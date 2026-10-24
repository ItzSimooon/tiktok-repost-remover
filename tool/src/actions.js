import { TIKTOK, firstVisible, anyVisible } from './selectors.js';
import { randBetween, sleep } from './throttle.js';
import { log } from './events.js';

/**
 * Entfernt EINEN Repost. Ergebnis:
 *   { outcome: 'removed' | 'skipped' | 'unverified' | 'error', reason?, error? }
 * reason 'captcha' / 'rate-limit' signalisiert dem Job, dass er warten muss.
 *
 * Strategien:
 *   ui   – öffnet das Video und klickt „Repost entfernen“ wie ein Mensch;
 *          Erfolg wird über TikToks eigene Antwort bestätigt.
 *   api  – sendet aus dem eingeloggten Tab dieselbe Anfrage, die die Webseite
 *          beim Klick sendet (Fallback, falls sich die Oberfläche geändert hat).
 *   auto – ui, bei nicht gefundenen Bedienelementen automatisch api.
 */
export async function removeRepost(page, item, strategy = 'auto') {
  if (strategy !== 'api') {
    const result = await removeViaUi(page, item);
    if (strategy === 'ui' || result.reason !== 'control-not-found') return result;
    log('debug', `Bedienelement nicht gefunden (${result.error}) – versuche API-Fallback.`);
  }
  return removeViaApi(page, item);
}

async function removeViaUi(page, item) {
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await sleep(randBetween(2000, 3800));

  if (await anyVisible(page, TIKTOK.captcha)) return { outcome: 'error', reason: 'captcha' };
  if (await anyVisible(page, TIKTOK.videoUnavailable)) {
    return { outcome: 'error', reason: 'control-not-found', error: 'Video nicht verfügbar' };
  }

  const share = await firstVisible(page, TIKTOK.shareButton, 10_000);
  if (!share) return { outcome: 'error', reason: 'control-not-found', error: 'Teilen-Button nicht gefunden' };

  // Alle POST-Anfragen nach dem Klick merken – hilft bei der Diagnose, falls TikTok Endpunkte umbenennt.
  const posts = [];
  const onRequest = (req) => {
    if (req.method() === 'POST' && req.url().startsWith(TIKTOK.origin)) posts.push(new URL(req.url()).pathname);
  };

  await share.hover().catch(() => {});
  await sleep(randBetween(300, 800));
  await share.click();
  await sleep(randBetween(800, 1600));

  const remove = await firstVisible(page, TIKTOK.removeRepostButton, 5_000);
  if (!remove) {
    const notReposted = await anyVisible(page, TIKTOK.addRepostButton);
    await page.keyboard.press('Escape').catch(() => {});
    if (notReposted) return { outcome: 'skipped', error: 'War bereits nicht mehr repostet' };
    return { outcome: 'error', reason: 'control-not-found', error: 'Option „Repost entfernen“ nicht gefunden' };
  }

  const confirmation = page
    .waitForResponse((res) => TIKTOK.api.repostDelete.test(res.url()), { timeout: 15_000 })
    .catch(() => null);
  page.on('request', onRequest);
  try {
    await sleep(randBetween(250, 700));
    await remove.click();
    const response = await confirmation;
    if (!response) {
      if (posts.length) log('debug', `Gesendete Anfragen nach dem Klick: ${[...new Set(posts)].join(', ')}`);
      return { outcome: 'unverified', error: 'Klick ausgeführt, aber keine Bestätigung von TikTok erhalten' };
    }
    return interpret(response.status(), await response.json().catch(() => null));
  } finally {
    page.off('request', onRequest);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function removeViaApi(page, item) {
  if (!page.url().startsWith(TIKTOK.origin)) {
    await page.goto(TIKTOK.home, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(randBetween(1500, 3000));
  }
  if (await anyVisible(page, TIKTOK.captcha)) return { outcome: 'error', reason: 'captcha' };

  // Läuft im eingeloggten TikTok-Tab (same-origin). Das Tool selbst sieht dabei keine Cookies.
  const { status, json } = await page.evaluate(
    async ({ path, id }) => {
      const params = new URLSearchParams({ aid: '1988', item_id: id });
      try {
        const res = await fetch(`${path}?${params}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });
        let body = null;
        try {
          body = await res.json();
        } catch {
          /* leere Antwort */
        }
        return { status: res.status, json: body };
      } catch (err) {
        return { status: 0, json: { status_msg: String(err) } };
      }
    },
    { path: TIKTOK.api.deletePath, id: item.id },
  );
  return interpret(status, json);
}

function interpret(httpStatus, json) {
  if (httpStatus === 429) return { outcome: 'error', reason: 'rate-limit', error: 'HTTP 429 – zu viele Anfragen' };
  const code = json?.status_code ?? json?.statusCode;
  if (httpStatus >= 200 && httpStatus < 300 && code === 0) return { outcome: 'removed' };
  const msg = json?.status_msg || json?.statusMsg || json?.message || '';
  if (/frequen|too many|rate|limit|häufig|später erneut|try again later/i.test(msg)) {
    return { outcome: 'error', reason: 'rate-limit', error: msg };
  }
  if (/verif|captcha/i.test(msg)) return { outcome: 'error', reason: 'captcha', error: msg };
  return {
    outcome: 'error',
    reason: 'api',
    error: msg || (code !== undefined ? `TikTok-Statuscode ${code}` : `HTTP ${httpStatus || 'Netzwerkfehler'}`),
  };
}
