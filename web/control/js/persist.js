// control/js/persist.js
// Cienka warstwa nad RPC public.game_state_write
// (supabase/migrations/2026-09-03_260_game_state_rpcs.sql). Jedyne miejsce
// w control2, które zna nazwę RPC i kształt jej argumentów — store.js woła
// tylko write(), nie buduje samodzielnie zapytań do Supabase.
//
// Zasada z planu, sekcja 4: żaden zapis nie jest "cichy" — sukces zwraca
// pełny nowy wiersz, błąd zawsze rzuca (z rozróżnieniem stale_write, żeby
// UI mogło pokazać "gra sterowana z innej zakładki" zamiast zgadywać).

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T18554";


export class StaleWriteError extends Error {
  constructor() {
    super("stale_write");
    this.name = "StaleWriteError";
  }
}

// Migracja 264 — odrzucenie zapisu, dopóki game_state.locked_until > now()
// (dźwięk/animacja poprzedniego przejścia jeszcze trwa, egzekwowane w
// bazie, nie tylko w JS jednej karty przeglądarki).
export class LockedError extends Error {
  constructor() {
    super("locked");
    this.name = "LockedError";
  }
}

function throwForRpcError(error) {
  const msg = String(error?.message || "");
  if (msg.includes("stale_write")) throw new StaleWriteError();
  if (msg.includes("locked")) throw new LockedError();
  throw error;
}

// Na zerwanym łączu zapis bez limitu wisiał do czasu, aż przeglądarka sama
// porzuci połączenie (minuty). Po limicie Control dociąga stan z serwera
// (app.js), więc zapis, który jednak doszedł, nie zostanie zgubiony.
const WRITE_TIMEOUT_MS = 15_000;

export function createPersist(gameId) {
  async function write({ step, topCard, phase, controlTeam, detail, soundCueKey, expectedRev, lockMs }) {
    const { data, error } = await sb().rpc("game_state_write", {
      p_game_id: gameId,
      p_step: step,
      p_top_card: topCard,
      p_phase: phase ?? null,
      p_control_team: controlTeam ?? null,
      p_detail: detail ?? null,
      p_sound_cue_key: soundCueKey ?? null,
      p_expected_rev: expectedRev ?? null,
      p_lock_ms: lockMs ?? null,
    }).abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
    if (error) throwForRpcError(error);
    return data;
  }

  // Wołane PO potwierdzeniu write() powyżej -- realny czas dźwięku liczony
  // z POTWIERDZONEGO sound_cue_key (control/js/app.js's dispatchGated/
  // advance), więc to zawsze osobne, drugie wywołanie, nie część write().
  async function setLock({ expectedRev, lockMs }) {
    const { data, error } = await sb().rpc("game_state_set_lock", {
      p_game_id: gameId,
      p_expected_rev: expectedRev ?? null,
      p_lock_ms: lockMs,
    });
    if (error) throwForRpcError(error);
    return data;
  }

  // Migracja 267 -- osobne, lekkie RPC: jsonb_set WYŁĄCZNIE na
  // detail.settings.uiLang, celowo z pominięciem sprawdzania locked_until
  // (język operatora jest metadaną niezależną od trwającego dźwięku/
  // animacji akcji gry -- patrz komentarz w migracji). Nie przechodzi przez
  // write() ani przez pełny snapshot `detail`.
  async function setUiLang(lang) {
    const { data, error } = await sb().rpc("game_state_set_ui_lang", {
      p_game_id: gameId,
      p_ui_lang: lang,
    });
    if (error) throwForRpcError(error);
    return data;
  }

  // Migracja 268 -- ten sam wzorzec co setUiLang() wyżej, dla
  // detail.settings.soundMuted. Zgłoszone: klik #btnMute w środku rundy
  // (locked_until z ostatniej akcji jeszcze trwa) kończył się gołym
  // window.alert("Błąd: locked") -- wyciszenie jest metadaną operatora,
  // niezależną od treści rozgrywki (patrz komentarz w migracji).
  async function setSoundMuted(muted) {
    const { data, error } = await sb().rpc("game_state_set_sound_muted", {
      p_game_id: gameId,
      p_muted: muted,
    });
    if (error) throwForRpcError(error);
    return data;
  }

  return { write, setLock, setUiLang, setSoundMuted };
}
