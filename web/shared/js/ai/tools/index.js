// E30: katalog narzędzi czatu AI. Każde narzędzie woła endpoint bazy (ten sam
// co interfejs) — baza pilnuje właściciela, reguł, blokad i limitów.
// Pola narzędzia:
//   name, description, inputSchema — to, co widzi model (opisy po angielsku;
//     odpowiedź model pisze w języku użytkownika — prompt systemowy);
//   confirm(args) → null | "send" | "irreversible" — okno potwierdzenia przed
//     wysłaniem czegoś innej osobie albo zmianą nieodwracalną (decyzja 11);
//   readOnly — narzędzie dostępne też w Control (tam czat tylko pomaga słowem);
//   where: "browser" — tylko w przeglądarce (nie na serwerze MCP);
//   run(args, ctx) → wynik (JSON dla modelu).
// Narzędzia nie importują modułów przeglądarki — działają też na serwerze MCP
// (kopia: supabase/functions/_shared/ai-tools/, scripts/sync-ai-tools.mjs).
// ctx: { db (klient Supabase użytkownika), userId, tabId, lang, pageId,
//   changed({ type, id }), confirm(...), loadJson(path), manualMeta(lang),
//   manualChapter(lang, id), sendPollMails(items), inviteContact(kind, value),
//   tylko przeglądarka: navigateTo(page, id), openContactForm({ subject, message }), pagePath }.
import knowledge from "./knowledge.js";
import games from "./games.js";
import gameSettings from "./game-settings.js";
import polls from "./polls.js";
import bases from "./bases.js";
import contacts from "./contacts.js";
import logos from "./logos.js";
import support from "./support.js";

export const TOOLS = [...knowledge, ...games, ...gameSettings, ...polls, ...bases, ...logos, ...contacts, ...support];

const BY_NAME = new Map(TOOLS.map((x) => [x.name, x]));
export const toolByName = (name) => BY_NAME.get(name) || null;

/**
 * Narzędzia dla miejsca rozmowy. pageId — strona (w Control tylko odczyt: czat
 * pomaga słowem, nic nie klika); server — serwer MCP (bez narzędzi przeglądarki:
 * przejście na stronę, formularz Kontaktu).
 */
export function toolsForPage(pageId, { server = false } = {}) {
  return TOOLS.filter((x) => (!server || x.where !== "browser") && (pageId !== "control" || x.readOnly));
}
