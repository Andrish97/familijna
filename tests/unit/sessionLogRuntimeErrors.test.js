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
  vm.runInNewContext(`${block}; this.errorSource = errorSource; this.errorFrame = errorFrame; this.watch = watchRuntimeErrors;`, context);
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
