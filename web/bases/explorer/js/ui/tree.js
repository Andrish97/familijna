// base-explorerjs/ui/tree.js
// Drzewo folderów (z Folderem głównym i Koszem): rozwijanie strzałką,
// zaznaczanie (klik, Ctrl/⌘, Shift, ramka), otwieranie (dwuklik / podwójne
// stuknięcie / Enter), menu kontekstowe. Zaznaczenie drzewa jest osobne od
// listy (selection.pane) — Delete nie usunie niewidocznego folderu z drzewa
// razem z elementami listy.

import { saveTreeOpen, selectionClear, selectionSetSingle, selectionToggle, selectionRange } from "../state.js?v=v2026-11-08T22332";
import { renderTree, renderSelection } from "../render.js?v=v2026-11-08T22332";
import { openFolder, openTrash } from "../commands.js?v=v2026-11-08T22332";
import { showContextMenu } from "../context-menu.js?v=v2026-11-08T22332";
import { attachMarquee } from "./marquee.js?v=v2026-11-08T22332";
import { addLongPress, addDoubleTap, isTouchContextMenuWindow } from "../mobile.js?v=v2026-11-08T22332";
import { isModKey } from "../platform.js?v=v2026-11-08T22332";

const ROW = ".row[data-key]";

export function wireTree(state) {
  const treeEl = document.getElementById("tree");
  if (!treeEl) return;

  const folderKeys = () => [...treeEl.querySelectorAll('.row[data-kind="cat"]')].map((r) => r.dataset.key);

  const marquee = attachMarquee(treeEl, {
    rowSelector: '.row[data-kind="cat"]',
    getBase: () => (state.selection.pane === "tree" ? state.selection.keys : new Set()),
    onSelect: (keys, final) => {
      if (final) return;
      state.selection.pane = "tree";
      state.selection.keys = keys;
      state.selection.anchorKey = null;
      renderSelection(state);
    },
  });

  treeEl.addEventListener("click", (e) => {
    if (marquee.consumeClick()) return;

    const tog = e.target.closest(".tree-toggle[data-id]");
    if (tog) {
      e.stopPropagation();
      const id = tog.dataset.id;
      if (state.treeOpen.has(id)) state.treeOpen.delete(id);
      else state.treeOpen.add(id);
      saveTreeOpen(state.baseId, state.treeOpen);
      renderTree(state);
      return;
    }

    const row = e.target.closest(ROW);
    if (!row) {
      if (state.selection.pane === "tree") { selectionClear(state); renderSelection(state); }
      return;
    }
    const key = row.dataset.key;
    if (row.dataset.kind === "cat" && e.shiftKey) selectionRange(state, folderKeys(), key, "tree");
    else if (row.dataset.kind === "cat" && isModKey(e)) selectionToggle(state, key, "tree");
    else selectionSetSingle(state, key, "tree");
    renderSelection(state);
  });

  async function open(row) {
    if (!row) return;
    const { kind, id } = row.dataset;
    if (kind === "root") await openFolder(state, null);
    else if (kind === "cat") await openFolder(state, id);
    else if (kind === "trash") await openTrash(state);
  }
  treeEl.addEventListener("dblclick", (e) => {
    if (e.target.closest(".tree-toggle")) return;
    void open(e.target.closest(ROW));
  });
  addDoubleTap(treeEl, (target) => {
    if (target?.closest?.(".tree-toggle")) return;
    void open(target?.closest?.(ROW));
  });

  function menuTarget(target) {
    const row = target?.closest?.(ROW);
    if (!row) return { kind: "root", id: null, pane: "tree" };
    if (row.dataset.kind === "cat") return { kind: "cat", id: row.dataset.id, pane: "tree" };
    if (row.dataset.kind === "trash") return { kind: "trash-folder", id: "trash", pane: "tree" };
    // wiersz „Folder główny”: akcje w folderze głównym, nie w bieżącym
    return { kind: "root", id: "root", pane: "tree" };
  }
  treeEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (isTouchContextMenuWindow(treeEl)) return;
    void showContextMenu({ state, x: e.clientX, y: e.clientY, target: menuTarget(e.target) });
  });
  addLongPress(treeEl, (x, y, target) => {
    if (target?.closest?.(".tree-toggle")) return;
    void showContextMenu({ state, x, y, target: menuTarget(target) });
  });
}
