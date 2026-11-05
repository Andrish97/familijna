// Wspólny start przed pierwszym renderem. Klasyczny skrypt w head, po meta viewport.
// Ta sama klasyfikacja służy CSS, guardowi i późniejszym aktualizacjom modułów.
(() => {
  if (globalThis.FamilijnaDevice) return;
  const PHONE_MAX_SHORT_SIDE = 700;
  function screenSides() {
    const w = window.screen?.width || window.innerWidth;
    const h = window.screen?.height || window.innerHeight;
    return { short: Math.min(w, h), long: Math.max(w, h) };
  }

  const isTouch = () => navigator.maxTouchPoints > 0 || !!window.matchMedia?.("(pointer: coarse)").matches;

  function isEditable(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    return tag === "input" && !/^(button|checkbox|radio|range|color|file|submit|reset|image|hidden)$/i.test(el.type || "");
  }

  /** Aktywne pole tekstowe (klawiatura ekranowa na dotyku może być otwarta). */
  function editableFocused() {
    return typeof document !== "undefined" && isEditable(document.activeElement);
  }

  // Zamykanie klawiatury: pole traci fokus, zanim okno wróci do pełnej
  // wysokości. Przez tę chwilę niskie okno nie jest „za małym oknem”,
  // a tablet w pionie nie jest poziomy („Obróć urządzenie” mignięciem przy
  // zamykaniu klawiatury, zgłoszenie 2026-10-29).
  const KEYBOARD_CLOSE_MS = 1000;
  let editableBlurAt = -Infinity;
  if (typeof document !== "undefined") {
    document.addEventListener("focusout", (event) => {
      if (isEditable(event.target)) editableBlurAt = Date.now();
    }, true);
  }

  /** Klawiatura ekranowa może być otwarta albo właśnie się zamyka. */
  function keyboardLikely() {
    return editableFocused() || Date.now() - editableBlurAt < KEYBOARD_CLOSE_MS;
  }

  // Orientacja z ekranu, nie z okna, gdy klawiatura może być otwarta:
  // klawiatura obniża okno i telefon w pionie wyglądałby na poziomy
  // („Obróć urządzenie” w trakcie pisania, zgłoszenie 2026-10-24).
  function screenOrientation() {
    const type = window.screen?.orientation?.type;
    if (type) return type.startsWith("landscape") ? "landscape" : "portrait";
    const w = window.screen?.width, h = window.screen?.height;
    return w && h ? (w >= h ? "landscape" : "portrait") : null;
  }

  function getDeviceProfile() {
    const { short, long } = screenSides();
    const hasTouch = isTouch();
    const primaryCoarse = !!window.matchMedia?.("(pointer: coarse)").matches;
    const primaryHover = !!window.matchMedia?.("(hover: hover)").matches;
    // A touchscreen laptop usually has a fine, hover-capable primary pointer;
    // a phone/tablet is normally operated through a coarse, non-hover pointer.
    const touch = primaryCoarse && !primaryHover || (!window.matchMedia && hasTouch);
    const width = window.innerWidth;
    const height = window.innerHeight;
    const isTv = /SmartTV|SMART-TV|Tizen|web0s|WebOS|HbbTV|BRAVIA|Android TV|GoogleTV|Roku|Viera|NetCast/i.test(navigator.userAgent || "");
    const dpr = window.devicePixelRatio || 1;
    const screenWidth = Number(window.screen?.width) || width;
    const screenHeight = Number(window.screen?.height) || height;
    return {
      formFactor: isTv ? "tv" : touch ? (short < PHONE_MAX_SHORT_SIDE ? "phone" : "tablet") : "desktop",
      orientation: (touch && keyboardLikely() && screenOrientation()) || (width >= height ? "landscape" : "portrait"),
      viewportWidth: width,
      viewportHeight: height,
      screenShortSide: short,
      screenLongSide: long,
      screenPixelWidth: Math.round(screenWidth * dpr),
      screenPixelHeight: Math.round(screenHeight * dpr),
      touch,
      hasTouch,
      isTv,
    };
  }

  const NARROW_MAX = 600;

  function deviceLayout(profile = getDeviceProfile()) {
    const narrow = profile.viewportWidth <= NARROW_MAX;
    return {
      device: profile.formFactor,
      input: profile.touch ? "touch" : "pointer",
      orientation: profile.orientation,
      compact: profile.formFactor === "phone" || narrow,
      sheet: (profile.touch && profile.formFactor !== "tv") || narrow,
    };
  }


  // Motyw (decyzja 2026-11-03, familijna-server/docs/jasny-motyw-plan.md):
  // wybór „auto” | „light” | „dark” w localStorage (uiTheme); „auto” wg systemu.
  // Ustawiany przed pierwszą klatką. Ekrany gry (<html data-theme-lock>) są ciemne.
  const THEME_KEY = "uiTheme";
  const THEME_CHOICES = ["auto", "light", "dark"];
  const THEME_BG = { light: "#f3f0e8", dark: "#050914" };
  function setupTheme(root) {
    const locked = !!root.hasAttribute?.("data-theme-lock");
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const readChoice = () => {
      if (locked) return "dark";
      try {
        const stored = localStorage.getItem(THEME_KEY);
        return THEME_CHOICES.includes(stored) ? stored : "auto";
      } catch { return "auto"; }
    };
    let choice = readChoice();
    const resolve = () => choice === "auto" ? (media?.matches ? "light" : "dark") : choice;
    // Kolor paska systemu (Android) wg motywu. Strona bez własnej mety dostaje
    // ją tutaj — inaczej przeglądarka brała ciemny theme_color z manifestu.
    const paintMeta = () => {
      if (typeof document.querySelector !== "function") return;
      let meta = document.querySelector('meta[name="theme-color"]');
      // Tworzymy dopiero po sparsowaniu <head> — wcześniej meta strony jeszcze nie istnieje.
      if (!meta && document.readyState !== "loading" && document.head && typeof document.createElement === "function") {
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.appendChild(meta);
      }
      if (meta) meta.setAttribute("content", THEME_BG[root.dataset.theme] || THEME_BG.dark);
    };
    const apply = () => {
      const theme = resolve();
      if (root.dataset.theme === theme) return theme;
      root.dataset.theme = theme;
      paintMeta();
      if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("theme:change", { detail: { theme, choice } }));
      return theme;
    };
    // Zmiana w trakcie pracy: przenikanie starego i nowego wyglądu (View
    // Transitions, decyzja 2026-11-03). Bez wsparcia przeglądarki albo przy
    // „ogranicz ruch” — od razu. Pierwsze ustawienie (przed klatką) bez animacji.
    const applyAnimated = () => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (resolve() === root.dataset.theme || reduce || typeof document.startViewTransition !== "function" || document.visibilityState === "hidden") {
        apply();
        return;
      }
      document.startViewTransition(() => { apply(); });
    };
    apply();
    // meta theme-color stoi w head po tym skrypcie — kolor po sparsowaniu.
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintMeta, { once: true });
    if (locked) { globalThis.FamilijnaTheme = { getChoice: () => "dark", getTheme: () => "dark", setChoice() {}, CHOICES: THEME_CHOICES, locked: true }; return; }
    media?.addEventListener?.("change", () => { if (choice === "auto") applyAnimated(); });
    // Inna karta zmieniła wybór.
    window.addEventListener?.("storage", (event) => {
      if (event.key !== THEME_KEY) return;
      choice = readChoice();
      applyAnimated();
      if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("theme:choice", { detail: { choice } }));
    });
    globalThis.FamilijnaTheme = {
      CHOICES: THEME_CHOICES,
      locked: false,
      getChoice: () => choice,
      getTheme: () => root.dataset.theme,
      setChoice(next) {
        if (!THEME_CHOICES.includes(next)) throw new Error(`Unknown theme: ${next}`);
        choice = next;
        try {
          if (next === "auto") localStorage.removeItem(THEME_KEY);
          else localStorage.setItem(THEME_KEY, next);
        } catch {}
        applyAnimated();
        if (typeof CustomEvent === "function") window.dispatchEvent?.(new CustomEvent("theme:choice", { detail: { choice } }));
      },
    };
  }

  globalThis.FamilijnaDevice = { getDeviceProfile, editableFocused, keyboardLikely, KEYBOARD_CLOSE_MS, deviceLayout, PHONE_MAX_SHORT_SIDE, NARROW_MAX };
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const root = document.documentElement;
  setupTheme(root);
  const next = deviceLayout();
  root.dataset.device = next.device;
  root.dataset.input = next.input;
  root.dataset.orientation = next.orientation;
  root.toggleAttribute("data-compact", next.compact);
  root.toggleAttribute("data-sheet", next.sheet);
  // Import modułu z już otwartej karty po wdrożeniu nie uruchamia ponownie
  // bramki startowej. Atrybuty i API profilu nadal są dostępne.
  if (document.readyState === "complete" && !root.classList.contains("page-loading")) return;
  root.setAttribute("data-layout-pending", "");
  // HTML może zawierać gotową treść dla trybu bez JS. Przy hydracji etap
  // potwierdza dopiero kod strony, po podmianie treści i podpięciu obsługi.
  const resetParsedSteps = (node) => {
    if (node.nodeType !== 1) return;
    if (node.matches("[data-skel-step].skel-step-ready")) node.classList.remove("skel-step-ready");
    for (const step of node.querySelectorAll("[data-skel-step].skel-step-ready")) step.classList.remove("skel-step-ready");
  };
  const parsed = new MutationObserver((records) => {
    if (document.readyState !== "loading") { parsed.disconnect(); return; }
    for (const record of records) for (const node of record.addedNodes) resetParsedSteps(node);
  });
  parsed.observe(document, { childList: true, subtree: true });
  document.addEventListener("DOMContentLoaded", () => parsed.disconnect(), { once: true });
  // Bezpiecznik działa także przy błędzie importu modułów. Guard nadal chowa body.
  const timeout = setTimeout(() => {
    root.classList.remove("page-loading");
    root.removeAttribute("data-layout-pending");
  }, 5000);
  globalThis.FamilijnaPageBoot = { finish() { clearTimeout(timeout); root.removeAttribute("data-layout-pending"); } };
})();
