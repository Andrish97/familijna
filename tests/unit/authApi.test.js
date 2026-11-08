import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAuthLogin, handleAuthReset, handleAuthEmailStatus, handleAuthResendPrepare, classifyGoTrueError,
  LOGIN_MAX_PER_LOGIN, STATUS_MAX_PER_EMAIL } from '../../cloudflare/maintenance-worker/src/lib/auth/auth-api.js';
import { handleContactSubmit, SUBMIT_MAX_PER_IP, SUBMIT_MAX_GLOBAL } from '../../cloudflare/maintenance-worker/src/lib/email/contact.js';

function kv() { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; }
const env = () => ({ SUPABASE_URL: 'https://api.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc', SUPABASE_ANON_KEY: 'anon', TURNSTILE_SECRET_KEY: 'real-secret', E2E_BYPASS_SECRET: 'e2e-secret', MAINT_KV: kv() });
const req = (path, body, { ip = '1.2.3.4', origin = 'https://www.familijna.app', type = 'application/json', headers = {} } = {}) =>
  new Request('https://www.familijna.app' + path, { method: 'POST', headers: { 'Content-Type': type, 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}), ...headers }, body: JSON.stringify(body && typeof body === 'object' && !('captcha_token' in body) ? { ...body, captcha_token: 'ok-token' } : body) });
const ok = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

// Baza: alicja -> alicja@example.com; hasło "dobre". GoTrue: token / recover.
function mockBackend() {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ path: u.pathname, search: u.search, body, headers: Object.fromEntries(new Headers(init.headers)) });
    if (u.pathname === '/rest/v1/rpc/profile_login_to_email') return ok(body.p_login.toLowerCase() === 'alicja' ? 'alicja@example.com' : null);
    if (u.pathname === '/rest/v1/rpc/mail_cooldown_email_reserve') return ok([{ ok: true, next_allowed_at: '2030-01-01T00:00:00Z' }]);
    if (u.pathname === '/rest/v1/rpc/email_get_status') return ok([{ status: body.p_email === 'jest@example.com' ? 'confirmed' : 'none', intent: 'signup' }]);
    if (u.pathname === '/rest/v1/rpc/email_resend_prepare') return ok([{ ok: true, nextallowedat: '2030-01-01T00:00:00Z', status: 'pending', intent: 'signup' }]);
    if (u.pathname === '/rest/v1/rpc/save_form_message') return ok([{ ok: true, ticket_number: 'TICKET-1', message_id: null }]);
    if (u.pathname === '/rest/v1/mail_queue') return ok([]);
    if (u.pathname === '/auth/v1/token') {
      if (body.email === 'alicja@example.com' && body.password === 'dobre') {
        return ok({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, expires_at: 1, token_type: 'bearer', user: { email: 'alicja@example.com' } });
      }
      return ok({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }, 400);
    }
    if (u.hostname === 'challenges.cloudflare.com') {
      const secret = init.body.get('secret'), response = init.body.get('response');
      calls.push({ path: 'siteverify', secret, response });
      const pass = secret === '1x0000000000000000000000000000000AA' || (secret === 'real-secret' && response === 'ok-token');
      return ok({ success: pass, hostname: secret === 'real-secret' ? 'www.familijna.app' : 'example.com' });
    }
    if (u.pathname === '/auth/v1/recover') return ok({});
    throw new Error('unexpected ' + u.pathname);
  };
  return calls;
}

test('auth/login: nazwa -> sesja, bez adresu e-mail w odpowiedzi; GoTrue kluczem anon z captcha', async () => {
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    const res = await handleAuthLogin(req('/_api/auth/login', { login: 'Alicja', password: 'dobre', captcha_token: 'ok-token' }), env());
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('@'), 'odpowiedź nie zawiera e-maila');
    assert.deepEqual(JSON.parse(text).session.refresh_token, 'rt');
    const token = calls.find(c => c.path === '/auth/v1/token');
    assert.equal(token.search, '?grant_type=password');
    assert.equal(token.headers.authorization, 'Bearer anon');
    assert.deepEqual(token.body.gotrue_meta_security, { captcha_token: 'ok-token' });
  } finally { globalThis.fetch = prev; }
});

test('auth/login: nieznana nazwa i złe hasło dają identyczną odpowiedź; limit nieudanych prób', async () => {
  const prev = globalThis.fetch;
  try {
    mockBackend();
    const e = env();
    const unknown = await handleAuthLogin(req('/_api/auth/login', { login: 'nikt', password: 'x' }), e);
    const wrong = await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'złe' }), env());
    assert.equal(unknown.status, wrong.status);
    assert.deepEqual(await unknown.json(), await wrong.json());
    const e2 = env();
    const statuses = [];
    for (let i = 0; i < LOGIN_MAX_PER_LOGIN + 1; i++) statuses.push((await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'złe' }), e2)).status);
    assert.equal(statuses.at(-1), 429);
    assert.equal(statuses.filter(s => s === 400).length, LOGIN_MAX_PER_LOGIN);
    // poprawne hasło też czeka na koniec okna
    assert.equal((await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'dobre' }), e2)).status, 429);
    assert.ok([...e2.MAINT_KV.m.keys()].every(k => !k.includes('alicja') && !k.includes('1.2.3.4')), 'KV bez jawnych identyfikatorów');
  } finally { globalThis.fetch = prev; }
});

