// Wybór scen zrzutów po zmianach (scripts/screens/changes.cjs): strona główna i Wskazówki.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { VERSION, withImporters, expandI18nParts } = require("../../scripts/screens/changes.cjs");
const scenes = require("../../scripts/screens/scenes.cjs");

test("same znaczniki wersji (?v= i meta app-version) nie są zmianą", () => {
  const strip = (s) => s.replace(VERSION, "");
  const before = '<meta name="app-version" content="v2026-10-22T18284"/><script src="/shared/js/core/a.js?v=v2026-10-22T18284"></script>';
  const after = '<meta name="app-version" content="v2026-10-22T18363"/><script src="/shared/js/core/a.js?v=v2026-10-22T18363"></script>';
  assert.equal(strip(before), strip(after));
  assert.notEqual(strip(before), strip(after.replace("a.js", "b.js")));
});

test("wspólny moduł dotyczy tylko stron, które go wczytują (także pośrednio)", () => {
  const viewer = withImporters(["web/shared/js/core/image-viewer.js"]);
  for (const file of ["web/home/js/index.js", "web/index.html", "web/manual/js/manual.js", "web/manual/index.html"]) {
    assert.ok(viewer.has(file), file);
  }
  assert.ok(!viewer.has("web/games/index.html"), "Moje gry nie wczytują podglądu zrzutu");
  const pick = (files) => scenes.filter((s) => [...files].some((f) => (s.sources || []).some((src) => f.startsWith(src)))).map((s) => s.id);
  const ids = pick(viewer);
  assert.ok(ids.includes("manual-shot-zoom") && ids.includes("home-viewer"), "Wskazówki i strona główna");
  // Kadry strony głównej to zrzuty innych stron (Moje gry, Control…) -- podgląd ich nie dotyczy.
  assert.ok(!ids.some((id) => scenes.find((s) => s.id === id)?.homepage));
  assert.ok(!ids.includes("games"));
});

test("moduł wczytywany przez każdą stronę (page-init) dotyczy prawie wszystkich scen", () => {
  const files = withImporters(["web/shared/js/core/device-guard.js"]);
  assert.ok(files.has("web/games/index.html") && files.has("web/control/index.html"));
});

test("część słownika dotyczy tylko stron z nią w meta i18n-parts", () => {
  const pick = (files) => scenes.filter((s) => [...files].some((f) => (s.sources || []).some((src) => f.startsWith(src)))).map((s) => s.id);
  const snake = pick(withImporters(expandI18nParts(["web/shared/translation/en/snake.js"])));
  assert.ok(snake.length > 0, "sceny Węża");
  assert.ok(!snake.includes("games") && !snake.includes("control"), "zmiana tekstu Węża nie odświeża Gier ani Control");
  assert.deepEqual(expandI18nParts(["web/shared/translation/pl/server.js"]), []);
  // część wspólna -- jak translation.js (każda strona z tłumaczeniami)
  assert.deepEqual(expandI18nParts(["web/shared/translation/uk/common.js"]), ["web/shared/translation/translation.js"]);
});

test("sceny podglądu urządzeń (?preview=1) idą przez ramkę rodzica", () => {
  // Wyświetlacz i Prowadzący w trybie podglądu przyjmują stan tylko od strony
  // nadrzędnej (E24 R28); scena bez ramki daje pustą tablicę (2026-11-12).
  const bad = scenes.filter((s) => String(s.path).includes("preview=1") && !s.frame).map((s) => s.id);
  assert.deepEqual(bad, []);
});
