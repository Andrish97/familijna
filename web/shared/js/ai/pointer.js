// E30: wskazanie miejsca na stronie (narzędzie show_on_page). Podświetlenie
// elementu z dymkiem; gdy cel jest na innej stronie — zapis w sessionStorage
// i wykonanie po wczytaniu tamtej strony (panel czatu montuje się na każdej).
// Kliknięcia przed wskazaniem (karta, sekcja, kafel) tylko zmieniają widok —
// niczego nie zapisują. W Control bez kliknięć (decyzja 7).
import { t } from "../../translation/translation.js";
import { iconText } from "../core/icons.js";
import { POINT_TARGETS, SELECT_TILE } from "./tools/targets.js";
import { isCompactLayout } from "../core/device-attrs.js";

const STORE = "familijna:ai-point";
// Kafel w innej karcie strony — kolejno próbowane karty przy zaznaczaniu.
const TILE_TABS = {
  games: ["#tabPrepared", "#tabPollText", "#tabPollPoints", "#tabMarket"],
  logoEditor: ["#tabLogoText", "#tabLogoDraw", "#tabLogoImage"],
  bases: ["#tabBasesMine", "#tabBasesShared"],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

async function waitFor(sel, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const el = [...document.querySelectorAll(sel)].find(visible);
    if (el || Date.now() > end) return el || null;
    await sleep(150);
  }
}

// Widoczny element albo (szuflada sekcji na telefonie) ukryty — kliknięcie
// przycisku karty/sekcji działa też wtedy, gdy szuflada jest zamknięta.
function clickIfThere(sel) {
  const all = [...document.querySelectorAll(sel)];
  // ukryty przycisk paska (np. „Więcej” na telefonie) — pozycje są w menu ☰
  const el = all.find(visible) || all.find((e) => !e.closest(".topbar"));
  if (el && !el.disabled) el.click();
  return !!el;
}

async function selectTile(pageId, kind, id) {
  const sel = SELECT_TILE[kind]?.(id);
  if (!sel) return false;
  let tile = await waitFor(sel, 2500);
  for (const tab of tile ? [] : TILE_TABS[pageId] || []) {
    if (!clickIfThere(tab)) continue;
    tile = await waitFor(sel, 1500);
    if (tile) break;
  }
  if (!tile) return false;
  if (!tile.classList.contains("is-selected")) tile.click();
  await sleep(200);
  return true;
}

let active = null;
export function clearPointer() {
  if (!active) return;
  cancelAnimationFrame(active.raf);
  active.ring.remove();
  active.note.remove();
  document.removeEventListener("keydown", active.onKey);
  active = null;
}

// Położenie przez zmienne CSS (jak --sheet-drag) — wygląd w components.css.
function setVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, `${Math.round(v)}px`);
}

function place(ring, note, el) {
  const pad = 6;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (el && visible(el)) {
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    setVars(ring, { "--ai-pt-top": r.top - pad, "--ai-pt-left": r.left - pad, "--ai-pt-w": r.width + pad * 2, "--ai-pt-h": r.height + pad * 2 });
    const nr = note.getBoundingClientRect();
    const below = r.bottom + pad + 10;
    const above = r.top - pad - 10 - nr.height;
    // wysoki element (cała sekcja): dymek na dole ekranu, nie na nagłówku
    const tall = r.height > vh * 0.5;
    const top = !tall && below + nr.height <= vh - 8 ? below : !tall && above >= 8 ? above : vh - nr.height - 8;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - nr.width / 2), vw - nr.width - 8);
    setVars(note, { "--ai-pt-top": top, "--ai-pt-left": left });
  } else {
    ring.hidden = true;
    const nr = note.getBoundingClientRect();
    setVars(note, { "--ai-pt-top": Math.max(8, (vh - nr.height) / 2), "--ai-pt-left": Math.max(8, (vw - nr.width) / 2) });
  }
}

// Element w zamkniętym menu ☰ (telefon) — otwórz menu, potem szukaj jeszcze raz.
async function revealInMobileMenu(sel) {
  const inMenu = [...document.querySelectorAll(sel)].some((e) => e.closest(".topbar-mobile-overlay"));
  const overlay = document.querySelector(".topbar-mobile-overlay");
  if (!inMenu || !overlay || overlay.classList.contains("is-open")) return null;
  document.querySelector(".topbar-menu-toggle")?.click();
  return waitFor(sel, 2000);
}

