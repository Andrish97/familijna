// control/js/soundReactor.js
// Dźwięk zostaje częścią Control (plan, decyzja z negocjacji), ale
// "sterowany stanem" zamiast wywoływany wprost z logiki gry (silnik/engine.js
// nigdy nie woła playSfx() bezpośrednio — tylko zapisuje sound_cue_key do
// wiersza, dokładnie jak każdą inną zmianę stanu).
//
// Subskrybuje WŁASNY, świeży stan Control (store.subscribe), nie odczyt z
// bazy — zero opóźnienia względem tego, co operator właśnie zrobił. Reguły
// "który SOUND_CUE gra jaką kombinację" żyją teraz w web/js/gameplay/soundCueEngine.js
// (reużyte też przez control/display/js/soundReactor.js — zgłoszone: dźwięk ma móc
// grać z Wyświetlacza zamiast Control).
//
// Źródło dźwięku (`settings.soundSource`, "control"/"display") i wyciszenie
// (`settings.soundMuted`) są teraz częścią WSPÓLNEGO game_state, nie
// lokalnego localStorage jak wcześniej — mute musi działać niezależnie od
// tego, które urządzenie faktycznie odtwarza (zgłoszone), więc nie może
// żyć tylko w tej karcie. Ten reaktor gra WYŁĄCZNIE gdy soundSource==="control"
// (domyślnie) — gdy operator przełączy na "display", ten sam mechanizm w
// control/display/js/soundReactor.js przejmuje odtwarzanie, a ten tutaj po prostu
// nic nie robi (zero podwójnego odtwarzania).

import { playSfx, getSfxDurationAccurate as getSfxDuration, stopSfx, setSfxMuted, applySfxGameSettings } from "../../shared/js/core/sfx.js?v=v2026-11-04T18552";
import { createSoundCueEngine } from "../../shared/js/gameplay/soundCueEngine.js?v=v2026-11-04T18552";


export function createSoundReactor(store, { waitForStart = null } = {}) {
  const engine = createSoundCueEngine({ playSfx, getSfxDuration, stopSfx, waitForStart });
  let prevRow = null;
  let appliedSound = null;
  function syncSoundSettings(settings) {
    const sound = settings?.sound || {};
    const signature = JSON.stringify(sound);
    if (signature !== appliedSound) {
      applySfxGameSettings(sound);
      appliedSound = signature;
    }
  }

  function onStateChange(state) {
    syncSoundSettings(state.settings);
    setSfxMuted(state.settings?.soundMuted);
    const nextRow = state.__row;
    if (!nextRow) return;
    // Pierwsze wywołanie po hydrate()/pierwszym commit() — brak
    // poprzedniego wiersza daje tylko SNAPSHOT_RENDER (patrz deriveEvents),
    // co tu jednoznacznie oznacza "nic nie graj" (nie chcemy dźwięku samego
    // wznowienia/odczytu, tylko realnych zmian).
    if (prevRow) {
      const settings = state.settings || {};
      const isControlSource = (settings.soundSource || "control") === "control";
      if (isControlSource) {
        engine.handleTransition(prevRow, nextRow);
      } else {
        engine.cancel();
      }
    }
    prevRow = nextRow;
  }

  const unsubscribe = store.subscribe(onStateChange);
  // Stan mógł już być załadowany (hydrate()) zanim ten reaktor powstał —
  // złap go od razu, żeby prevRow nie zostało puste do pierwszej zmiany.
  syncSoundSettings(store.state.settings);
  setSfxMuted(store.state.settings?.soundMuted);
  if (store.state.__row) prevRow = store.state.__row;

  return { destroy: unsubscribe };
}
