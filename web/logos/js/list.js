import { bindResourceDuplicate } from "../../shared/js/core/resource-duplicate.js?v=v2026-11-05T10353";
import { bindResourceSend } from "../../shared/js/core/resource-send.js?v=v2026-11-05T10353";
import { loadResourceCopyOffers, decideResourceCopy } from "../../shared/js/core/resource-copy-inbox.js?v=v2026-11-05T10353";
import { tileTagsHtml, proposedTags, proposedActionsHtml, bindProposedActions } from "../../shared/js/core/proposed-tile.js?v=v2026-11-05T10353";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-05T10353";
// familiada/logos/js/list.js
// Lista logo (/logos/): kafelki w trzech kartach, modale (nowe / nazwa /
// import / podgląd), eksport. Edycja to osobne strony /logos/editor/<tryb>/
// (editor-page.js) -- „Nowe logo” od razu zakłada wiersz w bazie i otwiera
// edytor z jego id w adresie.
//
// Moduły:
//   render.js       – format bitów i podgląd „jak na wyświetlaczu”
//   db.js           – tabela user_logos + pliki w Storage
//   transfer.js     – eksport/import .famlogo
//   core/pinch-zoom.js – wspólny pinch-zoom pełnoekranowego podglądu
//   routes.js       – adresy listy i edytorów

import { addRenameGesture } from "../../shared/js/core/rename-gesture.js?v=v2026-11-05T10353";
import { loadFont5x7, buildLogoPreviewCanvas } from "../../shared/js/core/logo-preview.js?v=v2026-11-05T10353";
import { alertModal, confirmModal, promptModal, progressModal } from "../../shared/js/core/modal.js?v=v2026-11-05T10353";
import { toast } from "../../shared/js/core/toast.js?v=v2026-11-05T10353";
import { initI18n, t } from "../../shared/translation/translation.js?v=v2026-11-05T10353";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-05T10353";
import { PAGES } from "../../shared/js/core/nav-map.js?v=v2026-11-05T10353";
import { tabFromUrl, setTab, markActiveTab } from "../../shared/js/core/tabs.js?v=v2026-11-05T10353";
import { isMobileDevice } from "../../shared/js/core/pwa.js?v=v2026-11-05T10353";
import { getDeviceProfile } from "../../shared/js/core/device-guard.js?v=v2026-11-05T10353";
import { v as cacheBust } from "../../shared/js/core/cache-bust.js?v=v2026-11-05T10353";
import { isResourceBusy, acquireResourceLock } from "../../shared/js/core/resource-lock.js?v=v2026-11-05T10353";
import { openDialog, closeDialog } from "../../shared/js/core/modal-sheet.js?v=v2026-11-05T10353";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-05T10353";
import { initListHeaderLayout } from "../../shared/js/core/list-header-layout.js?v=v2026-11-05T10353";
import { LOGO_NAME_MAX } from "./package.js?v=v2026-11-05T10353";

import { TYPE_GLYPH, TYPE_PIX, PIX_FORMAT, DOT_W, DOT_H, emptyRows, packBits, renderPreview, logoToPreview } from "./render.js?v=v2026-11-05T10353";
import { listLogos, fetchLogo, createLogo, updateLogo, deleteLogo, isUniqueViolation, uploadImportedLogoImage, removeLogoImageUrl } from "./db.js?v=v2026-11-05T10353";
import { buildExport, downloadJson, parseImport, safeFileName } from "./transfer.js?v=v2026-11-05T10353";
import { initPinchZoom, lockPageZoomForPreview, unlockPageZoomAfterPreview } from "../../shared/js/core/pinch-zoom.js?v=v2026-11-05T10353";
import { cannotEditReason } from "./text.js?v=v2026-11-05T10353";
import { editModeFor, editorUrl } from "./routes.js?v=v2026-11-05T10353";
import { initListSearch } from "../../shared/js/core/list-search.js?v=v2026-11-05T10353";
import { bindLocalizedFilePicker } from "../../shared/js/core/file-picker.js?v=v2026-11-05T10353";
import { setProgress } from "../../shared/js/core/ui-metrics.js?v=v2026-11-05T10353";

