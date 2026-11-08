import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// cloudflare/maintenance-worker/package.json ustawia "type": "module", więc
// ten plik i wszystko, co z niego importuje (src/lib/**), jest ladowane
// przez Node jako prawdziwe moduly ES z realnych sciezek plikowych --
// relatywne importy w index.js rozwiazuja sie normalnie. To testuje
// dokladnie ten sam plik, ktory buduje Wrangler (esbuild ignoruje
// package.json "type" i tak samo traktuje ten plik jako ESM).
const { default: worker } = await import("../../cloudflare/maintenance-worker/src/index.js");

const SECRET = "unit-test-e2e-secret";

test("Diagnostyka dostarczenia wymaga tokenu i adresu testowego w krótkim oknie", async () => {
  const after = encodeURIComponent(new Date().toISOString());
  for (const [recipient, headers, status] of [
    ["e2e+standard01@familijna.app", {}, 401],
    ["real@example.com", { "X-E2E-Token": token() }, 400],
  ]) {
    const response = await worker.fetch(new Request(`https://www.familijna.app/_e2e_api/mail-delivery?recipient=${encodeURIComponent(recipient)}&after=${after}`, { headers }), env(), {});
    assert.equal(response.status, status);
  }
});

function token() {
  const payload = Buffer.from(JSON.stringify({ iat: Date.now(), nonce: crypto.randomUUID() })).toString("base64");
  const signature = crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
  return `${payload}.${signature}`;
}

function env() {
  return {
    E2E_BYPASS_SECRET: SECRET,
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  };
}

test("E2E mailbox odrzuca brak podpisanego tokenu", async () => {
  const response = await worker.fetch(
    new Request("https://www.familijna.app/_e2e_api/emails?recipient=e2e%2Bstandard01%40familijna.app&after=2026-09-30T10:00:00Z"),
    env(),
    {}
  );
  assert.equal(response.status, 401);
});

test("E2E mailbox dopuszcza tylko przygotowane konta testowe i ograniczone okno czasu", async () => {
  const headers = { "X-E2E-Token": token() };
  const badRecipient = await worker.fetch(
    new Request(`https://www.familijna.app/_e2e_api/emails?recipient=test1%40familiada.online&after=${encodeURIComponent(new Date().toISOString())}`, { headers }),
    env(),
    {}
  );
  assert.equal(badRecipient.status, 400);

  const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const oldWindow = await worker.fetch(
    new Request(`https://www.familijna.app/_e2e_api/emails?recipient=e2e%2Bstandard01%40familijna.app&after=${encodeURIComponent(oldDate)}`, { headers: { "X-E2E-Token": token() } }),
    env(),
    {}
  );
  assert.equal(oldWindow.status, 400);
});

for (const recipient of ["e2e+standard01@familijna.app", "e2e+noaccount01@familijna.app", "e2e+disposable01.new@familijna.app", "e2e+dedicated01@familijna.app"]) {
test(`mail do ${recipient} zapisuje sie w e2e_emails i nie jest forwardowany`, async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).includes("/rpc/e2e_identity")) return Response.json({ name: "e2e.identity01" });
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify([{ id: "mail-id" }]), { status: 201, headers: { "Content-Type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  let forwarded = false;
  const raw = `From: sender@example.com\r\nTo: ${recipient}\r\nSubject: Zaproszenie\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nKliknij https://familijna.app/go/?s=abc`;
  await worker.email({
    from: "sender@example.com",
    to: recipient,
    headers: new Headers({ subject: "Zaproszenie" }),
    raw: new Blob([raw]).stream(),
    async forward() { forwarded = true; },
  }, { ...env(), FORWARD_EMAIL: "owner@example.com" });

  assert.equal(forwarded, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/e2e_emails$/);
  const saved = JSON.parse(calls[0].options.body);
  assert.equal(saved.recipient, recipient);
  assert.match(saved.body, /go\/\?s=/);
});

}

const { normalizeE2ERecipient } = await import("../../cloudflare/maintenance-worker/src/lib/e2e/e2e-api.js");
test("adresy testowe to wyłącznie e2e+<rola><NN> (E25)", () => {
  assert.equal(normalizeE2ERecipient(" E2E+Standard07@FAMILIJNA.APP "), "e2e+standard07@familijna.app");
  assert.equal(normalizeE2ERecipient("e2e+disposable01.new@familijna.app"), "e2e+disposable01.new@familijna.app");
  for (const value of ["test1@familiada.online","test14@familiada.online","e2e@familijna.app","e2e+x@familijna.app","e2e+standard01@example.com","e2e+standard01@familiada.online","real@familiada.online","e2e+standard01@familijna.app.attacker.net",null]) {
    assert.equal(normalizeE2ERecipient(value),null);
  }
});
test("skrzynka e2e+ i diagnostyka tylko z tokenem E2E i wypożyczeniem", async (t) => {
  const originalFetch=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async (url,options={})=>{if(String(url).includes("/rpc/e2e_lease_owns"))return Response.json(true);calls.push({url:String(url),method:options.method});return new Response(JSON.stringify([]),{status:200,headers:{"Content-Type":"application/json"}});};
  t.after(()=>{globalThis.fetch=originalFetch;});
  for(const [endpoint,method] of [["emails","GET"],["emails","DELETE"],["mail-delivery","GET"]]) {
    const url=`https://www.familijna.app/_e2e_api/${endpoint}?recipient=e2e%2Bnoaccount01%40familijna.app&after=${encodeURIComponent(new Date().toISOString())}`;
    const blocked=await worker.fetch(new Request(url,{method}),env(),{});
    assert.equal(blocked.status,401);
    const response=await worker.fetch(new Request(url,{method,headers:{"X-E2E-Token":token(),"X-E2E-Run":"run-1"}}),env(),{});
    assert.equal(response.status,200);
  }
  assert.equal(calls.length,4);
  assert.ok(calls.every(call=>call.url.includes('e2e%2Bnoaccount01%40familijna.app')));
});

