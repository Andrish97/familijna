import { escapeHtmlText as escapeHtml } from "../../shared/js/core/html-escape.js?v=v2026-11-08T22523";
import { bindResourceDuplicate } from "../../shared/js/core/resource-duplicate.js?v=v2026-11-08T22523";
// js/pages/bases.js
// Lista baz pytań (warstwa 1) – styl i ergonomia jak strona gier (games).

import { baseExportSnapshot } from "../../shared/js/core/base-transfer-format.js?v=v2026-11-08T22523";

import { addRenameGesture } from "../../shared/js/core/rename-gesture.js?v=v2026-11-08T22523";

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T22523";
import { fetchBadges } from "../../shared/js/core/nav-contact-badges.js?v=v2026-11-08T22523";
import { ROW_GONE } from "../../shared/js/core/db-guard.js?v=v2026-11-08T22523";
import { acquireResourceLock, getTabId } from "../../shared/js/core/resource-lock.js?v=v2026-11-08T22523";
import { alertModal, confirmModal, promptModal, progressModal } from "../../shared/js/core/modal.js?v=v2026-11-08T22523";
import { isGuestUser, hideForGuest } from "../../shared/js/core/guest-mode.js?v=v2026-11-08T22523";
import { getUiLang, initI18n, t } from "../../shared/translation/translation.js?v=v2026-11-08T22523";
import { linkTo, PAGES } from "../../shared/js/core/nav-map.js?v=v2026-11-08T22523";
import { tabFromUrl, setTab, markActiveTab } from "../../shared/js/core/tabs.js?v=v2026-11-08T22523";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T22523";
import { openDialog, closeDialog, isOverlayOpen } from "../../shared/js/core/modal-sheet.js?v=v2026-11-08T22523";
import "../../shared/js/core/contact-modal.js?v=v2026-11-08T22523";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-08T22523";
import { initListHeaderLayout } from "../../shared/js/core/list-header-layout.js?v=v2026-11-08T22523";
import { createCooldownTicker, formatCooldownRemaining } from "../../shared/js/core/cooldown.js?v=v2026-11-08T22523";
import { shareRowEl, shareSectionEl, shareCooldownEl, shareBulkActionsEl, attachListTools } from "../../shared/js/core/share-sections.js?v=v2026-11-08T22523";
import { toggleGroupEl } from "../../shared/js/core/toggle-group.js?v=v2026-11-08T22523";
import { toast, hideToast, setMessage } from "../../shared/js/core/toast.js?v=v2026-11-08T22523";
import { tileTagsHtml, proposedTags, proposedActionsHtml, bindProposedActions } from "../../shared/js/core/proposed-tile.js?v=v2026-11-08T22523";
import { initListSearch } from "../../shared/js/core/list-search.js?v=v2026-11-08T22523";
import { SORT_LIST } from "../../shared/js/core/list-filter.js?v=v2026-11-08T22523";
import { sendNotificationMail, goLinkToken } from "../../shared/js/core/notify-mail.js?v=v2026-11-08T22523";
import { bindLocalizedFilePicker } from "../../shared/js/core/file-picker.js?v=v2026-11-08T22523";
import { emptyState } from "../../shared/js/core/empty-state.js?v=v2026-11-08T22523";
import { setProgress, ratioPct } from "../../shared/js/core/ui-metrics.js?v=v2026-11-08T22523";

const i18nReady = initI18n({ withSwitcher: true });
i18nReady.then(() => {
  document.documentElement.classList.remove('page-loading');
  initListHeaderLayout();
  // Moje/udostępnione to zakładki — filtr po roli (własna / edycja / odczyt).
  initListSearch({
    grids: "#mineGrid, #sharedGrid", tile: ".card", name: ".name",
    sort: SORT_LIST,
    filter: {
      param: "role", attr: "role",
      options: ["owner", "editor", "viewer"].map((k) => ({ value: k, labelKey: `bases.filter.${k}` })),
      allKey: "common.filterAll", ariaKey: "bases.filter.label",
    },
  });
});

/* ================= DOM ================= */
const mineGrid = document.getElementById("mineGrid");
const sharedGrid = document.getElementById("sharedGrid");

// wypustki (mine/shared)
const tabBasesMine = document.getElementById("tabBasesMine");
const tabBasesShared = document.getElementById("tabBasesShared");
const basesSectionMine = document.getElementById("basesSectionMine");
const basesSectionShared = document.getElementById("basesSectionShared");
const basesSharedBadge = document.getElementById("basesSharedBadge");

const hint = document.getElementById("hint");

const btnBrowse = document.getElementById("btnBrowse");
const btnShare = document.getElementById("btnShare");
const btnDuplicate = document.getElementById("btnDuplicate");
const btnExport = document.getElementById("btnExport");
const btnImport = document.getElementById("btnImport");
const btnFriends = document.getElementById("btnFriends");
const altBadgeEl = document.getElementById("altBadge");

// Modal nazwy

// Modal importu
const importOverlay = document.getElementById("importOverlay");
const importFile = document.getElementById("importFile");
const importFilePicker = bindLocalizedFilePicker({
  input: importFile,
  button: document.getElementById("btnChooseImportFile"),
  fileName: document.getElementById("importFileName"),
  t,
});
const btnImportJson = document.getElementById("btnImportJson");
const btnImportDone = document.getElementById("btnImportDone");
const btnCancelImport = document.getElementById("btnCancelImport");
const btnImportCancelAction = document.getElementById("btnImportCancelAction");
const importErr = document.getElementById("importErr");
const importMsg = document.getElementById("importMsg");

// Import progress
const importProg = document.getElementById("importProg");
const importProgStep = document.getElementById("importProgStep");
const importProgCount = document.getElementById("importProgCount");
const importProgBar = document.getElementById("importProgBar");
const importProgMsg = document.getElementById("importProgMsg");

// Export progress (overlay eksportu do pliku)

// Modal share
const shareOverlay = document.getElementById("shareOverlay");
const shareSendOverlay = document.getElementById("shareSendOverlay");
const shareSectionsHost = document.getElementById("shareSectionsHost");
const btnShareSend = document.getElementById("btnShareSend");
const btnShareDone = document.getElementById("btnShareDone");
const btnShareSendClose = document.getElementById("btnShareSendClose");
const btnShareSendCancel = document.getElementById("btnShareSendCancel");

const shareEmail = document.getElementById("shareEmail");
const shareRole = document.getElementById("shareRole");
const baseShareFriends = document.getElementById("baseShareFriends");
const baseShareBulkHost = document.getElementById("baseShareBulkActions");
attachListTools(baseShareBulkHost?.parentElement, baseShareFriends, "base-share-friends");
attachListTools(shareSectionsHost?.previousElementSibling, shareSectionsHost, "base-share-shared");
const btnShareAddLabel = document.getElementById("btnShareAddLabel");
const baseDeclinesHost = document.getElementById("baseDeclinesHost");
const btnShareAdd = document.getElementById("btnShareAdd");
const btnShareClose = document.getElementById("btnShareClose");

/* ================= STATE ================= */
let currentUser = null;
let guestMode = false;
let ownedBases = []; // { id, name, owner_id, created_at, updated_at }
let sharedBases = []; // { id, name, owner_id, created_at, updated_at, sharedRole: 'viewer'|'editor' }
let selectedId = null;

// =======================================================
// Auto-refresh (jak subscriptions)
// - co 20s
// - tylko gdy strona widoczna
// - nie odświeżaj gdy overlay jest otwarty (żeby nie psuć UX)
// =======================================================
let autoRefreshTimer = null;
let basesRefreshInFlight = null;

