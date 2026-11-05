import { escapeHtmlText as escapeHtml } from "../../shared/js/core/html-escape.js?v=v2026-11-05T22122";
import { changeGameType } from "./change-type.js?v=v2026-11-05T22122";
import { gameTransferDropsVotes, normalizeGamePackage } from "../../shared/js/core/game-transfer-format.js?v=v2026-11-05T22122";
import { bindResourceDuplicate } from "../../shared/js/core/resource-duplicate.js?v=v2026-11-05T22122";
import { bindResourceSend } from "../../shared/js/core/resource-send.js?v=v2026-11-05T22122";
import { loadResourceCopyOffers, decideResourceCopy } from "../../shared/js/core/resource-copy-inbox.js?v=v2026-11-05T22122";
import { tileTagsHtml, proposedTags, proposedActionsHtml, bindProposedActions } from "../../shared/js/core/proposed-tile.js?v=v2026-11-05T22122";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-05T22122";
import { addRenameGesture } from "../../shared/js/core/rename-gesture.js?v=v2026-11-05T22122";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-05T22122";
import { fetchBadges } from "../../shared/js/core/nav-contact-badges.js?v=v2026-11-05T22122";
import { alertModal, confirmModal, promptModal, progressModal } from "../../shared/js/core/modal.js?v=v2026-11-05T22122";
import { initI18n, t } from "../../shared/translation/translation.js?v=v2026-11-05T22122";
import { linkTo, PAGES } from "../../shared/js/core/nav-map.js?v=v2026-11-05T22122";
import { tabFromUrl, setTab, markActiveTab } from "../../shared/js/core/tabs.js?v=v2026-11-05T22122";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-05T22122";
import { initUiSelect } from "../../shared/js/core/ui-select.js?v=v2026-11-05T22122";
import { maybeShowGuestMigrateReminder } from "../../shared/js/core/guest-migrate-reminder.js?v=v2026-11-05T22122";

import { initPwa, isStandalone, isIOSSafari, isMobileDevice, canOfferPwaInstall } from "../../shared/js/core/pwa.js?v=v2026-11-05T22122";
import { createPollResults } from "../../shared/js/core/poll-results.js?v=v2026-11-05T22122";
import { sortAnswersByPoints } from "../../shared/js/core/answer-order.js?v=v2026-11-05T22122";
import { openDialog, closeDialog, isOverlayOpen, handleSheetBack } from "../../shared/js/core/modal-sheet.js?v=v2026-11-05T22122";
import { setMessage } from "../../shared/js/core/toast.js?v=v2026-11-05T22122";

// Zarejestruj listener PWA jak najwcześniej – beforeinstallprompt może odpalić przed requireAuth
const pwaApi = initPwa();
// Jeśli beforeinstallprompt już odpalił zanim dodaliśmy listener w IIFE, sprawdzimy po zalogowaniu

import { exportGame, importGame, downloadJson } from "./games-import-export.js?v=v2026-11-05T22122";
import { setTopbarNavPriority } from '../../shared/js/core/topbar-controller.js?v=v2026-11-05T22122';

import "../../shared/js/core/contact-modal.js?v=v2026-11-05T22122";

import {
  TYPES,
  STATUS,
  loadGameBasic,
  validateGame,
  rulesFromState,
  editGate,
} from "../../shared/js/core/game-validate.js?v=v2026-11-05T22122";
import { isResourceBusy, acquireResourceLock, getTabId } from "../../shared/js/core/resource-lock.js?v=v2026-11-05T22122";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-05T22122";
import { initListSearch } from "../../shared/js/core/list-search.js?v=v2026-11-05T22122";
import { gameStateKey, SORT_LIST } from "../../shared/js/core/list-filter.js?v=v2026-11-05T22122";
import { initListHeaderLayout } from "../../shared/js/core/list-header-layout.js?v=v2026-11-05T22122";
import { bindLocalizedFilePicker } from "../../shared/js/core/file-picker.js?v=v2026-11-05T22122";
import { setProgress, ratioPct } from "../../shared/js/core/ui-metrics.js?v=v2026-11-05T22122";

const MSG = {
  exportBaseEmpty: () => t("games.exportBase.empty"),
  exportBaseMetaOwned: () => t("games.exportBase.metaOwned"),
  exportBaseMetaShared: () => t("games.exportBase.metaShared"),
  exportBaseBaseFallback: () => t("games.exportBase.baseFallback"),
  gameFallback: () => t("games.gameFallback"),
  typePollText: () => t("games.types.pollText"),
  typePollPoints: () => t("games.types.pollPoints"),
  typePrepared: () => t("games.types.prepared"),
  typeMarket: () => t("games.types.market"),
  statusDraft: () => t("games.status.draft"),
  statusOpen: () => t("games.status.open"),
  statusStopped: () => t("games.status.stopped"),
  badgeVotes: (n) => t("games.badges.votes", { n }),
  badgeToTally: () => t("games.badges.toTally"),
  statusReady: () => t("games.status.ready"),
  statusToOpen: () => t("games.status.toOpen"),
  newGamePollText: () => t("games.newGame.pollText"),
  newGamePollPoints: () => t("games.newGame.pollPoints"),
  newGamePrepared: () => t("games.newGame.prepared"),
  deleteTitle: () => t("games.delete.title"),
  deleteText: (name) => t("games.delete.text", { name }),
  deletePollAbort: () => t("games.delete.pollAbort"),
  deleteOk: () => t("games.delete.ok"),
  deleteCancel: () => t("games.delete.cancel"),
  alertDeleteFailed: () => t("games.alert.deleteFailed"),
  alertDeleteInUseLocked: () => t("games.alert.deleteInUseLocked"),
  alertCreateFailed: () => t("games.alert.createFailed"),
  hintRename: () => t("common.renameTileHint"),
  alertCheckFailed: () => t("games.alert.checkFailed"),
  alertOpenPollFailed: () => t("games.alert.openPollFailed"),
  exportJsonSub: () => t("games.exportFile.subtitle"),
  exportStart: () => t("games.exportFile.progress.start"),
  exportFetch: () => t("games.exportFile.progress.fetch"),
  exportDone: () => t("games.exportFile.progress.done"),
  exportDownload: () => t("games.exportFile.progress.download"),
  exportErrorLabel: () => t("games.exportFile.progress.errorLabel"),
  exportFailed: () => t("games.exportFile.progress.failed"),
  exportBaseLoadFailed: () => t("games.exportBase.loadFailed"),
  exportBasePick: () => t("games.exportBase.pickBase"),
  exportBaseStart: () => t("games.exportBase.progress.start"),
  exportBaseStep: () => t("games.exportBase.progress.step"),
  exportBaseDone: () => t("games.exportBase.progress.done"),
  exportBaseSaved: () => t("games.exportBase.progress.saved"),
  exportBaseFailed: () => t("games.exportBase.progress.failed"),
  exportBaseErrorLabel: () => t("games.exportBase.progress.errorLabel"),
  importPickFile: () => t("games.import.pickFile"),
  importLoaded: () => t("games.import.loaded"),
  importLoadFailed: () => t("games.import.loadFailed"),
  importPasteJson: () => t("games.import.pasteJson"),
  importInvalidJson: () => t("games.import.invalidJson"),
  importStart: () => t("games.import.progress.start"),
  importSave: () => t("games.import.progress.save"),
  importDone: () => t("games.import.progress.done"),
  importErrorLabel: () => t("games.import.progress.errorLabel"),
  importFailed: () => t("games.import.progress.failed"),
  importDbFailed: () => t("games.import.dbFailed"),
  exportBaseFolderStep: () => t("games.exportBase.progress.folder"),
  exportBaseQuestionsStep: () => t("games.exportBase.progress.questions"),
};

/* ================= DOM ================= */
const grid = document.getElementById("grid");

const hint = document.getElementById("hint");

const btnInstall = document.getElementById("btnInstall");
const btnEdit = document.getElementById("btnEdit");
const btnPreview = document.getElementById("btnPreview");
const btnPlay = document.getElementById("btnPlay");
const btnPoll = document.getElementById("btnPoll");
const btnSettings = document.getElementById("btnSettings");

const friendsBadge = document.getElementById("friendsBadge");
const tasksBadge = document.getElementById("tasksBadge");

const btnDuplicate = document.getElementById("btnDuplicate");
const btnChangeType = document.getElementById("btnChangeType");
const btnSendCopy = document.getElementById("btnSendCopy");
const btnExport = document.getElementById("btnExport");
const btnImport = document.getElementById("btnImport");
const btnExportBase = document.getElementById("btnExportBase");
const btnBackSheet = document.getElementById("btnBackSheet");

// Modal eksportu do bazy
const exportBaseOverlay = document.getElementById("exportBaseOverlay");
const baseSelectWrap = document.getElementById("baseSelectWrap");
const btnExportBaseDo = document.getElementById("btnExportBaseDo");
const btnExportBaseCancel = document.getElementById("btnExportBaseCancel");
const exportBaseMsg = document.getElementById("exportBaseMsg");

let baseSelectApi = null; // ui-select API

// Export base progress (w modalu eksportu do bazy)
const exportBaseProg = document.getElementById("exportBaseProg");
const exportBaseProgStep = document.getElementById("exportBaseProgStep");
const exportBaseProgCount = document.getElementById("exportBaseProgCount");
const exportBaseProgBar = document.getElementById("exportBaseProgBar");
const exportBaseProgMsg = document.getElementById("exportBaseProgMsg");

// Tabs
const tabPollText = document.getElementById("tabPollText");
const tabPollPoints = document.getElementById("tabPollPoints");
const tabPrepared = document.getElementById("tabPrepared");
const tabMarket = document.getElementById("tabMarket");
const connectDeviceBadge = document.getElementById("connectDeviceBadge");

