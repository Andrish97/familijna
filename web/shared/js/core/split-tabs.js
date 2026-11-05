// split-tabs.js
// Karta dzielona (decyzja 2026-10-23, familijna-server/docs/wspolne-style-plan.md): na
// szerokim ekranie panele stoją obok siebie, w układzie telefonu
// (data-compact, core/device-attrs.js) jedna karta z wypustkami pokazuje
// aktywny panel. Wygląd: .tabs-card--split i .split-panels
// w shared/style/components.css (ten sam atrybut).
//   <div class="tabs-card tabs-card--split">
//     <div class="tabs-strip" role="tablist"> .tab-slot > button.tab-label[data-split-tab=a] … </div>
//     <div class="split-panels"> <section class="card" data-split-panel="a"> … </div>
//   </div>
// Aktywny panel, wypustka i jej slot dostają .active (wypustki: wspólne
// markActiveTab z tabs.js — role, aria, strzałki); role tabpanel tylko
// w trybie wąskim.

import { markActiveTab } from "./tabs.js?v=v2026-11-05T23260";
import { isCompactLayout, onDeviceChange } from "./device-attrs.js?v=v2026-11-05T23260";

/**
 * root — .tabs-card--split; active — nazwa startowa; onChange(name) — po
 * wyborze przez użytkownika (np. zapis ?tab=). Zwraca { select, active, narrow }.
 */
export function initSplitTabs(root, { active, onChange } = {}) {
  const tabs = [...root.querySelectorAll("[data-split-tab]")];
  const panels = [...root.querySelectorAll("[data-split-panel]")];
  const names = tabs.map((tab) => tab.dataset.splitTab);
  let current = names.includes(active) ? active : names[0];
  // Etykieta panelu na szerokim ekranie (np. jego nagłówek) wraca po wyjściu z trybu wąskiego.
  const wideLabel = new Map(panels.map((panel) => [panel, panel.getAttribute("aria-labelledby")]));

  function apply() {
    const narrow = isCompactLayout();
    markActiveTab(tabs, tabs.find((tab) => tab.dataset.splitTab === current));
    for (const panel of panels) {
      const tab = tabs.find((t) => t.dataset.splitTab === panel.dataset.splitPanel);
      panel.classList.toggle("active", panel.dataset.splitPanel === current);
      if (narrow) {
        panel.setAttribute("role", "tabpanel");
        if (tab?.id) panel.setAttribute("aria-labelledby", tab.id);
      } else {
        panel.removeAttribute("role");
        if (wideLabel.get(panel)) panel.setAttribute("aria-labelledby", wideLabel.get(panel));
        else panel.removeAttribute("aria-labelledby");
      }
    }
  }
  function select(name, { user = false } = {}) {
    if (!names.includes(name)) return;
    current = name;
    apply();
    if (user) onChange?.(name);
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab.dataset.splitTab, { user: true }));
  }
  onDeviceChange(apply);
  apply();
  return { select, active: () => current, narrow: isCompactLayout };
}
