// Przycisk motywu w topbarze, osobno od języka (decyzja 2026-11-03,
// familijna-server/docs/jasny-motyw-plan.md): menu Auto / Jasny / Ciemny.
// Stan trzyma page-boot.js (FamilijnaTheme); ekrany gry mają motyw zablokowany
// i nie dostają przycisku.
import { icon, iconText } from "./icons.js?v=v2026-11-08T15560";
import { placeDropdown } from "./popover.js?v=v2026-11-08T15560";

const ICONS = { auto: "theme-auto", light: "theme-light", dark: "theme-dark" };
const KEYS = { auto: "common.themeAuto", light: "common.themeLight", dark: "common.themeDark" };

let switcherEl = null;
let translate = (key) => key;

function refresh() {
  const theme = globalThis.FamilijnaTheme;
  if (!switcherEl || !theme) return;
  const btn = switcherEl.querySelector(".theme-btn");
  btn.innerHTML = icon(ICONS[theme.getChoice()]);
  btn.setAttribute("aria-label", translate("common.themeLabel"));
  for (const opt of switcherEl._menu.querySelectorAll(".menu-item[data-theme]")) {
    const choice = opt.dataset.theme;
    opt.innerHTML = iconText(ICONS[choice], translate(KEYS[choice]));
    opt.setAttribute("aria-selected", String(theme.getChoice() === choice));
  }
}

/** Wstawia przycisk motywu przed `before` w `slot`. `t` — funkcja tłumaczeń. */
export function injectThemeSwitcher(slot, before, t) {
  const theme = globalThis.FamilijnaTheme;
  if (typeof t === "function") translate = t;
  if (!theme || theme.locked || !slot) return null;
  if (switcherEl) { refresh(); return switcherEl; }

  const container = document.createElement("div");
  container.className = "theme-switcher";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn theme-btn";
  const menu = document.createElement("div");
  menu.className = "theme-menu";
  menu.hidden = true;
  document.body.appendChild(menu);
  for (const choice of theme.CHOICES) {
    const opt = document.createElement("button");
    opt.type = "button";
    opt.className = "menu-item";
    opt.dataset.theme = choice;
    opt.addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = true;
      theme.setChoice(choice);
    });
    menu.appendChild(opt);
  }
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    if (!menu.hidden) placeDropdown(container, menu);
  });
  document.addEventListener("click", (e) => {
    if (!container.contains(e.target) && !menu.contains(e.target)) menu.hidden = true;
  });
  const reposition = () => { if (!menu.hidden) placeDropdown(container, menu); };
  window.addEventListener("resize", reposition, { passive: true });
  window.addEventListener("scroll", reposition, { passive: true });
  window.addEventListener("theme:choice", refresh);

  container.appendChild(btn);
  container._menu = menu;
  slot.insertBefore(container, before && before.parentNode === slot ? before : null);
  switcherEl = container;
  refresh();
  return container;
}

/** Odświeża napisy po zmianie języka. */
export function refreshThemeSwitcher() { refresh(); }
