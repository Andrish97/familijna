import { ICON_PARTS } from "./icon-parts.js";
import { observeIconMotion, forgetIconMotion } from "./icon-motion.js";
// Wspólny silnik ikon. Rysunki są osobnymi plikami SVG w /assets/icons/;
// ten moduł mapuje ich nazwy na pliki i przygotowuje znaczniki do wstawienia.
// Współdzielony odczyt przez <use> pozwala przeglądarce cache'ować pliki,
// a kolor currentColor dziedziczy się z elementu wywołującego.

// Jeden system podpowiedzi dla stron korzystających ze wspólnych kontrolek.
import "./tooltips.js";
import "./range-fill.js";

export const ICONS = Object.freeze({
  // Akcje
  close: "/assets/icons/actions/close.svg",
  trash: "/assets/icons/actions/trash.svg",
  "trash-forever": "/assets/icons/actions/trash-forever.svg",
  check: "/assets/icons/actions/check.svg",
  cancel: "/assets/icons/actions/cancel.svg",
  error: "/assets/icons/actions/error.svg",
  warning: "/assets/icons/actions/warning.svg",
  info: "/assets/icons/actions/info.svg",
  // Znak zapytania: przycisk „Wskazówki” w górnym pasku (info zostaje ikoną ogólną).
  help: "/assets/icons/actions/help.svg",
  save: "/assets/icons/actions/save.svg",
  refresh: "/assets/icons/actions/refresh.svg",
  restore: "/assets/icons/actions/restore.svg",
  undo: "/assets/icons/actions/undo.svg",
  redo: "/assets/icons/actions/redo.svg",

  // Edycja
  "edit-paper": "/assets/icons/editing/edit-paper.svg",
  pencil: "/assets/icons/editing/pencil.svg",
  copy: "/assets/icons/editing/copy.svg",
  duplicate: "/assets/icons/editing/duplicate.svg",
  cut: "/assets/icons/editing/cut.svg",
  paste: "/assets/icons/editing/paste.svg",
  plus: "/assets/icons/editing/plus.svg",
  tag: "/assets/icons/editing/tag.svg",
  merge: "/assets/icons/editing/merge.svg",
  cursor: "/assets/icons/editing/cursor.svg",
  hand: "/assets/icons/editing/hand.svg",
  text: "/assets/icons/editing/text.svg",
  brush: "/assets/icons/editing/brush.svg",
  eraser: "/assets/icons/editing/eraser.svg",
  shapes: "/assets/icons/editing/shapes.svg",
  "change-type": "/assets/icons/editing/change-type.svg",
  "tie-switch": "/assets/icons/editing/tie-switch.svg",
  "rotate-left": "/assets/icons/editing/rotate-left.svg",
  "rotate-right": "/assets/icons/editing/rotate-right.svg",
  grip: "/assets/icons/editing/grip.svg",

  // Pliki i transfer
  "file-plus": "/assets/icons/files/file-plus.svg",
  "file-doc": "/assets/icons/files/file-doc.svg",
  "file-expired": "/assets/icons/files/file-expired.svg",
  folder: "/assets/icons/files/folder.svg",
  "folder-open": "/assets/icons/files/folder-open.svg",
  "folder-plus": "/assets/icons/files/folder-plus.svg",
  categories: "/assets/icons/files/categories.svg",
  paperclip: "/assets/icons/files/paperclip.svg",
  image: "/assets/icons/files/image.svg",
  download: "/assets/icons/files/download.svg",
  upload: "/assets/icons/files/upload.svg",

  // Nawigacja i ustawienia
  home: "/assets/icons/navigation/home.svg",
  drawer: "/assets/icons/navigation/drawer.svg",
  "drawer-export": "/assets/icons/navigation/drawer-export.svg",
  hamburger: "/assets/icons/navigation/hamburger.svg",
  "arrow-up": "/assets/icons/navigation/arrow-up.svg",
  "arrow-down": "/assets/icons/navigation/arrow-down.svg",
  "arrow-right": "/assets/icons/navigation/arrow-right.svg",
  "arrow-left": "/assets/icons/navigation/arrow-left.svg",
  sort: "/assets/icons/navigation/sort.svg",
  filter: "/assets/icons/navigation/filter.svg",
  "caret-down": "/assets/icons/navigation/caret-down.svg",
  "caret-up": "/assets/icons/navigation/caret-up.svg",
  "caret-right": "/assets/icons/navigation/caret-right.svg",
  "caret-left": "/assets/icons/navigation/caret-left.svg",
  "fullscreen-enter": "/assets/icons/navigation/fullscreen-enter.svg",
  "fullscreen-exit": "/assets/icons/navigation/fullscreen-exit.svg",
  settings: "/assets/icons/navigation/settings.svg",
  "theme-auto": "/assets/icons/navigation/theme-auto.svg",
  "theme-light": "/assets/icons/navigation/theme-light.svg",
  "theme-dark": "/assets/icons/navigation/theme-dark.svg",

  // Komunikacja
  envelope: "/assets/icons/communication/envelope.svg",
  "envelope-in": "/assets/icons/communication/envelope-in.svg",
  "envelope-out": "/assets/icons/communication/envelope-out.svg",
  megaphone: "/assets/icons/communication/megaphone.svg",
  reply: "/assets/icons/communication/reply.svg",
  // Czat AI (E30): dymek z plusem — przycisk w górnym pasku; wysłanie wiadomości.
  chat: "/assets/icons/communication/chat.svg",
  send: "/assets/icons/communication/send.svg",
  bell: "/assets/icons/communication/bell.svg",
  coffee: "/assets/icons/communication/coffee.svg",

  // Urządzenia
  gamepad: "/assets/icons/devices/gamepad.svg",
  person: "/assets/icons/devices/person.svg",
  people: "/assets/icons/devices/people.svg",
  host: "/assets/icons/devices/host.svg",
  buzzer: "/assets/icons/devices/buzzer.svg",
  display: "/assets/icons/devices/display.svg",
  phone: "/assets/icons/devices/phone.svg",
  "qr-code": "/assets/icons/devices/qr-code.svg",

  // Zbiorcze akcje list odbiorców
  "select-all": "/assets/icons/sharing/select-all.svg",
  "clear-selection": "/assets/icons/sharing/clear-selection.svg",

  // Multimedia i oceny
  "speaker-on": "/assets/icons/media/speaker-on.svg",
  "speaker-off": "/assets/icons/media/speaker-off.svg",
  play: "/assets/icons/media/play.svg",
  stop: "/assets/icons/media/stop.svg",
  pause: "/assets/icons/media/pause.svg",
  star: "/assets/icons/ratings/star.svg",
  "star-empty": "/assets/icons/ratings/star-empty.svg",
  "star-half": "/assets/icons/ratings/star-half.svg",

  // Pozostałe narzędzia
  "align-left": "/assets/icons/editor/align-left.svg",
  "align-center": "/assets/icons/editor/align-center.svg",
  "align-right": "/assets/icons/editor/align-right.svg",
  "zoom-in": "/assets/icons/editor/zoom-in.svg",
  "zoom-out": "/assets/icons/editor/zoom-out.svg",
  search: "/assets/icons/editor/search.svg",
  polls: "/assets/icons/editor/polls.svg",
  globe: "/assets/icons/editor/globe.svg",
  shield: "/assets/icons/editor/shield.svg",
  calendar: "/assets/icons/editor/calendar.svg",
  hourglass: "/assets/icons/editor/hourglass.svg",
  camera: "/assets/icons/editor/camera.svg",
  eye: "/assets/icons/editor/eye.svg",
  "eye-off": "/assets/icons/editor/eye-off.svg",
  "swatch-white": "/assets/icons/editor/swatch-white.svg",
  "swatch-black": "/assets/icons/editor/swatch-black.svg",

  // Języki
  "flag-pl": "/assets/icons/languages/flag-pl.svg",
  "flag-ua": "/assets/icons/languages/flag-ua.svg",
  "lang-en": "/assets/icons/languages/lang-en.svg",

  // Podglądy narzędzia Kształty w edytorze logo
  "logo-shape-line": "/assets/icons/logo-shapes/line.svg",
  "logo-shape-rect": "/assets/icons/logo-shapes/rect.svg",
  "logo-shape-round-rect": "/assets/icons/logo-shapes/round-rect.svg",
  "logo-shape-ellipse": "/assets/icons/logo-shapes/ellipse.svg",
  "logo-shape-triangle": "/assets/icons/logo-shapes/triangle.svg",
  "logo-shape-diamond": "/assets/icons/logo-shapes/diamond.svg",
  "logo-shape-pentagon": "/assets/icons/logo-shapes/pentagon.svg",
  "logo-shape-hexagon": "/assets/icons/logo-shapes/hexagon.svg",
  "logo-shape-star5": "/assets/icons/logo-shapes/star5.svg",
  "logo-shape-arrow1": "/assets/icons/logo-shapes/arrow1.svg",
  "logo-shape-arrow2": "/assets/icons/logo-shapes/arrow2.svg",
  "logo-shape-arrow1-fill": "/assets/icons/logo-shapes/arrow1-fill.svg",
  "logo-shape-arrow2-fill": "/assets/icons/logo-shapes/arrow2-fill.svg",
  "logo-shape-heart": "/assets/icons/logo-shapes/heart.svg",
  "logo-shape-polygon": "/assets/icons/logo-shapes/polygon.svg",

});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

