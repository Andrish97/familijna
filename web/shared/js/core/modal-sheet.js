// js/core/modal-sheet.js
// Tryb "sheet" dla rozbudowanych modali na telefonie: zamiast wyśrodkowanego
// okna na przyciemnionym tle, treść strony jest zastępowana treścią modala
// (topbar i stopka zostają widoczne) — patrz css/base.css, sekcja
// "Modal sheet (mobile)".
//
// Wyjściem z modala w tym trybie jest ISTNIEJĄCY przycisk wstecz w
// topbarze danej strony (przejmuje tekst/zachowanie na czas otwarcia
// modala), a nie osobny przycisk wewnątrz modala — analogicznie do tego,
// jak editor.js/editor.css robi to swoim jedynym `btnBack`.

import { t } from "../../translation/translation.js?v=v2026-11-05T19195";
import { dialogAllowed } from "./nav-map.js?v=v2026-11-05T19195";
import { isSheetLayout, onDeviceChange } from "./device-attrs.js?v=v2026-11-05T19195";

// Esc zamyka najwyższe widoczne okno tak samo jak jego X w nagłówku (jedna
// obsługa dla wszystkich okien .overlay); „Anuluj” z [data-modal-cancel] też
// klika ten X. Okna z własną obsługą Esc wołają preventDefault, więc tu ich
// już nie zamykamy drugi raz. Okna blokujące bez X (np. eksport w toku)
// zostają otwarte.
const ESC_CLOSE_SELECTOR = [".mHead", ".uni-head", ".tagsHead", ".bld-preview-head", ".mkt-detail-head", ".previewModalTitle"]
  .map((head) => `${head} button:has(use[href*="/close.svg?v=v2026-11-05T19195"])`).join(", ");
// Na telefonie (arkusz) X bywa ukryty — wtedy bierzemy pierwszy dostępny.
const visibleCloseButton = (root) => {
  const all = [...root.querySelectorAll(ESC_CLOSE_SELECTOR)].filter((btn) => !btn.disabled);
  return all.find((btn) => btn.getClientRects().length > 0) || all[0] || null;
};
// Nasłuch na window: działa po obsługach okien na document.
if (typeof window !== "undefined" && typeof document !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    const open = [...document.querySelectorAll(".overlay")]
      .filter((el) => !el.hidden && getComputedStyle(el).display !== "none");
    const closeBtn = open.length ? visibleCloseButton(open.at(-1)) : null;
    if (!closeBtn) return;
    e.preventDefault();
    closeBtn.click();
  });
  // Klik w przyciemnione tło zamyka okno jak Esc (jedna reguła dla wszystkich
  // okien, E23 §6.2); okno od dołu zjeżdża z animacją. Liczy się tylko klik,
  // który zaczął się na tle (zaznaczanie tekstu w oknie kończone poza nim nie
  // zamyka). Okna bez X (blokujące) zostają otwarte.
  let pressedBackdrop = null;
  document.addEventListener("pointerdown", (e) => {
    pressedBackdrop = e.target?.classList?.contains("overlay") ? e.target : null;
  }, true);
  document.addEventListener("click", (e) => {
    const overlay = e.target;
    if (!overlay?.classList?.contains("overlay") || overlay !== pressedBackdrop) return;
    pressedBackdrop = null;
    if (overlay === activeOverlay && overlay.classList.contains("sheet-active")) { closeSheetAnimated(); return; }
    visibleCloseButton(overlay)?.click();
  });
  document.addEventListener("click", (e) => {
    const cancel = e.target.closest?.("[data-modal-cancel]");
    if (!cancel) return;
    for (let el = cancel.parentElement; el && !el.classList.contains("overlay"); el = el.parentElement) {
      const closeBtn = visibleCloseButton(el);
      if (closeBtn) { closeBtn.click(); return; }
    }
  });
}

// Okno od dołu: data-sheet na <html> (core/device-attrs.js — dotyk albo
// okno do 600 px); ten sam atrybut czyta CSS.

let activeClose = null;
let activeBack = null;
let activeOverlay = null;
let activeDialogKey = null;
let handlingPopstate = false;
const sheetRoutes = new Map();
let currentPageId = null;
const sheetLayouts = new WeakMap();

function urlDialog() {
  const href = typeof location !== "undefined" && location.href ? location.href : "/";
  return new URL(href, "https://familijna.invalid").searchParams.get("dialog");
}

