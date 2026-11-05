// js/core/game-state-subscribe.js
// Stan gry na urządzeniu (Wyświetlacz, Prowadzący, Przycisk) — jeden
// mechanizm (decyzja właściciela 2026-10-29, migracje 508–510): baza po
// każdym zapisie sama wysyła cały wiersz na prywatny kanał tego połączenia
//   game-state:<game_id>:<connection_id>
// (zdarzenia "state" i "completion"). Dołączenie sprawdza polityka na
// realtime.messages: token urządzenia (device-realtime-token, z klucza
// i żywego lease — bez logowania) musi pasować do tematu.
// Pomiar e2e 40868645209: p50 141 ms, p90 158 ms, 0 zgubionych.
//
// Odczyt stanu RPC tylko przy starcie i po każdym (ponownym) dołączeniu
// do kanału — kanał nie przechowuje wiadomości wysłanych, gdy urządzenie
// było odłączone (telefon w tle, zerwane łącze). Nie ma dzwonków ani
// odpytywania.

import { sb, REALTIME_OPTIONS, SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase.js?v=v2026-11-05T23260";
import { createNetworkMonitor, measureNetwork } from "./network-probe.js?v=v2026-11-05T23260";
import { createRowSync } from "./game-state-sync.js?v=v2026-11-05T23260";
import { realtimeSocketCloseDetails, observeRealtimeSocketClose } from "./realtime-socket-close.js?v=v2026-11-05T23260";
import { createDirectRetryScheduler } from "./direct-retry-backoff.js?v=v2026-11-05T23260";

const TRANSPORT = "broadcast";
const NOT_RESYNC_SOURCES = new Set([TRANSPORT, "rpc_bootstrap", "press"]);

export function createSubscription({ gameId, deviceType, key, onRow, onError, onCompletion = null, signal = false, sameRevChanged = null, getLeaseArgs = () => ({}), beforeResync = null, log = () => {} }) {
  let active = false;
  let channel = null;
  let signalChannel = null;
  let connected = false;
  let tokenTimer = null;
  const retry = createDirectRetryScheduler({
    run: () => { void startChannel(); },
    isActive: () => active,
    isConnected: () => connected,
  });
  // Po wybudzeniu telefonu sieć wraca po chwili: pierwsze pobranie tokenu
  // zwykle się nie udaje — krótkie, rosnące odstępy (1–15 s).
  let tokenRetryMs = 1_000;
  let status = "IDLE";
  let outage = null;
  let tokenAuthIncidentOpen = false;
  let transportSnapshotLogged = false;
  let sessionStarted = false;
  let readIncidentOpen = false;
  let renderIncidentOpen = false;
  let hiddenAt = document.visibilityState === "hidden" ? performance.now() : null;
  let lastRenderedRev = -1;
  let sync;
  // Pomiar łącza w trakcie gry (migracja 466): tylko start, spowolnienie
  // i powrót do normy; zapis jak diagnostyka — nigdy nie blokuje gry.
  const network = createNetworkMonitor({
    probe: () => measureNetwork({
      pingUrl: `${SUPABASE_URL}/_ping`,
      rpc: (abort) => sb().rpc("control2_net_ping").abortSignal(abort),
    }),
    send: (phase, data) => {
      if (!active || !sessionStarted) return;
      log({ event_type: "network_state", source: "probe", phase, visibility: document.visibilityState === "hidden" ? "hidden" : "visible", ...data });
    },
  });

  function transportContext() {
    return {
      visibility: document.visibilityState === "hidden" ? "hidden" : "visible",
      focused: !!document.hasFocus?.(),
      online: navigator.onLine !== false,
      was_discarded: !!document.wasDiscarded,
      revision: sync?.lastRev >= 0 ? sync.lastRev : null,
      rendered_revision: lastRenderedRev >= 0 ? lastRenderedRev : null,
    };
  }
  // Zapis przez dziennik sesji urządzenia (session-log.js, control2_device_log).
  function sendDiagnostic(eventType, phase, transport, metrics = {}) {
    if (!active || !sessionStarted) return;
    log({ event_type: eventType, phase, transport, client_time_ms: Date.now(), ...transportContext(), ...metrics });
  }
  function noteReadStatus(result) {
    if (!sessionStarted) return;
    if (!result.ok) {
      network.probeNow();
      if (readIncidentOpen) return;
      readIncidentOpen = true;
      sendDiagnostic("state_sync", "read_error", "rpc", {
        status: "FETCH_ERROR", error_class: String(result.error?.name || "Error").slice(0, 80),
        fetch_ms: result.fetchMs,
      });
    } else if (readIncidentOpen) {
      readIncidentOpen = false;
      renderIncidentOpen = false;
      sendDiagnostic("state_sync", "read_recovered", "rpc", {
        revision: Number.isSafeInteger(result.revision) ? result.revision : sync.lastRev,
        fetch_ms: result.fetchMs,
      });
    }
  }
  function newOutage(firstStatus, error = null) {
    return {
      startedAt: performance.now(), firstStatus, transitionCount: firstStatus ? 1 : 0,
      catchupCount: 0, missedRevisions: 0, maxFetchMs: 0, maxRenderMs: 0,
      startVisibility: document.visibilityState === "hidden" ? "hidden" : "visible",
      startOnline: navigator.onLine !== false, hiddenDurationMs: 0,
      wasDiscarded: !!document.wasDiscarded,
      errorClass: error ? String(error.name || "Error").slice(0, 80) : null,
      socketClose: recentSocketClose(),
    };
  }
  function noteRowProgress({ row, source, previousRev, fetchMs, receivedMs, renderMs, renderError }) {
    const started = row?.detail?.locks?.gameStarted === true && row?.detail?.locks?.gameEnded !== true;
    if (started && !sessionStarted) {
      sessionStarted = true;
      network.start();
      transportSnapshotLogged = connected;
      if (connected) sendDiagnostic("transport_state", "connected", TRANSPORT, { status: "SUBSCRIBED" });
      else if (!outage) outage = newOutage(status === "IDLE" ? null : status);
    } else if (!started && sessionStarted) {
      sessionStarted = false;
      network.stop();
      transportSnapshotLogged = false;
      outage = null;
      readIncidentOpen = false;
      renderIncidentOpen = false;
    }
    if (!sessionStarted) return;

    if (renderError) {
      if (!renderIncidentOpen) {
        renderIncidentOpen = true;
        sendDiagnostic("state_sync", "render_error", source === TRANSPORT ? TRANSPORT : "rpc", {
          revision: Number(row.rev) || null, previous_revision: previousRev >= 0 ? previousRev : null,
          fetch_ms: fetchMs, render_ms: renderMs,
          error_class: String(renderError?.name || "Error").slice(0, 80),
        });
      }
      return;
    }
    if (renderIncidentOpen) {
      renderIncidentOpen = false;
      sendDiagnostic("state_sync", "render_recovered", source === TRANSPORT ? TRANSPORT : "rpc", {
        revision: Number(row.rev) || null, render_ms: renderMs,
      });
    }
    lastRenderedRev = Math.max(lastRenderedRev, Number(row.rev) || 0);
    // Odczyt po (ponownym) dołączeniu przyniósł nowszy stan: urządzenie
    // przegapiło zmiany, gdy było odłączone. Wynik własnego zapisu urządzenia
    // (naciśnięcie Przycisku) bywa szybszy niż ta sama zmiana z kanału —
    // to nie nadrobienie (e2e 40884933127).
    if (!NOT_RESYNC_SOURCES.has(source) && previousRev >= 0 && Number(row.rev) > previousRev) {
      if (outage) {
        outage.catchupCount += 1;
        outage.missedRevisions += Math.max(1, Number(row.rev) - previousRev);
        outage.maxFetchMs = Math.max(outage.maxFetchMs, fetchMs || 0);
        outage.maxRenderMs = Math.max(outage.maxRenderMs, renderMs || 0);
      }
      sendDiagnostic("state_sync", "resync_applied", "rpc", {
        trigger: source, revision: Number(row.rev), previous_revision: previousRev,
        fetch_ms: fetchMs, render_ms: renderMs,
      });
    }
    if (source === TRANSPORT && renderMs >= 500) {
      sendDiagnostic("state_sync", "render_slow", TRANSPORT, {
        revision: Number(row.rev), previous_revision: previousRev >= 0 ? previousRev : null,
        received_ms: receivedMs, render_ms: renderMs,
      });
    }
  }
  function noteFailure(nextStatus, error = null) {
    status = nextStatus;
    connected = false;
    transportSnapshotLogged = false;
    if (!outage) outage = newOutage(nextStatus, error);
    else {
      outage.transitionCount += 1;
      if (!outage.errorClass && error) outage.errorClass = String(error.name || "Error").slice(0, 80);
    }
  }
  // Limit czasu: zawieszone żądanie trzymało `fetching` na zawsze. Szczegóły:
  // game-state-sync.js.
  sync = createRowSync({
    fetchRow: () => sb().rpc("game_state_get", {
      p_game_id: gameId,
      p_device_type: deviceType,
      p_key: key,
      ...getLeaseArgs(),
    }).abortSignal(AbortSignal.timeout(8000)),
    // await onRow: control/display/js/render.js's renderSnapshot()/renderDiff()
    // mają animacje trwające setki ms–kilka s — kolejny wiersz nie może się
    // z nimi nakładać. Dla urządzeń bez animacji onRow zwraca od razu.
    onRow: (...args) => { if (active) return onRow?.(...args); },
    onError: (...args) => { if (active) return onError?.(...args); },
    onReadStatus: noteReadStatus,
    onProgress: noteRowProgress,
    sameRevChanged,
  });
  const fetchGuarded = sync.fetchGuarded;

  // Osobny klient tylko dla kanałów urządzenia: accessToken zawsze zwraca
  // token urządzenia (na wspólnym kliencie realtime-js po dołączeniu
  // podmieniał go na anon i ponowne dołączenie szło bez claims urządzenia).
  let deviceToken = null;
  let realtime = null;
  let lastSocketClose = null;
  let ignoreCleanSocketCloseUntil = 0;
  // Planowa wymiana tokenu przed wygaśnięciem — diagnostyka token_refresh,
  // nie zerwanie.
  let plannedRefreshAt = null;
  const recentSocketClose = () => lastSocketClose && performance.now() - lastSocketClose.at <= 5_000
    ? { ...lastSocketClose.details } : {};
  // Lease, dla którego wystawiono token (claims: połączenie + epoka).
  let channelLeaseKey = null;
  const leaseKey = (lease) => `${lease?.p_connection_id || ""}:${lease?.p_epoch || ""}`;
  function realtimeClient() {
    if (!realtime) {
      realtime = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        accessToken: async () => deviceToken || SUPABASE_ANON_KEY,
        realtime: REALTIME_OPTIONS,
      });
      const closeObserverAttached = observeRealtimeSocketClose(realtime.realtime, (event) => {
        // Zamknięcia wywołane przez klienta też trafiają do diagnostyki —
        // flaga odróżnia je od serwerowych.
        const expected = event?.code === 1000 && event?.wasClean
          && performance.now() <= ignoreCleanSocketCloseUntil;
        const details = { ...realtimeSocketCloseDetails(event), socket_close_expected: expected };
        lastSocketClose = { at: performance.now(), details };
        globalThis.__sbDeviceRealtimeLastClose = details;
        if (outage) Object.assign(outage.socketClose, details);
        sendDiagnostic("transport_state", "socket_closed", TRANSPORT, { status, ...details });
      });
      globalThis.__sbDeviceRealtimeCloseObserverAttached = closeObserverAttached;
      // debug helper (jak globalThis.__sbClient w supabase.js)
      globalThis.__sbDeviceRealtime = realtime;
    }
    return realtime;
  }

  function onChannelReady() {
    if (!active) return;
    retry.reset();
    if (plannedRefreshAt != null) {
      sendDiagnostic("transport_state", "token_refresh", TRANSPORT, {
        status: "SUBSCRIBED", duration_ms: Math.max(0, Math.round(performance.now() - plannedRefreshAt)),
      });
      plannedRefreshAt = null;
    }
    const incident = outage;
    connected = true;
    status = "SUBSCRIBED";
    outage = null;
    if (sessionStarted) {
      if (incident) {
        sendDiagnostic("transport_state", "recovered", TRANSPORT, {
          status: "SUBSCRIBED", duration_ms: Math.max(0, Math.round(performance.now() - incident.startedAt)),
          first_status: incident.firstStatus, transition_count: incident.transitionCount,
          start_visibility: incident.startVisibility, start_online: incident.startOnline,
          hidden_duration_ms: incident.hiddenDurationMs + (hiddenAt == null ? 0 : Math.max(0, Math.round(performance.now() - Math.max(hiddenAt, incident.startedAt)))),
          was_discarded: incident.wasDiscarded, error_class: incident.errorClass,
          ...incident.socketClose,
        });
        transportSnapshotLogged = true;
      }
      if (!transportSnapshotLogged) {
        transportSnapshotLogged = true;
        sendDiagnostic("transport_state", "connected", TRANSPORT, { status: "SUBSCRIBED" });
      }
    }
    // Wiadomości wysłane przed dołączeniem przepadły — jeden odczyt stanu.
    fetchGuarded("rpc_channel_ready");
  }

  function onChannelFailure(nextStatus, error = null) {
    noteFailure(nextStatus, error);
    const retryMs = retry.schedule();
    if (retryMs !== null) sendDiagnostic("transport_state", "reconnect_scheduled", TRANSPORT, { status: nextStatus, retry_ms: retryMs });
    console.warn(`[device-realtime] ${nextStatus}; ponowne dołączenie`);
  }

  async function removeChannels(client) {
    const old = [channel, signalChannel].filter(Boolean);
    channel = null;
    signalChannel = null;
    if (old.length) ignoreCleanSocketCloseUntil = performance.now() + 5_000;
    for (const item of old) await client?.removeChannel(item).catch(() => {});
  }

  async function startChannel({ planned = false } = {}) {
    if (!active) return;
    retry.cancel();
    const lease = getLeaseArgs();
    if (!lease?.p_connection_id || !lease?.p_epoch) return;
    channelLeaseKey = leaseKey(lease);
    try {
      const { data, error } = await sb().functions.invoke("device-realtime-token", {
        body: { game_id: gameId, device_type: deviceType, key,
          connection_id: lease.p_connection_id, epoch: lease.p_epoch },
      });
      if (error || !data?.token || !active) throw error || new Error("Brak tokenu Realtime");
      tokenAuthIncidentOpen = false;
      deviceToken = data.token;
      const client = realtimeClient();
      // Token przed subscribe(): dołączenie do prywatnego kanału sprawdza go.
      await client.realtime.setAuth();
      if (!active) { deviceToken = null; return; }
      const hadChannel = !!channel;
      plannedRefreshAt = planned && hadChannel ? performance.now() : null;
      // Stary kanał jest już nieaktualny — jego CLOSED nie jest awarią.
      await removeChannels(client);
      const next = client.channel(`game-state:${gameId}:${lease.p_connection_id}`, { config: { private: true } });
      channel = next;
      next.on("broadcast", { event: "state" }, ({ payload }) => {
        const row = payload?.row;
        const rev = Number(row?.rev);
        if (row && Number.isFinite(rev)) sync.applyRow({ ...row, rev }, TRANSPORT);
      }).on("broadcast", { event: "completion" }, ({ payload }) => {
        if (payload?.row) onCompletion?.(payload.row);
      }).subscribe((nextStatus, subscribeError) => {
        if (next !== channel) return;
        status = nextStatus;
        if (nextStatus === "SUBSCRIBED" && active) {
          console.info("[device-realtime] SUBSCRIBED");
          onChannelReady();
        }
        if (nextStatus === "CHANNEL_ERROR" || nextStatus === "TIMED_OUT" || nextStatus === "CLOSED") {
          onChannelFailure(nextStatus, subscribeError);
        }
      });
      // Wyświetlacz wysyła Control sygnał „animacja rusza” (dźwięk z Control).
      if (signal) {
        signalChannel = client.channel(`game-signal:${gameId}`, { config: { private: true } });
        signalChannel.subscribe();
      }
      clearTimeout(tokenTimer);
      tokenRetryMs = 1_000;
      // Wymiana 5 min przed wygaśnięciem (serwer podaje expires_in).
      const expiresInS = Number(data.expires_in);
      const refreshMs = Number.isFinite(expiresInS) ? Math.max(60, expiresInS - 300) * 1000 : 240_000;
      tokenTimer = setTimeout(() => { if (active) void startChannel({ planned: true }); }, refreshMs);
    } catch (error) {
      if (!active) return;
      status = "TOKEN_ERROR";
      if (connected) {
        if (!tokenAuthIncidentOpen) {
          tokenAuthIncidentOpen = true;
          sendDiagnostic("transport_state", "auth_error", TRANSPORT, {
            status: "TOKEN_ERROR", error_class: String(error?.name || "Error").slice(0, 80),
          });
        }
      } else noteFailure("TOKEN_ERROR", error);
      console.info("[device-realtime] token kanału niedostępny; ponawiam", error);
      clearTimeout(tokenTimer);
      tokenTimer = setTimeout(() => { if (active) void startChannel(); }, tokenRetryMs);
      tokenRetryMs = Math.min(15_000, tokenRetryMs * 2);
    }
  }

  async function stopChannel() {
    connected = false;
    retry.cancel();
    clearTimeout(tokenTimer);
    tokenTimer = null;
    plannedRefreshAt = null;
    await removeChannels(realtime);
    deviceToken = null;
  }

  // Powrót z tła, zerwane łącze, nowa epoka lease: odczyt i nowe dołączenie.
  function resync() {
    if (!active) return;
    fetchGuarded("rpc_resume");
    void stopChannel().finally(() => { if (active) void startChannel(); });
  }

  async function start() {
    // Ta sama karta wróciła jako główna z nową epoką: token ma starą epokę,
    // więc kanał trzeba zbudować od nowa.
    if (active) {
      if (channelLeaseKey && leaseKey(getLeaseArgs()) !== channelLeaseKey) resync();
      return;
    }
    active = true;
    sync.reset();
    await fetchGuarded("rpc_bootstrap");
    if (!active) return;
    void startChannel();
    // Karta mogła zostać zamrożona przez przeglądarkę — po powrocie nowe
    // dołączenie i odczyt (status WebSocketu bywa nieaktualny).
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", resyncAfterLease);
    window.addEventListener("online", resyncAfterLease);
  }

  function onVisibility() {
    if (document.visibilityState === "hidden") {
      hiddenAt = performance.now();
      return;
    }
    if (document.visibilityState !== "visible") return;
    if (hiddenAt != null && outage) {
      outage.hiddenDurationMs += Math.max(0, Math.round(performance.now() - Math.max(hiddenAt, outage.startedAt)));
    }
    hiddenAt = null;
    resyncAfterLease();
  }
  // Po powrocie karty najpierw potwierdzenie roli (lease może mieć nową
  // epokę albo przejść w oczekiwanie), dopiero potem odczyt i kanał.
  function resyncAfterLease() {
    if (!active) return;
    if (!beforeResync) { resync(); return; }
    void Promise.resolve().then(beforeResync).catch(() => {}).then(() => { if (active) resync(); });
  }

  function stop() {
    if (!active) return;
    active = false;
    sessionStarted = false;
    network.stop();
    outage = null;
    readIncidentOpen = false;
    renderIncidentOpen = false;
    tokenAuthIncidentOpen = false;
    retry.cancel();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", resyncAfterLease);
    window.removeEventListener("online", resyncAfterLease);
    void stopChannel();
  }

  // Przycisk: game_state_buzzer_press zwraca świeży wiersz — trafia do tego
  // samego licznika rewizji, żeby starsza wiadomość go nie nadpisała.
  const applyRow = sync.applyRow;

  // Po already_pressed z game_state_buzzer_press: autorytatywny wiersz już
  // pokazuje zwycięzcę — dociągamy go od razu.
  function refetchNow() { return fetchGuarded("rpc_press_conflict"); }

  // Wyświetlacz → Control (game-signal:<gra>): sygnał chwilowy, nie stan.
  function sendSignal(event, payload) {
    if (!signalChannel) return Promise.resolve(false);
    return signalChannel.send({ type: "broadcast", event, payload }).then((result) => result === "ok").catch(() => false);
  }

  return { start, stop, applyRow, refetchNow, sendSignal, isConnected() { return connected; } };
}
