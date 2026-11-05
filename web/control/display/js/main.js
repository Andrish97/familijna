import { renderAndConfirm } from "../../../shared/js/gameplay/renderCompletion.js?v=v2026-11-05T23552";

// control/display/js/main.js
// Punkt wejścia Display v2. Napisane od zera (nie kopia control/display/js/main.js)
// — inna orkiestracja: zamiast kanału komend + snapshotu z device_state,
// jest jedno wywołanie RPC na start (game_state_get, przez subscribe.js)
// i "dzwonek" broadcastowy zamiast kanału DISPLAY_CMD. Obecność, widoczność
// karty i odblokowanie dźwięku zapisuje heartbeat lease (device-lease.js).

import { initFullscreenButton } from "../../../shared/js/core/fullscreen.js?v=v2026-11-05T23552";
import { initI18n, setUiLang, t } from "../../../shared/translation/translation.js?v=v2026-11-05T23552";
import { startKeepAlive } from "../../../shared/js/core/keep-alive.js?v=v2026-11-05T23552";
import { guardViewportWidth, MIN_WORK_HEIGHT } from "../../../shared/js/core/device-guard.js?v=v2026-11-05T23552";
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-05T23552";
import { createScene } from "./scene.js?v=v2026-11-05T23552";
import { createQRController } from "./qr.js?v=v2026-11-05T23552";
import { createSubscription } from "../../../shared/js/core/game-state-subscribe.js?v=v2026-11-05T23552";
import { createRenderer } from "./render.js?v=v2026-11-05T23552";
import { createDisplaySoundReactor } from "./soundReactor.js?v=v2026-11-05T23552";
import { loadSfxManifest, initSfx, setCurrentGameId, applySfxGameSettings, unlockAudio, onAudioUnlockLost, getSfxDurationAccurate as getSfxDuration, isAnySfxPlaying, onSfxPlayback, onAnySfxEnded, setSfxMuted } from "../../../shared/js/core/sfx.js?v=v2026-11-05T23552";
import { createDeviceLease, updateDeviceLeaseOverlay } from "../../../shared/js/core/device-lease.js?v=v2026-11-05T23552";


const $ = (id) => document.getElementById(id);

function enterFullscreen() {
  if (!/Smart[- ]?TV|HbbTV|NetCast|Web[O0]S|Tizen|Android[ /_-]?TV|Google[ /_-]?TV|BRAVIA|Viera|AFT\w+|AppleTV|CrKey|Roku|TV Safari/i.test(navigator.userAgent)) return;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  const root = document.documentElement;
  try {
    const result = root.requestFullscreen ? root.requestFullscreen() : root.webkitRequestFullscreen?.();
    result?.catch?.(() => {});
  } catch {}
}

function parseParams() {
  const u = new URL(location.href);
  return { gameId: u.searchParams.get("id") || "", key: u.searchParams.get("key") || "" };
}

async function authDisplayOrThrow(gameId, key) {
  if (!gameId || !key) throw new Error("Brak id lub key w URL.");
  const { data, error } = await sb().rpc("display_auth", { p_game_id: gameId, p_key: key }).abortSignal(AbortSignal.timeout(6500));
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.id) throw new Error("Zły klucz (display) albo gra nie istnieje.");
  return row;
}

function showBlack() {
  $("blackScreen")?.classList.remove("hidden");
  $("qrScreen")?.classList.add("hidden");
  $("gameScreen")?.classList.add("hidden");
}

