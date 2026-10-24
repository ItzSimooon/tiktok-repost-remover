// Landingpage für tiktok.hyprnode.de
// Rein statische Auslieferung + Download. Keine Logins, keine Formulare, keine TikTok-Logik, kein Tracking.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(DIR, 'public');
const DOWNLOADS = path.join(DIR, 'downloads');
const FONTS = path.join(DIR, 'node_modules/@fontsource-variable');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1'; // hinter nginx; für Direktbetrieb HOST=0.0.0.0
const DOWNLOAD_URL = process.env.DOWNLOAD_URL || ''; // optional: externe Quelle (z. B. GitHub Release)
const PROD = process.env.NODE_ENV === 'production';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: PROD ? [] : null,
      },
    },
    strictTransportSecurity: PROD ? { maxAge: 63072000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use((_req, res, next) => {
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  next();
});
app.use(compression());

// Schriften selbst hosten (DSGVO: keine Verbindung zu Google Fonts)
for (const family of ['figtree', 'league-spartan']) {
  app.use(`/fonts/${family}`, express.static(path.join(FONTS, family, 'files'), { immutable: true, maxAge: '365d', fallthrough: false }));
}

async function latestBuild() {
  try {
    return JSON.parse(await fs.readFile(path.join(DOWNLOADS, 'latest.json'), 'utf8'));
  } catch {
    return null;
  }
}

app.get('/download/info.json', async (_req, res) => {
  const info = await latestBuild();
  res.set('Cache-Control', 'public, max-age=300');
  if (!info) return res.status(404).json({ available: false });
  const { version, file, size, sha256, builtAt } = info;
  res.json({ available: true, version, file, size, sha256, builtAt, url: '/download' });
});

app.get('/download', async (_req, res, next) => {
  if (DOWNLOAD_URL) return res.redirect(302, DOWNLOAD_URL);
  const info = await latestBuild();
  if (!info) return next();
  res.set('Cache-Control', 'no-cache');
  res.download(path.join(DOWNLOADS, path.basename(info.file)), info.file);
});

app.get('/healthz', (_req, res) => res.type('text').send('ok'));

app.use(
  express.static(PUBLIC, {
    extensions: ['html'],
    maxAge: '7d',
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) res.set('Cache-Control', 'no-cache');
    },
  }),
);

app.use((_req, res) => res.status(404).sendFile(path.join(PUBLIC, '404.html')));

app.listen(PORT, HOST, () => {
  console.log(`Landingpage läuft auf http://${HOST}:${PORT}`);
});