function setUrlDialog(key, push) {
  const url = new URL(location.href || "/", "https://familijna.invalid");
  if (key) url.searchParams.set("dialog", key);
  else url.searchParams.delete("dialog");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (push) history.pushState({ ...(history.state || {}), __sheetDialog: key }, "", next);
  else history.replaceState(history.state, "", next);
}

function showRoutedOverlay(el) {
  if (!el) return false;
  setOverlayOpen(el, true);
  el.dataset.routed = "true";
  const close = () => {
    setOverlayOpen(el, false);
    exitModalSheet(el);
  };
  enterModalSheet(el, { onClose: close, historyKey: el.id, restore: false });
  return true;
}

function onModalPopstate() {
  const key = urlDialog();
  if (activeClose && key !== activeDialogKey) {
    handlingPopstate = true;
    try { activeClose(); } finally { handlingPopstate = false; }
  }
  if (key && activeDialogKey !== key) {
    const route = sheetRoutes.get(key);
    if (route) {
      setOverlayOpen(route.overlay, true);
      route.overlay.dataset.routed = "true";
      enterModalSheet(route.overlay, { ...route.options, historyKey: key, restore: true });
    } else {
      showRoutedOverlay(document.getElementById(key));
    }
  }
}

if (typeof window !== "undefined") window.addEventListener("popstate", onModalPopstate);

/**
 * Okno (nakładka .overlay): jeden sposób pokazywania i chowania — atrybut
 * hidden (silnik: [hidden] { display: none } w warstwie states). Czyści dawne
 * style.display i klasę .hidden, żeby nie mieszać trzech mechanizmów.
 */
export function setOverlayOpen(el, open) {
  if (!el) return;
  if (open) cancelClose(el);
  delete el.dataset.routed; // pokazanie „z adresu” oznacza showRoutedOverlay
  el.hidden = !open;
  el.classList.remove("hidden");
  el.style.removeProperty("display");
}

/** Czy okno jest pokazane (atrybut hidden i obliczony display). */
export function isOverlayOpen(el) {
  return !!el && !el.hidden && getComputedStyle(el).display !== "none";
}

