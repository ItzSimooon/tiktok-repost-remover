import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';

import { DEFAULT_SETTINGS, PROFILE_DIR, PUBLIC_DIR, sanitizeSettings } from './config.js';
import { bus, log, patchState, recentLogs, state } from './events.js';
import { countRemovalsSince, debounce, ensureDataDir, readJson, writeJson } from './store.js';
import { RemovalJob } from './job.js';

const args = new Set(process.argv.slice(2));
const DEMO = args.has('--demo') || process.env.DEMO === '1';
const HOST = '127.0.0.1'; // ausschließlich lokal erreichbar
const PORT = Number(process.env.PORT) || 4321;
const TOKEN = crypto.randomBytes(24).toString('hex'); // schützt die lokale API vor fremden Webseiten (CSRF)
const ITEMS_FILE = DEMO ? 'demo-reposts.json' : 'reposts.json';

await ensureDataDir();

const { TikTokSession } = DEMO ? {} : await import('./browser.js');
const { DemoSession } = DEMO ? await import('./demo.js') : {};
const session = DEMO ? new DemoSession() : new TikTokSession();

let settings = sanitizeSettings(await readJson('settings.json', {}), DEFAULT_SETTINGS);
const cache = await readJson(ITEMS_FILE, { username: null, scannedAt: null, items: [] });
let items = new Map(cache.items.map((it) => [it.id, it]));
let scanAbort = null;
let job = null;

patchState({ demo: DEMO, username: cache.username ?? null });

const saveItems = debounce(() => {
  writeJson(ITEMS_FILE, { username: state.username, scannedAt: cache.scannedAt, items: [...items.values()] }).catch((err) =>
    log('error', `Speichern fehlgeschlagen: ${err.message}`),
  );
}, 800);

session.onClosed = () => {
  scanAbort?.abort();
  if (job?.active) job.pause('Browser wurde geschlossen – bitte erneut öffnen und „Fortsetzen“ klicken.');
};

// ───────────────────────────── HTTP ─────────────────────────────

const app = express();
app.disable('x-powered-by');

// Schutz gegen DNS-Rebinding: nur Anfragen an localhost akzeptieren.
app.use((req, res, next) => {
  const host = (req.headers.host ?? '').replace(/:\d+$/, '');
  if (host !== '127.0.0.1' && host !== 'localhost') return res.status(403).send('Forbidden');
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
});

const indexHtml = (await fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8')).replace('__TOKEN__', TOKEN);
app.get('/', (_req, res) => res.type('html').set('Cache-Control', 'no-store').send(indexHtml));
app.use(express.static(PUBLIC_DIR, { index: false, maxAge: 0 }));
app.use(express.json({ limit: '2mb' }));

// Alle schreibenden API-Aufrufe brauchen das Token aus der ausgelieferten Seite.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET') return next();
  if (req.get('x-rc-token') !== TOKEN) return res.status(403).json({ error: 'Ungültiges Token – Seite neu laden.' });
  next();
});

const fail = (res, status, error) => res.status(status).json({ error });
const snapshot = () => ({
  state,
  settings,
  items: [...items.values()],
  scannedAt: cache.scannedAt,
  logs: recentLogs(),
});

app.get('/api/state', (_req, res) => res.json(snapshot()));

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  const listeners = {
    state: (s) => send('state', s),
    log: (e) => send('log', e),
    item: (e) => send('item', e),
    'items-append': (e) => send('items-append', e),
    'items-reset': (e) => send('items-reset', e),
    settings: (e) => send('settings', e),
  };
  for (const [ev, fn] of Object.entries(listeners)) bus.on(ev, fn);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  send('snapshot', snapshot());
  req.on('close', () => {
    clearInterval(ping);
    for (const [ev, fn] of Object.entries(listeners)) bus.off(ev, fn);
  });
});

app.post('/api/browser/open', async (_req, res) => {
  try {
    await session.open({ keepSession: settings.keepSession });
    res.json({ ok: true });
  } catch (err) {
    log('error', err.message);
    fail(res, 500, err.message);
  }
});

app.post('/api/browser/close', async (_req, res) => {
  await session.close();
  res.json({ ok: true });
});

app.post('/api/username', (req, res) => {
  const username = String(req.body?.username ?? '').trim().replace(/^@/, '');
  if (!/^[\w.-]{2,32}$/.test(username)) return fail(res, 400, 'Ungültiger Benutzername.');
  patchState({ username });
  res.json({ ok: true });
});

