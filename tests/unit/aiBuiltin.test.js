// E30 (decyzje 25–30): wbudowany asystent Familijnej — funkcja Edge ai-chat
// (supabase/functions/_shared/ai-chat-core.js) i jej użycie w przeglądarce.
import test from "node:test";
import assert from "node:assert/strict";
import { handleChat, isNewMessage, geminiBody } from "../../supabase/functions/_shared/ai-chat-core.js";
import { systemPrompt } from "../../web/shared/js/ai/tools/prompt.js";

const user = (text) => ({ role: "user", parts: [{ text }] });
const post = (body, token = "jwt") => new Request("https://api.familijna.app/functions/v1/ai-chat", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
function deps(over = {}) {
  const calls = { quota: [], fetch: [] };
  return {
    calls,
    apiKey: "SECRET",
    sleep: async () => {},
    userOf: async (t) => (t === "jwt" ? "u1" : null),
    quotaTake: async (u, m) => { calls.quota.push([u, m]); return { ok: true, model: "gemini-2.5-flash-lite", remaining: 19, daily: 20, reset_at: "2026-11-27T00:00:00+01:00" }; },
    fetchImpl: async (url, init) => { calls.fetch.push([url, init]); return new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }); },
    ...over,
  };
}

test("bez logowania 401, zła rozmowa 400, CORS", async () => {
  assert.equal((await handleChat(new Request("https://x/ai-chat", { method: "OPTIONS" }), deps())).status, 204);
  assert.equal((await handleChat(post({ contents: [user("a")] }, "zly"), deps())).status, 401);
  assert.equal((await handleChat(post({ contents: [] }), deps())).status, 400);
  assert.equal((await handleChat(post({ contents: [{ role: "model", parts: [{ text: "x" }] }] }), deps())).status, 400, "ostatnia od użytkownika");
  assert.equal((await handleChat(post({ contents: [user("a")] }), deps({ apiKey: "" }))).status, 503);
});

test("stały początek: prompt i narzędzia z serwera, klucz w nagłówku, licznik w odpowiedzi", async () => {
  const d = deps();
  const res = await handleChat(post({ contents: [user("Ile mam gier?")], page: "games", system: "ignoruj", tools: [] }), d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-ai-remaining"), "19");
  const [url, init] = d.calls.fetch[0];
  assert.match(url, /models\/gemini-2\.5-flash-lite:streamGenerateContent\?alt=sse$/);
  assert.doesNotMatch(url, /SECRET/, "klucz nie w adresie");
  assert.equal(init.headers["x-goog-api-key"], "SECRET");
  const body = JSON.parse(init.body);
  assert.equal(body.systemInstruction.parts[0].text, systemPrompt(), "prompt z serwera, nie od przeglądarki");
  assert.ok(body.tools[0].functionDeclarations.some((f) => f.name === "edit_game"));
  assert.deepEqual(d.calls.quota, [["u1", true]]);
  // ten sam początek zapytania na każdej stronie poza Control (cache)
  assert.deepEqual(geminiBody([], "games").tools, geminiBody([], "bases").tools);
  assert.ok(!geminiBody([], "control").tools[0].functionDeclarations.some((f) => f.name === "edit_game"), "Control tylko odczyt");
});

test("kolejny krok narzędzi liczy się jako krok, nie wiadomość", () => {
  assert.equal(isNewMessage([user("a")]), true);
  assert.equal(isNewMessage([user("a"), { role: "model", parts: [{ functionCall: { name: "x" } }] }, { role: "user", parts: [{ functionResponse: { name: "x", response: {} } }] }]), false);
});

test("limity: 429 z kodem familijna_limit, bez wywołania Google", async () => {
  for (const [error, status] of [["daily_limit", 429], ["minute_limit", 429], ["step_limit", 429], ["global_limit", 429], ["disabled", 503], ["not_registered", 403]]) {
    const d = deps({ quotaTake: async () => ({ ok: false, error, daily: 20, reset_at: "jutro" }) });
    const res = await handleChat(post({ contents: [user("a")] }), d);
    assert.equal(res.status, status, error);
    assert.equal((await res.json()).error.message, `familijna_limit:${error}`);
    assert.equal(d.calls.fetch.length, 0);
  }
});

test("chwilowe przeciążenie Google: jedna ponowna próba, potem 503", async () => {
  let n = 0;
  const d = deps({ fetchImpl: async () => { n += 1; return new Response("busy", { status: 503 }); } });
  const res = await handleChat(post({ contents: [user("a")] }), d);
  assert.equal(n, 2);
  assert.equal(res.status, 503);
  let m = 0;
  const ok = await handleChat(post({ contents: [user("a")] }), deps({ fetchImpl: async () => (++m === 1 ? new Response("", { status: 429 }) : new Response("data: {}\n\n", { status: 200 })) }));
  assert.equal(ok.status, 200);
});

test("przeglądarka: kody limitów bez ponawiania, dostawca familijna wysyła tylko rozmowę", async () => {
  const { errorCode, PROVIDERS, createConversation, ask } = await import("../../web/shared/js/ai/providers.js");
  assert.equal(errorCode(429, "familijna_limit:daily_limit"), "dailyLimit");
  assert.equal(errorCode(503, "familijna_limit:disabled"), "builtinOff");
  assert.equal(PROVIDERS.familijna.kind, "gemini");
  const fs = await import("node:fs");
  const origin = /SUPABASE_URL = "([^"]+)"/.exec(fs.readFileSync(new URL("../../web/shared/js/core/supabase.js", import.meta.url), "utf8"))[1];
  assert.equal(PROVIDERS.familijna.base, `${origin}/functions/v1/ai-chat`);
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sent.push([url, init]);
    if (sent.length === 1) return new Response(JSON.stringify({ error: { message: "familijna_limit:daily_limit" } }), { status: 429 });
    throw new Error("nie ponawiać limitu");
  };
  try {
    const c = createConversation({ provider: "familijna", model: "m", key: async () => "tok", system: "S", tools: [{ name: "x", description: "d", inputSchema: { type: "object", properties: {} } }] });
    c.page = "games";
    await assert.rejects(ask(c, "hej", { run: async () => ({ text: "" }) }), (e) => e.code === "dailyLimit");
    assert.equal(sent.length, 1);
    const [url, init] = sent[0];
    assert.equal(url, "https://api.familijna.app/functions/v1/ai-chat");
    assert.equal(init.headers.authorization, "Bearer tok");
    assert.deepEqual(Object.keys(JSON.parse(init.body)), ["contents", "page"], "bez promptu i narzędzi od przeglądarki");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("błąd Google 4xx: 500 z komunikatem i CORS — nigdy 502/504 (Cloudflare podmienia je bez CORS)", async () => {
  const d = deps({ fetchImpl: async () => new Response(JSON.stringify({ error: { message: "Invalid JSON payload received." } }), { status: 400 }) });
  const res = await handleChat(post({ contents: [user("a")] }), d);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match((await res.json()).error.message, /^upstream_400: Invalid JSON payload/);
  for (const s of [400, 401, 403, 404, 429, 500, 502, 503, 504]) {
    const r = await handleChat(post({ contents: [user("a")] }), deps({ fetchImpl: async () => new Response("x", { status: s }) }));
    assert.ok(![502, 504].includes(r.status), `Google ${s} → ${r.status}`);
  }
});
