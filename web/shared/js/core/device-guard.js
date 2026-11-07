// js/core/device-guard.js
// Wspólna reguła „jakie to urządzenie” + blokada stron, które potrzebują
// szerokiego ekranu (Control, ustawienia gry). Nakładka jest wspólna z
// blokadą gościa (page-overlay.js), teksty: pageGuard.*; „Wróć” prowadzi na
// backHref z mapy nawigacji (bez history.back() i referrera).
//
// Typ urządzenia, orientacja i dostępna szerokość są osobnymi cechami. Typ
// wynika z ekranu dotykowego i krótszego boku ekranu; orientacja oraz to,
// czy konkretna funkcja się mieści, wynikają z bieżącego viewportu. Obrót
// nie zmienia typu urządzenia, ale może udostępnić funkcję wymagającą miejsca.
//
// Wysokość (decyzja użytkownika 2026-10-22): strony robocze mają też próg
// wysokości viewportu (nav-map: minViewportHeight). Sprawdzany tylko w
// poziomie — w pionie układ jest jednokolumnowy i przewija się. Za niski
// poziomy widok to „obróć urządzenie”, gdy obrót pomoże (dotykowy telefon
// lub tablet, a w pionie strona się mieści), w innym razie „Za małe okno”
// (komputer, telewizor albo strona, której obrót nie pomoże, np. próg 980 px).

import { hidePageGuard, showPageGuard } from "./page-overlay.js?v=v2026-11-07T20215";


import "./page-boot.js?v=v2026-11-07T20215";
export const { getDeviceProfile, editableFocused, PHONE_MAX_SHORT_SIDE } = globalThis.FamilijnaDevice;
const { keyboardLikely, KEYBOARD_CLOSE_MS } = globalThis.FamilijnaDevice;
export const MIN_WORK_WIDTH = 980;
export const MIN_WORK_HEIGHT = 580;
export const TV_HD_RESOLUTION = Object.freeze({ width: 1280, height: 720 });

/** Czy format urządzenia to telefon; niezależne od viewportu i orientacji. */
export function isPhoneScreen() {
  return getDeviceProfile().formFactor === "phone";
}

/**
 * Kolejność decyzji: fizyczne możliwości ekranu → wymagany sposób wejścia →
 * dozwolona kategoria → szerokość viewportu i obrót, jeśli ten rozwiązuje brak
 * miejsca. Komputery i TV nigdy nie dostają sugestii obrotu.
 */
export function deviceGuardState(minWidth = MIN_WORK_WIDTH, options = {}) {
  return phoneGuardState(rawGuardState(minWidth, options), getDeviceProfile());
}

// Telefon (decyzja użytkownika 2026-10-20): albo obrót, jeśli pomoże, albo
// „Niedostępne na telefonie” -- także gdy ekran jest za mały („screen”) lub
// widok za wąski/niski („narrow”, „small”): telefonu nie da się poszerzyć ani
// wymienić ekranu.
function phoneGuardState(state, profile) {
  return profile.formFactor === "phone" && (state === "screen" || state === "narrow" || state === "small") ? "unsupported" : state;
}

// Klawiatura ekranowa (dotyk + aktywne pole tekstowe, także chwilę po utracie
// fokusu, gdy się zamyka) potrafi obniżyć viewport; to nie jest za małe okno,
// więc wtedy wysokości nie sprawdzamy.
function virtualKeyboardLikely(profile) {
  return profile.touch && keyboardLikely();
}

/** Poziomy viewport niższy niż próg strony (pion nie ma progu wysokości). */
function tooShort(profile, minHeight) {
  return minHeight > 0 && profile.orientation === "landscape" && profile.viewportHeight < minHeight
    && !virtualKeyboardLikely(profile);
}

// Obrót pomaga na zbyt niski poziomy widok tylko na dotykowym telefonie lub
// tablecie, gdy w pionie strona jest dozwolona, a jej próg szerokości mieści
// się w krótszym boku ekranu (w pionie wysokości nie sprawdzamy).
function rotationFixesHeight(profile, minWidth, { requirePhoneLandscape = false } = {}) {
  if (profile.formFactor !== "tablet" && profile.formFactor !== "phone") return false;
  if (profile.formFactor === "phone" && requirePhoneLandscape) return false;
  return profile.screenShortSide >= minWidth;
}

