// E30: katalog narzędzi czatu AI. Każde narzędzie woła endpoint bazy (ten sam
// co interfejs) — baza pilnuje właściciela, reguł, blokad i limitów.
// Pola narzędzia:
//   name, description, inputSchema — to, co widzi model (opisy po angielsku;
//     odpowiedź model pisze w języku użytkownika — prompt systemowy);
//   confirm(args) → null | "send" | "irreversible" — okno potwierdzenia przed
//     wysłaniem czegoś innej osobie albo zmianą nieodwracalną (decyzja 11);
//   readOnly — narzędzie dostępne też w Control (tam czat tylko pomaga słowem);
//   run(args, ctx) → wynik (JSON dla modelu).
// ctx: { lang, pageId, navigate(href), changed({ type, id }), confirm(...) }.
import knowledge from "./knowledge.js";
import games from "./games.js";
import polls from "./polls.js";
import bases from "./bases.js";
import contacts from "./contacts.js";
import logos from "./logos.js";

export const TOOLS = [...knowledge, ...games, ...polls, ...bases, ...logos, ...contacts];

const BY_NAME = new Map(TOOLS.map((x) => [x.name, x]));
export const toolByName = (name) => BY_NAME.get(name) || null;

/** Narzędzia dostępne na stronie: w Control tylko odczyt (czat pomaga słowem, nic nie klika). */
export function toolsForPage(pageId) {
  if (pageId !== "control") return TOOLS;
  return TOOLS.filter((x) => x.readOnly);
}
