// js/core/wake-prompt.js
// Ekran „nie wygaszaj” na telefonach i tabletach (Prowadzący, Przycisk).
// Safari/WebKit na iOS i iPadOS odmawia blokady wygaszania bez dotknięcia
// (NotAllowedError) — przy wejściu na stronę i po każdym powrocie z tła.
// Na Prowadzącym nikt nie dotyka ekranu, na Przycisku dopiero w pojedynku,
// więc telefon gasł po czasie automatycznej blokady i znikał z gry
// (eksport 29.10: 22 odmowy, gry 23.10 bez ani jednej zgody). Jedno
// dotknięcie przycisku na tym ekranie daje gest, przy którym keep-alive.js
// ponawia prośbę o blokadę. Android (Chrome) daje blokadę bez dotknięcia,
// ale odmawia albo ją zwalnia np. w trybie oszczędzania energii — ekran
// wtedy też się pokazuje, a tekst podpowiada wyłączenie tego trybu.

import { t } from "../../translation/translation.js?v=v2026-11-14T11320";
import { blockingScreen, setBlockingIcon, setBlockingOpen } from "./blocking-screen.js?v=v2026-11-14T11320";
import { onWakeLockChange } from "./keep-alive.js?v=v2026-11-14T11320";

function mobileDevice() {
  const ua = navigator.userAgent || "";
  return /iPad|iPhone|iPod|Android/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * canShow: czy strona pozwala teraz przykryć ekran (Przycisk — poza
 * pojedynkiem; w pojedynku samo naciśnięcie jest gestem).
 * Zwraca { sync } — wołać, gdy zmienia się wynik canShow.
 */
export function initWakePrompt({ canShow = () => true } = {}) {
  if (!mobileDevice()) return { sync() {} };
  let refused = false;
  // Po dotknięciu ekran znika, nawet gdy system dalej odmawia (np. tryb
  // oszczędzania energii) — wraca dopiero po kolejnym powrocie z tła.
  let dismissed = false;
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = blockingScreen("deviceWakeOverlay", [
      { key: "Confirm", i18n: "deviceWake.confirm", iconName: "check", accent: true },
    ], { prefix: "deviceWake" });
    setBlockingIcon(overlay, "phone");
    document.getElementById("deviceWakeTitle").textContent = t("deviceWake.title");
    document.getElementById("deviceWakeMsg").textContent = t("deviceWake.text");
    document.getElementById("deviceWakeConfirm")?.addEventListener("click", () => {
      dismissed = true;
      sync();
    });
    return overlay;
  }

  function sync() {
    const open = refused && !dismissed && !document.hidden && canShow();
    if (!open && !overlay) return;
    setBlockingOpen(ensureOverlay(), open);
  }

  onWakeLockChange(({ phase }) => {
    refused = phase === "denied" || phase === "released";
    sync();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) dismissed = false;
    sync();
  });
  return { sync };
}
