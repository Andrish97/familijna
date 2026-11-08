import { sb, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase.js?v=v2026-11-08T09471";
import { t } from "../../translation/translation.js?v=v2026-11-08T09471";
import { getDevicePresenceMeta } from "./device-context.js?v=v2026-11-08T09471";
import { startTicker } from "./background-ticker.js?v=v2026-11-08T09471";
import { blockingScreen, setBlockingIcon, setBlockingOpen } from "./blocking-screen.js?v=v2026-11-08T09471";
import { collectDeviceInfo, createSessionLog, watchPageLifecycle, watchRuntimeErrors } from "./session-log.js?v=v2026-11-08T09471";
import { onWakeLockChange } from "./keep-alive.js?v=v2026-11-08T09471";


const HEARTBEAT_MS = 3_000;
const makeConnectionId = () => globalThis.crypto?.randomUUID?.()
  || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
  });

// Świadome przejęcie z ekranu „otwarto w innym miejscu” (jedna instancja
// lease na stronę urządzenia).
let takeoverHandler = null;

export function updateDeviceLeaseOverlay(state) {
  // Wspólny ekran blokady (blocking-screen.js); części: deviceLeaseIcon,
  // deviceLeaseTitle, deviceLeaseMsg, deviceLeaseTakeover.
  const overlay = blockingScreen("deviceLeaseOverlay", [
    { key: "Takeover", i18n: "deviceLease.takeover", iconName: "check", accent: true },
  ], { prefix: "deviceLease" });
  if (!overlay.dataset.leaseState) {
    overlay.setAttribute("aria-live", "polite");
    document.getElementById("deviceLeaseTakeover")?.addEventListener("click", () => takeoverHandler?.());
  }
  overlay.dataset.leaseState = state || "starting";
  if (state === "primary") {
    setBlockingOpen(overlay, false);
    return;
  }
  const replaced = state === "replaced";
  setBlockingIcon(overlay, replaced ? "phone" : "refresh");
  document.getElementById("deviceLeaseTitle").textContent = t(replaced ? "deviceLease.replacedTitle" : "deviceLease.reconnectingTitle");
  document.getElementById("deviceLeaseMsg").textContent = t(replaced ? "deviceLease.replacedText" : "deviceLease.reconnectingText");
  overlay.querySelector(".blocking-actions").hidden = !replaced;
  setBlockingOpen(overlay, true);
}