export function setModalSheetPage(pageId) {
  currentPageId = pageId;
  if (typeof window === "undefined" || typeof location === "undefined" || !location.href) return;
  const key = urlDialog();
  if (!key) return;
  const allowed = dialogAllowed(pageId, key);
  if (allowed && key === "contactModalOverlay") {
    setTimeout(() => {
      if (urlDialog() !== key) return;
      import("./contact-modal.js?v=v2026-11-05T19195").then((module) => module.openContactModal());

    }, 0);
    return;
  }
  const overlay = allowed ? document.getElementById(key) : null;
  if (overlay) {
    // A directly opened URL still gets an in-page parent history entry, so
    // Back closes the dialog instead of leaving the site. Refresh preserves
    // the marker and does not add another layer.
    if (history.state?.__sheetDialog !== key) {
      const dialogUrl = new URL(location.href);
      const parentUrl = new URL(dialogUrl);
      parentUrl.searchParams.delete("dialog");
      history.replaceState({ ...(history.state || {}), __sheetParent: key }, "", `${parentUrl.pathname}${parentUrl.search}${parentUrl.hash}`);
      history.pushState({ __sheetDialog: key }, "", `${dialogUrl.pathname}${dialogUrl.search}${dialogUrl.hash}`);
    }
    setTimeout(() => { if (!activeClose && urlDialog() === key) showRoutedOverlay(overlay); }, 0);
  }
  else {
    const url = new URL(location.href);
    url.searchParams.delete("dialog");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

export function isSheetViewport() {
  return isSheetLayout();
}

// Arkusze mają wspólny szkielet tylko w prezentacji mobilnej: sam nagłówek,
// pasek akcji oraz osobno przewijaną treść z podpowiedziami. Wrappery są display:contents
// poza trybem sheet, więc układ desktopowy i istniejące selektory pozostają.
function prepareSheetLayout(overlayEl) {
  const modal = overlayEl?.querySelector(":scope > .modal");
  if (!modal || modal.dataset.sheetLayoutReady === "1") return;
  // Okno z warstwami (.modal-layer, np. tagi: lista → nowy tag → kolor):
  // każda warstwa dostaje własny nagłówek, pasek akcji i treść.
  const layers = [...modal.children].filter(el => el.matches(".modal-layer"));
  if (layers.length) {
    sheetLayouts.set(modal, { childNodes: [...modal.childNodes], nested: [] });
    for (const layer of layers) layoutSheetBox(layer, { layer: true });
  } else {
    layoutSheetBox(modal);
  }
  modal.prepend(sheetHandle(overlayEl));
  modal.dataset.sheetLayoutReady = "1";
}

function layoutSheetBox(box, { layer = false } = {}) {
  const children = [...box.children];
  const headerSelectors = [".uni-head", ".mHead", ".tagsHead", ".bld-preview-head", ".bld-preview-switch", ".mkt-detail-head", ".previewModalTitle", ".mTitle"];
  const actionSelectors = [".uni-foot", ".modal-actions", ".tagsFoot", ".mkt-detail-actions"];
  const nestedActionSelectors = [".baseShareLookup"];
  const isHeader = el => headerSelectors.some(sel => el.matches(sel));
  const isAction = el => actionSelectors.some(sel => el.matches(sel));
  // Ukryta warstwa nie ma wymiarów -- jej podpowiedź rozpoznaje atrybut hidden.
  const hintNodes = [...box.querySelectorAll(".mSub, .uni-hint, .hint")]
    .filter(el => el.textContent.trim() && (layer ? !el.hidden : el.getClientRects().length > 0));
  const onlyHint = hintNodes.length === 1 ? hintNodes[0] : null;
  const isGlobalHint = onlyHint?.matches(".mSub")
    || (onlyHint?.matches(".uni-hint") && onlyHint.parentElement?.matches(".uni-body"));
  const movableHint = isGlobalHint ? onlyHint : null;
  const headerChildren = children.filter(isHeader);
  const actionChildren = children.filter(isAction);
  const nestedActions = box.hasAttribute("data-sheet-local-actions")
    ? []
    : [...box.querySelectorAll(nestedActionSelectors.join(","))]
      .filter(el => !children.includes(el) && !el.parentElement?.closest(".sheet-modal-actions"));
  const relocated = [...nestedActions, ...(movableHint && !children.includes(movableHint) ? [movableHint] : [])];
  sheetLayouts.set(box, {
    childNodes: [...box.childNodes],
    nested: relocated.map(el => ({ el, parent: el.parentNode, next: el.nextSibling })),
  });
  const header = document.createElement("div");
  header.className = "sheet-modal-head";
  const actions = document.createElement("div");
  actions.className = "sheet-modal-actions";
  const body = document.createElement("div");
  body.className = "sheet-modal-body";
  for (const child of children) {
    if (headerChildren.includes(child)) header.append(child);
    else if (actionChildren.includes(child)) actions.append(child);
    else body.append(child);
  }
  if (movableHint && !header.contains(movableHint)) header.append(movableHint);
  for (const action of nestedActions) actions.append(action);
  if (!header.childElementCount) header.hidden = true;
  if (!actions.childElementCount) actions.hidden = true;
  // Nagłówek i akcje we wspólnym pasku: fitSheetTop() stawia przyciski obok
  // tytułu, gdy się mieszczą (uwaga użytkownika 2026-10-23).
  const top = document.createElement("div");
  top.className = "sheet-modal-top";
  top.append(header, actions);
  box.replaceChildren(top, body);
}

// Pokazuje jedną warstwę okna (.modal-layer), pozostałe chowa; w oknie od
// dołu od razu układa jej nagłówek.
export function showModalLayer(layer) {
  if (!layer?.parentElement) return;
  for (const el of layer.parentElement.children) {
    if (el.matches(".modal-layer")) el.hidden = el !== layer;
  }
  const overlay = layer.closest(".modal--sheet");
  if (overlay && overlay === activeOverlay) fitSheetTop(overlay);
}

// Tytuł i przyciski w jednym wierszu, dopóki się mieszczą: tytuł nie łamie
// się ani nie ucina, przyciski nie zawijają. Podpowiedź zawsze pod nimi na
// całą szerokość (uwaga użytkownika 2026-10-23). Kolejne próby, aż coś się
// zmieści: wiersz z tytułem, to samo z ciaśniejszymi przyciskami (przełącznik
// dwóch stanów same ikony), przyciski we własnym wierszu bez zawijania
// (zwykłe, potem ciaśniejsze); dopiero na końcu przyciski się zawijają
// (uwaga użytkownika 2026-10-24).
function fitSheetTop(overlayEl) {
  for (const top of overlayEl?.querySelectorAll(".sheet-modal-top") || []) fitTopBar(top);
}

const TOP_STEPS = [
  ["is-inline"],
  ["is-inline", "is-compact"],
  ["is-oneline"],
  ["is-oneline", "is-compact"],
];

function fitTopBar(top) {
  const all = ["is-inline", "is-oneline", "is-compact"];
  top.classList.remove(...all);
  const head = top.querySelector(":scope > .sheet-modal-head");
  const actions = top.querySelector(":scope > .sheet-modal-actions");
  if (!head || !actions || head.hidden || actions.hidden || !head.offsetHeight || !actions.offsetHeight) return;
  const title = head.firstElementChild;
  if (!title) return;
  const titleH = title.offsetHeight;
  // Szerokość treści liczona z dzieci: przy justify-content:flex-end
  // nadmiar wychodzi w lewo i scrollWidth go nie widzi.
  const rowFits = () => [...actions.children].every((row) => {
    if (row.hidden || !row.offsetWidth) return true;
    const items = [...row.children].filter((el) => el.offsetWidth);
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const need = items.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0) + gap * Math.max(0, items.length - 1);
    return need <= row.clientWidth + 1;
  });
  for (const step of TOP_STEPS) {
    top.classList.add(...step);
    const fits = step.includes("is-inline")
      ? title.offsetHeight <= titleH + 1 && title.scrollWidth <= title.clientWidth + 1 && rowFits()
      : rowFits();
    if (fits) return;
    top.classList.remove(...all);
  }
}

// Pasek u góry okna od dołu: przeciągnięcie w dół (albo stuknięcie) zamyka.
function sheetHandle(overlayEl) {
  const handle = document.createElement("button");
  handle.type = "button";
  handle.className = "sheet-handle";
  handle.setAttribute("aria-label", t("common.modal.closeLabel"));
  let startY = null, lastY = 0, lastT = 0, velocity = 0, moved = false;
  const setDrag = (px) => overlayEl.style.setProperty("--sheet-drag", `${Math.max(0, px)}px`);
  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY; lastY = e.clientY; lastT = e.timeStamp; velocity = 0; moved = false;
    handle.setPointerCapture?.(e.pointerId);
    overlayEl.classList.add("sheet-dragging");
  });
  handle.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > 4) moved = true;
    const dt = Math.max(1, e.timeStamp - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY; lastT = e.timeStamp;
    setDrag(dy);
  });
  const end = () => {
    if (startY === null) return;
    const dy = lastY - startY;
    startY = null;
    overlayEl.classList.remove("sheet-dragging");
    const panel = overlayEl.querySelector(":scope > .modal");
    const limit = Math.min(160, (panel?.offsetHeight || 600) * 0.25);
    if (!moved || dy > limit || velocity > 0.6) { closeSheetAnimated(); return; }
    overlayEl.classList.add("sheet-settling");
    setDrag(0);
    setTimeout(() => overlayEl.classList.remove("sheet-settling"), 240);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
  return handle;
}

