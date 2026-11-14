import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const { contentHashAssets } = createRequire(import.meta.url)('../../scripts/content-hash-assets.cjs');

test('wersje zależą od treści importu, a niezależne zasoby zachowują URL', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-hash-'));
  const write = (name, data) => fs.writeFileSync(path.join(root, name), data);
  const read = name => fs.readFileSync(path.join(root, name), 'utf8');
  try {
    write('index.html', '<script type="module" src="./a.js?v=vOLD"></script><img src="/image.png?v=vOLD">');
    write('a.js', 'import "./b.js?v=vOLD";');
    write('b.js', 'export const answer = 1;');
    write('image.png', Buffer.from([1, 2, 3]));
    write('sw.js', '// Version: vOLD\nself.skipWaiting();\n');
    contentHashAssets(root);
    const first = read('index.html');
    const firstManifest = JSON.parse(read('asset-hashes.json'));
    const firstSw = read('sw.js');
    contentHashAssets(root);
    assert.equal(read('index.html'), first);
    assert.deepEqual(JSON.parse(read('asset-hashes.json')), firstManifest);
    assert.equal(read('sw.js'), firstSw);

    write('image.png', Buffer.from([1, 2, 4]));
    contentHashAssets(root);
    const imageChanged = read('index.html');
    assert.equal(imageChanged.match(/a\.js\?v=h[0-9a-f]+/)[0], first.match(/a\.js\?v=h[0-9a-f]+/)[0]);
    assert.notEqual(imageChanged.match(/image\.png\?v=h[0-9a-f]+/)[0], first.match(/image\.png\?v=h[0-9a-f]+/)[0]);

    write('b.js', 'export const answer = 2;');
    contentHashAssets(root);
    assert.notEqual(read('index.html').match(/a\.js\?v=h[0-9a-f]+/)[0], first.match(/a\.js\?v=h[0-9a-f]+/)[0]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zmiana części słownika zmienia wersję translation.js (części dziedziczą jego ?v=)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-hash-i18n-'));
  const file = (name) => path.join(root, name);
  const write = (name, data) => { fs.mkdirSync(path.dirname(file(name)), { recursive: true }); fs.writeFileSync(file(name), data); };
  const version = () => fs.readFileSync(file('index.html'), 'utf8').match(/translation\.js\?v=(h[0-9a-f]+)/)[1];
  try {
    write('index.html', '<script type="module" src="/shared/translation/translation.js?v=vOLD"></script>');
    write('shared/translation/translation.js', 'const v = new URL(import.meta.url).search;');
    write('shared/translation/pl/control.js', 'export default { control: { a: "A" } };');
    contentHashAssets(root);
    const first = version();
    write('shared/translation/pl/control.js', 'export default { control: { a: "A", b: "B" } };');
    contentHashAssets(root);
    assert.notEqual(version(), first);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zrzuty Wskazówek dostają wersję z treści obrazu (rozdział i lista rozdziałów za nim)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-hash-manual-'));
  const file = (name) => path.join(root, name);
  const write = (name, data) => { fs.mkdirSync(path.dirname(file(name)), { recursive: true }); fs.writeFileSync(file(name), data); };
  const read = (name) => fs.readFileSync(file(name), 'utf8');
  const v = (text, name) => text.match(new RegExp(`${name}\\?v=(h[0-9a-f]+)`))[1];
  try {
    write('manual/content/chapter-loaders.js', 'export default { pl: { "1": () => import("./chapters/pl/1.js?v=vOLD") } };');
    write('manual/content/chapters/pl/1.js', 'export default "<img src=\\"/manual/img/pl/a-desktop.webp\\"><img src=\\"/manual/img/pl/light/b-desktop.webp\\">";');
    write('manual/img/pl/a-desktop.webp', Buffer.from([1]));
    write('manual/img/pl/light/b-desktop.webp', Buffer.from([2]));
    contentHashAssets(root);
    const first = { a: v(read('manual/content/chapters/pl/1.js'), 'a-desktop.webp'), b: v(read('manual/content/chapters/pl/1.js'), 'b-desktop.webp'), ch: v(read('manual/content/chapter-loaders.js'), '1.js') };
    contentHashAssets(root);
    assert.equal(v(read('manual/content/chapters/pl/1.js'), 'a-desktop.webp'), first.a);
    write('manual/img/pl/a-desktop.webp', Buffer.from([3]));
    contentHashAssets(root);
    const ch = read('manual/content/chapters/pl/1.js');
    assert.notEqual(v(ch, 'a-desktop.webp'), first.a);
    assert.equal(v(ch, 'b-desktop.webp'), first.b);
    assert.notEqual(v(read('manual/content/chapter-loaders.js'), '1.js'), first.ch);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
