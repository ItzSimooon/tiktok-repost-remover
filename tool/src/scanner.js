import { TIKTOK, firstVisible, anyVisible } from './selectors.js';
import { randBetween, randInt, sleep } from './throttle.js';
import { log } from './events.js';

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

// Wandelt ein Roh-Item aus TikToks Web-API in das schlanke Format der Oberfläche um.
export function normalizeItem(raw) {
  const author = raw.author ?? {};
  const authorId = author.uniqueId ?? raw.authorId ?? '';
  const tags = new Set([
    ...(raw.textExtra ?? []).map((t) => t.hashtagName).filter(Boolean),
    ...(raw.challenges ?? []).map((c) => c.title).filter(Boolean),
  ]);
  const stats = raw.statsV2 ?? raw.stats ?? {};
  return {
    id: String(raw.id),
    desc: raw.desc ?? '',
    createTime: num(raw.createTime),
    repostTime: num(raw.repostTime ?? raw.repost_time ?? raw.upvoteTime) ?? null,
    author: authorId,
    authorName: author.nickname ?? '',
    authorAvatar: author.avatarThumb ?? '',
    cover: raw.video?.cover || raw.video?.originCover || raw.video?.dynamicCover || '',
    duration: num(raw.video?.duration) ?? 0,
    plays: num(stats.playCount) ?? 0,
    likes: num(stats.diggCount) ?? 0,
    hashtags: [...tags],
    url: TIKTOK.videoUrl(authorId, raw.id),
    status: 'pending',
    error: null,
  };
}

/**
 * Lädt alle Reposts des eingeloggten Accounts:
 * öffnet das Profil, wechselt in den Reposts-Tab und scrollt gemächlich,
 * während die Antworten von /api/repost/item_list mitgelesen werden.
 * Es werden keine eigenen API-Anfragen gestellt – nur das, was die Seite ohnehin lädt.
 */
export async function scanReposts(session, username, { signal, onItems, onCaptcha }) {
  const page = await session.getPage();
  const items = new Map();
  let hasMore = true;
  let responses = 0;

  const onResponse = async (response) => {
    if (!TIKTOK.api.repostList.test(response.url())) return;
    try {
      const json = await response.json();
      responses += 1;
      const fresh = [];
      for (const raw of json.itemList ?? json.item_list ?? []) {
        if (!raw?.id || items.has(String(raw.id))) continue;
        const item = normalizeItem(raw);
        items.set(item.id, item);
        fresh.push(item);
      }
      hasMore = Boolean(json.hasMore ?? json.has_more);
      if (fresh.length) onItems(fresh, items.size);
    } catch (err) {
      log('debug', `Antwort der Repost-Liste nicht lesbar: ${err.message}`);
    }
  };

  page.on('response', onResponse);
  try {
    await page.goto(TIKTOK.profileUrl(username), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(randBetween(1800, 3200), signal);
    await waitForCaptcha(page, session, signal, onCaptcha);

    const tab = await firstVisible(page, TIKTOK.repostTab, 15_000);
    if (!tab) {
      throw new Error(
        'Reposts-Tab nicht gefunden. Prüfe, ob der Benutzername stimmt und du eingeloggt bist ' +
          '(der Tab ist nur für den Account-Inhaber sichtbar).',
      );
    }
    await tab.click();
    log('info', 'Reposts-Tab geöffnet – lade Liste …');
    await sleep(randBetween(1500, 2500), signal);

    let idleRounds = 0;
    let lastCount = -1;
    while (!signal.aborted) {
      await page.mouse.move(randInt(300, 900), randInt(300, 700)).catch(() => {});
      await page.mouse.wheel(0, randInt(1200, 2400)).catch(() => {});
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await sleep(randBetween(1300, 2700), signal);
      await waitForCaptcha(page, session, signal, onCaptcha);

      if (items.size === lastCount) idleRounds += 1;
      else {
        idleRounds = 0;
        lastCount = items.size;
      }
      if (!hasMore && idleRounds >= 2) break;
      if (idleRounds >= 8) {
        if (hasMore) log('warn', 'Keine neuen Reposts mehr geladen – Liste ist eventuell unvollständig. Scan ggf. wiederholen.');
        break;
      }
    }
    if (responses === 0 && !signal.aborted) {
      log('warn', 'TikTok hat keine Repost-Liste geliefert. Hast du überhaupt Reposts, oder ist der Tab leer?');
    }
  } finally {
    page.off('response', onResponse);
  }
  return [...items.values()];
}

async function waitForCaptcha(page, session, signal, onCaptcha) {
  if (!(await anyVisible(page, TIKTOK.captcha))) return;
  onCaptcha?.(true);
  log('warn', 'Captcha erkannt – bitte im Browserfenster lösen. Der Scan wartet so lange.');
  while (!signal.aborted && session.isOpen && (await anyVisible(page, TIKTOK.captcha))) {
    await sleep(1500, signal);
  }
  onCaptcha?.(false);
  await sleep(randBetween(1500, 3000), signal);
}
