// js/pages/connect-device.js

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-14T12020";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-14T12020";
import { isMobileDevice } from "../../shared/js/core/pwa.js?v=v2026-11-14T12020";
import { initI18n, t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-14T12020";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-14T12020";
import { alertModal, confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-14T12020";
import { toast, setMessage } from "../../shared/js/core/toast.js?v=v2026-11-14T12020";
import "../../shared/js/core/contact-modal.js?v=v2026-11-14T12020";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-14T12020";
import { initListHeaderLayout } from "../../shared/js/core/list-header-layout.js?v=v2026-11-14T12020";
import { emptyStateHtml } from "../../shared/js/core/empty-state.js?v=v2026-11-14T12020";
import { attachListTools } from "../../shared/js/core/share-sections.js?v=v2026-11-14T12020";
import { resolveDeviceCode } from "../../shared/js/core/device-code.js?v=v2026-11-14T12020";

// Kod QR prowadzi tylko na tę samą stronę (E24 R28: bez przekierowań na obce adresy).
function openScannedUrl(raw) {
  let url = null;
  try { url = new URL(String(raw || "")); } catch {}
  const own = [location.origin, "https://www.familiada.online", "https://familiada.online"];
  if (url && own.includes(url.origin)) { window.location.href = url.href; return; }
  toast(t("connectDevice.scan.foreignQr"), { kind: "error" });
}


const btnManual           = document.getElementById("btnManual");
const btnScanQr           = document.getElementById("btnScanQr");
const sharedDevicesCard   = document.getElementById("sharedDevicesCard");
const sharedDevicesList   = document.getElementById("sharedDevicesList");
attachListTools(sharedDevicesList?.previousElementSibling, sharedDevicesList, "connect-shared");
const pageHint            = document.getElementById("pageHint");
const connectCodeInput    = document.getElementById("connectCodeInput");
const btnConnectCode      = document.getElementById("btnConnectCode");
const connectCodeMsg      = document.getElementById("connectCodeMsg");


function setCodeMsg(text) { setMessage(connectCodeMsg, text); }

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function deviceTypeLabel(type) {
  if (type === "host")     return t("connectDevice.deviceType.host");
  if (type === "buzzer")   return t("connectDevice.deviceType.buzzer");
  if (type === "display")  return t("connectDevice.deviceType.display");
  if (type === "poll_qr")  return t("connectDevice.deviceType.pollQr");
  return type;
}

function deviceTypeIconName(type) {
  if (type === "host")    return "host";
  if (type === "buzzer")  return "buzzer";
  if (type === "poll_qr") return "polls";
  return "display";
}

function deviceTypeIcon(type) {
  return icon(deviceTypeIconName(type));
}

const _isMobile = isMobileDevice() || navigator.maxTouchPoints > 0 || !!window.matchMedia?.("(pointer: coarse)").matches;
// Pokaż skaner od razu: nie uzależniaj jego dostępności na iPhonie od
// zakończenia pobierania tłumaczeń ani odpowiedzi strony po logowaniu.
if (_isMobile && btnScanQr) btnScanQr.hidden = false;

// ── Podgląd urządzenia po kodzie: wspólne confirmModal (modal.js) ─────────────
async function showDevicePreview(info) {
  const gameLabel  = t("connectDevice.enterCode.previewGame");
  const ownerLabel = t("connectDevice.enterCode.previewOwner");
  const ok = await confirmModal({
    title: deviceTypeLabel(info.device_type),
    text: `${gameLabel} ${info.game_name || "—"}\n${ownerLabel} ${info.owner_username || "—"}`,
    okText: t("connectDevice.enterCode.connectBtn"),
    cancelText: t("common.cancel"),
    modalClass: "modal--narrow",
  });
  if (!ok) return;
  const lang = getUiLang() || "pl";
  const device = info.device_type === "poll_qr" ? "qr" : info.device_type;
  window.location.href = `/go/?d=${device}&id=${info.game_id}&key=${info.share_key}&lang=${lang}`;
}

// ── Code input ─────────────────────────────────────────────────────────────────
async function handleCodeConnect() {
  const raw = String(connectCodeInput?.value || "").trim().replace(/\D/g, "");
  if (raw.length !== 6) {
    setCodeMsg(t("connectDevice.enterCode.invalidCode"));
    return;
  }
  setCodeMsg(t("connectDevice.enterCode.resolving"));
  if (btnConnectCode) btnConnectCode.disabled = true;

  try {
    const data = await resolveDeviceCode(raw);
    if (!data?.ok) {
      setCodeMsg(t(data?.err === "rate_limited" ? "connectDevice.enterCode.tooManyAttempts" : "connectDevice.enterCode.codeNotFound"));
      return;
    }
    setCodeMsg("");
    void showDevicePreview(data);
  } catch (e) {
    // Brak sieci albo błąd Workera: komunikat w języku strony, nie surowy błąd przeglądarki.
    console.warn("[connect] resolve code failed", e);
    setCodeMsg(t("connectDevice.enterCode.networkError"));
  } finally {
    if (btnConnectCode) btnConnectCode.disabled = false;
  }
}

btnConnectCode?.addEventListener("click", handleCodeConnect);
connectCodeInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); handleCodeConnect(); }
});

