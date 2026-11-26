// E30: dostawcy AI dla czatu na kluczu użytkownika (wzór: Makietka,
// js/ai-dostawcy.js). Zapytania idą prosto z przeglądarki do dostawcy —
// nie przez serwery Familijnej. Trzy rodzaje API: Anthropic Messages,
// Google Gemini generateContent i API zgodne z OpenAI (Chat Completions:
// OpenAI, DeepSeek, Mistral, xAI, OpenRouter). Narzędzia (katalog w
// tools/) każdy dostawca dostaje w swoim formacie.
// Rozmowa trzyma historię w formacie swojego dostawcy — zmiana dostawcy
// zaczyna nową rozmowę.
// Adresy dostawców muszą być w connect-src CSP (Worker, security-headers.js).
import { t } from "../../translation/translation.js";

export const PROVIDERS = {
  anthropic: { label: "Anthropic (Claude)", kind: "anthropic", base: "https://api.anthropic.com/v1", keyUrl: "https://console.anthropic.com/settings/keys" },
  openai: { label: "OpenAI (ChatGPT)", kind: "openai", base: "https://api.openai.com/v1", keyUrl: "https://platform.openai.com/api-keys" },
  gemini: { label: "Google Gemini", kind: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", keyUrl: "https://aistudio.google.com/apikey" },
  deepseek: { label: "DeepSeek", kind: "openai", base: "https://api.deepseek.com/v1", keyUrl: "https://platform.deepseek.com/api_keys" },
  mistral: { label: "Mistral", kind: "openai", base: "https://api.mistral.ai/v1", keyUrl: "https://console.mistral.ai/api-keys" },
  xai: { label: "xAI (Grok)", kind: "openai", base: "https://api.x.ai/v1", keyUrl: "https://console.x.ai" },
  openrouter: { label: "OpenRouter", kind: "openai", base: "https://openrouter.ai/api/v1", keyUrl: "https://openrouter.ai/keys" },
};

const MAX_TOKENS = 8000;

/** Błąd dostawcy: status HTTP (0 = brak połączenia), kod i komunikat dla użytkownika. */
export class ProviderError extends Error {
  constructor(status, detail = "") {
    const d = String(detail || "");
    const code = errorCode(status, d);
    super(t(`aiChat.errors.${code}`, { status }));
    this.status = status;
    this.code = code;
    this.detail = d.slice(0, 300);
  }
}

export function errorCode(status, detail = "") {
  if (status === -1) return "refused";
  if (status === 0) return "offline";
  if (status === 401 || status === 403) return "badKey";
  if (status === 402 || /insufficient|credit|balance|billing|quota|payment/i.test(detail)) return "noFunds";
  if (status === 429) return "rateLimit";
  if (status === 400 && /tool|function.?call/i.test(detail)) return "noTools";
  if (status === 404 || (status === 400 && /model/i.test(detail))) return "noModel";
  if ([500, 502, 503, 504, 529].includes(status) || /overload/i.test(detail)) return "overloaded";
  return "other";
}

// Przeciążenie i chwilowe awarie: dwie kolejne próby (1,5 s i 4 s albo
// Retry-After do 10 s). Brak środków nie jest ponawiany.
const RETRY_MS = [1500, 4000];
const RETRY_STATUS = new Set([429, 500, 502, 503, 504, 529]);
export const timing = { sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

async function request(url, options) {
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try { res = await fetch(url, options); } catch (e) {
      if (e?.name === "AbortError") throw e;
      throw new ProviderError(0);
    }
    if (res.ok) return res;
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* odpowiedź nie-JSON */ }
    const detail = data?.error?.message || data?.message || text.slice(0, 300) || res.statusText;
    const noFunds = res.status === 402 || /insufficient|credit|balance|billing|quota/i.test(detail);
    if (RETRY_STATUS.has(res.status) && !noFunds && attempt < RETRY_MS.length) {
      const after = Number(res.headers?.get?.("retry-after"));
      await timing.sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10000) : RETRY_MS[attempt]);
      continue;
    }
    throw new ProviderError(res.status, detail);
  }
}

