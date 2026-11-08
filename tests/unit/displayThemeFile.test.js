import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  parseThemeFile, sanitizeThemeArtwork, serializeThemeFile, evaluateOutputs, hostRulesCss,
  customThemeId, customThemeKey, THEME_FILE_TYPE, THEME_ARTWORK_MAX_BYTES, THEME_FILE_MAX_BYTES, SHARED_FONT_FILES,
} from "../../web/shared/js/display/theme-file.js";

const read = (path) => fs.readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const INDICATORS = '<path id="lampA" d="M0 0H10" stroke="@lampA"/><path id="lampB" d="M20 0H30" stroke="@lampB"/>';
const svg = (inner, root = 'viewBox="0 0 1280 720"') => `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}</svg>`;
const OUTPUTS = {
  dimA: "mix(T, A, 0.25)",
  lampA: { off: "@dimA", a: "A", b: "@dimA" },
  lampB: { off: "mix(T, B, 0.25)", a: "mix(T, B, 0.25)", b: "B" },
};
// Pola części "display" (svg, page, panels, scale, motion) można podać na wierzchu.
const DISPLAY_KEYS = ["svg", "page", "panels", "scale", "motion"];
const T_LABEL = { pl: "Tło", en: "Background", uk: "Фон" };
const file = (over = {}) => {
  const display = { svg: svg(`<rect width="1280" height="720" fill="@T"/>${INDICATORS}`) };
  const rest = { inputs: { T: { default: "#102030", label: T_LABEL } }, outputs: OUTPUTS };
  for (const [k, v] of Object.entries(over)) (DISPLAY_KEYS.includes(k) ? display : rest)[k] = v;
  return JSON.stringify({ type: THEME_FILE_TYPE, version: 1, name: "Mój motyw", ...rest, display });
};
const errorOf = (text, options) => parseThemeFile(text, options).error;

test("poprawny plik: wejścia, wyjścia, domyślne wartości", () => {
  const r = parseThemeFile(file());
  assert.equal(r.ok, true, r.error);
  assert.equal(r.theme.name, "Mój motyw");
  assert.equal(r.theme.label, null);
  assert.deepEqual(r.theme.inputs, { T: { default: "#102030", label: T_LABEL } });
  assert.deepEqual(r.theme.outputs, OUTPUTS);
  const d = r.theme.display;
  assert.equal(d.page, "var(--t-T)");
  assert.equal(d.scale, 1);
  assert.deepEqual(d.panels.big, [640, 307.33656]);
  assert.match(d.svg, /^<rect width="1280" height="720" fill="@T"\/>/);
  assert.equal(d.motion, 0);
  assert.deepEqual(r.theme.host, { ruled: false, board: true, fonts: [], css: {} });
});

test("wyjścia liczone z wejść i stanu kontrolek", () => {
  const { theme } = parseThemeFile(file());
  const off = evaluateOutputs(theme, { A: "#ff0000", B: "#0000ff", T: "#000000", state: "off" });
  assert.equal(off.dimA, "#400000");
  assert.equal(off.lampA, "#400000");
  assert.equal(off.lampB, "#000040");
  const a = evaluateOutputs(theme, { A: "#ff0000", B: "#0000ff", T: "#000000", state: "a" });
  assert.equal(a.lampA, "#ff0000");
  assert.equal(a.lampB, "#000040");
  const b = evaluateOutputs(theme, { A: "#ff0000", B: "#0000ff", state: "b" });
  assert.equal(b.T, "#102030", "brak T z gry → wartość domyślna motywu");
  assert.equal(b.lampB, "#0000ff");
  const bad = evaluateOutputs(theme, { A: "red", B: "#0000ff", T: "javascript:x", state: "a" });
  assert.equal(bad.lampA, "#ff8c1a");
  assert.equal(bad.T, "#102030");
});

test("funkcje wzorów: mix, lighten, darken, tint, liczby i none", () => {
  const outputs = { ...OUTPUTS, m: "mix(A, B, 0.5)", l: "lighten(#000000, 0.5)", d: "darken(#ffffff, 0.5)", t: "tint(#536477, T)", tm: "tint(#536477, T, 1)", w: { off: 5, a: 7, b: "5" }, g: { off: "none", a: "A" } };
  const { theme, error } = parseThemeFile(file({ outputs }));
  assert.equal(error, undefined);
  const o = evaluateOutputs(theme, { A: "#ff0000", B: "#0000ff", T: "#152238", state: "a" });
  assert.deepEqual([o.m, o.l, o.d, o.w, o.g], ["#800080", "#808080", "#808080", 7, "#ff0000"]);
  assert.notEqual(o.t, o.tm);
  assert.equal(evaluateOutputs(theme, { A: "#ff0000", B: "#0000ff", state: "off" }).g, "none");
});