function show(el, text, { onBack, onNext, reason = "" }) {
  clearPointer();
  const ring = document.createElement("div");
  ring.className = "ai-pointer";
  ring.setAttribute("aria-hidden", "true");
  const note = document.createElement("div");
  note.className = "card ai-pointer-note";
  note.setAttribute("role", "status");
  const p = document.createElement("p");
  p.textContent = text || "";
  note.append(p);
  if (!el) {
    const miss = document.createElement("p");
    miss.className = "hint";
    miss.textContent = t(reason === "computer_only" ? "aiChat.pointer.computerOnly" : reason === "not_available_now" ? "aiChat.pointer.notNow" : "aiChat.pointer.missing");
    note.append(miss);
  }
  const actions = document.createElement("div");
  actions.className = "modal-actions";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "btn sm";
  back.innerHTML = iconText("chat", t("aiChat.pointer.back"));
  // [Zrobione — dalej]: prowadzenie krok po kroku — czat wraca i sprawdza
  // stan, potem pokazuje następny krok (onNext). Bez onNext: [Rozumiem].
  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = "btn sm gold";
  ok.innerHTML = onNext ? iconText("arrow-right", t("aiChat.pointer.next")) : iconText("check", t("aiChat.pointer.ok"));
  actions.append(back, ok);
  note.append(actions);
  document.body.append(ring, note);
  const onKey = (e) => { if (e.key === "Escape") clearPointer(); };
  document.addEventListener("keydown", onKey);
  ok.addEventListener("click", () => { clearPointer(); onNext?.(); });
  back.addEventListener("click", () => { clearPointer(); onBack?.(); });
  el?.addEventListener("click", clearPointer, { once: true });
  const tall = el && el.getBoundingClientRect().height > window.innerHeight * 0.5;
  el?.scrollIntoView({ block: tall ? "start" : "center", behavior: "smooth" });
  active = { ring, note, onKey, raf: 0 };
  const loop = () => { if (!active) return; place(ring, note, el); active.raf = requestAnimationFrame(loop); };
  loop();
}

/** Wskazanie na bieżącej stronie. Zwraca wynik dla modelu. */
export async function pointHere(pageId, { place: key, id, text }, { onBack, onNext } = {}) {
  const target = POINT_TARGETS[pageId]?.[key];
  if (!target) return { error: "unknown_place" };
  // telefon: strona/funkcja tylko na komputerze — bez szukania, od razu wyjaśnienie
  if (target.computerOnly && isCompactLayout()) {
    show(null, text, { onBack, onNext, reason: "computer_only" });
    return { ok: true, shown: false, note: "computer_only" };
  }
  const clicks = pageId !== "control";
  let selected = true;
  if (clicks && target.select && id) selected = await selectTile(pageId, target.select, id);
  if (clicks && isCompactLayout()) for (const sel of target.phoneBefore || []) { clickIfThere(sel); await sleep(300); }
  if (clicks) for (const sel of target.before || []) { clickIfThere(sel); await sleep(250); }
  let el = await waitFor(target.sel, target.sometimes ? 2500 : 6000);
  if (!el && clicks) el = await revealInMobileMenu(target.sel);
  const reason = !el && target.sometimes ? "not_available_now" : "";
  show(el, text, { onBack, onNext, reason });
  const note = !selected ? "item_not_found_on_page" : reason || undefined;
  return { ok: true, shown: !!el, ...(note ? { note } : {}) };
}

export function queuePoint(point) {
  try { sessionStorage.setItem(STORE, JSON.stringify({ ...point, at: Date.now() })); } catch { /* tryb prywatny */ }
}

/** Po wczytaniu strony: zaległe wskazanie dla tej strony (najwyżej 30 s). */
export async function runQueuedPoint(pageId, opts) {
  let point = null;
  try { point = JSON.parse(sessionStorage.getItem(STORE) || "null"); sessionStorage.removeItem(STORE); } catch { point = null; }
  if (!point || point.page !== pageId || Date.now() - (point.at || 0) > 30000) return;
  await pointHere(pageId, point, opts);
}
