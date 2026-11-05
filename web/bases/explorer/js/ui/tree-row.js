import { escapeHtmlAttribute as esc } from "../../../../shared/js/core/html-escape.js?v=v2026-11-05T14442";
export { esc };
// base-explorerjs/ui/tree-row.js
// Jeden wygląd drzewa folderów (decyzja użytkownika 2026-10-21): lewy panel
// i okno „Przenieś do / Kopiuj do” rysują wiersz tym samym kodem i tymi
// samymi klasami (.tree-row w base-explorer.css): linie prowadzące wcięć
// z --depth, strzałka, folder otwarty/zamknięty, nazwa, kropki i liczba pytań.

import { t } from "../../../../shared/translation/translation.js?v=v2026-11-05T14442";
import { icon } from "../../../../shared/js/core/icons.js?v=v2026-11-05T14442";


/** Strzałka rozwijania (albo puste miejsce tej samej szerokości). */
export function treeToggleHtml(id, { canToggle, isOpen }) {
  return canToggle
    ? `<button type="button" class="btn-plain tree-toggle" data-id="${esc(id)}" aria-label="${esc(t("baseExplorer.tree.toggle"))}">${icon(isOpen ? "caret-down" : "caret-right")}</button>`
    : `<span class="tree-toggle-space"></span>`;
}

/** Ikona wiersza: dom (folder główny), kosz, folder otwarty albo zamknięty. */
export function treeIconName(kind, isOpen) {
  if (kind === "root") return "home";
  if (kind === "trash") return "trash";
  return isOpen ? "folder-open" : "folder";
}

/**
 * Linie prowadzące wiersza na poziomie `depth`: dla każdego poziomu przodka
 * "pipe" (│, gałąź biegnie dalej) albo "none", a na poziomie rodzica "tee"
 * (├, są dalsze rodzeństwo) albo "end" (└, ostatnie dziecko — linia kończy
 * się na wierszu, nie jest ucięta). `cont` = czy przodkowie mają dalsze
 * rodzeństwo (wołający dokłada `!isLast` przy zejściu poziom niżej).
 */
export function treeLines(cont, isLast) {
  return [...cont.map((c) => (c ? "pipe" : "none")), isLast ? "end" : "tee"];
}

/** Wnętrze wiersza (bez samego elementu wiersza — atrybuty zostają u wywołującego). */
export function treeRowInner({ lines = [], toggle, iconName, label, path = "", extra = "", count = null }) {
  const guides = lines.map((l, k) => (l === "none" ? "" : `<i class="tree-g tree-g-${l}" style="--k:${k}"></i>`)).join("");
  return `<span class="tree-guides" aria-hidden="true">${guides}</span>${toggle}`
    + `<span class="tree-ico">${icon(iconName, { className: "list-ico" })}</span>`
    + `<span class="tree-text"><span class="tree-name title-text">${esc(label)}</span>${path ? `<span class="tree-path movePath">${esc(path)}</span>` : ""}</span>`
    + extra
    + (count == null ? "" : `<span class="badge badge--muted">${count}</span>`);
}
