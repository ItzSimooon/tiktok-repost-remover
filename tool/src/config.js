import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const PROFILE_DIR = path.join(DATA_DIR, 'browser-profile');

export const DEFAULT_SETTINGS = Object.freeze({
  delayMinSec: 8,          // Pause zwischen zwei Löschvorgängen (Untergrenze)
  delayMaxSec: 18,         // … (Obergrenze) – tatsächlicher Wert variiert zufällig
  breakEveryMin: 8,        // nach 8–15 Vorgängen folgt eine längere Pause
  breakEveryMax: 15,
  breakMinSec: 90,         // Länge der langen Pause
  breakMaxSec: 240,
  maxPerRun: 150,          // max. Vorgänge pro Durchlauf
  maxPerDay: 300,          // max. Vorgänge in 24 Stunden (aus der lokalen Historie berechnet)
  maxConsecutiveErrors: 3, // nach so vielen Fehlern in Folge stoppt der Lauf
  removalStrategy: 'auto', // 'auto' (UI, dann API) | 'ui' | 'api'
  dryRun: false,           // Testlauf: nichts wird wirklich entfernt
  keepSession: false,      // Browser-Profil lokal behalten (kein erneuter Login nötig)
});

// Harte Grenzen – auch über die Oberfläche nicht zu unterschreiten.
const BOUNDS = {
  delayMinSec: [4, 600],
  delayMaxSec: [6, 900],
  breakEveryMin: [3, 100],
  breakEveryMax: [4, 150],
  breakMinSec: [30, 3600],
  breakMaxSec: [45, 7200],
  maxPerRun: [1, 500],
  maxPerDay: [1, 1000],
  maxConsecutiveErrors: [1, 10],
};
const STRATEGIES = ['auto', 'ui', 'api'];
const MIN_GAP = [
  ['delayMinSec', 'delayMaxSec', 2],
  ['breakEveryMin', 'breakEveryMax', 1],
  ['breakMinSec', 'breakMaxSec', 15],
];

export function sanitizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...base };
  for (const [key, [min, max]] of Object.entries(BOUNDS)) {
    if (input[key] === undefined || input[key] === '') continue;
    const n = Number(input[key]);
    if (Number.isFinite(n)) out[key] = Math.round(Math.min(max, Math.max(min, n)));
  }
  if (STRATEGIES.includes(input.removalStrategy)) out.removalStrategy = input.removalStrategy;
  if (typeof input.dryRun === 'boolean') out.dryRun = input.dryRun;
  if (typeof input.keepSession === 'boolean') out.keepSession = input.keepSession;
  // Min/Max-Paare konsistent halten (Max liegt immer spürbar über Min → echte Variation)
  for (const [lo, hi, gap] of MIN_GAP) {
    if (out[hi] < out[lo] + gap) out[hi] = out[lo] + gap;
  }
  return out;
}
