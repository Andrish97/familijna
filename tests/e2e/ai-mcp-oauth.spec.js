// E30 (decyzja 19): łącznik MCP na produkcji tak, jak robi to Claude/ChatGPT —
// rejestracja klienta (DCR), PKCE S256, zgoda w oknie Ustawień konta, wymiana
// kodu na token fam_mcp_…, initialize / tools/list / tools/call (list_games),
// odłączenie w Ustawieniach (mcp_token_revoke) → 401.
const crypto = require("node:crypto");
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const API = "https://api.familijna.app";
const ORIGIN = "https://www.familijna.app";
const REDIRECT = "http://localhost:8976/callback";
const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("łącznik MCP: OAuth z PKCE, zgoda w Ustawieniach konta, narzędzia, odłączenie", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(150_000);
  const clientName = `E2E klient ${Date.now()}`;
  const reg = await fetch(`${API}/mcp/oauth/register`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: clientName, redirect_uris: [REDIRECT] }),
  });
  expect(reg.status).toBe(201);
  const { client_id: clientId } = await reg.json();

  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = `st${Date.now()}`;
  const auth = await fetch(`${API}/mcp/oauth/authorize?${new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state,
  })}`, { redirect: "manual" });
  expect(auth.status).toBe(302);
  const loginUrl = new URL(auth.headers.get("location"));
  const requestId = loginUrl.searchParams.get("ai");
  expect(requestId).toMatch(/^[0-9a-f-]{36}$/);

  // zgoda: zalogowany użytkownik w Ustawieniach konta (?ai=…) wybiera „Zezwól”
  await serveBranchCode(context, { pages: ["account"] });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const own = await page.evaluate(async () => (await window.__sbClient.from("games").select("id").neq("type", "market")).data.length);
  let callback = null;
  await context.route(`${REDIRECT}**`, (route) => { callback = route.request().url(); return route.fulfill({ status: 200, body: "ok" }); });
  await page.goto(`${ORIGIN}/account/?ai=${requestId}`, { waitUntil: "domcontentloaded" });
  const consent = page.locator(".uni-modal", { hasText: clientName });
  await expect(consent).toBeVisible({ timeout: 20000 });
  await consent.locator(".uni-foot .btn.gold").click();
  await expect.poll(() => callback, { timeout: 20000 }).not.toBeNull();
  const back = new URL(callback);
  expect(back.searchParams.get("state")).toBe(state);
  const code = back.searchParams.get("code");
  expect(code).toBeTruthy();

  const tok = await fetch(`${API}/mcp/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }),
  });
  expect(tok.status).toBe(200);
  const { access_token: token } = await tok.json();
  expect(token).toMatch(/^fam_mcp_[0-9a-f]{64}$/);
  // kod jednorazowy
  const again = await fetch(`${API}/mcp/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }),
  });
  expect(again.status).toBe(400);

  const rpc = async (id, method, params = {}) => fetch(`${API}/mcp`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const init = await (await rpc(1, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } })).json();
  expect(init.result.serverInfo.name).toBe("familijna");
  const list = await (await rpc(2, "tools/list")).json();
  expect(list.result.tools.some((x) => x.name === "list_games")).toBe(true);
  const call = await (await rpc(3, "tools/call", { name: "list_games", arguments: {} })).json();
  expect(call.result.isError).toBe(false);
  expect(JSON.parse(call.result.content[0].text).games.length).toBe(own);
  console.log(`[e2e-diag] mcp-oauth tools=${list.result.tools.length} list_games=${own}`);

  // odłączenie w Ustawieniach konta (po zgodzie strona przeszła na adres klienta)
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const tokens = await page.evaluate(async () => (await window.__sbClient.rpc("mcp_tokens_mine")).data?.tokens || []);
  const mine = tokens.find((x) => x.client_name === clientName);
  expect(mine).toBeTruthy();
  await page.evaluate(async (id) => window.__sbClient.rpc("mcp_token_revoke", { p_id: id }), mine.id);
  expect((await rpc(4, "tools/list")).status).toBe(401);
});