// Zamknięcie paskiem albo kliknięciem w tło: zwykłe zamknięcie okna (historia
// ?dialog= albo onClose strony); zjazd w dół robi closeDialog.
function closeSheetAnimated() {
  if (activeOverlay) handleSheetBack();
}

function restoreSheetLayout(overlayEl) {
  const modal = overlayEl?.querySelector(":scope > .modal");
  if (!modal || !sheetLayouts.has(modal)) return;
  for (const layer of modal.querySelectorAll(":scope > .modal-layer")) restoreSheetBox(layer);
  restoreSheetBox(modal);
  delete modal.dataset.sheetLayoutReady;
}

function restoreSheetBox(box) {
  const original = sheetLayouts.get(box);
  if (!original) return;
  for (const { el, parent, next } of original.nested) {
    if (parent) parent.insertBefore(el, next?.parentNode === parent ? next : null);
  }
  box.replaceChildren(...original.childNodes);
  sheetLayouts.delete(box);
}

// Modal zostaje otwarty niezależnie od szerokości ekranu (np. tablet
// obrócony w trakcie gdy modal już jest otwarty) — sam mechanizm sheet
// (podmiana treści, przejęty przycisk) ma się włączać/wyłączać żywo wraz
// z media query, zamiast zamrażać stan z chwili otwarcia. Bez tego:
// otwarcie na wąskim ekranie i obrót do szerokiego zostawiał przycisk
// wstecz z tekstem "← Wstecz" mimo że modal wrócił do zwykłego,
// wyśrodkowanego okna z własnym "✕" — dwa niespójne sposoby zamknięcia
// naraz ("przeskakiwanie między modalem a widokiem").
function applyPresentation(matches) {
  document.body.classList.toggle("sheet-open", matches);
  activeOverlay?.classList.toggle("sheet-active", matches);
}

