// control/js/engine.js
// Silnik rozgrywki Control v2 — JEDEN generyczny punkt wejścia:
// dispatch(action). Zero funkcji-per-akcja jak w starym gameRounds.js/
// gameFinal.js (acceptBuzz/addX/goSteal/goEndRound...) — to był stary
// kształt, tylko bez komend do urządzeń, nie prawdziwe odwzorowanie tabeli
// stanów. Tutaj tabela (web/js/gameplay/gameStateMachine.js) jest MECHANIZMEM, nie
// dokumentacją obok: każdy reducer proponuje `step`, a dispatch() woła
// assertTransition(aktualny_step, proponowany_step) i dopiero po tej
// weryfikacji zapisuje. Nielegalny skok (błąd w reducerze, literówka w
// akcji) rzuca wyjątek zamiast po cichu zepsuć stan gry.
//
// Zakres celowo NIE obejmuje nawigacji przedmeczowej (devices_display →
// setup_finish → r_intro → r_roundStart) — to liniowe
// przechodzenie bez żadnych reguł/rozgałęzień, obsługiwane wprost w
// control2.html (app-level), a nie w silniku reguł gry. Ten plik odpowiada
// za wszystko, co ma realną logikę: R2-R10 (rundy) i F0-F14 (finał).
//
// Zero importów przeglądarkowych — testowalne w gołym Node.

import { assertTransition } from "../../shared/js/gameplay/gameStateMachine.js?v=v2026-11-08T09471";
import { sortAnswersByPoints } from "../../shared/js/core/answer-order.js?v=v2026-11-08T09471";


const STRIKE_LIMIT = 3;
const TIMER_SECONDS = { P1: 15, P2: 20 };
const TIMER3_ACTIONS = new Set(["START_TIMER3", "EXPIRE_TIMER3", "CANCEL_TIMER3"]);
const FINAL_BLANK = "————";

// Najwyżej punktowana odpowiedź = każda o maksymalnej liczbie punktów (E21):
// przy 40/40/20 trafienie dowolnej „40” kończy pojedynek tak samo. Tożsamość
// odpowiedzi (kafle, odsłonięcia) zostaje po ord; punkty jej nie wyznaczają.
function isTopAnswer(answers, ans) {
  const max = answers.reduce((m, a) => Math.max(m, Number(a.fixed_points) || 0), 0);
  return max > 0 && (Number(ans?.fixed_points) || 0) === max;
}
function mapKey(round) {
  return round === 1 ? "map1" : "map2";
}
function entryKey(round) {
  return round === 1 ? "p1" : "p2";
}
function emptyMapRows() {
  return Array.from({ length: 5 }, () => ({
    mode: "AUTO",
    kind: null,
    matchId: null,
    outText: "",
    pts: 0,
    revealedAnswer: false,
    revealedPoints: false,
    locked: false,
    repeat: false,
    _addedToSum: false,
  }));
}
function shownText(row) {
  if (!row || row.kind === "SKIP" || row.kind == null) return FINAL_BLANK;
  return row.outText && row.outText.trim() ? row.outText : FINAL_BLANK;
}

