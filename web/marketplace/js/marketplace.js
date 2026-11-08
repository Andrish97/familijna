// js/pages/marketplace.js

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T15433";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-08T15433";
import { initI18n, t, getUiLang, applyTranslations } from "../../shared/translation/translation.js?v=v2026-11-08T15433";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T15433";
import { rulesFromState } from "../../shared/js/core/game-validate.js?v=v2026-11-08T15433";
import { initUiSelect } from "../../shared/js/core/ui-select.js?v=v2026-11-08T15433";
import { toast } from "../../shared/js/core/toast.js?v=v2026-11-08T15433";
import { confirmModal, promptModal } from "../../shared/js/core/modal.js?v=v2026-11-08T15433";
import { openDialog, closeDialog, setOverlayOpen, isOverlayOpen } from "../../shared/js/core/modal-sheet.js?v=v2026-11-08T15433";
import "../../shared/js/core/contact-modal.js?v=v2026-11-08T15433";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-08T15433";
import { initListHeaderLayout } from "../../shared/js/core/list-header-layout.js?v=v2026-11-08T15433";
import { cardInner, gamePath, publicRow, questionsHtml, starsHtml, selectRows, syncMarketSeo } from "./public.js?v=v2026-11-08T15433";
import { emptyStateHtml } from "../../shared/js/core/empty-state.js?v=v2026-11-08T15433";

let initialPublic = null;
try { initialPublic = JSON.parse(document.getElementById("marketBootstrap")?.textContent || "null"); }
catch { /* Brak odcisku w lokalnym podglądzie: zwykły odczyt publicznego RPC. */ }
let libraryIds = new Set();

// Status zgłoszonej gry → wariant oznaczenia (.tag z base.css).
const MKT_STATUS_TAG = { pending: "tag--warn", published: "tag--ok", rejected: "tag--bad", withdrawn: "tag--muted" };

/* =========================================================
   Constants
========================================================= */
const PAGE_SIZE = 20;

/* =========================================================
   State
========================================================= */
let currentUser   = null;
let isGuest       = false;
let currentOffset = 0;
let currentSearch = "";
let currentLangFilter = "all";
let currentSort = "recommended";
let searchTimer   = null;
let detailGameId  = null;
let detailGame    = null;
let submitLang    = "pl";
let submitGameUiSelect = null;
let langFilterUiSelect = null;
let sortUiSelect = null;
let browseRequest = 0;
let detailRequest = 0;
let browseLoading = false;
let browseRows = [];
let lastDetailTrigger = null;
// Podgląd i zgłoszenie otwarte z okna „Moje wysłane” wracają do niego po zamknięciu.
let returnToMySent = false;
let skipNextPopstate = false;

/* =========================================================
   Elements
========================================================= */
const els = {
  // views
  viewBrowse:  document.getElementById("viewBrowse"),
  mySentOverlay: document.getElementById("mySentOverlay"),
  btnMySentClose: document.getElementById("btnMySentClose"),
  // browse
  browseGrid:  document.getElementById("browseGrid"),
  browseInfo:  document.getElementById("browseInfo"),
  searchInput: document.getElementById("searchInput"),
  btnSearchFocus: document.getElementById("btnSearchFocus"),
  btnSearchClear: document.getElementById("btnSearchClear"),
  langFilter: document.getElementById("langFilter"),
  sortSelect: document.getElementById("sortSelect"),
  loadMoreWrap:document.getElementById("loadMoreWrap"),
  btnLoadMore: document.getElementById("btnLoadMore"),
  btnMySent:   document.getElementById("btnMySent"),
  // mine
  mySentList:  document.getElementById("mySentList"),
  mySentInfo:  document.getElementById("mySentInfo"),
  btnSubmitNew:document.getElementById("btnSubmitNew"),
  // detail modal
  gameDetailOverlay: document.getElementById("gameDetailOverlay"),
  detailTitle:  document.getElementById("detailTitle"),
  detailMeta:   document.getElementById("detailMeta"),
  detailDesc:   document.getElementById("detailDesc"),
  detailQuestions: document.getElementById("detailQuestions"),
  detailRating: document.getElementById("detailRating"),
  detailRaters: document.getElementById("detailRaters"),
  btnDetailClose:  document.getElementById("btnDetailClose"),
  btnAddLibrary:   document.getElementById("btnAddLibrary"),
  btnRemoveLibrary:document.getElementById("btnRemoveLibrary"),
  addedBadge:      document.getElementById("addedBadge"),
  // submit modal
  submitOverlay:       document.getElementById("submitOverlay"),
  submitGameSelectEl:  document.getElementById("submitGameSelect"),
  submitNoEligible:    document.getElementById("submitNoEligible"),
  submitTitle:      document.getElementById("submitTitle"),
  submitDesc:       document.getElementById("submitDesc"),
  submitLangPicker: document.getElementById("submitLangPicker"),
  submitConfirm:    document.getElementById("submitConfirm"),
  submitError:      document.getElementById("submitError"),
  btnSubmitCancel:  document.getElementById("btnSubmitCancel"),
  btnSubmitConfirm: document.getElementById("btnSubmitConfirm"),
  // nav
  btnGoGames:  document.getElementById("btnGoGames"),
  btnManual:     document.getElementById("btnManual"),
};

