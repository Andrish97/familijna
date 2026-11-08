// base-explorerjs/commands.js
// Polecenia menedżera bazy: wszystkie operacje na danych w jednym miejscu.
// Zapis idzie przez ops.js (jedna funkcja SQL = jedna transakcja), blokady
// zasobów przez resource-lock.js, a po każdej zmianie jedno odświeżenie:
// przeładowanie magazynu (data/store.js) i narysowanie strony.
// Rejestr akcji (actions/registry.js) woła te funkcje; dostępność sprawdza
// rejestr, tu zostają tylko warunki ochronne.

import * as ops from "./ops.js?v=v2026-11-08T10534";
import { reload } from "./data/store.js?v=v2026-11-08T10534";
import { getQuestion } from "./repo.js?v=v2026-11-08T10534";
import {
  goTo, currentFolderId, isTrash, selectionClear, setQuery, clearQuery,
} from "./state.js?v=v2026-11-08T10534";
import { renderAll } from "./render.js?v=v2026-11-08T10534";
import { openMoveModal } from "./ui/move-modal.js?v=v2026-11-08T10534";
import { openRenameModal } from "./ui/rename-modal.js?v=v2026-11-08T10534";
import { openTagsModal } from "./tags-modal.js?v=v2026-11-08T10534";
import { initQuestionModal } from "./question-modal.js?v=v2026-11-08T10534";
import { initExportModal } from "./export-modal.js?v=v2026-11-08T10534";
import { importGame } from "../../../games/js/games-import-export.js?v=v2026-11-08T10534";
import { normQuestionText, LIMITS } from "../../../shared/js/core/question-form.js?v=v2026-11-08T10534";
import { acquireResourceLock, acquireResourceLocks } from "../../../shared/js/core/resource-lock.js?v=v2026-11-08T10534";
import { alertModal, confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-08T10534";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-08T10534";
import { linkTo } from "../../../shared/js/core/nav-map.js?v=v2026-11-08T10534";

/* ================= Wspólne ================= */

// Po każdej zmianie danych: przeładuj magazyn i narysuj.
export async function refresh(state) {
  if (await reload(state)) renderAll(state);
}

// Klucze "c:<id>" / "q:<id>" → id folderów i pytań (inne klucze pomijane).
export function splitKeys(keys) {
  const folderIds = [];
  const questionIds = [];
  for (const k of keys || []) {
    if (typeof k !== "string") continue;
    if (k.startsWith("c:")) folderIds.push(k.slice(2));
    else if (k.startsWith("q:")) questionIds.push(k.slice(2));
  }
  return { folderIds: [...new Set(folderIds)], questionIds: [...new Set(questionIds)] };
}

function trashIdsOf(keys) {
  return [...keys].filter((k) => typeof k === "string" && k.startsWith("t:")).map((k) => k.slice(2));
}

function lockRefused(lease) {
  void alertModal({ text: lease?.error === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.baseItemMessage") });
  return false;
}

// Znany błąd ops.js (element zniknął, brak uprawnień, cykl…) → komunikat
// i false; nieznany leci dalej do komunikatu akcji (actions/run.js).
function opFailed(e) {
  if (!e?.userMessage) throw e;
  void alertModal({ text: e.userMessage });
  return false;
}

// Blokada całego poddrzewa folderów (foldery + pytania w nich) i pytań:
// równoległa edycja dowolnego elementu w środku trafia na ten sam klucz
// blokady (edit_locks) bez chodzenia po przodkach.
function locksFor(state, { folderIds = [], questionIds = [] }, extra = []) {
  const d = state.d;
  const folders = new Set(folderIds);
  for (const fid of folderIds) for (const id of d.descendantFolderIds(fid)) folders.add(id);
  const questions = new Set(questionIds);
  for (const fid of folderIds) for (const id of d.subtreeQuestionIds(fid)) questions.add(id);
  return [
    ...[...questions].map((resourceId) => ({ resourceType: "base_question", resourceId })),
    ...[...folders].map((resourceId) => ({ resourceType: "base_folder", resourceId })),
    ...extra,
  ];
}

// mode "shared": miejsce docelowe tworzenia / kopii — wiele osób może
// tworzyć naraz, ale nie w folderze, który ktoś właśnie zmienia na wyłączność.
async function withLocks(resources, context, fn, { mode = "exclusive" } = {}) {
  const lease = resources.length ? await acquireResourceLocks(resources, { context, mode }) : { ok: true, release() {} };
  if (!lease?.ok) return lockRefused(lease);
  try {
    return await fn();
  } catch (e) {
    return opFailed(e);
  } finally {
    lease.release();
  }
}

// Pytania zaznaczenia z folderami rozwiniętymi do całych poddrzew.
export function selectionQuestionIds(state) {
  const { folderIds, questionIds } = splitKeys(state.selection.keys);
  const out = new Set(questionIds);
  for (const fid of folderIds) for (const id of state.d.subtreeQuestionIds(fid)) out.add(id);
  return [...out];
}

/* ================= Historia (cofanie / ponawianie) ================= */

// Wpis historii z danych zwróconych przez bazę: undo/redo wykonują zapis
// (ops.js), odświeżenie robi undo()/redo() niżej. Utworzenie i kopia cofają
// się przez kosz (ponowienie = przywrócenie z kosza), więc id elementów się
// nie zmieniają i dalsze kroki historii nadal wskazują właściwe elementy.
// locks: () => zasoby do zablokowania na czas kroku (jak przy zwykłej
// akcji). Blokuje się tylko to, co jest w bazie — wpisów kosza nikt nie
// edytuje, a blokada nieistniejącego elementu kończy się „gone”.
function remember(state, labelKey, { locks = null, undo, redo, drop }) {
  const guarded = (fn) => async () => {
    const resources = (locks ? locks() : []).filter((r) => resourceExists(state, r));
    const lease = resources.length ? await acquireResourceLocks(resources, { context: "base-explorer:history" }) : null;
    if (lease && !lease.ok) {
      const e = new Error(lease.error || "locked");
      if (lease.error !== "gone") {
        e.keepHistory = true;
        e.userMessage = t("resourceLock.baseItemMessage");
      }
      throw e;
    }
    try {
      await fn();
    } finally {
      lease?.release();
    }
  };
  state.history?.push({ labelKey, undo: guarded(undo), redo: guarded(redo), drop });
}

function resourceExists(state, { resourceType, resourceId }) {
  if (resourceType === "base_question") return state.d.questionById.has(resourceId);
  if (resourceType === "base_folder") return state.d.folderById.has(resourceId);
  if (resourceType === "base_tag") return (state.store?.tags || []).some((tg) => tg.id === resourceId);
  return true;
}

const tagLocks = (ids) => ids.map((resourceId) => ({ resourceType: "base_tag", resourceId }));
const questionLocks = (ids) => ids.map((resourceId) => ({ resourceType: "base_question", resourceId }));

// Cofnięte utworzenie / kopia: wpis w koszu, z którego ponowienie przywraca.
// Gdy ponowienie przepada (nowa akcja po cofnięciu), wpis znika z kosza.
function rememberCreated(state, labelKey, items) {
  let trashIds = [];
  remember(state, labelKey, {
    locks: () => locksFor(state, items),
    undo: async () => { trashIds = (await ops.deleteItems(state.baseId, items))?.trash || []; },
    redo: async () => { await ops.trashRestore(state.baseId, trashIds); trashIds = []; },
    drop: (where) => {
      if (where === "redo" && trashIds.length) void ops.trashPurge(state.baseId, trashIds).catch(() => {});
    },
  });
}

export async function undo(state) {
  return historyStep(state, "undo");
}

export async function redo(state) {
  return historyStep(state, "redo");
}

async function historyStep(state, dir) {
  try {
    await state.history[dir]();
  } catch (e) {
    console.error(e);
    // zajęte: krok został w historii; inaczej historia jest już wyczyszczona
    // (history.js) — dalsze kroki dotyczyłyby innego stanu niż ten, który widać
    void alertModal({ text: e?.keepHistory ? e.userMessage : t("baseExplorer.errors.historyFailed") });
  }
  selectionClear(state);
  await refresh(state);
  return true;
}

/* ================= Nawigacja ================= */

export async function openFolder(state, folderId) {
  goTo(state, folderId || null);
  renderAll(state);
}

// Otwarcie folderu z listy (dwuklik, Enter, menu): wejście do niego kończy
// wyszukiwanie, jak w Eksploratorze. Drzewo zmienia tylko zakres filtra.
export async function openFolderFromList(state, folderId) {
  clearQuery(state);
  return openFolder(state, folderId);
}

export async function openTrash(state) {
  goTo(state, "trash");
  renderAll(state);
}

export async function goUp(state) {
  if (state.location.kind !== "folder") return;
  const parent = state.d.folderById.get(state.location.folderId)?.parent_id || null;
  await openFolder(state, parent);
}

/* ================= Tworzenie i zmiana nazwy ================= */

const folderLock = (id) => (id ? [{ resourceType: "base_folder", resourceId: id }] : []);

export async function createFolder(state, parentId) {
  const id = await withLocks(folderLock(parentId), "base-explorer:create",
    () => ops.createFolder(state.baseId, parentId, t("baseExplorer.toolbar.newFolder")), { mode: "shared" });
  if (id === false) return false;
  rememberCreated(state, "baseExplorer.toolbar.newFolder", { folderIds: [id] });
  await refresh(state);
  return true;
}

export async function createQuestion(state, folderId) {
  const id = await withLocks(folderLock(folderId), "base-explorer:create",
    () => ops.createQuestion(state.baseId, folderId, { text: t("baseExplorer.toolbar.newQuestion"), answers: [] }), { mode: "shared" });
  if (id === false) return false;
  rememberCreated(state, "baseExplorer.toolbar.newQuestion", { questionIds: [id] });
  await refresh(state);
  return true;
}

export async function renameSelected(state) {
  const keys = [...state.selection.keys];
  if (keys.length !== 1) return false;
  const key = keys[0];
  const isFolder = key.startsWith("c:");
  if (!isFolder && !key.startsWith("q:")) return false;
  const id = key.slice(2);

  const current = isFolder
    ? state.d.folderById.get(id)?.name || ""
    : String(state.d.questionById.get(id)?.payload?.text || "");

  const lease = await acquireResourceLock({
    resourceType: isFolder ? "base_folder" : "base_question",
    resourceId: id,
    context: "base-explorer:rename",
  });
  if (!lease?.ok) return lockRefused(lease);
  try {
    const next = await openRenameModal({
      title: t(isFolder ? "baseExplorer.rename.folderTitle" : "baseExplorer.rename.questionTitle"),
      value: current,
      maxLen: isFolder ? 80 : LIMITS.Q_TEXT,
    });
    if (next === null) return false;
    if (!lease.ok) {
      void alertModal({ text: lease.reason === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.forbiddenMessage") });
      return false;
    }
    const value = isFolder ? String(next).trim().slice(0, 80) : normQuestionText(next);
    if (!value) return false;
    try {
      // pytanie: baza podmienia tylko payload.text — odpowiedzi dodane
      // w międzyczasie gdzie indziej zostają
      const set = isFolder ? ops.renameFolder : ops.setQuestionText;
      const old = await set(state.baseId, id, value);
      remember(state, "baseExplorer.toolbar.rename", {
        locks: () => [{ resourceType: isFolder ? "base_folder" : "base_question", resourceId: id }],
        undo: () => set(state.baseId, id, old),
        redo: () => set(state.baseId, id, value),
      });
    } catch (e) {
      return opFailed(e);
    }
  } finally {
    lease.release();
  }
  await refresh(state);
  return true;
}

/* ================= Usuwanie i kosz ================= */

// Usuń zaznaczone: w koszu — trwale, wszędzie indziej — do kosza.
export async function deleteSelected(state) {
  if (isTrash(state)) return purgeTrash(state, trashIdsOf(state.selection.keys));

  const items = splitKeys(state.selection.keys);
  const n = items.folderIds.length + items.questionIds.length;
  if (!n) return false;
  const ok = await confirmModal({
    text: n === 1 ? t("baseExplorer.confirm.deleteOne") : t("baseExplorer.confirm.deleteMany", { n }),
  });
  if (!ok) return false;

  const done = await withLocks(locksFor(state, items), "base-explorer:delete",
    () => ops.deleteItems(state.baseId, items));
  if (done === false) return false;
  let trashIds = done?.trash || [];
  remember(state, "baseExplorer.toolbar.delete", {
    locks: () => locksFor(state, items),
    undo: async () => { await ops.trashRestore(state.baseId, trashIds); },
    redo: async () => { trashIds = (await ops.deleteItems(state.baseId, items))?.trash || []; },
  });
  selectionClear(state);
  await refresh(state);
  return true;
}

export async function restoreFromTrash(state) {
  const ids = trashIdsOf(state.selection.keys);
  if (!ids.length) return false;
  // dawne miejsca, które nadal są w bazie (tam wracają elementy)
  const origins = (state.store?.trash || [])
    .filter((e) => ids.includes(e.id) && e.origin_id && state.d.folderById.has(e.origin_id))
    .flatMap((e) => folderLock(e.origin_id));
  const restored = await withLocks(origins, "base-explorer:restore",
    () => ops.trashRestore(state.baseId, ids), { mode: "shared" });
  if (restored === false) return false;
  const items = { questionIds: restored?.questions || [], folderIds: restored?.folders || [] };
  let trashIds = [];
  remember(state, "baseExplorer.trash.restore", {
    locks: () => locksFor(state, items),
    undo: async () => { trashIds = (await ops.deleteItems(state.baseId, items))?.trash || []; },
    redo: async () => { await ops.trashRestore(state.baseId, trashIds); },
  });
  selectionClear(state);
  await refresh(state);
  return true;
}

// ids null = opróżnij cały kosz
export async function purgeTrash(state, ids) {
  if (ids && !ids.length) return false;
  const ok = await confirmModal({ text: t(ids ? "baseExplorer.trash.confirmPurge" : "baseExplorer.trash.confirmEmpty") });
  if (!ok) return false;
  try {
    await ops.trashPurge(state.baseId, ids);
  } catch (e) {
    return opFailed(e);
  }
  // usunięte na zawsze: kroki historii, które z nich korzystały, nie
  // mają już do czego wrócić
  state.history?.clear();
  selectionClear(state);
  await refresh(state);
  return true;
}

/* ================= Schowek, kopiowanie, przenoszenie ================= */

export function copyToClipboard(state, mode) {
  const keys = [...state.selection.keys].filter((k) => k.startsWith("c:") || k.startsWith("q:"));
  if (!keys.length) return false;
  state.clipboard = { mode, keys: new Set(keys) };
  renderAll(state);
  return true;
}

export async function copyItems(state, keys, targetFolderId) {
  const items = splitKeys(keys);
  if (!items.folderIds.length && !items.questionIds.length) return false;
  // źródła (czytane w trakcie kopii) i cel — współdzielenie
  const res = await withLocks(locksFor(state, items, folderLock(targetFolderId)), "base-explorer:copy",
    () => ops.copyItems(state.baseId, items, targetFolderId), { mode: "shared" });
  if (res === false) return false;
  rememberCreated(state, "baseExplorer.toolbar.paste", { questionIds: res?.questions || [], folderIds: res?.folders || [] });
  await refresh(state);
  return true;
}

export async function moveItems(state, keys, targetFolderId) {
  const items = splitKeys(keys);
  if (!items.folderIds.length && !items.questionIds.length) return false;
  if (items.folderIds.includes(targetFolderId)) {
    void alertModal({ text: t("baseExplorer.errors.moveIntoSelf") });
    return false;
  }
  if (targetFolderId && state.d.ancestorIds(targetFolderId).some((a) => items.folderIds.includes(a))) {
    void alertModal({ text: t("baseExplorer.errors.moveIntoChild") });
    return false;
  }
  const target = targetFolderId ? [{ resourceType: "base_folder", resourceId: targetFolderId }] : [];
  const done = await withLocks(locksFor(state, items, target), "base-explorer:move",
    () => ops.moveItems(state.baseId, items, targetFolderId));
  if (done === false) return false;
  remember(state, "baseExplorer.history.move", {
    locks: () => locksFor(state, items, target),
    undo: () => ops.restorePositions(state.baseId, done),
    redo: () => ops.moveItems(state.baseId, items, targetFolderId),
  });
  await refresh(state);
  return true;
}

// Przenieś do… / Kopiuj do…: folder docelowy z okna z drzewem.
export async function moveOrCopyTo(state, mode) {
  const items = splitKeys(state.selection.keys);
  if (!items.folderIds.length && !items.questionIds.length) return false;
  const blockedIds = new Set();
  if (mode === "move") {
    for (const fid of items.folderIds) {
      blockedIds.add(fid);
      for (const id of state.d.descendantFolderIds(fid)) blockedIds.add(id);
    }
  }
  const target = await openMoveModal(state, { mode, blockedIds, startId: currentFolderId(state) });
  if (target === undefined) return false;
  const keys = new Set(state.selection.keys);
  return mode === "copy" ? copyItems(state, keys, target) : moveItems(state, keys, target);
}

// Wklej: kopia albo przeniesienie (wycięte) do folderu docelowego.
export async function paste(state, targetFolderId) {
  const { mode, keys } = state.clipboard;
  if (!mode || !keys.size) return false;
  if (mode === "copy") return copyItems(state, keys, targetFolderId);
  const ok = await moveItems(state, keys, targetFolderId);
  // schowek pustoszeje tylko po udanym przeniesieniu
  if (ok) state.clipboard = { mode: null, keys: new Set() };
  renderAll(state);
  return ok;
}

// Duplikuj: kopia w tym samym folderze, bez ruszania schowka.
export async function duplicateSelected(state) {
  return copyItems(state, state.selection.keys, currentFolderId(state));
}

// Zmiana kolejności folderów (upuszczenie przed/za folderem w drzewie).
export async function reorderFolders(state, movedIds, targetId, mode) {
  const d = state.d;
  const target = d.folderById.get(targetId);
  if (!target || !movedIds.length) return false;
  const parentId = mode === "into" ? targetId : (target.parent_id || null);
  if (parentId && (movedIds.includes(parentId) || d.ancestorIds(parentId).some((a) => movedIds.includes(a)))) {
    void alertModal({ text: t("baseExplorer.errors.moveIntoChild") });
    return false;
  }
  const siblings = d.childFolders(parentId).map((f) => f.id).filter((id) => !movedIds.includes(id));
  let ordered;
  if (mode === "into") ordered = siblings.concat(movedIds);
  else {
    const idx = siblings.indexOf(targetId);
    const at = idx === -1 ? siblings.length : (mode === "before" ? idx : idx + 1);
    ordered = siblings.slice(0, at).concat(movedIds, siblings.slice(at));
  }
  const parentLock = parentId ? [{ resourceType: "base_folder", resourceId: parentId }] : [];
  const done = await withLocks(locksFor(state, { folderIds: movedIds }, parentLock), "base-explorer:reorder-folders",
    () => ops.reorderFolders(state.baseId, parentId, ordered));
  if (done === false) return false;
  remember(state, "baseExplorer.history.move", {
    locks: () => locksFor(state, { folderIds: movedIds }, parentLock),
    undo: () => ops.restorePositions(state.baseId, done),
    redo: () => ops.reorderFolders(state.baseId, parentId, ordered),
  });
  await refresh(state);
  return true;
}

/* ================= Tagi ================= */

// Nadane / zdjęte przypisania pytań → wpis historii.
export function rememberTagLinks(state, labelKey, { added = [], removed = [] }) {
  if (!added.length && !removed.length) return;
  const links = [...added, ...removed];
  remember(state, labelKey, {
    locks: () => [
      ...questionLocks([...new Set(links.map((l) => l.question_id))]),
      ...tagLocks([...new Set(links.map((l) => l.tag_id))]),
    ],
    undo: () => ops.restoreTagLinks(state.baseId, { add: removed, remove: added }),
    redo: () => ops.restoreTagLinks(state.baseId, { add: added, remove: removed }),
  });
}

// Zapisany tag (okno tagów): nowy cofa się usunięciem (z tym samym id przy
// ponowieniu), zmieniony — powrotem do nazwy i koloru sprzed zmiany.
export function rememberTagSave(state, { id, before }, { name, color }) {
  if (!id) return;
  if (!before) {
    let snapshot = null;
    remember(state, "baseExplorer.tags.addTag", {
      locks: () => tagLocks([id]),
      undo: async () => { snapshot = await ops.deleteTags(state.baseId, [id]); },
      redo: () => ops.restoreTags(state.baseId, snapshot),
    });
    return;
  }
  remember(state, "baseExplorer.menu.editTag", {
    locks: () => tagLocks([id]),
    undo: () => ops.saveTag(state.baseId, id, before.name, before.color),
    redo: () => ops.saveTag(state.baseId, id, name, color),
  });
}

// Upuszczenie elementów na tag: tag dostają pytania i całe poddrzewa folderów.
export async function assignTag(state, tagId, keys) {
  const items = splitKeys(keys);
  if (!tagId || (!items.folderIds.length && !items.questionIds.length)) return false;
  const done = await withLocks(locksFor(state, items, [{ resourceType: "base_tag", resourceId: tagId }]),
    "base-explorer:assign-tag", () => ops.setTagLinks(state.baseId, [tagId], items, true));
  if (done === false) return false;
  rememberTagLinks(state, "baseExplorer.history.tag", { added: done?.questionLinks || [], removed: [] });
  await refresh(state);
  return true;
}

// Zdejmij tagi z filtra z zaznaczonych elementów (folder = całe poddrzewo).
export async function untagSelected(state) {
  const tagIds = state.query.tagIds || [];
  const items = splitKeys(state.selection.keys);
  const n = items.folderIds.length + items.questionIds.length;
  if (!tagIds.length || !n) return false;
  const ok = await confirmModal({
    text: n === 1 ? t("baseExplorer.confirm.removeTagsOne") : t("baseExplorer.confirm.removeTagsMany", { n }),
  });
  if (!ok) return false;
  const done = await withLocks(locksFor(state, items, tagIds.map((resourceId) => ({ resourceType: "base_tag", resourceId }))),
    "base-explorer:untag", () => ops.setTagLinks(state.baseId, tagIds, items, false));
  if (done === false) return false;
  rememberTagLinks(state, "baseExplorer.menu.untag", { added: [], removed: done?.questionLinks || [] });
  selectionClear(state);
  await refresh(state);
  return true;
}

export async function deleteTags(state, tagIds) {
  const ids = [...new Set((tagIds || []).filter(Boolean))];
  if (!ids.length) return false;
  const ok = await confirmModal({
    text: ids.length === 1 ? t("baseExplorer.confirm.deleteTagsOne") : t("baseExplorer.confirm.deleteTagsMany", { n: ids.length }),
  });
  if (!ok) return false;
  const done = await withLocks(ids.map((resourceId) => ({ resourceType: "base_tag", resourceId })),
    "base-explorer:delete-tags", () => ops.deleteTags(state.baseId, ids));
  if (done === false) return false;
  remember(state, "baseExplorer.menu.deleteTag", {
    locks: () => tagLocks(ids),
    undo: () => ops.restoreTags(state.baseId, done),
    redo: () => ops.deleteTags(state.baseId, ids),
  });
  // usunięte tagi znikają z filtra
  setQuery(state, { tagIds: state.query.tagIds.filter((id) => !ids.includes(id)) });
  await refresh(state);
  return true;
}

// Okno tagów: przypisanie zaznaczeniu ("assign") albo nowy / edycja tagu.
export async function openTagsWindow(state, { mode = "assign", tagId = null } = {}) {
  let res;
  if (mode === "assign") {
    const { folderIds, questionIds } = splitKeys(state.selection.keys);
    const folderDescQIds = new Map(folderIds.map((fid) => [fid, new Set(state.d.subtreeQuestionIds(fid))]));
    res = await openTagsModal(state, {
      mode, selection: { qIds: questionIds, cIds: folderIds }, folderDescQIds,
      onLinks: (r) => rememberTagLinks(state, "baseExplorer.menu.tags", r),
      onTagSaved: (r, v) => rememberTagSave(state, r, v),
    });
  } else {
    res = await openTagsModal(state, { mode, tagId, onTagSaved: (r, v) => rememberTagSave(state, r, v) });
  }
  if (res === true || res?.saved) await refresh(state);
  else renderAll(state);
  return res;
}

/* ================= Okno pytania ================= */

let questionModal = null;

export async function editQuestion(state, qid) {
  if (!qid) return false;
  questionModal ||= initQuestionModal();
  const lease = await acquireResourceLock({ resourceType: "base_question", resourceId: qid, context: "base-explorer:question-modal" });
  if (!lease?.ok) return lockRefused(lease);
  try {
    const row = await getQuestion(qid);
    const input = { id: row.id, payload: (row.payload && typeof row.payload === "object") ? row.payload : { text: "", answers: [] } };
    // zapis z otwartym oknem: błąd pokazuje się w oknie, wpisana treść zostaje
    const save = async (payload) => {
      if (!lease.ok) {
        const e = new Error("lease lost");
        e.userMessage = lease.reason === "gone" ? t("resourceLock.goneMessage") : t("resourceLock.forbiddenMessage");
        throw e;
      }
      const old = await ops.saveQuestion(state.baseId, qid, payload);
      remember(state, "baseExplorer.menu.editQuestion", {
        locks: () => questionLocks([qid]),
        undo: () => ops.saveQuestion(state.baseId, qid, old),
        redo: () => ops.saveQuestion(state.baseId, qid, payload),
      });
    };
    const res = await questionModal.open(input, { save });
    if (!res?.ok) return false;
  } finally {
    lease.release();
  }
  await refresh(state);
  return true;
}

/* ================= Utwórz grę ================= */

let exportModal = null;

export async function createGame(state) {
  exportModal ||= initExportModal();
  const ownerId = state.user?.id;
  if (!ownerId) return false;

  const qids = selectionQuestionIds(state);
  // nazwa podpowiadana z folderu, gdy zaznaczony jest dokładnie jeden folder
  const { folderIds, questionIds } = splitKeys(state.selection.keys);
  const folder = folderIds.length === 1 && !questionIds.length ? state.d.folderById.get(folderIds[0]) : null;

  // lista okna = tylko zaznaczone pytania (w kolejności bazy); w oknie można
  // je jeszcze odznaczyć
  const picked = new Set(qids);
  const questions = (state.store.questions || []).filter((r) => picked.has(r.id)).map((r) => ({
    id: r.id,
    payload: (r.payload && typeof r.payload === "object") ? r.payload : { text: "", answers: [] },
    text: r.payload?.text ?? "",
    answers: Array.isArray(r.payload?.answers) ? r.payload.answers : [],
  }));

  const res = await exportModal.open({
    questions,
    ...(folder?.name ? { defaultName: folder.name } : {}),
    // gra powstaje tu (okno czeka na wynik); bez drugiego importGame
    run: async (payload, progress) => {
      const n = payload?.questions?.length || 1;
      progress?.({ step: t("baseExplorer.export.progress.creatingGame"), i: 0, n, msg: "" });
      let i = 0;
      const timer = setInterval(() => {
        i = Math.min(n - 1, i + 1);
        progress?.({ step: t("baseExplorer.export.progress.importingQuestions"), i, n, msg: "" });
      }, 120);
      try {
        const gameId = await importGame(payload, ownerId);
        progress?.({ step: t("baseExplorer.export.progress.importDone"), i: n, n, msg: t("baseExplorer.export.progress.importOk") });
        return { gameId };
      } finally {
        clearInterval(timer);
      }
    },
  });
  if (!res?.ok) return false;
  location.href = linkTo("games");
  return true;
}
