// Narzędzia czatu AI: Wskazówki (podręcznik) i przejście na inną stronę.
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

// --- wyszukiwanie w Wskazówkach: podrozdziały (nagłówki h2/h3 z id „s-…”) ---
const norm = (x) => String(x || "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
// rdzeń słowa: odmiana („podłączyć”, „podłączenie”) — wspólny początek
const stem = (w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w);

/** Podrozdziały rozdziału: [{ id, title, text }] — wstęp rozdziału ma id rozdziału. */
export function manualSections(chapterId, chapterTitle, html) {
  const out = [];
  const re = /<h([23])[^>]*\sid="s-([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let last = { id: String(chapterId), title: chapterTitle, start: 0 };
  let m;
  const push = (end) => out.push({ id: last.id, title: last.title, chapter: String(chapterId), chapterTitle, text: stripHtml(html.slice(last.start, end)) });
  while ((m = re.exec(html))) {
    push(m.index);
    last = { id: m[2].replace(/-/g, "."), title: stripHtml(m[3]), start: m.index + m[0].length };
  }
  push(html.length);
  return out.filter((x) => x.text || x.id !== String(chapterId));
}

const sectionCache = new Map();
async function allSections(ctx, lang) {
  if (!sectionCache.has(lang)) {
    const p = (async () => {
      const meta = await ctx.manualMeta(lang);
      const chapters = await Promise.all(meta.chapters.map(async (c) => manualSections(c.id, c.title, (await ctx.manualChapter(lang, c.id)) || "")));
      return chapters.flat().map((x) => ({ ...x, nTitle: norm(`${x.title} ${x.chapterTitle}`), nText: norm(x.text) }));
    })();
    sectionCache.set(lang, p);
    p.catch(() => sectionCache.delete(lang));
  }
  return sectionCache.get(lang);
}

/**
 * Najlepsze podrozdziały dla zapytania. Słowo waży tym więcej, im w mniejszej
 * liczbie podrozdziałów występuje (IDF) — „nie”, „gry” prawie nic nie znaczą;
 * trafienie w tytule liczy się mocniej niż w tekście.
 */
export function rankSections(sections, query, limit = 5) {
  const words = [...new Set(norm(query).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2).map(stem))];
  if (!words.length) return [];
  const n = sections.length;
  const idf = Object.fromEntries(words.map((w) => {
    const df = sections.filter((x) => x.nTitle.includes(w) || x.nText.includes(w)).length;
    return [w, Math.log((n + 1) / (df + 1))];
  }));
  const scored = sections.map((x) => {
    let score = 0;
    let hits = 0;
    for (const w of words) {
      const inTitle = x.nTitle.includes(w);
      const count = Math.min(4, x.nText.split(w).length - 1);
      if (inTitle || count) hits += 1;
      score += idf[w] * ((inTitle ? 4 : 0) + Math.log1p(count));
    }
    return { x, score: score * (hits / words.length) };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  return scored.map(({ x }) => {
    const rare = [...words].sort((a, b) => idf[b] - idf[a]);
    const at = rare.map((w) => x.nText.indexOf(w)).find((i) => i >= 0) ?? 0;
    const from = Math.max(0, at - 120);
    return { section: x.id, title: x.title, chapter: `${x.chapter}. ${x.chapterTitle}`, snippet: `${from ? "…" : ""}${x.text.slice(from, from + 320)}…` };
  });
}

export const PAGE_TARGETS = ["games", "editor", "gameSettings", "polls", "bases", "baseExplorer", "logoEditor", "friends", "subscribers", "tasks", "account", "manual"];

export default [
  {
    name: "search_manual",
    description: "Search the Familijna user manual (help) and get the best matching sections with a short excerpt. Use this first for any question about how the service works; then read the best section with manual_section. Search with the words the manual would use (e.g. “podłączyć wyświetlacz telewizor”).",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    readOnly: true,
    async run({ query }, ctx) {
      const lang = manualLang(ctx.lang);
      const results = rankSections(await allSections(ctx, lang), query);
      return results.length ? { results } : { results: [], hint: "Try other words or manual_contents." };
    },
  },
  {
    name: "manual_section",
    description: "Read one section of the user manual by its number (e.g. “17.1” or “5.10.1”) — shorter and faster than a whole chapter.",
    inputSchema: { type: "object", properties: { section: { type: "string", description: "Section number from search_manual or manual_contents." } }, required: ["section"] },
    readOnly: true,
    async run({ section }, ctx) {
      const lang = manualLang(ctx.lang);
      const all = await allSections(ctx, lang);
      const id = String(section).trim();
      const hit = all.find((x) => x.id === id);
      if (!hit) return { error: "unknown_section" };
      const sub = all.filter((x) => x.id.startsWith(`${id}.`)).map((x) => ({ section: x.id, title: x.title }));
      return { section: hit.id, title: hit.title, chapter: hit.chapterTitle, text: hit.text, ...(sub.length ? { subsections: sub } : {}) };
    },
  },
  {
    name: "manual_contents",
    description: "List chapters and section titles of the user manual (help) — when search_manual found nothing.",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const meta = await ctx.manualMeta(manualLang(ctx.lang));
      return { chapters: meta.chapters.map((c) => ({ id: c.id, title: c.title, sections: c.sections.map((s) => s.title) })) };
    },
  },
  {
    name: "manual_chapter",
    description: "Read a whole chapter of the user manual (long) — only when one section is not enough.",
    inputSchema: { type: "object", properties: { chapter: { type: "string", description: "Chapter id from manual_contents." } }, required: ["chapter"] },
    readOnly: true,
    async run({ chapter }, ctx) {
      const html = await ctx.manualChapter(manualLang(ctx.lang), String(chapter));
      if (html == null) return { error: "unknown_chapter" };
      return { chapter: String(chapter), text: stripHtml(html) };
    },
  },
  {
    name: "open_page",
    description: "Take the user to a page of the service (e.g. the editor of a game). The chat stays open after the page changes.",
    where: "browser",
    inputSchema: {
      type: "object",
      properties: {
        page: { type: "string", enum: PAGE_TARGETS },
        id: { type: "string", description: "UUID of the game or base for pages that show one (editor, gameSettings, polls, baseExplorer)." },
      },
      required: ["page"],
    },
    run({ page, id }, ctx) {
      if (!PAGE_TARGETS.includes(page)) return { error: "unknown_page" };
      const href = ctx.navigateTo(page, id || null);
      return href ? { ok: true, href } : { error: "unknown_page" };
    },
  },
];
