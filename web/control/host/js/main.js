// control/host/js/main.js
// Napisane od zera (nie kopia js/pages/host.js) — mniej tu do zrobienia niż
// w Display, bo Host nie ma własnego silnika rysowania: to render.js robi
// operacje DOM wprost na podstawie wiersza game_state. Gest przesunięcia
// (peek na pasmo 2) zostaje jako czysto lokalna wygoda — patrz komentarz w
// render.js — nie próbowaliśmy tu odtwarzać dokładnej matematyki CSS
// snap-to-grid z dzisiejszego host.js (kosmetyka do dostrojenia wizualnie
// później, nie architektura).

import { initI18n, setUiLang } from "../../../shared/translation/translation.js?v=v2026-11-03T22214";
import { startKeepAlive } from "../../../shared/js/core/keep-alive.js?v=v2026-11-03T22214";
import { initWakePrompt } from "../../../shared/js/core/wake-prompt.js?v=v2026-11-03T22214";
import { guardViewportWidth } from "../../../shared/js/core/device-guard.js?v=v2026-11-03T22214";

import { createSubscription } from "../../../shared/js/core/game-state-subscribe.js?v=v2026-11-03T22214";
import { createHostRenderer } from "./render.js?v=v2026-11-03T22214";
import { createCoverLogoRenderer } from "./coverLogo.js?v=v2026-11-03T22214";
import { createHostThemeApplier } from "./hostThemeManager.js?v=v2026-11-03T22214";
import { createDeviceLease, updateDeviceLeaseOverlay } from "../../../shared/js/core/device-lease.js?v=v2026-11-03T22214";
import { initFullscreenButton } from "../../../shared/js/core/fullscreen.js?v=v2026-11-03T22214";
import { setShift } from "../../../shared/js/core/geometry.js?v=v2026-11-03T22214";

function parseParams() {
  const u = new URL(location.href);
  return { gameId: u.searchParams.get("id") || "", key: u.searchParams.get("key") || "", preview: u.searchParams.get("preview") === "1" };
}

// css/host.css pozycjonuje .text (paperText1/2) jako position:absolute, a
// jego left/right SĄ ZDEFINIOWANE WYŁĄCZNIE pod selektorami
// `html.portrait .pane1 .text`/`html.landscape .pane1 .text` — bez tej
// klasy na <html> tekst nie ma żadnego left/right w ogóle. To nie kosmetyka
// do dostrojenia później, tylko wymóg funkcjonalny, żeby cokolwiek się
// wyświetliło (znalezione przez pierwszy przebieg control2-pairing.spec.js
// na żywo: #paperText1 istniał w DOM, ale toBeVisible() padało — zero
// wymiarów bez tej klasy).
function setupOrientationClass() {
  function apply() {
    const portrait = window.innerHeight >= window.innerWidth;
    document.documentElement.classList.toggle("portrait", portrait);
    document.documentElement.classList.toggle("landscape", !portrait);

    // html.landscape .pane1 .text czyta --host-outer-left/--host-outer-right (patrz
    // css/host.css) — bez nich left/right w landscape jest niepoprawnym
    // calc() i cała reguła pozycjonująca zostaje zignorowana.
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const safeL = parseFloat(cs.getPropertyValue("--host-safe-left")) || 0;
    const safeR = parseFloat(cs.getPropertyValue("--host-safe-right")) || 0;
    if (!portrait) {
      root.style.setProperty("--host-outer-left", `${safeL}px`);
      root.style.setProperty("--host-outer-right", `${safeR}px`);
    } else {
      root.style.setProperty("--host-outer-left", "0px");
      root.style.setProperty("--host-outer-right", "0px");
    }
  }
  apply();
  window.addEventListener("resize", apply);
}