// Modal importu JSON
const importOverlay = document.getElementById("importOverlay");
const importFile = document.getElementById("importFile");
const importFilePicker = bindLocalizedFilePicker({
  input: importFile,
  button: document.getElementById("btnChooseImportFile"),
  fileName: document.getElementById("importFileName"),
  t,
});
const btnImportJson = document.getElementById("btnImportJson");
const btnCancelImport = document.getElementById("btnCancelImport");
const btnImportCancelAction = document.getElementById("btnImportCancelAction");
const importPreview = document.getElementById("importPreview");
const importErr = document.getElementById("importErr");
const importMsg = document.getElementById("importMsg");

// Import progress (w modalu importu)
const importProg = document.getElementById("importProg");
const importProgStep = document.getElementById("importProgStep");
const importProgCount = document.getElementById("importProgCount");
const importProgBar = document.getElementById("importProgBar");
const importProgMsg = document.getElementById("importProgMsg");

// Export do pliku progress (osobny overlay)

/* ================= STATE ================= */
let currentUser = null;
let gamesAll = [];
let copyOffers = new Map(); // otrzymane kopie czekające na decyzję: id gry → oferta
let selectedId = null;
let marketGamesAll = [];
let selectedMarketId = null;

let renameLease = null; // blokada game:G trzymana, dopóki okno zmiany nazwy jest otwarte

// =======================================================
// Auto-refresh
// - co 20s
// - tylko gdy karta widoczna
// - nie odświeżaj gdy overlay/progress jest otwarty
// =======================================================
let autoRefreshTimer = null;
let gamesRefreshInFlight = null;

function anyOverlayOpen() {
  const ovs = [importOverlay, exportBaseOverlay];
  return !!document.querySelector(".uni-modal")
    || ovs.some((ov) => isOverlayOpen(ov));
}

async function refreshView() {
  if (gamesRefreshInFlight) return gamesRefreshInFlight;
  gamesRefreshInFlight = (async () => {
    try {
      await refresh();
    } catch (e) {
      // Chwilowy brak sieci przy auto-odświeżaniu: zostaje ostatnia lista,
      // zamiast nieobsłużonego odrzucenia co 20 s.
      console.warn("[games] refresh failed:", e);
    }
  })();
  try {
    await gamesRefreshInFlight;
  } finally {
    gamesRefreshInFlight = null;
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    if (anyOverlayOpen()) return;
    void refreshView();
  }, 20000);
}

