import { Pacer, sleep } from './throttle.js';
import { log, patchState, state } from './events.js';
import { appendHistory } from './store.js';

const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
};

/**
 * Arbeitet die Lösch-Warteschlange ab – strikt nacheinander, nie parallel,
 * mit variierenden Pausen, langen Pausen, Backoff und Abkühlphasen.
 */
export class RemovalJob {
  #abort = new AbortController();
  #paused = false;
  #stopRequested = false;
  #resumeWaiters = [];
  active = false;

  constructor({ session, items, settings, timeScale = 1, usedToday = 0, onItem }) {
    this.session = session;
    this.items = items;
    this.settings = settings;
    this.usedToday = usedToday;
    this.onItem = onItem;
    this.pacer = new Pacer(settings, timeScale);
  }

  #set(patch) {
    patchState({ job: patch });
  }

  pause(message = 'Pausiert – klicke „Fortsetzen“, um weiterzumachen.') {
    if (!this.active || this.#paused) return;
    this.#paused = true;
    this.#set({ status: 'paused', message });
    log('info', message);
  }

  resume() {
    if (!this.#paused) return;
    this.#paused = false;
    if (!this.#stopRequested) {
      this.#set({ status: 'running', message: '' });
      log('info', 'Fortgesetzt.');
    }
    this.#resumeWaiters.splice(0).forEach((resolve) => resolve());
  }

  stop() {
    if (!this.active) return;
    this.#stopRequested = true;
    this.#abort.abort();
    this.#set({ status: 'stopping', message: 'Wird nach dem aktuellen Schritt beendet …' });
    this.resume();
  }

  async #waitIfPaused() {
    while (this.#paused && !this.#stopRequested) {
      await new Promise((resolve) => this.#resumeWaiters.push(resolve));
    }
  }

  async #wait(ms, kind, message) {
    if (message) log('info', `${message} (${fmtDuration(ms)})`);
    this.#set({ wait: { kind, until: Date.now() + ms, ms } });
    await sleep(ms, this.#abort.signal);
    this.#set({ wait: null });
  }

  async #attempt(item) {
    try {
      return await this.session.remove(item, this.settings.removalStrategy);
    } catch (err) {
      return { outcome: 'error', reason: 'exception', error: String(err?.message ?? err).split('\n')[0] };
    }
  }

  async run() {
    const s = this.settings;
    const dailyLeft = Math.max(0, s.maxPerDay - this.usedToday);
    const limit = Math.min(this.items.length, s.maxPerRun, s.dryRun ? Infinity : dailyLeft);
    const queue = this.items.slice(0, limit);
    this.active = true;
    this.#set({
      status: 'running', total: queue.length, processed: 0, removed: 0, failed: 0, skipped: 0, unverified: 0,
      dryRun: s.dryRun, current: null, wait: null, message: '', startedAt: Date.now(), finishedAt: null,
    });

    if (limit < this.items.length) {
      const why = limit === dailyLeft && !s.dryRun ? `Tageslimit (${s.maxPerDay}/24 h)` : `Limit pro Durchlauf (${s.maxPerRun})`;
      log('warn', `${why}: In diesem Durchlauf werden ${limit} von ${this.items.length} Reposts bearbeitet. Den Rest kannst du später starten.`);
    }
    log('info', `${s.dryRun ? 'TESTLAUF gestartet' : 'Lauf gestartet'}: ${queue.length} Reposts, Pausen ${s.delayMinSec}–${s.delayMaxSec} s, lange Pause alle ${s.breakEveryMin}–${s.breakEveryMax}.`);

    let consecutiveErrors = 0;
    let rateLimitHits = 0;

    for (let i = 0; i < queue.length && !this.#stopRequested; i++) {
      if (!this.session.isOpen) this.pause('Browser ist geschlossen – bitte erneut öffnen und dann „Fortsetzen“ klicken.');
      await this.#waitIfPaused();
      if (this.#stopRequested) break;

      const item = queue[i];
      this.#set({ current: { id: item.id, author: item.author, desc: item.desc.slice(0, 120) } });

      let result;
      if (s.dryRun) {
        await sleep(400 + Math.random() * 600, this.#abort.signal);
        result = { outcome: 'removed', simulated: true };
      } else {
        // Wiederholungen nur für Captcha (Nutzer löst es) und Rate-Limit (Abkühlphase).
        while (!this.#stopRequested) {
          result = await this.#attempt(item);
          if (result.reason === 'captcha') {
            patchState({ captcha: true });
            this.pause('Captcha erkannt – bitte im Browserfenster lösen und dann „Fortsetzen“ klicken.');
            await this.#waitIfPaused();
            patchState({ captcha: false });
            continue;
          }
          if (result.reason === 'rate-limit') {
            rateLimitHits += 1;
            if (rateLimitHits >= 2) {
              log('error', 'TikTok bremst erneut. Der Lauf wird zum Schutz deines Accounts beendet – bitte in einigen Stunden fortfahren.');
              this.#stopRequested = true;
              break;
            }
            await this.#wait(this.pacer.cooldown(), 'cooldown', `TikTok meldet zu viele Anfragen (${result.error}). Abkühlphase`);
            continue;
          }
          break;
        }
        if (!result || ['captcha', 'rate-limit'].includes(result.reason)) break;
      }

      const j = state.job;
      const patch = { processed: j.processed + 1, current: null };
      let status = item.status;
      if (result.outcome === 'removed') {
        patch.removed = j.removed + 1;
        consecutiveErrors = 0;
        rateLimitHits = 0;
        if (!s.dryRun) status = 'removed';
        log('ok', `${s.dryRun ? '[Test] Würde entfernen' : 'Entfernt'}: @${item.author} – ${item.desc.slice(0, 60) || item.id}`);
      } else if (result.outcome === 'skipped') {
        patch.skipped = j.skipped + 1;
        consecutiveErrors = 0;
        status = 'removed';
        log('info', `Übersprungen (${result.error}): @${item.author}`);
      } else if (result.outcome === 'unverified') {
        patch.unverified = j.unverified + 1;
        consecutiveErrors = 0;
        status = 'unverified';
        log('warn', `Unbestätigt: @${item.author} – ${result.error}. Ein erneuter Scan zeigt, ob der Repost weg ist.`);
      } else {
        patch.failed = j.failed + 1;
        consecutiveErrors += 1;
        status = 'failed';
        log('error', `Fehler bei @${item.author}: ${result.error}`);
      }
      this.#set(patch);
      this.onItem(item.id, status, result.outcome === 'removed' ? null : result.error ?? null);
      if (!s.dryRun || result.outcome !== 'removed') {
        await appendHistory({
          at: Date.now(), id: item.id, author: item.author, desc: item.desc, url: item.url,
          outcome: result.outcome, error: result.error ?? null, dryRun: s.dryRun,
        }).catch(() => {});
      }

      if (consecutiveErrors >= s.maxConsecutiveErrors) {
        log('error', `${consecutiveErrors} Fehler in Folge – Lauf wird sicherheitshalber beendet. Prüfe das Browserfenster und das Protokoll.`);
        break;
      }
      if (i === queue.length - 1 || this.#stopRequested) break;

      if (result.outcome === 'error') {
        await this.#wait(this.pacer.backoff(consecutiveErrors), 'backoff', 'Warte nach Fehler');
      } else if (s.dryRun) {
        continue;
      } else {
        const next = this.pacer.next();
        await this.#wait(next.ms, next.kind, next.kind === 'break' ? 'Lange Pause zum Schutz vor dem Rate-Limit' : null);
      }
    }

    const j = state.job;
    const stopped = this.#stopRequested || j.processed < j.total;
    this.active = false;
    this.#set({
      status: stopped ? 'stopped' : 'finished', current: null, wait: null, finishedAt: Date.now(),
      message: stopped ? 'Lauf beendet.' : 'Fertig!',
    });
    log(stopped ? 'warn' : 'ok', `${stopped ? 'Lauf beendet' : 'Fertig'}: ${j.removed} entfernt, ${j.skipped} übersprungen, ${j.unverified} unbestätigt, ${j.failed} Fehler.`);
  }
}