/* =========================================================
   Toast
========================================================= */
function showToast(msg, type = "info") {
  toast(msg, { kind: type === "error" ? "error" : "info" });
}

/* =========================================================
   Views
========================================================= */
/* Okno „Moje wysłane” (decyzja 2026-10-21: okno zamiast karty strony). */
function openMySent() {
  if (isGuest || !currentUser || !els.mySentOverlay) return;
  returnToMySent = false;
  openDialog(els.mySentOverlay, { onClose: closeMySent });
  void loadMySent();
}

function closeMySent() {
  if (!els.mySentOverlay || !isOverlayOpen(els.mySentOverlay)) return;
  closeDialog(els.mySentOverlay);
}

// Podgląd lub zgłoszenie z okna „Moje wysłane”: jedno okno naraz, po
// zamknięciu wracamy do listy zgłoszeń.
function leaveMySentFor(action) {
  returnToMySent = true;
  // Na telefonie okno ma wpis ?dialog= w historii: zamknięcie robi history.back(),
  // a spóźniony popstate zamknąłby od razu nowo otwarte okno. Czekamy na niego.
  const popsHistory = new URL(location.href).searchParams.get("dialog") === els.mySentOverlay?.id;
  if (!popsHistory) {
    closeMySent();
    return action();
  }
  skipNextPopstate = true;
  window.addEventListener("popstate", () => { skipNextPopstate = false; action(); }, { once: true });
  closeMySent();
}

function backToMySent() {
  if (!returnToMySent) return;
  returnToMySent = false;
  openMySent();
}

function langFilterOptions() {
  return [
    { value: "all", label: t("marketplace.filterAll") },
    { value: "pl", label: "Polski" },
    { value: "en", label: "English" },
    { value: "uk", label: "Українська" },
  ];
}

function sortOptions() {
  return [
    { value: "recommended", label: t("marketplace.sortRecommended") },
    { value: "rating", label: t("marketplace.sortRating") },
    { value: "popular", label: t("marketplace.sortPopular") },
    { value: "newest", label: t("marketplace.sortNewest") },
    { value: "title", label: t("marketplace.sortTitle") },
  ];
}

function refreshBrowseSelectLabels() {
  langFilterUiSelect?.setOptions(langFilterOptions());
  sortUiSelect?.setOptions(sortOptions());
}

function syncSearchButton() {
  const active = !!String(els.searchInput?.value || "").trim();
  if (els.btnSearchClear) els.btnSearchClear.hidden = !String(els.searchInput?.value || "");
  if (els.btnSearchFocus) {
    els.btnSearchFocus.innerHTML = icon(active ? "close" : "search");
    els.btnSearchFocus.classList.toggle("is-active", active);
    const label = t(active ? "marketplace.searchClear" : "marketplace.searchLabel");
    els.btnSearchFocus.setAttribute("aria-label", label);
    els.btnSearchFocus.title = label;
  }
}

function syncBrowseControlStates() {
  els.langFilter?.classList.toggle("is-active", currentLangFilter !== "all");
  els.sortSelect?.classList.toggle("is-active", currentSort !== "recommended");
  syncSearchButton();
}