const FONT_3x10_URL = "/shared/fonts/display/font_3x10.json?v=v2026-11-05T10353";
const FONT_5x7_URL = "/shared/fonts/display/font_5x7.json?v=v2026-11-05T10353";
// Edycja wymaga miejsca na pasek narzędzi i scenę -- na telefonie dostępna
// jest tylko lista (podgląd, import/eksport, nazwa, usuwanie); „Edytuj”
// i „Nowe logo” są ukryte (.le-phone). Telefon wg wspólnej reguły
// isPhoneScreen() (js/core/device-guard.js): krótszy bok ekranu, więc
// tablet edytuje w poziomie i w pionie, a telefon w żadnej orientacji.

/* =========================================================
   DOM
========================================================= */
const $ = (id) => document.getElementById(id);
const el = {
  btnBack: $("btnBack"),

  listShell: $("listShell"),
  grid: $("grid"),
  hint: $("hint"),
  btnEdit: $("btnEdit"),
  btnPreview: $("btnPreview"),
  btnDuplicate: $("btnDuplicate"),
  btnSendCopy: $("btnSendCopy"),
  btnExport: $("btnExport"),
  btnImport: $("btnImport"),
  tabs: { TEXT: $("tabLogoText"), DRAW: $("tabLogoDraw"), IMAGE: $("tabLogoImage") },

  importOverlay: $("logoImportOverlay"),
  importFile: $("inpImportLogoFile"),
  importChoose: $("btnImportLogoChoose"),
  importFileName: $("logoImportFileName"),
  importPreviewWrap: $("logoImportPreviewWrap"),
  importPreviewCanvas: $("logoImportPreviewCanvas"),
  importErr: $("logoImportErr"),
  importProg: $("logoImportProg"),
  importStep: $("logoImportStep"),
  importBar: $("logoImportBar"),
  btnImportConfirm: $("btnLogoImportConfirm"),
  btnImportCancel: $("btnLogoImportCancel"),
  btnImportCancelAction: $("btnLogoImportCancelAction"),
  btnImportDone: $("btnLogoImportDone"),

  previewOverlay: $("previewOverlay"),
  previewCanvas: $("bigPreviewFull"),
};
const importFilePicker = bindLocalizedFilePicker({
  input: el.importFile,
  button: el.importChoose,
  fileName: el.importFileName,
  t,
});

/* =========================================================
   STAN
========================================================= */
let currentUser = null;
let logos = [];          // lekka lista (bez fabricData/obrazów) -- patrz db.listLogos
let copyOffers = new Map(); // otrzymane kopie czekające na decyzję: id logo → oferta
let selectedId = null;
let activeListMode = "TEXT";

let FONT_3x10 = null;    // znak -> [10 wierszy]
let GLYPH_5x7 = null;    // Map znak -> [7 intów]

/* =========================================================
   Drobne pomocnicze
========================================================= */
function show(node, on) {
  if (!node) return;
  node.hidden = !on;
  node.style.removeProperty("display");
}

const isCompactViewport = () => getDeviceProfile().viewportWidth < 700;
const refreshViewportClass = () => document.documentElement.classList.toggle("le-compact", isCompactViewport());
refreshViewportClass();
window.addEventListener("resize", refreshViewportClass, { passive: true });
window.addEventListener("orientationchange", refreshViewportClass, { passive: true });
const defaultName = () => t("logoEditor.defaults.logoName");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

