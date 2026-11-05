import test from 'node:test';
import assert from 'node:assert/strict';

const WORKER = 'cloudflare/maintenance-worker/src';

test('public catalog is fetched once per TTL, shared by parallel requests, errors are not kept', async t => {
  const { cachedPublicCatalog: publicCatalog, resetCatalogCache, CATALOG_TTL_MS } = await import(`../../${WORKER}/lib/ssr/marketplace.js`);
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; resetCatalogCache(); });
  resetCatalogCache();
  let calls = 0, fail = false;
  globalThis.fetch = async (url) => {
    calls++;
    assert.match(String(url), /\/rest\/v1\/rpc\/market_public_catalog$/);
    if (fail) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify([{ id: 'a', slug: 'gra-a', title: 'A', lang: 'pl' }]), { status: 200 });
  };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' };
  const [one, two] = await Promise.all([publicCatalog(env, 1000), publicCatalog(env, 1000)]);
  assert.equal(calls, 1);
  assert.equal(one, two);
  assert.equal(one[0].slug, 'gra-a');
  await publicCatalog(env, 1000 + CATALOG_TTL_MS - 1);
  assert.equal(calls, 1);
  fail = true;
  await assert.rejects(publicCatalog(env, 1000 + CATALOG_TTL_MS), /public_market_500/);
  assert.equal(calls, 2);
  fail = false;
  const again = await publicCatalog(env, 1000 + CATALOG_TTL_MS + 1);
  assert.equal(calls, 3, 'błąd nie zostaje w pamięci');
  assert.equal(again[0].slug, 'gra-a');
});

test('stale catalogue is served at once and refreshed in the background (Cache API)', async t => {
  const mod = await import(`../../${WORKER}/lib/ssr/marketplace.js`);
  const { cachedPublicCatalog, resetCatalogCache, CATALOG_TTL_MS } = mod;
  const realFetch = globalThis.fetch, realCaches = globalThis.caches, realNow = Date.now;
  t.after(() => { globalThis.fetch = realFetch; globalThis.caches = realCaches; Date.now = realNow; resetCatalogCache(); });
  const store = new Map();
  globalThis.caches = { default: {
    match: async (key) => store.get(key)?.clone() || null,
    put: async (key, res) => { store.set(key, res); },
  } };
  let clock = 1_000_000, calls = 0, slug = 'stara';
  Date.now = () => clock;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify([{ id: 'a', slug, title: 'A', lang: 'pl' }]), { status: 200 }); };
  const env = { SUPABASE_URL: 'https://db.example', SUPABASE_ANON_KEY: 'anon' };
  resetCatalogCache();
  assert.equal((await cachedPublicCatalog(env, clock))[0].slug, 'stara');
  assert.equal(calls, 1);
  // Inny izolat (pusta pamięć), wpis w Cache API przeterminowany: od razu stary katalog, odświeżenie w tle.
  resetCatalogCache(); clock += CATALOG_TTL_MS + 1; slug = 'nowa';
  const waits = [];
  const rows = await cachedPublicCatalog(env, clock, { waitUntil: (p) => waits.push(p) });
  assert.equal(rows[0].slug, 'stara');
  assert.equal(waits.length, 1);
  await Promise.all(waits);
  assert.equal(calls, 2);
  resetCatalogCache();
  assert.equal((await cachedPublicCatalog(env, clock))[0].slug, 'nowa', 'odświeżony wpis w Cache API');
  assert.equal(calls, 2);
});