function initBrowseUiSelects() {
  els.btnSearchFocus?.addEventListener("click", async () => {
    const input = els.searchInput;
    if (String(input?.value || "").trim()) {
      input.value = "";
      syncSearchButton();
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    const inputVisible = !!input
      && getComputedStyle(input).display !== "none"
      && getComputedStyle(input).visibility !== "hidden"
      && input.getClientRects().length > 0;
    if (inputVisible) {
      input.focus();
      return;
    }
    const value = await promptModal({
      title: t("marketplace.searchLabel"),
      value: currentSearch,
      placeholder: t("marketplace.searchPlaceholder"),
      text: "",
      okText: t("common.modal.alertOk"),
      search: true,
    });
    if (value === null) return;
    els.searchInput.value = value;
    syncSearchButton();
    els.searchInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  els.btnSearchClear?.addEventListener("click", (e) => {
    e.preventDefault();
    els.searchInput.value = "";
    syncSearchButton();
    els.searchInput.dispatchEvent(new Event("input", { bubbles: true }));
    els.searchInput.focus();
  });
  langFilterUiSelect = initUiSelect(els.langFilter, {
    options: langFilterOptions(),
    value: currentLangFilter,
    onChange: async (value) => {
      if (value === currentLangFilter) return;
      currentLangFilter = value;
      syncBrowseControlStates();
      syncBrowseParams();
      await loadBrowse({ reset: true });
    },
  });

  sortUiSelect = initUiSelect(els.sortSelect, {
    options: sortOptions(),
    value: currentSort,
    onChange: async (value) => {
      if (value === currentSort) return;
      currentSort = value;
      syncBrowseControlStates();
      syncBrowseParams();
      await loadBrowse({ reset: true });
    },
  });
}

/* =========================================================
   Browse — load + render
========================================================= */
async function loadBrowse({ reset = false, hydrate = false } = {}) {
  if (browseLoading && !reset) return;
  if (!reset) {
    const nextRows = browseRows.slice(currentOffset, currentOffset + PAGE_SIZE);
    nextRows.forEach(g => els.browseGrid?.appendChild(makeGameCard(g)));
    currentOffset += nextRows.length;
    if (els.loadMoreWrap) els.loadMoreWrap.hidden = currentOffset >= browseRows.length;
    return;
  }
  const requestId = ++browseRequest;
  browseLoading = true;
  if (els.btnLoadMore) els.btnLoadMore.disabled = true;
  const boot = hydrate && initialPublic;
  const result = boot ? { data: boot.games } : await sb().rpc("market_public_catalog");
  if (requestId !== browseRequest) return;
  browseLoading = false;
  if (els.btnLoadMore) els.btnLoadMore.disabled = false;
  if (result.error) {
    console.error("[marketplace] loadBrowse failed", result.error);
    if (els.browseInfo) els.browseInfo.textContent = t("marketplace.errorLoad");
    return; // Gotowy HTML nie znika po awarii odczytu.
  }
  const rows = (Array.isArray(result.data) ? result.data : []).map(publicRow)
    .map(g => ({ ...g, in_library: libraryIds.has(g.id) }));
  browseRows = selectRows(rows, { search: currentSearch, filter: currentLangFilter, sort: currentSort, lang: getUiLang() });
  const reuse = boot && boot.lang === getUiLang() && els.browseGrid?.querySelector(".mkt-card");
  if (reuse) {
    currentOffset = browseRows.length;
  } else {
    currentOffset = Math.min(PAGE_SIZE, browseRows.length);
    els.browseGrid?.replaceChildren(...browseRows.slice(0, currentOffset).map(makeGameCard));
    if (!browseRows.length && els.browseGrid) els.browseGrid.innerHTML = emptyStateHtml(t("marketplace.empty"), { variant: "tile", hook: "mkt-empty" });
  }
  if (els.loadMoreWrap) els.loadMoreWrap.hidden = currentOffset >= browseRows.length;
  if (els.browseInfo) els.browseInfo.textContent = "";
}

function makeGameCard(g) {
  const card = document.createElement("a");
  card.className = "mkt-card" + (g.origin === "producer" ? " mkt-card-producer" : "");
  card.dataset.id = g.id;
  card.href = gamePath(g, getUiLang());
  card.innerHTML = cardInner(g, t);
  return card;
}

/* =========================================================
   Detail modal
========================================================= */
async function openDetailBySlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(slug || ""))) {
    showToast(t("marketplace.detail.notFound"), "error");
    return;
  }
  const { data, error } = await sb().rpc("market_game_by_slug", { p_slug: slug }).single();
  if (error || !data) {
    console.error("[marketplace] openDetailBySlug error:", error, slug);
    showToast(t("marketplace.detail.notFound"), "error");
    return;
  }
  await openDetail(data.id, { updateUrl: false });
}

async function openDetail(id, { updateUrl = true, replaceUrl = false, trigger = null } = {}) {
  const requestId = ++detailRequest;
  detailGameId = id;
  detailGame = null;
  lastDetailTrigger = trigger || document.activeElement;

  // Show modal immediately with loading state
  if (els.gameDetailOverlay) els.gameDetailOverlay.dataset.detailState = "loading";
  if (els.detailTitle) els.detailTitle.textContent = "…";
  if (els.detailMeta) els.detailMeta.textContent = "";
  if (els.detailDesc) els.detailDesc.textContent = "";
  if (els.detailQuestions) els.detailQuestions.innerHTML = emptyStateHtml(t("marketplace.loading"), { tag: "p" });
  if (els.detailRating) els.detailRating.innerHTML = "";
  if (els.detailRaters) { els.detailRaters.hidden = true; els.detailRaters.innerHTML = ""; }
  if (els.btnAddLibrary) els.btnAddLibrary.hidden = true;
  if (els.btnRemoveLibrary) els.btnRemoveLibrary.hidden = true;
  if (els.addedBadge) els.addedBadge.hidden = true;
  openDialog(els.gameDetailOverlay, { onClose: closeDetail });

  const { data, error } = await sb().rpc("market_game_detail", { p_id: id }).single();
  if (requestId !== detailRequest) return;
  if (error || !data) {
    console.error("[marketplace] openDetail error:", error);
    if (els.gameDetailOverlay) els.gameDetailOverlay.dataset.detailState = "error";
    if (els.gameDetailOverlay) closeDialog(els.gameDetailOverlay);
    detailGameId = null;
    showToast(t("marketplace.errorLoad"), "error");
    return;
  }

  const g = data;
  detailGame = g;
  renderDetail(g);
  if (els.gameDetailOverlay) els.gameDetailOverlay.dataset.detailState = "ready";

  // Slug pozostaje adresem szczegółów. RPC po slugu obejmuje gry publiczne
  // oraz niepubliczne zgłoszenia widoczne wyłącznie dla ich autora.
  if (updateUrl) setDetailUrl(g, { replace: replaceUrl });
  syncMarketSeo(getUiLang(), t, g.status === "published" ? g : null, g.status !== "published");
  els.btnDetailClose?.focus();
}

