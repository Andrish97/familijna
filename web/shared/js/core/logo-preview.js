// js/core/logo-preview.js
// Shared logo preview rendering (used by control and logo-editor)
// Identyczna logika jak control/display/js/fonts.js + scene.js

const DOT_W = 150;
const DOT_H = 70;
const TILES_X = 30;
const TILES_Y = 10;

// Identycznie jak control/display/js/fonts.js buildGlyphMap — zwraca Map
function buildGlyphMap(fontJson) {
  const map = new Map();
  for (const [groupName, groupVal] of Object.entries(fontJson || {})) {
    if (groupName === "meta") continue;
    const obj = groupVal || {};
    for (const [k, v] of Object.entries(obj)) {
      map.set(k, v);
    }
  }
  return map;
}

// Identycznie jak control/display/js/fonts.js resolveGlyph — obsługuje aliasy "@"
function resolveGlyph(glyphs, ch) {
  const v = glyphs.get(ch);
  if (!v) return glyphs.get(" ") || [0, 0, 0, 0, 0, 0, 0];
  if (typeof v === "string" && v.startsWith("@")) {
    return resolveGlyph(glyphs, v.slice(1));
  }
  return v;
}

import { v } from './cache-bust.js?v=v2026-11-08T10534';

export async function loadFont5x7(url = "/shared/fonts/display/font_5x7.json?v=v2026-11-08T10534") {

  const r = await fetch(await v(url), { cache: "force-cache" });
  if (!r.ok) throw new Error(`Font 5x7: HTTP ${r.status}`);
  const json = await r.json();
  return buildGlyphMap(json);
}

export function rows30x10ToBits150(rows10, glyphs) {
  const out = new Uint8Array(DOT_W * DOT_H);
  if (!glyphs) return out;
  for (let ty = 0; ty < TILES_Y; ty++) {
    const rowStr = String(rows10?.[ty] ?? "").padEnd(30, " ").slice(0, 30);
    for (let tx = 0; tx < TILES_X; tx++) {
      const ch = rowStr[tx] ?? " ";
      const glyph = resolveGlyph(glyphs, ch);
      for (let py = 0; py < 7; py++) {
        const bits = (glyph[py] ?? 0) | 0;
        for (let px = 0; px < 5; px++) {
          if (!(bits & (1 << (4 - px)))) continue;
          const x = tx * 5 + px;
          const y = ty * 7 + py;
          out[y * DOT_W + x] = 1;
        }
      }
    }
  }
  return out;
}

function base64ToBytes(b64) {
  try {
    const bin = atob((b64 || "").replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array(0);
  }
}

export function unpackBitsRowMajorMSB(bitsB64, w, h) {
  const bytes = base64ToBytes(bitsB64);
  const bytesPerRow = Math.ceil(w / 8);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const rowBase = y * bytesPerRow;
    for (let x = 0; x < w; x++) {
      const byteIndex = rowBase + (x >> 3);
      if (byteIndex < 0 || byteIndex >= bytes.length) continue;
      out[y * w + x] = (bytes[byteIndex] >> (7 - (x & 7))) & 1;
    }
  }
  return out;
}

