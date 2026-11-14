// control/display/js/soundReactor.js
// Odpowiednik control/js/soundReactor.js, ale czytający WYŁĄCZNIE
// odczytany z bazy wiersz game_state (nie lokalny, świeży stan Control) —
// zgłoszone: dźwięk ma móc grać z Wyświetlacza zamiast Control, sterowany
// stanem z bazy, nie sekwencją wywołań jednego konkretnego urządzenia.
// Reguły "który SOUND_CUE gra jaką kombinację" żyją we wspólnym
// web/js/gameplay/soundCueEngine.js, reużytym 1:1 przez oba reaktory.
//
// Gated na `detail.settings.soundSource==="display"` — gdy operator zostawi
// domyślne "control", ten reaktor po prostu nic nie robi (zero podwójnego
// odtwarzania z dwóch urządzeń naraz).

import { playSfx, getSfxDurationAccurate as getSfxDuration, stopSfx, setSfxMuted } from "../../../shared/js/core/sfx.js?v=v2026-11-14T11110";
import { createSoundCueEngine } from "../../../shared/js/gameplay/soundCueEngine.js?v=v2026-11-14T11110";


export function createDisplaySoundReactor() {
  const engine = createSoundCueEngine({ playSfx, getSfxDuration, stopSfx });
  let prevRow = null;

  function onRow(row) {
    if (!row) return;
    setSfxMuted(row.detail?.settings?.soundMuted);
    if (prevRow) {
      const settings = row.detail?.settings || {};
      const isDisplaySource = settings.soundSource === "display";
      if (isDisplaySource) {
        engine.handleTransition(prevRow, row);
      } else {
        engine.cancel();
      }
    }
    prevRow = row;
  }

  return {
    onRow,
    cancel() {
      engine.cancel();
      prevRow = null;
      setSfxMuted(true);
    },
  };
}
