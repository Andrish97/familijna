// tests/e2e/perf-pages.spec.js
// Pomiar wydajności stron na produkcji, także po zalogowaniu (Lighthouse nie
// loguje się). Telefon (Pixel 7), łącze jak wolne 4G i procesor ×4 wolniejszy
// (CDP). Każda strona dwa razy: pierwsze wejście (pusta pamięć) i powtórne
// (pamięć przeglądarki). Wynik tylko w logu ([e2e-diag] perf …):
//   ttfb      — pierwszy bajt HTML,
//   fcp / lcp — pierwsze i największe wyświetlenie,
//   shown     — odsłonięcie powłoki strony (zdarzenie page:shown, page-layout.js),
//   data      — wszystkie etapy [data-skel-step] gotowe (dane na ekranie),
//   req/kB    — liczba pobrań i przesłane kB (js — z tego skrypty),
//   db        — zapytania do api.familijna.app: liczba, start pierwszego,
//               koniec ostatniego i „fale” (zapytania czekające na poprzednie).
// Bez asercji progów — to narzędzie pomiaru, nie bramka. Strony gry
// (edytor, ustawienia, Control) tylko gdy konto ma choć jedną grę.

const fs = require("node:fs");
const path = require("node:path");
const { devices } = require("@playwright/test");
const { test } = require("./helpers/e2e-test");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });
test.setTimeout(15 * 60_000);

const SITE = "https://www.familijna.app";
const API_HOST = "api.familijna.app";
const PUBLIC_PAGES = ["/", "/manual/", "/marketplace/"];
const ACCOUNT_PAGES = ["/games/", "/bases/", "/polls/", "/logos/", "/account/", "/friends/", "/subscribers/", "/tasks/", "/mails/"];
const GAME_PAGES = (id) => [`/games/editor/?id=${id}`, `/games/settings/?id=${id}`, `/control/?id=${id}`];
const ANON_KEY = fs.readFileSync(path.join(__dirname, "../../web/shared/js/core/supabase.js"), "utf8")
  .match(/SUPABASE_ANON_KEY = "([^"]+)"/)[1];

const FILTER = (process.env.PERF_PAGES || "").split(/\s+/).filter(Boolean);
const pick = (list) => (FILTER.length ? list.filter((p) => FILTER.some((f) => p.startsWith(f))) : list);

// Znaczniki czasu z wnętrza strony (od początku nawigacji).
function installProbe(context) {
  return context.addInitScript(() => {
    const probe = window.__perfProbe = { shown: null, lcp: null, stepsAt: null };
    window.addEventListener("page:shown", () => { probe.shown = performance.now(); }, { once: true });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) probe.lcp = entry.renderTime || entry.loadTime || entry.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    const checkSteps = () => {
      if (probe.stepsAt !== null || document.readyState === "loading") return;
      const steps = [...document.querySelectorAll("[data-skel-step]")];
      if (steps.every((s) => s.classList.contains("skel-step-ready"))) probe.stepsAt = performance.now();
    };
    // Skrypt startowy działa przed <html> — obserwujemy cały dokument.
    new MutationObserver(checkSteps).observe(document, { subtree: true, attributes: true, attributeFilter: ["class"] });
    document.addEventListener("DOMContentLoaded", checkSteps);
  });
}