function rawGuardState(minWidth, { formFactors = null, requiresTouch = false, minScreenShortSide = 0, minTvResolution = false, allowPhoneLandscape = false, requirePhoneLandscape = false, minHeight = 0 } = {}) {
  const profile = getDeviceProfile();
  // Physical screen limits take precedence over category exclusions. The
  // short-side threshold is for touch-first devices only (for example, a
  // large-tablet layout); desktop monitors remain governed by usable width.
  if (minScreenShortSide && profile.touch && profile.screenShortSide < minScreenShortSide) return "screen";
  if (minWidth > 0 && minWidth > profile.screenLongSide) return "screen";
  if (minTvResolution && profile.isTv) {
    const pxLong = Math.max(profile.screenPixelWidth, profile.screenPixelHeight);
    const pxShort = Math.min(profile.screenPixelWidth, profile.screenPixelHeight);
    if (pxLong < TV_HD_RESOLUTION.width || pxShort < TV_HD_RESOLUTION.height) return "screen";
  }
  if (requiresTouch && !profile.touch) return "touch";
  if (formFactors && !formFactors.includes(profile.formFactor)) return "unsupported";
  if (!allowPhoneLandscape && profile.formFactor === "phone" && profile.orientation === "landscape") return "rotate";
  if (requirePhoneLandscape && profile.formFactor === "phone" && profile.orientation === "portrait") return "rotate";
  // W widoku dzielonym tabletu viewport może zajmować tylko górną lub boczną
  // część ekranu. Taki obszar nie powinien być traktowany jak pełny tablet;
  // telefon w landscape pozostaje osobną regułą powyżej. Strona bez progu
  // szerokości (minWidth 0, np. Wskazówki, listy) działa w każdym widoku.
  if (minWidth > 0 && profile.formFactor === "tablet") {
    // Klawiatura ekranowa może obniżyć okno (przeglądarki bez resizes-visual), ale to nie jest
    // widok dzielony (blokada po otwarciu klawiatury, zgłoszenie 2026-10-29).
    const shortSide = profile.screenShortSide;
    const splitHeight = profile.viewportHeight < shortSide * 0.7 && !virtualKeyboardLikely(profile);
    const splitWidth = profile.orientation === "landscape"
      && profile.viewportWidth < shortSide * 0.85;
    if (splitHeight || splitWidth) return "narrow";
  }
  if (profile.viewportWidth >= minWidth) {
    if (tooShort(profile, minHeight)) return rotationFixesHeight(profile, minWidth, { requirePhoneLandscape }) ? "rotate" : "small";
    return "ok";
  }
  // Consider rotation only for a full-width portrait phone/tablet viewport.
  // A split-view tablet has a substantially reduced width; rotating its pane
  // is not a reliable way to obtain the full physical screen width.
  // Telefon w poziomie blokuje reguła wyżej, chyba że strona go dopuszcza —
  // bez tego obrót prowadziłby do kolejnej prośby o obrót.
  const fullPortraitViewport = profile.viewportWidth >= profile.screenShortSide * 0.85;
  const canRotate = profile.formFactor === "tablet" || (profile.formFactor === "phone" && allowPhoneLandscape);
  if (canRotate
      && profile.orientation === "portrait"
      && fullPortraitViewport
      && profile.viewportHeight >= minWidth) return "rotate";
  return "narrow";
}

const TEXTS = {
  unsupported: { title: "pageGuard.phoneTitle", message: "pageGuard.phoneMessage", icon: "phone" },
  screen: { title: "pageGuard.screenTitle", message: "pageGuard.screenMessage", icon: "fullscreen-enter" },
  touch: { title: "pageGuard.touchTitle", message: "pageGuard.touchMessage", icon: "phone" },
  rotate: { title: "pageGuard.rotateTitle", message: "pageGuard.rotateMessage", icon: "rotate-right" },
  narrow: { title: "pageGuard.narrowTitle", message: "pageGuard.narrowMessage", icon: "fullscreen-enter" },
  small: { title: "pageGuard.smallTitle", message: "pageGuard.smallMessage", icon: "fullscreen-enter" },
  tvUnsupported: { title: "pageGuard.tvUnsupportedTitle", message: "pageGuard.tvUnsupportedMessage", icon: "display" },
};

