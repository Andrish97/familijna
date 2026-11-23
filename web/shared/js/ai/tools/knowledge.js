// Narzędzia czatu AI: Wskazówki (podręcznik) i przejście na inną stronę.
import { linkTo, PAGES } from "../../core/nav-map.js";
import { noArgs } from "./common.js";

const MANUAL_LANGS = new Set(["pl", "en", "uk"]);
const manualLang = (lang) => (MANUAL_LANGS.has(lang) ? lang : "pl");

// Tekst rozdziału bez znaczników HTML.
export function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h\d|li|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const PAGE_TARGETS = ["games", "editor", "gameSettings", "polls", "bases", "baseExplorer", "logoEditor", "friends", "subscribers", "tasks", "account", "manual"];

export default [
  {
    name: "manual_contents",
    description: "List chapters of the Familijna user manual (help). Use before manual_chapter to find where a topic is described.",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const meta = (await import(`../../../../manual/content/meta/${manualLang(ctx.lang)}.js`)).default;
      return { chapters: meta.chapters.map((c) => ({ id: c.id, title: c.title, sections: c.sections.map((s) => s.title) })) };
    },
  },
  {
    name: "manual_chapter",
    description: "Read one chapter of the Familijna user manual. Answer questions about how the service works from the manual, not from guesses.",
    inputSchema: { type: "object", properties: { chapter: { type: "string", description: "Chapter id from manual_contents." } }, required: ["chapter"] },
    readOnly: true,
    async run({ chapter }, ctx) {
      const loaders = (await import("../../../../manual/content/chapter-loaders.js")).default;
      const load = loaders[manualLang(ctx.lang)]?.[String(chapter)];
      if (!load) return { error: "unknown_chapter" };
      return { chapter: String(chapter), text: stripHtml((await load()).default) };
    },
  },
  {
    name: "open_page",
    description: "Take the user to a page of the service (e.g. the editor of a game). The chat stays open after the page changes.",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "string", enum: PAGE_TARGETS },
        id: { type: "string", description: "UUID of the game or base for pages that show one (editor, gameSettings, polls, baseExplorer)." },
      },
      required: ["page"],
    },
    run({ page, id }, ctx) {
      if (!PAGE_TARGETS.includes(page) || !PAGES[page]) return { error: "unknown_page" };
      const href = linkTo(page, id ? { id } : {});
      ctx.navigate(href);
      return { ok: true, href };
    },
  },
];
