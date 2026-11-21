// Start strony bez skryptu wbudowanego w HTML (CSP bez 'unsafe-inline', E24 R12):
// najpierw słownik, potem zdjęcie zasłony ładowania i moduł strony.
import { initI18n } from "../../../shared/translation/translation.js";
await initI18n({ withSwitcher: true });
document.documentElement.classList.remove("page-loading");
import("./game-settings.js");
