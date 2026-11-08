// Przyciski − i + przy polu liczbowym albo suwaku (edytory logo).
// Jeden krok = krok pola (atrybut step); przytrzymany przycisk powtarza krok
// coraz szybciej. Pole dostaje `input` przy każdym kroku i jedno `change` po
// puszczeniu (jak przy przeciąganiu suwaka) -- historia zmian ma jeden wpis.
import { t } from "../../shared/translation/translation.js?v=v2026-11-08T15455";

const DELAYS = (n) => (n < 6 ? 140 : n < 20 ? 60 : 25);

function stepField(input, dir) {
  if (!input || input.disabled) return false;
  const before = input.value;
  try { if (dir > 0) input.stepUp(); else input.stepDown(); } catch { return false; }
  if (input.value === before) return false;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** HTML: [−][pole][+] (pasek ustawień rysunku buduje HTML z tekstu). */
export function stepperHtml(inputHtml) {
  const btn = (dir) =>
    `<button class="btn icon stepBtn" type="button" data-dir="${dir}" aria-label="${t(dir > 0 ? "logoEditor.image.stepUp" : "logoEditor.image.stepDown")}">${dir > 0 ? "+" : "−"}</button>`;
  return `<div class="stepper">${btn(-1)}${inputHtml}${btn(1)}</div>`;
}

/** DOM: owija istniejące pole w [−][pole][+] (pasek suwaka obrazu). */
export function wrapStepper(input, cls = "") {
  if (!input || input.parentElement?.classList.contains("stepper")) return;
  const box = document.createElement("div");
  box.className = `stepper ${cls}`.trim();
  input.before(box);
  box.insertAdjacentHTML("afterbegin", stepperHtml("").replace(/^<div class="stepper">|<\/div>$/g, ""));
  box.insertBefore(input, box.lastElementChild);
}

/** Obsługa wszystkich przycisków − / + w `root` (delegacja; raz na stronę). */
export function bindSteppers(root) {
  if (!root || root.dataset.steppers) return;
  root.dataset.steppers = "1";
  let timer = null, n = 0, input = null, held = null;
  const stop = () => {
    clearTimeout(timer); timer = null;
    if (input && n) input.dispatchEvent(new Event("change", { bubbles: true }));
    n = 0; input = null; held = null;
  };
  const tick = (dir) => { if (stepField(input, dir)) n++; timer = setTimeout(() => tick(dir), DELAYS(n)); };
  root.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.(".stepBtn");
    if (!b || e.button !== 0 || !root.contains(b)) return;
    e.preventDefault(); // pole nie traci fokusu, klawiatura ekranowa się nie wysuwa
    stop();
    held = b;
    input = b.parentElement?.querySelector("input");
    const dir = Number(b.dataset.dir) || 1;
    if (stepField(input, dir)) n = 1;
    timer = setTimeout(() => tick(dir), 400);
    b.setPointerCapture?.(e.pointerId);
  });
  for (const ev of ["pointerup", "pointercancel"]) root.addEventListener(ev, () => { if (held) stop(); });
  root.addEventListener("lostpointercapture", () => { if (held) stop(); });
  // klawiatura (Enter / Spacja na przycisku): jeden krok
  root.addEventListener("click", (e) => {
    const b = e.target.closest?.(".stepBtn");
    if (!b || e.detail !== 0) return;
    const f = b.parentElement?.querySelector("input");
    if (stepField(f, Number(b.dataset.dir) || 1)) f.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

// zmiana języka: opisy przycisków − / +
window.addEventListener("i18n:lang", () => {
  for (const b of document.querySelectorAll(".stepBtn")) {
    b.setAttribute("aria-label", t(Number(b.dataset.dir) > 0 ? "logoEditor.image.stepUp" : "logoEditor.image.stepDown"));
  }
});