export function createDeviceLease({ gameId, deviceType, key, onState }) {
  let connectionId = makeConnectionId();
  let mode = "starting";
  let state = "starting";
  let epoch = null;
  let registerNext = true;
  // Pierwsza rejestracja tej strony przejmuje rolę główną od razu, z dowolnej
  // przeglądarki (migracja 472); poprzednia instancja dostaje 'replaced'.
  // Ponowne rejestracje — np. po wybudzeniu karty — już nie: przy żywej
  // głównej instancji wybudzona karta zostaje wyparta i nie wraca sama.
  let firstRegistration = true;
  let inFlight = false;
  // Bieżący heartbeat — refresh() czeka na niego zamiast wysyłać drugi.
  let inFlightPromise = null;
  let stopped = false;
  let heartbeatAgain = false;
  let stopTicker = null;
  // Metadane strony (diagnostyka, odblokowanie dźwięku Wyświetlacza) jadą
  // tym samym heartbeatem co lease — jeden zapis, jedna transakcja w bazie.
  let extraMeta = {};
  let audioUnlockedOnServer = false;
  let lastHeartbeatOkAt = null;
  let hiddenAt = document.visibilityState === "hidden" ? Date.now() : null;
  let loggedConnection = null;
  const progress = { received_rev: 0, rendered_rev: 0, started_sound_cue_seq: 0 };

  const meta = () => ({
    ...getDevicePresenceMeta(gameId, extraMeta),
    visibility: document.visibilityState || "unknown",
    focused: !!document.hasFocus?.(),
    ...progress,
  });

  function publish(data = {}) {
    const wasPrimary = state === "primary";
    if (typeof data.audio_unlocked === "boolean") audioUnlockedOnServer = data.audio_unlocked;
    mode = data.mode || mode;
    const previous = `${state}:${epoch}`;
    state = data.state || state;
    epoch = state === "primary" ? Number(data.epoch) : null;
    if (`${state}:${epoch}` !== previous) onState?.({ mode, state, epoch, queuePosition: data.queue_position ?? null, waitingCount: data.waiting_count ?? 0 });
    if (!wasPrimary && state === "primary") logConnectionStart();
  }

  async function call(name, params) {
    const { data, error } = await sb().rpc(name, params).abortSignal(AbortSignal.timeout(6500));
    if (error) throw error;
    return data;
  }

  // Ramki trybu testowego leżą w karcie Control: ich widoczność jest
  // widocznością Control (zapisywaną przez Control), więc tylko by ją
  // czterokrotnie dublowały w statystykach.
  const insideControlTestFrame = (() => {
    try { return window.parent !== window && window.frameElement?.dataset?.controlTestMode === "true"; }
    catch { return false; }
  })();

  // Diagnostyka sesji (migracje 468–469): zapis od chwili, gdy ta instancja
  // jest główna — także przed startem gry (krok Urządzenia).
  const log = createSessionLog({
    rpc: "control2_device_log",
    params: () => ({ p_game_id: gameId, p_device_type: deviceType, p_key: key, p_connection_id: connectionId, p_epoch: epoch }),
    canSend: () => !insideControlTestFrame && mode === "lease" && state === "primary" && Number.isFinite(epoch),
  });
  const logEvent = (event) => { if (!insideControlTestFrame) log.push(event); };

  function queuePageState(reason) {
    if (stopped) return;
    const visible = document.visibilityState === "visible";
    const event = {
      event_type: "page_state",
      reason,
      visibility: document.visibilityState || "unknown",
      focused: !!document.hasFocus?.(),
      was_discarded: !!document.wasDiscarded,
      online: navigator.onLine !== false,
    };
    // Zapis „w tle” często nie wychodzi przed zamrożeniem strony — czas
    // w tle i od ostatniego sygnału życia niesie zapis powrotu.
    if (visible && hiddenAt != null) event.hidden_duration_ms = Math.max(0, Date.now() - hiddenAt);
    if (visible && lastHeartbeatOkAt != null) event.since_heartbeat_ms = Math.max(0, Date.now() - lastHeartbeatOkAt);
    hiddenAt = visible ? null : (hiddenAt ?? Date.now());
    logEvent(event);
  }

  function logConnectionStart() {
    if (loggedConnection === connectionId) return;
    loggedConnection = connectionId;
    queuePageState("initial");
    void collectDeviceInfo().then(logEvent, () => {});
  }

  async function heartbeat(register = false) {
    if (stopped) return null;
    // Wyparta karta nie odpytuje serwera; wraca tylko przez takeover().
    if (state === "replaced" && !register) return null;
    if (inFlight) {
      // Nowsze metadane (np. odblokowanie dźwięku) nie mogą czekać na
      // kolejny takt — wyślij je zaraz po bieżącym żądaniu.
      heartbeatAgain = true;
      return null;
    }
    inFlight = true;
    let settle;
    inFlightPromise = new Promise((resolve) => { settle = resolve; });
    try {
      let shouldRegister = register || registerNext || mode !== "lease";
      const params = () => ({
        p_game_id: gameId, p_device_type: deviceType, p_key: key,
        p_connection_id: connectionId, p_meta: meta(),
      });
      const registerParams = () => {
        const base = params();
        return firstRegistration ? { ...base, p_meta: { ...base.p_meta, takeover: true } } : base;
      };
      let data = await call(shouldRegister ? "control_device_instance_register" : "control_device_instance_heartbeat",
        shouldRegister ? registerParams() : { ...params(), p_epoch: epoch });
      if (shouldRegister) firstRegistration = false;
      if (!shouldRegister && data?.mode === "lease" && data?.state === "expired") {
        // Another connection may have promoted while this tab was suspended.
        // An expired connection can never heartbeat back into the queue, so
        // register a fresh instance instead of leaving this tab stuck forever.
        publish(data);
        connectionId = makeConnectionId();
        registerNext = true;
        shouldRegister = true;
        data = await call("control_device_instance_register", params());
      }
      publish(data || {});
      registerNext = false;
      lastHeartbeatOkAt = Date.now();
      void log.flush();
      return data;
    } catch (error) {
      if (register || registerNext || mode !== "lease") registerNext = true;
      if (mode === "lease") {
        state = "unavailable";
        onState?.({ mode, state, epoch, queuePosition: null, waitingCount: 0, error });
      }
      return null;
    } finally {
      inFlight = false;
      settle();
      inFlightPromise = null;
      if (heartbeatAgain && !stopped) {
        heartbeatAgain = false;
        void heartbeat(false);
      }
    }
  }

  function onVisibility() {
    queuePageState("visibilitychange");
    void heartbeat();
  }
  function onResume() {
    void heartbeat();
  }
  function onPageShow() { void heartbeat(mode !== "lease"); }
  function onPageHide(event) {
    if (event?.persisted) return;
    stopped = true;
    stopTicker?.();
    if (mode === "lease") releaseOnExit();
  }
  // Zamykana karta: zwykłe żądanie przeglądarka zwykle ucina, a wtedy nowe
  // urządzenie czekało na wygaśnięcie lease (12-15 s). keepalive dowozi
  // zwolnienie po zamknięciu karty, więc slot jest wolny od razu.
  function releaseOnExit() {
    try {
      void fetch(`${SUPABASE_URL}/rest/v1/rpc/control_device_instance_release`, {
        method: "POST",
        keepalive: true,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_game_id: gameId, p_device_type: deviceType, p_key: key,
          p_connection_id: connectionId, p_epoch: epoch,
        }),
      }).catch(() => {});
    } catch { /* zostaje wygaśnięcie lease */ }
  }

  let stopLifecycle = null;
  let stopWakeLock = null;
  let stopRuntimeErrors = null;
  async function start() {
    stopLifecycle = watchPageLifecycle(logEvent, { onExit: () => log.flushOnExit() });
    stopRuntimeErrors = watchRuntimeErrors(logEvent, deviceType);
    stopWakeLock = onWakeLockChange(({ phase, error_name: errorName }) => logEvent({ event_type: "wake_lock", phase, error_name: errorName }));
    await heartbeat(true);
    stopTicker = startTicker(() => void heartbeat(false), HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("pagehide", onPageHide, { once: true });
    return { mode, state, epoch };
  }

  function stop() {
    stopped = true;
    stopTicker?.();
    stopLifecycle?.();
    stopWakeLock?.();
    stopRuntimeErrors?.();
    log.stop();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onResume);
    window.removeEventListener("online", onResume);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("pagehide", onPageHide);
    if (mode === "lease") void call("control_device_instance_release", {
      p_game_id: gameId, p_device_type: deviceType, p_key: key,
      p_connection_id: connectionId, p_epoch: epoch,
    }).catch(() => {});
  }

  // „Używaj tutaj”: nowa instancja jak przy otwarciu strony.
  function takeover() {
    if (stopped || state !== "replaced") return;
    connectionId = makeConnectionId();
    firstRegistration = true;
    registerNext = true;
    void heartbeat(true);
  }
  takeoverHandler = takeover;

  // Potwierdzenie roli po powrocie karty (game-state-subscribe.js's
  // beforeResync): telefon schowany na 10–25 s wraca z wygasłym lease,
  // a odczyt stanu i token kanału ze starą epoką dostawały odmowę
  // (eksport 25.10). Czeka na heartbeat w toku albo wysyła nowy.
  async function refresh() {
    if (stopped) return state;
    if (inFlight) await inFlightPromise;
    else await heartbeat(false);
    return state;
  }

  return {
    start, stop, takeover, refresh,
    /** Zdarzenie diagnostyki sesji (control2_device_log). */
    log: logEvent,
    get mode() { return mode; },
    get state() { return state; },
    get epoch() { return epoch; },
    get connectionId() { return connectionId; },
    setProgress({ receivedRev, renderedRev, startedSoundCueSeq } = {}) {
      if (Number.isSafeInteger(receivedRev) && receivedRev >= 0) progress.received_rev = Math.max(progress.received_rev, receivedRev);
      if (Number.isSafeInteger(renderedRev) && renderedRev >= 0) progress.rendered_rev = Math.max(progress.rendered_rev, renderedRev);
      if (Number.isSafeInteger(startedSoundCueSeq) && startedSoundCueSeq >= 0) progress.started_sound_cue_seq = Math.max(progress.started_sound_cue_seq, startedSoundCueSeq);
    },
    actionArgs() { return state === "primary" ? { p_connection_id: connectionId, p_epoch: epoch } : {}; },
    /** Zmienia metadane strony i od razu wysyła heartbeat z nimi. */
    setMeta(patch) {
      extraMeta = { ...extraMeta, ...patch };
      void heartbeat(false);
    },
    /** Czy baza ma odblokowanie dźwięku dla tej instancji (Wyświetlacz). */
    get audioUnlockedOnServer() { return state === "primary" && audioUnlockedOnServer; },
  };
}
