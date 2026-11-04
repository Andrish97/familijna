import { t } from "../../../shared/translation/translation.js?v=v2026-11-04T23474";

// control/display/js/render.js
//
// Tłumaczy wiersz public.game_state (a dokładniej: różnicę między
// poprzednim a nowym wierszem, przez web/js/gameplay/deriveEvents.js) na wywołania
// control/display/js/scene.js's `api` — bez żadnego pośredniego formatu
// tekstowego (patrz plan, sekcja 5, "Konkretnie dla Display").
//
// Dwa tryby, dokładnie jak w planie:
// - renderSnapshot(row): pierwsze wejście/reconnect — maluje CAŁY bieżący
//   stan naraz, bez animacji (nie ma "poprzedniego" stanu do porównania).
// - renderDiff(prevRow, nextRow): każda kolejna zmiana na żywo — liczy
//   zdarzenia przez deriveEvents i dla każdego woła konkretny fragment
//   `api` z animacją, której CZAS TRWANIA liczy się na żywo z rzeczywistego
//   dźwięku (web/js/gameplay/transitionTiming.js), nie ze sztywnych stałych —
//   zgłoszone wprost: "Pozbądźmy się sztywnych zapisanych ram czasowych...
//   Animacja... zawsze = dźwięki". web/js/gameplay/displayAnim.js zostaje wyłącznie
//   jako STYL (typ wjazdu/wyjazdu: matrix/edge, kierunek), nie jako czas.
//
// UWAGA: to pierwszy przebieg tego mapowania — pokrywa główne, najczęściej
// używane ścieżki (start rundy, odsłonięcie odpowiedzi, X, kradzież, koniec
// rundy/gry, finał, tryb QR/czarny ekran, timer). Drobne niuanse
// wieloetapowej choreografii z dzisiejszego control/js/display.js (dokładne
// opóźnienia między krokami tej samej zmiany) wymagają dostrojenia
// wizualnego względem prawdziwego wyglądu — nie zgadywane tu na ślepo.

import { deriveEvents } from "../../../shared/js/gameplay/deriveEvents.js?v=v2026-11-04T23474";
import { resolveRoundsEndScreen, resolveFinalEndScreen, resolveEndScreenMode } from "../../../shared/js/gameplay/endScreen.js?v=v2026-11-04T23474";
import { createTransitionTiming } from "../../../shared/js/gameplay/transitionTiming.js?v=v2026-11-04T23474";

import { ANSWER_ANIM, LOGO_IN_ANIM } from "../../../shared/js/gameplay/displayAnim.js?v=v2026-11-04T23474";
import {
  ROUND_TEXT_MS, ROUND_POINTS_MS, ROUND_SUMA_MS, FINAL_TEXT_MS, FINAL_POINTS_MS,
  BOARD_TRANSITION, LOGO_IN_MS, DUEL_X_FLASH_MS,
} from "../../../shared/js/gameplay/displayTiming.js?v=v2026-11-04T23474";

function pad3(n) { return String(Math.max(0, Number(n) || 0)).padStart(3, " "); }