function renderDetail(g, { preserveQuestions = false } = {}) {
  const detailRating = els.detailRating;
  const detailRaters = els.detailRaters;
  if (els.detailTitle) els.detailTitle.textContent = g.title;
  if (els.detailMeta) {
    const isProducer = g.origin === "producer";
    if (isProducer) {
      els.detailMeta.innerHTML = `${esc(g.lang.toUpperCase())} · <span class="tag tag--gold mkt-badge-producer">${esc(t("marketplace.producerBadge"))}</span>`;
    } else {
      els.detailMeta.textContent = `${g.lang.toUpperCase()} · ${g.author_username}`;
    }
  }
  if (els.detailDesc) els.detailDesc.textContent = g.description || "";

  // Przy przejęciu SSR elementy z pytaniami pozostają w dokumencie.
  if (els.detailQuestions && !preserveQuestions) {
    els.detailQuestions.lang = g.lang;
    els.detailQuestions.innerHTML = questionsHtml(g, t) || emptyStateHtml(t("marketplace.detail.noQuestions"), { tag: "p" });
  }

  if (preserveQuestions) els.detailQuestions?.querySelectorAll("[data-points]").forEach(el => {
    el.textContent = `(${t("marketplace.detail.points", { count: Number(el.dataset.points) })})`;
  });

  // Rating display + input
  if (detailRating) {
    detailRating.innerHTML = "";
    const summary = document.createElement("div");
    summary.className = "mkt-rating-summary";
    summary.innerHTML = starsDisplay(g.avg_rating, g.rating_count);
    detailRating.appendChild(summary);

    const canRate = !!currentUser && !isGuest && g.status === "published";
    if (canRate) {
      detailRating.appendChild(buildStarInput(g.id, g.user_stars));
    }
  }

  // Raters list (only visible if current user is the author — RPC returns empty otherwise)
  if (detailRaters && currentUser) loadRaters(g.id, detailRaters);

  // Przyciski biblioteki
  const inLibrary = !!g.in_library;
  const withdrawn = g.status === "withdrawn";
  updateLibraryButtons(inLibrary, withdrawn);

  if (els.gameDetailOverlay) setOverlayOpen(els.gameDetailOverlay, true);
}

function marketplaceUrl() {
  const url = new URL(location.href);
  url.pathname = "/marketplace/";
  url.searchParams.delete("game");
  return `${url.pathname}${url.search}${url.hash}`;
}

function setDetailUrl(game, { replace = false } = {}) {
  const url = new URL(marketplaceUrl(), location.origin);
  if (game.status === "published" && game.slug) url.pathname = `/marketplace/game/${encodeURIComponent(game.slug)}`;
  else url.searchParams.set("game", game.id);
  const state = { gameSlug: game.status === "published" ? game.slug : null };
  if (replace) history.replaceState(state, "", `${url.pathname}${url.search}${url.hash}`);
  else history.pushState(state, "", `${url.pathname}${url.search}${url.hash}`);
}

function updateLibraryButtons(inLibrary, withdrawn = false) {
  const canAdd = !!currentUser && !inLibrary && detailGame?.status === "published";
  const canRemove = !!currentUser && inLibrary;

  if (els.btnAddLibrary)    els.btnAddLibrary.hidden    = !canAdd;
  if (els.btnRemoveLibrary) els.btnRemoveLibrary.hidden = !canRemove;
  if (els.addedBadge) {
    els.addedBadge.hidden = !inLibrary;
    if (inLibrary && withdrawn) {
      els.addedBadge.innerHTML = iconText("check", `${t("marketplace.addedBadge")} · ${t("marketplace.withdrawnBadge")}`);
    } else if (inLibrary) {
      els.addedBadge.innerHTML = iconText("check", t("marketplace.addedBadge"));
    }
  }
}

function closeDetail({ updateUrl = true } = {}) {
  detailRequest++;
  if (els.gameDetailOverlay) closeDialog(els.gameDetailOverlay);
  detailGameId = null;
  detailGame = null;
  syncMarketSeo(getUiLang(), t);
  // Usuń identyfikator modala bez zmiany karty, wyszukiwania ani filtrów.
  if (updateUrl && (new URL(location.href).searchParams.has("game") || location.pathname.startsWith("/marketplace/game/"))) {
    // Zamknięcie nie może dopisywać kolejnego wpisu: sekwencja
    // otwórz → zamknij → otwórz → Wstecz wracałaby do starego detail URL.
    history.replaceState(null, "", marketplaceUrl());
  }
  lastDetailTrigger?.focus?.();
  lastDetailTrigger = null;
  if (updateUrl) backToMySent();
}

/* =========================================================
   Library — add / remove
========================================================= */
async function addToLibrary() {
  if (!detailGameId || !currentUser) return;
  if (els.btnAddLibrary) els.btnAddLibrary.disabled = true;

  const { data, error } = await sb().rpc("market_add_to_library", { p_market_game_id: detailGameId });
  if (els.btnAddLibrary) els.btnAddLibrary.disabled = false;

  if (error) { console.error("[marketplace] addToLibrary error:", error); showToast(rpcErrorMessage(error), "error"); return; }
  const res = Array.isArray(data) ? data[0] : data;
  if (!res?.ok) { showToast(marketErrorMessage(res?.err), "error"); return; }

  showToast(t("marketplace.addedBadge"), "success");
  updateLibraryButtons(true, detailGame?.status === "withdrawn");
  if (detailGame) detailGame.in_library = true;
  refreshCardInLibrary(detailGameId, true);
}

