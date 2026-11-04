// familiada/logos/js/editor-page.js
// Wspólna logika trzech stron edytora logo (/logos/editor/<tryb>/?id=).
// Strona ma jeden tryb i jedno logo (id w adresie). Zmiany zapisują się
// SAME: bez przycisku „Zapisz”, bez pytań przy wyjściu -- do pracy można
// wrócić w każdej chwili, także po zamknięciu karty.
//
// Autozapis: każda zmiana -> zapis po krótkiej przerwie (DEBOUNCE_MS);
// czynność w toku (pisanie napisu na scenie, przeciągany kształt, wczytywany
// obraz) -> editor.isInteracting() i zapis czeka. Wyjście („Wstecz”, „?”,
// schowanie karty) -> zapis od razu. Bez informacji o zapisie na stronie.
//
// Blokady zasobów (resource-lock.js), jak przy edycji gry:
//   - to logo w innej karcie -> guardResourceLock: komunikat, wejście samo,
//     gdy tamta karta je zwolni; nasza blokada trzymana do wyjścia ze strony
//     (pagehide), więc Control/ustawienia gry czekają, aż edytor się zamknie,
//   - cała pula logo zajęta (zasób `logos` trzymany współdzielenie przez Control
//     albo ustawienia którejś gry) wyklucza logo:L w bazie -- przy wejściu to
//     samo guardResourceLock, przy każdym zapisie RPC update_logo_checked:
//     komunikat z powrotem na listę.

import { loadFont5x7 } from "../../shared/js/core/logo-preview.js?v=v2026-11-04T00065";
import { initI18n, t } from "../../shared/translation/translation.js?v=v2026-11-04T00065";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-04T00065";
import { isMobileDevice } from "../../shared/js/core/pwa.js?v=v2026-11-04T00065";
import { isPhoneScreen } from "../../shared/js/core/device-guard.js?v=v2026-11-04T00065";
import { v as cacheBust } from "../../shared/js/core/cache-bust.js?v=v2026-11-04T00065";
import { guardResourceLock, showBlockingOverlay } from "../../shared/js/core/resource-lock.js?v=v2026-11-04T00065";
import { openDialog, closeDialog, isOverlayOpen } from "../../shared/js/core/modal-sheet.js?v=v2026-11-04T00065";

import { renderPreview } from "./render.js?v=v2026-11-04T00065";
import { listLogos, fetchLogo, updateLogo, isUniqueViolation } from "./db.js?v=v2026-11-04T00065";
import { initPinchZoom, lockPageZoomForPreview, unlockPageZoomAfterPreview } from "../../shared/js/core/pinch-zoom.js?v=v2026-11-04T00065";
import { cannotEditReason } from "./text.js?v=v2026-11-04T00065";
import { EDITOR_PAGE_IDS, editModeFor, listBackUrl } from "./routes.js?v=v2026-11-04T00065";

const FONT_3x10_URL = "/shared/fonts/display/font_3x10.json?v=v2026-11-04T00065";
const FONT_5x7_URL = "/shared/fonts/display/font_5x7.json?v=v2026-11-04T00065";

const DEBOUNCE_MS = 700;
const RETRY_MS = 5000;

const $ = (id) => document.getElementById(id);

/**
 * @param {{ mode: "TEXT"|"DRAW"|"IMAGE", initEditor: (ctx) => object }} opts
 *   initEditor -- initTextEditor / initDrawEditor / initImageEditor
 *   (API: open / close / getCreatePayload / isInteracting? / onSaved?).
 */
