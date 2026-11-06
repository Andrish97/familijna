// proposed-tile.js
// Kafel propozycji — jeden wygląd i jedno działanie dla zaproszenia do bazy
// (Bazy → Udostępnione) i otrzymanej kopii gry/logo (Moje gry, Moje loga):
// zwykły kafel siatki zaraz po kaflu „+”, oznaczenia „Propozycja” + „Od: X”,
// a zamiast kosza przyciski ✓ (przyjmij, złoty) i ✕ (odrzuć). Odrzucona
// kopia gry/logo przepada; zaproszenie do bazy da się przywrócić z paska
// „Odrzucone” w Bazach (decyzja 2026-10-21).
// Wygląd: base.css (.tag, .grid .tile .tileMiniActions).

import { t } from "../../translation/translation.js?v=v2026-11-06T00485";
import { icon } from "./icons.js?v=v2026-11-06T00485";


const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Kolor oznaczenia kafla wg znaczenia (.tag z base.css). */
export const TILE_TAG_VARIANT = { proposed: "tag--warn", from: "tag--info", role: "tag--gold", mine: "" };

/**
 * Oznaczenia kafla: {kind, text, title?, icon?} → spany .tag.tileBadge.
 * @param {{kind:string,text?:string,title?:string,icon?:string}[]} list
 */
export function tileTagsHtml(list) {
  return (list || []).map((x) => `<span class="tag ${TILE_TAG_VARIANT[x.kind] || ""} tileBadge" data-kind="${esc(x.kind)}" title="${esc(x.title || "")}">${x.icon ? icon(x.icon) : ""}${esc(x.text || "")}</span>`).join("");
}

/** „Propozycja” + „Od: X” — wspólne dla zaproszeń i kopii. */
export function proposedTags({ from, fromTitle = "", title }) {
  return [
    { kind: "proposed", text: t("resourceSend.proposed"), title },
    { kind: "from", text: t("resourceSend.from", { name: from || "—" }), title: fromTitle || from || "" },
  ];
}

/** Przyciski ✓/✕ kafla propozycji (w miejscu kosza). */
export function proposedActionsHtml() {
  const accept = esc(t("resourceSend.accept"));
  const decline = esc(t("resourceSend.decline"));
  return `
    <div class="tileMiniActions">
      <button class="btn xs gold" data-accept type="button" title="${accept}" aria-label="${accept}">${icon("check")}</button>
      <button class="btn xs" data-decline type="button" title="${decline}" aria-label="${decline}">${icon("close")}</button>
    </div>`;
}

/**
 * Podpina ✓/✕ kafla. Obsługa zwraca true, gdy decyzja się zapisała; przy
 * błędzie przyciski wracają do działania. Na koniec zawsze onDone (odświeżenie).
 * @param {HTMLElement} tile
 * @param {{accept:()=>Promise<boolean>, decline:()=>Promise<boolean>, onFail?:()=>Promise<void>|void, onDone?:()=>Promise<void>|void}} opts
 */
export function bindProposedActions(tile, { accept, decline, onFail, onDone }) {
  const respond = (handler) => async (e) => {
    e.stopPropagation();
    const btns = [...tile.querySelectorAll("[data-accept],[data-decline]")];
    if (btns.some((x) => x.disabled)) return;
    btns.forEach((x) => { x.disabled = true; });
    let ok = false;
    try { ok = await handler(); } catch (error) { console.warn("[proposed] decision:", error); }
    if (!ok) {
      btns.forEach((x) => { x.disabled = false; });
      await onFail?.();
    }
    await onDone?.();
  };
  tile.querySelector("[data-accept]")?.addEventListener("click", respond(accept));
  tile.querySelector("[data-decline]")?.addEventListener("click", respond(decline));
}
