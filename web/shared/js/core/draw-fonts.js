// Czcionki edytora rysunku logo (decyzja użytkownika 2026-11-08): własny
// zestaw dołączony do serwisu — wszędzie wygląda tak samo, niezależnie od
// czcionek zainstalowanych w systemie. Jeden plik .woff2 na czcionkę
// (zmienna: wszystkie grubości w jednym pliku), litery łacińskie, polskie
// i cyrylica. Pliki i licencje: web/shared/fonts/ (jedno miejsce na wszystkie
// czcionki serwisu, także „papieru” Prowadzącego z motywów — SHARED_FONT_FILES
// w display/theme-file.js).
//
// W scenie rysunku (fabricData) obiekt tekstu ma fontFamily = `family`.
// Edytor, podgląd na Wyświetlaczu i ekran prowadzącego ładują czcionkę
// przez ensureDrawFonts() przed rysowaniem.
import { v as cacheBust } from "./cache-bust.js?v=v2026-11-08T23092";

/** { family, file, weight } — weight: zakres osi grubości albo jedyna grubość. */
export const DRAW_FONTS = [
  { family: "Roboto", file: "roboto", weight: "100 900" },
  { family: "Montserrat", file: "montserrat", weight: "100 900" },
  { family: "Rubik", file: "rubik", weight: "300 900" },
  { family: "Nunito", file: "nunito", weight: "200 1000" },
  { family: "Comfortaa", file: "comfortaa", weight: "300 700" },
  { family: "Exo 2", file: "exo2", weight: "100 900" },
  { family: "Jura", file: "jura", weight: "300 700" },
  { family: "Tektur", file: "tektur", weight: "400 900" },
  { family: "Oswald", file: "oswald", weight: "200 700" },
  { family: "Unbounded", file: "unbounded", weight: "200 900" },
  { family: "Russo One", file: "russoone", weight: "400" },
  { family: "Dela Gothic One", file: "delagothicone", weight: "400" },
  { family: "Rubik Mono One", file: "rubikmonoone", weight: "400" },
  { family: "Climate Crisis", file: "climatecrisis", weight: "400" },
  { family: "Rubik Bubbles", file: "rubikbubbles", weight: "400" },
  { family: "Ruslan Display", file: "ruslandisplay", weight: "400" },
  { family: "Merriweather", file: "merriweather", weight: "300 900" },
  { family: "Playfair Display", file: "playfairdisplay", weight: "400 900" },
  { family: "Roboto Slab", file: "robotoslab", weight: "100 900" },
  { family: "Yeseva One", file: "yesevaone", weight: "400" },
  { family: "Kurale", file: "kurale", weight: "400" },
  { family: "Poiret One", file: "poiretone", weight: "400" },
  { family: "Lobster", file: "lobster", weight: "400" },
  { family: "Pacifico", file: "pacifico", weight: "400" },
  { family: "Caveat", file: "caveat", weight: "400 700" },
  { family: "Marck Script", file: "marckscript", weight: "400" },
  { family: "Press Start 2P", file: "pressstart2p", weight: "400" },
  { family: "Tiny5", file: "tiny5", weight: "100 900" },
  { family: "Handjet", file: "handjet", weight: "100 900" },
  { family: "JetBrains Mono", file: "jetbrainsmono", weight: "100 800" },
];

export const DEFAULT_DRAW_FONT = "Roboto";

const BY_FAMILY = new Map(DRAW_FONTS.map((f) => [f.family, f]));
/** Adres pliku czcionki serwisu (web/shared/fonts/<file>.woff2). */
export const sharedFontUrl = (file) => new URL(`../../fonts/${file}.woff2`, import.meta.url).href;
const fileUrl = (f) => sharedFontUrl(f.file);


/** Czcionka z zestawu albo null. */
export const drawFontOf = (family) => BY_FAMILY.get(String(family || "").trim()) || null;

/**
 * Nazwa z zestawu dla fontFamily ze sceny. Rysunki zapisane przed własnym
 * zestawem dostały odpowiedniki w migracji 525; plik .famlogo zapisany
 * wcześniej przechodzi przez tę samą zamianę przy imporcie (package.js).
 */
export function normalizeDrawFont(family) {
  const name = String(family || "").trim();
  if (BY_FAMILY.has(name)) return name;
  const first = name.split(",")[0].trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  for (const [re, target] of LEGACY) if (re.test(first)) return target;
  return DEFAULT_DRAW_FONT;
}

// Dawne czcionki systemowe -> najbliższy krój z zestawu (pierwsza nazwa listy).
const LEGACY = [
  [/^(times new roman|georgia|garamond|palatino linotype|book antiqua|cambria)$/, "Merriweather"],
  [/^(didot|bodoni mt)$/, "Playfair Display"],
  [/^(rockwell|cooper black)$/, "Roboto Slab"],
  [/^(courier new|consolas|lucida console|cascadia mono|monaco)$/, "JetBrains Mono"],
  [/^(impact|haettenschweiler)$/, "Oswald"],
  [/^(arial black|futura|century gothic)$/, "Montserrat"],
  [/^(arial rounded mt bold)$/, "Nunito"],
  [/^(comic sans ms)$/, "Caveat"],
  [/^(brush script mt)$/, "Pacifico"],
  [/^(segoe script|lucida handwriting|apple chancery|snell roundhand)$/, "Marck Script"],
  [/^(papyrus)$/, "Kurale"],
  [/^(copperplate gothic)$/, "Yeseva One"],
];

const loaded = new Map(); // family -> Promise

/** Rejestruje i ładuje czcionki z zestawu (raz na stronę). */
export function ensureDrawFonts(families) {
  return Promise.all([...new Set(families)].map((family) => {
    const f = drawFontOf(family);
    if (!f || typeof FontFace === "undefined") return null;
    if (!loaded.has(f.family)) {
      loaded.set(f.family, (async () => {
        const face = new FontFace(f.family, `url("${await cacheBust(fileUrl(f))}") format("woff2")`, { weight: f.weight, display: "block" });
        await face.load();
        document.fonts.add(face);
        return face;
      })().catch((error) => {
        loaded.delete(f.family);
        console.warn("[draw-fonts]", f.family, error);
        return null;
      }));
    }
    return loaded.get(f.family);
  }));
}

/**
 * @font-face z osadzonym plikiem (data:) dla obrazu SVG — obraz SVG nie
 * widzi czcionek strony (ekran prowadzącego rysuje logo jako SVG).
 */
export async function drawFontFaceCss(families) {
  const rules = await Promise.all([...new Set(families)].map(async (family) => {
    const f = drawFontOf(family);
    if (!f) return "";
    const res = await fetch(await cacheBust(fileUrl(f)));
    if (!res.ok) return "";
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `@font-face{font-family:"${f.family}";font-weight:${f.weight};src:url(data:font/woff2;base64,${btoa(bin)}) format("woff2");}`;
  }));
  return rules.join("");
}

/** Wszystkie fontFamily obiektów tekstu w scenie (także w grupach). */
export function sceneFontFamilies(scene) {
  const out = new Set();
  const visit = (o) => {
    if (!o || typeof o !== "object") return;
    if (/text/i.test(o.type || "") && o.fontFamily) out.add(o.fontFamily);
    o.objects?.forEach(visit);
  };
  scene?.objects?.forEach(visit);
  return [...out];
}
