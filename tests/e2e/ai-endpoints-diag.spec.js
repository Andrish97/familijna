// E30: diagnostyka funkcji Edge czatu (ai-chat, mcp) na produkcji — bez kont:
// zapytanie wstępne CORS i POST bez logowania (oczekiwane 401 z nagłówkiem
// CORS). Wypisuje [e2e-diag]: status, access-control-allow-origin, początek treści.
import { test } from "@playwright/test";

const API = "https://api.familijna.app";
const ORIGIN = "https://www.familijna.app";

test("funkcje czatu: CORS i odpowiedź bez logowania (diagnostyka)", async () => {
  const calls = [
    ["ai-chat OPTIONS", `${API}/functions/v1/ai-chat`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type,apikey,x-client-info" } }],
    ["ai-chat POST", `${API}/functions/v1/ai-chat`, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json" }, body: "{}" }],
    ["ai-chat POST anon", `${API}/functions/v1/ai-chat`, { method: "POST", headers: { Origin: ORIGIN, "content-type": "application/json", authorization: "Bearer x" }, body: "{}" }],
    ["mcp GET", `${API}/mcp`, { method: "GET", headers: { Origin: ORIGIN } }],
    ["mcp openapi", `${API}/mcp/api/openapi.json`, { method: "GET", headers: { Origin: ORIGIN } }],
    ["send-mail OPTIONS", `${API}/functions/v1/send-mail`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type" } }],
  ];
  for (const [name, url, init] of calls) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      const text = (await res.text()).replace(/\s+/g, " ").slice(0, 200);
      console.log(`[e2e-diag] ${name}: status=${res.status} acao=${res.headers.get("access-control-allow-origin") || "-"} body=${text}`);
    } catch (e) {
      console.log(`[e2e-diag] ${name}: błąd=${String(e?.cause?.code || e?.name || e).slice(0, 60)}`);
    }
  }
});
