// theme-file.js
// Plik motywu — jeden format dla motywów wbudowanych (web/shared/themes/<klucz>.json,
// lista: index.json) i wgranych przez wybrane konta (import motywów).
// Schemat i instrukcja: familijna-server/docs/motywy.md.
//
//   Ustawienia gry ──wejścia──▶ motyw (wzory „outputs”) ──wyjścia──▶ SVG Wyświetlacza
//   A, B, T, stan a/b/off                                          CSS Prowadzącego
//
// Wejścia są zawsze te same: kolory drużyn A i B, trzeci kolor T (wartość
// domyślna i znaczenie podaje motyw) oraz stan kontrolek. Motyw liczy z nich
// nazwane wyjścia (kolory i liczby, osobno dla stanów) i używa ich w swoim
// SVG (`fill="@nazwa"`) i CSS (`var(--t-nazwa)`). Plik to DANE: wzory mają
// stałą listę funkcji, SVG i CSS przechodzą przez białe listy i są składane
// od nowa — wynik nie zawiera skryptów, zdarzeń ani adresów.
// Ten sam moduł działa w przeglądarce, w funkcji Edge i w testach — bez DOM
// i bez importów. Kopia dla Edge: supabase/functions/_shared/display-theme-file.js
// (node scripts/sync-display-theme-file.cjs).

export const THEME_FILE_TYPE = "familijna-theme";
export const THEME_FILE_VERSION = 1;
export const THEME_FILE_MAX_BYTES = 1536 * 1024;
export const THEME_ARTWORK_MAX_BYTES = 300 * 1024;
export const THEME_NAME_MAX = 40;
export const SCALE_MIN = 0.5;
export const SCALE_MAX = 1.5;
// display.motion — płynna zmiana wyjść przy zmianie stanu: stała czasowa w ms
// (0 = od razu). Nowoczesny: 180.
export const MOTION_MAX = 2000;
// Gotowe animacje dla SVG Wyświetlacza (klasy elementów; silnik je definiuje).
export const ANIMATION_CLASSES = ["anim-flow", "anim-pulse", "anim-spin", "anim-blink", "anim-slow", "anim-fast", "modern-slot"];
// Wejścia (z Ustawień gry) i stany kontrolek.
export const INPUTS = ["A", "B", "T"];
export const STATES = ["off", "a", "b"];
// Funkcje wzorów: mix(k1, k2, t), lighten(k, t), darken(k, t), tint(k, baza[, metal]).
export const FUNCTIONS = ["mix", "lighten", "darken", "tint"];
// Atrybuty SVG, które mogą brać wyjście motywu ("@nazwa"); data-glow — poświata.
export const OUTPUT_ATTRIBUTES = ["fill", "stroke", "stop-color", "color", "opacity", "fill-opacity", "stroke-opacity", "stroke-width", "data-glow"];
const MAX_OUTPUTS = 200;
// Położenie sześciu wyświetlaczy (środki) — domyślne.
export const DEFAULT_PANELS = {
  big: [640, 307.33656], left: [113.658, 337.33654], right: [1164.342, 337.33654],
  top: [640, 57.165475], longA: [356.8, 546.68763], longB: [923.2, 546.68763],
};
// Kroje Prowadzącego (host.fonts): wszyte w plik (woff2, woff, ttf, otf) albo
// wskazane po nazwie pliku czcionki serwisu (web/shared/fonts/).
// Pliki czcionek serwisu (web/shared/fonts/<plik>.woff2), które motyw może wskazać
// zamiast wszywać krój (host.fonts[].file). Bez importu: kopię walidatora dostaje
// funkcja Edge; zgodność z draw-fonts.js pilnuje test displayThemeFile.
export const SHARED_FONT_FILES = new Set(["roboto", "montserrat", "rubik", "nunito", "comfortaa", "exo2", "jura", "tektur", "oswald", "unbounded", "russoone", "delagothicone", "rubikmonoone", "climatecrisis", "rubikbubbles", "ruslandisplay", "merriweather", "playfairdisplay", "robotoslab", "yesevaone", "kurale", "poiretone", "lobster", "pacifico", "caveat", "marckscript", "pressstart2p", "tiny5", "handjet", "jetbrainsmono"]);
export const FONT_MAX_BYTES = 250 * 1024;
export const FONTS_MAX = 3;
const FONT_FAMILY = /^[A-Za-z][A-Za-z0-9 -]{0,39}$/;
const FONT_DATA = /^data:font\/(woff2|woff|ttf|otf);base64,([A-Za-z0-9+/]+={0,2})$/;
// unicodeRange: kilka plików jednej rodziny dzielących znaki (np. latin i latin-ext).
const FONT_RANGE = /^U\+[0-9A-F]{1,6}(?:-[0-9A-F]{1,6})?(?:,U\+[0-9A-F]{1,6}(?:-[0-9A-F]{1,6})?){0,63}$/;
const FONT_MAGIC = { woff2: ["wOF2"], woff: ["wOFF"], ttf: ["\u0000\u0001\u0000\u0000", "true"], otf: ["OTTO"] };
export const CUSTOM_THEME_PREFIX = "custom:";

