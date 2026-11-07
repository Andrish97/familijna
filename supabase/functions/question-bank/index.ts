import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { timingSafeEqual } from "../_shared/internal-auth.ts";

const MODEL = "paraphrase-multilingual-minilm-l12-v2-qa-v1";
const ACTIONS = new Set(["overview", "collect", "control", "create", "publish", "unpublish", "delete", "update_question", "disassemble"]);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

serve(async request => {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const key = (Deno.env.get("LEAD_FINDER_API_KEY") || "").trim();
  if (!key) return json({ ok: false, error: "question_bank_not_configured" }, 503);
  if (!timingSafeEqual(request.headers.get("x-internal-secret") || "", key)) return json({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_body" }, 400);
  try {
    if (body.action === "embed") {
      if (!Array.isArray(body.texts) || body.texts.length < 1 || body.texts.length > 32 || body.texts.some(t => typeof t !== "string" || !t.trim() || t.length > 4000))
        return json({ ok: false, error: "invalid_texts" }, 400);
      const origin = (Deno.env.get("MARKET_SEMANTIC_URL") || "").replace(/\/+$/, "");
      const token = Deno.env.get("MARKET_SEMANTIC_TOKEN") || Deno.env.get("GENERATE_GAME_SECRET") || "";
      if (!origin || !token) return json({ ok: false, error: "semantic_not_configured" }, 503);
      const response = await fetch(origin + "/embed", { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Secret": token },
        body: JSON.stringify({ model: MODEL, texts: body.texts }), signal: AbortSignal.timeout(45000) });
      if (!response.ok) return json({ ok: false, error: "semantic_unavailable" }, 503);
      return json(await response.json());
    }
    if (!ACTIONS.has(String(body.action))) return json({ ok: false, error: "unknown_action" }, 404);
    if (!["pl", "en", "uk"].includes(String(body.lang))) return json({ ok: false, error: "invalid_language" }, 400);
    // Pytania obsługuje osobny kontener (podział: familijna-server/docs/wyszukiwarka-podzial-plan.md).
    const origin = (Deno.env.get("QUESTION_FINDER_URL") || "http://familijna-question-finder:8001").replace(/\/+$/, "");
    const { action, ...params } = body;
    const response = await fetch(origin + "/api/questions/" + action, { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify(params), signal: AbortSignal.timeout(action === "create" || action === "disassemble" ? 180000 : 20000) });
    const data = await response.json();
    return json(data, response.status);
  } catch { return json({ ok: false, error: "Usługa pytań jest chwilowo niedostępna. Odśwież stan przed ponowieniem zapisu." }, 502); }
});
