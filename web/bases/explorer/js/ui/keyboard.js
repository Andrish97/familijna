// base-explorerjs/ui/keyboard.js
// Skróty klawiszowe. Skróty akcji pochodzą z rejestru (registry.js:
// shortcut); tu zostają tylko klawisze nawigacji i zaznaczania.
// Jedna bramka: przy otwartym oknie albo pisaniu w polu skróty nie działają.

import { ACTIONS } from "../actions/registry.js?v=v2026-11-05T22122";
import { buildContext } from "../actions/context.js?v=v2026-11-05T22122";
import { runAction } from "../actions/run.js?v=v2026-11-05T22122";
import { matchShortcut } from "../platform.js?v=v2026-11-05T22122";
import { selectionClear } from "../state.js?v=v2026-11-05T22122";
import { renderSelection } from "../render.js?v=v2026-11-05T22122";
import { goUp } from "../commands.js?v=v2026-11-05T22122";
import { isOverlayOpen } from "../../../../shared/js/core/modal-sheet.js?v=v2026-11-05T22122";
import { hideContextMenu, showContextMenu } from "../context-menu.js?v=v2026-11-05T22122";

const MODAL_IDS = ["questionOverlay", "tagsOverlay", "exportOverlay", "moveOverlay", "searchOverlay"];

function shortcutsBlocked() {
  const el = document.activeElement;
  const tag = String(el?.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select" || el?.isContentEditable) return true;
  if (el?.closest?.("#contextMenu")) return true; // klawisze należą do menu
  if (document.querySelector(".uni-modal")) return true;
  return MODAL_IDS.some((id) => {
    const m = document.getElementById(id);
    return isOverlayOpen(m);
  });
}

// Menu z klawiatury: przy pierwszym zaznaczonym wierszu jego panelu.
function openMenuFromKeyboard(state) {
  const pane = state.selection.pane === "tree" ? "tree" : "list";
  const root = document.getElementById(pane);
  const row = [...(root?.querySelectorAll(".row.is-selected[data-key]") || [])][0];
  const box = (row || document.getElementById("list"))?.getBoundingClientRect();
  if (!box) return;
  let target = { kind: "root", id: null, pane: "list" };
  if (row) {
    const { kind, id } = row.dataset;
    if (kind === "trash" && pane === "tree") target = { kind: "trash-folder", id: "trash", pane };
    else if (kind === "root" && pane === "tree") target = { kind: "root", id: "root", pane };
    else target = { kind, id, pane };
  }
  void showContextMenu({ state, x: box.left + 24, y: row ? box.bottom : box.top + 24, target, fromKeyboard: true });
}

export function wireKeyboard(state) {
  const withShortcut = ACTIONS.filter((a) => a.shortcut || a.altShortcut);

  document.addEventListener("keydown", async (e) => {
    // otwarte menu kontekstowe zamyka Escape (zanim cokolwiek innego)
    const cm = document.getElementById("contextMenu");
    if (cm && !cm.hidden && e.key === "Escape") {
      e.preventDefault();
      hideContextMenu({ animate: true });
      return;
    }
    if (shortcutsBlocked()) return;

    // Shift+F10 / klawisz menu: menu kontekstowe zaznaczenia (albo tła listy)
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      e.preventDefault();
      openMenuFromKeyboard(state);
      return;
    }

    const action = withShortcut.find((a) => (a.shortcut && matchShortcut(e, a.shortcut))
      || (a.altShortcut && matchShortcut(e, a.altShortcut)));
    if (action) {
      e.preventDefault();
      // przytrzymany klawisz nie powtarza akcji (np. wiele kopii z Ctrl+V)
      if (e.repeat) return;
      await runAction(action.id, buildContext(state, { source: "keys" }));
      return;
    }

    // Ctrl/⌘+A: wszystkie wiersze listy
    if (matchShortcut(e, { key: "KeyA", mod: true })) {
      e.preventDefault();
      state.selection.pane = "list";
      state.selection.keys = new Set(state.visibleListKeys || []);
      state.selection.anchorKey = null;
      renderSelection(state);
      return;
    }

    if (e.key === "Escape") {
      selectionClear(state);
      renderSelection(state);
      return;
    }

    // Backspace: w górę (z folderu do nadrzędnego)
    if (e.key === "Backspace" && state.location.kind === "folder") {
      e.preventDefault();
      await goUp(state);
    }
  });
}