// ── Shared devices (only logged-in non-guests) ─────────────────────────────────
async function renderSharedDevices() {
  if (!sharedDevicesList) return;
  sharedDevicesList.innerHTML = emptyStateHtml(t("connectDevice.shared.loading"));

  const { data, error } = await sb().rpc("list_shared_devices_for_me");
  if (error) {
    sharedDevicesList.innerHTML = emptyStateHtml(t("connectDevice.shared.error"));
    return;
  }

  // ?share=<id> (z Zadań): to udostępnienie jest na liście zawsze i jest podświetlone.
  const focusShare = new URLSearchParams(location.search).get("share");
  const items = (data || []).filter(item =>
    (focusShare && String(item.share_id) === focusShare) ||
    (_isMobile ? (item.device_type === "host" || item.device_type === "buzzer")
               : item.device_type === "display")
  );

  if (!items.length) {
    sharedDevicesList.innerHTML = emptyStateHtml(t("connectDevice.shared.empty"));
    return;
  }

  sharedDevicesList.innerHTML = "";
  for (const item of items) {
    const row = document.createElement("div");
    row.className = "shareRow mail-row mail-row--device connect-device-tile";
    row.dataset.shareId = String(item.share_id);

    const ownerLabel = escapeHtml(item.owner_username || item.owner_email || "—");
    const gameName   = escapeHtml(item.game_name || t("connectDevice.shared.noName"));
    const typeLabel  = deviceTypeLabel(item.device_type);

    row.innerHTML = `
      <span class="mail-kind connect-device-tile-icon">${deviceTypeIcon(item.device_type)}</span>
      <div class="mail-row-copy connect-device-tile-body">
        <div class="shareEmail connect-device-tile-name">${gameName}</div>
        <div class="shareNote connect-device-tile-meta">${typeLabel} · ${ownerLabel}</div>
      </div>
      <div class="shareRowActions connect-device-tile-arrow">${icon("arrow-right")}</div>
    `;

    row.addEventListener("click", async () => {
      if (!item.game_id || !item.share_key) {
        toast(t("connectDevice.shared.gameNotFound"), { kind: "error" });
        return;
      }
      const isMobileType = item.device_type === "host" || item.device_type === "buzzer";
      if (_isMobile && item.device_type === "display") {
        alertModal({ text: t("connectDevice.warning.desktopOnly") });
      } else if (!_isMobile && isMobileType) {
        alertModal({ text: t("connectDevice.warning.mobileOnly") });
      }
      try {
        const device = item.device_type === "poll_qr" ? "qr" : item.device_type;
        window.location.href = `/go/?d=${device}&id=${item.game_id}&key=${item.share_key}`;
      } catch (e) {
        toast(e?.message || t("common.genericError"), { kind: "error" });
      }
    });

    sharedDevicesList.appendChild(row);
  }

  if (focusShare) {
    const hit = sharedDevicesList.querySelector(`[data-share-id="${CSS.escape(focusShare)}"]`);
    if (hit) {
      hit.classList.add("is-focus");
      hit.scrollIntoView({ block: "center" });
    }
  }
}

