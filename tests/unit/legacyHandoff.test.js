// Odbiór przenosin ze starej domeny (web/shared/js/core/legacy-handoff.js).
import test from "node:test";
import assert from "node:assert/strict";
import { parseLegacyHandoff, applyLegacyHandoff } from "../../web/shared/js/core/legacy-handoff.js";

const encode = (obj) => "#fam-handoff=" + Buffer.from(JSON.stringify(obj)).toString("base64url");

test("parsuje paczkę i odrzuca obce części adresu", () => {
  const p = parseLegacyHandoff(encode({ v: 1, items: { uiLang: "en", "sb-api-auth-token": "{\"a\":1}", bad: 5 }, h: "#s-5-4" }));
  assert.deepEqual(p, { items: { uiLang: "en", "sb-api-auth-token": "{\"a\":1}" }, hash: "#s-5-4" });
  assert.equal(parseLegacyHandoff("#s-5-4"), null);
  assert.equal(parseLegacyHandoff("#fam-handoff=!!!"), null);
  assert.equal(parseLegacyHandoff(encode({ v: 2, items: {} })), null);
  assert.equal(parseLegacyHandoff(undefined), null);
});

test("zapisuje brakujące wpisy, nie nadpisuje istniejących i zdejmuje hash", () => {
  const store = new Map([["uiLang", "pl"]]);
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const calls = [];
  const hist = { state: null, replaceState: (...a) => calls.push(a) };
  const loc = { pathname: "/manual/", search: "?ch=5", hash: encode({ v: 1, items: { uiLang: "en", "sb-api-auth-token": "S" }, h: "#s-5-4" }) };
  assert.equal(applyLegacyHandoff(loc, storage, hist, "https://www.familiada.online/"), true);
  assert.equal(store.get("uiLang"), "pl");
  assert.equal(store.get("sb-api-auth-token"), "S");
  assert.deepEqual(calls, [[null, "", "/manual/?ch=5#s-5-4"]]);
  assert.equal(applyLegacyHandoff({ pathname: "/", search: "", hash: "" }, storage, hist, "https://www.familiada.online/"), false);
});

test("paczka spoza strony przenosin (inny referrer) nie zapisuje niczego, ale zdejmuje hash", () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const calls = [];
  const hist = { state: null, replaceState: (...a) => calls.push(a) };
  const loc = { pathname: "/", search: "", hash: encode({ v: 1, items: { "sb-api-auth-token": "ATAK" } }) };
  for (const ref of ["", "https://evil.example/", "https://familiada.online.evil.example/", "https://www.familijna.app/"]) {
    assert.equal(applyLegacyHandoff(loc, storage, hist, ref), false);
  }
  assert.equal(store.size, 0);
  assert.equal(calls.length, 4);
});
