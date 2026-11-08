// js/core/page-init.js
// Jedno wywołanie na starcie strony zamiast requireAuth + showGuestBlockedOverlay
// + guardViewportWidth + ręcznego podpinania #btnBack / #btnManual / konta.
// Wszystko wynika z wpisu strony w PAGES (nav-map.js):
//
//   1. urządzenie — blokada przed odsłonięciem strony i sprawdzaniem konta,
//   2. dostęp   public — bez wymuszania logowania (user albo null),
//               guest  — wymaga sesji (konto albo gość), inaczej loginUrl(),
//               user   — tylko konto; gość dostaje wspólną nakładkę (page-overlay.js),
//   3. topbar   #btnBack (etykieta + cel z backHref, najpierw handleSheetBack()),
//               #btnManual (manualHref() z wpis.manual), konto, topbar-ready,
//   4. przyciski  PAGES[id].buttons: niedostępne dla roli (anon / gość / konto)
//               albo zbyt wąskiego viewportu są chowane i aktualizowane po obrocie,
//               pozostałe dostają przejście przez linkTo() — chyba że opis ma
//               custom: true (strona coś sprawdza przed przejściem; cel daje strona),
//   5. zwraca użytkownika (null dla niezalogowanego, zablokowanego albo przekierowanego).
//
// Odstępstwa strony przekazujemy przez opts, nie przez zapasowe ścieżki:
//   ready          Promise (np. initI18n), na który czekamy przed pokazaniem czegokolwiek;
//                  inicjalizacja może biec równolegle z guardem, auth dopiero po nim
//   back           id przycisku „Wstecz” (domyślnie "btnBack"); false — strona go nie ma
//   backLabel      false — etykietę ustawia sama strona
//   onBack         (href, ev) => … zamiast przejścia na href (np. zapis przed wyjściem);
//                  handleSheetBack() i tak idzie pierwsze
//   manual         id przycisku „Wskazówki” (domyślnie "btnManual"); false — strona go nie ma
//   onManual       (href, ev) => … zamiast przejścia na href
//   account        opcje setTopbarAccount (withAccountSettings, showAuthEntry, onLogout)
//   accountOnLang  true — odśwież menu konta po zmianie języka
//   deferTopbarReady true — strona odsłoni topbar po własnym, późniejszym renderze
//   deps           podmiana zależności (testy)

import { holdPageLayout, redirectPage } from "./page-layout.js?v=v2026-11-08T23092";
import { PAGES, backHref, buttonHref, buttonRoles, buttonVisible, buttonBlocked, linkTo, loginUrl, manualHref, renderBackLabel, roleOf } from "./nav-map.js?v=v2026-11-08T23092";
import { isGuestUser } from "./guest-mode.js?v=v2026-11-08T23092";
import { showPageGuard } from "./page-overlay.js?v=v2026-11-08T23092";
import { setModalSheetPage } from "./modal-sheet.js?v=v2026-11-08T23092";
import { guardViewportWidth } from "./device-guard.js?v=v2026-11-08T23092";
import "./scroll-fade.js?v=v2026-11-08T23092"; // wygaszona krawędź przewijanych list (wszystkie strony)
import "./fit-row.js?v=v2026-11-08T23092"; // wiersze przycisków bez zawijania (.fit-row)

// Dotyk (telefon, tablet): bez chwytania i przeciągania elementów (decyzja
// użytkownika 2026-10-20). Każde przeciąganie ma odpowiednik w przyciskach
// (scalanie w podliczaniu, strzałki rund, kliknięcie w finale, menu w Eksploratorze).
// Dotyk: data-input na <html> (core/device-attrs.js, pierwszy moduł strony).
if (globalThis.document?.documentElement?.dataset.input === "touch") {
  globalThis.document?.addEventListener("dragstart", (e) => e.preventDefault(), true);
}

async function loadDeps() {
  const [auth, topbar, sheet, device] = await Promise.all([
    import("./auth.js?v=v2026-11-08T23092"),
    import("./topbar-controller.js?v=v2026-11-08T23092"),
    import("./modal-sheet.js?v=v2026-11-08T23092"),
    import("./device-guard.js?v=v2026-11-08T23092"),

  ]);
  return {
    getUser: auth.getUser,
    requireAuth: auth.requireAuth,
    setTopbarAccount: topbar.setTopbarAccount,
    handleSheetBack: sheet.handleSheetBack,
    guardViewportWidth: device.guardViewportWidth,
    getDeviceProfile: device.getDeviceProfile,
    showAccountNotices,
  };
}

// Jednorazowe komunikaty konta (informacja dla gościa, potem prośba o ocenę
// -- dla kont i gości), wspólne dla stron z kontem. Ładowane leniwie;
// w testach podmieniane w deps.
async function showAccountNotices(user) {
  if (!user) return;
  if (isGuestUser(user)) {
    const { maybeShowGuestInfoModal } = await import("./guest-info-modal.js?v=v2026-11-08T23092");
    await maybeShowGuestInfoModal(user);
  }
  const { initRatingSystem } = await import("./rating-system.js?v=v2026-11-08T23092");
  await initRatingSystem(user);
}

