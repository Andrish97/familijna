// Seria zrzutów obszaru „play”: Control (wszystkie kroki gry i okna),
// Wyświetlacz/Prowadzący (tryb podglądu ?preview=1), Przycisk (prawdziwy tryb
// urządzenia z kluczem), /connect/, /connect/tv/ i Ustawienia gry.
// Stany gry: wiersz game_state z data/game-state.mjs zmieniany w `db` sceny
// (Control czyta go przez game_state_get) albo wysyłany do podglądu urządzenia.
// Control i Ustawienia gry są niedostępne na telefonie: tylko komputer (+ tablet).
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { IDS } = require("../data/demo.cjs");
const panel = require("../data/panel.cjs");

const GAME_STATE = pathToFileURL(path.join(__dirname, "../data/game-state.mjs")).href;
const CAT = "play";
const page = (dir) => [`web/${dir}/index.html`, `web/${dir}/js/`, `web/${dir}/css/`];
const CONTROL = [...page("control"), "web/shared/js/gameplay/"];
const DISPLAY = ["web/control/display/", "web/shared/js/gameplay/", "web/shared/fonts/"];
const HOST = ["web/control/host/", "web/shared/js/gameplay/"];
const BUZZER = ["web/control/buzzer/", "web/shared/js/core/device-lease.js", "web/shared/js/core/game-state-subscribe.js"];
const CONNECT = page("connect");
const TV = ["web/connect/tv/"];
const SETTINGS = [...page("games/settings"), "web/shared/css/game-settings.css"];
const CONTROL_URL = `/control/?id=${IDS.game}`;
const SETTINGS_URL = `/games/settings/?id=${IDS.game}`;
const DESKTOP = ["desktop"];
const DESKTOP_TABLET = ["desktop", "tablet"];
// Ustawienia gry: telefon, tablet i komputer (od 2026-10-21 także telefon).
const SETTINGS_DEVICES = ["desktop", "tablet", "phone"];

// ---------- dane gry ----------
// Pięć pytań finału z pełną listą odpowiedzi (mapowanie, Prowadzący): pytania 2–6 gry.
function finalQuestions(lang) {
  return panel[lang].gameQuestions.slice(1, 6).map(([text, answers], i) => ({
    id: `f${i + 1}`, text,
    answers: answers.map(([a, pts], j) => ({ id: `f${i + 1}a${j + 1}`, text: a, fixed_points: pts })),
  }));
}
const emptyMap = () => ({ mode: "AUTO", kind: null, matchId: null, outText: "", pts: 0, revealedAnswer: false, revealedPoints: false, locked: false, repeat: false, _addedToSum: false });
const match = (q, j, extra = {}) => ({ ...emptyMap(), mode: "AUTO", kind: "MATCH", matchId: q.answers[j].id, outText: q.answers[j].text, pts: q.answers[j].fixed_points, ...extra });
const miss = (extra = {}) => ({ ...emptyMap(), mode: "MANUAL", kind: "MISS", ...extra });
const done = { revealedAnswer: true, revealedPoints: true, _addedToSum: true };
// Finał: wpisy dłuższe niż 11 miejsc Wyświetlacza i ze znakiem spoza jego fontu
// (Control oznacza litery do obcięcia i znaki pomijane).
const LONG_TYPED = { pl: "Kawa z mlekiem", en: "Tea with milk", uk: "Кава з молоком" };
const BAD_TYPED = { pl: "Kawa 😀 z mlekiem", en: "Tea 😀 with milk", uk: "Кава 😀 з молоком" };