function setupResponsivePaper() {
  const root = document.documentElement;
  const { preview } = parseParams();
  const panes = [
    [document.querySelector(".pane1"), document.getElementById("lineGrid1")],
    [document.querySelector(".pane2"), document.getElementById("lineGrid2")],
  ].filter(([pane, grid]) => pane && grid);
  const renderedCounts = new WeakMap();
  const scrollBound = new WeakSet();

  function update() {
    // Ta sama bazowa wysokość wiersza dla obu orientacji; na małym ekranie
    // ogranicza ją krótszy bok i pionowa przestrzeń, a na tablecie rośnie.
    // Podgląd (mały iframe w Control i ustawieniach gry) to pomniejszony
    // ekran urządzenia — bez progu 15 px, który robił tam za dużą czcionkę.
    const line = Math.max(preview ? 0 : 15, Math.min(34, window.innerWidth * 0.042, window.innerHeight / 24));
    root.style.setProperty("--host-line", `${line}px`);
    // Tekst zaczyna się na granicy wiersza siatki. Linie same pozostają
    // rozciągnięte od krawędzi do krawędzi, także przez safe area.
    for (const [id, property] of [
      ["paperText1", "--host-text-top-1"],
      ["paperText2", "--host-text-top-2"],
    ]) {
      const el = document.getElementById(id);
      if (!el) continue;
      root.style.removeProperty(property);
      const computedTop = parseFloat(getComputedStyle(el).top);
      if (!Number.isFinite(computedTop)) continue;
      root.style.setProperty(property, `${Math.ceil(computedTop / line) * line}px`);
    }
    for (const [pane, grid] of panes) {
      const rows = Math.ceil(pane.clientHeight / line) + 1;
      if (renderedCounts.get(grid) !== rows) {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < rows; i++) fragment.appendChild(document.createElement("span"));
        grid.replaceChildren(fragment);
        renderedCounts.set(grid, rows);
      }
      const text = pane.querySelector(".text");
      if (text) {
        const syncScroll = () => {
          const activeLine = parseFloat(getComputedStyle(root).getPropertyValue("--host-line")) || line;
          setShift(grid, { y: -(text.scrollTop % activeLine) });
        };
        if (!scrollBound.has(text)) {
          text.addEventListener("scroll", syncScroll, { passive: true });
          scrollBound.add(text);
        }
        syncScroll();
      }
    }
  }

  update();
  const observer = new ResizeObserver(update);
  panes.forEach(([pane]) => observer.observe(pane));
  window.addEventListener("resize", update, { passive: true });
  window.visualViewport?.addEventListener("resize", update, { passive: true });
}

// ZGŁOSZONY, REALNY BUG (nie tylko test): było `renderer.setPeek(!renderer.isCovered())`.
// isCovered() = authoritativeCovered && !peeked -- na starcie gestu, gdy
// zasłona jest aktywna i peeked=false, isCovered() JUŻ zwraca true, więc
// !isCovered() dawało false -> setPeek(false) -> peeked zostawało false,
// BEZ ŻADNEJ ZMIANY. Gest nigdy nie mógł zadziałać za pierwszym razem w
// dokładnie tej sytuacji, w której operator chce go użyć (zakryte, chce
// odkryć). Poprawka: przełączaj WŁASNY stan peeked (isPeeked()), nie
// wypadkową authoritativeCovered+peeked.
function setupPeekSwipe(renderer) {
  let sx = 0, sy = 0, active = false;
  const MIN = 60;
  document.addEventListener("pointerdown", (e) => {
    const inText = e.target.closest?.(".text");
    if (inText && document.documentElement.classList.contains("portrait")) { active = false; return; }
    sx = e.clientX; sy = e.clientY; active = true;
  }, { passive: true });
  document.addEventListener("pointerup", (e) => {
    if (!active) return;
    active = false;
    if (!renderer.isCoverableAtAll()) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.hypot(dx, dy) < MIN) return;
    renderer.setPeek(!renderer.isPeeked());
  }, { passive: true });
  document.addEventListener("pointercancel", () => { active = false; }, { passive: true });
}

