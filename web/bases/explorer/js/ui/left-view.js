// base-explorerjs/ui/left-view.js
// Widoki lewego panelu (decyzja użytkownika 2026-10-21): drzewo, tagi albo
// proponowane kategorie — jeden naraz, na pełną wysokość. Przyciski działają
// jak radio. Komputer: „Tagi” i „Kategorie” obok wyszukiwarki, ponowny klik
// wraca do drzewa. Telefon: drzewo / tagi / kategorie zamiast hamburgera —
// przycisk otwiera panel z tym widokiem, ponowne stuknięcie go zamyka.

import { renderAll, renderToolbar, isNarrow } from "../render.js?v=v2026-11-03T22594";
import { selectionClear } from "../state.js?v=v2026-11-03T22594";
import { initDrawer } from "../mobile.js?v=v2026-11-03T22594";

// Schowane drzewo nie trzyma zaznaczenia — skróty (Usuń, F2…) działałyby
// na niewidocznych folderach.
function setView(state, view) {
  if (view !== "tree" && state.selection.pane === "tree") { selectionClear(state); state.selection.pane = "list"; }
  state.leftView = view;
}

export function wireLeftView(state) {
  const toolbar = document.getElementById("toolbar");
  const drawer = initDrawer({ onChange: () => renderToolbar(state) });
  if (!toolbar) return;

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-left-view]");
    if (!btn) return;
    const view = btn.dataset.leftView;
    if (isNarrow()) {
      if (drawer?.isOpen() && state.leftView === view) { drawer.close(); return; }
      setView(state, view);
      renderAll(state);
      drawer?.open();
      return;
    }
    setView(state, state.leftView === view ? "tree" : view);
    renderAll(state);
  });

  // na komputerze nie ma szuflady; widok zostaje, przyciski się odświeżają
  window.matchMedia?.("(max-width: 980px)").addEventListener?.("change", () => {
    if (!isNarrow()) drawer?.close();
    renderToolbar(state);
  });
}
