// base-explorerjs/context-menu.js
// Menu kontekstowe (PPM / przytrzymanie). Pozycje pochodzą z rejestru akcji
// (registry.js: menu + menuGroup), dostępność i wykonanie z tego samego
// kontekstu co pasek i skróty.
// Na komputerze menu przy kursorze; na telefonie i tablecie dotykowym okno
// od dołu wyglądające jak pozostałe okna (wzorzec „okno od dołu” z
// shared/style/components.css i modal-sheet.js): przyciemnione tło, rogi 28 px,
// pasek do przeciągania, wysuwanie i zjazd z animacją, safe area.
import { placeAtPoint } from "../../../shared/js/core/popover.js?v=v2026-11-08T09312";
import { clearFloat } from "../../../shared/js/core/geometry.js?v=v2026-11-08T09312";
import { selectionSetSingle } from "./state.js?v=v2026-11-08T09312";
import { ACTIONS, MENU_GROUPS, actionState } from "./actions/registry.js?v=v2026-11-08T09312";
import { buildContext } from "./actions/context.js?v=v2026-11-08T09312";
import { runAction } from "./actions/run.js?v=v2026-11-08T09312";
import { formatShortcut } from "./platform.js?v=v2026-11-08T09312";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-08T09312";
import { renderSelection } from "./render.js?v=v2026-11-08T09312";
import { icon } from "../../../shared/js/core/icons.js?v=v2026-11-08T09312";
import { isSheetLayout } from "../../../shared/js/core/device-attrs.js?v=v2026-11-08T09312";

const CLOSE_MS = 230;
// Palec puszczony po przytrzymaniu daje „klik” bez wciśnięcia w menu —
// pozycja wykonuje się tylko po wciśnięciu, które zaczęło się w menu
// (albo z klawiatury: klik bez wciśnięcia, detail === 0).
let pressedInside = false;
let wired = false;
// Zdarzenie „scroll” przychodzi w następnej klatce — przewinięcie sprzed
// otwarcia (np. panel przewinięty do klikniętego wiersza) nie zamyka menu.
const SCROLL_GRACE_MS = 250;
let openedAt = 0;
let closingTimer = null;

// Ten sam warunek co okna od dołu (data-sheet, core/device-attrs.js).
const isSheet = () => isSheetLayout();
const menuEl = () => document.getElementById("contextMenu");

function backdrop() {
  let el = document.getElementById("contextMenuBackdrop");
  if (!el) {
    el = document.createElement("div");
    el.id = "contextMenuBackdrop";
    el.className = "context-menu-backdrop";
    el.hidden = true;
    menuEl()?.before(el);
  }
  return el;
}

export function isContextMenuOpen() {
  const cm = menuEl();
  return !!cm && !cm.hidden;
}

function hideNow() {
  clearTimeout(closingTimer);
  closingTimer = null;
  const cm = menuEl();
  if (cm) {
    cm.hidden = true;
    cm.innerHTML = "";
    cm.classList.remove("is-sheet", "is-closing", "is-dragging", "is-settling");
    cm.style.removeProperty("--cm-drag");
  }
  const bd = document.getElementById("contextMenuBackdrop");
  if (bd) { bd.hidden = true; bd.classList.remove("is-closing"); }
}

// animate: arkusz zjeżdża w dół, tło gaśnie (tło łapie też „klik” po
// dotknięciu, więc nie trafia on w wiersz pod spodem)
export function hideContextMenu({ animate = false } = {}) {
  const cm = menuEl();
  if (!cm || cm.hidden) return;
  if (!animate || !cm.classList.contains("is-sheet")) { hideNow(); return; }
  if (closingTimer) return;
  cm.classList.add("is-closing");
  document.getElementById("contextMenuBackdrop")?.classList.add("is-closing");
  closingTimer = setTimeout(hideNow, CLOSE_MS);
}

// Zamykanie: dotknięcie / klik poza menu, przewinięcie, zmiana rozmiaru.
function wireClose() {
  if (wired) return;
  wired = true;
  document.addEventListener("pointerdown", (e) => {
    if (!isContextMenuOpen()) return;
    if (e.target.closest?.("#contextMenu")) return;
    hideContextMenu({ animate: true });
  }, true);
  // arkusz dopasowuje się sam; zmiana rozmiaru zamyka tylko menu przy kursorze
  window.addEventListener("resize", () => { if (!menuEl()?.classList.contains("is-sheet")) hideContextMenu(); });
  document.addEventListener("scroll", (e) => {
    if (e.target?.closest?.("#contextMenu")) return; // przewijanie samego arkusza
    if (performance.now() - openedAt < SCROLL_GRACE_MS) return;
    hideContextMenu({ animate: true });
  }, true);
  window.addEventListener("blur", () => hideContextMenu());
}

