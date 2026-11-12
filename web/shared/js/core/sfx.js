// js/core/sfx.js
// Rozszerzony moduł dźwięku: manifest, warianty, głośności, własne pliki (IndexedDB).

const MANIFEST_PATH = "/shared/data/sounds.json?v=v2026-11-12T13423";

const AUDIO_BASE    = "/assets/audio/";
const IDB_NAME      = "familijna-sfx";
const IDB_STORE     = "custom-files";

/* ========= KONTEKST GRY ========= */

let _currentGameId = null;

export function setCurrentGameId(gameId) {
  _currentGameId = gameId ?? null;
}

/* ========= MANIFEST ========= */

let manifest = null;

export async function loadSfxManifest() {
  if (manifest) return manifest;
  const res = await fetch(MANIFEST_PATH);
  const json = await res.json();
  manifest = json.categories || [];
  return manifest;
}

export function getSfxCategories() {
  return manifest || [];
}

export function listSfx() {
  return getSfxCategories().map(c => c.key);
}

function getCategoryMeta(key) {
  return (manifest || []).find(c => c.key === key) || null;
}

/* ========= CACHE AUDIO ========= */

// Dźwięki gry: zdekodowane z góry bufory odtwarzane przez Web Audio.
// Element <audio> na telewizorze (Samsung) startował drugi dźwięk w trakcie
// pierwszego z opóźnieniem 1,4–2 s (eksport 7.11, reveal przy muzyce przejścia);
// bufor startuje w milisekundach i miesza się z innymi bez opóźnień.
// Odtwarzacze <audio> zostają tylko dla podglądu plików w ustawieniach gry
// (createSfxAudio / playSfxAudio).
const cache = new Map();     // key → dźwięk (bufor, wzmocnienie, bieżące odtworzenie)
let globalMuted = false;
let previewSfxKey = null;

// Wyciszenie nie zmienia zegara audio, głośności ani zaplanowanych dźwięków.
export function setSfxMuted(muted) {
  globalMuted = !!muted;
  if (typeof window !== "undefined") window.__sfxMuted = globalMuted;
  if (masterGain) masterGain.gain.setValueAtTime(globalMuted ? 0 : 1, audioContext.currentTime);
}
const playbackObservers = new Set();

export function onSfxPlayback(observer) {
  if (typeof observer !== "function") return () => {};
  playbackObservers.add(observer);
  return () => playbackObservers.delete(observer);
}

function reportPlayback(event) {
  for (const observer of playbackObservers) {
    try { observer(event); } catch {}
  }
}

let audioContext = null;
let masterGain = null;
const audioNodes = new WeakMap();

function getAudioContext() {
  if (!audioContext) {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    audioContext = new Context();
    masterGain = audioContext.createGain();
    masterGain.gain.value = globalMuted ? 0 : 1;
    masterGain.connect(audioContext.destination);
    // Przeglądarka może wstrzymać dźwięk bez przeładowania strony (uśpienie
    // telewizora, przejęcie audio przez system). Spróbuj wznowić; jeśli bez
    // gestu się nie da, odblokowanie przestaje obowiązywać.
    const context = audioContext;
    // Dostęp dla testów e2e (jak window.__sfxLog): pozwala zasymulować
    // wstrzymanie dźwięku przez przeglądarkę.
    if (typeof window !== "undefined") window.__sfxAudioContext = context;
    context.addEventListener?.("statechange", () => {
      if (!unlocked || context.state === "running") return;
      Promise.resolve(context.state === "closed" ? null : context.resume()).catch(() => {}).finally(() => {
        setTimeout(() => {
          if (unlocked && context.state !== "running") notifyAudioUnlockLost(`context_${context.state}`);
        }, 1000);
      });
    });
  }
  return audioContext;
}

const unlockLostObservers = new Set();

/** Powiadamia, gdy wcześniejsze odblokowanie dźwięku przestało obowiązywać. */
export function onAudioUnlockLost(observer) {
  if (typeof observer !== "function") return () => {};
  unlockLostObservers.add(observer);
  return () => unlockLostObservers.delete(observer);
}

