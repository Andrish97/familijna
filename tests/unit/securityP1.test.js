// Audyt E24: publiczny podpis obejścia przerwy, nagłówki bezpieczeństwa,
// ochrona dopinania poczty i sekret storage-cleanup. Testy API panelu są
// w prywatnym repo familijna-server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import {
  createAdminBypassToken, verifyAdminBypassToken, hasAdminBypass, ADMIN_BYPASS_TTL_SECONDS,
} from '../../cloudflare/maintenance-worker/src/lib/core/maintenance-bypass.js';
import { withSecurityHeaders } from '../../cloudflare/maintenance-worker/src/lib/core/security-headers.js';
import { ticketForSender } from '../../cloudflare/maintenance-worker/src/lib/email/inbound-email.js';

const ROOT = new URL('../../', import.meta.url);

// ── Ś7 ────────────────────────────────────────────────────────────────────
const BYPASS_ENV = { ADMIN_BYPASS_TOKEN: 'stary-staly-sekret' };
const cookieReq = (cookie) => new Request('https://www.familijna.app/', { headers: { Cookie: cookie } });

test('Ś7: podpisany token obejścia z ważnością 12 h', async () => {
  const now = Date.now();
  const token = await createAdminBypassToken(BYPASS_ENV, now);
  assert.match(token, /^v1\.\d+\.[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(token, /stary-staly-sekret/);
  assert.equal(await verifyAdminBypassToken(token, BYPASS_ENV, now), true);
  assert.equal(await verifyAdminBypassToken(token, BYPASS_ENV, now + ADMIN_BYPASS_TTL_SECONDS * 1000 + 1), false);
  assert.equal(await verifyAdminBypassToken(token, { ADMIN_BYPASS_TOKEN: 'inny' }, now), false);
  assert.equal(await verifyAdminBypassToken(token, {}, now), false);
  const [v, exp, sig] = token.split('.');
  assert.equal(await verifyAdminBypassToken(`${v}.${Number(exp) + 3600000}.${sig}`, BYPASS_ENV, now), false);
  assert.equal(await verifyAdminBypassToken(`${v}.${exp}.${sig.slice(0, -2)}AA`, BYPASS_ENV, now), false);
  // Token „na zawsze” z poprawnym podpisem i tak odrzucony (ważność > 12 h).
  const far = now + 30 * 86400000;
  const { createHmac: h } = await import('node:crypto');
  const farSig = h('sha256', 'stary-staly-sekret').update(`familijna-admin-bypass.v1.${far}`).digest('base64url');
  assert.equal(await verifyAdminBypassToken(`v1.${far}.${farSig}`, BYPASS_ENV, now), false);
});

test('Ś7: stare ciasteczko z surowym sekretem nie działa, nowe działa', async () => {
  assert.equal(await hasAdminBypass(cookieReq('__Secure-fml_admin=stary-staly-sekret'), BYPASS_ENV), false);
  assert.equal(await hasAdminBypass(cookieReq('__Host-fml_admin=stary-staly-sekret'), BYPASS_ENV), false);
  const token = await createAdminBypassToken(BYPASS_ENV);
  assert.equal(await hasAdminBypass(cookieReq(`a=b; __Secure-fml_admin=${token}`), BYPASS_ENV), true);
  assert.equal(await hasAdminBypass(cookieReq(`__Secure-fml_admin=${token}`), {}), false);
});

// ── N3 ────────────────────────────────────────────────────────────────────
const html = (headers = {}) => new Response('<p>x</p>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', ...headers } });

