// E30: rozmowa czatu AI — prompt systemowy, narzędzia z katalogu dla bieżącej
// strony i ich wykonywanie z potwierdzeniem (wysyłka do innych osób, zmiany
// nieodwracalne — decyzja 11). Bez interfejsu: panel czatu podaje ctx.
import { createConversation, ask } from "./providers.js";
import { toolsForPage, toolByName } from "./tools/index.js";

const LANG_NAMES = { pl: "Polish", en: "English", uk: "Ukrainian" };
const RESULT_MAX = 20000;

export function systemPrompt({ lang = "pl", pageId = null } = {}) {
  const playing = pageId === "control";
  return [
    "You are the assistant built into Familijna, a web service for preparing and running a family quiz game based on survey answers (games, polls that collect answers, question bases, logos, sharing with friends).",
    `Always reply in ${LANG_NAMES[lang] || "Polish"}, briefly and plainly; the user is not technical.`,
    "Questions about how the service works: read the manual with manual_contents and manual_chapter and answer from it; do not guess features.",
    "Do things for the user with the tools. Never invent ids — read them first (list_games, get_game, list_bases…). After a change, say in one sentence what changed.",
    "If a tool returns an error, explain it in plain words and suggest what to do. 'locked' means the resource is open elsewhere (another tab or device) — ask the user to close it there.",
    "Deleting and sending things to other people are confirmed by the user in a dialog shown by the app; if the user declines, do not retry.",
    `The user is on page: ${pageId || "unknown"}.`,
    playing
      ? "The user is running a live game (Control). Do not change anything; only explain how things work and help connect devices (display, host, buzzer) using the manual."
      : "",
  ].filter(Boolean).join("\n");
}

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
  return createConversation({ provider, model, key, system: systemPrompt({ lang, pageId }), tools, history });
}

/** Wiadomość użytkownika z pętlą narzędzi; zwraca { text, stopped? }. */
export function sendMessage(conversation, text, ctx, { onText, onStep, signal } = {}) {
  return ask(conversation, text, { run: (name, args) => runTool(name, args, ctx), onText, onStep, signal });
}