function anyOverlayOpen() {
  const ovs = [importOverlay, shareOverlay];
  if (ovs.some((ov) => isOverlayOpen(ov))) return true;
  // confirmModal/alertModal (js/core/modal.js) -- np. potwierdzenie usunięcia
  return !!document.querySelector(".uni-modal");
}

// Jedno miejsce "pobierz dane + przerysuj". Błąd sieci nie może zostawić
// nieobsłużonego odrzucenia (auto-refresh) -- zwracamy false, a wołający
// decyduje, czy pokazać komunikat.
async function refreshView({ withBadge = false } = {}) {
  if (basesRefreshInFlight) return basesRefreshInFlight;
  basesRefreshInFlight = (async () => {
    try {
      // Plakietka Znajomych niezależna od listy baz — równolegle.
      await Promise.all([refreshBases(), withBadge ? refreshAltBadge() : null]);
      render();
      setButtonsState();
      return true;
    } catch (e) {
      console.warn("[bases] refresh failed:", e);
      return false;
    }
  })();
  try {
    return await basesRefreshInFlight;
  } finally {
    basesRefreshInFlight = null;
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    if (anyOverlayOpen()) return;
    void refreshView({ withBadge: true });
  }, 20000);
}

function stopAutoRefresh() {
  if (!autoRefreshTimer) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

let shareRoleValue = "editor";
let ownBaseDeclines = [];
let baseDeclinesCollapsed = true;
let shareRenderVersion = 0;

/* ================= UI helpers ================= */

function setHint(t) {
  if (!hint) return;
  // domyślny tekst z HTML (data-i18n) pokazuje się razem z tytułem; dalej steruje JS
  hint.removeAttribute("data-i18n");
  hint.textContent = t || "";
}

function setMsg(el, text, kind) { setMessage(el, text, kind); }

// Uprawnienie (Podgląd | Edycja) — przycisk dwóch stanów z core/toggle-group.js.
function baseRoleButton(value, onChange) {
  return toggleGroupEl({
    value,
    size: "sm",
    className: "baseShareRole",
    label: t("bases.shareModal.roleLabel"),
    options: [
      { value: "viewer", icon: "eye", label: t("bases.shareModal.roleViewerShort"), title: t("bases.shareModal.roleViewer") },
      { value: "editor", icon: "edit-paper", label: t("bases.shareModal.roleEditorShort"), title: t("bases.shareModal.roleEditor") },
    ],
    onChange,
  });
}
function initShareRoleSelect() {
  // Jeden przełącznik (Może edytować / Tylko podgląd) w stopce okna „Udostępnij bazę”:
  // jedno uprawnienie dla wszystkich odbiorców z tego okna (adres i zaznaczeni znajomi).
  shareRole?.replaceChildren(baseRoleButton(shareRoleValue, value => { shareRoleValue = value; }));
}
function showShareMessage(message, kind = "info") {
  if (!message) { hideToast(); return; }
  toast(message, { kind });
}

function safeName(s) {
  return (String(s ?? "").trim() || t("bases.defaults.name")).slice(0, 80);
}

function safeDownloadName(name) {
  const base = String(name || t("bases.defaults.slug"))
    .replace(/[^\w\d\- ]+/g, "")
    .trim()
    .slice(0, 40) || t("bases.defaults.slug");
  return `${base}.fambase`;
}

function downloadJson(filename, obj) {
  // Keep the custom .fambase extension from Android adding ".json" by MIME.
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function isOwner(b) {
  return b && currentUser && b.owner_id === currentUser.id;
}

function selectedBase() {
  return (
    ownedBases.find((b) => b.id === selectedId) ||
    sharedBases.find((b) => b.id === selectedId) ||
    null
  );
}

function setButtonsState() {
  const b = selectedBase();
  // Zaproszenie (proposed) to jeszcze nie dostęp -- RLS i tak nie pozwoli
  // przeglądać ani eksportować bazy przed akceptacją.
  const hasAccess = !!b && !b.proposed;
  const owner = b ? isOwner(b) : false;

  // Przeglądanie: każdy z dostępem
  if (btnBrowse) btnBrowse.disabled = !hasAccess;

  // Udostępnianie (lista i nowe): tylko owner
  if (btnShare) btnShare.disabled = !hasAccess || !owner;
  if (btnShareSend) btnShareSend.disabled = !hasAccess || !owner;

  // Eksport: każdy z dostępem
  if (btnExport) btnExport.disabled = !hasAccess;
  if (btnDuplicate) btnDuplicate.disabled = !!btnDuplicate.dataset.duplicateBusy || !hasAccess || !owner || guestMode;
}

function showProgBlock(el, on) {
  if (el) el.hidden = !on;
}

function setProgUi(stepEl, countEl, barEl, msgEl, { step, i, n, msg, isError } = {}) {
  if (stepEl && step != null) {
    if (isError) stepEl.innerHTML = iconText("error", String(step));
    else stepEl.textContent = String(step);
  }
  if (countEl) countEl.textContent = `${Number(i) || 0}/${Number(n) || 0}`;

  setProgress(barEl, ratioPct(i, n));

  if (msgEl) msgEl.textContent = msg ? String(msg) : "";
}

/* ================= DB: listowanie baz ================= */
async function listOwnedBases() {
  const { data, error } = await sb()
    .from("question_bases")
    .select("id,name,owner_id,created_at,updated_at")
    .eq("owner_id", currentUser.id)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

async function listSharedBases() {
  const { data, error } = await sb().rpc("list_shared_bases_ext");
  if (error) throw error;

  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    owner_id: r.owner_id,
    ownerUsername: r.owner_username,
    ownerEmail: r.owner_email,
    created_at: r.created_at,
    updated_at: r.updated_at,

    sharedRole: r.shared_role,

    proposed: !!r.proposed,
    taskId: r.task_id || null,
    taskStatus: r.task_status || null,
    proposedRole: r.proposed_role || null,
  }));
}

async function refreshBases() {
  // Trzy niezależne odczyty równolegle (wcześniej po kolei: 4 rundy).
  const ownedP = (async () => {
    const owned = await listOwnedBases();
    // policz udostępnienia dla moich baz
    const ownedBaseIds = owned.map((b) => b.id);
    const shareCountByBase = new Map();
    if (ownedBaseIds.length) {
      const { data: shares, error } = await sb()
        .from("question_base_shares")
        .select("base_id")
        .in("base_id", ownedBaseIds);
      if (error) throw error;
      for (const s of shares || []) {
        shareCountByBase.set(s.base_id, (shareCountByBase.get(s.base_id) || 0) + 1);
      }
    }
    // dopisz shareCount do owned
    return owned.map((b) => ({ ...b, shareCount: shareCountByBase.get(b.id) || 0 }));
  })();
  const sharedP = guestMode ? Promise.resolve([]) : listSharedBases();
  const declinesP = guestMode ? Promise.resolve([]) : (async () => {
    const { data, error } = await sb().rpc("base_declines_list_mine");
    if (error) throw error;
    return data || [];
  })();
  const [ownedWithStats, shared, declines] = await Promise.all([ownedP, sharedP, declinesP]);
  ownBaseDeclines = declines;

  ownedBases = ownedWithStats
    .slice()
    .sort((a, b) =>
      String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))
    );

  // Z ostrożności usuń duplikaty (gdyby kiedyś owner mógł mieć też share)
  const ownedIdSet = new Set(ownedBases.map((b) => b.id));
  sharedBases = (shared || [])
    .filter((b) => !ownedIdSet.has(b.id))
    .slice()
    .sort((a, b) =>
      String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))
    );

  // jeśli zaznaczona baza zniknęła
  const stillExists =
    ownedBases.some((b) => b.id === selectedId) ||
    sharedBases.some((b) => b.id === selectedId);

  if (selectedId && !stillExists) selectedId = null;
}

