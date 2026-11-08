// Sesja runtime Control jest osobna od telemetryki game_sessions i od
// krótkiego TTL blokady strony. Aktywność oznacza świadome działanie
// operatora; heartbeat urządzeń ani animacje nie przesuwają terminu.
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T14583";
import { t } from "../../shared/translation/translation.js?v=v2026-11-08T14583";


const IDLE_STORAGE_KEY = (gameId) => `fam:control:runtime:${gameId}`;
const OUTRO_STORAGE_KEY = (gameId) => `control2:outro-started:${gameId}`;
const ACTIVITY_THROTTLE_MS = 30_000;

export function createRuntimeSession({ gameId, onExpired }) {
  const storageKey = IDLE_STORAGE_KEY(gameId);
  let sessionId = sessionStorage.getItem(storageKey);
  let lastSentAt = 0;
  let inFlight = false;
  let stopped = false;

  async function touch() {
    if (inFlight || stopped) return null;
    inFlight = true;
    try {
      const { data, error } = await sb().rpc("control_runtime_session_touch_v2", {
        p_game_id: gameId,
        p_session_id: sessionId,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || t("control.errors.sessionRenew"));

      sessionId = data.session_id;
      if (data.device_protocol !== 2) {
        throw new Error("Serwer zwrócił nieznaną wersję połączenia urządzeń.");
      }
      if (sessionId) sessionStorage.setItem(storageKey, sessionId);
      lastSentAt = Date.now();
      if (data.expired) {
        sessionStorage.removeItem(OUTRO_STORAGE_KEY(gameId));
        onExpired?.();
      }
      return data;
    } finally {
      inFlight = false;
    }
  }

  function onActivity() {
    if (Date.now() - lastSentAt < ACTIVITY_THROTTLE_MS) return;
    void touch().catch((error) => console.warn("[control2 runtime session]", error?.message || error));
  }

  function start() {
    return touch().then((data) => {
      if (data?.ok) {
        document.addEventListener("pointerdown", onActivity, { passive: true });
        document.addEventListener("keydown", onActivity, { passive: true });
        document.addEventListener("input", onActivity, { passive: true, capture: true });
        document.addEventListener("change", onActivity, { passive: true, capture: true });
      }
      return data;
    });
  }

  function stop() {
    stopped = true;
    document.removeEventListener("pointerdown", onActivity);
    document.removeEventListener("keydown", onActivity);
    document.removeEventListener("input", onActivity, true);
    document.removeEventListener("change", onActivity, true);
  }

  return { start, stop, noteActivity: onActivity, get sessionId() { return sessionId; } };
}