const TECHNICAL_FROM = 'bounce+948a5050-c564-11f1-8b41-16423a433ff6_vt1@bounce-zem.familiada.online';
for (const recipient of ['admin@familiada.online', 'unknown@familiada.online']) {
  test(`own SMTP copy to ${recipient} never reaches inbox, forwarding or admin notifications`, async (t) => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(String(url)); return Response.json({}); };
    t.after(() => { globalThis.fetch = originalFetch; });
    let forwarded = false;
    await worker.email({ from: TECHNICAL_FROM.toUpperCase(), to: recipient,
      headers: new Headers({ subject: 'Zaproszenie do ankiety' }),
      raw: new Blob(['Content-Type: text/plain\r\n\r\nFAMILIJNA']).stream(),
      async forward() { forwarded = true; },
    }, { ...env(), FORWARD_EMAIL: 'owner@example.com' });
    assert.deepEqual(calls, []);
    assert.equal(forwarded, false);
  });
}
test('technical sender still delivers to every exact test mailbox', async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { if (String(url).includes('/rpc/e2e_identity')) return Response.json({ name: 'e2e.identity01' }); calls.push({ url: String(url), body: JSON.parse(options.body) }); return Response.json([{ id: 'fixture' }]); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const addresses = ['standard01', 'standard40', 'noaccount10', 'disposable06', 'disposable06.new', 'dedicated01'].map((id) => `e2e+${id}@familijna.app`);
  for (const to of addresses) {
    await worker.email({ from: TECHNICAL_FROM, to, headers: new Headers({ subject: 'Invitation' }),
      raw: new Blob(['Content-Type: text/plain\r\n\r\nFixture']).stream(),
      async forward() { assert.fail('test mail forwarded'); },
    }, env());
    assert.equal(calls.at(-1).body.recipient, to);
    assert.match(calls.at(-1).url, /\/e2e_emails$/);
  }
  assert.equal(calls.length, addresses.length);
});
test('ordinary replies and similar domains retain the real inbox path', async (t) => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => { calls.push(String(url)); return Response.json(String(url).includes('/rpc/') ? [{ id: 'fixture' }] : []); };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const from of ['person@example.com', 'bounce+abc@other.example.com', 'bounce+abc@bounce-zem.familiada.online.attacker.example', 'support@bounce-zem.familiada.online']) {
    calls.length = 0;
    let forwarded = false;
    await worker.email({ from, to: 'admin@familiada.online', headers: new Headers({ subject: 'Re: Zaproszenie do ankiety' }),
      raw: new Blob(['Content-Type: text/plain\r\n\r\nReply']).stream(),
      async forward() { forwarded = true; },
    }, { ...env(), FORWARD_EMAIL: 'owner@example.com' });
    assert.equal(forwarded, true);
    assert.ok(calls.some(url => url.includes('/rpc/save_inbound_message')));
  }
});

test("zwolnienie blokady maila: tylko z tokenem, adres testowy i dozwolony klucz", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => { if (String(url).includes("/rpc/e2e_lease_owns")) return Response.json(true); calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null }); return Response.json(true); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const send = (body, withToken = true) => worker.fetch(new Request("https://www.familijna.app/_e2e_api/mail-cooldowns/release", {
    method: "POST", headers: { "Content-Type": "application/json", "X-E2E-Run": "run-1", ...(withToken ? { "X-E2E-Token": token() } : {}) }, body: JSON.stringify(body),
  }), env(), {});
  const ok = { recipient: "e2e+noaccount01@familijna.app", action_key: "auth:guest_upgrade_email" };
  assert.equal((await send(ok, false)).status, 401);
  assert.equal((await send({ ...ok, recipient: "real@example.com" })).status, 400);
  assert.equal((await send({ ...ok, action_key: "account:email" })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send(ok)).status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/rest\/v1\/rpc\/mail_cooldown_email_release$/);
  assert.deepEqual(calls[0].body, { p_email: "e2e+noaccount01@familijna.app", p_action_key: "auth:guest_upgrade_email", p_max_age_seconds: 7200 });
});