let sheetWas = typeof document !== "undefined" && isSheetLayout();
function onSheetLayoutChange({ sheet }) {
  if (sheet === sheetWas) return;
  sheetWas = sheet;
  if (!activeClose) return; // żaden sheet modal aktualnie otwarty
  if (sheet) prepareSheetLayout(activeOverlay);
  else restoreSheetLayout(activeOverlay);
  applyPresentation(sheet);
  if (sheet) fitSheetTop(activeOverlay);
}
if (typeof document !== "undefined") onDeviceChange(onSheetLayoutChange);
globalThis.addEventListener?.("resize", () => { if (activeClose) fitSheetTop(activeOverlay); });

/**
 * Okno (dialog) — jedyny sposób otwierania i zamykania okien .overlay
 * (E23 §6.2): pokazuje okno (atrybut hidden), na telefonie przełącza je
 * w okno od dołu, zapisuje ?dialog= w historii (Wstecz zamyka okno).
 *   onClose  zamyka TO okno (Wstecz przeglądarki, pasek, „Wstecz” w topbarze);
 *            domyślnie closeDialog(overlay)
 *   onBack   „Wstecz” w topbarze najpierw pyta stronę (true = obsłużone)
 * Esc, klik w tło i [data-modal-cancel] klikają X okna (obsługa wyżej).
 */
export function openDialog(overlayEl, { onClose, onBack, historyKey = overlayEl?.id, restore = false } = {}) {
  if (!overlayEl) return;
  setOverlayOpen(overlayEl, true);
  enterModalSheet(overlayEl, { onClose: onClose || (() => closeDialog(overlayEl)), onBack, historyKey, restore });
}

// Animacja zamknięcia: arkusz zjeżdża (sheet-closing), okno wyśrodkowane
// gaśnie (is-closing). Klasa trzyma ostatnią klatkę aż do schowania okna --
// zdjęta wcześniej cofała okno na miejsce na klatkę (mrugnięcie). Koniec
// rozpoznaje animationend; zapas czasu na wypadek braku animacji.
const CLOSE_FALLBACK_MS = 360;
const closing = new WeakMap(); // overlay -> { finish, dones }

function reducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function cancelClose(overlay) {
  const c = closing.get(overlay);
  if (!c) return;
  c.dones.length = 0;
  c.finish();
}

/** Chowa okno po animacji zamknięcia; done() chowa/usuwa okno. */
export function animateClose(overlay, done) {
  const pending = closing.get(overlay);
  if (pending) { pending.dones.push(done); return; }
  if (!overlay || !overlay.isConnected || overlay.hidden || getComputedStyle(overlay).display === "none" || reducedMotion()) { done(); return; }
  const cls = overlay.classList.contains("sheet-active") ? "sheet-closing" : "is-closing";
  const target = overlay.querySelector(":scope > .modal") || overlay;
  const dones = [done];
  let timer = 0;
  const onEnd = (e) => { if (e.target === target) finish(); };
  function finish() {
    if (closing.get(overlay)?.finish !== finish) return;
    closing.delete(overlay);
    clearTimeout(timer);
    target.removeEventListener("animationend", onEnd);
    for (const fn of dones) fn();
    overlay.classList.remove("sheet-closing", "is-closing", "keyboard-lift");
    overlay.style.removeProperty("--sheet-drag");
    overlay.style.removeProperty("--keyboard-lift");
  }
  closing.set(overlay, { finish, dones });
  target.addEventListener("animationend", onEnd);
  timer = setTimeout(finish, CLOSE_FALLBACK_MS);
  overlay.classList.add(cls);
}

