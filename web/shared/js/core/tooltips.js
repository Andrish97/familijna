// Wygląd: .app-tooltip w silniku stylów (web/shared/style/components.css).
import { EDGE_PAD, clamp } from "./ui-metrics.js?v=v2026-11-05T23304";
import { setFloat } from "./geometry.js?v=v2026-11-05T23304";
function install() {
  if (typeof document === "undefined" || document.documentElement.dataset.tooltipSystem) return;
  document.documentElement.dataset.tooltipSystem = "ready";

  const tip = document.createElement("div");
  tip.className = "app-tooltip";
  tip.id = "appTooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  document.body.append(tip);

  let active = null;
  let pointer = null;
  let frame = 0;
  let keyboardFocus = false;
  const selector = "[data-tooltip], [data-tip], [title]";

  function normalizeTitle(node) {
    if (!(node instanceof Element) || node.tagName === "IFRAME") return;
    const title = node.getAttribute("title");
    if (title === null) return;
    // Strony zmieniają title w trakcie działania (np. postęp w topbarze
    // Control). Podpowiedź przejętą z title aktualizujemy przy każdej zmianie;
    // jawne data-tooltip/data-tip ustawione przez stronę zostają.
    const fromTitle = node.hasAttribute("data-tooltip-from-title");
    if (fromTitle || (!node.hasAttribute("data-tooltip") && !node.hasAttribute("data-tip"))) {
      node.setAttribute("data-tooltip", title);
      node.setAttribute("data-tooltip-from-title", "");
      if (node === active) {
        if (title) { tip.textContent = title; schedulePosition(); } else hide();
      }
    }
    node.removeAttribute("title");
  }

  function normalize(root) {
    if (root instanceof Element) normalizeTitle(root);
    root.querySelectorAll?.("[title]").forEach(normalizeTitle);
  }

  function textFor(node) {
    return node?.getAttribute("data-tooltip") || node?.getAttribute("data-tip") || "";
  }

  function position() {
    frame = 0;
    if (!active || tip.hidden) return;
    const rect = active.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const x = pointer?.x ?? (rect.left + rect.width / 2);
    const y = pointer?.y ?? rect.top;
    const left = clamp(x - width / 2, EDGE_PAD, innerWidth - width - EDGE_PAD);
    const above = y - height - 12;
    const top = above >= EDGE_PAD ? above : Math.min(innerHeight - height - EDGE_PAD, (pointer ? y + 16 : rect.bottom + 10));
    setFloat(tip, { left, top: Math.max(EDGE_PAD, top) });
  }

  function schedulePosition() {
    if (!frame) frame = requestAnimationFrame(position);
  }

  // Tekst ucięty wielokropkiem (text-overflow: ellipsis lub line-clamp) pokazuje
  // pełną treść w tej samej podpowiedzi (decyzja 2026-10-23: nic nie ucięte
  // bez dostępu do całości). Szuka od elementu pod wskaźnikiem w górę.
  function truncatedFrom(node) {
    for (let el = node, depth = 0; el instanceof Element && depth < 4; el = el.parentElement, depth++) {
      const st = getComputedStyle(el);
      const clamp = Number(st.webkitLineClamp) > 0;
      if (st.textOverflow !== "ellipsis" && !clamp) continue;
      const cut = clamp ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1;
      return cut && el.textContent.trim() ? el : null;
    }
    return null;
  }
  function truncatedInside(node) {
    if (!(node instanceof Element)) return null;
    for (const el of node.querySelectorAll("*")) { const cut = truncatedFrom(el); if (cut === el) return el; }
    return null;
  }

  function show(node, point = null, fullText = "") {
    if (!node) return;
    const text = fullText || textFor(node);
    if (!text) return;
    active = node;
    pointer = point;
    tip.textContent = text;
    tip.hidden = false;
    schedulePosition();
  }

  function hide(node = null) {
    if (node && node !== active) return;
    active = null;
    pointer = null;
    tip.hidden = true;
  }

  normalize(document);
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") normalizeTitle(record.target);
      else record.addedNodes.forEach((node) => node.nodeType === Node.ELEMENT_NODE && normalize(node));
    }
    // węzeł z dymkiem zniknął (przebudowa listy) — „pointerout” już nie
    // przyjdzie, więc dymek chowa się tutaj
    if (active && !active.isConnected) hide();
  }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["title"] });

  document.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch") return;
    keyboardFocus = false;
    const node = event.target.closest?.(selector);
    if (node) { if (node !== active) show(node, { x: event.clientX, y: event.clientY }); return; }
    const cut = truncatedFrom(event.target);
    if (cut && cut !== active) show(cut, { x: event.clientX, y: event.clientY }, cut.textContent.trim());
  });
  // Dotyk: przytrzymanie uciętego tekstu pokazuje całość (do następnego dotknięcia).
  let pressTimer = 0;
  document.addEventListener("pointerdown", (event) => {
    clearTimeout(pressTimer);
    if (event.pointerType !== "touch") return;
    const cut = truncatedFrom(event.target);
    if (cut) pressTimer = setTimeout(() => show(cut, { x: event.clientX, y: event.clientY }, cut.textContent.trim()), 450);
  });
  for (const type of ["pointerup", "pointercancel"]) document.addEventListener(type, () => clearTimeout(pressTimer));
  document.addEventListener("pointerdown", (event) => {
    keyboardFocus = false;
    if (event.pointerType === "touch") hide();
  }, true);
  document.addEventListener("pointermove", (event) => {
    if (!active || event.pointerType === "touch") return;
    pointer = { x: event.clientX, y: event.clientY };
    schedulePosition();
  }, { passive: true });
  document.addEventListener("pointerout", (event) => {
    if (!active || !active.contains(event.target)) return;
    if (event.relatedTarget && active.contains(event.relatedTarget)) return;
    hide();
  });
  document.addEventListener("focusin", (event) => {
    if (!keyboardFocus) return;
    const node = event.target.closest?.(selector);
    if (node) { show(node); return; }
    const cut = truncatedFrom(event.target) || truncatedInside(event.target);
    if (cut) show(event.target, null, cut.textContent.trim());
  });
  document.addEventListener("focusout", (event) => {
    if (active?.contains(event.target)) hide();
  });
  document.addEventListener("keydown", (event) => {
    keyboardFocus = true;
    if (event.key === "Escape") hide();
  });
  document.addEventListener("scroll", () => hide(), true);
  window.addEventListener("resize", schedulePosition, { passive: true });
}

// Testy jednostkowe importują moduły pośrednio w Node, bez DOM.
if (typeof document !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}
