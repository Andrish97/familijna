// control/buzzer/js/main.js
// Napisane od zera (nie kopia js/pages/buzzer.js). Wysyłka kliknięcia to
// najważniejsza różnica architektoniczna z całego planu (sekcja 1/4):
// zamiast broadcastu do Control ("BUZZER_EVT CLICK A", wyścig po stronie
// klienta), Buzzer sam woła atomowy RPC game_state_buzzer_press — pierwszy
// zapis wygrywa w bazie, drugi dostaje jawny błąd already_pressed. Trzy
// możliwe wyniki, wszystkie jawne dla kontestanta (plan, sekcja 4):
// sukces (przycisk pokazuje PUSHED_x od razu, przez applyRow), already_pressed
// (przycisk natychmiast pokazuje, kto był pierwszy, przez refetchNow —
// autorytatywny wiersz już to wie), błąd sieci (przycisk wraca do ON,
// można spróbować ponownie).

import { initI18n, setUiLang } from "../../../shared/translation/translation.js?v=v2026-11-05T20040";
import { startKeepAlive } from "../../../shared/js/core/keep-alive.js?v=v2026-11-05T20040";
import { initWakePrompt } from "../../../shared/js/core/wake-prompt.js?v=v2026-11-05T20040";
import { guardViewportWidth } from "../../../shared/js/core/device-guard.js?v=v2026-11-05T20040";
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-05T20040";
import { createSubscription } from "../../../shared/js/core/game-state-subscribe.js?v=v2026-11-05T20040";
import { createButtonRenderer, isLockedRow } from "./render.js?v=v2026-11-05T20040";
import { createPressController } from "./press.js?v=v2026-11-05T20040";
import { createDeviceLease, updateDeviceLeaseOverlay } from "../../../shared/js/core/device-lease.js?v=v2026-11-05T20040";
import { initFullscreenButton } from "../../../shared/js/core/fullscreen.js?v=v2026-11-05T20040";


function parseParams() {
  const u = new URL(location.href);
  return { gameId: u.searchParams.get("id") || "", key: u.searchParams.get("key") || "" };
}