/** Nazwa niekolidująca (bez względu na wielkość liter) z innymi logo użytkownika. */
function makeUniqueName(baseName, excludeId = null) {
  const base = (String(baseName || "").trim() || defaultName()).slice(0, LOGO_NAME_MAX);
  const used = new Set(logos.filter((l) => l.id !== excludeId).map((l) => String(l.name || "").trim().toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  // Dopisek „ (n)” mieści się w limicie nazwy -- skracamy podstawę.
  const withSuffix = (suffix) => `${base.slice(0, LOGO_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
  for (let i = 2; i < 10000; i++) {
    const cand = withSuffix(` (${i})`);
    if (!used.has(cand.toLowerCase())) return cand;
  }
  return withSuffix(` (${Date.now()})`);
}

/** Komunikat dla odmowy z RPC *_checked -- tylko POWÓD, nigdy która to strona. */
function busyMessage(reason) {
  if (reason === "control") return t("resourceLock.logoPoolBusyControl");
  if (reason === "settings") return t("resourceLock.logoPoolBusySettings");
  if (reason === "logo") return t("resourceLock.logoMessage");
  return t("resourceLock.logoPoolBusy");
}

/** Komunikat dla odmowy zajęcia logo:L (odpowiedź acquire_edit_lock_mode). */
function lockBusyMessage(res) {
  if (res?.error === "gone") return t("resourceLock.goneMessage");
  if (res?.blocker_type === "logos") return busyMessage(res.blocker_context);
  return t("resourceLock.logoMessage");
}

function modeLabel(mode) {
  return t(`logoEditor.modes.${String(mode || "image").toLowerCase()}`);
}

// Karty z mapy stron (nazwy małymi literami w adresie, tryby wielkimi w kodzie).
const LOGO_TABS = PAGES.logoEditor.tabs;
const DEFAULT_LOGO_TAB = LOGO_TABS[0];

function listModeFromUrl() {
  return tabFromUrl(LOGO_TABS, DEFAULT_LOGO_TAB).toUpperCase();
}

function listModeForLogo(logo) {
  if (logo?.type === TYPE_GLYPH) return "TEXT";
  if (logo?.type === TYPE_PIX && logo?.payload?.source?.mode === "IMAGE") return "IMAGE";
  return "DRAW";
}

function setActiveListMode(mode, { updateUrl = true } = {}) {
  activeListMode = String(mode || "").toUpperCase();
  markActiveTab(Object.values(el.tabs), el.tabs[activeListMode]);
  const selected = logos.find((logo) => logo.id === selectedId);
  if (selected && listModeForLogo(selected) !== activeListMode) selectedId = null;
  if (updateUrl) {
    setTab(activeListMode.toLowerCase(), DEFAULT_LOGO_TAB);
  }
  renderList();
}

/* =========================================================
   Modale (overlay + tryb „sheet” na telefonie)
========================================================= */
const openOverlay = (overlay, onClose) => openDialog(overlay, { onClose });
const closeOverlay = closeDialog;

/* =========================================================
   Podgląd
========================================================= */
let previewZoom = null;

function openPreview(preview) {
  renderPreview(preview, el.previewCanvas, GLYPH_5x7);
  // Tablety z Chrome przedstawiają się jak desktop -- sprawdzamy też dotyk.
  const touch = isMobileDevice() || navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
  el.previewOverlay.querySelector(".modal")?.classList.toggle("is-touch", !!touch);
  previewZoom ??= initPinchZoom(el.previewOverlay.querySelector(".previewModalCanvas"), el.previewCanvas);
  previewZoom.reset();
  lockPageZoomForPreview();
  openOverlay(el.previewOverlay, closePreview);
}

function closePreview() {
  closeOverlay(el.previewOverlay);
  unlockPageZoomAfterPreview();
  previewZoom?.reset();
}

/* =========================================================
   Lista kafelków
========================================================= */
async function refresh() {
  [logos, copyOffers] = await Promise.all([listLogos(), loadResourceCopyOffers("logo")]);
  if (selectedId && !logos.some((l) => l.id === selectedId)) selectedId = null;
  renderList();
}

function selectTile(id) {
  selectedId = id;
  for (const tile of el.grid.querySelectorAll(".logoTile")) {
    tile.classList.toggle("is-selected", tile.dataset.key === String(id || ""));
  }
  updateListButtons();
}

el.grid?.addEventListener("click", (event) => {
  if (event.target === el.grid) selectTile(null);
});
el.grid?.closest(".logoCard")?.addEventListener("click", (event) => {
  if (event.target === event.currentTarget) selectTile(null);
});

function updateListButtons() {
  const has = !!selectedId;
  const guest = isGuestUser(currentUser);
  // Kopia czekająca na decyzję: tylko podgląd; resztę odblokowuje przyjęcie (✓ na kafelku).
  const proposed = has && copyOffers.has(selectedId);
  el.btnPreview.disabled = !has;
  el.btnEdit.disabled = !has || proposed;
  el.btnExport.disabled = !has || proposed;
  // Gość może powielać własne logo; wysyłać kopii nie może (decyzja 2026-10-22).
  el.btnDuplicate.disabled = !!el.btnDuplicate.dataset.duplicateBusy || !has || proposed;
  el.btnSendCopy.hidden = guest;
  el.btnSendCopy.disabled = !!el.btnSendCopy.dataset.sendBusy || !has || proposed || guest;
}

// Otrzymana kopia czekająca na decyzję: kafel propozycji jak zaproszenie do
// bazy (proposed-tile.js) — podgląd jak w innych kaflach, ✓/✕ zamiast kosza,
// „Propozycja” + „Od: X” pod nazwą na całą szerokość (ta sama wysokość kafla).
function makeProposedTile(logo, offer) {
  const name = logo.name || offer.name || t("logoEditor.defaults.unnamed");
  const tile = document.createElement("div");
  tile.className = "logoTile";
  tile.dataset.key = logo.id;
  tile.dataset.proposed = "1";
  tile.classList.toggle("is-selected", logo.id === selectedId);
  tile.innerHTML = `
    <div class="logoTileTop">
      <div>
        <div class="logoName" title="${esc(name)}">${esc(name)}</div>
      </div>
      <div class="cluster logoActions">${proposedActionsHtml()}</div>
      <div class="tileTags">${tileTagsHtml(proposedTags({ from: offer.sender_label, title: t("resourceSend.proposedTitle") }))}</div>
    </div>
    <div class="logoPrev"></div>`;
  tile.addEventListener("click", () => selectTile(logo.id));
  bindProposedActions(tile, {
    accept: () => decideResourceCopy(offer.id, "accept"),
    decline: () => decideResourceCopy(offer.id, "decline"),
    onFail: () => alertModal({ text: t("resourceSend.errors.decisionFailed") }),
    onDone: refresh,
  });
  return tile;
}

function makeTile(logo) {
  const offer = copyOffers.get(logo.id);
  if (offer) return makeProposedTile(logo, offer);
  const name = logo.name || t("logoEditor.defaults.unnamed");
  const tile = document.createElement("div");
  tile.className = "logoTile";
  tile.dataset.key = logo.id;
  tile.classList.toggle("is-selected", logo.id === selectedId);
  tile.innerHTML = `
    <div class="logoTileTop">
      <div>
        <div class="logoName" title="${esc(name)}">${esc(name)}</div>
        ${logo.received_from_label ? `<div class="logoMeta">${esc(t("resourceSend.from", { name: logo.received_from_label }))}</div>` : ""}
      </div>
      <div class="cluster logoActions">
        <button class="x" type="button" title="${esc(t("logoEditor.list.delete"))}" aria-label="${esc(t("logoEditor.list.delete"))}">${icon("trash")}</button>
      </div>
    </div>
    <div class="logoPrev"></div>`;

  tile.addEventListener("click", () => selectTile(logo.id));
  addRenameGesture(tile, (e) => {
    if (!e.target?.closest(".logoActions")) openRenameModal(logo);
  });
  tile.querySelector(".x").addEventListener("click", (ev) => {
    ev.stopPropagation();
    void removeLogo(logo, name);
  });
  return tile;
}

function renderList() {
  el.grid.innerHTML = "";

  const add = document.createElement("div");
  add.className = "addCard le-edit-only";
  const createTitleKey = {
    TEXT: "textCreateTitle",
    DRAW: "drawCreateTitle",
    IMAGE: "imageCreateTitle",
  }[activeListMode];
  const createSubtitleKey = {
    TEXT: "textSubtitle",
    DRAW: "drawSubtitle",
    IMAGE: "imageSubtitle",
  }[activeListMode];
  add.innerHTML = `
    <div class="plus">${icon("plus")}</div>
    <div class="txt">${esc(t(`logoEditor.create.${createTitleKey}`))}</div>
    <div class="sub">${esc(t(`logoEditor.create.${createSubtitleKey}`))}</div>`;
  add.addEventListener("click", () => openNameModal({ kind: "create", mode: activeListMode }));
  el.grid.appendChild(add);

  // Telefon: kafelka tworzenia nie ma (edytory tylko komputer/tablet), więc
  // pusta lista dostaje zwykły pusty stan z informacją, gdzie utworzyć logo.
  if (!logos.some((item) => listModeForLogo(item) === activeListMode)) {
    const empty = document.createElement("div");
    empty.className = "empty-state empty-state--tile le-compact-only";
    empty.textContent = t("logoEditor.list.emptyPhone");
    el.grid.appendChild(empty);
  }

  // Najpierw same kafelki, miniatury po kolei w wolnych chwilach -- przy
  // wielu logo nie blokujemy pierwszego wyrenderowania listy.
  const queue = [];
  for (const logo of logos.filter((item) => listModeForLogo(item) === activeListMode)) {
    const tile = makeTile(logo);
    el.grid.appendChild(tile);
    queue.push({ wrap: tile.querySelector(".logoPrev"), logo });
  }
  // Propozycje (otrzymane kopie) zaraz po kaflu tworzenia, przed resztą.
  add.after(...el.grid.querySelectorAll(':scope > .logoTile[data-proposed="1"]'));
  const idle = window.requestIdleCallback || ((cb) => setTimeout(cb, 0));
  const next = () => {
    const item = queue.shift();
    if (!item) return;
    if (item.wrap.isConnected) item.wrap.appendChild(buildLogoPreviewCanvas(item.logo, GLYPH_5x7, 520, 240));
    idle(next);
  };
  idle(next);

  updateListButtons();
}

async function removeLogo(logo, name) {
  if (!(await confirmModal({ text: t("logoEditor.confirm.deleteLogo", { name }) }))) return;
  try {
    await deleteLogo(logo.id);
    await refresh();
  } catch (e) {
    console.error(e);
    void alertModal({
      text: e?.code === "RESOURCE_IN_USE" ? busyMessage(e.reason) : t("logoEditor.errors.deleteFailed", { error: e?.message || e }),
    });
  }
}

/* =========================================================
   Modal nazwy: zmiana nazwy istniejącego / nazwa nowego logo
========================================================= */
// Okno nazwy -- wspólne promptModal (modal.js).
// state: { kind:"rename", logo, lease } | { kind:"create", mode }
async function openNameModal(state) {
  const creating = state.kind === "create";
  try {
    await promptModal({
      title: t(creating ? "logoEditor.create.nameModalTitle" : "logoEditor.rename.title"),
      text: t(creating ? "logoEditor.create.nameModalSub" : "logoEditor.rename.sub"),
      okText: t("logoEditor.common.save"),
      cancelText: t("logoEditor.common.cancel"),
      value: creating ? makeUniqueName(modeLabel(state.mode)) : state.logo.name || "",
      placeholder: t("logoEditor.rename.placeholder"),
      maxLength: 80,
      selectAll: true,
      validate: (v) => (String(v).trim() ? null : t("logoEditor.rename.emptyError")),
      onSubmit: (v) => (creating ? createAndOpen(state.mode, String(v).trim()) : renameLogo(state, String(v).trim())),
    });
  } finally {
    state.lease?.release?.();
  }
}

// Okno zmiany nazwy trzyma logo:L wyłącznie do zamknięcia okna (familijna-server/docs/blokady-
// zasobow.md, sekcja 6) -- w tym czasie nikt nie wejdzie w edycję tego logo,
// a trzymana pula logo (Control / ustawienia gry) nie pozwoli otworzyć okna.
async function openRenameModal(logo) {
  let lease;
  try {
    lease = await acquireResourceLock({ resourceType: "logo", resourceId: logo.id, context: "logo-list" });
  } catch (e) {
    console.error(e);
    void alertModal({ text: t("logoEditor.rename.failed") });
    return;
  }
  if (!lease?.ok) {
    void alertModal({ text: lockBusyMessage(lease) });
    return;
  }
  void openNameModal({ kind: "rename", logo, lease });
}

/** Zapis nowej nazwy; zwraca tekst błędu (okno zostaje) albo nic. */
async function renameLogo({ logo, lease }, name) {
  // Blokada logo:L z otwarcia okna mogła zginąć (uśpiona karta) -- wtedy
  // zapis stąd nadpisałby cudzą edycję. RPC i tak odmówi, ale mówimy wprost.
  if (lease && !lease.ok) return t("resourceLock.lostMessage");
  try {
    if (name !== logo.name) await updateLogo(logo.id, { name: makeUniqueName(name, logo.id) });
    await refresh();
  } catch (e) {
    console.error(e);
    return e?.code === "RESOURCE_IN_USE" ? busyMessage(e.reason) : t("logoEditor.rename.failed");
  }
}

/* =========================================================
   Edycja: osobne strony /logos/editor/<tryb>/?id=
========================================================= */
/** Pusty payload nowego logo danego trybu -- wiersz powstaje od razu, żeby
 *  edytor miał id w adresie od pierwszej chwili. */
function emptyPayload(mode) {
  if (mode === "TEXT") {
    return { type: TYPE_GLYPH, payload: { layers: [{ color: "main", rows: emptyRows() }], source: { mode: "TEXT", text: "" } } };
  }
  return {
    type: TYPE_PIX,
    payload: { w: DOT_W, h: DOT_H, format: PIX_FORMAT, bits_b64: packBits(new Uint8Array(DOT_W * DOT_H)), source: { mode } },
  };
}

/** Tworzy logo i przechodzi do edytora; zwraca tekst błędu (okno zostaje). */
async function createAndOpen(mode, name) {
  try {
    // Pula logo trzymana (Control / ustawienia gry) -- edytor i tak by nic nie zapisał.
    if (await isResourceBusy("logos", currentUser.id).catch(() => false)) {
      return t("resourceLock.logoPoolBusy");
    }
    let finalName = makeUniqueName(name);
    let id;
    for (let attempt = 0; ; attempt++) {
      try {
        id = await createLogo({ user_id: currentUser.id, name: finalName, ...emptyPayload(mode) });
        break;
      } catch (e) {
        // Nazwa zajęta przez logo spoza lokalnej listy (np. z innej karty).
        if (!isUniqueViolation(e) || attempt > 0) throw e;
        logos = await listLogos();
        finalName = makeUniqueName(name);
      }
    }
    location.href = editorUrl(mode, id);
    return false; // okno zostaje do przejścia na stronę edytora
  } catch (e) {
    console.error(e);
    return t("logoEditor.errors.saveFailed");
  }
}

async function editSelected() {
  if (!selectedId || isCompactViewport()) return;
  let logo;
  try {
    logo = await fetchLogo(selectedId);
  } catch (e) {
    console.error(e);
    void alertModal({ text: t("logoEditor.errors.loadFailed", { error: e?.message || e }) });
    return;
  }
  const mode = editModeFor(logo);
  const reason = cannotEditReason(logo, mode, FONT_3x10);
  if (reason) {
    void alertModal({ text: reason });
    return;
  }
  location.href = editorUrl(mode, logo.id);
}

/* =========================================================
   Import / eksport
========================================================= */
let importParsed = null;

function resetImportModal() {
  importParsed = null;
  show(el.importPreviewWrap, false);
  show(el.importErr, false);
  el.importErr.classList.replace("msg", "field-error");
  el.importErr.setAttribute("role", "alert");
  show(el.importProg, false);
  el.importErr.textContent = "";
  el.btnImportConfirm.disabled = true;
  el.btnImportConfirm.hidden = false;
  el.btnImportDone.hidden = true;
  el.btnImportCancelAction.hidden = false;
  if (el.importFileName) el.importFileName.textContent = el.importFile?.files?.[0]?.name || t("common.filePicker.none");
}

function updateImportFileName() {
  if (!el.importFileName) return;
  el.importFileName.textContent = el.importFile?.files?.[0]?.name || t("common.filePicker.none");
}

function openImportModal() {
  resetImportModal();
  importFilePicker.reset();
  openOverlay(el.importOverlay, () => closeOverlay(el.importOverlay));
}

async function onImportFileChosen() {
  resetImportModal();
  const file = el.importFile.files?.[0];
  updateImportFileName();
  if (!file) return;
  try {
    importParsed = parseImport(await file.text(), defaultName());
    const w = Math.round(Math.min(600, window.innerWidth * 0.82));
    el.importPreviewCanvas.width = w;
    el.importPreviewCanvas.height = Math.round((w * 11) / 26);
    renderPreview(logoToPreview(importParsed), el.importPreviewCanvas, GLYPH_5x7);
    show(el.importPreviewWrap, true);
    el.btnImportConfirm.disabled = false;
  } catch (e) {
    el.importErr.textContent = e?.message || t("logoEditor.errors.invalidJson");
    show(el.importErr, true);
  }
}

async function confirmImport() {
  if (!importParsed || el.btnImportConfirm.disabled) return;
  el.btnImportConfirm.disabled = true;
  el.btnImportCancel.disabled = true;
  el.btnImportCancelAction.disabled = true;
  el.importStep.textContent = t("logoEditor.import.steps.saveDb");
  setProgress(el.importBar, 60);
  show(el.importProg, true);
  let uploadedImageUrl = null;
  try {
    let imported = { ...importParsed, payload: { ...importParsed.payload } };
    const source = imported.payload.source || {};
    if (source.mode === "IMAGE" && source.imageData) {
      el.importStep.textContent = t("logoEditor.import.steps.uploadImage");
      setProgress(el.importBar, 35);
      uploadedImageUrl = await uploadImportedLogoImage(source.imageData, currentUser.id);
      const { imageData, ...sourceWithoutData } = source;
      imported.payload.source = { ...sourceWithoutData, imageUrl: uploadedImageUrl };
    }
    el.importStep.textContent = t("logoEditor.import.steps.saveDb");
    setProgress(el.importBar, 70);
    let id;
    try {
      id = await createLogo({ user_id: currentUser.id, ...imported, name: makeUniqueName(imported.name) });
    } catch (e) {
      if (uploadedImageUrl) await removeLogoImageUrl(uploadedImageUrl, currentUser.id);
      uploadedImageUrl = null;
      throw e;
    }
    uploadedImageUrl = null;
    setActiveListMode(listModeForLogo(importParsed));
    await refresh();
    selectTile(id);
    show(el.importProg, false);
    // Sukces w tym samym miejscu co błąd, ale jako komunikat .msg (nie .field-error).
    el.importErr.classList.replace("field-error", "msg");
    el.importErr.setAttribute("role", "status");
    el.importErr.textContent = t("logoEditor.status.imported");
    show(el.importErr, true);
    el.btnImportConfirm.hidden = true;
    el.btnImportDone.hidden = false;
    el.btnImportCancelAction.hidden = true;
  } catch (e) {
    console.error(e);
    if (uploadedImageUrl) await removeLogoImageUrl(uploadedImageUrl, currentUser.id);
    el.importErr.textContent = t("logoEditor.errors.importFailedDetailed", { error: e?.message || e });
    show(el.importErr, true);
    show(el.importProg, false);
    el.btnImportConfirm.disabled = false;
  } finally {
    el.btnImportCancel.disabled = false;
    el.btnImportCancelAction.disabled = false;
  }
}

async function exportSelected() {
  if (!selectedId) return;
  const progress = progressModal({ title: t("logoEditor.export.title"), text: t("logoEditor.export.subtitle"), doneText: t("logoEditor.export.close") });
  progress.setPercent(30);
  try {
    const logo = await fetchLogo(selectedId);
    const fileName = `${safeFileName(logo.name, t("logoEditor.defaults.logoFileName"))}.famlogo`;
    const out = await buildExport(logo, defaultName());
    progress.setPercent(100);
    downloadJson(out, fileName);
    progress.setMessage(t("logoEditor.export.success"));
  } catch (e) {
    console.error(e);
    progress.setMessage(t("logoEditor.errors.exportFailedDetailed", { error: e?.message || e }), "error");
    progress.setPercent(100, { isError: true });
  } finally {
    progress.allowClose();
  }
}

/* =========================================================
   START
========================================================= */
async function loadFonts() {
  const r = await fetch(await cacheBust(FONT_3x10_URL), { cache: "no-store" });
  if (!r.ok) throw new Error(`Font 3x10: HTTP ${r.status}`);
  FONT_3x10 = await r.json();
  GLYPH_5x7 = await loadFont5x7(await cacheBust(FONT_5x7_URL));
}

function bindUi() {
  el.btnImportDone.addEventListener("click", () => closeOverlay(el.importOverlay));
  bindResourceDuplicate({button:el.btnDuplicate,kind:"logo",getSource:()=>logos.find(l=>l.id===selectedId),onDone:async id=>{await refresh();const logo=logos.find(l=>l.id===id);if(logo)setActiveListMode(listModeForLogo(logo));selectTile(id);},onState:updateListButtons});
  bindResourceSend({button:el.btnSendCopy,kind:"logo",getSource:()=>logos.find(l=>l.id===selectedId),onDone:async()=>refresh(),onState:updateListButtons});
  // lista
  el.btnEdit.addEventListener("click", () => void editSelected());
  el.btnPreview.addEventListener("click", () => {
    const logo = logos.find((l) => l.id === selectedId);
    if (logo) openPreview(logoToPreview(logo));
  });
  el.btnExport.addEventListener("click", () => void exportSelected());
  el.btnImport.addEventListener("click", openImportModal);

  for (const [mode, tab] of Object.entries(el.tabs)) {
    tab?.addEventListener("click", () => setActiveListMode(mode));
  }

  // import
  el.importFile.addEventListener("change", () => void onImportFileChosen());
  el.btnImportConfirm.addEventListener("click", () => void confirmImport());
  el.btnImportCancel.addEventListener("click", () => closeOverlay(el.importOverlay));
  el.btnImportCancelAction.addEventListener("click", () => closeOverlay(el.importOverlay));

  // podgląd
  $("btnPreviewClose").addEventListener("click", closePreview);

  window.addEventListener("i18n:lang", () => {
    if (!el.importFile?.files?.length) updateImportFileName();
    setActiveListMode(activeListMode, { updateUrl: false });
  });

  // Plik .famlogo otwarty z systemu (PWA file handler).
  if ("launchQueue" in window) {
    window.launchQueue.setConsumer(async (params) => {
      if (!params.files?.length) return;
      const dt = new DataTransfer();
      dt.items.add(await params.files[0].getFile());
      openImportModal();
      el.importFile.files = dt.files;
      await onImportFileChosen();
    });
  }
}

async function boot() {
  const i18nP = initI18n({ withSwitcher: true });
  const userP = initPage("logoEditor", { ready: i18nP }); // auth startuje równolegle z i18n
  await i18nP;
  document.documentElement.classList.remove("page-loading");
  initListHeaderLayout();
  initListSearch({ grids: "#grid", tile: ".logoTile", name: ".logoName" });

  currentUser = await userP;
  if (!currentUser) return; // initPage przekierował na logowanie
  // Ustaw właściwą podpowiedź od razu po auth; ładowanie fontów nie powinno
  // zostawiać pustego nagłówka ani pokazywać tekstu z innego trybu.
  setActiveListMode(listModeFromUrl(), { updateUrl: false });

  try {
    await loadFonts();
  } catch (e) {
    console.error(e);
    void alertModal({ text: t("logoEditor.errors.fontsLoad") });
  }

  bindUi();
  try {
    await refresh();
  } catch (e) {
    console.error("[logo] initial list load failed:", e);
    toast(t("logoEditor.errors.loadFailed", { error: String(e?.message || "") }), { kind: "error" });
  } finally {
    // Odsłoń pusty/wczytany stan listy; błąd ładowania jest przekazany toastem.
    document.querySelector(".logoShell")?.classList.add("skel-step-ready");
  }
}

boot();
