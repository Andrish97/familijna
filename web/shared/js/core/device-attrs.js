// Rodzaj urządzenia na <html> (E23, silnik-stylow-projekt.md §3.3): jedno
// źródło dla CSS i JS zamiast zapytań udających wykrywanie urządzenia.
//   data-device      phone | tablet | desktop | tv  (getDeviceProfile)
//   data-input       touch | pointer
//   data-orientation portrait | landscape
//   data-compact     układ telefonu: telefon albo okno do 600 px
//   data-sheet       okna od dołu: dotyk (bez TV) albo okno do 600 px
//   data-keyboard    klawiatura ekranowa otwarta (dotyk, aktywne pole);
//                    --keyboard-h: jej wysokość
//   data-keyboard-room  zapas pod treścią (html::after), gdy pole z samego
//                    dołu strony trzeba podnieść ponad koniec strony
// Początkowe atrybuty ustawia klasyczny page-boot.js; ten moduł je aktualizuje.
import "./page-layout.js?v=v2026-11-03T23205";
import { editableFocused } from "./device-guard.js?v=v2026-11-03T23205";

export const { NARROW_MAX, deviceLayout } = globalThis.FamilijnaDevice;

let current = null;

function apply() {
  const root = document.documentElement;
  const next = deviceLayout();
  root.dataset.device = next.device;
  root.dataset.input = next.input;
  root.dataset.orientation = next.orientation;
  root.toggleAttribute("data-compact", next.compact);
  root.toggleAttribute("data-sheet", next.sheet);
  const changed = !current || Object.keys(next).some((key) => next[key] !== current[key]);
  current = next;
  if (changed) document.dispatchEvent(new CustomEvent("device:change", { detail: next }));
}

// Klawiatura zasłania stronę, nie zmienia układu (decyzja użytkownika
// 2026-10-29): meta viewport interactive-widget=resizes-visual. Tam, gdzie
// jest VirtualKeyboard API (Chrome na Androidzie), przejmujemy ustawienie
// widoku (overlaysContent): przeglądarka nic nie przesuwa, a strona jednym
// płynnym ruchem stawia aktywne pole tuż nad klawiaturą — tylko gdy
// klawiatura by je zasłoniła. Bez API (np. Safari) przesuwa przeglądarka.
const vk = typeof navigator !== "undefined" ? navigator.virtualKeyboard : null;
const KEYBOARD_MIN = 120;
const FIELD_GAP = 12; // odstęp pola od klawiatury
let fullHeight = { width: 0, height: 0 };

function viewHeight() {
  return Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
}

/** Wysokość klawiatury w px (0, gdy zamknięta). */
function keyboardHeight() {
  if (vk?.overlaysContent) return Math.round(vk.boundingRect?.height || 0);
  const h = viewHeight();
  if (window.innerWidth !== fullHeight.width) fullHeight = { width: window.innerWidth, height: h };
  if (!editableFocused() || h > fullHeight.height) fullHeight.height = Math.max(fullHeight.height, h);
  const covered = fullHeight.height - h;
  return covered > KEYBOARD_MIN ? covered : 0;
}

const scrollable = (node) => /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight;

// Cele rozpoczętych płynnych ruchów (kontener → docelowe scrollTop). Pomiar
// w trakcie ruchu liczy pole tam, gdzie dojedzie, więc kolejne ustawienie
// (druga zmiana klawiatury, wolne urządzenie) nie dokłada ruchu drugi raz.
const scrollTargets = new Map();
const liftedBox = (lift) => (lift.classList.contains("overlay") ? lift.querySelector(":scope > .modal") : lift);

/** Ile pole jeszcze przejedzie w górę w trwających ruchach. */
function pendingMove(el) {
  let px = 0;
  for (const [node, target] of scrollTargets) {
    const current = node === document.scrollingElement ? window.scrollY : node.scrollTop;
    if (Math.abs(target - current) < 1) { scrollTargets.delete(node); continue; }
    if (node === document.scrollingElement || node.contains(el)) px += target - current;
  }
  for (const lift of document.querySelectorAll(".keyboard-lift")) {
    if (!lift.contains(el)) continue;
    const box = liftedBox(lift) || lift;
    const scale = box.offsetHeight ? box.getBoundingClientRect().height / box.offsetHeight : 1;
    const now = -(parseFloat(getComputedStyle(box).translate.split(" ")[1]) || 0);
    px += ((parseFloat(lift.style.getPropertyValue("--keyboard-lift")) || 0) - now) * scale;
  }
  return px;
}

function smoothScroll(node, step) {
  const isPage = node === document.scrollingElement;
  const from = scrollTargets.get(node) ?? (isPage ? window.scrollY : node.scrollTop);
  scrollTargets.set(node, from + step);
  (isPage ? window : node).scrollTo({ top: from + step, behavior: "smooth" });
}

/** Przesuń pole tuż nad klawiaturę, jeśli je zasłania: kontenery z
 * przewijaniem, potem okno (.overlay) lub treść strony bez przewijania
 * (.page-fit, np. dolny pasek list) podjeżdża, a na zwykłej stronie --
 * przewinięcie strony. */
/** Strona bez przewijania całości (.page-fit albo overflow:hidden, np. Control). */
function pageLocked() {
  if (document.body.classList.contains("page-fit")) return true;
  return [document.documentElement, document.body].some((n) => getComputedStyle(n).overflowY === "hidden");
}

