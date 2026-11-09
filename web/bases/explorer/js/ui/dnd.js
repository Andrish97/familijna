// base-explorerjs/ui/dnd.js
// Przeciąganie: rozpoznaje zamiar i woła polecenia (commands.js).
// - lista → folder w liście: przenieś / kopiuj (modyfikator jak w systemie),
// - lista → tło listy: do bieżącego folderu (decyzja 2026-10-20),
// - → drzewo: na folder (środek wiersza) = do folderu; górna / dolna ćwiartka
//   wiersza przy samych folderach = zmiana kolejności (przed / za),
//   „Folder główny” = do folderu głównego,
// - → tag w lewym panelu: nadaj tag (całe poddrzewa folderów).

import { selectionSetSingle, currentFolderId, hasQuery, isTrash } from "../state.js?v=v2026-11-09T13161";
import { renderSelection } from "../render.js?v=v2026-11-09T13161";
import { moveItems, copyItems, reorderFolders, assignTag } from "../commands.js?v=v2026-11-09T13161";
import { isCopyDragModifier } from "../platform.js?v=v2026-11-09T13161";
import { alertModal } from "../../../../shared/js/core/modal.js?v=v2026-11-09T13161";
import { t } from "../../../../shared/translation/translation.js?v=v2026-11-09T13161";

const MARKS = ["is-drop-target", "is-drop-before", "is-drop-after", "is-drop-into"];

// podświetlenie celu po upuszczeniu — szukane po przerysowaniu
function pulse(root, key) {
  const el = key ? root?.querySelector(`.row[data-key="${CSS.escape(key)}"]`) : null;
  if (!el) return;
  el.classList.remove("drop-pulse");
  void el.offsetWidth; // restart animacji
  el.classList.add("drop-pulse");
  setTimeout(() => el.classList.remove("drop-pulse"), 460);
}

export function wireDnd(state) {
  const listEl = document.getElementById("list");
  const treeEl = document.getElementById("tree");
  const tagsEl = document.getElementById("leftFilters");
  let dragKeys = null; // przeciągane klucze "c:"/"q:"
  let treeDrop = null; // { mode: before|after|into, targetId|null(root) }

  const canDrag = () => state.canEdit && !isTrash(state);

  function clearMarks() {
    document.querySelectorAll(MARKS.map((c) => `.${c}`).join(",")).forEach((el) => el.classList.remove(...MARKS));
  }

  function end() {
    clearMarks();
    dragKeys = null;
    treeDrop = null;
  }

  function onDragStart(e, pane) {
    if (!canDrag()) { e.preventDefault(); return; }
    const row = e.target.closest(".row[data-key]");
    const key = row?.dataset.key;
    if (!key || !(key.startsWith("c:") || key.startsWith("q:"))) { e.preventDefault(); return; }
    // start na niezaznaczonym wierszu: przeciągamy tylko jego (bez
    // przebudowy listy — przeglądarka nie przerywa przeciągania)
    if (state.selection.pane !== pane || !state.selection.keys.has(key)) {
      selectionSetSingle(state, key, pane);
      renderSelection(state);
    }
    dragKeys = new Set([...state.selection.keys].filter((k) => k.startsWith("c:") || k.startsWith("q:")));
    try { e.dataTransfer.setData("text/plain", "move"); } catch {}
    e.dataTransfer.effectAllowed = "copyMove";
  }

  async function run(fn) {
    try {
      await fn();
    } catch (err) {
      console.error(err);
      void alertModal({ text: t("baseExplorer.errors.moveFailed") });
    }
  }

  // ===== lista =====
  listEl?.addEventListener("dragstart", (e) => onDragStart(e, "list"));
  listEl?.addEventListener("dragover", (e) => {
    if (!dragKeys || e.target.closest(".list-head")) return;
    const row = e.target.closest('.row[data-kind="cat"]');
    // w wynikach filtra tło nie ma „tu” — tylko upuszczenie na folder
    if (!row && hasQuery(state)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = isCopyDragModifier(e) ? "copy" : "move";
    clearMarks();
    row?.classList.add("is-drop-target");
  });
  listEl?.addEventListener("drop", (e) => {
    if (!dragKeys) return;
    const row = e.target.closest('.row[data-kind="cat"]');
    if (!row && hasQuery(state)) return;
    e.preventDefault();
    const keys = dragKeys;
    const target = row ? row.dataset.id : currentFolderId(state);
    end();
    void run(async () => {
      if (isCopyDragModifier(e)) await copyItems(state, keys, target);
      else await moveItems(state, keys, target);
      pulse(listEl, row?.dataset.key);
    });
  });

  // ===== drzewo =====
  treeEl?.addEventListener("dragstart", (e) => onDragStart(e, "tree"));
  treeEl?.addEventListener("dragover", (e) => {
    if (!dragKeys) return;
    const row = e.target.closest('.row[data-kind="cat"], .row[data-kind="root"]');
    clearMarks();
    if (!row) { treeDrop = null; return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = isCopyDragModifier(e) ? "copy" : "move";
    const isRoot = row.dataset.kind === "root";
    let mode = "into";
    // przed / za tylko dla samych folderów (zmiana kolejności)
    const onlyFolders = [...dragKeys].every((k) => k.startsWith("c:"));
    if (!isRoot && onlyFolders && !isCopyDragModifier(e)) {
      const r = row.getBoundingClientRect();
      const y = e.clientY - r.top;
      if (y < r.height * 0.25) mode = "before";
      else if (y > r.height * 0.75) mode = "after";
    }
    treeDrop = { mode, targetId: isRoot ? null : row.dataset.id, key: row.dataset.key };
    row.classList.add(mode === "before" ? "is-drop-before" : mode === "after" ? "is-drop-after" : "is-drop-into");
  });
  treeEl?.addEventListener("drop", (e) => {
    if (!dragKeys || !treeDrop) { end(); return; }
    e.preventDefault();
    const keys = dragKeys;
    const { mode, targetId, key } = treeDrop;
    end();
    void run(async () => {
      if (isCopyDragModifier(e)) await copyItems(state, keys, targetId);
      else if (mode === "into") await moveItems(state, keys, targetId);
      else await reorderFolders(state, [...keys].map((k) => k.slice(2)), targetId, mode);
      pulse(treeEl, key);
    });
  });

  // ===== tagi =====
  tagsEl?.addEventListener("dragover", (e) => {
    if (!dragKeys) return;
    const row = e.target.closest('.row[data-kind="tag"]');
    clearMarks();
    if (!row) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    row.classList.add("is-drop-target");
  });
  tagsEl?.addEventListener("drop", (e) => {
    const row = e.target.closest('.row[data-kind="tag"]');
    if (!dragKeys || !row) { end(); return; }
    e.preventDefault();
    const keys = dragKeys;
    end();
    void run(async () => {
      await assignTag(state, row.dataset.id, keys);
      pulse(tagsEl, row.dataset.key);
    });
  });

  // koniec przeciągania z każdego miejsca (także poza panelami)
  document.addEventListener("dragend", end);
  document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) clearMarks(); });
}
