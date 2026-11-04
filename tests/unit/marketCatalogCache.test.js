import test from 'node:test';
import assert from 'node:assert/strict';

const WORKER = 'cloudflare/maintenance-worker/src';

test('public catalog is fetched once per TTL, shared by parallel requests, errors are not kept', async t => {
  const { publicCatalog, resetCatalogCache, CATALOG_TTL_MS } = await import(`../../${WORKER}/lib/ssr/marketplace.js`);
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
