// js/core/fullscreen.js
// Przycisk pełnego ekranu (.fs-btn) — jeden dla Przycisku, Prowadzącego,
// snake, QR ankiety i Wyświetlacza (E23 §6.2, wcześniej pięć kopii).
//   - Fullscreen API (także webkit), na telefonie bez paska nawigacji;
//   - gdy API brak albo odmówi: „pseudo pełny ekran” (html.pseudoFS);
//   - iPhone/iPad w zwykłej karcie Safari nie ma Fullscreen API — wtedy okno
//     „Dodaj do ekranu początkowego” (.a2hs, html.showA2HS), jeśli strona je ma;
//   - zainstalowana aplikacja: html.webapp (silnik chowa wtedy .fs-btn).

import { icon } from "./icons.js?v=v2026-11-07T20025";
import { isIOSSafari, isStandalone } from "./pwa.js?v=v2026-11-07T20025";

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

/**
 * button      przycisk .fs-btn (ikona w środku podmieniana)
 * a2hs        okno .a2hs „Dodaj do ekranu początkowego” (opcjonalne)
 * a2hsClose   jego przycisk OK
 * landscape   po wejściu zablokuj orientację poziomą (snake)
 */
export function initFullscreenButton({ button, a2hs = null, a2hsClose = null, landscape = false } = {}) {
  if (!button) return;
  const root = document.documentElement;
  let pseudo = false;

  const sync = () => {
    const on = !!fullscreenElement() || pseudo;
    button.innerHTML = icon(on ? "fullscreen-exit" : "fullscreen-enter");
    button.classList.toggle("is-active", on);
  };
  const setPseudo = (on) => {
    pseudo = on;
    root.classList.toggle("pseudoFS", on);
    if (on) setTimeout(() => window.scrollTo(0, 1), 50); // iOS: próba schowania paska adresu
  };
  const showHint = (on) => {
    root.classList.toggle("showA2HS", on);
    a2hs?.setAttribute("aria-hidden", on ? "false" : "true");
    (on ? a2hsClose : button)?.focus();
  };

  if (a2hs) {
    a2hsClose?.addEventListener("click", () => showHint(false));
    a2hs.addEventListener("click", (e) => { if (e.target === a2hs) showHint(false); });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && root.classList.contains("showA2HS")) showHint(false);
    });
  }

  button.addEventListener("click", async () => {
    if (a2hs && isIOSSafari() && !isStandalone()) { showHint(true); return; }
    try {
      if (fullscreenElement()) await (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (pseudo) setPseudo(false);
      else {
        const request = root.requestFullscreen || root.webkitRequestFullscreen;
        if (!request) throw new Error("fullscreen unavailable");
        await request.call(root, { navigationUI: "hide" });
        if (landscape) await screen.orientation?.lock?.("landscape").catch(() => {});
      }
    } catch (e) {
      setPseudo(true);
      console.warn("[fullscreen] fallback:", e?.message || e);
    }
    sync();
  });
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  if (isStandalone()) root.classList.add("webapp");
  sync();
}