export function getRoundMultiplier(settings, roundNo) {
  const arr = settings?.roundMultipliers?.length ? settings.roundMultipliers : [1];
  const idx = Math.min(roundNo - 1, arr.length - 1);
  const n = Number.parseInt(String(arr[Math.max(idx, 0)]), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function isThresholdHit(state) {
  const totals = state.rounds.totals || { A: 0, B: 0 };
  const threshold = state.settings.finalMinPoints;
  return (totals.A || 0) >= threshold || (totals.B || 0) >= threshold;
}

function canEnterFinal(state) {
  if (state.settings.hasFinal !== true) return false;
  if (state.settings.finalQuestionsMode === "pick") {
    return state.final.confirmed === true && state.final.picked.length === 5;
  }
  return true;
}

function computeWinnerTeam(state) {
  const totals = state.rounds.totals || { A: 0, B: 0 };
  return (totals.A || 0) >= (totals.B || 0) ? "A" : "B";
}

function sameStep(state) {
  return { step: state.step, phase: state.phase, controlTeam: state.controlTeam, topCard: state.topCard };
}

// control/js/gameRounds.js's clearTimer3(): 3-sekundowy zegarek na decyzję
// (DUEL/PLAY/STEAL) — jeśli operator sam rozstrzygnie coś przed jego
// wygaśnięciem (odsłoni odpowiedź, doda X ręcznie, odda pytanie, ręcznie
// wejdzie w kradzież, zakończy rundę), zegarek trzeba zdjąć, inaczej
// zaplanowane w control/js/app.js wywołanie EXPIRE_TIMER3 later doliczyłoby
// dodatkowe, nieproszone pudło po fakcie.
function clearTimer3(r) {
  r.timer3 = { running: false, endsAt: 0, resolved: null };
}

// control/js/gameRounds.js's duelResetCycle(): w pojedynku drużyny walczą
// o TĘ SAMĄ odpowiedź na zmianę, nie tylko o odpowiedź #1 — pudło idzie
// przez ADD_X (pts=0,isX=true), trafienie przez REVEAL_ANSWER (pts=realne
// punkty tej odpowiedzi, może być dowolna, nie tylko topowa). Pierwsza
// próba w cyklu wygrywa natychmiast TYLKO gdy trafiono odpowiedź #1 bez
// pudła; w każdym innym przypadku (pudło ALBO trafienie nie-topowej
// odpowiedzi) oddaje głos drugiej drużynie. Druga próba porównuje punkty
// obu prób (pudło liczy się jako 0, remis idzie do pierwszej drużyny w
// cyklu). Gdy obie spudłowały (obie ≤0), reset NIE czyści firstTeam/
// secondTeam i NIE wraca do r_duel — nie ma "ponownego buzzera" (Ty masz
// jakieś sprzeczne informacje — nie ma czegoś takiego), po prostu kolej
// wraca do firstTeam na tę samą, wciąż otwartą rundę pojedynku.
function duelResetCycle(d) {
  d.cycleFirstAnswered = false;
  d.cycleSecondAnswered = false;
  d.cycleFirstPts = 0;
  d.cycleSecondPts = 0;
  d.cycleFirstIsX = false;
  d.cycleSecondIsX = false;
  d.currentTeam = d.firstTeam || null;
}

function duelRegisterResult(d, team, { pts, isX, isTop }) {
  if (!d.cycleFirstAnswered) {
    d.cycleFirstAnswered = true;
    d.cycleFirstPts = pts;
    d.cycleFirstIsX = !!isX;
    if (!isX && isTop) return { type: "WIN", winner: team };
    d.currentTeam = team === d.firstTeam ? d.secondTeam : d.firstTeam;
    return { type: "CONTINUE_SECOND" };
  }
  d.cycleSecondAnswered = true;
  d.cycleSecondPts = pts;
  d.cycleSecondIsX = !!isX;
  const firstPts = d.cycleFirstIsX ? 0 : d.cycleFirstPts;
  const secondPts = d.cycleSecondIsX ? 0 : d.cycleSecondPts;
  if (firstPts <= 0 && secondPts <= 0) {
    duelResetCycle(d);
    return { type: "RESET" };
  }
  return secondPts > firstPts ? { type: "WIN", winner: d.secondTeam } : { type: "WIN", winner: d.firstTeam };
}

function gotoEnd(state) {
  state.final.runtime.timer = { running: false, phase: null, endsAt: 0 };
  return { step: "f_end", phase: null, controlTeam: null, topCard: "final", soundCueKey: "final_theme" };
}

// R9: dokąd pójdzie gra po końcu bieżącej rundy — CZYSTA funkcja (żadnej
// mutacji), więc control/js/ui.js może ją wywołać wprost, żeby z
// wyprzedzeniem podpisać przycisk R8 ("przejdź do następnej rundy"/
// "przejdź do finału"/"przejdź do zakończenia gry" — zgłoszone: przycisk ma
// się podpisać PRZED kliknięciem, nie dopiero po). state.rounds.totals w
// tym momencie już zawiera wynik właśnie kończonej rundy (END_ROUND dolicza
// bankPts×mnożnik PRZED wejściem w R8 — patrz niżej), więc isThresholdHit()
// tu i przy faktycznym finalizeRound() zawsze widzą te same liczby.
export function previewRoundEndDestination(state) {
  if (isThresholdHit(state)) {
    return canEnterFinal(state) ? "FINAL" : "GAME_END";
  }
  if (!state.rounds._questionPool.length) return "GAME_END";
  return "NEXT_ROUND";
}

// Preview before awarding the current bank, for the end-round button.
export function previewPendingRoundEndDestination(state) {
  const r = state.rounds;
  const winner = r.steal.used && r.steal.won ? r.steal.team : state.controlTeam;
  const totals = { ...r.totals };
  if (winner) totals[winner] = (totals[winner] || 0) + r.bankPts * getRoundMultiplier(state.settings, r.roundNo);
  return previewRoundEndDestination({ ...state, rounds: { ...r, totals } });
}

// R9: koniec rundy — jedyny punkt, gdzie decyduje się co dalej (kolejna
// runda / finał / koniec gry). Wywoływany z END_ROUND (gdy nie ma nic do
// odsłonięcia) i NEXT_AFTER_REVEAL (po R8, gdy operator sam potwierdzi, że
// odsłonił już wszystko) — patrz plan, tabela A, R9.
function finalizeRound(state) {
  const r = state.rounds;
  const destination = previewRoundEndDestination(state);
  r.roundNo += 1;
  r.bankPts = 0;
  r.xA = 0;
  r.xB = 0;
  r.passUsed = false;
  r.allowPass = false;
  r.canEndRound = false;
  r.lockPlayControls = false;
  r.roundEndDestination = null;

  if (destination === "FINAL") {
    state.locks.finalActive = true;
    return { step: "f_start", phase: null, controlTeam: null, topCard: "final" };
  }
  if (destination === "GAME_END") {
    return { step: "r_gameEnd", phase: null, controlTeam: null, topCard: "rounds" };
  }
  return { step: "r_roundStart", phase: "READY", controlTeam: null, topCard: "rounds" };
}

// Każdy reducer: (state, action, deps) -> Promise<null | {step, phase, controlTeam, topCard, soundCueKey?}>
// null = akcja świadomie nie ma zastosowania w bieżącym stanie (no-op) —
// nigdy cichy wyjątek, dispatch() po prostu nic nie commituje.
const REDUCERS = {
  // ---- rundy: R1->R2 ----
  async START_ROUND(state, action, deps) {
    const r = state.rounds;
    if (!r._questionPool.length) r._questionPool = await deps.loadQuestionPool();
    if (!r._questionPool.length) {
      return { step: "r_gameEnd", phase: null, controlTeam: null, topCard: "rounds" };
    }
    const q = r._questionPool.shift();
    const answers = sortAnswersByPoints(await deps.loadAnswers(q.id));

    r.question = { id: q.id, ord: q.ord, text: q.text };
    r.answers = answers;
    r.revealed = [];
    r.bankPts = 0;
    r.xA = 0;
    r.xB = 0;
    r.passUsed = false;
    r.allowPass = false;
    r.canEndRound = false;
    r.lockPlayControls = false;
    r.stealWon = false;
    r.steal = { active: false, used: false, team: null, won: null };
    r.duel = {
      enabled: true, lastPressed: null, firstTeam: null, secondTeam: null, currentTeam: null,
      cycleFirstAnswered: false, cycleSecondAnswered: false, cycleFirstPts: 0, cycleSecondPts: 0,
      cycleFirstIsX: false, cycleSecondIsX: false,
    };
    clearTimer3(r);

    return { step: "r_duel", phase: "DUEL", controlTeam: null, topCard: "rounds", soundCueKey: "round_transition" };
  },

  // ---- R2->R3: przyjęcie bzyczenia (lastPressed już w state — zapisane
  // bezpośrednio przez Buzzer przez game_state_buzzer_press) ----
  // control/js/gameRounds.js's acceptBuzz() samo nigdy nie gra dźwięku
  // (confirmPhysicalTeam() woła je z jawnym komentarzem "bez dźwięku"); w
  // trybie physicalBuzzer operator tylko zatwierdza, kto kliknął pierwszy,
  // bez żadnego sygnału dźwiękowego.
  async ACCEPT_BUZZ(state, action) {
    const r = state.rounds;
    // Tylko przed przyjęciem zgłoszenia: spóźnione zatwierdzenie z kolejki
    // (np. podwójne Enter) nie może zresetować trwającej rozgrywki.
    if (state.step !== "r_duel" || r.duel.firstTeam) return null;
    const other = action.team === "A" ? "B" : "A";
    r.duel.firstTeam = action.team;
    r.duel.secondTeam = other;
    r.duel.currentTeam = action.team;
    r.duel.cycleFirstAnswered = false;
    r.duel.cycleSecondAnswered = false;
    r.duel.cycleFirstPts = 0;
    r.duel.cycleSecondPts = 0;
    r.duel.cycleFirstIsX = false;
    r.duel.cycleSecondIsX = false;
    // Zgłoszenie urządzenia zagrało już w chwili naciśnięcia.
    const soundCueKey = undefined;
    return { step: "r_play", phase: "DUEL", controlTeam: null, topCard: "rounds", soundCueKey };
  },

  // ---- R2: "Ponów naciśnięcie" — operator odrzuca zgłoszenie sprzed
  // przyjęcia (np. błędny/przypadkowy sygnał z Buzzera) i otwiera przycisk
  // na nowo, bez cofania całej rundy. Tylko przed ACCEPT_BUZZ — po
  // przyjęciu (firstTeam już ustawione) nie ma czego "ponawiać" (no-op,
  // patrz niżej). Odpowiednik starego control/js/gameRounds.js's
  // retryDuel().
  async RETRY_DUEL(state) {
    const r = state.rounds;
    if (state.phase !== "DUEL" || r.duel.firstTeam) return null;
    r.duel.lastPressed = null;
    return { step: "r_duel", phase: "DUEL", controlTeam: null, topCard: "rounds" };
  },

  // ---- R3/R4/R5/R8: odsłonięcie odpowiedzi — jeden reducer, gałąź wg
  // aktualnej fazy (DUEL/PLAY/STEAL/REVEAL), dokładnie jak w tabeli A ----
  async REVEAL_ANSWER(state, action) {
    const r = state.rounds;
    if (state.phase === "REVEAL") return REDUCERS.REVEAL_LEFT(state, action);

    const ans = r.answers.find((a) => a.ord === action.ord);
    if (!ans || r.revealed.includes(action.ord)) return null;
    clearTimer3(r);

    if (state.phase === "DUEL") {
      // control/js/gameRounds.js's revealAnswerByOrd(): w pojedynku wolno
      // odsłonić DOWOLNĄ odpowiedź, nie tylko #1 — jej punkty zawsze trafiają
      // do banku, a wynik (trafienie/nie-topowa) idzie przez
      // duelRegisterResult tak samo jak pudło z ADD_X.
      const isTop = isTopAnswer(r.answers, ans);
      const team = r.duel.currentTeam || r.duel.firstTeam || "A";
      r.revealed.push(action.ord);
      r.bankPts += ans.fixed_points;
      const result = duelRegisterResult(r.duel, team, { pts: ans.fixed_points, isX: false, isTop });
      if (result.type === "WIN") {
        r.allowPass = true;
        return { step: "r_play", phase: "PLAY", controlTeam: result.winner, topCard: "rounds", soundCueKey: "answer_correct" };
      }
      // CONTINUE_SECOND lub RESET — duel.currentTeam już zaktualizowany przez
      // duelRegisterResult, zostajemy w tym samym kroku/fazie.
      return { step: "r_play", phase: "DUEL", controlTeam: null, topCard: "rounds", soundCueKey: "answer_correct" };
    }

    // Kradzież to jedna odpowiedź: po jej rozstrzygnięciu zostaje tylko
    // „Zakończ rundę”, a reszta odsłania się po końcu rundy bez punktów.
    if (state.phase === "STEAL" && (!r.steal.active || r.steal.used)) return null;

    r.revealed.push(action.ord);
    r.bankPts += ans.fixed_points;
    r.allowPass = false;

    if (state.phase === "STEAL") {
      r.steal.used = true;
      r.steal.won = true;
      r.stealWon = true;
      r.steal.active = false;
      r.canEndRound = true;
      return { step: "r_play", phase: "STEAL", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_correct" };
    }

    if (r.revealed.length >= r.answers.length) r.canEndRound = true;
    return { step: "r_play", phase: state.phase, controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_correct" };
  },

  // ---- R4: pass (raz na rundę, tylko PLAY, tylko przed 1. trafieniem) ----
  async PASS(state) {
    const r = state.rounds;
    if (state.phase !== "PLAY" || !r.allowPass || r.passUsed) return null;
    clearTimer3(r);
    r.passUsed = true;
    r.allowPass = false;
    const nextControl = state.controlTeam === "A" ? "B" : "A";
    return { step: "r_play", phase: "PLAY", controlTeam: nextControl, topCard: "rounds" };
  },

  // ---- R3/R4/R5: pudło — gałąź wg fazy ----
  async ADD_X(state) {
    const r = state.rounds;
    clearTimer3(r);

    if (state.phase === "DUEL") {
      // Krótki błysk na Display (slot 4, roundsFlashDuelX w starym systemie)
      // przy KAŻDYM pudle w pojedynku, nie tylko przy jego rozstrzygnięciu —
      // missSeq/lastMissTeam to jedyny sposób, żeby deriveEvents (diff stanu)
      // w ogóle zauważył to zdarzenie, bo pudło w DUEL nie rusza xA/xB.
      const missedTeam = r.duel.currentTeam || r.duel.firstTeam || "A";
      r.duel.lastMissTeam = missedTeam;
      r.duel.missSeq = (r.duel.missSeq || 0) + 1;
      const result = duelRegisterResult(r.duel, missedTeam, { pts: 0, isX: true, isTop: false });
      if (result.type === "WIN") {
        r.allowPass = true;
        return { step: "r_play", phase: "PLAY", controlTeam: result.winner, topCard: "rounds", soundCueKey: "answer_wrong" };
      }
      // CONTINUE_SECOND lub RESET (obie spudłowały — kolej wraca do
      // firstTeam, BEZ ponownego buzzera: firstTeam/secondTeam zostają).
      return { step: "r_play", phase: "DUEL", controlTeam: null, topCard: "rounds", soundCueKey: "answer_wrong" };
    }

    if (state.phase === "STEAL") {
      if (!r.steal.active || r.steal.used) return null;
      r.steal.used = true;
      r.steal.won = false;
      r.stealWon = false;
      r.steal.active = false;
      r.canEndRound = true;
      return { step: "r_play", phase: "STEAL", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_wrong" };
    }

    if (state.phase === "PLAY") {
      if (!state.controlTeam) return null;
      const key = state.controlTeam === "A" ? "xA" : "xB";
      r[key] = Math.min((r[key] || 0) + 1, STRIKE_LIMIT);
      r.allowPass = false;

      if (r[key] >= STRIKE_LIMIT && r.revealed.length < r.answers.length) {
        const other = state.controlTeam === "A" ? "B" : "A";
        r.steal = { active: true, used: false, team: other, won: null };
        return { step: "r_play", phase: "STEAL", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_wrong" };
      }
      if (r[key] >= STRIKE_LIMIT) r.canEndRound = true;
      return { step: "r_play", phase: "PLAY", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_wrong" };
    }
    return null;
  },

  // ---- R5: ręczna kradzież (bez czekania na 3. X) ----
  async GO_STEAL(state) {
    const r = state.rounds;
    if (state.phase !== "PLAY" || !state.controlTeam) return null;
    clearTimer3(r);
    const other = state.controlTeam === "A" ? "B" : "A";
    r.steal = { active: true, used: false, team: other, won: null };
    return { step: "r_play", phase: "STEAL", controlTeam: state.controlTeam, topCard: "rounds" };
  },

  // ---- 3s zegarek na decyzję (DUEL/PLAY/STEAL) — control/js/gameRounds.js's
  // startTimer3Internal(): opcjonalny, operator włącza go sam; jeśli nikt nie
  // rozstrzygnie w ciągu 3s, EXPIRE_TIMER3 (dispatch'owane z zegarka w
  // control/js/app.js, ten sam mechanizm co finałowy timer) dolicza X
  // dokładnie tak samo jak ręczne kliknięcie ADD_X. ----
  async START_TIMER3(state, action, deps) {
    const r = state.rounds;
    if (state.phase === "REVEAL" || r.canEndRound || r.lockPlayControls) return null;
    if (r.timer3?.running) return null;
    r.timer3 = { running: true, endsAt: deps.now() + 3000, resolved: null };
    return sameStep(state);
  },

  async EXPIRE_TIMER3(state) {
    const r = state.rounds;
    if (!r.timer3?.running) return null;
    r.timer3 = { running: false, endsAt: 0, resolved: "X" };
    return REDUCERS.ADD_X(state);
  },

  // Zgłoszone: "chodzi o to, żeby wrócić o krok, a nie pójść dalej" —
  // w odróżnieniu od EXPIRE_TIMER3 (naliczenie X, gdy timer3 wygasł NA ŻYWO,
  // Control otwarty i obserwujący), to jest wersja dla timera3 zastanego
  // JUŻ wygasłego przy wznowieniu (store.hydrate(), operator był
  // nieobecny — nie mógł ani ręcznie rozstrzygnąć, ani obserwować
  // auto-rozstrzygnięcia). Naliczanie X za czas, który upłynął podczas gdy
  // nikt nie patrzył, byłoby niesprawiedliwe wobec drużyny — więc zamiast
  // ADD_X po prostu kasuje timer3 do stanu SPRZED jego startu (jak
  // "Zacznij od nowa" jest cofnięciem gry, nie kontynuacją) i zostawia
  // rundę dokładnie tam, gdzie była: operator sam decyduje X-em/odpowiedzią
  // po powrocie.
  //
  // DRUGI użytkownik tego samego reducera (zgłoszone): control/js/ui.js
  // dispatchuje to również z kliknięcia W TRAKCIE odliczania na żywo (kafel
  // zegarka, ten sam wzorzec co finalTimerRow's "Zatrzymaj") — operator
  // rozmyślił się i chce przerwać 3s zegarek ręcznie, bez czekania na
  // wygaśnięcie i bez naliczania pudła. Zachowanie identyczne w obu
  // przypadkach (kasuje timer3, nic więcej), więc jeden reducer wystarcza.
  async CANCEL_TIMER3(state) {
    const r = state.rounds;
    if (!r.timer3?.running) return null;
    r.timer3 = { running: false, endsAt: 0, resolved: null };
    return sameStep(state);
  },

  // ---- R6-R7: koniec rundy ----
  async END_ROUND(state) {
    const r = state.rounds;
    if (!state.controlTeam) return null;
    clearTimer3(r);
    r.lockPlayControls = true;

    const winner = r.steal.used && r.steal.won ? r.steal.team : state.controlTeam;
    const multiplier = getRoundMultiplier(state.settings, r.roundNo);
    r.totals[winner] = (r.totals[winner] || 0) + r.bankPts * multiplier;
    r.bankPts = 0;

    if (previewRoundEndDestination(state) === "GAME_END") {
      return { ...finalizeRound(state), soundCueKey: "round_transition" };
    }
    if (r.revealed.length < r.answers.length) {
      // Destination policzone TERAZ (totals już ostateczne dla tej rundy) i
      // zapisane w state — control/js/ui.js czyta je wprost, żeby podpisać
      // przycisk R8 kontekstowo, bez importu logiki silnika (patrz komentarz
      // przy previewRoundEndDestination).
      r.roundEndDestination = previewRoundEndDestination(state);
      return { step: "r_play", phase: "REVEAL", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "round_transition" };
    }
    return { ...finalizeRound(state), soundCueKey: "round_transition" };
  },

  // ---- R8: odkrywanie reszty (czysto pokazowe, nie dolicza do banku) ----
  // Zgłoszone: po odsłonięciu OSTATNIEJ odpowiedzi ekran następnej
  // rundy/finału/końca gry odpalał się sam, "znikąd" — bez żadnego kliknięcia
  // operatora. Poprawka: odsłonięcie ostatniej odpowiedzi już NIE finalizuje
  // rundy samo z siebie — tylko odblokowuje przycisk NEXT_AFTER_REVEAL
  // (patrz control/js/ui.js), który operator musi kliknąć sam, dokładnie
  // jak każde inne "duże przejście" w tej appce.
  async REVEAL_LEFT(state, action) {
    const r = state.rounds;
    if (r.revealed.includes(action.ord)) return null;
    r.revealed.push(action.ord);
    return { step: "r_play", phase: "REVEAL", controlTeam: state.controlTeam, topCard: "rounds", soundCueKey: "answer_correct" };
  },

  // ---- R8->R9: operator potwierdza koniec rundy PO ręcznym odsłonięciu
  // wszystkich pozostałych odpowiedzi (patrz komentarz w REVEAL_LEFT) ----
  // BEZ soundCueKey: zgłoszone wprost — "dźwięk przejścia rundy gra i przed
  // i po odsłanianiu" — round_transition+reveal już zagrało RAZ w
  // END_ROUND (dokładnie w momencie, gdy punkty z banku trafiają do wyniku,
  // patrz plan sekcja 2a "R6-R7"), zanim jeszcze weszliśmy w R8. Odkrywanie
  // reszty (R8) jest czysto pokazowe (REVEAL_LEFT gra "answer_correct" per
  // klik) — koniec R8 NIE ma własnego dźwięku "końca rundy"; kolejny
  // round_transition zagra dopiero przy START_ROUND następnej rundy.
  async NEXT_AFTER_REVEAL(state) {
    const r = state.rounds;
    if (state.phase !== "REVEAL") return null;
    if (r.revealed.length < r.answers.length) return null;
    return finalizeRound(state);
  },

  // ---- R10: ekran końca gry bez finału ----
  async GAME_END_SHOW(state) {
    if (state.locks.gameEnded) return null;
    state.locks.gameEnded = true;
    return { step: "r_gameEnd", phase: null, controlTeam: null, topCard: "rounds", soundCueKey: "final_end" };
  },

  // ---- F0: start finału ----
  // Ładuje pełne dane 5 wybranych pytań (tekst + lista odpowiedzi z
  // punktami) i trzyma je w f.questions — potrzebne zarówno Control (operator
  // wybiera, która odpowiedź z listy pasuje do tego, co wpisał gracz), jak i
  // Hostowi (pokazuje treść pytania + tę samą listę z podświetlonym
  // dopasowaniem, dokładnie jak dzisiejszy control/js/gameFinal.js's
  // hostMappingLeft/Right). Bez tego dane w ogóle nie istniałyby w
  // game_state — dzisiejszy odpowiednik (qPicked/answersByQ) żyje wyłącznie
  // w pamięci Control, więc Host nie mógłby tego zobaczyć przez RPC.
  async START_FINAL(state, action, deps) {
    if (state.settings.hasFinal !== true) return null;
    const f = state.final;
    f.winnerTeam = computeWinnerTeam(state);

    const allQuestions = await deps.loadQuestions(state.gameId);
    const byId = new Map(allQuestions.map((q) => [String(q.id), q]));
    // Odpowiedzi pytań finału równolegle, w kolejności wylosowania
    // (wcześniej po kolei: 5 rund przy wejściu w finał).
    const pickedQuestions = (f.picked || []).map((id) => byId.get(String(id))).filter(Boolean);
    const answerLists = await Promise.all(pickedQuestions.map((q) => deps.loadAnswers(q.id)));
    const questions = pickedQuestions.map((q, i) => ({
      id: q.id,
      text: q.text,
      answers: sortAnswersByPoints(answerLists[i]).map((a) => ({ id: a.id, text: a.text, fixed_points: a.fixed_points })),
    }));
    if (questions.length !== 5) return null; // niekompletna pula — nie wchodzimy w finał w połowie skonfigurowany

    f.questions = questions;
    f.runtime = {
      sum: 0,
      timer: { running: false, phase: null, endsAt: 0, usedP1: false, usedP2: false },
      map1: emptyMapRows(),
      map2: emptyMapRows(),
      p1: new Array(5).fill(null),
      p2: new Array(5).fill(null),
      reached200: false,
    };
    state.locks.finalActive = true;
    state.host.covered = true;
    return { step: "f_p1_entry", phase: null, controlTeam: null, topCard: "final", soundCueKey: "final_theme" };
  },

  // ---- F1/F8: wpisywanie odpowiedzi + flaga powtórzenia ----
  async SET_ENTRY_TEXT(state, action) {
    const key = entryKey(action.round);
    const mapping = state.final.runtime[mapKey(action.round)][action.idx];
    if (mapping.revealedAnswer) return null;
    const prev = state.final.runtime[key][action.idx] || {};
    // control/js/gameFinal.js: wpisanie nowego tekstu gasi "powtórzenie" —
    // repeat włącza się wyłącznie przyciskiem, ale gaśnie jako efekt uboczny
    // innych akcji operatora (tu: edycja pola).
    const next = { ...prev, text: action.text };
    if (action.round === 2 && prev.repeat === true && (action.text || "") !== (prev.text || "")) {
      next.repeat = false;
      state.final.runtime.map2[action.idx] = emptyMapRows()[0];
    }
    if ((action.text || "") !== (prev.text || "")) state.final.runtime[mapKey(action.round)][action.idx] = emptyMapRows()[0];
    state.final.runtime[key][action.idx] = next;
    return sameStep(state);
  },

  async SET_REPEAT(state, action) {
    if (action.round !== 2 || state.final.runtime.map2[action.idx].revealedAnswer) return null;
    const prevEntry = state.final.runtime.p2[action.idx] || {};
    if (action.repeat === false || (prevEntry.text || "").trim()) return null;
    state.final.runtime.p2[action.idx] = { ...prevEntry, repeat: true };
    const row = state.final.runtime.map2[action.idx];
    row.mode = "MANUAL";
    row.kind = "SKIP";
    row.matchId = null;
    row.outText = "";
    row.pts = 0;
    return { ...sameStep(state), soundCueKey: state.step === "f_p2_entry" ? "answer_repeat" : undefined };
  },

  // control/js/gameFinal.js's p1StartTimer()/p2StartTimer(): timer gracza to
  // JEDNORAZOWA szansa na rundę — `usedP1`/`usedP2` raz ustawione na true nie
  // wraca (nie da się "odświeżyć" 15/20 sekund ponownym startem, ani po
  // naturalnym wygaśnięciu, ani po wcześniejszym zatrzymaniu).
  async START_TIMER(state, action, deps) {
    const t = state.final.runtime.timer;
    const usedKey = action.phase === "P1" ? "usedP1" : "usedP2";
    if (t[usedKey]) return null;
    const seconds = TIMER_SECONDS[action.phase];
    state.final.runtime.timer = { ...t, running: true, phase: action.phase, endsAt: deps.now() + seconds * 1000, [usedKey]: true };
    return sameStep(state);
  },

  // Wywoływane TYLKO na żywo — operator ma otwartą kartę Control i
  // obserwuje, jak czas realnie upływa (scheduleFinalTimerWatch w app.js)
  // — "koniec czasu" to coś, co faktycznie się wydarzyło na jego oczach,
  // więc usedP1/usedP2 zostaje zużyte (zgodne z regułą "jednorazowa
  // szansa"). Dla zastanego już wygasłego zegarka PRZY WZNOWIENIU (nikt
  // nie patrzył) patrz CANCEL_TIMER niżej — inny reducer, inne zachowanie.
  async EXPIRE_TIMER(state, action, deps) {
    const t = state.final.runtime.timer;
    if (!t.running) return null;
    const entries = state.final.runtime[t.phase === "P1" ? "p1" : "p2"];
    if (deps.now() < t.endsAt && !entries.every((entry) => String(entry?.text || "").trim())) return null;
    state.final.runtime.timer = { ...t, running: false, endsAt: 0 };
    return { ...sameStep(state), soundCueKey: "time_over" };
    // Brak auto-przejścia do mapowania — operator klika "dalej" ręcznie
    // (START_MAPPING/NEXT_QUESTION), dokładnie jak w oryginale.
  },

  // Odpowiednik CANCEL_TIMER3 dla zegarka finału — patrz jego komentarz
  // wyżej. Zgłoszone: "Najlepiej rozłącz w trakcie timerów, albo zamknij
  // Control w trakcie timerów — czy one wrócą do stanu przed, a nie po, bo
  // tak powinny". Wcześniej final.runtime.timer zastany już wygasły PRZY
  // WZNOWIENIU szedł NAPRZÓD (EXPIRE_TIMER, "koniec czasu", usedP1/usedP2
  // zostaje zużyte na zawsze) — ale operator, który w tej chwili miał
  // rozłączone/zamknięte urządzenie, nie mógł tego ani zaobserwować, ani
  // obsłużyć, dokładnie tak samo jak przy timer3. Zużycie jednorazowej
  // szansy gracza za czas, kiedy nikt nie patrzył, byłoby tak samo
  // niesprawiedliwe jak naliczenie X za timer3 w tej samej sytuacji — ten
  // reducer więc w pełni cofa stan do sprzed startu zegarka, ŁĄCZNIE z
  // jednorazową flagą used{Phase}, żeby gracz po powrocie operatora dostał
  // dokładnie taką samą, nienaruszoną szansę, jaką miał przed zniknięciem
  // Control. Używane WYŁĄCZNIE przy "dogonieniu" zastanego wygasłego
  // zegarka (control/js/app.js's applyExpiredTimersOnResume) — świadome,
  // ręczne zatrzymanie NA ŻYWO (toggleFinalTimer) i naturalne wygaśnięcie
  // na żywo (scheduleFinalTimerWatch) zostają przy EXPIRE_TIMER, bo to
  // odrębny przypadek: "zdążyłem to zobaczyć", nie "zniknąłem i nie wiem co
  // się stało".
  async CANCEL_TIMER(state) {
    const t = state.final.runtime.timer;
    if (!t.running) return null;
    const usedKey = t.phase === "P1" ? "usedP1" : "usedP2";
    state.final.runtime.timer = { ...t, running: false, phase: null, endsAt: 0, [usedKey]: false };
    return sameStep(state);
  },

  // ---- F2-F6/F9-F13: rozstrzygnięcie dopasowania + dwuetapowe odsłonięcie ----
  async RESOLVE_MAPPING(state, action) {
    const row = state.final.runtime[mapKey(action.round)][action.idx];
    if (row.revealedAnswer) return null;
    const hasText = (state.final.runtime[entryKey(action.round)][action.idx]?.text || "").trim().length > 0;
    if ((action.kind === "SKIP" && hasText) || (["MATCH", "MISS"].includes(action.kind) && !hasText)) return null;
    if (action.mode) row.mode = action.mode;
    if (action.kind) row.kind = action.kind;
    if (action.matchId !== undefined) row.matchId = action.matchId;
    if (action.outText !== undefined) row.outText = action.outText;
    if (action.pts !== undefined) row.pts = action.pts;
    return sameStep(state);
  },

  // Zgłoszone: "brak odpowiedzi ma od razu dawać dźwięk błędu już podczas
  // odsłaniania odpowiedzi, a punkty mają się odsłonić automatycznie bez
  // klikania" — dla MISS/SKIP nie ma żadnej realnej wartości dramaturgicznej
  // w osobnym drugim kroku "Pokaż punkty" (zawsze 0 pkt, zawsze
  // "answer_wrong") — więc REVEAL_ANSWER_ONLY od razu woła tę samą logikę co
  // REVEAL_POINTS dla tego przypadku, w jednym kliknięciu/jednym dźwięku.
  // MATCH zostaje dwuetapowe (realne punkty, realna suspensja) — patrz
  // REVEAL_POINTS niżej, nietknięte dla tej gałęzi.
  async REVEAL_ANSWER_ONLY(state, action) {
    const row = state.final.runtime[mapKey(action.round)][action.idx];
    row.outText = shownText(row);
    row.revealedAnswer = true;
    if (row.kind === "SKIP") {
      return REDUCERS.REVEAL_POINTS(state, action);
    }
    row.revealedPoints = false;
    return { ...sameStep(state), soundCueKey: "reveal" };
  },

  async REVEAL_POINTS(state, action) {
    const f = state.final;
    const row = f.runtime[mapKey(action.round)][action.idx];
    const pts = row.kind === "MATCH" ? row.pts || 0 : 0;
    row.pts = pts;
    row.revealedPoints = true;
    if (!row._addedToSum) {
      f.runtime.sum += pts;
      row._addedToSum = true;
    }
    const soundCueKey = row.kind === "MATCH" ? "answer_correct" : "answer_wrong";
    const hitTarget = f.runtime.sum >= state.settings.finalTarget;
    if (hitTarget) {
      f.runtime.reached200 = true;
    }
    return { ...sameStep(state), soundCueKey };
  },

  // ---- F1->F2 / F8->F9: pierwsze wejście w mapowanie danej rundy ----
  // control/js/gameFinal.js's toP1MapQ()/toP2MapQ() zawsze wołają
  // timerStopAndReset() PRZED wejściem w mapowanie — niezależnie od tego,
  // czy operator kliknął "Dalej" podczas gdy timer jeszcze leciał, czy
  // dopiero po jego naturalnym wygaśnięciu. Bez tego runtime.timer.running
  // zostawałby true w zapisanym stanie na zawsze (nic więcej go nie
  // czyści), co przy kolejnym hydrate() Control (np. po przeładowaniu w
  // trakcie mapowania) fałszywie odpalałoby EXPIRE_TIMER/"time_over" poza
  // kontekstem wpisywania.
  async START_MAPPING(state, action) {
    const timer = state.final.runtime.timer;
    const phase = action.round === 1 ? "P1" : "P2";
    if (state.step !== `f_p${action.round}_entry` || timer.running || !timer[`used${phase}`]) return null;
    state.final.runtime.timer = { ...state.final.runtime.timer, running: false, phase: null, endsAt: 0 };
    return { step: `f_p${action.round}_map_q1`, phase: null, controlTeam: null, topCard: "final" };
  },

  // ---- kolejne pytanie / koniec bloku rundy ----
  async NEXT_QUESTION(state, action) {
    if (state.final.runtime.reached200) return gotoEnd(state);
    const nextIdx = action.idx + 1;
    if (action.round === 1) {
      if (nextIdx > 5) {
        return { step: "f_p2_start", phase: null, controlTeam: null, topCard: "final", soundCueKey: "round_transition" };
      }
      return { step: `f_p1_map_q${nextIdx}`, phase: null, controlTeam: null, topCard: "final" };
    }
    if (nextIdx > 5) return gotoEnd(state);
    return { step: `f_p2_map_q${nextIdx}`, phase: null, controlTeam: null, topCard: "final" };
  },

  // ---- F7->F8: start rundy 2 ----
  // Host pasmo 2 zostaje zasłonięte przez CAŁY finał, obie tury — to nie
  // jest luka (wcześniejszy zapis w planie to twierdził błędnie, odwrócone
  // po uzgodnieniu). Jedyny sposób podejrzenia treści to lokalny gest
  // peek na urządzeniu Hosta (control/host/js/render.js), nigdy zapis do
  // game_state. Display, w odróżnieniu od Hosta, dostaje pełne odsłonięcie
  // odpowiedzi gracza 1 przy starcie zegarka gracza 2 (patrz START_TIMER).
  // soundCueKey "round_transition": zgłoszone wprost — "między F7 i F8 miał
  // być dźwięk przejścia rundy plus odsłonięcie". To DOSŁOWNIE przejście do
  // rundy 2 finału (ten sam rodzaj przejścia co R1->R2/F7-wejście), więc ta
  // sama kombinacja "round_transition"+"reveal" zsynchronizowana na koniec
  // (web/js/gameplay/soundCueEngine.js's isP2RoundReveal), nie samo "reveal" —
  // wcześniej ta akcja była całkiem bezdźwięczna mimo realnej animacji
  // (zgłoszone: "Animacja... zawsze = dźwięki" — bez dźwięku nie było z
  // czego wyliczyć czasu tej animacji ani zablokować operatora na czas jej
  // trwania, patrz control/js/actionGate.js).
  async START_P2_ROUND(state) {
    return { step: "f_p2_entry", phase: null, controlTeam: null, topCard: "final", soundCueKey: "round_transition" };
  },

  // ---- F14: koniec finału ----
  async FINISH_FINAL(state) {
    if (state.locks.gameEnded) return null;
    const f = state.final;
    state.rounds.totals[f.winnerTeam] = (state.rounds.totals[f.winnerTeam] || 0) + f.runtime.sum;
    state.locks.gameEnded = true;
    // Round-end already played on entering f_end. This cue starts the
    // separate game outro; the final result is already on the display.
    return { ...sameStep(state), soundCueKey: "final_end" };
  },
};

export function createEngine({ store, loadQuestionPool, loadQuestions, loadAnswers, now = Date.now, computeCommitGate = async () => 0 }) {
  const deps = { loadQuestionPool, loadQuestions, loadAnswers, now };

  async function dispatchNow(action) {
    const reducer = REDUCERS[action.type];
    if (!reducer) throw new Error(`Nieznana akcja: ${action.type}`);
    // Po osiągnięciu celu lub odsłonięciu całego finału pozostaje tylko
    // ręczne „Zakończ finał”. Blokada obejmuje też spóźnione akcje w kolejce.
    const runtime = store.state.final?.runtime;
    const awaitingFinalEnd = /^f_p[12]_map_q[1-5]$/.test(store.state.step) &&
      (runtime?.reached200 || (store.state.step === "f_p2_map_q5" && runtime.map2.every((answer) => answer.revealedPoints)));
    if (awaitingFinalEnd && action.type !== "NEXT_QUESTION") return null;
    if (store.state.step === "r_play" && ["PLAY", "STEAL"].includes(store.state.phase) &&
        store.state.rounds.canEndRound && previewPendingRoundEndDestination(store.state) === "GAME_END" &&
        action.type !== "END_ROUND") return null;

    const previousRow = store.state.__row || null;
    const result = await reducer(store.state, action, deps);
    if (!result) return null; // no-op, świadomie — akcja nie miała zastosowania
    // 3s zegarek nie blokuje innych akcji (zgłoszone 2026-10-20): każda inna
    // akcja operatora w trakcie odliczania jest decyzją, więc zegarek gaśnie
    // bez naliczania X — inaczej późniejsze EXPIRE_TIMER3 dokładałoby pudło
    // (i jego dźwięk z blokadą) po już odsłoniętej odpowiedzi.
    if (!TIMER3_ACTIONS.has(action.type) && store.state.rounds?.timer3?.running) {
      store.state.rounds.timer3 = { running: false, endsAt: 0, resolved: null };
    }

    // Tabela stanów jest tu MECHANIZMEM, nie dokumentacją: nielegalny skok
    // (błąd w reducerze, nieuwzględniona gałąź) rzuca zamiast po cichu
    // zepsuć stan gry.
    assertTransition(store.state.step, result.step);

    store.state.step = result.step;
    store.state.phase = result.phase ?? null;
    store.state.controlTeam = result.controlTeam ?? null;
    store.state.topCard = result.topCard ?? store.state.topCard;

    const proposedRow = { step: result.step, sound_cue_key: result.soundCueKey,
      sound_cue_seq: (previousRow?.sound_cue_seq || 0) + (result.soundCueKey ? 1 : 0) };
    const lockMs = await computeCommitGate(action.type, previousRow, proposedRow);
    return store.commit({ soundCueKey: result.soundCueKey, lockMs });
  }

  // Zserializowane — bez tego dwa dispatch() wystrzelone bez odczekania na
  // pierwszy (potwierdzony na żywo w control2.spec.js's "pełna runda": test
  // klika kolejne odsłonięcia odpowiedzi bez czekania na zapis, `.click()`
  // Playwrighta wraca zanim async handler w app.js w ogóle zacznie czekać na
  // sieć) mogą nachodzić na siebie DWA razy nad tym samym `store.state` —
  // reducer #2 czyta stan PRZED zmutowaniem go przez #1 (bo `await
  // reducer(...)` oddaje sterowanie choć na jeden mikrotask, nawet gdy
  // reducer nic realnie nie czeka), gubiąc zmianę #1 (lost update), a ich
  // store.commit() ścigają się o ten sam `rev` — potwierdzone na żywo
  // (`[store] commit() NAKŁADA SIĘ — 3 równocześnie w locie`), gdzie nawet
  // pojedynczy retry na stale_write w store.js nie wystarczał na 3-stronny
  // wyścig. Kolejka gwarantuje, że KAŻDY dispatch (reducer + commit razem)
  // w pełni się kończy, zanim zacznie się następny — więc każdy reducer
  // zawsze widzi już w pełni osiadły stan z poprzedniej akcji, nie tylko
  // sam zapis do bazy. Testy jednostkowe już zawsze `await`-ują każdy
  // dispatch po kolei, więc kolejka jest dla nich no-opem (kolejny dispatch
  // i tak nigdy nie startuje, zanim poprzedni się nie rozstrzygnie).
  let _queue = Promise.resolve();
  function dispatch(action) {
    const run = () => dispatchNow(action);
    const result = _queue.then(run, run);
    _queue = result.catch(() => {});
    return result;
  }

  return { dispatch };
}
