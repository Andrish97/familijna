import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { homeSeo, homeSchemas, schemaJson } from '../../web/shared/js/core/home-seo.js';
import { homeDictionary, homeText, localizeHome } from '../../cloudflare/maintenance-worker/src/lib/ssr/home.js';
import { httpsRedirect, withSecurityHeaders } from '../../cloudflare/maintenance-worker/src/lib/core/security-headers.js';
import { buildDynamicSitemap } from '../../cloudflare/maintenance-worker/src/lib/ssr/ssr.js';

test('homepage locales have their own canonical, translated metadata and matching structured content', () => {
  const descriptions = new Set();
  for (const lang of ['pl', 'en', 'uk']) {
    const dict = homeDictionary(lang);
    const t = key => homeText(dict, key);
    const seo = homeSeo(lang, t);
    assert.equal(seo.url, 'https://www.familijna.app/' + (lang === 'pl' ? '' : `?lang=${lang}`));
    assert.ok(seo.title && !seo.title.startsWith('home.'));
    descriptions.add(seo.description);
    const questions = Object.values(dict.home.faq).filter(v => v?.q && v?.a);
    const schemas = homeSchemas(seo, t, questions);
    assert.ok(questions.length > 20);
    for (const schema of Object.values(schemas)) {
      assert.equal(schema.url, seo.url);
      assert.equal(schema.inLanguage, lang);
    }
    assert.deepEqual(schemas.faq.mainEntity.map(v => v.name), questions.map(v => v.q));
    assert.ok(schemas.application.featureList.every(v => typeof v === 'string'));
  }
  assert.equal(descriptions.size, 3);
});

test('JSON-LD cannot escape its script element, and the static Polish schema matches its metadata', () => {
  const malicious = { text: '</script><script>alert(1)</script>' };
  const encoded = schemaJson(malicious);
  assert.ok(!encoded.includes('<'));
  assert.deepEqual(JSON.parse(encoded), malicious);
  const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
  const dict = homeDictionary('pl');
  const seo = homeSeo('pl', key => homeText(dict, key));
  assert.ok(html.includes(`>${seo.title}</title>`));
  assert.ok(html.includes(`content="${seo.description}"`));
  for (const match of html.matchAll(/data-home-schema="(\w+)">([\s\S]*?)<\/script>/g)) {
    const schema = JSON.parse(match[2]);
    assert.equal(schema.url, seo.url);
    assert.equal(schema.inLanguage, 'pl');
  }
});

test('home localization leaves maintenance, errors, APIs and other hosts alone', () => {
  for (const [url, status, type, method] of [
    ['https://www.familijna.app/', 503, 'text/html', 'GET'],
    ['https://www.familijna.app/', 404, 'text/html', 'GET'],
    ['https://www.familijna.app/', 200, 'application/json', 'GET'],
    ['https://www.familijna.app/', 200, 'text/html', 'POST'],
    ['https://admin.familijna.app/', 200, 'text/html', 'GET'],
    ['https://www.familijna.app/login/', 200, 'text/html', 'GET'],
  ]) {
    const response = new Response('original', { status, headers: { 'Content-Type': type } });
    assert.equal(localizeHome(new Request(url, { method }), response), response);
  }
});

test('HTTP is upgraded before handling sessions, including POST and apex without losing query parameters', async () => {
  const { default: worker } = await import('../../cloudflare/maintenance-worker/src/index.js');
  for (const [host, target] of [['www', 'www'], ['', 'www'], ['admin', 'admin']]) {
    const name = host ? `${host}.familijna.app` : 'familijna.app';
    for (const method of ['GET', 'HEAD', 'POST']) {
      const request = new Request(`http://${name}/_api/auth/login?lang=en`, { method });
      const response = await worker.fetch(request, {}, {});
      assert.equal(response.status, 308);
      assert.equal(response.headers.get('Location'), `https://${target}.familijna.app/_api/auth/login?lang=en`);
      assert.equal(response.headers.get('Strict-Transport-Security'), null);
    }
  }
  assert.equal(httpsRedirect(new Request('https://www.familijna.app/')), null);
  assert.equal(httpsRedirect(new Request('http://api.familijna.app/')), null);
  assert.equal(httpsRedirect(new Request('http://evilfamilijna.app/')), null);
});

