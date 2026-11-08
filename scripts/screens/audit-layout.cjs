#!/usr/bin/env node
// Audyt układu na scenach zrzutów (decyzje 2026-10-23, familijna-server/docs/wspolne-style-plan.md
// „Zakazy przewijania i zawijania”): na każdej scenie i urządzeniu sprawdza
//   - poziome przewijanie strony (zakazane wszędzie),
//   - przewijanie dokumentu na stronach, gdzie jest zakazane (SCROLL_POLICY),
//   - treść ukrytą przez obcięcie (overflow:hidden/clip bez wielokropka;
//     wielokropek ma pełny tekst w podpowiedzi core/tooltips.js),
//   - elementy sterujące poza ekranem albo zasłonięte przez przodka bez scrolla,
//   - elementy sterujące i tekst w strefie safe area (wyspa aparatu, pasek gestu).
//
//   node scripts/screens/audit-layout.cjs --scenes=games,polls   (opcje jak run.cjs)
//   node scripts/screens/audit-layout.cjs --all --devices=phone,phone-landscape
// Domyślne urządzenia: phone, phone-landscape, tablet, desktop, desktop-short.
// Wynik: <out>/audit.json i lista w konsoli; kod 1, gdy są błędy (--strict).
// Uruchamia run.cjs z --audit (te same sceny, dane i kroki co zrzuty).

// Strony, na których dokument może się przewijać (reszta: przewija się
// tylko obszar roboczy/lista; e20-kategorie-stron.md „Typ scrolla”).
const SCROLL_POLICY = {
  global: [/^\/$/, /^\/marketplace\//, /^\/account\//, /^\/manual\//, /^\/privacy\//, /^\/settings\//, /^\/login\//],
};

// Elementy, które nie mogą się zawijać (decyzje: e20-uwagi-do-korekty.md,
// ujednolicenie-wygladu.md; lista w wspolne-style-plan.md „Zakazy…”).
const NO_WRAP = ["#navMore", "#btnMySent", ".topbar .btn", ".fit-row"];

// Uruchamiane przez addInitScript przed skryptami strony. Bez treści i danych
// użytkowników: zapisujemy tylko selektory i geometrię źródeł przesunięcia.
function observeLayoutShifts() {
  const state = window.__screensLayoutAudit = { shown: null, loadingRemoved: null, shifts: [], supported: false };
  const label = (el) => el?.nodeType === 1
    ? `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join("")}` : "";
  const rect = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  const record = (entries) => {
    for (const entry of entries) {
      if (entry.hadRecentInput || state.stopped) continue;
      state.shifts.push({ time: entry.startTime, value: entry.value,
        sources: (entry.sources || []).map((source) => ({ el: label(source.node), before: rect(source.previousRect), after: rect(source.currentRect) })) });
    }
  };
  const checkShown = () => {
    const root = document.documentElement;
    if (!root || state.shown !== null || !document.body) return;
    if (!root.hasAttribute("data-page-guard") && (root.classList.contains("page-loading") || root.hasAttribute("data-layout-pending"))) return;
    // Guard jest osobnym końcowym ekranem; body zostaje pod nim niewidoczne.
    state.shown = performance.now();
  };
  const mutation = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target === document.documentElement && r.attributeName === "class" && r.oldValue?.split(/\s+/).includes("page-loading")
          && !r.target.classList.contains("page-loading")) state.loadingRemoved = performance.now();
    }
    checkShown();
  });
  mutation.observe(document, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "data-layout-pending", "data-page-guard"] });
  let observer;
  try {
    observer = new PerformanceObserver((list) => record(list.getEntries()));
    observer.observe({ type: "layout-shift", buffered: true });
    state.supported = PerformanceObserver.supportedEntryTypes?.includes("layout-shift") ?? true;
  } catch {}
  state.stop = () => {
    if (observer) { record(observer.takeRecords()); observer.disconnect(); }
    mutation.disconnect();
    state.stopped = true;
    const after = state.shifts.filter((entry) => state.shown !== null && entry.time >= state.shown);
    return { shown: state.shown, loadingRemoved: state.loadingRemoved, supported: state.supported,
      before: state.shifts.filter((entry) => state.shown === null || entry.time < state.shown).reduce((sum, entry) => sum + entry.value, 0),
      after: after.reduce((sum, entry) => sum + entry.value, 0), shifts: after };
  };
}

