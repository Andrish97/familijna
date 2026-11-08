// base-explorerjs/ui/search.js
// Pole wyszukiwania: sam tekst zapytania (decyzja użytkownika 2026-10-21 —
// wyszukiwanie i filtry działają razem, tagi i kategorie filtruje się
// w lewym panelu, bez tabletek i „#tag” w polu). Tekst łączy się z filtrami
// z panelu (AND); „X” przy polu czyści tekst i filtry.
// Telefon: w pasku sam przycisk „Szukaj” (#btnSearchSheet); otwiera okno
// (#searchOverlay), do którego na czas edycji przenosimy to samo pole z paska
// (tam schowane) — dlatego nasłuch jest na dokumencie, nie na #toolbar.

import { setQuery, clearQuery } from "../state.js?v=v2026-11-08T15284";
import { renderAll } from "../render.js?v=v2026-11-08T15284";
import { openDialog, closeDialog } from "../../../../shared/js/core/modal-sheet.js?v=v2026-11-08T15284";
import { guardRoutedSheet } from "./sheet-guard.js?v=v2026-11-08T15284";

const TEXT_DELAY_MS = 200;

// Wpisany tekst czeka 200 ms; zmiana filtra z innego miejsca (lewy panel)
// najpierw go zatwierdza — inaczej klik w tag tuż po wyczyszczeniu pola
// łączyłby się jeszcze ze starym tekstem.
let commitPending = () => {};
export function commitPendingSearch() {
  commitPending();
}

export function wireSearch(state) {
  const root = document; // pole bywa w pasku albo w oknie „Szukaj”
  const inp = () => document.getElementById("searchText");

  let textTimer = null;

  function commitText(value) {
    clearTimeout(textTimer);
    textTimer = null;
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text === state.query.text) return;
    setQuery(state, { text });
    renderAll(state);
  }

  commitPending = () => {
    const el = inp();
    if (textTimer && el) commitText(el.value);
  };

  function clearAll() {
    clearTimeout(textTimer);
    textTimer = null;
    const el = inp();
    if (el) el.value = "";
    clearQuery(state);
    renderAll(state);
  }

  root.addEventListener("input", (e) => {
    const el = e.target;
    if (el?.id !== "searchText") return;
    clearTimeout(textTimer);
    textTimer = setTimeout(() => commitText(el.value), TEXT_DELAY_MS);
  });

  // Enter zatwierdza od razu (bez czekania 200 ms)
  root.addEventListener("keydown", (e) => {
    if (e.target?.id === "searchText" && e.key === "Enter") commitText(e.target.value);
  });

  root.addEventListener("click", (e) => {
    // telefon: przycisk „Szukaj” w pasku otwiera okno z polem
    if (e.target.closest("#btnSearchSheet")) { sheet.open(); return; }
    // „X” w polu: czyści tekst i filtry
    if (e.target.closest("#searchSubmitBtn")) {
      e.preventDefault();
      clearAll();
      inp()?.focus();
      return;
    }
    if (e.target.closest("#searchBox")) inp()?.focus();
  });

  const sheet = wireSearchSheet(state, { clear: clearAll, commit: () => commitPending() });
}

// Okno „Szukaj” na telefonie: przenosi #searchBox z paska do okna na czas
// edycji i oddaje go przy zamknięciu.
function wireSearchSheet(state, { clear, commit }) {
  const overlay = document.getElementById("searchOverlay");
  const body = document.getElementById("searchSheetBody");
  let open = false;
  let home = null;

  function show() {
    const box = document.getElementById("searchBox");
    if (!overlay || !body || !box || open) return;
    open = true;
    // szuflada lewego panelu (mobile.js) — także przy 601–900 px z myszą,
    // gdzie okno nie przechodzi w tryb od dołu i nie wysyła modal-sheet:enter
    document.dispatchEvent(new CustomEvent("explorer:close-drawer"));
    home = { parent: box.parentElement, next: box.nextSibling };
    body.append(box);
    openDialog(overlay, { onClose: hide });
    document.getElementById("searchText")?.focus();
  }

  function hide() {
    if (!open) return;
    open = false;
    commit();
    closeDialog(overlay);
    const box = document.getElementById("searchBox");
    if (home?.parent && box) home.parent.insertBefore(box, home.next?.parentNode === home.parent ? home.next : null);
    renderAll(state);
    // fokus wraca na przycisk „Szukaj” w pasku
    document.getElementById("btnSearchSheet")?.focus({ preventScroll: true });
  }

  document.getElementById("searchSheetDone")?.addEventListener("click", hide);
  document.getElementById("searchSheetClose")?.addEventListener("click", hide);
  document.getElementById("searchSheetClear")?.addEventListener("click", () => { clear(); document.getElementById("searchText")?.focus(); });
  // Enter w polu zatwierdza i zamyka okno
  document.addEventListener("keydown", (e) => {
    if (!open || e.key !== "Enter" || e.target?.id !== "searchText") return;
    e.preventDefault();
    hide();
  });
  window.matchMedia?.("(max-width: 980px)").addEventListener?.("change", (e) => { if (!e.matches) hide(); });

  guardRoutedSheet(overlay, () => open);
  return { open: show, close: hide, isOpen: () => open };
}
