// familiada/logos/js/render.js
// Wspólne dla wszystkich trybów: format bitów PIX 150x70 i podgląd
// „jak na wyświetlaczu” (30x10 kafli po 5x7 kropek). Zamiana GLYPH ->
// kropki: js/core/logo-preview.js (ta sama co na wyświetlaczu).

import { rows30x10ToBits150 } from "../../shared/js/core/logo-preview.js?v=v2026-11-05T18070";


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

const COLORS = { bg: "#1f1f23", cell: "#000000", dotOff: "#1f1f23", dotOn: "#d7ff3d" };

function layoutFor(canvas) {
  for (let d = 16; d >= 2; d--) {
    const gap = Math.max(1, Math.round(d / 4));
    const tileGap = 2 * d;
    const tileW = 5 * d + 6 * gap;
    const tileH = 7 * d + 8 * gap;
    const panelW = TILES_X * tileW + (TILES_X - 1) * tileGap;
    const panelH = TILES_Y * tileH + (TILES_Y - 1) * tileGap;
    if (panelW <= canvas.width - 20 && panelH <= canvas.height - 20) {
      return { d, gap, tileGap, tileW, tileH, panelW, panelH };
    }
  }
  const d = 2, gap = 1, tileGap = 4, tileW = 5 * d + 6 * gap, tileH = 7 * d + 8 * gap;
  return {
    d, gap, tileGap, tileW, tileH,
    panelW: TILES_X * tileW + (TILES_X - 1) * tileGap,
    panelH: TILES_Y * tileH + (TILES_Y - 1) * tileGap,
  };
}

/** Rysuje 150x70 bitów jako tablicę kropek na canvasie. */
export function renderBitsToCanvas(bits, canvas) {
  if (!canvas) return;
  const g = canvas.getContext("2d");
  const L = layoutFor(canvas);
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);

  const x0 = Math.floor((canvas.width - L.panelW) / 2);
  const y0 = Math.floor((canvas.height - L.panelH) / 2);
  const r = L.d / 2;
  const step = L.d + L.gap;

  for (let ty = 0; ty < TILES_Y; ty++) {
    for (let tx = 0; tx < TILES_X; tx++) {
      const tileX = x0 + tx * (L.tileW + L.tileGap);
      const tileY = y0 + ty * (L.tileH + L.tileGap);
      g.fillStyle = COLORS.cell;
      g.fillRect(tileX, tileY, L.tileW, L.tileH);
      for (let py = 0; py < 7; py++) {
        for (let px = 0; px < 5; px++) {
          g.beginPath();
          g.arc(tileX + L.gap + r + px * step, tileY + L.gap + r + py * step, r, 0, Math.PI * 2);
          g.fillStyle = bits[(ty * 7 + py) * DOT_W + tx * 5 + px] ? COLORS.dotOn : COLORS.dotOff;
          g.fill();
        }
      }
    }
  }
}

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
