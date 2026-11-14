import { createRenderCompletionGate } from "../../shared/js/gameplay/renderCompletion.js?v=v2026-11-14T13241";

// control/js/app.js
// Punkt wejścia Control v2 — spina store/engine/devices/presence/
// soundReactor/ui. Nawigacja przedmeczowa (devices_display →
// setup_finish → r_intro → r_roundStart) jest liniowa, bez rozgałęzień,
// więc żyje tu (app-level), nie w engine.js (patrz komentarz na górze
// engine.js) — ale i tak przechodzi przez assertTransition(), żeby tabela
// stanów była mechanizmem wszędzie, nie tylko wewnątrz silnika reguł gry.

import { guardResourceLocks } from "../../shared/js/core/resource-lock.js?v=v2026-11-14T13241";
import { openDialog, closeDialog } from "../../shared/js/core/modal-sheet.js?v=v2026-11-14T13241";
import { initI18n, getUiLang, t } from "../../shared/translation/translation.js?v=v2026-11-14T13241";
import { backHref, linkTo } from "../../shared/js/core/nav-map.js?v=v2026-11-14T13241";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-14T13241";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-14T13241";
import { loadQuestions, loadAnswers, guardGameState } from "../../shared/js/core/game-validate.js?v=v2026-11-14T13241";
import { loadSfxManifest, initSfx, setCurrentGameId, unlockAudio, applySfxGameSettings, loadSfxFromCloud, playSfx, getSfxDurationAccurate as getSfxDuration, listSfx, isAnySfxPlaying, onSfxPlayback } from "../../shared/js/core/sfx.js?v=v2026-11-14T13241";
import { listGameSounds } from "../../shared/js/core/sfx-cloud.js?v=v2026-11-14T13241";
import { assertTransition } from "../../shared/js/gameplay/gameStateMachine.js?v=v2026-11-14T13241";
import { alertModal, confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-14T13241";
import { DEFAULT_SETTINGS } from "../../shared/js/gameplay/gameStateShape.js?v=v2026-11-14T13241";
import { ROUND_ANSWER_TOTAL_MS, FINAL_ANSWER_TOTAL_MS, BOARD_TRANSITION_MS, LOGO_IN_MS } from "../../shared/js/gameplay/displayTiming.js?v=v2026-11-14T13241";
import { qrDataUrl } from "../../shared/js/core/qr-code.js?v=v2026-11-14T13241";

// QR generowany lokalnie i od razu (SVG w data:), bez zewnętrznego API:
// wcześniej przez chwilę widać było samą białą ramkę <img>.
function qrImgSrc(url) {
  return qrDataUrl(String(url ?? ""), { margin: 0 });
}

// Ustawienia "advanced" zachowywane przez "Zacznij od nowa" (sekcja 3a pkt 2
// — dokładnie jak dzisiejsze resetProgress({keepAdvanced:true})).
const ADVANCED_SETTINGS_KEYS = ["roundMultipliers", "finalMinPoints", "finalTarget", "endScreenMode", "finalPrizeMultiplier", "mainPrizeAmount"];

// Denormalizacja games.settings (skonfigurowane osobno, na stronie
// game-settings, ZANIM operator w ogóle otworzy Control) do płaskiego
// game_state.detail — odpowiednik dzisiejszego control/js/app.js's
// applyGameSettingsToStore(). D3 ("setup_finish") to w nowej wersji
// wyłącznie PODSUMOWANIE tych już zapisanych ustawień (plan, tabela D3),
// nie formularz do wypełnienia — więc to musi się wykonać, zanim operator
// tam dotrze, nie jako efekt kliknięcia "Rozpocznij".
function applyTeamNamesToState(teams, state) {
  const nameA = String(teams?.teamA ?? "").trim();
  const nameB = String(teams?.teamB ?? "").trim();
  const defaultA = teams?.defaultA === true || !nameA;
  const defaultB = teams?.defaultB === true || !nameB;
  state.teams = {
    teamA: defaultA ? t("control.teamADefault") : nameA,
    teamB: defaultB ? t("control.teamBDefault") : nameB,
    defaultA, defaultB,
  };
}

function applyGameSettingsToState(settings, state) {
  if (!settings || typeof settings !== "object") return;
  const { teams, display, game, questions } = settings;

  applyTeamNamesToState(teams, state);

  if (display) {
    if (display.colors) state.display.colors = { ...state.display.colors, ...display.colors };
    if (display.theme !== undefined) state.display.theme = display.theme;
    if (display.logoId !== undefined) state.display.logoId = display.logoId;
    if (display.hostLogoMode !== undefined) state.display.hostLogoMode = display.hostLogoMode === "pixel" ? "pixel" : "source";
  }

  if (game) {
    if (game.hasFinal !== undefined && game.hasFinal !== null) state.settings.hasFinal = game.hasFinal;
    if (game.finalQuestionsMode) state.settings.finalQuestionsMode = game.finalQuestionsMode;
    if (game.roundsQuestionsMode) state.settings.roundsQuestionsMode = game.roundsQuestionsMode;
    if (game.advanced && typeof game.advanced === "object") {
      const adv = game.advanced;
      if (Array.isArray(adv.roundMultipliers) && adv.roundMultipliers.length) state.settings.roundMultipliers = adv.roundMultipliers;
      if (typeof adv.finalMinPoints === "number") state.settings.finalMinPoints = adv.finalMinPoints;
      if (typeof adv.finalTarget === "number") state.settings.finalTarget = adv.finalTarget;
      if (typeof adv.endScreenMode === "string") state.settings.endScreenMode = adv.endScreenMode;
      if (typeof adv.finalPrizeMultiplier === "number") state.settings.finalPrizeMultiplier = adv.finalPrizeMultiplier;
      if (typeof adv.mainPrizeAmount === "number") state.settings.mainPrizeAmount = adv.mainPrizeAmount;
    }
  }

  // Zdenormalizowane głośności/warianty (BEZ własnych plików — patrz
  // web/js/gameplay/gameStateShape.js's komentarz przy `sound`) — Display2 (anon)
  // czyta je stąd zamiast osobnego zapytania do games.settings, dokładnie
  // jak resztę ustawień na tym ekranie.
  if (settings.sound && typeof settings.sound === "object") {
    state.settings.sound = {
      volumes: { ...(settings.sound.volumes || {}) },
      variants: { ...(settings.sound.variants || {}) },
    };
  }

  if (questions) {
    // Tak jak w starym applyGameSettingsToStore: tylko gdy finał faktycznie
    // włączony — inaczej martwa lista pytań finałowych niepotrzebnie
    // wykluczyłaby te pytania z puli rund (pickQuestionPool niżej).
    if (game?.hasFinal === true && Array.isArray(questions.final) && questions.final.length > 0) {
      const ids = questions.final.map((q) => q.id).filter(Boolean);
      if (ids.length > 0) {
        state.final.picked = ids.slice(0, 5);
        state.final.pickedPreview = questions.final.slice(0, 5)
          .filter((q) => q?.id && q?.text)
          .map((q) => ({ id: q.id, text: q.text }));
        state.final.confirmed = true;
      }
    }
    if (Array.isArray(questions.rounds) && questions.rounds.length > 0) {
      state.settings.roundsPicked = questions.rounds.slice();
    }
  }
}

import { createStore } from "./store.js?v=v2026-11-14T13241";
import { createRuntimeSession } from "./runtimeSession.js?v=v2026-11-14T13241";
import { createEngine } from "./engine.js?v=v2026-11-14T13241";
import { createActionGate } from "./actionGate.js?v=v2026-11-14T13241";
import { createDevices } from "./devices.js?v=v2026-11-14T13241";
import { createPresence } from "./presence.js?v=v2026-11-14T13241";
import { missingDevices, blockingDevices, absenceCause } from "./deviceGate.js?v=v2026-11-14T13241";
import { createSessionTelemetry } from "./sessionTelemetry.js?v=v2026-11-14T13241";
import { createConnectivityIncidentTracker } from "./diagnostics.js?v=v2026-11-14T13241";
import { compareBrowserContexts, getGameBrowserContextId } from "../../shared/js/core/device-context.js?v=v2026-11-14T13241";
import { createSoundReactor } from "./soundReactor.js?v=v2026-11-14T13241";
import { createControlTestMode, currentControlGeometry } from "./testMode.js?v=v2026-11-14T13241";
import { createUI } from "./ui.js?v=v2026-11-14T13241";
import { createShareDevice } from "./shareDevice.js?v=v2026-11-14T13241";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-14T13241";
import { toast } from "../../shared/js/core/toast.js?v=v2026-11-14T13241";

async function pickQuestionPool(state) {
  const all = await loadQuestions(state.gameId);
  const finalPicked = new Set((state.final.picked || []).map(String));
  let pool = finalPicked.size ? all.filter((q) => !finalPicked.has(String(q.id))) : all.slice();

  // Realny bug znaleziony przez failed nagranie (przebieg z 2026-09-26,
  // diagnostyka dumpFailureDiagnostics(): przycisk R8 pokazywał "Przejdź do
  // następnej rundy" zamiast oczekiwanego "Przejdź do zakończenia gry" po
  // rundzie, która miała być OSTATNIĄ wg wybranej ręcznie puli 2 pytań).
  // Plan (tabela A, R1) i komentarz w control/js/engine.js's
  // previewRoundEndDestination() są tu jednoznaczne: "pick" = KOLEJNOŚĆ Z
  // roundsPicked, nie "roundsPicked, a potem reszta jako dolewka". Ta
  // funkcja doklejała [...ordered, ...WSZYSTKO_INNE] -- więc pula w trybie
  // "pick" nigdy realnie się nie wyczerpywała po wybranych pytaniach, tylko
  // ciągnęła dalej z reszty bazy pytań gry, co silnik (engine.js's
  // previewRoundEndDestination -- `!state.rounds._questionPool.length`)
  // błędnie odczytywał jako "jest jeszcze kolejna runda". Pula w trybie
  // "pick" ma kończyć się DOKŁADNIE na wybranych pytaniach -- wyczerpanie
  // jest tu prawidłowym, oczekiwanym skutkiem (R9③ w planie), nie
  // przypadkiem do "naprawienia" przez dolewanie czegokolwiek więcej.
  if (state.settings.roundsQuestionsMode === "pick" && state.settings.roundsPicked?.length) {
    const byId = new Map(pool.map((q) => [String(q.id), q]));
    return state.settings.roundsPicked.map((p) => byId.get(String(p.id))).filter(Boolean);
  }

  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

// Losowanie finału wybiera 5 pytań z puli rund i zwraca pozostałą pulę.
// Używane przy pierwszym wejściu w Podsumowanie i przy ponownym losowaniu.
// Zwraca też "pickedPreview" (id+tekst) —
// samo `picked` to tylko ID, za mało żeby operator zobaczył CO wylosowano
// w Podsumowaniu, zanim finał się realnie zacznie.
async function drawFinalPicks(state, roundPool) {
  const shuffled = roundPool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const picks = shuffled.slice(0, 5);
  const pickedIds = new Set(picks.map((q) => String(q.id)));
  return {
    picked: picks.map((q) => q.id),
    pickedPreview: picks.map((q) => ({ id: q.id, text: q.text })),
    roundsPool: roundPool.filter((q) => !pickedIds.has(String(q.id))),
  };
}

async function main() {
  // Wyjście z Control: przed „Wstecz” sprawdzenie rozgrywki; podmieniane po
  // utworzeniu store (do tego czasu wyjście jest swobodne).
  let beforeLeave = async () => true;
  let runtimeSession = null;
  let sessionTelemetry = null;
  let isGameInProgress = () => false;
  const manualNavigationKey = "fam:control:manual-navigation";
  let testModePanel = null;
  let testModeChanging = false;
  const i18nP = initI18n({ withSwitcher: true });
  const params = new URLSearchParams(location.search);
  const gameId = params.get("id");
  // Blokady strony (guardResourceLocks): zwalniane przed przejściem do
  // instrukcji / ustawień gry, żeby tamta strona mogła je od razu zająć.
  let pageLock = null;
  async function leaveTo(href) {
    await pageLock?.release?.().catch(() => {});
    location.href = href;
  }
  // initPage: dostęp, nakładka wąskiego okna / telefonu, „Wstecz”, „Wskazówki”
  // (zwykłe przejście na /manual/ z ret = Control) i konto wg mapy. Stan gry
  // jest w bazie, więc po powrocie store.hydrate() wznawia rozgrywkę.
  const userP = initPage("control", {
    ready: i18nP,
    deviceGuard: {
      fits: () => currentControlGeometry().fits,
      fitsAfterRotate: () => currentControlGeometry(false, { width: innerHeight, height: innerWidth }).fits,
      messageKey: "control.panelTooSmall",
    },
    onBack: async (href) => {
      if (!(await beforeLeave())) return;
      location.href = href;
    },
    onManual: async (href) => {
      if (isGameInProgress()) {
        const navigationId = crypto.randomUUID();
        sessionStorage.setItem(manualNavigationKey, JSON.stringify({ gameId, navigationId, at: Date.now() }));
        sessionTelemetry?.logEvent({
          event_type: "page_lifecycle", phase: "manual_open", target: "manual", navigation_id: navigationId,
        });
      }
      await leaveTo(href);
    },
  });
  await i18nP;

  const root = document.getElementById("app");

  const user = await userP;
  if (!user) return; // initPage przekierował na logowanie
  document.getElementById("btnFriends")?.addEventListener("click", async (event) => {
    if (event.currentTarget.disabled) return;
    if (!(await beforeLeave())) return;
    await leaveTo(linkTo("friends"));
  });

  if (!gameId) { root.textContent = "Brak parametru ?id= w URL."; return; }

  // Manifest nie zależy od gry ani sesji Control. Pobierz go równolegle z
  // pierwszym odczytem gry, zamiast dodawać osobną rundę sieciową przed UI.
  // Błąd przechowujemy jako wartość, żeby przedwczesny powrót (np. brak gry)
  // nie zostawił odrzuconego Promise bez obsługi.
  const sfxManifestP = loadSfxManifest().then(
    (manifest) => ({ manifest }),
    (error) => ({ error }),
  );

  // Odczyt gry i blokady zasobów nie zależą od siebie — biegną równolegle.
  const gameP = sb().from("games").select("*").eq("id", gameId).single();
  // Blokady strony (familijna-server/docs/blokady-zasobow.md, sekcja 6): game:G wyłącznie (wspólny
  // klucz z edytorem, ustawieniami i ankietą) + logos współdzielone (cała pula
  // logo użytkownika; id = użytkownik). Kolejność: najpierw gra, potem pula logo
  // — pierwsza przeszkoda zatrzymuje ze swoim komunikatem. Edycja któregokolwiek
  // logo (logo:L wyłącznie) wyklucza logos, więc zatrzymuje Control.
  const lockP = guardResourceLocks([
    { type: "game", id: gameId, mode: "exclusive", message: t("resourceLock.gameMessage") },
    // Reuse the already authenticated owner. A second auth.getUser() here
    // could transiently return null and silently omit the logo-pool lock.
    { type: "logos", id: user.id, mode: "shared", message: t("resourceLock.logoEditBlocksControl") },
  ], { context: "control", backHref: backHref("control") });
  const { data: game, error: gameError } = await gameP;
  if (gameError || !game) {
    void lockP.then((acquired) => acquired?.ok && acquired.release?.()).catch(() => {});
    root.textContent = "Nie znaleziono gry.";
    return;
  }
  const lock = await lockP;
  if (!lock.ok) return;
  pageLock = lock;

  // Blokada stanu: gra, która nie nadaje się do rozgrywki (np. ankieta
  // otwarta, za mało pytań), blokuje Control w całości.
  if (!(await guardGameState(gameId, "play"))) return;

  runtimeSession = createRuntimeSession({
    gameId,
    onExpired: () => {
      runtimeSession?.stop();
      location.reload();
    },
  });
  let runtimeSessionResult;
  try {
    runtimeSessionResult = await runtimeSession.start();
  } catch (error) {
    root.textContent = error?.message || t("control.errors.sessionStart");
    return;
  }
  if (!runtimeSessionResult?.ok) {
    root.textContent = runtimeSessionResult?.error || t("control.errors.sessionStart");
    return;
  }
  if (runtimeSessionResult.expired) return;

  // Linki i kody urządzeń wymagają tylko aktywnej sesji Control. Pobierz je
  // równolegle z odczytem stanu gry zamiast po nim.
  const devices = createDevices({ game });
  const urlsP = devices.buildUrls(getUiLang());
  const connectCodesP = urlsP.then(() => Promise.all(
    ["display", "host", "buzzer"].map(async (kind) => [
      kind,
      await devices.generateConnectCode(kind).catch(() => null),
    ]),
  )).then(Object.fromEntries);
  connectCodesP.catch(() => {});

  const sfxManifestResult = await sfxManifestP;
  if (sfxManifestResult.error) throw sfxManifestResult.error;

  setCurrentGameId(gameId);
  // Odczyt własnych plików z IndexedDB nie zależy od game_state; uruchom go
  // teraz, a poczekaj równolegle z hydrate() poniżej.
  const sfxInitP = initSfx();

  // Głośności/warianty dźwięku skonfigurowane w game-settings (poza
  // Control) — dokładnie jak dzisiejsze control/js/app.js's main().
  applySfxGameSettings(game.settings?.sound || {});
  if (game.settings?.sound) {
    const customKeys = Object.entries(game.settings.sound.variants || {})
      .filter(([, v]) => v === "__custom__")
      .map(([k]) => k);
    if (customKeys.length > 0) {
      (async () => {
        try {
          // Zalogowany właściciel z initPage — bez zapytania do serwera logowania.
          if (user?.id) {
            const urlMap = await listGameSounds(sb(), user.id, gameId, customKeys);
            if (urlMap.size > 0) loadSfxFromCloud(urlMap);
          }
        } catch (e) { console.warn("[control2] wczytanie własnych dźwięków nie powiodło się:", e); }
      })();
    }
  }

  // Prepare audio lengths while the operator connects devices.
  void Promise.all(listSfx().map(getSfxDuration));
  const store = createStore(gameId);
  const [expiredTimer] = await Promise.all([store.hydrate(), sfxInitP]);
  isGameInProgress = () => !!store.state.locks.gameStarted && !store.state.locks.gameEnded;
  sessionTelemetry = createSessionTelemetry(gameId, () => store.state, store.subscribe);
  try {
    const navigation = JSON.parse(sessionStorage.getItem(manualNavigationKey) || "null");
    if (navigation?.gameId === gameId && typeof navigation.navigationId === "string") {
      sessionTelemetry.logEvent({
        event_type: "page_lifecycle", phase: "manual_return", source: "manual",
        navigation_id: navigation.navigationId,
        duration_ms: Math.max(0, Date.now() - Number(navigation.at || Date.now())),
      });
    }
  } catch { /* Uszkodzony znacznik nawigacji nie może zatrzymać Control. */ }
  sessionStorage.removeItem(manualNavigationKey);
  const realtimeStates = new Map();
  // Wyjście z Control (ustawienia, zamknięcie karty) przerywa zapytania
  // i kanały; to nie jest awaria, więc nie trafia do statystyk. Okno 3 s,
  // bo anulowane beforeunload zostawia operatora na stronie.
  let pageLeavingAt = 0;
  const notePageLeaving = () => { pageLeavingAt = Date.now(); };
  window.addEventListener("beforeunload", notePageLeaving);
  window.addEventListener("pagehide", notePageLeaving);
  const pageLeaving = () => Date.now() - pageLeavingAt < 3000;
  function observeRealtimeState(channel, rawStatus) {
    const state = rawStatus === "SUBSCRIBED" ? "connected" : "disconnected";
    const previous = realtimeStates.get(channel);
    const snapshot = { state, rawStatus, reportedForGame: !!store.state.locks.gameStarted };
    realtimeStates.set(channel, snapshot);
    if (store.state.locks.gameStarted && previous?.state !== state && !pageLeaving()) {
      void sessionTelemetry.report({
        kind: "diagnostic", category: "realtime",
        message: `Kanał Realtime ${channel} ${state === "connected" ? "połączony" : "rozłączony"}.`,
        devices: ["control", "display"],
        metrics: { channel, state, raw_status: rawStatus, fallback: state !== "connected", phase: previous ? "status_change" : "game_start" },
      });
    }
  }
  function reportRealtimeSnapshots() {
    if (!store.state.locks.gameStarted) return;
    for (const [channel, snapshot] of realtimeStates) {
      if (snapshot.reportedForGame) continue;
      snapshot.reportedForGame = true;
      void sessionTelemetry.report({
        kind: "diagnostic", category: "realtime",
        message: `Stan kanału Realtime ${channel} przy starcie gry: ${snapshot.state}.`,
        devices: ["control", "display"],
        metrics: { channel, state: snapshot.state, raw_status: snapshot.rawStatus, fallback: snapshot.state !== "connected", phase: "game_start" },
      });
    }
  }

  // Tylko przed startem gry (D0-D3) — po "Rozpocznij" te pola żyją już
  // wyłącznie w game_state i nie mają być nadpisywane przy każdym
  // wznowieniu Control w trakcie rozgrywki (patrz komentarz przy funkcji).
  if (!store.state.locks.gameStarted) {
    applyGameSettingsToState(game.settings, store.state);
    applyTeamNamesToState(store.state.teams, store.state);
    await store.commit();
  } else if (!store.state.teams.teamA?.trim() || !store.state.teams.teamB?.trim()) {
    // Wznowienie rozpoczętej gry z pustymi domyślnymi nazwami.
    applyTeamNamesToState(store.state.teams, store.state);
    await store.commit();
  }

  // Język urządzeń (Display/Host/Buzzer) idzie za językiem operatora w
  // Control — dokładnie jak dzisiejsze control/js/app.js's LANG-push na
  // starcie i przy każdej zmianie, tylko teraz przez zwykły zapis do
  // game_state zamiast broadcastu komend (urządzenia go stamtąd czytają,
  // patrz *2/js/main.js). Nieograniczone do fazy przedmeczowej — operator
  // może przełączyć język w dowolnym momencie rozgrywki.
  if (store.state.settings.uiLang !== getUiLang()) {
    await store.setUiLang(getUiLang());
  }
  window.addEventListener("i18n:lang", async (event) => {
    const nextLang = event?.detail?.lang;
    if (!nextLang || store.state.settings.uiLang === nextLang) return;
    // Migracja 267: osobne, lekkie RPC (jsonb_set WYŁĄCZNIE na
    // detail.settings.uiLang) — świadomie z pominięciem store.commit()/
    // locked_until (migracja 264). Zgłoszone: język operatora jest metadaną
    // niezależną od reszty rozgrywki, nie ma czekać w kolejce na koniec
    // dźwięku/animacji trwającej akcji gry (wcześniejsza wersja tego
    // listenera właśnie tak robiła i w 100% deterministyczny sposób gubiła
    // zmianę, gdy trafiła w to okno — patrz historia commitów).
    await store.setUiLang(nextLang);
  });

  const engine = createEngine({
    store,
    loadQuestionPool: () => pickQuestionPool(store.state),
    loadQuestions,
    loadAnswers,
    now: Date.now,
    computeCommitGate: (...args) => actionGate.computeGateMs(...args),
  });
  const actionGate = createActionGate({ getSfxDuration });

  // JEDEN silnik blokady operatora względem dźwięku/animacji (zgłoszone:
  // "blokowanie akcji względem dźwięku animacji... wszędzie" — patrz
  // actionGate.js's komentarz na górze). Dwie fazy, obie odzwierciedlone w
  // tym samym `busy()`, czytanym przez KAŻDY kafel w ui.js (ctx.busy w
  // render()), zamiast osobnego, ręcznie uzbrajanego zegarka na każdy
  // przycisk:
  //  1. `committing` — true od kliknięcia do potwierdzonego zapisu (czas
  //     sieci, nieznany z góry — bez sztucznego "floora", po prostu czekamy
  //     na prawdziwą odpowiedź).
  //  2. `lockedUntil` — po potwierdzeniu, na czas REALNEGO dźwięku
  //     (actionGate.computeGateMs(), policzony z POTWIERDZONEGO
  //     sound_cue_key, nie zgadywany z wyprzedzeniem).
  let committing = false;
  let queuedGameAction = false;
  let presenceFlags = {};
  // Odblokowanie dźwięku głównej instancji Wyświetlacza z migawki
  // `control_devices_snapshot` (migracja 397). Nowa instancja (przeładowanie,
  // podmiana) zaczyna od false, więc Control nie musi o nie prosić.
  let displayAudioUnlocked = null;
  let controlOffline = !navigator.onLine;
  let controlUIReady = false;
  let presenceUnavailable = false;
  let presenceFailureStartedAt = null;
  let presenceFailureSource = null;
  // renderCurrent can run from early async callbacks before the timer-watch
  // factories below are initialized. Keep those calls safe during bootstrap.
  let scheduleFinalTimerWatch = () => {};
  let scheduleTimer3Watch = () => {};
  let disconnectEpisode = false;
  let lastDisconnectState = "";
  let deviceLostModal = null; // uchwyt okna „Utracono połączenie” (alertModal: setText, close)
  const browserContextId = getGameBrowserContextId(gameId);
  let lastDisplayAudioDiagnosticId = null;
  let hasInitialPresenceSnapshot = false;
  function summarizedDeviceContext(deviceDiagnostics, kind) {
    const item = deviceDiagnostics?.[kind];
    return {
      profile: compareBrowserContexts(browserContextId, item?.browserContextId),
      visibility: item?.visibility || "unknown",
      focused: item?.focused ?? null,
      stale_ms: Number.isFinite(item?.ageMs) ? item.ageMs : null,
      visibility_change_ms_ago: Number.isFinite(item?.visibilityChangedAt)
        ? Math.max(0, Date.now() - item.visibilityChangedAt) : null,
    };
  }
  const connectivityTracker = createConnectivityIncidentTracker({
    onIncident: ({ devices, ...metrics }) => void sessionTelemetry.report({
      kind: "diagnostic", category: "connectivity",
      message: "Utrata obecności urządzeń podczas gry.",
      devices,
      metrics,
    }),
  });
  // Wyłączone przyciski nie wywołują akcji, więc bez tego statystyki
  // zawsze pokazywały 0 prób w czasie blokady. pointerdown (przechwytywany
  // na dokumencie) dochodzi także przy wyłączonym przycisku.
  document.addEventListener("pointerdown", (event) => {
    const button = event.target?.closest?.("button");
    if (!button?.disabled || !button.closest("#app")) return;
    if (blockingDevices(store.state, presenceFlags).length) noteConnectivityBlockedAction("disabled_click");
    else if (waitingForDisplayAudioUnlock()) noteAudioUnlockBlockedAction();
  }, { capture: true });
  function noteConnectivityBlockedAction(action) {
    connectivityTracker.noteBlockedAction(action, blockingDevices(store.state, presenceFlags));
  }
  function updateConnectivityIncident(missing, deviceDiagnostics, wasOnline) {
    connectivityTracker.update(missing, Object.fromEntries(missing.map(kind => [kind, summarizedDeviceContext(deviceDiagnostics, kind)])), wasOnline);
  }
  let restarting = false;
  let dispatchGeneration = 0;
  let lockedUntil = Number.isFinite(Date.parse(store.state.__row?.locked_until || ""))
    ? Date.parse(store.state.__row.locked_until) : 0;
  const displayCompletion = createRenderCompletionGate(store.state.rev);
  // Wznowienie strony nie jest nową zmianą planszy. W szczególności Buzzer
  // może podnieść rev samym lastPressed, którego Wyświetlacz nie renderuje;
  // traktowanie tego zapisanego stanu jako oczekującego potwierdzenia
  // blokowało Control po odświeżeniu na etapie pojedynku.
  displayCompletion.acknowledge(store.state.rev);
  const displayCompletionTimes = new Map();
  let previousDisplayRow = store.state.__row || null;
  let lastDisplayCueSeq = store.state.__row?.sound_cue_seq;
  let lastDisplayStep = store.state.step;
  // Dźwięk wyznacza start animacji, a jej długość stałe z displayTiming.js
  // (Wyświetlacz liczy z tych samych) — oczekiwany czas to dłuższe z obu.
  async function expectedDisplayTransitionMs(previous, row) {
    const key = row?.sound_cue_key;
    if (!key) return null;
    const timing = actionGate.timing;
    const afterReveal = async (otherKey, animMs) => Math.max(
      await timing.syncedMs(otherKey, "reveal"),
      (await timing.revealSyncSplit(otherKey)).offsetMs + animMs);
    const boardMs = BOARD_TRANSITION_MS;
    if (key === "round_transition") return afterReveal("round_transition", boardMs);
    if (key === "show_intro") return afterReveal("show_intro", LOGO_IN_MS);
    if (key === "final_theme" && previous?.step === "f_start" && row.step === "f_p1_entry") {
      return (await timing.dur("final_theme")) + await afterReveal("round_transition", boardMs);
    }
    if (key === "final_theme" && row.step === "f_end") return afterReveal("final_theme", boardMs);
    const answerMs = row.top_card === "final" ? FINAL_ANSWER_TOTAL_MS : ROUND_ANSWER_TOTAL_MS;
    return Math.max(await timing.dur(key), answerMs);
  }
  function evaluateDisplayCompletion(revision, item) {
    if (item.timedOut && !item.lateReported && item.completedAt != null) {
      // Po ack_timeout dopisujemy, ile realnie trwała blokada Control.
      item.lateReported = true;
      void sessionTelemetry.report({
        kind: "diagnostic", category: "display_delay",
        message: "Display potwierdził planszę dopiero po przekroczeniu czasu.",
        devices: ["display"],
        metrics: {
          revision, sound: item.sound, reason: "late_ack",
          expected_ms: Math.round(item.expectedMs),
          actual_ms: Math.max(0, Math.round(item.completedAt - item.requestedAt)),
          ack_source: item.ackSource || null,
          display_ack_ms: item.displayAckMs ?? null,
          display_visibility: lastDeviceDiagnostics?.display?.visibility || null,
        },
      });
      return;
    }
    if (item.reported || item.completedAt == null || item.expectedMs == null) return;
    item.reported = true;
    if (item.timeoutTimer) clearTimeout(item.timeoutTimer);
    const actualMs = Math.max(0, Math.round(item.completedAt - item.requestedAt));
    const extraMs = actualMs - item.expectedMs;
    if (extraMs <= 1500) return;
    void sessionTelemetry.report({
      kind: "diagnostic", category: "display_delay",
      message: "Display potwierdził zmianę planszy z opóźnieniem.",
      devices: ["display"],
      metrics: {
        revision, sound: item.sound, expected_ms: Math.round(item.expectedMs),
        actual_ms: actualMs, extra_ms: Math.round(extraMs),
        ack_source: item.ackSource || null,
        display_ack_ms: item.displayAckMs ?? null,
        completion_realtime_connected: completionRealtimeConnected,
        control_visibility: item.controlVisibility,
        control_focused: item.controlFocused,
      },
    });
  }
  function reportDisplayCompletionTimeout(revision, item) {
    if (item.reported || item.completedAt != null || item.expectedMs == null) return;
    item.reported = true;
    item.timedOut = true;
    const lowerBoundMs = Math.round(performance.now() - item.requestedAt);
    void sessionTelemetry.report({
      kind: "diagnostic", category: "display_delay",
      message: "Display nie potwierdził ukończenia planszy w oczekiwanym czasie.",
      devices: ["display"],
      metrics: { revision, sound: item.sound, reason: "ack_timeout", ack_read_error: !!item.ackReadError, completion_realtime_connected: completionRealtimeConnected, wait_ms: lowerBoundMs, expected_ms: Math.round(item.expectedMs), control_visibility: document.visibilityState || "unknown", request_visibility: item.controlVisibility, control_focused: item.controlFocused, display_visibility: lastDeviceDiagnostics?.display?.visibility || null },
    });
  }
  function reportDisplayCompletionReadError(revision, item, error) {
    if (completionReadIncident) return;
    completionReadIncident = { at: performance.now(), revision, sound: item.sound };
    for (const pending of displayCompletionTimes.values()) pending.ackReadError = true;
    void sessionTelemetry.report({
      kind: "diagnostic", category: "display_delay",
      message: "Control nie może odczytać potwierdzenia renderowania Wyświetlacza.",
      devices: ["control", "display"],
      metrics: {
        revision, sound: item.sound, reason: "ack_read_error",
        error_code: String(error?.code || error?.name || "read_error").slice(0, 80),
        control_visibility: document.visibilityState || "unknown",
        control_focused: !!document.hasFocus?.(),
      },
    });
  }
  function recoverDisplayCompletionRead() {
    if (!completionReadIncident) return;
    const incident = completionReadIncident;
    completionReadIncident = null;
    void sessionTelemetry.report({
      kind: "diagnostic", category: "display_delay",
      message: "Odczyt potwierdzenia renderowania Wyświetlacza wrócił.",
      devices: ["control", "display"],
      metrics: { revision: incident.revision, reason: "ack_read_recovered", duration_ms: Math.round(performance.now() - incident.at) },
    });
  }
  function noteDisplayRequest() {
    const row = store.state.__row;
    if (row && (row.step !== lastDisplayStep || row.sound_cue_seq !== lastDisplayCueSeq)) {
      const priorRow = previousDisplayRow;
      displayCompletion.request(row.rev);
      // Wiersz optymistyczny (store.js) ma jeszcze poprzednią rewizję; pomiar
      // liczy od tej, którą nada serwer — inaczej spóźnione potwierdzenie
      // poprzedniej planszy zamykało pomiar nowej, a display_ack_ms nie
      // znajdował żądania (eksport 25.10).
      const targetRev = Number.isSafeInteger(row.__target_rev) ? row.__target_rev : row.rev;
      const item = { requestedAt: performance.now(), completedAt: null, expectedMs: null, sound: row.sound_cue_key || null, step: row.step, soundCueSeq: row.sound_cue_seq, previousStep: lastDisplayStep, controlVisibility: document.visibilityState || "unknown", controlFocused: !!document.hasFocus?.(), reported: false };
      displayCompletionTimes.set(targetRev, item);
      void expectedDisplayTransitionMs(priorRow, row).then(expectedMs => {
        item.expectedMs = expectedMs;
        evaluateDisplayCompletion(targetRev, item);
        if (expectedMs != null && !item.reported) {
          item.timeoutTimer = setTimeout(() => reportDisplayCompletionTimeout(targetRev, item), Math.max(0, expectedMs + 1500));
        }
      });
      while (displayCompletionTimes.size > 40) displayCompletionTimes.delete(displayCompletionTimes.keys().next().value);
      lastDisplayStep = row.step;
      lastDisplayCueSeq = row.sound_cue_seq;
    }
    if (row) previousDisplayRow = row;
  }
  // Wyświetlacz otwarty w tej samej przeglądarce i schowany (inna karta lub
  // okno na wierzchu). Tryb testowy pokazuje go w ramce tej strony — pomijamy.
  function displayHiddenSameBrowser() {
    const display = lastDeviceDiagnostics?.display;
    return !store.state.settings.testMode && presenceFlags.display === true
      && display?.visibility === "hidden"
      && compareBrowserContexts(browserContextId, display?.browserContextId) === "same_profile";
  }
  function waitingForDisplay() {
    return !/^(devices_|setup_)/.test(store.state.step) && displayCompletion.pending;
  }
  function waitingForDisplayAudioUnlock() {
    return store.state.settings.soundSource === "display"
      && !/^(devices_|setup_)/.test(store.state.step)
      && !store.state.locks.gameEnded
      && presenceFlags.display === true
      && displayAudioUnlocked !== true;
  }
  // Każde czekanie na gest na Wyświetlaczu trafia do statystyk jednym
  // zdarzeniem audio_unlock: powód (nowa instancja / przeglądarka wstrzymała
  // dźwięk), czas blokady, wynik i próby akcji operatora w tym czasie.
  let audioUnlockWait = null;
  let lastDeviceDiagnostics = null;
  function noteAudioUnlockBlockedAction() {
    if (audioUnlockWait) audioUnlockWait.blockedActions += 1;
  }
  function syncAudioUnlockWait() {
    const waiting = waitingForDisplayAudioUnlock();
    if (waiting && !audioUnlockWait) {
      const display = lastDeviceDiagnostics?.display;
      audioUnlockWait = {
        startedAt: Date.now(),
        reason: display?.audioLockReason || "new_instance",
        detail: display?.audioLockDetail || null,
        visibility: display?.visibility || null,
        step: store.state.step,
        blockedActions: 0,
      };
      return;
    }
    if (waiting || !audioUnlockWait) return;
    const wait = audioUnlockWait;
    audioUnlockWait = null;
    const outcome = displayAudioUnlocked === true ? "unlocked"
      : presenceFlags.display !== true ? "display_offline"
      : store.state.locks.gameEnded ? "game_ended"
      : "not_required";
    void sessionTelemetry.report({
      kind: "diagnostic", category: "audio_unlock",
      message: "Control czekał na odblokowanie dźwięku na Wyświetlaczu.",
      devices: ["display"],
      metrics: {
        reason: wait.reason,
        detail: wait.detail,
        outcome,
        wait_ms: Math.max(0, Date.now() - wait.startedAt),
        blocked_action_attempts: wait.blockedActions,
        display_visibility: wait.visibility,
        step: wait.step,
      },
    });
  }
  function onControlReconnect() {
    controlOffline = false;
    renderCurrent();
  }
  window.addEventListener("offline", () => {
    controlOffline = true;
    renderCurrent();
  });
  window.addEventListener("online", onControlReconnect);
  let completionUIReady = false;
  let completionReadPending = false;
  let completionRealtimeConnected = false;
  let latestDisplayCompletion = null;
  let completionReadIncident = null;
  // Czas od żądania zmiany planszy do zapisu potwierdzenia przez
  // Wyświetlacz, liczony zegarem serwera (483: requested_at/rendered_at).
  // Odróżnia spóźniony Wyświetlacz od potwierdzenia zgubionego w drodze.
  function displayAckMs(row, requestedRev) {
    if (!row || Number(row.requested_rev) !== requestedRev) return null;
    const ms = Date.parse(row.rendered_at || "") - Date.parse(row.requested_at || "");
    return Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : null;
  }
  function applyDisplayCompletion(row, source = "realtime") {
    const renderedRev = Number(row?.rendered_rev);
    const requestedRev = Number(row?.requested_rev);
    if (Number.isFinite(renderedRev) && Number.isFinite(requestedRev)) {
      latestDisplayCompletion = { rendered_rev: renderedRev, requested_rev: requestedRev };
    }
    if (!Number.isFinite(renderedRev) || !displayCompletion.acknowledge(renderedRev)) return;
    const completedAt = performance.now();
    for (const [requestedRev, item] of displayCompletionTimes) {
      if (requestedRev <= renderedRev && item.completedAt == null) {
        item.completedAt = completedAt;
        if (item.timeoutTimer) clearTimeout(item.timeoutTimer);
        item.ackSource = source;
        item.displayAckMs = displayAckMs(row, requestedRev);
        evaluateDisplayCompletion(requestedRev, item);
      }
    }
    for (const requestedRev of displayCompletionTimes.keys()) {
      if (requestedRev <= renderedRev) displayCompletionTimes.delete(requestedRev);
    }
    renderCurrent();
  }
  async function refreshDisplayCompletion({ force = false } = {}) {
    if (!completionUIReady || completionReadPending || (!force && !waitingForDisplay())) return;
    completionReadPending = true;
    try {
      const { data, error } = await sb().from("game_state_display_completion").select("rendered_rev, requested_rev, rendered_at, requested_at").eq("game_id", gameId).maybeSingle().abortSignal(AbortSignal.timeout(6500));
      if (error) {
        for (const [revision, item] of displayCompletionTimes) reportDisplayCompletionReadError(revision, item, error);
        return;
      }
      if (data) { recoverDisplayCompletionRead(); applyDisplayCompletion(data, "resync_read"); }
    } catch (error) {
      for (const [revision, item] of displayCompletionTimes) reportDisplayCompletionReadError(revision, item, error);
    } finally { completionReadPending = false; }
  }
  function refreshPendingDisplayCompletionOnResume() {
    if (document.visibilityState === "hidden") return;
    // Powrót karty: wiadomości z czasu w tle mogły przepaść — jeden odczyt
    // potwierdzenia z bazy.
    void refreshDisplayCompletion();
  }
  document.addEventListener("visibilitychange", refreshPendingDisplayCompletionOnResume);
  window.addEventListener("pageshow", refreshPendingDisplayCompletionOnResume);
  window.addEventListener("focus", refreshPendingDisplayCompletionOnResume);
  function soundBusy() { return isAnySfxPlaying(); }
  let lastSoundBusy = false;
  setInterval(() => {
    const current = soundBusy();
    if (current !== lastSoundBusy) { lastSoundBusy = current; if (completionUIReady) renderCurrent(); }
  }, 125);
  // Dźwięk odsłuchiwany w Podsumowaniu jest podglądem, nie dźwiękiem akcji
  // gry. Nie może blokować przejścia do rozgrywki; UI zatrzymuje go przy
  // wyjściu z Podsumowania. Poza tym krokiem aktywne SFX nadal blokują akcje.
  function presenceReadBlocksGame() { return presenceUnavailable && store.state.locks.gameStarted && !store.state.locks.gameEnded; }
  function busy() { return testModePanel?.blocked() || controlOffline || presenceReadBlocksGame() || waitingForDisplayAudioUnlock() || queuedGameAction || (soundBusy() && store.state.step !== "setup_finish") || committing || waitingForDisplay() || Date.now() < lockedUntil || blockingDevices(store.state, presenceFlags).length > 0; }

  function recoverLeaseStatusRead() {
    if (!presenceUnavailable) return false;
    void sessionTelemetry.report({
      kind: "diagnostic", category: "connectivity",
      message: "Control odzyskał odczyt statusu urządzeń.",
      devices: ["control"],
      metrics: {
        phase: "recovered", source: presenceFailureSource,
        duration_ms: presenceFailureStartedAt == null ? null : Math.max(0, Date.now() - presenceFailureStartedAt),
      },
    });
    presenceFailureStartedAt = null;
    presenceFailureSource = null;
    presenceUnavailable = false;
    return true;
  }

  // Uzbraja klienckie `lockedUntil` na czas `ms` (potwierdzonego dźwięku/
  // animacji). Blokada w bazie (migracja 264) powstaje w tym samym zapisie
  // (game_state_write, p_lock_ms — engine.js's computeCommitGate i advance()),
  // a armLock() jest wołane dopiero po jego potwierdzeniu, więc
  // `Date.now() + ms` tutaj nigdy nie wypada przed serwerowym `locked_until`.
  // Wcześniej osobne store.setLock(ms) dokładało drugą podróż do serwera,
  // przez którą Control trzymał przyciski, i drugą
  // zmianę wiersza rozsyłaną do wszystkich urządzeń (eksport 25.10).
  function armLock(ms, generation = dispatchGeneration) {
    if (ms <= 0 || restarting || generation !== dispatchGeneration) return;
    lockedUntil = Math.max(lockedUntil, Date.now() + ms);
    setTimeout(renderCurrent, ms + 20);
  }

  // JEDYNE miejsce, które w ogóle woła engine.dispatch() — wywoływane zarówno
  // z operatorskich kliknięć (handle()'s "game.dispatch" niżej) jak i z
  // automatycznych, niezwiązanych z żadnym kliknięciem wygaśnięć zegarków
  // (makeTimerWatch niżej — EXPIRE_TIMER/EXPIRE_TIMER3) — oba źródła mają
  // dostawać DOKŁADNIE tę samą blokadę, inaczej auto-pudło z 3s zegarka
  // zostawiałoby okno bez ochrony, którego ręczne ADD_X już nie ma.
  async function dispatchGatedNow(action) {
    if (testModePanel?.blocked() && !action.type.startsWith("EXPIRE_")) return null;
    if (controlOffline) return null;
    if (waitingForDisplayAudioUnlock()) {
      if (!action.type.startsWith("EXPIRE_")) noteAudioUnlockBlockedAction();
      return null;
    }
    // Expiration records real elapsed time even while an endpoint is absent.
    // Queued operator actions are rechecked when they actually execute.
    if (!action.type.startsWith("EXPIRE_") && (presenceReadBlocksGame() || blockingDevices(store.state, presenceFlags).length)) return null;
    if (waitingForDisplay() && !action.type.startsWith("EXPIRE_")) return null;
    const prevRow = store.state.__row || null;
    committing = true;
    typingCommit = action.type === "SET_ENTRY_TEXT";
    let nextRow = null;
    // START_ROUND ma dodatkową blokadę po stronie bazy, gdy Wyświetlacz
    // kończy animację poprzedniej rundy. Sprawdź ten sam trwały znacznik
    // przed zapisem, żeby kliknięcie nie trafiało w wyścig z potwierdzeniem.
    async function waitForDisplayRender() {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        if (controlOffline || presenceFlags.display === false) return false;
        // Potwierdzenie z kanału Control (zdarzenie completion, 510).
        const latest = latestDisplayCompletion;
        if (latest && latest.rendered_rev >= latest.requested_rev) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    }
    // TYMCZASOWA diagnostyka -- patrz komentarz przy armLock().
    const _dgT0 = Date.now();
    console.log(`[e2e-diag-state] t=${_dgT0} dispatchGatedNow START type=${action.type}`);
    let displayWaitFailed = false;
    try {
      if (action.type === "START_ROUND") {
        renderCurrent();
        displayWaitFailed = !(await waitForDisplayRender());
      }
      if (displayWaitFailed) return null;
      // Naprawiona luka: ten renderCurrent() (i cała reszta funkcji) była
      // POZA try/finally chroniącym `committing` -- rzucony tu wyjątek
      // (np. błąd w konkretnej gałęzi render()) zostawiał `committing`
      // trwale na true, bo finally niżej nigdy się nie wykonywał. Z
      // kolejką dispatchGated() (patrz komentarz przy niej) to już nie
      // "tylko" złamany render na tę jedną akcję -- jeśli to była OSTATNIA
      // zakolejkowana akcja (np. ostatni SET_ENTRY_TEXT z serii szybkich
      // .fill()), busy() zostawał zablokowany NA ZAWSZE, bo nic po niej już
      // nie wywołało dispatchGated ponownie, żeby to odkręcić (znalezione
      // przy diagnozie e2e: "Rozpocznij odliczanie" trwale disabled mimo
      // poprawnie wypełnionych wszystkich pól).
      renderCurrent();
      nextRow = await engine.dispatch(action);
    } finally {
      typingCommit = false;
      committing = false;
      if (displayWaitFailed) renderCurrent();
    }
    console.log(`[e2e-diag-state] t=${Date.now()} dispatchGatedNow AFTER-ENGINE type=${action.type} afterMs=${Date.now() - _dgT0} nextRowRev=${nextRow?.rev}`);
    const ms = await actionGate.computeGateMs(action.type, prevRow, nextRow);
    console.log(`[e2e-diag-state] t=${Date.now()} dispatchGatedNow gateMs type=${action.type} ms=${ms}`);
    // Migracja 264 -- ta sama blokada, egzekwowana też w bazie (nie tylko w
    // tej karcie przeglądarki). Best-effort: nieudane ustawienie nie cofa
    // już potwierdzonego zapisu treści powyżej, patrz store.js's setLockNow().
    if (ms > 0) {
      displayCompletion.request(nextRow.rev);
      armLock(ms);
    }
    renderCurrent();
    console.log(`[e2e-diag-state] t=${Date.now()} dispatchGatedNow END type=${action.type} totalMs=${Date.now() - _dgT0}`);
    return nextRow;
  }

  // Zserializowane -- dokładnie ten sam wzorzec i powód co engine.js's
  // własna `_queue` (patrz komentarz tam), tylko jeden poziom wyżej.
  // engine.dispatch() samo w sobie już chroni reducer+commit przed
  // nachodzeniem, ALE dispatchGated() dokłada WŁASNY, synchroniczny
  // renderCurrent() na SAMYM START (linia `committing = true;
  // renderCurrent();`, PRZED jeszcze reducerem) -- bez kolejki tutaj dwa
  // wywołania dispatchGated() wystrzelone bez odczekania (np. pole
  // "Odpowiedź gracza" wpisywane w f_p1_entry: on(inp,"input",...) woła
  // emit("game.dispatch",...) na KAŻDY .fill()/wpis, bez await) mogły
  // nachodzić na siebie -- renderCurrent() z DRUGIEGO, wcześniej
  // nieuruchomionego jeszcze reducera przebudowywał WSZYSTKIE pola input
  // od zera z JESZCZE STAREGO stanu (reducer PIERWSZEGO wywołania nie
  // zdążył jeszcze dopisać swojego tekstu), gubiąc wizualnie to, co
  // operator/test właśnie wpisał w INNE, równolegle edytowane pole (na
  // żywo: pole 2/5 w finale zostawało puste -- hasTyped=false -- mimo że
  // test .fill()'ował je tak samo jak resztę). Kolejka gwarantuje, że
  // renderCurrent()+reducer+commit dla KAŻDEGO dispatchGated w pełni się
  // kończy, zanim zacznie się następny.
  let _dispatchGatedQueue = Promise.resolve();
  let typingCommit = false;
  function dispatchGated(action) {
    const generation = dispatchGeneration;
    const run = () => generation === dispatchGeneration && !restarting ? dispatchGatedNow(action) : null;
    const result = _dispatchGatedQueue.then(run, run);
    _dispatchGatedQueue = result.catch(() => {});
    return result;
  }

  // "Dogonienie" timerów zastanych już wygasłych przy wznowieniu (plan,
  // sekcja 4) — zanim cokolwiek się wyrenderuje operatorowi. Zgłoszone:
  // "rozłącz/zamknij Control w trakcie timerów — czy one wrócą do stanu
  // przed, a nie po, bo tak powinny" — OBA timery idą teraz WSTECZ, do
  // stanu sprzed ich startu (final.timer: CANCEL_TIMER, rounds.timer3:
  // CANCEL_TIMER3) — symetrycznie, bez naliczania żadnej konsekwencji
  // (pudło/zużyta szansa gracza) za czas, w którym nikt nie patrzył. Patrz
  // engine.js's CANCEL_TIMER/CANCEL_TIMER3 dla pełnego uzasadnienia; to
  // zmiana względem wcześniejszej wersji tego kodu, gdzie final.timer szedł
  // NAPRZÓD (EXPIRE_TIMER) — zachowane dla LIVE wygaśnięcia/ręcznego
  // zatrzymania (patrz scheduleFinalTimerWatch/toggleFinalTimer niżej),
  // tylko NIE dla tego, zastanego już wygasłego przy wznowieniu, przypadku.
  async function applyExpiredTimersOnResume(expired) {
    if (!expired) return;
    if (expired.final) await engine.dispatch({ type: "CANCEL_TIMER" });
    if (expired.timer3) await engine.dispatch({ type: "CANCEL_TIMER3" });
  }
  await applyExpiredTimersOnResume(expiredTimer);

  // Control jest jedynym urządzeniem "authenticated" — może czytać
  // game_state bezpośrednio (dla siebie), więc na dzwonek reaguje pełnym
  // hydrate() zamiast RPC z kluczem jak anon. To jedyny sposób, żeby
  // Control zauważył zmianę zapisaną przez KOGOŚ INNEGO — jedyny taki
  // przypadek to Buzzer piszący bezpośrednio przez game_state_buzzer_press
  // (sekcja 1/4 planu). Własne zapisy Control i tak już ma zaaplikowane
  // synchronicznie przez commit() zanim ten sam dzwonek do niego wróci —
  // stąd warunek rev > store.state.rev, żeby nie robić zbędnego refetchu.
  let externalRefreshInFlight = false;
  async function refreshExternalState() {
    if (externalRefreshInFlight) return;
    externalRefreshInFlight = true;
    try {
      const expiredNow = await store.refreshExternal();
      await applyExpiredTimersOnResume(expiredNow);
    } finally {
      externalRefreshInFlight = false;
    }
    // Odczyt pominięty (w trakcie ruszył własny zapis), a w międzyczasie
    // przyszła nowsza cudza zmiana — jeszcze raz po zapisach.
    if (latestExternalRev > store.state.rev) void store.whenIdle().then(() => { if (latestExternalRev > store.state.rev) void refreshExternalState(); });
  }
  const urls = await urlsP;
  testModePanel = createControlTestMode({ urls, onActivity: () => runtimeSession.noteActivity(), onResize: () => renderCurrent() });
  const connectCodes = await connectCodesP;

  function deviceLabel(kind) {
    return { display: t("control.deviceDisplay"), host: t("control.deviceHost"), buzzer: t("control.deviceBuzzer") }[kind];
  }
  // Treść okna według przyczyny: uśpione urządzenie (strona zgłosiła przejście
  // w tło — zablokowany ekran, inna aplikacja) albo zerwane połączenie.
  // Wcześniej zawsze „sprawdź internet i podłącz ponownie”, także gdy telefon
  // tylko zablokował ekran (eksport 29.10).
  function deviceLostMessage(kinds, diagnostics) {
    const asleep = kinds.filter((kind) => absenceCause(diagnostics?.[kind]) === "asleep");
    const offline = kinds.filter((kind) => !asleep.includes(kind));
    const parts = [];
    if (asleep.length) parts.push(t("control.deviceAsleepText", { devices: asleep.map(deviceLabel).join(", ") }));
    if (offline.length) parts.push(t("control.deviceOfflineText", { devices: offline.map(deviceLabel).join(", ") }));
    parts.push(t("control.deviceBlockedNote"));
    return { title: t(offline.length ? "control.deviceLostTitle" : "control.deviceAsleepTitle"), text: parts.join("\n\n") };
  }
  // Brakujące urządzenia, które NIE wstrzymują gry — krótkie ostrzeżenie.
  function absentDevicesNotice() {
    const blocking = blockingDevices(store.state, presenceFlags);
    const absent = missingDevices(store.state, presenceFlags).filter((kind) => !blocking.includes(kind));
    if (!absent.length) {
      // Urządzenie połączone, ale bez kanału na żywo (tryb zapasowy: odczyt
      // z bazy co 2 s) — zwykle antywirus, VPN lub proxy blokuje WebSockety.
      const slow = ["display", "host", "buzzer"].filter((kind) => presenceFlags[kind] && lastDeviceDiagnostics?.[kind]?.realtimeLive === false);
      return slow.length ? t("control.hints.deviceNoLive", { devices: slow.map(deviceLabel).join(", ") }) : null;
    }
    const asleep = absent.filter((kind) => absenceCause(lastDeviceDiagnostics?.[kind]) === "asleep");
    const key = asleep.length === absent.length ? "control.hints.deviceAsleep" : "control.hints.deviceOffline";
    return t(key, { devices: absent.map(deviceLabel).join(", ") });
  }

  const presence = createPresence({
    gameId,
    // Pojedynczy nieudany odczyt przy świeżej migawce: gra nie jest blokowana,
    // tylko zapis do diagnostyki (czy to dalej się zdarza i jak często).
    onTransientError: ({ error, errorSource }) => {
      if (pageLeaving()) return;
      void sessionTelemetry.report({
        kind: "diagnostic", category: "connectivity",
        message: "Jeden odczyt statusu urządzeń się nie udał; gra nie była blokowana.",
        devices: ["control"],
        metrics: {
          phase: "read_retry", source: errorSource || "status_read",
          error_name: String(error?.name || "Error").slice(0, 80),
          error_message: String(error?.message || "").slice(0, 120) || null,
        },
      });
    },
    onChange: ({ flags, displayAudioUnlocked: audioUnlocked, deviceDiagnostics, error, errorSource }) => {
      const previous = presenceFlags;
      if (error) {
        if (pageLeaving()) return;
        if (!presenceUnavailable) {
          presenceFailureStartedAt = Date.now();
          presenceFailureSource = errorSource || "status_read";
          sessionTelemetry.probeNetworkNow();
          void sessionTelemetry.report({
            kind: "diagnostic", category: "connectivity",
            message: "Control utracił możliwość odczytu statusu urządzeń; akcje gry są chwilowo blokowane.",
            devices: ["control"],
            metrics: {
              phase: "read_error", source: presenceFailureSource,
              error_name: String(error?.name || "Error").slice(0, 80),
              error_code: String(error?.code || "").slice(0, 80) || null,
              http_status: Number.isFinite(error?.status) && error.status > 0 ? error.status : null,
              error_message: String(error?.message || "").slice(0, 120) || null,
            },
          });
        }
        presenceUnavailable = true;
        renderCurrent();
        return;
      }
      presenceFlags = flags;
      displayAudioUnlocked = audioUnlocked;
      lastDeviceDiagnostics = deviceDiagnostics;
      if (presenceUnavailable) recoverLeaseStatusRead();
      const audioDiagnostic = deviceDiagnostics?.display?.audioDiagnostic;
      if (!hasInitialPresenceSnapshot) {
        hasInitialPresenceSnapshot = true;
        lastDisplayAudioDiagnosticId = audioDiagnostic?.id || null;
      } else if (audioDiagnostic?.id && audioDiagnostic.id !== lastDisplayAudioDiagnosticId) {
        lastDisplayAudioDiagnosticId = audioDiagnostic.id;
        void sessionTelemetry.report({
          kind: "diagnostic", category: "audio_start",
          message: "Opóźniony start lub błąd dźwięku na Wyświetlaczu.",
          devices: ["display"],
          metrics: {
            sound: String(audioDiagnostic.sound || "unknown").slice(0, 80),
            start_delay_ms: Math.max(0, Number(audioDiagnostic.delayMs) || 0),
            failed: !!audioDiagnostic.failed,
            error: String(audioDiagnostic.error || "").slice(0, 160),
          },
        });
      }
      const missing = missingDevices(store.state, flags);
      const blocking = blockingDevices(store.state, flags);
      updateConnectivityIncident(missing, deviceDiagnostics, missing.some(kind => previous[kind]));
      // Okno tylko dla urządzeń, bez których gra stoi; pozostałe brakujące
      // (uśpiony Prowadzący, Przycisk poza pojedynkiem) to ostrzeżenie nad
      // podpowiedzią (ui.js, devicesAbsent) — decyzja użytkownika 2026-10-29.
      if (!blocking.length) {
        disconnectEpisode = false;
        lastDisconnectState = "";
        deviceLostModal?.close?.(true);
        deviceLostModal = null;
      } else {
        const lost = deviceLostMessage(blocking, deviceDiagnostics);
        deviceLostModal?.setText?.(lost.text);
        deviceLostModal?.setTitle?.(lost.title);
        const disconnectState = JSON.stringify(flags);
        if ((blocking.some((kind) => previous[kind]) || disconnectEpisode) && disconnectState !== lastDisconnectState) {
          lastDisconnectState = disconnectState;
          // Jeden modal na całe zdarzenie utraty połączenia. Przywracanie
          // urządzeń po kolei zmienia listę brakujących, ale nie powinno
          // ponownie zasłaniać Control ani blokować kliknięcia kolejnego
          // statusu w górnym pasku.
          if (!disconnectEpisode && blocking.some((kind) => previous[kind])) {
            disconnectEpisode = true;
            // wspólne alertModal (modal.js); tekst odświeżany przy zmianie listy brakujących
            const ctl = {};
            deviceLostModal = ctl;
            void alertModal({
              title: lost.title, text: lost.text, okText: t("common.a2hsOk"),
              modalClass: "modal--narrow", overlayId: "deviceLostOverlay", controller: ctl,
            }).then(() => { if (deviceLostModal === ctl) deviceLostModal = null; });
          }
        }
      }
      renderCurrent();
    },
  });
  presence.start();

  // "Udostępnij" per urządzenie (D0/D1) — modal 1:1 ze starym Control
  // (control/js/shareDevice.js). Licznik (badge, liczba udostępnień/puste) na przycisku
  // idzie przez ctx.shareBadges zamiast bezpośredniej mutacji DOM, bo wiersz
  // urządzenia jest przebudowywany przy każdym renderDevicesStep().
  let shareBadges = {};
  const shareDevice = createShareDevice({
    currentUser: user,
    game,
    // Przerysowanie tylko przy zmianie liczb: pełne renderCurrent() zastępuje
    // wiersze urządzeń, a kliknięcie trafiające w tę chwilę ginęło (zwykle
    // przychodzą same zera zaraz po wejściu).
    onBadgesChanged: (badges) => {
      const kinds = new Set([...Object.keys(shareBadges), ...Object.keys(badges)]);
      const changed = [...kinds].some((kind) => (Number(shareBadges[kind]) || 0) !== (Number(badges[kind]) || 0));
      shareBadges = badges;
      if (changed) renderCurrent();
    },
  });
  shareDevice.refreshBadges();

  const displayCueStartWaiters = new Map();
  // Prywatne kanały Control (decyzja właściciela 2026-10-29, migracja 510):
  // baza sama wysyła tu każdą zmianę stanu (także naciśnięcie Przycisku)
  // i potwierdzenie planszy — bez dzwonków i odpytywania. Wpuszcza tylko
  // właściciela gry. Po każdym (ponownym) dołączeniu jeden odczyt, bo
  // wiadomości z przerwy przepadły.
  let latestExternalRev = 0;
  function onControlState(row) {
    const rev = Number(row?.rev);
    if (!Number.isFinite(rev) || rev <= store.state.rev) return;
    latestExternalRev = Math.max(latestExternalRev, rev);
    // Własny zapis w toku: jego odpowiedź niesie stan; nowszą wiadomość
    // (np. naciśnięcie w trakcie zapisu) dociągamy po jego końcu.
    if (store.writing() || externalRefreshInFlight) {
      void store.whenIdle().then(() => { if (latestExternalRev > store.state.rev) void refreshExternalState(); });
      return;
    }
    void applyExpiredTimersOnResume(store.applyExternalRow(row));
  }
  const controlChannel = sb().channel(`game-control:${gameId}`, { config: { private: true } })
    .on("broadcast", { event: "state" }, ({ payload }) => onControlState(payload?.row))
    .on("broadcast", { event: "completion" }, ({ payload }) => {
      if (!payload?.row) return;
      recoverDisplayCompletionRead();
      applyDisplayCompletion(payload.row, "realtime");
    });
  // Wyświetlacz: „animacja rusza” (dźwięk z Control) — sygnał chwilowy.
  const signalChannel = sb().channel(`game-signal:${gameId}`, { config: { private: true } })
    .on("broadcast", { event: "display_transition_started" }, (message) => {
      const seq = Number(message?.payload?.sound_cue_seq);
      const waiter = displayCueStartWaiters.get(seq);
      if (!waiter) return;
      displayCueStartWaiters.delete(seq);
      clearTimeout(waiter.timer);
      clearTimeout(waiter.capTimer);
      waiter.resolve();
    });
  void Promise.resolve().then(() => sb().realtime.setAuth()).catch(() => {}).then(() => {
    controlChannel.subscribe((status) => {
      completionRealtimeConnected = status === "SUBSCRIBED";
      observeRealtimeState("game_control", status);
      if (status === "SUBSCRIBED") {
        void refreshExternalState();
        void refreshDisplayCompletion({ force: true });
      }
    });
    signalChannel.subscribe((status) => observeRealtimeState("display_transition_started", status));
  });
  // Limit 1,2 s liczony od potwierdzenia zapisu Control przez serwer, nie od
  // stanu optymistycznego: wcześniej mieściły się w nim też zapis Control,
  // dzwonek i odczyt stanu przez Wyświetlacz, więc 10–25% dźwięków ruszało
  // przed animacją przy widocznym Wyświetlaczu (eksport 25.10). Gdy
  // potwierdzenie nie przyjdzie (np. odrzucony zapis), limit startuje po 3 s.
  const DISPLAY_START_WAIT_MS = 1200;
  const DISPLAY_START_CONFIRM_CAP_MS = 3000;
  function cueWriteConfirmed(seq) {
    const row = store.state.__row;
    return !!row && row.__target_rev == null && Number(row.sound_cue_seq) >= seq;
  }
  function armDisplayCueStart(seq, waiter) {
    if (waiter.timer) return;
    clearTimeout(waiter.capTimer);
    waiter.timer = setTimeout(() => {
      if (displayCueStartWaiters.get(seq) === waiter) displayCueStartWaiters.delete(seq);
      if (store.state.locks.gameStarted && !store.state.locks.gameEnded && store.state.settings.soundSource === "control") {
        void sessionTelemetry.report({
          kind: "diagnostic", category: "display_delay",
          message: "Display nie potwierdził startu animacji w ciągu 1,2 s; Control uruchomił dźwięk po limicie.",
          devices: ["display"],
          metrics: {
            reason: "start_signal_timeout", sound_cue_seq: seq, wait_ms: DISPLAY_START_WAIT_MS,
            since_request_ms: Math.round(performance.now() - waiter.requestedAt),
          },
        });
      }
      waiter.resolve();
    }, DISPLAY_START_WAIT_MS);
  }
  store.subscribe(() => {
    for (const [seq, waiter] of displayCueStartWaiters) {
      if (!waiter.timer && cueWriteConfirmed(seq)) armDisplayCueStart(seq, waiter);
    }
  });
  function waitForDisplayCueStart(soundCueSeq) {
    const seq = Number(soundCueSeq);
    if (!Number.isFinite(seq) || seq <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const previous = displayCueStartWaiters.get(seq);
      if (previous) { clearTimeout(previous.timer); clearTimeout(previous.capTimer); previous.resolve(); }
      // A transient lost broadcast must never mute a cue or stall Control.
      // Normal path waits for Display to finish its timing prep and begin the
      // corresponding render; timeout is the network-failure fallback.
      const waiter = { resolve, timer: null, capTimer: null, requestedAt: performance.now() };
      displayCueStartWaiters.set(seq, waiter);
      if (cueWriteConfirmed(seq)) armDisplayCueStart(seq, waiter);
      else waiter.capTimer = setTimeout(() => armDisplayCueStart(seq, waiter), DISPLAY_START_CONFIRM_CAP_MS);
    });
  }
  createSoundReactor(store, { waitForStart: waitForDisplayCueStart });
  const stopAudioDiagnostics = onSfxPlayback(event => {
    const state = store.state;
    if (!state.locks.gameStarted || state.locks.gameEnded || state.settings.soundSource === "display" || state.settings.soundMuted) return;
    if (!event.failed && event.delayMs < 500) return;
    void sessionTelemetry.report({
      kind: "diagnostic", category: "audio_start",
      message: "Opóźniony start lub błąd dźwięku w Control.",
      devices: ["control"],
      metrics: {
        sound: String(event.key || "unknown").slice(0, 80),
        start_delay_ms: Math.max(0, Number(event.delayMs) || 0),
        failed: !!event.failed,
        error: String(event.error || "").slice(0, 160),
      },
    });
  });
  window.addEventListener("pagehide", stopAudioDiagnostics, { once: true });

  // Odblokowanie audio po cichu na pierwszej dowolnej interakcji (sekcja 3a
  // pkt 4) — bez osobnego ekranu, bez dźwięku słyszalnego dla operatora.
  const unlockOnce = () => { unlockAudio(); document.removeEventListener("pointerdown", unlockOnce); document.removeEventListener("keydown", unlockOnce); };
  document.addEventListener("pointerdown", unlockOnce, { once: true });
  document.addEventListener("keydown", unlockOnce, { once: true });

  const root2 = document.getElementById("app");
  const ui = createUI({ root: root2, emit: handle });

  // Timery (finał 15s/20s, 3s decyzja w rundach) same z siebie NIE wygasają w
  // żywej karcie Control — silnik dostaje EXPIRE_TIMER/EXPIRE_TIMER3
  // wyłącznie z hydrate() (start/wznowienie) i z dzwonka po cudzym zapisie
  // (patrz wyżej). Bez tego zegarka operator musiałby ręcznie odświeżyć
  // kartę, żeby usłyszeć "koniec czasu"/dostać auto-X — dokładnie to, co w
  // oryginalnych control/js/gameRounds.js/gameFinal.js robił nieprzerwanie
  // działający requestAnimationFrame. Zdublowane wywołanie po naturalnym
  // wygaśnięciu jest nieszkodliwe: oba EXPIRE_* same sprawdzają `running` i
  // są no-opem, gdy timera już nie ma (np. operator sam rozstrzygnął wcześniej).
  function makeTimerWatch(getTimer, expireAction) {
    const w = { endsAt: null, handle: null };
    return () => {
      const timer = getTimer();
      const endsAt = timer?.running ? timer.endsAt : null;
      if (endsAt === w.endsAt) return;
      if (w.handle) { clearTimeout(w.handle); w.handle = null; }
      w.endsAt = endsAt;
      if (endsAt == null) return;
      w.handle = setTimeout(() => {
        dispatchGated({ type: expireAction }).catch(() => {});
      }, Math.max(0, endsAt - Date.now()));
    };
  }
  scheduleFinalTimerWatch = makeTimerWatch(() => store.state.final?.runtime?.timer, "EXPIRE_TIMER");
  scheduleTimer3Watch = makeTimerWatch(() => store.state.rounds?.timer3, "EXPIRE_TIMER3");
  scheduleFinalTimerWatch();
  scheduleTimer3Watch();

  function renderCtx() {
    return { urls, presenceFlags, displayAudioUnlocked, connectCodes, shareBadges, testModeChanging, typingPending:typingCommit, displayHiddenSameBrowser: displayHiddenSameBrowser(), busy: testModePanel?.blocked() || controlOffline || presenceReadBlocksGame() || waitingForDisplayAudioUnlock() || queuedGameAction || (soundBusy() && store.state.step !== "setup_finish") || (committing && !typingCommit) || waitingForDisplay() || Date.now() < lockedUntil || blockingDevices(store.state, presenceFlags).length > 0, devicesBlocked: presenceReadBlocksGame() || blockingDevices(store.state, presenceFlags).length > 0, devicesAbsent: absentDevicesNotice() };
  }

  // Przerysowanie podczas wciśnięcia zastępowało element pod palcem/kursorem:
  // wciśnięcie trafiało w stary, puszczenie w nowy i kliknięcie ginęło (krok
  // urządzeń, gdy łączą się Wyświetlacz/Prowadzący/Przycisk; e2e control2
  // „Przycisk fizyczny”, „tryb testowy”). Podmiana DOM czeka do końca
  // kliknięcia (następne zadanie po puszczeniu), najdłużej RENDER_HOLD_MAX_MS.
  const RENDER_HOLD_MAX_MS = 1500;
  let pointerHeld = false;
  let renderDeferred = false;
  let pointerHoldTimer = null;
  const releasePointerHold = () => {
    if (!pointerHeld) return;
    pointerHeld = false;
    clearTimeout(pointerHoldTimer);
    if (!renderDeferred) return;
    renderDeferred = false;
    setTimeout(() => renderCurrent(), 0);
  };
  document.addEventListener("pointerdown", () => {
    pointerHeld = true;
    clearTimeout(pointerHoldTimer);
    pointerHoldTimer = setTimeout(releasePointerHold, RENDER_HOLD_MAX_MS);
  }, true);
  document.addEventListener("pointerup", releasePointerHold, true);
  document.addEventListener("pointercancel", releasePointerHold, true);

  function renderCurrent() {
    // Network/audio callbacks may resolve while main() is still awaiting the
    // last bootstrap reads. The final render below covers their latest state.
    if (!controlUIReady) return;
    syncAudioUnlockWait();
    document.body.dataset.controlStep = store.state.step;
    syncTopbarDeviceCodeButtons();
    reportRealtimeSnapshots();
    if (store.state.locks.gameEnded) connectivityTracker.flush();
    noteDisplayRequest();
    scheduleFinalTimerWatch();
    scheduleTimer3Watch();
    // Zawinięte w try/catch -- dispatchGatedNow() woła renderCurrent()
    // PRZED ustawieniem committing=false (patrz komentarz tam); rzucony tu
    // wyjątek bez tego zostawiałby błąd całkowicie niewidoczny (połknięty
    // przez kolejkę dispatchGated()), a operator z trwale zablokowanym UI
    // bez żadnego śladu w konsoli, dlaczego.
    try {
      testModePanel.update(store.state.settings.testMode);
      if (pointerHeld) renderDeferred = true;
      else ui.render(store.state, { ...renderCtx(), testModeAvailable: testModePanel.canEnable() });
      document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
    } catch (e) {
      console.error("[control2] render() rzucił -- UI może zostać nieaktualne:", e);
    }
    // Mute jest teraz częścią game_state (nie lokalny stan tej karty) —
    // musi się odświeżyć na KAŻDĄ zmianę stanu, nie tylko po kliknięciu tu,
    // żeby np. druga karta Control (blokada resource-lock zwolniona) albo
    // wznowienie po przeładowaniu pokazywały poprawną ikonę od razu.
    syncMuteButton();
    // Zgłoszone: "Zacznij od nowa" w topbarze (w odróżnieniu od tego samego
    // przycisku na ekranach końca gry, które już idą przez navButton()'s
    // busy/disabled) nie było w ogóle objęte blokadą dźwięku/animacji —
    // kliknięcie w trakcie jeszcze trwającego locked_until z poprzedniej
    // akcji (np. dźwięku końca gry) kończyło się surowym window.alert
    // ("Błąd: locked") zamiast po prostu czekać jak reszta dużych przejść.
    if (btnStartOver) btnStartOver.disabled = false;
  }

  // Samo renderCurrent() maluje cyfry timera3/finału tylko RAZ, w momencie
  // zmiany stanu — bez czegoś, co odświeża widok co ułamek sekundy, kafel
  // pokazywałby tę samą liczbę aż do wygaśnięcia. Odświeżamy tylko wtedy,
  // gdy faktycznie coś odlicza — reszta czasu bez zbędnej pracy.
  //
  // ui.tickTimers(), NIE pełny ui.render()/renderCurrent(): zgłoszone
  // wprost — "licznik i przyciski cały czas migają" oraz "wpisywanie nie ma
  // blokować licznika". Pełny render() tutaj przebudowywałby CAŁY ekran 4x/s
  // (root.innerHTML="" + od nowa), co niszczyło fokus/kursor w polach
  // wpisywania finału (renderFinalEntry tworzy świeże <input> przy każdym
  // renderze) i restartowało CSS-animacje wszystkich innych, niezwiązanych
  // przycisków na ekranie — stąd wrażenie ciągłego migania całego panelu, nie
  // tylko samych cyfr. tickTimers() podmienia WYŁĄCZNIE treść cyfr (patrz
  // ui.js), więc reszta DOM (w tym fokus operatora w polu tekstowym) zostaje
  // nietknięta przez cały czas trwania odliczania.
  setInterval(() => {
    if (store.state.rounds?.timer3?.running || store.state.final?.runtime?.timer?.running) {
      ui.tickTimers(store.state);
    }
  }, 250);

  // ===== Modal QR z topbaru (prywatny podgląd operatora — nie to samo co
  // "QR na wyświetlaczu"; identyczna logika/DOM co dzisiejsze
  // control/js/app.js's showQrModal/hideQrModal). =====
  function getDeviceUrl(kind) {
    if (kind === "display") return urls.displayUrl;
    if (kind === "host") return urls.hostUrl;
    if (kind === "buzzer") return urls.buzzerUrl;
    return null;
  }
  function qrModalLabel(kind) {
    if (kind === "display") return t("control.deviceDisplay");
    if (kind === "host") return t("control.deviceHost");
    if (kind === "buzzer") return t("control.deviceBuzzer");
    return t("control.qrModalTitle");
  }
  function syncTopbarDeviceCodeButtons() {
    const disabled = store.state.settings.testMode === true;
    for (const id of ["dotDisplayRow", "dotHostRow", "dotBuzzerRow"]) {
      const row = document.getElementById(id);
      if (!row) continue;
      row.classList.toggle("qr-code-unavailable", disabled);
      row.setAttribute("aria-disabled", String(disabled));
    }
  }
  function showQrModal(kind) {
    if (store.state.settings.testMode) return;
    const url = getDeviceUrl(kind);
    if (!url) return;
    const overlay = document.getElementById("qrModalOverlay");
    const titleEl = document.getElementById("qrModalTitle");
    const imgEl = document.getElementById("qrModalImg");
    const codeValEl = document.getElementById("qrModalCodeVal");
    if (!overlay || !titleEl) return;
    titleEl.textContent = qrModalLabel(kind);
    if (codeValEl) codeValEl.textContent = connectCodes[kind] || "——————";
    const qrWrap = document.getElementById("qrModalQrWrap");
    if (kind === "display") { if (qrWrap) qrWrap.hidden = true; }
    else { if (qrWrap) qrWrap.hidden = false; if (imgEl) imgEl.src = qrImgSrc(url); }
    const openBtn = document.getElementById("qrModalOpen");
    if (openBtn) {
      if (kind === "display") { openBtn.href = url; openBtn.classList.remove("hidden"); }
      else openBtn.classList.add("hidden");
    }
    overlay.dataset.kind = kind;
    openDialog(overlay, { onClose: hideQrModal });
  }
  function hideQrModal() {
    const overlay = document.getElementById("qrModalOverlay");
    closeDialog(overlay);
  }
  document.getElementById("qrModalClose")?.addEventListener("click", hideQrModal);
  document.getElementById("qrModalCopy")?.addEventListener("click", async () => {
    const kind = document.getElementById("qrModalOverlay")?.dataset.kind;
    const code = kind && connectCodes[kind];
    if (code) {
      try { await navigator.clipboard.writeText(code); toast(t("control.copyOk")); }
      catch { toast(t("control.copyFail"), { kind: "error" }); }
    }
  });

  // Kropki statusu w topbarze są klikalne PRZEZ CAŁĄ GRĘ (nie tylko na
  // kroku Urządzenia) — po to są te modale: jeśli urządzenie trzeba
  // ponownie podłączyć w trakcie rozgrywki (np. tablet się zrestartował),
  // operator musi mieć skąd wziąć kod/QR bez cofania się do kroku
  // Urządzenia (które i tak nie jest już wtedy dostępne — poza D0/D3 nie
  // ma przejścia z powrotem). Te elementy są statyczne (poza #app), więc
  // jednorazowe podpięcie tu jest bezpieczne, w odróżnieniu od przycisków
  // w device-row, patrz control/js/shareDevice.js.
  document.getElementById("dotDisplayRow")?.addEventListener("click", () => showQrModal("display"));
  document.getElementById("dotHostRow")?.addEventListener("click", () => showQrModal("host"));
  document.getElementById("dotBuzzerRow")?.addEventListener("click", () => showQrModal("buzzer"));

  beforeLeave = async () => {
    // Ostrzeżenie tylko w trakcie realnej rozgrywki (jak dzisiejsze
    // shouldWarnBeforeUnload()) — z D0-D3 wychodzimy bez pytania.
    if (store.state.locks.gameStarted && !store.state.locks.gameEnded) {
      const ok = await confirmModal({
        title: t("control.leaveTitle"),
        text: t("control.leaveText"),
        okText: t("control.leaveOk"),
        cancelText: t("control.leaveCancel"),
      });
      if (!ok) return false;
    }
    // Sesja i jej linki wygasają po godzinie bezczynności, także po wyjściu
    // z Control. Nawigacja nie może unieważnić grantów przed tym terminem.
    runtimeSession?.stop();
    return true;
  };

  // "Losowo" ma losować RAZ, od razu przy wejściu w Podsumowanie (D3), i
  // pokazać co wylosowano — nie dopiero leniwie przy pierwszym Starcie
  // rundy/finału (plan, sekcja 3a pkt 1). Bezpieczne wołać wielokrotnie:
  // no-op jeśli pula już wylosowana (a "Losuj ponownie" i tak nadpisuje
  // jawnie, osobną akcją).
  async function ensureQuestionsDrawn() {
    const st = store.state;
    if (!st.rounds._questionPool?.length) {
      st.rounds._questionPool = await pickQuestionPool(st);
    }
    if (st.settings.hasFinal === true && st.settings.finalQuestionsMode !== "pick" && !st.final.picked?.length) {
      const { picked, pickedPreview, roundsPool } = await drawFinalPicks(st, st.rounds._questionPool);
      st.final.picked = picked;
      st.final.pickedPreview = pickedPreview;
      st.rounds._questionPool = roundsPool;
      st.final.confirmed = true;
    }
  }

  // W odróżnieniu od dispatchGated() ten tor (proste przejścia UI-
  // nawigacyjne, np. "Rozpocznij grę" -> r_roundStart/"show_intro") nie
  // liczył DOTĄD żadnej blokady wcale -- ani klienckiej, ani bazodanowej.
  // Migracja 264: domykamy oba na raz, tym samym `timing` co actionGate.js
  // (ta sama liczba, co realnie steruje animacją na Displayu), zamiast
  // zgadywać nowy zestaw stałych.
  async function advance(nextStep, extra = {}, soundCueKey) {
    if (controlOffline) return;
    if (waitingForDisplayAudioUnlock()) { noteAudioUnlockBlockedAction(); return; }
    const generation = dispatchGeneration;
    assertTransition(store.state.step, nextStep);
    store.state.step = nextStep;
    Object.assign(store.state, extra);
    committing = true;
    renderCurrent();
    try {
      const lockMs = soundCueKey === "show_intro"
        ? await actionGate.computeGateMs("SHOW_INTRO", null, { step: nextStep })
        : await actionGate.timing.dur(soundCueKey);
      await store.commit({ soundCueKey, lockMs });
    } finally {
      committing = false;
    }
    if (soundCueKey) {
      const ms = nextStep === "r_roundStart" && soundCueKey === "show_intro"
        ? await actionGate.computeGateMs("SHOW_INTRO", null, store.state.__row)
        : await actionGate.timing.dur(soundCueKey);
      armLock(ms, generation);
    }
    renderCurrent();
  }

  // Wpisywanie finału (F1/F8): "Rozpocznij odliczanie"/"Zatrzymaj" to jeden
  // toggle, dokładnie jak stare control/js/gameFinal.js's p1StartTimer()/
  // p2StartTimer() — wczesne zatrzymanie dozwolone TYLKO gdy wszystkie pola
  // są wypełnione (allFilledP1/P2, jak dawne timerStopEarlyIfAllowed),
  // inaczej klik/skrót nic nie robi. Jedno miejsce prawdy, reużywane przez
  // kafel w control/js/ui.js i przez skrót Ctrl/Cmd+Shift niżej.
  function allFilledP1() {
    return store.state.final.runtime.p1.every((x) => String(x?.text || "").trim().length > 0);
  }
  function allFilledP2() {
    return store.state.final.runtime.p2.every((x) => String(x?.text || "").trim().length > 0);
  }
  async function toggleFinalTimer(round) {
    const phase = round === 1 ? "P1" : "P2";
    const timer = store.state.final.runtime.timer;
    if (timer.running && timer.phase === phase) {
      const filled = round === 1 ? allFilledP1() : allFilledP2();
      if (!filled) return;
      await dispatchGated({ type: "EXPIRE_TIMER" });
      return;
    }
    const used = round === 1 ? timer.usedP1 : timer.usedP2;
    if (used) return;
    await dispatchGated({ type: "START_TIMER", phase });
  }

  // ---------------- SKRÓT: Ctrl/Cmd+Shift -> start/zatrzymanie odliczania ----------------
  // 1:1 z dawnym control/js/gameFinal.js's wantsFinalTimerHotkey/
  // handleFinalTimerHotkey — działa tylko na krokach wpisywania finału
  // (f_p1_entry/f_p2_entry), celowo nawet gdy operator akurat pisze w polu.
  function isMacLike() {
    const p = navigator.platform || "";
    return /Mac|iPhone|iPad|iPod/i.test(p);
  }
  document.addEventListener("keydown", (e) => {
    const main = isMacLike() ? e.metaKey : e.ctrlKey;
    if (!main || e.key !== "Enter" || e.shiftKey || e.altKey || e.repeat || e.isComposing || (isMacLike() ? e.ctrlKey : e.metaKey)) return;
    if ([...document.querySelectorAll(".overlay, [role='dialog']")].some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")) return;
    const step = store.state.step;
    if (step !== "f_p1_entry" && step !== "f_p2_entry") return;
    // Skrót woła engine.dispatch() BEZPOŚREDNIO, z pominięciem
    // dispatchGated() -- jedyne miejsce w całej appce, które mogło
    // wystrzelić zapis zupełnie bez sprawdzenia busy() (ani przycisk w
    // ui.js, którego kliknięcie i tak przechodzi przez emit(), nie miał tu
    // wcześniej żadnej ochrony -- patrz finalTimerRow). Bez tego dwa razy
    // szybko wciśnięty skrót (albo skrót w trakcie jeszcze trwającej
    // blokady po poprzednim przejściu) mógł tak samo pomieszać intencje,
    // jak opisany wcześniej wyścig na przycisku r_intro.
    if (busy() && !typingCommit) return;
    e.preventDefault();
    handle("final.toggleTimer", { round:step === "f_p1_entry" ? 1 : 2 });
  }, { capture: true });

  async function handle(action, payload) {
    try {
      if (testModeChanging && action !== "devices.testMode") return;
      if (testModePanel.blocked() && action !== "devices.testMode") return;
      if (store.state.settings.testMode && ["devices.noHostTablet", "devices.physicalBuzzer", "devices.copyCode", "devices.shareOpen", "qr.modal.show", "qr.host.toggle", "qr.buzzer.toggle"].includes(action)) return;
      if (action === "devices.testMode") {
        if (testModeChanging || store.state.step !== "devices_display" || (payload && !testModePanel.canEnable())) return;
        const previous = structuredClone({ settings:store.state.settings, display:store.state.display });
        testModeChanging = true;
        try {
          store.state.settings.testMode = !!payload;
          if (payload) {
            store.state.settings.noHostTablet = false;
            store.state.settings.physicalBuzzer = false;
            store.state.display.qr.host.show = false;
            store.state.display.qr.buzzer.show = false;
            store.state.display.mode = "BLACK";
          }
          renderCurrent();
          await store.commit();
        } catch (error) {
          store.state.settings = previous.settings;
          store.state.display = previous.display;
          throw error;
        } finally {
          testModeChanging = false;
          renderCurrent();
        }
        return;
      }
      const gameAction = action === "game.dispatch" || action === "rounds.introNext" || action === "final.toggleTimer" || action === "setup.start";
      if (gameAction && restarting) return;
      if (gameAction && blockingDevices(store.state, presenceFlags).length) noteConnectivityBlockedAction(payload?.type || action);
      if (gameAction && queuedGameAction && payload?.type !== "SET_ENTRY_TEXT") return;
      if (gameAction && typingCommit && payload?.type !== "SET_ENTRY_TEXT") {
        // Reserve this command immediately: later typing cannot overtake
        // a repeat press and leave the next timer click silently discarded.
        queuedGameAction = true;
        renderCurrent();
        try { await _dispatchGatedQueue; }
        finally { queuedGameAction = false; }
      }
      if (gameAction && busy() && payload?.type !== "SET_ENTRY_TEXT") return;
      if (gameAction && (presenceReadBlocksGame() || blockingDevices(store.state, presenceFlags).length)) return;
      if (action === "ui.flushTyping") { await _dispatchGatedQueue; return; }
      if (action === "ui.rerender") {
        // Czysto lokalna zmiana UI (np. zaznaczenie drużyny w trybie
        // physicalBuzzer, przed potwierdzeniem) — bez zapisu do game_state.
        renderCurrent();
        return;
      }
      // Host/buzzer NIEZALEŻNE — jeden LUB oba naraz na Display (dokładnie
      // jak dzisiejsze qrHostOnDisplay/qrBuzzerOnDisplay + syncQrDisplay w
      // control/js/app.js, nie jeden qrTarget na raz jak w pierwszym
      // przebiegu control2).
      async function syncQrDisplay() {
        const q = store.state.display.qr;
        const wantHost = !!q.host.show && !store.state.settings.noHostTablet;
        const wantBuzzer = !!q.buzzer.show && !store.state.settings.physicalBuzzer;
        q.host.show = wantHost;
        q.buzzer.show = wantBuzzer;
        q.host.url = wantHost ? urls.hostUrl : null;
        q.host.code = wantHost ? connectCodes.host : null;
        q.buzzer.url = wantBuzzer ? urls.buzzerUrl : null;
        q.buzzer.code = wantBuzzer ? connectCodes.buzzer : null;
        store.state.display.mode = (wantHost || wantBuzzer) ? "QR" : "BLACK";
        await store.commit();
      }
      if (action === "qr.host.toggle") {
        store.state.display.qr.host.show = !store.state.display.qr.host.show;
        await syncQrDisplay();
        return;
      }
      if (action === "qr.buzzer.toggle") {
        store.state.display.qr.buzzer.show = !store.state.display.qr.buzzer.show;
        await syncQrDisplay();
        return;
      }
      if (action === "qr.toggle") {
        // Globalny "Schowaj QR" — chowa oba naraz.
        store.state.display.qr.host.show = false;
        store.state.display.qr.buzzer.show = false;
        await syncQrDisplay();
        return;
      }
      if (action === "devices.noHostTablet") {
        store.state.settings.noHostTablet = !!payload;
        if (payload) { store.state.display.qr.host.show = false; }
        await syncQrDisplay();
        return;
      }
      if (action === "devices.physicalBuzzer") {
        store.state.settings.physicalBuzzer = !!payload;
        if (payload) { store.state.display.qr.buzzer.show = false; }
        await syncQrDisplay();
        return;
      }
      if (action === "devices.soundSource") {
        // Jeden przełącznik (zgłoszone) — "control" (domyślnie) albo
        // "display". Gated w obu soundReactor.js (control2 i display2), tak
        // że dokładnie jedno z dwóch urządzeń faktycznie odtwarza w danej
        // chwili — bez żadnego dodatkowego zapisu tutaj poza samym polem.
        store.state.settings.soundSource = payload === "display" ? "display" : "control";
        await store.commit();
        return;
      }
      if (action === "settings.toggleSoundMuted") {
        // Współdzielone (nie lokalne — patrz komentarz w soundReactor.js),
        // żeby wyciszenie działało niezależnie od tego, które urządzenie
        // faktycznie gra. Migracja 268/store.setSoundMuted() -- NIE
        // store.commit() -- z tego samego powodu co setUiLang(): wyciszenie
        // jest metadaną operatora, niezależną od locked_until trwającej
        // akcji gry. Zgłoszone (e2e "dźwięk ze źródła Wyświetlacz"): klik
        // #btnMute tuż po odsłonięciu odpowiedzi (locked_until z TEJ akcji
        // jeszcze trwa) kończył się gołym window.alert("Błąd: locked") przez
        // pełny commit()/game_state_write.
        await store.setSoundMuted(!store.state.settings.soundMuted);
        return;
      }
      if (action === "settings.setSoundVolume") {
        // Suwak w Podsumowaniu (D3) — właściciel gry wprost zażądał, żeby
        // zmiana głośności TU zapisywała się do game_state (nie do
        // games.settings, skąd wartość początkowa jest tylko wczytana raz
        // przy applyGameSettingsToState) — dzięki temu jest widoczna
        // natychmiast na Wyświetlaczu, jeśli to on gra (soundSource="display").
        const { key, pct } = payload || {};
        if (!key || typeof pct !== "number") return;
        const clamped = Math.max(0, Math.min(100, Math.round(pct)));
        store.state.settings.sound.volumes[key] = clamped;
        await store.commit();
        return;
      }
      if (action === "qr.modal.show") {
        showQrModal(payload);
        return;
      }
      if (action === "devices.copyCode") {
        const code = connectCodes[payload];
        if (code) {
      try { await navigator.clipboard.writeText(code); toast(t("control.copyOk")); }
      catch { toast(t("control.copyFail"), { kind: "error" }); }
    }
        return;
      }
      if (action === "devices.shareOpen") {
        await shareDevice.open(payload);
        return;
      }
      if (action === "devices.shareSendOpen") {
        await shareDevice.openSend(payload);
        return;
      }
      if (action === "devices.next") {
        // Wyjście z podłączania: wracamy do BLACK, jeśli operator zostawił widoczny QR.
        store.state.display.mode = "BLACK";
        store.state.display.qr.host = { show: false, url: null, code: null };
        store.state.display.qr.buzzer = { show: false, url: null, code: null };
        // "Losowo" ma losować OD RAZU i pokazać co wylosowano w Podsumowaniu
        // — nie leniwie dopiero przy pierwszym Starcie rundy/finału.
        await ensureQuestionsDrawn();
        await advance("setup_finish");
        return;
      }
      if (action === "setup.openSettings") {
        // Zwykłe przejście na /games/settings/ (ret = Control); ustawienia
        // zapisują się same, a Control po powrocie wczytuje je od nowa.
        await leaveTo(linkTo("gameSettings", { id: gameId }));
        return;
      }
      if (action === "setup.back") {
        // Dokładnie jak stare control/js/app.js's setup.finish.back ->
        // setActiveCard("devices") — swobodny powrót, nic nie resetuje
        // (parowanie urządzeń i tak zostaje, bo to osobny mechanizm
        // presence, nie stan gry).
        await advance("devices_display");
        return;
      }
      if (action === "setup.start") {
        // D3 to już tylko podsumowanie — drużyny/finał/pytania są od dawna
        // ustawione w games.settings i zdenormalizowane wyżej w main().
        store.state.locks.gameStarted = true;
        // Plan, sekcja 3a pkt 5: "Display zostaje BLACK aż do faktycznego
        // rozpoczęcia gry" — to jest dokładnie ten moment. Bez tego
        // display.mode NIGDZIE indziej nie przechodzi na "GAME" (jedyne inne
        // miejsca ustawiają "BLACK"/"QR"), więc Wyświetlacz zostawałby czarny
        // przez całą grę mimo jej realnego postępu — potwierdzony błąd, nie
        // tylko wrażenie z nagrania.
        store.state.display.mode = "GAME";
        await advance("r_intro", { topCard: "rounds" });
        return;
      }
      if (action === "setup.reshuffleRounds") {
        // Sekcja 3a pkt 1: "Losuj ponownie" — tylko w trybie losowym i tylko
        // przed startem gry (potem pula jest już w grze). Wymusza budowę puli
        // teraz (normalnie leniwie budowana dopiero przy pierwszym
        // START_ROUND), żeby dało się ją przetasować z góry.
        if (store.state.settings.roundsQuestionsMode === "pick" || store.state.locks.gameStarted) return;
        store.state.rounds._questionPool = await pickQuestionPool(store.state);
        await store.commit();
        return;
      }
      if (action === "setup.reshuffleFinal") {
        if (store.state.settings.finalQuestionsMode === "pick" || store.state.locks.gameStarted) return;
        const all = await loadQuestions(store.state.gameId);
        const byId = new Map(all.map((q) => [String(q.id), q]));
        const oldFinal = (store.state.final.picked || []).map((id) => byId.get(String(id))).filter(Boolean);
        const alreadyInRounds = new Set((store.state.rounds._questionPool || []).map((q) => String(q.id)));
        const candidates = [...(store.state.rounds._questionPool || []), ...oldFinal.filter((q) => !alreadyInRounds.has(String(q.id)))];
        const { picked, pickedPreview, roundsPool } = await drawFinalPicks(store.state, candidates);
        store.state.final.picked = picked;
        store.state.final.pickedPreview = pickedPreview;
        store.state.rounds._questionPool = roundsPool;
        store.state.final.confirmed = true;
        await store.commit();
        return;
      }
      if (action === "session.finish") {
        // Gra już zakończona (locks.gameEnded) — czysta nawigacja z powrotem
        // do poprzedniej strony, bez żadnego dalszego zapisu do game_state.
        location.href = backHref("control");
        return;
      }
      if (action === "rounds.introNext") {
        // Dokładnie jak dzisiejsze gameRounds.js: intro logo + dźwięk na
        // starcie gry (nie tylko na końcu — show_intro gra też tutaj).
        await advance("r_roundStart", { phase: "READY" }, "show_intro");
        return;
      }
      // "Zacznij od nowa" wołane z przycisku na ekranie końca gry (obok
      // "Wróć do moich gier") — ta sama funkcja co topbar's #btnStartOver.
      if (action === "game.restart") { await restartGame(); return; }
      // Próbka dźwięku powtórzenia na ekranie "Rozpocznij 2 rundę" — dokładnie
      // jak stare control.html's "final.repeatTest": czysto lokalny podgląd
      // dźwięku, bez żadnego zapisu do game_state (nic w grze się nie zmienia).
      if (action === "final.repeatTest") { playSfx("answer_repeat"); return; }
      // Kafel odliczania na ekranie wpisywania finału — ten sam toggle co
      // skrót Ctrl/Cmd+Shift (patrz toggleFinalTimer wyżej).
      if (action === "final.toggleTimer") { await toggleFinalTimer(payload.round); return; }
      if (action === "game.dispatch") { await dispatchGated(payload); return; }
    } catch (e) {
      console.error("[control2] akcja nie powiodła się:", action, e);
      void sessionTelemetry.report({ kind: "error", message: `${action}: ${e.message || e}` });
      // Zapis nie doszedł (sieć, limit czasu) albo nie wiadomo, czy doszedł:
      // lokalny stan jest już zmieniony optymistycznie. Pobierz prawdę z
      // serwera, żeby panel nie pokazywał czegoś, czego Wyświetlacz nie ma
      // (badanie Control na słabym łączu, 25.10).
      const networkFailure = isNetworkFailure(e);
      if (networkFailure) void store.hydrate().then(() => renderCurrent(), () => {});
      void alertModal({ text: networkFailure ? t("control.actionNetworkFailed") : `${t("control.actionFailed")} ${e.message || e}` });
    }
  }

  function isNetworkFailure(error) {
    const name = String(error?.name || "");
    const message = String(error?.message || "");
    return name === "TypeError" || name === "AbortError" || name === "TimeoutError"
      || /Failed to fetch|NetworkError|Load failed|network|timed out|aborted/i.test(message);
  }

  const btnMute = document.getElementById("btnMute");
  function syncMuteButton() { if (btnMute) btnMute.innerHTML = icon(store.state.settings.soundMuted ? "speaker-off" : "speaker-on"); }
  syncMuteButton();
  btnMute?.addEventListener("click", () => { handle("settings.toggleSoundMuted"); });
  // Zadeklarowane TU (nie przy addEventListener niżej) -- renderCurrent()
  // (zdefiniowane wyżej w pliku, ale wywoływane dopiero na samym końcu,
  // store.subscribe(renderCurrent); renderCurrent();) czyta tę zmienną przy
  // KAŻDYM renderze, więc musi być zainicjalizowana PRZED pierwszym takim
  // wywołaniem, nie dopiero przy swoim listenerze.
  const btnStartOver = document.getElementById("btnStartOver");

  // Wydzielone z topbara, żeby ten sam "Zacznij od nowa" dało się też
  // wywołać z przycisku na ekranach końca gry (control/js/ui.js's
  // renderGameEnd/renderFinalEnd, akcja "game.restart" w handle() niżej) —
  // dokładnie ta sama logika, dwa miejsca wywołania.
  async function restartGame() {
    if (restarting) return;
    const ok = await confirmModal({
      title: "Zacznij od nowa",
      text: "To wróci do podłączania urządzeń i wyzeruje postęp gry (drużyny, pytania, wyniki). Parowanie urządzeń zostaje. Ustawienia zaawansowane zostają zachowane.",
    });
    if (!ok) return;
    connectivityTracker.flush();
    restarting = true;
    dispatchGeneration++;
    try {
      await _dispatchGatedQueue;
      await store.setLock(0);
      lockedUntil = 0;
      await restartGameNow();
    } finally {
      restarting = false;
      renderCurrent();
    }
  }
  async function restartGameNow() {
    const keptAdvanced = {};
    for (const key of ADVANCED_SETTINGS_KEYS) keptAdvanced[key] = store.state.settings[key];
    store.state.locks = { gameStarted: false, finalActive: false, gameEnded: false };
    store.state.teams = { teamA: "", teamB: "" };
    store.state.settings = { ...DEFAULT_SETTINGS, ...keptAdvanced, testMode: store.state.settings.testMode === true };
    store.state.rounds = {
      roundNo: 1, bankPts: 0, xA: 0, xB: 0, totals: { A: 0, B: 0 },
      passUsed: false, allowPass: false, canEndRound: false, lockPlayControls: false,
      question: null, answers: [], revealed: [],
      duel: { enabled: false, lastPressed: null, firstTeam: null, secondTeam: null, currentTeam: null },
      timer3: { running: false, endsAt: 0, resolved: null },
      steal: { active: false, used: false, team: null, won: null },
      stealWon: false, _questionPool: [], _usedQuestionIds: [],
    };
    store.state.final = {
      picked: [], confirmed: false, winnerTeam: null, questions: [],
      runtime: { sum: 0, timer: { running: false, phase: null, endsAt: 0 }, map1: [null,null,null,null,null], map2: [null,null,null,null,null], p1: [null,null,null,null,null], p2: [null,null,null,null,null], reached200: false },
    };
    store.state.display = {
      mode: "BLACK",
      qr: { host: { show: false, url: null, code: null }, buzzer: { show: false, url: null, code: null } },
      colors: store.state.display.colors, theme: store.state.display.theme, logoId: store.state.display.logoId,
      hostLogoMode: store.state.display.hostLogoMode,
    };
    store.state.host = { covered: true }; // ta sama domyślna zasłona co makeDefaultState() — patrz web/js/gameplay/gameStateShape.js
    store.state.step = "devices_display";
    store.state.phase = null;
    store.state.controlTeam = null;
    store.state.topCard = "devices";
    // Naprawiona luka (znaleziona diagnostyką [e2e-diag-state] powyżej):
    // commit() MUSI iść zaraz PO mutacji, bez żadnego await pomiędzy --
    // store.js's commit() czyta state.step/topCard/... SYNCHRONICZNIE, W
    // MOMENCIE WYWOŁANIA, nie w momencie mutacji. Poprzednia wersja robiła
    // await sb().from("games").select(...) PRZED commit() -- w tym oknie
    // (realny network round-trip) potrafiło się dokończyć INNE, już
    // wcześniej w locie będące potwierdzenie zapisu (np. przejście
    // "Gotowe" -> r_intro, którego commitNow() wciąż czekał na sieć),
    // którego applyRow() nadpisywało state.step z powrotem na "r_intro" --
    // więc gdy restartGame() W KOŃCU wołał commit(), payload budował się
    // już z NADPISANEGO, złego state.step, i cały reset ginął bez śladu
    // błędu (na żywo: "Zacznij od nowa" zostawał na starym ekranie).
    // Rozwiązanie: dwa OSOBNE commity -- najpierw reset (zero await
    // pomiędzy mutacją a commit()), dopiero PO nim (na już bezpiecznie
    // zapisanym stanie) odśwież i dograj games.settings drugim commitem.
    await store.commit();
    // D3 znów pokaże podsumowanie games.settings (drużyny/finał/pytania) —
    // odśwież je z bazy, bo mogły się zmienić od czasu wejścia w Control.
    try {
      const { data: freshGame } = await sb().from("games").select("settings").eq("id", gameId).single();
      applyGameSettingsToState(freshGame?.settings, store.state);
      await store.commit();
    } catch (e) {
      console.warn("[control2] odświeżenie games.settings po 'Zacznij od nowa' nie powiodło się:", e);
    }
  }
  // Przez handle(), NIE bezpośrednio restartGame -- jedyny try/catch (linia
  // ~887, alert() na błąd) chroni WYŁĄCZNIE wywołania idące przez handle()
  // (np. action==="game.restart" z ekranu końca gry). Bezpośredni listener
  // na restartGame nie miał żadnej ochrony: jeśli store.commit() rzuci
  // (np. stale_write po wyczerpaniu retry, tuż po serii innych świeżych
  // zapisów), to nieobsłużone odrzucenie Promise z asynchronicznego
  // event listenera -- operator zostaje bez żadnego komunikatu, ciągle na
  // starym ekranie, z zerowym śladem w UI, że coś się nie udało (znalezione
  // przy diagnozie e2e: "Zacznij od nowa" → "Tak" nie wracał do D0, bez
  // żadnego widocznego błędu).
  btnStartOver?.addEventListener("click", () => { handle("game.restart"); });

  controlUIReady = true;
  store.subscribe(renderCurrent);
  completionUIReady = true;
  void refreshDisplayCompletion();
  renderCurrent();
  if (lockedUntil > Date.now()) {
    setTimeout(renderCurrent, lockedUntil - Date.now() + 20);
  }

  // TYMCZASOWA diagnostyka (do usunięcia po znalezieniu przyczyny testów
  // control2 utykających na "Rozpocznij grę" mimo game_state_write
  // zwracającego 200) -- loguje KAŻDĄ zmianę store.state (własny commit
  // ALBO cudzy hydrate() z dzwonka) z realnym stemplem czasu, żeby
  // rozstrzygnąć czy store.state.step faktycznie dochodzi do
  // "r_roundStart" lokalnie (bug w renderze) czy nigdy tam nie dociera
  // (bug wcześniej w łańcuchu -- advance()/commit()/handle()).
  store.subscribe((s) => {
    console.log(`[e2e-diag-state] t=${Date.now()} step=${s.step} phase=${s.phase} rev=${s.rev} topCard=${s.topCard} totals=${JSON.stringify(s.rounds?.totals)} roundNo=${s.rounds?.roundNo} xA=${s.rounds?.xA}`);
  });
}

main().catch((e) => {
  console.error("[control2] błąd startu:", e);
  const root = document.getElementById("app");
  if (root) root.textContent = `Błąd startu: ${e.message || e}`;
});
