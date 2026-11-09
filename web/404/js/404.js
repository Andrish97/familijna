import { initI18n, t, withLangParam } from "../../shared/translation/translation.js?v=v2026-11-09T00150";
import { getUser } from "../../shared/js/core/auth.js?v=v2026-11-09T00150";


(async () => {
  try {
    await initI18n({ withSwitcher: true, apply: true });
  } catch (err) {
    console.error("[404] i18n nieaktywny:", err);
  } finally {
    document.documentElement.classList.remove('page-loading');
    document.querySelector('.topbar')?.classList.add('topbar-ready');
  }
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  const isTv = document.documentElement.dataset.tvLayout === "true";
  if (isTv) {
    document.querySelector(".notfound-actions")?.remove();
    const hint = document.querySelector(".notfound-card .hint");
    if (hint) hint.textContent = t("notFound.tvRedirectHint");
  }
  let returnTo = isTv ? "/connect/?tv=1" : "/";
  if (!isTv) {
    try {
      if (await getUser()) {
        returnTo = "/games/";
        document.querySelector('[data-i18n="notFound.homeBtn"]')?.remove();
        document.querySelector('[data-i18n="notFound.marketplaceBtn"]')?.remove();
        const myGames = document.getElementById("notFoundMyGames");
        if (myGames) {
          myGames.hidden = false;
          myGames.href = withLangParam("/games/");
        }
        const hint = document.querySelector(".notfound-card .hint");
        if (hint) hint.textContent = t("notFound.authRedirectHint");
      }
    } catch (err) {
      console.warn("[404] nie udało się sprawdzić sesji:", err);
    }
  }
  setTimeout(() => {
    window.location.href = withLangParam(returnTo);
  }, 5000);
})();