async function requestJson(url, options) {
  const text = await (await request(url, options)).text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

// Zdarzenia SSE jako obiekty JSON.
export async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
    const parts = buf.split(/\r?\n\r?\n/);
    buf = done ? "" : parts.pop();
    for (const p of parts) {
      const data = p.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data); } catch { /* niepełne albo obce zdarzenie */ }
    }
    if (done) return;
  }
}

const anthropicHeaders = (key) => ({
  "content-type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  // Wywołanie z przeglądarki użytkownika, jego własnym kluczem.
  "anthropic-dangerous-direct-browser-access": "true",
});

/** Lista modeli dostawcy (do wyboru w ustawieniach). */
export async function listModels(providerId, key) {
  const p = PROVIDERS[providerId];
  if (!p || !key) return [];
  if (p.kind === "anthropic") {
    const w = await requestJson(`${p.base}/models?limit=100`, { headers: anthropicHeaders(key) });
    return (w?.data || []).map((m) => m.id);
  }
  if (p.kind === "gemini") {
    const w = await requestJson(`${p.base}/models?pageSize=200&key=${encodeURIComponent(key)}`, {});
    return (w?.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((m) => !/(image|imagen|tts|audio|live|lyria|banana|embedding|aqa)/i.test(m));
  }
  const w = await requestJson(`${p.base}/models`, { headers: { authorization: `Bearer ${key}` } });
  return (w?.data || []).map((m) => m.id).sort();
}

// Zalecany model z listy dostawcy (szybki i rozsądny), po wzorcach nazw;
// najnowsza wersja, bez wersji próbnych.
const RECOMMENDED = {
  anthropic: [/sonnet/],
  gemini: [/flash(?!-lite)/],
  openai: [/^gpt-[\d.]+-mini$/, /^gpt-.*mini/],
  deepseek: [/deepseek-chat/],
  mistral: [/mistral-medium-latest/, /medium/],
  xai: [/grok.*(fast|mini)/, /grok/],
  openrouter: [/^google\/gemini-[\d.]+-flash$/, /gemini.*flash(?!-lite)/],
};
const version = (m) => { const v = String(m).match(/(\d+(?:\.\d+)?)/); return v ? parseFloat(v[1]) : 0; };
const preview = (m) => /preview|exp|latest-|\d{4}-?\d{2}-?\d{2}|thinking|search|vision|audio|realtime|transcribe|codex|instruct/i.test(m) && !/-latest$/.test(m);
export function recommendedModel(providerId, models = []) {
  for (const re of RECOMMENDED[providerId] || []) {
    const hits = models.filter((m) => re.test(m));
    const stable = hits.filter((m) => !preview(m));
    const list = (stable.length ? stable : hits).sort((a, b) => version(b) - version(a) || a.length - b.length);
    if (list.length) return list[0];
  }
  return models[0] || "";
}

// Schemat narzędzia dla Gemini: tylko pola, które Gemini przyjmuje.
export function geminiSchema(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(geminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (["type", "description", "enum", "required", "nullable", "format"].includes(k)) out[k] = v;
    else if (k === "properties") out.properties = Object.fromEntries(Object.entries(v || {}).map(([n, x]) => [n, geminiSchema(x)]));
    else if (k === "items") out.items = geminiSchema(v);
  }
  if (Array.isArray(out.type)) out.type = out.type.find((x) => x !== "null") || "string";
  if (out.format && !["enum", "date-time"].includes(out.format)) delete out.format;
  if (out.type === "object" && !out.properties) out.properties = {};
  // Gemini przyjmuje „enum” tylko przy tekście — lista liczb idzie do opisu.
  if (out.enum && (out.type !== "string" || out.enum.some((x) => typeof x !== "string"))) {
    out.description = `${out.description ? `${out.description} ` : ""}(${out.enum.join(" | ")})`;
    delete out.enum;
  }
  return out;
}

/**
 * Nowa rozmowa. tools: [{ name, description, inputSchema }].
 * history — zapisana historia (format dostawcy) przy wznowieniu.
 */
export function createConversation({ provider, model, key, system, tools, history = [] }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider: ${provider}`);
  return { provider, kind: p.kind, base: p.base, key, model, system, tools, history };
}

export function userMessage(kind, text) {
  if (kind === "gemini") return { role: "user", parts: [{ text }] };
  return { role: "user", content: text };
}

// Jeden krok modelu ze strumieniem: tekst idzie do onText(fragment) na
// bieżąco; wynik { text, calls: [{ id, name, args }] }, odpowiedź trafia do historii.
async function step(c, onText, signal) {
  if (c.kind === "anthropic") {
    const res = await request(`${c.base}/messages`, {
      method: "POST", headers: anthropicHeaders(c.key), signal,
      body: JSON.stringify({
        // cache_control: stały początek (narzędzia + prompt) liczony taniej przy kolejnych krokach (decyzja 28)
        model: c.model, max_tokens: MAX_TOKENS, messages: c.history, stream: true,
        system: [{ type: "text", text: c.system, cache_control: { type: "ephemeral" } }],
        tools: c.tools.map((x, i, all) => ({
          name: x.name, description: x.description, input_schema: x.inputSchema,
          ...(i === all.length - 1 ? { cache_control: { type: "ephemeral" } } : {}),
        })),
      }),
    });
    const blocks = [];
    const json = [];
    let stop = "";
    for await (const z of sseEvents(res)) {
      if (z.type === "error") throw new ProviderError(/overload/i.test(z.error?.type || "") ? 529 : 500, z.error?.message);
      if (z.type === "content_block_start") { blocks[z.index] = { ...z.content_block }; if (z.content_block.type === "tool_use") json[z.index] = ""; }
      if (z.type === "content_block_delta") {
        const b = blocks[z.index];
        const d = z.delta || {};
        if (d.type === "text_delta") { b.text = (b.text || "") + d.text; onText(d.text); }
        if (d.type === "input_json_delta") json[z.index] += d.partial_json;
        if (d.type === "thinking_delta") b.thinking = (b.thinking || "") + d.thinking;
        if (d.type === "signature_delta") b.signature = (b.signature || "") + d.signature;
      }
      if (z.type === "content_block_stop" && blocks[z.index]?.type === "tool_use") {
        try { blocks[z.index].input = json[z.index] ? JSON.parse(json[z.index]) : {}; } catch { blocks[z.index].input = {}; }
      }
      if (z.type === "message_delta" && z.delta?.stop_reason) stop = z.delta.stop_reason;
    }
    if (stop === "refusal") throw new ProviderError(-1, "refusal");
    const content = blocks.filter(Boolean);
    c.history.push({ role: "assistant", content });
    return {
      text: content.filter((b) => b.type === "text").map((b) => b.text).join("\n"),
      calls: content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, args: b.input || {} })),
    };
  }
  if (c.kind === "gemini") {
    const res = await request(`${c.base}/models/${encodeURIComponent(c.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(c.key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: c.system }] }, contents: c.history,
        tools: [{ functionDeclarations: c.tools.map((x) => ({ name: x.name, description: x.description, parameters: geminiSchema(x.inputSchema) })) }],
      }),
    });
    const parts = [];
    for await (const z of sseEvents(res)) {
      for (const p of z?.candidates?.[0]?.content?.parts || []) {
        if (p.text && !p.thought && parts.at(-1)?.text !== undefined && !parts.at(-1).thought) { parts.at(-1).text += p.text; onText(p.text); }
        else { parts.push({ ...p }); if (p.text && !p.thought) onText(p.text); }
      }
    }
    c.history.push({ role: "model", parts });
    return {
      text: parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n"),
      calls: parts.filter((p) => p.functionCall).map((p, i) => ({ id: `g${i}`, name: p.functionCall.name, args: p.functionCall.args || {} })),
    };
  }
  const res = await request(`${c.base}/chat/completions`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${c.key}` }, signal,
    body: JSON.stringify({
      model: c.model, messages: [{ role: "system", content: c.system }, ...c.history], stream: true,
      tools: c.tools.map((x) => ({ type: "function", function: { name: x.name, description: x.description, parameters: x.inputSchema } })),
    }),
  });
  let text = "";
  const calls = [];
  for await (const z of sseEvents(res)) {
    if (z.error) throw new ProviderError(z.error.code === 429 ? 429 : 500, z.error.message);
    const d = z?.choices?.[0]?.delta || {};
    if (typeof d.content === "string" && d.content) { text += d.content; onText(d.content); }
    for (const tc of d.tool_calls || []) {
      const w = calls[tc.index ?? calls.length] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
      if (tc.id) w.id = tc.id;
      if (tc.function?.name) w.function.name += tc.function.name;
      if (tc.function?.arguments) w.function.arguments += tc.function.arguments;
    }
  }
  const tool = calls.filter(Boolean);
  c.history.push({ role: "assistant", content: text, ...(tool.length ? { tool_calls: tool } : {}) });
  return {
    text,
    calls: tool.map((x) => {
      let args = {};
      try { args = x.function.arguments ? JSON.parse(x.function.arguments) : {}; } catch { args = {}; }
      return { id: x.id, name: x.function.name, args };
    }),
  };
}

// Wyniki narzędzi do historii — wszystkie razem, w formacie dostawcy.
function pushResults(c, results) {
  if (c.kind === "anthropic") {
    c.history.push({ role: "user", content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.text, ...(r.error ? { is_error: true } : {}) })) });
  } else if (c.kind === "gemini") {
    c.history.push({ role: "user", parts: results.map((r) => ({ functionResponse: { name: r.name, response: { result: r.text, ...(r.error ? { error: true } : {}) } } })) });
  } else {
    for (const r of results) c.history.push({ role: "tool", tool_call_id: r.id, content: r.text });
  }
}

/**
 * Wiadomość użytkownika i pętla narzędzi aż do odpowiedzi.
 * run(name, args) → { text, error? } wykonuje narzędzie (potwierdzenia, blokady — po stronie run).
 * onText(fragment) — tekst odpowiedzi na bieżąco; onStep({ text, calls }) — postęp.
 * signal — AbortSignal (przerwanie przez użytkownika albo przejście na inną stronę).
 */
export function ask(c, text, opts = {}) {
  c.history.push(userMessage(c.kind, text));
  opts.onUserMessage?.(c);
  return resume(c, opts);
}

/**
 * Dalszy ciąg rozmowy bez nowej wiadomości — po odpowiedzi przerwanej
 * przejściem na inną stronę (historia kończy się wiadomością użytkownika
 * albo wynikami narzędzi). Opcje jak w ask.
 */
export async function resume(c, { run, onText = () => {}, onStep = () => {}, signal = null, maxSteps = 25 } = {}) {
  let last = "";
  for (let i = 0; i < maxSteps; i += 1) {
    if (signal?.aborted) return { text: last, stopped: true };
    const s = await step(c, onText, signal);
    onStep(s);
    if (s.text) last = s.text;
    if (!s.calls.length) return { text: last };
    const results = [];
    for (const call of s.calls) {
      let r;
      try { r = await run(call.name, call.args); } catch (e) { r = { text: `Error: ${e?.message || e}`, error: true }; }
      results.push({ id: call.id, name: call.name, ...r });
    }
    pushResults(c, results);
  }
  return { text: last, stopped: true, tooManySteps: true };
}
