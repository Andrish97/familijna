import { ICON_PARTS } from "./icon-parts.js?v=v2026-11-08T21472";
import { observeIconMotion, forgetIconMotion } from "./icon-motion.js?v=v2026-11-08T21472";
// Wspólny silnik ikon. Rysunki są osobnymi plikami SVG w /assets/icons/;
// ten moduł mapuje ich nazwy na pliki i przygotowuje znaczniki do wstawienia.
// Współdzielony odczyt przez <use> pozwala przeglądarce cache'ować pliki,
// a kolor currentColor dziedziczy się z elementu wywołującego.

// Jeden system podpowiedzi dla stron korzystających ze wspólnych kontrolek.
import "./tooltips.js?v=v2026-11-08T21472";
import "./range-fill.js?v=v2026-11-08T21472";

export const ICONS = Object.freeze({
  // Akcje
  close: "/assets/icons/actions/close.svg?v=v2026-11-08T21472",
  trash: "/assets/icons/actions/trash.svg?v=v2026-11-08T21472",
  "trash-forever": "/assets/icons/actions/trash-forever.svg?v=v2026-11-08T21472",
  check: "/assets/icons/actions/check.svg?v=v2026-11-08T21472",
  cancel: "/assets/icons/actions/cancel.svg?v=v2026-11-08T21472",
  error: "/assets/icons/actions/error.svg?v=v2026-11-08T21472",
  warning: "/assets/icons/actions/warning.svg?v=v2026-11-08T21472",
  info: "/assets/icons/actions/info.svg?v=v2026-11-08T21472",
  save: "/assets/icons/actions/save.svg?v=v2026-11-08T21472",
  refresh: "/assets/icons/actions/refresh.svg?v=v2026-11-08T21472",
  restore: "/assets/icons/actions/restore.svg?v=v2026-11-08T21472",
  undo: "/assets/icons/actions/undo.svg?v=v2026-11-08T21472",
  redo: "/assets/icons/actions/redo.svg?v=v2026-11-08T21472",

  // Edycja
  "edit-paper": "/assets/icons/editing/edit-paper.svg?v=v2026-11-08T21472",
  pencil: "/assets/icons/editing/pencil.svg?v=v2026-11-08T21472",
  copy: "/assets/icons/editing/copy.svg?v=v2026-11-08T21472",
  duplicate: "/assets/icons/editing/duplicate.svg?v=v2026-11-08T21472",
  cut: "/assets/icons/editing/cut.svg?v=v2026-11-08T21472",
  paste: "/assets/icons/editing/paste.svg?v=v2026-11-08T21472",
  plus: "/assets/icons/editing/plus.svg?v=v2026-11-08T21472",
  tag: "/assets/icons/editing/tag.svg?v=v2026-11-08T21472",
  merge: "/assets/icons/editing/merge.svg?v=v2026-11-08T21472",
  cursor: "/assets/icons/editing/cursor.svg?v=v2026-11-08T21472",
  hand: "/assets/icons/editing/hand.svg?v=v2026-11-08T21472",
  text: "/assets/icons/editing/text.svg?v=v2026-11-08T21472",
  brush: "/assets/icons/editing/brush.svg?v=v2026-11-08T21472",
  eraser: "/assets/icons/editing/eraser.svg?v=v2026-11-08T21472",
  shapes: "/assets/icons/editing/shapes.svg?v=v2026-11-08T21472",
  "change-type": "/assets/icons/editing/change-type.svg?v=v2026-11-08T21472",
  "tie-switch": "/assets/icons/editing/tie-switch.svg?v=v2026-11-08T21472",
  "rotate-left": "/assets/icons/editing/rotate-left.svg?v=v2026-11-08T21472",
  "rotate-right": "/assets/icons/editing/rotate-right.svg?v=v2026-11-08T21472",
  grip: "/assets/icons/editing/grip.svg?v=v2026-11-08T21472",

  // Pliki i transfer
  "file-plus": "/assets/icons/files/file-plus.svg?v=v2026-11-08T21472",
  "file-doc": "/assets/icons/files/file-doc.svg?v=v2026-11-08T21472",
  "file-expired": "/assets/icons/files/file-expired.svg?v=v2026-11-08T21472",
  folder: "/assets/icons/files/folder.svg?v=v2026-11-08T21472",
  "folder-open": "/assets/icons/files/folder-open.svg?v=v2026-11-08T21472",
  "folder-plus": "/assets/icons/files/folder-plus.svg?v=v2026-11-08T21472",
  categories: "/assets/icons/files/categories.svg?v=v2026-11-08T21472",
  paperclip: "/assets/icons/files/paperclip.svg?v=v2026-11-08T21472",
  image: "/assets/icons/files/image.svg?v=v2026-11-08T21472",
  download: "/assets/icons/files/download.svg?v=v2026-11-08T21472",
  upload: "/assets/icons/files/upload.svg?v=v2026-11-08T21472",

  // Nawigacja i ustawienia
  home: "/assets/icons/navigation/home.svg?v=v2026-11-08T21472",
  drawer: "/assets/icons/navigation/drawer.svg?v=v2026-11-08T21472",
  "drawer-export": "/assets/icons/navigation/drawer-export.svg?v=v2026-11-08T21472",
  hamburger: "/assets/icons/navigation/hamburger.svg?v=v2026-11-08T21472",
  "arrow-up": "/assets/icons/navigation/arrow-up.svg?v=v2026-11-08T21472",
  "arrow-down": "/assets/icons/navigation/arrow-down.svg?v=v2026-11-08T21472",
  "arrow-right": "/assets/icons/navigation/arrow-right.svg?v=v2026-11-08T21472",
  "arrow-left": "/assets/icons/navigation/arrow-left.svg?v=v2026-11-08T21472",
  sort: "/assets/icons/navigation/sort.svg?v=v2026-11-08T21472",
  filter: "/assets/icons/navigation/filter.svg?v=v2026-11-08T21472",
  "caret-down": "/assets/icons/navigation/caret-down.svg?v=v2026-11-08T21472",
  "caret-up": "/assets/icons/navigation/caret-up.svg?v=v2026-11-08T21472",
  "caret-right": "/assets/icons/navigation/caret-right.svg?v=v2026-11-08T21472",
  "caret-left": "/assets/icons/navigation/caret-left.svg?v=v2026-11-08T21472",
  "fullscreen-enter": "/assets/icons/navigation/fullscreen-enter.svg?v=v2026-11-08T21472",
  "fullscreen-exit": "/assets/icons/navigation/fullscreen-exit.svg?v=v2026-11-08T21472",
  settings: "/assets/icons/navigation/settings.svg?v=v2026-11-08T21472",
  "theme-auto": "/assets/icons/navigation/theme-auto.svg?v=v2026-11-08T21472",
  "theme-light": "/assets/icons/navigation/theme-light.svg?v=v2026-11-08T21472",
  "theme-dark": "/assets/icons/navigation/theme-dark.svg?v=v2026-11-08T21472",

  // Komunikacja
  envelope: "/assets/icons/communication/envelope.svg?v=v2026-11-08T21472",
  "envelope-in": "/assets/icons/communication/envelope-in.svg?v=v2026-11-08T21472",
  "envelope-out": "/assets/icons/communication/envelope-out.svg?v=v2026-11-08T21472",
  megaphone: "/assets/icons/communication/megaphone.svg?v=v2026-11-08T21472",
  reply: "/assets/icons/communication/reply.svg?v=v2026-11-08T21472",
  bell: "/assets/icons/communication/bell.svg?v=v2026-11-08T21472",
  coffee: "/assets/icons/communication/coffee.svg?v=v2026-11-08T21472",

  // Urządzenia
  gamepad: "/assets/icons/devices/gamepad.svg?v=v2026-11-08T21472",
  person: "/assets/icons/devices/person.svg?v=v2026-11-08T21472",
  people: "/assets/icons/devices/people.svg?v=v2026-11-08T21472",
  host: "/assets/icons/devices/host.svg?v=v2026-11-08T21472",
  buzzer: "/assets/icons/devices/buzzer.svg?v=v2026-11-08T21472",
  display: "/assets/icons/devices/display.svg?v=v2026-11-08T21472",
  phone: "/assets/icons/devices/phone.svg?v=v2026-11-08T21472",
  "qr-code": "/assets/icons/devices/qr-code.svg?v=v2026-11-08T21472",

  // Zbiorcze akcje list odbiorców
  "select-all": "/assets/icons/sharing/select-all.svg?v=v2026-11-08T21472",
  "clear-selection": "/assets/icons/sharing/clear-selection.svg?v=v2026-11-08T21472",

  // Multimedia i oceny
  "speaker-on": "/assets/icons/media/speaker-on.svg?v=v2026-11-08T21472",
  "speaker-off": "/assets/icons/media/speaker-off.svg?v=v2026-11-08T21472",
  play: "/assets/icons/media/play.svg?v=v2026-11-08T21472",
  stop: "/assets/icons/media/stop.svg?v=v2026-11-08T21472",
  pause: "/assets/icons/media/pause.svg?v=v2026-11-08T21472",
  star: "/assets/icons/ratings/star.svg?v=v2026-11-08T21472",
  "star-empty": "/assets/icons/ratings/star-empty.svg?v=v2026-11-08T21472",
  "star-half": "/assets/icons/ratings/star-half.svg?v=v2026-11-08T21472",

  // Pozostałe narzędzia
  "align-left": "/assets/icons/editor/align-left.svg?v=v2026-11-08T21472",
  "align-center": "/assets/icons/editor/align-center.svg?v=v2026-11-08T21472",
  "align-right": "/assets/icons/editor/align-right.svg?v=v2026-11-08T21472",
  "zoom-in": "/assets/icons/editor/zoom-in.svg?v=v2026-11-08T21472",
  "zoom-out": "/assets/icons/editor/zoom-out.svg?v=v2026-11-08T21472",
  search: "/assets/icons/editor/search.svg?v=v2026-11-08T21472",
  polls: "/assets/icons/editor/polls.svg?v=v2026-11-08T21472",
  globe: "/assets/icons/editor/globe.svg?v=v2026-11-08T21472",
  shield: "/assets/icons/editor/shield.svg?v=v2026-11-08T21472",
  calendar: "/assets/icons/editor/calendar.svg?v=v2026-11-08T21472",
  hourglass: "/assets/icons/editor/hourglass.svg?v=v2026-11-08T21472",
  camera: "/assets/icons/editor/camera.svg?v=v2026-11-08T21472",
  eye: "/assets/icons/editor/eye.svg?v=v2026-11-08T21472",
  "eye-off": "/assets/icons/editor/eye-off.svg?v=v2026-11-08T21472",
  "swatch-white": "/assets/icons/editor/swatch-white.svg?v=v2026-11-08T21472",
  "swatch-black": "/assets/icons/editor/swatch-black.svg?v=v2026-11-08T21472",

  // Języki
  "flag-pl": "/assets/icons/languages/flag-pl.svg?v=v2026-11-08T21472",
  "flag-ua": "/assets/icons/languages/flag-ua.svg?v=v2026-11-08T21472",
  "lang-en": "/assets/icons/languages/lang-en.svg?v=v2026-11-08T21472",

  // Podglądy narzędzia Kształty w edytorze logo
  "logo-shape-line": "/assets/icons/logo-shapes/line.svg?v=v2026-11-08T21472",
  "logo-shape-rect": "/assets/icons/logo-shapes/rect.svg?v=v2026-11-08T21472",
  "logo-shape-round-rect": "/assets/icons/logo-shapes/round-rect.svg?v=v2026-11-08T21472",
  "logo-shape-ellipse": "/assets/icons/logo-shapes/ellipse.svg?v=v2026-11-08T21472",
  "logo-shape-triangle": "/assets/icons/logo-shapes/triangle.svg?v=v2026-11-08T21472",
  "logo-shape-diamond": "/assets/icons/logo-shapes/diamond.svg?v=v2026-11-08T21472",
  "logo-shape-pentagon": "/assets/icons/logo-shapes/pentagon.svg?v=v2026-11-08T21472",
  "logo-shape-hexagon": "/assets/icons/logo-shapes/hexagon.svg?v=v2026-11-08T21472",
  "logo-shape-star5": "/assets/icons/logo-shapes/star5.svg?v=v2026-11-08T21472",
  "logo-shape-arrow1": "/assets/icons/logo-shapes/arrow1.svg?v=v2026-11-08T21472",
  "logo-shape-arrow2": "/assets/icons/logo-shapes/arrow2.svg?v=v2026-11-08T21472",
  "logo-shape-arrow1-fill": "/assets/icons/logo-shapes/arrow1-fill.svg?v=v2026-11-08T21472",
  "logo-shape-arrow2-fill": "/assets/icons/logo-shapes/arrow2-fill.svg?v=v2026-11-08T21472",
  "logo-shape-heart": "/assets/icons/logo-shapes/heart.svg?v=v2026-11-08T21472",
  "logo-shape-polygon": "/assets/icons/logo-shapes/polygon.svg?v=v2026-11-08T21472",

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
