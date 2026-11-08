// tabs.js
// Jeden sposób na karty wszystkich stron: nazwa karty żyje w adresie
// (?tab=<nazwa>) i tylko tam — bez sessionStorage / localStorage.
// Reguły (familijna-server/docs/nawigacja-mapa-plan.md, „Karty — jeden sposób…”):
//   - lista kart i domyślna (pierwsza) pochodzą z PAGES[...].tabs w nav-map.js,
//   - nieznana karta w adresie oznacza kartę domyślną (to reguła, nie zapas),
//   - karta domyślna jest bez parametru w adresie,
//   - zmiana karty to replaceState, nie pushState: przeglądarkowe „Wstecz”
//     wraca do poprzedniej strony, nie przewija kart.
// Testy: tests/unit/tabs.test.js.

import { filterToHref } from "./list-filter.js?v=v2026-11-08T16530";


export const TAB_PARAM = "tab";

/** Karta z ?tab= (search), tylko z listy allowed; inaczej def. */
export function tabFromUrl(allowed, def, search = typeof location !== "undefined" ? location.search : "") {
  const tab = new URLSearchParams(search).get(TAB_PARAM);
  return tab && allowed.includes(tab) ? tab : def;
}

/** Adres href z kartą name; karta domyślna (def) usuwa parametr. */
export function tabHref(href, name, def) {
  return filterToHref(href, TAB_PARAM, name === def ? "" : name);
}

/**
 * Zapisuje kartę name w bieżącym adresie (replaceState). def — karta
 * domyślna (bez parametru). Nic nie robi, gdy adres się nie zmienia.
 */
export function setTab(name, def) {
  const next = tabHref(location.href, name, def);
  if (next !== location.pathname + location.search + location.hash) {
    history.replaceState(history.state, "", next);
  }
}

// ── Wygląd i dostępność wypustek (.tabs-strip > .tab-slot > .tab-label) ──
// Jeden sposób dla wszystkich stron: aktywna wypustka i jej slot dostają
// .active, każda wypustka role="tab", aria-selected i tabindex (fokus tylko
// na aktywnej); strzałki, Home i End przechodzą do sąsiedniej i ją wybierają
// (klik — stronę przełącza jej własna obsługa kliknięcia).
const keyedStrips = new WeakSet();

function bindTabKeys(strip) {
  if (!strip || keyedStrips.has(strip)) return;
  keyedStrips.add(strip);
  strip.addEventListener("keydown", (event) => {
    const labels = [...strip.querySelectorAll(".tab-label")].filter((label) => !label.disabled && label.offsetParent);
    const i = labels.indexOf(event.target.closest(".tab-label"));
    if (i < 0) return;
    const last = labels.length - 1;
    const next = { ArrowLeft: i ? i - 1 : last, ArrowRight: i === last ? 0 : i + 1, Home: 0, End: last }[event.key];
    if (next == null) return;
    event.preventDefault();
    labels[next].focus();
    labels[next].click();
  });
}

/** labels — wypustki jednego paska; active — wybrana (element albo null). */
export function markActiveTab(labels, active) {
  const list = [...labels].filter(Boolean);
  for (const label of list) {
    const on = label === active;
    label.classList.toggle("active", on);
    label.closest(".tab-slot")?.classList.toggle("active", on);
    label.setAttribute("role", "tab");
    label.setAttribute("aria-selected", String(on));
    label.tabIndex = on ? 0 : -1;
  }
  const strip = list[0]?.closest(".tabs-strip");
  strip?.setAttribute("role", "tablist");
  bindTabKeys(strip);
}
