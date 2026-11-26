// E30 (decyzja 19): rdzeń serwera MCP (supabase/functions/_shared/mcp-core.js,
// mcp-env.js) — trasy, OAuth, JSON-RPC, narzędzia z atrapą bazy.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleHttp, routeOf, PROTOCOL_VERSIONS } from "../../supabase/functions/_shared/mcp-core.js";
import { serverToolEnv, parseExportDefault } from "../../supabase/functions/_shared/mcp-env.js";

const PUB = "https://api.familijna.app";
const SITE = "https://www.familijna.app";
const TOKEN = `fam_mcp_${"a".repeat(64)}`;

function fakeDb(tables = {}) {
  const calls = [];
  const query = (name) => {
    const q = { _rows: tables[name] || [], select() { return q; }, neq() { return q; }, eq() { return q; }, order() { return q; },
      then(ok) { return Promise.resolve({ data: q._rows, error: null }).then(ok); } };
    return q;
  };
  return { calls, from: query, rpc: async (fn, args) => { calls.push([fn, args]); return { data: { ok: true }, error: null }; } };
}

function deps(over = {}) {
  const anonCalls = [];
  const db = fakeDb({ games: [{ id: "g1", name: "Gra", type: "prepared", status: "draft" }] });
  return {
    anonCalls, db,
    pub: PUB, site: SITE,
    anonRpc: async (fn, args) => {
      anonCalls.push([fn, args]);
      if (fn === "mcp_client_register") return { ok: true, client_id: "c1", client_name: args.p_name };
      if (fn === "mcp_authorize_begin") return { ok: true, request_id: "r1" };
      if (fn === "mcp_token_exchange") return args.p_code === "good" ? { ok: true, access_token: TOKEN, expires_in: 60 } : { ok: false, error: "invalid_grant" };
      return null;
    },
    tokenUser: async (t) => (t === TOKEN ? { user_id: "u1", token_id: "t1" } : null),
    userCtx: async ({ userId, tokenId }) => serverToolEnv({ db, jwt: "jwt", userId, tokenId, lang: "pl", site: SITE, supabaseUrl: "https://api.x", fetchImpl: async () => { throw new Error("bez sieci"); } }),
    ...over,
  };
}
const post = (path, body, headers = {}) => new Request(`${PUB}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("trasy: przez Workera i bezpośrednio do funkcji", () => {
  assert.equal(routeOf("/mcp"), "/mcp");
  assert.equal(routeOf("/functions/v1/mcp"), "/mcp");
  assert.equal(routeOf("/functions/v1/mcp/oauth/token"), "/mcp/oauth/token");
  assert.equal(routeOf("/.well-known/oauth-protected-resource/mcp"), "/.well-known/oauth-protected-resource/mcp");
  assert.equal(routeOf("/functions/v1/mcp/.well-known/oauth-authorization-server"), "/.well-known/oauth-authorization-server");
});

test("OAuth: opisy, rejestracja, przekierowanie do zgody, wymiana kodu", async () => {
  const d = deps();
  const pr = await (await handleHttp(new Request(`${PUB}/.well-known/oauth-protected-resource/mcp`), d)).json();
  assert.equal(pr.resource, `${PUB}/mcp`);
  const as = await (await handleHttp(new Request(`${PUB}/.well-known/oauth-authorization-server`), d)).json();
  assert.equal(as.token_endpoint, `${PUB}/mcp/oauth/token`);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"]);

  const reg = await handleHttp(post("/mcp/oauth/register", { client_name: "Claude", redirect_uris: ["https://claude.ai/cb"] }), d);
  assert.equal(reg.status, 201);
  assert.equal((await reg.json()).client_id, "c1");

  const bad = await handleHttp(new Request(`${PUB}/mcp/oauth/authorize?response_type=code&client_id=c1&code_challenge_method=plain`), d);
  assert.equal(bad.status, 400);
  const auth = await handleHttp(new Request(`${PUB}/mcp/oauth/authorize?response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb&code_challenge=${"x".repeat(43)}&code_challenge_method=S256&state=s`), d);
  assert.equal(auth.status, 302);
  assert.equal(auth.headers.get("location"), `${SITE}/login/?next=account&ai=r1`);

  const form = (code) => new Request(`${PUB}/mcp/oauth/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `grant_type=authorization_code&code=${code}&code_verifier=v&client_id=c1&redirect_uri=https%3A%2F%2Fclaude.ai%2Fcb` });
  const tok = await handleHttp(form("good"), d);
  assert.equal(tok.status, 200);
  assert.equal((await tok.json()).access_token, TOKEN);
  assert.equal((await handleHttp(form("bad"), d)).status, 400);
});