/* ================= DB: CRUD baz ================= */
async function createBase(name) {
  const { data, error } = await sb()
    .from("question_bases")
    .insert({
      owner_id: currentUser.id,
      name: safeName(name),
    }, { defaultToNull: false })
    .select("id,name,owner_id,created_at,updated_at")
    .single();

  if (error) throw error;
  return data;
}

/** Komunikat, gdy base:B nie da się zająć wyłącznie (familijna-server/docs/blokady-zasobow.md, sekcja 6). */
function baseBusyMessage(res) {
  if (res?.error === "gone") return t("resourceLock.goneMessage");
  // wyłączne trzymanie = ktoś inny już zmienia całą bazę; współdzielone = baza otwarta w eksploratorze
  return res?.blocker_mode === "exclusive" ? t("resourceLock.baseChangingMessage") : t("resourceLock.baseOpenMessage");
}

// Zmiana nazwy przez RPC: baza sprawdza, czy base:B nie jest trzymane przez inną
// kartę (eksplorator otwarty = współdzielone, zmiana całej bazy = wyłączne).
async function renameBase(baseId, newName) {
  const { data, error } = await sb().rpc("rename_resource_checked", {
    p_resource_type: "base",
    p_resource_id: baseId,
    p_name: safeName(newName),
    p_tab_id: getTabId(),
  });
  if (error) throw error;
  if (data?.in_use) {
    const e = new Error("base in use");
    e.code = "RESOURCE_IN_USE";
    throw e;
  }
  if (data?.error === "not_found_or_forbidden") {
    const e = new Error("base gone");
    e.code = ROW_GONE;
    throw e;
  }
  if (!data?.ok) throw new Error(data?.error || "rename failed");
}

async function deleteBase(base) {
  const ok = await confirmModal({
    title: t("bases.delete.title"),
    text: t("bases.delete.text", { name: base.name }),
    okText: t("bases.delete.ok"),
    cancelText: t("bases.delete.cancel"),
  });
  if (!ok) return;

  // qb_questions/qb_categories/qb_tags mają ON DELETE CASCADE od
  // question_bases -- gołe .delete() skasowałoby też elementy, które ktoś
  // aktywnie edytuje w base-explorerze (Warstwa 1, edit_locks), bez
  // żadnego ostrzeżenia. delete_resource_checked sprawdza to atomowo po
  // stronie serwera, tak samo jak dla gry/logo w games.js.
  // base:B zajęte wyłącznie na czas akcji: otwarty eksplorator (współdzielone)
  // albo zmiana całej bazy u kogoś innego zatrzymują usunięcie.
  let lease = null;
  try {
    lease = await acquireResourceLock({ resourceType: "base", resourceId: base.id, context: "bases-list" });
  } catch (e) {
    console.warn("[bases] delete lock error:", e);
    void alertModal({ text: t("bases.delete.failed") });
    return;
  }
  if (!lease?.ok) {
    void alertModal({ text: baseBusyMessage(lease) });
    return;
  }
  let data, error;
  try {
    ({ data, error } = await sb().rpc("delete_resource_checked", {
      p_resource_type: "base",
      p_resource_id: base.id,
      p_tab_id: getTabId(),
    }));
  } finally {
    lease.release();
  }
  if (error) {
    console.warn("[bases] delete error:", error);
    void alertModal({ text: t("bases.delete.failed") });
    return;
  }
  if (!data?.ok) {
    console.warn("[bases] delete blocked:", data);
    void alertModal({ text: data?.in_use ? t("bases.delete.inUse") : t("bases.delete.failed") });
  }
}

async function leaveSharedBase(base) {
  const ok = await confirmModal({
    title: t("bases.leaveShared.title"),
    text: t("bases.leaveShared.text", { name: base?.name || t("bases.defaults.baseLabel") }),
    okText: t("bases.leaveShared.ok"),
    cancelText: t("bases.leaveShared.cancel"),
  });
  if (!ok) return;

  const { data: ok2, error } = await sb().rpc("leave_shared_base", { p_base_id: base.id });
  if (error || ok2 !== true) {
    console.warn("[bases] leave_shared_base error:", error);
    void alertModal({ text: t("bases.leaveShared.failed") });
  }
}

/* ================= Export / Import ================= */
// Długie listy id w .in() lecą w URL-u (GET) -- dzielimy je, żeby duża baza
// nie kończyła się 414 URI Too Long.
const IN_CHUNK = 150;
// Wstawianie wsadowe -- jedno zapytanie na paczkę zamiast jednego na wiersz.
const INSERT_CHUNK = 200;

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function selectIn(table, cols, column, ids) {
  const rows = [];
  for (const part of chunks(ids, IN_CHUNK)) {
    const { data, error } = await sb().from(table).select(cols).in(column, part);
    if (error) throw error;
    rows.push(...(data || []));
  }
  return rows;
}

async function insertAll(table, rows, onChunk) {
  for (const part of chunks(rows, INSERT_CHUNK)) {
    const { error } = await sb().from(table).insert(part, { defaultToNull: false });
    if (error) throw error;
    onChunk?.(part.length);
  }
}

const EXPORT_STEPS = 6;

async function exportBase(baseId, onProgress) {
  const prog = (step, i, msg = "") => {
    if (typeof onProgress === "function") onProgress({ step, i, n: EXPORT_STEPS, msg });
  };
  // Wszystkie cztery odczyty zależą tylko od baseId. Uruchom je razem,
  // ale komunikaty postępu pokazuj w dotychczasowej kolejności.
  const [baseResult, categoriesResult, questionsResult, tagsResult] = await Promise.all([
    sb().from("question_bases").select("id,name").eq("id", baseId).single(),
    sb().from("qb_categories").select("id,parent_id,name,ord").eq("base_id", baseId).order("ord", { ascending: true }),
    sb().from("qb_questions").select("id,category_id,ord,payload").eq("base_id", baseId).order("ord", { ascending: true }),
    sb().from("qb_tags").select("id,name,color,ord").eq("base_id", baseId).order("ord", { ascending: true }),
  ]);
  const { data: baseRow, error: bErr } = baseResult;
  if (bErr) throw bErr;
  prog(t("bases.export.steps.base"), 1);

  const { data: cats, error: cErr } = categoriesResult;
  if (cErr) throw cErr;
  prog(t("bases.export.steps.folders"), 2, t("bases.export.count", { count: (cats || []).length }));

  const { data: qs, error: qErr } = questionsResult;
  if (qErr) throw qErr;
  prog(t("bases.export.steps.questions"), 3, t("bases.export.count", { count: (qs || []).length }));

  const { data: tags, error: tErr } = tagsResult;
  if (tErr) throw tErr;
  prog(t("bases.export.steps.tags"), 4, t("bases.export.count", { count: (tags || []).length }));

  const qtags = await selectIn("qb_question_tags", "question_id,tag_id", "question_id", (qs || []).map((q) => q.id));
  prog(t("bases.export.steps.questionTags"), 5, t("bases.export.count", { count: qtags.length }));

  // Tagi folderów -- import zawsze je obsługiwał, ale eksport ich nie
  // zapisywał, więc eksport → import po cichu je gubił.
  const ctags = await selectIn("qb_category_tags", "category_id,tag_id", "category_id", (cats || []).map((c) => c.id));
  prog(t("bases.export.steps.categoryTags"), 6, t("bases.export.count", { count: ctags.length }));

  return baseExportSnapshot({
    base: baseRow,
    categories: cats,
    tags,
    questions: qs,
    question_tags: qtags,
    category_tags: ctags,
  }, t("bases.defaults.baseLabel"));
}

