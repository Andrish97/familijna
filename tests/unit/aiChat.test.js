// E30: pętla rozmowy czatu AI (web/shared/js/ai) z atrapą dostawcy —
// trzy rodzaje API (Anthropic, Gemini, zgodne z OpenAI), narzędzia,
// ponawianie, błędy i potwierdzenia przed akcjami nieodwracalnymi.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Moduły przeglądarki podmienione na atrapy (Supabase, tłumaczenia, blokady).
const STUBS = {
  "translation.js": "export const t = (k, p) => p && p.status !== undefined ? `${k}:${p.status}` : k;",
  "supabase.js": "export const sb = () => globalThis.__sb;",
  "resource-lock.js": "export const getTabId = () => 'tab-test';",
  "game-content.js": "export const applyGameContent = (...a) => globalThis.__apply(...a); export const createGameWithContent = (...a) => globalThis.__create(...a);",
  "poll-mail.js": "export const sendPollInviteMails = async () => ({ total: 0, sent: 0, failed: 0, skipped: 0 });",
  "contact-invite.js": "export const createContactInvite = async () => ({ data: {}, mail: null }); export const sendContactInviteMail = async () => false;",
  "cache-bust.js": "export const v = async (u) => u;",
  "contact-dialog.js": "export const openContactModal = async (o) => { globalThis.__contact = o; };",
  "nav-map.js": "export const PAGES = { games: {}, editor: {} }; export const linkTo = (p, q) => `/${p}/?${new URLSearchParams(q)}`;",
};