function stopAutoRefresh() {
  if (!autoRefreshTimer) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

// DOMYŚLNIE: PREPAROWANA
let activeTab = TYPES.PREPARED;

/* ================= UI helpers ================= */

const IOS_PROMPT_LS_KEY = "pwa:install_dismissed";

async function maybeShowIosWebappPrompt() {
  if (!isIOSSafari() || isStandalone()) return;
  if (localStorage.getItem(IOS_PROMPT_LS_KEY)) return;

  let skipNextTime = false;
  await confirmModal({
    title: t("games.iosWebapp.title"),
    text: t("games.iosWebapp.text"),
    okText: t("games.iosWebapp.ok"),
    cancelText: t("games.iosWebapp.never"),
    onReady: ({ cancelBtn }) => {
      cancelBtn?.addEventListener("click", () => { skipNextTime = true; }, { once: true });
    },
  });

  if (skipNextTime) localStorage.setItem(IOS_PROMPT_LS_KEY, "1");
}

function setProgUi(stepEl, countEl, barEl, msgEl, { step, i, n, msg, isError, done } = {}) {
  if (stepEl && step != null) {
    if (isError || done) stepEl.innerHTML = iconText(isError ? "error" : "check", String(step));
    else stepEl.textContent = String(step);
  }
  if (countEl) countEl.textContent = `${Number(i) || 0}/${Number(n) || 0}`;

  setProgress(barEl, ratioPct(i, n));

  if (msgEl) {
    msgEl.textContent = msg ? String(msg) : "";
    msgEl.dataset.kind = isError ? "error" : "";
  }
}

function showProgBlock(el, on) {
  if (el) el.hidden = !on;
}

function setHint(t) {
  if (!hint) return;
  // domyślny tekst z HTML (data-i18n) pokazuje się razem z tytułem; dalej steruje JS
  hint.removeAttribute("data-i18n");
  hint.textContent = t || "";
}

function setImportMsg(text, kind) { setMessage(importMsg, text, kind); }

let importParsed = null; // aktualnie sparsowany obiekt gry
let importCompleted = false;

function importResetPreview() {
  importParsed = null;
  importCompleted = false;
  if (btnImportJson) {
    btnImportJson.setAttribute("data-i18n", "games.import.confirm");
    btnImportJson.setAttribute("data-i18n-icon", "upload");
    btnImportJson.innerHTML = iconText("upload", t("games.import.confirm"));
  }
  if (btnImportCancelAction) btnImportCancelAction.hidden = false;
  setImportMsg("");
  showProgBlock(importProg, false);
  if (importPreview) { importPreview.hidden = true; importPreview.innerHTML = ""; }
  if (importErr) { importErr.hidden = true; importErr.textContent = ""; }
  if (btnImportJson) btnImportJson.disabled = true;
}

function openImportModal() {
  importResetPreview();
  importFilePicker.reset();
  setImportMsg("");
  showProgBlock(importProg, false);
  openDialog(importOverlay, { onClose: closeImportModal });
}
function closeImportModal() {
  closeDialog(importOverlay);
}

// Okno nazwy (tworzenie i zmiana nazwy) -- wspólne promptModal (modal.js).
// Zmiana nazwy trzyma game:G wyłącznie do zamknięcia okna (familijna-server/docs/blokady-
// zasobow.md, sekcja 6) -- w tym czasie nikt nie otworzy tej gry w edytorze,
// ustawieniach, ankiecie ani Control.
async function openNameDialog({ game = null, uiType = null } = {}) {
  const create = !game;
  if (!create) {
    let lease;
    try {
      lease = await acquireResourceLock({ resourceType: "game", resourceId: game.id, context: "games-list" });
    } catch (e) {
      console.error("[games] rename lock error:", e);
      void alertModal({ text: t("games.nameModal.failed") });
      return;
    }
    if (!lease?.ok) {
      void alertModal({ text: t(lease?.error === "gone" ? "resourceLock.goneMessage" : "resourceLock.gameMessage") });
      return;
    }
    renameLease = lease;
  }
  try {
    await promptModal({
      title: t(create ? "games.nameModal.titleCreate" : "games.nameModal.title"),
      text: t(create ? "games.nameModal.subCreate" : "games.nameModal.sub"),
      okText: t("games.common.save"),
      cancelText: t("games.common.cancel"),
      value: create ? "" : (game.name || ""),
      placeholder: t("games.nameModal.placeholder"),
      maxLength: 80,
      selectAll: !create,
      validate: (v) => (String(v).trim() ? null : t("games.nameModal.empty")),
      onSubmit: async (v) => {
        const val = String(v).trim();
        try {
          if (create) {
            const g = await createGame(uiType, val);
            selectedId = g.id;
          } else if (!(await renameGame(game.id, val))) {
            return false;
          }
          await refresh();
        } catch (e) {
          console.error("[games] name modal error:", e);
          return create ? MSG.alertCreateFailed() : t("games.nameModal.failed");
        }
      },
    });
  } finally {
    if (!create) {
      renameLease?.release?.();
      renameLease = null;
    }
  }
}

async function renameGame(gameId, newName) {
  const val = String(newName || "").trim();
  if (!val) return true;

  // game:G trzyma okno zmiany nazwy (renameLease); baza i tak sprawdza
  // blokady innych kart (rename_resource_checked, migracja 313) i odmawia.
  if (renameLease && !renameLease.ok) {
    void alertModal({ text: t("resourceLock.lostMessage") });
    return false;
  }

  const { data, error } = await sb().rpc("rename_resource_checked", {
    p_resource_type: "game",
    p_resource_id: gameId,
    p_name: val,
    p_tab_id: getTabId(),
  });
  if (error) throw error;
  if (data?.in_use) {
    void alertModal({ text: t("resourceLock.gameMessage") });
    return false;
  }
  if (!data?.ok) throw new Error(data?.error || "rename failed");
  return true;
}

function setExportBaseMsg(text, kind) { setMessage(exportBaseMsg, text, kind); }

function openExportBaseModal() {
  setExportBaseMsg("");
  openDialog(exportBaseOverlay, { onClose: closeExportBaseModal });
}

function closeExportBaseModal() {
  closeDialog(exportBaseOverlay);
}



/**
 * Bazy do eksportu:
 * - moje (owner)
 * - udostępnione z rolą editor (bo eksport = zapis do bazy)
 */
async function listExportableBases() {
  const ownedP = sb()
    .from("question_bases")
    .select("id,name,owner_id,updated_at,created_at")
    .eq("owner_id", currentUser.id)
    .order("updated_at", { ascending: false });

  const sharedP = sb()
    .from("question_base_shares")
    .select("role, base_id, question_bases(id,name,owner_id,updated_at,created_at)")
    .eq("user_id", currentUser.id)
    .eq("role", "editor")
    .order("created_at", { ascending: false });

  const [{ data: owned, error: e1 }, { data: shared, error: e2 }] = await Promise.all([ownedP, sharedP]);
  if (e1) throw e1;
  if (e2) throw e2;

  const out = [];

  for (const b of (owned || [])) {
    out.push({ id: b.id, name: b.name, kind: "owned" });
  }

  for (const row of (shared || [])) {
    const b = row.question_bases;
    if (!b) continue;
    out.push({ id: b.id, name: b.name, kind: "shared_editor" });
  }

  // usuń duplikaty, gdyby kiedyś coś się nałożyło
  const seen = new Set();
  return out.filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
}

function renderBaseSelect(bases) {
  if (!baseSelectWrap) return;

  // Zniszcz poprzedni ui-select jeśli istnieje
  if (baseSelectApi) {
    baseSelectApi.destroy();
    baseSelectApi = null;
  }

  if (!bases || !bases.length) {
    // Brak baz - pokaż komunikat (przycisk wyłączony: inaczej klik zamieniał
    // "nie masz baz" na mylące "wybierz bazę")
    baseSelectWrap.hidden = true;
    if (btnExportBaseDo) btnExportBaseDo.disabled = true;
    setExportBaseMsg(MSG.exportBaseEmpty());
    return;
  }

  baseSelectWrap.hidden = false;
  if (btnExportBaseDo) btnExportBaseDo.disabled = false;

  // Przygotuj opcje
  const options = bases.map(b => ({
    value: b.id,
    label: b.name || MSG.exportBaseBaseFallback(),
  }));

  // Inicjalizuj ui-select
  baseSelectApi = initUiSelect(baseSelectWrap, {
    options,
    value: options[0]?.value || "",
    placeholder: MSG.exportBasePick(),
    onChange: (value) => {
      // Można dodać walidację jeśli potrzeba
    },
  });
}

function getSelectedBaseId() {
  return baseSelectApi ? baseSelectApi.getValue() : null;
}

async function pickUniqueRootFolderName(baseId, desiredName) {
  const base = String(desiredName || MSG.gameFallback()).trim() || MSG.gameFallback();
  const base80 = base.slice(0, 80);

  // pobierz nazwy root-folderów z tej bazy
  const { data, error } = await sb()
    .from("qb_categories")
    .select("name")
    .eq("base_id", baseId)
    .is("parent_id", null);

  if (error) throw error;

  const used = new Set((data || []).map(r => String(r.name || "").trim()));

  if (!used.has(base80)) return base80;

  // Dodawaj (2), (3)... pilnując limitu 80 znaków
  for (let n = 2; n < 1000; n++) {
    const suffix = ` (${n})`;
    const candidate = base80.slice(0, Math.max(1, 80 - suffix.length)) + suffix;
    if (!used.has(candidate)) return candidate;
  }

  // awaryjnie (nie powinno się zdarzyć)
  return (base80.slice(0, 70) + " (999)").slice(0, 80);
}

async function exportSelectedGameToBase(baseId, onProgress) {
  if (!selectedId) return;

  // 1) Pobierz payload gry (już masz działające)
  let obj = null;
  obj = await exportGame(selectedId, ({ step, i, n, msg } = {}) => {
    if (typeof onProgress === "function") {
      onProgress({ step: step || MSG.exportFetch(), i, n, msg });
    }
  });

  const gameNameRaw = String(obj?.game?.name || MSG.gameFallback()).trim() || MSG.gameFallback();
  const gameName = await pickUniqueRootFolderName(baseId, gameNameRaw);

  // 2) Utwórz folder w root o nazwie gry
  // Ustal ord = max(root.ord)+1 (opcjonalnie, ale stabilnie)

  const { data: lastRoot, error: eLast } = await sb()
    .from("qb_categories")
    .select("ord")
    .eq("base_id", baseId)
    .is("parent_id", null)
    .order("ord", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (eLast) throw eLast;

  const nextOrd = (Number(lastRoot?.ord) || 0) + 1;

  if (typeof onProgress === "function") {
    onProgress({ step: MSG.exportBaseFolderStep(), i: 0, n: 1, msg: "" });
  }

  const { data: folder, error: eCat } = await sb()
    .from("qb_categories")
    .insert(
      { base_id: baseId, parent_id: null, name: gameName.slice(0, 80), ord: nextOrd },
      { defaultToNull: false }
    )
    .select("id")
    .single();
  if (eCat) throw eCat;

  try {
    await insertExportedQuestions(baseId, folder.id, obj, onProgress);
  } catch (e) {
    // Bez tego błąd w połowie zostawiał w bazie folder z częścią pytań (albo
    // pusty), a ponowna próba tworzyła obok "Nazwa (2)". qb_questions ma
    // category_id ON DELETE SET NULL, więc pytania trzeba usunąć jawnie.
    try {
      await sb().from("qb_questions").delete().eq("category_id", folder.id);
      await sb().from("qb_categories").delete().eq("id", folder.id);
    } catch (cleanupErr) {
      console.warn("[games] export-to-base cleanup failed:", cleanupErr);
    }
    throw e;
  }
}

async function insertExportedQuestions(baseId, folderId, obj, onProgress) {
  // 3) Zapisz pytania do tego folderu
  const qs = Array.isArray(obj?.questions) ? obj.questions : [];
  const rows = qs.map((q, i) => ({
    base_id: baseId,
    category_id: folderId,
    ord: i + 1,
    payload: {
      text: q?.text || "",
      answers: Array.isArray(q?.answers) ? q.answers.map((a) => ({
        text: a?.text || "",
        fixed_points: Number(a?.fixed_points) || 0,
      })) : [],
    },
  }));

  if (rows.length) {
    const nQ = rows.length;
    const CHUNK = 200;

    if (typeof onProgress === "function") {
      onProgress({ step: MSG.exportBaseQuestionsStep(), i: 0, n: nQ, msg: "" });
    }

    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const { error: eQ } = await sb().from("qb_questions").insert(part, { defaultToNull: false });
      if (eQ) throw eQ;

      if (typeof onProgress === "function") {
        onProgress({
          step: MSG.exportBaseQuestionsStep(),
          i: Math.min(i + part.length, nQ),
          n: nQ,
          msg: t("games.exportBase.progress.savedCount", { done: Math.min(i + part.length, nQ), total: nQ }),
        });
      }
    }
  }
}

function safeDownloadName(name) {
  const base = String(name || "familijna")
    // \p{L}, nie \w -- \w to tylko ASCII: "Łódź" dawało "d", a nazwa
    // po ukraińsku kończyła jako "familijna.famgame".
    .replace(/[^\p{L}\p{N}\- ]+/gu, "")
    .trim()
    .slice(0, 40) || "familijna";
  return `${base}.famgame`;
}

// Typ gry z bazy = zakładka (prepared/poll_points/poll_text/market; CHECK
// games_type_check innych nie dopuszcza). Bez zgadywania starych aliasów.
function uiTypeFromRow(g) {
  return String(g?.type || "");
}

function typeLabel(uiType) {
  if (uiType === TYPES.POLL_TEXT) return MSG.typePollText();
  if (uiType === TYPES.POLL_POINTS) return MSG.typePollPoints();
  if (uiType === TYPES.PREPARED) return MSG.typePrepared();
  if (uiType === TYPES.MARKET) return MSG.typeMarket();
  return String(uiType || t("common.emDash")).toUpperCase();
}

// Klucz stanu kafla (draft/toOpen/open/stopped/ready) — wspólny dla etykiety i filtra.
function statusKey(st, g) {
  // Preparowana ma zawsze stan „draft” — gotowa do gry to nie szkic.
  return gameStateKey(st, {
    isPrepared: !!g && uiTypeFromRow(g) === TYPES.PREPARED,
    playOk: !!g && !!rulesFromState(g.rules_state)?.play?.ok,
    openOk: !!g && !!rulesFromState(g.rules_state)?.poll_open?.ok,
  });
}

function statusLabel(st, g) {
  const k = statusKey(st, g);
  if (k === "ready") return MSG.statusReady();
  if (k === "toOpen") return MSG.statusToOpen();
  if (k === "open") return MSG.statusOpen();
  if (k === "stopped") return MSG.statusStopped();
  return MSG.statusDraft();
}

function setButtonsState({ hasSel, canEdit, canPlay, canPoll, canExport, canChangeType = false, canDuplicate = false, canSend = false }) {
  const guest = isGuestUser(currentUser);
  if (btnEdit) btnEdit.disabled = !hasSel || !canEdit;
  if (btnChangeType) btnChangeType.disabled = !hasSel || !canChangeType || !!btnChangeType.dataset.busy;
  if (btnPreview) btnPreview.disabled = !hasSel;
  if (btnPlay) btnPlay.disabled = !hasSel || !canPlay;
  if (btnPoll) btnPoll.disabled = !hasSel || !canPoll;
  if (btnSettings) btnSettings.disabled = !hasSel || !canPlay;
  if (btnExport) btnExport.disabled = !hasSel || !canExport;
  if (btnExportBase) btnExportBase.disabled = !hasSel || !canExport;
  // Gość może powielać własne gry; wysyłać kopii nie może (decyzja 2026-10-22).
  if (btnDuplicate) btnDuplicate.disabled = !!btnDuplicate.dataset.duplicateBusy || !hasSel || !canDuplicate;
  if (btnSendCopy) {
    btnSendCopy.hidden = guest;
    btnSendCopy.disabled = !!btnSendCopy.dataset.sendBusy || !hasSel || !canSend || guest;
  }
}
/* ================= Tabs ================= */
// Karty i domyślna (pierwsza) z mapy stron; nazwy kart = wartości TYPES.
const GAME_TABS = PAGES.games.tabs;
const DEFAULT_GAME_TAB = GAME_TABS[0];

function gameTabFromUrl() {
  return tabFromUrl(GAME_TABS, DEFAULT_GAME_TAB);
}

function setActiveTab(type, { updateUrl = true } = {}) {
  type = GAME_TABS.includes(type) ? type : DEFAULT_GAME_TAB;
  activeTab = type;

  if (updateUrl) setTab(type, DEFAULT_GAME_TAB);

  const tabByType = { [TYPES.POLL_TEXT]: tabPollText, [TYPES.POLL_POINTS]: tabPollPoints, [TYPES.PREPARED]: tabPrepared, [TYPES.MARKET]: tabMarket };
  markActiveTab(Object.values(tabByType), tabByType[type]);

  // jeśli zaznaczona gra nie pasuje do zakładki – odznacz
  if (type !== TYPES.MARKET) {
    selectedMarketId = null;
    const sel = gamesAll.find(g => g.id === selectedId);
    if (sel && uiTypeFromRow(sel) !== activeTab) selectedId = null;
  } else {
    selectedId = null;
  }

  render();
  updateActionState();
}

/* ================= DB ================= */
async function listGames() {
  const { data, error } = await sb()
    .from("games")
    .select("id,name,created_at,updated_at,type,status,rules_state,received_from_label,received_from_identity")
    .neq("type", TYPES.MARKET)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

function defaultNameForUiType(uiType) {
  if (uiType === TYPES.POLL_TEXT) return MSG.newGamePollText();
  if (uiType === TYPES.POLL_POINTS) return MSG.newGamePollPoints();
  return MSG.newGamePrepared();
}

async function createGame(uiType, name) {
  const { data, error } = await sb()
    .from("games")
    .insert(
      {
        name: name || defaultNameForUiType(uiType),
        owner_id: currentUser.id,
        type: uiType,
        status: STATUS.DRAFT,
      },
      { defaultToNull: false }
    )
    .select("id,name,type,status")
    .single();
  if (error) throw error;
  return data;
}

async function deleteGame(game) {
  const ok = await confirmModal({
    title: MSG.deleteTitle(),
    // 312: otwarta ankieta nie blokuje usunięcia -- zostaje przerwana
    text: (game.status === STATUS.POLL_OPEN || game.status === STATUS.POLL_STOPPED) ? `${MSG.deleteText(game.name)} ${MSG.deletePollAbort()}` : MSG.deleteText(game.name),
    okText: MSG.deleteOk(),
    cancelText: MSG.deleteCancel(),
  });
  if (!ok) return;

  // Zamiast gołego .from("games").delete() — RPC sprawdza i usuwa
  // atomowo, blokując gdy gra ma aktywny edit_lock (edytor/ustawienia/ankieta/control
  // otwarte gdzie indziej) — patrz familijna-server/docs/plan-testy-i-poprawki.md,
  // "Krzyżowe blokady między zasobami". MUSI się wykonać PRZED
  // sprzątaniem plików dźwiękowych niżej — inaczej zablokowane usunięcie
  // i tak osierociłoby pliki audio gry, która jednak zostaje.
  const { data: result, error } = await sb().rpc("delete_resource_checked", {
    p_resource_type: "game",
    p_resource_id: game.id,
    p_tab_id: getTabId(),
  });
  if (error) {
    console.error("[games] delete error:", error);
    void alertModal({ text: MSG.alertDeleteFailed() });
    return;
  }
  if (!result?.ok) {
    // Usunięta w międzyczasie (np. w innej karcie) -- nie ma czego blokować,
    // wystarczy odświeżyć listę (wcześniej komunikat "gra jest w użyciu").
    if (result?.error === "not_found_or_forbidden") return;
    console.warn("[games] delete blocked:", result);
    void alertModal({
      text: MSG.alertDeleteInUseLocked(),
    });
    return;
  }
  // Folder dźwięków gry usuwa baza (migracja 313, kolejka storage_cleanup_queue).
}

/* ================= Render ================= */
// Co blokuje NASTĘPNY krok gry -- widać bez zaznaczania kafelka:
// preparowana -> czy da się grać; ankieta w szkicu -> czy da się ją
// uruchomić. Otwarta/zamknięta ankieta: status w linii meta wystarcza.
function tileBlocker(g) {
  const v = rulesFromState(g?.rules_state);
  if (!v) return "";
  const uiType = uiTypeFromRow(g);
  if (uiType === TYPES.PREPARED) return v.play.ok ? "" : v.play.reason;
  if (g.status === STATUS.DRAFT) return v.poll_open.ok ? "" : v.poll_open.reason;
  return "";
}

// Liczby głosów otwartych / zatrzymanych ankiet (polls_vote_counts): jedno zapytanie
// na wczytanie listy, nie na kafelek.
let pollVoteCounts = new Map();

async function loadPollVoteCounts() {
  try {
    const { data, error } = await sb().rpc("polls_vote_counts");
    if (error) throw error;
    pollVoteCounts = new Map((data || []).map((r) => [r.game_id, Number(r.votes) || 0]));
  } catch (e) {
    console.warn("[games] polls_vote_counts failed:", e);
    pollVoteCounts = new Map();
  }
}

function pollBadge(g) {
  if (g.status === STATUS.POLL_OPEN) {
    return pollVoteCounts.has(g.id) ? { cls: "tag--muted", text: MSG.badgeVotes(pollVoteCounts.get(g.id)) } : null;
  }
  if (g.status === STATUS.POLL_STOPPED) return { cls: "tag--gold pollBadge--tally", text: MSG.badgeToTally() };
  return null;
}

// Kolor oznaczenia stanu: szkic wyciszony, do uruchomienia i otwarta niebieska,
// zatrzymana złota, gotowa zielona.
function statusTagClass(g) {
  const k = statusKey(g.status, g);
  if (k === "ready") return "tag--ok";
  if (k === "toOpen" || k === "open") return "tag--info";
  if (g.status === STATUS.POLL_STOPPED) return "tag--gold";
  return "tag--muted";
}

// Otrzymana kopia czekająca na decyzję: kafel propozycji jak zaproszenie do
// bazy (proposed-tile.js) — „Propozycja” + „Od: X”, ✓/✕ zamiast kosza.
function cardProposed(g, offer) {
  const el = document.createElement("div");
  el.className = "card tile";
  el.dataset.gameId = g.id;
  el.dataset.proposed = "1";
  el.dataset.created = g.created_at || "";
  el.dataset.updated = g.updated_at || "";
  el.dataset.received = g.created_at || "";
  el.dataset.status = statusKey(g.status, g);
  el.innerHTML = `
    ${proposedActionsHtml()}
    <div class="name"></div>
    <div class="tileTags">${tileTagsHtml(proposedTags({ from: offer.sender_label, title: t("resourceSend.proposedTitle") }))}</div>
  `;
  el.querySelector(".name").textContent = g.name || offer.name || t("common.emDash");
  el.addEventListener("click", () => selectGame(g.id));
  bindProposedActions(el, {
    accept: () => decideResourceCopy(offer.id, "accept"),
    decline: () => decideResourceCopy(offer.id, "decline"),
    onFail: () => alertModal({ text: t("resourceSend.errors.decisionFailed") }),
    onDone: refresh,
  });
  return el;
}

function cardGame(g) {
  const offer = copyOffers.get(g.id);
  if (offer) return cardProposed(g, offer);
  const el = document.createElement("div");
  el.className = "card tile";
  el.dataset.gameId = g.id;
  el.dataset.created = g.created_at || "";
  el.dataset.updated = g.updated_at || "";
  el.dataset.received = g.received_from_identity ? (g.created_at || "") : "";
  el.dataset.status = statusKey(g.status, g);

  el.innerHTML = `
    <div class="x" title="${t("games.card.delete")}">${icon("trash")}</div>
    <div class="name"></div>
    <div class="rules"></div>
    <div class="tileTags"></div>
  `;

  el.querySelector(".name").textContent = g.name || t("common.emDash");

  // Rząd oznaczeń: stan zawsze (ta sama wysokość i odstęp na każdym kaflu),
  // obok plakietka ankiety — OTWARTA: liczba głosów, ZATRZYMANA: „do podliczenia”.
  const tags = el.querySelector(".tileTags");
  const addTag = (text, cls) => {
    const tag = document.createElement("span");
    tag.className = `tag ${cls}`;
    tag.textContent = text;
    tags.append(tag);
  };
  addTag(statusLabel(g.status, g), `cardStatus ${statusTagClass(g)}`);
  if (g.received_from_label) addTag(t("resourceSend.from", { name: g.received_from_label }), "tag--muted");
  const badge = pollBadge(g);
  if (badge) addTag(badge.text, `pollBadge ${badge.cls}`);

  const blocker = tileBlocker(g);
  el.querySelector(".rules").textContent = blocker;
  el.classList.toggle("not-ready", !!blocker);

  el.addEventListener("click", () => selectGame(g.id));

  addRenameGesture(el, () => {
    void openNameDialog({ game: g });
  });

  el.querySelector(".x").addEventListener("click", async (e) => {
    e.stopPropagation();
    await deleteGame(g);
    await refresh();
  });

  return el;
}

// Zaznaczenie = przełączenie klasy, NIE render(): pełna przebudowa kafelków
// po pierwszym tapnięciu sprawiała, że drugie trafiało w nowy element i
// podwójne tapnięcie (zmiana nazwy, rename-gesture.js) na dotyku nie działało.
function selectGame(id) {
  selectedId = id;
  grid?.querySelectorAll(".card[data-game-id]").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.gameId === id);
  });
  void updateActionState();
}

