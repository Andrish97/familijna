// E30 (decyzja 34): którzy dostawcy AI pozwalają na zapytania prosto ze strony
// (CORS) — czat Familijnej łączy się z dostawcą z przeglądarki, bez serwera.
// Diagnostyka: wysyła tylko zapytanie wstępne OPTIONS (bez klucza) i wypisuje
// wynik jako [e2e-diag]. Nie wymaga kont ani bazy. Zielony zawsze — wynik czyta agent.
import { test } from "@playwright/test";

const ORIGIN = "https://www.familijna.app";
const BEARER = "authorization,content-type";
const PROVIDERS = [
  ["openai", "https://api.openai.com/v1/chat/completions", BEARER],
  ["anthropic", "https://api.anthropic.com/v1/messages", "x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,content-type"],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent", "x-goog-api-key,content-type"],
  ["openrouter", "https://openrouter.ai/api/v1/chat/completions", BEARER],
  ["openrouter-auth", "https://openrouter.ai/api/v1/auth/keys", "content-type"],
  ["deepseek", "https://api.deepseek.com/v1/chat/completions", BEARER],
  ["mistral", "https://api.mistral.ai/v1/chat/completions", BEARER],
  ["xai", "https://api.x.ai/v1/chat/completions", BEARER],
  ["groq", "https://api.groq.com/openai/v1/chat/completions", BEARER],
  ["cerebras", "https://api.cerebras.ai/v1/chat/completions", BEARER],
  ["together", "https://api.together.xyz/v1/chat/completions", BEARER],
  ["fireworks", "https://api.fireworks.ai/inference/v1/chat/completions", BEARER],
  ["github-models", "https://models.github.ai/inference/chat/completions", BEARER],
  ["nvidia", "https://integrate.api.nvidia.com/v1/chat/completions", BEARER],
  ["sambanova", "https://api.sambanova.ai/v1/chat/completions", BEARER],
  ["huggingface", "https://router.huggingface.co/v1/chat/completions", BEARER],
  ["moonshot", "https://api.moonshot.ai/v1/chat/completions", BEARER],
  ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions", BEARER],
  ["zai", "https://api.z.ai/api/paas/v4/chat/completions", BEARER],
  ["perplexity", "https://api.perplexity.ai/chat/completions", BEARER],
  ["cohere", "https://api.cohere.ai/compatibility/v1/chat/completions", BEARER],
  ["novita", "https://api.novita.ai/v3/openai/chat/completions", BEARER],
  ["hyperbolic", "https://api.hyperbolic.xyz/v1/chat/completions", BEARER],
  ["inference-net", "https://api.inference.net/v1/chat/completions", BEARER],
  ["ai21", "https://api.ai21.com/studio/v1/chat/completions", BEARER],
  ["llama", "https://api.llama.com/compat/v1/chat/completions", BEARER],
  ["minimax", "https://api.minimax.io/v1/text/chatcompletion_v2", BEARER],
  ["nebius", "https://api.studio.nebius.com/v1/chat/completions", BEARER],
  ["deepinfra", "https://api.deepinfra.com/v1/openai/chat/completions", BEARER],
  ["chutes", "https://llm.chutes.ai/v1/chat/completions", BEARER],
  ["requesty", "https://router.requesty.ai/v1/chat/completions", BEARER],
  ["vercel-ai-gateway", "https://ai-gateway.vercel.sh/v1/chat/completions", BEARER],
  ["pollinations", "https://text.pollinations.ai/openai", "content-type"],
];

test("dostawcy AI: CORS z familijna.app (diagnostyka)", async () => {
  test.setTimeout(120_000);
  const rows = await Promise.all(PROVIDERS.map(async ([id, url, headers]) => {
    try {
      const res = await fetch(url, {
        method: "OPTIONS",
        headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": headers },
        signal: AbortSignal.timeout(15_000),
      });
      const allowOrigin = res.headers.get("access-control-allow-origin") || "";
      const allowHeaders = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
      const originOk = allowOrigin === "*" || allowOrigin === ORIGIN;
      const headersOk = allowHeaders === "*" || headers.split(",").every((h) => allowHeaders.includes(h));
      return `${id}: status=${res.status} origin=${originOk ? "tak" : "nie"} headers=${headersOk ? "tak" : allowHeaders ? "częściowo" : "nie"}`;
    } catch (e) {
      return `${id}: błąd=${String(e?.cause?.code || e?.name || e).slice(0, 40)}`;
    }
  }));
  for (const r of rows) console.log(`[e2e-diag] cors ${r}`);
});