// Funkcja wykonywana w stronie (page.evaluate). opts: { path, safe, allowDocScroll }.
function inspectLayout(opts) {
  const NO_WRAP = opts.noWrap || [];
  const out = [];
  const initial = opts.initialLayout;
  if (initial && !initial.supported) out.push({ kind: "blad-audytu", el: "", detail: "Brak pomiaru layout-shift" });
  if (initial?.after > 0.01) out.push({ kind: "skok-po-zaladowaniu", el: [...new Set(initial.shifts.flatMap((s) => s.sources.map((source) => source.el)))].join(", "), detail: `CLS po pokazaniu strony: ${initial.after.toFixed(5)} > 0.01` });
  const W = innerWidth, H = innerHeight;
  const safe = { top: 0, right: 0, bottom: 0, left: 0, ...(opts.safe || {}) };
  const label = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = [...el.classList].slice(0, 3);
    if (cls.length) s += `.${cls.join(".")}`;
    return s;
  };
  const path = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      parts.unshift(label(e));
      if (e.id) break;
    }
    return parts.join(" > ");
  };
  const add = (kind, el, detail) => out.push({ kind, el: el ? path(el) : "", detail: detail || "" });
  const visible = (el) => {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e = el; e; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0) return false;
      if (e.inert || e.getAttribute("aria-hidden") === "true") return false;
    }
    return true;
  };
  const scrollable = (st) => /(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflowX);

  // Nakładka blokująca (ekran „Obróć urządzenie”, brak dostępu, blokada zasobu):
  // strona pod nią jest niedostępna z założenia — audyt sprawdza samą nakładkę.
  const guard = [...document.querySelectorAll(".blocking-overlay")].find((el) => visible(el));
  // Otwarte okno (nakładka na cały ekran): strona pod nim ma zablokowane
  // przewijanie z założenia — sprawdzamy samo okno.
  const dialog = !guard && [...document.querySelectorAll(".overlay, [role=dialog][aria-modal=true]")]
    .filter((el) => visible(el) && getComputedStyle(el).position === "fixed").pop();
  const root = guard || dialog || document.body;

  // 1. Dokument.
  const doc = document.scrollingElement || document.documentElement;
  if (doc.scrollWidth > W + 1) add("poziome-przewijanie", null, `${doc.scrollWidth}px > ${W}px`);
  if (doc.scrollHeight > H + 1 && !guard && !dialog) {
    const st = getComputedStyle(document.body), hs = getComputedStyle(document.documentElement);
    const locked = /hidden|clip/.test(st.overflowY) || /hidden|clip/.test(hs.overflowY);
    if (locked) add("ucieta-strona", null, `treść ${doc.scrollHeight}px > ekran ${H}px przy zablokowanym przewijaniu`);
    else if (!opts.allowDocScroll) add("przewijanie-strony", null, `${doc.scrollHeight}px > ${H}px`);
  }

  // 2. Obcięcia i wielokropki.
  const all = [...root.querySelectorAll("*")].filter((el) => !el.closest("svg, canvas, video, iframe, [data-audit-skip]"));
  for (const el of all) {
    if (/^(INPUT|TEXTAREA|SELECT|IMG|PICTURE|OPTION|SCRIPT|STYLE|TEMPLATE)$/.test(el.tagName)) continue;
    const st = getComputedStyle(el);
    const clipX = /hidden|clip/.test(st.overflowX), clipY = /hidden|clip/.test(st.overflowY);
    if (!clipX && !clipY) continue;
    const overX = clipX && el.scrollWidth > el.clientWidth + 1;
    const overY = clipY && el.scrollHeight > el.clientHeight + 1;
    if (!overX && !overY) continue;
    if (!visible(el)) continue;
    // Napis tylko dla czytników (sr-only, etykieta zwinięta do ikony) — ukryty celowo.
    if (el.clientWidth <= 2 || el.clientHeight <= 2 || (st.clip && st.clip !== "auto") || st.clipPath !== "none") continue;
    // Wielokropek: pełny tekst daje podpowiedź (core/tooltips.js — najechanie,
    // fokus, przytrzymanie na dotyku); naturalność ocenia się na zrzucie.
    if (st.textOverflow === "ellipsis" || Number(st.webkitLineClamp) > 0) continue;
    // Obcięcie widocznych dzieci (nie ozdobników o pointer-events:none / absolutnych tłach).
    const er = el.getBoundingClientRect();
    const hidden = [...el.querySelectorAll("*")].filter((c) => {
      if (!visible(c)) return false;
      const cs = getComputedStyle(c);
      if (cs.pointerEvents === "none" && !c.textContent.trim()) return false;
      const r = c.getBoundingClientRect();
      return (overX && (r.right > er.right + 2 || r.left < er.left - 2)) || (overY && (r.bottom > er.bottom + 2 || r.top < er.top - 2));
    });
    const leaves = hidden.filter((c) => !hidden.some((d) => d !== c && c.contains(d)));
    const meaningful = leaves.filter((c) => c.textContent.trim() || c.matches("button,a,input,select,textarea,[role=button],[tabindex]"));
    if (meaningful.length) add("ukryta-tresc", el, `${overX ? "w poziomie " : ""}${overY ? "w pionie " : ""}${meaningful.length} el. (${label(meaningful[0])})`);
    else if (!leaves.length && el.textContent.trim() && el.children.length === 0) add("uciety-tekst", el, el.textContent.trim().slice(0, 40));
  }

  // 3. Sterowanie poza ekranem / zasłonięte / w safe area.
  const controls = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [tabindex]:not([tabindex='-1'])")]
    .filter((el) => !el.closest("svg, .drawer-scrim, [data-audit-skip]") && visible(el));
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    // Przodek z przewijaniem może pokazać element — wtedy liczy się tylko jego okno.
    let box = { left: 0, top: 0, right: W, bottom: H }, scroller = null, clipper = null;
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (scrollable(st) && (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1)) { scroller = e; break; }
      if (/hidden|clip/.test(st.overflowX + st.overflowY)) {
        const pr = e.getBoundingClientRect();
        if (r.right <= pr.left + 1 || r.left >= pr.right - 1 || r.bottom <= pr.top + 1 || r.top >= pr.bottom - 1) { clipper = e; break; }
      }
      if (st.position === "fixed") break;
    }
    if (clipper) { add("sterowanie-zasloniete", el, `przez ${label(clipper)}`); continue; }
    if (scroller) continue;
    if (!opts.allowDocScroll && (r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.left < box.left - 1 || r.top < box.top - 1)) {
      add("sterowanie-poza-ekranem", el, `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`);
      continue;
    }
    const inSafe = (r.top < safe.top - 1 && safe.top) || (r.bottom > H - safe.bottom + 1 && safe.bottom && r.top < H)
      || (r.left < safe.left - 1 && safe.left) || (r.right > W - safe.right + 1 && safe.right);
    if (inSafe && (!opts.allowDocScroll || el.closest("[style*=fixed], .topbar, footer, .footer, .bottom-bar") || getComputedStyle(el).position === "fixed")) add("safe-area", el, `${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
  }
  // 4. Android (zgłoszenie 2026-10-23): przycisk z ikoną na dotyku — kryjące tło,
  // bez opacity < 1, filter, backdrop-filter i transform (artefakty przezroczystości).
  if (opts.touch) {
    const alpha = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return 1; const p = m[1].split(/[ ,\/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
    // Gradient z półprzezroczystym kolorem bez kryjącego koloru pod spodem też prześwituje.
    const seeThroughImage = (st) => /rgba?\([^)]*[,\/]\s*0?\.\d+\s*\)/.test(st.backgroundImage) && alpha(st.backgroundColor) < 1;
    const hasIcon = (b) => b.querySelector("svg, img, canvas, [class*=icon], [class*=Icon]")
      || /url\(/.test(getComputedStyle(b, "::before").maskImage + getComputedStyle(b, "::before").backgroundImage + getComputedStyle(b, "::after").maskImage)
      || !/\p{L}{2}/u.test(b.textContent.trim());
    for (const btn of root.querySelectorAll("button, a.btn, [role=button], [role=tab], label.btn")) {
      if (btn.matches(".drawer-scrim") || !visible(btn) || !hasIcon(btn)) continue;
      const bad = [];
      for (let e = btn; e && e !== document.body; e = e.parentElement) {
        const st = getComputedStyle(e);
        if (Number(st.opacity) < 1) { bad.push(`opacity ${st.opacity} (${label(e)})`); break; }
        if (st.backdropFilter && st.backdropFilter !== "none") { bad.push(`backdrop-filter (${label(e)})`); break; }
        if (st.filter !== "none") { bad.push(`filter (${label(e)})`); break; }
        if (st.mixBlendMode && st.mixBlendMode !== "normal") { bad.push(`mix-blend-mode (${label(e)})`); break; }
        // Pierwsze podłoże pod przyciskiem (sam przycisk albo przodek z tłem) musi kryć.
        const a = alpha(st.backgroundColor);
        if (a > 0 && a < 1 && st.backgroundImage === "none") { bad.push(`tło przezroczyste ${st.backgroundColor} (${label(e)})`); break; }
        if (seeThroughImage(st)) { bad.push(`gradient przezroczysty (${label(e)})`); break; }
        if (a === 1 || st.backgroundImage !== "none") break;
        if (e.matches(".overlay, .modal, main, header")) break;
      }
      const st = getComputedStyle(btn);
      // Samo przesunięcie (np. wyśrodkowanie translateX(-50%)) nie tworzy artefaktów.
      if (st.transform !== "none" && !/^matrix\(1, 0, 0, 1,/.test(st.transform)) bad.push("transform");
      if (bad.length) add("android-przezroczystosc", btn, bad.join("; "));
    }
  }

  // 4a. Obwódka przycisku ucięta przez przodka z overflow (zgłoszenie
  // 2026-10-24): krawędź przycisku wystaje o 0,5–4 px poza obszar przycinania.
  for (const btn of root.querySelectorAll("button, a.btn, [role=button], .btn, input:not([type=hidden]), select, textarea")) {
    if (!visible(btn)) continue;
    const r = btn.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) continue;
    for (let e = btn.parentElement; e && e !== document.documentElement; e = e.parentElement) {
      const st = getComputedStyle(e);
      if (st.overflowX === "visible" && st.overflowY === "visible" && st.contain.indexOf("paint") < 0) continue;
      // Lista przewijana: element częściowo przewinięty to nie ucięta obwódka.
      if (e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1) break;
      const c = e.getBoundingClientRect();
      const bl = parseFloat(st.borderLeftWidth), bt = parseFloat(st.borderTopWidth), br = parseFloat(st.borderRightWidth), bb = parseFloat(st.borderBottomWidth);
      const clip = { left: c.left + bl, top: c.top + bt, right: c.right - br, bottom: c.bottom - bb };
      const cut = Math.max(st.overflowX === "visible" ? 0 : Math.max(clip.left - r.left, r.right - clip.right),
        st.overflowY === "visible" ? 0 : Math.max(clip.top - r.top, r.bottom - clip.bottom));
      if (cut > 0.5 && cut <= 4) { add("obwodka-ucieta", btn, `${cut.toFixed(1)} px (${label(e)})`); break; }
      if (cut > 4) break; // przewinięte poza widok — nie obwódka
    }
  }

  // 4c. Przewijany obszar bez wygaszonej krawędzi (scroll-fade.js): treść
  // ucięta ostro przy krawędzi (zgłoszenie 2026-10-24, Dźwięk w ustawieniach gry).
  for (const el of root.querySelectorAll("*")) {
    if (el.scrollHeight <= el.clientHeight + 8 || el.clientHeight < 60) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== "auto" && oy !== "scroll") continue;
    if (!visible(el) || el.classList.contains("scroll-fade") || el.closest("select, textarea, .menu, [role=listbox]")) continue;
    if (el === document.documentElement || el === document.body) continue;
    add("brak-wygaszenia", el, `${el.clientHeight}/${el.scrollHeight} px`);
  }

  // 4d. Sklejone karty (zgłoszenie 2026-10-24, Ankiety): dwa sąsiednie bloki
  // z ramką lub tłem stoją w pionie bliżej niż 4 px (bez odstępu silnika).
  const boxed = (el) => {
    const st = getComputedStyle(el);
    if (st.position === "absolute" || st.position === "fixed" || st.display.startsWith("inline")) return false;
    const bordered = ["Top", "Bottom", "Left", "Right"].filter((side) => parseFloat(st[`border${side}Width`]) > 0 && st[`border${side}Style`] !== "none").length >= 3;
    const r = parseFloat(st.borderTopLeftRadius) > 0;
    return bordered && r;
  };
  // Pomija elementy przycięte przez przewijaną listę (częściowo przewinięte).
  const clippedByScroll = (el) => {
    const r = el.getBoundingClientRect();
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      if (e.scrollHeight <= e.clientHeight + 1) continue;
      const c = e.getBoundingClientRect();
      if (r.top < c.top - 1 || r.bottom > c.bottom + 1) return true;
    }
    return false;
  };
  const boxes = [...root.querySelectorAll("main *, .overlay:not([hidden]) *")].filter((el) => visible(el) && el.getBoundingClientRect().height > 20 && boxed(el) && !clippedByScroll(el))
    .map((el) => ({ el, r: el.getBoundingClientRect() }));
  for (const { el: b, r: rb } of boxes) {
    for (const { el: a, r: ra } of boxes) {
      if (a === b || a.contains(b) || b.contains(a)) continue;
      const gapY = rb.top - ra.bottom;
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      if (overlapX > 40 && gapY > -1 && gapY < 3) { add("sklejone-karty", b, `${gapY.toFixed(1)} px pod ${label(a)}`); break; }
    }
  }

  // 4b. Zakazy zawijania: element w jednym wierszu; stopka — części obok siebie.
  for (const el of root.querySelectorAll(NO_WRAP.join(","))) {
    if (!visible(el)) continue;
    // Wiersze samego tekstu (bez plakietek z position:absolute i ikon).
    const lh = parseFloat(getComputedStyle(el).fontSize) * 1.1;
    const tops = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim() || !visible(n.parentElement) || getComputedStyle(n.parentElement).position === "absolute") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 1) tops.push(r.top);
    }
    tops.sort((x, y) => x - y);
    const lines = new Set();
    let last = -Infinity;
    for (const t of tops) { if (t - last > lh * 0.6) lines.add(t); last = t; }
    if (lines.size > 1) add("zawiniete", el, `${lines.size} wiersze`);
  }
  // Rząd przycisków zawinięty na dwa wiersze (zgłoszenie 2026-10-24) i .fit-row
  // szerszy niż jego miejsce.
  for (const row of root.querySelectorAll("*")) {
    const btns = [...row.children].filter((c) => c.matches(".btn, button") && visible(c));
    if (btns.length < 2) continue;
    const st = getComputedStyle(row);
    if (st.display !== "flex" && st.display !== "inline-flex") continue;
    if (st.flexDirection.startsWith("column")) continue;
    const tops = btns.map((b) => b.getBoundingClientRect().top);
    const h = Math.min(...btns.map((b) => b.getBoundingClientRect().height));
    if (Math.max(...tops) - Math.min(...tops) > h * 0.6) add("przyciski-zawiniete", row, `${btns.length} przycisków w ${new Set(tops.map((t) => Math.round(t / h))).size} rzędach`);
  }
  for (const row of root.querySelectorAll(".fit-row")) {
    if (visible(row) && row.scrollWidth > row.clientWidth + 1) add("fit-row-za-szeroki", row, `${row.scrollWidth}/${row.clientWidth} px`);
  }
  for (const foot of root.querySelectorAll(".footer")) {
    if (!visible(foot)) continue;
    const parts = [...foot.children].filter((c) => visible(c) && getComputedStyle(c).position !== "absolute");
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1].getBoundingClientRect(), b = parts[i].getBoundingClientRect();
      if (b.top >= a.bottom - 1) add("stopka-pod-soba", parts[i], "część stopki spadła pod poprzednią");
    }
  }

  // 3. Karty w kartach (zgłoszenie 2026-11-08, wzór: edytor logo przed 6043c134).
  // Silnik zna dwa poziomy (.card i .card--inset, wiersz listy w karcie);
  // trzecia i dalsza obramowana powierzchnia w łańcuchu = „ramka w ramce”.
  // Powierzchnia: widoczny blok ≥ 48×28 z tłem albo pełną ramką, zaokrąglony
  // lub obramowany ze wszystkich stron. Kontrolki (przyciski, pola, tagi)
  // nie liczą się — to elementy, nie warstwy; czarna tablica podglądu
  // i białe pole kodu QR (--black/--white) to treść, nie warstwa.
  // Dozwolone: karta › karta w karcie › wiersz/kafel listy (trzeci poziom
  // powtarza się w rodzicu). Zgłaszane: trzeci poziom niebędący wierszem
  // (ramka wokół treści) i każdy czwarty poziom.
  const CONTROL = "button, input, select, textarea, a.btn, .btn, .btn-plain, .inp, .tag, .badge, .ui-select, .toggle-group, .toggle-group *, .searchBox, label, summary, img, canvas, video, svg, iframe, [role=button], [role=option], [role=tab]"
    // pusty stan zastępuje wiersze listy; komunikat, próbka koloru, menu i ramka kadru to nie warstwy
    + ", .empty-state, .pollLinkPlaceholder, .callout, .colorPreview, .geo-float, .geo-box";
  const alpha = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c === "transparent" ? 0 : 1;
    const p = m[1].split(/[ ,/]+/).filter(Boolean);
    return p.length > 3 ? Number(p[3]) : 1;
  };
  const surfaceCache = new Map();
  const surface = (el) => {
    if (surfaceCache.has(el)) return surfaceCache.get(el);
    let res = null;
    if (!el.matches(CONTROL)) {
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      if (r.width >= 48 && r.height >= 28 && st.display !== "contents") {
        const content = /^rgb\((0, 0, 0|255, 255, 255)\)$/.test(st.backgroundColor) && st.backgroundImage === "none";
        const bg = !content && (alpha(st.backgroundColor) > 0.02 || st.backgroundImage !== "none");
        const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => parseFloat(st[`border${s}Width`]) > 0 && st[`border${s}Style`] !== "none" && alpha(st[`border${s}Color`]) > 0.02).length;
        const radius = parseFloat(st.borderTopLeftRadius) > 0 || parseFloat(st.borderBottomRightRadius) > 0;
        if (!content && ((bg && (radius || sides === 4)) || (sides === 4 && radius))) res = { bg: bg ? st.backgroundColor : "", border: sides === 4 };
      }
    }
    surfaceCache.set(el, res);
    return res;
  };
  for (const el of root.querySelectorAll("*")) {
    if (el.closest("svg, [data-audit-skip]") || !surface(el)) continue;
    const chain = [el];
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      if (getComputedStyle(e).position === "fixed" && !surface(e)) break; // nakładka okna: liczymy od okna
      if (surface(e)) chain.unshift(e);
    }
    if (chain.length < 3 || !visible(el)) continue;
    // Zgłaszamy tylko najgłębszy element łańcucha (bez dzieci-powierzchni).
    if ([...el.querySelectorAll("*")].some((c) => surface(c) && visible(c))) continue;
    const cls = el.classList[0];
    const row = cls && [...el.parentElement.children].some((c) => c !== el && c.classList.contains(cls));
    if (chain.length === 3 && row) continue;
    add("warstwy-kart", el, `${chain.length} poziomy: ${chain.map((e) => label(e)).join(" › ")}`);
  }

  // Atrybut hidden / klasa .hidden musi chować element -- żadna reguła strony
  // ani silnika nie może przywrócić mu display.
  for (const el of document.querySelectorAll("[hidden], .hidden")) {
    if (el.closest("template, svg, head")) continue;
    if (getComputedStyle(el).display !== "none") add("hidden-widoczny", el, `display: ${getComputedStyle(el).display}`);
  }

  // Uniknąć powtórzeń (te same elementy w listach).
  const seen = new Set();
  return out.filter((p) => { const k = `${p.kind}|${p.el.replace(/:\d+/g, "")}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

const allowDocScroll = (path) => SCROLL_POLICY.global.some((re) => re.test(path.split(/[?#]/)[0]));

module.exports = { observeLayoutShifts, inspectLayout, allowDocScroll, SCROLL_POLICY, NO_WRAP };

if (require.main === module) {
  const { spawnSync } = require("node:child_process");
  const argv = process.argv.slice(2);
  if (!argv.some((a) => a.startsWith("--devices"))) argv.push("--devices=phone,phone-landscape,tablet,desktop,desktop-short", "--force-devices");
  if (!argv.some((a) => a.startsWith("--out"))) argv.push("--out=scripts/screens/out-audit");
  const r = spawnSync(process.execPath, [require.resolve("./run.cjs"), "--audit", ...argv], { stdio: "inherit" });
  process.exitCode = r.status ?? 1;
}
