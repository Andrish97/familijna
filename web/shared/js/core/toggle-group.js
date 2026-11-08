// Przycisk dwóch stanów (.toggle-group w silniku): obie wartości widoczne
// naraz, wybrana wyróżniona; klik w część wybiera tę wartość.
// Wspólny dla przełączników tworzonych w JS (uprawnienie w udostępnianiu
// bazy); znaczniki jak w Ustawieniach gry.
import { icon } from "./icons.js?v=v2026-11-08T23184";

let groupSeq = 0;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/**
 * @param {object} opts
 * @param {string} opts.value                         wybrana wartość
 * @param {{value:string,label:string,icon?:string,title?:string}[]} opts.options
 * @param {string} [opts.label]                       aria-label grupy
 * @param {"sm"} [opts.size]
 * @param {string} [opts.className]                   dodatkowa klasa grupy
 * @param {(value:string) => (boolean|void|Promise<boolean|void>)} [opts.onChange]
 *        false (albo wyjątek) cofa wybór
 */
export function toggleGroupEl({ value, options, label = "", size = "", className = "", onChange } = {}) {
  const group = document.createElement("div");
  group.className = ["toggle-group", size ? `toggle-group--${size}` : "", className].filter(Boolean).join(" ");
  group.setAttribute("role", "radiogroup");
  if (label) group.setAttribute("aria-label", label);
  const name = `toggleGroup${++groupSeq}`;
  const inputs = [];
  let current = value;
  group.dataset.value = current;

  const choose = async (next) => {
    if (next === current) return;
    inputs.forEach((el) => { el.disabled = true; });
    let ok = true;
    try { ok = (await onChange?.(next)) !== false; } catch { ok = false; }
    if (ok) current = next;
    group.dataset.value = current;
    inputs.forEach((el) => { el.disabled = false; el.checked = el.value === current; });
  };

  for (const opt of options) {
    const item = document.createElement("label");
    item.className = "toggle-item";
    if (opt.title) item.title = opt.title;
    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = opt.value;
    input.checked = opt.value === current;
    if (opt.title) input.setAttribute("aria-label", opt.title);
    const slider = document.createElement("span");
    slider.className = "toggle-slider";
    slider.innerHTML = `${opt.icon ? icon(opt.icon) : ""}<span class="toggle-label">${esc(opt.label)}</span>`;
    input.addEventListener("change", () => { if (input.checked) choose(opt.value); });
    inputs.push(input);
    item.append(input, slider);
    group.append(item);
  }
  return group;
}