test('HSTS protects all HTTPS application responses, preserves a stronger policy, and excludes service and unrelated hosts', () => {
  for (const host of ['familijna.app', 'www.familijna.app', 'admin.familijna.app']) {
    for (const status of [200, 301, 404, 503]) {
      const res = withSecurityHeaders(new Request(`https://${host}/`), new Response('body', { status }));
      assert.equal(res.headers.get('Strict-Transport-Security'), 'max-age=604800');
      assert.equal(res.status, status);
    }
  }
  const stronger = 'max-age=31536000';
  const res = withSecurityHeaders(new Request('https://www.familijna.app/'), new Response('', { headers: { 'Strict-Transport-Security': stronger } }));
  assert.equal(res.headers.get('Strict-Transport-Security'), stronger);
  for (const host of ['api.familijna.app', 'docker.familijna.app', 'evilfamilijna.app', 'familijna.app.example']) {
    const res = withSecurityHeaders(new Request(`https://${host}/`), new Response('', { headers: { 'Content-Type': 'text/html' } }));
    assert.equal(res.headers.get('Strict-Transport-Security'), null);
    assert.equal(res.headers.get('Content-Security-Policy'), null);
  }
});

test('baseline CSP preserves stricter origin directives', () => {
  const csp = "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'";
  const response = withSecurityHeaders(new Request('https://www.familijna.app/'), new Response('body', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': csp } }));
  assert.ok(response.headers.get('Content-Security-Policy').startsWith(csp));
  assert.ok(!response.headers.get('Content-Security-Policy').includes('unsafe-eval'));
  const strict = withSecurityHeaders(new Request('https://www.familijna.app/'), new Response('body', { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" } }));
  assert.ok(!strict.headers.get('Content-Security-Policy').includes('script-src'));
  assert.ok(!strict.headers.get('Content-Security-Policy').includes('connect-src'));
  assert.ok(!strict.headers.get('Content-Security-Policy').includes('frame-src'));
  const baseline = withSecurityHeaders(new Request('https://www.familijna.app/'), new Response('body', { headers: { 'Content-Type': 'text/html' } }));
  for (const directive of ['script-src', 'connect-src', 'frame-src']) assert.ok(baseline.headers.get('Content-Security-Policy').includes(directive));
  // Własne dźwięki gry wczytuje fetch() adresu blob: (shared/js/core/sfx.js).
  assert.match(baseline.headers.get('Content-Security-Policy'), /connect-src [^;]*\bblob:/);
});

test('sitemap includes each localized homepage and retains published game URLs', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify([{ slug: 'dzieci-i-rodzice', created_at: '2026-05-25' }]), { headers: { 'Content-Type': 'application/json' } });
  try {
    // Katalog idzie kluczem publicznym (806ca4edd: bez klucza administracyjnego).
    const response = await buildDynamicSitemap({ SUPABASE_URL: 'https://api.example.invalid', SUPABASE_ANON_KEY: 'unit' });
    const xml = await response.text();
    for (const suffix of ['', '?lang=en', '?lang=uk', 'marketplace/game/dzieci-i-rodzice']) assert.ok(xml.includes(`<loc>https://www.familijna.app/${suffix}</loc>`));
    // Gry bez lastmod: updated_at zmienia też liczba kopii (familijna-server/docs/seo-katalog-statyczny-plan.md).
    assert.ok(!xml.includes('<lastmod>2026-05-25</lastmod>'));
  } finally { globalThis.fetch = original; }
});
