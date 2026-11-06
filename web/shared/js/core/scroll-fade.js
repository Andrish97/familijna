import { registerPageLayout } from "./page-layout.js?v=v2026-11-06T00362";
// scroll-fade.js
// Wygaszona krawędź przewijanych list (decyzja właściciela 2026-10-21):
// gdy nad lub pod widocznym fragmentem są jeszcze elementy, krawędź listy
// zanika (maska 32 px, base.css .scroll-fade.has-more-above/below) zamiast
// ostrego cięcia wiersza czy kafla. Gdy treść się mieści — bez maski, więc
// obwódka fokusu pierwszego i ostatniego elementu zostaje cała.
//
// Jeden kod dla wszystkich list: kontener pasujący do SCROLL_FADE_SELECTOR
// (albo z klasą .scroll-fade w znaczniku) jest podpinany sam — także gdy
// pojawi się później (okna, przerysowane listy). Strona może też wywołać
// scrollFade(el) dla własnego kontenera (np. list-search.js dla siatek).
//
// Wydajność: pasywne nasłuchy przewijania, ResizeObserver na kontenerach,
// jeden MutationObserver na treść; przeliczenie najwyżej raz na klatkę
// (requestAnimationFrame) i tylko dla kontenerów, w których coś się zmieniło.
// Maska tylko na kontenerze, który rzeczywiście się przewija (overflow-y
// auto/scroll) — element z overflow:visible nigdy nie dostaje maski.

// Rejestr przewijanych list (wzorce-ui.md, „Wygaszona krawędź list”).
// Nie dopisujemy tu okien z własnym tłem (.modal, menu rozwijane) — maska
// wygasiłaby tło karty; w oknie wygasza się lista albo ciało arkusza.
export const SCROLL_FADE_SELECTOR = [
  ".scroll-fade",
  // wspólne: listy odbiorców, znajomi, subskrybenci, zadania, poczta, Connect
  ".shareList",
  ".tasks-scroll",
  "#shareDeviceCurrentContent",
  // okna: ciało arkusza na telefonie i treść okien uni-modal
  ".sheet-modal-body",
  ".uni-body",
  ".uni-modal > .mSub",
  ".modal-scroll",
  // edytor gry, edycja pytania (Eksplorator), ustawienia gry i Control
  ".listShell",
  "#gsContent",
  ".qf-listShell",
  ".qList",
  ".c2-scroll-area",
  ".c2-summary-grid",
  // Eksplorator baz
  ".explorer .list",
  ".explorer-left > .tree",
  ".left-filters > .matched-categories",
  ".left-filters > .tags",
  ".tagsPickList",
  ".xPickList",
  ".moveList",
  ".colorModalBody",
  // podglądy pytań (Gry, Społeczność, panel admina), wyniki ankiety
  ".bld-preview-questions",
  ".mkt-detail-questions",
  ".market-preview-questions",
  "#resultsList",
  // Wskazówki: treść rozdziału i lista spisu (nie cała szuflada — ma własne tło)
  "#manualContent",
  "#manualToc > .m-side-list",
  // Logo: lista czcionek, siatka obrazów
  "#drawFontList",
  ".imgTopGrid",
  // panel admina
  ".gen-game-list-container",
  ".mail-table-wrap",
  "#mailListBody",
  ".mail-conv-messages",
  "#mktEmailList",
  "#mcLogsContainer",
  "#assignReportList",
  "#ratersBody",
].join(",");

const ABOVE = "has-more-above";
const BELOW = "has-more-below";

const tracked = new WeakSet();
const scrollable = new WeakMap(); // el -> bool (overflow-y auto/scroll), liczone poza przewijaniem
const pending = new Map(); // el -> true, gdy trzeba też odświeżyć styl/nagłówek
let raf = 0;

const flush = () => {
  raf = 0;
  const jobs = [...pending];
  pending.clear();
  for (const [el, full] of jobs) update(el, full);
};