function notifyAudioUnlockLost(reason) {
  if (!unlocked) return;
  unlocked = false;
  for (const observer of unlockLostObservers) {
    try { observer(reason); } catch {}
  }
}

export function createSfxAudio(url) {
  const context = getAudioContext();
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  audio.src = url;
  audio.addEventListener("error", () => {
    // Nieudane pobranie/dekodowanie: odsłuch w ustawieniach nie może
    // zostać w stanie „gra”.
    stopSfxAudio(audio);
  });
  const source = context.createMediaElementSource(audio);
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(gain);
  gain.connect(masterGain);
  audioNodes.set(audio, { source, gain, volume: 1, generation: 0 });
  return audio;
}

export function setSfxAudioVolume(audio, volume) {
  const nodes = audioNodes.get(audio);
  if (!nodes) return;
  nodes.volume = Math.max(0, Math.min(1, volume));
  if (!audio.paused && !audio.ended) scheduleFade(audio);
}

export function stopSfxAudio(audio, { dispose = false } = {}) {
  if (!audio) return;
  const nodes = audioNodes.get(audio);
  if (nodes) {
    nodes.generation++;
    nodes.gain.gain.cancelScheduledValues(audioContext.currentTime);
    nodes.gain.gain.setValueAtTime(0, audioContext.currentTime);
  }
  try { audio.pause(); audio.currentTime = 0; } catch {}
  if (dispose && nodes) {
    nodes.source.disconnect();
    nodes.gain.disconnect();
    audioNodes.delete(audio);
  }
}

function decodeBuffer(context, bytes) {
  // Starsze Safari zna tylko wersję z wywołaniami zwrotnymi.
  return new Promise((resolve, reject) => {
    const pending = context.decodeAudioData(bytes, resolve, reject);
    if (pending?.then) pending.then(resolve, reject);
  });
}

function createSound(url) {
  const context = getAudioContext();
  const gain = context.createGain();
  gain.gain.value = 0;
  gain.connect(masterGain);
  const sound = { src: url, gain, volume: 1, buffer: null, failed: false, error: null, source: null, startedAt: 0, generation: 0, endListeners: new Set() };
  sound.ready = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      sound.buffer = await decodeBuffer(context, await response.arrayBuffer());
    } catch (error) {
      sound.failed = true;
      sound.error = String(error?.name || "sound_load_failed");
    }
    return sound.buffer;
  })();
  return sound;
}

function stopSound(sound) {
  sound.generation++;
  const source = sound.source;
  sound.source = null;
  sound.gain.gain.cancelScheduledValues(audioContext.currentTime);
  sound.gain.gain.setValueAtTime(0, audioContext.currentTime);
  if (source) {
    source.onended = null;
    try { source.stop(); } catch {}
    source.disconnect();
  }
}

function disposeSound(sound) {
  stopSound(sound);
  sound.gain.disconnect();
  if (sound.src.startsWith("blob:")) URL.revokeObjectURL(sound.src);
}

function setSoundVolume(sound, volume) {
  sound.volume = Math.max(0, Math.min(1, volume));
  if (sound.source) scheduleSoundFade(sound);
}

function scheduleSoundFade(sound) {
  const position = audioContext.currentTime - sound.startedAt;
  scheduleGainFade(sound.gain.gain, sound.volume, position, sound.buffer?.duration);
}

export function buildSfxUrl(folder, file) {
  const currentVersion = MANIFEST_PATH.split("?")[1];
  return `${AUDIO_BASE}${folder}/${file.split("?")[0]}?${currentVersion}`;
}

function loadIntoCache(key, url) {
  const old = cache.get(key);
  if (old) disposeSound(old);
  const sound = createSound(url);
  cache.set(key, sound);
  return sound;
}

/* ========= WARIANTY ========= */

export function getSfxVariant(key) {
  return localStorage.getItem(`sfx_variant_${key}`) || "classic.mp3";
}

