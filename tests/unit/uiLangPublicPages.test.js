import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Search Console 2026-11: „Duplikat, Google wybrał inną stronę kanoniczną” dla
// /?lang=en, /marketplace?lang=en, /privacy?lang=en. Googlebot renderuje z
// en-US, a adres bez ?lang tłumaczył się na angielski (canonical ?lang=en).
// Na stronach do indeksowania język wynika z adresu, nie z przeglądarki.
const PUBLIC_PAGES = ["index.html", "marketplace/index.html", "manual/index.html", "privacy/index.html"];

test("indexable public pages take the language from the URL", () => {
  for (const page of PUBLIC_PAGES) {
    const html = readFileSync(new URL(`../../web/${page}`, import.meta.url), "utf8");
    assert.match(html, /<meta name="i18n-lang" content="url">/, page);
  }
});

test("getUiLang: URL-language pages ignore the browser language, app pages keep it", async () => {
  const saved = {};
  for (const key of ["window", "document", "location", "localStorage", "navigator"]) saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  const define = (key, value) => Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  let urlLang = true, stored = null, search = "";
  define("window", { addEventListener() {}, dispatchEvent() {} });
  define("document", {
    documentElement: { dataset: {} }, readyState: "loading", addEventListener() {},
    querySelectorAll: () => [], getElementById: () => null,
    querySelector: (sel) => (urlLang && sel.includes("i18n-lang") ? {} : null),
  });
  define("location", { get search() { return search; } });
  define("localStorage", { getItem: () => stored, setItem() {} });
  define("navigator", { language: "en-US" });
  try {
    const { getUiLang } = await import("../../web/shared/translation/translation.js");
    assert.equal(getUiLang(), "pl", "public page without ?lang = Polish for Googlebot (en-US)");
    search = "?lang=en";
    assert.equal(getUiLang(), "en", "?lang wins");
    search = ""; stored = "uk";
    assert.equal(getUiLang(), "uk", "a saved choice of the person still applies");
    stored = null; urlLang = false;
    assert.equal(getUiLang(), "en", "app pages keep the browser language");
  } finally {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