test('N3: nagłówki bezpieczeństwa na stronach HTML naszych hostów', () => {
  for (const host of ['www.familijna.app', 'admin.familijna.app', 'nieznana.familijna.app']) {
    const res = withSecurityHeaders(new Request(`https://${host}/`), html());
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff', host);
    assert.equal(res.headers.get('Referrer-Policy'), 'strict-origin-when-cross-origin');
    assert.equal(res.headers.get('X-Frame-Options'), 'SAMEORIGIN');
    const csp = res.headers.get('Content-Security-Policy');
    for (const directive of ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      assert.ok(csp.split('; ').includes(directive), directive);
    }
    assert.match(res.headers.get('Permissions-Policy'), /camera=\(self\)/);
    const ro = res.headers.get('Content-Security-Policy-Report-Only');
    assert.match(ro, /script-src 'self' 'unsafe-inline' https:\/\/cdn\.jsdelivr\.net/);
    assert.match(ro, /connect-src [^;]*wss:\/\/api\.familijna\.app/);
    assert.match(ro, /object-src 'none'/);
    assert.equal(res.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(res.status, 200);
  }
});

test('N3: bez zmian dla usług przepuszczanych, nie-HTML; istniejąca CSP uzupełniona', () => {
  for (const host of ['api.familijna.app', 'panel.familijna.app', 'supabase.familijna.app', 'docker.familijna.app']) {
    assert.equal(withSecurityHeaders(new Request(`https://${host}/`), html()).headers.get('X-Frame-Options'), null, host);
  }
  const js = withSecurityHeaders(new Request('https://www.familijna.app/a.js'), new Response('1', { headers: { 'Content-Type': 'application/javascript' } }));
  assert.equal(js.headers.get('X-Frame-Options'), null);
  const redirect = withSecurityHeaders(new Request('https://familijna.app/'), Response.redirect('https://www.familijna.app/', 301));
  assert.equal(redirect.status, 301);
  const nf = withSecurityHeaders(new Request('https://www.familijna.app/x'), html({ 'Content-Security-Policy': "default-src 'self'" }));
  assert.match(nf.headers.get('Content-Security-Policy'), /^default-src 'self'; frame-ancestors 'self'/);
  const tools = withSecurityHeaders(new Request('https://admin.familijna.app/admin/tools/a.html'), html({ 'Content-Security-Policy': "frame-ancestors 'self'" }));
  assert.equal(tools.headers.get('Content-Security-Policy').split("frame-ancestors").length, 2);
});

test('N3: Worker dokłada nagłówki do strony z plików ASSETS', async () => {
  const { default: worker } = await import('../../cloudflare/maintenance-worker/src/index.js');
  const { setStateCache } = await import('../../cloudflare/maintenance-worker/src/lib/core/state.js');
  setStateCache({ enabled: false, mode: 'off' });
  const ASSETS = { fetch: async () => new Response('<p>Gry</p>', { headers: { 'Content-Type': 'text/html' } }) };
  {
    const res = await worker.fetch(new Request('https://www.familijna.app/games/', { headers: { Accept: 'text/html' } }), { ASSETS }, { waitUntil() {} });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.match(await res.text(), /Gry/);
  }
});

// ── N6 ────────────────────────────────────────────────────────────────────
function mockTicketDb(first) {
  globalThis.fetch = async (url) => {
    const u = new URL(url);
    const ok = (data) => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    if (u.pathname === '/rest/v1/reports') return ok([{ id: 'r1', ticket_number: 'TICKET-2026-0007' }]);
    if (u.pathname === '/rest/v1/messages') return ok([first]);
    throw new Error('unexpected ' + u.pathname);
  };
}

test('N6: mail z [TICKET-…] dopina się tylko od adresu zgłoszenia', async () => {
  const env = { SUPABASE_URL: 'https://api.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
  const prev = globalThis.fetch;
  try {
    mockTicketDb({ direction: 'inbound', from_email: 'owner@example.com', to_email: null });
    assert.equal(await ticketForSender(env, '2026-0007', 'Owner@Example.com'), 'TICKET-2026-0007');
    assert.equal(await ticketForSender(env, '2026-0007', 'intruz@example.com'), null);
    assert.equal(await ticketForSender(env, '2026-0007', ''), null);
    mockTicketDb({ direction: 'outbound', from_email: null, to_email: 'klient@example.com' });
    assert.equal(await ticketForSender(env, '2026-0007', 'klient@example.com'), 'TICKET-2026-0007');
    globalThis.fetch = async () => new Response('[]', { headers: { 'content-type': 'application/json' } });
    assert.equal(await ticketForSender(env, '2026-9999', 'owner@example.com'), null);
  } finally { globalThis.fetch = prev; }
});

// ── N4 ────────────────────────────────────────────────────────────────────
test('N4: storage-cleanup wymaga nagłówka pochodnego od MAIL_WORKER_SECRET (zgodny z bazą)', async () => {
  const fn = readFileSync(new URL('supabase/functions/storage-cleanup/index.ts', ROOT), 'utf8');
  assert.match(fn, /const CLEANUP_CONTEXT = "storage-cleanup";/);
  assert.match(fn, /x-internal-secret/);
  assert.doesNotMatch(fn, /Access-Control-Allow-Origin/);
  const sql = readFileSync(new URL('supabase/migrations/2026-10-21_452_storage_cleanup_internal_secret.sql', ROOT), 'utf8');
  assert.match(sql, /extensions\.hmac\('storage-cleanup', v_secret, 'sha256'\)/);
  // Ten sam wektor sprawdza tests/sql/security-p1-452-454.sql (pgcrypto).
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('storage-cleanup')));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
  assert.equal(hex, '7d142014d30bcd1ef18534140dbd10c5bc144f64759a48205691ac44400f68a8');
  assert.equal(hex, createHmac('sha256', 'test-secret').update('storage-cleanup').digest('hex'));
});