app.post('/api/scan', (req, res) => {
  if (!session.isOpen) return fail(res, 409, 'Bitte zuerst den Browser öffnen.');
  if (!state.loggedIn) return fail(res, 409, 'Bitte zuerst im Browserfenster bei TikTok einloggen.');
  if (state.scan.running) return fail(res, 409, 'Es läuft bereits ein Scan.');
  if (job?.active) return fail(res, 409, 'Während eines Lösch-Laufs kann nicht gescannt werden.');
  const username = String(req.body?.username ?? state.username ?? '').trim().replace(/^@/, '');
  if (!/^[\w.-]{2,32}$/.test(username)) return fail(res, 400, 'Bitte deinen TikTok-Benutzernamen angeben.');

  patchState({ username, scan: { running: true, found: 0, message: 'Scan läuft …' } });
  scanAbort = new AbortController();
  const previous = items;
  items = new Map();
  bus.emit('items-reset', {});
  log('info', `Lade Reposts von @${username} …`);

  session
    .scan(username, {
      signal: scanAbort.signal,
      onCaptcha: (captcha) => patchState({ captcha }),
      onItems: (fresh, total) => {
        for (const it of fresh) {
          // Status aus früheren Läufen übernehmen, falls der Repost noch auftaucht
          const old = previous.get(it.id);
          if (old && old.status === 'failed') Object.assign(it, { status: 'failed', error: old.error });
          items.set(it.id, it);
        }
        patchState({ scan: { found: total } });
        bus.emit('items-append', { items: fresh });
      },
    })
    .then((list) => {
      cache.scannedAt = Date.now();
      const aborted = scanAbort?.signal.aborted;
      patchState({ scan: { running: false, found: list.length, message: aborted ? 'Scan abgebrochen.' : 'Scan abgeschlossen.' } });
      log('ok', `${aborted ? 'Scan abgebrochen' : 'Scan abgeschlossen'}: ${list.length} Reposts gefunden.`);
    })
    .catch((err) => {
      if (items.size === 0 && previous.size > 0) {
        items = previous; // fehlgeschlagener Scan soll die alte Liste nicht verwerfen
        bus.emit('items-reset', { items: [...items.values()] });
      }
      patchState({ scan: { running: false, found: items.size, message: err.message } });
      log('error', `Scan fehlgeschlagen: ${err.message.split('\n')[0]}`);
    })
    .finally(() => {
      scanAbort = null;
      saveItems();
    });
  res.json({ ok: true });
});

app.post('/api/scan/stop', (_req, res) => {
  scanAbort?.abort();
  res.json({ ok: true });
});

app.post('/api/settings', async (req, res) => {
  const before = settings.keepSession;
  settings = sanitizeSettings(req.body ?? {}, settings);
  await writeJson('settings.json', settings);
  bus.emit('settings', settings);
  if (before !== settings.keepSession && session.isOpen) {
    log('info', 'Die Sitzungs-Einstellung greift beim nächsten Öffnen des Browsers.');
  }
  res.json({ ok: true, settings });
});

app.post('/api/session/forget', async (_req, res) => {
  if (session.isOpen) return fail(res, 409, 'Bitte zuerst den Browser schließen.');
  await fs.rm(PROFILE_DIR, { recursive: true, force: true });
  patchState({ username: null });
  log('ok', 'Lokales Browser-Profil gelöscht – beim nächsten Start ist ein neuer Login nötig.');
  res.json({ ok: true });
});

app.post('/api/items/clear', (_req, res) => {
  if (state.scan.running || job?.active) return fail(res, 409, 'Gerade beschäftigt.');
  items = new Map();
  cache.scannedAt = null;
  bus.emit('items-reset', {});
  saveItems();
  res.json({ ok: true });
});

app.post('/api/remove', async (req, res) => {
  if (job?.active) return fail(res, 409, 'Es läuft bereits ein Lauf.');
  if (state.scan.running) return fail(res, 409, 'Bitte warten, bis der Scan fertig ist.');
  if (!settings.dryRun && (!session.isOpen || !state.loggedIn)) return fail(res, 409, 'Browser öffnen und einloggen, bevor du löschst.');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const queue = ids.map((id) => items.get(id)).filter((it) => it && it.status !== 'removed');
  if (!queue.length) return fail(res, 400, 'Keine (offenen) Reposts ausgewählt.');

  const usedToday = await countRemovalsSince(Date.now() - 24 * 3600 * 1000);
  if (!settings.dryRun && usedToday >= settings.maxPerDay) {
    return fail(res, 429, `Tageslimit erreicht (${usedToday}/${settings.maxPerDay} in 24 h). Bitte später fortfahren.`);
  }

  job = new RemovalJob({
    session,
    items: queue,
    settings: { ...settings },
    timeScale: DEMO ? 0.12 : 1,
    usedToday,
    onItem: (id, status, error) => {
      const it = items.get(id);
      if (!it) return;
      Object.assign(it, { status, error });
      bus.emit('item', { id, status, error });
      saveItems();
    },
  });
  job.run().catch((err) => log('error', `Lauf abgebrochen: ${err.message}`));
  res.json({ ok: true, queued: queue.length });
});

app.post('/api/job/:action', (req, res) => {
  if (!job?.active) return fail(res, 409, 'Kein aktiver Lauf.');
  const action = { pause: () => job.pause(), resume: () => job.resume(), stop: () => job.stop() }[req.params.action];
  if (!action) return fail(res, 404, 'Unbekannte Aktion.');
  action();
  res.json({ ok: true });
});

app.use('/api', (_req, res) => fail(res, 404, 'Nicht gefunden.'));

// ──────────────────────────── Start ─────────────────────────────

const server = app.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`\n  Repost Cleaner ${DEMO ? '(DEMO) ' : ''}läuft auf ${url}`);
  console.log('  Nur auf diesem Rechner erreichbar. Beenden mit Strg+C.\n');
  if (!args.has('--no-open')) openInBrowser(url);
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `Port ${PORT} ist belegt. Starte mit PORT=4322 npm start` : err);
  process.exit(1);
});

function openInBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin' ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  } catch {
    /* kein Desktop – URL steht in der Konsole */
  }
}

async function shutdown() {
  job?.stop();
  scanAbort?.abort();
  await session.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