const esc = (v) => String(v).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;" }[c]));
const assetHref = (name) => `${ICONS[name]}#icon`;

/** Zwraca SVG używające osobnego pliku z assets/icons. */
let partInstance = 0;
function inlineParts(markup) {
  const prefix = `icon-part-${++partInstance}-`;
  return markup.replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (_, id) => `url(#${prefix}${id})`)
    .replace(/href="#([^"]+)"/g, (_, id) => `href="#${prefix}${id}"`);
}

export function icon(name, { className = "", label = "", animation = "" } = {}) {
  const asset = ICONS[name];
  if (!asset) {
    if (typeof console !== "undefined") console.warn(`[icons] nieznana ikona: ${name}`);
    return "";
  }
  const cls = `ico ico-${name}${className ? ` ${className}` : ""}`;
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  const parts = animation ? ICON_PARTS[name] : null;
  if (animation && parts?.animation !== animation) throw new RangeError(`Nieznana animacja ikony: ${name}/${animation}`);
  const motion = parts ? ` data-icon-animation="${animation}"` : "";
  const drawing = parts ? inlineParts(parts.markup) : `<use href="${assetHref(name)}"></use>`;
  return `<svg class="${esc(cls)}" viewBox="0 0 24 24" width="1em" height="1em" ${a11y} focusable="false"${motion}>${drawing}</svg>`;
}

