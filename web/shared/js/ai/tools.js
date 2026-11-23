// E30: katalog narzędzi czatu AI. Każde narzędzie woła endpoint bazy (ten sam
// co interfejs) — baza pilnuje właściciela, reguł, blokad i limitów.
// Pola narzędzia:
//   name, description, inputSchema — to, co widzi model (opisy po angielsku,
//     odpowiedź model pisze w języku użytkownika — patrz prompt systemowy);
//   confirm(args) → null | "send" | "irreversible" — okno potwierdzenia przed
//     wysłaniem czegoś innej osobie albo nieodwracalną zmianą (decyzja 11);
//   readOnly — czy narzędzie działa też w Control (tam czat tylko pomaga słowem);
//   run(args, ctx) → obiekt wyniku (serializowany do JSON dla modelu).
// ctx: { lang, pageId, navigate(href), changed({ type, id }) }.
import { sb } from "../core/supabase.js";
import { getTabId } from "../core/resource-lock.js";
import { applyGameContent, createGameWithContent } from "../core/game-content.js";
import { linkTo, PAGES } from "../core/nav-map.js";

const uuid = { type: "string", description: "UUID" };
const answersSchema = {
  type: "array",
  description: "Answers in display order (max 6). Points matter only in 'prepared' games (each ≥ 4, sum ≤ 100); ignored otherwise. 'poll_text' games have no answers.",
  items: {
    type: "object",
    properties: { text: { type: "string", description: "Max 17 characters." }, points: { type: "integer" } },
    required: ["text"],
  },
};
const questionSchema = {
  type: "object",
  properties: { text: { type: "string", description: "Max 100 characters." }, answers: answersSchema },
  required: ["text"],
};

async function rpc(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message || "rpc_failed");
  return data;
}

async function select(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message || "select_failed");
  return data || [];
}