const MAX_ELEMENTS = 6000;
const MAX_DEPTH = 32;
const MAX_VALUE = 60000;

const ELEMENTS = new Set([
  "defs", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "linearGradient", "radialGradient", "stop", "pattern", "mask", "clipPath",
]);
// Pomijane bez błędu: dane edytorów (Inkscape, Illustrator) i opisy.
const DROPPED = new Set(["metadata", "title", "desc"]);
const TEXT_PARENTS = new Set(["text", "tspan"]);
const HREF_ELEMENTS = new Set(["linearGradient", "radialGradient", "pattern"]);

const ATTRIBUTES = new Set([
  "id", "class", "transform", "opacity", "display", "visibility",
  "fill", "fill-opacity", "fill-rule", "clip-rule", "clip-path", "mask",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "pathLength",
  "x", "y", "width", "height", "rx", "ry", "cx", "cy", "r", "fx", "fy", "fr",
  "x1", "y1", "x2", "y2", "dx", "dy", "d", "points",
  "offset", "stop-color", "stop-opacity",
  "gradientUnits", "gradientTransform", "spreadMethod",
  "patternUnits", "patternContentUnits", "patternTransform", "viewBox", "preserveAspectRatio",
  "maskUnits", "maskContentUnits", "clipPathUnits",
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "word-spacing",
  "text-anchor", "dominant-baseline", "text-decoration", "color", "data-glow",
]);
// Właściwości z atrybutu style (Inkscape zapisuje w nim wygląd) zamieniane
// na zwykłe atrybuty; pozostałe są pomijane.
const STYLE_PROPERTIES = new Set([
  "opacity", "display", "visibility", "fill", "fill-opacity", "fill-rule", "clip-rule",
  "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "stop-color", "stop-opacity",
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "word-spacing",
  "text-anchor", "dominant-baseline", "text-decoration",
]);
const URL_ATTRIBUTES = new Set(["fill", "stroke", "clip-path", "mask"]);

const fail = (error, detail = "") => ({ ok: false, error, detail: String(detail).slice(0, 80) });

class ThemeFileError extends Error {
  constructor(code, detail = "") { super(code); this.code = code; this.detail = detail; }
}
const reject = (code, detail) => { throw new ThemeFileError(code, detail); };

