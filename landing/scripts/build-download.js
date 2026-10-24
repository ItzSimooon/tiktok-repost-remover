// Packt ../tool als ZIP für den Download (ohne node_modules und ohne lokale Daten)
// und schreibt Version, Größe und SHA-256-Prüfsumme nach downloads/latest.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import archiver from 'archiver';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.resolve(DIR, '../tool');
const OUT = path.join(DIR, 'downloads');

const pkg = JSON.parse(await fsp.readFile(path.join(TOOL, 'package.json'), 'utf8'));
const file = `repost-cleaner-v${pkg.version}.zip`;
const target = path.join(OUT, file);
await fsp.mkdir(OUT, { recursive: true });

await new Promise((resolve, reject) => {
  const output = fs.createWriteStream(target);
  const zip = archiver('zip', { zlib: { level: 9 } });
  output.on('close', resolve);
  zip.on('error', reject);
  zip.on('warning', (err) => console.warn(err.message));
  zip.pipe(output);
  zip.glob(
    '**/*',
    {
      cwd: TOOL,
      dot: false,
      ignore: ['node_modules/**', 'data/**', '*.log', 'start.sh', 'start.command'],
    },
    { prefix: 'repost-cleaner/' },
  );
  // Ausführbare Startskripte für macOS/Linux
  for (const script of ['start.sh', 'start.command']) {
    if (fs.existsSync(path.join(TOOL, script))) {
      zip.file(path.join(TOOL, script), { name: `repost-cleaner/${script}`, mode: 0o755 });
    }
  }
  zip.append('', { name: 'repost-cleaner/data/.keep' });
  zip.finalize();
});

const buffer = await fsp.readFile(target);
const info = {
  version: pkg.version,
  file,
  size: buffer.length,
  sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  builtAt: new Date().toISOString(),
};
await fsp.writeFile(path.join(OUT, 'latest.json'), JSON.stringify(info, null, 2));
console.log(`✓ ${file} (${(info.size / 1024).toFixed(1)} KB)\n  SHA-256: ${info.sha256}`);