test("JSON-RPC: bez tokenu 401 z opisem logowania; initialize, lista narzędzi, wywołanie", async () => {
  const d = deps();
  const noAuth = await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), d);
  assert.equal(noAuth.status, 401);
  assert.match(noAuth.headers.get("www-authenticate"), /resource_metadata="https:\/\/api\.familijna\.app\/\.well-known\/oauth-protected-resource\/mcp"/);

  const H = { authorization: `Bearer ${TOKEN}` };
  const init = await (await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, H), d)).json();
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "familijna");
  const unknownVer = await (await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, H), d)).json();
  assert.equal(unknownVer.result.protocolVersion, PROTOCOL_VERSIONS[0]);

  const note = await handleHttp(post("/mcp", { jsonrpc: "2.0", method: "notifications/initialized" }, H), d);
  assert.equal(note.status, 202);

  const list = await (await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 3, method: "tools/list" }, H), d)).json();
  const names = list.result.tools.map((x) => x.name);
  assert.ok(names.includes("edit_game") && names.includes("manual_chapter"));
  assert.ok(!names.includes("open_page") && !names.includes("report_problem"), "bez narzędzi przeglądarki");
  const del = list.result.tools.find((x) => x.name === "delete_game");
  assert.equal(del.annotations.destructiveHint, true);
  assert.equal(list.result.tools.find((x) => x.name === "list_games").annotations.readOnlyHint, true);

  const call = await (await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_games", arguments: {} } }, H), d)).json();
  assert.equal(call.result.isError, false);
  assert.equal(JSON.parse(call.result.content[0].text).games[0].name, "Gra");

  await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "edit_game", arguments: { game_id: "g1", operations: [{ op: "rename", name: "X" }] } } }, H), d);
  const [fn, args] = d.db.calls.at(-1);
  assert.equal(fn, "game_content_apply");
  assert.equal(args.p_tab_id, "mcp:t1", "osobna „karta” serwera — edytor otwarty w przeglądarce blokuje zmianę");

  const browserOnly = await (await handleHttp(post("/mcp", { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "open_page", arguments: { page: "games" } } }, H), d)).json();
  assert.equal(browserOnly.error.code, -32602);
});

test("Wskazówki z plików strony i maile zaproszeń do ankiety", async () => {
  const meta = parseExportDefault(fs.readFileSync(new URL("../../web/manual/content/meta/pl.js", import.meta.url), "utf8"));
  assert.ok(meta.chapters.some((c) => c.id === "5"));
  const chapter = parseExportDefault(fs.readFileSync(new URL("../../web/manual/content/chapters/pl/5.js", import.meta.url), "utf8"));
  assert.match(chapter, /Asystent AI/);

  const sent = [];
  const db = fakeDb();
  const env = serverToolEnv({
    db, jwt: "jwt", userId: "u1", tokenId: "t1", lang: "pl", site: SITE, supabaseUrl: "https://api.x",
    fetchImpl: async (url, opts) => { sent.push([url, JSON.parse(opts.body), opts.headers.authorization]); return new Response(JSON.stringify({ ok: true, results: [{ token: "abc", ok: true, queued: true }] })); },
  });
  const res = await env.sendPollMails([{ link: `${SITE}/go/?t=ABC`, task_id: "task1" }]);
  assert.deepEqual(res, { total: 1, sent: 1, failed: 0, skipped: 0 });
  assert.equal(sent[0][0], "https://api.x/functions/v1/send-mail");
  assert.equal(sent[0][2], "Bearer jwt");
  assert.deepEqual(sent[0][1].items, [{ action: "poll:share", token: "abc", reminder: false }]);
  assert.deepEqual(db.calls.at(-1), ["polls_hub_tasks_mark_emailed", { p_task_ids: ["task1"] }]);
});

test("kopie z serwera MCP: Worker strony z JWT użytkownika, mail kopii przez send-mail", async () => {
  const sent = [];
  const env = serverToolEnv({
    db: fakeDb(), jwt: "jwt", userId: "u1", tokenId: "t1", lang: "en", site: SITE, supabaseUrl: "https://api.x",
    fetchImpl: async (url, opts) => { sent.push([url, opts.headers.authorization, JSON.parse(opts.body)]); return new Response(JSON.stringify({ ok: true, results: [{ queued: true }] })); },
  });
  await env.resourceAction("send", { kind: "game", source_id: "g" });
  assert.deepEqual(sent[0], [`${SITE}/_api/resource-send`, "Bearer jwt", { kind: "game", source_id: "g" }]);
  assert.equal(await env.sendNotificationMail({ action: "copy:send", token: "c" }), true);
  assert.deepEqual(sent[1][2], { lang: "en", items: [{ action: "copy:send", token: "c" }] });
});
