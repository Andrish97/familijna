// base-explorerjs/ops.js
// Jedyne miejsce zapisu menedżera bazy: każda akcja = jedna funkcja SQL
// (migracja 427), czyli jedna transakcja — bez stanów częściowych.
// Funkcje zwracają to, co zwraca baza (m.in. stan „przed” zmianą).

import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-05T23012";
import { ROW_GONE } from "../../../shared/js/core/db-guard.js?v=v2026-11-05T23012";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-05T23012";

// Błędy funkcji qb_* → kod + komunikat dla użytkownika.
const ERRORS = {
  "qb:gone": { code: ROW_GONE, key: "resourceLock.goneMessage" },
  "qb:forbidden": { code: "FORBIDDEN", key: "resourceLock.forbiddenMessage" },
  "qb:not_authenticated": { code: "FORBIDDEN", key: "resourceLock.forbiddenMessage" },
  "qb:cycle": { code: "CYCLE", key: "baseExplorer.errors.moveIntoChild" },
  "qb:duplicate": { code: "DUPLICATE", key: "baseExplorer.tags.errors.duplicate" },
};

async function call(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (!error) return data;
  const known = ERRORS[String(error.message || "").trim()];
  if (!known) throw error;
  const e = new Error(error.message);
  e.code = known.code;
  e.userMessage = t(known.key);
  throw e;
}

const ids = (arr) => Array.from(new Set((arr || []).filter(Boolean)));
const orNull = (arr) => (ids(arr).length ? ids(arr) : null);

export function createFolder(baseId, parentId, name) {
  return call("qb_create_folder", { p_base_id: baseId, p_parent_id: parentId || null, p_name: name });
}

export function createQuestion(baseId, categoryId, payload) {
  return call("qb_create_question", { p_base_id: baseId, p_category_id: categoryId || null, p_payload: payload });
}

export function renameFolder(baseId, id, name) {
  return call("qb_rename_folder", { p_base_id: baseId, p_id: id, p_name: name });
}

export function setQuestionText(baseId, id, text) {
  return call("qb_set_question_text", { p_base_id: baseId, p_id: id, p_text: text });
}

export function saveQuestion(baseId, id, payload) {
  return call("qb_save_question", { p_base_id: baseId, p_id: id, p_payload: payload });
}

export function deleteItems(baseId, { questionIds, folderIds }) {
  return call("qb_delete_items", { p_base_id: baseId, p_question_ids: orNull(questionIds), p_folder_ids: orNull(folderIds) });
}

export function moveItems(baseId, { questionIds, folderIds }, targetId) {
  return call("qb_move_items", {
    p_base_id: baseId, p_question_ids: orNull(questionIds), p_folder_ids: orNull(folderIds), p_target: targetId || null,
  });
}

export function reorderFolders(baseId, parentId, orderedIds) {
  return call("qb_reorder_folders", { p_base_id: baseId, p_parent_id: parentId || null, p_ordered_ids: ids(orderedIds) });
}

export function restorePositions(baseId, positions) {
  return call("qb_restore_positions", { p_base_id: baseId, p_positions: positions || {} });
}

export function copyItems(baseId, { questionIds, folderIds }, targetId) {
  return call("qb_copy_items", {
    p_base_id: baseId, p_question_ids: orNull(questionIds), p_folder_ids: orNull(folderIds), p_target: targetId || null,
    // „Folder (kopia)” w języku interfejsu
    p_copy_label: t("baseExplorer.defaults.copy"),
  });
}

export function saveTag(baseId, id, name, color) {
  return call("qb_save_tag", { p_base_id: baseId, p_id: id || null, p_name: name, p_color: color });
}

export function deleteTags(baseId, tagIds) {
  return call("qb_delete_tags", { p_base_id: baseId, p_tag_ids: ids(tagIds) });
}

export function setTagLinks(baseId, tagIds, { questionIds, folderIds }, on) {
  return call("qb_set_tag_links", {
    p_base_id: baseId, p_tag_ids: ids(tagIds), p_question_ids: orNull(questionIds), p_folder_ids: orNull(folderIds), p_on: !!on,
  });
}

export function applyTagStates(baseId, { questionIds, folderIds }, { on, off }) {
  return call("qb_apply_tag_states", {
    p_base_id: baseId, p_question_ids: orNull(questionIds), p_folder_ids: orNull(folderIds), p_on: orNull(on), p_off: orNull(off),
  });
}

export function restoreTagLinks(baseId, { add, remove }) {
  return call("qb_restore_tag_links", { p_base_id: baseId, p_add: add || [], p_remove: remove || [] });
}

// ===== Kosz (migracja 428) =====

export function trashList(baseId) {
  return call("qb_trash_list", { p_base_id: baseId });
}

export function trashRestore(baseId, trashIds) {
  return call("qb_trash_restore", { p_base_id: baseId, p_trash_ids: ids(trashIds) });
}

// trashIds null = opróżnij kosz
export function trashPurge(baseId, trashIds) {
  return call("qb_trash_purge", { p_base_id: baseId, p_trash_ids: trashIds ? ids(trashIds) : null });
}

// ===== Cofanie usunięcia tagów (migracja 429) =====

// snapshot = wynik deleteTags: {tags, questionLinks, folderLinks}
export function restoreTags(baseId, snapshot) {
  return call("qb_restore_tags", { p_base_id: baseId, p_snapshot: snapshot || {} });
}