async function main() {
  await initI18n({ withSwitcher: false });
  const controlTestFrame = window.parent !== window
    && window.frameElement?.dataset.controlTestMode === "true";
  const deviceGate = guardViewportWidth({
    minWidth: 0,
    formFactors: controlTestFrame ? null : ["phone", "tablet"],
    requiresTouch: !controlTestFrame,
    allowPhoneLandscape: true,
    requirePhoneLandscape: !controlTestFrame,
    rotateMessageKey: "buzzer.rotateMessage",
  });
  document.documentElement.removeAttribute("data-device-guard-pending");
  if (deviceGate.state() !== "ok") await deviceGate.ready;
  // Utrzymujemy ekran aktywny dopiero po przejściu wspólnego guarda.
  startKeepAlive();
  initFullscreenButton({ button: document.getElementById("btnFullscreen"), a2hs: document.getElementById("buzzerA2HS"), a2hsClose: document.getElementById("buzzerA2HSClose") });
  document.documentElement.classList.remove("page-loading");

  const { gameId, key } = parseParams();
  const loadError = document.getElementById("deviceLoadError");
  const offScreen = document.getElementById("offScreen");
  // iPhone/iPad: ekran „nie wygaszaj” poza pojedynkiem — przyciski działają
  // tylko w kroku r_duel (render.js); tam ekran nie może zabrać naciśnięcia,
  // a samo naciśnięcie jest gestem. Między pojedynkami telefon leży
  // nietknięty najdłużej.
  let lastRowStep = null;
  const wakePrompt = initWakePrompt({ canShow: () => lastRowStep !== "r_duel" });
  const revealStep = (element) => {
    if (!element) return;
    element.hidden = false;
    element.classList.add("skel-step-ready");
  };
  document.querySelector("[data-retry-device]")?.addEventListener("click", () => location.reload());
  if (!gameId || !key) {
    revealStep(loadError);
    return;
  }

  let subscription = null;
  const lease = createDeviceLease({ gameId, deviceType: "buzzer", key, onState: ({ state }) => {
    updateDeviceLeaseOverlay(state);
    if (subscription) {
      if (state === "primary") void subscription.start();
      else subscription.stop();
    }
  } });
  await lease.start();
  updateDeviceLeaseOverlay(lease.state);

  const renderer = createButtonRenderer();
  let lastRow = null;
  let appliedLang = null;
  let lockTimer = null;
  let displayReadyKey = null;
  let displayCheckPendingKey = null;
  // Gotowość Wyświetlacza dla bieżącego przejścia (krok + dźwięk): baza
  // wysyła potwierdzenie planszy na kanał Przycisku (zdarzenie completion,
  // migracja 510); przejście zaczyna się od rewizji, w której zmienił się
  // klucz (taką rewizję żąda trigger request_display_completion).
  let transitionKey = null;
  let transitionRev = null;
  const requestKeyOf = (row) => `${row?.step || ""}:${row?.sound_cue_seq ?? ""}`;
  const isDisplayReady = (row) => Boolean(row && displayReadyKey === requestKeyOf(row));
  function noteTransition(row) {
    const rowKey = requestKeyOf(row);
    if (rowKey === transitionKey) return;
    transitionKey = rowKey;
    transitionRev = Number(row.rev) || 0;
  }
  function applyCompletion(completion) {
    const rendered = Number(completion?.rendered_rev);
    const requested = Number(completion?.requested_rev);
    if (!lastRow || !Number.isFinite(rendered) || !Number.isFinite(requested) || transitionRev == null) return;
    if (rendered >= requested && requested >= transitionRev && displayReadyKey !== transitionKey) {
      displayReadyKey = transitionKey;
      presses.render(lastRow);
    }
  }
  // Przy starcie i po ponownym dołączeniu (wiadomości z przerwy przepadły):
  // jeden odczyt gotowości z bazy.
  async function checkDisplayReady() {
    if (!lastRow) return;
    const row = lastRow;
    const requestKey = requestKeyOf(row);
    if (displayReadyKey === requestKey || displayCheckPendingKey === requestKey) return;
    // A pending RPC for an older transition must not delay the current one.
    // Keep one in-flight request per transition; late replies are ignored.
    displayCheckPendingKey = requestKey;
    try {
      const { data, error } = await sb().rpc("game_state_display_is_ready", { p_game_id: gameId, p_key: key, p_device_type: "buzzer", ...lease.actionArgs() }).abortSignal(AbortSignal.timeout(6500));
      // Completion is requested only when step or sound_cue_seq changes
      // (migration 305). Unrelated revisions, including a buzzer press or
      // locked_until update, must not invalidate an acknowledgment already
      // received for this visual/audio transition.
      if (!error && requestKey === requestKeyOf(lastRow) && data === true) {
        displayReadyKey = requestKey;
        presses.render(lastRow);
      }
    } finally { if (displayCheckPendingKey === requestKey) displayCheckPendingKey = null; }
  }

  // Migracja 264 -- game_state_set_lock (control/js/store.js) NIE dzwoni
  // dzwonkiem i NIE podbija rev (patrz komentarz tam) -- więc bez własnego
  // zegarka Buzzer nigdy by się nie dowiedział, że blokada, którą sam
  // widzi w row.locked_until, naturalnie minęła, dopóki nie przyjdzie
  // KOLEJNY, niepowiązany zapis w grze. Re-render tą samą, już posiadaną
  // treścią (lastRow) wystarczy -- deriveButtonState/isLockedRow przeliczą
  // się na nowo względem aktualnego Date.now().
  function scheduleUnlockRerender(row) {
    clearTimeout(lockTimer);
    lockTimer = null;
    if (!isLockedRow(row)) return;
    const msLeft = new Date(row.locked_until).getTime() - Date.now();
    lockTimer = setTimeout(() => presses.render(lastRow), Math.max(0, msLeft) + 20);
  }

  let initialStateReady = false;
  subscription = createSubscription({
    gameId, deviceType: "buzzer", key,
    getLeaseArgs: () => lease.actionArgs(),
    beforeResync: () => lease.refresh(),
    log: lease.log,
    // Potwierdzenie planszy z bazy (zdarzenie completion na kanale Przycisku).
    onCompletion: applyCompletion,
    // Bez podbicia rev powiadamiamy też o wygaśnięciu blokady i potwierdzeniu
    // renderowania Wyświetlacza; oba pola są dostarczane tym samym strumieniem.
    sameRevChanged: (prev, next) => prev.locked_until !== next.locked_until
      || prev.display_rendered_rev !== next.display_rendered_rev,
    onRow: (row, source) => {
      lease.setProgress({ receivedRev: Number(row.rev) || 0 });
      // Język idzie za operatorem w Control — patrz control/display/js/main.js.
      const lang = row.detail?.settings?.uiLang;
      if (lang && lang !== appliedLang) {
        // appliedLang ustawiane DOPIERO po sukcesie -- patrz identyczny
        // komentarz w control/host/js/main.js: appliedLang=lang PRZED zapisem
        // wyniku setUiLang() + .catch(()=>{}) łykający błąd bez retry
        // zostawiałby stronę trwale w starym języku po przejściowym błędzie
        // (np. sieciowym) przy dynamicznym imporcie słownika.
        setUiLang(lang, { persist: true, updateUrl: true, apply: true })
          .then(() => { appliedLang = lang; })
          .catch((e) => console.warn("[buzzer2] setUiLang nie powiodło się, spróbuję ponownie przy kolejnym wierszu:", e));
      }
      lastRow = row;
      noteTransition(row);
      presses.render(row);
      lastRowStep = row.step || null;
      wakePrompt.sync();
      lease.setProgress({ renderedRev: Number(row.rev) || 0 });
      initialStateReady = true;
      if (loadError) loadError.hidden = true;
      document.getElementById("arena")?.classList.add("skel-step-ready");
      offScreen?.classList.add("skel-step-ready");
      // Wiersz z odczytu (start, ponowne dołączenie): gotowość z bazy.
      if (source !== "broadcast") void checkDisplayReady();
      scheduleUnlockRerender(row);
    },
    onError: (error) => {
      console.warn("[buzzer2] game_state_get failed:", error);
      if (!initialStateReady) revealStep(loadError);
    },
  });

  const presses = createPressController({
    getRow: () => lastRow ? { ...lastRow, display_animation_pending: !isDisplayReady(lastRow) } : null,
    render: (row, team) => renderer.render(row ? { ...row, display_animation_pending: !isDisplayReady(row) } : row, team),
    send: (team) => sb().rpc("game_state_buzzer_press", {
      p_game_id: gameId, p_key: key, p_team: team,
      ...lease.actionArgs(),
    }),
    // Naciśnięcie zapisuje baza i sama wysyła je Control i urządzeniom (510).
    applyRow: (row) => subscription.applyRow(row, "press"),
    refetch: () => subscription.refetchNow(),
    onError: (error) => console.warn("[buzzer2] press failed, spróbuj ponownie:", error),
  });
  const press = presses.press;

  document.getElementById("btnA")?.addEventListener("click", () => press("A"));
  document.getElementById("btnB")?.addEventListener("click", () => press("B"));
  document.getElementById("btnA")?.addEventListener("touchstart", (e) => { e.preventDefault(); press("A"); }, { passive: false });
  document.getElementById("btnB")?.addEventListener("touchstart", (e) => { e.preventDefault(); press("B"); }, { passive: false });

  if (lease.state === "primary") await subscription.start();
}

main();