/** Zamyka okno otwarte przez openDialog (bez wołania onClose), z animacją; then() po schowaniu. */
export function closeDialog(overlayEl, then) {
  if (!overlayEl) return;
  animateClose(overlayEl, () => {
    setOverlayOpen(overlayEl, false);
    // Okno nad innym oknem (np. potwierdzenie nad arkuszem) nie zamyka arkusza.
    if (!activeOverlay || activeOverlay === overlayEl) exitModalSheet(overlayEl);
    then?.();
  });
}

// overlayEl: element .overlay danego modala.
// opts.onClose: funkcja zamykająca TEN modal (pasek, klik w tło, Wstecz
//   przeglądarki).
function enterModalSheet(overlayEl, { onClose, onBack, historyKey = overlayEl?.id, restore = false } = {}) {
  if (!isSheetViewport() || overlayEl?.classList.contains("modal--keep-dialog")) return;
  // Zamknięcie poprzedniego okna i od razu otwarcie następnego (np. zgłoszenie
  // → lista wysłanych): poprzednie kończy zamykanie teraz, zanim to przejmie arkusz.
  if (activeOverlay && activeOverlay !== overlayEl) closing.get(activeOverlay)?.finish();
  prepareSheetLayout(overlayEl);
  if (!historyKey || !dialogAllowed(currentPageId, historyKey)) historyKey = null;

  // Wymuszone main.wrap{overflow:hidden;height:calc(100dvh - topbar-h)} w
  // trybie sheet (css/base.css) nagle kurczy przewijalny obszar strony (np.
  // marketplace.html mają scroll na całym body) — przeglądarka
  // wtedy sama przycina window.scrollY do nowego, mniejszego zakresu, więc
  // pozycja scrolla jest tracona NA ZAWSZE, jeszcze zanim modal się zamknie.
  // Zapamiętujemy ją tutaj i przywracamy w exitModalSheet(), żeby strona po
  // zamknięciu modala wróciła w to samo miejsce, a nie na sam początek.
  activeOverlay = overlayEl || null;
  activeClose = onClose || null;
  activeDialogKey = historyKey || null;
  const currentKey = urlDialog();
  if (activeDialogKey && currentKey !== activeDialogKey) {
    setUrlDialog(activeDialogKey, !restore);
  }
  activeBack = typeof onBack === "function" ? onBack : null;
  if (activeDialogKey) sheetRoutes.set(activeDialogKey, { overlay: overlayEl, options: { onClose, onBack } });

  // Przeglądarki bez overflow:clip (css/base.css): focus() pola w oknie
  // przewija tło-kontener i panel skacze na górę -- cofamy to przewinięcie.
  if (overlayEl && !overlayEl.dataset.sheetScrollGuard) {
    overlayEl.dataset.sheetScrollGuard = "1";
    overlayEl.addEventListener("scroll", () => { if (overlayEl.scrollTop) overlayEl.scrollTop = 0; });
  }
  overlayEl?.style.removeProperty("--sheet-drag");
  overlayEl?.style.removeProperty("--keyboard-lift");
  overlayEl?.classList.remove("sheet-closing", "sheet-dragging", "sheet-settling", "keyboard-lift");
  applyPresentation(true);
  fitSheetTop(overlayEl);
  requestAnimationFrame(() => { if (activeOverlay === overlayEl) fitSheetTop(overlayEl); });
  document.dispatchEvent(new CustomEvent("modal-sheet:enter", { detail: { overlay: overlayEl } }));
}

function exitModalSheet(overlayEl) {
  const key = activeDialogKey;
  applyPresentation(false);
  restoreSheetLayout(overlayEl || activeOverlay);

  activeOverlay = null;
  activeClose = null;
  activeBack = null;
  activeDialogKey = null;

  if (key && urlDialog() === key) {
    if (!handlingPopstate) history.back();
  }

}

// Wywoływane na początku handlera kliknięcia przycisku wstecz w
// topbarze każdej strony, np.:
//   btnBack.addEventListener("click", () => {
//     if (handleSheetBack()) return;
//     location.href = ...; // normalne zachowanie przycisku
//   });
// Zwraca true, gdy przejęło kliknięcie (był otwarty sheet modal).
export function handleSheetBack() {
  if (activeClose) {
    if (activeBack?.() === true) return true;
    if (activeDialogKey && urlDialog() === activeDialogKey) history.back();
    else activeClose();
    return true;
  }
  return false;
}