function monitorVisibleFrameGaps() {
  if (document.visibilityState !== "visible" || typeof requestAnimationFrame !== "function") return () => null;
  let active = true;
  let previous = performance.now();
  let maxGapMs = 0;
  let stalledFrames = 0;
  let frameId = 0;
  // RAF may be paused while a tab is hidden and resume with a large gap.
  // That gap belongs to background suspension, not a visible rendering stall.
  const resetWindow = () => {
    previous = performance.now();
    stalledFrames = 0;
    maxGapMs = 0;
  };
  document.addEventListener("visibilitychange", resetWindow);
  const tick = now => {
    if (!active) return;
    if (document.visibilityState !== "visible") {
      previous = now;
      frameId = requestAnimationFrame(tick);
      return;
    }
    const gap = Math.max(0, now - previous);
    previous = now;
    if (gap >= 150) { stalledFrames += 1; maxGapMs = Math.max(maxGapMs, gap); }
    frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);
  return () => {
    active = false;
    cancelAnimationFrame(frameId);
    document.removeEventListener("visibilitychange", resetWindow);
    // Report only obvious visible stalls; background-tab throttling is excluded.
    return document.visibilityState === "visible" && stalledFrames && maxGapMs >= 250
      ? { maxGapMs: Math.round(maxGapMs), stalledFrames }
      : null;
  };
}

// Instrumentacja WYŁĄCZNIE do obserwacji w E2E (tests/e2e/control.spec.js).
// Display maluje na SVG dot-matrix, bez żadnego tekstu w DOM (w
// odróżnieniu od Hosta, gdzie zwykły .textContent wystarcza) — bez tego
// zapisu nie dałoby się z Playwrighta zweryfikować, co render.js FAKTYCZNIE
// kazał narysować scene.js (dokładny tekst/punkty/animacja), tylko czy
// strona się nie wywaliła. Zero wpływu na realne rysowanie — owija wywołania
// przezroczyście, oryginalna funkcja i tak się wykonuje.
function instrumentSceneApi(api) {
  window.__displayLog = [];
  const wrap = (obj, path) => {
    const out = {};
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "function") {
        out[k] = (...args) => {
          const call = `${path}.${k}`;
          window.__displayLog.push({ call, args });
          const perf = window.__displayPerf;
          if (!perf) return v.apply(obj, args);
          const start = performance.now();
          const findMs = (value) => {
            if (!value || typeof value !== "object") return 0;
            if (Number.isFinite(value.ms)) return value.ms;
            return findMs(value.animOut) + findMs(value.animIn);
          };
          const targetMs = args.reduce((sum, arg) => sum + findMs(arg), 0);
          perf.active++;
          let syncMs;
          const finish = () => {
            perf.active--;
            if (targetMs > 0) perf.animations.push({ call, startedAt: performance.timeOrigin + start, targetMs, actualMs: performance.now() - start, syncMs });
          };
          try {
            const result = v.apply(obj, args);
            syncMs = performance.now() - start;
            if (result && typeof result.then === "function") return result.finally(finish);
            finish();
            return result;
          } catch (error) { syncMs = performance.now() - start; finish(); throw error; }
        };
      } else if (v && typeof v === "object") {
        out[k] = wrap(v, `${path}.${k}`);
      } else {
        out[k] = v;
      }
    }
    return out;
  };
  return wrap(api, "api");
}