export function setSfxVariant(key, file) {
  const meta = getCategoryMeta(key);
  if (!meta) return;
  localStorage.setItem(`sfx_variant_${key}`, file);
  loadIntoCache(key, buildSfxUrl(meta.folder, file));
  _applySfxVolume(key);
}

export function resetSfxVariants() {
  for (const cat of getSfxCategories()) {
    localStorage.removeItem(`sfx_variant_${cat.key}`);
    loadIntoCache(cat.key, buildSfxUrl(cat.folder, "classic.mp3"));
    _applySfxVolume(cat.key);
  }
}

/* ========= GŁOŚNOŚCI ========= */

export function getSfxVolume(key) {
  const v = localStorage.getItem(`sfx_vol_${key}`);
  return v !== null ? parseFloat(v) : 1.0;
}

export function getSfxVolumes() {
  const map = new Map();
  for (const cat of getSfxCategories()) {
    map.set(cat.key, getSfxVolume(cat.key));
  }
  return map;
}

export function setSfxVolume(key, v) {
  const clamped = Math.max(0, Math.min(1, v));
  localStorage.setItem(`sfx_vol_${key}`, String(clamped));
  const sound = cache.get(key);
  if (sound) setSoundVolume(sound, _getEffectiveVolume(key));
}

function _applySfxVolume(key) {
  const sound = cache.get(key);
  if (sound) setSoundVolume(sound, _getEffectiveVolume(key));
}

// Głośności sesyjne (nadpisują localStorage na czas sesji, nie zapisują)
const _sessionVolumes = new Map();

// Ustawia głośność na żywo bez zapisu do localStorage (użycie w podsumowaniu)
export function setSessionSfxVolume(key, v) {
  const clamped = Math.max(0, Math.min(1, v));
  _sessionVolumes.set(key, clamped);
  // Zmiana poziomu nie restartuje odtwarzania ani procentowego fade.
  const sound = cache.get(key);
  if (sound) setSoundVolume(sound, clamped);
}

function _getEffectiveVolume(key) {
  return _sessionVolumes.has(key) ? _sessionVolumes.get(key) : getSfxVolume(key);
}

export function applySfxVolumes() {
  for (const cat of getSfxCategories()) {
    _applySfxVolume(cat.key);
  }
}

export function resetSfxVolumes() {
  for (const cat of getSfxCategories()) {
    localStorage.removeItem(`sfx_vol_${cat.key}`);
    const sound = cache.get(cat.key);
    if (sound) setSoundVolume(sound, _getEffectiveVolume(cat.key));
  }
}

/* ========= CUSTOM BLOB (IndexedDB, per game) ========= */

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbKey(key, gameId) {
  return gameId ? `${gameId}:${key}` : key;
}

export async function setSfxCustomBlob(key, blob, filename, gameId = _currentGameId) {
  const k = idbKey(key, gameId);
  const url = URL.createObjectURL(blob);
  loadIntoCache(key, url);
  _applySfxVolume(key);

  const db = await openIDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).put({ blob, filename }, k);
    req.onsuccess = res;
    req.onerror = () => rej(req.error);
  });
}

export async function getSfxCustomFiles(gameId = _currentGameId) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    const keyReq = tx.objectStore(IDB_STORE).getAllKeys();
    const result = new Map();
    let data, keys;
    req.onsuccess = () => { data = req.result; if (keys !== undefined) finish(); };
    keyReq.onsuccess = () => { keys = keyReq.result; if (data !== undefined) finish(); };
    req.onerror = keyReq.onerror = () => reject(req.error);
    function finish() {
      const prefix = gameId ? `${gameId}:` : null;
      keys.forEach((k, i) => {
        const ks = String(k);
        if (prefix) {
          if (ks.startsWith(prefix)) result.set(ks.slice(prefix.length), data[i]);
        } else {
          if (!ks.includes(":")) result.set(ks, data[i]);
        }
      });
      resolve(result);
    }
  });
}

