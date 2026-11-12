// Start strony bez skryptu wbudowanego w HTML (CSP bez 'unsafe-inline', E24 R12):
// najpierw słownik, potem zdjęcie zasłony ładowania i moduł strony.
import { initI18n } from "../../shared/translation/translation.js?v=v2026-11-12T13484";
await initI18n({ withSwitcher: true });
document.documentElement.classList.remove("page-loading");
import("./app.js?v=v2026-11-12T13484");