function isValidImportPayload(p) {
  return !!p && typeof p === "object" && !!p.base && typeof p.base === "object" && Array.isArray(p.questions);
}

async function importBase(payload, onProgress) {
  const prog = (step, i, n, msg) => {
    if (typeof onProgress === "function") onProgress({ step, i, n, msg });
  };

  if (!isValidImportPayload(payload)) {
    throw new Error(t("bases.import.invalidFormat"));
  }

  const baseName = safeName(payload.base?.name || t("bases.defaults.name"));
  const base = await createBase(baseName);
  prog(t("bases.import.steps.createBase"), 1, 5, "");

  try {
    await importBaseContent(base.id, payload, prog);
  } catch (e) {
    // Import nie jest atomowy -- bez sprzątania po błędzie zostawałaby
    // na liście pusta/niepełna baza. Usunięcie bazy kasuje (CASCADE)
    // wszystko, co zdążyło się wstawić.
    const { error: delErr } = await sb().from("question_bases").delete().eq("id", base.id);
    if (delErr) console.warn("[bases] import cleanup failed:", delErr);
    throw e;
  }
  return base.id;
}

async function importBaseContent(baseId, payload, prog) {
  // Nowe id nadajemy po stronie klienta -- dzięki temu wszystko można wstawić
  // wsadowo, a mapowanie stare → nowe id (rodzic folderu, folder pytania,
  // powiązania tagów) jest znane z góry.
  const newId = () => crypto.randomUUID();
  const oldToNewCat = new Map();
  const oldToNewTag = new Map();
  const oldToNewQ = new Map();

  // 1) Kategorie – poziomami (rooty → dzieci), żeby rodzic zawsze istniał
  prog(t("bases.import.steps.categories"), 2, 5, "");
  const cats = (Array.isArray(payload.categories) ? payload.categories : []).filter((c) => c && c.id != null);
  for (const c of cats) oldToNewCat.set(c.id, newId());
  const catIds = new Set(cats.map((c) => c.id));
  const depthOf = new Map();
  const depth = (c, seen = new Set()) => {
    if (depthOf.has(c.id)) return depthOf.get(c.id);
    // rodzic spoza pliku albo cykl -> traktuj jak root
    const parent = catIds.has(c.parent_id) && !seen.has(c.parent_id) ? cats.find((x) => x.id === c.parent_id) : null;
    seen.add(c.id);
    const d = parent ? depth(parent, seen) + 1 : 0;
    depthOf.set(c.id, d);
    return d;
  };
  const levels = [];
  for (const c of cats) (levels[depth(c)] ||= []).push(c);
  for (const level of levels.filter(Boolean)) {
    await insertAll("qb_categories", level.map((c) => ({
      id: oldToNewCat.get(c.id),
      base_id: baseId,
      parent_id: depthOf.get(c.id) > 0 ? oldToNewCat.get(c.parent_id) : null,
      name: String(c.name || t("bases.defaults.category")).slice(0, 80),
      ord: Number(c.ord) || 0,
    })));
  }

  // 2) Tagi
  prog(t("bases.import.steps.tags"), 3, 5, "");
  const tags = (Array.isArray(payload.tags) ? payload.tags : []).filter((x) => x && x.id != null);
  for (const tag of tags) oldToNewTag.set(tag.id, newId());
  await insertAll("qb_tags", tags.map((tag) => ({
    id: oldToNewTag.get(tag.id),
    base_id: baseId,
    name: String(tag.name || t("bases.defaults.tag")).slice(0, 40),
    color: String(tag.color || "gray").slice(0, 24),
    ord: Number(tag.ord) || 0,
  })));

  // 3) Pytania
  const qs = (Array.isArray(payload.questions) ? payload.questions : []).filter((q) => q && typeof q === "object");
  let done = 0;
  prog(t("bases.import.steps.questions"), 0, qs.length, "");
  const qRows = qs.map((q) => {
    const id = newId();
    if (q.id != null) oldToNewQ.set(q.id, id);
    return {
      id,
      base_id: baseId,
      category_id: q.category_id != null ? (oldToNewCat.get(q.category_id) || null) : null,
      ord: Number(q.ord) || 0,
      payload: q.payload && typeof q.payload === "object" ? q.payload : {},
      updated_by: currentUser.id,
    };
  });
  await insertAll("qb_questions", qRows, (n) => {
    done += n;
    prog(t("bases.import.steps.questions"), done, qs.length, "");
  });

  // 4) Powiązania tagów pytań
  prog(t("bases.import.steps.questionTags"), 4, 5, "");
  const qtRows = [];
  const qtSeen = new Set();
  for (const r of Array.isArray(payload.question_tags) ? payload.question_tags : []) {
    const nq = oldToNewQ.get(r?.question_id);
    const nt = oldToNewTag.get(r?.tag_id);
    if (!nq || !nt || qtSeen.has(nq + nt)) continue;
    qtSeen.add(nq + nt);
    qtRows.push({ question_id: nq, tag_id: nt });
  }
  await insertAll("qb_question_tags", qtRows);

  // 5) Powiązania tagów kategorii (folderów)
  prog(t("bases.import.steps.categoryTags"), 5, 5, "");
  const ctRows = [];
  const ctSeen = new Set();
  for (const r of Array.isArray(payload.category_tags) ? payload.category_tags : []) {
    const nc = oldToNewCat.get(r?.category_id);
    const nt = oldToNewTag.get(r?.tag_id);
    if (!nc || !nt || ctSeen.has(nc + nt)) continue;
    ctSeen.add(nc + nt);
    ctRows.push({ category_id: nc, tag_id: nt });
  }
  await insertAll("qb_category_tags", ctRows);
}

/* ================= Share modal ================= */

// Okno „Udostępnienia” (górny pasek): kto ma dostęp, uprawnienie, ponów, cofnij.
async function openShareModal() {
  showShareMessage("");
  await renderShareModal();
  openDialog(shareOverlay, { onClose: closeShareModal });
}

function closeShareModal() {
  closeDialog(shareOverlay);
  shareRenderVersion++;
  shareCooldownTicker.resetBindings();
  showShareMessage("");

  // Odśwież status kafelków po zamknięciu modala (shareCount / udostępnione listy).
  // Fire-and-forget: UI wraca natychmiast, a odświeżenie dociągnie dane w tle.
  void refreshView({ withBadge: true });
}

// Okno „Udostępnij bazę” (dolny pasek, jak „Wyślij” w Grach): adres lub nazwa
// i znajomi do zaznaczenia, uprawnienie w stopce.
async function openShareSendModal() {
  showShareMessage("");
  shareEmail.value = "";
  shareRoleValue = "editor";
  initShareRoleSelect();
  updateBaseShareSelection();
  await renderShareSendModal();
  openDialog(shareSendOverlay, { onClose: closeShareSendModal });
}

function closeShareSendModal() {
  closeDialog(shareSendOverlay);
  shareRenderVersion++;
  shareCooldownTicker.resetBindings();
  showShareMessage("");
  void refreshView({ withBadge: true });
}

const shareCooldownTicker = createCooldownTicker();
shareCooldownTicker.start();