test("wzory: błędy składni, typów, nieznanych nazw i kolejności", () => {
  const bad = {
    a: "mix(A, B)", b: "mix(A, B, 2)", c: "rgb(1,2,3)", d: "A + B", e: "@pozniej", f: "darken(5, 0.2)",
    g: { a: "A" }, h: { off: "A", c: "B" }, i: { off: "A", a: 5 }, j: "url(x)", k: "T", l: "", m: 2000,
  };
  for (const [name, expr] of Object.entries(bad)) {
    const inputs = name === "k" ? {} : { T: { default: "#102030", label: T_LABEL } };
    assert.equal(errorOf(file({ inputs, outputs: { [name]: expr }, svg: svg('<path id="team"/>') })), "outputs", name);
  }
  assert.equal(errorOf(file({ outputs: { A: "B" } })), "outputs");
  assert.equal(errorOf(file({ outputs: { "zła-nazwa": "A" } })), "outputs");
});

test("SVG: wyjścia tylko w atrybutach wyglądu i tylko istniejące", () => {
  assert.equal(errorOf(file({ svg: svg(`<rect fill="@nie"/>${INDICATORS}`) })), "svg_reference");
  assert.equal(errorOf(file({ svg: svg(`<rect x="@lampA"/>${INDICATORS}`) })), "svg_value");
  assert.equal(errorOf(file({ svg: svg(`<rect data-glow="#ff0000"/>${INDICATORS}`) })), "svg_value");
  assert.equal(parseThemeFile(file({ svg: svg(`<g data-glow="@lampA" color="@lampB"/>${INDICATORS}`) })).ok, true);
});

test("motywy wbudowane (web/shared/themes/*.json) to pliki w formacie importu", () => {
  const dir = new URL("../../web/shared/themes/", import.meta.url);
  const index = JSON.parse(fs.readFileSync(new URL("index.json", dir), "utf8"));
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".json") && f !== "index.json").sort();
  assert.deepEqual(index.themes.map(e => `${e.key}.json`).sort(), files);
  const builtinKeys = index.themes.map(e => e.key);
  for (const entry of index.themes) {
    // CI dopisuje do ścieżek wersję ?v= (scripts/version-assets.js).
    assert.equal(entry.file.split("?")[0], `/shared/themes/${entry.key}.json`);
    const text = fs.readFileSync(new URL(`${entry.key}.json`, dir), "utf8");
    const result = parseThemeFile(text, { builtin: true, builtinKeys });
    assert.equal(result.ok, true, `${entry.key}: ${result.error} ${result.detail}`);
    assert.equal(parseThemeFile(text).ok, true, entry.key);
    for (const state of ["off", "a", "b"]) evaluateOutputs(result.theme, { A: "#c4002f", B: "#2a62ff", state });
  }
  assert.equal(index.default, "wings");
});

