// Start strony bez skryptu wbudowanego w HTML (CSP bez 'unsafe-inline', E24 R12):
// najpierw słownik, potem zdjęcie zasłony ładowania i moduł strony.
import { initI18n } from "../../../shared/translation/translation.js?v=v2026-11-08T19051";
await initI18n({ withSwitcher: true });
document.documentElement.classList.remove("page-loading");
import("./game-settings.js?v=v2026-11-08T19051");