/**
 * Gwiazdki oceny wypełnione procentowo: 4.6 → 4 pełne, piąta w 60%.
 * Ikony bazowe są plikami SVG i są współdzielone przez odwołania <use>.
 */
export function starRating(value, { max = 5, label = "" } = {}) {
  const v = Math.max(0, Math.min(max, Number(value) || 0));
  let out = "";
  for (let i = 0; i < max; i++) {
    const frac = Math.max(0, Math.min(1, v - i));
    if (frac >= 0.99) { out += icon("star"); continue; }
    if (frac <= 0.01) { out += icon("star-empty"); continue; }
    const width = (2.7 + frac * 18.6).toFixed(2);
    out += `<svg class="ico ico-star-part" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><use href="${assetHref("star-empty")}" width="24" height="24"></use><svg x="0" y="0" width="${width}" height="24" viewBox="0 0 ${width} 24" overflow="hidden"><use href="${assetHref("star")}" width="24" height="24"></use></svg></svg>`;
  }
  const a11y = label ? ` role="img" aria-label="${esc(label)}"` : "";
  return `<span class="ico-stars"${a11y}>${out}</span>`;
}

/** Ikona + tekst (tekst jest escapowany) — do przycisków ustawianych z JS. */
export function iconText(name, text, { after = false, animation = "" } = {}) {
  const i = icon(name, { animation }), txt = esc(text ?? "");
  if (!i) return txt;
  return after ? `${txt} ${i}` : `${i} ${txt}`;
}

/** Podmienia <i data-icon="nazwa"> w HTML na element używający pliku SVG. */
export function hydrateIcons(root = typeof document !== "undefined" ? document : null) {
  if (!root?.querySelectorAll) return;
  const list = root.matches?.("[data-icon]") ? [root] : [];
  list.push(...root.querySelectorAll("[data-icon]"));
  for (const el of list) {
    if (el.tagName === "svg" || el.tagName === "SVG") continue;
    const extra = String(el.getAttribute("class") || "").split(/\s+/).filter((c) => c && c !== "ico").join(" ");
    const html = icon(el.dataset.icon, { className: extra, label: el.getAttribute("aria-label") || "", animation: el.dataset.iconAnimation || "" });
    if (html) el.outerHTML = html;
  }
  observeIconMotion(root);
}

if (typeof document !== "undefined" && typeof MutationObserver !== "undefined") {
  const start = () => {
    hydrateIcons(document);
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) hydrateIcons(n);
        for (const n of m.removedNodes) if (n.nodeType === 1) forgetIconMotion(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

// Wspólne znaczenie akcji udostępniania.
const SHARING_ACTION_ICONS = new Map([
  ["decline", "close"], ["reject", "close"], ["withdraw", "close"], ["leave", "close"],
  ["delete", "trash"], ["remove", "trash"], ["revoke", "trash"], ["cancel", "trash"],
]);
export function sharingActionIcon(action, fallback = "") {
  return SHARING_ACTION_ICONS.get(action) || fallback;
}