// ── QR scanner ─────────────────────────────────────────────────────────────────
async function loadJsQR() {
  if (window.jsQR) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/shared/vendor/jsQR.min.js?v=v2026-11-14T12020";
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

function buildScanOverlay() {
  const video = document.createElement("video");
  video.setAttribute("playsinline", "");
  video.className = "qr-scan-video";

  const closeBtn = document.createElement("button");
  closeBtn.innerHTML = icon("close");
  closeBtn.setAttribute("aria-label", t("common.modal.closeLabel"));
  closeBtn.type = "button";
  closeBtn.className = "btn icon qr-scan-close";

  return { video, closeBtn };
}

async function startQrScan() {
  const hasCamera = !!navigator.mediaDevices?.getUserMedia;

  if (hasCamera) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const { video, closeBtn } = buildScanOverlay();

      document.body.appendChild(video);
      document.body.appendChild(closeBtn);
      video.srcObject = stream;
      await video.play();

      let scanning = true;
      const stop = () => {
        scanning = false;
        stream.getTracks().forEach(tr => tr.stop());
        video.remove();
        closeBtn.remove();
      };
      closeBtn.addEventListener("click", stop);

      if ("BarcodeDetector" in window) {
        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
        const scan = async () => {
          if (!scanning) return;
          try {
            const codes = await detector.detect(video);
            if (codes.length) {
              const url = codes[0].rawValue;
              stop();
              openScannedUrl(url);
              return;
            }
          } catch {}
          if (scanning) requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      } else {
        await loadJsQR();
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const scan = () => {
          if (!scanning) return;
          if (video.readyState === video.HAVE_ENOUGH_DATA) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = window.jsQR(imageData.data, imageData.width, imageData.height);
            if (code?.data?.startsWith("http")) {
              stop();
              openScannedUrl(code.data);
              return;
            }
          }
          if (scanning) requestAnimationFrame(scan);
        };
        requestAnimationFrame(scan);
      }
      return;
    } catch {
      toast(t("connectDevice.scan.cameraError"), { kind: "error" });
      return;
    }
  }

  await loadJsQR();
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.hidden = true;
  document.body.appendChild(input);

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    let bitmap;
    const objectUrl = URL.createObjectURL(file);
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      const img = new Image();
      img.src = objectUrl;
      await new Promise(r => { img.onload = r; });
      bitmap = img;
    }

    let w = bitmap.width, h = bitmap.height;
    const MAX = 1500;
    if (w > MAX || h > MAX) {
      if (w > h) { h = Math.round((h * MAX) / w); w = MAX; }
      else        { w = Math.round((w * MAX) / h); h = MAX; }
    }

    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
    URL.revokeObjectURL(objectUrl);
    if (bitmap.close) bitmap.close();

    const imageData = canvas.getContext("2d").getImageData(0, 0, w, h);
    const code = window.jsQR(imageData.data, imageData.width, imageData.height);
    if (code?.data?.startsWith("http")) {
      openScannedUrl(code.data);
    } else {
      toast(t("connectDevice.scan.noQr"), { kind: "error" });
    }
  });

  input.click();
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────
(async () => {
  const i18nP = initI18n({ withSwitcher: true });
  // Strona publiczna: user albo null (anonim wraca na landing, bez „Wskazówek”).
  const userP = initPage("connectDevice", { ready: i18nP });
  await i18nP;
  document.documentElement.classList.remove('page-loading');
  // podtytuł nie zależy od konta — razem z tytułem, przed odpowiedzią sesji
  if (pageHint) pageHint.textContent = _isMobile
    ? (t("connectDevice.header.hintMobile"))
    : (t("connectDevice.header.hintDesktop"));

  const currentUser = await userP;

  const isLoggedIn = !!currentUser;
  const guestMode  = isLoggedIn ? isGuestUser(currentUser) : true;

  // Gość nie dostaje „Wskazówek” na tej stronie (jak dotąd).
  if (guestMode && btnManual) btnManual.hidden = true;

  if (_isMobile && btnScanQr) {
    btnScanQr.hidden = false;
    btnScanQr.addEventListener("click", startQrScan);
  }
  initListHeaderLayout(".connect-device-body > main.wrap > .bar");

  if (isLoggedIn && !guestMode) {
    if (sharedDevicesCard) sharedDevicesCard.hidden = false;
    await renderSharedDevices();
  }
  document.querySelector(".games-shell[data-skel-step]")?.classList.add("skel-step-ready");
})();