// Tekst rozdziału Wskazówek bez znaczników HTML.
function stripHtml(html) {
  return String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|h\d|li|tr|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const MANUAL_LANGS = new Set(["pl", "en", "uk"]);
const manualLang = (lang) => (MANUAL_LANGS.has(lang) ? lang : "pl");

export const TOOLS = [
  // ---------------------------------------------------------------- wiedza
  {
    name: "manual_contents",
    description: "List chapters of the Familijna user manual (help). Use before manual_chapter to find where a topic is described.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run(_args, ctx) {
      const meta = (await import(`../../../manual/content/meta/${manualLang(ctx.lang)}.js`)).default;
      return { chapters: meta.chapters.map((c) => ({ id: c.id, title: c.title, sections: c.sections.map((s) => s.title) })) };
    },
  },
  {
    name: "manual_chapter",
    description: "Read one chapter of the Familijna user manual. Answer questions about how the service works from the manual, not from guesses.",
    inputSchema: { type: "object", properties: { chapter: { type: "string", description: "Chapter id from manual_contents." } }, required: ["chapter"] },
    readOnly: true,
    async run({ chapter }, ctx) {
      const loaders = (await import("../../../manual/content/chapter-loaders.js")).default;
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
        page: { type: "string", enum: ["games", "editor", "gameSettings", "polls", "bases", "baseExplorer", "logoEditor", "friends", "tasks", "subscribers", "account", "manual"] },
        id: { type: "string", description: "Resource UUID for pages that show one game or base (editor, gameSettings, polls, baseExplorer)." },
      },
      required: ["page"],
    },
    readOnly: true,
    run({ page, id }, ctx) {
      if (!PAGES[page]) return { error: "unknown_page" };
      const href = linkTo(page, id ? { id } : {});
      ctx.navigate(href);
      return { ok: true, href };
    },
  },

  // ---------------------------------------------------------------- odczyt
  {
    name: "list_games",
    description: "List the user's games: id, name, type (prepared = points set by hand; poll_text = text poll; poll_points = poll with answers), status (draft, poll_open, poll_stopped, ready).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run() {
      const rows = await select(sb().from("games").select("id,name,type,status,updated_at").neq("type", "market").order("updated_at", { ascending: false }));
      return { games: rows };
    },
  },
  {
    name: "get_game",
    description: "Read one game: questions with ids, answers with ids and points, and what is still missing before it can be played or a poll can be started.",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    readOnly: true,
    async run({ game_id }) {
      const [game] = await select(sb().from("games").select("id,name,type,status").eq("id", game_id));
      if (!game) return { error: "not_found" };
      const questions = await select(sb().from("questions").select("id,ord,text,answers(id,ord,text,fixed_points)").eq("game_id", game_id).order("ord"));
      const rules = await rpc("game_validate", { p_game_id: game_id });
      return {
        game,
        questions: questions.map((q) => ({
          id: q.id, position: q.ord, text: q.text,
          answers: [...(q.answers || [])].sort((a, b) => a.ord - b.ord).map((a) => ({ id: a.id, text: a.text, points: a.fixed_points })),
        })),
        readiness: rules?.readiness, can_edit: rules?.edit, can_play: rules?.play, can_open_poll: rules?.poll_open,
      };
    },
  },
  {
    name: "list_bases",
    description: "List question bases the user owns or that are shared with them (id, name, role).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run() {
      const own = await select(sb().from("question_bases").select("id,name,owner_id,updated_at").order("updated_at", { ascending: false }));
      return { bases: own.map((b) => ({ id: b.id, name: b.name, owned: true })) };
    },
  },
  {
    name: "list_logos",
    description: "List the user's logos (id, name, type: GLYPH_30x10 = text/glyph logo, PIX_150x70 = pixel drawing or image).",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run() {
      return { logos: await select(sb().from("user_logos").select("id,name,type,updated_at").order("updated_at", { ascending: false })) };
    },
  },

  // ---------------------------------------------------------------- gry: zapis
  {
    name: "create_game",
    description: "Create a new game (draft), optionally with questions. Types: prepared (points by hand), poll_text (text poll, questions only), poll_points (poll with given answers). Ready to play/poll needs ≥ 10 questions; prepared and poll_points need 3–6 answers per question.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["prepared", "poll_text", "poll_points"] },
        name: { type: "string", description: "Max 80 characters." },
        questions: { type: "array", items: questionSchema },
      },
      required: ["type", "name"],
    },
    async run({ type, name, questions }, ctx) {
      const res = await createGameWithContent(type, name, Array.isArray(questions) ? questions : null);
      ctx.changed({ type: "game", id: res.id });
      return res;
    },
  },
  {
    name: "edit_game",
    description: "Change a game's content in one all-or-nothing step. Operations (use ids from get_game): rename {name}; add_question {text, answers?, position?}; update_question {question_id, text}; delete_question {question_id}; move_question {question_id, position}; set_answers {question_id, answers} (replaces all answers); add_answer {question_id, text, points?}; update_answer {answer_id, text?, points?}; delete_answer {answer_id}. A closed poll (status ready) can be edited only with reset_poll_results = true, which deletes its votes.",
    inputSchema: {
      type: "object",
      properties: {
        game_id: uuid,
        operations: { type: "array", items: { type: "object", properties: { op: { type: "string" } }, required: ["op"] } },
        reset_poll_results: { type: "boolean" },
      },
      required: ["game_id", "operations"],
    },
    confirm: ({ operations, reset_poll_results }) => {
      const ops = Array.isArray(operations) ? operations : [];
      if (reset_poll_results) return "irreversible";
      return ops.some((o) => ["delete_question", "delete_answer", "set_answers"].includes(o?.op)) ? "irreversible" : null;
    },
    async run({ game_id, operations, reset_poll_results }, ctx) {
      const res = await applyGameContent(game_id, operations, { reset: !!reset_poll_results });
      ctx.changed({ type: "game", id: game_id });
      return res;
    },
  },
  {
    name: "delete_game",
    description: "Delete a game permanently (an open poll is aborted).",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    confirm: () => "irreversible",
    async run({ game_id }, ctx) {
      const res = await rpc("delete_resource_checked", { p_resource_type: "game", p_resource_id: game_id, p_tab_id: getTabId() });
      if (res?.ok) ctx.changed({ type: "game", id: game_id });
      return res;
    },
  },
  {
    name: "copy_game_to_base",
    description: "Copy a game's questions into a question base as a new folder named after the game.",
    inputSchema: { type: "object", properties: { game_id: uuid, base_id: uuid }, required: ["game_id", "base_id"] },
    async run({ game_id, base_id }, ctx) {
      const [game] = await select(sb().from("games").select("id,name").eq("id", game_id));
      if (!game) return { error: "not_found" };
      const qs = await select(sb().from("questions").select("ord,text,answers(ord,text,fixed_points)").eq("game_id", game_id).order("ord"));
      const questions = qs.map((q) => ({
        text: q.text,
        answers: [...(q.answers || [])].sort((a, b) => a.ord - b.ord).map((a) => ({ text: a.text, fixed_points: a.fixed_points })),
      }));
      const res = await rpc("qb_import_folder", { p_base_id: base_id, p_name: game.name, p_questions: questions });
      if (res?.ok) ctx.changed({ type: "base", id: base_id });
      return res;
    },
  },
];

const BY_NAME = new Map(TOOLS.map((x) => [x.name, x]));
export const toolByName = (name) => BY_NAME.get(name) || null;

/** Narzędzia dostępne na stronie: w Control tylko te do odczytu (czat pomaga słowem). */
export function toolsForPage(pageId) {
  const playing = pageId === "control";
  return TOOLS.filter((x) => !playing || (x.readOnly && x.name !== "open_page"));
}