export async function clearSfxCustomFile(key, gameId = _currentGameId) {
  const k = idbKey(key, gameId);
  const meta = getCategoryMeta(key);
  if (meta) {
    loadIntoCache(key, buildSfxUrl(meta.folder, getSfxVariant(key)));
    _applySfxVolume(key);
  }
  const db = await openIDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const req = tx.objectStore(IDB_STORE).delete(k);
    req.onsuccess = res;
    req.onerror = () => rej(req.error);
  });
}

export async function clearAllSfxCustomFiles(gameId = _currentGameId) {
  for (const cat of getSfxCategories()) {
    await clearSfxCustomFile(cat.key, gameId);
  }
}

/* ========= CLOUD URL ========= */

export function loadSfxFromCloud(urlMap) {
  for (const [key, url] of urlMap) {
    loadIntoCache(key, url);
    _applySfxVolume(key);
  }
}

/* ========= FADE ========= */

// Wejście: krótkie, stałe (tylko bez trzasku) — procent długości pliku
// tłumił uderzenie krótkich efektów i wyciszał początek długiej muzyki
// (intro 32 s: 1,6 s ciszy). Wyjście: do 0,35 s (najwyżej 20% pliku)
// po krzywej (1 - t)², która na ucho cichnie równo; liniowa trzymała
// głośność do końca i urywała dźwięk (zgłoszenie właściciela 2026-10-29).
const FADE_IN_S = 0.015;
const FADE_OUT_MAX_S = 0.35;
const FADE_OUT_MAX_RATIO = 0.2;
const FADE_CURVE_POINTS = 32;

// Krzywa wyciszenia od ułamka `from` (0 = początek wyjścia) do końca.
function fadeOutCurve(target, from) {
  const curve = new Float32Array(FADE_CURVE_POINTS);
  for (let i = 0; i < FADE_CURVE_POINTS; i++) {
    const t = from + (1 - from) * (i / (FADE_CURVE_POINTS - 1));
    curve[i] = target * (1 - t) * (1 - t);
  }
  return curve;
}

function scheduleFade(audio) {
  const nodes = audioNodes.get(audio);
  if (!nodes) return;
  scheduleGainFade(nodes.gain.gain, nodes.volume, audio.currentTime || 0, audio.duration);
}

// Wejście i wyjście dla odtwarzania od pozycji `position` (s) pliku o długości `duration`.
function scheduleGainFade(gain, target, position, duration) {
  const now = audioContext.currentTime;
  gain.cancelScheduledValues(now);
  if (!Number.isFinite(duration) || duration <= 0) {
    gain.setValueAtTime(target, now);
    return;
  }
  const fadeIn = Math.min(FADE_IN_S, duration / 4);
  const fadeOut = Math.min(FADE_OUT_MAX_S, duration * FADE_OUT_MAX_RATIO);
  const fadeOutStart = duration - fadeOut;
  const remaining = Math.max(0, duration - position);
  if (position >= fadeOutStart) {
    // Zmiana głośności w trakcie wyjścia: dokończ krzywą od bieżącego miejsca.
    const from = Math.min(1, (position - fadeOutStart) / fadeOut);
    scheduleCurve(gain, fadeOutCurve(target, from), now, remaining);
    return;
  }
  gain.setValueAtTime(position < fadeIn ? target * position / fadeIn : target, now);
  if (position < fadeIn) gain.linearRampToValueAtTime(target, now + fadeIn - position);
  scheduleCurve(gain, fadeOutCurve(target, 0), now + fadeOutStart - position, fadeOut);
}

function scheduleCurve(gain, curve, start, duration) {
  if (duration <= 0) { gain.setValueAtTime(0, start); return; }
  try {
    gain.setValueCurveAtTime(curve, start, duration);
  } catch {
    gain.setValueAtTime(curve[0], start);
    gain.linearRampToValueAtTime(0, start + duration);
  }
}

