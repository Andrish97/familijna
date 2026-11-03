import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dictionaries } from "./helpers/i18n.js";
const { pl, en, uk } = dictionaries;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
// Na branchu CI ustawia E2E_WEB_ROOT (zbudowany artefakt) — serveBranchCode serwuje wtedy z niego.
const webRoot = process.env.E2E_WEB_ROOT ? path.resolve(process.env.E2E_WEB_ROOT) : path.join(root, "web");
const { localFileFor, serveBranchCode } = require("../e2e/helpers/branch-code.js");
const read = (file) => fs.readFileSync(path.join(root, /^(tests|scripts|supabase|cloudflare|services|docs)\//.test(file) ? file : "web/" + file), "utf8");

function get(object, key) {
  return key.split(".").reduce((value, part) => value?.[part], object);
}

test("index: każdy użyty klucz istnieje w PL/EN/UK", () => {
  const html = read("index.html");
  const js = read("home/js/index.js");
  const keys = new Set();
  for (const match of html.matchAll(/data-i18n(?:-(?:html|placeholder|title|aria-label|value|alt|content|data-text))?="([^"]+)"/g)) {
    keys.add(match[1]);
  }
  for (const match of js.matchAll(/\bt\(["']([^"']+)["']/g)) keys.add(match[1]);
  for (const [lang, dictionary] of Object.entries({ pl, en, uk })) {
    assert.deepEqual([...keys].filter((key) => get(dictionary, key) == null), [], lang);
  }
});

test("index: sesję weryfikuje backend, a nie niezaufany localStorage", () => {
  const html = read("index.html");
  const js = read("home/js/index.js");
  assert.doesNotMatch(html, /sb-.*auth-token/);
  assert.match(js, /await getUser\(\)/);
  assert.match(js, /redirectPage\(withLangParam\("\/games\/"\)\)/);
});

test("serveBranchCode mapuje główną trasę / na index.html z brancha", () => {
  const helper = read("tests/e2e/helpers/branch-code.js");
  assert.match(helper, /!rel && pages\.includes\("index"\)/);
  assert.match(helper, /path\.join\(REPO_ROOT, "index\.html"\)/);
});

test("serveBranchCode mapuje zagnieżdżony edytor DRAW na jego własny index.html", () => {
  assert.equal(localFileFor("/logos/editor/draw/", ["logos"]), path.join(webRoot, "logos/editor/draw/index.html"));
  // tv.spec: HTML strony (np. /connect/ dla telewizora) wybiera Worker, kod z brancha.
  assert.equal(localFileFor("/connect/", [], { productionHtml: true }), null);
  assert.equal(localFileFor("/shared/js/core/page-boot.js", [], { productionHtml: true }), path.join(webRoot, "shared/js/core/page-boot.js"));
});

test("serveBranchCode serwuje moduły manuala i polityki prywatności zamiast HTML strony", () => {
  assert.equal(localFileFor("/manual/js/manual.js", ["manual"]), path.join(webRoot, "manual/js/manual.js"));
  assert.equal(localFileFor("/privacy/js/privacy.js", ["privacy"]), path.join(webRoot, "privacy/js/privacy.js"));
});

test("polski interfejs używa nazwy Strona główna", () => {
  const files = ["index.html", "login/index.html", "404.html", "shared/translation/pl/common.js", "shared/translation/pl/login.js", "shared/translation/pl/home.js"]
    .map(read).join("\n");
  assert.doesNotMatch(files, /Strona startowa/i);
  assert.equal(pl.index.backHome, "Strona główna");
  assert.equal(pl.nav.page.home, "Strona główna");
});

test("podłącz urządzenie: powrót anonima liczy mapa nawigacji (Strona główna)", () => {
  const js = read("connect/js/connect-device.js");
  assert.doesNotMatch(js, /common\.backToHome/);
  assert.match(js, /initPage\("connectDevice"/); // etykieta i cel „Wstecz” z mapy (initPage)
  for (const dictionary of [pl, en, uk]) {
    assert.equal(typeof dictionary.index.backHome, "string");
    assert.notEqual(dictionary.index.backHome, "index.backHome");
    assert.equal(typeof dictionary.nav.page.home, "string");
  }
});

test("FAQ opisuje aktualny tryb gościa i Gry Społeczności tak samo w PL/EN/UK", () => {
  for (const dictionary of [pl, en, uk]) {
    assert.match(dictionary.home.faq.q5.a, /serwer|server|сервер/i);
    assert.match(dictionary.home.faq.q8.a, /Społeczności|Community|Спільноти/i);
  }
  assert.doesNotMatch(pl.home.faq.q4.a, /pełną funkcjonalność/i);
  assert.match(pl.home.faq.q4.a, /e-mail i hasło/);
});


test("serveBranchCode podmienia kod login, zachowując HTML Workera i Turnstile", () => {
  assert.equal(localFileFor("/login/", ["subscribers"]), null);
  assert.equal(localFileFor("/login/index.html", ["subscribers"]), null);
  assert.equal(localFileFor("/login/js/login.js", ["subscribers"]), path.join(webRoot, "login/js/login.js"));
});

test("serveBranchCode oddaje dalszą obsługę żądań zewnętrznych kolejnym handlerom testu", async () => {
  let handler;
  await serveBranchCode({ addInitScript: async () => {}, route: (_pattern, callback) => { handler = callback; } }, { pages: ["games"] });
  let fellBack = false;
  await handler({
    request: () => ({ url: () => "https://www.familijna.app/login" }),
    fallback: async () => { fellBack = true; },
  });
  assert.equal(fellBack, true);
});