function drawThumbFlat150x70(canvas, bits150) {
  const ctx = canvas.getContext("2d");
  const cw = canvas.width, ch = canvas.height;
  const scale = Math.min(cw / DOT_W, ch / DOT_H);
  const ox = Math.floor((cw - DOT_W * scale) / 2);
  const oy = Math.floor((ch - DOT_H * scale) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.fillStyle = "#fff";
  for (let y = 0; y < DOT_H; y++) {
    for (let x = 0; x < DOT_W; x++) {
      if (!bits150[y * DOT_W + x]) continue;
      ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
    }
  }
}

/**
 * Spłaszcza dowolny zapisany w bazie payload logo ({type, payload} —
 * GLYPH_30x10 albo PIX_150x70) do jednej, jednolitej siatki bitów 150x70
 * (Uint8Array, 1=zapalony/lit, 0=zgaszony) — ten sam kształt niezależnie od
 * typu źródłowego. Wydzielone z buildLogoPreviewCanvas(), żeby dało się
 * reużyć samo rozstrzygnięcie bitów bez rysowania na canvasie (np.
 * control/host/js/coverLogo.js rysuje siatkę litych kwadratów SVG zamiast obrazka).
 * @param {object|null} logo   - { type, payload } — wiersz z bazy albo skonstruowany obiekt
 * @param {Map|null}    glyphs - wynik loadFont5x7() (Map) — wymagane dla typu GLYPH
 */
export function logoToBits150(logo, glyphs) {
  if (logo?.type === "GLYPH_30x10") {
    const rows = logo?.payload?.layers?.[0]?.rows;
    const rows10 = Array.isArray(rows) && rows.length
      ? rows.map(r => String(r || "").padEnd(30, " ").slice(0, 30)).slice(0, 10)
      : Array.from({ length: 10 }, () => " ".repeat(30));
    return rows30x10ToBits150(rows10, glyphs);
  }
  if (logo?.type === "PIX_150x70") {
    const p = logo.payload || {};
    const w = Number(p.w) || DOT_W;
    const h = Number(p.h) || DOT_H;
    const raw = p.bits_b64 || p.bits_base64 || p.bitsBase64 || "";
    return (w === DOT_W && h === DOT_H)
      ? unpackBitsRowMajorMSB(raw, w, h)
      : new Uint8Array(DOT_W * DOT_H);
  }
  return new Uint8Array(DOT_W * DOT_H);
}

/**
 * Build a preview canvas for a DB logo record (or a raw logo payload object).
 * @param {object|null} logo     - { type, payload } — DB row or constructed object
 * @param {Map|null}    glyphs   - result of loadFont5x7() (Map) — needed for GLYPH type
 * @param {number}      width    - canvas px width  (default 300)
 * @param {number}      height   - canvas px height (default 140)
 */
export function buildLogoPreviewCanvas(logo, glyphs, width = 300, height = 140, ownerDocument = document) {
  const c = ownerDocument.createElement("canvas");
  c.width = width;
  c.height = height;
  drawThumbFlat150x70(c, logoToBits150(logo, glyphs));
  return c;
}

/* ---------- podgląd „jak na wyświetlaczu” (30x10 kafli po 5x7 okrągłych kropek) ---------- */
// Ten sam w edytorze logo, imporcie pliku i w panelu admina (podgląd demo).

const COLORS = { bg: "#1f1f23", cell: "#000000", dotOff: "#1f1f23", dotOn: "#d7ff3d" };

// Szary margines wokół tablicy: równy z każdej strony (6 średnic kropki).
// Płótno przycinane do tablicy + marginesu, więc podgląd ma symetryczne tło
// niezależnie od rozmiaru z HTML (ten rozmiar = największe dopuszczalne pole).
// Dla 1060x480 (panel admina) wynik jak dawniej: d = 4, margines 24 px.
const PAD_DOTS = 6;

function layoutFor(box) {
  for (let d = 64; d >= 2; d--) {
    const gap = Math.max(1, Math.round(d / 4));
    const tileGap = 2 * d;
    const tileW = 5 * d + 6 * gap;
    const tileH = 7 * d + 8 * gap;
    const panelW = TILES_X * tileW + (TILES_X - 1) * tileGap;
    const panelH = TILES_Y * tileH + (TILES_Y - 1) * tileGap;
    const pad = PAD_DOTS * d;
    if (panelW + 2 * pad <= box.w && panelH + 2 * pad <= box.h) {
      return { d, gap, tileGap, tileW, tileH, panelW, panelH, pad };
    }
  }
  const d = 2, gap = 1, tileGap = 4, tileW = 5 * d + 6 * gap, tileH = 7 * d + 8 * gap;
  return {
    d, gap, tileGap, tileW, tileH,
    panelW: TILES_X * tileW + (TILES_X - 1) * tileGap,
    panelH: TILES_Y * tileH + (TILES_Y - 1) * tileGap,
    pad: PAD_DOTS * d,
  };
}

/** Rysuje 150x70 bitów jako tablicę kropek na canvasie. */
export function renderBitsToCanvas(bits, canvas, box = null) {
  if (!canvas) return;
  // największe pole: podane (piksele ekranu, np. pole na stronie × gęstość
  // ekranu × przybliżenie) albo rozmiar z HTML (zapamiętany przy pierwszym rysowaniu)
  canvas.__logoBox ||= { w: canvas.width, h: canvas.height };
  const L = layoutFor(box || canvas.__logoBox);
  const w = L.panelW + 2 * L.pad, h = L.panelH + 2 * L.pad;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const g = canvas.getContext("2d");
  g.fillStyle = COLORS.bg;
  g.fillRect(0, 0, canvas.width, canvas.height);

  const x0 = L.pad;
  const y0 = L.pad;
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