function elementOf(ref, defaultId) {
  if (ref === false) return null;
  if (ref && typeof ref === "object") return ref;
  return document.getElementById(ref || defaultId);
}

function wireBack(id, user, opts, d) {
  const btn = elementOf(opts.back, "btnBack");
  if (!btn) return;
  const ctx = () => ({ anon: !user });
  btn.dataset.sheetBack = "1"; // znacznik dla contact-modal.js
  if (btn.tagName === "A") {
    const sync = () => {
      const href = backHref(id, ctx());
      if (href) btn.setAttribute("href", href);
    };
    sync();
    window.addEventListener("i18n:lang", sync);
  }
  if (opts.backLabel !== false) renderBackLabel(btn, id, ctx);
  btn.addEventListener("click", async (ev) => {
    if (btn.tagName === "A" && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0)) return;
    ev.preventDefault?.();
    if (d.handleSheetBack()) return;
    const href = backHref(id, ctx());
    if (opts.onBack) { await opts.onBack(href, ev); return; }
    if (href) location.href = href;
  });
}

function presetLinks(id, opts) {
  const btn = elementOf(opts.back, "btnBack");
  const href = btn?.tagName === "A" ? backHref(id, { anon: true }) : null; // bez ret: rodzic publiczny
  if (href) btn.setAttribute("href", href);
  // Linki przycisków mapy (np. „Polityka prywatności” we Wskazówkach) też od razu
  // z ?ret=; widoczność wg roli rozstrzyga później wireButtons.
  for (const [bid, spec] of Object.entries(PAGES[id].buttons || {})) {
    const link = document.getElementById(bid);
    if (link?.tagName === "A" && !spec.custom && !buttonBlocked(spec)) link.setAttribute("href", buttonHref(spec));
  }
}

function wireManual(id, user, opts) {
  const btn = elementOf(opts.manual, "btnManual");
  if (!btn) return;
  // Publiczne Wskazówki pozostają dostępne także bez konta.
  if (!user && PAGES.manual.access !== "public") { btn.hidden = true; return; }
  if (btn.tagName === "A") {
    const sync = () => btn.setAttribute("href", manualHref(id));
    sync();
    window.addEventListener("i18n:lang", sync);
  }
  btn.addEventListener("click", async (ev) => {
    if (btn.tagName === "A" && (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button > 0)) return;
    ev.preventDefault?.();
    const href = manualHref(id);
    if (opts.onManual) { await opts.onManual(href, ev); return; }
    location.href = href;
  });
}

function hideButton(btn) {
  btn.hidden = true;
  btn.dataset.navHidden = "true"; // przycisk poza rachunkiem „Więcej” w topbarze
}

// Przyciski z PAGES[id].buttons: chowa niedostępne dla roli i urządzenia,
// resztę podpina pod linkTo(). Przycisk, którego strona nie ma w HTML, pomijamy
// (jedna mapa opisuje też warianty strony); spójność mapy z HTML pilnuje test.
function wireButtons(id, user, d) {
  const buttons = PAGES[id].buttons;
  if (!buttons) return;
  const role = roleOf(user, isGuestUser(user));
  for (const [bid, spec] of Object.entries(buttons)) {
    const btn = document.getElementById(bid);
    if (!btn) continue;
    if (!buttonRoles(id, spec).includes(role)) { hideButton(btn); continue; }
    // Przyciski zależne od roli startują ukryte w HTML. Rola jest już
    // rozstrzygnięta, więc dopiero teraz oceniamy wymaganą szerokość.
    if (btn.dataset.navHidden === "true") {
      delete btn.dataset.navHidden;
      btn.hidden = false;
    }
    const updateDeviceVisibility = () => {
      const visible = buttonVisible(id, spec, role, d.getDeviceProfile());
      const wasHidden = btn.dataset.navHidden === "true";
      if (visible === !wasHidden) return;
      if (!visible) hideButton(btn);
      else {
        delete btn.dataset.navHidden;
        btn.hidden = false;
      }
      if (spec.minViewportWidth) {
        window.dispatchEvent?.(new Event("nav:visibilitychange"));
      }
    };
    updateDeviceVisibility();
    if (spec.minViewportWidth) {
      window.addEventListener("resize", updateDeviceVisibility, { passive: true });
      window.addEventListener("orientationchange", updateDeviceVisibility, { passive: true });
    }
    if (spec.blockedUntil) {
      btn.disabled = buttonBlocked(spec);
      if (btn.disabled) {
        btn.dataset.navBlockedUntil = spec.blockedUntil;
        continue;
      }
      delete btn.dataset.navBlockedUntil;
    }
    if (spec.custom) continue;
    btn.dataset.navHref = buttonHref(spec);
    if (btn.tagName === "A") { btn.setAttribute("href", buttonHref(spec)); continue; }
    btn.addEventListener("click", () => { location.href = buttonHref(spec); });
  }
}

