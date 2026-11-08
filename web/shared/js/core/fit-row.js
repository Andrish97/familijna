import { registerPageLayout } from "./page-layout.js?v=v2026-11-08T10015";
// fit-row.js
// Wiersz przycisków bez zawijania (zgłoszenie 2026-10-24: pasek ustawień gry
// na telefonie łamał się na dwa rzędy). Element z klasą .fit-row stoi zawsze
// w jednym rzędzie; gdy przyciski z ikoną i napisem się nie mieszczą, dostaje
// .is-icons — napisy chowają się, zostają ikony (nazwa w dymku i dla czytnika
// ekranu); główny przycisk (.gold) chowa napis dopiero, gdy i to nie wystarczy
// (.is-icons-all). Wygląd: components.css „Wiersz bez zawijania”.
//
// Podpinany sam (jak scroll-fade.js): każdy .fit-row w dokumencie, także
// dodany później. Przeliczenie raz na klatkę po zmianie rozmiaru lub treści.

registerPageLayout(() => {
  for (const row of document.querySelectorAll(".fit-row")) update(row);
});

const tracked = new WeakSet();
const pending = new Set();
let raf = 0;

// Mierzone w pełnej szerokości dzieci (.is-measuring: bez kurczenia) —
// inaczej komunikat ścisnąłby się do zera zamiast zwinąć napisy.
function fits(row) {
  row.classList.add("is-measuring");
  const ok = row.scrollWidth <= row.clientWidth + 1;
  row.classList.remove("is-measuring");
  return ok;
}

function update(row) {
  if (!row.isConnected) return;
  for (const btn of row.querySelectorAll(".btn")) {
    const text = btn.textContent.trim();
    if (text && btn.querySelector("svg.ico") && !btn.title) btn.title = text;
  }
  // Stopnie: napisy → ikony w przyciskach pobocznych (główny .gold zostaje
  // z napisem) → ikony we wszystkich.
  row.classList.remove("is-icons", "is-icons-all");
  if (!fits(row)) {
    row.classList.add("is-icons");
    if (!fits(row)) row.classList.add("is-icons-all");
  }
}

function schedule(row) {
  pending.add(row);
  if (!raf) raf = requestAnimationFrame(() => {
    raf = 0;
    const rows = [...pending];
    pending.clear();
    rows.forEach(update);
  });
}

const ro = typeof ResizeObserver === "function"
  ? new ResizeObserver((entries) => { for (const e of entries) schedule(e.target); })
  : null;
const mo = typeof MutationObserver === "function"
  ? new MutationObserver((records) => {
    const withoutMeasuredClasses = (value) => (value || "").split(/\s+/).filter((c) => !["is-icons", "is-icons-all", "is-measuring"].includes(c)).join(" ");
    for (const r of records) {
      const row = r.target.closest?.(".fit-row");
      if (!row) continue;
      if (r.target === row && r.attributeName === "class"
          && withoutMeasuredClasses(r.oldValue) === withoutMeasuredClasses(row.className)) continue;
      schedule(row);
    }
  })
  : null;

/** Podpina wiersz (wielokrotne wywołanie nic nie robi). */
export function fitRow(row) {
  if (!row || tracked.has(row)) return;
  tracked.add(row);
  ro?.observe(row);
  mo?.observe(row, { childList: true, subtree: true, characterData: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "hidden"] });
  schedule(row);
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches(".fit-row")) fitRow(root);
  for (const el of root.querySelectorAll(".fit-row")) fitRow(el);
}

if (typeof document !== "undefined") {
  const start = () => {
    scan(document.body);
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) scan(n); })
      .observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start, { once: true });
}