async function removeFromLibrary() {
  if (!detailGameId || !currentUser) return;
  if (els.btnRemoveLibrary) els.btnRemoveLibrary.disabled = true;

  const { data, error } = await sb().rpc("market_remove_from_library", { p_market_game_id: detailGameId });
  if (els.btnRemoveLibrary) els.btnRemoveLibrary.disabled = false;

  if (error) { console.error("[marketplace] removeFromLibrary error:", error); showToast(rpcErrorMessage(error), "error"); return; }
  const res = Array.isArray(data) ? data[0] : data;
  if (!res?.ok) { showToast(marketErrorMessage(res?.err), "error"); return; }

  updateLibraryButtons(false);
  if (detailGame) detailGame.in_library = false;
  refreshCardInLibrary(detailGameId, false);
}

function refreshCardInLibrary(id, inLibrary) {
  if (inLibrary) libraryIds.add(id); else libraryIds.delete(id);
  const card = els.browseGrid?.querySelector(`[data-id="${id}"]`);
  if (!card) return;
  const badge = card.querySelector(".mkt-badge-added");
  if (inLibrary && !badge) {
    const top = card.querySelector(".mkt-card-top");
    const span = document.createElement("span");
    span.className = "tag tag--ok mkt-badge-added";
    span.innerHTML = iconText("check", t("marketplace.addedBadge"));
    top?.appendChild(span);
  } else if (!inLibrary && badge) {
    badge.remove();
  }
}

/* =========================================================
   Moje wysłane
========================================================= */
async function loadMySent() {
  if (!els.mySentList) return;
  els.mySentList.innerHTML = "";
  if (els.mySentInfo) els.mySentInfo.textContent = t("marketplace.loading");

  const { data, error } = await sb().rpc("market_my_submissions");
  if (error) {
    console.error("[marketplace] loadMySent error:", error);
    if (els.mySentInfo) els.mySentInfo.textContent = t("marketplace.errorLoad");
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  if (els.mySentInfo) els.mySentInfo.textContent = "";
  if (!rows.length) {
    els.mySentList.innerHTML = emptyStateHtml(t("marketplace.mySent.empty"), { variant: "tile", hook: "mkt-empty" });
    return;
  }

  const statusLabels = {
    pending:   t("marketplace.mySent.statusPending"),
    published: t("marketplace.mySent.statusPublished"),
    rejected:  t("marketplace.mySent.statusRejected"),
    withdrawn: t("marketplace.mySent.statusWithdrawn"),
  };

  els.mySentList.innerHTML = rows.map(g => {
    const statusClass = MKT_STATUS_TAG[g.status] || "";
    const note = g.moderation_note
      ? `<div class="mkt-sent-note">${esc(t("marketplace.mySent.reasonLabel").replace("{note}", g.moderation_note))}</div>`
      : "";
    const withdrawBtn = g.status === "published"
      ? `<button class="btn sm" data-withdraw="${esc(g.id)}" type="button">${icon("close")}<span>${esc(t("marketplace.mySent.btnWithdraw"))}</span></button>`
      : "";
    const ratingInfo = g.rating_count
      ? `<span class="mkt-sent-rating">${starsDisplay(g.avg_rating, g.rating_count)}</span>`
      : "";
    const libraryInfo = `<span class="mkt-sent-library">${esc(t("marketplace.libraryCount").replace("{count}", g.library_count ?? 0))}</span>`;
    return `<div class="shareRow mkt-sent-row">
      <div class="mkt-sent-info">
        <div class="mkt-sent-title">${esc(g.title)}</div>
        <div class="mkt-sent-meta">${esc(g.lang.toUpperCase())} · ${libraryInfo} ${ratingInfo}</div>
        <span class="tag tag--upper ${statusClass} mkt-status-badge">${esc(statusLabels[g.status] ?? g.status)}</span>
        ${note}
      </div>
      <div class="cluster mkt-sent-actions">
        <button class="btn sm" data-preview="${esc(g.id)}" type="button">${icon("eye")}<span>${esc(t("marketplace.mySent.btnPreview"))}</span></button>
        ${withdrawBtn}
      </div>
    </div>`;
  }).join("");

  // Wire withdraw buttons
  els.mySentList.querySelectorAll("[data-withdraw]").forEach(btn => {
    btn.addEventListener("click", () => withdrawGame(btn.dataset.withdraw));
  });
  // Wire preview buttons
  els.mySentList.querySelectorAll("[data-preview]").forEach(btn => {
    btn.addEventListener("click", () => leaveMySentFor(() => openDetail(btn.dataset.preview)));
  });
}

async function withdrawGame(id) {
  const ok = await confirmModal({
    title: t("marketplace.mySent.withdrawConfirmTitle"),
    text:  t("marketplace.mySent.withdrawConfirm"),
    okText:     t("marketplace.mySent.btnWithdraw"),
    cancelText: t("common.cancel"),
  });
  if (!ok) return;

  const { data, error } = await sb().rpc("market_withdraw", { p_market_game_id: id });
  if (error) { console.error("[marketplace] withdrawGame error:", error); showToast(rpcErrorMessage(error), "error"); return; }
  const res = Array.isArray(data) ? data[0] : data;
  if (!res?.ok) { showToast(marketErrorMessage(res?.err), "error"); return; }

  showToast(t("marketplace.mySent.withdrawn"), "success");
  await loadMySent();
}

/* =========================================================
   Submit modal
========================================================= */
async function openSubmitModal() {
  // Kwalifikujące się gry: własne, nie z Marketplace, nie demo -- i grywalne
  // według centralnych reguł (rules_state.play: gotowa preparowana albo
  // zamknięta ankieta). Tę samą regułę sprawdza market_submit_game (E21).
  const { data: games, error } = await sb()
    .from("games")
    .select("id,name,type,status,rules_state")
    .eq("owner_id", currentUser.id)
    .is("source_market_id", null)
    .eq("is_demo", false)
    .in("type", ["prepared", "poll_text", "poll_points"])
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[marketplace] eligible games error:", error);
    showToast(t("marketplace.submit.errorLoadEligible"), "error");
    return;
  }

  const eligible = (games || []).filter((g) => !!rulesFromState(g.rules_state)?.play?.ok);

  const hasEligible = eligible.length > 0;

  if (submitGameUiSelect) {
    submitGameUiSelect.setOptions(eligible.map(g => ({ value: g.id, label: g.name })));
    submitGameUiSelect.setValue("", { silent: true });
  }
  if (els.submitGameSelectEl) els.submitGameSelectEl.hidden = !hasEligible;
  if (els.submitNoEligible) els.submitNoEligible.hidden = hasEligible;
  if (els.submitTitle) els.submitTitle.value = "";
  if (els.submitDesc) els.submitDesc.value = "";
  if (els.submitConfirm) els.submitConfirm.checked = false;
  if (els.submitError) els.submitError.hidden = true;

  // Reset lang picker
  submitLang = getUiLang();
  els.submitLangPicker?.querySelectorAll("[data-lang]").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.lang === submitLang);
  });

  openDialog(els.submitOverlay, { onClose: closeSubmitModal });
}

