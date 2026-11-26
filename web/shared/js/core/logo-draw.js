// Rysowanie logo 150×70 kropek z opisu kształtów (narzędzie czatu draw_logo).
// Bez DOM i bez Fabrica — działa w przeglądarce i na serwerze MCP. Wynik:
// bity w formacie PIX_150x70 (jak edytor rysunku); edytor wczytuje je jako
// warstwę do dalszego rysowania (logos/js/draw.js loadSource bez fabricData).
// Napisy czcionką tablicy 5×7 (shared/fonts/display/font_5x7.json), skala 1–10,
// litera = kafel tablicy (napis przyciągany do kafli).

export const DOT_W = 150;
export const DOT_H = 70;
export const PIX_FORMAT = "BITPACK_MSB_FIRST_ROW_MAJOR";

/** Mapa znak → 7 wierszy po 5 bitów z pliku czcionki 5×7. */
export function glyphMap(font5x7) {
  const map = new Map();
  for (const [group, chars] of Object.entries(font5x7 || {})) {
    if (group === "meta" || !chars || typeof chars !== "object") continue;
    for (const [ch, rows] of Object.entries(chars)) if (Array.isArray(rows)) map.set(ch, rows);
  }
  return map;
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * shapes: [{ type, … }] w kropkach (x 0–149, y 0–69), kolor "on" (świeci) albo "off";
 * kształty domyślnie wypełnione, fill: false — obrys.
 *   rect { x, y, w, h, fill?, stroke? }   ellipse { cx, cy, rx, ry, fill?, stroke? }
 *   line { x1, y1, x2, y2, stroke? }      polygon { points:[x,y,…], fill?, stroke? }
 *   polyline { points, stroke? }          text { x, y, text, scale?, align? }
 * background: "black" (kropki zgaszone) albo "white" (wszystkie świecą).
 */
export function drawLogoBits({ shapes = [], background = "black" } = {}, font5x7 = null) {
  const bits = new Uint8Array(DOT_W * DOT_H);
  if (background === "white") bits.fill(1);
  const warnings = [];
  const glyphs = glyphMap(font5x7);
  let paint = 1;
  const plot = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < DOT_W && y < DOT_H) bits[y * DOT_W + x] = paint;
  };
  const dot = (x, y, w) => {
    if (w <= 1) return plot(x, y);
    const r = (w - 1) / 2;
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) if (dx * dx + dy * dy <= r * r + 0.25) plot(x + dx, y + dy);
  };
  const seg = (x1, y1, x2, y2, w) => {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))));
    for (let i = 0; i <= n; i++) dot(x1 + ((x2 - x1) * i) / n, y1 + ((y2 - y1) * i) / n, w);
  };
  // wypełnienie wielokąta: parzystość przecięć w środku każdej kropki
  const fillPoly = (pts) => {
    const ys = pts.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(DOT_H - 1, Math.ceil(Math.max(...ys))); y++) {
      const cy = y + 0.5;
      const xs = [];
      for (let i = 0; i < pts.length; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % pts.length];
        if ((ay <= cy && by > cy) || (by <= cy && ay > cy)) xs.push(ax + ((cy - ay) * (bx - ax)) / (by - ay));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) plot(x, y);
    }
  };
  const pairs = (flat) => {
    const out = [];
    const a = Array.isArray(flat) ? flat.flat().map(Number) : [];
    for (let i = 0; i + 1 < a.length; i += 2) if (Number.isFinite(a[i]) && Number.isFinite(a[i + 1])) out.push([a[i], a[i + 1]]);
    return out;
  };

  shapes.forEach((s, index) => {
    if (!s || typeof s !== "object") return;
    paint = s.color === "off" ? 0 : 1;
    const stroke = Math.max(1, Math.min(20, num(s.stroke, 1)));
    // kształty domyślnie wypełnione; fill: false = sam obrys grubości stroke
    const fill = s.fill === undefined ? true : !!s.fill;
    switch (s.type) {
      case "rect": {
        const x = num(s.x), y = num(s.y), w = num(s.w), h = num(s.h);
        if (w <= 0 || h <= 0) { warnings.push(`#${index}: rect needs w and h > 0`); break; }
        if (fill) for (let yy = Math.round(y); yy < Math.round(y + h); yy++) for (let xx = Math.round(x); xx < Math.round(x + w); xx++) plot(xx, yy);
        else { const x2 = x + w - 1, y2 = y + h - 1; seg(x, y, x2, y, stroke); seg(x2, y, x2, y2, stroke); seg(x2, y2, x, y2, stroke); seg(x, y2, x, y, stroke); }
        break;
      }
      case "ellipse": {
        const cx = num(s.cx), cy = num(s.cy), rx = Math.abs(num(s.rx)), ry = Math.abs(num(s.ry, s.rx));
        if (!rx || !ry) { warnings.push(`#${index}: ellipse needs rx and ry`); break; }
        if (fill) {
          for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) plot(x, y);
          }
        } else {
          const n = Math.max(24, Math.ceil(2 * Math.PI * Math.max(rx, ry)));
          for (let i = 0; i < n; i++) {
            const a1 = (2 * Math.PI * i) / n, a2 = (2 * Math.PI * (i + 1)) / n;
            seg(cx + rx * Math.cos(a1), cy + ry * Math.sin(a1), cx + rx * Math.cos(a2), cy + ry * Math.sin(a2), stroke);
          }
        }
        break;
      }
      case "line":
        seg(num(s.x1), num(s.y1), num(s.x2), num(s.y2), stroke);
        break;
      case "polygon":
      case "polyline": {
        const pts = pairs(s.points);
        if (pts.length < 2) { warnings.push(`#${index}: ${s.type} needs points [x,y,x,y,…]`); break; }
        if (s.type === "polygon" && fill && pts.length >= 3) fillPoly(pts);
        else {
          for (let i = 0; i + 1 < pts.length; i++) seg(...pts[i], ...pts[i + 1], stroke);
          if (s.type === "polygon") seg(...pts.at(-1), ...pts[0], stroke);
        }
        break;
      }
      case "text": {
        // Napis trzyma się kafli tablicy (30×10 kafli po 5×7 kropek, z przerwami
        // między kaflami): litera = scale×scale kafli, bez dodatkowej przerwy —
        // odstęp daje przerwa między kaflami. x, y przyciągane do kafli.
        const text = String(s.text || "").toUpperCase();
        const scale = Math.max(1, Math.min(10, Math.round(num(s.scale, 1))));
        const width = text.length * 5 * scale;
        let x0 = num(s.x);
        if (s.align === "center") x0 -= width / 2;
        else if (s.align === "right") x0 -= width;
        x0 = Math.round(x0 / 5) * 5;
        const y0 = Math.round(num(s.y) / 7) * 7;
        const missing = new Set();
        [...text].forEach((ch, i) => {
          const rows = ch === " " ? [0, 0, 0, 0, 0, 0, 0] : glyphs.get(ch);
          if (!rows) { missing.add(ch); return; }
          rows.forEach((row, ry) => {
            for (let rx = 0; rx < 5; rx++) {
              if (!((row >> (4 - rx)) & 1)) continue;
              for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) plot(x0 + (i * 5 + rx) * scale + sx, y0 + ry * scale + sy);
            }
          });
        });
        if (missing.size) warnings.push(`#${index}: no board glyph for ${[...missing].join(" ")}`);
        if (x0 < 0 || x0 + width > DOT_W || y0 < 0 || y0 + 7 * scale > DOT_H) warnings.push(`#${index}: text goes outside the board (${width}×${7 * scale} dots at ${x0},${y0})`);
        break;
      }
      default:
        warnings.push(`#${index}: unknown type ${s.type}`);
    }
  });
  return { bits, warnings };
}

/** Bity → base64 (wiersze po bajtach, najstarszy bit z lewej) — jak logos/js/render.js packBits. */
export function packBits(bits) {
  const perRow = Math.ceil(DOT_W / 8);
  const out = new Uint8Array(perRow * DOT_H);
  for (let y = 0; y < DOT_H; y++) for (let x = 0; x < DOT_W; x++) if (bits[y * DOT_W + x]) out[y * perRow + (x >> 3)] |= 1 << (7 - (x & 7));
  let bin = "";
  for (const b of out) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Podgląd dla modelu: 75×35 znaków, każdy znak = 2×2 kropki („#” świeci, „+” częściowo, „.” zgaszone). */
export function previewAscii(bits) {
  const lines = [];
  for (let y = 0; y < DOT_H; y += 2) {
    let line = "";
    for (let x = 0; x < DOT_W; x += 2) {
      const n = bits[y * DOT_W + x] + bits[y * DOT_W + x + 1] + bits[(y + 1) * DOT_W + x] + bits[(y + 1) * DOT_W + x + 1];
      line += n === 4 ? "#" : n ? "+" : ".";
    }
    lines.push(line);
  }
  return lines.join("\n");
}
