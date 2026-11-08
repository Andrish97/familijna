import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLayoutTheme, approach } from "../../web/shared/js/display/theme_layouts.js";
import { parseThemeFile, evaluateOutputs, hostRulesCss } from "../../web/shared/js/display/theme-file.js";

const themesDir = new URL("../../web/shared/themes/", import.meta.url);
const index = JSON.parse(readFileSync(new URL("index.json", themesDir), "utf8"));
const themes = index.themes.map(entry => ({ key: entry.key, ...parseThemeFile(readFileSync(new URL(`${entry.key}.json`, themesDir), "utf8"), { builtin: true }).theme }));
const byKey = Object.fromEntries(themes.map(theme => [theme.key, theme]));

// Minimalny DOM: elementy z atrybutami i stylem (to, czego używa silnik).
function element(attrs = {}) {
  const style = new Map();
  return {
    attrs: new Map(Object.entries(attrs)), style: { setProperty: (k, v) => style.set(k, v), removeProperty: k => style.delete(k), filter: "" }, css: style,
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }, setAttribute(k, v) { this.attrs.set(k, String(v)); }, removeAttribute(k) { this.attrs.delete(k); },
  };
}
function stage(children = []) {
  const svg = { innerHTML: "", setAttribute() {}, querySelectorAll: () => children };
  const bg = { innerHTML: "", style: { css: new Map(), setProperty(k, v) { this.css.set(k, v); }, background: "" } };
  return { svg, bg };
}

test("każdy motyw: sześć wyświetlaczy, jedna skala, kolory i stan z jednego silnika", () => {
  assert.equal(index.default, "wings");
  for (const theme of themes) {
    assert.deepEqual(Object.keys(theme.label).sort(), ["en", "pl", "uk"]);
    const { svg, bg } = stage();
    const created = createLayoutTheme(svg, bg, { colors: { A: "#123456", B: "#abcdef" }, controls: { B: true } }, theme.key, theme);
    assert.equal(created.name, theme.key);
    assert.equal(Object.keys(created.displays).length, 6);
    assert.equal(created.multiplier, theme.display.scale);
    assert.equal(created.getColors().A, "#123456");
    assert.equal(created.getControls().B, true);
    assert.equal(bg.style.background, theme.display.page);
  }
});

test("Klasyczny: położenia, poświata z T i lampki w trzech stanach", () => {
  const classic = byKey.classic;
  const lamp = element({ color: "@lampA" });
  const { svg, bg } = stage([lamp]);
  const theme = createLayoutTheme(svg, bg, { colors: { A: "#ff0000", B: "#0000ff", BG: "#d21180" } }, "classic", classic);
  assert.deepEqual(theme.displays.big, { cx: 640, cy: 341.6 });
  assert.equal(bg.style.css.get("--t-pageTop"), "#da3c97");
  assert.equal(bg.style.css.get("--t-pageBottom"), "#5e083a");
  assert.match(bg.style.background, /^radial-gradient\(150vw 90vh at 50% 25%, var\(--t-pageTop\) 0%/);
  assert.equal(lamp.css.get("color"), "#2e2e32");
  theme.updateControls({ A: true });
  assert.equal(lamp.css.get("color"), "#ff0000");
  theme.updateControls({ A: false, B: true });
  assert.equal(lamp.css.get("color"), "#2e2e32");
});

test("Nowoczesny: bez trzeciego koloru, gradient drużyn zależy od stanu", () => {
  const modern = byKey.modern;
  assert.equal(modern.inputs.T, null);
  const off = evaluateOutputs(modern, { A: "#ff0000", B: "#0000ff", state: "off" });
  const a = evaluateOutputs(modern, { A: "#ff0000", B: "#0000ff", state: "a" });
  assert.notEqual(off.team2, a.team2);
  assert.equal(a.team0, a.team2);
});

test("Prowadzący z pliku: krój i miary w CSS motywu, CSS zawężony do motywu, tło niezależne od T", () => {
  // Prowadzący bez czcionek systemowych (decyzja użytkownika 2026-11-08): każdy
  // motyw wbudowany wskazuje czcionkę serwisu z web/shared/fonts/ (host.fonts[].file,
  // jedno miejsce na pliki; Kaseton: Merriweather zamiast Georgii).
  for (const theme of themes) assert.match(theme.host.css[":root"]["--host-font"], /^"(Caveat|JetBrainsMono|Merriweather)-Variable"/, theme.key);
  for (const theme of themes) {
    const first = /^"([^"]+)"/.exec(theme.host.css[":root"]["--host-font"])?.[1];
    const font = theme.host.fonts.find((f) => f.family === first);
    assert.ok(font?.file, `${theme.key}: ${first} bez pliku serwisu w host.fonts`);
    assert.ok(fs.existsSync(new URL(`../../web/shared/fonts/${font.file}.woff2`, import.meta.url)), `${theme.key}: brak pliku ${font.file}`);
  }
  assert.match(hostRulesCss(byKey.classic.host.css), /--host-font: "Caveat-Variable", cursive; --host-font-ratio: 1;/);
  const css = hostRulesCss(byKey.wings.host.css);
  assert.match(css, /^html\[data-host-style\] \{[^}]*--host-background: #152238;/m);
  assert.match(css, /html\[data-host-style\] \.pane::after \{[^}]*height: 3px;/);
  const host = readFileSync(new URL("../../web/control/host/css/host.css", import.meta.url), "utf8");
  assert.doesNotMatch(host, /data-host-theme=|data-host-frame=/);
});

test("explicit theme choice applies only its optional background; same selection preserves custom background", async () => {
  const { chooseDisplayTheme } = await import("../../web/shared/js/display/theme-config.js");
  const display = { theme: "classic", logoId: "logo", colors: { A: "#25a56a", B: "#ef8e24", DOT: "#d7ff3d", BACKGROUND: "#123456" } };
  const chosen = chooseDisplayTheme(display, { key: "wings", defaultBackground: "#152238" });
  assert.equal(chosen.colors.BACKGROUND, "#152238");
  assert.equal(chosen.colors.A, display.colors.A);
  assert.equal(chosen.colors.B, display.colors.B);
  assert.equal(chosen.logoId, display.logoId);
  assert.equal(display.colors.BACKGROUND, "#123456");
  chosen.colors.BACKGROUND = "#987654";
  assert.equal(chooseDisplayTheme(chosen, { key: "wings", defaultBackground: "#152238" }), chosen);
  assert.equal(chooseDisplayTheme(chosen, { key: "modern" }).colors.BACKGROUND, "#987654");
});

test("płynne przejście koloru dochodzi dokładnie do celu (kanały całkowite)", () => {
  // Odtworzenie z e2e: rgb(39,167,108) stało 2 jednostki przed #25a56a.
  let color = "#c4002f";
  let steps = 0;
  while (color !== "#25a56a" && steps < 500) { color = approach(color, "#25a56a", 1 - Math.exp(-16.67 / 80)); steps++; }
  assert.equal(color, "#25a56a");
  assert.ok(steps < 120, `za wolno: ${steps} kroków`);
  assert.equal(approach("#27a76c", "#25a56a", 0.1), "#26a66b");
  assert.equal(approach(5, 7, 0.5), 6);
});
