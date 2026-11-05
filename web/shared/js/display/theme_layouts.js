// Silnik motywów Wyświetlacza — jeden dla wszystkich motywów.
//   wejścia (kolory A, B, T z Ustawień gry + stan kontrolek a/b/off)
//   → wyjścia motywu (wzory "outputs" z pliku, evaluateOutputs)
//   → SVG motywu (atrybuty "@nazwa") i wypełnienie ekranu (display.page, var(--t-nazwa)).
// display.motion: płynne przejście wyjść przy zmianie stanu (stała czasowa, ms).
// Silnik nie zna żadnego konkretnego motywu. Schemat: familijna-server/docs/motywy.md.
import { evaluateOutputs, OUTPUT_ATTRIBUTES } from "./theme-file.js?v=v2026-11-05T14595";

// Nazwy wyświetlaczy w pliku (display.panels) → nazwy w createDisplays().
const PANEL_NAMES = { big: "big", left: "leftPanel", right: "rightPanel", top: "topPanel", longA: "long1", longB: "long2" };
// Gotowe animacje dla SVG motywu (ANIMATION_CLASSES w theme-file.js):
// anim-flow (odcinek płynący po obrysie; .modern-slot to ten sam ruch Nowoczesnego),
// anim-pulse (przygasanie), anim-spin (obrót wokół środka elementu),
// anim-blink (miganie); anim-slow / anim-fast — dwa razy wolniej / szybciej.
const STYLE = `<style>
.modern-slot, .anim-flow { stroke-dasharray: 1000 1000; stroke-dashoffset: 0; animation: anim-flow 12s linear infinite; animation-delay: -3s; }
.anim-pulse { animation: anim-pulse 2s ease-in-out infinite; }
.anim-spin { transform-box: fill-box; transform-origin: center; animation: anim-spin 8s linear infinite; }
.anim-blink { animation: anim-blink 1s steps(1, end) infinite; }
.anim-flow.anim-slow { animation-duration: 24s; } .anim-flow.anim-fast { animation-duration: 6s; }
.anim-pulse.anim-slow { animation-duration: 4s; } .anim-pulse.anim-fast { animation-duration: 1s; }
.anim-spin.anim-slow { animation-duration: 16s; } .anim-spin.anim-fast { animation-duration: 4s; }
.anim-blink.anim-slow { animation-duration: 2s; } .anim-blink.anim-fast { animation-duration: .5s; }
@keyframes anim-flow { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -2000; } }
@keyframes anim-pulse { 50% { opacity: .35; } }
@keyframes anim-spin { to { transform: rotate(360deg); } }
@keyframes anim-blink { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .modern-slot, .anim-flow { animation: none; stroke-dashoffset: -500; }
  .anim-pulse, .anim-spin, .anim-blink { animation: none; }
}
</style>`;
const HEX = /^#[0-9a-f]{6}$/i;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (values) => "#" + values.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
// Krok płynnego przejścia: kolory i liczby zbliżają się do celu; "none" i
// zmiana typu przeskakują od razu.
export function approach(from, to, amount) {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * amount;
  if (HEX.test(String(from)) && HEX.test(String(to))) {
    const a = rgb(from), b = rgb(to);
    // Kanały są liczbami całkowitymi: krok co najmniej o 1, inaczej zaokrąglenie
    // zatrzymałoby kolor tuż przed celem, a animacja nie skończyłaby się nigdy.
    return hex(a.map((v, i) => {
      const step = (b[i] - v) * amount;
      return Math.abs(step) < 1 && b[i] !== v ? v + Math.sign(b[i] - v) : v + step;
    }));
  }
  return to;
}
const close = (a, b) => typeof a === "number" ? Math.abs(a - b) < .01
  : (HEX.test(String(a)) && HEX.test(String(b)) ? rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) < 1) : a === b);

// theme = motyw z theme-file.js: { inputs, outputs, display: { svg, page, panels, scale, motion } }.
export function createLayoutTheme(baseSvg, bgLayer, config = {}, name, theme) {
  const defaultT = theme.inputs.T?.default ?? null;
  const colors = { A: "#ff8c1a", B: "#138a50", ...(defaultT ? { BG: defaultT } : {}), ...config.colors };
  const controls = { A: false, B: false, ...config.controls };
  const motion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
  let frame = null, previousTime = null, destroyed = false;
  bgLayer.innerHTML = "";
  bgLayer.style.opacity = "1";
  baseSvg.setAttribute("viewBox", "0 0 1280 720");
  baseSvg.setAttribute("data-display-theme", name);
  baseSvg.innerHTML = STYLE + theme.display.svg;
  const displays = {};
  for (const [key, [cx, cy]] of Object.entries(theme.display.panels)) displays[PANEL_NAMES[key]] = { cx, cy };
  // Elementy SVG związane z wyjściami: atrybut "@nazwa" → właściwość stylu.
  const bound = [];
  for (const el of baseSvg.querySelectorAll("*")) {
    for (const attr of OUTPUT_ATTRIBUTES) {
      const value = el.getAttribute(attr);
      if (!value?.startsWith("@")) continue;
      bound.push({ el, attr, out: value.slice(1) });
      el.removeAttribute(attr);
    }
  }
  let shown = null;
  const target = () => {
    const state = controls.A ? "a" : controls.B ? "b" : "off";
    const T = HEX.test(colors.BG || "") ? colors.BG : defaultT;
    return evaluateOutputs(theme, { A: colors.A, B: colors.B, T, state });
  };
  function apply(out) {
    for (const { el, attr, out: key } of bound) {
      const value = out[key];
      if (attr === "data-glow") el.style.filter = value && value !== "none" ? `drop-shadow(0 0 6px ${value})` : "";
      else if (value === "none" && attr !== "fill" && attr !== "stroke") el.style.removeProperty(attr);
      else el.style.setProperty(attr, attr === "stroke-width" ? `${value}px` : String(value));
    }
    for (const [key, value] of Object.entries(out)) if (HEX.test(String(value))) bgLayer.style.setProperty(`--t-${key}`, value);
    bgLayer.style.background = theme.display.page;
    shown = out;
  }
  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null; previousTime = null;
  }
  // Zmiana stanu: przy display.motion > 0 wyjścia dochodzą do celu płynnie
  // (krok 1 − e^(−Δt/motion)); zmiana kolorów w Ustawieniach — od razu.
  function animate() {
    if (destroyed) return;
    if (!theme.display.motion || motion?.matches || !shown) { stop(); apply(target()); return; }
    if (frame !== null) return;
    const tick = (now) => {
      if (destroyed) return;
      const delta = previousTime === null ? 16.67 : Math.min(now - previousTime, 64);
      previousTime = now;
      const amount = 1 - Math.exp(-delta / theme.display.motion);
      const goal = target();
      const next = {};
      let moving = false;
      for (const [key, value] of Object.entries(goal)) {
        next[key] = approach(shown[key] ?? value, value, amount);
        if (!close(next[key], value)) moving = true;
      }
      apply(moving ? next : goal);
      frame = moving ? requestAnimationFrame(tick) : null;
      if (!moving) previousTime = null;
    };
    frame = requestAnimationFrame(tick);
  }
  apply(target());
  motion?.addEventListener?.("change", animate);
  return {
    name, displays, multiplier: theme.display.scale,
    getColors: () => ({ ...colors }), getControls: () => ({ ...controls }),
    updateColors(next) { Object.assign(colors, next); stop(); apply(target()); },
    updateControls(next) { Object.assign(controls, next); animate(); },
    destroy() {
      destroyed = true;
      stop();
      motion?.removeEventListener?.("change", animate);
    },
  };
}
