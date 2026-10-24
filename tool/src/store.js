import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './config.js';

// Lokale Ablage in ./data – enthält ausschließlich Repost-Metadaten, Einstellungen und
// die Lösch-Historie. Niemals Passwörter, Cookies oder Tokens.

const writeQueues = new Map();

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readJson(name, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

// Atomar schreiben (tmp + rename) und Schreibvorgänge pro Datei serialisieren.
export function writeJson(name, data) {
  const file = path.join(DATA_DIR, name);
  const previous = writeQueues.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      const tmp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2));
      await fs.rename(tmp, file);
    });
  writeQueues.set(file, next);
  return next;
}

export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const HISTORY = () => path.join(DATA_DIR, 'history.jsonl');

export async function appendHistory(entry) {
  await fs.appendFile(HISTORY(), `${JSON.stringify(entry)}\n`);
}

// Anzahl echter (nicht simulierter) Entfernungen seit `since` – für das Tageslimit.
export async function countRemovalsSince(since) {
  let raw;
  try {
    raw = await fs.readFile(HISTORY(), 'utf8');
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (!e.dryRun && e.at >= since && ['removed', 'unverified'].includes(e.outcome)) count += 1;
    } catch {
      /* defekte Zeile ignorieren */
    }
  }
  return count;
}