function closeSubmitModal() {
  if (!els.submitOverlay || !isOverlayOpen(els.submitOverlay)) return;
  closeDialog(els.submitOverlay);
  backToMySent();
}

function showSubmitError(msg) {
  if (!els.submitError) return;
  els.submitError.textContent = msg;
  els.submitError.hidden = false;
}

async function submitGame() {
  if (els.submitError) els.submitError.hidden = true;

  const gameId = submitGameUiSelect?.getValue() || "";
  const title  = els.submitTitle?.value.trim() ?? "";
  const desc   = els.submitDesc?.value.trim() ?? "";
  const confirmed = els.submitConfirm?.checked;

  if (!gameId)    return showSubmitError(t("marketplace.submit.errorMissingGame"));
  if (!title)     return showSubmitError(t("marketplace.submit.errorMissingTitle"));
  if (!confirmed) return showSubmitError(t("marketplace.submit.errorCheckbox"));

  if (els.btnSubmitConfirm) els.btnSubmitConfirm.disabled = true;

  let payload;
  try {
    const { exportGame } = await import("../../games/js/games-import-export.js?v=v2026-11-08T15433");
    payload = await exportGame(gameId);
  } catch (e) {
    console.error("[marketplace] submitGame export error:", e);
    if (els.btnSubmitConfirm) els.btnSubmitConfirm.disabled = false;
    showSubmitError(String(e?.message || e));
    return;
  }

  const { data, error } = await sb().rpc("market_submit_game", {
    p_game_id:     gameId,
    p_title:       title,
    p_description: desc,
    p_lang:        submitLang,
    p_payload:     payload,
  });

  if (els.btnSubmitConfirm) els.btnSubmitConfirm.disabled = false;

  if (error) { console.error("[marketplace] submitGame rpc error:", error); showSubmitError(rpcErrorMessage(error)); return; }
  const res = Array.isArray(data) ? data[0] : data;
  if (!res?.ok) {
    const errCode = res?.err || "submit_failed";
    if (errCode === "duplicate_content") {
      showSubmitError(marketErrorMessage(errCode));
      els.submitError?.scrollIntoView({ block: "nearest" });
      return;
    }
    const errKey = `marketplace.submit.err.${errCode}`;
    const errMsg = t(errKey);
    showSubmitError(errMsg === errKey ? t("marketplace.submit.err.submit_failed") : errMsg);
    return;
  }

  showToast(t("marketplace.submit.success"), "success");
  closeSubmitModal();
}

/* =========================================================
   Ratings
========================================================= */
function starsDisplay(avg, count) { return starsHtml(avg, count, t); }

function buildStarInput(gameId, selectedStars = 0) {
  const wrap = document.createElement("div");
  wrap.className = "mkt-rate-wrap";

  const label = document.createElement("span");
  label.className = "field-label";
  label.textContent = t("marketplace.rating.rateThis");
  wrap.appendChild(label);

  const row = document.createElement("div");
  row.className = "mkt-star-input";
  for (let i = 1; i <= 5; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mkt-star-btn";
    btn.innerHTML = icon("star");
    btn.setAttribute("aria-label", `${i}/5`);
    btn.dataset.stars = i;
    btn.classList.toggle("selected", i <= Number(selectedStars || 0));
    btn.setAttribute("aria-pressed", i === Number(selectedStars || 0) ? "true" : "false");
    btn.addEventListener("mouseover", () => {
      row.querySelectorAll(".mkt-star-btn").forEach((b, j) => b.classList.toggle("hover", j < i));
    });
    btn.addEventListener("click", () => submitRating(gameId, i, wrap, row));
    row.appendChild(btn);
  }
  row.addEventListener("mouseleave", () => {
    row.querySelectorAll(".mkt-star-btn").forEach(b => b.classList.remove("hover"));
  });
  wrap.appendChild(row);
  return wrap;
}

