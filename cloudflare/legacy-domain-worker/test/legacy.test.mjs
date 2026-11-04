// Worker starej domeny: fazy według dat i rozdział hostów.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { handle, phase, handoffPage, gonePage } from "../src/index.js";

const env = { LEGACY_HANDOFF_UNTIL: "2026-12-01", LEGACY_REDIRECT_UNTIL: "2027-12-31", NEW_ORIGIN: "https://www.familijna.app" };
const T_HANDOFF = Date.parse("2026-12-01T23:59:00Z");
const T_REDIRECT = Date.parse("2026-12-02T00:00:00Z");
const T_GONE = Date.parse("2028-01-01T00:00:00Z");
const nav = (url, extra = {}) => new Request(url, { headers: { Accept: "text/html", "Sec-Fetch-Mode": "navigate", "User-Agent": "Mozilla/5.0", ...extra } });

test("fazy włącznie z dniem granicznym", () => {
  assert.equal(phase(env, T_HANDOFF), "handoff");
  assert.equal(phase(env, T_REDIRECT), "redirect");
  assert.equal(phase(env, Date.parse("2027-12-31T23:59:59Z")), "redirect");
  assert.equal(phase(env, T_GONE), "gone");
});

test("przenosiny: strona HTML dla przeglądarki, 301 dla robotów i plików", async () => {
  const page = await handle(nav("https://familiada.online/manual/?ch=5"), env, T_HANDOFF);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /https:\/\/www\.familijna\.app\/manual\/\?ch=5/);
  assert.match(html, /fam-handoff=/);
  const bot = await handle(nav("https://www.familiada.online/", { "User-Agent": "Googlebot/2.1" }), env, T_HANDOFF);
  assert.equal(bot.status, 301);
  const asset = await handle(new Request("https://www.familiada.online/logos/assets/a.png"), env, T_HANDOFF);
  assert.equal(asset.headers.get("Location"), "https://www.familijna.app/logos/assets/a.png");
});

test("przekierowanie po przenosinach i 410 po końcu", async () => {
  const r = await handle(nav("https://www.familiada.online/go/?m=x"), env, T_REDIRECT);
  assert.equal(r.status, 301);
  assert.equal(r.headers.get("Location"), "https://www.familijna.app/go/?m=x");
  const g = await handle(nav("https://www.familiada.online/go/"), env, T_GONE);
  assert.equal(g.status, 410);
  assert.match(await g.text(), /familijna\.app/);
});

test("hosty: API przechodzi do serwera do końca, inne 404", async () => {
  const seen = [];
  const up = async (req) => { seen.push(new URL(req.url).host); return new Response("ok"); };
  assert.equal((await handle(new Request("https://api.familiada.online/rest/v1/x", { method: "POST" }), env, T_REDIRECT, up)).status, 200);
  assert.deepEqual(seen, ["api.familiada.online"]);
  assert.equal((await handle(new Request("https://api.familiada.online/x"), env, T_GONE, up)).status, 410);
  assert.equal((await handle(nav("https://panel.familiada.online/"), env, T_HANDOFF, up)).status, 404);
});

