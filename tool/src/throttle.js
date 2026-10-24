// Zufallswert zwischen min und max, gehäuft in der Mitte (Mittel zweier Gleichverteilungen).
// Wirkt natürlicher als eine reine Gleichverteilung und vermeidet starre Muster.
export const randBetween = (min, max) => min + (max - min) * ((Math.random() + Math.random()) / 2);
export const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

// Abbrechbares Sleep: löst mit false auf, wenn das Signal abgebrochen wurde.
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Bestimmt die Pausen zwischen Löschvorgängen:
 *  - jede Aktion: zufällige Pause im Bereich delayMin–delayMax (+ gelegentliches „Zögern“)
 *  - alle breakEveryMin–breakEveryMax Aktionen: lange Pause breakMin–breakMax
 *  - bei Fehlern: exponentieller Backoff (30 s, 60 s, 120 s … max. 10 min)
 *  - bei Rate-Limit-Signal: Abkühlphase von 10–15 Minuten
 * timeScale < 1 wird nur im Demo-Modus verwendet.
 */
export class Pacer {
  constructor(settings, timeScale = 1) {
    this.s = settings;
    this.scale = timeScale;
    this.sinceBreak = 0;
    this.breakAfter = this.#drawBreakAfter();
  }

  #drawBreakAfter() {
    return randInt(this.s.breakEveryMin, this.s.breakEveryMax);
  }

  next() {
    this.sinceBreak += 1;
    if (this.sinceBreak >= this.breakAfter) {
      this.sinceBreak = 0;
      this.breakAfter = this.#drawBreakAfter();
      return { kind: 'break', ms: randBetween(this.s.breakMinSec, this.s.breakMaxSec) * 1000 * this.scale };
    }
    let sec = randBetween(this.s.delayMinSec, this.s.delayMaxSec);
    if (Math.random() < 0.12) sec += randBetween(4, 15);
    return { kind: 'delay', ms: sec * 1000 * this.scale };
  }

  backoff(attempt) {
    const base = Math.min(30 * 2 ** (attempt - 1), 600);
    return randBetween(base * 0.85, base * 1.15) * 1000 * this.scale;
  }

  cooldown() {
    return randBetween(600, 900) * 1000 * this.scale;
  }
}
