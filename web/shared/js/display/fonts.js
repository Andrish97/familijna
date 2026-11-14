import { v } from '../core/cache-bust.js?v=v2026-11-14T13542';


export const loadJson = async (url) => {
  const res = await fetch(await v(url), { cache: "no-store" });
  if (!res.ok) throw new Error(`Nie można wczytać: ${url}`);
  return res.json();
};

// Buduje mapę GLYPHS z *wszystkich* kategorii w font_5x7.json,
// oprócz "meta". Czyli jak dodasz np. "emoji": {...}, to też zadziała.
export const buildGlyphMap = (FONT) => {
  const map = new Map();

  for (const [groupName, groupVal] of Object.entries(FONT || {})) {
    if (groupName === "meta") continue;
    const obj = groupVal || {};
    for (const [k, v] of Object.entries(obj)) {
      map.set(k, v);
    }
  }

  return map;
};

/**
 * Czy Wyświetlacz narysuje znak: glif dla znaku po NFC albo dla jego
 * jednoznakowej wielkiej litery (renderer rysuje wielkimi literami). Jedno
 * źródło dla pól wpisu (nazwy drużyn, odpowiedzi -- E21); SQL ma tę samą regułę
 * (public.fam_display_has_glyph). Białe znaki nie mają glifu -- sprawdza wołający.
 */
export const hasDisplayGlyph = (GLYPHS, ch) => {
  if (!GLYPHS) return false;
  const glyphOf = (c) => {
    let v = GLYPHS.get(c);
    for (let i = 0; i < 4 && typeof v === "string" && v.startsWith("@"); i++) v = GLYPHS.get(v.slice(1));
    return Array.isArray(v);
  };
  const base = String(ch ?? "").normalize("NFC");
  if (Array.from(base).length !== 1) return false;
  if (glyphOf(base)) return true;
  const upper = base.toUpperCase();
  return Array.from(upper).length === 1 && glyphOf(upper);
};

export const resolveGlyph = (GLYPHS, ch) => {
  const v = GLYPHS.get(ch);
  if (!v) return GLYPHS.get(" ") || [0,0,0,0,0,0,0];
  if (typeof v === "string" && v.startsWith("@")) {
    return resolveGlyph(GLYPHS, v.slice(1));
  }
  return v;
};