const schedule = (el, full = true) => {
  pending.set(el, pending.get(el) || full);
  if (!raf) raf = requestAnimationFrame(flush);
};

function update(el, full) {
  if (!el.isConnected) {
    ro?.unobserve(el);
    return;
  }
  if (full || !scrollable.has(el)) {
    const oy = getComputedStyle(el).overflowY;
    scrollable.set(el, oy === "auto" || oy === "scroll");
    // przyklejony nagłówek tabeli (Eksplorator, panel admina) nie zanika:
    // górna maska zaczyna się pod nim
    const head = el.querySelector(":scope > table > thead");
    const top = head ? `${head.offsetHeight}px` : "";
    if (el.style.getPropertyValue("--scroll-fade-top") !== top) {
      if (top) el.style.setProperty("--scroll-fade-top", top);
      else el.style.removeProperty("--scroll-fade-top");
    }
  }
  // Przerysowanie z uzgadnianiem klas (Control) zdejmuje klasę — przywróć.
  if (!el.classList.contains("scroll-fade")) el.classList.add("scroll-fade");
  const max = scrollable.get(el) ? el.scrollHeight - el.clientHeight : 0;
  const above = max > 1 && el.scrollTop > 1;
  const below = max > 1 && el.scrollTop < max - 1;
  if (el.classList.contains(ABOVE) !== above) el.classList.toggle(ABOVE, above);
  if (el.classList.contains(BELOW) !== below) el.classList.toggle(BELOW, below);
}

const ro = typeof ResizeObserver === "function"
  ? new ResizeObserver((entries) => { for (const e of entries) schedule(e.target); })
  : null;

// Zmiana treści (wiersze dorysowane, zwinięta sekcja, ukryty element):
// odśwież najbliższe śledzone kontenery nad zmienionym węzłem.
const contentMo = typeof MutationObserver === "function"
  ? new MutationObserver((records) => {
    const seen = new Set();
    for (const r of records) {
      for (let n = r.target; n && n.nodeType === 1; n = n.parentElement) {
        if (seen.has(n)) break;
        seen.add(n);
        if (tracked.has(n)) schedule(n);
      }
    }
  })
  : null;

const onScroll = (ev) => schedule(ev.currentTarget, false);

/** Podpina wygaszoną krawędź do przewijanego kontenera (wielokrotne wywołanie nic nie robi). */
export function scrollFade(el) {
  if (!el || el.nodeType !== 1 || tracked.has(el)) return;
  tracked.add(el);
  el.classList.add("scroll-fade");
  el.addEventListener("scroll", onScroll, { passive: true });
  ro?.observe(el);
  contentMo?.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "open"] });
  schedule(el);
}

const attachWithin = (root) => {
  if (root.nodeType !== 1) return;
  if (root.matches(SCROLL_FADE_SELECTOR)) scrollFade(root);
  if (root.firstElementChild) for (const el of root.querySelectorAll(SCROLL_FADE_SELECTOR)) scrollFade(el);
};

let started = false;
/** Automatyczne podpinanie list z rejestru — na stronie i w dorysowanych oknach. */
export function initScrollFade(root) {
  if (started || typeof document === "undefined" || !document.documentElement || typeof document.addEventListener !== "function") return;
  started = true;
  root ||= document;
  const run = () => {
    attachWithin(root === document ? document.documentElement : root);
    if (typeof MutationObserver !== "function") return;
    let added = [];
    let addRaf = 0;
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) added.push(n);
      if (added.length && !addRaf) {
        addRaf = requestAnimationFrame(() => {
          addRaf = 0;
          const nodes = added;
          added = [];
          for (const n of nodes) if (n.isConnected) attachWithin(n);
        });
      }
    }).observe(root === document ? document.documentElement : root, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
  else run();
}

registerPageLayout(() => {
  for (const el of document.querySelectorAll(SCROLL_FADE_SELECTOR)) {
    scrollFade(el);
    update(el, true);
  }
});

initScrollFade();