test("plik z Inkscape: deklaracja, komentarze, metadane, style i przestrzenie nazw", () => {
  const ink = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Created with Inkscape -->
<svg xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="x" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0,0,1280,720" width="1280" height="720" inkscape:version="1.3">
  <sodipodi:namedview id="nv" pagecolor="#fff"/>
  <metadata><rdf:RDF/></metadata>
  <defs><linearGradient id="g1"><stop offset="0" style="stop-color:#ff0000;stop-opacity:1"/></linearGradient>
  <linearGradient id="g2" xlink:href="#g1" x1="0" x2="1" gradientUnits="userSpaceOnUse"/></defs>
  <g inkscape:label="Warstwa 1" inkscape:groupmode="layer">
    <rect style="fill:url(#g2);stroke:#000;stroke-width:2;-inkscape-font-specification:Arial;mix-blend-mode:multiply" width="100" height="50"/>
    <text x="640" y="700" style="font-family:'Arial Black';font-size:12px">A &amp; B</text>
    ${INDICATORS}
  </g>
</svg>`;
  const body = sanitizeThemeArtwork(ink);
  assert.doesNotMatch(body, /inkscape|sodipodi|metadata|xmlns|mix-blend|style=/);
  assert.match(body, /<linearGradient id="g2" href="#g1"/);
  assert.match(body, /<rect fill="url\(#g2\)" stroke="#000" stroke-width="2" width="100" height="50"\/>/);
  assert.match(body, /font-family="'Arial Black'"/);
  assert.match(body, />A &amp; B<\/text>/);
});

test("odrzuca skrypty, zdarzenia i elementy spoza listy", () => {
  const cases = {
    svg_element: [
      `<script>alert(1)</script>`, `<foreignObject><div/></foreignObject>`, `<image href="x.png"/>`,
      `<use href="#a"/>`, `<style>rect{}</style>`, `<animate attributeName="href" to="javascript:alert(1)"/>`,
      `<set attributeName="onclick"/>`, `<a href="https://example.com"><rect/></a>`, `<iframe/>`, `<svg/>`, `<filter id="f"/>`,
    ],
    svg_event: [`<rect onload="alert(1)"/>`, `<g ONCLICK="x"/>`, `<rect onmouseover='x'/>`],
    svg_url: [
      `<rect fill="url(https://evil.example/x.svg#a)"/>`, `<rect fill="url('data:image/svg+xml,x')"/>`,
      `<linearGradient id="q" href="javascript:alert(1)"/>`, `<rect x="url(#a)"/>`,
      `<rect style="fill:url(//evil/x)"/>`, `<rect fill="url( #a) url(x)"/>`,
    ],
    svg_value: [`<rect fill="javascript:alert(1)"/>`, `<rect id="1bad"/>`, `<rect class="ok Bad!"/>`, `<rect fill="expression(alert(1))"/>`, `<rect fill="@A @B"/>`],
  };
  for (const [code, list] of Object.entries(cases)) {
    for (const inner of list) {
      assert.equal(errorOf(file({ svg: svg(inner + INDICATORS) })), code, inner);
    }
  }
});

test("odrzuca DOCTYPE, encje, CDATA i błędną składnię; wymaga viewBox i odwołań", () => {
  assert.equal(errorOf(file({ svg: `<!DOCTYPE svg [<!ENTITY x "y">]>` + svg(INDICATORS) })), "svg_doctype");
  assert.equal(errorOf(file({ svg: svg(`<text>&x;</text>` + INDICATORS) })), "svg_entity");
  assert.equal(errorOf(file({ svg: svg(`<text><![CDATA[x]]></text>` + INDICATORS) })), "svg_doctype");
  assert.equal(errorOf(file({ svg: svg(`<g><rect></g>` + INDICATORS) })), "svg_syntax");
  assert.equal(errorOf(file({ svg: svg(`<rect fill=red/>` + INDICATORS) })), "svg_syntax");
  assert.equal(errorOf(file({ svg: svg(INDICATORS) + "<?php ?>" })), "svg_syntax");
  assert.equal(errorOf(file({ svg: svg(INDICATORS, 'viewBox="0 0 1920 1080"') })), "svg_viewbox");
  assert.equal(errorOf(file({ svg: `<g>${INDICATORS}</g>` })), "svg_root");
  assert.equal(errorOf(file({ svg: svg(`<rect fill="url(#nie-ma)"/>` + INDICATORS) })), "svg_reference");
});

test("pola pliku: typ, wersja, nazwa, wejścia, display, Prowadzący, rozmiar", () => {
  assert.equal(errorOf(""), "empty");
  assert.equal(errorOf("{nie json"), "not_json");
  assert.equal(errorOf("[]"), "not_theme");
  assert.equal(errorOf(file({ type: "familiada-display-theme" })), "not_theme");
  assert.equal(errorOf(file({ version: 2 })), "version");
  assert.equal(errorOf(file({ name: " " })), "name");
  assert.equal(errorOf(file({ name: "<b>" })), "name");
  assert.equal(errorOf(file({ label: { pl: "A", en: "B" } })), "label");
  assert.equal(errorOf(file(), { builtin: true }), "label");
  assert.equal(errorOf(file({ inputs: { T: { default: "red" } } })), "inputs");
  assert.equal(errorOf(file({ inputs: { X: { default: "#000000" } } })), "inputs");
  assert.equal(errorOf(file({ inputs: { T: { default: "#000000", label: { pl: "Tło" } } } })), "inputs");
  assert.equal(errorOf(file({ inputs: { T: { default: "#000000" } } })), "inputs", "T bez nazwy w trzech językach");
  assert.equal(parseThemeFile(file({ inputs: { T: { default: "#000000", label: { pl: "Obręcz", en: "Rim", uk: "Обідок" } } } })).theme.inputs.T.label.pl, "Obręcz");
  assert.equal(errorOf(JSON.stringify({ type: THEME_FILE_TYPE, version: 1, name: "X" })), "display");
  assert.equal(errorOf(file({ scale: 3 })), "display");
  assert.equal(errorOf(file({ panels: { big: [2000, 10] } })), "display");
  assert.equal(errorOf(file({ panels: { huge: [1, 1] } })), "display");
  assert.equal(errorOf(file({ page: "url(x.png)" })), "host_css");
  assert.equal(errorOf(file({ page: "var(--t-nie)" })), "host_css");
  assert.equal(parseThemeFile(file({ page: "radial-gradient(var(--t-lampA), var(--t-T))" })).ok, true);
  assert.equal(errorOf(file({ host: { css: { ":root": { "--host-font": "url(x.woff2)" } } } })), "host_css");
  assert.equal(errorOf(file({ host: { ruled: "tak" } })), "host");
  assert.equal(errorOf(file({ host: 5 })), "host");
  assert.equal(parseThemeFile(file({ host: "wings" })).theme.host.from, "wings");
  assert.equal(errorOf(file({ host: "wings" }), { builtinKeys: ["classic"] }), "host");
  assert.equal(errorOf(file({ svg: svg(`<text>${"x".repeat(THEME_ARTWORK_MAX_BYTES)}</text>`) })), "artwork_too_large");
  assert.equal(errorOf(file({ notes: "x".repeat(THEME_FILE_MAX_BYTES) })), "too_large");
  assert.equal(errorOf(file({ svg: undefined })), "artwork_missing");
});

test("display.motion: stała czasowa 0–2000 ms", () => {
  assert.equal(parseThemeFile(file({ motion: 180 })).theme.display.motion, 180);
  assert.equal(errorOf(file({ motion: -1 })), "display");
  assert.equal(errorOf(file({ motion: 2001 })), "display");
  assert.equal(errorOf(file({ motion: "180" })), "display");
});

test("czcionki Prowadzącego wszyte w plik: typ po nagłówku, rozmiar, nazwa, grubość", () => {
  const b64 = (head, size = 64) => Buffer.concat([Buffer.from(head, "latin1"), Buffer.alloc(size)]).toString("base64");
  const font = (over = {}) => ({ family: "Scena Mono", data: `data:font/woff2;base64,${b64("wOF2")}`, ...over });
  const host = (fonts) => file({ host: { fonts } });
  const ok = parseThemeFile(host([font({ weight: "100 800", style: "italic" })]));
  assert.equal(ok.ok, true, ok.detail);
  assert.deepEqual(ok.theme.host.fonts[0], { family: "Scena Mono", data: font().data, weight: "100 800", style: "italic" });
  assert.equal(parseThemeFile(host([font({ data: `data:font/ttf;base64,${b64("\u0000\u0001\u0000\u0000")}` })])).ok, true);
  assert.equal(parseThemeFile(host([font({ data: `data:font/otf;base64,${b64("OTTO")}` })])).ok, true);
  assert.equal(errorOf(host([font({ data: `data:font/woff2;base64,${b64("wOFF")}` })])), "fonts", "nagłówek nie pasuje do typu");
  assert.equal(errorOf(host([font({ data: `data:font/svg;base64,${b64("wOF2")}` })])), "fonts");
  assert.equal(errorOf(host([font({ data: "https://example.com/x.woff2" })])), "fonts");
  assert.equal(errorOf(host([font({ data: `data:font/woff2;base64,${b64("wOF2", 251 * 1024)}` })])), "fonts");
  assert.equal(errorOf(host([font({ family: "x;}body{" })])), "fonts");
  assert.equal(errorOf(host([font({ weight: "bold" })])), "fonts");
  assert.equal(errorOf(host([font({ style: "oblique" })])), "fonts");
  assert.equal(errorOf(host([font(), font(), font(), font()])), "fonts");
  assert.equal(errorOf(host({})), "fonts");
  assert.equal(parseThemeFile(host([font({ unicodeRange: "U+0000-00FF,U+0131" })])).theme.host.fonts[0].unicodeRange, "U+0000-00FF,U+0131");
  assert.equal(errorOf(host([font({ unicodeRange: "U+00;}" })])), "fonts");
});

test("CSS Prowadzącego: biała lista, wyjścia motywu jako var(--t-…)", () => {
  const ok = parseThemeFile(file({ host: { css: {
    ":root": { "--host-paper-bg": "var(--t-T)", "--host-background": "#152238" },
    ".pane": { border: "4px double var(--host-brass)", "clip-path": "polygon(0 0, 100% 0, 100% 100%)" },
    ".pane::after": { content: '""', background: "linear-gradient(90deg, var(--t-lampA), transparent)" },
  } } }));
  assert.equal(ok.ok, true, ok.error);
  assert.match(hostRulesCss(ok.theme.host.css), /^html\[data-host-style\] \{ --host-paper-bg: var\(--t-T\); --host-background: #152238; \}/);
  const bad = [
    { body: { color: "red" } }, { ".pane": { behavior: "x" } }, { ".pane": { background: "url(https://evil.example/x.png)" } },
    { ".pane": { background: "red; } body { color: red" } }, { ".pane": { background: 'image-set("x")' } },
    { ".pane": { background: "var(--secret)" } }, { ".pane": { background: "var(--t-nie)" } }, { ".pane": { content: '"tekst"' } },
    { ".pane": { color: "red !important" } }, { ".pane": { "--other-var": "1px" } }, { ".pane": "color: red" },
  ];
  for (const css of bad) assert.equal(errorOf(file({ host: { css } })), "host_css", JSON.stringify(css));
});

test("zapis kanoniczny wczytuje się ponownie identycznie", () => {
  const first = parseThemeFile(file({
    label: { pl: "A", en: "B", uk: "В" }, inputs: { T: { default: "#010203", label: { pl: "Tło", en: "Background", uk: "Фон" } } },
    page: "radial-gradient(var(--t-lampA), var(--t-T))", scale: 0.9, panels: { big: [640, 341.6] },
    host: { ruled: true, board: false, css: { ":root": { "--host-font": '"Caveat-Variable", cursive', "--host-font-ratio": "1" }, ".pane": { border: "1px solid var(--t-lampB)" } } },
  }));
  assert.equal(first.ok, true, first.error);
  assert.deepEqual(parseThemeFile(serializeThemeFile(first.theme)), first);
  const borrowed = parseThemeFile(file({ host: "radar" }));
  assert.deepEqual(parseThemeFile(serializeThemeFile(borrowed.theme)), borrowed);
});

test("klucz motywu custom:<uuid>", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.equal(customThemeId(customThemeKey(id.toUpperCase())), id);
  assert.equal(customThemeId("custom:../x"), null);
  assert.equal(customThemeId("wings"), null);
});

test("kopia walidatora dla funkcji Edge jest aktualna (node scripts/sync-display-theme-file.cjs)", () => {
  const source = read("web/shared/js/display/theme-file.js");
  const copy = read("supabase/functions/_shared/display-theme-file.js");
  assert.equal(copy, "// Wygenerowane przez scripts/sync-display-theme-file.cjs. Edytuj web/shared/js/display/theme-file.js.\n" + source);
});

test("czcionki serwisu dla motywów: lista = zestaw rysunku + Unbounded, pliki w web/shared/fonts/", async () => {
  const { DRAW_FONTS } = await import("../../web/shared/js/core/draw-fonts.js");
  assert.deepEqual([...SHARED_FONT_FILES].sort(), [...new Set([...DRAW_FONTS.map((f) => f.file), "unbounded"])].sort());
  for (const name of SHARED_FONT_FILES) assert.ok(fs.existsSync(new URL(`../../web/shared/fonts/${name}.woff2`, import.meta.url)), name);
  // motyw może wskazać plik serwisu zamiast wszywać krój; nieznany plik — odmowa
  const ok = parseThemeFile(file({ host: { fonts: [{ family: "Caveat-Variable", file: "caveat", weight: "400 700" }] } }));
  assert.equal(ok.ok, true, ok.error);
  assert.deepEqual(ok.theme.host.fonts, [{ family: "Caveat-Variable", file: "caveat", weight: "400 700", style: "normal" }]);
  assert.equal(errorOf(file({ host: { fonts: [{ family: "X", file: "../evil" }] } })), "fonts");
});