function revealAboveKeyboard(el, kb) {
  const overlay = el.closest(".overlay");
  const lift = overlay || (pageLocked() ? el.closest("main") : null);
  // Podniesienia innego miejsca (fokus przeszedł gdzie indziej) nie trzymamy.
  for (const other of document.querySelectorAll(".keyboard-lift")) if (other !== lift) other.classList.remove("keyboard-lift");
  const pending = pendingMove(el);
  const rect = el.getBoundingClientRect();
  const top = rect.top - pending;
  const bottom = rect.bottom - pending;
  // Okno zasłania górny pasek, więc wtedy granicą jest góra ekranu.
  const topbarBottom = overlay ? 0 : document.querySelector(".topbar")?.getBoundingClientRect().bottom || 0;
  // Pole wyższe niż widoczna część: jego górny brzeg zostaje pod paskiem.
  let delta = Math.round(Math.min(bottom - (window.innerHeight - kb - FIELD_GAP), top - topbarBottom - FIELD_GAP));
  if (delta <= 0) return;
  for (let node = el.parentElement; node && node !== document.body && delta > 0; node = node.parentElement) {
    if (!scrollable(node)) continue;
    const at = scrollTargets.get(node) ?? node.scrollTop;
    const step = Math.min(delta, node.scrollHeight - node.clientHeight - at);
    if (step > 0) { smoothScroll(node, step); delta -= step; }
  }
  if (delta <= 0) return;
  if (lift) {
    // Powierzchnia skalowana (Control: zoom) -- przesunięcie w jej pikselach.
    const box = liftedBox(lift) || lift;
    const scale = box.offsetHeight ? box.getBoundingClientRect().height / box.offsetHeight : 1;
    const current = lift.classList.contains("keyboard-lift") ? parseFloat(lift.style.getPropertyValue("--keyboard-lift")) || 0 : 0;
    const shift = Math.min(kb / scale, current + delta / scale);
    clearTimeout(lift.__keyboardSettle);
    lift.style.setProperty("--keyboard-lift", `${Math.round(shift)}px`);
    lift.classList.add("keyboard-lift");
  } else {
    // Zapas pod treścią tylko wtedy, gdy strona nie ma dokąd się przewinąć
    // (poza układem strony: html::after, wyśrodkowane strony nie drgną).
    const at = scrollTargets.get(document.scrollingElement) ?? window.scrollY;
    const room = document.documentElement.scrollHeight - window.innerHeight - at;
    if (room < delta) document.documentElement.toggleAttribute("data-keyboard-room", true);
    smoothScroll(document.scrollingElement, delta);
  }
}

/** Klawiatura zamknięta: podniesione okno lub treść zjeżdża na swoje miejsce. */
function settleLifted() {
  scrollTargets.clear();
  document.documentElement.removeAttribute("data-keyboard-room");
  for (const el of document.querySelectorAll(".keyboard-lift")) {
    el.style.setProperty("--keyboard-lift", "0px");
    // Po zjeździe bez klasy: translate (nawet 0) zmienia odniesienie okien
    // position:fixed otwieranych z wnętrza podniesionej treści.
    clearTimeout(el.__keyboardSettle);
    el.__keyboardSettle = setTimeout(() => {
      el.classList.remove("keyboard-lift");
      el.style.removeProperty("--keyboard-lift");
    }, LIFT_MS);
  }
}

// Jedno ustawienie naraz: płynne przewijanie trwa, a pomiar w jego trakcie
// przesunąłby pole za daleko.
const SCROLL_MS = 450;
const LIFT_MS = 300; // transition: translate .25s (layout.css, components.css)
let revealTimer = 0;
let revealUntil = 0;
function scheduleReveal() {
  if (!vk?.overlaysContent) return;
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    if (keyboardH <= 0 || !editableFocused()) return;
    revealAboveKeyboard(document.activeElement, keyboardH);
    revealUntil = Date.now() + SCROLL_MS;
  }, Math.max(0, revealUntil - Date.now()));
}

let keyboardH = 0;
function applyKeyboard() {
  const root = document.documentElement;
  const covered = keyboardHeight(); // zawsze: zapamiętuje pełną wysokość okna
  const kb = root.dataset.input === "touch" && editableFocused() ? covered : 0;
  if (kb === keyboardH) return;
  keyboardH = kb;
  root.toggleAttribute("data-keyboard", kb > 0);
  root.style.setProperty("--keyboard-h", `${kb}px`);
  if (kb > 0) scheduleReveal();
  else settleLifted();
}

/** Inne pole przy otwartej klawiaturze: to samo ustawienie bez czekania na zmianę klawiatury. */
function onFocusIn() {
  requestAnimationFrame(() => {
    applyKeyboard();
    if (keyboardH > 0) scheduleReveal();
  });
}

/** Układ telefonu (data-compact). */
export const isCompactLayout = () => document.documentElement.hasAttribute("data-compact");
/** Okna od dołu (data-sheet). */
export const isSheetLayout = () => document.documentElement.hasAttribute("data-sheet");

/** Zmiana układu (obrót, zmiana okna): fn(layout). */
export function onDeviceChange(fn) {
  document.addEventListener("device:change", (event) => fn(event.detail));
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  apply();
  applyKeyboard();
  window.addEventListener("resize", () => { apply(); applyKeyboard(); }, { passive: true });
  window.addEventListener("orientationchange", apply);
  if (vk) {
    try { vk.overlaysContent = true; } catch {}
    vk.addEventListener?.("geometrychange", applyKeyboard);
  }
  window.visualViewport?.addEventListener("resize", applyKeyboard, { passive: true });
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", () => requestAnimationFrame(applyKeyboard));
}
