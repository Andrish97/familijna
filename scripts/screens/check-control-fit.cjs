// Kontrola czcionki rozgrywki Control: najgorszy przypadek w limitach bazy
// (pytania QLEN znaków, domyślnie 100; odpowiedzi 17) na wszystkich ekranach
// rozgrywki, w wielu rozmiarach i proporcjach okna, PL i UK.
// Błąd (kod 1), gdy coś jest ucięte, wychodzi poza kartę, strona się przewija
// albo czcionka z okna była za duża i musiało zadziałać zabezpieczenie
// fit-text.js (--c2-fit). Wypisuje czcionkę bazową; zrzuty w out/control-fit/.
//   node scripts/screens/check-control-fit.cjs
//   zmienne: VP=1280x720,... LANGS=pl,uk QLEN=100 SCREENS=finale2:f_p2_entry,... TEAM=40
const path = require("node:path");
const fs = require("node:fs");
const repo = path.resolve(__dirname, "../..");
const { startServer, stopServer, launch, newContext } = require("./lib.cjs");
const { buildDb, IDS } = require("./data/demo.cjs");

const OUT = path.join(__dirname, "out/control-fit");
const QLEN = Number(process.env.QLEN || 100);
const TEXT = {
  pl: "Wymień rzecz, którą najczęściej zabierasz ze sobą na długi rodzinny wyjazd nad morze, kiedy pakujesz się w ostatniej chwili i boisz się, że czegoś zapomnisz, a samochód jest już prawie pełny po dach!! ",
  uk: "Назви річ, яку ти найчастіше береш із собою в довгу сімейну поїздку на море, коли пакуєшся в останню хвилину й боїшся щось забути, а машина вже майже повна аж до самого даху!! ",
};
const ANSWERS = {
  pl: ["Krem z filtrem 50", "Ręcznik plażowy X", "Okulary słoneczne", "Ładowarka do tel.", "Kapelusz i czapka", "Dmuchany materac."],
  uk: ["Крем від сонця 50", "Пляжний рушник XL", "Сонцезахисні окул", "Зарядка до телефо", "Капелюх і кепка X", "Надувний матрац X"],
};
const VIEWPORTS = (process.env.VP || "980x600,1024x768,1280x720,1280x800,1280x1024,1366x768,1440x900,1536x864,1600x900,1680x1050,1920x1080,1920x1200,2560x1080,2560x1440,3840x2160,1080x1350").split(",").map((v) => v.split("x").map(Number));
const LANGS = (process.env.LANGS || "pl,uk").split(",");
const SCREENS = (process.env.SCREENS || "round:r_play,round:r_duel,finale:f_p1_entry,finale2:f_p2_entry,finale:f_p1_map_q1,finale2:f_p2_map_q2").split(",").map((s) => s.split(":"));
const TEAM = Number(process.env.TEAM || 0);

const question = (lang) => { let s = TEXT[lang]; while (s.length < QLEN) s += s; return s.slice(0, QLEN).trim(); };

function gameState(buildGameState, lang, kind, step) {
  const row = buildGameState(lang, kind);
  const d = row.detail;
  const answers = ANSWERS[lang];
  d.rounds.question.text = question(lang);
  d.rounds.answers.forEach((a, i) => { a.text = answers[i]; });
  d.final.questions.forEach((q, qi) => {
    q.text = question(lang);
    q.answers = answers.map((text, i) => ({ id: `fa${qi}${i}`, text, fixed_points: 30 - i * 5 }));
  });
  if (Array.isArray(d.final.runtime.p1)) d.final.runtime.p1 = d.final.runtime.p1.map((p, i) => (p ? { ...p, text: answers[i] } : p));
  if (TEAM) {
    const name = (seed) => { let s = process.env.TEAMW ? seed[0].repeat(TEAM) : seed; while (s.length < TEAM) s += ` ${seed}`; return s.slice(0, TEAM); };
    d.teams = { teamA: name("Wesołe Króliczki z Wąchocka"), teamB: name("Mądre Żyrafy Moniki") };
  }
  if (/map/.test(step)) {
    const blank = () => ({ kind: null, matchId: null, revealedAnswer: false, revealedPoints: false });
    d.final.runtime.map1 = d.final.questions.map((_, i) => ({ ...blank(), ...(d.final.runtime.map1?.[i] || {}) }));
    d.final.runtime.map2 = d.final.questions.map(blank);
    if (!d.final.runtime.p2?.length) d.final.runtime.p2 = d.final.questions.map(() => ({ text: "" }));
  }
  row.step = step;
  return row;
}

