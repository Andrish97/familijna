// theme-registry.js
// Motywy wbudowane: web/shared/themes/index.json to lista plików, a każdy
// plik <klucz>.json ma ten sam format co motyw wgrany (theme-file.js).
// Wspólne dla Wyświetlacza, Prowadzącego i Ustawień gry.
// Zasady: familijna-server/docs/motywy.md.
import { parseThemeFile } from "./theme-file.js?v=v2026-11-08T15451";

const INDEX_URL = "/shared/themes/index.json?v=v2026-11-08T15451";
let registry = null;

async function load() {
  const response = await fetch(INDEX_URL);
  if (!response.ok) throw new Error(`index.json: HTTP ${response.status}`);
  const index = await response.json();
  const builtinKeys = (index.themes || []).map((entry) => entry.key);
  const themes = await Promise.all((index.themes || []).map(async (entry) => {
    try {
      const res = await fetch(entry.file);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = parseThemeFile(await res.text(), { builtin: true, builtinKeys });
      if (!result.ok) throw new Error(`${result.error} ${result.detail}`);
      return { key: entry.key, ...result.theme };
    } catch (error) {
      console.warn(`[themes] pominięty motyw ${entry.key}:`, error.message);
      return null;
    }
  }));
  const list = themes.filter(Boolean);
  const byKey = new Map(list.map((theme) => [theme.key, theme]));
  // "host": "<klucz>" — Prowadzący pożyczony z innego motywu wbudowanego.
  for (const theme of list) if (theme.host.from) theme.host = byKey.get(theme.host.from)?.host ?? null;
  return { defaultKey: index.default || "wings", themes: list, byKey };
}

// { defaultKey, themes: [{ key, name, label, display, host }], byKey } —
// motywy w kolejności z index.json; display i host jak w theme-file.js.
export function loadBuiltinThemes() {
  if (!registry) registry = load().catch((error) => { registry = null; throw error; });
  return registry;
}

// Prowadzący motywu (także wgranego z "host": "<klucz>").
export async function resolveHost(theme) {
  if (!theme?.host?.from) return theme?.host ?? null;
  const { byKey } = await loadBuiltinThemes();
  return byKey.get(theme.host.from)?.host ?? null;
}
