// js/core/supabase.js
// Ten moduł eksportuje FUNKCJĘ sb(), bo Twój auth.js wywołuje sb().auth...

export const SUPABASE_URL = "https://api.familijna.app";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsImF1ZCI6ImF1dGhlbnRpY2F0ZWQiLCJpYXQiOjE3NzIyMTEyNTAsImV4cCI6MjA4NzU3MTI1MCwicm9sZSI6ImFub24ifQ.9Hg8RB6iC72o2ommzcYUNQWnPSzsDyUdxwQR9PGcF4U";
// Sygnał kontrolny Realtime co 10 s (domyślnie 25 s): zerwane po cichu
// gniazdo (np. telefon przechodzi z Wi-Fi na LTE) wykryte po 10–20 s zamiast
// 25–50 s; potem ponowne dołączenie i odczyt stanu. Odpowiedź może się
// spóźnić do 10 s bez fałszywego zerwania na słabym łączu.
export const REALTIME_OPTIONS = { heartbeatIntervalMs: 10_000 };

import { startActivity } from "./activity.js?v=v2026-11-05T20334";
import { applyLegacyHandoff } from "./legacy-handoff.js?v=v2026-11-05T20334";


let _client = null;

export function sb() {
  if (_client) return _client;

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    throw new Error(
      "supabase-js nie jest załadowany. Upewnij się, że <script src='/shared/vendor/supabase-js.js?v=v2026-11-05T20334' defer></script> jest przed modułami."
    );
  }

  applyLegacyHandoff();
  _client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { realtime: REALTIME_OPTIONS });

  // żeby reszta stron mogła używać window.supabaseClient
  window.supabaseClient = _client;
  startActivity(_client);

  return _client;
}
// debug helper:
globalThis.__sb = sb;
globalThis.__sbClient = sb();

export function buildSiteUrl(path = "") {
  const p = String(path || "").trim();
  const normalized = p.startsWith("/") ? p : `/${p}`;
  return new URL(normalized, location.origin).toString();
}