function selectMarketGame(marketId) {
  selectedMarketId = marketId;
  grid?.querySelectorAll(".card[data-market-id]").forEach((el) => {
    el.classList.toggle("is-selected", el.dataset.marketId === marketId);
  });
  setMarketButtonsState();
}

grid?.addEventListener("click", (event) => {
  if (event.target !== grid) return;
  if (activeTab === TYPES.MARKET) selectMarketGame(null);
  else selectGame(null);
});
grid?.closest(".games-card")?.addEventListener("click", (event) => {
  if (event.target !== event.currentTarget) return;
  if (activeTab === TYPES.MARKET) selectMarketGame(null);
  else selectGame(null);
});

function cardAdd(uiType) {
  const el = document.createElement("div");
  el.className = "addCard";
  el.innerHTML = `
    <div class="plus">${icon("plus")}</div>
    <div class="txt">${t("games.card.newGame")}</div>
  `;
    el.addEventListener("click", () => {
      void openNameDialog({ uiType });
    });
  return el;
}

function render() {
  if (!grid) return;
  grid.innerHTML = "";

  if (activeTab === TYPES.MARKET) {
    renderMarket();
    return;
  }

  const games = (gamesAll || []).filter(g => uiTypeFromRow(g) === activeTab);

  // Kafel „Nowa gra” zawsze pierwszy, zaraz po nim propozycje (otrzymane
  // kopie), potem reszta gier.
  grid.appendChild(cardAdd(activeTab));

  const proposed = games.filter(g => copyOffers.has(g.id));
  for (const g of [...proposed, ...games.filter(g => !copyOffers.has(g.id))]) {
    const el = cardGame(g);
    if (g.id === selectedId) el.classList.add("is-selected");
    grid.appendChild(el);
  }

  setButtonsState({
    hasSel: !!selectedId,
    canEdit: false,
    canPlay: false,
    canPoll: false,
    canExport: false,
  });

  setHint(MSG.hintRename());
}

