// E30: rozmowa czatu AI — prompt systemowy, narzędzia z katalogu dla bieżącej
// strony i ich wykonywanie z potwierdzeniem (wysyłka do innych osób, zmiany
// nieodwracalne — decyzja 11). Bez interfejsu: panel czatu podaje ctx.
import { createConversation, ask, resume } from "./providers.js";
import { toolsForPage, toolByName } from "./tools/index.js";

const LANG_NAMES = { pl: "Polish", en: "English", uk: "Ukrainian" };
const RESULT_MAX = 20000;

export function systemPrompt() {
  // Stały dla wszystkich stron i języków (decyzja 28: wspólny początek
  // zapytania = cache u dostawcy). Strona i język — w linii kontekstu
  // doklejanej do wiadomości użytkownika (contextLine).
  return [
    "You are the assistant built into Familijna, a web service for preparing and running a family quiz game based on survey answers (games, polls that collect answers, question bases, logos, sharing with friends).",
    "Each user message ends with a context line <ctx>…</ctx>: the user's language and the page they are on. Always reply in that language, briefly and plainly; the user is not technical. Never mention the context line.",
    "Questions about how the service works: read the manual with manual_contents and manual_chapter and answer from it; do not guess features.",
    "Do things for the user with the tools. Never invent ids — read them first (list_games, get_game, list_bases…). After a change, say in one sentence what changed.",
    "If a tool returns an error, explain it in plain words and suggest what to do. 'locked' means the resource is open elsewhere (another tab or device) — ask the user to close it there.",
    "Deleting and sending things to other people are confirmed by the user in a dialog shown by the app; if the user declines, do not retry.",
    "When something cannot be done with a tool (uploading a file or an image, own sound files, drawing by hand, connecting a device, anything during a live game) or the user asks where something is, show it: list_page_places, then show_on_page with a short instruction — the app opens the page and highlights the place.",
    "Logos: a text logo → create_text_logo; a picture (icon, emblem, shapes with short text) → draw_logo: compose shapes on the 150×70 dot board, check preview_only first, then save.",
    "When the user asks HOW to do something (rather than asking you to do it), guide them through the whole process: first a short numbered plan, then one step at a time — do the step with a tool if they want, or show the place with show_on_page and wait. When they say a step is done, check the result with a tool (e.g. get_game, get_poll, get_game_settings) and continue with the next step. Sending things to other people and irreversible steps always need their consent.",
    "When the context says live_game, the user is running a game in Control: change nothing, only explain how things work and help connect devices (display, host, buzzer) using the manual and show_on_page on Control.",
  ].join("\n");
}

/** Linia kontekstu na końcu wiadomości użytkownika (zmienne dane po stałym początku). */
export function contextLine({ lang = "pl", pageId = null } = {}) {
  const live = pageId === "control" ? "; live_game" : "";
  return `<ctx>language: ${LANG_NAMES[lang] || "Polish"}; page: ${pageId || "unknown"}${live}</ctx>`;
}
const CTX_RE = /\n*<ctx>[^<]*<\/ctx>\s*$/;
/** Tekst wiadomości bez linii kontekstu (do pokazania w historii). */
export const withoutContext = (text) => String(text || "").replace(CTX_RE, "");

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

/** Nowa (albo wznowiona — history) rozmowa dla strony. */
export function startConversation({ provider, model, key, lang, pageId, history = [] }) {
  const tools = toolsForPage(pageId).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  return createConversation({ provider, model, key, system: systemPrompt(), tools, history });
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
