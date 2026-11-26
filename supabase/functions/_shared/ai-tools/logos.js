// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: logo (lista, logo tekstowe, usuwanie). Logo tekstowe
// składa ta sama funkcja co edytor (logos/js/text.js, czcionka 3×10 —
// 30 × 10 znaków tablicy); zapis przez endpoint logo_create (migracja 534).
import { compileText } from "./logo-text.js";
import { drawLogoBits, packBits, previewAscii, DOT_W, DOT_H, PIX_FORMAT } from "./logo-draw.js";
import { uuid, noArgs, rpc, rows } from "./common.js";

// Czcionki z plików strony: ctx.loadJson (przeglądarka: wersjonowany adres; serwer MCP: adres strony).
const fonts = new Map();
const loadFont = (ctx, url) => {
  if (!fonts.has(url)) {
    const p = ctx.loadJson(url);
    fonts.set(url, p);
    p.catch(() => fonts.delete(url));
  }
  return fonts.get(url);
};
const font3x10 = (ctx) => loadFont(ctx, "/shared/fonts/display/font_3x10.json");
const font5x7 = (ctx) => loadFont(ctx, "/shared/fonts/display/font_5x7.json");

// Nowe logo (logo_create) albo nadpisanie istniejącego (update_logo_checked —
// ten sam endpoint co edytor; blokada puli logo jak przy edycji ręcznej).
async function saveLogo(ctx, { name, type, payload, replaceId }) {
  if (replaceId) {
    const [old] = await rows(ctx.db.from("user_logos").select("id,name").eq("id", replaceId));
    if (!old) return { ok: false, error: "not_found" };
    const patch = { type, payload, ...(name && name !== old.name ? { name } : {}) };
    const res = await rpc(ctx, "update_logo_checked", { p_logo_id: replaceId, p_patch: patch, p_tab_id: ctx.tabId });
    if (res?.ok) ctx.changed({ type: "logo", id: replaceId });
    return res?.ok ? { ok: true, id: replaceId, replaced: true } : res;
  }
  const res = await rpc(ctx, "logo_create", { p_name: name, p_type: type, p_payload: payload, p_tab_id: ctx.tabId });
  if (res?.ok) ctx.changed({ type: "logo", id: res.id });
  return res;
}

const SHAPE_TYPES = ["rect", "ellipse", "line", "polygon", "polyline", "text"];
const shapeSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: SHAPE_TYPES },
    color: { type: "string", enum: ["on", "off"], description: "on = lit dots (default), off = dark dots (cut out of lit areas)." },
    fill: { type: "boolean", description: "rect/ellipse/polygon: filled (default true); false = outline of width stroke." },
    stroke: { type: "integer", description: "Line/outline width in dots (1–20, default 1)." },
    x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" },
    cx: { type: "number" }, cy: { type: "number" }, rx: { type: "number" }, ry: { type: "number" },
    x1: { type: "number" }, y1: { type: "number" }, x2: { type: "number" }, y2: { type: "number" },
    points: { type: "array", items: { type: "number" }, description: "polygon/polyline: flat list x1,y1,x2,y2,…" },
    text: { type: "string", description: "text: capital letters, digits and symbols of the board font 5×7." },
    scale: { type: "integer", description: "text: letter size in tiles, 1 = one tile (5×7 dots, sharpest), 2 = 2×2 tiles … (1–10); bigger letters are crossed by the gaps between tiles. For a logo that is only big text use create_text_logo." },
    align: { type: "string", enum: ["left", "center", "right"], description: "text: x is the left edge, centre or right edge." },
  },
  required: ["type"],
};

