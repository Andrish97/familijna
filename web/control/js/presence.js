// control/js/presence.js
// Stan urządzeń dla Control: jeden odczyt `control_devices_snapshot`
// (migracja 397) w jednej migawce bazy — lease głównej instancji, kolejka,
// widoczność karty, diagnostyka i odblokowanie dźwięku Wyświetlacza. Dzięki
// temu Control nie skleja kilku odczytów z różnych chwil.
//
// W odróżnieniu od dawnego Control: żadnych komend przy przejściu
// offline->online — urządzenie samo wie, co pokazać, bo czyta game_state przy
// każdym (re)connect. Ten moduł opisuje wyłącznie fakt obecności.

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-05T10361";


const STATUS_READ_TIMEOUT_MS = 6_500;
const POLL_MS = 750;
// Jeden nieudany odczyt (zwykle pojedyncze żądanie zawieszone do limitu, gdy
// następne odpowiada w 0,3 s — eksport 2.11) nie blokuje gry, jeśli poprzedni
// udany odczyt jest świeży; drugi z rzędu już tak (decyzja właściciela 2.11).
const FRESH_SNAPSHOT_MS = 10_000;
const KINDS = ["display", "host", "buzzer"];

export function createPresence({ gameId, onChange, onTransientError }) {
  let timer = null;
  let inFlight = false;
  let flags = { display: false, host: false, buzzer: false };
  let displayAudioUnlocked = false;
  let devices = {};
  let lastPageVisibility = { display: null, host: null, buzzer: null };
  let pageVisibilityChangedAt = { display: null, host: null, buzzer: null };
  let readUnavailable = false;
  let failedReads = 0;
  let lastSnapshotAt = null;
  // onChange() przerysowuje panel, więc zawiadamiamy tylko o realnej zmianie.
  let lastReported = null;

  async function tick() {
    if (inFlight) return;
    inFlight = true;
    try {
      const { data, error, status } = await sb().rpc("control_devices_snapshot", { p_game_id: gameId })
        .abortSignal(AbortSignal.timeout(STATUS_READ_TIMEOUT_MS));
      if (error || !data?.ok) {
        // Migawka jest źródłem prawdy dla akcji gry: bez niej zostają ostatnie
        // flagi, a Control blokuje akcje do czasu poprawnego odczytu.
        // lease_status: baza odpowiedziała błędem; status_read: brak
        // odpowiedzi (sieć, limit czasu) — supabase-js zwraca wtedy status 0.
        const failure = error || new Error("snapshot_unavailable");
        if (failure && typeof failure === "object" && failure.status == null) failure.status = status;
        fail(failure, Number(status) >= 400 || error?.code ? "lease_status" : "status_read");
        return;
      }
      readUnavailable = false;
      failedReads = 0;
      lastSnapshotAt = Date.now();
      devices = data.devices || {};
      flags = Object.fromEntries(KINDS.map(kind => [kind, devices[kind]?.primary_online === true]));
      displayAudioUnlocked = flags.display && devices.display?.audio_unlocked === true;
      for (const kind of KINDS) {
        const visibility = devices[kind]?.visibility || null;
        if (lastPageVisibility[kind] != null && visibility != null && visibility !== lastPageVisibility[kind]) {
          pageVisibilityChangedAt[kind] = Date.now();
        }
        if (visibility != null) lastPageVisibility[kind] = visibility;
      }
      report({ error: null, errorSource: null });
    } catch (error) {
      fail(error, "status_read");
    } finally {
      inFlight = false;
    }
  }

  function fail(error, errorSource) {
    failedReads++;
    if (!readUnavailable && failedReads === 1 && lastSnapshotAt != null && Date.now() - lastSnapshotAt < FRESH_SNAPSHOT_MS) {
      onTransientError?.({ error, errorSource });
      return;
    }
    readUnavailable = true;
    report({ error, errorSource });
  }

  function report({ error, errorSource }) {
    const deviceDiagnostics = Object.fromEntries(KINDS.map(kind => {
      const device = devices[kind] || {};
      const meta = device.meta || {};
      const lastSeenAt = device.last_seen_at || null;
      const lastSeen = lastSeenAt ? new Date(lastSeenAt).getTime() : null;
      return [kind, {
        lastSeenAt,
        ageMs: lastSeen == null ? null : Math.max(0, Date.now() - lastSeen),
        browserContextId: meta.browser_context_id || null,
        visibility: device.visibility || meta.page_visibility || null,
        visibilityChangedAt: pageVisibilityChangedAt[kind],
        focused: typeof device.focused === "boolean" ? device.focused : null,
        waitingCount: Number(device.waiting_count) || 0,
        audioDiagnostic: meta.audio_diagnostic || null,
        audioLockReason: typeof meta.audio_lock_reason === "string" ? meta.audio_lock_reason : null,
        audioLockDetail: typeof meta.audio_lock_detail === "string" ? meta.audio_lock_detail : null,
      }];
    }));
    const fp = JSON.stringify({
      flags, readUnavailable, errorSource: errorSource || null, displayAudioUnlocked,
      deviceVisibility: Object.fromEntries(Object.entries(deviceDiagnostics).map(([kind, item]) => [kind, [item.visibility, item.focused, item.browserContextId, item.waitingCount]])),
      displayAudioDiagnosticId: deviceDiagnostics.display.audioDiagnostic?.id || null,
      displayAudioLock: [deviceDiagnostics.display.audioLockReason, deviceDiagnostics.display.audioLockDetail],
    });
    if (fp === lastReported) return;
    lastReported = fp;
    onChange?.({ flags: { ...flags }, displayAudioUnlocked, deviceDiagnostics, error, errorSource });
  }

  function onVisible() {
    if (document.visibilityState === "visible") void tick();
  }

  function start() {
    void tick();
    timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", tick);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", tick);
  }

  function getFlags() { return { ...flags }; }

  return { start, stop, getFlags, refresh: tick };
}
