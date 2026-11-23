// Narzędzia czatu AI: logo (lista, logo tekstowe, usuwanie). Logo tekstowe
// składa ta sama funkcja co edytor (logos/js/text.js, czcionka 3×10 —
// 30 × 10 znaków tablicy); zapis przez endpoint logo_create (migracja 534).
import { sb } from "../../core/supabase.js";
import { getTabId } from "../../core/resource-lock.js";
import { v as versioned } from "../../core/cache-bust.js";
import { compileText } from "../../core/logo-text.js";
import { uuid, noArgs, rpc, rows } from "./common.js";

const FONT_3x10_URL = "/shared/fonts/display/font_3x10.json";
let fontP = null;
const font3x10 = () => {
  if (!fontP) {
    fontP = versioned(FONT_3x10_URL).then((url) => fetch(url)).then((r) => {
      if (!r.ok) throw new Error(`font_3x10: HTTP ${r.status}`);
      return r.json();
    });
    fontP.catch(() => { fontP = null; });
  }
  return fontP;
};

export default [
  {
    name: "list_logos",
    description: "List the user's logos (id, name, type: GLYPH_30x10 = text logo, PIX_150x70 = drawing or image).",
    inputSchema: noArgs,
    readOnly: true,
    async run() {
      return { logos: await rows(sb().from("user_logos").select("id,name,type,updated_at").order("updated_at", { ascending: false })) };
    },
  },
  {
    name: "create_text_logo",
    description: "Create a text logo shown on the game board: the text is drawn in big board letters (about 7–9 characters fit; spaces separate words). Returns an error if the text is too wide or has characters the board cannot show.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "Logo name, max 80 characters, unique." }, text: { type: "string" } },
      required: ["name", "text"],
    },
    async run({ name, text }, ctx) {
      const compiled = compileText(String(text || ""), await font3x10());
      if (compiled.invalid.length) return { ok: false, error: "invalid_chars", chars: compiled.invalid };
      if (!compiled.fit) return { ok: false, error: "too_wide", used_columns: compiled.usedW, max_columns: 30 };
      const res = await rpc("logo_create", {
        p_name: name, p_type: "GLYPH_30x10", p_tab_id: getTabId(),
        p_payload: { layers: [{ color: "main", rows: compiled.rows }], source: { mode: "TEXT", text: String(text) } },
      });
      if (res?.ok) ctx.changed({ type: "logo", id: res.id });
      return res;
    },
  },
  {
    name: "delete_logo",
    description: "Delete a logo permanently.",
    inputSchema: { type: "object", properties: { logo_id: uuid }, required: ["logo_id"] },
    confirm: () => "irreversible",
    async run({ logo_id }, ctx) {
      const res = await rpc("delete_resource_checked", { p_resource_type: "logo", p_resource_id: logo_id, p_tab_id: getTabId() });
      if (res?.ok) ctx.changed({ type: "logo", id: logo_id });
      return res;
    },
  },
];
