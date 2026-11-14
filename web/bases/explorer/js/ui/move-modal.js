// base-explorerjs/ui/move-modal.js
// Okno „Przenieś do… / Kopiuj do…” (E22 etap 9, prośba użytkownika
// 2026-10-21): drzewo folderów z wyszukiwaniem — zastępstwo przeciągania na
// telefonie i wygodne przenoszenie daleko w drzewie na komputerze.
// Zwraca wybrany folder (null = folder główny) albo undefined (anulowano).
// Przy przenoszeniu folderów nie da się wybrać ich samych ani ich wnętrza.

import { normalizeText } from "../data/listing.js?v=v2026-11-14T12020";
import { t } from "../../../../shared/translation/translation.js?v=v2026-11-14T12020";
import { icon } from "../../../../shared/js/core/icons.js?v=v2026-11-14T12020";
import { guardRoutedSheet } from "./sheet-guard.js?v=v2026-11-14T12020";
import { esc, treeToggleHtml, treeIconName, treeRowInner, treeLines } from "./tree-row.js?v=v2026-11-14T12020";
import { openDialog, closeDialog } from "../../../../shared/js/core/modal-sheet.js?v=v2026-11-14T12020";
import { emptyStateHtml } from "../../../../shared/js/core/empty-state.js?v=v2026-11-14T12020";

const ROOT = "root";

let active = null; // jedno okno naraz
guardRoutedSheet(typeof document !== "undefined" ? document.getElementById("moveOverlay") : null, () => !!active);

/**
 * mode: "move" | "copy"
 * blockedIds: foldery, których nie wolno wybrać (przenoszone i ich wnętrze)
 * startId: folder, od którego zacząć (rozwinięta ścieżka, zaznaczony)
 */
