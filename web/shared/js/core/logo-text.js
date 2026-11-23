// Logo tekstowe: napis czcionką 3×10 -> GLYPH_30x10 (30 kolumn × 10 wierszy
// znaków). Glify przycięte do szerokości, stała 1 kolumna przerwy, napis
// wyśrodkowany. Bez tekstów interfejsu — używa go edytor logo
// (logos/js/text.js) i czat AI (shared/js/ai/tools/logos.js).
export const TEXT_TILES_X = 30;
export const TEXT_TILES_Y = 10;
const TILES_X = TEXT_TILES_X;
const TILES_Y = TEXT_TILES_Y;

export const GLYPH_W = 3;

// Cyrylica jest w foncie, ale na liście „dozwolonych znaków” pokazujemy ją
// tylko w interfejsie ukraińskim (kompilacja przyjmuje ją zawsze, żeby logo
// zrobione po ukraińsku dało się edytować w innym języku).
export const CYRILLIC_UK = new Set("АБВГҐДЕЄЖЗИІЙКЛМНОПРСТУФХЦЧШЩЬЮЯЇ");

export const isLit = (ch) => ch !== " " && ch !== " ";

/** Przycina glif 3x10 do zapalonych kolumn. */
export function cropGlyph(rows) {
  let left = GLYPH_W, right = -1;
  for (let x = 0; x < GLYPH_W; x++) {
    if (rows.some((r) => isLit(r[x] ?? " "))) { left = Math.min(left, x); right = x; }
  }
  if (right < left) return { rows: rows.map(() => ""), w: 0 };
  return { rows: rows.map((r) => r.slice(left, right + 1)), w: right - left + 1 };
}

/** Kompiluje napis. Zwraca { rows[10], usedW, fit, invalid[] }. */
export function compileText(text, font) {
  const glyphs = [];
  const invalid = new Set();
  for (const ch of Array.from(String(text ?? ""))) {
    if (ch === " ") { glyphs.push(null); continue; }
    const g = font?.[ch] ?? font?.[ch.toUpperCase()];
    if (!g || /[\n\r\t]/.test(ch)) { invalid.add(ch); continue; }
    glyphs.push(cropGlyph(Array.from({ length: TILES_Y }, (_, i) => String(g[i] ?? "").padEnd(GLYPH_W, " ").slice(0, GLYPH_W))));
  }

  // szerokość: między dwoma glifami 1 kolumna przerwy, każda spacja dokłada
  // 1 kolumnę do tej przerwy (decyzja 2026-10-20: słowa wyraźnie rozdzielone,
  // „A B” szersze niż „AB”); spacje na brzegach -- po 1 kolumnie.
  const layout = [];
  let x = 0, prevGlyph = false;
  for (const g of glyphs) {
    if (!g) { x += 1; continue; }
    if (prevGlyph) x += 1;
    layout.push({ g, x });
    x += g.w;
    prevGlyph = true;
  }
  const usedW = x;
  const fit = usedW <= TILES_X;
  const offset = fit ? Math.floor((TILES_X - usedW) / 2) : 0;

  const grid = Array.from({ length: TILES_Y }, () => Array(TILES_X).fill(" "));
  for (const { g, x: gx } of layout) {
    for (let y = 0; y < TILES_Y; y++) {
      for (let cx = 0; cx < g.w; cx++) {
        const outX = offset + gx + cx;
        const c = g.rows[y][cx] ?? " ";
        if (outX < TILES_X && c !== " ") grid[y][outX] = c;
      }
    }
  }
  return { rows: grid.map((r) => r.join("")), usedW, fit, invalid: [...invalid] };
}

