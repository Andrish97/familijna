import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { Miniflare, Response } from 'miniflare';
import { PUBLIC_LANGS, publicUrl } from '../../../web/shared/js/core/public-seo.js';
import manual from '../../../web/manual/content/pl.js';

let mf;
let bundle;
let failOrigin = false;
let legacyManual = false;
const requests = [];
const sources = Object.fromEntries(['manual/index.html', 'privacy/index.html', '404.html', 'maintenance/index.html']
  .map((path) => [path, readFileSync(new URL(`../../../web/${path}`, import.meta.url), 'utf8')]));
const outboundService = async (request) => {
  const url = new URL(request.url);
  requests.push(url.pathname);
  if (url.pathname === '/rest/v1/rpc/market_public_catalog') return new Response('[]', {headers:{'Content-Type':'application/json'}});
  if (url.pathname.includes('/rest/')) throw new Error('guide reading must not use the database');
  if (failOrigin) return new Response('origin unavailable', { status: 503 });
  // Wersje zrzutów Wskazówek z bieżącego wydania (scripts/content-hash-assets.cjs).
  if (url.pathname === '/asset-hashes.json') return new Response(JSON.stringify({
    'manual/img/pl/play-display-play-desktop.webp': '0123456789abcdef' + 'f'.repeat(48),
    'manual/index.html': 'a'.repeat(64),
  }), { headers: { 'Content-Type': 'application/json' } });
  let source = sources[url.pathname.slice(1)];
  if (legacyManual && url.pathname === '/manual/index.html') source = source
    .replace('content="index, follow"', 'content="noindex, nofollow"')
    .replace('<body class="manual-body">', '<body class="manual-body skel-body">')
    .replace('</head>', "<script>document.documentElement.classList.add('page-loading')</script></head>");
  return new Response(source || 'not found', { status: source ? 200 : 404, headers: { 'Content-Type': 'text/html' } });
};
before(async () => {
  bundle = (await build({ entryPoints: [new URL('../src/index.js', import.meta.url).pathname], bundle: true,
    write: false, format: 'esm', platform: 'browser', target: 'es2022' })).outputFiles[0].text;
  mf = new Miniflare({ modules: true, script: bundle, compatibilityDate: '2024-01-01', kvNamespaces: ['MAINT_KV'], bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'}, outboundService });
});
after(async () => mf?.dispose());

test('every guide chapter and index has full localized HTML, canonical, reciprocal hreflang and crawlable links, equal for both UAs', async () => {
  for (const lang of PUBLIC_LANGS) for (const id of [null, ...manual.chapters.map((ch) => ch.id)]) {
    const canonical = publicUrl('manual', lang, id);
    const response = await mf.dispatchFetch(canonical + (canonical.includes('?') ? '&' : '?') + 'from=6.4&ret=%2Fgames%2F&q=test');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Language'), lang);
    assert.equal(response.headers.get('X-Robots-Tag'), 'index, follow');
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.ok(html.includes(`rel="canonical" href="${canonical.replaceAll('&', '&amp;')}"`));
    assert.equal((html.match(/rel="alternate" hreflang=/g) || []).length, 4);
    assert.doesNotMatch(html, /page-loading|noindex/);
    assert.match(html, /<h1 class="m-title">[^<]+<\/h1>/);
    assert.match(html, /class="m-side-item/);
    assert.match(html, new RegExp(`data-manual-lang="${lang}" data-manual-chapter="${id || ''}"`));
    assert.match(html, /<meta name="description" content="[^"]{15}/);
    assert.ok(html.match(/id="btnLegal"[^>]*>/)?.[0].includes(publicUrl('privacy', lang)));
    if (id) {
      assert.match(html, /<div class="m-doc">\s*</);
      assert.match(html, /class="m-pager/);
      const title = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1];
      const heading = html.match(/<h1 class="m-title">([^<]*)<\/h1>/)?.[1];
      assert.ok(title.includes(heading));
    } else assert.match(html, /class="m-part-chapters/);
    if (lang === 'pl' && id === '17') {
      assert.ok(html.includes('src="/manual/img/pl/play-display-play-desktop.webp?v=h0123456789abcdef"'));
      // Obraz spoza mapy wydania -- bez wersji (krótka pamięć jak dotąd).
      assert.ok(html.includes('src="/manual/img/pl/light/play-display-play-desktop.webp"'));
    }
    const bot = await mf.dispatchFetch(canonical, { headers: { 'User-Agent': 'Googlebot' } });
    assert.equal(await bot.text(), html);
  }
  assert.ok(requests.every((path) => path === '/manual/index.html' || path === '/asset-hashes.json'));
  // Mapa wersji pamiętana (1 min), nie pobierana przy każdej stronie.
  assert.equal(requests.filter((path) => path === '/asset-hashes.json').length, 1);
});

test('sitemap lists public localized documents using exactly their canonical URLs; HEAD agrees', async () => {
  // Cache API przeżywa wdrożenie: poprzedni Worker mógł zostawić mapę bez Wskazówek.
  const cache = (await mf.getCaches()).default;
  await cache.put('https://www.familijna.app/sitemap.xml', new Response('<urlset>old-sitemap</urlset>', {
    headers: { 'Content-Type': 'application/xml', 'Cache-Control': 'public, max-age=3600' },
  }));
  const response = await mf.dispatchFetch('https://www.familijna.app/sitemap.xml');
  assert.equal(response.status, 200);
  const xml = await response.text();
  for (const lang of PUBLIC_LANGS) {
    for (const chapter of [null, ...manual.chapters.map((c) => c.id)]) {
      assert.ok(xml.includes(`<loc>${publicUrl('manual', lang, chapter).replaceAll('&', '&amp;')}</loc>`));
    }
    assert.ok(xml.includes(`<loc>${publicUrl('privacy', lang)}</loc>`));
  }
  assert.doesNotMatch(xml, /maintenance|404\.html|from=|ret=/);
  const head = await mf.dispatchFetch('https://www.familijna.app/sitemap.xml', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('Content-Type'), response.headers.get('Content-Type'));
  assert.equal(await head.text(), '');
});

test('privacy delivers the whole translated policy and metadata without JS or auth', async () => {
  for (const [lang, heading] of [['pl', 'Polityka Prywatności'], ['en', 'Privacy Policy'], ['uk', 'Політика конфіденційності']]) {
    const response = await mf.dispatchFetch(publicUrl('privacy', lang));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Language'), lang);
    assert.ok(html.includes(heading));
    assert.equal((html.match(/<h2 /g) || []).length, 9);
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.doesNotMatch(html, /page-loading|noindex/);
    const bot = await mf.dispatchFetch(publicUrl('privacy', lang), { headers: { 'User-Agent': 'Googlebot' } });
    assert.equal(await bot.text(), html);
  }
});

test('HEAD, aliases and invalid chapters preserve status and language; errors are never rewritten as public content', async () => {
  for (const path of ['/manual', '/manual/', '/manual/index.html', '/privacy', '/privacy/', '/privacy/index.html']) {
    const response = await mf.dispatchFetch(`https://www.familijna.app${path}?lang=uk`, { method: 'HEAD' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Language'), 'uk');
    assert.equal(await response.text(), '');
  }
  for (const ch of ['999', '0', '', '../1', '01']) {
    const response = await mf.dispatchFetch(`https://www.familijna.app/manual/?ch=${encodeURIComponent(ch)}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
    await response.text();
  }
  failOrigin = true;
  try {
    const response = await mf.dispatchFetch('https://www.familijna.app/manual/?ch=6');
    assert.equal(response.status, 503);
    assert.equal(await response.text(), 'origin unavailable');
    assert.equal(response.headers.get('X-Robots-Tag'), null);
  } finally { failOrigin = false; }
});

test('technical document is noindex; actual maintenance remains 503 with Retry-After', async () => {
  for (const method of ['GET', 'HEAD']) {
    const response = await mf.dispatchFetch('https://www.familijna.app/404.html', { method });
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
    await response.text();
  }
  for (const path of ['/maintenance', '/maintenance/', '/maintenance/index.html']) {
    const response = await mf.dispatchFetch(`https://www.familijna.app${path}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, follow');
    await response.text();
  }
  const maintenance = new Miniflare({ modules: true, script: bundle, compatibilityDate: '2024-01-01', kvNamespaces: ['MAINT_KV'], bindings:{SUPABASE_URL:'https://api.test',SUPABASE_ANON_KEY:'anon-only'}, outboundService });
  try {
    await (await maintenance.getKVNamespace('MAINT_KV')).put('state', JSON.stringify({ enabled: true, mode: 'message' }));
    const response = await maintenance.dispatchFetch('https://www.familijna.app/manual/?ch=6');
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('Retry-After'), '300');
    assert.equal(response.headers.get('X-Robots-Tag'), null);
    await response.text();
  } finally { await maintenance.dispose(); }
});

test('independent deployment also opens indexing and removes content hiding in the previous Pages template', async () => {
  legacyManual = true;
  try {
    const response = await mf.dispatchFetch('https://www.familijna.app/manual/?ch=6&lang=en');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.doesNotMatch(html, /page-loading|skel-body|noindex/);
    assert.match(html, /<div class="m-doc">/);
    assert.match(html, /name="robots" content="index, follow"/);
  } finally { legacyManual = false; }
});
