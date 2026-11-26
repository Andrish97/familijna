// E30: rozmowa czatu AI — prompt systemowy, narzędzia z katalogu dla bieżącej
// strony i ich wykonywanie z potwierdzeniem (wysyłka do innych osób, zmiany
// nieodwracalne — decyzja 11). Bez interfejsu: panel czatu podaje ctx.
import { createConversation, ask, resume } from "./providers.js";
import { systemPrompt, contextLine, withoutContext, LANG_NAMES } from "./tools/prompt.js";
import { toolsForPage, toolByName } from "./tools/index.js";

const RESULT_MAX = 20000;

/**
 * Wykonanie narzędzia dla modelu. ctx: { lang, pageId, confirm({ kind, tool, args }) → Promise<boolean>,
 * navigate(href), changed({ type, id }) }. Wynik { text, error } dla providers.ask.
 */
export async function runTool(name, args, ctx) {
  const tool = toolByName(name);
  const allowed = toolsForPage(ctx.pageId).includes(tool);
  if (!tool || !allowed) return { text: JSON.stringify({ error: "tool_not_available_here" }), error: true };
  const kind = typeof tool.confirm === "function" ? tool.confirm(args || {}) : null;
  if (kind && !(await ctx.confirm({ kind, tool: name, args: args || {} }))) {
    return { text: JSON.stringify({ error: "declined_by_user" }), error: true };
  }
  let result;
  try {
    result = await tool.run(args || {}, ctx);
  } catch (e) {
    result = { ok: false, error: e?.code && e.code !== e?.message ? `${e.code}: ${e.message}` : String(e?.message || e) };
  }
  const failed = !!result?.error || result?.ok === false;
  let text = JSON.stringify(result ?? {});
  if (text.length > RESULT_MAX) text = `${text.slice(0, RESULT_MAX)}…(truncated)`;
  return { text, error: failed };
}

export { systemPrompt, contextLine, withoutContext, LANG_NAMES };

/** Nowa (albo wznowiona — history) rozmowa dla strony. */
export function startConversation({ provider, model, key, lang, pageId, history = [] }) {
  const tools = toolsForPage(pageId).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  const c = createConversation({ provider, model, key, system: systemPrompt(), tools, history });
  c.page = pageId;
  return c;
}

/** Wiadomość użytkownika z pętlą narzędzi; zwraca { text, stopped? }. */
export function sendMessage(conversation, text, ctx, { onText, onStep, signal, onUserMessage } = {}) {
  return ask(conversation, `${text}\n\n${contextLine(ctx)}`, { run: (name, args) => runTool(name, args, ctx), onText, onStep, signal, onUserMessage });
}

/** Dokończenie odpowiedzi przerwanej przejściem na inną stronę. */
export function continueReply(conversation, ctx, { onText, onStep, signal } = {}) {
  return resume(conversation, { run: (name, args) => runTool(name, args, ctx), onText, onStep, signal });
}

/** Czy historia czeka na odpowiedź modelu (ostatnia wiadomość od użytkownika albo wyniki narzędzi). */
export function awaitingReply(kind, history) {
  const last = history?.at(-1);
  if (!last) return false;
  if (kind === "openai") return last.role === "user" || last.role === "tool";
  return last.role === "user";
}

const textOf = (content) => (typeof content === "string" ? content
  : Array.isArray(content) ? content.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "");

/**
 * Historia dostawcy jako wpisy do pokazania: { role: "user"|"assistant"|"tool", text, tool? }.
 * Wyniki narzędzi pomijamy (model streszcza je w odpowiedzi).
 */
export function displayItems(kind, history) {
  const out = [];
  for (const m of history || []) {
    if (kind === "gemini") {
      const parts = m.parts || [];
      const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n");
      if (m.role === "user" && !parts.some((p) => p.functionResponse) && text) out.push({ role: "user", text: withoutContext(text) });
      if (m.role === "model") {
        for (const p of parts) if (p.functionCall) out.push({ role: "tool", tool: p.functionCall.name });
        if (text) out.push({ role: "assistant", text });
      }
      continue;
    }
    if (m.role === "user") {
      if (Array.isArray(m.content) && m.content.some((b) => b?.type === "tool_result")) continue;
      const text = withoutContext(textOf(m.content));
      if (text) out.push({ role: "user", text });
    } else if (m.role === "assistant") {
      const calls = kind === "anthropic"
        ? (Array.isArray(m.content) ? m.content.filter((b) => b?.type === "tool_use").map((b) => b.name) : [])
        : (m.tool_calls || []).map((c) => c.function?.name);
      for (const tool of calls) out.push({ role: "tool", tool });
      const text = textOf(m.content);
      if (text) out.push({ role: "assistant", text });
    }
  }
  return out;
}