async function throttle(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

// Zapytania do bazy w „falach”: nowa fala, gdy zapytanie startuje po końcu
// wszystkich zapytań, które zaczęły się wcześniej (czeka na poprzednie).
function dbWaves(calls) {
  const sorted = [...calls].sort((a, b) => a.start - b.start);
  let waves = 0, frontierEnd = -Infinity;
  for (const call of sorted) {
    if (call.start >= frontierEnd) waves++;
    frontierEnd = Math.max(frontierEnd, call.end);
  }
  return waves;
}

const ms = (v) => (v === null || v === undefined ? "–" : `${Math.round(v)}`);

async function measure(page, url, label) {
  const calls = [];
  const started = new Map();
  let navStart = 0;
  const onRequest = (req) => { if (new URL(req.url()).host === API_HOST) started.set(req, Date.now()); };
  const onDone = (req) => {
    if (!started.has(req)) return;
    const u = new URL(req.url());
    const name = u.pathname.replace(/^\/(rest|auth|storage|functions)\/v1\//, "$1:").replace(/^rest:rpc\//, "rpc:");
    calls.push({ name, start: started.get(req) - navStart, end: Date.now() - navStart });
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  navStart = Date.now();
  await page.goto(SITE + url, { waitUntil: "load", timeout: 90_000 });
  await page.waitForFunction(() => {
    const p = window.__perfProbe;
    return p && p.shown !== null && p.stepsAt !== null;
  }, null, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1500); // późne zapytania po odsłonięciu
  page.off("request", onRequest);
  page.off("requestfinished", onDone);
  page.off("requestfailed", onDone);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {};
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    const res = performance.getEntriesByType("resource");
    const kb = (list) => Math.round(list.reduce((s, r) => s + (r.transferSize || 0), 0) / 1024);
    const js = res.filter((r) => /\.m?js(\?|$)/.test(r.name));
    return {
      path: location.pathname + location.search,
      ttfb: nav.responseStart, fcp: fcp?.startTime, lcp: window.__perfProbe?.lcp,
      shown: window.__perfProbe?.shown, data: window.__perfProbe?.stepsAt,
      req: res.length + 1, kb: kb(res) + Math.round((nav.transferSize || 0) / 1024), jsReq: js.length, jsKb: kb(js),
    };
  });
  // Tylko zapytania startu strony: odświeżanie cykliczne (co 20–30 s) pomijamy.
  const windowEnd = Math.max(m.shown || 0, m.data || 0) + 5000;
  const startup = calls.filter((c) => c.start <= windowEnd);
  calls.length = 0;
  calls.push(...startup);
  const db = calls.length
    ? `${calls.length} zapytań ${ms(Math.min(...calls.map((c) => c.start)))}→${ms(Math.max(...calls.map((c) => c.end)))} ms, fale ${dbWaves(calls)}`
    : "0";
  const redirected = m.path !== url ? ` (→ ${m.path})` : "";
  console.log(`[e2e-diag] perf ${label} ${url}${redirected}: ttfb ${ms(m.ttfb)} fcp ${ms(m.fcp)} lcp ${ms(m.lcp)} shown ${ms(m.shown)} data ${ms(m.data)} | req ${m.req} ${m.kb} kB (js ${m.jsReq}/${m.jsKb} kB) | db ${db}`);
  if (calls.length) {
    const top = [...calls].sort((a, b) => a.start - b.start).map((c) => `${c.name} ${ms(c.start)}-${ms(c.end)}`);
    console.log(`[e2e-diag] perf ${label} ${url} db: ${top.join(", ")}`);
  }
}

async function measurePages(page, cdp, list) {
  for (const url of list) {
    await cdp.send("Network.clearBrowserCache");
    await measure(page, url, "pierwsze");
    await measure(page, url, "powtórne");
  }
}

test("wydajność stron (telefon, wolne 4G, CPU ×4)", async ({ browser, accounts, loginAs }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"], serviceWorkers: "block" });
  await installProbe(context);
  const page = await context.newPage();
  try {
    let cdp = await throttle(page);
    await measurePages(page, cdp, pick(PUBLIC_PAGES));

    // Logowanie bez dławienia (to nie jest mierzone), potem znów telefon.
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await loginAs(page, context, accounts.standard[0]);
    cdp = await throttle(page);
    await measurePages(page, cdp, pick(ACCOUNT_PAGES));

    const gameId = await page.evaluate(async ({ host, anon }) => {
      const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
      const token = key && JSON.parse(localStorage.getItem(key))?.access_token;
      if (!token) return null;
      const res = await fetch(`https://${host}/rest/v1/games?select=id&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      return res.ok ? (await res.json())[0]?.id || null : null;
    }, { host: API_HOST, anon: ANON_KEY });
    if (gameId) await measurePages(page, cdp, pick(GAME_PAGES(gameId)));
    else console.log("[e2e-diag] perf: konto bez gier — edytor, ustawienia i Control pominięte");
  } finally {
    await context.close();
  }
});