// Wspólne przekształcenia stanu (detail z PERSISTED_KEYS + pola wiersza).
// Uwaga: game-state.mjs dla „round” ustawia display.previewNumbers itp. --
// te pola są tylko dla trybu podglądu, Control ich nie używa.
const S = {
  // Pojedynek przed przyjęciem zgłoszenia: drużyna A nacisnęła pierwsza.
  duel(row, d, { pressed = "A", physical = false } = {}) {
    row.step = "r_duel"; row.phase = "DUEL"; row.control_team = null;
    d.rounds.revealed = []; d.rounds.bankPts = 0; d.rounds.xA = 0; d.rounds.xB = 0;
    d.rounds.duel = { enabled: true, lastPressed: physical ? null : pressed, firstTeam: null, secondTeam: null, currentTeam: null, missSeq: 0, lastMissTeam: null };
    d.settings.physicalBuzzer = physical;
    d.host.covered = true;
  },
  // Rozgrywka: kontrola B, odsłonięte 1 i 2, jedna pomyłka („Oddaj kontrolę” już niedostępne).
  play(row, d) {
    row.step = "r_play"; row.phase = "PLAY"; row.control_team = "B";
    d.rounds.roundNo = 2; d.rounds.totals = { A: 62, B: 48 };
    d.rounds.revealed = [1, 2]; d.rounds.xA = 0; d.rounds.xB = 1;
    d.rounds.bankPts = d.rounds.answers[0].fixed_points + d.rounds.answers[1].fixed_points;
    d.rounds.allowPass = false; d.rounds.passUsed = false;
    d.rounds.duel = { enabled: true, lastPressed: "B", firstTeam: "B", secondTeam: "A", currentTeam: "B", missSeq: 0, lastMissTeam: null };
    d.host.covered = false;
  },
  // Zaraz po wygranym pojedynku: odsłonięta tylko odpowiedź z pojedynku, „Oddaj kontrolę” dostępne.
  pass(row, d) {
    S.play(row, d);
    d.rounds.revealed = [1]; d.rounds.xB = 0;
    d.rounds.bankPts = d.rounds.answers[0].fixed_points;
    d.rounds.allowPass = true;
  },
  // Przejęcie: B ma trzy pomyłki, A odpowiada raz.
  steal(row, d) {
    S.play(row, d);
    row.phase = "STEAL"; row.control_team = "A";
    d.rounds.xB = 3; d.rounds.revealed = [1, 2, 4];
    d.rounds.bankPts = [0, 1, 3].reduce((s, i) => s + d.rounds.answers[i].fixed_points, 0);
    d.rounds.allowPass = false;
    d.rounds.steal = { active: true, used: false, team: "A", won: null };
  },
  // Koniec rundy po nieudanym przejęciu: duży X drużyny A, „Zakończ rundę”.
  stealLost(row, d) {
    S.steal(row, d);
    d.rounds.steal = { active: false, used: true, team: "A", won: false };
    d.rounds.canEndRound = true;
    // Są jeszcze pytania -- runda kończy się przyciskiem „Zakończ rundę”, nie końcem gry.
    d.rounds._questionPool = [{ id: "next-round" }];
  },
  // Odkrywanie reszty odpowiedzi po rundzie (REVEAL), dalej finał.
  reveal(row, d) {
    S.stealLost(row, d);
    row.phase = "REVEAL"; row.control_team = null;
    d.rounds.canEndRound = false;
    d.rounds.revealed = [1, 2, 4, 3];
    d.rounds.totals = { A: 312, B: 187 };
    d.rounds.roundNo = 5;
    d.rounds.roundEndDestination = "FINAL";
  },
  finale(row, d, lang) {
    d.final.questions = finalQuestions(lang);
    d.final.picked = d.final.questions.map((q) => q.id);
    d.final.runtime.p1 = panel[lang].finale.map(([, answer], i) => ({ text: i === 3 ? "" : d.final.questions[i].answers[i % 2].text }));
    d.final.runtime.p1[4] = { text: panel[lang].finale[4][1] };
  },
  // Odpowiedzi gracza 1 rozstrzygnięte i odsłonięte (suma 112).
  finaleP1Done(row, d, lang) {
    S.finale(row, d, lang);
    const q = d.final.questions;
    d.final.runtime.map1 = [match(q[0], 0, done), match(q[1], 1, done), match(q[2], 0, done), miss({ ...done, kind: "SKIP" }), miss(done)];
    d.final.runtime.map1[3].outText = ""; d.final.runtime.map1[4].outText = d.final.runtime.p1[4].text;
    d.final.runtime.sum = [0, 1, 2].reduce((s, i) => s + d.final.runtime.map1[i].pts, 0);
    d.final.runtime.timer = { running: false, phase: null, endsAt: 0, usedP1: true, usedP2: false };
  },
  // Gracz 2: wpisane odpowiedzi, pytanie 3 -- powtórzenie.
  finaleP2(row, d, lang) {
    S.finaleP1Done(row, d, lang);
    const q = d.final.questions;
    d.final.runtime.p2 = [{ text: q[0].answers[1].text }, { text: q[1].answers[0].text }, { text: "", repeat: true }, { text: q[3].answers[2].text }, { text: "" }];
    d.final.runtime.timer = { running: false, phase: null, endsAt: 0, usedP1: true, usedP2: true };
  },
  // Gracz 2 odsłonił wszystko -- suma powyżej celu 200.
  finaleP2Done(row, d, lang) {
    S.finaleP2(row, d, lang);
    const q = d.final.questions;
    d.final.runtime.map2 = [match(q[0], 1, done), match(q[1], 0, done), { ...emptyMap(), mode: "MANUAL", kind: "SKIP", repeat: true, ...done }, match(q[3], 2, done), { ...emptyMap(), mode: "MANUAL", kind: "SKIP", ...done }];
    d.final.runtime.sum += [0, 1, 3].reduce((s, i) => s + d.final.runtime.map2[i].pts, 0);
    d.final.runtime.reached200 = d.final.runtime.sum >= 200;
  },
};
const T = (row) => row.detail;
// db sceny Control: zmiana wiersza game_state, który Control odtwarza.
const state = (fn) => (db, lang) => {
  const row = db.tables.game_state[0];
  fn(row, T(row), lang, db);
  row.detail.locks.gameStarted = row.step !== "devices_display" && row.step !== "setup_finish";
  if (row.step.startsWith("f_")) { row.top_card = "final"; row.detail.locks.finalActive = true; } else if (row.step.startsWith("r_")) { row.top_card = "rounds"; row.detail.locks.finalActive = false; }
};

// Podgląd urządzenia (?preview=1): wiersz stanu wysłany jak przez Control.
// Liczby małych wyświetlaczy (lewy/górny/prawy) podajemy jak tryb podglądu
// (bez nich pokazuje przykładowe 789/456/123).
function previewStep(kind, fn, { frame = false, numbers, settle = 1500 } = {}) {
  return async (view, { lang, page }) => {
    const { buildGameState } = await import(GAME_STATE);
    const row = buildGameState(lang, kind);
    const d = row.detail;
    if (fn) fn(row, d, lang);
    row.rev = 7;
    d.display = { ...d.display, suppressLogoDraw: true, previewXPositions: undefined };
    if (numbers) d.display.previewNumbers = numbers(row, d);
    else delete d.display.previewNumbers;
    await view.evaluate(() => document.fonts?.ready);
    await page.waitForTimeout(1200);
    if (frame) await page.evaluate((r) => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row: r }, location.origin), row);
    else await page.evaluate((r) => window.postMessage({ type: "familijna:preview-row", row: r }, "*"), row);
    await page.waitForTimeout(settle);
  };
}
const pad = (n) => String(n ?? 0).padStart(3, "0");
const docReady = () => document.readyState === "complete";

// Klik w kafel Control i odczekanie na przerysowanie.
const click = (selector, wait = 400) => async (view) => { await view.locator(selector).first().click(); await view.waitForTimeout(wait); };
const waitModal = (selector) => async (view) => { await view.locator(`${selector}:visible`).first().waitFor({ state: "visible", timeout: 8000 }); await view.waitForTimeout(400); };