export function playSfxAudio(audio, volume = 1) {
  const context = getAudioContext();
  const nodes = audioNodes.get(audio);
  nodes.generation++;
  const generation = nodes.generation;
  nodes.gain.gain.cancelScheduledValues(context.currentTime);
  nodes.gain.gain.setValueAtTime(0, context.currentTime);
  nodes.volume = Math.max(0, Math.min(1, volume));
  audio.currentTime = 0;
  // Wywołane synchronicznie w obsłudze gestu. Fade wykonuje silnik audio,
  // również wtedy, gdy przeglądarka ogranicza klatki strony/iframe.
  const resumed = context.state === "running" ? Promise.resolve() : context.resume();
  const playing = audio.play();
  return Promise.all([resumed, playing]).then(() => {
    if (nodes.generation === generation && !audio.paused && !audio.ended) scheduleFade(audio);
  });
}

/* ========= ODTWARZANIE ========= */

export function stopSfx(key) {
  const sound = cache.get(key);
  if (sound) stopSound(sound);
}

export function isSfxPlaying(key) {
  return !!cache.get(key)?.source;
}

// Actual audio state, used in addition to timing estimates for action gates.
export function isAnySfxPlaying() {
  return [...cache.values()].some(sound => !!sound.source);
}

// Koniec dowolnego dźwięku gry (playSfx). Wyświetlacz wysyła potwierdzenie
// planszy zaraz po końcu dźwięku zamiast przy następnym takcie 500 ms.
const endedObservers = new Set();
export function onAnySfxEnded(observer) {
  if (typeof observer !== "function") return () => {};
  endedObservers.add(observer);
  return () => endedObservers.delete(observer);
}
function reportEnded(key) {
  for (const observer of endedObservers) {
    try { observer(key); } catch {}
  }
}

// Jednorazowo na najbliższy naturalny koniec dźwięku (nie na zatrzymanie).
export function onSfxEnd(key, fn) {
  const sound = cache.get(key);
  if (!sound || typeof fn !== "function") return () => {};
  sound.endListeners.add(fn);
  return () => sound.endListeners.delete(fn);
}

// Instrumentacja WYŁĄCZNIE do obserwacji w E2E (tests/e2e/control.spec.js) —
// zero wpływu na normalne działanie: jedna operacja push() na window, zawsze
// włączona (nie ma trybu "testowego" do przełączania). Bez tego nie dałoby
// się z Playwrighta zweryfikować, JAKI dźwięk (i w jakiej kolejności) faktycznie
// poleciał — Audio Web API nie eksponuje tego nigdzie w DOM.
export function playSfx(key) {
  const requestedAt = performance.now();
  if (typeof window !== "undefined") {
    (window.__sfxLog ??= []).push({ key, at: Date.now(), muted: globalMuted });
  }
  const sound = cache.get(key);
  if (!sound) {
    reportPlayback({ key, failed: true, error: "sound_not_loaded", delayMs: 0 });
    return;
  }
  const context = getAudioContext();
  // Ponowne odtworzenie zaczyna dźwięk od początku (jak dotąd).
  stopSound(sound);
  const generation = sound.generation;
  const delayMs = () => Math.max(0, Math.round(performance.now() - requestedAt));
  const start = () => {
    if (generation !== sound.generation) return;
    if (!sound.buffer) {
      reportPlayback({ key, failed: true, error: sound.error || "sound_not_loaded", delayMs: delayMs() });
      return;
    }
    if (context.state !== "running") {
      // Zawieszony kontekst nie gra: przeglądarka wymaga gestu (autoplay).
      notifyAudioUnlockLost("not_allowed");
      reportPlayback({ key, failed: true, error: "NotAllowedError", delayMs: delayMs() });
      return;
    }
    const source = context.createBufferSource();
    source.buffer = sound.buffer;
    source.connect(sound.gain);
    source.onended = () => {
      if (sound.source !== source) return;
      sound.source = null;
      source.disconnect();
      const listeners = [...sound.endListeners];
      sound.endListeners.clear();
      for (const fn of listeners) { try { fn(); } catch {} }
      reportEnded(key);
    };
    sound.source = source;
    sound.startedAt = context.currentTime;
    scheduleSoundFade(sound);
    source.start();
    reportPlayback({ key, failed: false, delayMs: delayMs() });
  };
  // Gotowy bufor i działający kontekst: start od razu, w tym samym takcie.
  if (sound.buffer && context.state === "running") { start(); return; }
  const resumed = context.state === "running" ? null : context.resume().catch(() => {});
  Promise.all([sound.ready, resumed]).then(start);
}

