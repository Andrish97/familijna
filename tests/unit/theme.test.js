// Jasny motyw (decyzja 2026-11-03, familijna-server/docs/jasny-motyw-plan.md):
// page-boot.js ustawia data-theme przed pierwszą klatką — Auto wg systemu,
// ręczny wybór w localStorage (uiTheme), ekrany gry (data-theme-lock) ciemne.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const read = (p) => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const BOOT = read("web/shared/js/core/page-boot.js");

function boot({ systemLight = false, stored = null, locked = false } = {}) {
  const store = new Map(stored ? [["uiTheme", stored]] : []);
  const attrs = new Set(locked ? ["data-theme-lock"] : []);
  const root = { dataset: {}, hasAttribute: (k) => attrs.has(k), toggleAttribute() {}, setAttribute() {}, removeAttribute() {},
    classList: { contains: () => false, remove() {} } };
  const meta = { content: "", setAttribute(_k, v) { this.content = v; } };
  const mediaListeners = [], events = [];
  const media = { matches: systemLight, addEventListener: (_t, fn) => mediaListeners.push(fn) };
  const context = vm.createContext({
    document: { documentElement: root, readyState: "complete", addEventListener() {}, querySelector: () => meta },
    window: { innerWidth: 1440, innerHeight: 900, screen: { width: 1440, height: 900 },
      matchMedia: (q) => (q.includes("prefers-color-scheme") ? media : { matches: false }),
      addEventListener() {}, dispatchEvent: (e) => events.push(e.type) },
    navigator: { maxTouchPoints: 0, userAgent: "" },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    MutationObserver: class { observe() {} disconnect() {} }, setTimeout() {}, clearTimeout() {},
  });
  vm.runInContext(BOOT, context);
  return { root, meta, media, mediaListeners, events, store, theme: context.FamilijnaTheme };
}

test("Auto idzie za systemem, także po zmianie ustawień systemu", () => {
  assert.equal(boot().root.dataset.theme, "dark");
  const light = boot({ systemLight: true });
  assert.equal(light.root.dataset.theme, "light");
  assert.equal(light.meta.content, "#f3f0e8", "pasek przeglądarki w kolorze tła");
  light.media.matches = false;
  light.mediaListeners.forEach((fn) => fn());
  assert.equal(light.root.dataset.theme, "dark");
  assert.equal(light.meta.content, "#050914");
});

test("ręczny wybór wygrywa z systemem i jest zapamiętany; Auto czyści zapis", () => {
  const b = boot({ systemLight: false, stored: "light" });
  assert.equal(b.root.dataset.theme, "light");
  assert.equal(b.theme.getChoice(), "light");
  b.theme.setChoice("dark");
  assert.equal(b.root.dataset.theme, "dark");
  assert.equal(b.store.get("uiTheme"), "dark");
  assert.ok(b.events.includes("theme:change") && b.events.includes("theme:choice"));
  b.theme.setChoice("auto");
  assert.equal(b.store.has("uiTheme"), false);
  assert.throws(() => b.theme.setChoice("sepia"));
  assert.equal(boot({ stored: "sepia" }).theme.getChoice(), "auto", "nieznana wartość = Auto");
});

test("ekrany gry (data-theme-lock) zostają ciemne mimo jasnego systemu i wyboru", () => {
  const b = boot({ systemLight: true, stored: "light", locked: true });
  assert.equal(b.root.dataset.theme, "dark");
  assert.equal(b.theme.locked, true);
  for (const page of ["web/snake/index.html", "web/connect/tv/index.html", "web/control/buzzer/index.html",
    "web/control/host/index.html", "web/polls/vote/qr/index.html", "web/control/display/index.html"]) {
    assert.match(read(page), /<html[^>]*\bdata-theme-lock\b/, page);
  }
});

test("tokeny: jasny motyw nadpisuje podłoża, tekst i „biel” przezroczystości", () => {
  const css = read("web/shared/style/tokens.css");
  const light = css.slice(css.indexOf(':root[data-theme="light"] {'));
  for (const token of ["color-scheme: light", "--rgb-white:", "--bg:", "--surface-1:", "--surface-modal:", "--text:", "--accent:"]) {
    assert.ok(light.includes(token), token);
  }
});