export async function bootEditorPage({ mode, initEditor }) {
  const el = {
    btnBack: $("btnBack"),
    brandTitle: $("brandTitle"),
    logoName: $("logoName"),
    status: $("saveStatus"),
    bigPreview: $("bigPreview"),
    previewOverlay: $("previewOverlay"),
    previewCanvas: $("bigPreviewFull"),
  };

  let FONT_3x10 = null;
  let GLYPH_5x7 = null;
  let currentUser = null;
  let logoId = null;
  let logoRecord = null;
  let editor = null;
  let logos = [];          // lekka lista -- tylko do unikalnych nazw
  let logoLock = null;     // blokada logo:L (guardResourceLock)

  // Autozapis
  let ready = false;       // logo wczytane do edytora, zmiany się liczą
  let dirty = false;
  let changeSeq = 0;       // rośnie z każdą zmianą; zapis wie, czy w trakcie przyszło coś nowego
  let timer = null;
  let saving = null;       // Promise trwającego zapisu

  const modeLabel = () => t(`logoEditor.modes.${mode.toLowerCase()}`);
  const defaultName = () => t("logoEditor.defaults.logoName");

  /* ---------- stan zapisu ---------- */
  let statusState = "idle";

  function setStatus(state, text = "") {
    statusState = state;

    renderStatus();
  }
  // Bez żadnej informacji o zapisie na stronie (decyzja: familijna-server/docs/ujednolicenie-
  // wygladu.md, sekcja 4). Stan zostaje tylko jako data-state ukrytego
  // #saveStatus — punkt zaczepienia testów.
  function renderStatus() {
    if (el.status) el.status.dataset.state = statusState;
  }

  // Zapis odrzucony przez bazę (reason z db.js: logo | control | settings | …).
  function busyMessage(reason) {
    if (reason === "control") return t("resourceLock.logoPoolBusyControl");
    if (reason === "settings") return t("resourceLock.logoPoolBusySettings");
    if (reason === "logo") return t("resourceLock.logoMessage");
    return t("resourceLock.logoPoolBusy");
  }

  // Wejście: odpowiedź acquire_edit_lock_mode mówi, kto przeszkadza --
  // inna karta z tym logo albo pula logo (logos) trzymana przez Control / ustawienia.
  function entryBusyMessage(res) {
    if (res?.blocker_type !== "logos") return t("resourceLock.logoMessage");
    if (res.blocker_context === "control") return t("resourceLock.logoPoolBusyControlEntry");
    if (res.blocker_context === "settings") return t("resourceLock.logoPoolBusySettingsEntry");
    return t("resourceLock.logoPoolBusy");
  }

  /** Nazwa niekolidująca (bez względu na wielkość liter) z innymi logo użytkownika. */
  function makeUniqueName(baseName) {
    const base = String(baseName || "").trim() || defaultName();
    const used = new Set(logos.filter((l) => l.id !== logoId).map((l) => String(l.name || "").trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) return base;
    for (let i = 2; i < 10000; i++) {
      const cand = `${base} (${i})`;
      if (!used.has(cand.toLowerCase())) return cand;
    }
    return `${base} (${Date.now()})`;
  }

  /* ---------- autozapis ---------- */
  function markDirty() {
    if (!ready) return;
    dirty = true;
    changeSeq++;
    if (!saving) setStatus("dirty");
    schedule(DEBOUNCE_MS);
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void save(); }, ms);
  }

  /**
   * Zapisuje bieżący stan. force: przy wyjściu -- nie czeka na koniec
   * czynności w toku (getCreatePayload ją zakończy). Zwraca true, gdy po
   * zapisie nic nie zostało do zapisania.
   */
  async function save({ force = false } = {}) {
    if (!ready || !dirty) return true;
    if (saving) {
      await saving;
      return dirty ? save({ force }) : true;
    }
    if (!force && editor.isInteracting?.()) {
      schedule(DEBOUNCE_MS);
      return false;
    }
    clearTimeout(timer);
    timer = null;
    const seq = changeSeq;
    let ok = false;
    saving = (async () => {
      setStatus("saving");
      try {
        const res = await editor.getCreatePayload();
        if (!res?.ok) {
          // Stanu nie da się zapisać (np. niedozwolone znaki, brak obrazu):
          // logo w bazie zostaje poprzednie, zapis ruszy po następnej zmianie.
          setStatus("invalid", res?.msg || t("logoEditor.errors.saveFailed"));
          return;
        }
        const payload = res.payload;
        payload.source = { ...(payload.source || {}), mode };
        let name = makeUniqueName(el.logoName.value);
        for (let attempt = 0; ; attempt++) {
          try {
            await updateLogo(logoId, { name, type: res.type, payload });
            break;
          } catch (e) {
            // Nazwa zajęta przez logo spoza lokalnej listy (np. z innej karty).
            if (!isUniqueViolation(e) || attempt > 0) throw e;
            logos = await listLogos();
            const next = makeUniqueName(name);
            name = next !== name ? next : `${name} (${Date.now() % 100000})`;
          }
        }
        if (mode === "DRAW") logoRecord = { ...logoRecord, name, type: res.type, payload };
        if (el.logoName.value.trim() !== name && document.activeElement !== el.logoName) el.logoName.value = name;
        await editor.onSaved?.();
        if (changeSeq === seq) dirty = false;
        ok = true;
        setStatus(dirty ? "dirty" : "saved");
      } catch (e) {
        console.error("[logo/editor] autosave failed:", e);
        if (e?.code === "RESOURCE_IN_USE") {
          // Pula logo zajęła się w trakcie edycji (otwarty Control albo
          // ustawienia gry): baza odrzuca zapis, więc edycja się kończy --
          // ten sam pełnoekranowy komunikat co przy wejściu (jak editor.js
          // przy odrzuconym zapisie). W bazie zostaje ostatni zapisany stan.
          ready = false;
          clearTimeout(timer);
          setStatus("error", busyMessage(e.reason));
          block(busyMessage(e.reason));
          return;
        }
        setStatus("error", t("logoEditor.status.saveRetry"));
        schedule(RETRY_MS);
      }
    })();
    try {
      await saving;
    } finally {
      saving = null;
    }
    if (ok && dirty) schedule(DEBOUNCE_MS); // zmiany w trakcie zapisu
    return ok && !dirty;
  }

  /**
   * Wyjście ze strony: próba zapisu od razu, potem wyjście — bez komunikatów
   * (stanu nie do zapisania nie trzymamy; w bazie zostaje ostatni zapis).
   */
  async function go(href) {
    // Zwolnienie blokady PRZED nawigacją (patrz release() w resource-lock.js).
    await logoLock?.release?.().catch(() => {});
    location.href = href;
  }
  async function leave(href) {
    if (!ready) { await go(href); return; }
    await save({ force: true }).catch(() => {});
    ready = false;
    await go(href);
  }

  /* ---------- podgląd ---------- */
  let previewZoom = null;
  let latestPreview = null;
  function openPreview(preview) {
    if (!preview) return;
    renderPreview(preview, el.previewCanvas, GLYPH_5x7);
    // Tablety z Chrome przedstawiają się jak desktop -- sprawdzamy też dotyk.
    const touch = isMobileDevice() || navigator.maxTouchPoints > 0 || window.matchMedia?.("(pointer: coarse)").matches;
    el.previewOverlay.querySelector(".modal")?.classList.toggle("is-touch", !!touch);
    previewZoom ??= initPinchZoom(el.previewOverlay.querySelector(".previewModalCanvas"), el.previewCanvas);
    previewZoom.reset();
    lockPageZoomForPreview();
    openDialog(el.previewOverlay, { onClose: closePreview });
  }
  function closePreview() {
    closeDialog(el.previewOverlay);
    unlockPageZoomAfterPreview();
    previewZoom?.reset();
  }

  function onEditorPreview(preview) {
    if (!preview) return;
    latestPreview = preview;
    if (el.bigPreview) renderPreview(preview, el.bigPreview, GLYPH_5x7);
  }

  // Tryb tekstowy nie miał żadnej akcji otwierającej istniejący modal
  // powiększonego podglądu. Kliknięcie podglądu działa teraz tak samo jak w
  // edytorach rysowania i obrazu.
  if (el.bigPreview) {
    el.bigPreview.tabIndex = 0;
    el.bigPreview.setAttribute("role", "button");
    el.bigPreview.setAttribute("aria-label", "Otwórz powiększony podgląd");
  }
  el.bigPreview?.addEventListener("click", () => openPreview(latestPreview));
  el.bigPreview?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openPreview(latestPreview);
  });

  function renderHeader() {
    el.brandTitle.textContent = modeLabel();
  }

  /** Strona nie może edytować -- komunikat z jedynym wyjściem: lista logo. */
  function block(message) {
    showBlockingOverlay({ message, backHref: listBackUrl(mode) });
    document.querySelector("main.logoWrap[data-skel-step]")?.classList.add("skel-step-ready");
  }

  /* ---------- UI (działa od razu, także w trakcie wczytywania) ---------- */
  el.logoName.addEventListener("input", markDirty);
  $("btnPreviewClose")?.addEventListener("click", closePreview);
  window.addEventListener("logoeditor:openPreview", (ev) => { if (ev?.detail) openPreview(ev.detail); });
  // Schowanie karty / przejście do innej aplikacji: zapis od razu.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void save({ force: true });
  });
  window.addEventListener("i18n:lang", () => { renderHeader(); renderStatus(); });

  /* ---------- start ---------- */
  const i18nP = initI18n({ withSwitcher: true });
  // Dostęp, telefon (nakładka urządzenia), „Wstecz”, „Wskazówki”, konto — wg mapy.
  // Zapis przed wyjściem; otwarty podgląd na komputerze zamyka się „Wstecz”.
  const userP = initPage(EDITOR_PAGE_IDS[mode], {
    ready: i18nP,
    onBack: async (href) => {
      if (isOverlayOpen(el.previewOverlay)) { closePreview(); return; }
      await leave(href);
    },
    onManual: (href) => leave(href),
  });
  await i18nP;
  document.documentElement.classList.remove("page-loading");
  document.documentElement.classList.toggle("le-phone", isPhoneScreen());
  renderHeader();
  renderStatus();

  currentUser = await userP;
  if (!currentUser) return; // przekierowanie na logowanie albo nakładka telefonu

  logoId = new URLSearchParams(location.search).get("id");
  if (!logoId) { block(t("logoEditor.errors.notFound")); return; }

  try {
    const r = await fetch(await cacheBust(FONT_3x10_URL), { cache: "no-store" });
    if (!r.ok) throw new Error(`Font 3x10: HTTP ${r.status}`);
    FONT_3x10 = await r.json();
    GLYPH_5x7 = await loadFont5x7(await cacheBust(FONT_5x7_URL));
  } catch (e) {
    console.error(e);
    block(t("logoEditor.errors.fontsLoad"));
    return;
  }

  let logo;
  try {
    [logo, logos] = await Promise.all([fetchLogo(logoId), listLogos()]);
  } catch (e) {
    console.error(e);
    block(t("logoEditor.errors.notFound"));
    return;
  }
  if (editModeFor(logo) !== mode) { block(t("logoEditor.errors.wrongType")); return; }
  logoRecord = logo;
  const reason = cannotEditReason(logo, mode, FONT_3x10);
  if (reason) { block(reason); return; }

  // To logo edytowane w innej karcie albo pula logo zajęta (Control / ustawienia
  // gry) -> pełnoekranowy komunikat.
  const lock = await guardResourceLock({
    resourceType: "logo",
    resourceId: logo.id,
    context: "logo-editor",
    message: entryBusyMessage,
    backHref: listBackUrl(mode),
  });
  if (!lock.ok) return;
  logoLock = lock;

  editor = initEditor({
    getMode: () => mode,
    markDirty,
    clearDirty: () => {},
    // text.js czyści komunikat przy każdej zmianie -- stan pokazuje autozapis.
    setEditorMsg: () => {},
    onPreview: onEditorPreview,
    getFont3x10: () => FONT_3x10,
  });
  el.logoName.value = logo.name || "";
  el.logoName.disabled = false;
  await editor.open(logo.payload || null);
  ready = true;
  document.querySelector("main.logoWrap[data-skel-step]")?.classList.add("skel-step-ready");
}
