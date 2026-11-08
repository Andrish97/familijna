// The file importer and copy sender use the same canonical logo package.
import { normalizeDrawFont } from "../../shared/js/core/draw-fonts.js?v=v2026-11-08T18113";
import { DOT_W, DOT_H, TYPE_GLYPH, TYPE_PIX, PIX_FORMAT, normalizeRows } from "./render.js?v=v2026-11-08T18113";


// Nazwa logo: jak w polu nazwy i w bazie (migracja 514).
export const LOGO_NAME_MAX = 80;
// Plik .famlogo z dysku: obrazy tylko osadzone (data:, tak zapisuje eksport)
// albo z własnego Storage (bucket user-logos). Adres z obcego pliku pobierałby
// obraz z dowolnego serwera na ekranie Prowadzącego (loadFromJSON rysunku).
// Kopie między kontami przenosi serwer (duplicate.js), więc parser wspólny
// (parseLogoPackage) zostawia adresy bez zmian.
// Host przypięty do własnego API (E24 R28; dawny adres familiada.online — stare eksporty).
const OWN_IMAGE_URL = /^https:\/\/api\.(familijna\.app|familiada\.online)\/storage\/v1\/object\/public\/user-logos\/[^?#]+$/i;
const EMBEDDED_IMAGE = /^data:image\/(png|jpe?g|gif|webp);base64,/i;
const allowedImage = (src) => EMBEDDED_IMAGE.test(src) || OWN_IMAGE_URL.test(src);

function cleanScene(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const out = { ...node };
  for (const key of ["backgroundImage", "overlayImage"]) {
    if (out[key] && typeof out[key] === "object" && typeof out[key].src === "string" && !allowedImage(out[key].src)) delete out[key];
  }
  if (out.fill && typeof out.fill === "object" && typeof out.fill.source === "string" && !allowedImage(out.fill.source)) delete out.fill;
  // tekst: tylko czcionki z zestawu (plik zapisany przed zestawem — odpowiednik)
  if (/text/i.test(out.type || "")) out.fontFamily = normalizeDrawFont(out.fontFamily);
  if (Array.isArray(out.objects)) {
    out.objects = out.objects
      .filter((o) => !(o && typeof o === "object" && typeof o.src === "string" && !allowedImage(o.src)))
      .map(cleanScene);
  }
  return out;
}

export function sanitizeLogoFileImport(logo) {
  const source = logo?.payload?.source;
  if (!source || typeof source !== "object") return logo;
  const clean = { ...source };
  if (typeof clean.imageUrl === "string" && !OWN_IMAGE_URL.test(clean.imageUrl)) delete clean.imageUrl;
  if (clean.fabricData) clean.fabricData = cleanScene(clean.fabricData);
  return { ...logo, payload: { ...logo.payload, source: clean } };
}

function invalid(code, params = {}) {
  const error = new Error(code);
  error.code = code;
  error.params = params;
  throw error;
}

export function parseLogoPackage(obj, fallbackName) {
  const kindRaw = String(obj?.kind || "").toUpperCase();
  const typeRaw = String(obj?.type || "").toUpperCase();
  const kind = kindRaw || (typeRaw.includes("GLYPH") ? "GLYPH" : typeRaw.includes("PIX") ? "PIX" : "");
  const name = (String(obj?.name || "").trim() || String(fallbackName || "")).slice(0, LOGO_NAME_MAX);
  const p = obj?.payload || {};
  const source = p.source && typeof p.source === "object" ? { ...p.source } : {};
  delete source.editHistory;
  if (source.imageData) delete source.imageUrl;
  delete source.hostRasterUrl;
  delete source.hostRasterData;
  if (kind === "GLYPH") {
    const rows = normalizeRows(p.rows ?? p.layers?.[0]?.rows ?? obj?.rows);
    if (!source.mode) source.mode = "TEXT";
    return { name, type: TYPE_GLYPH, payload: { layers: [{ color: "main", rows }], source } };
  }
  if (kind === "PIX") {
    const w = Number(p.w) || DOT_W;
    const h = Number(p.h) || DOT_H;
    if (w !== DOT_W || h !== DOT_H) invalid("pixSize", { expectedW: DOT_W, expectedH: DOT_H, actualW: w, actualH: h });
    const bits_b64 = String(p.bits_b64 || "");
    if (!bits_b64) invalid("missingBits");
    if (!source.mode) source.mode = source.fabricData ? "DRAW" : "IMAGE";
    return { name, type: TYPE_PIX, payload: { w, h, format: PIX_FORMAT, bits_b64, source } };
  }
  invalid("unknownImportFormat");
}