export function openMoveModal(state, { mode = "move", blockedIds = new Set(), startId = null } = {}) {
  const overlay = document.getElementById("moveOverlay");
  const list = document.getElementById("moveList");
  const search = document.getElementById("moveSearch");
  const ok = document.getElementById("moveOk");
  if (!overlay || !list || !search || !ok) return Promise.resolve(undefined);
  active?.(undefined);

  const d = state.d;
  // foldery osiągalne z folderu głównego (uszkodzone dane z cyklem nie trafiają do wyników)
  const reachable = new Set();
  const stack = [...d.childFolders(null)];
  while (stack.length) {
    const f = stack.pop();
    if (reachable.has(f.id)) continue;
    reachable.add(f.id);
    stack.push(...d.childFolders(f.id));
  }
  const open = new Set([ROOT]);
  for (const id of [startId, ...(startId ? d.ancestorIds(startId) : [])]) if (id) open.add(id);
  let picked = null; // ROOT | id folderu
  let query = "";

  document.getElementById("moveTitle").textContent = t(mode === "copy" ? "baseExplorer.move.copyTitle" : "baseExplorer.move.moveTitle");
  ok.innerHTML = `${icon(mode === "copy" ? "copy" : "folder")} ${esc(t(mode === "copy" ? "baseExplorer.move.copyHere" : "baseExplorer.move.moveHere"))}`;
  search.value = "";

  // Ten sam wygląd co drzewo w lewym panelu (ui/tree-row.js, decyzja
  // użytkownika 2026-10-21); wybrany folder zaznaczony jak na liście.
  const countOf = (key) => (key === ROOT ? d.questionById.size : d.subtreeQuestionIds(key).length);
  const rowHtml = (key, label, { depth = 0, canToggle = false, isOpen = false, path = "", lines = [] } = {}) => {
    const isRoot = key === ROOT;
    const blocked = !isRoot && blockedIds.has(key);
    const cls = ["tree-row", "moveRow", isRoot ? "is-root" : "", picked === key ? "is-selected is-picked" : "", blocked ? "is-blocked" : ""].filter(Boolean).join(" ");
    const inner = treeRowInner({
      lines,
      toggle: path ? "" : treeToggleHtml(key, { canToggle, isOpen }),
      iconName: treeIconName(isRoot ? "root" : "cat", isOpen),
      label, path, count: countOf(key),
    });
    return `<div class="${cls}" role="treeitem" data-id="${esc(key)}" style="--depth:${depth}"${blocked ? ' aria-disabled="true"' : ""}${canToggle ? ` aria-expanded="${isOpen}"` : ""}>${inner}</div>`;
  };

  function treeHtml() {
    const out = [];
    const walk = (parentId, depth, cont) => {
      const kids = d.childFolders(parentId);
      kids.forEach((f, i) => {
        const isLast = i === kids.length - 1;
        const canToggle = d.childFolders(f.id).length > 0;
        const isOpen = canToggle && open.has(f.id);
        out.push(rowHtml(f.id, f.name || t("baseExplorer.defaults.folder"), { depth, canToggle, isOpen, lines: treeLines(cont, isLast) }));
        if (isOpen) walk(f.id, depth + 1, [...cont, !isLast]);
      });
    };
    const rootKids = d.childFolders(null).length > 0;
    const rootOpen = rootKids && open.has(ROOT);
    out.push(rowHtml(ROOT, t("baseExplorer.tree.root"), { canToggle: rootKids, isOpen: rootOpen }));
    if (rootOpen) walk(null, 1, []);
    return out.join("");
  }

  // wyszukiwanie: płaska lista pasujących folderów ze ścieżką
  function resultsHtml() {
    const words = normalizeText(query).split(/\s+/).filter(Boolean);
    const hits = [...d.folderById.values()].filter((f) => reachable.has(f.id) && words.every((w) => d.folderSearchText(f.id).includes(w)));
    if (!hits.length) return emptyStateHtml(t("baseExplorer.move.noFolders"), { variant: "inline", hook: "list-empty" });
    const pathOf = (f) => [...d.ancestorIds(f.id)].reverse().map((id) => d.folderById.get(id)?.name || "").join(" / ");
    return hits
      .sort((a, b) => String(a.name).localeCompare(String(b.name), "pl", { sensitivity: "base" }))
      .map((f) => rowHtml(f.id, f.name || t("baseExplorer.defaults.folder"), { path: pathOf(f) || t("baseExplorer.tree.root") }))
      .join("");
  }

  function render() {
    list.innerHTML = query.trim() ? resultsHtml() : treeHtml();
    // wybór spoza widocznej listy (np. po wpisaniu frazy) nie obowiązuje —
    // Enter / „Przenieś tutaj” nie trafiłyby w niewidoczny folder
    if (picked !== null && !list.querySelector(`.moveRow[data-id="${CSS.escape(picked)}"]`)) picked = null;
    ok.disabled = picked === null;
  }

  return new Promise((resolve) => {
    const returnFocus = document.activeElement;
    const finish = (value) => {
      active = null;
      list.onclick = null;
      list.ondblclick = null;
      search.oninput = null;
      document.removeEventListener("keydown", onKey, true);
      document.getElementById("moveClose").onclick = null;
      document.getElementById("moveCancel").onclick = null;
      ok.onclick = null;
      closeDialog(overlay);
      // fokus wraca tam, skąd otwarto okno (menu kontekstowe znika — wtedy lista)
      const back = returnFocus?.isConnected && returnFocus.offsetParent !== null ? returnFocus : document.getElementById("list");
      back?.focus?.({ preventScroll: true });
      resolve(value);
    };
    active = finish;
    const confirm = () => { if (picked !== null) finish(picked === ROOT ? null : picked); };

    list.onclick = (e) => {
      const tog = e.target.closest(".tree-toggle[data-id]");
      if (tog) {
        const id = tog.dataset.id;
        if (open.has(id)) open.delete(id); else open.add(id);
        render();
        return;
      }
      const row = e.target.closest(".moveRow[data-id]");
      if (!row || row.classList.contains("is-blocked")) return;
      // samo przełączenie klasy (bez przerysowania) — inaczej dwuklik
      // trafiałby w dwa różne elementy i przeglądarka by go nie zgłosiła
      picked = row.dataset.id;
      list.querySelectorAll(".moveRow.is-picked").forEach((el) => el.classList.remove("is-picked", "is-selected"));
      row.classList.add("is-picked", "is-selected");
      ok.disabled = false;
    };
    list.ondblclick = (e) => {
      const row = e.target.closest(".moveRow[data-id]");
      if (!row || row.classList.contains("is-blocked") || e.target.closest(".tree-toggle")) return;
      picked = row.dataset.id;
      confirm();
    };
    search.oninput = () => { query = search.value; render(); };
    // Enter zatwierdza (Esc i tło — wspólna obsługa okien) (fokus bywa poza oknem — na dokumencie)
    // Enter na przycisku (Anuluj, X, strzałka) działa jak ten przycisk; w polu
    // szukania z jednym wynikiem wybiera go.
    function onKey(e) {
      if (e.key !== "Enter") return;
      if (e.target?.closest?.("button") && e.target !== ok) return;
      if (picked === null && e.target === search) {
        const rows = list.querySelectorAll(".moveRow[data-id]:not(.is-blocked)");
        if (rows.length === 1) picked = rows[0].dataset.id;
      }
      if (picked === null) return;
      e.preventDefault();
      e.stopPropagation();
      confirm();
    }
    document.addEventListener("keydown", onKey, true);
    document.getElementById("moveClose").onclick = () => finish(undefined);
    document.getElementById("moveCancel").onclick = () => finish(undefined);
    ok.onclick = confirm;

    // start: folder, w którym jesteśmy (jeśli wolno go wybrać)
    if (startId && !blockedIds.has(startId)) picked = startId;
    render();
    document.dispatchEvent(new CustomEvent("explorer:close-drawer"));
    openDialog(overlay, { onClose: () => finish(undefined) });
    list.querySelector(".is-picked")?.scrollIntoView({ block: "nearest" });
    // fokus w oknie; na dotyku bez pola tekstowego (klawiatura zasłoniłaby drzewo)
    if (window.matchMedia?.("(pointer: fine)").matches) search.focus({ preventScroll: true });
    else {
      const box = overlay.querySelector(".modal");
      box?.setAttribute("tabindex", "-1");
      box?.focus({ preventScroll: true });
    }
  });
}
