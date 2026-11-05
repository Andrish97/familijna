import { t } from "../../translation/translation.js?v=v2026-11-05T20040";

// web/js/gameplay/hints.js
// Blok podpowiedzi nad siatką (control/js/ui.js) — odpowiednik starego
// control/js/gameRounds.js's/gameFinal.js's setDuelMsg/setPlayMsg/
// setStealMsg/setRevealMsg/setEndMsg/ROUNDS_MSG/FINAL_MSG, ale bez
// imperatywnego "ustaw wiadomość, gdy coś się zdarzy": tu wszystko idzie
// przez tabelę stanów — to jest CZYSTA funkcja odczytująca bieżący
// game_state (step/phase/detail) i zwracająca jeden, zawsze aktualny tekst,
// dokładnie tak samo jak reszta renderowania w tym projekcie. Zero
// osobnego, ulotnego stanu "ostatni komunikat" do synchronizowania.
//
// Zero importów przeglądarkowych — testowalne w gołym Node, jak
// gameStateMachine.js/deriveEvents.js.

// "A"/"B" to wewnętrzne kody drużyn (public.game_team) — nigdy nie
// pokazujemy ich operatorowi wprost, tylko realną nazwę wpisaną w
// ustawieniach gry (state.teams.teamA/teamB). Reużywane przez
// control/js/ui.js (pasek statusu, ekran pojedynku), żeby te same litery
// nie były tłumaczone w dwóch miejscach dwoma różnymi kawałkami kodu.
export function teamName(state, code) {
  if (code === "A") return state.teams?.defaultA === true ? t("control.teamADefault") : state.teams?.teamA || t("control.teamADefault");
  if (code === "B") return state.teams?.defaultB === true ? t("control.teamBDefault") : state.teams?.teamB || t("control.teamBDefault");
  return code || "—";
}

export function getRoundsHint(state) {
  const r = state.rounds;
  // Ekrany przejściowe (r_intro, r_roundStart) mają własny opis w c2-intro.
  if (state.step !== "r_duel" && state.step !== "r_play") return "";

  // Uwaga: hinty celowo NIE powtarzają tego, co już widać na pasku statusu
  // pod siatką (kto ma kontrolę / bank / kradzież) — tylko podpowiadają
  // KOLEJNY krok. Kto teraz odpowiada w pojedynku (DUEL) nie jest na pasku
  // statusu (ten pokazuje tylko controlTeam, który w DUEL jest jeszcze
  // pusty), więc tu zostaje.
  if (state.phase === "DUEL") {
    if (!r.duel.firstTeam) {
      if (r.duel.lastPressed) {
        return t("control.hints.duelFirst", { team: teamName(state, r.duel.lastPressed) });
      }
      return state.settings.physicalBuzzer
        ? t("control.hints.duelPhysical")
        : t("control.hints.duelWaiting");
    }
    // Reguła pojedynku (engine.js's duelRegisterResult): najwyżej punktowana
    // odpowiedź wygrywa od razu; inaczej odpowiada druga drużyna i wygrywa
    // wyższa, remis -- drużyna, która odpowiadała pierwsza w tym cyklu.
    return r.duel.cycleFirstAnswered
      ? t("control.hints.duelNowAnswering", { team: teamName(state, r.duel.currentTeam), first: teamName(state, r.duel.firstTeam) })
      : t("control.hints.duelAnswering", { team: teamName(state, r.duel.currentTeam) });
  }

  if (state.phase === "PLAY") {
    if (!state.controlTeam) return "";
    if (r.canEndRound) return t("control.hints.playCanEnd");
    if (r.allowPass && !r.passUsed) return t("control.hints.playOrPass");
    return t("control.hints.playPick");
  }

  if (state.phase === "STEAL") {
    if (r.steal.used) {
      return r.steal.won
        ? t("control.hints.stealWon")
        : t("control.hints.stealLost");
    }
    return t("control.hints.stealChance");
  }

  if (state.phase === "REVEAL") {
    return t("control.hints.reveal");
  }

  return "";
}