export function createRenderer({ scene, qr, getSfxDuration, onFinalResult }) {
  const timing = createTransitionTiming({ getSfxDuration });
  let generation = 0;
  let activeGeneration = 0;
  const waits = new Map();
  const abortError = () => Object.assign(new Error("Render cancelled"), { name: "AbortError" });
  function guardedApi(object) {
    return new Proxy(object, { get(target, name) {
      const value = target[name];
      if (typeof value === "function") return (...args) => {
        if (activeGeneration !== generation) throw abortError();
        return value.apply(target, args);
      };
      return value && typeof value === "object" ? guardedApi(value) : value;
    } });
  }
  const api = guardedApi(scene.api);
  function wait(ms) {
    if (activeGeneration !== generation) return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waits.delete(timer); resolve(); }, Math.max(0, ms));
      waits.set(timer, reject);
    });
  }
  function cancel() {
    generation++;
    stopTimerTick();
    scene.cancelAnimations?.();
    for (const [timer, reject] of waits) { clearTimeout(timer); reject(abortError()); }
    waits.clear();
  }
  let timerHandle = null;

  function stopTimerTick() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function startTimerTick(row) {
    stopTimerTick();
    const timer = row.detail?.final?.runtime?.timer;
    if (!timer?.running) return;
    const winnerTeam = row.detail?.final?.winnerTeam;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
      if (remaining <= 0) {
        // control/js/gameFinal.js's startTimerForPhase(): przy wygaśnięciu
        // NA ŻYWO stary Control jawnie kazał Displayowi "restoreTotalsTriplets()"
        // — wrócić do prawdziwych wyników drużyn zamiast zamrożonych zer.
        // Tu Display robi to SAM, z własnego zegara (endsAt to i tak
        // jedyne wiążące źródło — to nic nowego, ten sam sposób liczenia co
        // samo tykanie wyżej), zamiast czekać na komendę/nowy zapis stanu.
        // Bez tego: gdyby Control było zamknięte dokładnie w momencie
        // wygaśnięcia (zgłoszone: "jest timer na wyświetlaczu, który
        // zostanie przerwany"), Wyświetlacz zostawałby zamrożony na "00"
        // dla widzów, dopóki Control by nie wrócił i nie dopisał
        // EXPIRE_TIMER do game_state — game_state.detail.final.runtime.timer.running
        // może więc chwilowo mijać się z prawdą (nieaktualizowane, bo
        // Control nieobecny), ale to nie problem: to jest czysto lokalna
        // decyzja RENDEROWANIA z tego samego endsAt, nie nowe źródło
        // prawdy — kiedy Control faktycznie dopisze EXPIRE_TIMER, ten sam
        // paintTotals() i tak wykona się ponownie (TIMER_STOPPED), bez
        // różnicy w wyniku.
        stopTimerTick();
        paintTotals(row);
        return;
      }
      const digits = String(remaining).padStart(2, "0");
      if (winnerTeam === "A") api.small.rightDigits(digits); else api.small.leftDigits(digits);
    };
    tick();
    timerHandle = setInterval(tick, 250);
  }

  function paintTotals(row) {
    if (row.step === "r_intro" || (row.step === "r_roundStart" && !row.detail?.rounds?.question)) { api.small.leftDigits(""); api.small.rightDigits(""); return; }
    const totals = row.detail?.rounds?.totals || { A: 0, B: 0 };
    if (row.top_card === "final" && row.detail?.final?.winnerTeam && row.step !== "f_start") {
      const winner = row.detail.final.winnerTeam;
      api.small.leftDigits(winner === "A" ? String(totals.A ?? 0) : "");
      api.small.rightDigits(winner === "B" ? String(totals.B ?? 0) : "");
      return;
    }
    api.small.leftDigits(String(totals.A ?? 0));
    api.small.rightDigits(String(totals.B ?? 0));
  }

  // 3s zegarek decyzji w rundach (detail.rounds.timer3) celowo NIE zmienia
  // Wyświetlacza — małe potrójne wyświetlacze zawsze pokazują wyniki drużyn
  // (decyzja użytkownika 2026-10-20). Odliczanie widzi tylko Control.

  // control/js/gameFinal.js's startFinal()/startP2Round(): tuż po wejściu
  // w f_p1_entry/f_p2_entry (zanim operator w ogóle kliknie "start timera")
  // strona zwycięskiej drużyny dostaje "15"/"20" jako zapowiedź — TIMER_STARTED
  // dopiero potem zaczyna właściwe odliczanie tych samych cyfr w dół.
  function showTimerPlaceholder(row, text) {
    const winnerTeam = row.detail?.final?.winnerTeam;
    if (winnerTeam === "A") api.small.rightDigits(text);
    else if (winnerTeam === "B") api.small.leftDigits(text);
  }

  function applyIndicator(row) {
    if (row.control_team === "A") return api.indicator.set("ON_A");
    if (row.control_team === "B") return api.indicator.set("ON_B");
    // Zgłoszone (przy okazji audytu synchronizacji dźwięk/animacja): control_team
    // zostaje null przez CAŁY pojedynek (R2/R3) — ustawiane dopiero, gdy ktoś
    // go wygra — więc do tej pory wskaźnik w ogóle się nie zapalał, dopóki
    // pojedynek trwał, mimo że plan (sekcja 2a) wprost każe: "acceptBuzz →
    // INDICATOR ON_A/ON_B na drużynę, która ma teraz odpowiadać". To, kto ma
    // teraz próbować, żyje w detail.rounds.duel.currentTeam (osobne pole,
    // którego deriveEvents.js nie diffuje jako CONTROL_CHANGED) — stąd
    // dodatkowe wywołania applyIndicator() w STEP_CHANGE(r_duel->r_play)/
    // ANSWER_REVEALED/DUEL_MISS niżej, nie tylko przy CONTROL_CHANGED.
    if (row.phase === "DUEL") {
      const cur = row.detail?.rounds?.duel?.currentTeam;
      if (cur === "A") return api.indicator.set("ON_A");
      if (cur === "B") return api.indicator.set("ON_B");
    }
    if ((row.detail?.locks?.finalActive || row.step === "f_end") && row.detail?.final?.winnerTeam) {
      return api.indicator.set(row.detail.final.winnerTeam === "A" ? "ON_A" : "ON_B");
    }
    if (row.step === "r_gameEnd" || row.step === "f_start") {
      const totals = row.detail?.rounds?.totals || {};
      if (totals.A !== totals.B) return api.indicator.set(totals.A > totals.B ? "ON_A" : "ON_B");
    }
    api.indicator.set("OFF");
  }

  async function applyDisplayMode(row) {
    const mode = row.detail?.display?.mode || "BLACK";
    if (mode === "QR") {
      qr.show(row.detail.display.qr);
      return;
    }
    qr.hide();
    if (mode === "BLACK") {
      api.big.clear();
      api.small.clearAll();
      api.indicator.set("OFF");
      return;
    }
    if (row.step === "devices_display" || row.step === "setup_finish") {
      api.big.clear(); api.small.clearAll(); api.indicator.set("OFF"); return;
    }
    // mode === "GAME" — namaluj planszę odpowiednią dla bieżącego kroku.
    await paintForStep(row);
  }

  // control/js/display.js's PLACE.roundsText/roundsPts — sloty nieodkryte
  // pokazują placeholder (nie pustkę), żeby widzowie widzieli ILE jest
  // odpowiedzi do zgadnięcia, nie tylko te już odkryte.
  const ROUNDS_TEXT_PLACEHOLDER = "…".repeat(17);
  const ROUNDS_PTS_PLACEHOLDER = "——";

  async function paintRoundsBoard(row, { animIn, animOut, transition } = {}) {
    const r = row.detail.rounds;
    const answerCount = Math.max(1, Math.min(6, r.answers?.length || 6));
    const rows = Array.from({ length: 6 }, (_, i) => {
      const ord = i + 1;
      const ans = r.answers?.find((a) => a.ord === ord);
      const revealed = (r.revealed || []).includes(ord);
      if (revealed && ans) return { text: ans.text, pts: String(ans.fixed_points) };
      if (ord <= answerCount) return { text: ROUNDS_TEXT_PLACEHOLDER, pts: ROUNDS_PTS_PLACEHOLDER };
      return { text: "", pts: "" };
    });
    // await: animOut MUSI dobiec końca, zanim cokolwiek innego zacznie
    // rysować na tym samym płótnie ("big") — inaczej dwie animacje na raz
    // (np. logo wchodzące i stara plansza rund jeszcze schodząca) nakładają
    // się wizualnie (zgłoszone: "wszystko się nakłada jedno na drugie").
    await api.rounds.setAll({ rows, suma: String(r.bankPts ?? 0), animIn, animOut, transition });
    for (const key of ["1A", "2A", "3A", "4A", "1B", "2B", "3B", "4B"]) {
      const [n, side] = [key[0], key[1]];
      const count = side === "A" ? r.xA : r.xB;
      const isBigSlot = n === "4";
      const on = isBigSlot
        ? (side === (r.steal?.team) && r.steal?.used && r.steal?.won === false)
        : Number(n) <= (count || 0);
      api.rounds.setX(key, !!on);
    }
    api.small.topDigits(pad3(r.bankPts));
    paintTotals(row);
    applyIndicator(row);
  }

  // control/js/display.js's PLACE.finalText/finalPts — tak samo jak w
  // rundach, nieodkryte pola dostają placeholder, nie pustkę.
  const FINAL_TEXT_PLACEHOLDER = "—".repeat(11);
  const FINAL_PTS_PLACEHOLDER = "▒▒";

  async function paintFinalBoard(row, { animIn, transition } = {}) {
    const f = row.detail.final;
    const rows = Array.from({ length: 5 }, (_, i) => {
      const m1 = f.runtime.map1[i], m2 = f.runtime.map2[i];
      return {
        left: m1?.revealedAnswer ? m1.outText : FINAL_TEXT_PLACEHOLDER,
        a: m1?.revealedPoints ? String(m1.pts) : FINAL_PTS_PLACEHOLDER,
        b: m2?.revealedPoints ? String(m2.pts) : FINAL_PTS_PLACEHOLDER,
        right: m2?.revealedAnswer ? m2.outText : FINAL_TEXT_PLACEHOLDER,
      };
    });
    await api.final.setAll({ rows, animIn, transition });
    api.small.topDigits(pad3(f.runtime.sum));
    paintTotals(row);
    applyIndicator(row);
    startTimerTick(row);
    if (!f.runtime.timer?.running) paintTotals(row);
  }

  // Nazwy drużyn (LONG1/LONG2 w starym systemie) — dziś malowane wprost z
  // detail.teams, zamiast wysyłane raz przez stateGameReady(). Widoczne
  // przez całą właściwą rozgrywkę (rundy+finał), tak jak w oryginale.
  let lastTeamNames = null;
  let latestTeamNamesRow = null;
  function paintTeamNames(row, force = false) {
    // Starsza animacja z kolejki nie może przywrócić poprzednich nazw.
    const raw = (latestTeamNamesRow || row).detail?.teams || {};
    const teams = {
      teamA: raw.defaultA === true || !raw.teamA ? t("control.teamADefault") : raw.teamA,
      teamB: raw.defaultB === true || !raw.teamB ? t("control.teamBDefault") : raw.teamB,
    };
    if (force || lastTeamNames?.teamA !== teams.teamA) api.small.long1(teams.teamA || "");
    if (force || lastTeamNames?.teamB !== teams.teamB) api.small.long2(teams.teamB || "");
    lastTeamNames = { ...teams };
  }

  function updateTeamNames(row) {
    latestTeamNamesRow = row;
    if (row.detail?.display?.mode === "GAME"
      && !["devices_display", "setup_finish"].includes(row.step)) {
      paintTeamNames(row);
    }
  }

  async function paintForStep(row) {
    // r_intro MUSI być sprawdzone przed top_card==="rounds" — r_intro sam
    // ma top_card="rounds" (cała sekcja Rund, patrz plan, tabela A), więc
    // sprawdzenie w odwrotnej kolejności nigdy by tu nie trafiło (ten sam
    // bug: renderSnapshot()/reconnect W TRAKCIE r_intro malowałby pustą
    // planszę rund zamiast logo — renderDiff()'s STEP_CHANGE do "r_intro"
    // niżej to zawsze robił poprawnie, tylko pierwsze malowanie nie).
    // Nazwy drużyn są już wtedy znane (denormalizowane z game-settings
    // przed startem gry) — pokazujemy je na "small" razem z logo na "big",
    // to dwa niezależne płótna.
    if (row.step === "r_intro") { api.big.clear(); paintTeamNames(row); paintTotals(row); return; }
    if (row.step === "r_roundStart" && row.detail?.rounds?.roundNo === 1) {
      paintTeamNames(row);
      await api.logo.show();
      return;
    }
    if (row.top_card === "rounds" || row.step === "f_start") { paintTeamNames(row); await paintRoundsBoard(row); return; }
    if (row.top_card === "final") { paintTeamNames(row); await paintFinalBoard(row); return; }
    api.big.clear();
  }

  async function showEndScreen(row, { animate = true } = {}) {
    stopTimerTick();
    paintTeamNames(row);
    paintTotals(row);
    applyIndicator(row);
    api.small.topDigits(row.top_card === "final" ? pad3(row.detail.final.runtime.sum) : "000");
    if (row.top_card === "rounds") {
      // Końcowa plansza zmienia się od początku reveal i przejścia rundy.
      // Osobne outro gra dopiero po przejściu, nie opóźnia rysowania.
      const totals = row.detail.rounds.totals || { A: 0, B: 0 };
      const screen = resolveRoundsEndScreen(row.detail.settings, { isDraw: totals.A === totals.B, totals });
      const draw = () => { api.big.clear(); if (screen.kind === "logo") api.logo.draw(); else api.win.set(screen.amount); };
      if (animate) await api.big.replace(draw, BOARD_TRANSITION);
      else draw();
      return;
    }
    // Wynik odsłania się podczas reveal, kończącego się razem z muzyką finału.
    const split = animate ? await timing.revealSyncSplit("final_theme") : { offsetMs: 0, revealMs: 0 };
    if (split.offsetMs > 0) await wait(split.offsetMs);
    // Before outro, the final sum has not yet been added to round totals.
    // Reconnecting after outro must not add it a second time.
    paintTotals(row);
    const winnerTeam = row.detail.final.winnerTeam;
    const totals = row.detail.rounds.totals || { A: 0, B: 0 };
    const finalPoints = row.detail.final.runtime.sum || 0;
    const roundsPoints = (totals[winnerTeam] || 0) - (row.detail.locks.gameEnded ? finalPoints : 0);
    const hitTarget = !!row.detail.final.runtime.reached200;
    const screen = resolveFinalEndScreen(row.detail.settings, {
      roundsPoints,
      finalPoints,
      hitTarget,
    });
    const draw = () => { api.big.clear(); if (screen.kind === "logo") api.logo.draw(); else api.win.set(screen.amount); };
    if (animate) await api.big.replace(draw, BOARD_TRANSITION);
    else draw();
    if (screen.kind !== "logo") {
      if (resolveEndScreenMode(row.detail.settings) === "money") onFinalResult?.({
          amount: screen.amount,
          roundsPoints,
          finalPoints,
          multiplier: Number(row.detail.settings?.finalPrizeMultiplier ?? 3),
          mainPrize: Number(row.detail.settings?.mainPrizeAmount ?? 25000),
          hitTarget,
          stateRev: Number(row.rev) || 0,
          renderKind: animate ? "animated" : "snapshot",
        });
    }
  }

  // ============================================================
  // Pierwsze renderowanie / reconnect — bez animacji.
  // ============================================================
  async function renderSnapshot(row) {
    activeGeneration = generation;
    stopTimerTick();
    if (row.detail?.display?.colors) {
      const c = row.detail.display.colors;
      if (c.A) api.color.set("A", c.A);
      if (c.B) api.color.set("B", c.B);
      if (c.BACKGROUND) api.color.set("BG", c.BACKGROUND);
      if (c.DOT) api.color.set("DOT", c.DOT);
    }
    if (row.detail?.display?.theme) await api.theme.set(row.detail.display.theme);

    if (row.detail?.locks?.gameEnded || row.step === "f_end" || row.step === "r_gameEnd") { await showEndScreen(row, { animate: false }); return; }
    await applyDisplayMode(row);
  }

  // ============================================================
  // Kolejne zmiany na żywo.
  // ============================================================
  // WAŻNE: async i await w KAŻDYM branchu, który rysuje na współdzielonym
  // płótnie "big" (logo/plansza rund/plansza finału/WIN) — zgłoszony bug
  // ("wszystko się nakłada jedno na drugie") miał jedną przyczynę: kolejne
  // animacje na tym samym płótnie odpalane RÓWNOLEGLE (fire-and-forget)
  // zamiast po kolei. deriveEvents może w JEDNYM wywołaniu zwrócić kilka
  // zdarzeń dla tej samej zmiany stanu (np. STEP_CHANGE do "r_gameEnd" I
  // GAME_ENDED naraz — patrz web/js/gameplay/deriveEvents.js) — bez await nad pętlą
  // drugie zdarzenie zaczynało rysować, zanim pierwsze skończyło znikać.
  // Stare control/js/gameRounds.js/gameFinal.js robiły to zawsze przez
  // `await display.coś()` w ścisłej kolejności — to jest dokładnie ten sam
  // wzorzec, tylko przeniesiony na stronę odbiorcy (Display samo sekwencjonuje
  // to, co kiedyś sekwencjonował nadawca poleceń).
  async function renderDiff(prevRow, nextRow) {
    activeGeneration = generation;
    const transitionStartedAt = Date.now();
    if (["devices_display", "setup_finish"].includes(nextRow.step) && nextRow.detail?.display?.mode !== "QR") {
      await applyDisplayMode(nextRow); return;
    }
    if (prevRow.step === nextRow.step && nextRow.detail?.display?.mode === "GAME") {
      const before = prevRow.detail?.teams || {};
      const after = nextRow.detail?.teams || {};
      if (before.teamA !== after.teamA || before.teamB !== after.teamB || prevRow.detail?.settings?.uiLang !== nextRow.detail?.settings?.uiLang) paintTeamNames(nextRow);
    }
    const events = deriveEvents(prevRow, nextRow);
    // Jeden dispatch = jeden potwierdzony sound_cue_key dla CAŁEGO wiersza —
    // odsłonięcia (odpowiedzi/punkty rund lub finału) animują się dokładnie
    // tyle, ile trwa TEN dźwięk (answer_correct/answer_wrong/reveal, zależnie
    // od kontekstu), zamiast sztywnej stałej ANSWER_ANIM.
    // Reconnect/polling may combine the last score and Finish final in one
    // received row. Do not replay the old score using the final-theme length
    // before starting the result transition for the current sound.
    const closingFinal = nextRow.step === "f_end" && prevRow.step !== "f_end";
    const answerAnimMs = closingFinal ? 0 : await timing.dur(nextRow.sound_cue_key);
    for (const ev of events) {
      switch (ev.kind) {
        case "SNAPSHOT_RENDER":
          await renderSnapshot(nextRow);
          break;
        case "STEP_CHANGE":
          if (ev.to === "r_duel" && ev.from === "r_roundStart") {
            // Przejście planszy rusza razem z reveal (logo albo poprzednia
            // plansza znika losowymi kawałkami, nowa wjeżdża z nakładką).
            const { offsetMs } = await timing.revealSyncSplit("round_transition");
            if (offsetMs > 0) await wait(offsetMs);
            await paintRoundsBoard(nextRow, { transition: BOARD_TRANSITION });
          } else if (ev.to === "r_play" && ev.from === "r_duel") {
            // R2->R3 (ACCEPT_BUZZ): control_team zostaje null (dopiero PLAY
            // go ustawia), ale duel.currentTeam już wskazuje, kto ma teraz
            // próbować — applyIndicator() (patrz jej komentarz) to teraz
            // odczytuje. Bez tego wskaźnik milczał przez CAŁY pojedynek.
            applyIndicator(nextRow);
          } else if (ev.to === "r_roundStart" && ev.from === "r_play") {
            // R9 (koniec WŁAŚNIE ROZEGRANEJ rundy, bez finału/końca gry) —
            // zgłoszone: LEFT/RIGHT mają skoczyć na nowe wyniki DOSŁOWNIE w
            // momencie dźwięku końca rundy (reveal+round_transition), nie
            // dopiero przy "Start rundy" NASTĘPNEJ rundy. Ta gałąź wcześniej
            // w ogóle nie istniała — engine.js's finalizeRound() dolicza
            // bank×mnożnik do totals PRZED tym przejściem (patrz END_ROUND/
            // NEXT_AFTER_REVEAL), ale nic tu nigdy nie kazało Displayowi tego
            // przerysować, więc stare wyniki wisiały na małych cyfrach aż do
            // kolejnego kliknięcia operatora — kompletnie oderwane od
            // dźwięku, który miał je "zapowiadać". Sama duża plansza (z
            // ostatniej rundy) świadomie zostaje bez zmian — animOut dopiero
            // przy starcie następnej rundy (gałąź wyżej), dokładnie jak w
            // planie (sekcja 2a: R6-R7 aktualizuje tylko LEFT/RIGHT/TOP,
            // R1->R2 dopiero chowa/pokazuje planszę).
            api.small.topDigits("000");
            paintTotals(nextRow);
          } else if (ev.to === "r_gameEnd" || ev.to === "f_start") {
            // "reveal" gra od razu (web/js/gameplay/soundCueEngine.js's isRoundEnd:
            // sequential "reveal" PRZED "round_transition") — zgłoszone:
            // punkty mają przeskoczyć NA reveal, więc paintTotals leci PRZED
            // animOut, nie po nim (animOut trwa tyle, ile realnie gra reveal
            // — kończą się razem, zamiast animOut na sztywną, niezależną
            // liczbę).
            await timing.dur("reveal");
            // Ten sam powód co w gałęzi r_roundStart wyżej — totals mają być
            // aktualne od razu, nie dopiero po GAME_ENDED (osobny, późniejszy
            // klik "Zakończ grę"/"Pokaż koniec gry").
            api.small.topDigits("000");
            paintTotals(nextRow);
            if (ev.to === "r_gameEnd") {
              const { offsetMs } = await timing.revealSyncSplit("round_transition");
              if (offsetMs > 0) await wait(offsetMs);
              await showEndScreen(nextRow);
            }
            // Plansza rund zostaje do świadomego „Zakończ grę”.
          } else if (ev.to === "f_p1_entry" && ev.from === "f_start") {
            // Keep the winner score; reserve the opposite side for the timer.
            paintTotals(nextRow);
            api.small.topDigits(pad3(nextRow.detail.final.runtime.sum));
            const leadMs = await timing.dur("final_theme");
            const { offsetMs } = await timing.revealSyncSplit("round_transition");
            await wait(leadMs + offsetMs);
            await paintFinalBoard(nextRow, { transition: BOARD_TRANSITION });
            showTimerPlaceholder(nextRow, "15");
            // Wskaźnik na zwycięzcę zapala się TU (plan, sekcja 2a: "zostaje
            // zapalony przez cały finał i zakończenie gry") — nie przez
            // CONTROL_CHANGED, bo control_team zostaje null przez cały
            // finał (winner idzie z detail.final.winnerTeam, osobnego pola,
            // którego deriveEvents nie diffuje jako CONTROL_CHANGED).
            applyIndicator(nextRow);
          } else if (ev.to === "f_p2_start") {
            // Replace player 1 answers with placeholders during reveal:
            // equal disappearance and appearance phases.
            const { offsetMs } = await timing.revealSyncSplit("round_transition");
            if (offsetMs > 0) await wait(offsetMs);
            const rows = Array.from({ length: 5 }, () => ({ left: FINAL_TEXT_PLACEHOLDER, a: FINAL_PTS_PLACEHOLDER }));
            await api.final.setHalf("A", { rows, transition: BOARD_TRANSITION });
          } else if (ev.to === "f_p2_entry" && ev.from === "f_p2_start") {
            // Restore player 1 answers with the same two-phase transition.
            const { offsetMs } = await timing.revealSyncSplit("round_transition");
            if (offsetMs > 0) await wait(offsetMs);
            const f = nextRow.detail.final;
            const rows = Array.from({ length: 5 }, (_, i) => {
              const m1 = f.runtime.map1[i];
              return {
                left: m1?.revealedAnswer ? m1.outText : FINAL_TEXT_PLACEHOLDER,
                a: m1?.revealedPoints ? String(m1.pts) : FINAL_PTS_PLACEHOLDER,
              };
            });
            await api.final.setHalf("A", { rows, transition: BOARD_TRANSITION });
            // control/js/gameFinal.js's startP2Round(): zapowiedź "20" po
            // stronie zwycięzcy, ten sam mechanizm co przy f_p1_entry.
            showTimerPlaceholder(nextRow, "20");
          } else if (ev.to === "r_roundStart" && ev.from === "r_intro") {
            const { offsetMs } = await timing.revealSyncSplit("show_intro");
            if (offsetMs > 0) await wait(offsetMs);
            paintTeamNames(nextRow);
            await api.logo.show({ ...LOGO_IN_ANIM, ms: LOGO_IN_MS });
          } else if (ev.to === "r_intro") {
            api.big.clear();
            paintTeamNames(nextRow, true);
            paintTotals(nextRow);
          }
          break;
        // engine.js's END_ROUND (R6-R7) rusza WCZEŚNIEJ niż STEP_CHANGE do
        // r_roundStart/r_gameEnd/f_start powyżej, gdy zostały jeszcze
        // nieodsłonięte odpowiedzi — step zostaje "r_play", zmienia się
        // tylko phase (PLAY/STEAL -> REVEAL), więc to jedyny sygnał na tę
        // chwilę. Bank×mnożnik jest w totals i TOP=0 już w samym engine.js
        // (patrz END_ROUND) — ten sam totals/TOP-reset co w gałęziach
        // r_roundStart/r_gameEnd/f_start wyżej, tylko wywołany wcześniej, bo
        // tu kończy się runda BEZ R8 do przejścia. Bez tego LEFT/RIGHT
        // pokazywały stare wyniki przez CAŁY czas odkrywania reszty (R8),
        // mimo że dźwięk końca rundy już zagrał.
        case "PHASE_CHANGE":
          if (ev.to === "REVEAL") {
            api.small.topDigits("000");
            paintTotals(nextRow);
          }
          break;
        case "CONTROL_CHANGED":
          applyIndicator(nextRow);
          break;
        case "ANSWER_REVEALED": {
          const r = nextRow.detail.rounds;
          const bankChanged = r.bankPts !== (prevRow.detail?.rounds?.bankPts ?? 0);
          // Jedna równa fala: tekst, potem punkty, potem suma banku — każdy
          // znak w tym samym tempie (displayTiming.js), niezależnie od
          // długości dźwięku.
          const revealedAnswers = ev.ords
            .map((ord) => ({ ord, ans: r.answers.find((a) => a.ord === ord) }))
            .filter(({ ans }) => ans);
          await Promise.all(revealedAnswers.map(({ ord, ans }) => {
            return api.rounds.setText(ord, ans.text, { animIn: { ...ANSWER_ANIM, ms: ROUND_TEXT_MS } });
          }));
          const pointAnimations = revealedAnswers.map(({ ord, ans }) => {
            return api.rounds.setPts(ord, String(ans.fixed_points), { animIn: { ...ANSWER_ANIM, ms: ROUND_POINTS_MS } });
          });
          // R8 (odkrywanie reszty, phase REVEAL) jest czysto pokazowe —
          // bankPts się wtedy nie zmienia (control/js/display.js's
          // roundsRevealRow tam w ogóle nie woła RSUMA/TOP) — bez tego
          // SUMA dostawałaby zbędną animację na niezmienioną liczbę.
          await Promise.all(pointAnimations);
          if (bankChanged) {
            api.small.topDigits(pad3(r.bankPts));
            await api.rounds.setSuma(String(r.bankPts ?? 0), {
              animIn: { ...ANSWER_ANIM, ms: ROUND_SUMA_MS },
            });
          }
          // W pojedynku trafienie nie-topowej odpowiedzi oddaje głos DRUGIEJ
          // drużynie (duel.currentTeam się zmienia), bez żadnej zmiany
          // control_team (ta zostaje null aż do wygranej) — CONTROL_CHANGED
          // się tu nie odpali, więc applyIndicator() trzeba wywołać wprost
          // (patrz jej komentarz). Poza DUEL to tylko nieszkodliwe powtórzenie
          // tego, co CONTROL_CHANGED już ustawił.
          applyIndicator(nextRow);
          break;
        }
        case "DUEL_MISS":
          // Krótki błysk (slot 4), nie stały X — control/js/display.js's
          // roundsFlashDuelX: ON, potem OFF, bez czekania; stały czas błysku
          // (displayTiming.js).
          if (ev.team) {
            api.rounds.setX(`4${ev.team}`, true);
            const token = generation;
            setTimeout(() => { if (token === generation) api.rounds.setX(`4${ev.team}`, false); }, DUEL_X_FLASH_MS);
          }
          // Pudło w pojedynku też oddaje głos drugiej drużynie (ten sam
          // powód co w ANSWER_REVEALED wyżej).
          applyIndicator(nextRow);
          break;
        case "STRIKE":
          api.rounds.setX(`${ev.count}${ev.team}`, true);
          break;
        case "STEAL_RESOLVED":
          if (!ev.won) {
            const stealTeam = nextRow.detail.rounds.steal?.team;
            if (stealTeam) api.rounds.setX(`4${stealTeam}`, true);
          }
          break;
        // Zgłoszony realny bug (#16/#17): web/js/gameplay/deriveEvents.js's
        // diffFinalMapReveals() emituje ev.round jako STRING "map1"/"map2"
        // (dokładnie ten klucz w detail.final.runtime, potwierdzone testem
        // jednostkowym tests/unit/deriveEvents.test.js) — ten kod porównywał
        // to z LICZBĄ 1, co jest zawsze fałszywe dla OBU wartości. Skutek:
        // każde odsłonięcie odpowiedzi/punktów gracza 1 (map1) czytało dane
        // z map2 (najczęściej jeszcze null → wywalało się po cichu/psuło
        // resztę renderDiff) i zawsze pisało na PRAWĄ stronę planszy — stąd
        // brak treści gracza 1, zawsze zera, i pomylone strony.
        case "FINAL_ANSWER_REVEALED": {
          const row = nextRow.detail.final.runtime[ev.round][ev.idx];
          const ms = closingFinal ? 0 : FINAL_TEXT_MS;
          if (ev.round === "map1") await api.final.setLeft(ev.idx + 1, row.outText, { animIn: { ...ANSWER_ANIM, ms } });
          else await api.final.setRight(ev.idx + 1, row.outText, { animIn: { ...ANSWER_ANIM, ms } });
          break;
        }
        case "FINAL_POINTS_REVEALED": {
          const f = nextRow.detail.final;
          const row = f.runtime[ev.round][ev.idx];
          const animIn = { ...ANSWER_ANIM, ms: closingFinal ? 0 : FINAL_POINTS_MS };
          await Promise.all([
            ev.round === "map1" ? api.final.setA(ev.idx + 1, String(row.pts), { animIn }) : api.final.setB(ev.idx + 1, String(row.pts), { animIn }),
            api.final.setSumaFor(ev.round === "map1" ? "A" : "B", String(f.runtime.sum), { animIn }),
          ]);
          api.small.topDigits(pad3(f.runtime.sum));
          break;
        }
        case "TIMER_STARTED":
          startTimerTick(nextRow);
          break;
        case "TIMER_STOPPED":
          stopTimerTick();
          paintTotals(nextRow);
          break;
        case "DISPLAY_MODE_CHANGED":
          await applyDisplayMode(nextRow);
          break;
        case "GAME_ENDED":
          // Ten sam events[] może nieść STEP_CHANGE (do "r_gameEnd") TUŻ
          // PRZED tym zdarzeniem (patrz web/js/gameplay/deriveEvents.js) — dzięki
          // await nad całą pętlą to zdarzenie startuje dopiero PO tym, jak
          // animOut planszy rund z poprzedniego case'a faktycznie się
          // skończył, zamiast malować logo/WIN w tym samym momencie.
          applyIndicator(nextRow);
          break;
        // HOST_COVER_CHANGED, SOUND_CUE — nie dotyczą Display.
        default:
          break;
      }
    }
    if (nextRow.step === "f_end" && prevRow.step !== "f_end") {
      const scoringMs = ["answer_correct", "answer_wrong"].includes(nextRow.sound_cue_key) ? answerAnimMs : 0;
      const remainingMs = scoringMs - (Date.now() - transitionStartedAt);
      if (remainingMs > 0) await wait(remainingMs);
      await showEndScreen(nextRow);
    }
  }

  return { renderSnapshot, renderDiff, cancel, updateTeamNames };
}