// ---------- Przycisk (prawdziwy tryb urządzenia) ----------
const buzzerDb = (fn) => (db, lang) => {
  db.user = null;
  Object.assign(db.rpc, {
    control_device_instance_register: { mode: "lease", state: "primary", epoch: 1, game_rev: 1, waiting_count: 0 },
    control_device_instance_heartbeat: { mode: "lease", state: "primary", epoch: 1, game_rev: 1, waiting_count: 0 },
    control_device_instance_release: true,
    control2_device_log: 1,
    game_state_display_is_ready: true,
  });
  if (fn) state(fn)(db, lang);
};
// Funkcja brzegowa device-realtime-token (token kanału na żywo) nie jest
// danymi atrapy: bez tokenu Przycisk sam przechodzi na transport awaryjny
// (odczyty game_state_get), więc ten wpis nie oznacza brakujących danych.
const dropRealtimeTokenMiss = async (view) => {
  await view.waitForFunction(() => (window.__SCREENS_MISSES__ || []).includes("function:device-realtime-token"), null, { timeout: 4000 }).catch(() => {});
  await view.evaluate(() => { const m = window.__SCREENS_MISSES__ || []; const i = m.indexOf("function:device-realtime-token"); if (i >= 0) m.splice(i, 1); });
};
const BUZZER_URL = `/control/buzzer/?id=${IDS.game}&key=bzr100KEY`;
const BUZZER_DEVICES = ["phone-landscape", "tablet"];

// ---------- Ustawienia gry ----------
function settingsDb({ finalPick = 0, roundsPick = false, hasFinal = true, endMode = "money", inProgress = false } = {}) {
  return (db, lang) => {
    const game = db.tables.games.find((g) => g.id === IDS.game);
    const qs = db.tables.questions.filter((q) => q.game_id === IDS.game).sort((a, b) => a.ord - b.ord).map((q) => ({ id: q.id, ord: q.ord, text: q.text }));
    const picked = qs.slice(5, 5 + finalPick);
    game.settings = {
      ...game.settings,
      teams: { teamA: panel[lang].teams[0], teamB: panel[lang].teams[1] },
      game: { hasFinal, finalQuestionsMode: finalPick ? "pick" : "random", roundsQuestionsMode: roundsPick ? "pick" : "random", advanced: { roundMultipliers: [1, 1, 1, 2, 3], finalMinPoints: 300, finalTarget: 200, endScreenMode: endMode, finalPrizeMultiplier: 3, mainPrizeAmount: 25000 } },
      questions: { final: picked, rounds: roundsPick ? [...qs.filter((q) => !picked.includes(q)).reverse()] : [] },
    };
    if (inProgress) db.rpc.control_game_settings_status = { ok: true, in_progress: true, expires_at: new Date(Date.now() + 14 * 60e3 + 32e3).toISOString() };
  };
}
// Na tablecie i telefonie sekcje są w wysuwanym panelu (przycisk z menu na pasku akcji).
const cat = (name) => async (view) => {
  const toggle = view.locator("#gsSidebarToggle");
  if (await toggle.isVisible()) { await toggle.click(); await view.waitForTimeout(300); }
  await click(`.gs-sidebar-item[data-cat="${name}"]`, 500)(view);
};

