// Ukryta gra w węża (/snake/): zapis zdarzeń do statystyk admina
// (scan -- wejście z kodu QR na kadrze, enter, start, finish z wynikiem).
// Przeglądarkę rozpoznaje losowy identyfikator w localStorage; zalogowanym
// RPC zwraca też postęp (best, games). Błąd zapisu nie przeszkadza w grze.
import { sb } from "./supabase.js?v=v2026-11-14T11110";

const VISITOR_KEY = "familijna:snake:visitor";

export function snakeVisitor() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id || "")) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return `tmp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }
}

export async function logSnake(kind, { score = null, lang = null } = {}) {
  try {
    const { data, error } = await sb().rpc("snake_log", { p_kind: kind, p_visitor: snakeVisitor(), p_score: score, p_lang: lang });
    if (error) throw error;
    return data || null;
  } catch (e) {
    console.warn("[snake]", kind, e?.message || e);
    return null;
  }
}