// Dane obu okien udostępniania (znajomi do zaznaczenia, wysłane, aktywne).
async function loadSharePanel() {
  const b = selectedBase();
  if (!b || !isOwner(b)) return null;
  const version = ++shareRenderVersion;
  shareCooldownTicker.resetBindings();
  const { data, error } = await sb().rpc("base_share_panel", { p_base_id: b.id });
  if (version !== shareRenderVersion) return null;
  if (error || !data?.ok) { showShareMessage(t("bases.share.failed"), "error"); return null; }
  return { b, data };
}
function emptyShareList(host) {
  host.append(emptyState(t("baseSharePanel.empty"), { hook: "shareEmpty" }));
}
// Okno „Udostępnij bazę”: znajomi do zaznaczenia (bez tych, którzy już mają dostęp).
async function renderShareSendModal() {
  const loaded = await loadSharePanel();
  if (!loaded) return;
  const { data } = loaded;
  baseShareFriends.replaceChildren();
  baseShareBulkHost?.replaceChildren();
  if (!data.friends.length) emptyShareList(baseShareFriends);
  const bulkActions = shareBulkActionsEl({
    onSelectAll: () => {
      baseShareFriends.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((input) => { input.checked = true; });
      updateBaseShareSelection();
    },
    onDeselectAll: () => {
      baseShareFriends.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
      updateBaseShareSelection();
    },
  });
  baseShareBulkHost?.replaceChildren(bulkActions.element);
  baseShareBulkActions = bulkActions;
  for (const friend of data.friends) {
    const row = shareRowEl({ id: friend.user_id, label: friend.label || friend.email, compact: true });
    const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.value = friend.user_id;
    checkbox.setAttribute("aria-label", friend.label || friend.email);
    checkbox.addEventListener("change", updateBaseShareSelection);
    row.prepend(checkbox);
    row.addEventListener("click", event => {
      if (checkbox.disabled || event.target.closest("input,button")) return;
      checkbox.checked = !checkbox.checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const { element, labelEl } = shareCooldownEl(); row.querySelector(".shareRowActions").append(element);
    const key = `friend:${friend.user_id}`;
    shareCooldownTicker.bind({ key, labelEl, disableEls: [checkbox], onTick: (_, active) => {
      element.hidden = !active; row.classList.toggle("is-cooling-down", active); row.classList.toggle("pick", !active);
      if (active) checkbox.checked = false;
      updateBaseShareSelection();
    }});
    shareCooldownTicker.setEndMs(key, Date.parse(friend.cooldown_until) || 0);
    baseShareFriends.append(row);
  }
  updateBaseShareSelection();
}
// Okno „Udostępnienia”: wysłane (oczekujące, odrzucone) i aktywne udostępnienia.
async function renderShareModal() {
  const loaded = await loadSharePanel();
  if (!loaded) return;
  const { b, data } = loaded;
  shareSectionsHost.replaceChildren();
  const recipients = [...data.outgoing, ...data.active];
  if (!recipients.length) emptyShareList(shareSectionsHost);
  for (const recipient of recipients) {
    const active = recipient.status === "done";
    const roleEl = baseRoleButton(recipient.role, async role => {
      const { data: result, error } = await sb().rpc(active ? "update_base_share_role" : "base_share_update_invite_role", active
        ? { p_base_id: b.id, p_user_id: recipient.user_id, p_role: role }
        : { p_task_id: recipient.task_id, p_role: role });
      const response = Array.isArray(result) ? result[0] : result;
      if (error || !response?.ok) { showShareMessage(t("bases.share.failed"), "error"); return false; }

      return true;
    });
    const actions = [];
    if (!active && recipient.status !== "declined" && recipient.email_enabled) actions.push({
      key: "resend", icon: "refresh", title: t("contacts.actions.resend"), countdown: true,
      onMount: ({ rowEl, button, labelEl }) => {
        const key = `resend:${recipient.task_id}`;
        shareCooldownTicker.bind({ key, labelEl, disableEls: [button], onTick: (_, cooling) => {
          labelEl.hidden = !cooling; rowEl.classList.toggle("is-cooling-down", cooling);
        }});
        shareCooldownTicker.setEndMs(key, Date.parse(recipient.cooldown_until) || 0);
      },
      onClick: async (_, button) => {
        button.disabled = true;
        try {
          const { data: response, error } = await sb().rpc("base_share_resend", { p_task_id: recipient.task_id });
          if (error || !response?.ok) { showShareMessage(baseShareError(response), "error"); return; }
          const queued = response.mail_allowed && await deliverBaseShare(response, { reminder: true });
          await renderShareModal();
          showShareMessage(t(queued ? "bases.share.success" : "contacts.friendMailDisabled"));
        } catch { showShareMessage(t("bases.share.emailFailed"), "error"); }
        finally { button.disabled = false; }
      },
    });
    actions.push({ key: active ? "remove" : "cancel", icon: "trash", title: t("bases.share.remove"), onClick: async (_, button) => {
      button.disabled = true;
      const { data: ok, error } = await sb().rpc(active ? "revoke_base_share" : "base_share_cancel_task", active
        ? { p_base_id: b.id, p_user_id: recipient.user_id } : { p_task_id: recipient.task_id });
      if (error || !ok) { button.disabled = false; showShareMessage(t("bases.share.failed"), "error"); return; }
       await renderShareModal();
    }});
    const stateKey = active ? "active" : recipient.status === "declined" ? "declined" : "pending";
    const row = shareRowEl({ id: recipient.task_id || recipient.user_id, label: recipient.label || recipient.email,
      title: recipient.email, compact: true, state: { key: stateKey, label: t(`contacts.status.${stateKey}`) },
      // udostępniamy tylko kontom — znacznik „ma konto” nic nie mówi; zostaje „Znajomy”
      tags: [...(recipient.is_friend ? [{ text: t("shareSections.channel.friend") }] : []),
        { text: t(active ? "contacts.status.active" : recipient.status === "declined" ? "contacts.status.declined" : "contacts.status.pending") }],
      extras: [roleEl], actions });
    if (recipient.status === "declined") {
      const { element, labelEl } = shareCooldownEl(); row.querySelector(".shareRowActions").prepend(element);
      const key = `refusal:${recipient.task_id}`;
      shareCooldownTicker.bind({ key, labelEl, disableEls: [], onTick: (_, active) => { element.hidden = !active; } });
      shareCooldownTicker.setEndMs(key, Date.parse(recipient.cooldown_until) || 0);
    }
    shareSectionsHost.append(row);
  }
}
let baseShareBulkActions = null;
// Jeden przycisk „Udostępnij” dla wpisanego adresu i zaznaczonych znajomych:
// licznik w etykiecie to liczba odbiorców, przycisk aktywny, gdy jest komu.
function updateBaseShareSelection() {
  const inputs = baseShareFriends?.querySelectorAll('input[type="checkbox"]') || [];
  const selected = baseShareFriends?.querySelectorAll('input:checked:not(:disabled)').length || 0;
  const recipients = selected + (String(shareEmail?.value || "").trim() ? 1 : 0);
  if (btnShareAdd) btnShareAdd.disabled = shareAddInFlight || !recipients;
  if (btnShareAddLabel) btnShareAddLabel.textContent = recipients > 1 ? t("baseSharePanel.shareN", { n: recipients }) : t("baseSharePanel.share");
  baseShareBulkActions?.update(inputs);
}
function baseShareError(row) {
  if (row?.cooldown_until) return t("baseSharePanel.cooldown", { time: formatCooldownRemaining(Math.max(0, Date.parse(row.cooldown_until) - Date.now())) });
  if (row?.err === "already_pending") return t("bases.share.alreadyPending");
  if (row?.err === "already_active") return t("baseSharePanel.alreadyActive");
  if (row?.err === "owner") return t("bases.share.owner");
  if (row?.err === "unknown_user") return t("bases.share.unknownUser");
  if (row?.err === "not_friend") return t("bases.share.notFriend");
  return t("bases.share.failed");
}
// Mail z udostępnieniem: treść, odbiorcę i rolę bierze send-mail z bazy
// (przydział powiadomienia z RPC); tu tylko token z linku /go/?b=…
async function deliverBaseShare(row, { reminder = false } = {}) {
  const token = goLinkToken(row?.mail_link, "b");
  if (!token) return;
  return sendNotificationMail({ action: "base:share", token, reminder });
}
let shareAddInFlight = false;
// Udostępnia naraz wpisanemu adresowi (jeśli jest) i zaznaczonym znajomym,
// z jednym uprawnieniem z przełącznika obok przycisku.
async function shareAdd() {
  if (shareAddInFlight) return;
  const b = selectedBase();
  if (!b || !isOwner(b)) return;
  const raw = String(shareEmail.value || "").trim();
  const friendIds = [...baseShareFriends.querySelectorAll('input:checked:not(:disabled)')].map(input => input.value);
  if (!friendIds.length && !raw) { showShareMessage(t("bases.share.enterEmail"), "error"); return; }
  shareAddInFlight = true; updateBaseShareSelection();
  let message = t("bases.share.success");
  let messageKind = "info";
  try {
    for (const id of [...(raw ? [null] : []), ...friendIds]) {
      const { data, error } = await sb().rpc(id ? "base_share_to_friend" : "base_share_by_user", id
        ? { p_base_id: b.id, p_recipient_user_id: id, p_role: shareRoleValue }
        : { p_base_id: b.id, p_user_lookup: raw, p_role: shareRoleValue });
      const row = Array.isArray(data) ? data[0] : data;
      if (error || !row?.ok) { message = baseShareError(row); messageKind = "error"; continue; }
      try {
        const queued = await deliverBaseShare(row);
        if (queued === false) message = t("contacts.friendMailDisabled");
      }
      catch { message = t("bases.share.emailFailed"); messageKind = "error"; }
      if (!id) shareEmail.value = "";
    }
    if (messageKind === "error") { await renderShareSendModal(); showShareMessage(message, messageKind); }
    else { closeShareSendModal(); showShareMessage(message, messageKind); }
  } catch { showShareMessage(t("bases.share.failed"), "error"); }
  finally { shareAddInFlight = false; updateBaseShareSelection(); }
}

/* ================= Wypustki (mine/shared) ================= */
// Karty z mapy stron (pierwsza = domyślna); adres jest jedynym źródłem.
const BASE_TABS = PAGES.bases.tabs;
const DEFAULT_BASE_TAB = BASE_TABS[0];
let activeTab = DEFAULT_BASE_TAB;

function setActiveTab(tab, { updateUrl = true } = {}) {
  if (guestMode || !BASE_TABS.includes(tab)) tab = DEFAULT_BASE_TAB;
  activeTab = tab;
  if (updateUrl) setTab(activeTab, DEFAULT_BASE_TAB);
  const mineOn = activeTab === "mine";
  basesSectionMine?.classList.toggle("active", mineOn);
  basesSectionShared?.classList.toggle("active", !mineOn);
  markActiveTab([tabBasesMine, tabBasesShared], mineOn ? tabBasesMine : tabBasesShared);
  // Udostępnionym bazom nie zmienia się nazwy -- wtedy bez podpowiedzi.
  setHint(mineOn ? t("common.renameTileHint") : "");
}

function setSharedBasesBadge(n) {
  if (!basesSharedBadge) return;
  const v = Number(n || 0);
  basesSharedBadge.textContent = v > 99 ? "99+" : (v > 0 ? String(v) : "");
}

// Linia pod nazwą odrzuconej bazy, jak w Zadaniach:
// „od X · odrzucono D · zniknie za N dni” (odmiana liczby wg języka).
function declineNote(item) {
  const lang = getUiLang() || "pl";
  const parts = [t("bases.declineNote.from", { name: item.owner_label || "—" })];
  if (item.declined_at) parts.push(t("bases.declineNote.declinedAt", { date: new Date(item.declined_at).toLocaleDateString(lang) }));
  const ms = Date.parse(item.expires_at || "");
  if (ms) {
    const n = Math.max(1, Math.ceil((ms - Date.now()) / 864e5));
    parts.push(t(`bases.declineNote.expires.${new Intl.PluralRules(lang).select(n)}`, { n }));
  }
  return parts.join(" · ");
}

/* ================= Render kafelków ================= */
function render() {
  if (!mineGrid || !sharedGrid) return;

  mineGrid.innerHTML = "";
  sharedGrid.innerHTML = "";
  baseDeclinesHost?.replaceChildren();
  if (ownBaseDeclines.length && baseDeclinesHost) {
    baseDeclinesHost.append(shareSectionEl({
      key: "base-declines", title: t("contacts.sections.declined"), collapsed: baseDeclinesCollapsed,
      onToggle: value => { baseDeclinesCollapsed = value; },
      rows: ownBaseDeclines.map(item => ({ id: item.id, label: item.name, compact: true,
        note: declineNote(item),
        actions: [{ key: "undo", icon: "undo", title: t("contacts.actions.undo_reject"), onClick: async () => {
          const { data, error } = await sb().rpc("base_share_undo_decline", { p_task_id: item.id });
          if (error || !data?.ok) await alertModal({ text: t("bases.proposed.failed") });
          await refreshView({ withBadge: true });
        }}],
      })),
    }));
  }

  const renderTile = (b, hostEl) => {
    const tile = document.createElement("div");
    tile.className = "card tile";
    tile.dataset.baseId = b.id;
    tile.dataset.created = b.created_at || "";
    tile.dataset.updated = b.updated_at || "";
    tile.dataset.role = b.sharedRole || (b.proposed ? b.proposedRole : null) || "owner";
    if (b.id === selectedId) tile.classList.add("is-selected");
    // zaproszenie to zwykły kafel z tagiem (bez koloru całego kafla); znacznik tylko dla selektorów
    if (b.proposed) tile.dataset.proposed = "1";
    const badges = [];

    // Udostępniona (albo dopiero proponowana) -- ta sama informacja "od kogo"
    // i z jakim dostępem; dla zaproszenia rola pochodzi z proposed_role.
    // Zaproszenie: wspólny kafel propozycji (proposed-tile.js) jak otrzymane
    // kopie gier i logo.
    const shareRole = b.sharedRole || (b.proposed ? b.proposedRole : null);
    if (shareRole) {
      const ownerUn = String(b.ownerUsername || "").trim();
      const ownerMail = String(b.ownerEmail || "").trim();
      const fromLabel = ownerUn || ownerMail || "—";

      if (b.proposed) badges.push(...proposedTags({ from: fromLabel, fromTitle: ownerMail || fromLabel, title: t("bases.badges.proposedTitle") }));
      else badges.push({
        text: t("resourceSend.from", { name: fromLabel }),
        title: ownerMail ? ownerMail : fromLabel,
        kind: "from",
      });

      const isEdit = shareRole === "editor";
      badges.push({
        icon: isEdit ? "edit-paper" : "eye",
        text: "",
        title: isEdit ? t("bases.badges.editAccess") : t("bases.badges.viewAccess"),
        kind: "role",
      });
    } else {
      const n = Number(b.shareCount || 0);
      badges.push(
        n > 0
          ? { icon: "people", text: String(n), title: t("bases.badges.sharedOthers", { count: n }), kind: "mine" }
          : { icon: "person", text: "", title: t("bases.badges.notShared"), kind: "mine" }
      );
    }

    const canDeleteOwned = isOwner(b);
    const canLeaveShared = !!b.sharedRole && !b.proposed;
    const deleteBtn = (canDeleteOwned || canLeaveShared)
      ? `<button class="x" type="button" title="${escapeHtml(
          canDeleteOwned ? t("bases.actions.remove") : t("bases.actions.leaveShared")
        )}">${icon(canDeleteOwned ? "trash" : "close")}</button>`
      : ``;

      // wspólny kafel (base.css .tile): nazwa, oznaczenia przy dole, przyciski w rogu
      tile.innerHTML = `
        ${b.proposed ? proposedActionsHtml() : deleteBtn}
        <div class="name">${escapeHtml(b.name || t("bases.defaults.baseLabel"))}</div>
        <div class="tileTags">${tileTagsHtml(badges)}</div>
      `;

    if (b.proposed) {
      const respond = (rpcName) => async () => {
        const { data: ok, error } = await sb().rpc(rpcName, { p_task_id: b.taskId });
        return !error && ok === true;
      };
      bindProposedActions(tile, {
        accept: respond("base_share_accept"),
        decline: respond("base_share_decline"),
        onFail: () => alertModal({ text: t("bases.proposed.failed") }),
        onDone: () => refreshView(),
      });
    }

    // Zaznaczenie NIE przebudowuje kafelków (tylko przełącza klasę) -- inaczej
    // drugi tap podwójnego tapnięcia trafia w nowy element i zmiana nazwy
    // na dotyku nigdy się nie uruchamia (rename-gesture.js liczy tapnięcia
    // per element).
    tile.addEventListener("click", () => {
      selectBase(selectedId === b.id ? null : b.id);
    });

    const x = tile.querySelector(".x");
    if (x) {
      x.addEventListener("click", async (e) => {
        e.stopPropagation();
        if (isOwner(b)) {
          await deleteBase(b);
        } else {
          await leaveSharedBase(b);
        }
        await refreshView();
      });
    }

    addRenameGesture(tile, (e) => {
      if (!isOwner(b)) return;
      if (e.target?.closest?.(".x")) return;
      selectBase(b.id);
      void openNameDialog(b);
    });

    hostEl.appendChild(tile);
  };

  // ===== MOJE (z kafelkiem +) =====
  const tNew = document.createElement("div");
  tNew.className = "addCard";
  tNew.innerHTML = `
    <div class="plus">${icon("plus")}</div>
    <div class="name">${escapeHtml(t("bases.sections.newBase"))}</div>
  `;
  tNew.addEventListener("click", () => void openNameDialog());
  mineGrid.appendChild(tNew);

  for (const b of ownedBases) renderTile(b, mineGrid);

  // ===== UDOSTĘPNIONE =====
  if (!guestMode) {
    if (!sharedBases.length) {
      const empty = document.createElement("div");
      empty.className = "addCard";
      empty.classList.add("addCard--static"); // komunikat w miejscu kafla, nieklikalny
      empty.innerHTML = `
        <div class="txt">${escapeHtml(t("bases.sections.sharedEmpty"))}</div>
        <div class="sub">${escapeHtml(t("bases.sections.sharedEmptyHint"))}</div>
      `;
      sharedGrid.appendChild(empty);
    } else {
      // Zaproszenia (kafle propozycji) na początku (tu bez kafla „+”).
      for (const b of sharedBases.filter((x) => x.proposed)) renderTile(b, sharedGrid);
      for (const b of sharedBases.filter((x) => !x.proposed)) renderTile(b, sharedGrid);
    }
  }

  // mobile badge: pending invites in "shared"
  setSharedBasesBadge(sharedBases.filter((b) => !!b.proposed).length);
}

function selectBase(id) {
  selectedId = id;
  for (const el of document.querySelectorAll(".bases-section .card[data-base-id]")) {
    el.classList.toggle("is-selected", el.dataset.baseId === selectedId);
  }
  setButtonsState();
}

for (const grid of [mineGrid, sharedGrid]) {
  grid?.addEventListener("click", (event) => {
    if (event.target === grid) selectBase(null);
  });
  const section = grid?.closest(".bases-section");
  section?.addEventListener("click", (event) => {
    if (event.target === section) selectBase(null);
  });
}



/* ================= Okno nazwy (wspólne promptModal) ================= */
// Zmiana nazwy trzyma base:B wyłącznie do zamknięcia okna -- w tym czasie
// nikt nie otworzy eksploratora tej bazy (pełna blokada strony), a otwarty
// eksplorator nie pozwoli otworzyć okna.
async function openNameDialog(base = null) {
  const create = !base;
  let lease = null;
  if (!create) {
    try {
      lease = await acquireResourceLock({ resourceType: "base", resourceId: base.id, context: "bases-list" });
    } catch (e) {
      console.warn("[bases] rename lock error:", e);
      void alertModal({ text: t("bases.nameModal.failed") });
      return;
    }
    if (!lease?.ok) {
      void alertModal({ text: baseBusyMessage(lease) });
      return;
    }
  }
  try {
    await promptModal({
      title: t(create ? "bases.nameModal.titleCreate" : "bases.nameModal.titleRename"),
      text: t(create ? "bases.nameModal.subCreate" : "bases.nameModal.subRename"),
      okText: t("bases.common.save"),
      cancelText: t("bases.common.cancel"),
      value: create ? "" : (base.name || ""),
      placeholder: t("bases.nameModal.placeholder"),
      maxLength: 80,
      selectAll: !create,
      onSubmit: async (v) => {
        const val = safeName(v);
        try {
          if (create) {
            const b = await createBase(val);
            selectedId = b.id;
            setActiveTab("mine");
          } else {
            const b = ownedBases.find((x) => x.id === base.id);
            if (b && isOwner(b)) await renameBase(b.id, val);
          }
          void refreshView();
        } catch (e) {
          console.warn("[bases] name ok error:", e);
          return e?.code === ROW_GONE ? t("resourceLock.goneMessage")
            : e?.code === "RESOURCE_IN_USE" ? t("resourceLock.baseOpenMessage") : t("bases.nameModal.failed");
        }
      },
    });
  } finally {
    lease?.release?.();
  }
}

/* ================= Modal import ================= */
let importParsed = null;

function importResetState() {
  importParsed = null;
  if (importErr) { importErr.hidden = true; importErr.textContent = ""; }
  if (btnImportJson) btnImportJson.disabled = true;
  if (btnImportJson) btnImportJson.hidden = false;
  if (btnImportDone) btnImportDone.hidden = true;
  if (btnImportCancelAction) btnImportCancelAction.hidden = false;
  setMsg(importMsg, "");
}

function openImportModal() {
  importResetState();
  importFilePicker.reset();
  setMsg(importMsg, "");
  showProgBlock(importProg, false);
  openDialog(importOverlay, { onClose: closeImportModal });
}

function closeImportModal() {
  closeDialog(importOverlay);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error(t("bases.import.fileReadFailed")));
    r.readAsText(file);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  btnBrowse?.addEventListener("click", () => {
    const b = selectedBase();
    if (!b) return;
    location.href = linkTo("baseExplorer", { id: b.id });
  });

  btnShare?.addEventListener("click", async () => {
    const b = selectedBase();
    if (!b || !isOwner(b)) return;
    await openShareModal();
  });
  btnShareSend?.addEventListener("click", async () => {
    const b = selectedBase();
    if (!b || !isOwner(b)) return;
    await openShareSendModal();
  });

  btnExport?.addEventListener("click", async () => {
    const b = selectedBase();
    if (!b || btnExport?.disabled) return;

    const progress = progressModal({ title: t("bases.exportModal.title"), text: t("bases.exportModal.subtitle"), doneText: t("bases.exportModal.close") });
    progress.update({ step: t("bases.export.steps.start"), i: 0, n: 6 });
    if (btnExport) btnExport.disabled = true;

    try {
      const out = await exportBase(b.id, ({ step, i, n, msg } = {}) => progress.update({ step, i, n, msg }));
      downloadJson(safeDownloadName(b.name), out);
      progress.allowClose();
    } catch (e) {
      console.warn("[bases] export error:", e);
      progress.update({ step: t("bases.export.errorStep"), i: 0, n: 1, msg: e?.message || t("bases.export.failed"), isError: true });
    } finally {
      if (btnExport) btnExport.disabled = false;
    }
  });

  btnImport?.addEventListener("click", () => openImportModal());

  // Wczytanie pliku → walidacja, bez podglądu
  importFile?.addEventListener("change", async () => {
    importResetState();
    const f = importFile?.files?.[0];
    if (!f) return;
    try {
      const obj = JSON.parse(await readFileAsText(f));
      if (!isValidImportPayload(obj)) throw new Error(t("bases.import.invalidFormat"));
      importParsed = obj;
      if (btnImportJson) btnImportJson.disabled = false;
    } catch (e) {
      if (importErr) { importErr.textContent = e?.message || t("bases.import.invalidJson"); importErr.hidden = false; }
    }
  });

  btnImportJson?.addEventListener("click", async () => {
    if (btnImportJson?.disabled || !importParsed) return;
    const payload = importParsed;
    const qCount = Array.isArray(payload?.questions) ? payload.questions.length : 0;

    setMsg(importMsg, "");
    showProgBlock(importProg, true);
    setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
      step: t("bases.import.steps.start"), i: 0, n: qCount, msg: "",
    });
    if (btnImportJson) btnImportJson.disabled = true;
    if (btnCancelImport) btnCancelImport.disabled = true;
    if (btnImportCancelAction) btnImportCancelAction.disabled = true;
    if (importFile) importFile.disabled = true;

    try {
      const newId = await importBase(payload, ({ step, i, n, msg } = {}) => {
        setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
          step: step || t("bases.import.steps.default"), i, n, msg,
        });
      });
      selectedId = newId;
      setActiveTab("mine");
      await refreshView();
      showProgBlock(importProg, false);
      setMsg(importMsg, t("bases.import.success"));
      if (btnImportJson) btnImportJson.hidden = true;
      if (btnImportDone) btnImportDone.hidden = false;
      if (btnImportCancelAction) btnImportCancelAction.hidden = true;
    } catch (e) {
      console.warn("[bases] import error:", e);
      setMsg(importMsg, t("bases.import.failed"));
      setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
        step: t("bases.import.errorStep"), i: 0, n: 1, msg: e?.message || t("bases.import.errorMsg"), isError: true,
      });
    } finally {
      showProgBlock(importProg, false);
      if (btnImportJson) btnImportJson.disabled = !importParsed;
      if (btnCancelImport) btnCancelImport.disabled = false;
      if (btnImportCancelAction) btnImportCancelAction.disabled = false;
      if (importFile) importFile.disabled = false;
    }
  });

  btnCancelImport?.addEventListener("click", () => closeImportModal());
  btnImportCancelAction?.addEventListener("click", () => closeImportModal());
  btnImportDone?.addEventListener("click", () => closeImportModal());

  btnShareClose?.addEventListener("click", () => closeShareModal());
  btnShareDone?.addEventListener("click", () => closeShareModal());
  btnShareSendClose?.addEventListener("click", () => closeShareSendModal());
  btnShareSendCancel?.addEventListener("click", () => closeShareSendModal());
  btnShareAdd?.addEventListener("click", async () => shareAdd());
  shareEmail?.addEventListener("input", () => updateBaseShareSelection());
  shareEmail?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") shareAdd();
  });
});