export default [
  {
    name: "list_logos",
    description: "List the user's logos (id, name, type: GLYPH_30x10 = text logo, PIX_150x70 = drawing or image).",
    inputSchema: noArgs,
    readOnly: true,
    async run(_args, ctx) {
      return { logos: await rows(ctx.db.from("user_logos").select("id,name,type,updated_at").order("updated_at", { ascending: false })) };
    },
  },
  {
    name: "create_text_logo",
    description: "Create a text logo shown on the game board: the text is drawn in big board letters (about 7–9 characters fit; spaces separate words). Returns an error if the text is too wide or has characters the board cannot show.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Logo name, max 80 characters, unique." }, text: { type: "string" },
        replace_logo_id: { type: "string", description: "UUID of an existing logo to overwrite instead of creating a new one (its name stays unless name is changed)." },
      },
      required: ["name", "text"],
    },
    confirm: ({ replace_logo_id }) => (replace_logo_id ? "irreversible" : null),
    async run({ name, text, replace_logo_id }, ctx) {
      const compiled = compileText(String(text || ""), await font3x10(ctx));
      if (compiled.invalid.length) return { ok: false, error: "invalid_chars", chars: compiled.invalid };
      if (!compiled.fit) return { ok: false, error: "too_wide", used_columns: compiled.usedW, max_columns: 30 };
      const payload = { layers: [{ color: "main", rows: compiled.rows }], source: { mode: "TEXT", text: String(text) } };
      return saveLogo(ctx, { name, type: "GLYPH_30x10", payload, replaceId: replace_logo_id });
    },
  },
  {
    name: "draw_logo",
    description: "Draw a picture logo for the game board from shapes (the user describes it, you compose it). The board is 150×70 dots, each dot lit or dark (no colours, no grey); x 0–149 left→right, y 0–69 top→bottom. The dots form 30×10 tiles of 5×7 dots with visible gaps between tiles, so thin lines look best inside tiles and big shapes read well. Shapes are drawn in order; color off cuts dark dots out of lit ones. Text uses the board font: one letter = one tile (scale 2 = 2×2 tiles), snapped to tiles — at most 30/scale letters per line and 10/scale lines; x is a multiple of 5, y of 7. First call with preview_only = true, check the returned preview (75×35 characters, one per 2×2 dots: # lit, + partly, . dark) and warnings, fix the shapes, then save with preview_only = false. The saved logo can be refined by hand in the drawing editor.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Logo name, max 80 characters, unique." },
        background: { type: "string", enum: ["black", "white"], description: "black = all dots dark at start (default), white = all lit." },
        shapes: { type: "array", items: shapeSchema },
        preview_only: { type: "boolean", description: "true = only return the preview, do not save." },
        replace_logo_id: { type: "string", description: "UUID of an existing logo to overwrite (redraw) instead of creating a new one." },
      },
      required: ["name", "shapes"],
    },
    confirm: ({ replace_logo_id, preview_only }) => (replace_logo_id && !preview_only ? "irreversible" : null),
    async run({ name, background = "black", shapes, preview_only = false, replace_logo_id }, ctx) {
      if (!Array.isArray(shapes) || !shapes.length) return { ok: false, error: "no_shapes" };
      if (shapes.length > 300) return { ok: false, error: "too_many_shapes", max: 300 };
      const usesText = shapes.some((x) => x?.type === "text");
      const { bits, warnings } = drawLogoBits({ shapes, background }, usesText ? await font5x7(ctx) : null);
      const lit = bits.reduce((a, b) => a + b, 0);
      const preview = previewAscii(bits);
      if (preview_only) return { ok: true, saved: false, lit_dots: lit, warnings, preview };
      if (!lit) return { ok: false, error: "empty_logo", warnings };
      const res = await saveLogo(ctx, {
        name, type: "PIX_150x70", replaceId: replace_logo_id,
        payload: { w: DOT_W, h: DOT_H, format: PIX_FORMAT, bits_b64: packBits(bits), source: { mode: "DRAW", bg: "BLACK" } },
      });
      return { ...res, warnings };
    },
  },
  {
    name: "delete_logo",
    description: "Delete a logo permanently.",
    inputSchema: { type: "object", properties: { logo_id: uuid }, required: ["logo_id"] },
    confirm: () => "irreversible",
    async run({ logo_id }, ctx) {
      const res = await rpc(ctx, "delete_resource_checked", { p_resource_type: "logo", p_resource_id: logo_id, p_tab_id: ctx.tabId });
      if (res?.ok) ctx.changed({ type: "logo", id: logo_id });
      return res;
    },
  },
];