async function main() {
  await initI18n({ withSwitcher: false });
  const controlTestFrame = window.parent !== window
    && window.frameElement?.dataset.controlTestMode === "true";
  const { gameId, key, preview } = parseParams();
  const deviceGate = preview || controlTestFrame ? null : guardViewportWidth({
    minWidth: 0,
    formFactors: null,
    requiresTouch: !controlTestFrame,
    allowPhoneLandscape: true,
  });
  document.documentElement.removeAttribute("data-device-guard-pending");
  if (deviceGate && deviceGate.state() !== "ok") await deviceGate.ready;
  setupOrientationClass();
  setupResponsivePaper();
  document.documentElement.classList.remove("page-loading");

  if (preview) {
    // Podgląd w Control/ustawieniach gry — bez przycisku pełnego ekranu.
    document.getElementById("btnFullscreen")?.remove();
    document.documentElement.toggleAttribute("data-preview", true); // host.css: bez progów px
    const renderer = createHostRenderer();
    const coverLogo = createCoverLogoRenderer({ previewOnly: true });
    let latestRow = null;
    const hostThemePromise = createHostThemeApplier().catch(error => {
      console.warn("[host2] preview theme unavailable:", error);
      return null;
    });
    window.addEventListener("message", event => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "familijna:preview-row") return;
      const row = event.data.row;
      if (!row?.detail?.display) return;
      // The preview only paints the supplied snapshot. Show the paper as soon
      // as its text is rendered; optional theme/logo work must not keep the
      // preview surface (or the parent page) waiting.
      latestRow = row;
      renderer.render(row);
      document.getElementById("paper")?.classList.add("skel-step-ready");
      void (async () => {
        try {
          const hostTheme = await hostThemePromise;
          if (latestRow !== row) return;
          await hostTheme?.apply(row);
          await coverLogo.apply(row);
        } catch (error) {
          console.warn("[host2] preview decoration failed:", error);
        }
      })();
    });
    if (window.parent !== window) window.parent.postMessage({ type: "familijna:host-preview-ready" }, location.origin);
    return;
  }
  initFullscreenButton({ button: document.getElementById("btnFullscreen"), a2hs: document.getElementById("hostA2HS"), a2hsClose: document.getElementById("hostA2HSClose") });

  const loadError = document.getElementById("deviceLoadError");
  document.querySelector("[data-retry-device]")?.addEventListener("click", () => location.reload());
  if (!gameId || !key) {
    if (loadError) loadError.hidden = false;
    document.getElementById("paper")?.classList.add("skel-step-ready");
    return;
  }

  // Wszystkie trzy urządzenia utrzymują ekran aktywny przez Wake Lock
  // oraz zapasowy, wyciszony strumień wideo. Podgląd w ustawieniach nie.
  startKeepAlive();
  // iPhone/iPad: blokada wygaszania wymaga dotknięcia (wake-prompt.js).
  initWakePrompt();
  let subscription = null;
  const lease = createDeviceLease({ gameId, deviceType: "host", key, onState: ({ state }) => {
    updateDeviceLeaseOverlay(state);
    if (subscription) {
      if (state === "primary") void subscription.start();
      else subscription.stop();
    }
  } });
  await lease.start();
  updateDeviceLeaseOverlay(lease.state);
  const renderer = createHostRenderer();
  // Zmiana orientacji w locie (obrót tabletu) ma przeliczyć podpowiedź
  // przesunięcia (portrait/landscape mają inny kierunek) -- dokładnie jak
  // stare js/pages/host.js's window.addEventListener("resize", ...).
  // setupOrientationClass() (niżej) już nasłuchuje na resize dla samego
  // --host-outer-left/--host-outer-right; ten listener jest celowo osobny, bo
  // renderer jeszcze nie istnieje w momencie jej wywołania.
  window.addEventListener("resize", () => renderer.updateSwipeHint());
  window.addEventListener("i18n:lang", () => renderer.updateSwipeHint());
  const coverLogo = createCoverLogoRenderer({ gameId, key });
  coverLogo.apply({ step:null, detail:{} });
  const hostTheme = await createHostThemeApplier();
  setupPeekSwipe(renderer);

  let appliedLang = null;
  let initialStateReady = false;
  subscription = createSubscription({
    gameId, deviceType: "host", key,
    getLeaseArgs: () => lease.actionArgs(),
    beforeResync: () => lease.refresh(),
    log: lease.log,
    onRow: async (row) => {
      lease.setProgress({ receivedRev: Number(row.rev) || 0 });
      // Język idzie za operatorem w Control (patrz control/display/js/main.js —
      // ta sama zasada). render.js's pasmo 1/2 JEST tłumaczone przez t()
      // (roundTitle()/renderFinalMapping() używają rh()/fh()) — ale
      // setUiLang() ładuje słownik asynchronicznie, więc bez await
      // renderer.render(row) niżej potrafił wystartować PRZED podmianą
      // słownika i namalować tytuł jeszcze starym językiem (zauważone na
      // żywo: zmiana na "en" nie zmieniała od razu treści paperText1).
      const lang = row.detail?.settings?.uiLang;
      if (lang && lang !== appliedLang) {
        // appliedLang ustawiane DOPIERO po sukcesie -- jeśli setUiLang()
        // rzuci (np. przejściowy błąd sieci przy dynamicznym imporcie
        // słownika), appliedLang zostaje niezmienione, więc kolejny wiersz
        // z tym samym lang spróbuje ponownie zamiast utknąć na zawsze w
        // starym języku (wcześniej appliedLang=lang szło PRZED await, a
        // .catch(()=>{}) po cichu połykał błąd bez retry).
        try {
          await setUiLang(lang, { persist: true, updateUrl: true, apply: true });
          appliedLang = lang;
        } catch (e) {
          console.warn("[host2] setUiLang nie powiodło się, spróbuję ponownie przy kolejnym wierszu:", e);
        }
      }
      await hostTheme.apply(row);
      renderer.render(row);
      coverLogo.apply(row);
      lease.setProgress({ renderedRev: Number(row.rev) || 0 });
      initialStateReady = true;
      if (loadError) loadError.hidden = true;
      document.getElementById("paper")?.classList.add("skel-step-ready");
    },
    onError: (error) => {
      console.warn("[host2] game_state_get failed:", error);
      if (!initialStateReady && loadError) loadError.hidden = false;
      document.getElementById("paper")?.classList.add("skel-step-ready");
    },
  });
  if (lease.state === "primary") await subscription.start();
}

main();