export function showDeviceGuard(state, backHref, messageKey = null) {
  const profile = getDeviceProfile();
  const tvUnsupported = state === "unsupported" && profile.formFactor === "tv";
  const txt = tvUnsupported
    ? TEXTS.tvUnsupported
    : TEXTS[state] || TEXTS.unsupported;
  // Obrót rozwiązuje blokadę bez opuszczania bieżącej strony, więc nie
  // pokazuj nieużytecznego przycisku „Wróć” przy żadnym guardzie rotate.
  showPageGuard({
    kind: "device",
    state,
    iconName: txt.icon,
    titleKey: txt.title,
    messageKey: messageKey || txt.message,
    backHref: state === "rotate" || tvUnsupported ? null : backHref,
    loginHref: tvUnsupported ? null : undefined,
    redirectHref: tvUnsupported ? "/connect/?tv=1" : null,
    redirectDelayMs: tvUnsupported ? 3000 : 0,
  });
}

/**
 * Strona wymaga minimalnej szerokości (i w poziomie wysokości): guard reaguje
 * na resize, obrót i zmianę powiększenia (visualViewport).
 */
export function guardViewportWidth({ minWidth = MIN_WORK_WIDTH, minHeight = 0, backHref = null, fits = null, fitsAfterRotate = null, messageKey = null, rotateMessageKey = null, formFactors = null, requiresTouch = false, minScreenShortSide = 0, minTvResolution = false, allowPhoneLandscape = false, requirePhoneLandscape = false } = {}) {
  const currentState = () => {
    let state = deviceGuardState(minWidth, { formFactors, requiresTouch, minScreenShortSide, minTvResolution, allowPhoneLandscape, requirePhoneLandscape, minHeight });
    const profile = getDeviceProfile();
    const rotationCanHelp = (profile.formFactor === "tablet" || (profile.formFactor === "phone" && allowPhoneLandscape))
      && profile.orientation === "portrait"
      && profile.viewportWidth >= profile.screenShortSide * 0.85
      && typeof fitsAfterRotate === "function"
      && fitsAfterRotate();
    if (state === "rotate" && fitsAfterRotate && !rotationCanHelp) state = "narrow";
    // Własny pomiar strony (Control: skala panelu) obejmuje szerokość i wysokość,
    // więc niedopasowanie to „Za małe okno”, nie „Za wąskie okno”.
    if (state === "ok" && fits && !fits()) state = rotationCanHelp ? "rotate" : "small";
    return phoneGuardState(state, profile);
  };
  function apply() {
    const state = currentState();
    if ((state === "narrow" || state === "small") && messageKey) {
      showPageGuard({ kind: "device", state, iconName: "fullscreen-enter", titleKey: TEXTS[state].title, messageKey, backHref });
    } else if (state === "rotate" && rotateMessageKey) showDeviceGuard(state, backHref, rotateMessageKey);
    else if (state !== "ok") showDeviceGuard(state, backHref);
    else if (document.getElementById("pageGuard")?.dataset.kind !== "guest") hidePageGuard();
    document.documentElement.dataset.deviceGuard = state;
    // Guard jest końcowym, widocznym stanem zablokowanej nawigacji. Zdejmujemy
    // ukrywanie startowe po pokazaniu nakładki; page-overlay ukrywa body, więc
    // sekcje strony nadal nie są odsłonięte ani ładowane przed decyzją guarda.
    if (state !== "ok") document.documentElement.classList.remove("page-loading");
    // Usuń wczesną blokadę (inline script w <head>) — guard przejął kontrolę
    document.documentElement.removeAttribute("data-mobile-guard");
  }

  let resolveReady;
  let readyResolved = false;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const refresh = () => {
    apply();
    if (!readyResolved && currentState() === "ok") {
      readyResolved = true;
      resolveReady?.(true);
    }
  };
  const onOrientationChange = () => setTimeout(refresh, 250);
  window.addEventListener("resize", refresh);
  window.addEventListener("orientationchange", onOrientationChange);
  window.visualViewport?.addEventListener("resize", refresh, { passive: true });
  // Po zamknięciu klawiatury ekranowej (utrata fokusu pola i czas na powrót
  // okna do pełnej wysokości) próg wysokości i orientacja z okna znów obowiązują.
  document.addEventListener("focusout", () => setTimeout(refresh, KEYBOARD_CLOSE_MS + 50));
  refresh();

  return { refresh, state: currentState, ready };
}
