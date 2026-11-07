// familiada/logos/js/render.js
// Wspólne dla wszystkich trybów: format bitów PIX 150x70 i podgląd
// „jak na wyświetlaczu” (30x10 kafli po 5x7 kropek). Zamiana GLYPH ->
// kropki: js/core/logo-preview.js (ta sama co na wyświetlaczu).

import { rows30x10ToBits150, renderBitsToCanvas } from "../../shared/js/core/logo-preview.js?v=v2026-11-07T22490";


export const TILES_X = 30;
export const TILES_Y = 10;
export const DOT_W = TILES_X * 5; // 150
export const DOT_H = TILES_Y * 7; // 70

export const TYPE_GLYPH = "GLYPH_30x10";
export const TYPE_PIX = "PIX_150x70";
export const PIX_FORMAT = "BITPACK_MSB_FIRST_ROW_MAJOR";

export const emptyRows = () => Array.from({ length: TILES_Y }, () => " ".repeat(TILES_X));

export function normalizeRows(rows) {
  return Array.from({ length: TILES_Y }, (_, i) => String(rows?.[i] ?? "").padEnd(TILES_X, " ").slice(0, TILES_X));
}

/* ---------- bitpack (PIX_150x70) ---------- */

export function packBits(bits01, w = DOT_W, h = DOT_H) {
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(bytesPerRow * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (bits01[y * w + x]) out[y * bytesPerRow + (x >> 3)] |= 1 << (7 - (x & 7));
    }
  }
  let bin = "";
  for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
  return btoa(bin);
}

export function unpackBits(b64, w = DOT_W, h = DOT_H) {
  let bytes;
  try {
    const bin = atob(String(b64 || "").replace(/\s+/g, ""));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    bytes = new Uint8Array(0);
  }
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * bytesPerRow + (x >> 3);
      if (i < bytes.length) out[y * w + x] = (bytes[i] >> (7 - (x & 7))) & 1;
    }
  }
  return out;
}

/* ---------- podgląd „jak na wyświetlaczu” ---------- */
// Jedno źródło dla aplikacji i panelu admina: js/core/logo-preview.js.
export { renderBitsToCanvas };

/** Podgląd w formacie edytora: { kind:"GLYPH", rows } albo { kind:"PIX", bits }. */
export function renderPreview(preview, canvas, glyphs) {
  if (!preview) return;
  const bits = preview.kind === "GLYPH" ? rows30x10ToBits150(normalizeRows(preview.rows), glyphs) : preview.bits;
  renderBitsToCanvas(bits || new Uint8Array(DOT_W * DOT_H), canvas);
}

/** Rekord z bazy -> podgląd. */
export function logoToPreview(logo) {
  if (logo?.type === TYPE_PIX) {
    const p = logo.payload || {};
    if ((Number(p.w) || DOT_W) !== DOT_W || (Number(p.h) || DOT_H) !== DOT_H) {
      return { kind: "PIX", bits: new Uint8Array(DOT_W * DOT_H) };
    }
    return { kind: "PIX", bits: unpackBits(p.bits_b64) };
  }
  return { kind: "GLYPH", rows: normalizeRows(logo?.payload?.layers?.[0]?.rows) };
}