function runPage(storageInit, href) {
  const store = new Map(Object.entries(storageInit));
  const u = new URL(href);
  let replaced = null;
  const localStorage = {
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const location = { pathname: u.pathname, search: u.search, hash: u.hash, replace: (x) => { replaced = x; } };
  const html = handoffPage("https://www.familijna.app", "https://www.familijna.app" + u.pathname + u.search);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((x) => x.includes("fam:handoff"));
  vm.runInNewContext(script, { localStorage, location, btoa, unescape, encodeURIComponent, JSON });
  return { replaced, store };
}

test("skrypt przenosin: paczka z sesją, znacznik i brak drugiego przeniesienia", async () => {
  const { parseLegacyHandoff } = await import("../../../web/shared/js/core/legacy-handoff.js");
  const { replaced, store } = runPage({ "sb-api-auth-token": "{\"refresh_token\":\"r\"}", uiLang: "uk", "familiada:tabId": "x" }, "https://www.familiada.online/games/?a=1#top");
  assert.ok(replaced.startsWith("https://www.familijna.app/games/?a=1#fam-handoff="));
  const p = parseLegacyHandoff(replaced.slice(replaced.indexOf("#")));
  assert.deepEqual(p.items, { "sb-api-auth-token": "{\"refresh_token\":\"r\"}", uiLang: "uk" });
  assert.equal(p.hash, "#top");
  assert.equal(store.get("fam:handoff:done"), "1");
  const again = runPage(Object.fromEntries(store), "https://www.familiada.online/games/");
  assert.equal(again.replaced, "https://www.familijna.app/games/");
  assert.equal(runPage({}, "https://familiada.online/x#h").replaced, "https://www.familijna.app/x#h");
});

test("http:// i narzędzia Google dostają 301 także w fazie przenosin", async () => {
  const env = { LEGACY_HANDOFF_UNTIL: "2099-01-01", LEGACY_REDIRECT_UNTIL: "2099-12-31", NEW_ORIGIN: "https://www.familijna.app" };
  const html = { Accept: "text/html", "Sec-Fetch-Mode": "navigate", "User-Agent": "Mozilla/5.0" };
  const plain = await handle(new Request("http://familiada.online/", { headers: html }), env);
  assert.equal(plain.status, 301);
  assert.equal(plain.headers.get("Location"), "https://www.familijna.app/");
  const google = await handle(new Request("https://familiada.online/", { headers: { ...html, "User-Agent": "Mozilla/5.0 (compatible; Google-Site-Verification/1.0)" } }), env);
  assert.equal(google.status, 301);
  const head = await handle(new Request("https://familiada.online/", { method: "HEAD", headers: html }), env);
  assert.equal(head.status, 301);
  const browser = await handle(new Request("https://familiada.online/", { headers: html }), env);
  assert.equal(browser.status, 200);
});

test("wygląd strony przenosin: wzorzec .page--block aplikacji, przycisk, zapasowe odświeżenie", () => {
  const html = handoffPage("https://www.familijna.app", "https://www.familijna.app/games/?a=1");
  assert.match(html, /<body class="page--block">/);
  assert.match(html, /<link rel="stylesheet" href="\/__familijna\/style.css">/);
  assert.match(html, /class="block-title" id="t-title">Familijna ma nowy adres</);
  assert.match(html, /<a class="btn gold" id="t-go" href="https:\/\/www.familijna.app\/games\/\?a=1">/);
  assert.match(html, /<meta http-equiv="refresh" content="3;url=https:\/\/www.familijna.app\/games\/\?a=1">/);
  // przenosiny przed arkuszem stylów — przejście nie czeka na CSS
  assert.ok(html.indexOf("fam:handoff") < html.indexOf("/__familijna/boot.js"));
  assert.ok(html.indexOf("/__familijna/boot.js") < html.indexOf("/__familijna/style.css"));
  assert.doesNotMatch(gonePage("https://www.familijna.app"), /refresh|fam:handoff/);
});

test("arkusz stylów: pliki aplikacji z nowej domeny, ten sam origin", async () => {
  const asked = [];
  const upstream = async (u) => { asked.push(u); return new Response(u.endsWith("404.css") ? "x" : `/*${u}*/`, { status: u.includes("tv-layout") ? 404 : 200 }); };
  const res = await handle(new Request("https://www.familiada.online/__familijna/style.css"), env, T_HANDOFF, upstream);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/css/);
  const css = await res.text();
  assert.ok(css.includes("/*https://www.familijna.app/shared/style/flat.css*/"));
  assert.ok(!css.includes("tv-layout.css*/"));
  assert.equal(asked.length, 4);
  const boot = await handle(new Request("https://www.familiada.online/__familijna/boot.js"), env, T_HANDOFF, upstream);
  assert.match(boot.headers.get("Content-Type"), /javascript/);
  assert.equal(await boot.text(), "/*https://www.familijna.app/shared/js/core/page-boot.js*/");
});
