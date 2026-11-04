#!/usr/bin/env node
// Minifikujemy i wersjonujemy wyłącznie artefakt; czytelne źródła pozostają bez zmian.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { transform } = createRequire(path.join(__dirname, '../tests/package.json'))('esbuild');
const { contentHashAssets } = require('./content-hash-assets.cjs');
const { addModulePreloads } = require('./module-preload.cjs');
const TEXT_EXT = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.svg', '.xml']);
const stableVersions = source => source.replace(/\?v=[a-zA-Z0-9T:-]+/g, '?v=vASSET');

async function buildPublic({ source = path.join(__dirname, '../web'), out = path.join(__dirname, '../_site_public') } = {}) {
  source = path.resolve(source); out = path.resolve(out);
  if (source === out || source.startsWith(out + path.sep) || out.startsWith(source + path.sep)) throw new Error('Katalog wynikowy musi być oddzielony od źródeł');
  const marker = path.join(out, '.familijna-build.json');
  const entries = await fs.readdir(out).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  if (entries.length && !await fs.stat(marker).catch(() => null)) throw new Error('Niepusty katalog bez znacznika buildu');
  await fs.rm(out, { recursive: true, force: true });
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(marker, JSON.stringify({ format: 1, complete: false }) + '\n');
  const totals = { js: { files: 0, source: 0, output: 0 }, css: { files: 0, source: 0, output: 0 } };
  async function copy(dir, relative = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.endsWith('.md')) continue;
      const rel = path.join(relative, entry.name), src = path.join(dir, entry.name), dest = path.join(out, rel);
      if (entry.isDirectory()) { await fs.mkdir(dest, { recursive: true }); await copy(src, rel); continue; }
      if (!entry.isFile()) throw new Error(`Nieobsługiwany typ pliku: ${rel}`);
      const kind = path.extname(rel).slice(1);
      if (!['js', 'css'].includes(kind) || rel.split(path.sep).includes('vendor') || /\.min\.(js|css)$/.test(rel)) {
        if (TEXT_EXT.has(path.extname(rel).toLowerCase()) && !rel.split(path.sep).includes('vendor')) {
          await fs.writeFile(dest, stableVersions(await fs.readFile(src, 'utf8')));
        } else await fs.copyFile(src, dest);
        continue;
      }
      const raw = await fs.readFile(src, 'utf8');
      const input = stableVersions(raw);
      const result = await transform(input, { loader: kind, sourcefile: rel, minify: true,
        // Bez bundlowania: dynamiczne ścieżki import.meta.url i manifesty nadal działają.
        target: kind === 'js' ? 'esnext' : ['chrome80', 'safari13', 'firefox78'],
        keepNames: kind === 'js', legalComments: 'inline', charset: 'utf8' });
      for (const warning of result.warnings) console.warn(`[build] ${rel}: ${warning.text}`);
      await fs.writeFile(dest, result.code);
      totals[kind].files++; totals[kind].source += Buffer.byteLength(raw); totals[kind].output += Buffer.byteLength(result.code);
    }
  }
  await copy(source);
  totals.preload = await addModulePreloads(out);
  await fs.writeFile(marker, JSON.stringify({ format: 1, totals }, null, 2) + '\n');
  totals.hashes = contentHashAssets(out);
  return totals;
}
module.exports = { buildPublic };
if (require.main === module) {
  const output = process.argv.find(arg => arg.startsWith('--out='))?.slice(6);
  buildPublic(output ? { out: output } : {}).then(totals => console.log(JSON.stringify(totals)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
