import fs from 'node:fs/promises';
import { PROFILE_DIR } from './config.js';
import { TIKTOK, anyVisible } from './selectors.js';
import { log, patchState, state } from './events.js';
import { scanReposts } from './scanner.js';
import { removeRepost } from './actions.js';

// Bevorzugt den installierten Chrome bzw. Edge (Login funktioniert dort am zuverlässigsten),
// sonst das von Playwright mitgelieferte Chromium.
const CHANNELS = ['chrome', 'msedge', null];

/**
 * Steuert ein ECHTES, sichtbares Browserfenster auf deinem Rechner.
 * Du loggst dich darin selbst ein – das Tool fragt keine Zugangsdaten ab,
 * liest keine Cookie-Inhalte aus und überträgt nichts an Dritte.
 */
export class TikTokSession {
  context = null;
  browser = null;
  page = null;
  watchTimer = null;
  onClosed = null;

  get isOpen() {
    return Boolean(this.context);
  }

  async open({ keepSession }) {
    if (this.context) {
      await (await this.getPage()).bringToFront().catch(() => {});
      return;
    }
    patchState({ browser: 'starting' });
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      patchState({ browser: 'closed' });
      throw new Error('Playwright ist nicht installiert. Bitte im Tool-Ordner „npm install“ ausführen.');
    }

    let lastError;
    for (const channel of CHANNELS) {
      const launchOpts = { headless: false, ...(channel ? { channel } : {}) };
      try {
        if (keepSession) {
          await fs.mkdir(PROFILE_DIR, { recursive: true });
          this.context = await chromium.launchPersistentContext(PROFILE_DIR, { ...launchOpts, viewport: null });
        } else {
          this.browser = await chromium.launch(launchOpts);
          this.browser.on('disconnected', () => this.#handleClosed());
          this.context = await this.browser.newContext({ viewport: null });
        }
        log('ok', `Browser gestartet (${channel ?? 'Playwright-Chromium'}, ${keepSession ? 'Sitzung wird lokal gemerkt' : 'temporäre Sitzung'}).`);
        break;
      } catch (err) {
        lastError = err;
        await this.browser?.close().catch(() => {});
        this.browser = null;
        this.context = null;
      }
    }
    if (!this.context) {
      patchState({ browser: 'closed' });
      throw new Error(
        'Kein Browser gefunden. Installiere Google Chrome/Microsoft Edge oder führe „npm run browser:install“ aus. ' +
          `(${String(lastError?.message ?? '').split('\n')[0]})`,
      );
    }

    this.context.on('close', () => this.#handleClosed());
    const page = await this.getPage();
    patchState({ browser: 'open' });
    await page.goto(TIKTOK.home, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch((err) => {
      log('warn', `TikTok konnte nicht geladen werden: ${err.message.split('\n')[0]}`);
    });
    log('info', 'Bitte logge dich jetzt im geöffneten Browserfenster selbst bei TikTok ein (QR-Code, E-Mail o. Ä.).');
    this.#startWatch();
  }

  async close() {
    const target = this.browser ?? this.context;
    if (target) await target.close().catch(() => {});
    this.#handleClosed();
  }

  async getPage() {
    if (!this.context) throw new Error('Der Browser ist nicht geöffnet.');
    if (!this.page || this.page.isClosed()) {
      this.page = this.context.pages().find((p) => !p.isClosed()) ?? (await this.context.newPage());
    }
    return this.page;
  }

  #handleClosed() {
    if (!this.context && !this.browser) return;
    clearInterval(this.watchTimer);
    this.context = null;
    this.browser = null;
    this.page = null;
    patchState({ browser: 'closed', loggedIn: false, captcha: false });
    log('warn', 'Das Browserfenster wurde geschlossen.');
    this.onClosed?.();
  }

  #startWatch() {
    clearInterval(this.watchTimer);
    let busy = false;
    const tick = async () => {
      if (!this.context || busy) return;
      busy = true;
      try {
        const loggedIn = await this.isLoggedIn();
        const patch = { loggedIn, captcha: await this.hasCaptcha() };
        if (loggedIn && !state.loggedIn) log('ok', 'Login erkannt.');
        if (loggedIn && !state.username) {
          const username = await this.detectUsername();
          if (username) {
            patch.username = username;
            log('ok', `Eingeloggt als @${username}.`);
          }
        }
        patchState(patch);
      } catch {
        /* Fenster wird gerade geschlossen o. Ä. */
      } finally {
        busy = false;
      }
    };
    this.watchTimer = setInterval(tick, 2500);
    tick();
  }

  async isLoggedIn() {
    if (!this.context) return false;
    const cookies = await this.context.cookies(TIKTOK.origin);
    // Nur Existenz/Ablauf werden geprüft; der Inhalt wird nie gespeichert, geloggt oder übertragen.
    return cookies.some(
      (c) => c.name === TIKTOK.sessionCookie && c.value !== '' && (c.expires === -1 || c.expires * 1000 > Date.now()),
    );
  }

  async detectUsername() {
    const page = await this.getPage();
    if (!page.url().startsWith(TIKTOK.origin)) return null;
    return page
      .evaluate(() => {
        try {
          const raw = document.getElementById('__UNIVERSAL_DATA_FOR_REHYDRATION__')?.textContent;
          const id = raw && JSON.parse(raw)?.__DEFAULT_SCOPE__?.['webapp.app-context']?.user?.uniqueId;
          if (id) return id;
        } catch {
          /* Struktur geändert – Fallback unten */
        }
        const link = document.querySelector('a[data-e2e="nav-profile"], a[data-e2e="profile-icon"]');
        return link?.getAttribute('href')?.match(/^\/@([\w.-]+)/)?.[1] ?? null;
      })
      .catch(() => null);
  }

  async hasCaptcha() {
    if (!this.page || this.page.isClosed()) return false;
    return anyVisible(this.page, TIKTOK.captcha);
  }

  async scan(username, options) {
    return scanReposts(this, username, options);
  }

  async remove(item, strategy) {
    return removeRepost(await this.getPage(), item, strategy);
  }
}
