import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
// Pliki strony przychodzą z bindingu ASSETS (Workers Static Assets), pozostałe
// żądania (Supabase) przez fetch — ten sam podstawiony serwer obsługuje oba.
const assetsOrigin = (handler) => ({ outboundService: handler, serviceBindings: { ASSETS: handler } });

const source = readFileSync(new URL('../../../web/index.html', import.meta.url), 'utf8');
let mf;
let originRequests = 0;
let originHtml = source;

before(async () => {
  const bundle = await build({
    entryPoints: [new URL('../src/index.js', import.meta.url).pathname],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  mf = new Miniflare({
    modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2024-01-01',
    kvNamespaces: ['MAINT_KV'],
    ...assetsOrigin(async () => {
      originRequests++;
      return new Response(originHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: 'origin-template' } });
    }),
  });
});

after(async () => { await mf?.dispose(); });

test('real HTMLRewriter renders localized content, metadata and schemas for visitors and Googlebot', async () => {
  for (const [lang, heading] of [
    ['pl', 'Familijna — przygotuj pytania i poprowadź grę'],
    ['en', 'Familijna — prepare questions and run the game'],
    ['uk', 'Familijna — підготуй питання та проведи гру'],
  ]) {
    const url = `https://www.familijna.app/${lang === 'pl' ? '' : `?lang=${lang}`}`;
    const browser = await mf.dispatchFetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    assert.equal(browser.status, 200);
    assert.equal(browser.headers.get('Content-Language'), lang);
    assert.equal(browser.headers.get('ETag'), null);
    assert.equal(browser.headers.get('Strict-Transport-Security'), 'max-age=604800');
    const html = await browser.text();
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(heading));
    assert.ok(html.includes(`rel="canonical" href="${url}"`));
    const title = html.match(/<title[^>]*>(.*?)<\/title>/s)?.[1];
    assert.ok(title && !title.includes('home.'));
    let count = 0;
    for (const match of html.matchAll(/data-home-schema="(\w+)">([\s\S]*?)<\/script>/g)) {
      count++;
      const schema = JSON.parse(match[2]);
      assert.equal(schema.inLanguage, lang);
      assert.equal(schema.url, url);
      if (match[1] === 'faq') {
        assert.ok(schema.mainEntity.length > 20);
        assert.ok(html.includes(schema.mainEntity[0].name));
      }
    }
    assert.equal(count, 3);
    const bot = await mf.dispatchFetch(url, { headers: { 'User-Agent': 'Googlebot' } });
    assert.equal(await bot.text(), html);
  }
});

test('HEAD returns localized headers with no body; unsupported languages use Polish', async () => {
  const head = await mf.dispatchFetch('https://www.familijna.app/?lang=en', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Language'), 'en');
  assert.equal(await head.text(), '');
  const response = await mf.dispatchFetch('https://www.familijna.app/?lang=invalid');
  assert.equal(response.headers.get('Content-Language'), 'pl');
  assert.ok((await response.text()).includes('rel="canonical" href="https://www.familijna.app/"'));
});

test('HTTP POST is redirected without invoking the origin or authentication', async () => {
  const before = originRequests;
  const response = await mf.dispatchFetch('http://www.familijna.app/_api/auth/login?lang=en', { method: 'POST', body: '{}', redirect: 'manual' });
  assert.equal(response.status, 308);
  assert.equal(response.headers.get('Location'), 'https://www.familijna.app/_api/auth/login?lang=en');
  assert.equal(originRequests, before);
});

test('new Worker also localizes the previous Pages template during independent deployments', async () => {
  originHtml = source.replace(/ data-home-schema="\w+"/g, '').replace(/ data-i18n-content="[^"]+"/g, '');
  try {
    const response = await mf.dispatchFetch('https://www.familijna.app/?lang=en');
    const html = await response.text();
    assert.equal((html.match(/type="application\/ld\+json"/g) || []).length, 3);
    assert.ok(html.includes('property="og:title" content="Familijna — free team game with survey questions"'));
    for (const match of html.matchAll(/data-home-schema="\w+">([\s\S]*?)<\/script>/g)) assert.equal(JSON.parse(match[1]).inLanguage, 'en');
  } finally { originHtml = source; }
});
