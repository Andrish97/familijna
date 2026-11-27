// E30 (decyzja 35): klucz API Familijnej na produkcji — utworzenie (jak okno
// w Ustawieniach konta: mcp_api_key_create), API HTTP /mcp/api (lista narzędzi,
// list_games), łącznik MCP z kluczem w nagłówku, odwołanie → 401.
const { test, expect } = require("./helpers/e2e-test");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const API = "https://api.familijna.app";
const ORIGIN = "https://www.familijna.app";

test("klucz API: HTTP API i MCP z kluczem, po odwołaniu 401", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const created = await page.evaluate(async () => (await window.__sbClient.rpc("mcp_api_key_create", { p_name: `e2e ${Date.now()}` })).data);
  expect(created?.ok, JSON.stringify(created)).toBe(true);
  expect(created.token).toMatch(/^fam_key_[0-9a-f]{64}$/);
  const H = { authorization: `Bearer ${created.token}`, "content-type": "application/json" };
  try {
    const spec = await (await fetch(`${API}/mcp/api/openapi.json`)).json();
    expect(spec.paths["/call"].post.operationId).toBe("callTool");

    const tools = await fetch(`${API}/mcp/api/tools`, { headers: H });
    expect(tools.status).toBe(200);
    expect((await tools.json()).tools.some((x) => x.name === "list_games")).toBe(true);

    const own = await page.evaluate(async () => (await window.__sbClient.from("games").select("id").neq("type", "market")).data.length);
    const call = await fetch(`${API}/mcp/api/call`, { method: "POST", headers: H, body: JSON.stringify({ name: "list_games", arguments: {} }) });
    expect(call.status).toBe(200);
    const games = (await call.json()).games;
    console.log(`[e2e-diag] api-keys list_games=${games?.length} own=${own}`);
    expect(games.length).toBe(own);

    const mcp = await fetch(`${API}/mcp`, { method: "POST", headers: { ...H, "x-api-key": created.token }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    expect(mcp.status).toBe(200);
    expect((await mcp.json()).result.tools.length).toBeGreaterThan(20);
  } finally {
    await page.evaluate(async (id) => window.__sbClient.rpc("mcp_token_revoke", { p_id: id }), created.id);
  }
  const after = await fetch(`${API}/mcp/api/tools`, { headers: H });
  expect(after.status).toBe(401);
});