function renderMarket() {
  if (!grid) return;
  grid.innerHTML = "";

  if (!marketGamesAll.length) {
    const el = document.createElement("div");
    el.className = "addCard";
    el.classList.add("addCard--static"); // komunikat w miejscu kafla, nieklikalny
    el.innerHTML = `
      <div class="txt">${t("games.market.empty")}</div>
      <div class="sub">${t("games.market.emptyHint")}</div>
    `;
    grid.appendChild(el);
  }

  for (const g of marketGamesAll) {
    const el = cardMarket(g);
    if (g.key === selectedMarketId) el.classList.add("is-selected");
    grid.appendChild(el);
  }

  setMarketButtonsState();
  setHint("");
}

function setMarketButtonsState() {
  setButtonsState({
    hasSel: !!selectedMarketId,
    canEdit: false,
    canPlay: !!selectedMarketId,
    canPoll: false,
    canExport: false,
  });
}

function cardMarket(g) {
  const el = document.createElement("div");
  el.className = "card tile";
  el.dataset.marketId = g.key;
  el.innerHTML = `
    <div class="name">${escapeHtml(g.title || "—")}</div>
    <div class="meta">${g.archived ? escapeHtml(t("games.market.archived")) : (g.lang || "").toUpperCase()}</div>
    <div class="x" title="${t("games.market.removeFromLibrary")}">${icon("trash")}</div>
  `;
  el.addEventListener("click", () => selectMarketGame(g.key));
  el.querySelector(".x").addEventListener("click", async (e) => {
    e.stopPropagation();
    await removeFromLibrary(g);
  });
  return el;
}

// Usunięcie z biblioteki kasuje też lokalną kopię gry (z jej ustawieniami),
// więc -- jak przy zwykłej grze -- najpierw potwierdzenie. Wcześniej jedno
// kliknięcie w kosz usuwało grę od razu, a błąd znikał w konsoli.
async function removeFromLibrary(g) {
  const ok = await confirmModal({
    title: t("games.market.removeTitle"),
    text: t("games.market.removeText", { name: g.title || "—" }),
    okText: t("games.market.removeOk"),
    cancelText: MSG.deleteCancel(),
  });
  if (!ok) return;

  try {
    // Kopia może być właśnie otwarta w Control/ustawieniach (zasób "game"),
    // a RPC usuwa ją bez pytania -- patrz "Model: zasób ma stan busy/free".
    if (g.game_id && await isResourceBusy("game", g.game_id)) {
      void alertModal({ text: t("resourceLock.gameMessage") });
      return;
    }
    const { data, error } = g.archived
      ? await sb().rpc("market_remove_archived_copy", { p_game_id: g.game_id })
      : await sb().rpc("market_remove_from_library", { p_market_game_id: g.market_game_id });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (row && row.ok === false) throw new Error(row.err || "remove_failed");
  } catch (e) {
    console.error("[games] removeFromLibrary error:", e);
    void alertModal({ text: t("games.market.removeFailed") });
    return;
  }

  if (selectedMarketId === g.key) selectedMarketId = null;
  marketGamesAll = marketGamesAll.filter(x => x.key !== g.key);
  if (activeTab === TYPES.MARKET) renderMarket();
}

async function loadMarketGames() {
  try {
    const { data, error } = await sb().rpc("market_my_library");
    if (error) throw error;
    // Archiwalna kopia (pozycja Marketplace usunięta) nie ma market_game_id --
    // kluczem jest wtedy jej lokalna gra.
    marketGamesAll = (data || []).map((g) => ({ ...g, key: g.market_game_id || `g:${g.game_id}` }));
  } catch (e) {
    console.error("[games] loadMarketGames error:", e);
    marketGamesAll = [];
  }
}

/* ================= Button logic ================= */

// Stan przycisków: zapisany games.rules_state (przyszedł z listą, zero
// dodatkowych zapytań); gdy go brak (stara baza) -- game_validate.
async function selectionRules(g) {
  return rulesFromState(g?.rules_state) || await validateGame(g.id);
}

// Wyłączony przycisk mówi w podpowiedzi, czego brakuje (tekst z bazy).
function setButtonReasons(v) {
  const pairs = [[btnEdit, v?.edit], [btnChangeType, v?.change_type], [btnPlay, v?.play], [btnSettings, v?.play], [btnPoll, v?.poll_entry], [btnExport, v?.export], [btnExportBase, v?.export], [btnDuplicate, v?.duplicate], [btnSendCopy, v?.send]];
  for (const [btn, a] of pairs) {
    if (!btn) continue;
    if (a && !a.ok && a.reason) btn.title = a.reason;
    else btn.title = "";
  }
}

async function updateActionState() {
  // market tab: buttons controlled by renderMarket directly
  if (activeTab === TYPES.MARKET) {
    setButtonReasons(null);
    return;
  }

  const sel = gamesAll.find(g => g.id === selectedId) || null;
  if (!sel) {
    setButtonsState({ hasSel: false, canEdit: false, canPlay: false, canPoll: false, canExport: false });
    setButtonReasons(null);
    return;
  }
  // Kopia czekająca na decyzję: tylko podgląd; resztę odblokowuje przyjęcie (✓ na kafelku).
  if (copyOffers.has(sel.id)) {
    setButtonsState({ hasSel: true, canEdit: false, canPlay: false, canPoll: false, canExport: false });
    if (btnSettings) btnSettings.disabled = true;
    setButtonReasons(null);
    return;
  }

  try {
    const v = await selectionRules(sel);
    // Szybkie klikanie A -> B: odpowiedź dla A mogła przyjść po B i
    // ustawić przyciski według złej gry.
    if (selectedId !== sel.id || activeTab === TYPES.MARKET) return;

    setButtonsState({
      hasSel: true,
      canEdit: v.edit.ok,
      canChangeType: v.change_type.ok,
      canDuplicate: v.duplicate.ok,
      canSend: v.send.ok,
      canPlay: v.play.ok,
      canPoll: v.poll_entry.ok,
      canExport: v.export.ok,
    });
    setButtonReasons(v);
  } catch (e) {
    console.error("[games] game_validate error:", e);
    if (selectedId !== sel.id || activeTab === TYPES.MARKET) return;
    setButtonsState({ hasSel: true, canEdit: false, canPlay: false, canPoll: false, canExport: false });
    setButtonReasons(null);
  }
}

/* ================= Import/Export ================= */
// Otwarta/zatrzymana ankieta przechodzi do pliku/kopii jako szkic -- bieżące
// głosy nie zostaną zachowane (E21); bez zgody nic się nie dzieje.
async function confirmTransferDropsVotes(g, { toBase = false } = {}) {
  if (!gameTransferDropsVotes(g)) return true;
  return confirmModal({
    title: t("games.transferDropsVotes.title"),
    text: t(toBase ? "games.transferDropsVotes.baseText" : "games.transferDropsVotes.text"),
    okText: t("games.transferDropsVotes.ok"),
    cancelText: t("games.transferDropsVotes.cancel"),
  });
}

async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error(MSG.importLoadFailed()));
    r.readAsText(file);
  });
}

/* ================= Main ================= */
async function refresh() {
  const [games, , offers] = await Promise.all([listGames(), loadPollVoteCounts(), loadResourceCopyOffers("game")]);
  gamesAll = games;
  copyOffers = offers;

  if (selectedId && !gamesAll.some(g => g.id === selectedId)) selectedId = null;

  if (activeTab === TYPES.MARKET) {
    await loadMarketGames();
    if (selectedMarketId && !marketGamesAll.some(g => g.key === selectedMarketId)) selectedMarketId = null;
  }

  render();
  await updateActionState();
}

