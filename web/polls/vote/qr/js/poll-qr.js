// Kod QR rysowany lokalnie (SVG), jak w Control i na Wyświetlaczu — bez zewnętrznej biblioteki z CDN.
import { qrDataUrl } from "../../../../shared/js/core/qr-code.js?v=v2026-11-05T23554";
import { anonymousPollLink } from "../../../../shared/js/core/poll-links.js?v=v2026-11-05T23554";
import { guardViewportWidth, MIN_WORK_HEIGHT } from "../../../../shared/js/core/device-guard.js?v=v2026-11-05T23554";
import { sb } from "../../../../shared/js/core/supabase.js?v=v2026-11-05T23554";
import { initI18n, setUiLang, t, getUiLang } from "../../../../shared/translation/translation.js?v=v2026-11-05T23554";
import { initFullscreenButton } from "../../../../shared/js/core/fullscreen.js?v=v2026-11-05T23554";


// 1. Inicjalizacja i18n
await initI18n({ withSwitcher: false });
const deviceGate = guardViewportWidth({ minWidth: 980, minHeight: MIN_WORK_HEIGHT, minScreenShortSide: 800, minTvResolution: true, formFactors: ["desktop", "tablet", "tv"] });
document.documentElement.removeAttribute("data-device-guard-pending");
// Guard musi być widoczny od razu na niedozwolonym urządzeniu. Nie czekaj
// z odsłonięciem dokumentu na zmianę szerokości — ready rozwiązuje się dopiero
// po wejściu w dozwolony widok.
if (deviceGate.state() !== "ok") {
  document.documentElement.classList.remove("page-loading");
  await deviceGate.ready;
}

const qs = new URLSearchParams(location.search);
let url = qs.get("url");
const paramId  = qs.get("id");
const paramKey = qs.get("key");

function getScopeFromVoteUrl(u){
  try{
    const x = new URL(u, location.href);
    const id = x.searchParams.get("id") || "";
    const key = x.searchParams.get("key") || "";
    return `${id}:${key}`;
  }catch{
    return "";
  }
}

function withLangInUrl(u, lang){
  try{
    const x = new URL(u, location.href);
    x.searchParams.set("lang", lang);
    return x.toString();
  }catch{
    return u;
  }
}

const qr = document.getElementById("qr");

// Stan końcowy ekranu: zamiast kodu QR komunikat (ankieta zamknięta / link
// wygasł / brak ankiety). Po rotacji klucza ten sam klucz już nie wraca do
// poll_open, więc po wejściu w ten stan niczego więcej nie odświeżamy.
let ended = false;
function showEnded(msgKey) {
  ended = true;
  if (pollLangInterval) clearInterval(pollLangInterval);
  document.querySelector(".qr-container")?.classList.add("is-ended");
  document.querySelector(".qr-container[data-skel-step]")?.classList.add("skel-step-ready");
  if (qr) qr.textContent = t(msgKey);
  document.documentElement.classList.remove("page-loading");
}

// Komunikat dla błędu get_poll_game ('forbidden' / 'not found'); null = błąd przejściowy
function endedKeyForError(error) {
  const m = String(error?.message || "");
  if (m.includes("forbidden")) return "pollQr.linkExpired";
  if (m.includes("not found") || m.includes("invalid input syntax")) return "pollQr.pollNotFound";
  return null;
}

// Komunikat dla statusu gry; null = ankieta nadal otwarta albo tylko zatrzymana
// (zatrzymana może wrócić do głosowania tym samym linkiem, więc QR zostaje)
function endedKeyForStatus(status) {
  if (status === "poll_open" || status === "poll_stopped") return null;
  if (status === "ready") return "pollQr.pollClosed";
  return "pollQr.linkExpired";
}

async function render(u){
  if (!qr) {
    console.error("[poll-qr] missing #qr element");
    return;
  }

  qr.innerHTML = "";
  if (ended) return;
  if(!u){ qr.textContent = t("pollQr.missingUrl"); return; }

  try{
    const img = document.createElement("img");
    img.src = qrDataUrl(u, { margin: 1 });
    qr.appendChild(img);
  }catch(e){
    console.error("[poll-qr] QR error:", e);
    qr.textContent = t("pollQr.qrFailed");
  }
}

// Jeśli w URL strony poll-qr jest lang, upewnij się, że link w QR też go ma
const currentLang = getUiLang();
if (url && currentLang) {
  url = withLangInUrl(url, currentLang);
}

