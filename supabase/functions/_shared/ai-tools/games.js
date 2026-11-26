// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: gry (odczyt, tworzenie, treść, usuwanie, kopia do bazy).
import { uuid, noArgs, rpc, rows, questionSchema } from "./common.js";

const DESTRUCTIVE_OPS = new Set(["delete_question", "delete_answer", "set_answers"]);

export default [
  {
    name: "list_games",
    description: "List the user's games: id, name, type (prepared = points set by hand; poll_text = text poll; poll_points = poll with given answers), status (draft, poll_open, poll_stopped, ready).",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      return { games: await rows(ctx.db.from("games").select("id,name,type,status,updated_at").neq("type", "market").order("updated_at", { ascending: false })) };
    },
  },
  {
    name: "get_game",
    description: "Read one game: questions with ids, answers with ids and points, and what is still missing before it can be played or a poll can be started.",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    readOnly: true,
    async run({ game_id }, ctx) {
      const [game] = await rows(ctx.db.from("games").select("id,name,type,status").eq("id", game_id));
      if (!game) return { error: "not_found" };
      const questions = await rows(ctx.db.from("questions").select("id,ord,text,answers(id,ord,text,fixed_points)").eq("game_id", game_id).order("ord"));
      const rules = await rpc(ctx, "game_validate", { p_game_id: game_id });
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
    name: "create_game",
    description: "Create a new game (draft), optionally with questions. Types: prepared (points by hand), poll_text (text poll, questions only), poll_points (poll with given answers). Playing or starting a poll needs ≥ 10 questions; prepared and poll_points need 3–6 answers per question.",
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
      const res = await rpc(ctx, "game_create", { p_type: type, p_name: name, p_questions: Array.isArray(questions) ? questions : null });
      if (res?.ok) ctx.changed({ type: "game", id: res.id });
      return res;
    },
  },
  {
    name: "edit_game",
    description: "Change a game's content in one all-or-nothing step. Operations (ids from get_game): rename {name}; add_question {text, answers?, position?}; update_question {question_id, text}; delete_question {question_id}; move_question {question_id, position}; set_answers {question_id, answers} (replaces all answers); add_answer {question_id, text, points?}; update_answer {answer_id, text?, points?}; delete_answer {answer_id}. A closed poll (status ready) can be edited only with reset_poll_results = true, which deletes its votes.",
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
      if (reset_poll_results) return "irreversible";
      return (Array.isArray(operations) ? operations : []).some((o) => DESTRUCTIVE_OPS.has(o?.op)) ? "irreversible" : null;
    },
    async run({ game_id, operations, reset_poll_results }, ctx) {
      const res = await rpc(ctx, "game_content_apply", { p_game_id: game_id, p_ops: operations, p_tab_id: ctx.tabId, p_reset: !!reset_poll_results });
      if (res?.ok) ctx.changed({ type: "game", id: game_id });
      return res;
    },
  },
  {
    name: "delete_game",
    description: "Delete a game permanently (an open poll is aborted).",
    inputSchema: { type: "object", properties: { game_id: uuid }, required: ["game_id"] },
    confirm: () => "irreversible",
    async run({ game_id }, ctx) {
      const res = await rpc(ctx, "delete_resource_checked", { p_resource_type: "game", p_resource_id: game_id, p_tab_id: ctx.tabId });
      if (res?.ok) ctx.changed({ type: "game", id: game_id });
      return res;
    },
  },
  {
    name: "rename",
    description: "Rename a game, a question base or a logo.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["game", "base", "logo"] }, id: uuid, name: { type: "string", description: "Max 80 characters." } },
      required: ["kind", "id", "name"],
    },
    async run({ kind, id, name }, ctx) {
      const res = await rpc(ctx, "rename_resource_checked", { p_resource_type: kind, p_resource_id: id, p_name: name, p_tab_id: ctx.tabId });
      if (res?.ok !== false) ctx.changed({ type: kind, id });
      return res;
    },
  },
  {
    name: "copy_game_to_base",
    description: "Copy a game's questions into a question base as a new folder named after the game.",
    inputSchema: { type: "object", properties: { game_id: uuid, base_id: uuid }, required: ["game_id", "base_id"] },
    async run({ game_id, base_id }, ctx) {
      const [game] = await rows(ctx.db.from("games").select("id,name").eq("id", game_id));
      if (!game) return { error: "not_found" };
      const qs = await rows(ctx.db.from("questions").select("ord,text,answers(ord,text,fixed_points)").eq("game_id", game_id).order("ord"));
      const questions = qs.map((q) => ({
        text: q.text,
        answers: [...(q.answers || [])].sort((a, b) => a.ord - b.ord).map((a) => ({ text: a.text, fixed_points: a.fixed_points })),
      }));
      const res = await rpc(ctx, "qb_import_folder", { p_base_id: base_id, p_name: game.name, p_questions: questions });
      if (res?.ok) ctx.changed({ type: "base", id: base_id });
      return res;
    },
  },
];