const ENTITY = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});/gi;
function checkEntities(raw) {
  const rest = raw.replace(ENTITY, "");
  if (rest.includes("&")) reject("svg_entity");
}
function decode(raw) {
  checkEntities(raw);
  return raw.replace(ENTITY, (m) => {
    const k = m.slice(1, -1).toLowerCase();
    if (k === "amp") return "&"; if (k === "lt") return "<"; if (k === "gt") return ">";
    if (k === "quot") return "\""; if (k === "apos") return "'";
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}
const escapeText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => escapeText(s).replace(/"/g, "&quot;");

// Tokenizer ograniczonego XML: elementy, atrybuty w cudzysłowach, tekst,
// komentarze (pomijane) i deklaracja XML na początku. Bez DOCTYPE i CDATA.
function parseXml(src) {
  const root = { name: "#root", attrs: [], children: [] };
  const stack = [root];
  let pos = 0, count = 0, seenElement = false;
  while (pos < src.length) {
    if (src.startsWith("<!--", pos)) {
      const end = src.indexOf("-->", pos + 4);
      if (end < 0) reject("svg_syntax", "comment");
      pos = end + 3; continue;
    }
    if (src.startsWith("<?", pos)) {
      if (seenElement || !/^<\?xml[\s?]/i.test(src.slice(pos, pos + 6))) reject("svg_syntax", "instruction");
      const end = src.indexOf("?>", pos);
      if (end < 0) reject("svg_syntax", "instruction");
      pos = end + 2; continue;
    }
    if (src.startsWith("<!", pos)) reject("svg_doctype");
    if (src.startsWith("</", pos)) {
      const m = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(src.slice(pos, pos + 200));
      if (!m) reject("svg_syntax", "close");
      const top = stack.pop();
      if (!top || top === root || top.name !== m[1]) reject("svg_syntax", m[1]);
      pos += m[0].length; continue;
    }
    if (src[pos] === "<") {
      const m = /^<([A-Za-z_][\w:.-]*)/.exec(src.slice(pos, pos + 200));
      if (!m) reject("svg_syntax", "tag");
      pos += m[0].length;
      const node = { name: m[1], attrs: [], children: [] };
      for (;;) {
        const ws = /^\s*/.exec(src.slice(pos, pos + 1000))[0];
        pos += ws.length;
        if (src.startsWith("/>", pos)) { pos += 2; break; }
        if (src[pos] === ">") { pos += 1; stack.push(node); break; }
        if (!ws) reject("svg_syntax", node.name);
        // Atrybut bez wartości (np. data-modern-lines we wbudowanym Modern)
        // jest pusty; nieznane atrybuty i tak nie trafiają do wyniku.
        const a = /^([^\s=/>"']+)(?:\s*=\s*("([^"]*)"|'([^']*)'))?/.exec(src.slice(pos, pos + MAX_VALUE + 300));
        if (!a || (a[2] === undefined && /^\s*=/.test(src.slice(pos + a[0].length, pos + a[0].length + 20)))) reject("svg_syntax", node.name);
        node.attrs.push([a[1], decode(a[3] ?? a[4] ?? "")]);
        pos += a[0].length;
      }
      stack[stack.length - (stack[stack.length - 1] === node ? 2 : 1)].children.push(node);
      if (stack.length - 1 > MAX_DEPTH + 1) reject("svg_too_complex");
      if (++count > MAX_ELEMENTS) reject("svg_too_complex");
      seenElement = true;
      continue;
    }
    const next = src.indexOf("<", pos);
    const end = next < 0 ? src.length : next;
    const text = src.slice(pos, end);
    if (text.trim()) {
      if (stack.length === 1) reject("svg_syntax", "text");
      stack[stack.length - 1].children.push({ text: decode(text) });
    }
    pos = end;
  }
  if (stack.length !== 1) reject("svg_syntax", "unclosed");
  return root;
}

const ID_RE = /^[A-Za-z_][\w.-]{0,63}$/;
const OUTPUT_NAME = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const OUTPUT_REF = /^@[A-Za-z][A-Za-z0-9]{0,23}$/;
const CLASS_RE = /^[a-z][a-z0-9-]{0,31}$/;
const URL_RE = /url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;

function checkValue(name, value, refs) {
  if (value.length > MAX_VALUE) reject("svg_value", name);
  if (/[<>]|javascript:|expression\s*\(|@import|\\/i.test(value)) reject("svg_value", name);
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(value))) {
    if (!URL_ATTRIBUTES.has(name) || !/^#[A-Za-z_][\w.-]{0,63}$/.test(m[2])) reject("svg_url", name);
    refs.add(m[2].slice(1));
  }
  if (/url\s*\(/i.test(value.replace(URL_RE, ""))) reject("svg_url", name);
}

function styleToAttrs(style) {
  const out = [];
  for (const part of style.split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const value = part.slice(i + 1).trim();
    if (STYLE_PROPERTIES.has(prop) && value) out.push([prop, value]);
  }
  return out;
}

function sanitizeNode(node, ctx, parentName) {
  if (node.text !== undefined) {
    if (!TEXT_PARENTS.has(parentName)) return "";
    return escapeText(node.text);
  }
  const name = node.name;
  if (name.includes(":") || DROPPED.has(name)) return "";
  if (!ELEMENTS.has(name)) reject("svg_element", name);
  const attrs = new Map();
  const put = (key, value) => {
    // Wyjście motywu: "@nazwa" (sprawdzane z listą outputs w parseThemeFile).
    if (value.startsWith("@")) {
      if (!OUTPUT_ATTRIBUTES.includes(key) || !OUTPUT_REF.test(value)) reject("svg_value", `${key}: ${value}`);
      ctx.outputRefs.add(value.slice(1));
      attrs.set(key, value);
      return;
    }
    if (key === "data-glow") reject("svg_value", key);
    checkValue(key, value, ctx.refs);
    attrs.set(key, value);
  };
  const raw = [];
  for (const [key, value] of node.attrs) {
    const lower = key.toLowerCase();
    if (lower.startsWith("on")) reject("svg_event", key);
    if (lower === "style") { raw.push(...styleToAttrs(value)); continue; }
    raw.push([key, value]);
  }
  for (const [key, value] of raw) {
    if (key === "href" || key === "xlink:href") {
      if (!HREF_ELEMENTS.has(name) || !/^#[A-Za-z_][\w.-]{0,63}$/.test(value)) reject("svg_url", key);
      ctx.refs.add(value.slice(1));
      attrs.set("href", value);
      continue;
    }
    if (key.includes(":") || key.startsWith("xmlns")) continue;
    if (!ATTRIBUTES.has(key)) continue;
    if (key === "id") {
      if (!ID_RE.test(value)) reject("svg_value", "id");
      ctx.ids.add(value);
      attrs.set("id", value);
      continue;
    }
    if (key === "class") {
      const tokens = value.split(/\s+/).filter(Boolean);
      if (tokens.some(t => !CLASS_RE.test(t))) reject("svg_value", "class");
      ctx.classSets.push(tokens);
      if (tokens.length) attrs.set("class", tokens.join(" "));
      continue;
    }
    put(key, value);
  }
  const children = node.children.map(child => sanitizeNode(child, ctx, name)).join("");
  const attrText = [...attrs].map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
  return children ? `<${name}${attrText}>${children}</${name}>` : `<${name}${attrText}/>`;
}

function normalizeViewBox(value) {
  return String(value || "").trim().split(/[\s,]+/).map(Number);
}

// Zwraca oczyszczoną zawartość <svg> (bez korzenia — viewBox ustawia silnik).
// info (opcjonalnie) dostaje { ids, outputRefs } — użyte id i wyjścia "@nazwa".
export function sanitizeThemeArtwork(svg, info = {}) {
  if (typeof svg !== "string" || !svg.trim()) reject("artwork_missing");
  if (new TextEncoder().encode(svg).length > THEME_ARTWORK_MAX_BYTES) reject("artwork_too_large");
  const doc = parseXml(svg.trim());
  const roots = doc.children.filter(n => n.name);
  if (roots.length !== 1 || roots[0].name !== "svg") reject("svg_root");
  const root = roots[0];
  const viewBox = normalizeViewBox(root.attrs.find(([k]) => k === "viewBox")?.[1]);
  if (viewBox.join(" ") !== "0 0 1280 720") reject("svg_viewbox");
  const ctx = { ids: new Set(), refs: new Set(), classSets: [], outputRefs: new Set() };
  const body = root.children.map(child => sanitizeNode(child, ctx, "svg")).join("");
  for (const ref of ctx.refs) if (!ctx.ids.has(ref)) reject("svg_reference", ref);
  info.ids = ctx.ids;
  info.outputRefs = ctx.outputRefs;
  return body;
}

const cleanName = (value) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const validName = (name) => name && name.length <= THEME_NAME_MAX && !/[\u0000-\u001f\u007f<>]/.test(name);
const isObject = (v) => v && typeof v === "object" && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;

// ---- Wzory wyjść ----
// Wyrażenie: kolor #rrggbb, liczba, wejście A/B/T, wcześniejsze wyjście @nazwa,
// "none" albo funkcja z FUNCTIONS. Wynik: kolor ([r,g,b]), liczba albo "none".
function tokenize(src) {
  const out = [];
  const re = /\s*(#[0-9a-fA-F]{6}|-?\d+(?:\.\d+)?|@[A-Za-z][A-Za-z0-9]{0,23}|[A-Za-z]+|[(),])\s*/y;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`znak „${src[pos]}”`);
    out.push(m[1]);
    pos = re.lastIndex;
  }
  return out;
}

function parseExpr(src) {
  if (typeof src === "number") return { num: src };
  if (typeof src !== "string" || !src.trim() || src.length > 300) throw new Error("pusty albo za długi wzór");
  const tokens = tokenize(src);
  let i = 0;
  const node = () => {
    const tok = tokens[i++];
    if (tok === undefined) throw new Error("niepełny wzór");
    if (tok.startsWith("#")) return { color: tok.toLowerCase() };
    if (/^-?\d/.test(tok)) return { num: Number(tok) };
    if (tok.startsWith("@")) return { ref: tok.slice(1) };
    if (tok === "none") return { none: true };
    if (INPUTS.includes(tok)) return { input: tok };
    if (FUNCTIONS.includes(tok)) {
      if (tokens[i++] !== "(") throw new Error(`${tok}: brak „(”`);
      const args = [node()];
      while (tokens[i] === ",") { i++; args.push(node()); }
      if (tokens[i++] !== ")") throw new Error(`${tok}: brak „)”`);
      return { fn: tok, args };
    }
    throw new Error(`nieznane „${tok}”`);
  };
  const tree = node();
  if (i !== tokens.length) throw new Error("nadmiarowe znaki");
  return tree;
}

const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => "#" + rgb.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
const mixRgb = (a, b, t) => a.map((v, i) => Math.round(v * (1 - t) + b[i] * t));
// Dopasowanie koloru grafiki do bazy (np. tła): jasność oryginału decyduje,
// ile bazy rozjaśnionej/przyciemnionej przyjmuje; metal zachowuje więcej oryginału.
function tintRgb(c, base, metal) {
  const lum = (.2126 * c[0] + .7152 * c[1] + .0722 * c[2]) / 255;
  const t = lum < .08 ? -.7 : lum < .2 ? -.35 : lum < .4 ? .10 : lum < .65 ? .30 : .58;
  const target = mixRgb(base, t < 0 ? [0, 0, 0] : [255, 255, 255], Math.abs(t));
  return mixRgb(target, c, metal ? .48 : .20);
}

function evalNode(n, env) {
  if (n.color) return rgbOf(n.color);
  if (n.num !== undefined) return n.num;
  if (n.none) return "none";
  if (n.input) {
    if (!env[n.input]) throw new Error(`wejście ${n.input} nie istnieje w tym motywie`);
    return rgbOf(env[n.input]);
  }
  if (n.ref) {
    if (!(n.ref in env.outputs)) throw new Error(`@${n.ref} przed zdefiniowaniem`);
    const v = env.outputs[n.ref];
    return typeof v === "string" && v.startsWith("#") ? rgbOf(v) : v;
  }
  const args = n.args.map((a) => evalNode(a, env));
  const color = (k) => { if (!Array.isArray(args[k])) throw new Error(`${n.fn}: argument ${k + 1} to nie kolor`); return args[k]; };
  const num = (k) => { if (typeof args[k] !== "number" || args[k] < 0 || args[k] > 1) throw new Error(`${n.fn}: argument ${k + 1} to nie liczba 0–1`); return args[k]; };
  const arity = { mix: [3, 3], lighten: [2, 2], darken: [2, 2], tint: [2, 3] }[n.fn];
  if (args.length < arity[0] || args.length > arity[1]) throw new Error(`${n.fn}: zła liczba argumentów`);
  if (n.fn === "mix") return mixRgb(color(0), color(1), num(2));
  if (n.fn === "lighten") return mixRgb(color(0), [255, 255, 255], num(1));
  if (n.fn === "darken") return mixRgb(color(0), [0, 0, 0], num(1));
  return tintRgb(color(0), color(1), args.length > 2 ? num(2) > 0 : false);
}

const formatValue = (v) => Array.isArray(v) ? hexOf(v) : v;

// Wyjścia dla podanych wejść i stanu: { A, B, T, ...outputs } → "#rrggbb" | liczba | "none".
export function evaluateOutputs(theme, { A, B, T = null, state = "off" }) {
  const color = (value, fallback) => (typeof value === "string" && HEX.test(value) ? value.toLowerCase() : fallback);
  const env = { A: color(A, "#ff8c1a"), B: color(B, "#138a50"), T: theme.inputs.T ? color(T, theme.inputs.T.default) : null, outputs: {} };
  const out = env.outputs;
  out.A = env.A; out.B = env.B;
  if (env.T) out.T = env.T;
  for (const [name, def] of Object.entries(theme.outputs)) {
    const expr = isObject(def) ? (def[state] ?? def.off) : def;
    out[name] = formatValue(evalNode(parseExpr(expr), env));
  }
  return out;
}

function parseOutputs(raw, hasT) {
  if (raw === undefined) return {};
  if (!isObject(raw) || Object.keys(raw).length > MAX_OUTPUTS) reject("outputs", "outputs");
  const out = {};
  const sample = { A: "#ff8c1a", B: "#138a50", T: hasT ? "#808080" : null, outputs: { A: "#ff8c1a", B: "#138a50", ...(hasT ? { T: "#808080" } : {}) } };
  for (const [name, def] of Object.entries(raw)) {
    if (!OUTPUT_NAME.test(name) || INPUTS.includes(name)) reject("outputs", name);
    const perState = isObject(def);
    if (perState) {
      if (def.off === undefined) reject("outputs", `${name}: brak off`);
      for (const key of Object.keys(def)) if (!STATES.includes(key)) reject("outputs", `${name}.${key}`);
    }
    const exprs = perState ? STATES.filter((s) => def[s] !== undefined).map((s) => def[s]) : [def];
    let kind = null;
    for (const expr of exprs) {
      let value;
      try { value = formatValue(evalNode(parseExpr(expr), sample)); }
      catch (e) { reject("outputs", `${name}: ${e.message}`); }
      const k = typeof value === "number" ? "number" : "color";
      if (typeof value === "number" && (value < 0 || value > 1000)) reject("outputs", `${name}: liczba 0–1000`);
      if (kind && kind !== k) reject("outputs", `${name}: różne typy w stanach`);
      kind = k;
    }
    sample.outputs[name] = formatValue(evalNode(parseExpr(exprs[0]), sample));
    out[name] = perState ? Object.fromEntries(STATES.filter((s) => def[s] !== undefined).map((s) => [s, def[s]])) : def;
  }
  return out;
}

// ---- CSS motywu (Prowadzący, wypełnienie ekranu Wyświetlacza) ----
// Selektory elementów strony Prowadzącego (":root" = cały motyw), właściwości
// i funkcje z białej listy; wartości bez adresów, @-reguł i znaków sterujących.
// var() tylko do wyjść motywu (--t-nazwa), zmiennych Prowadzącego (--host-…)
// i --white/--black.
export const HOST_SELECTORS = [":root", ".paper", ".pane", ".pane1", ".pane2", ".pane::before", ".pane::after",
  ".pane1::after", ".pane2::after", ".cover2", ".cover2::before", ".text", ".p2Hint"];
const HOST_PROPERTIES = new Set([
  "background", "background-color", "background-image", "border", "border-color", "border-width", "border-style",
  "border-radius", "border-inline", "border-block", "border-inline-color", "border-block-color",
  "box-shadow", "clip-path", "content", "display", "position", "inset", "top", "right", "bottom", "left",
  "width", "height", "z-index", "pointer-events", "opacity", "color",
]);
const CSS_FUNCTIONS = new Set(["var", "calc", "min", "max", "clamp", "color-mix", "rgb", "rgba", "hsl", "hsla",
  "linear-gradient", "radial-gradient", "repeating-linear-gradient", "repeating-radial-gradient",
  "conic-gradient", "polygon", "circle", "ellipse", "inset"]);
const HOST_VAR = /^--host-[a-z0-9-]{1,40}$/;
const THEME_VAR = /^--t-([A-Za-z][A-Za-z0-9]{0,23})$/;

function checkCssValue(prop, value, names) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) reject("host_css", prop);
  if (/[;{}<>\\!@]|url\s*\(|expression|javascript|\/\*/i.test(value)) reject("host_css", prop);
  for (const m of value.matchAll(/([a-z-]+)\s*\(/gi)) if (!CSS_FUNCTIONS.has(m[1].toLowerCase())) reject("host_css", `${prop}: ${m[1]}`);
  for (const m of value.matchAll(/var\(\s*([^),\s]+)/g)) {
    const own = THEME_VAR.exec(m[1]);
    if (own) { if (!names.has(own[1])) reject("host_css", `${prop}: ${m[1]}`); continue; }
    if (!HOST_VAR.test(m[1]) && m[1] !== "--white" && m[1] !== "--black") reject("host_css", `${prop}: ${m[1]}`);
  }
  if (prop === "content" && value !== '""') reject("host_css", prop);
  return value.trim();
}

function sanitizeHostCss(css, names) {
  if (css === undefined) return {};
  if (!isObject(css)) reject("host_css", "css");
  const out = {};
  for (const [selector, rules] of Object.entries(css)) {
    if (!HOST_SELECTORS.includes(selector)) reject("host_css", selector);
    if (!isObject(rules)) reject("host_css", selector);
    out[selector] = {};
    for (const [prop, value] of Object.entries(rules)) {
      if (!HOST_PROPERTIES.has(prop) && !HOST_VAR.test(prop)) reject("host_css", prop);
      out[selector][prop] = checkCssValue(prop, value, names);
    }
  }
  return out;
}

// Reguły → arkusz CSS Prowadzącego, zawężony do html[data-host-style]
// (ustawia hostThemeManager.js). Wartości są już sprawdzone przez parseThemeFile.
export function hostRulesCss(css) {
  return Object.entries(css || {}).map(([selector, props]) => {
    const target = selector === ":root" ? "html[data-host-style]" : `html[data-host-style] ${selector}`;
    return `${target} { ${Object.entries(props).map(([prop, value]) => `${prop}: ${value};`).join(" ")} }`;
  }).join("\n");
}

function parseHost(raw, builtinKeys, names) {
  if (raw === undefined) return { ruled: false, board: true, fonts: [], css: {} };
  // Klucz motywu wbudowanego: Prowadzący pożyczony z tamtego pliku.
  if (typeof raw === "string") {
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(raw) || (builtinKeys && !builtinKeys.includes(raw))) reject("host", raw);
    return { from: raw };
  }
  if (!isObject(raw)) reject("host", "host");
  const ruled = raw.ruled ?? false, board = raw.board ?? true;
  if (typeof ruled !== "boolean" || typeof board !== "boolean") reject("host", "ruled/board");
  // Krój i jego miary to zmienne CSS motywu (--host-font, --host-font-ratio…).
  return { ruled, board, fonts: parseFonts(raw.fonts), css: sanitizeHostCss(raw.css, names) };
}

function parseLabel(raw, what, max = THEME_NAME_MAX) {
  if (!isObject(raw)) reject(what, "label");
  const out = {};
  for (const lang of ["pl", "en", "uk"]) {
    out[lang] = cleanName(raw[lang]);
    if (!out[lang] || out[lang].length > max || /[\u0000-\u001f\u007f<>]/.test(out[lang])) reject(what, `label.${lang}`);
  }
  return out;
}

// host.fonts: [{ family, data: "data:font/woff2;base64,…", weight?, style? }]
// albo [{ family, file: "caveat", … }] — czcionka serwisu z web/shared/fonts/
// (SHARED_FONT_FILES; motywy wbudowane, bez kopii pliku w motywie).
function parseFonts(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > FONTS_MAX) reject("fonts", "lista");
  return raw.map((font) => {
    if (!isObject(font) || typeof font.family !== "string" || !FONT_FAMILY.test(font.family)) reject("fonts", font?.family ?? "family");
    const file = font.file === undefined ? null : String(font.file);
    if (file !== null && !SHARED_FONT_FILES.has(file)) reject("fonts", `${font.family}: file`);
    const m = file === null && typeof font.data === "string" ? FONT_DATA.exec(font.data) : null;
    if (file === null && !m) reject("fonts", `${font.family}: data`);
    if (m) {
      let head;
      try { head = atob(m[2].slice(0, 8)).slice(0, 4); } catch { reject("fonts", `${font.family}: base64`); }
      if (!FONT_MAGIC[m[1]].includes(head)) reject("fonts", `${font.family}: to nie plik ${m[1]}`);
      if (Math.floor(m[2].length * 3 / 4) > FONT_MAX_BYTES) reject("fonts", `${font.family}: za duży`);
    }
    const weight = String(font.weight ?? "400");
    if (!/^(?:[1-9]00)(?: [1-9]00)?$/.test(weight)) reject("fonts", `${font.family}: weight`);
    const style = font.style ?? "normal";
    if (style !== "normal" && style !== "italic") reject("fonts", `${font.family}: style`);
    if (font.unicodeRange !== undefined && (typeof font.unicodeRange !== "string" || !FONT_RANGE.test(font.unicodeRange))) reject("fonts", `${font.family}: unicodeRange`);
    return { family: font.family, ...(file !== null ? { file } : { data: font.data }), weight, style, ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}) };
  });
}

// inputs: { "T": { "default": "#rrggbb", "label": { pl, en, uk } } } albo bez T.
function parseInputs(raw) {
  if (raw === undefined) return { T: null };
  if (!isObject(raw)) reject("inputs", "inputs");
  for (const key of Object.keys(raw)) if (key !== "T") reject("inputs", key);
  if (raw.T === undefined || raw.T === null) return { T: null };
  if (!isObject(raw.T) || typeof raw.T.default !== "string" || !HEX.test(raw.T.default)) reject("inputs", "T.default");
  // Nazwa trzeciego koloru w Ustawieniach zawsze z motywu, w trzech językach.
  return { T: { default: raw.T.default.toLowerCase(), label: parseLabel(raw.T.label, "inputs", 24) } };
}

function parseDisplay(raw, names) {
  if (!isObject(raw)) reject("display", "display");
  const scale = raw.scale ?? 1;
  if (typeof scale !== "number" || !(scale >= SCALE_MIN && scale <= SCALE_MAX)) reject("display", "scale");
  const motion = raw.motion ?? 0;
  if (typeof motion !== "number" || !(motion >= 0 && motion <= MOTION_MAX)) reject("display", "motion");
  const panels = {};
  const rawPanels = raw.panels ?? {};
  if (!isObject(rawPanels)) reject("display", "panels");
  for (const [key, def] of Object.entries(DEFAULT_PANELS)) {
    const value = rawPanels[key] ?? def;
    if (!Array.isArray(value) || value.length !== 2 || !(value[0] >= 0 && value[0] <= 1280) || !(value[1] >= 0 && value[1] <= 720)) reject("display", `panels.${key}`);
    panels[key] = [Number(value[0]), Number(value[1])];
  }
  for (const key of Object.keys(rawPanels)) if (!(key in DEFAULT_PANELS)) reject("display", `panels.${key}`);
  const info = {};
  const svg = sanitizeThemeArtwork(raw.svg, info);
  for (const ref of info.outputRefs) if (!names.has(ref)) reject("svg_reference", `@${ref}`);
  const page = raw.page === undefined ? (names.has("T") ? "var(--t-T)" : "#000000") : checkCssValue("page", raw.page, names);
  return { svg, page, panels, scale, motion };
}

// Tekst pliku → { ok: true, theme } albo { ok: false, error, detail }.
// theme = { name, label, inputs, outputs, display, host }.
// builtin: plik z web/shared/themes/ — wymagane label PL/EN/UK.
// builtinKeys: dozwolone klucze w "host": "<klucz>" (lista z index.json).
export function parseThemeFile(text, { builtin = false, builtinKeys = null } = {}) {
  try {
    if (typeof text !== "string" || !text.trim()) return fail("empty");
    if (new TextEncoder().encode(text).length > THEME_FILE_MAX_BYTES) return fail("too_large");
    let data;
    try { data = JSON.parse(text); } catch { return fail("not_json"); }
    if (!isObject(data) || data.type !== THEME_FILE_TYPE) return fail("not_theme");
    if (data.version !== THEME_FILE_VERSION) return fail("version", data.version);
    const name = cleanName(data.name);
    if (!validName(name)) return fail("name");
    let label = null;
    if (data.label !== undefined || builtin) label = parseLabel(data.label, "label");
    const inputs = parseInputs(data.inputs);
    const outputs = parseOutputs(data.outputs, !!inputs.T);
    const names = new Set(["A", "B", ...(inputs.T ? ["T"] : []), ...Object.keys(outputs)]);
    const display = parseDisplay(data.display, names);
    const host = parseHost(data.host, builtinKeys, names);
    return { ok: true, theme: { name, label, inputs, outputs, display, host } };
  } catch (e) {
    if (e instanceof ThemeFileError) return fail(e.code, e.detail);
    return fail("invalid");
  }
}

// Kanoniczny zapis oczyszczonego motywu (to trafia do bucketu).
export function serializeThemeFile(theme) {
  return JSON.stringify({
    type: THEME_FILE_TYPE,
    version: THEME_FILE_VERSION,
    name: theme.name,
    ...(theme.label ? { label: theme.label } : {}),
    inputs: theme.inputs.T ? { T: { default: theme.inputs.T.default, label: theme.inputs.T.label } } : {},
    outputs: theme.outputs,
    display: { ...theme.display, svg: `<svg viewBox="0 0 1280 720">${theme.display.svg}</svg>` },
    host: theme.host.from ?? theme.host,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function customThemeId(key) {
  if (typeof key !== "string" || !key.startsWith(CUSTOM_THEME_PREFIX)) return null;
  const id = key.slice(CUSTOM_THEME_PREFIX.length).toLowerCase();
  return UUID_RE.test(id) ? id : null;
}
export const customThemeKey = (id) => CUSTOM_THEME_PREFIX + String(id).toLowerCase();
export const THEME_BUCKET = "user-themes";
export const themeObjectPath = (id) => `${String(id).toLowerCase()}.json`;