async function load() {
  const res = await build({
    stdin: {
      contents: "export * as providers from './web/shared/js/ai/providers.js'; export * as chat from './web/shared/js/ai/chat.js'; export * as tools from './web/shared/js/ai/tools/index.js';",
      resolveDir: ROOT, loader: "js",
    },
    bundle: true, format: "esm", write: false, platform: "neutral",
    plugins: [{
      name: "stubs",
      setup(b) {
        b.onResolve({ filter: /\.js$/ }, (a) => {
          const name = path.basename(a.path);
          if (STUBS[name] && !a.path.startsWith("./tools")) return { path: name, namespace: "stub" };
          return null;
        });
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({ contents: STUBS[a.path], loader: "js" }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(res.outputFiles[0].text).toString("base64")}`);
}
const mod = await load();
const { providers, chat, tools } = mod;
providers.timing.sleep = async () => {};

// Odpowiedź SSE z listy zdarzeń.
function sse(events) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(new TextEncoder().encode(body), { status: 200, headers: { "content-type": "text/event-stream" } });
}
function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: opts?.body ? JSON.parse(opts.body) : null, headers: opts?.headers });
    const r = responses.shift();
    if (!r) throw new Error("brak odpowiedzi atrapy");
    return typeof r === "function" ? r() : r;
  };
  return calls;
}
const tool = { name: "list_games", description: "d", inputSchema: { type: "object", properties: {} } };

test("Anthropic: narzędzie, wynik w historii, odpowiedź strumieniem", async () => {
  const calls = fakeFetch([
    sse([
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tu1", name: "list_games" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"a\":" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "1}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
    ]),
    sse([
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Masz " } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "2 gry." } },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
    ]),
  ]);
  const c = providers.createConversation({ provider: "anthropic", model: "m", key: "k", system: "s", tools: [tool] });
  let streamed = "";
  const ran = [];
  const out = await providers.ask(c, "Ile mam gier?", { run: async (n, a) => { ran.push([n, a]); return { text: "{\"n\":2}" }; }, onText: (x) => { streamed += x; } });
  assert.equal(out.text, "Masz 2 gry.");
  assert.equal(streamed, "Masz 2 gry.");
  assert.deepEqual(ran, [["list_games", { a: 1 }]]);
  assert.equal(calls[0].headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(calls[0].body.tools[0].input_schema.type, "object");
  assert.deepEqual(c.history[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: "{\"n\":2}" }] });
});

test("OpenAI: wywołanie narzędzia złożone z kawałków strumienia", async () => {
  fakeFetch([
    sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "list_", arguments: "{\"x\"" } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "games", arguments: ":2}" } }] } }] },
    ]),
    sse([{ choices: [{ delta: { content: "Gotowe." } }] }]),
  ]);
  const c = providers.createConversation({ provider: "deepseek", model: "m", key: "k", system: "s", tools: [tool] });
  const ran = [];
  const out = await providers.ask(c, "x", { run: async (n, a) => { ran.push([n, a]); return { text: "ok" }; } });
  assert.equal(out.text, "Gotowe.");
  assert.deepEqual(ran, [["list_games", { x: 2 }]]);
  assert.deepEqual(c.history[2], { role: "tool", tool_call_id: "c1", content: "ok" });
});

test("Gemini: functionCall i functionResponse, schemat bez nieobsługiwanych pól", async () => {
  const calls = fakeFetch([
    sse([{ candidates: [{ content: { parts: [{ functionCall: { name: "list_games", args: {} } }] } }] }]),
    sse([{ candidates: [{ content: { parts: [{ text: "Jest " }] } }] }, { candidates: [{ content: { parts: [{ text: "dobrze." }] } }] }]),
  ]);
  const schemaTool = { ...tool, inputSchema: { type: "object", additionalProperties: false, properties: { n: { type: "integer", enum: [1, 2] } } } };
  const c = providers.createConversation({ provider: "gemini", model: "g", key: "k", system: "s", tools: [schemaTool] });
  const out = await providers.ask(c, "x", { run: async () => ({ text: "w" }) });
  assert.equal(out.text, "Jest dobrze.");
  const params = calls[0].body.tools[0].functionDeclarations[0].parameters;
  assert.equal(params.additionalProperties, undefined);
  assert.equal(params.properties.n.enum, undefined);
  assert.deepEqual(c.history[2], { role: "user", parts: [{ functionResponse: { name: "list_games", response: { result: "w" } } }] });
});

test("błędy dostawcy: zły klucz bez ponawiania, przeciążenie ponawiane", async () => {
  const calls = fakeFetch([new Response(JSON.stringify({ error: { message: "invalid x-api-key" } }), { status: 401 })]);
  const c = providers.createConversation({ provider: "anthropic", model: "m", key: "k", system: "s", tools: [] });
  await assert.rejects(providers.ask(c, "x", { run: async () => ({ text: "" }) }), (e) => e.code === "badKey" && e.message === "aiChat.errors.badKey:401");
  assert.equal(calls.length, 1);

  const calls2 = fakeFetch([
    new Response("overloaded", { status: 529 }),
    new Response("overloaded", { status: 529 }),
    sse([{ choices: [{ delta: { content: "ok" } }] }]),
  ]);
  const c2 = providers.createConversation({ provider: "openai", model: "m", key: "k", system: "s", tools: [] });
  assert.equal((await providers.ask(c2, "x", { run: async () => ({ text: "" }) })).text, "ok");
  assert.equal(calls2.length, 3);

  assert.equal(providers.errorCode(402, ""), "noFunds");
  assert.equal(providers.errorCode(400, "model not found"), "noModel");
  assert.equal(providers.errorCode(400, "tools are not supported"), "noTools");
});

test("zalecany model z listy dostawcy", () => {
  assert.equal(providers.recommendedModel("anthropic", ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-sonnet-4-5"]), "claude-sonnet-5-5");
  assert.equal(providers.recommendedModel("gemini", ["gemini-3-flash-lite", "gemini-3-flash", "gemini-3-flash-preview"]), "gemini-3-flash");
});

test("narzędzia: potwierdzenie przed nieodwracalnym, odmowa nie wykonuje, Control tylko odczyt", async () => {
  const applied = [];
  let reply = { ok: true };
  const db = { rpc: async (fn, args) => { applied.push([fn, args]); return { data: reply, error: null }; } };
  const asked = [];
  const ctx = (answer, pageId = "editor") => ({
    lang: "pl", pageId, db, tabId: "tab-test", changed() {},
    confirm: async (q) => { asked.push(q); return answer; },
  });
  const add = { game_id: "g", operations: [{ op: "add_question", text: "Q" }] };
  let r = await chat.runTool("edit_game", add, ctx(false));
  assert.equal(r.error, false);
  assert.equal(asked.length, 0, "dodanie pytania bez pytania o zgodę");

  const del = { game_id: "g", operations: [{ op: "delete_question", question_id: "q" }] };
  r = await chat.runTool("edit_game", del, ctx(false));
  assert.deepEqual(JSON.parse(r.text), { error: "declined_by_user" });
  assert.equal(asked.at(-1).kind, "irreversible");
  assert.equal(applied.length, 1, "odmowa: nic nie wykonane");

  r = await chat.runTool("edit_game", del, ctx(true));
  assert.equal(applied.length, 2);
  assert.equal(applied[1][0], "game_content_apply");
  assert.equal(applied[1][1].p_tab_id, "tab-test");

  r = await chat.runTool("edit_game", add, ctx(true, "control"));
  assert.deepEqual(JSON.parse(r.text), { error: "tool_not_available_here" });
  const names = tools.toolsForPage("control").map((x) => x.name);
  assert.ok(names.includes("manual_chapter") && names.includes("get_poll"));
  for (const n of ["create_game", "open_page", "open_poll", "send_poll_invites", "invite_contact", "add_base_questions"]) assert.ok(!names.includes(n), n);
  const server = tools.toolsForPage(null, { server: true }).map((x) => x.name);
  assert.ok(server.includes("edit_game") && !server.includes("open_page") && !server.includes("report_problem"), "MCP bez narzędzi przeglądarki");

  reply = { ok: false, error: "locked", blocker_context: "editor" };
  r = await chat.runTool("edit_game", add, ctx(true));
  assert.equal(r.error, true);
  assert.equal(JSON.parse(r.text).error, "locked");
});

test("prompt systemowy: język odpowiedzi i tryb Control", () => {
  assert.match(chat.systemPrompt({ lang: "uk", pageId: "games" }), /reply in Ukrainian/);
  assert.match(chat.systemPrompt({ lang: "pl", pageId: "control" }), /Do not change anything/);
  assert.doesNotMatch(chat.systemPrompt({ lang: "pl", pageId: "games" }), /Do not change anything/);
});

test("katalog: unikalne nazwy, schemat obiektu, potwierdzenia wysyłki i nieodwracalnych", () => {
  const names = tools.TOOLS.map((x) => x.name);
  assert.equal(new Set(names).size, names.length);
  for (const x of tools.TOOLS) {
    assert.match(x.name, /^[a-z_]{3,40}$/, x.name);
    assert.equal(x.inputSchema.type, "object", x.name);
    assert.ok(x.description.length > 20, x.name);
  }
  const kind = (n, a = {}) => tools.toolByName(n).confirm?.(a) ?? null;
  for (const n of ["send_poll_invites", "invite_contact"]) assert.equal(kind(n), "send", n);
  for (const n of ["delete_game", "abort_poll", "tally_poll", "delete_logo"]) assert.equal(kind(n), "irreversible", n);
  assert.equal(kind("edit_game", { operations: [{ op: "set_answers" }] }), "irreversible");
  assert.equal(kind("edit_game", { operations: [{ op: "rename" }], reset_poll_results: true }), "irreversible");
  for (const n of ["create_game", "open_poll", "stop_poll", "delete_base_items", "add_base_questions"]) assert.equal(kind(n), null, n);
});

test("każde narzędzie ma nazwę dla użytkownika w trzech językach", async () => {
  const { loadDict } = await import("./helpers/i18n.js");
  for (const lang of ["pl", "en", "uk"]) {
    const dict = await loadDict(lang);
    for (const x of tools.TOOLS) assert.ok(dict.aiChat?.tools?.[x.name], `${lang}: aiChat.tools.${x.name}`);
  }
});

test("historia do pokazania: wiadomości, narzędzia, bez wyników narzędzi; czekanie na odpowiedź", () => {
  const anthropic = [
    { role: "user", content: "Zrób grę" },
    { role: "assistant", content: [{ type: "text", text: "Robię." }, { type: "tool_use", id: "1", name: "create_game", input: {} }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "{}" }] },
    { role: "assistant", content: [{ type: "text", text: "Gotowe." }] },
  ];
  assert.deepEqual(chat.displayItems("anthropic", anthropic), [
    { role: "user", text: "Zrób grę" }, { role: "tool", tool: "create_game" },
    { role: "assistant", text: "Robię." }, { role: "assistant", text: "Gotowe." },
  ]);
  assert.equal(chat.awaitingReply("anthropic", anthropic), false);
  assert.equal(chat.awaitingReply("anthropic", anthropic.slice(0, 3)), true);
  assert.equal(chat.awaitingReply("anthropic", anthropic.slice(0, 1)), true);

  const openai = [
    { role: "user", content: "x" },
    { role: "assistant", content: "", tool_calls: [{ id: "c", function: { name: "list_games", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "c", content: "{}" },
  ];
  assert.deepEqual(chat.displayItems("openai", openai), [{ role: "user", text: "x" }, { role: "tool", tool: "list_games" }]);
  assert.equal(chat.awaitingReply("openai", openai), true);

  const gemini = [
    { role: "user", parts: [{ text: "x" }] },
    { role: "model", parts: [{ functionCall: { name: "get_game", args: {} } }] },
    { role: "user", parts: [{ functionResponse: { name: "get_game", response: {} } }] },
    { role: "model", parts: [{ text: "ok" }] },
  ];
  assert.deepEqual(chat.displayItems("gemini", gemini), [{ role: "user", text: "x" }, { role: "tool", tool: "get_game" }, { role: "assistant", text: "ok" }]);
  assert.equal(chat.awaitingReply("gemini", gemini), false);
});

test("CSP stron aplikacji dopuszcza adresy wszystkich dostawców AI", async () => {
  const { AI_PROVIDER_HOSTS } = await import("../../cloudflare/maintenance-worker/src/lib/core/security-headers.js");
  for (const [id, p] of Object.entries(providers.PROVIDERS)) {
    assert.ok(AI_PROVIDER_HOSTS.split(" ").includes(new URL(p.base).origin), `${id}: ${p.base}`);
  }
});

test("zgłoszenie problemu: tylko wypełnia formularz Kontaktu, bez potwierdzenia, także w Control", async () => {
  let opened = null;
  const ctx = {
    lang: "pl", pageId: "control", pagePath: "/control/", changed() {},
    confirm: async () => { throw new Error("bez pytania"); },
    openContactForm: async (o) => { opened = o; },
  };
  const r = await chat.runTool("report_problem", { subject: "Nie działa przycisk", description: "Klikam i nic." }, ctx);
  assert.equal(r.error, false);
  assert.equal(JSON.parse(r.text).opened, "contact_form");
  assert.equal(opened.subject, "Nie działa przycisk");
  assert.match(opened.message, /^Klikam i nic\.\n\n— \/control\/$/);
});

test("ustawienia gry: te same granice co strona, zmiany tylko w podanych polach, błędne wartości odrzucone", async () => {
  const { SETTINGS_LIMITS, patchSettings } = await import("../../web/shared/js/ai/tools/game-settings.js");
  const { ADVANCED_LIMITS } = await import("../../web/games/settings/js/advanced-limits.js");
  const { LONG_MAX_INPUT } = await import("../../web/shared/js/display/long-text.js");
  for (const key of Object.keys(ADVANCED_LIMITS)) assert.deepEqual(SETTINGS_LIMITS[key], ADVANCED_LIMITS[key], key);
  assert.equal(SETTINGS_LIMITS.teamName, LONG_MAX_INPUT);

  const saved = { teams: { teamA: "Red" }, questions: { rounds: ["q1"] }, sound: { volumes: { a: 5 } } };
  const ok = patchSettings(saved, { team_b_name: " Blue ", colors: { team_a: "#f80" }, end_screen: "points", main_prize_amount: 1000, round_multipliers: [1, 2] });
  assert.equal(ok.settings.teams.teamA, "Red");
  assert.equal(ok.settings.teams.teamB, "Blue");
  assert.equal(ok.settings.display.colors.A, "#FF8800");
  assert.equal(ok.settings.game.advanced.endScreenMode, "points");
  assert.deepEqual(ok.settings.game.advanced.roundMultipliers, [1, 2]);
  assert.deepEqual(ok.settings.questions, saved.questions, "wybór pytań bez zmian");
  assert.deepEqual(saved.teams, { teamA: "Red" }, "zapisany obiekt nietknięty");

  assert.equal(patchSettings({}, { final_target: 481 }).error, "out_of_range");
  assert.equal(patchSettings({}, { colors: { dots: "zielony" } }).error, "invalid_color");
  assert.equal(patchSettings({}, { end_screen: "fireworks" }).error, "invalid_value");
  assert.equal(patchSettings({}, { team_a_name: "x".repeat(49) }).error, "too_long");
  assert.equal(patchSettings({}, { round_multipliers: [] }).error, "out_of_range");
});
