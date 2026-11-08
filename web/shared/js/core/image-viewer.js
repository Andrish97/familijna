// js/core/image-viewer.js
// Podgląd zrzutu w oknie (strona główna, Wskazówki): na komputerze obraz w oknie
// z tytułem, na telefonie i tablecie okno od dołu; wszędzie przybliżanie palcami
// (pinch-zoom.js).
// Zamyka [×], Esc, kliknięcie tła albo „Wstecz” na górnym pasku (backBtn).

import { t } from "../../translation/translation.js?v=v2026-11-08T21565";
import { icon } from "./icons.js?v=v2026-11-08T21565";
import { openDialog, closeDialog, setOverlayOpen, isSheetViewport } from "./modal-sheet.js?v=v2026-11-08T21565";
import { initPinchZoom, lockPageZoomForPreview, unlockPageZoomAfterPreview } from "./pinch-zoom.js?v=v2026-11-08T21565";

/**
 * @param {{ mount?: HTMLElement|null, before?: Node|null, backBtn?: HTMLElement|null }} opts
 *   mount/before — gdzie wstawić okno (domyślnie body), backBtn — przycisk „Wstecz” w topbarze
 * @returns {{ open(src: string, title?: string, preview?: HTMLImageElement|null): void, close(): void }}
 */
export function createImageViewer({ mount = null, before = null, backBtn = null } = {}) {
  const overlay = document.createElement("div");
  overlay.id = "imgvOverlay";
  overlay.className = "overlay modal--sheet imgv-overlay";
  setOverlayOpen(overlay, false);
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <div class="modal modal--media imgv-panel" role="dialog" aria-modal="true" aria-labelledby="imgvHeading">
      <div class="imgv-top mHead">
        <h2 class="imgv-title mTitle" id="imgvHeading" data-i18n="common.imageViewer.title">${t("common.imageViewer.title")}</h2>
        <button class="btn sm" type="button" id="imgvClose" aria-label="${t("common.modal.closeLabel")}" data-i18n-aria-label="common.modal.closeLabel">${icon("close")}</button>
      </div>
      <p class="imgv-name mSub" id="imgvName"></p>
      <div class="imgv-stage sheet-fill" id="imgvStage"></div>
    </div>
  `;
  (mount || document.body).insertBefore(overlay, before);
  const stage = overlay.querySelector("#imgvStage");
  const closeBtn = overlay.querySelector("#imgvClose");
  const titleEl = overlay.querySelector("#imgvName");

  let previewZoom = null;
  let previousFocus = null;

  // preview -- obraz ze strony (już wczytany): pokazany od razu w docelowym
  // rozmiarze, a pełny kadr podmienia go po zdekodowaniu, bez skoku okna.
  // Okno na komputerze: szerokość z proporcji obrazu i wysokości nagłówka
  // (--imgv-chrome), żeby cały obraz mieścił się w oknie bez ucinania dołu.
  const panel = overlay.querySelector(".imgv-panel");
  const fit = () => {
    const zoom = stage.querySelector(".imgv-zoom");
    if (!zoom || !overlay.classList.contains("is-open")) return;
    const chrome = panel.getBoundingClientRect().height - zoom.getBoundingClientRect().height;
    if (chrome > 0) panel.style.setProperty("--imgv-chrome", `${Math.ceil(chrome)}px`);
  };
  const setRatio = (w, h) => { if (w > 0 && h > 0) { panel.style.setProperty("--imgv-ratio", String(w / h)); requestAnimationFrame(fit); } };
  window.addEventListener("resize", () => requestAnimationFrame(fit), { passive: true });

  // preview -- obraz ze strony (już wczytany): pokazany od razu w docelowym
  // rozmiarze, a pełny kadr podmienia go po zdekodowaniu, bez skoku okna.
  // Przybliżanie palcami (pinch-zoom.js) na każdym urządzeniu -- także na
  // dużym tablecie i komputerze z ekranem dotykowym.
  const open = (src, title, preview = null) => {
    if (overlay.classList.contains("is-open")) return;
    previousFocus = document.activeElement;
    stage.innerHTML = "";
    titleEl.textContent = title || "";
    const img = document.createElement("img");
    img.className = "imgv-img"; img.alt = title || "";
    const ready = preview?.complete && preview.naturalWidth > 0;
    img.src = ready ? (preview.currentSrc || preview.src) : src;
    if (ready) setRatio(preview.naturalWidth, preview.naturalHeight);
    else img.decode().then(() => setRatio(img.naturalWidth, img.naturalHeight)).catch(() => {});
    if (ready && img.src !== new URL(src, location.href).href) {
      const full = new Image();
      full.src = src;
      full.decode().then(() => { if (img.isConnected) img.src = src; }).catch(() => {});
    }
    const zoom = document.createElement("div");
    zoom.className = "imgv-zoom sheet-fill";
    zoom.appendChild(img); stage.appendChild(zoom);
    previewZoom = initPinchZoom(zoom, img);
    lockPageZoomForPreview();
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
    openDialog(overlay, { onClose: close });
    requestAnimationFrame(fit);
    (isSheetViewport() ? overlay.querySelector(".sheet-handle") : closeBtn)?.focus();
  };

  const close = () => {
    if (!overlay.classList.contains("is-open")) return;
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    closeDialog(overlay);
    previewZoom?.reset();
    previewZoom = null;
    unlockPageZoomAfterPreview();
    stage.innerHTML = "";
    previousFocus?.focus?.();
    previousFocus = null;
  };

  closeBtn.addEventListener("click", close);
  backBtn?.addEventListener("click", (e) => {
    if (!overlay.classList.contains("is-open")) return;
    e.preventDefault();
    close();
  });
  window.addEventListener("keydown", (e) => {
    if (!overlay.classList.contains("is-open")) return;
    if (e.key === "Tab") {
      // W tym prostym dialogu jedynym elementem interaktywnym jest zamknięcie.
      e.preventDefault();
      (isSheetViewport() ? overlay.querySelector(".sheet-handle") : closeBtn)?.focus();
    }
  }, true);

  return { open, close };
}