test('auth/login: tylko JSON z własnej strony', async () => {
  const prev = globalThis.fetch;
  try {
    mockBackend();
    assert.equal((await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'dobre' }, { origin: 'https://evil.example' }), env())).status, 403);
    assert.equal((await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'dobre' }, { type: 'text/plain' }), env())).status, 415);
    const get = new Request('https://www.familijna.app/_api/auth/login');
    assert.equal((await handleAuthLogin(get, env())).status, 405);
  } finally { globalThis.fetch = prev; }
});

test('classifyGoTrueError: captcha, niepotwierdzony e-mail, limit, awaria', () => {
  assert.equal(classifyGoTrueError(400, { error_code: 'captcha_failed' }), 'captcha_failed');
  assert.equal(classifyGoTrueError(400, { error_description: 'Email not confirmed' }), 'email_not_confirmed');
  assert.equal(classifyGoTrueError(429, {}), 'rate_limited');
  assert.equal(classifyGoTrueError(500, {}), 'auth_unavailable');
  assert.equal(classifyGoTrueError(400, { error: 'invalid_grant' }), 'invalid_credentials');
});

test('auth/reset: nazwa -> cooldown + /recover z adresem resetu; e-mail nie wraca do klienta', async () => {
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    const res = await handleAuthReset(req('/_api/auth/reset', { login: 'alicja', lang: 'en' }), env());
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(!text.includes('@'));
    assert.equal(JSON.parse(text).sent, true);
    const recover = calls.find(c => c.path === '/auth/v1/recover');
    assert.equal(new URLSearchParams(recover.search).get('redirect_to'), 'https://www.familijna.app/login/reset/?lang=en');
    assert.equal(recover.body.email, 'alicja@example.com');
    assert.equal(calls.find(c => c.path.endsWith('mail_cooldown_email_reserve')).body.p_action_key, 'auth:reset_password');
    assert.equal((await handleAuthReset(req('/_api/auth/reset', { login: 'nikt' }), env())).status, 404);
  } finally { globalThis.fetch = prev; }
});

test('auth/email-status i resend-prepare: limity na adres, odpowiedź bez stanu konta w resend', async () => {
  const prev = globalThis.fetch;
  try {
    mockBackend();
    const e = env();
    const first = await handleAuthEmailStatus(req('/_api/auth/email-status', { email: 'Jest@Example.com' }), e);
    assert.deepEqual(await first.json(), { ok: true, status: 'confirmed', intent: 'signup' });
    let last;
    for (let i = 1; i <= STATUS_MAX_PER_EMAIL; i++) last = await handleAuthEmailStatus(req('/_api/auth/email-status', { email: 'jest@example.com' }, { ip: '9.9.9.' + i }), e);
    assert.equal(last.status, 429);
    const resend = await (await handleAuthResendPrepare(req('/_api/auth/resend-prepare', { email: 'a@example.com', intent: 'signup' }), env())).json();
    assert.deepEqual(Object.keys(resend).sort(), ['allowed', 'next_allowed_at', 'ok']);
    assert.equal((await handleAuthEmailStatus(req('/_api/auth/email-status', { email: 'zly' }), env())).status, 400);
  } finally { globalThis.fetch = prev; }
});

test('contact: limit na IP i łączny (KV) przed zapisem zgłoszenia', async () => {
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    const e = env();
    const statuses = [];
    for (let i = 0; i <= SUBMIT_MAX_PER_IP; i++) {
      statuses.push((await handleContactSubmit(req('/_api/contact', { email: 'a@example.com', subject: 'S', message: 'Treść ' + i }), e)).status);
    }
    assert.equal(statuses.at(-1), 429);
    assert.equal(calls.filter(c => c.path.endsWith('save_form_message')).length, SUBMIT_MAX_PER_IP);
    e.MAINT_KV.m.set('contact_submit_global', String(SUBMIT_MAX_GLOBAL));
    assert.equal((await handleContactSubmit(req('/_api/contact', { email: 'b@example.com', subject: 'S', message: 'Treść' }, { ip: '5.5.5.5' }), e)).status, 429);
  } finally { globalThis.fetch = prev; }
});

