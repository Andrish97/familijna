// Kod urządzenia przez Worker (/_api/device/resolve): limit nieudanych prób
// na IP i łącznie, poprawny kod nie zużywa limitu, obca domena odrzucona
// (decyzja użytkownika 2026-10-29, migracja 514).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleDeviceCodeResolve, CODE_FAIL_MAX_PER_IP, CODE_FAIL_MAX_ALL } from '../../cloudflare/maintenance-worker/src/lib/device/connect-code.js';

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }
const env = () => ({ SUPABASE_URL: 'https://api.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc', MAINT_KV: kv() });
const req = (body, { ip = '1.2.3.4', origin = 'https://www.familijna.app', method = 'POST' } = {}) =>
  new Request('https://www.familijna.app/_api/device/resolve', { method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });

// Baza: jedyny działający kod 123456.
function mockDb() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = JSON.parse(init.body);
    calls.push({ path: new URL(url).pathname, body, auth: new Headers(init.headers).get('Authorization') });
    return ok(body.p_code === '123456'
      ? { ok: true, code: '123456', device_type: 'display', game_id: 'g1', share_key: 'k1', owner_username: 'ala' }
      : { ok: false, err: 'not_found' });
  };
  return calls;
}

test('poprawny kod: klucz z bazy kluczem serwisowym, bez zużycia limitu', async () => {
  const calls = mockDb(); const e = env();
  for (let i = 0; i < CODE_FAIL_MAX_PER_IP + 5; i++) {
    const res = await handleDeviceCodeResolve(req({ code: '123 456' }), e);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).share_key, 'k1');
  }
  assert.equal(calls[0].path, '/rest/v1/rpc/resolve_device_connect_code');
  assert.deepEqual(calls[0].body, { p_code: '123456' });
  assert.equal(e.MAINT_KV.m.size, 0, 'udane próby nie są liczone');
});

test('nieudane próby: limit na IP, potem 429 także dla poprawnego kodu; inne IP dalej działa', async () => {
  mockDb(); const e = env();
  for (let i = 0; i < CODE_FAIL_MAX_PER_IP; i++) {
    const res = await handleDeviceCodeResolve(req({ code: String(100000 + i) }), e);
    assert.deepEqual(await res.json(), { ok: false, err: 'not_found' });
  }
  const blocked = await handleDeviceCodeResolve(req({ code: '123456' }), e);
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { ok: false, err: 'rate_limited' });
  const other = await handleDeviceCodeResolve(req({ code: '123456' }, { ip: '5.6.7.8' }), e);
  assert.equal((await other.json()).ok, true);
  // w KV tylko skróty adresów
  assert.ok([...e.MAINT_KV.m.keys()].every((k) => !k.includes('1.2.3.4')));
});

test('łączny limit nieudanych prób z wielu adresów', async () => {
  mockDb(); const e = env();
  for (let i = 0; i < CODE_FAIL_MAX_ALL; i++) await handleDeviceCodeResolve(req({ code: '999999' }, { ip: `10.0.${i >> 8}.${i & 255}` }), e);
  const res = await handleDeviceCodeResolve(req({ code: '123456' }, { ip: '9.9.9.9' }), e);
  assert.equal(res.status, 429);
  // E24 R14: łączny limit nie blokuje wszystkich — z ważnym Turnstile kod przechodzi.
  assert.deepEqual(await res.json(), { ok: false, err: 'captcha_required' });
  const db = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url).includes('siteverify') ? ok({ success: true, hostname: 'www.familijna.app' }) : db(url, init);
  const withCaptcha = await handleDeviceCodeResolve(req({ code: '123456', captcha_token: 't' }, { ip: '9.9.9.9' }), { ...e, TURNSTILE_SECRET_KEY: 'ts' });
  assert.equal((await withCaptcha.json()).ok, true);
});

test('IPv6: limit na IP liczony po prefiksie /64', async () => {
  const { clientIp } = await import('../../cloudflare/maintenance-worker/src/lib/core/rate-limit.js');
  const ip = (v) => clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': v } }));
  assert.equal(ip('2001:db8:1:2:aaaa::1'), ip('2001:db8:1:2:ffff:1:2:3'));
  assert.equal(ip('2001:db8::1'), '2001:db8:0:0::/64');
  assert.notEqual(ip('2001:db8:1:2::1'), ip('2001:db8:1:3::1'));
  assert.equal(ip('203.0.113.7'), '203.0.113.7');
});

test('zły format nie pyta bazy ani nie zużywa limitu; obca domena i GET odrzucone', async () => {
  const calls = mockDb(); const e = env();
  for (const code of ['', '12345', '1234567', 'abcdef', null, { x: 1 }]) {
    assert.deepEqual(await (await handleDeviceCodeResolve(req({ code }), e)).json(), { ok: false, err: 'not_found' });
  }
  assert.equal(calls.length, 0);
  assert.equal((await handleDeviceCodeResolve(req({ code: '123456' }, { origin: 'https://evil.example' }), e)).status, 403);
  assert.equal((await handleDeviceCodeResolve(req(null, { method: 'GET' }), e)).status, 405);
});

test('przeglądarka nie woła już RPC kodu wprost (TV, Podłącz urządzenie)', async () => {
  for (const f of ['web/connect/tv/js/tv.js', 'web/connect/js/connect-device.js']) {
    const src = await readFile(new URL(`../../${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /resolve_device_connect_code/, f);
    assert.match(src, /resolveDeviceCode\(/, f);
  }
  const worker = await readFile(new URL('../../cloudflare/maintenance-worker/src/index.js', import.meta.url), 'utf8');
  assert.match(worker, /DEVICE_ROUTES/);
});
