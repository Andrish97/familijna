import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Sam blok zapisu błędów (bez importów modułu, który łączy się z Supabase).
const full = fs.readFileSync(new URL("../../web/shared/js/core/session-log.js", import.meta.url), "utf8");
const start = full.indexOf("const safeText");
const end = full.indexOf("  window.addEventListener(\"error\", onError);");
const block = full.slice(start, end).replace(/export function/g, "function") + "\n  return { onError, onRejection };\n}\n";

function setup() {
  const listeners = {};
  const context = {
    URL, globalThis: { location: { origin: "https://familijna.app" } },
    document: { visibilityState: "visible", hasFocus: () => true },
  };
  vm.runInNewContext(`${block}; this.errorSource = errorSource; this.errorFrame = errorFrame; this.isForeignError = isForeignError; this.watch = watchRuntimeErrors;`, context);
  const pushed = [];
  const handlers = context.watch((event) => pushed.push(event), "host");
  return { context, handlers, pushed, listeners };
}

test("źródło błędu: plik strony, obcy skrypt, brak pliku", () => {
  const { context } = setup();
  assert.equal(context.errorSource("https://familijna.app/control/host/js/main.js?v=abc", "https://familijna.app"), "/control/host/js/main.js");
  assert.equal(context.errorSource("safari-web-extension://AB12/content.js", "https://familijna.app"), "ext:safari-web-extension:AB12");
  assert.equal(context.errorSource("", "https://familijna.app"), "none");
});

test("błąd zapisuje nazwę, krótką treść i źródło w znakach dopuszczanych przez serwer", () => {
  const { handlers, pushed } = setup();
  const error = new TypeError("Cannot read properties of null (reading 'x') for ola@example.com 123456");
  handlers.onError({ error, message: error.message, filename: "https://familijna.app/control/host/js/render.js", lineno: 12, colno: 7 });
  const event = pushed[0];
  assert.equal(event.error_name, "TypeError");
  assert.equal(event.error_source, "/control/host/js/render.js");
  assert.match(event.error_message, /^[A-Za-z0-9_.:/+-]{1,80}$/);
  assert.ok(!event.error_message.includes("ola"), "bez adresu e-mail");
  assert.ok(!event.error_message.includes("123456"), "bez długich liczb");
  assert.equal(event.line, 12);
  handlers.onRejection({ reason: new Error("Load failed") });
  assert.equal(pushed[1].error_message, "Load_failed");
});

test("pierwsza ramka stosu pokazuje skrypt wstrzyknięty przez przeglądarkę", () => {
  const { context } = setup();
  assert.equal(context.errorFrame("readerCheck@user-script:4:120:19\nglobal code@user-script:4:1", "https://familijna.app"), "ext:user-script:");
  assert.equal(context.errorFrame("render@https://familijna.app/control/host/js/render.js?v=1:12:7", "https://familijna.app"), "/control/host/js/render.js");
  assert.equal(context.errorFrame("TypeError: x\n    at render (https://familijna.app/shared/js/a.js:3:9)", "https://familijna.app"), "/shared/js/a.js");
  assert.equal(context.errorFrame(undefined), undefined);
});

test("obce skrypty: oznaczone i zapisane raz; nasz błąd najwyżej 3 razy", () => {
  const { context, handlers, pushed } = setup();
  assert.equal(context.isForeignError({ source: "none" }), true, "Script error. bez pliku");
  assert.equal(context.isForeignError({ source: "/control/host/" }), true, "kod wklejony w stronę");
  assert.equal(context.isForeignError({ source: "ext:https:cdn.example.com" }), true);
  assert.equal(context.isForeignError({ source: "/control/host/", frame: "ext:user-script:" }), true);
  assert.equal(context.isForeignError({ source: "/control/host/js/main.js" }), false);
  assert.equal(context.isForeignError({ source: "/control/host/", frame: "/shared/js/core/sfx.js" }), false, "ramka stosu rozstrzyga");

  const injected = { error: new TypeError("undefined is not an object (evaluating 'window.__firefox__.reader')"), filename: "https://familijna.app/control/host/", lineno: 1, colno: 19 };
  for (let i = 0; i < 10; i++) handlers.onError(injected);
  assert.equal(pushed.length, 1, "obcy błąd raz na stronę");
  assert.equal(pushed[0].foreign, true);

  const own = () => { const error = new TypeError("x is null"); error.stack = "render@https://familijna.app/control/host/js/render.js:3:4"; return { error, filename: "https://familijna.app/control/host/js/render.js" }; };
  for (let i = 0; i < 10; i++) handlers.onError(own());
  const ownEvents = pushed.filter(event => !event.foreign);
  assert.equal(ownEvents.length, 3, "nasz błąd najwyżej 3 razy");
  assert.equal(ownEvents[0].error_source, "/control/host/js/render.js");

  handlers.onRejection({ reason: { name: "TypeError", message: "Load failed" } });
  assert.equal(pushed.at(-1).foreign, undefined, "odrzucenie bez stosu traktujemy jak nasze");
});
