// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: bazy pytań (te same endpointy qb_* co Eksplorator bazy).
// Usunięte pozycje trafiają do kosza bazy (30 dni) — bez okna potwierdzenia.
import { uuid, uuidList, noArgs, rpc, rows } from "./common.js";

// Dopisek kopiowanego folderu — baseExplorer.defaults.copy (zgodność: unit/aiChat.test.js).
export const COPY_LABEL = { pl: "kopia", en: "copy", uk: "копія" };

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
    description: "List question bases: the user's own (owned = true) and shared with them (owner name, role editor/viewer). Proposals to share waiting for the user's answer have proposed = true and a task_id (answer_base_share).",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      const uid = ctx.userId;
      const own = await rows(ctx.db.from("question_bases").select("id,name,owner_id,updated_at").eq("owner_id", uid).order("updated_at", { ascending: false }));
      const shared = await rpc(ctx, "list_shared_bases_ext", {});
      return {
        bases: [
          ...own.map((b) => ({ id: b.id, name: b.name, owned: true })),
          ...(Array.isArray(shared) ? shared : []).map((b) => ({
            id: b.id, name: b.name, owned: false, owner: b.owner_username || null,
            role: b.proposed ? b.proposed_role : b.shared_role, proposed: !!b.proposed, task_id: b.proposed ? b.task_id : undefined,
          })),
        ],
      };
    },
  },
  {
    name: "get_base",
    description: "Read a question base: folders (id, parent_id, name), tags (id, name, color) and questions (id, folder_id, text, tag_ids, answers with points).",
    inputSchema: { type: "object", properties: { base_id: uuid }, required: ["base_id"] },
    readOnly: true,
    async run({ base_id }, ctx) {
      const c = await rpc(ctx, "qb_base_content", { p_base_id: base_id });
      const tagsOf = new Map();
      for (const l of c?.questionTags || []) tagsOf.set(l.question_id, [...(tagsOf.get(l.question_id) || []), l.tag_id]);
      return {
        folders: (c?.categories || []).map((f) => ({ id: f.id, parent_id: f.parent_id, name: f.name })),
        tags: (c?.tags || []).map((t) => ({ id: t.id, name: t.name, color: t.color })),
        questions: (c?.questions || []).map((q) => ({
          id: q.id, folder_id: q.category_id, text: q.payload?.text, tag_ids: tagsOf.get(q.id) || [],
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
  {
    name: "copy_base_items",
    description: "Copy questions and folders inside a base into a folder (target_folder_id omitted = top level); copied folders get “(copy)” in the name.",
    inputSchema: { type: "object", properties: { base_id: uuid, question_ids: uuidList, folder_ids: uuidList, target_folder_id: uuid }, required: ["base_id"] },
    async run({ base_id, question_ids, folder_ids, target_folder_id }, ctx) {
      const res = await rpc(ctx, "qb_copy_items", {
        p_base_id: base_id, p_question_ids: question_ids?.length ? question_ids : null, p_folder_ids: folder_ids?.length ? folder_ids : null,
        p_target: target_folder_id || null, p_copy_label: COPY_LABEL[ctx.lang] || COPY_LABEL.pl,
      });
      ctx.changed({ type: "base", id: base_id });
      return res ?? { ok: true };
    },
  },
  {
    name: "base_tag",
    description: "Tags of a base: create or change a tag (name, color #RRGGBB; tag_id to change), delete tags, or put tags on / take them off questions and folders.",
    inputSchema: {
      type: "object",
      properties: {
        base_id: uuid,
        action: { type: "string", enum: ["save", "delete", "attach", "detach"] },
        tag_id: uuid, name: { type: "string" }, color: { type: "string", description: "#RRGGBB" },
        tag_ids: uuidList, question_ids: uuidList, folder_ids: uuidList,
      },
      required: ["base_id", "action"],
    },
    async run(a, ctx) {
      let res;
      if (a.action === "save") {
        if (!String(a.name || "").trim()) return { ok: false, error: "name_required" };
        if (a.color && !/^#[0-9a-f]{6}$/i.test(a.color)) return { ok: false, error: "invalid_color" };
        res = await rpc(ctx, "qb_save_tag", { p_base_id: a.base_id, p_id: a.tag_id || null, p_name: String(a.name).trim(), p_color: a.color || "#c4c4c4" });
      } else if (a.action === "delete") {
        res = await rpc(ctx, "qb_delete_tags", { p_base_id: a.base_id, p_tag_ids: a.tag_ids || (a.tag_id ? [a.tag_id] : []) });
      } else if (a.action === "attach" || a.action === "detach") {
        res = await rpc(ctx, "qb_set_tag_links", {
          p_base_id: a.base_id, p_tag_ids: a.tag_ids || (a.tag_id ? [a.tag_id] : []),
          p_question_ids: a.question_ids?.length ? a.question_ids : null, p_folder_ids: a.folder_ids?.length ? a.folder_ids : null, p_on: a.action === "attach",
        });
      } else return { ok: false, error: "invalid_action" };
      ctx.changed({ type: "base", id: a.base_id });
      return res ?? { ok: true };
    },
  },
  {
    name: "base_trash",
    description: "Trash of a base (deleted items kept 30 days): list, restore items, or delete items for good (trash_ids omitted with action purge = empty the whole trash).",
    inputSchema: {
      type: "object",
      properties: { base_id: uuid, action: { type: "string", enum: ["list", "restore", "purge"] }, trash_ids: uuidList },
      required: ["base_id", "action"],
    },
    confirm: ({ action }) => (action === "purge" ? "irreversible" : null),
    async run({ base_id, action, trash_ids }, ctx) {
      if (action === "list") return rpc(ctx, "qb_trash_list", { p_base_id: base_id });
      const res = action === "restore"
        ? await rpc(ctx, "qb_trash_restore", { p_base_id: base_id, p_trash_ids: trash_ids || [] })
        : await rpc(ctx, "qb_trash_purge", { p_base_id: base_id, p_trash_ids: trash_ids?.length ? trash_ids : null });
      ctx.changed({ type: "base", id: base_id });
      return res ?? { ok: true };
    },
  },
  {
    name: "delete_base",
    description: "Delete the user's own question base permanently with all its questions.",
    inputSchema: { type: "object", properties: { base_id: uuid }, required: ["base_id"] },
    confirm: () => "irreversible",
    async run({ base_id }, ctx) {
      const res = await rpc(ctx, "delete_resource_checked", { p_resource_type: "base", p_resource_id: base_id, p_tab_id: ctx.tabId });
      if (res?.ok) ctx.changed({ type: "base", id: base_id });
      return res;
    },
  },
  {
    name: "create_game_from_base",
    description: "Create a new game from questions of a base (question_ids, or all questions of folder_ids including subfolders), like “Create a game” in the base explorer. Text answers and points are taken from the base; for type poll_text answers are dropped.",
    inputSchema: {
      type: "object",
      properties: {
        base_id: uuid, name: { type: "string", description: "Max 80 characters." },
        type: { type: "string", enum: ["prepared", "poll_text", "poll_points"] },
        question_ids: uuidList, folder_ids: uuidList,
      },
      required: ["base_id", "name", "type"],
    },
    async run({ base_id, name, type, question_ids = [], folder_ids = [] }, ctx) {
      const c = await rpc(ctx, "qb_base_content", { p_base_id: base_id });
      const folders = c?.categories || [];
      const inFolders = new Set(folder_ids);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of folders) if (f.parent_id && inFolders.has(f.parent_id) && !inFolders.has(f.id)) { inFolders.add(f.id); grew = true; }
      }
      const wanted = new Set(question_ids);
      const picked = (c?.questions || []).filter((q) => wanted.has(q.id) || inFolders.has(q.category_id));
      if (!picked.length) return { ok: false, error: "no_questions" };
      const questions = picked.map((q) => ({
        text: q.payload?.text || "",
        answers: type === "poll_text" ? [] : (q.payload?.answers || []).map((a) => ({ text: a.text, points: type === "prepared" ? a.fixed_points : undefined })),
      }));
      const res = await rpc(ctx, "game_create", { p_type: type, p_name: name, p_questions: questions });
      if (res?.ok) ctx.changed({ type: "game", id: res.id });
      return { ...res, questions: questions.length };
    },
  },
];
