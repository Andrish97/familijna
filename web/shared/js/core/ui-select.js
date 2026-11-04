import { icon, iconText } from "./icons.js?v=v2026-11-04T18552";
import { placeUnder, clearPlacement } from "./popover.js?v=v2026-11-04T18552";


export function initUiSelect(root, { options = [], value = "", placeholder = "—", onChange, disabled = false } = {}) {
  if (!root) return null;
  const btn = root.querySelector(".ui-select-btn");
  const label = root.querySelector(".ui-select-label");
  const menu = root.querySelector(".ui-select-menu");
  if (!btn || !label || !menu) return null;
  const caret = btn.querySelector(".ui-select-caret");
  if (caret) caret.innerHTML = icon("caret-down", { animation: "disclosure" });

  let currentOptions = [];
  let currentValue = "";
  let destroyed = false;

  const close = () => {
    if (destroyed) return;
    root.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    clearPlacement(menu);
  };

  // Listy filtra i sortowania są szersze od przycisku (krótkie etykiety).
  const positionMenu = () => placeUnder(btn, menu, { minWidth: root.matches(".list-filter, .list-sort") ? 220 : 0 });

  const open = () => {
    if (destroyed || root.classList.contains("is-disabled")) return;
    root.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    positionMenu();
  };

  const toggle = () => {
    if (root.classList.contains("open")) close();
    else open();
  };

  const setValue = (val, { silent = false } = {}) => {
    currentValue = String(val ?? "");
    const match = currentOptions.find((opt) => String(opt.value) === currentValue);
    if (match?.icon) label.innerHTML = iconText(match.icon, match.label);
    else label.textContent = match ? match.label : placeholder;
    // pełna nazwa w dymku — na przycisku może być ucięta wielokropkiem
    if (match?.label) btn.title = match.label; else btn.removeAttribute("title");
    for (const item of menu.querySelectorAll(".menu-item")) {
      const isSelected = item.dataset.value === currentValue;
      item.setAttribute("aria-selected", isSelected ? "true" : "false");
    }
    if (!silent && onChange) onChange(currentValue);
  };

  const setOptions = (opts = []) => {
    currentOptions = opts.map((opt) => ({
      value: String(opt.value ?? ""),
      label: String(opt.label ?? ""),
      icon: opt.icon || "",
      dirty: !!opt.dirty,
    }));
    menu.innerHTML = "";
    currentOptions.forEach((opt) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.dataset.value = opt.value;
      if (opt.icon) item.innerHTML = iconText(opt.icon, opt.label);
      else {
        const text = document.createElement("span");
        text.className = "menu-item-label";
        text.textContent = opt.label || placeholder;
        item.appendChild(text);
      }
      if (opt.dirty) {
        item.classList.add("has-unsaved-changes");
        const marker = document.createElement("span");
        marker.className = "ui-select-dirty-dot";
        marker.textContent = "•";
        marker.setAttribute("aria-label", "Niezapisane zmiany");
        item.appendChild(marker);
      }
      item.setAttribute("role", "option");
      if (opt.label) item.title = opt.label;
      item.setAttribute("aria-selected", "false");
      menu.appendChild(item);
    });
    if (!currentOptions.some((opt) => opt.value === currentValue)) {
      currentValue = currentOptions[0]?.value || "";
    }
    setValue(currentValue, { silent: true });
  };

  const setDisabled = (flag) => {
    const on = !!flag;
    root.classList.toggle("is-disabled", on);
    btn.disabled = on;
    if (on) close();
  };

  const handleDocClick = (e) => {
    if (destroyed) return;
    if (!root.contains(e.target)) close();
  };

  // Menu ma position: fixed — przewinięcie paska lub listy z przyciskiem
  // zostawiłoby je w starym miejscu. Przewijanie samego menu go nie zamyka.
  const handleScroll = (e) => {
    if (destroyed || !root.classList.contains("open")) return;
    const target = e.target;
    if (target === menu || menu.contains?.(target)) return;
    if (target === document || target.contains?.(root)) close();
  };

  const handleKeydown = (e) => {
    if (destroyed) return;
    if (e.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { e.preventDefault(); close(); }
  };

  btn.addEventListener("click", (e) => {
    e.preventDefault();
    toggle();
  });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest(".menu-item");
    if (!item) return;
    setValue(item.dataset.value);
    close();
  });

  document.addEventListener("click", handleDocClick);
  document.addEventListener("keydown", handleKeydown);
  document.addEventListener("scroll", handleScroll, true);

  setOptions(options);
  setValue(value, { silent: true });
  setDisabled(disabled);

  return {
    setOptions,
    setValue,
    getValue: () => currentValue,
    setDisabled,
    destroy: () => {
      destroyed = true;
      document.removeEventListener("click", handleDocClick);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("scroll", handleScroll, true);
    },
  };
}
