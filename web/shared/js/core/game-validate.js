// js/core/game-validate.js
import { sb } from "./supabase.js?v=v2026-11-08T16070";
import { t, withLangParam } from "../../translation/translation.js?v=v2026-11-08T16070";
import { showBlockingOverlay, isResourceBusy } from "./resource-lock.js?v=v2026-11-08T16070";
import { confirmModal, alertModal } from "./modal.js?v=v2026-11-08T16070";


// Typy, statusy, progi i evaluateReadiness: game-rules.js (bez zależności
// od przeglądarki, testowane jednostkowo i porównywane z SQL).
export { TYPES, STATUS, RULES, evaluateReadiness } from "./game-rules.js?v=v2026-11-08T16070";

/** Przetłumaczony opis braku z evaluateReadiness / readiness bazy. */
export const readinessText = (issue) => t(`gameValidate.${issue?.code || "unknownType"}`, issue?.params || {});

export async function loadGameBasic(gameId) {
  const { data, error } = await sb()
    .from("games")
    .select("id,name,type,status")
    .eq("id", gameId)
    .single();
  if (error) throw error;
  return data;
}

export async function loadQuestions(gameId) {
  const { data, error } = await sb()
    .from("questions")
    .select("id,ord,text")
    .eq("game_id", gameId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadAnswers(questionId) {
  const { data, error } = await sb()
    .from("answers")
    .select("id,ord,text,fixed_points")
    .eq("question_id", questionId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return data || [];
}

/* ====== walidacja: tylko w bazie ====== */

// Reguły (czy wolno edytować / grać / otworzyć lub zamknąć ankietę) liczy
// RPC game_validate (migracja 273) -- jedno źródło prawdy dla games, editor,
// polls, subscriptions i control. Tu tylko tłumaczymy kod błędu na tekst.
// Każda akcja: { ok, reason } (+ needsReset dla edit).
const ACTIONS = ["edit", "change_type", "duplicate", "send", "play", "poll_entry", "poll_open", "poll_stop", "poll_resume", "poll_close", "export"];

function actionResult(raw) {
  const ok = !!raw?.ok;
  return {
    ok,
    reason: ok ? "" : t(`gameValidate.${raw?.code || "unknownType"}`, raw?.params || {}),
    code: raw?.code || "",
    needsReset: !!raw?.needs_reset,
    dropsVotes: !!raw?.drops_votes,
  };
}

/**
 * Stan gry i wszystkich akcji jednym zapytaniem.
 * Zwraca { game: {id,type,status,rev}, rules, edit, play, poll_entry,
 * poll_open, poll_stop, poll_resume, poll_close, export }. Gra niedostępna -> każda akcja z
 * reason gameValidate.noGame.
 */
export async function validateGame(gameId) {
  const { data, error } = await sb().rpc("game_validate", { p_game_id: gameId });
  if (error) throw error;

  const out = { game: data?.game || null, rules: data?.rules || null, readiness: data?.readiness || null };
  for (const k of ACTIONS) {
    out[k] = data?.ok ? actionResult(data[k]) : actionResult({ ok: false, code: "noGame" });
  }
  return out;
}

/**
 * Zapisany stan z kolumny games.rules_state (migracja 275) -- ten sam kształt
 * co validateGame(), bez poll_close (zależy od głosów, tylko na żądanie).
 * null, gdy kolumny jeszcze nie ma / pusta -- wtedy wołający pyta validateGame().
 */
export function rulesFromState(state) {
  if (!state || typeof state !== "object") return null;
  const out = { rules: state.rules || null, readiness: state.readiness || null };
  for (const k of ACTIONS) {
    if (k === "poll_close") continue;
    out[k] = actionResult(state[k]);
  }
  return out;
}

/**
 * Warstwa 2 (migracja 274): baza sama odrzuca zapis łamiący reguły --
 * 'game_content_locked:<powód>' (treść gry przy otwartej lub zatrzymanej
 * ankiecie / kopii ze Społeczności) albo 'poll_close_blocked:<kod>' (podliczenie
 * ankiety bez spełnionych warunków). Zwraca przetłumaczony komunikat albo "" dla innych
 * błędów.
 */
export function gameRuleErrorMessage(err) {
  const m = String(err?.message || "");
  if (m.includes("game_content_locked:poll_open")) return t("gameValidate.pollOpenNoEdit");
  if (m.includes("game_content_locked:poll_stopped")) return t("gameValidate.pollStoppedNoEdit");
  if (m.includes("game_content_locked:market")) return t("gameValidate.marketNoEdit");
  if (m.includes("game_content_locked:control_active")) return t("gameValidate.controlActive");
  // walidacja zapisu tekstów (migracja 404): oba edytory pytań
  const bad = m.match(/content_invalid:(\w+)(?::(.*))?/);
  if (bad) return t(`gameValidate.${bad[1]}`, { chars: (bad[2] || "").trim() });
  // wyjątki RPC Zatrzymaj / Wznów / Podlicz (migracja 315)
  if (/\bpoll_not_open\b/.test(m)) return t("gameValidate.stopOnlyOpen");
  if (/\bpoll_not_stopped\b/.test(m)) return t("gameValidate.resumeOnlyStopped");
  const close = m.match(/poll_close_blocked:(\w+):(\d*)/);
  if (close?.[1] === "tallyMinVotes") return t("gameValidate.tallyMinVotes", { min: 10, n: close[2] || "0" });
  if (close) return t(`gameValidate.${close[1]}`, { ord: close[2] || "?" });
  return "";
}

/**
 * Blokada stanu strony gry (familijna-server/docs/blokady-zasobow.md, „Blokady stanu i akcji”):
 * strona, której stan gry nie pozwala na pracę, blokuje się w całości tym
 * samym pełnoekranowym komunikatem co zajęty zasób — także przy wejściu
 * ręcznie wpisanym adresem. Wywoływać PO wzięciu blokady zasobu.
 * @param {string} gameId
 * @param {"edit"|"play"|"poll_entry"} action
 * @returns {Promise<object|null>} wynik akcji (ok) albo null (strona zablokowana)
 */
// check: już wysłane validateGame(gameId) (strona puszcza je równolegle
// z innym sprawdzeniem po blokadzie) — bez drugiego zapytania.
export async function guardGameState(gameId, action, { backHref = "/games/", check = null } = {}) {
  let res = null;
  try {
    res = (await (check || validateGame(gameId)))[action];
  } catch (e) {
    console.error("[game-validate] guardGameState:", e);
    res = { ok: false, reason: t("gameValidate.noGame") };
  }
  if (res?.ok) return res;
  showBlockingOverlay({
    title: t("gameValidate.stateBlockedTitle"),
    message: res?.reason || t("gameValidate.noGame"),
    backHref: withLangParam(backHref),
  });
  return null;
}

const RESET_ERRORS = {
  control_active: "gameValidate.controlActive",
  poll_open: "gameValidate.pollOpenNoEdit",
  poll_stopped: "gameValidate.pollStoppedNoEdit",
};

/**
 * Wspólna bramka edycji (lista Gier, edytor, Zmień typ): reguła edit z bazy,
 * a dla zamkniętej ankiety jedno potwierdzenie i pełny reset
 * (game_reset_poll_for_edit). Odmowa i błąd -- komunikat w alertModal.
 * @param {string} gameId
 * @param {{ action?: "edit"|"change_type", resetNow?: boolean, checkBusy?: boolean }} opts
 *   resetNow=false: tylko zgoda (reset wykona wołający RPC, np. game_change_type).
 * @returns {Promise<{ ok: boolean, reset: boolean }>}
 */
export async function editGate(gameId, { action = "edit", resetNow = true, checkBusy = false } = {}) {
  let info;
  try {
    info = (await validateGame(gameId))[action];
  } catch (e) {
    console.error("[game-validate] editGate:", e);
    void alertModal({ text: t("gameValidate.noGame") });
    return { ok: false, reset: false };
  }
  if (!info?.ok) {
    void alertModal({ text: info?.reason || t("gameValidate.noGame") });
    return { ok: false, reset: false };
  }
  if (!info.needsReset) return { ok: true, reset: false };

  const ok = await confirmModal({
    title: t("gameValidate.editAfterPoll.title"),
    text: t("gameValidate.editAfterPoll.text"),
    okText: t("gameValidate.editAfterPoll.ok"),
    cancelText: t("gameValidate.editAfterPoll.cancel"),
  });
  if (!ok) return { ok: false, reset: false };
  if (!resetNow) return { ok: true, reset: true };

  // Zasób zajęty w innej karcie (edytor/ustawienia/ankieta) -- nie resetujemy spod ręki.
  if (checkBusy && await isResourceBusy("game", gameId)) {
    void alertModal({ text: t("resourceLock.gameMessage") });
    return { ok: false, reset: false };
  }
  const { data, error } = await sb().rpc("game_reset_poll_for_edit", { p_game_id: gameId });
  if (error || !data?.ok) {
    console.error("[game-validate] reset:", error || data);
    void alertModal({ text: t(RESET_ERRORS[data?.error] || "gameValidate.resetFailed") });
    return { ok: false, reset: false };
  }
  return { ok: true, reset: true };
}
