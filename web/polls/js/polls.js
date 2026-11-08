// js/pages/polls.js
// Strona ankiety (właściciel): /polls/?id=<gra>.
//   A. Pasek stanu — stan słowem po lewej, WSZYSTKIE akcje po prawej
//      (Uruchom · Zatrzymaj · Wznów głosowanie · Podlicz głosy · Zatwierdź ·
//      Uruchom ponownie · Przerwij). Na telefonie stan u góry, przyciski pod nim.
//   B. Karty Udostępnianie · Wyniki. Wyniki są jedne dla wszystkich stanów:
//      na żywo, zatrzymane (surowe), podliczanie (poll-tally.js), ostateczne.
// Stany gry: draft -> poll_open <-> poll_stopped -> ready (migracja 315).
import { shareSectionEl, shareRowEl, shareCooldownEl, shareBulkActionsEl } from "../../shared/js/core/share-sections.js?v=v2026-11-08T09312";
import { anonymousPollLink } from "../../shared/js/core/poll-links.js?v=v2026-11-08T09312";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T09312";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-08T09312";
import { holdSkeletonLayout } from "../../shared/js/core/page-layout.js?v=v2026-11-08T09312";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T09312";
import { alertModal, confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-08T09312";
import { qrDataUrl } from "../../shared/js/core/qr-code.js?v=v2026-11-08T09312";
import { initI18n, t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-08T09312";
import { backHref, PAGES } from "../../shared/js/core/nav-map.js?v=v2026-11-08T09312";
import { tabFromUrl, setTab, markActiveTab } from "../../shared/js/core/tabs.js?v=v2026-11-08T09312";
import { guardResourceLock } from "../../shared/js/core/resource-lock.js?v=v2026-11-08T09312";
import { validateGame, gameRuleErrorMessage, guardGameState } from "../../shared/js/core/game-validate.js?v=v2026-11-08T09312";
import { sendPollInviteMails } from "../../shared/js/core/poll-mail.js?v=v2026-11-08T09312";
import "../../shared/js/core/contact-modal.js?v=v2026-11-08T09312";
import { createPollResults } from "../../shared/js/core/poll-results.js?v=v2026-11-08T09312";
import { openDialog, closeDialog, isOverlayOpen } from "../../shared/js/core/modal-sheet.js?v=v2026-11-08T09312";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-08T09312";
import { toast, hideToast } from "../../shared/js/core/toast.js?v=v2026-11-08T09312";
import { createTally } from "./poll-tally.js?v=v2026-11-08T09312";

import { createCooldownTicker } from "../../shared/js/core/cooldown.js?v=v2026-11-08T09312";

// initI18n is called at the start of DOMContentLoaded (see below)

const qs = new URLSearchParams(location.search);
const gameId = qs.get("id");

const $ = (id) => document.getElementById(id);

// pasek stanu
const pollBar = $("pollBar");
const pollStateWord = $("pollStateWord");
const pollStateInfo = $("pollStateInfo");
const hintTop = $("hintTop");
const btnOpenPoll = $("btnOpenPoll");
const btnStopPoll = $("btnStopPoll");
const btnResumePoll = $("btnResumePoll");
const btnTallyPoll = $("btnTallyPoll");
const btnApproveTally = $("btnApproveTally");
const btnLeaveTally = $("btnLeaveTally");
const btnReopenPoll = $("btnReopenPoll");
const btnAbort = $("btnAbort");

// treść
const cardMain = $("cardMain");
const cardEmpty = $("cardEmpty");
const pollLoadRetryWrap = $("pollLoadRetryWrap");
const pollLoadRetry = $("pollLoadRetry");
const tabShare = $("tabShare");
const tabRecipients = $("tabRecipients");
const tabResults = $("tabResults");
const secShare = $("secShare");
const secResults = $("secResults");
const pollTabsCard = $("pollTabsCard");
const recipientShareTab = tabRecipients?.closest(".tab-slot");
const recipientShareSection = document.querySelector(".pollRecipientsSec");

// Udostępnianie
const shareEmpty = $("shareEmpty");
const shareBody = $("shareBody");
const linkPlaceholder = $("linkPlaceholder");
const linkLive = $("linkLive");
const pollLinkEl = $("pollLink");
const qrBox = $("qr");
const btnCopy = $("btnCopy");
const btnOpen = $("btnOpen");
const btnOpenQr = $("btnOpenQr");
const btnAddRecipients = $("btnAddRecipients");
const subsGrid = $("subsGrid");
const subsEmpty = $("subsEmpty");
const subsSummary = $("subsSummary");
const sendHint = $("sendHint");
const pollRecipientsOverlay = $("pollRecipientsOverlay");
const pollRecipientsFriends = $("pollRecipientsFriends");
const pollRecipientsSubs = $("pollRecipientsSubs");
const pollRecipientsEmpty = $("pollRecipientsEmpty");
const pollRecipientsCount = $("pollRecipientsCount");
const pollRecipientsAdd = $("pollRecipientsAdd");
const pollRecipientsClose = $("pollRecipientsClose");
const pollRecipientsCancel = $("pollRecipientsCancel");

// QR modal (wyświetlacz ankiety / kod do głosowania)
const pollQrModalOverlay = $("pollQrModalOverlay");
const pollQrModalTitle = $("pollQrModalTitle");
const pollQrModalSubtitle = $("pollQrModalSubtitle");
const pollQrModalVote = $("pollQrModalVote");
const pollQrModalCode = $("pollQrModalCode");
const pollQrModalActions = $("pollQrModalActions");
const pollQrModalHint = $("pollQrModalHint");
const pollQrModalCodeVal = $("pollQrModalCodeVal");
const pollQrModalCopy = $("pollQrModalCopy");
const pollQrModalOpen = $("pollQrModalOpen");
const pollQrModalClose = $("pollQrModalClose");
let _pollQrDeviceCode = "";
let _pollQrOpenUrl = "";

// Wyniki
const resultsMeta = $("resultsMeta");
const resultsList = $("resultsList");
const tallyBar = $("tallyBar");
const tallyHint = $("tallyHint");
const tallyTools = $("tallyTools");
const tallySave = $("tallySave");
const btnUndo = $("btnUndo");
const btnRedo = $("btnRedo");

let game = null;
let currentUser = null;
let guestMode = false;
let initialLoadFailed = false;
let busy = false; // trwa akcja stanu (uruchom / zatrzymaj / podlicz / przerwij)
let lastCheck = null; // wynik validateGame() z ostatniego odświeżenia
let lastPreview = null; // ostatnia odpowiedź get_poll_preview
let votesText = ""; // „12 głosów” w pasku stanu (ankieta otwarta)
let tallyActive = false; // karta Wyniki w trybie podliczania
let tallyValid = false;

const TYPES = {
  POLL_TEXT: "poll_text",
  POLL_POINTS: "poll_points",
  PREPARED: "prepared",
};
const STATUS = {
  DRAFT: "draft",
  POLL_OPEN: "poll_open",
  POLL_STOPPED: "poll_stopped",
  READY: "ready",
};

const LIVE_REFRESH_MS = 5000;

function setMsg(text, kind = "info") {
  if (!text) { hideToast(); return; }
  toast(text, { kind });
}

function typeShortLabel(type) {
  if (type === TYPES.POLL_TEXT) return t("polls.typeShort.text");
  if (type === TYPES.POLL_POINTS) return t("polls.typeShort.points");
  return t("games.types.prepared");
}

function statusLabel(st) {
  const s = st || STATUS.DRAFT;
  if (s === STATUS.DRAFT) return t("games.status.draft");
  if (s === STATUS.POLL_OPEN) return t("games.status.open");
  if (s === STATUS.POLL_STOPPED) return t("games.status.stopped");
  if (s === STATUS.READY) return t("games.status.ready");
  return String(s).toUpperCase();
}

function formatUntil(untilMs) {
  try {
    return new Date(untilMs).toLocaleString(getUiLang() || "pl", {
      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return new Date(untilMs).toLocaleString();
  }
}

/* =======================
   QR modal: wyświetlacz (kod urządzenia) albo powiększony kod do głosowania
======================= */

function hidePollQrModal() {
  if (!isOverlayOpen(pollQrModalOverlay)) return;
  closeDialog(pollQrModalOverlay);
}

// Otwiera okno; na telefonie wchodzi w tryb arkusza (wyjście = „Wstecz” w topbarze).
function openPollQrOverlay() {
  if (!pollQrModalOverlay) return;
  openDialog(pollQrModalOverlay, { onClose: hidePollQrModal });
}

function setQrModalMode(vote) {
  if (pollQrModalVote) pollQrModalVote.hidden = !vote;
  for (const el of [pollQrModalCode, pollQrModalActions, pollQrModalHint]) if (el) el.hidden = !!vote;
  if (pollQrModalTitle) pollQrModalTitle.textContent = vote ? t("polls.qrModal.voteTitle") : t("polls.qrModal.title");
  if (pollQrModalSubtitle) pollQrModalSubtitle.textContent = vote ? t("polls.qrModal.voteSubtitle") : t("polls.qrModal.subtitle");
}

// Kliknięcie małego QR: ten sam kod do głosowania, powiększony.
async function showVoteQrModal() {
  const url = pollLinkEl?.value;
  if (!url || !pollQrModalVote) return;
  setQrModalMode(true);
  pollQrModalVote.innerHTML = "";
  openPollQrOverlay();
  try {
    const wrap = document.createElement("div");
    wrap.className = "qrFrameSmall qrFrameBig";
    const img = document.createElement("img");
    img.src = qrDataUrl(url, { margin: 1 });
    img.alt = "";
    wrap.appendChild(img);
    pollQrModalVote.appendChild(wrap);
  } catch (e) {
    console.warn("[polls] big QR failed:", e);
    pollQrModalVote.textContent = t("polls.qrFailed");
  }
}

async function showPollQrModal() {
  if (!game || !pollLinkEl?.value) return;
  setQrModalMode(false);

  // URL do strony wyświetlacza (poll-qr) — zawiera aktualny język polls
  const displayUrl = new URL("/polls/vote/qr/", location.href);
  displayUrl.searchParams.set("id", game.id);
  displayUrl.searchParams.set("key", game.share_key_poll);
  displayUrl.searchParams.set("lang", getUiLang() || "pl");
  _pollQrOpenUrl = displayUrl.toString();

  if (pollQrModalCodeVal) pollQrModalCodeVal.textContent = "——————";
  openPollQrOverlay();

  try {
    const { data, error } = await sb().rpc("generate_device_connect_code", {
      p_game_id:     game.id,
      p_device_type: "poll_qr",
      p_share_key:   game.share_key_poll,
      p_game_name:   game.name,
    });
    if (error || !data?.ok) throw new Error(error?.message || "RPC error");
    _pollQrDeviceCode = data.code;
    if (pollQrModalCodeVal) pollQrModalCodeVal.textContent = data.code;
  } catch (e) {
    console.warn("[polls] showPollQrModal error", e);
    setMsg(t("common.genericError"), "error");
  }
}

pollQrModalClose?.addEventListener("click", hidePollQrModal);
pollQrModalCopy?.addEventListener("click", async () => {
  if (!_pollQrDeviceCode) return;
  try {
    await navigator.clipboard.writeText(_pollQrDeviceCode);
    setMsg(t("polls.qrModal.copied"));
  } catch {
    setMsg(t("polls.copy.failed"), "error");
  }
});
pollQrModalOpen?.addEventListener("click", () => {
  if (!_pollQrOpenUrl) return;
  window.open(_pollQrOpenUrl, "_blank", "noopener,noreferrer");
});

// --- Język QR-a w ankietach (games.poll_qr_lang, migracja 269) ---
// Język jest PERSYSTOWANY na games.poll_qr_lang -- poll-qr.js samo się o niego
// dopytuje (pollowanie), więc broadcastLang() tylko zapisuje, nigdy nie czeka
// na odbiorcę.
async function broadcastLang(lang) {
  if (!game?.id) return;
  try {
    await sb().rpc("set_poll_qr_lang", { p_game_id: game.id, p_lang: lang });
  } catch (e) {
    console.warn("[polls] set_poll_qr_lang failed", e);
  }
}

window.addEventListener("i18n:lang", (e) => {
  const lang = e?.detail?.lang;
  if (!lang) return;

  broadcastLang(lang);
  tally.relabel();
  void refresh();
});

/* =======================
   Link i QR
======================= */

function setLinkUiVisible(on) {
  const v = !!on;
  if (btnCopy) btnCopy.disabled = !v;
  if (btnOpen) btnOpen.disabled = !v;
  if (btnOpenQr) btnOpenQr.disabled = !v;
  if (qrBox) qrBox.disabled = !v;
  if (!v) clearQr();
}

function clearQr() {
  if (qrBox) qrBox.innerHTML = "";
}

let renderedQrUrl = "";
async function renderQr(url) {
  if (!qrBox) return;
  if (url === renderedQrUrl && qrBox.firstChild) return;
  renderedQrUrl = url;
  qrBox.innerHTML = "";
  if (!url) return;

  try {
    const wrap = document.createElement("div");
    wrap.className = "qrFrameSmall";

    // Kod QR rysowany lokalnie (SVG), jak w Control i na Wyświetlaczu.
    const img = document.createElement("img");
    img.src = qrDataUrl(url, { margin: 1 });
    img.alt = "";
    wrap.appendChild(img);
    qrBox.appendChild(wrap);
  } catch (e) {
    console.warn("[polls] QR failed:", e);
    qrBox.textContent = t("polls.qrFailed");
  }
}

function pollLink(g) {
  if (!g || ![TYPES.POLL_TEXT,TYPES.POLL_POINTS].includes(g.type)) return "";
  return anonymousPollLink({ gameId:g.id, key:g.share_key_poll, lang:getUiLang() },location.href);
}

/* =======================
   DB helpers
======================= */

// Pierwsze wczytanie gry startuje razem z sesją i blokadą (wejście na
// stronę); pierwsze refresh() bierze ten wynik zamiast nowego zapytania.
let prefetchedGame = null;

async function loadGame() {
  if (prefetchedGame) { const p = prefetchedGame; prefetchedGame = null; return p; }
  const { data, error } = await sb()
    .from("games")
    .select("id,name,type,status,share_key_poll,poll_opened_at,poll_closed_at")
    .eq("id", gameId)
    .single();
  if (error) throw error;
  return data;
}

async function listQuestionsBasic() {
  const { data, error } = await sb()
    .from("questions")
    .select("id, ord, text")
    .eq("game_id", gameId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return data || [];
}

function rpcErrText(error, data) {
  return error?.message || error?.details || data?.err || data?.error || t("common.genericError");
}

/* =======================
   Wyniki — jedna lista dla wszystkich stanów
   Na żywo (otwarta), surowe (zatrzymana), podliczanie (poll-tally.js),
   ostateczne (gotowa). Lista budowana raz; potem tylko liczby i szerokości
   pasków (przejścia CSS) — bez skakania.
======================= */

const pollResults = createPollResults(resultsList);
function resetResultsDom() { pollResults.reset(); }

const tally = createTally({
  gameId,
  pollResults,
  ui: {
    barEl: tallyBar,
    hintEl: tallyHint,
    toolsEl: tallyTools,
    saveEl: tallySave,
    undoBtn: btnUndo,
    redoBtn: btnRedo,
    onValidity: (ok) => { tallyValid = !!ok; renderBar(); },
    onNotice: (text) => setMsg(text),
    onSaved: (text) => setMsg(text),
  },
});

async function previewResults() {
  if (!game || !resultsList) return;
  if (game.type === TYPES.PREPARED) {
    resetResultsDom();
    if (resultsMeta) resultsMeta.textContent = t("polls.meta.prepared");
    return;
  }
  if (game.status === STATUS.DRAFT) {
    resetResultsDom();
    lastPreview = null;
    if (resultsMeta) resultsMeta.textContent = t("polls.results.draftEmpty");
    return;
  }

  const { data, error } = await sb().rpc("get_poll_preview", { p_game_id: gameId });
  if (error) throw error;
  lastPreview = data;
  if (tallyActive) return; // podliczanie ma własny widok tych wierszy
  const meta = pollResults.render(data);
  if (resultsMeta) {
    resultsMeta.textContent = game.status === STATUS.POLL_STOPPED ? t("polls.results.stopped") : meta;
  }
}

// liczba głosujących = wiersze odpowiedzi na pierwsze pytanie (jeden na osobę na pytanie)
let firstQuestionId = null;
async function fetchVotersCount() {
  if (!game || game.status !== STATUS.POLL_OPEN) return null;
  if (!firstQuestionId) {
    const qs1 = await listQuestionsBasic();
    firstQuestionId = qs1[0]?.id || null;
  }
  if (!firstQuestionId) return 0;
  const table = game.type === TYPES.POLL_TEXT ? "poll_text_entries" : "poll_votes";
  const { count, error } = await sb()
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("game_id", gameId)
    .eq("question_id", firstQuestionId);
  if (error) throw error;
  return count || 0;
}

async function refreshVotes() {
  try {
    const n = await fetchVotersCount();
    if (n !== null) {
      votesText = t("polls.bar.votes", { n });
      renderBar();
    }
  } catch (e) {
    console.warn("[polls] votes count failed", e);
  }
}

/* =======================
   Podliczanie: wejście, wyjście, zatwierdzenie
======================= */

async function enterTally() {
  if (!game || game.status !== STATUS.POLL_STOPPED || tallyActive) return;
  busy = true;
  setActiveTab("results");
  renderBar();
  try {
    // świeże dane, ta sama lista wierszy co w widoku surowym
    tallyActive = false;
    await previewResults();
    if (!lastPreview) throw new Error("no preview");
    if (resultsMeta) resultsMeta.textContent = "";
    if (game.type === TYPES.POLL_POINTS) await tally.enterPoints(lastPreview);
    else await tally.enterText();
    tallyActive = true;
    setMsg("");
  } catch (e) {
    console.error("[polls] enter tally:", e);
    await alertModal({ text: `${t("polls.errors.loadAnswers")}\n\n${e?.message || e}` });
    try { await tally.leave(); } catch { /* sprzątanie */ }
    tallyActive = false;
    resetResultsDom();
    await previewResults().catch(() => {});
  }
  busy = false;
  renderBar();
}

async function leaveTally() {
  if (!tallyActive) return;
  try { await tally.leave(); } catch (e) { console.warn("[polls] leave tally", e); }
  tallyActive = false;
  tallyValid = false;
  await previewResults().catch(() => {});
  renderBar();
}

async function approveTallyFlow() {
  if (!game || !tallyActive || !tally.valid()) return;
  const points = game.type === TYPES.POLL_POINTS;
  const key = points ? "tallyPoints" : "tallyText";
  const ok = await confirmModal({
    title: t(`polls.modals.${key}.title`),
    text: t(`polls.modals.${key}.text`),
    okText: t(`polls.modals.${key}.ok`),
    cancelText: t("polls.actions.cancel"),
  });
  if (!ok) return;

  try {
    if (points) {
      const { error } = await sb().rpc("poll_points_tally", { p_game_id: gameId });
      if (error) throw error;
    } else {
      const { error } = await sb().rpc("poll_text_tally_apply", { p_game_id: gameId, p_payload: tally.textPayload() });
      if (error) throw error;
    }
    tally.finish();
    tallyActive = false;
  } catch (e) {
    console.error("[polls] tally error:", e);
    await alertModal({ text: `${t("polls.errors.tally")}\n\n${gameRuleErrorMessage(e) || e?.message || e}` });
  }
}

/* =======================
   Wypustki Udostępnianie · Wyniki
======================= */

// Karty z mapy stron (pierwsza = domyślna, bez parametru w adresie). Wypustka
// z ?tab= obowiązuje od wejścia, dopóki stan ankiety się nie zmieni; bez
// ?tab= wypustkę dobiera stan ankiety (szkic/otwarta: Udostępnianie).
const POLL_TABS = PAGES.polls.tabs;
const DEFAULT_POLL_TAB = POLL_TABS[0];
let activeTab = tabFromUrl(POLL_TABS, DEFAULT_POLL_TAB);
let activeShareSide = "anonymous";
let tabTouchedByUser = new URLSearchParams(location.search).has("tab");
let urlTabPending = tabTouchedByUser;

function setActiveTab(tab, { byUser = false } = {}) {
  const selected = tab === "recipients" && !guestMode ? "recipients" : tab === "results" ? "results" : "share";
  activeTab = selected === "results" ? "results" : "share";
  activeShareSide = selected === "recipients" ? "recipients" : "anonymous";
  if (byUser) tabTouchedByUser = true;
  setTab(activeTab, DEFAULT_POLL_TAB);
  const shareOn = activeTab === "share";
  secShare?.classList.toggle("active", shareOn);
  secResults?.classList.toggle("active", !shareOn);
  pollTabsCard?.classList.toggle("mobile-recipients-active", shareOn && activeShareSide === "recipients");
  markActiveTab([tabShare, tabRecipients, tabResults], !shareOn ? tabResults : activeShareSide === "recipients" ? tabRecipients : tabShare);
}

function setShareTabEnabled(on) {
  for (const btn of [tabShare, tabRecipients]) {
    if (!btn) continue;
    btn.disabled = !on;
    btn.setAttribute("aria-disabled", on ? "false" : "true");
  }
  tabShare?.closest(".tab-slot")?.classList.toggle("is-disabled", !on);
  tabRecipients?.closest(".tab-slot")?.classList.toggle("is-disabled", !on);
  if (!on && activeTab === "share") setActiveTab("results");
}

/* =======================
   Odbiorcy ankiety
======================= */

let subsAll = [];            // aktywni subskrybenci e-mail właściciela
let friendsAll = [];         // zaakceptowani znajomi właściciela
let tasks = [];              // zaproszenia tego uruchomienia
const selectedSubIds = new Set();
const selectedFriendIds = new Set();
const recipientTicker = createCooldownTicker();
const pickerTicker = createCooldownTicker();
recipientTicker.start();
pickerTicker.start();
let recipientPickerSnapshot = null;
let recipientPickerLoading = false;
let subsSig = "";

function emailKey(s) {
  return String(s || "").trim().toLowerCase();
}

function taskIsWaiting(tk) {
  return tk && (tk.status === "pending" || tk.status === "opened");
}

function subLabel(sub) {
  return sub.subscriber_label || sub.subscriber_email || "—";
}

// Karta Udostępnianie: w szkicu widoczna, ale zablokowana do uruchomienia;
// działa przy otwartej i zatrzymanej ankiecie. Po podliczeniu linki wygasają.
function sharingAvailable(st = game?.status) {
  return st === STATUS.DRAFT || st === STATUS.POLL_OPEN || st === STATUS.POLL_STOPPED;
}

async function loadTasks() {
  if (!game || !currentUser) { tasks = []; return; }
  if (guestMode) { friendsAll = []; subsAll = []; tasks = []; return; }
  const { data, error } = await sb().rpc("poll_share_panel", { p_game_id: gameId });
  if (error || !data?.ok) throw new Error(error?.message || data?.err || "poll_share_panel");
  friendsAll = data.friends || [];
  subsAll = data.subscribers || [];
  tasks = data.tasks || [];
}

async function loadSubsData() {
  if (!game || !currentUser || !sharingAvailable()) return;
  await loadTasks();
  renderSubs(true);
  if (pollRecipientsOverlay && !pollRecipientsOverlay.classList.contains("hidden") && isOverlayOpen(pollRecipientsOverlay)) renderRecipientPicker();
}

async function refreshTasksOnly() {
  if (!game || game.status === STATUS.DRAFT || !sharingAvailable()) return;
  await loadTasks();
  renderSubs();
}

function taskForRecipient(recipient) {
  return tasks.find((tk) => recipient.kind === "friend"
    ? String(tk.recipient_user_id || "") === String(recipient.user_id)
    : !tk.recipient_user_id && emailKey(tk.recipient_email) === emailKey(recipient.email)) || null;
}

function availableRecipients() {
  const friendRows = friendsAll
    .map((f) => ({ kind: "friend", id: String(f.user_id), user_id: f.user_id, email: f.email, label: f.label || f.email, cooldown_until: f.cooldown_until, email_enabled: f.email_enabled }))
    .filter((r) => !taskForRecipient(r));
  const subscriberRows = subsAll
    .map((s) => ({ kind: "subscriber", id: String(s.id), sub_id: s.id, email: s.email, label: s.email, cooldown_until: s.cooldown_until, email_enabled: s.email_enabled }))
    .filter((r) => !taskForRecipient(r) && !friendsAll.some((f) => emailKey(f.email) === emailKey(r.email)));
  return { friendRows, subscriberRows };
}

function canSendInvites() {
  return game?.status === STATUS.POLL_OPEN;
}

function renderSubs(force = false) {
  if (!subsGrid) return;

  // zaznaczenia zostają tylko dla wciąż niezaproszonych
  const available = availableRecipients();
  for (const id of [...selectedSubIds]) if (!available.subscriberRows.some((r) => r.id === id && !(Date.parse(r.cooldown_until) > Date.now()))) selectedSubIds.delete(id);
  for (const id of [...selectedFriendIds]) if (!available.friendRows.some((r) => r.id === id && !(Date.parse(r.cooldown_until) > Date.now()))) selectedFriendIds.delete(id);

  const stopped = game?.status === STATUS.POLL_STOPPED;
  const sig = JSON.stringify([
    game?.status,
    friendsAll,
    subsAll,
    tasks, busy,
    [...selectedSubIds].sort(),
    [...selectedFriendIds].sort(),
    getUiLang(),
  ]);
  if (!force && sig === subsSig) return;
  subsSig = sig;

  // podsumowanie w nagłówku
  if (subsSummary) {
    subsSummary.textContent = t("polls.share.summary", {
      invited: tasks.filter(tk => !tk.hidden).length,
      voted: tasks.filter((tk) => !tk.hidden && tk.status === "done").length,
      declined: tasks.filter((tk) => !tk.hidden && tk.status === "declined").length,
    });
  }

  // Nowych odbiorców dodaje się w oknie, dopiero przy otwartej ankiecie.
  if (btnAddRecipients) btnAddRecipients.disabled = !canSendInvites();
  if (sendHint) {
    sendHint.textContent = stopped ? t("polls.share.sendDisabledStopped")
      : game?.status === STATUS.DRAFT ? t("polls.share.sendAfterStart") : "";
  }
  renderBar();

  recipientTicker.resetBindings();
  const sharedRecipients = tasks.filter(tk => !tk.hidden).map((tk) => {
    const friend = friendsAll.find((f) => String(f.user_id) === String(tk.recipient_user_id));
    const sub = subsAll.find((s) => !tk.recipient_user_id && emailKey(s.email) === emailKey(tk.recipient_email));
    return { tk, kind: tk.recipient_user_id ? "friend" : "subscriber", label: tk.label || friend?.label || sub?.email || tk.recipient_email || "—" };
  });
  if (subsEmpty) subsEmpty.hidden = true;
  const rows = sharedRecipients.map(({ tk, kind, label }) => {
    const waiting = taskIsWaiting(tk);
    const limit = (tk.reminder_count || 0) >= 2;
    const locked = limit || stopped || busy;
    const until = Date.parse(tk.cooldown_until) || 0;
    const title = stopped ? t("polls.share.sendDisabledStopped")
      : limit ? t("polls.share.reminderLimit") : t("polls.share.remind");
    const actions = [];
    if (waiting && tk.email_enabled) actions.push({
      key: "remind", icon: "refresh", title, countdown: true, disabled: locked || until > Date.now(),
      onClick: () => void remindShare(tk, { sub_id: tk.recipient_user_id || tk.recipient_email }),
      onMount: ({ button, labelEl }) => {
        if (locked) button.dataset.locked = "1";
        const key = `task:${tk.id}`;
        recipientTicker.bind({ key, labelEl, disableEls: [button] });
        recipientTicker.setEndMs(key, until);
      },
    });
    actions.push({ key: "remove", icon: "trash", title: t("polls.share.remove"), disabled: busy,
      onClick: () => void removeShare(tk, { sub_id: tk.recipient_user_id || tk.recipient_email, subscriber_label: label }) });
    const stateKey = waiting ? "waiting" : tk.status === "done" ? "done" : "declined";
    return {
      id: tk.id, label, compact: true,
      state: { key: stateKey, label: t(`polls.share.state.${stateKey}`) },
      tags: [{ text: t(`shareSections.channel.${kind}`), cls: "tag--muted" }], actions,
      note: waiting ? (tk.status === "opened" ? t("pollSharePanel.opened") : t("polls.share.state.waiting"))
        : tk.status === "done" ? t("polls.share.state.done") : t("polls.share.state.declined"),
    };
  });
  subsGrid.replaceChildren(shareSectionEl({ key: "poll-shared", title: t("polls.share.recipientsTitle"), rows, emptyText: t("pollSharePanel.empty") }));
}

// Wysyłka zaproszeń do zaznaczonych; wywołujący pilnuje `busy`.
async function sendInvitesCore() {
  const { data, error } = await sb().rpc("poll_share_send", {
    p_game_id: gameId,
    p_friend_ids: [...selectedFriendIds],
    p_subscriber_ids: [...selectedSubIds],
  });
  if (error || data?.ok === false) {
    throw new Error(rpcErrText(error, data));
  }

  const res = await sendPollInviteMails({ mailItems: data?.mail });
  selectedSubIds.clear();
  selectedFriendIds.clear();

  if (res.failed) await alertModal({ text: `${t("polls.share.mailFailed")} (${res.failed}/${res.total})` });
  else if (res.skipped) setMsg(t("pollSharePanel.mailDisabled"));
  else setMsg(t("polls.share.invitesSent", { n: data?.created || res.sent }));
  if (data?.blocked) setMsg(t("polls.share.invitesBlocked", { n: data.blocked }), "error");
}

async function sendInvites() {
  if (!game || busy || (!selectedSubIds.size && !selectedFriendIds.size) || !canSendInvites()) return;
  busy = true;
  if (btnAddRecipients) btnAddRecipients.disabled = true;
  try {
    await sendInvitesCore();
  } catch (e) {
    console.error("[polls] send invites", e);
    await alertModal({ text: `${t("polls.share.inviteFailed")}\n\n${e?.message || e}` });
  } finally {
    busy = false;
    await safeLoadSubs();
  }
}

function recipientSelectionChanged() {
  const n = selectedSubIds.size + selectedFriendIds.size;
  if (pollRecipientsCount) pollRecipientsCount.textContent = n ? t("polls.share.selectedCount", { n }) : "";
  if (pollRecipientsAdd) {
    pollRecipientsAdd.disabled = n === 0 || busy || !canSendInvites();
    pollRecipientsAdd.textContent = t("polls.share.sendInvitesN", { n });
  }
}

function renderRecipientGroup(host, rows, kind, title) {
  const section = shareSectionEl({ key: `poll-${kind}`, title, emptyText: rows.length ? "" : t("pollSharePanel.empty") });
  const list = section.querySelector(".shareList");
  const selectedIds = kind === "friend" ? selectedFriendIds : selectedSubIds;
  const heading = section.querySelector(".section-title");
  heading.classList.add("shareSectionHeading");
  const bulkActions = shareBulkActionsEl({
    onSelectAll: () => {
      for (const input of list.querySelectorAll('input[type="checkbox"]:not(:disabled)')) selectedIds.add(input.value);
      list.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((input) => { input.checked = true; });
      recipientSelectionChanged();
      syncBulkActions();
    },
    onDeselectAll: () => {
      for (const input of list.querySelectorAll('input[type="checkbox"]')) selectedIds.delete(input.value);
      list.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
      recipientSelectionChanged();
      syncBulkActions();
    },
  });
  heading.append(bulkActions.element);
  const syncBulkActions = () => bulkActions.update(list.querySelectorAll('input[type="checkbox"]'));
  for (const recipient of rows) {
    const row = shareRowEl({ id: recipient.id, label: recipient.label, title: recipient.email, compact: true });
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox"; checkbox.value = recipient.id; checkbox.checked = selectedIds.has(recipient.id);
    if (busy || !canSendInvites()) { checkbox.disabled = true; checkbox.dataset.locked = "1"; }
    checkbox.setAttribute("aria-label", recipient.label);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) selectedIds.add(recipient.id); else selectedIds.delete(recipient.id);
      recipientSelectionChanged();
      syncBulkActions();
    });
    row.prepend(checkbox);
    row.addEventListener("click", event => {
      if (checkbox.disabled || event.target.closest("input,button")) return;
      checkbox.checked = !checkbox.checked; checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const { element, labelEl } = shareCooldownEl(); row.querySelector(".shareRowActions").append(element);
    const key = `${kind}:${recipient.id}`;
    pickerTicker.bind({ key, labelEl, disableEls: [checkbox], onTick: (_, cooling) => {
      element.hidden = !cooling; row.classList.toggle("is-cooling-down", cooling); row.classList.toggle("pick", !cooling);
      if (cooling) { checkbox.checked = false; selectedIds.delete(recipient.id); }
      recipientSelectionChanged();
      syncBulkActions();
    }});
    pickerTicker.setEndMs(key, Date.parse(recipient.cooldown_until) || 0);
    list.append(row);
  }
  syncBulkActions();
  host.replaceChildren(section);
}

function renderRecipientPicker() {
  if (!pollRecipientsFriends || !pollRecipientsSubs) return;
  pickerTicker.resetBindings();
  const { friendRows, subscriberRows } = availableRecipients();
  if (pollRecipientsEmpty) pollRecipientsEmpty.hidden = true;
  renderRecipientGroup(pollRecipientsFriends, friendRows, "friend", t("polls.share.friendsTitle"));
  renderRecipientGroup(pollRecipientsSubs, subscriberRows, "subscriber", t("polls.share.subsTitle"));
  recipientSelectionChanged();
}

async function openRecipientPicker() {
  if (guestMode || !game || busy || recipientPickerLoading || !canSendInvites()) return;
  recipientPickerLoading = true;
  if (btnAddRecipients) btnAddRecipients.disabled = true;
  try { await loadTasks(); }
  catch (error) { console.warn("[polls] recipient picker", error); setMsg(t("common.genericError"), "error"); return; }
  finally {
    recipientPickerLoading = false;
    if (btnAddRecipients) btnAddRecipients.disabled = busy || !canSendInvites();
  }
  renderSubs(true);
  recipientPickerSnapshot = {
    subscriberIds: [...selectedSubIds],
    friendIds: [...selectedFriendIds],
  };
  renderRecipientPicker();
  openDialog(pollRecipientsOverlay, { onClose: closeRecipientPicker });
}

function closeRecipientPicker() {
  pickerTicker.resetBindings();
  if (!pollRecipientsOverlay) return;
  if (recipientPickerSnapshot) {
    selectedSubIds.clear();
    selectedFriendIds.clear();
    recipientPickerSnapshot.subscriberIds.forEach((id) => selectedSubIds.add(id));
    recipientPickerSnapshot.friendIds.forEach((id) => selectedFriendIds.add(id));
    recipientPickerSnapshot = null;
    renderBar();
  }
  closeDialog(pollRecipientsOverlay);
}

async function acceptRecipientSelection() {
  const n = selectedSubIds.size + selectedFriendIds.size;
  if (!n || busy) return;
  recipientPickerSnapshot = null;
  closeRecipientPicker();
  await sendInvites();
}

async function remindShare(tk, sub) {
  if (busy || game?.status !== STATUS.POLL_OPEN) return;
  busy = true;
  try {
    const { data, error } = await sb().rpc("poll_share_remind", { p_game_id: gameId, p_task_id: tk.id });
    if (error) throw error;
    if (!data?.ok) {
      if (data?.err === "cooldown" && data.cooldown_until) {
        setMsg(t("polls.share.canResend", { when: formatUntil(Date.parse(data.cooldown_until)) }));
      } else if (data?.err === "reminder limit") {
        setMsg(t("polls.share.reminderLimit"));
      } else {
        await alertModal({ text: `${t("polls.share.remindFailed")}\n\n${rpcErrText(null, data)}` });
      }
      return;
    }
    if (data.mail_allowed === false) { setMsg(t("pollSharePanel.mailDisabled")); return; }
    const res = await sendPollInviteMails({ mailItems: data.mail, reminder: true });
    if (res.failed) await alertModal({ text: `${t("polls.share.mailFailed")} (${res.failed}/${res.total})` });
    else setMsg(t(res.skipped ? "pollSharePanel.mailDisabled" : "polls.share.reminded"));
    // Po akcji ponownie pobieramy rzeczywiste zegary i flagi z bazy.
  } catch (e) {
    console.error("[polls] remind", e);
    await alertModal({ text: `${t("polls.share.remindFailed")}\n\n${e?.message || e}` });
  } finally {
    busy = false;
    await safeLoadSubs();
  }
}

async function removeShare(tk, sub) {
  if (busy) return;
  const ok = await confirmModal({
    title: t("polls.share.removeTitle"),
    text: tk.status === "done"
      ? t("polls.share.removeTextVoted", { name: subLabel(sub) })
      : t("polls.share.removeText", { name: subLabel(sub) }),
    okText: t("polls.share.removeOk"),
    cancelText: t("polls.actions.cancel"),
  });
  if (!ok) return;
  busy = true;
  try {
    const { data, error } = await sb().rpc("poll_share_remove", { p_game_id: gameId, p_task_id: tk.id });
    if (error || data?.ok === false) throw new Error(rpcErrText(error, data));
  } catch (e) {
    console.error("[polls] remove share", e);
    await alertModal({ text: `${t("polls.share.removeFailed")}\n\n${e?.message || e}` });
  } finally {
    busy = false;
    await safeLoadSubs();
    void refreshVotes();
    if (!tallyActive) void previewResults().catch(() => {});
  }
}

async function safeLoadSubs() {
  try {
    await loadSubsData();
  } catch (e) {
    console.warn("[polls] load subscribers failed", e);
  }
}

/* =======================
   A. Pasek stanu
======================= */

function show(btn, on) {
  if (btn) btn.hidden = !on;
}

// Stan słowem + krótki opis po lewej; przyciski wg stanu po prawej.
// Główna akcja złota, „Przerwij” zawsze ostatni (stonowany, czerwony obrys).
function renderBar() {
  if (!pollBar || !game) return;
  const st = game.status || STATUS.DRAFT;
  const prepared = game.type === TYPES.PREPARED;
  if (subsSummary) subsSummary.hidden = prepared || !sharingAvailable(st);
  const tallying = tallyActive && st === STATUS.POLL_STOPPED;

  pollBar.dataset.state = tallying ? "tally" : st;
  if (pollStateWord) pollStateWord.textContent = statusLabel(st);

  let info = "";
  if (tallying) info = t("polls.bar.tallyInfo");
  else if (st === STATUS.POLL_OPEN) info = votesText;
  else if (st === STATUS.POLL_STOPPED) info = t("polls.bar.stoppedInfo");
  else if (st === STATUS.READY) info = t("polls.bar.readyInfo");
  if (pollStateInfo) pollStateInfo.textContent = prepared ? "" : info;

  const chk = lastCheck;
  let hint = "";

  show(btnOpenPoll, !prepared && st === STATUS.DRAFT);
  show(btnStopPoll, !prepared && st === STATUS.POLL_OPEN);
  show(btnResumePoll, !prepared && st === STATUS.POLL_STOPPED && !tallying);
  show(btnTallyPoll, !prepared && st === STATUS.POLL_STOPPED && !tallying);
  show(btnLeaveTally, tallying);
  show(btnApproveTally, tallying);
  show(btnReopenPoll, !prepared && st === STATUS.READY);
  show(btnAbort, !prepared && (st === STATUS.POLL_OPEN || st === STATUS.POLL_STOPPED));

  if (btnOpenPoll) {
    // ikona + etykieta (na telefonie sama ikona); textContent kasował oba
    const label = t("polls.actions.openPoll");
    btnOpenPoll.innerHTML = `${icon("play")}<span class="pollActionLabel"></span>`;
    btnOpenPoll.querySelector(".pollActionLabel").textContent = label;
    btnOpenPoll.title = label;
    btnOpenPoll.setAttribute("aria-label", label);
    const ok = chk?.poll_open?.ok;
    btnOpenPoll.disabled = busy || !ok;
    if (st === STATUS.DRAFT && chk && !ok) hint = chk.poll_open.reason;
  }
  if (btnReopenPoll) {
    const ok = chk?.poll_open?.ok;
    btnReopenPoll.disabled = busy || !ok;
    if (st === STATUS.READY && chk && !ok) hint = chk.poll_open.reason;
  }
  if (btnStopPoll) btnStopPoll.disabled = busy || (chk ? !chk.poll_stop?.ok : false);
  if (btnResumePoll) btnResumePoll.disabled = busy;
  if (btnTallyPoll) {
    const ok = chk?.poll_close?.ok;
    btnTallyPoll.disabled = busy || !ok;
    if (st === STATUS.POLL_STOPPED && !tallying && chk && !ok) hint = chk.poll_close.reason;
  }
  if (btnLeaveTally) btnLeaveTally.disabled = busy;
  if (btnApproveTally) btnApproveTally.disabled = busy || !tallyValid;
  if (btnAbort) btnAbort.disabled = busy;

  if (hintTop) hintTop.textContent = hint || "";
}

/* =======================
   Odświeżanie
======================= */

let stateKey = null;      // status + klucz: zmiana = nowy stan / nowe uruchomienie
let refreshSeq = 0;

function renderShareSection(st, link) {
  const available = sharingAvailable(st);
  const hasLink = st === STATUS.POLL_OPEN || st === STATUS.POLL_STOPPED;
  if (shareBody) shareBody.hidden = !available;
  shareBody?.classList.toggle("is-locked", st === STATUS.DRAFT);
  if (shareEmpty) {
    shareEmpty.hidden = available;
    shareEmpty.textContent = st === STATUS.READY ? t("polls.share.closedEmpty") : t("polls.share.draftEmpty");
  }
  if (linkPlaceholder) linkPlaceholder.hidden = st !== STATUS.DRAFT;
  if (linkLive) linkLive.hidden = st === STATUS.DRAFT;
  if (hasLink) {
    if (pollLinkEl) pollLinkEl.value = link;
    setLinkUiVisible(true);
    void renderQr(link);
  } else {
    if (pollLinkEl) pollLinkEl.value = "";
    setLinkUiVisible(false);
    renderedQrUrl = "";
  }
  setShareTabEnabled(st !== STATUS.READY);
}

async function refresh() {
  if (!currentUser) return; // initPage jeszcze nie wpuścił (albo pokazał nakładkę gościa)
  const seq = ++refreshSeq;
  if (!gameId) {
    if (pollBar) pollBar.hidden = true;
    if (cardMain) cardMain.hidden = true;
    if (pollLoadRetryWrap) pollLoadRetryWrap.hidden = true;
    if (cardEmpty) cardEmpty.hidden = false;
    setMsg(t("polls.missingId"), "error");
    return;
  }

  const prev = game;
  try {
    game = await loadGame();
  } catch (error) {
    console.warn("[polls] initial game load failed", error);
    if (!game) {
      const shouldNotify = !initialLoadFailed;
      initialLoadFailed = true;
      if (pollLoadRetryWrap) pollLoadRetryWrap.hidden = false;
      if (shouldNotify) setMsg(t("polls.load.failed"), "error");
    } else {
      setMsg(t("polls.load.failed"), "error");
    }
    return;
  }
  if (seq !== refreshSeq) return;

  initialLoadFailed = false;
  if (pollLoadRetryWrap) pollLoadRetryWrap.hidden = true;
  if (cardEmpty) cardEmpty.hidden = true;
  if (pollBar) pollBar.hidden = false;
  if (cardMain) cardMain.hidden = false;

  const st = game.status || STATUS.DRAFT;
  const key = `${st}:${game.share_key_poll}`;
  if (key !== stateKey) {
    // podliczanie kończy się razem ze stanem „zatrzymana” (podliczenie, wznowienie, przerwanie)
    if (tallyActive && st !== STATUS.POLL_STOPPED) {
      tally.finish();
      tallyActive = false;
      tallyValid = false;
    }
    // nowy stan lub nowe uruchomienie: domyślna wypustka, czysta lista wyników
    stateKey = key;
    tabTouchedByUser = urlTabPending;
    urlTabPending = false;
    if (!tallyActive) resetResultsDom();
    // zaznaczenia przeżywają szkic -> otwarta -> zatrzymana (ten sam klucz)
    if (!prev || prev.share_key_poll !== game.share_key_poll || !sharingAvailable(st)) {
      selectedSubIds.clear();
      selectedFriendIds.clear();
    }
    subsAll = [];
    tasks = [];
    subsSig = "";
    firstQuestionId = null;
    votesText = "";
  }
  // Wypustka z adresu / wybrana przez użytkownika zostaje; inaczej wg stanu ankiety.
  setActiveTab(tabTouchedByUser
    ? (activeTab === "share" && activeShareSide === "recipients" ? "recipients" : activeTab)
    : (st === STATUS.DRAFT || st === STATUS.POLL_OPEN ? "share" : "results"));

  const nameEl = $("pollGameName");
  if (nameEl) {
    nameEl.textContent = t("polls.pageSubtitle", {
      type: typeShortLabel(game.type),
      name: game.name || t("polls.defaultName"),
    });
  }

  renderShareSection(st, st === STATUS.DRAFT ? "" : pollLink(game));
  renderBar();
  // Powód blokady akcji i podsumowanie odbiorców ustalają wysokość paska.
  // Silnik odsłoni ten etap po ich odczycie; wyniki mają osobną gotowość.
  const baseLayoutReady = Promise.all([
    game.type === TYPES.PREPARED ? Promise.resolve(null) : validateGame(game.id),
    sharingAvailable(st) ? safeLoadSubs() : Promise.resolve(),
  ]).then(([chk]) => {
    if (seq === refreshSeq) { lastCheck = chk; renderBar(); }
    return chk;
  });
  holdSkeletonLayout([pollBar, cardMain], baseLayoutReady);
  pollBar?.classList.add("skel-step-ready");
  cardMain?.classList.add("skel-step-ready");

  try {
    const [chk] = await Promise.all([
      baseLayoutReady,
      previewResults(),
      st === STATUS.POLL_OPEN ? refreshVotes() : Promise.resolve(),
    ]);
    if (seq !== refreshSeq) return;
    lastCheck = chk;
  } catch (e) {
    console.warn("[polls] refresh failed", e);
    if (resultsMeta) resultsMeta.textContent = t("polls.results.refreshFailed");
    lastCheck = null;
  }
  resultsList?.classList.add("skel-step-ready");
  renderBar();
}

// odświeżanie na żywo: wyniki i zaproszenia (otwarta), zmiana stanu z innego okna (zatrzymana)
async function liveTick() {
  if (document.hidden || busy || tallyActive || !game) return;
  if (game.status !== STATUS.POLL_OPEN && game.status !== STATUS.POLL_STOPPED) return;
  try {
    const g = await loadGame();
    if (g.status !== game.status || g.share_key_poll !== game.share_key_poll) {
      await refresh();
      return;
    }
    if (game.status === STATUS.POLL_OPEN) {
      const [chk] = await Promise.all([
        validateGame(game.id),
        previewResults(),
        refreshVotes(),
        refreshTasksOnly(),
      ]);
      if (!busy && !tallyActive) { lastCheck = chk; renderBar(); }
    } else {
      await refreshTasksOnly();
    }
  } catch (e) {
    console.warn("[polls] live refresh failed", e);
  }
}

/* =======================
   Akcje stanu
======================= */

async function openPollFlow() {
  const chk = await validateGame(game.id);
  if (!chk.poll_open.ok) return setMsg(chk.poll_open.reason, "error");

  const ok = await confirmModal({
    title: t("polls.modals.open.title"),
    text: t("polls.modals.open.text", { name: game.name }),
    okText: t("polls.modals.open.ok"),
    cancelText: t("polls.modals.open.cancel"),
  });
  if (!ok) return;

  try {
    const { error } = await sb().rpc("poll_open", { p_game_id: gameId, p_key: game.share_key_poll });
    if (error) throw error;
  } catch (e) {
    console.error("[polls] open error:", e);
    await alertModal({ text: `${t("polls.errors.open")}\n\n${gameRuleErrorMessage(e) || e?.message || e}` });
  }
}

async function stopPollFlow() {
  const ok = await confirmModal({
    title: t("polls.modals.stop.title"),
    text: t("polls.modals.stop.text"),
    okText: t("polls.modals.stop.ok"),
    cancelText: t("polls.actions.cancel"),
  });
  if (!ok) return;

  try {
    const { data, error } = await sb().rpc("poll_stop", { p_game_id: gameId });
    if (error || data?.ok === false) throw error || new Error(rpcErrText(null, data));
  } catch (e) {
    console.error("[polls] stop error:", e);
    await alertModal({ text: `${t("polls.errors.stop")}\n\n${gameRuleErrorMessage(e) || e?.message || e}` });
  }
}

async function resumePollFlow() {
  const ok = await confirmModal({
    title: t("polls.modals.resume.title"),
    text: t("polls.modals.resume.text"),
    okText: t("polls.modals.resume.ok"),
    cancelText: t("polls.actions.cancel"),
  });
  if (!ok) return;

  try {
    const { data, error } = await sb().rpc("poll_resume", { p_game_id: gameId });
    if (error || data?.ok === false) throw error || new Error(rpcErrText(null, data));
  } catch (e) {
    console.error("[polls] resume error:", e);
    await alertModal({ text: `${t("polls.errors.resume")}\n\n${gameRuleErrorMessage(e) || e?.message || e}` });
  }
}

async function abortPollFlow() {
  const ok = await confirmModal({
    title: t("polls.modals.abort.title"),
    text: t("polls.modals.abort.text"),
    okText: t("polls.modals.abort.ok"),
    cancelText: t("polls.actions.cancel"),
  });
  if (!ok) return;

  try {
    const { data, error } = await sb().rpc("poll_abort", { p_game_id: gameId });
    if (error || data?.ok === false) throw new Error(rpcErrText(error, data));
    if (tallyActive) {
      tally.finish();
      tallyActive = false;
      tallyValid = false;
    }
  } catch (e) {
    console.error("[polls] abort error:", e);
    await alertModal({ text: `${t("polls.errors.abort")}\n\n${e?.message || e}` });
  }
}

async function restartPollFlow() {
  const chk = await validateGame(game.id);
  if (!chk.poll_open.ok) return setMsg(chk.poll_open.reason, "error");

  const ok = await confirmModal({
    title: t("polls.modals.reopen.title"),
    text: t("polls.modals.reopen.text"),
    okText: t("polls.modals.reopen.ok"),
    cancelText: t("polls.modals.reopen.cancel"),
  });
  if (!ok) return;

  let aborted = false;
  try {
    const { data, error } = await sb().rpc("poll_abort", { p_game_id: gameId });
    if (error || data?.ok === false || !data?.share_key_poll) throw new Error(rpcErrText(error, data));
    aborted = true;
    const { error: e2 } = await sb().rpc("poll_open", { p_game_id: gameId, p_key: data.share_key_poll });
    if (e2) throw e2;
  } catch (e) {
    console.error("[polls] reopen error:", e);
    await alertModal({ text: `${t("polls.errors.reopen")}${aborted ? `\n${t("polls.errors.reopenAborted")}` : ""}\n\n${e?.message || e}` });
  }
}

async function runStateAction(fn) {
  if (!game || busy) return;
  busy = true;
  renderBar();
  try {
    await fn();
  } finally {
    busy = false;
    // stan i klucz zawsze czytamy z bazy od nowa (uruchomienie zmienia share_key_poll)
    try { await refresh(); } catch (e) { console.warn("[polls] refresh after action", e); }
  }
}

/* =======================
   Init
======================= */

document.addEventListener("DOMContentLoaded", async () => {
  const i18nP = initI18n({ withSwitcher: true });
  if (gameId) { prefetchedGame = loadGame(); prefetchedGame.catch(() => {}); }
  // Poprawki podliczania zapisują się same (szkic w bazie); przed wyjściem
  // tylko dopychamy ostatni zapis.
  const userP = initPage("polls", {
    ready: i18nP,
    onBack: async (href) => {
      try { await tally.flush(); } catch { /* szkic i tak jest w bazie */ }
      location.href = href;
    },
  });
  await i18nP;
  document.documentElement.classList.remove('page-loading');

  const u = await userP;
  if (!u) return; // przekierowanie na logowanie albo nakładka gościa
  currentUser = u;
  guestMode = isGuestUser(u);
  if (guestMode) {
    if (recipientShareTab) recipientShareTab.hidden = true;
    if (recipientShareSection) recipientShareSection.hidden = true;
    if (btnAddRecipients) btnAddRecipients.hidden = true;
  }
  pollLoadRetry?.addEventListener("click", () => {
    initialLoadFailed = false;
    void refresh();
  });

  window.addEventListener("pagehide", () => { void tally.flush(); });

  tabShare?.addEventListener("click", () => { if (!tabShare.disabled) setActiveTab("share", { byUser: true }); });
  tabRecipients?.addEventListener("click", () => { if (!tabRecipients.disabled) setActiveTab("recipients", { byUser: true }); });
  tabResults?.addEventListener("click", () => setActiveTab("results", { byUser: true }));
  const mobilePollTabs = window.matchMedia("(max-width: 980px)");
  mobilePollTabs.addEventListener?.("change", (event) => {
    if (!event.matches && activeShareSide === "recipients") setActiveTab("share");
  });

  [pollRecipientsClose, pollRecipientsCancel].forEach((button) => button?.addEventListener("click", closeRecipientPicker));
  pollRecipientsAdd?.addEventListener("click", () => void acceptRecipientSelection());
  btnAddRecipients?.addEventListener("click", () => void openRecipientPicker());

  btnCopy?.addEventListener("click", async () => {
    if (!pollLinkEl?.value) return;
    try {
      await navigator.clipboard.writeText(pollLinkEl.value);
      setMsg(t("polls.copy.success"));
    } catch {
      setMsg(t("polls.copy.failed"), "error");
    }
  });

  btnOpen?.addEventListener("click", () => {
    if (!pollLinkEl?.value) return;
    window.open(pollLinkEl.value, "_blank", "noopener,noreferrer");
  });

  btnOpenQr?.addEventListener("click", () => {
    showPollQrModal();
  });

  qrBox?.addEventListener("click", () => { void showVoteQrModal(); });

  btnOpenPoll?.addEventListener("click", () => runStateAction(openPollFlow));
  btnStopPoll?.addEventListener("click", () => runStateAction(async () => {
    await stopPollFlow();
  }));
  btnResumePoll?.addEventListener("click", () => runStateAction(resumePollFlow));
  btnTallyPoll?.addEventListener("click", () => runStateAction(async () => { await enterTally(); }));
  btnLeaveTally?.addEventListener("click", () => runStateAction(leaveTally));
  btnApproveTally?.addEventListener("click", () => runStateAction(approveTallyFlow));
  btnReopenPoll?.addEventListener("click", () => runStateAction(restartPollFlow));
  btnAbort?.addEventListener("click", () => runStateAction(abortPollFlow));

  btnUndo?.addEventListener("click", () => tally.undo());
  btnRedo?.addEventListener("click", () => tally.redo());

  // Skróty Cofnij / Ponów w podliczaniu (poza polem tekstu — tam działa natywne cofanie)
  document.addEventListener("keydown", (e) => {
    if (!tallyActive || tally.mode() !== "text") return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === "z") {
      e.preventDefault();
      if (e.shiftKey) tally.redo(); else tally.undo();
    } else if (ctrl && k === "y") {
      e.preventDefault();
      tally.redo();
    }
  });

  // resourceType: "game" — dołącza do już istniejącego wspólnego klucza
  // z editor.js/game-settings.js (patrz komentarz w editor.js przy tym
  // samym wywołaniu): podliczenie zapisuje punkty do answers.fixed_points,
  // więc otwarcie ankiety wyklucza edytor/ustawienia tej samej gry i odwrotnie,
  // nie tylko drugą kartę tej samej strony.
  if (gameId) {
    const lock = await guardResourceLock({
      resourceType: "game",
      resourceId: gameId,
      context: "polls",
      message: t("resourceLock.gameMessage"),
      backHref: backHref("polls"),
    });
    if (!lock.ok) return;
    // Blokada stanu: strona ankiety tylko dla gry, która może mieć ankietę.
    if (!(await guardGameState(gameId, "poll_entry", { backHref: backHref("polls") }))) return;
  }

  await refresh();
  setInterval(() => void liveTick(), LIVE_REFRESH_MS);
});
