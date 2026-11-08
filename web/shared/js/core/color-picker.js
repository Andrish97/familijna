// Wybór koloru — jeden dla całej aplikacji (Ustawienia gry, znaczniki
// Eksploratora): podgląd, pole HEX i suwaki R/G/B (wygląd: .color-picker
// w components.css). Identyfikatory części: <prefix>Preview, <prefix>Hex,
// <prefix>R/G/B i <prefix>RVal/GVal/BVal.

import { t } from "../../translation/translation.js?v=v2026-11-08T14473";
import { hexToRgb, rgbToHex } from "./color.js?v=v2026-11-08T14473";

const CHANNELS = ["R", "G", "B"];

export function colorPickerHTML(prefix) {
  const rows = CHANNELS.map((ch) => `
      <label class="sliderRow"><span class="sLbl">${ch}</span><input class="rng" id="${prefix}${ch}" type="range" min="0" max="255" step="1"/><span class="sVal" id="${prefix}${ch}Val">0</span></label>`).join("");
  return `<div class="color-picker">
    <div class="colorTopRow">
      <div class="colorPreview" id="${prefix}Preview" role="img" aria-label="${t("common.colorPicker.preview")}"></div>
      <label class="colorHexField"><span class="field-label">${t("common.colorPicker.hexLabel")}</span><input class="inp" id="${prefix}Hex" autocomplete="off" spellcheck="false" inputmode="text" placeholder="#RRGGBB"/><span class="hint">${t("common.colorPicker.hexHint")}</span></label>
    </div>
    <div class="sliders">${rows}
    </div>
  </div>`;
}

/**
 * Obsługa wyboru koloru w root (znaczniki z colorPickerHTML).
 * Suwaki i pole HEX zmieniają kolor na bieżąco; poprawny HEX (także
 * „abc”, małe litery) przestawia suwaki, a po zatwierdzeniu pola wraca
 * w zapisie #RRGGBB. onChange(hex) po każdej zmianie przez użytkownika.
 */
export function bindColorPicker(root, { value, onChange } = {}) {
  const preview = root.querySelector(".colorPreview");
  const hexInput = root.querySelector(".colorHexField .inp");
  const rows = [...root.querySelectorAll(".sliderRow")].map((row) => ({ rng: row.querySelector(".rng"), val: row.querySelector(".sVal") }));
  let rgb = [0, 0, 0];

  const get = () => rgbToHex(...rgb);

  function render({ keepHex = false } = {}) {
    const hex = get();
    rows.forEach(({ rng, val }, i) => {
      if (rng) {
        rng.value = String(rgb[i]);
        const from = [...rgb]; from[i] = 0;
        const to = [...rgb]; to[i] = 255;
        rng.style.setProperty("--track", `linear-gradient(to right, ${rgbToHex(...from)}, ${rgbToHex(...to)})`);
      }
      if (val) val.textContent = String(rgb[i]);
    });
    if (hexInput && !keepHex) hexInput.value = hex;
    preview?.style.setProperty("--c", hex);
  }

  function set(hex) {
    const c = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
    rgb = [c.r, c.g, c.b];
    render();
  }

  const onSlider = () => {
    rgb = rows.map(({ rng }) => Number(rng?.value) || 0);
    render();
    onChange?.(get());
  };
  const onHexInput = () => {
    const c = hexToRgb(hexInput.value);
    if (!c) return;
    rgb = [c.r, c.g, c.b];
    render({ keepHex: true });
    onChange?.(get());
  };
  const onHexChange = () => { if (hexToRgb(hexInput.value)) hexInput.value = get(); };

  rows.forEach(({ rng }) => rng?.addEventListener("input", onSlider));
  hexInput?.addEventListener("input", onHexInput);
  hexInput?.addEventListener("change", onHexChange);
  set(value);

  return {
    set,
    get,
    destroy() {
      rows.forEach(({ rng }) => rng?.removeEventListener("input", onSlider));
      hexInput?.removeEventListener("input", onHexInput);
      hexInput?.removeEventListener("change", onHexChange);
    },
  };
}