function wireAccount(user, opts, d) {
  const apply = () => d.setTopbarAccount(user, {
    loginHref: loginUrl(),
    accountHref: linkTo("account"),
    withAccountSettings: true,
    ...(opts.account || {}),
  });
  apply();
  if (opts.accountOnLang) window.addEventListener("i18n:lang", apply);
}

/**
 * Strona wejścia (wariant „bare”, E23 §6.2): publiczna, bez konta w topbarze —
 * Go, głosowanie, centrum maili, strona główna. Próg urządzenia z PAGES,
 * „i” → Wskazówki (manualHref, po zmianie języka też), topbar i strona
 * odsłonięte po tłumaczeniach (ready) — także gdy tłumaczenia zawiodą.
 */
export async function initEntryPage(id, { ready, route } = {}) {
  const p = PAGES[id];
  if (!p) throw new Error(`initEntryPage: nieznana strona "${id}"`);
  guardViewportWidth({ minWidth: p.minViewportWidth || 0, minHeight: p.minViewportHeight || 0, ...(p.deviceGuard || {}) });
  const btnManual = document.getElementById("btnManual");
  const syncManual = () => btnManual?.setAttribute("href", manualHref(id));
  window.addEventListener("i18n:lang", syncManual);
  try {
    const [language, decision] = await holdPageLayout(Promise.allSettled([ready, route]));
    if (decision.status === "rejected") throw decision.reason;
    if (language.status === "rejected") throw language.reason;
    return !decision.value;
  } finally {
    syncManual();
    document.querySelector(".topbar")?.classList.add("topbar-ready");
    document.documentElement.classList.remove("page-loading");
  }
}

export async function initPage(id, opts = {}) {
  let finishLayout;
  holdPageLayout(new Promise((resolve) => { finishLayout = resolve; }));
  try {
    return await initializePage(id, opts, finishLayout);
  } finally {
    finishLayout();
  }
}

async function initializePage(id, opts, finishLayout) {
  const p = PAGES[id];
  if (!p) throw new Error(`initPage: nieznana strona "${id}"`);
  // Linki topbara (Wskazówki, Prywatność) są klikalne, zanim skończy się
  // sprawdzanie sesji — od razu adresy z mapy (?ret=), nie zapasowe z HTML.
  presetLinks(id, opts);
  const d = opts.deps || await loadDeps();

  // Guard jest pierwszą bramką. Nie pytamy o sesję ani nie odsłaniamy strony,
  // dopóki urządzenie i viewport nie spełniają warunków tej trasy.
  const guard = d.guardViewportWidth({ minWidth: p.minViewportWidth || 0, minHeight: p.minViewportHeight || 0, backHref: backHref(id, { anon: true }), ...(p.deviceGuard || {}), ...opts.deviceGuard });
  if (!(await guard.ready)) return null;

  // Auth startuje dopiero po przejściu guarda; może biec równolegle z i18n.
  const userP = p.access === "public"
    ? Promise.resolve(d.getUser()).catch(() => null)
    : Promise.resolve(d.requireAuth(loginUrl(), { fresh: !!p.freshUser }));
  userP.catch(() => {});
  if (opts.ready) await opts.ready;

  const user = (await userP) || null;
  // requireAuth przekierował (brak sesji / brak nazwy użytkownika) — nic więcej.
  if (!user && p.access !== "public") return null;
  setModalSheetPage(id);

  // Topbar działa także pod nakładką — „Wstecz” jest wtedy wyjściem.
  wireBack(id, user, opts, d);
  wireManual(id, user, opts);
  wireButtons(id, user, d);
  wireAccount(user, opts, d);
  if (user && !isGuestUser(user)) {
    const targets = [...new Set(Object.values(p.buttons || {})
      .filter((spec) => ["friends", "subscribers"].includes(spec.to))
      .map((spec) => spec.to))];
    if (targets.length) {
      void import("./nav-contact-badges.js?v=v2026-11-08T23092")
        .then(({ initNavContactBadges }) => initNavContactBadges(targets))
        .catch((error) => console.warn("[nav] contact badge refresh failed", error));
    }
  }
  if (!opts.deferTopbarReady) document.querySelector(".topbar")?.classList.add("topbar-ready");

  if (p.access === "user" && isGuestUser(user)) {
    if (p.guestRedirect) {
      redirectPage(linkTo(p.guestRedirect));
      return null;
    }
    showPageGuard({
      kind: "guest",
      state: "guest",
      iconName: "person",
      titleKey: "pageGuard.guestTitle",
      messageKey: "pageGuard.guestMessage",
      backHref: backHref(id, { anon: false }),
      loginHref: loginUrl({ forceAuth: true }),
    });
    return null;
  }

  finishLayout();

  // Account notices are shared across authenticated pages, not tied to the
  // Games library. Await the same blocking modal flow everywhere so users
  // don't miss a one-time notice while the page continues initializing.
  if (!new Set(["login", "privacy", "mailCenter", "connectDevice"]).has(id)) {
    await d.showAccountNotices(user);
  }

  return user;
}