document.addEventListener("DOMContentLoaded", async () => {
  const i18nP = initI18n({ withSwitcher: true });
  // initPage: dostęp, topbar i konto wg mapy (auth startuje równolegle z i18n)
  const userP = initPage("games", { ready: i18nP });
  await i18nP;
  initListHeaderLayout();
  // Typ to zakładki (preparowana/tekstowa/punktowa/rynek); filtr obejmuje stan i odebrane kopie.
  initListSearch({
    grids: "#grid", tile: ".card", name: ".name",
    sort: {
      ...SORT_LIST,
    },
    filter: {
      param: "status", attr: "status",
      options: [
        ...["draft", "toOpen", "open", "stopped", "ready"].map((k) => ({ value: k, labelKey: `games.status.${k}` })),
        { value: "received", labelKey: "games.status.received", matches: (tile) => !!tile.dataset.received },
      ],
      allKey: "common.filterAll", ariaKey: "games.filter.label",
    },
  });

  // Nav priority BEFORE remove('page-loading') — recalc via RAF fires before first paint,
  // so user never sees buttons jump from "all visible" to "some in Więcej"
  const { recalc: _navRecalc } = setTopbarNavPriority({
    moreEl: document.getElementById('navMore'),
    moreDropdownEl: document.getElementById('navMoreDropdown'),
  });

  document.documentElement.classList.remove('page-loading'); // translations ready — show skeleton
  currentUser = await userP;
  if (!currentUser) return; // initPage przekierował na logowanie
  bindResourceDuplicate({button:btnDuplicate,kind:"game",getSource:()=>gamesAll.find(g=>g.id===selectedId),confirm:confirmTransferDropsVotes,onDone:async id=>{selectedId=id;const g=await loadGameBasic(id);setActiveTab(uiTypeFromRow(g));await refresh();},onState:()=>void updateActionState()});
  bindResourceSend({button:btnSendCopy,kind:"game",getSource:()=>gamesAll.find(g=>g.id===selectedId),onDone:async()=>refresh(),onState:()=>void updateActionState()});

  maybeShowGuestMigrateReminder(currentUser);

  // Wspólna reguła z panelem admina: pokazuj tylko przy dostępnej instalacji
  // albo gdy system wymaga ręcznej instrukcji dodania aplikacji.
  if (btnInstall) {
    btnInstall.hidden = isStandalone() || !canOfferPwaInstall(pwaApi);
  }
  window.addEventListener("pwa:installed", () => {
    if (btnInstall) btnInstall.hidden = true;
  });

  void maybeShowIosWebappPrompt();

  // Android/Chrome/Edge/desktop – auto-prompt instalacji PWA (po odrzuceniu LS_KEY jest set → nie odpali)
  window.addEventListener("pwa:installable", () => {
    if (btnInstall && !isStandalone() && canOfferPwaInstall(pwaApi)) btnInstall.hidden = false;
    if (!localStorage.getItem("pwa:install_dismissed")) showPwaPrompt();
  }, { once: true });
  if (pwaApi.canInstall() && !localStorage.getItem("pwa:install_dismissed")) showPwaPrompt();

  async function showPwaPrompt() {
    if (isStandalone()) return;
    let installResult = null;
    const ok = await confirmModal({
      title: t("games.pwaInstall.title"),
      text: t("games.pwaInstall.text"),
      okText: t("games.pwaInstall.ok"),
      cancelText: t("games.pwaInstall.cancel"),
      onReady: ({ okBtn }) => okBtn.addEventListener("click", () => { installResult = pwaApi.install(); }, { once: true }),
    });
    if (ok && installResult) await installResult;
    else pwaApi.dismiss();
  }

  // btnInstall — klik
  btnInstall?.addEventListener("click", async () => {
    if (!pwaApi.canInstall()) {
      if (isIOSSafari()) {
        // iOS: pokaż instrukcję dodania do ekranu głównego
        await alertModal({
          title: t("games.iosWebapp.title"),
          text: t("games.iosWebapp.text"),
          okText: t("games.iosWebapp.ok"),
        });
      } else {
        const ua = navigator.userAgent || "";
        const isAndroidChrome = /Android/i.test(ua) && /Chrome\//i.test(ua) && !/EdgA|OPR\//i.test(ua);
        const isMacSafari = /Mac/.test(navigator.platform) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
        const title = isMacSafari ? t("games.pwaInstall.macSafariTitle") : t("games.pwaInstall.unavailableTitle");
        const text = isMacSafari
          ? t("games.pwaInstall.macSafari")
          : isAndroidChrome
            ? t("games.pwaInstall.unavailableAndroid")
            : t("games.pwaInstall.unavailableText");
        await alertModal({
          title,
          text,
          okText: t("games.iosWebapp.ok"),
        });
        return;
      }
      return;
    }
    let installResult = null;
    const ok = await confirmModal({
      title: t("games.pwaInstall.title"),
      text: t("games.pwaInstall.text"),
      okText: t("games.pwaInstall.ok"),
      cancelText: t("games.pwaInstall.cancelBtn"),
      onReady: ({ okBtn }) => okBtn.addEventListener("click", () => { installResult = pwaApi.install(); }, { once: true }),
    });
    if (ok && installResult) await installResult;
    // Klik Anuluj nie ustawia LS_KEY — celowo bez pwaApi.dismiss()
  });

  // Przyciski przejść topbaru (Społeczność, Logo, Podłącz urządzenie, Subskrypcje,
  // Bazy) podpina i chowa wg roli initPage z PAGES.games.buttons.

  // Po ustaleniu widoczności przycisków (initPage) przelicz overflow nav
  requestAnimationFrame(() => _navRecalc?.());

  // Jeden zapis licznika dla wszystkich przycisków topbara (jak w bazach,
  // ankietach i subskrypcjach): 0 → pusto (CSS chowa pusty .badge), >99 → „99+”.
  function setNavBadge(badgeEl, n){
    if (badgeEl) badgeEl.textContent = n > 99 ? "99+" : (n > 0 ? String(n) : "");
  }

  // Zadania (tylko ankiety): badges_get().tasks_pending.
  async function refreshTasksBadge(){
    try{
      const row = await fetchBadges();
      setNavBadge(tasksBadge, Number(row?.tasks_pending ?? 0));
      setNavBadge(friendsBadge, Number(row?.friends_pending ?? 0));
    } catch (e){
      setNavBadge(tasksBadge, 0);
      setNavBadge(friendsBadge, 0);
    }
  }

  // Licznik = dokładnie to, co pokaże lista na /connect/ na tym
  // urządzeniu (telefon/tablet: prowadzący + przycisk, komputer/TV:
  // wyświetlacz) — wcześniej liczył wszystkie udostępnienia, więc badge
  // obiecywał więcej pozycji niż było na stronie.
  async function refreshConnectDeviceBadge(){
    if (!connectDeviceBadge) return;
    try{
      const { data, error } = await sb().rpc("list_shared_devices_for_me");
      if (error) throw error;
      const mobile = isMobileDevice();
      const n = (data || []).filter((item) => mobile
        ? (item.device_type === "host" || item.device_type === "buzzer")
        : item.device_type === "display").length;
      setNavBadge(connectDeviceBadge, n);
    } catch {
      // cicho, UI ma działać dalej
    }
  }

  async function refreshBasesBadge(){
    try{
      const { data: cnt, error } = await sb().rpc("bases_count_incoming_share_invites");
      if (error) throw error;

      setNavBadge(document.getElementById("basesBadge"), Number(cnt || 0));
    } catch {
      // cicho, UI ma działać dalej
    }
  }

  let badgesRefreshInFlight = null;
  let badgesRefreshTimer = null;
  let lastBadgesRefreshAt = 0;

  async function refreshBadgesNow(){
    if (badgesRefreshInFlight) return badgesRefreshInFlight;
    badgesRefreshInFlight = (async () => {
      await Promise.allSettled([refreshTasksBadge(), refreshBasesBadge(), refreshConnectDeviceBadge()]);
      lastBadgesRefreshAt = Date.now();
    })();
    try {
      await badgesRefreshInFlight;
    } finally {
      badgesRefreshInFlight = null;
    }
  }

  function refreshBadges({ force = false } = {}) {
    const now = Date.now();
    const minGapMs = 12_000;

    if (!force && now - lastBadgesRefreshAt < minGapMs) {
      if (badgesRefreshTimer) return;
      badgesRefreshTimer = setTimeout(() => {
        badgesRefreshTimer = null;
        void refreshBadgesNow();
      }, minGapMs - (now - lastBadgesRefreshAt));
      return;
    }

    if (badgesRefreshTimer) {
      clearTimeout(badgesRefreshTimer);
      badgesRefreshTimer = null;
    }

    void refreshBadgesNow();
  }

  // po init/requireAuth:
  refreshBadges({ force: true });

  setInterval(() => {
    if (document.visibilityState !== "visible") return;
    refreshBadges();
  }, 15_000);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshBadges({ force: true });
  });

  tabPollText?.addEventListener("click", () => setActiveTab(TYPES.POLL_TEXT));
  tabPollPoints?.addEventListener("click", () => setActiveTab(TYPES.POLL_POINTS));
  tabPrepared?.addEventListener("click", () => setActiveTab(TYPES.PREPARED));
  tabMarket?.addEventListener("click", async () => {
    if (activeTab !== TYPES.MARKET) {
      await loadMarketGames();
    }
    setActiveTab(TYPES.MARKET);
  });

  // games.html nie ma naturalnego przycisku wstecz na mobile (jest
  // stroną główną) — btnBackSheet istnieje wyłącznie na potrzeby trybu
  // sheet, zastępuje brand w topbarze gdy modal jest otwarty.
  if (btnBackSheet) btnBackSheet.dataset.sheetBack = "1";
  btnBackSheet?.addEventListener("click", () => { handleSheetBack(); });

  // PREVIEW
  const previewOverlay = document.getElementById("previewOverlay");
  const previewTitle = document.getElementById("previewTitle");
  const previewQuestions = document.getElementById("previewQuestions");
  // Numer bieżącego podglądu: odpowiedź dla gry A, która przyszła po
  // zamknięciu i otwarciu podglądu B, nie może nadpisać pytań B.
  let previewSeq = 0;
  const previewSwitch = document.getElementById("previewSwitch");
  const btnModeGame = document.getElementById("btnPreviewModeGame");
  const btnModePoll = document.getElementById("btnPreviewModePoll");
  const previewPoll = document.getElementById("previewPoll");
  const previewPollMeta = document.getElementById("previewPollMeta");
  const previewPollList = document.getElementById("previewPollList");
  const previewPollResults = createPollResults(previewPollList);
  let previewPollGameId = null;
  let previewPollLoaded = false;

  // Wyniki ankiety: migawka z chwili przełączenia (bez odświeżania w tle).
  const loadPreviewPoll = async () => {
    const seq = previewSeq;
    const id = previewPollGameId;
    if (!id || !previewPollMeta) return;
    previewPollResults.reset();
    previewPollMeta.textContent = t("games.preview.loading");
    try {
      const { data, error } = await sb().rpc("get_poll_preview", { p_game_id: id });
      if (error) throw error;
      if (seq !== previewSeq) return;
      if (data?.status === STATUS.DRAFT) {
        previewPollMeta.textContent = t("games.preview.pollDraft");
        return;
      }
      previewPollMeta.textContent = previewPollResults.render(data);
      previewPollLoaded = true;
    } catch (e) {
      console.error("[games] poll preview failed:", e);
      if (seq !== previewSeq) return;
      previewPollMeta.textContent = t("games.preview.pollFailed");
    }
  };

  const setPreviewMode = (mode) => {
    const poll = mode === "poll";
    btnModeGame?.classList.toggle("gold", !poll);
    btnModePoll?.classList.toggle("gold", poll);
    btnModeGame?.setAttribute("aria-pressed", String(!poll));
    btnModePoll?.setAttribute("aria-pressed", String(poll));
    if (previewQuestions) previewQuestions.hidden = poll;
    if (previewPoll) previewPoll.hidden = !poll;
    if (poll && !previewPollLoaded) void loadPreviewPoll();
  };
  btnModeGame?.addEventListener("click", () => setPreviewMode("game"));
  btnModePoll?.addEventListener("click", () => setPreviewMode("poll"));

  const closePreview = () => {
    previewSeq++;
    if (previewOverlay) closeDialog(previewOverlay);
  };
  document.getElementById("btnPreviewClose")?.addEventListener("click", closePreview);
  document.getElementById("btnPreviewCloseBottom")?.addEventListener("click", closePreview);

  btnPreview?.addEventListener("click", async () => {
    let gameName = "—";
    let marketId = null;
    let archivedId = null;
    const gameId = selectedId;

    // Ustal nazwę i źródło danych
    if (activeTab === TYPES.MARKET && selectedMarketId) {
      const mg = marketGamesAll.find(g => g.key === selectedMarketId);
      if (!mg) return;
      gameName = mg.title || "—";
      marketId = mg.market_game_id;
      archivedId = mg.archived ? mg.game_id : null;
    } else if (gameId) {
      const g = gamesAll.find(x => x.id === gameId);
      gameName = g?.name || "—";
    } else {
      return;
    }
    const seq = ++previewSeq;

    // Przełącznik Gra · Ankieta tylko dla gier ankietowych
    const pg = !marketId ? gamesAll.find(x => x.id === gameId) : null;
    const isPoll = !!pg && (pg.type === TYPES.POLL_TEXT || pg.type === TYPES.POLL_POINTS);
    previewPollGameId = isPoll ? gameId : null;
    previewPollLoaded = false;
    previewPollResults.reset();
    if (previewSwitch) previewSwitch.hidden = !isPoll;
    setPreviewMode("game");

    // Pokaż modal natychmiast z nazwą i "Ładowanie…"
    if (previewTitle) previewTitle.textContent = gameName;
    if (previewQuestions) previewQuestions.innerHTML = `<div class="empty-state">${t("games.preview.loading")}</div>`;
    openDialog(previewOverlay, { onClose: closePreview });

    let questions = [];
    try {
      if (archivedId) {
        // archiwalna kopia: treść tylko w lokalnej grze (bez transferu -- odczyt wprost)
        const { data, error } = await sb().from("questions").select("ord,text,answers(ord,text,fixed_points)")
          .eq("game_id", archivedId).order("ord", { ascending: true });
        if (error) throw error;
        questions = data || [];
      } else if (marketId) {
        // market_my_library nie zwraca treści gry (payload) -- wcześniej
        // podgląd gry ze Społeczności zawsze pokazywał "Brak pytań".
        const { data, error } = await sb().rpc("market_game_detail", { p_id: marketId });
        if (error) throw error;
        const row = Array.isArray(data) ? data[0] : data;
        questions = Array.isArray(row?.payload?.questions) ? row.payload.questions : [];
      } else {
        const exported = await exportGame(gameId);
        questions = exported?.questions ?? [];
      }
    } catch (e) {
      console.error("[games] preview load failed:", e);
    }

    // Renderuj pytania
    if (seq !== previewSeq || !previewQuestions) return;
    if (!questions.length) {
      previewQuestions.innerHTML = `<div class="empty-state">${t("games.preview.noQuestions")}</div>`;
      return;
    }

    const esc = s => String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const ptsLabel = t("games.preview.pts");
    previewQuestions.innerHTML = questions.map((q, i) => {
      const answers = sortAnswersByPoints(q.answers);
      const hasPoints = answers.some(a => a.fixed_points != null && a.fixed_points > 0);
      const answersHtml = answers.map(a =>
        `<li>${esc(a.text)}${hasPoints ? ` <span class="q-preview-pts">(${a.fixed_points ?? 0} ${ptsLabel})</span>` : ""}</li>`
      ).join("");
      return `<div class="q-preview-item">
        <div class="q-preview-text">${i + 1}. ${esc(q.text)}</div>
        ${answersHtml ? `<ol class="q-preview-answers">${answersHtml}</ol>` : ""}
      </div>`;
    }).join("");
  });

  // EDIT
  btnEdit?.addEventListener("click", async () => {
    if (!selectedId) return;

    const g = gamesAll.find(x => x.id === selectedId);
    if (!g) return;

    // Wspólna bramka edycji (game-validate.js): ta sama reguła, potwierdzenie
    // i pełny reset zamkniętej ankiety co edytor i „Zmień typ”.
    const gate = await editGate(g.id, { checkBusy: true });
    if (!gate.ok) return;
    if (gate.reset) await refresh();

    location.href = linkTo("editor", { id: g.id });
  });

  // ZMIEŃ TYP (E21): ta sama gra, bramka edit, wynik -- szkic wybranego typu
  btnChangeType?.addEventListener("click", async () => {
    const g = gamesAll.find(x => x.id === selectedId);
    if (!g || btnChangeType.dataset.busy) return;
    btnChangeType.dataset.busy = "1";
    btnChangeType.disabled = true;
    try {
      const type = await changeGameType(g);
      if (type) {
        setActiveTab(type);
        await refresh();
      }
    } finally {
      delete btnChangeType.dataset.busy;
      void updateActionState();
    }
  });

  // PLAY
  btnPlay?.addEventListener("click", async () => {
    // Gra z marketu: każdy user ma własną kopię games z własnym UUID
    if (activeTab === TYPES.MARKET && selectedMarketId) {
      const mg = marketGamesAll.find(g => g.key === selectedMarketId);
      if (!mg) return;

      let gameId = mg.game_id;
      if (!gameId) {
        // brak kopii — wywołaj market_add_to_library idempotentnie
        if (btnPlay) btnPlay.disabled = true;
        try {
          const { error } = await sb().rpc("market_add_to_library", {
            p_market_game_id: mg.market_game_id,
          });
          if (error) {
            console.error("[games] market_add_to_library:", error);
            void alertModal({ text: MSG.alertCheckFailed() });
            return;
          }
          await loadMarketGames();
          gameId = marketGamesAll.find(g => g.key === selectedMarketId)?.game_id;
        } finally {
          if (btnPlay) btnPlay.disabled = false;
        }
      }

      if (!gameId) return;
      location.href = linkTo("control", { id: gameId });
      return;
    }

    if (!selectedId) return;

    try {
      const chk = (await validateGame(selectedId)).play;
      if (!chk.ok) {
        void alertModal({ text: chk.reason });
        return;
      }
      location.href = linkTo("control", { id: selectedId });
    } catch (e) {
      console.error(e);
      void alertModal({ text: MSG.alertCheckFailed() });
    }
  });

  // POLLS
  btnPoll?.addEventListener("click", async () => {
    if (!selectedId) return;

    try {
      // szkic: treść musi wystarczać do uruchomienia; otwarta/zamknięta: wejście zawsze
      const entry = (await validateGame(selectedId)).poll_entry;
      if (!entry.ok) {
        void alertModal({ text: entry.reason });
        return;
      }

      location.href = linkTo("polls", { id: selectedId });
    } catch (e) {
      console.error(e);
      void alertModal({ text: MSG.alertOpenPollFailed() });
    }
  });

  // SETTINGS
  btnSettings?.addEventListener("click", () => {
    const gameId = activeTab === TYPES.MARKET
      ? marketGamesAll.find(g => g.key === selectedMarketId)?.game_id
      : selectedId;
    if (!gameId) return;
    location.href = linkTo("gameSettings", { id: gameId });
  });

  // EXPORT — pobierz dane z paskiem, potem instant download
  btnExport?.addEventListener("click", async () => {
    if (!selectedId || btnExport?.disabled) return;

    // exportGame() czyta grę/pytania/odpowiedzi w kilku osobnych zapytaniach
    // po kolei -- jeśli ktoś w tym czasie edytuje tę grę (editor/ustawienia/
    // ankieta), eksport może złapać rozjechany stan (np. odpowiedź do
    // pytania, które w międzyczasie zniknęło). Eksport niczego nie
    // nadpisuje, ale sam wyeksportowany plik mógłby być niespójny, więc
    // dostaje ten sam busy-check co reszta jednorazowych akcji strony gier.
    if (await isResourceBusy("game", selectedId)) {
      void alertModal({ text: t("resourceLock.gameMessage") });
      return;
    }
    if (!(await confirmTransferDropsVotes(gamesAll.find((g) => g.id === selectedId)))) return;

    const progress = progressModal({ title: t("games.exportFile.title"), text: MSG.exportJsonSub(), doneText: t("games.exportFile.close") });
    progress.update({ step: MSG.exportStart(), i: 0, n: 0 });
    if (btnExport) btnExport.disabled = true;

    try {
      const obj = await exportGame(selectedId, ({ step, i, n, msg } = {}) => {
        progress.update({ step: step || MSG.exportFetch(), i, n, msg });
      });
      downloadJson(safeDownloadName(obj?.game?.name), obj);
      progress.allowClose(); // „Gotowe” jak dotąd -- okno zamyka użytkownik
    } catch (e) {
      console.error(e);
      progress.update({ step: MSG.exportErrorLabel(), i: 0, n: 1, msg: e?.message || MSG.exportFailed(), isError: true });
    } finally {
      if (btnExport) btnExport.disabled = false;
    }
  });

  btnExportBase?.addEventListener("click", async () => {
    if (!selectedId) return;
    if (!(await confirmTransferDropsVotes(gamesAll.find((g) => g.id === selectedId), { toBase: true }))) return;

    try {
      setExportBaseMsg("");
      if (btnExportBaseDo) btnExportBaseDo.disabled = true;
      openExportBaseModal();

      const bases = await listExportableBases();
      renderBaseSelect(bases);
    } catch (e) {
      console.error(e);
      setExportBaseMsg(MSG.exportBaseLoadFailed());
    }
  });

  btnExportBaseCancel?.addEventListener("click", () => closeExportBaseModal());

  btnExportBaseDo?.addEventListener("click", async () => {
    const baseId = getSelectedBaseId();
    if (!baseId) {
      setExportBaseMsg(MSG.exportBasePick());
      return;
    }

    if (btnExportBaseDo?.disabled) return;

    setExportBaseMsg("");
    showProgBlock(exportBaseProg, true);
    setProgUi(exportBaseProgStep, exportBaseProgCount, exportBaseProgBar, exportBaseProgMsg, {
      step: MSG.exportBaseStart(),
      i: 0,
      n: 1,
      msg: "",
    });

    if (btnExportBaseDo) btnExportBaseDo.disabled = true;
    if (btnExportBaseCancel) btnExportBaseCancel.disabled = true;

    try {
      await exportSelectedGameToBase(baseId, ({ step, i, n, msg, isError } = {}) => {
        setProgUi(exportBaseProgStep, exportBaseProgCount, exportBaseProgBar, exportBaseProgMsg, {
          step: step || MSG.exportBaseStep(),
          i,
          n,
          msg,
          isError,
        });
      });

      setProgUi(exportBaseProgStep, exportBaseProgCount, exportBaseProgBar, exportBaseProgMsg, {
        step: MSG.exportBaseDone(),
        done: true,
        i: 1,
        n: 1,
        msg: MSG.exportBaseSaved(),
      });

      closeExportBaseModal();
      void alertModal({ text: MSG.exportBaseSaved() });
    } catch (e) {
      console.error(e);
      setExportBaseMsg(MSG.exportBaseFailed());
      setProgUi(exportBaseProgStep, exportBaseProgCount, exportBaseProgBar, exportBaseProgMsg, {
        step: MSG.exportBaseErrorLabel(),
        i: 0,
        n: 1,
        msg: e?.message || MSG.exportBaseFailed(),
        isError: true,
      });
    } finally {
      showProgBlock(exportBaseProg, false);
      if (btnExportBaseDo) btnExportBaseDo.disabled = false;
      if (btnExportBaseCancel) btnExportBaseCancel.disabled = false;
    }
  });

  // IMPORT (modal)
  btnImport?.addEventListener("click", openImportModal);
  btnCancelImport?.addEventListener("click", closeImportModal);
  btnImportCancelAction?.addEventListener("click", closeImportModal);

  // Wczytanie pliku → podgląd w modalu
  importFile?.addEventListener("change", async () => {
    importResetPreview();
    const f = importFile?.files?.[0];
    if (!f) return;
    try {
      let obj;
      try {
        obj = JSON.parse(await readFileAsText(f));
      } catch (e) {
        // SyntaxError ma komunikat silnika ("Unexpected token…") po angielsku
        if (e instanceof SyntaxError) throw new Error(MSG.importInvalidJson());
        throw e;
      }
      // Podgląd = to, co zapisze baza (ten sam kontrakt co _game_package_normalize):
      // limity, punkty, nadmiar odpowiedzi; plik bez wersji -- jawny migrator v1.
      let norm;
      try {
        norm = normalizeGamePackage(obj, { defaultName: t("gamesImportExport.defaults.gameName") });
      } catch (e) {
        throw new Error(t(`games.import.errors.${e?.code || "invalid_payload"}`));
      }
      importParsed = obj;
      const gameName = norm.game.name || "—";
      const gameType = typeLabel(norm.game.type) + (norm.game.state === "closed" ? ` · ${t("games.import.preview.closed")}` : "");
      const qs = norm.questions;
      const notes = [norm.recovered && t("games.import.preview.recovered"), norm.closed_downgraded && t("games.import.preview.closedDowngraded")].filter(Boolean);

      const qRows = qs.map((q, i) => {
        const answers = sortAnswersByPoints(q.answers);
        const hasPoints = answers.some(a => Number(a.fixed_points) > 0);
        const aText = answers
          .map(a => escapeHtml(String(a.text || "")) + (hasPoints ? ` (${Number(a.fixed_points) || 0})` : ""))
          .join(" · ");
        return `<div class="import-preview-item"><strong>${i + 1}. ${escapeHtml(String(q.text || ""))}</strong>${aText ? `<div class="import-preview-answers">${aText}</div>` : ""}</div>`;
      }).join("");

      if (importPreview) {
        importPreview.innerHTML = `
          <div class="import-preview-summary">
            <span>${t("games.import.preview.name")} ${escapeHtml(gameName)}</span>
            <span>${t("games.import.preview.type")} ${escapeHtml(gameType)}</span>
            <span>${t("games.import.preview.questions")} ${qs.length}</span>
          </div>
          ${notes.map((note) => `<div class="import-note">${escapeHtml(note)}</div>`).join("")}
          <div class="import-preview-list import-preview-list--scroll scroll-fade">${qRows}</div>`;
        importPreview.hidden = false;
      }
      if (btnImportJson) btnImportJson.disabled = false;
    } catch (e) {
      if (importErr) { importErr.textContent = e?.message || MSG.importInvalidJson(); importErr.hidden = false; }
    }
  });

  btnImportJson?.addEventListener("click", async () => {
    if (importCompleted) { closeImportModal(); return; }
    if (btnImportJson?.disabled || !importParsed) return;
    const obj = importParsed;
    const qCount = Array.isArray(obj?.questions) ? obj.questions.length : 0;

    setImportMsg("");
    showProgBlock(importProg, true);
    setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
      step: MSG.importStart(), i: 0, n: qCount, msg: "",
    });
    if (btnImportJson) btnImportJson.disabled = true;
    if (btnCancelImport) btnCancelImport.disabled = true;
    if (btnImportCancelAction) btnImportCancelAction.disabled = true;
    if (importFile) importFile.disabled = true;

    try {
      const newId = await importGame(obj, currentUser.id, ({ step, i, n, msg, isError } = {}) => {
        setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, { step: step || MSG.importSave(), i, n, msg, isError });
      });
      setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
        step: MSG.importDone(), done: true, i: qCount, n: qCount, msg: "",
      });
      selectedId = newId;
      try { const ng = await loadGameBasic(newId); if (ng?.type) setActiveTab(uiTypeFromRow(ng)); } catch {}
      await refresh();
      importCompleted = true;
      if (btnImportJson) {
        btnImportJson.setAttribute("data-i18n", "games.import.done");
        btnImportJson.setAttribute("data-i18n-icon", "check");
        btnImportJson.innerHTML = iconText("check", t("games.import.done"));
      }
      if (btnImportCancelAction) btnImportCancelAction.hidden = true;
    } catch (e) {
      console.error("IMPORT ERROR:", e);
      setProgUi(importProgStep, importProgCount, importProgBar, importProgMsg, {
        step: MSG.importErrorLabel(), i: 0, n: qCount, msg: e?.message || MSG.importFailed(), isError: true,
      });
      setImportMsg(MSG.importDbFailed());
    } finally {
      showProgBlock(importProg, importCompleted);
      if (btnImportJson) btnImportJson.disabled = !importParsed;
      if (btnCancelImport) btnCancelImport.disabled = false;
      if (btnImportCancelAction) btnImportCancelAction.disabled = false;
      if (importFile) importFile.disabled = false;
    }
  });

  // Stan zakładki jest częścią adresu, dzięki czemu link można odświeżyć
  // i udostępnić bez utraty kontekstu.
  setActiveTab(gameTabFromUrl(), { updateUrl: false });

  try {
    await refresh();
  } catch (e) {
    // Bez tego nieudane pierwsze ładowanie zostawiało samą kartę "+" bez
    // słowa wyjaśnienia (jakby użytkownik nie miał żadnych gier).
    console.error("[games] initial load failed:", e);
    setHint(t("games.alert.loadFailed"));
  } finally {
    // Nie pokazuj listy jako pustej przed pierwszą odpowiedzią; nawet przy
    // błędzie odsłoń komunikat zamiast pozostawić niewidoczną sekcję.
    document.querySelector(".games-shell")?.classList.add("skel-step-ready");
  }

  // Treść kafelków (typ, status, "Nowa gra", podpowiedź) jest składana w JS,
  // więc applyTranslations() jej nie obejmuje -- po zmianie języka rysujemy
  // ją od nowa (bez tego zostawała w starym języku do auto-odświeżenia).
  window.addEventListener("i18n:lang", () => {
    render();
    void updateActionState();
  });

  // File Handlers API – otwórz modal importu gdy plik został przekazany przez system
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files?.length) return;
      const file = await launchParams.files[0].getFile();
      // Wstaw plik do inputu i otwórz modal
      const dt = new DataTransfer();
      dt.items.add(file);
      if (importFile) {
        importFile.files = dt.files;
        importFile.dispatchEvent(new Event("change"));
      }
      openImportModal();
    });
  }

  // auto refresh
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoRefresh();
    else startAutoRefresh();
  });
  startAutoRefresh();
  document.documentElement.classList.remove('page-loading');
});
