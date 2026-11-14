/**
 * keep-alive.js
 * Prevents browser from throttling background tabs.
 * - Flickers document title to keep JS timers alive
 * - Acquires a Web Lock to prevent CPU throttling (Chrome/Edge)
 * - Acquires Screen Wake Lock to prevent screen sleep (display/fullscreen)
 * - Plays silent audio to keep AudioContext alive in background
 */

let _titleInterval = null;
let _originalTitle = document.title;
let _dot = true;
let _wakeLock = null;

function startTitleFlicker() {
  if (_titleInterval) return;
  _titleInterval = setInterval(() => {
    document.title = (_dot ? "● " : "○ ") + _originalTitle;
    _dot = !_dot;
  }, 1000);
}

function stopTitleFlicker() {
  clearInterval(_titleInterval);
  _titleInterval = null;
  document.title = _originalTitle;
}

function acquireWebLock() {
  if (!navigator.locks) return;
  navigator.locks.request("familijna-keep-alive", { mode: "shared" }, () => new Promise(() => {}));
}

// Stan blokady wygaszania ekranu dla diagnostyki sesji (session-log.js):
// zapisujemy tylko zmiany (włączona, odmowa, brak obsługi, zwolnienie przez
// system przy widocznej karcie — np. tryb oszczędzania baterii).
const _wakeListeners = new Set();
let _wakeState = null;
function setWakeState(phase, extra = {}) {
  if (_wakeState?.phase === phase) return;
  _wakeState = { phase, ...extra };
  for (const listener of _wakeListeners) { try { listener(_wakeState); } catch {} }
}
export function onWakeLockChange(listener) {
  _wakeListeners.add(listener);
  if (_wakeState) listener(_wakeState);
  return () => _wakeListeners.delete(listener);
}

// Safari na iOS/iPadOS odmawia blokady bez gestu użytkownika
// (NotAllowedError zaraz po otwarciu strony — eksport 24.10, Prowadzący na
// iPadzie). Odmowę i zwolnienie przez system ponawiamy przy najbliższym
// dotknięciu, kliknięciu lub klawiszu; to te zdarzenia dają aktywację.
const GESTURE_EVENTS = ["pointerup", "touchend", "click", "keydown"];
const _gestureRetries = new Set();
let _gestureArmed = false;
function onUserGesture() {
  for (const retry of [..._gestureRetries]) {
    _gestureRetries.delete(retry);
    try { retry(); } catch {}
  }
  if (!_gestureRetries.size) disarmGestureRetry();
}
function disarmGestureRetry() {
  if (!_gestureArmed) return;
  _gestureArmed = false;
  for (const type of GESTURE_EVENTS) document.removeEventListener(type, onUserGesture, true);
}
function retryOnGesture(retry) {
  _gestureRetries.add(retry);
  if (_gestureArmed) return;
  _gestureArmed = true;
  for (const type of GESTURE_EVENTS) document.addEventListener(type, onUserGesture, { capture: true, passive: true });
}

let _wakeRequest = null;
function wakeLockHeld() {
  return !!_wakeLock && !_wakeLock.released;
}
function requestWakeLock() {
  if (wakeLockHeld() || document.hidden) return Promise.resolve();
  if (_wakeRequest) return _wakeRequest;
  _wakeRequest = (async () => {
    try {
      const lock = await navigator.wakeLock.request("screen");
      _wakeLock = lock;
      setWakeState("granted");
      lock.addEventListener?.("release", () => {
        // Ukrycie karty zwalnia blokadę zawsze (wraca przy widoczności);
        // zwolnienie przy widocznej karcie odnotowujemy i ponawiamy gestem.
        if (document.hidden) return;
        setWakeState("released");
        retryOnGesture(requestWakeLock);
      });
    } catch (error) {
      setWakeState("denied", { error_name: String(error?.name || "Error").slice(0, 40) });
      retryOnGesture(requestWakeLock);
    } finally {
      _wakeRequest = null;
    }
  })();
  return _wakeRequest;
}

async function acquireScreenWakeLock() {
  if (!navigator.wakeLock) { setWakeState("unsupported"); return; }
  // Re-acquire after tab becomes visible again (browser releases it automatically)
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void requestWakeLock();
  });
  await requestWakeLock();
}

// Odpowiednik triku z bibliotek typu NoSleep.js: wyciszony, zapętlony,
// prawdziwy plik wideo (3 KB: czarny obraz i cicha ścieżka dźwięku) w
// <video muted playsinline loop>. Odtwarzane wideo wstrzymuje automatyczne
// wygaszanie ekranu na iOS i Androidzie niezależnie od Screen Wake Lock API.
// Działa OBOK acquireScreenWakeLock() (nie zamiast): na iPhonie blokada
// bywa odrzucana do pierwszego dotknięcia (eksporty 23–29.10), a wyciszone
// wideo inline Safari zwykle odtwarza bez gestu. Wcześniej źródłem był
// strumień z <canvas> (captureStream), którego iOS nie traktuje jak
// odtwarzanego wideo.
// MP4 (H.264) dla Safari; WebM dla Chromium bez H.264 (np. Linux).
const KEEP_AWAKE_SOURCES = [
  ["/assets/video/keep-awake.mp4?v=v2026-11-14T11110", "video/mp4"],
  ["/assets/video/keep-awake.webm?v=v2026-11-14T11110", "video/webm"],
];
function startVideoWakeLockFallback() {
  try {
    const video = document.createElement("video");
    for (const [src, type] of KEEP_AWAKE_SOURCES) {
      const source = document.createElement("source");
      source.src = src;
      source.type = type;
      video.appendChild(source);
    }
    video.muted = true;
    video.loop = true;
    video.preload = "auto";
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.className = "keep-alive-video"; // niewidoczny 1×1 px (components.css)
    document.body.appendChild(video);

    // Bez gestu przeglądarka potrafi odrzucić odtwarzanie — wtedy ponawiamy gestem.
    const play = () => video.play()?.catch?.(() => retryOnGesture(play));
    play();
    // Przeglądarki wstrzymują odtwarzanie ukrytej karty — tak samo jak
    // acquireScreenWakeLock() wyżej, wznawiamy po powrocie na widoczność.
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) play();
    });
  } catch {}
}

function startSilentAudio() {
  try {
    const ctx = new AudioContext();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(ctx.destination);
    src.start();
    // Resume after user gesture unlocks AudioContext
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && ctx.state === "suspended") ctx.resume();
    });
  } catch {}
}

export function startKeepAlive({ silentAudio = false, videoWakeLockFallback = true } = {}) {
  acquireWebLock();
  acquireScreenWakeLock();
  if (silentAudio) startSilentAudio();
  if (videoWakeLockFallback) startVideoWakeLockFallback();

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) startTitleFlicker();
    else stopTitleFlicker();
  });

  if (document.hidden) startTitleFlicker();
}