async function refreshAltBadge() {
  try {
    const row = await fetchBadges();
    const n = Number(row?.friends_pending || 0);
    if (!altBadgeEl || !btnFriends) return;
    altBadgeEl.textContent = n > 99 ? "99+" : (n > 0 ? String(n) : "");
  } catch {}
}

/* ================= Init ================= */
function removeShareParam() {
  try {
    const u = new URL(location.href);
    u.searchParams.delete("b");
    history.replaceState(history.state, "", u.toString());
  } catch {}
}

// Wejście z Go: ?b=<token>. Sama decyzja (przyjmij/odrzuć) jest na
// kafelku zaproszenia -- tu tylko wyjaśniamy, dlaczego kafelka może nie być.
async function handleShareLink(token) {
  let info = null;
  try {
    const { data, error } = await sb().rpc("base_share_token_info", { p_token: token });
    if (error) throw error;
    // RPC zwraca TABLE -> supabase-js daje tablicę
    info = Array.isArray(data) ? (data[0] || null) : (data || null);
  } catch (e) {
    console.warn("[bases] token info failed:", e);
    return; // nie wiemy nic pewnego -- lepiej nie straszyć komunikatem
  }

  if (!info) {
    // zadania starsze niż 5 dni są kasowane (base_share_tasks_cleanup)
    await alertModal({ text: t("bases.proposed.expired") });
  } else if (info.recipient_user_id && info.recipient_user_id !== currentUser?.id) {
    await alertModal({ text: t("bases.proposed.mismatch") });
    return; // zostaw ?share= -- po przelogowaniu na właściwe konto link dalej działa
  } else if (info.status === "cancelled") {
    await alertModal({ text: t("bases.proposed.cancelled") });
  } else if (info.status === "pending" || info.status === "opened") {
    setActiveTab("shared");
    const invite = sharedBases.find((b) => b.proposed && b.id === info.base_id);
    if (invite) selectBase(invite.id);
  } else {
    // done / declined
    await alertModal({ text: t("bases.proposed.handled") });
    if (info.status === "done" && sharedBases.some((b) => b.id === info.base_id)) {
      setActiveTab("shared");
      selectBase(info.base_id);
    }
  }
  removeShareParam();
}

