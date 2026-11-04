import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { buildPublic } = createRequire(import.meta.url)('../../scripts/build-public.cjs');

const write = async (root, rel, text) => {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), text);
};

test('artifact preloads the whole static module graph and the page dictionary parts', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'familijna-preload-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'src'), out = path.join(dir, 'out');
  await write(source, 'page/js/app.js', 'import { b } from "/shared/b.js?v=x"; import "../../shared/translation/translation.js?v=x"; export const lazy = () => import("/shared/lazy.js?v=x"); console.log(b);');
  await write(source, 'shared/b.js', 'import { c } from "./c.js?v=x"; export const b = c;');
  await write(source, 'shared/c.js', 'export const c = 1;');
  await write(source, 'shared/lazy.js', 'export const lazy = 1;');
  await write(source, 'shared/later.js', 'import { c } from "./c.js?v=x"; export default c;');
  await write(source, 'shared/translation/translation.js', 'export const v = new URL(import.meta.url).search;');
  for (const lang of ['pl', 'en', 'uk']) for (const part of ['common', 'page']) await write(source, `shared/translation/${lang}/${part}.js`, `export default { ${part}: "${lang}" };`);
  await write(source, 'page/index.html', [
    '<!DOCTYPE html><html><head>',
    '<meta name="i18n-parts" content="page">',
    '<link rel="stylesheet" href="/page.css?v=x">',
    '<script type="module" src="/page/js/app.js?v=x"></script>',
    '<script type="module">await Promise.resolve(); import("/shared/later.js?v=x");</script>',
    '</head><body></body></html>',
  ].join('\n'));
  await write(source, 'page.css', 'body{color:red}');
  await write(source, 'plain/index.html', '<html><head><script src="/classic.js"></script></head></html>');
  await write(source, 'classic.js', 'window.x = 1;');

  await buildPublic({ source, out });
  const html = await fs.readFile(path.join(out, 'page/index.html'), 'utf8');
  const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]);
  const plain = url => url.split('?')[0];
  assert.deepEqual(preloads.map(plain).sort(), ['/shared/b.js', '/shared/c.js', '/shared/later.js', '/shared/translation/translation.js'].sort());
  assert.ok(!preloads.some(url => url.includes('lazy')), 'dynamiczny import() w module zostaje leniwy');
  assert.ok(!preloads.some(url => url.includes('/page/js/app.js')), 'wejście jest już w <script src>');
  // Ten sam URL co w imporcie (wersja z treści), inaczej moduł pobrałby się drugi raz.
  const b = await fs.readFile(path.join(out, 'shared/b.js'), 'utf8');
  const cUrl = b.match(/\.\/c\.js(\?v=h[0-9a-f]{16})/)[1];
  assert.ok(preloads.includes(`/shared/c.js${cUrl}`));
  // Preload przed pierwszym arkuszem, części słownika z wersją translation.js.
  assert.ok(html.indexOf('modulepreload') < html.indexOf('rel="stylesheet"'));
  const translationVersion = preloads.find(url => url.startsWith('/shared/translation/translation.js')).split('?')[1];
  assert.match(html, new RegExp(`new URL\\("/shared/translation/translation\\.js\\?${translationVersion}"`));
  assert.match(html, /\["common","page"\]\.forEach/);

  // Skrypt części słownika: język jak w getUiLang(), linki z wersją translation.js.
  const script = html.match(/<script data-preload>([\s\S]*?)<\/script>/)[1];
  const run = (search, stored, language) => {
    const added = [];
    const document = { head: { appendChild: el => added.push(el.href) }, createElement: () => ({}) };
    const localStorage = { getItem: () => stored };
    new Function('document', 'location', 'localStorage', 'navigator', 'URL', 'URLSearchParams', script)(
      document, { search, href: 'https://example.test/page/' + search }, localStorage, { language }, URL, URLSearchParams);
    return added;
  };
  assert.deepEqual(run('?lang=en', 'uk', 'pl-PL'), [`/shared/translation/en/common.js?${translationVersion}`, `/shared/translation/en/page.js?${translationVersion}`]);
  assert.match(run('', 'uk', 'en-US')[0], /\/uk\/common\.js/);
  assert.match(run('', null, 'en-US')[0], /\/en\/common\.js/);
  assert.match(run('', null, 'de-DE')[0], /\/pl\/common\.js/);

  assert.doesNotMatch(await fs.readFile(path.join(out, 'plain/index.html'), 'utf8'), /modulepreload|data-preload/);
});
