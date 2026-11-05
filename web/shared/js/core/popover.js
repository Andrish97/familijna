// Położenie wyskakujących menu (position: fixed) — jedno dla całej aplikacji:
// menu języka, „Więcej” i konta w topbarze (placeDropdown), lista rozwijana
// ui-select (placeUnder), menu kontekstowe (placeAtPoint). Zawsze w oknie,
// EDGE_PAD od krawędzi.

import { EDGE_PAD as PAD, ANCHOR_GAP as GAP, LIST_GAP, LIST_MIN_HEIGHT, clamp } from "./ui-metrics.js?v=v2026-11-05T14441";
import { setFloat, clearFloat, measureHidden } from "./geometry.js?v=v2026-11-05T14441";

/**
 * Menu pod przyciskiem anchor, wyrównane do jego prawej krawędzi (align
 * "start" — do lewej); gdy nie mieści się pod — nad nim.
 */
export function placeDropdown(anchor, el, { align = "end" } = {}) {
  if (!anchor || !el) return;
  setFloat(el, { left: -9999, top: 0 });
  measureHidden(el, (m) => {
    const a = anchor.getBoundingClientRect();
    const left = clamp(align === "start" ? a.left : a.right - m.width, PAD, innerWidth - m.width - PAD);
    let top = a.bottom + GAP;
    if (top + m.height > innerHeight - PAD) top = a.top - m.height - GAP;
    setFloat(el, { left, top: clamp(top, PAD, innerHeight - m.height - PAD) });
  });
}

/**
 * Lista pod polem (ui-select): szerokość pola (co najmniej minWidth), od jego
 * lewej krawędzi; nad polem, gdy pod nim jest mniej miejsca. Wysokość listy
 * ograniczona miejscem w oknie (przewija się sama).
 */
export function placeUnder(anchor, el, { minWidth = 0, gap = LIST_GAP, preferredHeight = 260 } = {}) {
  if (!anchor || !el) return;
  const a = anchor.getBoundingClientRect();
  const width = Math.min(Math.max(a.width, minWidth), innerWidth - 2 * PAD);
  const below = innerHeight - a.bottom - gap;
  const above = a.top - gap;
  const down = below >= Math.min(preferredHeight, above) || below >= above;
  setFloat(el, {
    left: clamp(a.left, PAD, innerWidth - width - PAD),
    width,
    top: down ? a.bottom + gap : null,
    bottom: down ? null : innerHeight - a.top + gap,
    maxHeight: Math.max(down ? below : above, LIST_MIN_HEIGHT),
  });
}

/** Zdejmuje położenie ustawione przez placeDropdown/placeUnder (np. menu przechodzi do panelu telefonu). */
export function clearPlacement(el) {
  clearFloat(el);
}

/** Menu w punkcie (x, y), np. menu kontekstowe — przesunięte, żeby mieściło się w oknie. */
export function placeAtPoint(el, x, y) {
  setFloat(el, { left: -9999, top: 0 });
  el.hidden = false;
  const m = el.getBoundingClientRect();
  setFloat(el, { left: clamp(x, PAD, innerWidth - m.width - PAD), top: clamp(y, PAD, innerHeight - m.height - PAD) });
}
