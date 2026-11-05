// base-explorerjs/ui/sheet-guard.js
// Okna „Szukaj” i „Przenieś do” są w nav-map (dialogs), żeby systemowe
// „Wstecz” na telefonie je zamykało. Wspólny modal-sheet.js umie jednak też
// pokazać takie okno „z adresu” (?dialog=… po odświeżeniu albo „Dalej”
// w historii) — bez treści, bo treść wstawia dopiero nasz kod przy otwarciu.
// Strażnik: okno pokazane, gdy nasz kod go nie otworzył → od razu zamknij
// (closeDialog cofa przy tym wpis historii). Pokazanie z adresu oznacza
// modal-sheet.js (data-routed); otwarcie naszym kodem (openDialog) go zdejmuje.

import { closeDialog, isOverlayOpen } from "../../../../shared/js/core/modal-sheet.js?v=v2026-11-05T23552";

export function guardRoutedSheet(overlay, isOpen = () => overlay?.dataset.routed !== "true") {
  if (!overlay) return;
  const dismiss = () => {
    if (isOpen() || !isOverlayOpen(overlay)) return;
    closeDialog(overlay);
  };
  document.addEventListener("modal-sheet:enter", (e) => {
    if (e.detail?.overlay === overlay) setTimeout(dismiss, 0);
  });
  // wejście z adresu mogło nastąpić, zanim strona podpięła nasłuch
  setTimeout(dismiss, 0);
}