async function submitRating(gameId, stars, wrap, row) {
  row.querySelectorAll(".mkt-star-btn").forEach(b => { b.disabled = true; });
  const { data, error } = await sb().rpc("market_rate_game", { p_market_game_id: gameId, p_stars: stars });
  row.querySelectorAll(".mkt-star-btn").forEach(b => { b.disabled = false; });

  if (error) { showToast(rpcErrorMessage(error), "error"); return; }
  const res = Array.isArray(data) ? data[0] : data;
  if (!res?.ok) {
    showToast(marketErrorMessage(res?.err), "error");
    return;
  }
  showToast(t("marketplace.rating.saved"), "success");
  // Refresh summary counts in detail header
  const { data: fresh } = await sb().rpc("market_game_detail", { p_id: gameId }).single();
  const detailRatingEl = wrap.closest(".mkt-detail-rating");
  if (fresh) {
    detailGame = fresh;
    const summary = detailRatingEl?.querySelector(".mkt-rating-summary");
    if (summary) summary.innerHTML = starsDisplay(fresh.avg_rating, fresh.rating_count);
    wrap.replaceWith(buildStarInput(gameId, fresh.user_stars));
    // Refresh card on browse grid
    const card = els.browseGrid?.querySelector(`[data-id="${CSS.escape(gameId)}"]`);
    const oldRating = card?.querySelector(".mkt-card-rating");
    if (oldRating) oldRating.innerHTML = starsDisplay(fresh.avg_rating, fresh.rating_count);
  }
}

async function loadRaters(gameId, container) {
  const { data, error } = await sb().rpc("market_game_raters", { p_market_game_id: gameId });
  if (error || !data?.length) return;
  container.hidden = false;
  container.innerHTML =
    `<div class="mkt-raters-title">${esc(t("marketplace.rating.ratersTitle"))}</div>` +
    data.map(r =>
      `<div class="mkt-rater-row">
        <span class="mkt-rater-name">${esc(r.username || "?")}</span>
        <span class="mkt-rater-stars" role="img" aria-label="${r.stars}/5">${icon("star").repeat(r.stars)}${icon("star-empty").repeat(5 - r.stars)}</span>
      </div>`
    ).join("");
}

/* =========================================================
   Helpers
========================================================= */
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function marketErrorMessage(code) {
  const key = `marketplace.errors.${String(code || "unknown")}`;
  const translated = t(key);
  return translated === key ? t("marketplace.errors.unknown") : translated;
}

// Wyjątki plpgsql (`RAISE EXCEPTION`) trafiają do Supabase w `message`, nie
// w `code`. Najpierw mapujemy znany tekst backendu, dopiero potem fallback.
function rpcErrorMessage(error) {
  const message = String(error?.message || "");
  const known = [
    "not_authenticated", "game_not_available", "game_not_found",
    "invalid_stars", "cannot_rate_own_game", "not_found_or_not_published",
  ].find(code => message.includes(code));
  return marketErrorMessage(known || "unknown");
}

/* =========================================================
   Wire events
========================================================= */
function wireEvents() {
  // Znacznik dla contact-modal.js (btnGoGames dostaje go z initPage).

  // Link zachowuje nową kartę i standardową nawigację przed startem JS.
  els.browseGrid?.addEventListener("click", (ev) => {
    const card = ev.target.closest("a.mkt-card[data-id]");
    if (!card || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0) return;
    ev.preventDefault();
    void openDetail(card.dataset.id, { trigger: card });
  });
  // Browse
  els.btnMySent?.addEventListener("click", openMySent);
  els.btnMySentClose?.addEventListener("click", closeMySent);

  els.searchInput?.addEventListener("input", () => {
    syncSearchButton();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(async () => {
      currentSearch = els.searchInput.value;
      syncBrowseParams();
      await loadBrowse({ reset: true });
    }, 350);
  });

  els.btnLoadMore?.addEventListener("click", () => loadBrowse());
  // Detail modal
  els.btnDetailClose?.addEventListener("click", closeDetail);
  els.btnAddLibrary?.addEventListener("click", addToLibrary);
  els.btnRemoveLibrary?.addEventListener("click", removeFromLibrary);

  // Submit modal
  els.btnSubmitNew?.addEventListener("click", () => leaveMySentFor(openSubmitModal));
  els.btnSubmitCancel?.addEventListener("click", closeSubmitModal);
  document.getElementById("btnSubmitClose")?.addEventListener("click", closeSubmitModal);
  els.btnSubmitConfirm?.addEventListener("click", submitGame);

  // Lang picker in submit modal
  els.submitLangPicker?.addEventListener("click", e => {
    const btn = e.target.closest("[data-lang]");
    if (!btn) return;
    submitLang = btn.dataset.lang;
    els.submitLangPicker.querySelectorAll("[data-lang]").forEach(b => {
      b.classList.toggle("is-active", b === btn);
    });
  });

  // Przycisk wstecz w przeglądarce
  const UUID_RE_NAV = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  window.addEventListener("popstate", e => {
    if (skipNextPopstate) return; // powrót po zamknięciu „Moje wysłane” (leaveMySentFor)
    const legacyGameId = new URL(location.href).searchParams.get("game");
    if (legacyGameId && UUID_RE_NAV.test(legacyGameId)) {
      openDetail(legacyGameId, { replaceUrl: true });
    } else if (location.pathname.startsWith("/marketplace/game/")) {
      const param = location.pathname.split("/")[3];
      if (param) {
        if (UUID_RE_NAV.test(param)) openDetail(param, { replaceUrl: true });
        else openDetailBySlug(decodeURIComponent(param));
      }
    } else {
      closeDetail({ updateUrl: false });
      restoreBrowseParams();
      loadBrowse({ reset: true });
    }
  });
}

