// E21: „Zmień typ” -- edycja tego samego rekordu (familijna-server/docs/reguly-gier-transfer-plan.md
// §4 „Zmiana typu gry”); konwersję wykonuje atomowo game_change_type. Wynik to
// szkic wybranego typu -- braki pokaże silnik reguł. Zamknięta ankieta (decyzja
// 2026-10-21): bez osobnego pytania o reset -- to okno jest potwierdzeniem; głosy
// ankiety znikają, a wyniki (odpowiedzi, punkty) można zachować, gdy nowy typ je
// wykorzysta (migracja 441, p_keep).
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-14T13241";
import { t } from "../../shared/translation/translation.js?v=v2026-11-14T13241";
import { confirmModal, alertModal } from "../../shared/js/core/modal.js?v=v2026-11-14T13241";
import { isResourceBusy } from "../../shared/js/core/resource-lock.js?v=v2026-11-14T13241";
import { validateGame, TYPES } from "../../shared/js/core/game-validate.js?v=v2026-11-14T13241";

const SOURCE_TYPES = [TYPES.PREPARED, TYPES.POLL_POINTS, TYPES.POLL_TEXT];
// Nazwy typów jak na zakładkach Gier.
const TAB_KEY = { [TYPES.PREPARED]: "prepared", [TYPES.POLL_POINTS]: "pollPoints", [TYPES.POLL_TEXT]: "pollText" };

/**
 * Klucz opisu konwersji -- tylko to, co zrobi sama operacja na danych
 * (game_change_type); null -- ten sam typ.
 */
export function conversionKey(from, to) {
  if (from === to) return null;
  if (to === TYPES.POLL_TEXT) return "toText";
  if (to === TYPES.POLL_POINTS) return "toPoints";
  return "toPrepared";
}

// Co można zachować z zamkniętej ankiety przy zmianie na dany typ (klucz
// podpisu pola wyboru) -- null: nic (np. -> ankieta tekstowa: same pytania).
export function keepKey(from, to) {
  if (from === to || to === TYPES.POLL_TEXT) return null;
  if (to === TYPES.PREPARED) return from === TYPES.POLL_TEXT ? "answersPoints" : "points";
  if (to === TYPES.POLL_POINTS && from === TYPES.POLL_TEXT) return "answers";
  return null;
}

// Opis skutku: szkic -- sama konwersja; zamknięta ankieta -- także to, co
// zostanie z wyników (zależnie od pola „Zachowaj …”).
export function summaryKey(from, to, { closed = false, keep = false } = {}) {
  const key = conversionKey(from, to);
  if (!key || !closed || key === "toText") return key || "same";
  const what = keepKey(from, to);
  if (what === "points") return keep ? "keepAll" : "toPoints";
  if (what === "answersPoints") return keep ? "keepAll" : "questionsOnly";
  if (what === "answers") return keep ? "keepAnswers" : "questionsOnly";
  return key;
}

// Karta na typ: nazwa jak na zakładce Gier i skutek zmiany; obecny typ
// wyłączony, domyślnie wybrany pierwszy inny. Przy zamkniętej ankiecie
// wybrana karta ma pole „Zachowaj …” -- domyślnie odznaczone: wszystko, co
// powstało w wyniku ankiety, znika (decyzja użytkownika 2026-10-21).
function buildBody(current, closed) {
  const box = document.createElement("div");
  box.className = "change-type";
  box.setAttribute("role", "radiogroup");
  box.setAttribute("aria-label", t("games.changeType.title"));
  const first = SOURCE_TYPES.find((type) => type !== current);
  const keeps = new Map();
  for (const type of SOURCE_TYPES) {
    const label = document.createElement("label");
    label.className = "change-type-option";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "changeType";
    input.value = type;
    input.checked = type === first;
    input.disabled = type === current;
    const name = document.createElement("span");
    name.className = "change-type-name";
    name.textContent = t(`games.tabs.${TAB_KEY[type]}`);
    const desc = document.createElement("span");
    desc.className = "change-type-desc";
    label.append(input, name, desc);
    const what = closed ? keepKey(current, type) : null;
    let keep = null;
    if (what) {
      const row = document.createElement("span");
      row.className = "change-type-keep";
      keep = document.createElement("input");
      keep.type = "checkbox";
      keep.checked = false;
      const text = document.createElement("span");
      text.textContent = t(`games.changeType.keep.${what}`);
      row.append(keep, text);
      label.append(row);
      keeps.set(type, keep);
    }
    const render = () => {
      desc.textContent = t(`games.changeType.summary.${summaryKey(current, type, { closed, keep: !!keep?.checked })}`);
    };
    keep?.addEventListener("change", render);
    render();
    box.append(label);
  }
  const picked = () => box.querySelector('input[name="changeType"]:checked')?.value;
  return { box, picked, keep: () => !!keeps.get(picked())?.checked };
}

/**
 * @param {{id: string, type: string}} game
 * @returns {Promise<string|null>} nowy typ albo null (anulowano / odmowa)
 */
export async function changeGameType(game) {
  if (!game || !SOURCE_TYPES.includes(game.type)) return null;
  let info;
  try {
    info = (await validateGame(game.id)).change_type;
  } catch (e) {
    console.error("[games] change_type validate:", e);
    void alertModal({ text: t("gameValidate.noGame") });
    return null;
  }
  if (!info?.ok) {
    void alertModal({ text: info?.reason || t("gameValidate.noGame") });
    return null;
  }
  const closed = !!info.needsReset;

  const { box, picked, keep } = buildBody(game.type, closed);
  const ok = await confirmModal({
    title: t("games.changeType.title"),
    text: t(closed ? "games.changeType.textClosed" : "games.changeType.text"),
    okText: t("games.changeType.ok"),
    cancelText: t("games.changeType.cancel"),
    body: box,
    // na telefonie okno zastępuje stronę (wzorzec okien formularzowych)
    sheet: { backBtn: document.getElementById("btnBackSheet") },
  });
  const to = picked();
  if (!ok || !to || to === game.type) return null;

  if (await isResourceBusy("game", game.id)) {
    void alertModal({ text: t("resourceLock.gameMessage") });
    return null;
  }
  const { data, error } = await sb().rpc("game_change_type", { p_game_id: game.id, p_type: to, p_reset: closed, p_keep: closed && keep() });
  if (error || !data?.ok) {
    console.error("[games] game_change_type:", error || data);
    const code = data?.code ? `gameValidate.${data.code}` : "games.changeType.failed";
    void alertModal({ text: t(code) });
    return null;
  }
  return data.type || to;
}
