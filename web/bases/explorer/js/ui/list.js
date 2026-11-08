// base-explorerjs/ui/list.js
// Lista (prawa strona): zaznaczanie (klik, Ctrl/⌘, Shift, ramka), otwieranie
// (dwuklik / podwójne stuknięcie), menu kontekstowe (PPM / przytrzymanie)
// i sortowanie klikiem w nagłówek.

import { selectionClear, selectionSetSingle, selectionToggle, selectionRange, setSort } from "../state.js?v=v2026-11-08T15451";
import { renderList, renderSelection, LIST_COLUMNS } from "../render.js?v=v2026-11-08T15451";
import { openFolderFromList, editQuestion } from "../commands.js?v=v2026-11-08T15451";
import { showContextMenu } from "../context-menu.js?v=v2026-11-08T15451";
import { attachMarquee } from "./marquee.js?v=v2026-11-08T15451";
import { addLongPress, addDoubleTap, isTouchContextMenuWindow } from "../mobile.js?v=v2026-11-08T15451";
import { isModKey } from "../platform.js?v=v2026-11-08T15451";

const ROW = ".row[data-key]";

export function wireList(state) {
  const listEl = document.getElementById("list");
  if (!listEl) return;

  const marquee = attachMarquee(listEl, {
    rowSelector: `tbody ${ROW}`,
    getBase: () => (state.selection.pane === "list" ? state.selection.keys : new Set()),
    onSelect: (keys, final) => {
      if (final) return;
      state.selection.pane = "list";
      state.selection.keys = keys;
      state.selection.anchorKey = null;
      renderSelection(state);
    },
  });

  listEl.addEventListener("click", (e) => {
    if (marquee.consumeClick()) return;

    const th = e.target.closest(".list-head th[data-sort-key]");
    if (th) {
      if (e.target.closest(".col-resizer")) return;
      const key = th.dataset.sortKey;
      const col = LIST_COLUMNS.find((c) => c.key === key);
      const dir = state.sort.key === key ? (state.sort.dir === "asc" ? "desc" : "asc") : (col?.sort || "asc");
      setSort(state, key, dir);
      renderList(state);
      return;
    }

    const row = e.target.closest(ROW);
    if (!row) {
      if (e.target.closest(".list-head")) return;
      selectionClear(state);
      renderSelection(state);
      return;
    }
    const key = row.dataset.key;
    if (e.shiftKey) selectionRange(state, state.visibleListKeys || [], key, "list");
    else if (isModKey(e)) selectionToggle(state, key, "list");
    else selectionSetSingle(state, key, "list");
    renderSelection(state);
  });

  async function open(row) {
    if (!row) return;
    const { kind, id } = row.dataset;
    if (kind === "cat") await openFolderFromList(state, id);
    else if (kind === "q" && state.canEdit) await editQuestion(state, id);
  }
  listEl.addEventListener("dblclick", (e) => open(e.target.closest(ROW)));
  addDoubleTap(listEl, (target) => open(target?.closest?.(ROW)));

  function menuTarget(target) {
    const row = target?.closest?.(ROW);
    if (row) return { kind: row.dataset.kind, id: row.dataset.id, pane: "list" };
    return { kind: "root", id: null, pane: "list" };
  }
  listEl.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (isTouchContextMenuWindow(listEl)) return; // menu otwiera przytrzymanie (mobile.js)
    if (e.target.closest(".list-head")) return;
    void showContextMenu({ state, x: e.clientX, y: e.clientY, target: menuTarget(e.target) });
  });
  addLongPress(listEl, (x, y, target) => {
    if (target?.closest?.(".list-head")) return;
    void showContextMenu({ state, x, y, target: menuTarget(target) });
  });
}