// Pasek u góry arkusza: stuknięcie albo przeciągnięcie w dół zamyka
// (jak sheetHandle w modal-sheet.js).
function sheetHandle(cm) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "cm-handle";
  handle.setAttribute("aria-label", t("common.modal.closeLabel"));
  let startY = null, lastY = 0, lastT = 0, velocity = 0, moved = false;
  const setDrag = (px) => cm.style.setProperty("--cm-drag", `${Math.max(0, px)}px`);
  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY; lastY = e.clientY; lastT = e.timeStamp; velocity = 0; moved = false;
    handle.setPointerCapture?.(e.pointerId);
    cm.classList.add("is-dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    velocity = (e.clientY - lastY) / Math.max(1, e.timeStamp - lastT);
    lastY = e.clientY; lastT = e.timeStamp;
    setDrag(dy);
  });
  const end = () => {
    if (startY === null) return;
    const dy = lastY - startY;
    startY = null;
    cm.classList.remove("is-dragging");
    const limit = Math.min(160, cm.offsetHeight * 0.25);
    if (!moved || dy > limit || velocity > 0.6) { hideContextMenu({ animate: true }); return; }
    cm.classList.add("is-settling");
    setDrag(0);
    setTimeout(() => cm.classList.remove("is-settling"), 240);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  return handle;
}

function itemHtml(item, idx) {
  if (item.sep) return `<div class="cm-sep" role="separator" aria-hidden="true"></div>`;
  const cls = item.danger ? "menu-item is-danger" : "menu-item";
  const kbd = item.shortcut ? `<span class="cm-kbd">${item.shortcut}</span>` : "";
  const why = item.disabled && item.reason ? ` title="${item.reason}"` : "";
  return `<button type="button" role="menuitem" class="${cls}" data-idx="${idx}"${item.id ? ` data-action="${item.id}"` : ""}${item.disabled ? " aria-disabled=\"true\"" : ""}${why}>
    ${item.icon ? icon(item.icon) : ""}<span>${item.label}</span>${kbd}
  </button>`;
}

// Jak w Eksploratorze: menu na niezaznaczonym wierszu najpierw go zaznacza
// (w tym panelu), na wierszu z zaznaczenia zostawia zaznaczenie.
function selectTargetFirst(state, target) {
  const prefix = { cat: "c:", q: "q:", trash: "t:" }[target?.kind];
  if (!prefix || !target.id) return false;
  const key = prefix + target.id;
  const pane = target.pane || "list";
  if (state.selection.pane === pane && state.selection.keys.has(key)) return false;
  selectionSetSingle(state, key, pane);
  return true;
}

function menuItems(ctx) {
  const kind = ctx.target?.kind;
  const items = [];
  for (const group of MENU_GROUPS) {
    let added = false;
    for (const a of ACTIONS) {
      if (a.menuGroup !== group || !a.menu?.includes(kind)) continue;
      const st = actionState(a, ctx);
      if (!st.visible) continue;
      if (!added && items.length) items.push({ sep: true });
      added = true;
      items.push({
        id: a.id,
        label: t(a.label(ctx)),
        icon: a.icon,
        danger: !!a.danger,
        shortcut: a.shortcut ? formatShortcut(a.shortcut) : "",
        disabled: !st.enabled,
        reason: st.reason ? t(st.reason) : "",
      });
    }
  }
  return items;
}

// Klawiatura w otwartym menu: strzałki / Home / End po dostępnych
// pozycjach, Enter i spacja wykonują (przycisk), Tab zamyka.
function onMenuKeydown(e) {
  const cm = e.currentTarget;
  const items = [...cm.querySelectorAll(".menu-item:not([aria-disabled='true'])")];
  if (!items.length) return;
  const i = items.indexOf(document.activeElement);
  let next = null;
  if (e.key === "ArrowDown") next = items[(i + 1) % items.length];
  else if (e.key === "ArrowUp") next = items[(i - 1 + items.length) % items.length];
  else if (e.key === "Home") next = items[0];
  else if (e.key === "End") next = items[items.length - 1];
  else if (e.key === "Tab") { e.preventDefault(); hideContextMenu(); return; }
  if (!next) return;
  e.preventDefault();
  e.stopPropagation();
  next.focus({ preventScroll: false });
}

// fromKeyboard: otwarte klawiszem (Shift+F10 / klawisz menu) — fokus od
// razu na pierwszej dostępnej pozycji.
export async function showContextMenu({ state, x, y, target, fromKeyboard = false }) {
  const cm = document.getElementById("contextMenu");
  if (!cm) return;
  wireClose();
  hideNow();

  if (selectTargetFirst(state, target)) renderSelection(state);

  const ctx = buildContext(state, { source: "menu", target });
  const items = menuItems(ctx);
  if (!items.length) return;

  cm.setAttribute("role", "menu");
  cm.innerHTML = items.map(itemHtml).join("");
  cm.onclick = async (e) => {
    const btn = e.target.closest(".menu-item[data-idx]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (!pressedInside && e.detail !== 0) return;
    const it = items[Number(btn.dataset.idx)];
    if (!it || it.disabled) return;
    hideContextMenu();
    await runAction(it.id, ctx);
  };
  pressedInside = false;
  openedAt = performance.now();
  cm.onpointerdown = () => { pressedInside = true; };
  cm.onkeydown = onMenuKeydown;

  if (isSheet()) {
    cm.classList.add("is-sheet");
    clearFloat(cm);
    cm.prepend(sheetHandle(cm));
    backdrop().hidden = false;
    cm.hidden = false;
  } else {
    placeAtPoint(cm, x, y);
  }
  if (fromKeyboard) cm.querySelector(".menu-item:not([aria-disabled='true'])")?.focus({ preventScroll: true });
}
