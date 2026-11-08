// web/js/gameplay/previewRow.js
//
// Wspólny budowniczy przykładowego wiersza game_state do podglądu
// Wyświetlacza (kolory/motyw/nazwy drużyn) przed startem gry — display2 umie
// renderować WYŁĄCZNIE prawdziwy wiersz game_state (patrz control/display/js/main.js's
// bootPreview(), tryb ?preview=1: żadnej autoryzacji/subskrypcji, tylko
// postMessage {type:"familijna:preview-row", row} z gotowym, spreparowanym
// wierszem), więc każde miejsce chcące pokazać ten podgląd musi dostarczyć
// wiersz w tym samym kształcie.
//
// UŻYWANE W KILKU MIEJSCACH — jedna funkcja zamiast osobnych niezależnych
// implementacji, żeby się nie rozjechały:
//   - control/js/ui.js's renderSetupFinish (D3, podsumowanie przed startem)
//   - js/pages/game-settings.js (modal ustawień gry w Control v2)
//   - js/pages/game-settings.js (oryginał — modal w starym control.html ORAZ
//     samodzielnie spod /game-settings)
//
// Stały układ podglądu (ustalony wprost, nie zgadywany):
//   - big: aktualne logo gry (step="r_intro" — jedyny krok, w którym
//     control/display/js/render.js's paintForStep() maluje logo na "big")
//   - small: prawo=123, góra=456, lewo=789 — przykładowe cyfry, każda
//     trójka inna, żeby pokazać wszystkie kształty czcionki na raz
//   - długie: lewo=drużyna A, prawo=drużyna B (paintTeamNames, wywoływane
//     też dla r_intro — "small" to płótno NIEZALEŻNE od "big", więc logo i
//     nazwy drużyn/cyfry pokazują się razem, mimo że w prawdziwej grze te
//     cyfry akurat o tej porze jeszcze nie istnieją)
//   - wskaźnik: wyłączony
//   - motyw/kolory: aktualnie ustawione (stosowane bezwarunkowo w
//     control/display/js/render.js's renderSnapshot(), niezależnie od kroku)
// Cyfry/wskaźnik idą wprost przez scene.api w control/display/js/main.js's
// bootPreview() (czysto demonstracyjne, żaden prawdziwy stan gry ich tak
// nie niesie) — ten moduł buduje tylko to, co MA sens jako realny wiersz
// game_state (logo/drużyny/kolory/motyw).
//
// `logoPreview` — jawny payload logo {type, payload} (albo null dla
// domyślnego) do podglądu WYŁĄCZNIE JESZCZE NIEZAPISANEGO wyboru w
// formularzu (js/pages/game-settings.js's logo grid) — scene.js's
// bindGame()/reload() czytają logo z bazy, więc nie zobaczyłyby takiego
// wyboru wcale. Pomiń ten parametr całkowicie (D3 — control/js/ui.js),
// gdy podgląd ma pokazywać logo JUŻ ZAPISANEJ gry: iframe wtedy dostaje
// prawdziwe ?id= w URL, a control/display/js/main.js's bootPreview() sam woła
// bindGame(id) — przekazanie tu logoPreview:null nadpisałoby to z powrotem
// na domyślne.

import { t } from "../../translation/translation.js?v=v2026-11-08T16070";
export function buildDisplayPreviewRow({ teams, display, logoPreview } = {}) {
  const displayDetail = {
    mode: "GAME",
    colors: display?.colors,
    theme: display?.theme,
    logoId: display?.logoId,
    hostLogoMode: display?.hostLogoMode === "pixel" ? "pixel" : "source",
    qr: { host: { show: false }, buzzer: { show: false } },
  };
  if (logoPreview !== undefined) displayDetail.logoPreview = logoPreview;

  return {
    top_card: "rounds", step: "r_intro", phase: null, control_team: null,
    sound_cue_key: null, sound_cue_seq: 0,
    detail: {
      teams: { teamA: teams?.teamA || t("gameSettings.teams.defaultA"), teamB: teams?.teamB || t("gameSettings.teams.defaultB"), defaultA: teams?.defaultA === true || !teams?.teamA, defaultB: teams?.defaultB === true || !teams?.teamB },
      rounds: { roundNo: 1, bankPts: 0, xA: 0, xB: 0, totals: { A: 0, B: 0 } },
      final: { runtime: {} },
      display: displayDetail,
      // Settings/Control previews must show the Host's covered band: this is
      // where the selected Host logo is presented. It is preview-only state;
      // live game state still owns the actual cover gesture.
      host: { covered: true },
      locks: { gameEnded: false },
    },
  };
}
