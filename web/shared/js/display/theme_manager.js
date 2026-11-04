// theme_manager.js
// Menadżer motywów – motywy wbudowane (web/shared/themes/) i wgrane, THEME command
import { t, getUiLang } from "../../translation/translation.js?v=v2026-11-04T23474";
import { createLayoutTheme } from "./theme_layouts.js?v=v2026-11-04T23474";
import { isCustomThemeKey, loadCustomTheme } from "./custom-themes.js?v=v2026-11-04T23474";
import { loadBuiltinThemes } from "./theme-registry.js?v=v2026-11-04T23474";
import { DEFAULT_PANELS } from "./theme-file.js?v=v2026-11-04T23474";


let THEMES = {};
let THEME_META = [];
let DEFAULT_THEME = "wings";
const EMPTY_THEME = { inputs: { T: null }, outputs: {}, display: { svg: "", page: "#000000", panels: DEFAULT_PANELS, scale: 1 } };

// Rejestr: web/shared/themes/index.json + pliki motywów (theme-registry.js).
// Każdy motyw rysuje createLayoutTheme: wejścia → wyjścia motywu → SVG.
async function initRegistry() {
  try {
    const { defaultKey, themes } = await loadBuiltinThemes();
    DEFAULT_THEME = defaultKey;
    THEME_META = themes.map(theme => ({ key: theme.key, label: theme.label }));
    for (const theme of themes) {
      THEMES[theme.key] = (svg, bg, config) => createLayoutTheme(svg, bg, config, theme.key, theme);
    }
  } catch (e) {
    console.warn("[theme_manager] Rejestr motywów niedostępny:", e.message);
  }
  // Bez rejestru: same wyświetlacze na czarnym tle, żeby gra działała dalej.
  if (Object.keys(THEMES).length === 0) {
    THEMES[DEFAULT_THEME] = (svg, bg, config) => createLayoutTheme(svg, bg, config, DEFAULT_THEME, EMPTY_THEME);
    THEME_META = [{ key: DEFAULT_THEME, label: `display.theme.${DEFAULT_THEME}` }];
  }
}

export async function createThemeManager(baseSvg, bgLayer) {
  await initRegistry();

  let activeTheme = null;
  let activeName = null;

  const load = (name, config = {}) => {
    const key = name.toLowerCase();
    const factory = THEMES[key];
    if (!factory) throw new Error(`THEME: nieznany motyw "${name}". Dostępne: ${getAvailableLabels().map(m => m.label).join(", ")}`);
    activeTheme?.destroy?.();
    activeTheme = factory(baseSvg, bgLayer, config);
    baseSvg.setAttribute("data-display-theme", key);
    activeName = key;
    return activeTheme;
  };

  // Motyw wgrany ("custom:<uuid>") trzeba najpierw pobrać i sprawdzić;
  // false = brak takiego motywu (wywołujący wraca do domyślnego).
  const ensure = async (name) => {
    const key = (name ?? "").toString().toLowerCase();
    if (THEMES[key]) return true;
    if (!isCustomThemeKey(key)) return false;
    const theme = await loadCustomTheme(key);
    if (!theme) return false;
    THEMES[key] = (svg, bg, config) => createLayoutTheme(svg, bg, config, key, theme);
    THEME_META.push({ key, label: theme.label || { pl: theme.name } });
    return true;
  };

  const getActive = () => activeName;
  const getActiveTheme = () => activeTheme;
  const getAvailable = () => Object.keys(THEMES);
  const getDefault = () => DEFAULT_THEME;

  const labelFor = label => typeof label === "object" ? (label[getUiLang()] || label.pl) : t(label);
  const getAvailableLabels = () => THEME_META.map(m => ({ key: m.key, label: labelFor(m.label) }));
  const getThemeLabel = (key) => {
    const m = THEME_META.find(x => x.key === key);
    return m ? labelFor(m.label) : key;
  };

  const updateColors = (colors) => {
    if (!activeTheme) return;
    activeTheme.updateColors?.(colors);
  };

  const updateControls = (controls) => {
    if (!activeTheme) return;
    activeTheme.updateControls?.(controls);
  };

  load(DEFAULT_THEME);

  return {
    load,
    ensure,
    getActive,
    getActiveTheme,
    getAvailable,
    getAvailableLabels,
    getThemeLabel,
    updateColors,
    updateControls,
    getDefault,
  };
}
