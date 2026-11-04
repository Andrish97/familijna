// custom-themes.js
// Wczytywanie wgranych motywów (klucz "custom:<uuid>") z publicznego
// bucketu user-themes. Każde wczytanie przechodzi ponownie przez walidator,
// więc wyświetlacz i Prowadzący rysują tylko grafikę z białej listy.
// Brak pliku albo błąd walidacji → null (strona wraca do motywu domyślnego).
import { SUPABASE_URL } from "../core/supabase.js?v=v2026-11-04T23474";
import { parseThemeFile, customThemeId, themeObjectPath, THEME_BUCKET } from "./theme-file.js?v=v2026-11-04T23474";

const cache = new Map();

export const isCustomThemeKey = (key) => customThemeId(key) !== null;

export function customThemeUrl(id) {
  return `${SUPABASE_URL}/storage/v1/object/public/${THEME_BUCKET}/${themeObjectPath(id)}`;
}

export function loadCustomTheme(key) {
  const id = customThemeId(key);
  if (!id) return Promise.resolve(null);
  if (!cache.has(id)) {
    cache.set(id, (async () => {
      try {
        const response = await fetch(customThemeUrl(id), { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = parseThemeFile(await response.text());
        if (!result.ok) throw new Error(`plik motywu: ${result.error}`);
        return result.theme;
      } catch (error) {
        console.warn(`[themes] nie udało się wczytać motywu ${id}:`, error.message);
        cache.delete(id);
        return null;
      }
    })());
  }
  return cache.get(id);
}