// Sound previews are mutually exclusive, while gameplay cues may still
// intentionally overlap. Keep this policy separate from playSfx().
export function playSfxPreview(key) {
  if (previewSfxKey && previewSfxKey !== key) stopSfx(previewSfxKey);
  previewSfxKey = key;
  playSfx(key);
}

export function stopSfxPreview(key = null) {
  if (!previewSfxKey || (key && previewSfxKey !== key)) return;
  stopSfx(previewSfxKey);
  previewSfxKey = null;
}

// Długość z zdekodowanego bufora (metadane MP3 bywają przybliżone). Czekamy
// najwyżej 5 s na wczytanie; 0 = nieznana (transitionTiming przyjmuje wtedy zapas).
const DURATION_WAIT_MS = 5000;
export async function getSfxDuration(key) {
  const sound = cache.get(key);
  if (!sound) return 0;
  const buffer = await Promise.race([sound.ready, new Promise(resolve => setTimeout(() => resolve(null), DURATION_WAIT_MS))]);
  return buffer?.duration || 0;
}

// Ta sama miara co getSfxDuration (Control 2 i Wyświetlacz importują tę nazwę).
export const getSfxDurationAccurate = getSfxDuration;

/* ========= AUDIO UNLOCK ========= */

let unlocked = false;
let unlockPromise = null;

export async function unlockAudio() {
  const context = getAudioContext();
  if (unlocked && context.state === "running") return true;
  if (unlockPromise) return unlockPromise;
  try {
    const a = new Audio();
    a.volume = 0;
    a.src = "/assets/audio/reveal/classic.mp3?v=v2026-11-12T13423";

    // Call play() synchronously in the gesture handler, then trust its
    // promise. Previously a rejected autoplay attempt still returned true,
    // allowing Display to report an unlock the browser had refused.
    const resumed = context.resume();
    const playing = a.play();
    unlockPromise = Promise.all([resumed, playing]).then(() => {
      a.pause();
      unlocked = context.state === "running";
      return unlocked;
    }).catch(() => false).finally(() => { unlockPromise = null; });
    return await unlockPromise;
  } catch {
    unlockPromise = null;
    return false;
  }
}

/* ========= INICJALIZACJA ========= */

/**
 * Wywołać raz po loadSfxManifest() i setCurrentGameId().
 * Wczytuje warianty z localStorage, głośności, własne pliki z IndexedDB.
 */
export async function initSfx() {
  for (const cat of getSfxCategories()) {
    loadIntoCache(cat.key, buildSfxUrl(cat.folder, getSfxVariant(cat.key)));
  }
  applySfxVolumes();

  if (_currentGameId) {
    const gameFiles = await getSfxCustomFiles(_currentGameId);
    for (const [key, { blob }] of gameFiles) {
      loadIntoCache(key, URL.createObjectURL(blob));
      _applySfxVolume(key);
    }
  }
}

/**
 * Nadpisuje ustawienia z game.settings.sound (per-game).
 * volumes: { key: 0–100 }, variants: { key: "classic.mp3?v=v2026-11-12T13423" }

 */
export function applySfxGameSettings({ volumes = {}, variants = {} } = {}) {
  // Brak wpisu oznacza 100%, tak jak suwak ustawień. Nie dziedziczymy
  // głośności poprzedniej gry zapisanej w tej samej przeglądarce.
  for (const { key } of getSfxCategories()) {
    const pct = volumes[key];
    setSfxVolume(key, typeof pct === "number" && Number.isFinite(pct) ? pct / 100 : 1);
  }
  for (const [key, file] of Object.entries(variants)) {
    // "__custom__" nie jest plikiem z audio/ — pomijamy,
    // plik custom zostanie załadowany osobno przez loadSfxFromCloud()
    if (file && file !== "__custom__") {
      localStorage.setItem(`sfx_variant_${key}`, file);
    }
  }
}
