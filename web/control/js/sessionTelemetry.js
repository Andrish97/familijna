// Wyniki zapisuje baza przy zmianach game_state. Front zgłasza tylko
// aktywność i lokalne obserwacje; telemetryka nie blokuje akcji gry.
// Obserwacje idą dziennikiem sesji (session-log.js, control2_control_log,
// migracje 468–469) — także przed startem gry, do sesji uruchomienia Control.
import { sb, SUPABASE_URL } from "../../shared/js/core/supabase.js?v=v2026-11-08T23100";
import { createNetworkMonitor, measureNetwork } from "../../shared/js/core/network-probe.js?v=v2026-11-08T23100";
import { collectDeviceInfo, createSessionLog, watchPageLifecycle, watchRuntimeErrors } from "../../shared/js/core/session-log.js?v=v2026-11-08T23100";


export function createSessionTelemetry(gameId, getState, subscribe = () => () => {}) {
  // Token użytkownika do wysyłki przy zamknięciu strony (fetch keepalive).
  let accessToken = null;
  const refreshToken = () => sb().auth.getSession()
    .then(({ data }) => { accessToken = data?.session?.access_token || null; }, () => {});
  void refreshToken();

  const log = createSessionLog({
    rpc: "control2_control_log",
    params: () => ({ p_game_id: gameId }),
    accessToken: () => accessToken,
  });

  let hiddenAt = document.hidden ? Date.now() : null;
  function logVisibility(reason) {
    const visible = document.visibilityState === "visible";
    const event = {
      event_type: "page_state",
      reason,
      visibility: document.visibilityState || "unknown",
      focused: !!document.hasFocus?.(),
      was_discarded: !!document.wasDiscarded,
      online: navigator.onLine !== false,
    };
    if (visible && hiddenAt != null) event.hidden_duration_ms = Math.max(0, Date.now() - hiddenAt);
    hiddenAt = visible ? null : (hiddenAt ?? Date.now());
    log.push(event);
  }

  // Pomiar łącza Control w trakcie gry (migracja 466) — jak na urządzeniach.
  let networkActive = false;
  const network = createNetworkMonitor({
    probe: () => measureNetwork({
      pingUrl: `${SUPABASE_URL}/_ping`,
      rpc: (signal) => sb().rpc("control2_net_ping").abortSignal(signal),
    }),
    send: (phase, data) => {
      if (!networkActive) return;
      log.push({ event_type: "network_state", source: "probe", phase, visibility: document.hidden ? "hidden" : "visible", ...data });
    },
  });
  function syncNetwork(state) {
    const next = !!state?.locks?.gameStarted && !state?.locks?.gameEnded;
    if (next === networkActive) return;
    networkActive = next;
    if (next) network.start(); else network.stop();
  }

  // Sygnał aktywności sesji rozgrywki (last_seen_at) — tylko w trakcie gry.
  async function ping() {
    const state = getState();
    if (!state.locks.gameStarted || state.locks.gameEnded || state.step === "r_intro") return;
    try {
      await sb().rpc("control2_session_ping", { p_game_id: gameId });
    } catch { /* Auxiliary diagnostics never interrupt gameplay or flood console. */ }
  }

  async function report(event = null) {
    syncNetwork(getState());
    if (event) log.push(event);
    void refreshToken();
    await ping();
  }

  logVisibility("initial");
  void collectDeviceInfo().then(info => log.push(info), () => {});
  const stopLifecycle = watchPageLifecycle(event => log.push(event), { onExit: () => log.flushOnExit() });
  const stopRuntimeErrors = watchRuntimeErrors(event => log.push(event), "control");
  const timer = setInterval(() => { void report(); }, 5 * 60 * 1000);
  syncNetwork(getState());
  const unsubscribe = subscribe(state => syncNetwork(state));
  function visibilityChanged() {
    logVisibility("visibilitychange");
    if (!document.hidden) void report();
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  return {
    report,
    logEvent(event) { if (event) log.push(event); },
    probeNetworkNow() { network.probeNow(); },
    stop() {
      networkActive = false;
      network.stop();
      clearInterval(timer);
      unsubscribe?.();
      stopLifecycle();
      stopRuntimeErrors();
      document.removeEventListener("visibilitychange", visibilityChanged);
      log.stop();
    },
  };
}
