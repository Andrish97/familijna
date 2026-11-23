// E30: zapis treści gry przez endpointy bazy (migracja 534) — wspólne dla
// edytora, listy gier i czatu AI. Baza sprawdza właściciela, reguły edycji,
// aktywną rozgrywkę i blokady innych kart; ta karta podaje swój identyfikator,
// więc własna blokada (edytor otwarty w tej karcie) nie przeszkadza.
import { sb } from "./supabase.js";
import { getTabId } from "./resource-lock.js";
import { ROW_GONE } from "./db-guard.js";

const GONE = new Set(["not_found_or_forbidden", "question_not_found", "answer_not_found"]);

// Odmowa endpointu jako wyjątek: code = kod błędu ('locked', 'edit_blocked',
// 'too_many_answers'…; zniknięty wiersz = ROW_GONE), message zrozumiały dla
// gameRuleErrorMessage (edit_blocked:<kod reguły>, content_invalid:…).
export function contentError(res) {
  const err = String(res?.error || "unknown_error");
  const message = err === "edit_blocked" && res?.code ? `edit_blocked:${res.code}` : err;
  const e = new Error(message);
  e.code = GONE.has(err) ? ROW_GONE : err;
  e.result = res;
  return e;
}

async function call(fn, args) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  if (!data?.ok) throw contentError(data);
  return data;
}

/**
 * Zestaw zmian treści gry w jednej transakcji (wszystko albo nic).
 * Operacje: rename, add_question, update_question, delete_question,
 * move_question, set_answers, add_answer, update_answer, delete_answer.
 * @param {string} gameId
 * @param {object[]} ops
 * @param {{ reset?: boolean }} [opts] reset — zgoda na wyzerowanie wyników zamkniętej ankiety
 */
export function applyGameContent(gameId, ops, { reset = false } = {}) {
  return call("game_content_apply", { p_game_id: gameId, p_ops: ops, p_tab_id: getTabId(), p_reset: reset });
}

/** Nowa gra w szkicu, opcjonalnie od razu z pytaniami [{text, answers:[{text, points}]}]. */
export function createGameWithContent(type, name, questions = null) {
  return call("game_create", { p_type: type, p_name: name, p_questions: questions });
}

/** Ustawienia gry: zapis tylko, gdy w bazie są wciąż `expected` (inaczej błąd 'conflict'). */
export function saveGameSettings(gameId, expected, settings) {
  return call("game_settings_save", { p_game_id: gameId, p_expected: expected, p_settings: settings, p_tab_id: getTabId() });
}
