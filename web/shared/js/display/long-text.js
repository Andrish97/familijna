import { hasDisplayGlyph } from "./fonts.js?v=v2026-11-07T22200";

// Długie pola Wyświetlacza (long1/long2 -- nazwy drużyn): 95 kolumn kropek.
// Znaki rysujemy proporcjonalnie: każdy zajmuje tylko kolumny ze swoimi
// zapalonymi kropkami (kropka 1 kolumnę, „W” 5), między znakami 1 kolumna
// przerwy, spacja 3 kolumny. Ten sam układ służy Wyświetlaczowi do rysowania
// i ustawieniom gry do sprawdzenia, czy nazwa się zmieści -- liczy się
// rzeczywista szerokość znaków z czcionki, nie ich liczba.

export const LONG_COLS = 95;
export const LONG_GAP = 1;
export const LONG_SPACE_W = 3;
const GLYPH_W = 5;
// Bez czcionki (jeszcze nie wczytana) każdy znak liczymy jako pełne 5 kolumn.
const FALLBACK_MASK = (1 << GLYPH_W) - 1;
// Najwięcej znaków, jakie w ogóle zmieszczą się w polu (same kropki).
export const LONG_MAX_INPUT = Math.floor((LONG_COLS + LONG_GAP) / (1 + LONG_GAP));

/** Znaki tak, jak narysuje je Wyświetlacz (wielkie litery, pełne znaki Unicode). */
export const longTextChars = (text) => Array.from(String(text ?? "").toUpperCase().trim());

const glyphOf = (glyphs, ch) => {
  let v = glyphs?.get(ch);
  for (let i = 0; i < 4 && typeof v === "string" && v.startsWith("@"); i++) v = glyphs.get(v.slice(1));
  return Array.isArray(v) ? v : null;
};

/**
 * Układ napisu w długim polu: { items: [{ glyph, from, width }], width }.
 * from -- pierwsza kolumna glifu z kropkami (0 = lewa), width -- liczba kolumn.
 * Spacja, znaki bez kropek i znaki spoza czcionki: pusta przerwa LONG_SPACE_W
 * (Wyświetlacz ich nie poprawia -- egzekwują je pola wpisu, dane poprawi E21).
 */
export function layoutLongText(text, glyphs) {
  const items = [];
  for (const ch of longTextChars(text)) {
    const glyph = glyphs ? glyphOf(glyphs, ch) : null;
    const mask = glyphs ? (glyph || []).reduce((acc, row) => acc | (row | 0), 0) & FALLBACK_MASK : FALLBACK_MASK;
    if (!mask) { items.push({ glyph: null, from: 0, width: LONG_SPACE_W }); continue; }
    let from = 0, to = GLYPH_W - 1;
    while (!(mask & (1 << (GLYPH_W - 1 - from)))) from++;
    while (!(mask & (1 << (GLYPH_W - 1 - to)))) to--;
    items.push({ glyph, from, width: to - from + 1 });
  }
  const width = items.reduce((sum, item) => sum + item.width, 0) + Math.max(0, items.length - 1) * LONG_GAP;
  return { items, width };
}

/** { width, max, fits, invalid[] } -- invalid: znaki bez glifu w czcionce Wyświetlacza. */
export function measureLongText(text, glyphs) {
  const { width } = layoutLongText(text, glyphs);
  const invalid = glyphs ? [...new Set(longTextChars(text).filter((ch) => ch !== " " && !hasDisplayGlyph(glyphs, ch)))] : [];
  return { width, max: LONG_COLS, fits: width <= LONG_COLS, invalid };
}

/**
 * Napis bez znaków, których Wyświetlacz nie ma (decyzja 2026-10-20): taki znak
 * jest pomijany razem z jedną spacją, która stoi zaraz za nim („Kawa 😀 z” →
 * „Kawa z”). Używane przy wpisywaniu (ustawienia gry); Wyświetlacz rysuje dane
 * bez zmian -- istniejące dane poprawi migracja (E21).
 * Bez czcionki (jeszcze nie wczytana) napis zostaje bez zmian.
 */
export function dropUnsupported(text, glyphs) {
  const chars = Array.from(String(text ?? ""));
  if (!glyphs) return chars.join("");
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (/\s/.test(ch) || hasDisplayGlyph(glyphs, ch)) { out += ch; continue; }
    // Spację za pominiętym znakiem pomijaj tylko, gdy powieliłaby spację
    // (albo stałaby na początku): „Kawa 😀 z” → „Kawa z”, „Kawa😀 z” → „Kawa z”.
    if (chars[i + 1] === " " && (!out || /\s$/.test(out))) i++;
  }
  return out;
}

/** Najdłuższy początek napisu, który zmieści się w długim polu. */
export function clipLongText(text, glyphs) {
  const source = Array.from(String(text ?? ""));
  let out = "";
  for (const ch of source) {
    if (layoutLongText(out + ch, glyphs).width > LONG_COLS) break;
    out += ch;
  }
  return out;
}
