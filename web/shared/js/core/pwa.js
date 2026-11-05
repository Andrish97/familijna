// js/core/pwa.js
// Rejestracja Service Workera + prompt instalacji (Android/Chrome/Edge/desktop)
// iOS Safari obsługuje własny prompt w games.js (maybeShowIosWebappPrompt)
// Flaga zapamiętana w localStorage – per urządzenie/przeglądarka, nie synchronizuje się.

const LS_KEY = "pwa:install_dismissed";

export function initPwa({ serviceWorkerUrl = "/sw.js?v=v2026-11-05T16132", scope = "/", registerServiceWorker = true } = {}) {
  if (registerServiceWorker && "serviceWorker" in navigator) {
    navigator.serviceWorker.register(serviceWorkerUrl, { scope }).catch(() => {});
  }

  let deferredPrompt = null;
  let didNotifyInstalled = false;

  const notifyInstalled = () => {
    if (didNotifyInstalled) return;
    didNotifyInstalled = true;
    localStorage.removeItem(LS_KEY);
    window.dispatchEvent(new CustomEvent("pwa:installed"));
  };

  window.addEventListener("beforeinstallprompt", (e) => {
    // Zapisz prompt (dla przycisku instalacji)
    // NIE wywołuj preventDefault - przeglądarka sama decyduje kiedy pokazać banner
    deferredPrompt = e;
    // Dispatchuj zdarzenie auto-modala tylko gdy użytkownik nie odrzucił
    if (!localStorage.getItem(LS_KEY)) {
      window.dispatchEvent(new CustomEvent("pwa:installable", { detail: { prompt: e } }));
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyInstalled();
  });

  return {
    canInstall: () => !!deferredPrompt,
    getPrompt: () => deferredPrompt,
    install: async () => {
      if (!deferredPrompt) return false;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === "accepted") notifyInstalled();
      else localStorage.setItem(LS_KEY, "1");
      return outcome === "accepted";
    },
    dismiss: () => {
      localStorage.setItem(LS_KEY, "1");
      deferredPrompt = null;
    },
  };
}

/** Strona otwarta jako zainstalowana aplikacja (ekran początkowy, PWA). */
export function isStandalone() {
  return !!(window.navigator.standalone || window.matchMedia?.("(display-mode: standalone)").matches);
}

/** iPhone/iPad w Safari (bez Fullscreen API i bez beforeinstallprompt). */
export function isIOSSafari() {
  const ua = navigator.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /WebKit/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

// A single rule for install controls: show them only when the browser can
// install the PWA or the platform needs manual Add to Home Screen/Dock steps.
export function canOfferPwaInstall(pwaApi) {
  const ua = navigator.userAgent || "";
  const macSafari = /Mac/.test(navigator.platform) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua);
  return !!pwaApi?.canInstall() || isIOSSafari() || macSafari;
}

export function isMobileDevice() {
  const ua = navigator.userAgent || "";
  return /Android|iPhone|iPad|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