function syncBrowseParams() {
  const url = new URL(location.href);
  if (currentSearch) url.searchParams.set("q", currentSearch); else url.searchParams.delete("q");
  if (currentLangFilter !== "all") url.searchParams.set("filter", currentLangFilter); else url.searchParams.delete("filter");
  if (currentSort !== "recommended") url.searchParams.set("sort", currentSort); else url.searchParams.delete("sort");
  history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function restoreBrowseParams() {
  const params = new URLSearchParams(location.search);
  const filter = params.get("filter");
  const sort = params.get("sort");
  currentSearch = params.get("q") || "";
  currentLangFilter = ["pl", "en", "uk"].includes(filter) ? filter : "all";
  currentSort = ["recommended", "rating", "popular", "newest", "title"].includes(sort) ? sort : "recommended";
  if (els.searchInput) els.searchInput.value = currentSearch;
  syncBrowseControlStates();
  langFilterUiSelect?.setValue(currentLangFilter, { silent: true });
  sortUiSelect?.setValue(currentSort, { silent: true });
}

/* =========================================================
   Init
========================================================= */
document.addEventListener("DOMContentLoaded", async () => {
  const i18nP = initI18n({ withSwitcher: true });
  const userP = initPage("marketplace", {
    ready: i18nP,
    back: els.btnGoGames,
    deferTopbarReady: true,
    account: { showAuthEntry: false },
  });
  await i18nP;
  document.documentElement.classList.remove('page-loading');
  initListHeaderLayout(".mkt-head");
  initBrowseUiSelects();
  window.addEventListener("i18n:lang", refreshBrowseSelectLabels);

  // init ui-select for game picker in submit modal
  submitGameUiSelect = initUiSelect(els.submitGameSelectEl, {
    placeholder: t("marketplace.submit.pickGamePlaceholder"),
    options: [],
    value: "",
  });

  wireEvents();
  applyTranslations();
  restoreBrowseParams();

  document.querySelector(".topbar")?.classList.add("topbar-ready");
  await loadBrowse({ reset: true, hydrate: true });
  document.getElementById('browseGrid')?.classList.add('skel-step-ready');

  // Zgodny odcisk przejmujemy bez ponownego odczytu i czyszczenia pytań.
  const bootGame = initialPublic?.game;
  if (bootGame) {
    detailGame = bootGame;
    detailGameId = bootGame.id;
    openDialog(els.gameDetailOverlay, { onClose: closeDetail, restore: true });
    renderDetail(bootGame, { preserveQuestions: true });
    syncMarketSeo(getUiLang(), t, bootGame);
  } else {
    const params = new URL(location.href).searchParams;
    const id = params.get("game");
    const param = location.pathname.startsWith("/marketplace/game/") ? decodeURIComponent(location.pathname.split("/")[3] || "") : null;
    if (id && /^[0-9a-f-]{36}$/i.test(id)) await openDetail(id, { replaceUrl: true });
    else if (param) await openDetailBySlug(param);
    else syncMarketSeo(getUiLang(), t, null, params.has("game"));
  }
  initialPublic = null;
  document.querySelectorAll("[data-market-enable]").forEach(el => { el.disabled = false; });
  document.documentElement.dataset.marketReady = "true";

  // Wyłącznie akcje i oznaczenia konta czekają na auth.
  currentUser = await userP;
  isGuest = !currentUser || isGuestUser(currentUser);
  if (els.btnMySent) els.btnMySent.hidden = isGuest || !currentUser;
  if (currentUser) {
    // Szczegóły otwarte przez użytkownika mają już odpowiedź jego RPC.
    // Po auth uzupełnij kontrolki, bez drugiego odczytu nadpisującego ocenę.
    if (detailGame && detailGame !== bootGame) renderDetail(detailGame, { preserveQuestions: true });
    const { data } = await sb().rpc("market_my_library");
    for (const row of data || []) refreshCardInLibrary(row.market_game_id, true);
    const id = detailGameId;
    if (bootGame && detailGame === bootGame && id === bootGame.id) {
      const requestId = detailRequest;
      const { data: personal } = await sb().rpc("market_game_detail", { p_id: id }).single();
      if (personal && detailGame === bootGame && detailGameId === id && detailRequest === requestId) { detailGame = personal; renderDetail(personal, { preserveQuestions: true }); }
    }
  }

  window.addEventListener("i18n:lang", async () => {
    if (detailGame) { renderDetail(detailGame); syncMarketSeo(getUiLang(), t, detailGame.status === "published" ? detailGame : null, detailGame.status !== "published"); }
    else syncMarketSeo(getUiLang(), t);
    if (els.mySentOverlay && isOverlayOpen(els.mySentOverlay)) await loadMySent();
    await loadBrowse({ reset: true });
  });
});
