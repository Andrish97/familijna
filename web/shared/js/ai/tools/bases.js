// Narzędzia czatu AI: bazy pytań (te same endpointy qb_* co Eksplorator bazy).
// Usunięte pozycje trafiają do kosza bazy (30 dni) — bez okna potwierdzenia.
import { uuid, uuidList, noArgs, rpc, rows } from "./common.js";

const baseQuestion = {
  type: "object",
  properties: {
    text: { type: "string", description: "Max 100 characters." },
    answers: { type: "array", items: { type: "object", properties: { text: { type: "string" }, points: { type: "integer" } }, required: ["text"] } },
  },
  required: ["text"],
};
const payloadOf = (q, old = {}) => ({
  ...old,
  text: q.text,
  answers: (Array.isArray(q.answers) ? q.answers : []).map((a) => ({ text: a.text, fixed_points: Number(a.points) || 0 })),
});

export default [
  {
    name: "list_bases",
    description: "List question bases the user owns or that are shared with them (id, name, owned).",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const uid = ctx.userId;
      const list = await rows(ctx.db.from("question_bases").select("id,name,owner_id,updated_at").order("updated_at", { ascending: false }));
      return { bases: list.map((b) => ({ id: b.id, name: b.name, owned: b.owner_id === uid })) };
    },
  },
  {
    name: "get_base",
    description: "Read a question base: folders (id, parent_id, name) and questions (id, folder_id, text, answers with points).",
    inputSchema: { type: "object", properties: { base_id: uuid }, required: ["base_id"] },
    readOnly: true,
    async run({ base_id }, ctx) {
      const c = await rpc(ctx, "qb_base_content", { p_base_id: base_id });
      return {
        folders: (c?.categories || []).map((f) => ({ id: f.id, parent_id: f.parent_id, name: f.name })),
        questions: (c?.questions || []).map((q) => ({
          id: q.id, folder_id: q.category_id, text: q.payload?.text,
          answers: (q.payload?.answers || []).map((a) => ({ text: a.text, points: a.fixed_points })),
        })),
      };
    },
  },
  {
    name: "create_base",
    description: "Create a new, empty question base.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Max 80 characters." } }, required: ["name"] },
    async run({ name }, ctx) {
      const res = await rpc(ctx, "base_create", { p_name: name });
      if (res?.ok) ctx.changed({ type: "base", id: res.id });
      return res;
    },
  },
  {
    name: "add_base_questions",
    description: "Add questions to a base. With folder_name: a new top-level folder (a taken name gets “(2)”). Otherwise into folder_id (omit for the base's top level).",
    inputSchema: {
      type: "object",
      properties: { base_id: uuid, folder_name: { type: "string" }, folder_id: uuid, questions: { type: "array", items: baseQuestion } },
      required: ["base_id", "questions"],
    },
    async run({ base_id, folder_name, folder_id, questions }, ctx) {
      const list = Array.isArray(questions) ? questions : [];
      let res;
      if (folder_name) {
        res = await rpc(ctx, "qb_import_folder", { p_base_id: base_id, p_name: folder_name, p_questions: list.map((q) => payloadOf(q)) });
      } else {
        const ids = [];
        for (const q of list) ids.push(await rpc(ctx, "qb_create_question", { p_base_id: base_id, p_category_id: folder_id || null, p_payload: payloadOf(q) }));
        res = { ok: true, question_ids: ids };
      }
      ctx.changed({ type: "base", id: base_id });
      return res;
    },
  },
  {
    name: "create_base_folder",
    description: "Create a folder in a base (parent_id omitted = top level).",
    inputSchema: { type: "object", properties: { base_id: uuid, parent_id: uuid, name: { type: "string" } }, required: ["base_id", "name"] },
    async run({ base_id, parent_id, name }, ctx) {
      const res = await rpc(ctx, "qb_create_folder", { p_base_id: base_id, p_parent_id: parent_id || null, p_name: name });
      ctx.changed({ type: "base", id: base_id });
      return { ok: true, result: res };
    },
  },
  {
    name: "edit_base_question",
    description: "Replace the text and answers of a base question.",
    inputSchema: { type: "object", properties: { base_id: uuid, question_id: uuid, question: baseQuestion }, required: ["base_id", "question_id", "question"] },
    async run({ base_id, question_id, question }, ctx) {
      const [row] = await rows(ctx.db.from("qb_questions").select("payload").eq("id", question_id).eq("base_id", base_id));
      if (!row) return { error: "not_found" };
      await rpc(ctx, "qb_save_question", { p_base_id: base_id, p_id: question_id, p_payload: payloadOf(question, row.payload || {}) });
      ctx.changed({ type: "base", id: base_id });
      return { ok: true };
    },
  },
  {
    name: "rename_base_folder",
    description: "Rename a folder in a base.",
    inputSchema: { type: "object", properties: { base_id: uuid, folder_id: uuid, name: { type: "string" } }, required: ["base_id", "folder_id", "name"] },
    async run({ base_id, folder_id, name }, ctx) {
      const res = await rpc(ctx, "qb_rename_folder", { p_base_id: base_id, p_id: folder_id, p_name: name });
      ctx.changed({ type: "base", id: base_id });
      return { ok: true, result: res };
    },
  },
  {
    name: "move_base_items",
    description: "Move questions and folders to another folder of the same base (target_folder_id omitted = top level).",
    inputSchema: { type: "object", properties: { base_id: uuid, question_ids: uuidList, folder_ids: uuidList, target_folder_id: uuid }, required: ["base_id"] },
    async run({ base_id, question_ids, folder_ids, target_folder_id }, ctx) {
      const res = await rpc(ctx, "qb_move_items", {
        p_base_id: base_id, p_question_ids: question_ids?.length ? question_ids : null,
        p_folder_ids: folder_ids?.length ? folder_ids : null, p_target: target_folder_id || null,
      });
      ctx.changed({ type: "base", id: base_id });
      return { ok: true, result: res };
    },
  },
  {
    name: "delete_base_items",
    description: "Move questions and folders of a base to the base's trash (restorable for 30 days in the base explorer).",
    inputSchema: { type: "object", properties: { base_id: uuid, question_ids: uuidList, folder_ids: uuidList }, required: ["base_id"] },
    async run({ base_id, question_ids, folder_ids }, ctx) {
      const res = await rpc(ctx, "qb_delete_items", {
        p_base_id: base_id, p_question_ids: question_ids?.length ? question_ids : null, p_folder_ids: folder_ids?.length ? folder_ids : null,
      });
      ctx.changed({ type: "base", id: base_id });
      return { ok: true, result: res };
    },
  },
];