test('Worker: trasy /_api/auth/* przed bramką; przy przerwie technicznej 503 bez obejścia', async () => {
  const { default: worker } = await import('../../cloudflare/maintenance-worker/src/index.js');
  const { setStateCache } = await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    setStateCache({ enabled: false, mode: 'off' });
    const ctx = { waitUntil() {} };
    const res = await worker.fetch(req('/_api/auth/login', { login: 'alicja', password: 'dobre' }), env(), ctx);
    assert.equal(res.status, 200);
    assert.ok(calls.some(c => c.path === '/auth/v1/token'));
    setStateCache({ enabled: true, mode: 'full' });
    const blocked = await worker.fetch(req('/_api/auth/email-status', { email: 'a@example.com' }), env(), ctx);
    assert.equal(blocked.status, 503);
  } finally { globalThis.fetch = prev; setStateCache({ enabled: false, mode: 'off' }); }
});

import { createHmac, randomUUID } from 'node:crypto';
const e2eToken = (secret) => { const p = Buffer.from(JSON.stringify({ iat: Date.now() - 1000, nonce: randomUUID() })).toString('base64'); return `${p}.${createHmac('sha256', secret).update(p).digest('hex')}`; };

test('Turnstile: bez tokenu / zły token = captcha_failed, bez sekretu = odmowa (fail closed), e2e = testowy klucz', async () => {
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    for (const [path, body] of [['/_api/auth/login', { login: 'alicja', password: 'dobre' }], ['/_api/auth/email-status', { email: 'a@example.com' }],
      ['/_api/auth/resend-prepare', { email: 'a@example.com' }], ['/_api/auth/reset', { login: 'alicja' }]]) {
      const handler = { '/_api/auth/login': handleAuthLogin, '/_api/auth/email-status': handleAuthEmailStatus, '/_api/auth/resend-prepare': handleAuthResendPrepare, '/_api/auth/reset': handleAuthReset }[path];
      for (const token of [undefined, 'zly-token']) {
        const res = await handler(req(path, { ...body, captcha_token: token }), env());
        assert.equal(res.status, 400, path); assert.equal((await res.json()).error, 'captcha_failed');
      }
      const noSecret = { ...env(), TURNSTILE_SECRET_KEY: '' };
      const closed = await handler(req(path, body), noSecret);
      assert.equal(closed.status, 503, path); assert.equal((await closed.json()).error, 'captcha_unavailable');
    }
    assert.ok(!calls.some(c => c.path === '/auth/v1/token'), 'bez captchy nie ma logowania');
    // Testy e2e: podpisany nagłówek -> oficjalny testowy klucz (token testowy przechodzi), bez sekretu produkcyjnego też.
    const e = { ...env(), TURNSTILE_SECRET_KEY: '' };
    const res = await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'dobre', captcha_token: 'XXXX.DUMMY.TOKEN.XXXX' }, { headers: { 'X-E2E-Token': e2eToken('e2e-secret') } }), e);
    assert.equal(res.status, 200);
    assert.equal(calls.filter(c => c.path === 'siteverify').at(-1).secret, '1x0000000000000000000000000000000AA');
    // Fałszywy nagłówek e2e nie daje testowego klucza.
    const forged = await handleAuthLogin(req('/_api/auth/login', { login: 'alicja', password: 'dobre', captcha_token: 'XXXX.DUMMY.TOKEN.XXXX' }, { headers: { 'X-E2E-Token': e2eToken('inny') } }), env());
    assert.equal(forged.status, 400);
  } finally { globalThis.fetch = prev; }
});

test('Turnstile: formularz kontaktu i dopisanie do zgłoszenia wymagają tokenu', async () => {
  const prev = globalThis.fetch;
  try {
    const calls = mockBackend();
    const res = await handleContactSubmit(req('/_api/contact', { email: 'a@example.com', subject: 'S', message: 'Treść', captcha_token: '' }), env());
    assert.equal(res.status, 400);
    assert.ok(!calls.some(c => c.path.endsWith('save_form_message')));
    const { handleContactAppend } = await import('../../cloudflare/maintenance-worker/src/lib/email/contact.js');
    const app = await handleContactAppend(req('/_api/contact/append', { email: 'a@example.com', ticket: 'TICKET-1', message: 'Treść', captcha_token: 'zly' }), env());
    assert.equal(app.status, 400);
  } finally { globalThis.fetch = prev; }
});

test('auth/reset: limit KV na login i IP; podpisany przebieg e2e go nie zużywa', async () => {
  const prev = globalThis.fetch;
  try {
    mockBackend();
    const e = env();
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await handleAuthReset(req('/_api/auth/reset', { login: 'alicja' }), e)).status);
    assert.deepEqual(statuses.slice(0, 5), [200, 200, 200, 200, 200]);
    assert.equal(statuses[5], 429, 'szósty reset w godzinie odrzucony');
    for (let i = 0; i < 3; i++) {
      const res = await handleAuthReset(req('/_api/auth/reset', { login: 'alicja' }, { headers: { 'X-E2E-Token': e2eToken('e2e-secret') } }), e);
      assert.equal(res.status, 200, 'e2e bez limitu');
    }
  } finally { globalThis.fetch = prev; }
});
