// js/core/page-overlay.js
// Jedna pełnoekranowa nakładka „tu nie wejdziesz”: gość bez dostępu do strony
// albo urządzenie, którego strona nie obsługuje (telefon, za wąskie okno).
// Ekran: core/blocking-screen.js (ten sam co blokada zasobu). „Wróć” prowadzi na adres z mapy nawigacji (backHref),
// nigdy przez history.back() ani referrer. i18n: pageGuard.*.

import { applyTranslations, t, withLangParam } from "../../translation/translation.js?v=v2026-11-03T22214";
import { blockingScreen, setBlockingIcon, setBlockingOpen, isBlockingOpen } from "./blocking-screen.js?v=v2026-11-03T22214";


export const PAGE_GUARD_ID = "pageGuard";
let redirectTimer = null;

function ensureOverlay() {
  const existing = document.getElementById(PAGE_GUARD_ID);
  if (existing) return existing;
  const overlay = blockingScreen(PAGE_GUARD_ID, [
    { key: "Back", i18n: "pageGuard.back", iconName: "arrow-left" },
    { key: "Login", i18n: "pageGuard.login", iconName: "person", accent: true },
  ]);
  window.addEventListener("i18n:lang", () => {
    if (isBlockingOpen(overlay)) applyTranslations(overlay);
  });
  return overlay;
}

/**
 * Pokazuje nakładkę.
 *   kind        "guest" | "device" (znacznik w data-kind)
 *   state       drobniejszy stan (np. "phone", "rotate", "narrow")
 *   iconName    nazwa ikony z icons.js
 *   titleKey / messageKey   klucze tłumaczeń
 *   backHref    adres „Wróć” (null — bez przycisku)
 *   loginHref   adres „Zaloguj” (null — bez przycisku)
 */
export function showPageGuard({ kind, state = "", iconName = "info", titleKey, messageKey, backHref = null, loginHref = null, redirectHref = null, redirectDelayMs = 0 }) {
  const overlay = ensureOverlay();
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
  // Strona pod blokadą urządzenia niewidoczna (base.css: html[data-page-guard] body).
  if (kind === "device") document.documentElement.setAttribute("data-page-guard", "");
  const title = overlay.querySelector("#pageGuardTitle");
  const msg = overlay.querySelector("#pageGuardMsg");
  title.setAttribute("data-i18n", titleKey);
  msg.setAttribute("data-i18n", messageKey);
  title.textContent = t(titleKey);
  msg.textContent = t(messageKey);

  setBlockingIcon(overlay, iconName);

  const back = overlay.querySelector("#pageGuardBack");
  back.hidden = !backHref;
  back.onclick = backHref ? () => { location.href = backHref; } : null;

  const login = overlay.querySelector("#pageGuardLogin");
  login.hidden = !loginHref;
  login.onclick = loginHref ? () => { location.href = loginHref; } : null;

  overlay.dataset.kind = kind;
  overlay.dataset.state = state;
  setBlockingOpen(overlay, true);
  if (redirectHref) {
    const target = withLangParam(redirectHref);
    redirectTimer = setTimeout(() => {
      if (isBlockingOpen(overlay)) window.location.replace(target);
    }, Math.max(0, redirectDelayMs));
  }
  applyTranslations(overlay);
  return overlay;
}

/** Chowa nakładkę (np. po obrocie tabletu albo poszerzeniu okna). */
export function hidePageGuard() {
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
  const overlay = document.getElementById(PAGE_GUARD_ID);
  if (!overlay) return;
  setBlockingOpen(overlay, false);
  document.documentElement.removeAttribute("data-page-guard");
}