function inspect() {
  const card = document.querySelector(".c2-gameplay-card");
  const problems = [];
  const fit = card.style.getPropertyValue("--c2-fit");
  if (fit) problems.push(`zabezpieczenie --c2-fit=${Number(fit).toFixed(2)}`);
  const cr = card.getBoundingClientRect();
  for (const el of card.querySelectorAll("*")) {
    if (!el.offsetParent || /INPUT|TEXTAREA|svg|path/i.test(el.tagName)) continue;
    const st = getComputedStyle(el);
    if ((st.overflowX !== "visible" || st.overflowY !== "visible") && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)) problems.push(`ucięte: ${el.className || el.tagName}`);
    const b = el.getBoundingClientRect();
    if (b.width && (b.bottom > cr.bottom + 1 || b.right > cr.right + 1 || b.left < cr.left - 1 || b.top < cr.top - 1)) problems.push(`poza kartą: ${el.className || el.tagName}`);
  }
  const doc = document.documentElement;
  if (doc.scrollHeight > innerHeight + 1 || doc.scrollWidth > innerWidth + 1) problems.push("przewijanie strony");
  return { base: parseFloat(getComputedStyle(card).fontSize), problems: [...new Set(problems)] };
}

(async () => {
  const { buildGameState } = await import(path.join(repo, "scripts/screens/data/game-state.mjs"));
  fs.mkdirSync(OUT, { recursive: true });
  const origin = await startServer();
  const browser = await launch();
  const jobs = [];
  for (const [w, h] of VIEWPORTS) for (const lang of LANGS) for (const [kind, step] of SCREENS) jobs.push({ w, h, lang, kind, step });
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      const db = buildDb(job.lang, { gameState: gameState(buildGameState, job.lang, job.kind, job.step) });
      const context = await newContext(browser, db, job.lang, { width: job.w, height: job.h, scale: 1, mobile: false });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`${origin}/control/?id=${IDS.game}&lang=${job.lang}`, { waitUntil: "domcontentloaded" });
      let r;
      try {
        await page.waitForSelector(".c2-gameplay-card", { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        r = await page.evaluate(inspect);
      } catch { r = { base: null, problems: ["brak ekranu rozgrywki (okno poniżej minimum Control?)"] }; }
      if (errors.length) r.problems.push(`błąd JS: ${errors[0].slice(0, 120)}`);
      await page.screenshot({ path: path.join(OUT, `${job.step}-${job.lang}-${job.w}x${job.h}.png`) });
      results.push({ ...job, ...r });
      await context.close();
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await browser.close();
  stopServer();

  let bad = 0;
  for (const [w, h] of VIEWPORTS) {
    const rs = results.filter((r) => r.w === w && r.h === h);
    const issues = rs.filter((r) => r.problems.length);
    bad += issues.length;
    const base = rs.find((r) => r.base)?.base;
    console.log(`${`${w}×${h}`.padEnd(10)} czcionka ${base ? `${base.toFixed(1)} px` : "-"}  ${issues.length ? issues.map((r) => `${r.step}/${r.lang}: ${r.problems.slice(0, 2).join("; ")}`).join(" | ") : "ok"}`);
  }
  console.log(bad ? `\n${bad} przypadków z problemem (pytania ${QLEN} znaków)` : `\nwszystko się mieści bez zabezpieczenia (pytania ${QLEN} znaków)`);
  if (bad) process.exitCode = 1;
})().catch((e) => { console.error(e); process.exit(1); });
