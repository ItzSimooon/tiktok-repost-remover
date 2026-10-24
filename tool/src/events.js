import { EventEmitter } from 'node:events';

// Zentraler Event-Bus: alles, was die Oberfläche live sehen soll, läuft hierüber (→ SSE).
export const bus = new EventEmitter();
bus.setMaxListeners(0);

export const state = {
  demo: false,
  browser: 'closed', // closed | starting | open
  loggedIn: false,
  username: null,
  captcha: false,
  scan: { running: false, found: 0, message: '' },
  job: {
    status: 'idle', // idle | running | paused | stopping | finished | stopped
    total: 0,
    processed: 0,
    removed: 0,
    failed: 0,
    skipped: 0,
    unverified: 0,
    dryRun: false,
    current: null,
    wait: null, // { kind: 'delay'|'break'|'backoff'|'cooldown', until, ms }
    message: '',
    startedAt: null,
    finishedAt: null,
  },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function patchState(patch) {
  const before = JSON.stringify(state);
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(state[key])) Object.assign(state[key], value);
    else state[key] = value;
  }
  if (JSON.stringify(state) !== before) bus.emit('state', state);
}

const logBuffer = [];
const LOG_TAGS = { info: 'i', ok: '✓', warn: '!', error: '✗', debug: '·' };

export function log(level, message) {
  const entry = { ts: Date.now(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > 500) logBuffer.shift();
  bus.emit('log', entry);
  const time = new Date(entry.ts).toLocaleTimeString('de-DE');
  console.log(`[${time}] ${LOG_TAGS[level] ?? '-'} ${message}`);
}

export const recentLogs = () => logBuffer.slice(-250);