export function getFinalHint(state) {
  const f = state.final;
  const step = state.step;

  // Ekrany przejściowe (f_start, f_p2_start, f_end) mają własny opis w c2-intro.
  if (step === "f_p1_entry" || step === "f_p2_entry") {
    const round = step === "f_p1_entry" ? 1 : 2;
    const timer = f.runtime.timer;
    const phaseKey = round === 1 ? "P1" : "P2";
    const running = timer.running && timer.phase === phaseKey;
    // `used` (ustawiane już w momencie startu, nie dopiero po wygaśnięciu)
    // samo w sobie więc NIE wystarcza do "Czas wykorzystany" — trzeba
    // dodatkowo sprawdzić, że zegarek faktycznie już nie chodzi.
    const used = round === 1 ? timer.usedP1 : timer.usedP2;
    // Runda 2: przypomnienie o przycisku "Powtórzenie" — dopisane do KAŻDEJ
    // gałęzi poza "czas wykorzystany" (tam nie ma już czego pilnować),
    // żeby operator nie wpisywał ręcznie tego, co gracz 2 tylko powtórzył.
    if (used && !running) return t("control.hints.entryTimeUp");
    if (running) return t("control.hints.entryRunning", { round });
    return t("control.hints.entryIdle", { round });
  }

  if (step.startsWith("f_p1_map_q") || step.startsWith("f_p2_map_q")) {
    const round = step.startsWith("f_p1_map_q") ? 1 : 2;
    const idx = Number(step.slice(-1)) - 1;
    const entry = f.runtime[round === 1 ? "p1" : "p2"][idx] || {};
    const row = f.runtime[round === 1 ? "map1" : "map2"][idx];
    if (f.runtime.reached200) return t("control.hints.mapReached200", { target: state.settings.finalTarget });
    if (round === 2 && idx === 4 && row.revealedPoints) return t("control.hints.mapAllRevealed");
    // Rozstrzygnięcie jest ZAWSZE już jakieś, nawet zanim operator cokolwiek
    // kliknął (domyślnie: dopasowanie z listy jeśli wybrane ręcznie, inaczej
    // "Nie ma na liście" gdy coś wpisano / "Brak odpowiedzi" gdy pusto —
    // control/js/ui.js's effectiveMappingResolution) — nie ma tu wyboru
    // "X albo Y", tylko potwierdzenie tego, co już jest zaznaczone.
    // Powtórzenie + jeszcze nieodsłonięte: oba zdania razem (zgłoszone) —
    // operator ma wiedzieć NARAZ że to powtórzenie ORAZ co ma zrobić dalej,
    // nie dwa osobne, następujące po sobie stany hinta.
    if (round === 2 && entry.repeat && !row.revealedAnswer) {
      return t("control.hints.mapRepeat");
    }
    if (!row.revealedAnswer) return t("control.hints.mapRevealAnswer");
    if (!row.revealedPoints) return t("control.hints.mapRevealPoints");
    // Po odsłonięciu zostaje tylko „Dalej” -- oczywiste, bez podpowiedzi.
    return "";
  }

  return "";
}

// Skróty klawiszowe z dawnego control/js/gameFinal.js's renderP1Entry/
// renderP2Entry/handleFinalTimerHotkey — działają WYŁĄCZNIE na krokach
// wpisywania (f_p1_entry/f_p2_entry), dopisywane pod głównym hintem
// (control/js/ui.js's hintBlock), nie osobno. Runda 2 dostaje dodatkowo
// Shift+Enter (przełącznik "Powtórzenie") — runda 1 go nie ma, bo tam nie
// ma czego powtarzać.
export function getFinalEntryShortcuts(round) {
  const shortcuts = [
    t("control.shortcuts.fields"),
    t("control.shortcuts.entryTimer"),
  ];
  if (round === 2) shortcuts.push(t("control.shortcuts.entryRepeat"));
  shortcuts.push(t("control.shortcuts.m"));
  return shortcuts;
}
