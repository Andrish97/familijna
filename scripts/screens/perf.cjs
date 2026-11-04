#!/usr/bin/env node
// Rundy zapytań do bazy przy wczytaniu strony (prawdziwy kod strony, atrapa
// Supabase z opóźnieniem każdej odpowiedzi). Na telefonie każda runda to
// 100–300 ms, więc liczba kolejnych rund przed gotowością = czekanie użytkownika.
//
//   node scripts/screens/perf.cjs --scenes=games,bases [--latency=150] [--verbose]
//
// Wypisuje: czas do gotowości sceny, liczbę zapytań, rundy (najdłuższy łańcuch
// zapytań, z których każde zaczęło się dopiero po końcu poprzedniego)
// i z --verbose oś czasu zapytań.
const { startServer, stopServer, launch, newContext } = require("./lib.cjs");
const scenes = require("./scenes.cjs");
const { buildDb } = require("./data/demo.cjs");

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v = "1"] = a.replace(/^--/, "").split("="); return [k, v]; }));
const LATENCY = Number(args.latency || 150);
const DESKTOP = { width: 1400, height: 900, scale: 1, mobile: false };

// Rundy: głębokość łańcucha zależności (zapytanie zależy od tych, które
// skończyły się przed jego startem). Margines na czas JS między nimi.
function rounds(trace) {
  const done = trace.filter((t) => t.end != null).sort((a, b) => a.start - b.start);
  const depth = [];
  done.forEach((t, i) => {
    let d = 1;
    for (let j = 0; j < i; j++) if (done[j].end <= t.start + 1) d = Math.max(d, depth[j] + 1);
    depth[i] = d;
  });
  return { list: done.map((t, i) => ({ ...t, round: depth[i] })), max: Math.max(0, ...depth) };
}

(async () => {
  const { buildGameState } = await import("./data/game-state.mjs");
  const picked = args.scenes ? scenes.filter((s) => args.scenes.split(",").includes(s.id)) : scenes.filter((s) => !s.steps?.length && !s.guest && !s.previewRow);
  const origin = await startServer();
  const browser = await launch();
  for (const scene of picked) {
    const lang = "pl";
    const db = buildDb(lang, scene.gameState ? { gameState: buildGameState(lang, scene.gameState) } : {});
    db.latency = LATENCY;
    if (typeof scene.db === "function") scene.db(db, lang);
    const context = await newContext(browser, db, lang, scene.size ? { scale: 1, mobile: false, ...scene.size } : DESKTOP);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const sep = scene.path.includes("?") ? "&" : "?";
    const t0 = Date.now();
    await page.goto(`${origin}${scene.path.split("#")[0]}${sep}lang=${lang}`, { waitUntil: "domcontentloaded" });
    let ready = null;
    try {
      if (typeof scene.ready === "string") await page.waitForSelector(scene.ready, { state: "visible", timeout: 20000 });
      else if (scene.ready) await page.waitForFunction(scene.ready, null, { timeout: 20000 });
      await page.waitForFunction(() => !document.documentElement.classList.contains("page-loading"), null, { timeout: 8000 }).catch(() => {});
      ready = await page.evaluate(() => performance.now());
    } catch (e) { errors.push("gotowość: " + e.message.split("\n")[0]); }
    await page.waitForTimeout(LATENCY * 3);
    const trace = await page.evaluate(() => window.__SCREENS_TRACE__ || []);
    const r = rounds(trace);
    const before = ready == null ? r.list : r.list.filter((t) => t.start < ready);
    const roundsBefore = Math.max(0, ...before.map((t) => t.round));
    console.log(`${scene.id.padEnd(34)} gotowa ${ready == null ? "  —  " : String(Math.round(ready)).padStart(5) + " ms"}  zapytań ${String(before.length).padStart(2)} (po: ${r.list.length - before.length})  rundy przed gotowością ${roundsBefore}${errors.length ? "  BŁĄD " + errors[0].slice(0, 80) : ""}`);
    if (args.verbose) for (const t of r.list) console.log(`    r${t.round} ${String(Math.round(t.start)).padStart(5)}–${String(Math.round(t.end)).padStart(5)}  ${t.name}${ready != null && t.start >= ready ? "  (po gotowości)" : ""}`);
    await context.close();
    void t0;
  }
  await browser.close();
  stopServer();
})();