// Tryb podglądu dla D3 w Control (plan, sekcja 3a pkt 5: "Podgląd kolorów/
// motywu/logo w małej miniaturce w panelu Control" — Control osadza tę samą
// stronę w iframe zamiast montować scene.js osobno, prościej i bez
// duplikowania kodu rysującego). Zero autoryzacji/subskrypcji real
// game_state — Control (jedyne, co go osadza) sam zna aktualne ustawienia i
// przesyła gotowy, spreparowany wiersz przez postMessage; nie ma potrzeby
// przekazywać do iframe klucza dostępu do prawdziwej gry.
async function bootPreview() {
  const scene = await createScene();
  scene.api = instrumentSceneApi(scene.api);
  const qrCtrl = createQRController({
    qrScreen: $("qrScreen"), gameScreen: $("gameScreen"),
    hostCard: $("qrHostCard"), buzzerCard: $("qrBuzzerCard"),
    hostImg: $("qrHostImg"), buzzerImg: $("qrBuzzerImg"),
    hostCodeEl: $("qrHostCode"), buzzerCodeEl: $("qrBuzzerCode"),
  });
  const qr = { show() {}, hide() { qrCtrl.hide(); } };
  const renderer = createRenderer({ scene, qr });

  $("blackScreen")?.classList.add("hidden");
  $("qrScreen")?.classList.add("hidden");
  // Preview is a passive renderer, not a device session: reveal its surface
  // directly instead of waiting for the live-game skeleton/auth flow.
  $("gameScreen")?.classList.add("skel-step-ready");
  $("gameScreen")?.classList.remove("hidden");

  // ZAWSZE renderSnapshot, nigdy renderDiff — w odróżnieniu od prawdziwej
  // gry, tu nie ma czego animować płynnie (to formularz ustawień, nie mecz),
  // a co ważniejsze: web/js/gameplay/deriveEvents.js w ogóle nie ma zdarzenia na
  // zmianę kolorów/motywu (bo w prawdziwej grze te pola nigdy się nie
  // zmieniają w trakcie rozgrywki — blokada ustawień po starcie) — gdyby
  // korzystać z renderDiff() tutaj, KAŻDA kolejna wiadomość po pierwszej
  // zgubiłaby zmianę koloru/motywu (deriveEvents nie ma jak jej wykryć),
  // mimo że sam wiersz niesie już nową wartość.
  let previewAppearance = null;
  let previewTeams = {};
  let previewQueue = Promise.resolve();
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "familijna:preview-row") return;
    const row = e.data.row;
    previewQueue = previewQueue.then(async () => {
    const appearance = JSON.stringify(row.detail?.display);
    const rawTeams = row.detail?.teams || {};
    const teams = {
      teamA: rawTeams.defaultA === true || !rawTeams.teamA ? t("control.teamADefault") : rawTeams.teamA,
      teamB: rawTeams.defaultB === true || !rawTeams.teamB ? t("control.teamBDefault") : rawTeams.teamB,
    };
    if (previewAppearance === appearance) {
      if (previewTeams.teamA !== teams.teamA) scene.api.small.long1(teams.teamA || "");
      if (previewTeams.teamB !== teams.teamB) scene.api.small.long2(teams.teamB || "");
      previewTeams = { ...teams };
      return;
    }
    // logoPreview (wyłącznie w wierszu podglądu — nigdy w prawdziwym
    // game_state) to jeszcze NIEZAPISANY wybór logo w formularzu ustawień —
    // bindGame/reload czytają logo z bazy, więc nie zobaczyłyby tego wcale.
    // Musi się wykonać PRZED renderSnapshot, żeby paintForStep's
    // api.logo.show() (step==="r_intro") narysował już właściwe logo, a nie
    // stare/domyślne z poprzedniej klatki.
    if ("logoPreview" in (row.detail?.display || {})) {
      scene.api.logo.setPreview(row.detail.display.logoPreview);
    } else {
      const logoId = row.detail?.display?.logoId;
      let logoPreview = null;
      if (logoId) {
        try {
          const { data, error } = await sb()
            .from("user_logos")
            .select("type,payload")
            .eq("id", logoId)
            .maybeSingle();
          if (error) throw error;
          if (data?.type && data?.payload) logoPreview = data;
        } catch (error) {
          console.warn("[display2] preview logo lookup failed:", error);
        }
      }
      scene.api.logo.setPreview(logoPreview);
    }
    await renderer.renderSnapshot(row);
    // Podgląd formularza jest statyczny; intro prawdziwej gry pozostaje osobne.
    if (!row.detail?.display?.suppressLogoDraw) scene.api.logo.draw();
    previewAppearance = appearance;
    previewTeams = { ...teams };
    // Reszta tego układu (plan podglądu: prawo/góra/lewo = przykładowe
    // cyfry, wskaźnik wyłączony) nie odpowiada ŻADNEMU prawdziwemu stanowi
    // gry — to czysto demonstracyjne wypełnienie "small" (płótno niezależne
    // od "big", gdzie jest logo), więc idzie bezpośrednio przez scene.api,
    // nie przez wspólny (z prawdziwą grą) render.js's paintForStep.
    const previewNumbers = row.detail?.display?.previewNumbers;
    if (previewNumbers) {
      scene.api.small.rightDigits(String(previewNumbers.right ?? ""));
      scene.api.small.topDigits(String(previewNumbers.top ?? ""));
      scene.api.small.leftDigits(String(previewNumbers.left ?? ""));
      // Bez previewXPositions nie ruszamy pól X: setX(..., false) czyści
      // kolumny 1–3 i 28–30, a tam leżą teksty finału i logo.
      const xPositions = row.detail?.display?.previewXPositions;
      if (xPositions) for (const side of ["A", "B"]) {
        const active = new Set(xPositions[side] || []);
        for (let position = 1; position <= 3; position++) {
          scene.api.rounds.setX(`${position}${side}`, active.has(position));
        }
      }
    } else {
      scene.api.small.rightDigits("123");
      scene.api.small.topDigits("456");
      scene.api.small.leftDigits("789");
    }
    // Lampki kontroli jak w grze: drużyna z control_team (podglądy ustawień
    // jej nie mają, więc tam zostają zgaszone).
    scene.api.indicator.set(row.control_team === "A" ? "ON_A" : row.control_team === "B" ? "ON_B" : "OFF");
    window.dispatchEvent(new CustomEvent("familijna:preview-rendered", { detail: { rev: row.rev } }));
    if (window.parent !== window) window.parent.postMessage({ type: "familijna:preview-rendered", rev: row.rev }, location.origin);
    }).catch((error) => console.warn("[display2] preview render failed", error));
  });

  document.documentElement.classList.remove("page-loading");
  parent.postMessage({ type: "familijna:preview-ready" }, "*");
}

