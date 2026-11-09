// js/core/session-log.js
// Wspólny zapis diagnostyki sesji Control 2 (migracje 468–469,
// familijna-server/docs/diagnostyka-sesji-plan.md). Urządzenia piszą przez control2_device_log,
// Control przez control2_control_log; paczki do 20 zdarzeń, ponowienia
// z rosnącą przerwą, deduplikacja w bazie po event_id. Zapis jest
// pomocniczy: nigdy nie blokuje gry i nie zgłasza błędów użytkownikowi.

import { sb, SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase.js?v=v2026-11-09T13091";
import { getDeviceProfile } from "./device-guard.js?v=v2026-11-09T13091";

const BATCH = 20;
const MAX_QUEUE = 200;
const RETRY_MS = [1_000, 3_000, 10_000, 30_000];

export const newEventId = () => globalThis.crypto?.randomUUID?.()
  || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * @param {object} o
 * @param {string} o.rpc            control2_device_log | control2_control_log
 * @param {() => object} o.params   parametry RPC bez p_events
 * @param {() => boolean} [o.canSend] np. tylko główna instancja urządzenia
 * @param {() => string|null} [o.accessToken] token użytkownika (Control) do wysyłki przy zamknięciu strony
 */
export function createSessionLog({ rpc, params, canSend = () => true, accessToken = () => null }) {
  const queue = [];
  let flushing = null;
  let retryTimer = null;
  let retryIndex = 0;
  let consecutiveFailures = 0;
  let droppedEvents = 0;
  let stopped = false;

  function push(event) {
    if (stopped || !event?.event_type && !event?.kind) return;
    queue.push({ ...event, event_id: event.event_id || newEventId() });
    if (queue.length > MAX_QUEUE) {
      const dropped = queue.length - MAX_QUEUE;
      queue.splice(0, dropped);
      droppedEvents += dropped;
    }
    void flush();
  }

  function scheduleRetry() {
    if (retryTimer || stopped || !queue.length) return;
    const delay = RETRY_MS[Math.min(retryIndex, RETRY_MS.length - 1)];
    retryIndex += 1;
    retryTimer = setTimeout(() => { retryTimer = null; void flush(); }, delay);
  }

  async function flush() {
    if (flushing || stopped || !queue.length) return flushing;
    if (!canSend()) { scheduleRetry(); return null; }
    flushing = (async () => {
      while (queue.length && !stopped && canSend()) {
        const batch = queue.slice(0, BATCH);
        try {
          const { error } = await sb().rpc(rpc, { ...params(), p_events: batch }).abortSignal(AbortSignal.timeout(6500));
          if (error) throw error;
          // Odrzucone przez bazę (np. poza sesją) i tak nie przejdą przy ponowieniu.
          queue.splice(0, batch.length);
          retryIndex = 0;
          if (consecutiveFailures || droppedEvents) {
            queue.push({
              event_type: "log_delivery",
              phase: "recovered",
              failed_attempts: consecutiveFailures,
              dropped_events: droppedEvents,
              event_id: newEventId(),
            });
            consecutiveFailures = 0;
            droppedEvents = 0;
          }
        } catch {
          consecutiveFailures += 1;
          scheduleRetry();
          break;
        }
      }
    })().finally(() => { flushing = null; });
    return flushing;
  }

  // Przy zamykaniu strony zwykłe żądanie bywa przerywane; keepalive je dowozi.
  function flushOnExit() {
    if (!queue.length || !canSend()) return;
    try {
      const token = accessToken() || SUPABASE_ANON_KEY;
      fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpc}`, {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...params(), p_events: queue.splice(0, BATCH) }),
      }).catch(() => {});
    } catch { /* Diagnostyka przy zamknięciu jest najlepszym wysiłkiem. */ }
  }

  return {
    push,
    flush,
    flushOnExit,
    stop() { stopped = true; clearTimeout(retryTimer); },
    get pending() { return queue.length; },
  };
}

function browserFamily(ua) {
  // Brave udaje Chrome/Safari w UA; na komputerze i Androidzie ma navigator.brave.
  if (typeof navigator !== "undefined" && navigator.brave) return "brave";
  if (/SamsungBrowser/i.test(ua)) return "samsung";
  if (/Edg(A|iOS)?\//.test(ua)) return "edge";
  if (/OPR\/|Opera/.test(ua)) return "opera";
  if (/Firefox|FxiOS/.test(ua)) return "firefox";
  if (/CriOS|Chrome|Chromium/.test(ua)) return "chrome";
  if (/Safari/.test(ua)) return "safari";
  return "other";
}

function osFamily(ua) {
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Tizen|Web0S|WebOS|webOS/.test(ua)) return "tv_os";
  if (/Android/.test(ua)) return "android";
  if (/Windows/.test(ua)) return "windows";
  if (/CrOS/.test(ua)) return "chromeos";
  if (/Macintosh|Mac OS X/.test(ua)) return "macos";
  if (/Linux/.test(ua)) return "linux";
  return "other";
}

/** Zgrubny opis urządzenia (decyzja 2026-10-22): bez wersji i identyfikatorów. */
export async function collectDeviceInfo() {
  const ua = navigator.userAgent || "";
  let formFactor = "unknown";
  try { formFactor = getDeviceProfile().formFactor; } catch {}
  const info = {
    event_type: "device_info",
    device_class: formFactor,
    browser: browserFamily(ua),
    os: osFamily(ua),
    standalone: !!(window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone),
    wake_lock_api: !!navigator.wakeLock,
  };
  // Skrypty wstrzykiwane przez przeglądarkę (bez treści, tylko obecność):
  // __firefox__ — Firefox na iOS i przeglądarki z jego kodu (np. Brave na iOS),
  // ethereum — portfel kryptowalut w przeglądarce. Tłumaczą obce błędy JS.
  const injected = [window.__firefox__ && "firefox_ns", window.ethereum && "ethereum", navigator.brave && "brave"].filter(Boolean);
  if (injected.length) info.injected_scripts = injected.join("+");
  const memory = Number(navigator.deviceMemory);
  if (Number.isFinite(memory)) info.memory_gb = memory;
  const connection = navigator.connection;
  if (connection) {
    if (typeof connection.saveData === "boolean") info.save_data = connection.saveData;
    if (typeof connection.type === "string") info.connection_type = connection.type;
  }
  try {
    const battery = await navigator.getBattery?.();
    if (battery) {
      info.battery_level = Math.round((Number(battery.level) || 0) * 10) * 10;
      info.charging = !!battery.charging;
    }
  } catch {}
  return info;
}

/**
 * Zdarzenia cyklu życia strony: zamrożenie i wznowienie (Chrome), zamknięcie
 * i powrót z pamięci przeglądarki, utrata i powrót sieci. Czasy trwania
 * liczone przy powrocie — zapis „przed” często nie zdąży wyjść.
 */
export function watchPageLifecycle(push, { onExit } = {}) {
  let frozenAt = null;
  let offlineAt = navigator.onLine === false ? Date.now() : null;
  const since = (at) => at == null ? undefined : Math.max(0, Date.now() - at);
  const onFreeze = () => { frozenAt = Date.now(); push({ event_type: "page_lifecycle", phase: "freeze" }); };
  const onResume = () => { push({ event_type: "page_lifecycle", phase: "resume", duration_ms: since(frozenAt) }); frozenAt = null; };
  const onPageHide = (event) => {
    push({ event_type: "page_lifecycle", phase: "pagehide", persisted: !!event?.persisted });
    onExit?.();
  };
  const onPageShow = (event) => { if (event?.persisted) push({ event_type: "page_lifecycle", phase: "pageshow", persisted: true }); };
  const onOffline = () => { offlineAt = Date.now(); push({ event_type: "page_lifecycle", phase: "offline" }); };
  const onOnline = () => { push({ event_type: "page_lifecycle", phase: "online", duration_ms: since(offlineAt) }); offlineAt = null; };
  document.addEventListener("freeze", onFreeze);
  document.addEventListener("resume", onResume);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  if (offlineAt != null) push({ event_type: "page_lifecycle", phase: "offline" });
  return () => {
    document.removeEventListener("freeze", onFreeze);
    document.removeEventListener("resume", onResume);
    window.removeEventListener("pagehide", onPageHide);
    window.removeEventListener("pageshow", onPageShow);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
  };
}

// Diagnostyka przyjmuje tylko krótkie teksty z [A-Za-z0-9_.:/+-] (serwer odrzuca
// resztę). Treść błędu: e-maile i liczby (np. kody, identyfikatory) zastąpione,
// pozostałe znaki -> "_".
const safeText = (value, max = 80) => String(value ?? "")
  .replace(/[^\s@]+@[^\s@]+/g, "e-mail")
  .replace(/\d{4,}/g, "N")
  .replace(/[^A-Za-z0-9_.:/+-]+/g, "_")
  .replace(/^_+|_+$/g, "")
  .slice(0, max);

// Skąd jest błąd: plik naszej strony (ścieżka bez parametrów), obcy skrypt
// (ext:host — rozszerzenie, wtyczka przeglądarki) albo brak pliku (none —
// zwykle zamaskowany błąd obcego skryptu, „Script error.”).
export function errorSource(filename, origin = globalThis.location?.origin) {
  if (!filename) return "none";
  try {
    const url = new URL(filename, origin);
    if (url.origin === origin) return safeText(url.pathname);
    return safeText(`ext:${url.protocol.replace(":", "")}:${url.host}`);
  } catch {
    return "invalid";
  }
}

// Plik pierwszej ramki stosu (bez treści stosu): wstrzyknięte skrypty Safari/WebKit
// mają adresy user-script:… albo webkit-masked-url:…, choć zdarzenie podaje adres strony.
export function errorFrame(stack, origin = globalThis.location?.origin) {
  const frame = /(?:@|\(|at\s+)([a-z][\w+.-]*:[^\s()]*?)(?::\d+){1,2}\)?\s*$/i;
  const url = String(stack || "").split("\n").map(l => l.match(frame)?.[1]).find(Boolean);
  return url ? errorSource(url, origin) : undefined;
}

// Nasz kod to wyłącznie pliki .js z tej domeny (strony nie mają skryptów w HTML).
// Wszystko inne — brak pliku („Script error.”), inna domena, skrypty doklejane
// przez przeglądarkę lub rozszerzenie (user-script:, adres samej strony) — to
// obcy skrypt. Rozstrzyga pierwsza ramka stosu, a bez niej plik ze zdarzenia.
const ownScript = (path) => typeof path === "string" && path.startsWith("/") && /\.m?js$/.test(path);
export function isForeignError({ source, frame } = {}) {
  if (frame) return !ownScript(frame);
  return !ownScript(source);
}

// Ten sam błąd na jednej stronie: obcy zapisujemy raz, nasz najwyżej 3 razy
// (pętla nie zalewa dziennika, a pierwsze wystąpienia zostają).
const MAX_SAME_OWN_ERROR = 3;

/** Capture uncaught script failures without storing user input or stack traces. */
export function watchRuntimeErrors(push, page) {
  const seen = new Map();
  const report = (event, { foreign }) => {
    const key = [event.phase, event.error_name, event.error_message, event.error_frame || event.error_source].join("|");
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    if (count > (foreign ? 1 : MAX_SAME_OWN_ERROR)) return;
    push(foreign ? { ...event, foreign: true } : event);
  };
  const onError = (event) => {
    const error = event?.error;
    const entry = {
      event_type: "runtime_error",
      phase: "uncaught_error",
      error_name: safeText(error?.name || "Error") || "Error",
      error_message: safeText(error?.message ?? event?.message) || undefined,
      error_source: errorSource(event?.filename),
      error_frame: errorFrame(error?.stack),
      page,
      line: Number.isFinite(event?.lineno) ? event.lineno : undefined,
      column: Number.isFinite(event?.colno) ? event.colno : undefined,
      visibility: document.visibilityState || "unknown",
      focused: !!document.hasFocus?.(),
    };
    report(entry, { foreign: isForeignError({ source: entry.error_source, frame: entry.error_frame }) });
  };
  const onRejection = (event) => {
    const reason = event?.reason;
    const frame = errorFrame(reason?.stack);
    report({
      event_type: "runtime_error",
      phase: "unhandled_rejection",
      error_name: safeText(reason?.name || "UnhandledRejection") || "UnhandledRejection",
      error_message: safeText(reason?.message ?? (typeof reason === "string" ? reason : "")) || undefined,
      error_frame: frame,
      page,
      visibility: document.visibilityState || "unknown",
      focused: !!document.hasFocus?.(),
    // Odrzucenie bez stosu (np. nieudane żądanie) traktujemy jak nasze.
    }, { foreign: !!frame && !ownScript(frame) });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