// PWA: otwarcie pliku .fambase z systemu (manifest.json -> file_handlers).
function initFileLaunch() {
  if (!("launchQueue" in window)) return;
  window.launchQueue.setConsumer(async (launchParams) => {
    if (!launchParams.files?.length) return;
    const file = await launchParams.files[0].getFile();
    openImportModal();
    const dt = new DataTransfer();
    dt.items.add(file);
    if (importFile) {
      importFile.files = dt.files;
      importFile.dispatchEvent(new Event("change"));
    }
  });
}

(async function init() {
  currentUser = await initPage("bases", { ready: i18nReady });
  if (!currentUser) return;
  guestMode = isGuestUser(currentUser);
  bindResourceDuplicate({button:btnDuplicate,kind:"base",getSource:selectedBase,onDone:async id=>{selectedId=id;setActiveTab("mine");await refreshView();},onState:setButtonsState});
  if (guestMode) {
    document.body.classList.add("bases-guest");
    hideForGuest(currentUser, [btnShare, btnShareSend, basesSectionShared]);
    tabBasesShared?.closest(".tab-slot")?.remove();
    document.getElementById("basesTabs").hidden = true;
  }

  setActiveTab(tabFromUrl(BASE_TABS, DEFAULT_BASE_TAB), { updateUrl: false });
  tabBasesMine?.addEventListener("click", () => setActiveTab("mine"));
  tabBasesShared?.addEventListener("click", () => setActiveTab("shared"));

  initShareRoleSelect();
  window.addEventListener("i18n:lang", () => {
    initShareRoleSelect();
    setActiveTab(activeTab); // podpowiedź w nowym języku
    render();
    setButtonsState();
  });

  initFileLaunch();

  const loaded = await refreshView({ withBadge: !guestMode });
  document.querySelectorAll('[data-skel-step]').forEach(el => el.classList.add('skel-step-ready'));
  if (!loaded) setHint(t("bases.loadFailed"));

  // auto refresh jak w subscriptions
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoRefresh();
    else startAutoRefresh();
  });
  startAutoRefresh();

  const shareToken = new URLSearchParams(location.search).get("b");
  if (!guestMode && shareToken && loaded) await handleShareLink(shareToken);
})();
