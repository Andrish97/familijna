// Prowadzący z pliku motywu: te same wejścia co Wyświetlacz (kolory A, B, T
// z Ustawień gry) → wyjścia motywu jako zmienne CSS --t-nazwa → CSS motywu
// (część "host": reguły z białej listy, zawężone do html[data-host-style]).
// Krój i jego miary ustawia CSS motywu (--host-font…), kroje mogą być wszyte
// w plik (host.fonts); linie papieru i tablica to stałe przełączniki z pliku.
// Schemat: familijna-server/docs/motywy.md.
import { sharedFontUrl } from "../../../shared/js/core/draw-fonts.js?v=v2026-11-08T14473";
import { v as cacheBust } from "../../../shared/js/core/cache-bust.js?v=v2026-11-08T14473";
import { isCustomThemeKey, loadCustomTheme } from "../../../shared/js/display/custom-themes.js?v=v2026-11-08T14473";
import { loadBuiltinThemes, resolveHost } from "../../../shared/js/display/theme-registry.js?v=v2026-11-08T14473";
import { evaluateOutputs, hostRulesCss } from "../../../shared/js/display/theme-file.js?v=v2026-11-08T14473";

const FALLBACK_KEY = "wings";
const DEFAULT_COLORS = { A: "#ff8c1a", B: "#138a50", DOT: "#d7ff3d" };
// Kroje wszyte w motyw (host.fonts): ładowane raz, przed włączeniem CSS motywu.
const loadedFonts = new Map();
function loadFonts(fonts) {
  return Promise.all((fonts || []).map((font) => {
    const id = `${font.family}|${font.weight}|${font.style}|${font.unicodeRange || ""}|${font.file || font.data.length}`;
    if (!loadedFonts.has(id)) {
      const opts = { weight: font.weight, style: font.style, ...(font.unicodeRange ? { unicodeRange: font.unicodeRange } : {}) };
      // czcionka serwisu (web/shared/fonts/) albo wszyta w plik motywu
      const source = font.file
        ? cacheBust(sharedFontUrl(font.file)).then((url) => new FontFace(font.family, `url("${url}") format("woff2")`, opts))
        : Promise.resolve(new FontFace(font.family, Uint8Array.from(atob(font.data.slice(font.data.indexOf(",") + 1)), (c) => c.charCodeAt(0)), opts));
      loadedFonts.set(id, source.then((face) => face.load()).then((loaded) => { document.fonts.add(loaded); })
        .catch((error) => console.warn(`[host2] krój ${font.family} niedostępny:`, error)));
    }
    return loadedFonts.get(id);
  }));
}

function applyHost(host, root, key) {
  let sheet = document.getElementById("hostThemeRules");
  if (!sheet) {
    sheet = document.createElement("style");
    sheet.id = "hostThemeRules";
    document.head.appendChild(sheet);
  }
  sheet.textContent = hostRulesCss(host.css);
  root.dataset.hostTheme = key;
  root.dataset.hostStyle = key;
  root.dataset.hostRuled = String(host.ruled);
  root.dataset.hostBoard = String(host.board);
}

export async function createHostThemeApplier() {
  let defaultKey = FALLBACK_KEY, byKey = new Map();
  try { ({ defaultKey, byKey } = await loadBuiltinThemes()); }
  catch (error) { console.warn("[host2] nie udało się wczytać rejestru motywów:", error); }
  let currentKey = null;
  let currentTheme = null;

  async function activate(key, root) {
    const theme = isCustomThemeKey(key) ? await loadCustomTheme(key) : byKey.get(key);
    const host = theme ? await resolveHost(theme) : null;
    if (!host) {
      console.warn(`[host2] nieznany motyw "${key}"`);
      if (key === FALLBACK_KEY) return currentKey;
      return activate(FALLBACK_KEY, root);
    }
    await loadFonts(host.fonts);
    applyHost(host, root, key);
    currentTheme = theme;
    return key;
  }

  async function apply(row) {
    const root = document.documentElement;
    const key = row.detail?.display?.theme || defaultKey;
    if (key !== currentKey) currentKey = await activate(key, root);

    const colors = row.detail?.display?.colors || {};
    root.style.setProperty("--host-dot", colors.DOT || DEFAULT_COLORS.DOT);
    if (!currentTheme) return;
    // Wyjścia motywu dla bieżących kolorów → zmienne CSS używane w CSS motywu.
    const out = evaluateOutputs(currentTheme, { A: colors.A || DEFAULT_COLORS.A, B: colors.B || DEFAULT_COLORS.B, T: colors.BACKGROUND || null });
    for (const [name, value] of Object.entries(out)) if (typeof value === "string" && value.startsWith("#")) root.style.setProperty(`--t-${name}`, value);
  }

  return { apply };
}
