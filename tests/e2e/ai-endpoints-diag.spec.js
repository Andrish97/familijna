// E30: diagnostyka funkcji Edge czatu (ai-chat, mcp) na produkcji: zapytanie
// wstępne CORS, POST bez logowania i POST z tokenem konta testowego (jak
// przeglądarka). Wypisuje [e2e-diag]: status, nagłówki CORS, typ, początek treści.
const { test } = require("./helpers/e2e-test");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const API = "https://api.familijna.app";
const ORIGIN = "https://www.familijna.app";

async function probe(name, url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(40_000) });
    const h = res.headers;
    const cors = ["access-control-allow-origin", "access-control-allow-headers", "access-control-expose-headers", "content-type", "x-ai-remaining", "cf-cache-status", "server"]
      .map((k) => `${k}=${h.get(k) ?? "-"}`).join(" ");
    const text = (await res.text()).replace(/\s+/g, " ").slice(0, 240);
    console.log(`[e2e-diag] ${name}: status=${res.status} ${cors} body=${text}`);
  } catch (e) {
    console.log(`[e2e-diag] ${name}: błąd=${String(e?.cause?.code || e?.name || e).slice(0, 60)}`);
  }
}

test("funkcje czatu: CORS i odpowiedź z tokenem konta testowego (diagnostyka)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await probe("ai-chat OPTIONS", `${API}/functions/v1/ai-chat`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } });
  await probe("mcp openapi", `${API}/mcp/api/openapi.json`, { method: "GET", headers: { Origin: ORIGIN } });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const token = await page.evaluate(async () => (await window.__sbClient.auth.getSession()).data.session?.access_token || "");
  const status = await page.evaluate(async () => (await window.__sbClient.rpc("ai_quota_status")).data);
  console.log(`[e2e-diag] quota visible=${status?.visible} enabled=${status?.enabled} remaining=${status?.remaining}`);
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Odpowiedz jednym słowem: tak" }] }], page: "games" });
  await probe("ai-chat POST token", `${API}/functions/v1/ai-chat`, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json", authorization: `Bearer ${token}` }, body });
  // to samo z przeglądarki (CORS liczy przeglądarka)
  const inBrowser = await page.evaluate(async ([url, b, tk]) => {
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tk}` }, body: b });
      return `status=${r.status} type=${r.headers.get("content-type")} body=${(await r.text()).replace(/\s+/g, " ").slice(0, 200)}`;
    } catch (e) { return `błąd=${String(e?.message || e)}`; }
  }, [`${API}/functions/v1/ai-chat`, body, token]);
  console.log(`[e2e-diag] ai-chat z przeglądarki: ${inBrowser}`);
});
