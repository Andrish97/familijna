// js/pages/privacy.js
//
// - publiczna strona (bez wymuszania logowania)
// - jeśli user zalogowany -> pokazuj username + Wyloguj
// - jeśli niezalogowany -> ukryj username + Wyloguj, a Wstecz wraca do /
//   (initPage: konto, „Wstecz” i etykieta wg mapy nawigacji)

import { initI18n, getUiLang, t } from "../../shared/translation/translation.js";
import { initPage } from "../../shared/js/core/page-init.js";
import "../../shared/js/core/contact-modal.js";


import { syncPublicSeo } from "../../shared/js/core/public-seo.js";

window.dispatchEvent(new Event("resize"));

document.addEventListener("DOMContentLoaded", async () => {
  const i18nP = initI18n({ withSwitcher: true });
  // Strona publiczna: zalogowany widzi konto, niezalogowany wraca na landing.
  // Menu konta odświeża się po zmianie języka (etykiety są tekstem, nie data-i18n).
  const pageP = initPage("privacy", { ready: i18nP, account: { showAuthEntry: false }, accountOnLang: true });
  await i18nP;
  syncPublicSeo("privacy", getUiLang(), t("privacy.title"), t("privacy.description"));
  document.documentElement.classList.remove('page-loading');

  await pageP;
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
});

window.addEventListener("i18n:lang", () => syncPublicSeo("privacy", getUiLang(), t("privacy.title"), t("privacy.description")));