window.addEventListener("DOMContentLoaded", async () => {
  await initI18n({ withSwitcher: false });
  const params = new URL(location.href).searchParams;
  const preview = params.get("preview") === "1";
  const controlTestFrame = window.parent !== window
    && window.frameElement?.dataset.controlTestMode === "true";
  const deviceGate = preview || controlTestFrame ? null : guardViewportWidth({ minWidth: 980, minHeight: MIN_WORK_HEIGHT, minScreenShortSide: 800, minTvResolution: true, formFactors: ["desktop", "tablet", "tv"] });
  document.documentElement.removeAttribute("data-device-guard-pending");
  if (deviceGate && deviceGate.state() !== "ok") await deviceGate.ready;

  if (preview) {
    // Podgląd w Control/ustawieniach gry — bez przycisku pełnego ekranu.
    $("btnFullscreen")?.remove();
    await bootPreview();
    return;
  }
  startKeepAlive();
  initFullscreenButton({ button: $("btnFullscreen") });
  enterFullscreen();
  document.addEventListener("keydown", (event) => {
    const screen = $("audioUnlockScreen");
    if (screen && !screen.classList.contains("hidden") && (event.key === "Enter" || event.key === " " || event.key === "Select" || event.keyCode === 23)) {
      event.preventDefault();
      $("btnAudioUnlock")?.click();
    }
  });
  document.addEventListener("pointerdown", enterFullscreen, { once: true });
  document.addEventListener("keydown", enterFullscreen, { once: true });

  try {
    const { gameId, key } = parseParams();
    // Manifest dźwięków i scena (motyw, plansza) nie zależą od gry ani lease —
    // startują razem z autoryzacją zamiast po niej (start urządzenia).
    const sfxManifestP = loadSfxManifest();
    const sceneP = createScene();
    sfxManifestP.catch(() => {});
    sceneP.catch(() => {});
    const game = await authDisplayOrThrow(gameId, key);
    let subscription = null;
    let rendererInstance = null;
    let soundReactorInstance = null;
    const lease = createDeviceLease({ gameId: game.id, deviceType: "display", key, onState: ({ state }) => {
      updateDeviceLeaseOverlay(state);
      if (subscription) {
        if (state === "primary") {
          syncAudioUnlockScreen();
          void subscription.start();
        } else {
          subscription.stop();
          rendererInstance?.cancel?.();
          soundReactorInstance?.cancel?.();
          setSfxMuted(true);
          $("audioUnlockScreen")?.classList.add("hidden");
          showBlack();
        }
      }
    } });
    await lease.start();
    updateDeviceLeaseOverlay(lease.state);
    // Zdarzenia Wyświetlacza idą dziennikiem sesji urządzenia (session-log.js).
    const displayEventLog = { report: lease.log };

    // Dźwięk "ze źródła Wyświetlacz" (zgłoszone) — ten sam js/core/sfx.js co
    // Control, wczytany niezależnie tutaj. Głośności/warianty (BEZ własnych
    // plików — patrz web/js/gameplay/gameStateShape.js) dociągane niżej z pierwszego
    // wiersza game_state, gdzie control/js/app.js je zdenormalizowało.
    setCurrentGameId(game.id);
    await sfxManifestP;
    await initSfx();
    const soundReactor = createDisplaySoundReactor();
    soundReactorInstance = soundReactor;

    const audioUnlockScreen = $("audioUnlockScreen");
    const btnAudioUnlock = $("btnAudioUnlock");
    // Odblokowanie dźwięku jest cechą tej instancji Wyświetlacza: baza wiąże je
    // z połączeniem i generacją lease (migracja 397), więc przeładowanie lub
    // podmiana urządzenia zawsze zaczyna od zablokowanego dźwięku.
    let audioUnlockedHere = false;
    let displaySoundSelected = false;
    let activeGameStep = null;
    let lastFrameDiagnosticAt = 0;
    const stopAudioDiagnostics = onSfxPlayback(event => {
      if (!displaySoundSelected || !activeGameStep || /^(devices_|setup_)/.test(activeGameStep)) return;
      if (!event.failed && event.delayMs < 500) return;
      const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      lease.setMeta({ audio_diagnostic: {
        id, sound: String(event.key || "unknown").slice(0, 80),
        delayMs: Math.max(0, Number(event.delayMs) || 0), failed: !!event.failed,
        error: String(event.error || "").slice(0, 160),
      } });
    });
    window.addEventListener("pagehide", stopAudioDiagnostics, { once: true });
    function syncAudioUnlockScreen(row = null) {
      if (!audioUnlockScreen) return;
      const soundSource = row?.detail?.settings?.soundSource;
      if (soundSource === "display" || soundSource === "control") {
        displaySoundSelected = soundSource === "display";
      }
      if (typeof row?.step === "string") activeGameStep = row.step;
      // Odblokowanie przeglądarki jest potrzebne tylko wtedy, gdy dźwięk ma
      // grać z tego urządzenia. Nie zasłaniaj Display, gdy gra dźwięk z Control.
      const visible = displaySoundSelected && !audioUnlockedHere && lease.state === "primary";
      const wasHidden = audioUnlockScreen.classList.contains("hidden");
      audioUnlockScreen.classList.toggle("hidden", !visible);
      audioUnlockScreen.setAttribute("aria-hidden", String(!visible));
      if (visible && wasHidden) btnAudioUnlock?.focus({ preventScroll: true });
    }
    syncAudioUnlockScreen();
    btnAudioUnlock?.addEventListener("click", async () => {
      enterFullscreen();
      if (!await unlockAudio()) return;
      // Przeglądarka pozwala już grać. Zapis do bazy jedzie heartbeatem lease:
      // wysyłany od razu, a przy słabym łączu powtarzany każdym kolejnym
      // heartbeatem — bez ponownego gestu.
      audioUnlockedHere = true;
      lease.setMeta({ audio_unlocked: true, audio_lock_reason: null, audio_lock_detail: null });
      syncAudioUnlockScreen();
    });

    // Przeglądarka przestała pozwalać na dźwięk bez przeładowania strony
    // (np. uśpienie telewizora): Control wstrzymuje grę, a przycisk wraca.
    const stopUnlockLostWatch = onAudioUnlockLost((reason) => {
      if (!audioUnlockedHere) return;
      console.warn("[display2 audio unlock] browser audio no longer unlocked:", reason);
      audioUnlockedHere = false;
      // Powód trafia do statystyk Control (zdarzenie audio_unlock); bez niego
      // blokada oznacza nową instancję Wyświetlacza.
      lease.setMeta({ audio_unlocked: false, audio_lock_reason: "browser_lost", audio_lock_detail: String(reason || "").slice(0, 40) });
      syncAudioUnlockScreen();
    });
    window.addEventListener("pagehide", stopUnlockLostWatch, { once: true });

    const scene = await sceneP;
    scene.api = instrumentSceneApi(scene.api);
    const qrCtrl = createQRController({
      qrScreen: $("qrScreen"), gameScreen: $("gameScreen"),
      hostCard: $("qrHostCard"), buzzerCard: $("qrBuzzerCard"),
      hostImg: $("qrHostImg"), buzzerImg: $("qrBuzzerImg"),
      hostCodeEl: $("qrHostCode"), buzzerCodeEl: $("qrBuzzerCode"),
    });
    await scene.api.logo.bindGame?.(game.id);

    // Host/buzzer NIEZALEŻNE — jeden LUB oba naraz (plan, korekta po
    // feedbacku: pierwszy przebieg pokazywał tylko jeden na raz, źle).
    const qr = {
      show(qrDetail) {
        $("blackScreen")?.classList.add("hidden");
        const host = qrDetail?.host || {};
        const buzzer = qrDetail?.buzzer || {};
        qrCtrl.setHost(host.show ? host.url || "" : "");
        qrCtrl.setHostCode(host.show ? host.code || "" : "");
        qrCtrl.setBuzzer(buzzer.show ? buzzer.url || "" : "");
        qrCtrl.setBuzzerCode(buzzer.show ? buzzer.code || "" : "");
        qrCtrl.setSingle(!!host.show !== !!buzzer.show);
        qrCtrl.show();
      },
      hide() {
        qrCtrl.hide();
      },
    };

    const renderer = createRenderer({
      scene, qr, getSfxDuration,
      onFinalResult: ({ amount, roundsPoints, finalPoints, multiplier, mainPrize, hitTarget, stateRev, renderKind }) =>
        displayEventLog.report({
          event_type: "prize_render",
          amount,
          rounds_points: roundsPoints,
          final_points: finalPoints,
          multiplier,
          main_prize: mainPrize,
          hit_target: hitTarget,
          state_rev: stateRev,
          render_kind: renderKind,
        }),
    });
    rendererInstance = renderer;
    async function warmCueTiming(row, previous) {
      const keys = new Set();
      const key = row?.sound_cue_key;
      if (key) keys.add(key);
      if (key === "round_transition" || key === "show_intro") keys.add("reveal");
      if (key === "final_theme" && row.step === "f_end") keys.add("reveal");
      if (key === "final_theme" && previous?.step === "f_start" && row.step === "f_p1_entry") {
        keys.add("round_transition");
        keys.add("reveal");
      }
      const pressed = row.detail?.rounds?.duel?.lastPressed;
      if (row.step === "r_duel" && pressed && !previous?.detail?.rounds?.duel?.lastPressed
        && !row.detail?.settings?.physicalBuzzer) keys.add("buzzer_press");
      // Resolve the exact shared timings before either side starts. Otherwise
      // Display audio can start immediately while renderDiff waits for MP3
      // decoding, making the animation finish after the sound.
      await Promise.all([...keys].map(getSfxDuration));
    }
    let prevRow = null;
    let renderQueue = Promise.resolve();
    let renderGeneration = 0;
    let appliedLang = null;

    let completedRenderRev = -1;
    let reportedRenderRev = -1;
    let loggedCompletionErrorRev = -1;
    let reportingCompletion = false;
    async function reportCompletion() {
      if (reportingCompletion || completedRenderRev <= 0 || completedRenderRev <= reportedRenderRev || isAnySfxPlaying()) return;
      reportingCompletion = true;
      const revision = completedRenderRev;
      try {
        const { error } = await sb().rpc("game_state_display_complete", { p_game_id: gameId, p_key: key, p_rev: revision, ...lease.actionArgs() }).abortSignal(AbortSignal.timeout(6500));
        if (!error) {
          reportedRenderRev = revision;
          // Control i Przycisk dostają potwierdzenie z bazy (zdarzenie
          // completion, migracja 510).
          lease.setProgress({ renderedRev: revision });
        }
        else if (loggedCompletionErrorRev !== revision) {
          loggedCompletionErrorRev = revision;
          displayEventLog.report({ event_type: "runtime_error", phase: "completion_ack", error_name: error.code || error.name || "RPCError", state_rev: revision });
        }
      } catch (error) {
        if (loggedCompletionErrorRev !== revision) {
          loggedCompletionErrorRev = revision;
          displayEventLog.report({ event_type: "runtime_error", phase: "completion_ack", error_name: error?.name || "NetworkError", state_rev: revision });
        }
      } finally { reportingCompletion = false; }
    }
    // Potwierdzenie zaraz po końcu dźwięku (dawniej do 500 ms czekania na
    // takt; eksport 29.10). Takt zostaje jako ponowienie zgubionego zapisu.
    onAnySfxEnded(() => { void reportCompletion().catch(() => {}); });
    // Retry a lost acknowledgment without replaying any animation.
    setInterval(() => { void reportCompletion().catch(() => {}); }, 500);
    subscription = createSubscription({
      gameId: game.id,
      deviceType: "display",
      key,
      // Sygnał „animacja rusza” dla Control (game-signal:<gra>, migracja 510).
      signal: true,
      getLeaseArgs: () => lease.actionArgs(),
      beforeResync: () => lease.refresh(),
      log: lease.log,
      onRow: async (row) => {
        lease.setProgress({ receivedRev: Number(row.rev) || 0 });
        setSfxMuted(row.detail?.settings?.soundMuted);
        // Język idzie za operatorem w Control (control/js/app.js's
        // LANG-push, dawniej osobna komenda `LANG <code>` — dziś zwykłe
        // pole w game_state, patrz web/js/gameplay/gameStateShape.js).
        const lang = row.detail?.settings?.uiLang;
        if (lang && lang !== appliedLang) {
          // appliedLang ustawiane DOPIERO po sukcesie -- patrz identyczny
          // komentarz w control/host/js/main.js i control/buzzer/js/main.js: appliedLang=lang
          // PRZED zapisem wyniku setUiLang() + .catch(()=>{}) łykający błąd
          // bez retry zostawiałby stronę trwale w starym języku po
          // przejściowym błędzie przy dynamicznym imporcie słownika.
          try {
            if (await setUiLang(lang, { persist: true, updateUrl: true, apply: true })) appliedLang = lang;
          } catch (e) {
            console.warn("[display2] setUiLang nie powiodło się, spróbuję ponownie przy kolejnym wierszu:", e);
          }
        }

        // Nazwy korzystają z bieżącego słownika, poza kolejką animacji
        // i bez oczekiwania na przygotowanie lub zakończenie dźwięku.
        renderer.updateTeamNames(row);

        // Dźwięk — patrz komentarz przy setCurrentGameId() wyżej. Reaplikowane
        // na KAŻDY wiersz (tanie — kilka localStorage.setItem), nie tylko raz:
        // operator może zmienić głośność w modalu ustawień PO tym, jak Display
        // już dostał pierwszy (pusty) wiersz `sound` — "raz" zamroziłoby
        // ustawienia sprzed realnej konfiguracji (złapane przy pisaniu testu
        // E2E, nie w prawdziwej grze — ale ten sam mechanizm tam też obowiązuje).
        if (row.detail?.settings?.sound) {
          applySfxGameSettings(row.detail.settings.sound);
        }
        const prev = prevRow;
        const displayOwnsSound = row.detail?.settings?.soundSource === "display";
        const cueTimingReady = warmCueTiming(row, prev);
        if (displayOwnsSound) await cueTimingReady;
        else void cueTimingReady;
        soundReactor.onRow(row);
        lease.setProgress({ startedSoundCueSeq: Number(row.sound_cue_seq) || 0 });
        syncAudioUnlockScreen(row);

        // Widoczność kontenerów zależy wyłącznie od trybu — samo malowanie
        // planszy/QR/czarnego to render.js.
        const mode = row.detail?.display?.mode || "BLACK";
        if (mode === "GAME" && !["devices_display", "setup_finish"].includes(row.step)) {
          $("blackScreen")?.classList.add("hidden");
          $("qrScreen")?.classList.add("hidden");
          $("gameScreen")?.classList.remove("hidden");
        } else if (mode === "QR") {
          $("gameScreen")?.classList.add("hidden");
        } else {
          $("qrScreen")?.classList.add("hidden");
          $("gameScreen")?.classList.add("hidden");
          $("blackScreen")?.classList.remove("hidden");
        }

        // Rendering is serialized separately from RPC reads. A new restart
        // can cancel the current animation without waiting for its sound.
        prevRow = row;
        const restarting = row.top_card === "devices" && prev?.top_card !== "devices";
        if (restarting) { renderGeneration++; renderer.cancel(); }
        const token = renderGeneration;
        renderQueue = renderQueue.then(async () => {
          if (token !== renderGeneration) return;
          // For Control as the sound source, let its sound reactor start the
          // cue only after this Display has prepared timing and is about to
          // render the matching revision. The signal is keyed by cue sequence
          // so repeated identical sounds remain distinct.
          await cueTimingReady;
          if (token !== renderGeneration) return;
          if (lease.state === "primary" && prev && row.sound_cue_seq !== prev.sound_cue_seq
            && row.detail?.settings?.soundSource === "control") {
            void subscription?.sendSignal("display_transition_started", {
              sound_cue_seq: row.sound_cue_seq,
            });
          }
          await renderAndConfirm(
            async () => {
              const stopFrameMonitor = monitorVisibleFrameGaps();
              try {
                return await (!prev || restarting ? renderer.renderSnapshot(row) : renderer.renderDiff(prev, row));
              } finally {
                const gap = stopFrameMonitor();
                const now = Date.now();
                if (gap && now - lastFrameDiagnosticAt >= 15_000) {
                  lastFrameDiagnosticAt = now;
                  displayEventLog.report({
                    event_type: "render_stall",
                    max_frame_gap_ms: gap.maxGapMs,
                    stalled_frames: gap.stalledFrames,
                    visibility: document.visibilityState || "unknown",
                    state_rev: row.rev,
                  });
                }
              }
            },
            async () => {
              completedRenderRev = Math.max(completedRenderRev, row.rev);
              await reportCompletion();
            },
            () => token === renderGeneration,
          );
          if (token === renderGeneration) {
            document.querySelectorAll("[data-skel-step]").forEach((step) => step.classList.add("skel-step-ready"));
          }
        }).catch(error => {
          if (error?.name !== "AbortError") {
            displayEventLog.report({ event_type: "runtime_error", phase: "render", error_name: error?.name || "Error", state_rev: row.rev });
            console.warn("[display2] render failed", error);
          }
        });
      },
      onError: (error) => {
        console.warn("[display2] game_state_get failed:", error);
        showBlack();
        document.querySelectorAll("[data-skel-step]").forEach((step) => step.classList.add("skel-step-ready"));
      },
    });

    document.documentElement.classList.remove("page-loading");
    if (lease.state === "primary") await subscription.start();
  } catch (e) {
    console.warn("[display2]", e?.message || e);
    showBlack();
    document.querySelectorAll("[data-skel-step]").forEach((step) => step.classList.add("skel-step-ready"));
  }
});