let myScope = getScopeFromVoteUrl(url);
let myGameId = myScope.split(":")[0] || "";

// --- Tryb device: ?id=&key= (podłączenie przez 6-cyfrowy kod) ---
let deviceInitFailed = false;
if (!url && paramId && paramKey) {
  if (qr) qr.textContent = t("pollQr.loadingGame");
  try {
    const { data, error } = await sb().rpc("get_poll_game", {
      p_game_id: paramId,
      p_key:     paramKey,
    });
    if (error) {
      // get_poll_game (supabase/schema.sql) rzuca zwykłe RAISE EXCEPTION
      // ('forbidden' dla złego klucza, 'not found' dla nieistniejącej gry)
      // — to NIE jest PGRST116 (ten kod dotyczy tylko braku wierszy przy
      // .single() na zapytaniach do tabel, nigdy wyjątków z funkcji RPC),
      // więc ten warunek nigdy nie był prawdziwy i zły klucz zawsze
      // pokazywał ogólny komunikat "Brak URL" zamiast "Nieprawidłowy klucz".
      const k = endedKeyForError(error);
      if (k) throw new Error(k);
      throw new Error(error.message || "not_found");
    }
    if (!data?.game) throw new Error("pollQr.pollNotFound");

    const game = data.game;
    const endedKey = endedKeyForStatus(game.status);
    if (endedKey) throw new Error(endedKey);

    url = anonymousPollLink({ gameId:game.id, key:paramKey, lang:currentLang },location.href);
    myScope  = getScopeFromVoteUrl(url);
    myGameId = paramId;
  } catch(e) {
    console.error("[poll-qr] device init error:", e);
    deviceInitFailed = true;
    if (String(e.message).startsWith("pollQr.")) {
      showEnded(e.message);
    } else if (qr) {
      qr.textContent = t("pollQr.missingUrlOrKey");
    }
  }
}

// --- Fullscreen ---
initFullscreenButton({ button: document.getElementById("btnFullscreen") });

async function applyLangChange(lang) {
  await setUiLang(lang, { persist: false, updateUrl: true, apply: true });
  url = withLangInUrl(url, lang);
  myScope = getScopeFromVoteUrl(url);
  // render() anuluje poprzedni render automatycznie
  await render(url);
}

// --- Język: pollowanie games.poll_qr_lang (migracja 269) zamiast komend ---
// Wcześniej: BroadcastChannel (ta sama przeglądarka) + Supabase Realtime
// broadcast POLL_QR_LANG (inne urządzenie), oba wymagające, żeby polls.js i
// poll-qr.js były podłączone w TEJ SAMEJ chwili, gdy operator zmienia
// język — urządzenie, które akurat straciło łącze/dołączyło PO tym
// momencie, zostawało trwale z nieaktualnym językiem aż do kolejnej
// zmiany. Naprawa: poll-qr samo się dopytuje o stan (ten sam get_poll_game,
// którego już używa przy starcie) — jak Display v2, zamiast czekać na
// komendę z zewnątrz.
const myKey = myScope.split(":")[1] || "";
const POLL_LANG_INTERVAL_MS = 4000;
var pollLangInterval = null;

async function pollLangOnce() {
  if (!myGameId || !myKey) return;
  try {
    const { data, error } = await sb().rpc("get_poll_game", { p_game_id: myGameId, p_key: myKey });
    if (ended) return;
    if (error) {
      const k = endedKeyForError(error);
      if (k) showEnded(k);
      return;
    }
    if (!data?.game) return;
    const k = endedKeyForStatus(data.game.status);
    if (k) {
      showEnded(k);
      return;
    }
    const lang = data.game.poll_qr_lang;
    if (lang && lang !== getUiLang()) await applyLangChange(lang);
  } catch (e) {
    console.warn("[poll-qr] lang poll failed", e);
  }
}

if (myGameId && myKey) {
  pollLangOnce();
  pollLangInterval = setInterval(pollLangOnce, POLL_LANG_INTERVAL_MS);
}

// Oczyść interval przy unload
window.addEventListener("beforeunload", () => {
  if (pollLangInterval) clearInterval(pollLangInterval);
});

if (!deviceInitFailed) {
  render(url).finally(() => {
    document.querySelector(".qr-container[data-skel-step]")?.classList.add("skel-step-ready");
    document.documentElement.classList.remove('page-loading');
  });
} else {
  document.querySelector(".qr-container[data-skel-step]")?.classList.add("skel-step-ready");
  document.documentElement.classList.remove('page-loading');
}