module.exports = [
  // ======================= Control: urządzenia =======================
  { id: "play-control-devices-mixed", category: CAT, title: "Control — urządzenia: Wyświetlacz połączony, Prowadzący rozłączony, Przycisk fizyczny, udostępnienia", path: CONTROL_URL, sources: CONTROL, gameState: "devices", ready: ".device-row", devices: DESKTOP, settle: 1200,
    db: (db, lang) => {
      state((row, d) => { d.settings.physicalBuzzer = true; })(db, lang);
      const dev = (online, extra = {}) => ({ primary_online: online, waiting_count: 0, visibility: online ? "visible" : "hidden", focused: online, audio_unlocked: online, meta: {}, last_seen_at: new Date(Date.now() - (online ? 0 : 95e3)).toISOString(), ...extra });
      db.rpc.control_devices_snapshot = { ok: true, devices: { display: dev(true), host: dev(false), buzzer: dev(false) } };
      db.rpc.control_device_shares_list = "fn:(args) => args.p_device_type === 'host' ? [{ share_id: 's1', recipient_kind: 'friend', recipient_id: 'u1', recipient_username: 'aleksandra_nowak' }, { share_id: 's2', recipient_kind: 'mail', recipient_email: 'ola@example.test' }] : args.p_device_type === 'display' ? [{ share_id: 's3', recipient_kind: 'account', recipient_username: 'jan_kowalski' }] : []";
    } },
  { id: "play-control-devices-sound-display", category: CAT, title: "Control — urządzenia: dźwięk z Wyświetlacza, bez tabletu Prowadzącego", path: CONTROL_URL, sources: CONTROL, gameState: "devices", ready: ".device-row", devices: DESKTOP, settle: 1200,
    db: state((row, d) => { d.settings.soundSource = "display"; d.settings.noHostTablet = true; }) },
  { id: "play-control-qr-modal", category: CAT, title: "Control — okno kodu QR Prowadzącego (kropka na górnym pasku)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 800,
    steps: [click("#dotHostRow"), waitModal("#qrModalOverlay:not(.hidden)")] },
  { id: "play-control-share-device-list", category: CAT, title: "Control — okno udostępniania Prowadzącego z aktywnymi udostępnieniami", path: CONTROL_URL, sources: [...CONTROL, "web/shared/js/core/share-sections.js"], gameState: "devices", ready: ".device-row", devices: DESKTOP, settle: 800,
    db: (db) => {
      db.rpc.control_device_shares_list = "fn:(args) => args.p_device_type === 'host' ? [{ share_id: 's1', recipient_kind: 'friend', recipient_id: '" + "00000000-0000-4000-8810-000000000001" + "', recipient_username: 'aleksandra_nowak' }, { share_id: 's2', recipient_kind: 'mail', recipient_email: 'ola@example.test', cooldown_until: new Date(Date.now() + 3 * 3600e3).toISOString() }] : []";
    },
    steps: [click('.device-row[data-device="host"] button:has(.badge)', 200), waitModal("#shareDeviceOverlay")] },

  // ======================= Control: start i rundy =======================
  { id: "play-control-intro", category: CAT, title: "Control — rozpoczęcie gry (intro)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d) => { row.step = "r_intro"; row.phase = null; row.control_team = null; d.rounds.revealed = []; d.rounds.bankPts = 0; d.rounds.xB = 0; d.rounds.question = null; }) },
  { id: "play-control-round-start", category: CAT, title: "Control — start rundy 3 z wynikiem drużyn", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d) => { row.step = "r_roundStart"; row.phase = "READY"; row.control_team = null; d.rounds.roundNo = 3; d.rounds.totals = { A: 124, B: 87 }; d.rounds.revealed = []; d.rounds.bankPts = 0; d.rounds.xB = 0; }) },
  { id: "play-control-duel", category: CAT, title: "Control — pojedynek: Przycisk wskazał drużynę, zatwierdzenie i ponowienie", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 1000,
    db: state((row, d) => S.duel(row, d)) },
  { id: "play-control-duel-armed", category: CAT, title: "Control — pojedynek: zaznaczone „Zatwierdź” (drugi klik potwierdza)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 600,
    db: state((row, d) => S.duel(row, d)),
    steps: [async (view) => { await view.waitForTimeout(800); await view.locator(".c2-tile", { hasText: panel.pl.teams[0] }).count(); await view.locator(".c2-tile").nth(2).click(); await view.waitForTimeout(400); }] },
  { id: "play-control-duel-physical", category: CAT, title: "Control — pojedynek z przyciskiem fizycznym (operator wskazuje drużynę)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 1000,
    db: state((row, d) => S.duel(row, d, { physical: true })) },
  { id: "play-control-play-pass", category: CAT, title: "Control — rozgrywka zaraz po pojedynku: „Oddaj kontrolę”, zaznaczona odpowiedź", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 600,
    db: state((row, d) => S.pass(row, d)),
    steps: [async (view) => { await view.waitForTimeout(800); await view.locator(".c2-tile:not(.c2-tile-revealed):not([disabled])").first().click(); await view.waitForTimeout(400); }] },
  { id: "play-control-timer3", category: CAT, title: "Control — rozgrywka: odliczanie 3 s i trzy błędy", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 600,
    db: state((row, d) => { S.play(row, d); d.rounds.xB = 2; d.rounds.allowPass = false; d.rounds.timer3 = { running: true, endsAt: Date.now() + 4e3, resolved: null }; }) },
  { id: "play-control-steal", category: CAT, title: "Control — przejęcie (kradzież) przez drużynę przeciwną", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 1000,
    db: state((row, d) => S.steal(row, d)) },
  { id: "play-control-round-end", category: CAT, title: "Control — koniec rundy po nieudanym przejęciu („Zakończ rundę”)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-statusbar", devices: DESKTOP, settle: 1000,
    db: state((row, d) => S.stealLost(row, d)) },
  { id: "play-control-reveal", category: CAT, title: "Control — odkrywanie pozostałych odpowiedzi, przejście do finału", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-statusbar", devices: DESKTOP, settle: 1000,
    db: state((row, d) => S.reveal(row, d)) },

  // ======================= Control: finał =======================
  { id: "play-control-final-start", category: CAT, title: "Control — rozpoczęcie finału", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d, lang) => { S.finale(row, d, lang); row.step = "f_start"; d.final.runtime.p1 = [null, null, null, null, null]; d.final.runtime.timer = { running: false, phase: null, endsAt: 0, usedP1: false, usedP2: false }; }) },
  { id: "play-control-final-p1-timer", category: CAT, title: "Control — finał, gracz 1: wpisywanie w trakcie odliczania 15 s", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-entryrow", devices: DESKTOP, settle: 800,
    db: state((row, d, lang) => { S.finale(row, d, lang); d.final.runtime.p1[3] = { text: LONG_TYPED[lang] }; d.final.runtime.p1[4] = { text: "" }; d.final.runtime.timer = { running: true, phase: "P1", endsAt: Date.now() + 60e3, usedP1: true, usedP2: false }; }) },
  { id: "play-control-final-p1-map", category: CAT, title: "Control — finał, gracz 1: dopasowanie odpowiedzi 3 (odsłonięta odpowiedź, punkty do odsłonięcia)", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-mapinput", devices: DESKTOP, settle: 800,
    db: state((row, d, lang) => {
      S.finaleP1Done(row, d, lang);
      row.step = "f_p1_map_q3";
      const m = d.final.runtime.map1;
      m[2] = { ...m[2], revealedPoints: false, _addedToSum: false }; m[3] = emptyMap(); m[4] = emptyMap();
      d.final.runtime.sum = m[0].pts + m[1].pts;
    }) },
  { id: "play-control-final-p1-map-miss", category: CAT, title: "Control — finał, gracz 1: odpowiedź spoza listy (brak dopasowania)", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-mapinput", devices: DESKTOP, settle: 800,
    db: state((row, d, lang) => {
      S.finaleP1Done(row, d, lang);
      row.step = "f_p1_map_q5";
      d.final.runtime.p1[4] = { text: BAD_TYPED[lang] };
      d.final.runtime.map1[4] = miss();
      d.final.runtime.sum = [0, 1, 2].reduce((s, i) => s + d.final.runtime.map1[i].pts, 0);
    }) },
  { id: "play-control-final-p2-start", category: CAT, title: "Control — finał: przejście do gracza 2 (próbka dźwięku powtórzenia)", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d, lang) => { S.finaleP1Done(row, d, lang); row.step = "f_p2_start"; }) },
  { id: "play-control-final-p2-repeat-map", category: CAT, title: "Control — finał, gracz 2: powtórzenie odpowiedzi przy dopasowaniu", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-mapinput", devices: DESKTOP, settle: 800,
    db: state((row, d, lang) => {
      S.finaleP2(row, d, lang);
      row.step = "f_p2_map_q3";
      const q = d.final.questions;
      d.final.runtime.map2 = [match(q[0], 1, done), match(q[1], 0, done), { ...emptyMap(), mode: "MANUAL", kind: "SKIP", repeat: true }, emptyMap(), emptyMap()];
      d.final.runtime.sum += q[0].answers[1].fixed_points + q[1].answers[0].fixed_points;
    }) },
  { id: "play-control-final-p2-timer", category: CAT, title: "Control — finał, gracz 2: wpisywanie w trakcie odliczania 20 s (powtórzenie w pytaniu 3)", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-entryrow", devices: DESKTOP, settle: 800,
    db: state((row, d, lang) => { S.finaleP2(row, d, lang); row.step = "f_p2_entry"; d.final.runtime.p2[3] = { text: "" }; d.final.runtime.timer = { running: true, phase: "P2", endsAt: Date.now() + 60e3, usedP1: true, usedP2: true }; }) },
  { id: "play-control-final-end", category: CAT, title: "Control — koniec finału przed odsłonięciem (suma finału)", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_end"; d.settings.endScreenMode = "money"; }) },
  // Cel finału osiągnięty przy ocenie gracza 2 -- dalsza ocena zablokowana, zostaje „Zakończ finał”.
  { id: "play-control-final-goal", category: CAT, title: "Control — cel finału osiągnięty: „Zakończ finał”", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-statusbar, .c2-intro, #app", devices: DESKTOP, settle: 1200,
    db: state((row, d, lang) => { S.finaleP2Done(row, d, lang); const m = d.final.runtime.map2[3]; m.pts += 20; d.final.runtime.sum += 20; d.final.runtime.reached200 = d.final.runtime.sum >= 200; row.step = "f_p2_map_q4"; }) },

  // ======================= Control: koniec gry =======================
  { id: "play-control-game-end-points", category: CAT, title: "Control — koniec gry bez finału, ekran końcowy: punkty", path: CONTROL_URL, sources: [...CONTROL, "web/shared/js/gameplay/endScreen.js"], gameState: "round", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d) => { S.reveal(row, d); row.step = "r_gameEnd"; row.phase = null; d.settings.hasFinal = false; d.settings.endScreenMode = "points"; }) },
  { id: "play-control-game-end-logo", category: CAT, title: "Control — koniec gry remisem, ekran końcowy: logo", path: CONTROL_URL, sources: [...CONTROL, "web/shared/js/gameplay/endScreen.js"], gameState: "round", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d) => { S.reveal(row, d); row.step = "r_gameEnd"; row.phase = null; d.settings.hasFinal = false; d.settings.endScreenMode = "points"; d.rounds.totals = { A: 245, B: 245 }; }) },
  { id: "play-control-game-ended", category: CAT, title: "Control — gra zakończona: wynik, „Zacznij od nowa” i „Wróć do moich gier”", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-intro", devices: DESKTOP, settle: 1000,
    db: state((row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_end"; d.settings.endScreenMode = "money"; d.locks.gameEnded = true; d.rounds.totals = { A: 312 + d.final.runtime.sum, B: 187 }; }) },

  // ======================= Control: okna =======================
  { id: "play-control-device-lost", category: CAT, title: "Control — okno „Utracono połączenie” (Wyświetlacz rozłączony w trakcie gry, gra wstrzymana)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 600,
    db: (db) => {
      // Pierwsze odczyty: wszystko połączone; potem znika Wyświetlacz (bez przejścia w tło).
      db.rpc.control_devices_snapshot = "fn:(args, db) => { db.__snapN = (db.__snapN || 0) + 1; const lost = db.__snapN > 3; const dev = (on) => ({ primary_online: on, waiting_count: 0, visibility: 'visible', focused: on, audio_unlocked: on, meta: {}, last_seen_at: new Date(Date.now() - (on ? 0 : 20e3)).toISOString() }); return { ok: true, devices: { display: dev(!lost), host: dev(true), buzzer: dev(true) } }; }";
    },
    steps: [waitModal("#deviceLostOverlay")] },
  // Decyzja 2026-10-29: uśpiony Prowadzący i Przycisk poza pojedynkiem nie
  // wstrzymują gry — ostrzeżenie nad podpowiedzią, bez okna.
  { id: "play-control-device-asleep", category: CAT, title: "Control — uśpiony Prowadzący i Przycisk: ostrzeżenie nad podpowiedzią, gra trwa", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-hint-warn", devices: DESKTOP, settle: 600,
    db: (db) => {
      db.rpc.control_devices_snapshot = "fn:(args, db) => { db.__snapN = (db.__snapN || 0) + 1; const lost = db.__snapN > 3; const dev = (on, hidden) => ({ primary_online: on, waiting_count: 0, visibility: hidden ? 'hidden' : 'visible', focused: on, audio_unlocked: true, meta: {}, last_seen_at: new Date(Date.now() - (on ? 0 : 20e3)).toISOString() }); return { ok: true, devices: { display: dev(true, false), host: dev(!lost, lost), buzzer: dev(!lost, lost) } }; }";
    } },
  // Decyzja 2026-11-14: Wyświetlacz bez kanału na żywo (tryb zapasowy, odczyt
  // z bazy co 2 s) — ostrzeżenie nad podpowiedzią, gra trwa.
  { id: "play-control-device-no-live", category: CAT, title: "Control — Wyświetlacz bez połączenia na żywo: ostrzeżenie (antywirus/VPN), gra trwa", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-hint-warn", devices: DESKTOP, settle: 600,
    db: (db) => {
      db.rpc.control_devices_snapshot = "fn:() => { const dev = (meta) => ({ primary_online: true, waiting_count: 0, visibility: 'visible', focused: true, audio_unlocked: true, meta, last_seen_at: new Date().toISOString() }); return { ok: true, devices: { display: dev({ realtime_live: false }), host: dev({}), buzzer: dev({}) } }; }";
    } },
  { id: "play-control-leave-confirm", category: CAT, title: "Control — okno „Gra w toku” przy wyjściu do Moich gier", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: ".c2-tile", devices: DESKTOP, settle: 600,
    steps: [async (view) => { await view.waitForTimeout(600); await view.locator("#btnBack").click(); }, waitModal(".uni-modal")] },
  { id: "play-control-restart-confirm", category: CAT, title: "Control — okno „Zacznij od nowa” na ekranie końca gry", path: CONTROL_URL, sources: CONTROL, gameState: "finale", ready: ".c2-intro", devices: DESKTOP, settle: 600,
    db: state((row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_end"; d.locks.gameEnded = true; d.rounds.totals = { A: 312 + d.final.runtime.sum, B: 187 }; }),
    steps: [async (view) => { await view.waitForTimeout(600); await view.locator(".c2-intro-btn").first().click(); }, waitModal(".uni-modal")] },
  { id: "play-control-phone", category: CAT, title: "Control na telefonie — niedostępne (za mały ekran)", path: CONTROL_URL, sources: CONTROL, gameState: "round", ready: () => !!document.querySelector("#pageGuard, .page-guard"), devices: ["phone"], settle: 600 },

  // ======================= Wyświetlacz (podgląd) =======================
  { id: "play-display-logo", category: CAT, title: "Wyświetlacz — logo gry na starcie (nazwy drużyn)", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => { row.step = "r_roundStart"; row.phase = "READY"; row.control_team = null; d.rounds.revealed = []; d.rounds.question = null; }, { frame: true, numbers: () => ({ left: "", right: "", top: "" }), settle: 6000 })] },
  { id: "play-display-duel", category: CAT, title: "Wyświetlacz — pojedynek: pusta plansza i lampka drużyny", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => { S.duel(row, d); d.rounds.duel.currentTeam = "A"; row.control_team = "A"; }, { frame: true, numbers: () => ({ left: "000", right: "000", top: "000" }) })] },
  { id: "play-display-steal", category: CAT, title: "Wyświetlacz — przejęcie: trzy X drużyny B, duży X drużyny A", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => S.stealLost(row, d), { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: pad(d.rounds.totals.B), top: pad(d.rounds.bankPts) }) })] },
  { id: "play-display-play", category: CAT, title: "Wyświetlacz — rozgrywka: odsłonięte odpowiedzi, pula i jeden X", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => S.play(row, d), { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: pad(d.rounds.totals.B), top: pad(d.rounds.bankPts) }) })] },
  { id: "play-display-final-p1", category: CAT, title: "Wyświetlacz — finał po graczu 1: odpowiedzi i suma", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP1Done(row, d, lang); row.step = "f_p1_map_q5"; }, { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: "", top: pad(d.final.runtime.sum) }) })] },
  { id: "play-display-final", category: CAT, title: "Wyświetlacz — plansza finału: odpowiedzi gracza 1 i 2", path: "/control/display/?preview=1", sources: DISPLAY, frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_p2_map_q5"; }, { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: "", top: pad(d.final.runtime.sum) }) })] },
  { id: "play-display-end-money", category: CAT, title: "Wyświetlacz — koniec gry: wygrana kwota", path: "/control/display/?preview=1", sources: [...DISPLAY, "web/shared/js/gameplay/endScreen.js"], frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_end"; d.settings.endScreenMode = "money"; d.locks.gameEnded = true; d.rounds.totals = { A: 312 + d.final.runtime.sum, B: 187 }; }, { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: "", top: pad(d.final.runtime.sum) }), settle: 6000 })] },
  { id: "play-display-end-points", category: CAT, title: "Wyświetlacz — koniec gry bez finału: punkty zwycięzców", path: "/control/display/?preview=1", sources: [...DISPLAY, "web/shared/js/gameplay/endScreen.js"], frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => { S.reveal(row, d); row.step = "r_gameEnd"; row.phase = null; d.settings.endScreenMode = "points"; d.locks.gameEnded = true; }, { frame: true, numbers: (row, d) => ({ left: pad(d.rounds.totals.A), right: pad(d.rounds.totals.B), top: "000" }), settle: 6000 })] },
  { id: "play-display-end-logo", category: CAT, title: "Wyświetlacz — koniec gry: logo (remis)", path: "/control/display/?preview=1", sources: [...DISPLAY, "web/shared/js/gameplay/endScreen.js"], frame: true, ready: docReady, settle: 3500, size: { width: 1600, height: 900 },
    steps: [previewStep("round", (row, d) => { S.reveal(row, d); row.step = "r_gameEnd"; row.phase = null; d.settings.endScreenMode = "points"; d.locks.gameEnded = true; d.rounds.totals = { A: 245, B: 245 }; }, { frame: true, numbers: () => ({ left: "245", right: "245", top: "000" }), settle: 6000 })] },

  // ======================= Prowadzący (podgląd) =======================
  { id: "play-host-duel", category: CAT, title: "Prowadzący — pojedynek: pytanie pod zasłoną", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("round", (row, d) => S.duel(row, d), { frame: true, settle: 1200 })] },
  { id: "play-host-play", category: CAT, title: "Prowadzący — rozgrywka: odsłonięta kartka, „Oddaj kontrolę”", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("round", (row, d) => S.play(row, d), { frame: true, settle: 1200 })] },
  { id: "play-host-steal", category: CAT, title: "Prowadzący — przejęcie", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "tablet-landscape"],
    steps: [previewStep("round", (row, d) => { S.steal(row, d); d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-final-p1", category: CAT, title: "Prowadzący — finał, gracz 1: odliczanie i stan wpisanych odpowiedzi", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("finale", (row, d, lang) => { S.finale(row, d, lang); d.final.runtime.p1[3] = { text: "" }; d.final.runtime.timer = { running: true, phase: "P1", endsAt: Date.now() + 11e3, usedP1: true, usedP2: false }; d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-final-p2-repeat", category: CAT, title: "Prowadzący — finał, gracz 2: powtórzenie odpowiedzi", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP2(row, d, lang); row.step = "f_p2_map_q3"; d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-final-map", category: CAT, title: "Prowadzący — finał, gracz 1: dopasowanie odpowiedzi do listy", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "tablet-landscape"],
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP1Done(row, d, lang); row.step = "f_p1_map_q2"; d.host.covered = false; }, { frame: true, settle: 1200 })] },

  { id: "play-host-duel-open", category: CAT, title: "Prowadzący — pojedynek: zasłona odsunięta (pytanie i odpowiedzi)", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("round", (row, d) => { S.duel(row, d); d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-reveal", category: CAT, title: "Prowadzący — odsłanianie pozostałych odpowiedzi po rundzie", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "tablet-landscape"],
    steps: [previewStep("round", (row, d) => { S.reveal(row, d); d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-final-p2", category: CAT, title: "Prowadzący — finał, gracz 2: odliczanie, powtórzenie i odpowiedzi gracza 1", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "phone-landscape", "tablet-landscape"],
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP2(row, d, lang); row.step = "f_p2_entry"; d.final.runtime.p2[3] = { text: "" }; d.final.runtime.timer = { running: true, phase: "P2", endsAt: Date.now() + 14e3, usedP1: true, usedP2: true }; d.host.covered = false; }, { frame: true, settle: 1200 })] },
  { id: "play-host-end", category: CAT, title: "Prowadzący — po zakończeniu gry (ekran wyczyszczony)", path: "/control/host/?preview=1", sources: HOST, frame: true, ready: docReady, devices: ["tablet", "tablet-landscape"],
    steps: [previewStep("finale", (row, d, lang) => { S.finaleP2Done(row, d, lang); row.step = "f_end"; d.locks.gameEnded = true; d.host.covered = false; }, { frame: true, settle: 1200 })] },

  // ======================= Przycisk (urządzenie z kluczem) =======================
  { id: "play-buzzer-off", category: CAT, title: "Przycisk — przed pojedynkiem (wyłączony)", path: BUZZER_URL, sources: BUZZER, gameState: "devices", ready: "#offScreen.skel-step-ready", devices: BUZZER_DEVICES,
    steps: [dropRealtimeTokenMiss], db: buzzerDb() },
  // Safari na iPhonie odmawia blokady wygaszania bez dotknięcia (wake-prompt.js).
  { id: "play-buzzer-wake", category: CAT, title: "Przycisk — iPhone: ekran „Nie wygaszaj ekranu”", path: BUZZER_URL, sources: [...BUZZER, "web/shared/js/core/wake-prompt.js"], gameState: "devices", ready: "#deviceWakeOverlay.is-open", devices: ["phone-landscape"],
    initScript: () => {
      Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
      Object.defineProperty(navigator, "wakeLock", { get: () => ({ request: () => Promise.reject(new DOMException("Wake Lock permission request denied", "NotAllowedError")) }) });
    },
    steps: [dropRealtimeTokenMiss], db: buzzerDb() },
  { id: "play-buzzer-on", category: CAT, title: "Przycisk — pojedynek: gotowy do naciśnięcia", path: BUZZER_URL, sources: BUZZER, gameState: "round", ready: "#arena.skel-step-ready", devices: BUZZER_DEVICES, settle: 800,
    steps: [dropRealtimeTokenMiss], db: buzzerDb((row, d) => { S.duel(row, d); d.rounds.duel.lastPressed = null; }) },
  { id: "play-buzzer-pushed", category: CAT, title: "Przycisk — drużyna A nacisnęła pierwsza", path: BUZZER_URL, sources: BUZZER, gameState: "round", ready: "#arena.skel-step-ready", devices: BUZZER_DEVICES, settle: 800,
    steps: [dropRealtimeTokenMiss], db: buzzerDb((row, d) => S.duel(row, d)) },
  { id: "play-buzzer-waiting", category: CAT, title: "Przycisk — drugie urządzenie w kolejce (czeka na zwolnienie)", path: BUZZER_URL, sources: BUZZER, gameState: "round", ready: "#deviceLeaseOverlay:not([hidden])", devices: ["phone-landscape"], settle: 600,
    steps: [dropRealtimeTokenMiss], db: (db, lang) => { buzzerDb((row, d) => S.duel(row, d))(db, lang); db.rpc.control_device_instance_register = { mode: "lease", state: "waiting", queue_position: 1, waiting_count: 1 }; db.rpc.control_device_instance_heartbeat = db.rpc.control_device_instance_register; } },
  { id: "play-buzzer-no-key", category: CAT, title: "Przycisk — link bez klucza (błąd wczytania)", path: "/control/buzzer/", sources: BUZZER, ready: "#deviceLoadError:not([hidden])", devices: ["phone-landscape"], guest: true },

  // ======================= /connect/ =======================
  { id: "play-connect-confirm", category: CAT, title: "Podłącz urządzenie — kod wpisany, okno potwierdzenia", path: "/connect/", sources: CONNECT, ready: ".games-shell.skel-step-ready",
    db: (db, lang) => { db.rpc.resolve_device_connect_code = { ok: true, device_type: "display", game_id: IDS.game, game_name: panel[lang].game, owner_username: panel[lang].friends.accepted[0][0], share_key: "dsp100KEY" }; },
    steps: [async (view) => { await view.locator("#connectCodeInput").fill("482193"); await view.locator("#btnConnectCode").click(); }, waitModal(".uni-modal")] },
  { id: "play-connect-bad-code", category: CAT, title: "Podłącz urządzenie — nieznany kod", path: "/connect/", sources: CONNECT, ready: ".games-shell.skel-step-ready",
    db: (db) => { db.rpc.resolve_device_connect_code = { ok: false, error: "not_found" }; },
    steps: [async (view) => { await view.locator("#connectCodeInput").fill("123456"); await view.locator("#btnConnectCode").click(); await view.waitForTimeout(500); }] },
  { id: "play-connect-empty", category: CAT, title: "Podłącz urządzenie — brak udostępnionych urządzeń", path: "/connect/", sources: CONNECT, ready: ".games-shell.skel-step-ready",
    db: (db) => { db.rpc.list_shared_devices_for_me = []; } },
  { id: "play-connect-guest", category: CAT, title: "Podłącz urządzenie — bez konta (tylko kod)", path: "/connect/", sources: CONNECT, ready: ".games-shell.skel-step-ready", guest: true },
  { id: "play-connect-share-focus", category: CAT, title: "Podłącz urządzenie — udostępnienie z Zadań wyróżnione (?share=)", path: "/connect/?share=00000000-0000-4000-9300-000000000002", sources: CONNECT, ready: ".connect-device-tile", devices: ["phone"] },

  // ======================= /connect/tv/ =======================
  { id: "play-connect-tv", category: CAT, title: "Podłącz telewizor — kod Wyświetlacza (przeglądarka TV)", path: "/connect/tv/", sources: TV, ready: docReady, devices: DESKTOP, guest: true, size: { width: 1920, height: 1080 },
    steps: [async (view, { page }) => {
      await page.context().addInitScript(() => Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/94.0 TV Safari/537.36" }));
      await view.reload({ waitUntil: "load" });
      await view.locator("main.skel-step-ready").waitFor({ timeout: 8000 });
      await view.waitForTimeout(400);
    }] },
  { id: "play-connect-tv-bad", category: CAT, title: "Podłącz telewizor — kod Prowadzącego (nie dla telewizora)", path: "/connect/tv/", sources: TV, ready: docReady, guest: true, size: { width: 1920, height: 1080 },
    db: (db) => { db.rpc.resolve_device_connect_code = { ok: true, device_type: "host", game_id: IDS.game, share_key: "hst100KEY" }; },
    steps: [async (view, { page }) => {
      await page.context().addInitScript(() => Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (Linux; Android 12; BRAVIA 4K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0 Safari/537.36" }));
      await view.reload({ waitUntil: "load" });
      await view.locator("main.skel-step-ready").waitFor({ timeout: 8000 });
      await view.locator("#tvCode").fill("482193");
      await view.locator("#tvConnect").click();
      await view.waitForTimeout(500);
    }] },
  { id: "play-connect-tv-only", category: CAT, title: "Podłącz telewizor — otwarte na komputerze (tylko telewizor)", path: "/connect/tv/", sources: TV, ready: docReady, guest: true, settle: 600 },

  // ======================= Ustawienia gry =======================
  { id: "play-settings-teams", category: CAT, title: "Ustawienia gry — Drużyny (nazwy z podglądem długości)", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: SETTINGS_DEVICES, settle: 800,
    db: settingsDb() },
  { id: "play-settings-questions", category: CAT, title: "Ustawienia gry — Pytania: finał ręcznie, rundy w ustalonej kolejności", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: SETTINGS_DEVICES, settle: 500,
    db: settingsDb({ finalPick: 5, roundsPick: true }), steps: [cat("questions")] },
  { id: "play-settings-questions-no-final", category: CAT, title: "Ustawienia gry — Pytania: bez finału (zakładki Finał i Rundy wyszarzone)", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: DESKTOP, settle: 500,
    db: settingsDb({ hasFinal: false }), steps: [cat("questions")] },
  { id: "play-settings-finale", category: CAT, title: "Ustawienia gry — Pytania — Finał: wybór pytań (3/5)", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: SETTINGS_DEVICES, settle: 500,
    db: settingsDb({ finalPick: 3 }), steps: [cat("finale")] },
  { id: "play-settings-finale-full", category: CAT, title: "Ustawienia gry — Pytania — Finał: komplet 5 pytań", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: DESKTOP, settle: 500,
    db: settingsDb({ finalPick: 5 }), steps: [cat("finale")] },
  { id: "play-settings-rounds", category: CAT, title: "Ustawienia gry — Pytania — Rundy: kolejność pytań", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: SETTINGS_DEVICES, settle: 500,
    db: settingsDb({ finalPick: 5, roundsPick: true }), steps: [cat("rounds")] },
  { id: "play-settings-game", category: CAT, title: "Ustawienia gry — Ustawienia gry: mnożniki, próg finału, ekran końcowy", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: SETTINGS_DEVICES, settle: 500,
    db: settingsDb({ endMode: "points" }), steps: [cat("game")] },
  { id: "play-settings-final-need5", category: CAT, title: "Ustawienia gry — okno: finał wymaga 5 pytań (zapis z 3)", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: DESKTOP, settle: 400,
    db: settingsDb({ finalPick: 2 }),
    steps: [cat("finale"), click("#gsFinalePool .qRow"), click("#btnSaveAll", 200), waitModal(".uni-modal")] },
  { id: "play-settings-unsaved", category: CAT, title: "Ustawienia gry — okno niezapisanych zmian przy wyjściu", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: DESKTOP, settle: 400,
    db: settingsDb(),
    steps: [async (view) => { await view.locator("#gsTeamA").fill(panel.pl.teams[0] + "!"); await view.waitForTimeout(300); await view.locator("#btnBack").click(); }, waitModal(".uni-modal")] },
  { id: "play-settings-reset-all", category: CAT, title: "Ustawienia gry — okno „Przywróć domyślne”", path: SETTINGS_URL, sources: SETTINGS, ready: "#gsTeamA", devices: DESKTOP, settle: 400,
    db: settingsDb(), steps: [click("#btnResetAll", 200), waitModal(".uni-modal")] },
  { id: "play-settings-ingame", category: CAT, title: "Ustawienia gry — okno „Gra w toku” (blokada trwającej rozgrywki)", path: SETTINGS_URL, sources: SETTINGS, ready: "#ingameGuard", devices: SETTINGS_DEVICES, settle: 600,
    db: settingsDb({ inProgress: true }) },
];
