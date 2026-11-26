// E30 (decyzje 25–30): wbudowany czat na kluczu Familijnej. Rdzeń funkcji
// Edge ai-chat — czysty JS, testowany w Node (unit/aiBuiltin.test.js).
//
// Przeglądarka wysyła tylko rozmowę (contents w formacie Gemini) i stronę.
// Prompt systemowy i narzędzia dokłada serwer z tej samej kopii co przeglądarka
// (ai-tools/: prompt.js, index.js, gemini-schema.js) — klucza nie da się użyć
// jako ogólnego czatu, a początek zapytania jest stały (cache, decyzja 28).
// Limity: ai_quota_take (migracja 538) — nowa wiadomość albo kolejny krok
// narzędzi. Narzędzia wykonuje dalej przeglądarka — funkcja nie ma żadnych
// uprawnień w bazie poza liczeniem limitów.
import { systemPrompt } from "./ai-tools/prompt.js";
import { geminiSchema } from "./ai-tools/gemini-schema.js";
import { toolsForPage } from "./ai-tools/index.js";

export const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const MAX_BODY = 400_000;
export const MAX_OUTPUT_TOKENS = 2048;
const RETRY_MS = 1500;

export const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-expose-headers": "x-ai-remaining, x-ai-daily, x-ai-reset-at",
};

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "content-type": "application/json", "cache-control": "no-store", ...headers },
});
// Błąd w kształcie odpowiedzi Google ({ error: { message } }) — przeglądarka
// czyta go tak samo jak błąd dostawcy (providers.js request()).
const fail = (status, code, extra = {}) => json(status, { error: { code: status, message: `familijna_limit:${code}`, ...extra } });

/** Czy ostatnia wiadomość to nowy tekst użytkownika (a nie wyniki narzędzi). */
export function isNewMessage(contents) {
  const last = contents.at(-1);
  if (last?.role !== "user") return false;
  const parts = Array.isArray(last.parts) ? last.parts : [];
  return parts.some((p) => typeof p?.text === "string") && !parts.some((p) => p?.functionResponse);
}

/** Treść zapytania do Gemini — stały początek (prompt, narzędzia), potem rozmowa. */
export function geminiBody(contents, page) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    tools: [{ functionDeclarations: toolsForPage(page).map((x) => ({ name: x.name, description: x.description, parameters: geminiSchema(x.inputSchema) })) }],
    contents,
    generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
  };
}

/**
 * deps: { userOf(token) → userId|null, quotaTake(userId, newMessage) → wynik
 * ai_quota_take, apiKey, fetchImpl, sleep(ms) }.
 */
export async function handleChat(request, deps) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json(405, { error: { message: "method_not_allowed" } });
  if (!deps.apiKey) return fail(503, "disabled");

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const userId = token ? await deps.userOf(token) : null;
  if (!userId) return json(401, { error: { code: 401, message: "not_authenticated" } });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json(413, { error: { code: 413, message: "conversation_too_long" } });
  let body;
  try { body = JSON.parse(raw); } catch { body = null; }
  const contents = Array.isArray(body?.contents) ? body.contents : null;
  if (!contents?.length || contents.some((c) => !["user", "model"].includes(c?.role) || !Array.isArray(c?.parts))) {
    return json(400, { error: { code: 400, message: "invalid_conversation" } });
  }
  if (contents.at(-1).role !== "user") return json(400, { error: { code: 400, message: "invalid_conversation" } });
  const page = typeof body.page === "string" ? body.page.slice(0, 40) : null;

  const quota = await deps.quotaTake(userId, isNewMessage(contents));
  if (!quota?.ok) {
    const code = quota?.error || "disabled";
    const status = ["daily_limit", "minute_limit", "step_limit", "global_limit"].includes(code) ? 429 : code === "not_registered" ? 403 : 503;
    return fail(status, code, { daily: quota?.daily, reset_at: quota?.reset_at, per_minute: quota?.per_minute, max_steps: quota?.max_steps });
  }

  const url = `${GEMINI_BASE}/models/${encodeURIComponent(quota.model)}:streamGenerateContent?alt=sse`;
  const init = {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": deps.apiKey },
    body: JSON.stringify(geminiBody(contents, page)),
  };
  let upstream = await deps.fetchImpl(url, init);
  // chwilowe przeciążenie Google: jedna ponowna próba (decyzja 29 — bez drugiego klucza)
  if ([429, 500, 502, 503, 504].includes(upstream.status)) {
    await deps.sleep(RETRY_MS);
    upstream = await deps.fetchImpl(url, init);
  }
  if (!upstream.ok) {
    // Komunikat Google (bez klucza). Nigdy 502/504: Cloudflare podmienia je na
    // własną stronę błędu bez CORS — przeglądarka widzi wtedy tylko „CORS”.
    const raw = await upstream.text().catch(() => "");
    let detail = raw.slice(0, 300);
    try { detail = JSON.parse(raw)?.error?.message?.slice(0, 300) || detail; } catch { /* tekst */ }
    console.error(`[ai-chat] gemini ${upstream.status}: ${detail}`);
    const status = upstream.status === 429 || upstream.status >= 500 ? 503 : 500;
    return json(status, { error: { code: status, message: `${status === 503 ? "overloaded" : `upstream_${upstream.status}`}: ${detail}` } });
  }
  return new Response(upstream.body, {
    status: 200,
    headers: {
      ...CORS, "content-type": "text/event-stream", "cache-control": "no-store",
      "x-ai-remaining": String(quota.remaining ?? ""), "x-ai-daily": String(quota.daily ?? ""), "x-ai-reset-at": String(quota.reset_at ?? ""),
    },
  });
}
