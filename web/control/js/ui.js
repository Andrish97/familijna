// control/js/ui.js
// Renderowanie panelu Control v2 — napisane od zera. Zakres celowo
// zawężony zgodnie z sekcją 3b planu: D0/D1/D3 (urządzenia, ustawienia) już
// są OK wizualnie, więc tu dostają prosty, funkcjonalny formularz — dopiero
// Rundy / Finał-wpisywanie / Finał-odsłanianie mają wspólny szablon (jedna
// karta, bez przewijania, mały stepper na górze, nawigacja na dole).
// Dokładny CSS/HTML tych trzech ekranów to celowo pierwsza rzecz do
// wspólnego dopracowania z właścicielem projektu (wizualne, nie
// architektoniczne) — poniższe spełnia twarde reguły z planu, ale nie
// udaje gotowego projektu graficznego.
//
// ui.js nie zna store'a/silnika wprost — dostaje `dispatch(handlerName, payload)`
// i renderuje na podstawie przekazanego `state`. Zero logiki gry tutaj.

// Blok podpowiedzi nad siatką — odpowiednik starego setDuelMsg/setPlayMsg/
// setStealMsg/setRevealMsg/ROUNDS_MSG/FINAL_MSG, ale jako czysta funkcja
// bieżącego game_state (web/js/gameplay/hints.js), nie ulotny stan ustawiany przy
// każdym zdarzeniu — "wszystko idzie przez tabelę stanów".
import { getRoundsHint, getFinalHint, getFinalEntryShortcuts, teamName } from "../../shared/js/gameplay/hints.js?v=v2026-11-05T20052";
import { t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-05T20052";
import { getSfxCategories, getSfxVariant, isSfxPlaying, playSfxPreview, stopSfxPreview, stopSfx, onSfxEnd, setSfxVolume } from "../../shared/js/core/sfx.js?v=v2026-11-05T20052";
import { buildDisplayPreviewRow } from "../../shared/js/gameplay/previewRow.js?v=v2026-11-05T20052";
import { DEFAULT_SETTINGS } from "../../shared/js/gameplay/gameStateShape.js?v=v2026-11-05T20052";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-05T20052";

import { previewPendingRoundEndDestination } from "./engine.js?v=v2026-11-05T20052";
import { fitGameplayText, watchGameplayText } from "./fit-text.js?v=v2026-11-05T20052";
import { displayTextSegments } from "../../shared/js/gameplay/displayText.js?v=v2026-11-05T20052";
import { hasDisplayGlyph } from "../../shared/js/display/fonts.js?v=v2026-11-05T20052";
import { loadFont5x7 } from "../../shared/js/core/logo-preview.js?v=v2026-11-05T20052";
import { FINAL_DISPLAY_MAX } from "../../shared/js/core/answer-text.js?v=v2026-11-05T20052";
import { setCell } from "../../shared/js/core/geometry.js?v=v2026-11-05T20052";


const $ = (id) => document.getElementById(id);
const on = (el, ev, fn) => el && (el[`on${ev}`] = fn);

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") el[k] = v;
    else if (v !== undefined && v !== null) el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) el.appendChild(c);
  return el;
}

function iconNode(name) {
  const template = document.createElement("template");
  template.innerHTML = icon(name);
  return template.content.firstElementChild;
}

function iconLabel(iconName, label, { after = false } = {}) {
  const mark = iconNode(iconName);
  const text = document.createTextNode(label);
  return after ? [text, mark].filter(Boolean) : [mark, text].filter(Boolean);
}

export function createUI({ root, emit }) {
  watchGameplayText(root);
  function clear() { root.innerHTML = ""; }
  function setTopbarProgress(label) {
    const el = document.getElementById("c2TopbarProgress");
    if (el) {
      const [main = "", detail = ""] = String(label || "").split(/\s+[—–]\s+/, 2);
      el.replaceChildren(
        Object.assign(document.createElement("span"), { className: "title", textContent: main }),
        Object.assign(document.createElement("span"), { className: "subtitle", textContent: detail }),
      );
      el.title = label || "";
    }
  }
  function stopSummarySoundPreview() {
    getSfxCategories().forEach(({ key }) => { if (isSfxPlaying(key)) stopSfx(key); });
  }

  // Tryb physicalBuzzer (plan, tabela A/R2): operator wybiera drużynę
  // wprost zamiast czekać na Buzzer — dwuetapowo (zaznacz → potwierdź, jak
  // sekcja 3a pkt 7), więc trzyma się to lokalnie w UI, nie w game_state
  // (nic się jeszcze nie zmieniło w grze, dopóki nie ma potwierdzenia).
  let pendingPhysicalTeam = null;

  // Kafle Rund, które faktycznie zmieniają wynik/przebieg gry (odpowiedź,
  // X, Oddaj kontrolę) też idą przez zaznacz → potwierdź, jak sekcja 3a
  // pkt 7 — pierwsze kliknięcie tylko "uzbraja" kafel (złota obwódka, zero
  // zapisu), drugie kliknięcie NA TYM SAMYM kaflu wysyła akcję. Kliknięcie
  // innego kafla przezbraja zamiast zaliczać stare zaznaczenie. Lokalny
  // stan UI, jak pendingPhysicalTeam — nic się nie zmienia w grze, dopóki
  // nie ma drugiego kliknięcia.
  let armedKey = null;
  let currentState = null;
  let typingPending = false;
  let pendingMappingChoice = null;
  let keyboardTarget = null;
  const mappingInputsPendingBlur = new WeakSet();
  const keyboardActions = new Map();
  function bindShortcut(el, key, run, select) {
    if (!key || (/^[0-9]+$/.test(key) && !/^[1-6]$/.test(key))) return el;
    el.dataset.shortcut = key;
    el.setAttribute("aria-keyshortcuts", key === "reveal" ? "Enter" : key.toUpperCase());
    keyboardActions.set(key, { el, run, select });
    return el;
  }
  function shortcutsAllowed() {
    return ![...document.querySelectorAll(".overlay, [role='dialog']")].some((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden");
  }
  document.addEventListener("pointerdown", (event) => {
    if (root.contains(event.target)) keyboardTarget = null;
  });
  document.addEventListener("keydown", async (event) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !shortcutsAllowed()) return;
    if (event.target.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const key = event.code.startsWith("Key") ? event.code.slice(3).toLowerCase() : event.code.startsWith("Digit") ? event.code.slice(5) : event.key;
    if (key === "m") { event.preventDefault(); emit("settings.toggleSoundMuted"); return; }
    const stepBefore = currentState?.step;
    if (typingPending || pendingMappingChoice) {
      if (key !== "Enter" && !keyboardActions.has(key)) return;
      event.preventDefault();
      if (typingPending) await emit("ui.flushTyping");
      if (pendingMappingChoice) await pendingMappingChoice;
      if (currentState?.step !== stepBefore || !shortcutsAllowed()) return;
    }
    if (key === "Enter") {
      const mapping = /^f_p[12]_map_q[1-5]$/.test(currentState?.step || "");
      const mouseSelection = armedKey?.startsWith("ans:") ? armedKey.slice(4) : armedKey === "acceptBuzz" ? "c" : armedKey === "pass" ? "p" : armedKey === "x" ? "x" : armedKey?.startsWith("timer:") ? "t" : null;
      const selected = keyboardTarget && ["n", "b", "e", "t"].includes(keyboardTarget)
        ? keyboardActions.get(keyboardTarget) : mapping ? keyboardActions.get("reveal") : keyboardActions.get(keyboardTarget || mouseSelection);
      if (mapping) event.preventDefault();
      if (!selected || selected.el.disabled || boardBusy()) return;
      event.preventDefault(); selected.run(); keyboardTarget = null;
      return;
    }
    const selected = keyboardActions.get(key);
    if (!selected || selected.el.disabled || (boardBusy() && key !== "i")) return;
    event.preventDefault(); keyboardTarget = key;
    if (selected.select) {
      const mapping = /^f_p[12]_map_q/.test(currentState?.step || "");
      const work = selected.select();
      if (mapping) {
        keyboardTarget = null;
        pendingMappingChoice = Promise.resolve(work);
        const choice = pendingMappingChoice;
        try { await choice; } finally { if (pendingMappingChoice === choice) pendingMappingChoice = null; }
      }
    } else selected.el.focus();
  });

  // Blokada operatora względem dźwięku/animacji (odsłanianie POJEDYNCZYCH
  // kafli I duże przejścia planszy — Rozpocznij/Zakończ rundę, Rozpocznij
  // finał, Zakończ grę×2 — to dziś JEDEN, wspólny mechanizm, nie dwa różne
  // jak wcześniej) — teraz liczona CENTRALNIE, raz, w control/js/app.js's
  // dispatchGated() (i actionGate.js) przy KAŻDYM dispatch(), automatycznie,
  // z rzeczywistego, potwierdzonego czasu dźwięku. Zgłoszone: "blokowanie
  // akcji względem dźwięku animacji... wszędzie" — poprzedni mechanizm
  // wymagał, żeby KAŻDY onclick w tym pliku z osobna pamiętał wywołać
  // armRevealCooldown()/armBoardTransition() z poprawnym kluczem z góry;
  // znalezione tu kilka miejsc, które o tym zapomniały (ADD_X, ACCEPT_BUZZ,
  // ostatnie "Dalej" rundy 1 finału), dowiodło że to z natury zawodne.
  // ui.js dostaje wynik gotowy, przez ctx.busy — sam nie zarządza już żadnym
  // zegarkiem (zgodne z komentarzem na górze pliku: "ui.js nie zna
  // store'a/silnika wprost... zero logiki gry tutaj").
  let busy = false;
  let devicesBlocked = false;
  function boardBusy() { return busy; }
  function revealLocked() { return busy; }


  // Statusy urządzeń w TOPBARZE (poza #app, statyczne w control2.html) —
  // dokładnie jak dzisiejsze control/js/ui.js's setDeviceBadges: aktualizacja
  // imperatywna przy każdym renderze, nie przebudowa DOM.
  //
  // Zgłoszone: przycisk nieaktywnego urządzenia (noHostTablet/physicalBuzzer)
  // ma zniknąć CAŁKOWICIE, nie tylko przygasnąć jak dawne .opted-out w
  // control/js/app.js (opacity:.3 + pointer-events:none — kropka wciąż tam
  // była, tylko nieklikalna). Tu cały wiersz (#dotHostRow/#dotBuzzerRow)
  // dostaje .hidden (display:none, css/base.css) — reaguje natychmiast, gdy
  // operator zaznaczy checkbox na kroku Urządzeń (ten sam render() na każdą
  // zmianę stanu), więc do kroku Podsumowania wiersz jest już niewidoczny, i
  // zostaje tak przez resztę gry (ten sam warunek co blokada "Dalej" w
  // renderDevicesStep — state.settings.noHostTablet/physicalBuzzer).
  function updateTopbarDots(state, presenceFlags = {}) {
    const skip = { display: false, host: !!state.settings.noHostTablet, buzzer: !!state.settings.physicalBuzzer };
    for (const kind of ["display", "host", "buzzer"]) {
      const dot = $(`dot${kind[0].toUpperCase()}${kind.slice(1)}`);
      if (dot) dot.className = `dot ${presenceFlags[kind] ? "ok" : "bad"}`;
      const row = $(`dot${kind[0].toUpperCase()}${kind.slice(1)}Row`);
      if (row) row.classList.toggle("hidden", skip[kind]);
    }
  }

  // ============================================================
  // D0/D1: parowanie urządzeń — struktura/klasy jak dzisiejsze control.html
  // (device-row/device-row-1/device-row-2/device-row-opt/badge), żeby
  // reużyć control.css один do jednego zamiast osobnego, uproszczonego stylu.
  // ============================================================
  function renderDevicesStep(state, ctx) {
    clear();
    const { urls, presenceFlags = {}, connectCodes = {}, shareBadges = {}, displayAudioUnlocked } = ctx;

    const deviceRow = (label, kind, url, { withQr = false } = {}) => {
      const online = !!presenceFlags[kind];
      const code = connectCodes[kind];
      // Dwie stałe linie w siatce równych kolumn (decyzja 2026-10-21: mniej
      // przycisków, równe szerokości): kod (kliknięcie kopiuje), Udostępnij /
      // akcje urządzenia.
      const codeLine = [
        h("button", { class: "btn device-connect-code", type: "button", title: t("common.copy"), "aria-label": `${t("common.copy")} ${code || ""}`.trim(), onclick: () => emit("devices.copyCode", kind) }, [
          h("span", { class: "device-connect-code-val", text: code || "——————" }),
          iconNode("copy"),
        ]),
      ];
      // Dwa przyciski udostępniania jak w Bazach (decyzja użytkownika 2026-10-23):
      // „Udostępnienia” (lista w tej sesji, licznik) obok kodu i „Udostępnij”
      // (adres + znajomi) — u Wyświetlacza obok „Otwórz”, u reszty w trzeciej linii.
      const sendBtn = h("button", { class: "btn", type: "button", "data-act": "share-send", onclick: () => emit("devices.shareSendOpen", kind) }, iconLabel("envelope-out", t("control.shareDevice")));
      const row2 = [];
      const lines = [];
      if (withQr) {
        const shown = !!state.display.qr[kind].show;
        row2.push(h("button", { class: "btn", type: "button", onclick: () => emit("qr.modal.show", kind) }, iconLabel("qr-code", t("control.qrCodeBtn"))));
        row2.push(h("button", {
          class: `btn ${shown ? "primary" : ""}`, type: "button",
          onclick: () => emit(kind === "host" ? "qr.host.toggle" : "qr.buzzer.toggle"),
        }, iconLabel(shown ? "eye-off" : "qr-code", shown ? t("control.qrHide") : t("control.qrOnDisplayToggle"))));
        lines.push(h("div", { class: "device-row-line device-row-line--single" }, [sendBtn]));
      } else {
        // "Otwórz" ma sens WYŁĄCZNIE dla Wyświetlacza — Prowadzący/Przycisk
        // otwiera się na CUDZYM urządzeniu (tablet/telefon), nie w karcie
        // operatora.
        row2.push(h("a", { class: "btn", href: url, target: "_blank", rel: "noopener" }, iconLabel("display", t("common.open"))));
        row2.push(sendBtn);
      }
      // Zachowaj stałą geometrię karty w trybie testowym. Zawartość wiersza
      // jest niewidoczna i nieaktywna, ale jego miejsce pozostaje zarezerwowane.
      const shared = Number(shareBadges[kind]) || 0;
      codeLine.push(h("button", {
        class: "btn", type: "button", "data-act": "share-list",
        onclick: () => emit("devices.shareOpen", kind),
      }, [
        ...iconLabel("people", t("control.shareDeviceShares")),
        h("span", { class: "badge", "aria-hidden": "true", text: shared > 99 ? "99+" : (shared > 0 ? String(shared) : "") }),
      ]));
      const children = [
        h("div", { class: "device-row-1" }, [
          h("div", { class: "device-name", text: label }),
          h("div", { class: `conn-status ${online ? "conn-status--connected" : "conn-status--disconnected"}`, text: online ? t("control.deviceStatusOk") : t("control.deviceStatusDisconnected") }),
        ]),
      ];
      children.push(h("div", { class: `device-row-2${state.settings.testMode ? " test-mode-reserved" : ""}` }, [
        h("div", { class: "device-row-line" }, codeLine),
        h("div", { class: "device-row-line" }, row2),
        ...lines,
      ]));
      return h("div", { class: "card card--inset device-row", "data-device": kind }, children);
    };

    // Jeden ekran, wszystkie 3 urządzenia naraz — dokładnie jak dzisiejsze
    // control.html (patrz komentarz wprost w jego kodzie: "Step 2
    // (host+buzzer) – usunięty, scalony z step 1"). Wcześniejsza wersja tego
    // pliku rozdzielała Wyświetlacz od Prowadzącego/Przycisku na dwa osobne
    // kroki — to był błąd (odtworzenie martwego, celowo scalonego kodu),
    // poprawiony po korekcie właściciela projektu.
    const rows = [deviceRow(t("control.deviceDisplay"), "display", urls.displayUrl)];

    // Zwijanie przez opt-out: DOKŁADNIE jak dzisiejsze control.html
    // (data-opted-out atrybut na .device-row, control.css's
    // `.device-row[data-opted-out] .device-row-2 { display:none }`) —
    // wiersz zostaje w DOM cały czas (nazwa, badge i checkbox w zwykłym trybie),
    // tylko kod/przyciski chowają się pod checkboxem. Wcześniejsza
    // wersja podmieniała cały wiersz na osobny, ubogi znacznik "pominięty" —
    // zgłoszone jako niezgodne ze starym Control i (w nowej siatce 2x2)
    // powód, dla którego przyciski Prowadzącego/Przycisku się nie mieściły.
    const hostRow = deviceRow(t("control.deviceHost"), "host", urls.hostUrl, { withQr: true });
    const noHostChk = h("input", { type: "checkbox" });
    noHostChk.checked = !!state.settings.noHostTablet;
    on(noHostChk, "change", (e) => emit("devices.noHostTablet", e.currentTarget.checked));
    hostRow.appendChild(h("div", { class: `device-row-opt${state.settings.testMode ? " test-mode-reserved" : ""}` }, [
      h("label", { class: "choice" }, [noHostChk, h("div", { class: "choice-text" }, [
        h("span", { class: "choice-label", text: t("control.noHostTablet") }),
        h("span", { class: "hint", text: t("control.noHostTabletHint") }),
      ])]),
    ]));
    if (state.settings.noHostTablet) hostRow.setAttribute("data-opted-out", "");
    rows.push(hostRow);

    const buzzerRow = deviceRow(t("control.deviceBuzzer"), "buzzer", urls.buzzerUrl, { withQr: true });
    const physBuzzChk = h("input", { type: "checkbox" });
    physBuzzChk.checked = !!state.settings.physicalBuzzer;
    on(physBuzzChk, "change", (e) => emit("devices.physicalBuzzer", e.currentTarget.checked));
    buzzerRow.appendChild(h("div", { class: `device-row-opt${state.settings.testMode ? " test-mode-reserved" : ""}` }, [
      h("label", { class: "choice" }, [physBuzzChk, h("div", { class: "choice-text" }, [
        h("span", { class: "choice-label", text: t("control.physicalBuzzer") }),
        h("span", { class: "hint", text: t("control.physicalBuzzerHint") }),
      ])]),
    ]));
    if (state.settings.physicalBuzzer) buzzerRow.setAttribute("data-opted-out", "");
    rows.push(buzzerRow);

    if (state.settings.testMode) {
      for (const row of rows) {
        row.querySelectorAll("button,input").forEach(el => { el.disabled = true; });
        row.querySelectorAll("a").forEach(el => { el.removeAttribute("href"); el.setAttribute("aria-disabled", "true"); el.tabIndex = -1; });
      }
    }
    const testToggle = h("input", { id: "controlTestToggle", type: "checkbox" });
    testToggle.checked = state.settings.testMode === true;
    testToggle.disabled = ctx.testModeChanging === true || (!testToggle.checked && ctx.testModeAvailable === false);
    // Czytaj z klikniętego pola: reconcileEntry() przenosi ten handler na żywy
    // element, a testToggle jest wtedy odłączoną kopią ze starym stanem.
    on(testToggle, "change", (e) => emit("devices.testMode", e.currentTarget.checked));
    const testChoice = h("div", { class: "control-test-choice" }, [
      h("label", { class: "choice" }, [testToggle, h("span", { text: t("control.testModeLabel") })]),
      h("span", { class: "hint", text: t(ctx.testModeAvailable === false ? "control.testModeTooSmall" : "control.testModeHint"), role: "status" }),
    ]);

    // ===== Dźwięk — JEDNA sekcja, przełącznik dwustanowy w tym samym stylu
    // co "Losowo"/"Wybierz" w ustawieniach gry (.toggle-group/.toggle-item/
    // .toggle-slider, control.css — reużyte 1:1, control2.html i tak już
    // linkuje control.css). Zgłoszone: dawny checkbox z dwoma osobnymi
    // wierszami tekstu wyglądał jak dwie sekcje i był za gadatliwy. =====
    const soundOnDisplay = state.settings.soundSource === "display";
    const soundRadioControl = h("input", { type: "radio", name: "soundSource", value: "control" });
    soundRadioControl.checked = !soundOnDisplay;
    on(soundRadioControl, "change", () => emit("devices.soundSource", "control"));
    const soundRadioDisplay = h("input", { type: "radio", name: "soundSource", value: "display" });
    soundRadioDisplay.checked = soundOnDisplay;
    on(soundRadioDisplay, "change", () => emit("devices.soundSource", "display"));

    const soundRowChildren = [
      h("div", { class: "hint", text: t("control.soundSourceIntro") }),
      h("div", { class: "toggle-group" }, [
        h("label", { class: "toggle-item" }, [soundRadioControl, h("span", { class: "toggle-slider", text: t("control.soundSourceControlOpt") })]),
        h("label", { class: "toggle-item" }, [soundRadioDisplay, h("span", { class: "toggle-slider", text: t("control.soundSourceDisplayOpt") })]),
      ]),
    ];
    if (soundOnDisplay) {
      soundRowChildren.push(h("div", { class: "hint", text: t("control.soundSourceDisplayHint") }));
    }
    rows.push(h("div", { class: "card card--inset device-row" }, [
      h("div", { class: "device-row-1" }, [
        h("div", { class: "device-name", text: t("control.soundSection") }),
      ]),
      h("div", { class: "device-row-opt" }, soundRowChildren),
    ]));
    // Tryb testowy jest kolejną kartą listy urządzeń: bezpośrednio po
    // czterech kartach (Wyświetlacz, Prowadzący, Przycisk, Dźwięk), przed
    // dolną podpowiedzią, separatorem i nawigacją kroku.
    testChoice.classList.add("card", "card--inset", "device-row");
    rows.push(testChoice);

    // Dokładnie jak dzisiejsze btnDevicesNext (control/js/app.js's
    // requiredOnline): Wyświetlacz jest WYMAGANY zawsze (nie ma dla niego
    // odpowiednika opt-outu), Prowadzący/Przycisk są wymagane tylko gdy
    // operator NIE odznaczył odpowiedniej flagi (noHostTablet/physicalBuzzer)
    // — bez tego "Dalej" zostaje zablokowane.
    const displayReady = !!presenceFlags.display;
    const hostReady = !!presenceFlags.host || state.settings.noHostTablet;
    const buzzerReady = !!presenceFlags.buzzer || state.settings.physicalBuzzer;
    const requiredOnline = displayReady && hostReady && buzzerReady;
    const displayAudioReady = state.settings.soundSource !== "display" || displayAudioUnlocked === true;

    // Ten sam bug co "Gotowe — przejdź do rozgrywki" (punkt 25,
    // docs/control-recording-feedback.md) -- gołe `<button class="btn
    // gold">` zamiast navButton(), więc inny styl niż KAŻDE "Dalej" w
    // rozgrywce. Ujednolicone z tej samej przyczyny (zgłoszone: "zobacz
    // też pozostałe przyciski dalej/wstecz jakie mają style").
    const next = navButton(t("common.next"), {
      disabled: ctx.testModeChanging === true || !requiredOnline || !displayAudioReady,
      onclick: () => emit("devices.next"),
    });

    root.appendChild(h("div", { class: "cardBody" }, [
      // .stepTitle zostaje (niewidoczny, display:none w control.css — testy
      // E2E celują w niego jako stabilny selektor kroku, dokładnie jak w
      // starym Control) — postęp kroku jest w topbarze, bez osobnego paska.
      // Tekst .stepTitle NIE idzie przez t() celowo — jest zawsze niewidoczny
      // (display:none) i istnieje wyłącznie jako stabilny selektor testów E2E,
      // więc nie jest to string user-facing.
      h("div", { class: "stepTitle", text: "Urządzenia" }),
      // Przewija się lista kart urządzeń wraz z kartą trybu testowego.
      // Krótka podpowiedź pod listą: zwykła .hint jak w kartach urządzeń.
      h("div", { class: "c2-roundlayout c2-devices-layout" }, [
        h("div", { class: "c2-roundlayout-main" }, [
          h("div", { class: "c2-scroll-area" }, [h("div", { class: "c2-devicerows" }, rows)]),
        ]),
        h("div", { class: `c2-roundlayout-divider${state.settings.testMode ? " test-mode-reserved" : ""}` }),
        h("div", { class: `c2-roundlayout-side${state.settings.testMode ? " test-mode-reserved" : ""}` }, [h("p", { class: "hint", text: t("control.deviceCodeHint") })]),
      ]),
      h("div", { class: "stepFoot" }, [h("div", { class: "stepFootButtons" }, [next])]),
    ]));
  }

  // ============================================================
  // D3: podsumowanie ustawień. Drużyny/finał/tryby doboru pytań/ustawienia
  // zaawansowane są od dawna skonfigurowane na osobnej stronie
  // (game-settings, poza Control) i zdenormalizowane do stanu przez
  // control/js/app.js's applyGameSettingsToState() — to jest wyłącznie
  // READ-ONLY podsumowanie tego, co już ustawiono (plan, tabela D3), nie
  // formularz danych wejściowych.
  // ============================================================
  function colorDots(colors) {
    return h("span", {}, ["A", "B", "BACKGROUND", "DOT"].map((k) =>
      h("span", { style: `display:inline-block;width:14px;height:14px;border-radius:50%;margin-right:4px;background:${colors?.[k] || "#000"};border:1px solid rgba(255,255,255,.3)`, title: k })
    ));
  }

  function displayThemeLabel(theme) {
    const key = String(theme || "").toLowerCase();
    if (key === "classic") return t("control.themeClassic");
    if (key === "modern") return t("control.themeModern");
    if (key === "wings") return t("control.themeWings");
    if (key === "radar") return t("control.themeRadar");
    if (key === "cabinet") return t("control.themeCabinet");
    if (key === "ribbon") return t("control.themeRibbon");
    if (key === "bridge") return t("control.themeBridge");
    return theme || t("control.summaryDefault");
  }

  function summarySection(title, valueNode, extraClass = "") {
    return h("div", { class: `summarySection ${extraClass}`.trim() }, [
      h("div", { class: "summarySectionTitle", text: title }),
      valueNode,
    ]);
  }

  // Podgląd wylosowanej puli ("Losowo ma losować i pokazywać co wylosowano")
  // — przyjmuje tablicę {text} (rounds._questionPool ma je już wprost;
  // final.pickedPreview to ta sama sygnatura, wypełniana przez
  // app.js's drawFinalPicks). Puste/brak = nic jeszcze nie wylosowano.
  function questionPreviewList(items) {
    if (!items || !items.length) return null;
    return h("div", { class: "c2-qpreview" }, items.map((q, i) =>
      h("div", { class: "c2-qpreview-item" }, [
        h("span", { class: "c2-qpreview-num", text: String(i + 1) }),
        h("span", { class: "c2-qpreview-text", text: q.text }),
      ])
    ));
  }

  // Sekcja "Dźwięk" w Podsumowaniu (D3) — odpowiednik starego control.html's
  // #summarySoundList (control/js/app.js:1306+). Suwak tu zmienia głośność
  // NA ŻYWO we wspólnym game_state (nie w games.settings — właściciel gry
  // wprost tego zażądał: "zmiana głośności w podsumowaniu nie zmienia jej w
  // ustawieniach... to musi być w game state"), więc słychać ją też na
  // Wyświetlaczu, gdy soundSource="display". Warianty/pliki własne zostają
  // edytowalne wyłącznie w modalu "Zmień ustawienia" (setup.openSettings) —
  // tu tylko odczyt etykiety + podgląd odtwarzania, bez edycji.
  //
  // Re-render pełnej listy sekcji leci przy KAŻDYM store.commit() (patrz
  // renderCurrent()), więc suwak commitowałby (i pisał do bazy) przy każdym
  // pikselu przeciągnięcia, gdyby robić to na "input" — zamiast tego: "input"
  // tylko aktualizuje etykietę % i głośność lokalnego podglądu/odtwarzania
  // (setSfxVolume, bez zapisu do game_state), "change" (puszczenie suwaka)
  // dopiero emituje właściwy zapis. Dokładnie ten sam kompromis co plan,
  // sekcja 4: "czysto kosmetyczne... może zostać fire-and-forget/debounce".
  function soundSummarySection(state) {
    const cats = getSfxCategories();
    if (!cats.length) return null;
    const lang = getUiLang() || "pl";
    const SVG_PLAY = icon("play");
    const SVG_STOP = icon("stop");

    const rows = cats.map((cat) => {
      const key = cat.key;
      const variant = getSfxVariant(key);
      const variantLabel = cat.sounds?.find((s) => s.file.split("?")[0] === variant.split("?")[0])?.label?.[lang] || variant.split("?")[0];
      const desc = t("gameSettings.sfxDesc." + key) || key;
      const volPct = Math.round((state.settings.sound?.volumes?.[key] ?? 100));

      const playBtn = h("button", { class: "btn sm icon summarySoundPlay", type: "button" });
      playBtn.innerHTML = isSfxPlaying(key) ? SVG_STOP : SVG_PLAY;
      // Handlery działają na żywych elementach z e.currentTarget: po
      // uzgodnieniu DOM zmienne z tego renderu wskazują odłączone kopie.
      on(playBtn, "click", (e) => {
        const button = e.currentTarget;
        document.querySelectorAll(".summarySoundPlay").forEach((other) => { other.innerHTML = SVG_PLAY; });
        if (isSfxPlaying(key)) {
          stopSfxPreview(key);
        } else {
          playSfxPreview(key);
          button.innerHTML = SVG_STOP;
          onSfxEnd(key, () => { button.innerHTML = SVG_PLAY; });
        }
      });

      const volLabel = h("span", { class: "summarySoundVolLabel", text: `${volPct}%` });
      const slider = h("input", { class: "summarySoundVol sound-volume-slider", type: "range", min: "0", max: "100", step: "1", "data-sfx-vol": key });
      slider.value = String(volPct);
      on(slider, "input", (e) => {
        const pct = parseInt(e.currentTarget.value, 10);
        const label = e.currentTarget.closest(".summarySoundRow")?.querySelector(".summarySoundVolLabel");
        if (label) label.textContent = `${pct}%`;
        setSfxVolume(key, pct / 100);
      });
      on(slider, "change", (e) => {
        emit("settings.setSoundVolume", { key, pct: parseInt(e.currentTarget.value, 10) });
      });

      return h("div", { class: "summarySoundRow" }, [
        h("span", { class: "summarySoundDesc", text: desc }),
        h("span", { class: "summarySoundVariant", text: variantLabel }),
        playBtn,
        slider,
        volLabel,
      ]);
    });

    return summarySection(t("control.summarySound"), h("div", { id: "summarySoundList" }, rows), "c2-summary-sound");
  }

  // Wiersz-atrapa "rundy w toku" do podglądu D3 — patrz web/js/gameplay/previewRow.js
  // (ta sama funkcja, którą używa też js/pages/game-settings.js's modal
  // ustawień, żeby oba miejsca nie rozjechały się osobnymi implementacjami).
  // Podgląd dostaje wyłącznie ustawienia z bieżącego wiersza; iframe nie
  // dostaje identyfikatora gry ani klucza urządzenia.
  function buildPreviewRow(state) {
    return buildDisplayPreviewRow({ teams: state.teams, display: state.display });
  }

  // Podglądy obsługują kolejne wiadomości "preview-row" bez przeładowania.
  // Wysyłamy stan, gdy się zmieni, oraz gdy iframe zgłosi gotowość (pierwsze
  // załadowanie albo nowy element po zmianie src).
  const SETUP_PREVIEWS = {
    "familijna:preview-ready": { selector: "#c2DisplayPreview iframe", origin: "*" },
    "familijna:host-preview-ready": { selector: "#c2HostPreview iframe", origin: location.origin },
  };
  let setupPreviewKey = null;
  function postSetupPreview({ selector, origin }, row) {
    root.querySelector(selector)?.contentWindow?.postMessage({ type: "familijna:preview-row", row }, origin);
  }
  function syncSetupPreviews(state) {
    const row = buildPreviewRow(state);
    const key = JSON.stringify(row);
    if (key === setupPreviewKey) return;
    setupPreviewKey = key;
    for (const preview of Object.values(SETUP_PREVIEWS)) postSetupPreview(preview, row);
  }
  window.addEventListener("message", (e) => {
    const preview = SETUP_PREVIEWS[e.data?.type];
    if (!preview || currentState?.step !== "setup_finish") return;
    if (e.source !== root.querySelector(preview.selector)?.contentWindow) return;
    postSetupPreview(preview, buildPreviewRow(currentState));
  });

  function renderSetupFinish(state, ctx = {}) {
    const s = state.settings;
    const d = state.display;
    const hasFinal = s.hasFinal === true;
    const displaySoundNeedsUnlock = s.soundSource === "display" && ctx.displayAudioUnlocked !== true;

    // Podglądy to wewnętrzne iframe: prowadzą wprost na /control/<urządzenie>/,
    // nie przez /go/ (ten służy tylko linkom wychodzącym poza aplikację).
    const previewUrl = (goUrl) => {
      try {
        const url = new URL(goUrl);
        const device = url.searchParams.get("d");
        url.search = "";
        url.pathname = `/control/${device}/`;
        url.searchParams.set("preview", "1");
        url.searchParams.set("lang", getUiLang());
        return url.toString();
      } catch { return null; }
    };
    const previewSrc = ctx.urls?.displayUrl ? previewUrl(ctx.urls.displayUrl) : null;
    const hostPreviewSrc = ctx.urls?.hostUrl ? previewUrl(ctx.urls.hostUrl) : null;

    // Podglądy żyją w <iframe>: przeniesienie albo przebudowa elementu
    // przeładowuje go od zera (zgłoszone: "mruga, a tak głównie jest czarny").
    // render() uzgadnia ten ekran z żywym DOM, więc iframe z tym samym src
    // zostaje na miejscu, a nowy stan podglądu dostaje wiadomością
    // (syncSetupPreviews po uzgodnieniu i przy zgłoszeniu gotowości).
    const finalIncomplete = hasFinal && (state.final.picked?.length !== 5 || !state.final.confirmed);
    const previewFrame = previewSrc ? h("iframe", { src: previewSrc, title: t("control.displayPreviewTitle") }) : null;
    const hostPreviewFrame = hostPreviewSrc ? h("iframe", { src: hostPreviewSrc, title: t("control.hostLogoPreviewTitle") }) : null;
    clear();

    // Brak 5 pytań finału: komunikat w sekcji „Finał” (widoczna od razu; nie w
    // stopce obok przycisków); „Gotowe” wskazuje go przez aria-describedby.
    const finalWarn = finalIncomplete ? h("div", { class: "callout callout--warn", id: "c2FinalIncomplete", role: "status", text: t("control.finalPickIncompleteWarning") }) : null;

    const sections = [
      summarySection(t("control.summaryTeams"), h("div", { class: "summarySectionValue", text: t("control.teamsVsFormat", {
        teamA: state.teams.defaultA === true ? t("control.teamADefault") : state.teams.teamA || t("control.teamADefault"),
        teamB: state.teams.defaultB === true ? t("control.teamBDefault") : state.teams.teamB || t("control.teamBDefault"),
      }) }), "c2-summary-teams"),
      summarySection(t("control.summaryDisplay"), h("div", { class: "summaryDisplayInfo" }, [
        h("div", { class: "summaryDisplayRow" }, [h("span", { class: "summaryDisplayLabel", text: `${t("control.summaryColors")}: ` }), colorDots(d.colors)]),
        h("div", { class: "summaryDisplayRow" }, [h("span", { class: "summaryDisplayLabel", text: `${t("control.summaryTheme")}: ` }), document.createTextNode(displayThemeLabel(d.theme))]),
        h("div", { class: "summaryDisplayRow" }, [h("span", { class: "summaryDisplayLabel", text: `${t("control.summaryLogo")}: ` }), document.createTextNode(d.logoId ? t("control.summaryLogoCustom") : t("control.summaryDefault"))]),
        h("div", { class: "summaryDisplayRow" }, [h("span", { class: "summaryDisplayLabel", text: `${t("control.summaryHostLogo")}: ` }), document.createTextNode(d.hostLogoMode === "pixel" ? t("gameSettings.display.hostLogoPixel") : t("gameSettings.display.hostLogoSource"))]),
        h("div", { id: "c2DevicePreviews" }, [
          h("div", { class: "c2-device-preview-card" }, [h("div", { class: "c2-device-preview-title", text: t("control.displayPreviewTitle") }), h("div", { id: "c2DisplayPreview" }, previewFrame ? [previewFrame] : [])]),
          h("div", { class: "c2-device-preview-card" }, [h("div", { class: "c2-device-preview-title", text: t("control.hostLogoPreviewTitle") }), h("div", { id: "c2HostPreview" }, hostPreviewFrame ? [hostPreviewFrame] : [])]),
        ]),
      ]), "c2-summary-display"),
      soundSummarySection(state),
      summarySection(t("control.summaryFinal"), h("div", { class: "c2-summary-final-body" }, [
        h("div", { class: "summarySectionValue", text: hasFinal ? t("control.toggleYes") : t("control.toggleNo") }),
        finalWarn,
      ].filter(Boolean)), "c2-summary-final"),
    ].filter(Boolean);
    // "Losuj ponownie" mieszka PRZY danej sekcji pytań (nie w stopce z resztą
    // nawigacji) — to akcja dotycząca konkretnie tej puli, nie kroku jako
    // całości. Tylko w trybie losowym (w "pick" kolejność jest już ustalona
    // ręcznie, nie ma czego losować). "Losowo" losuje OD RAZU przy wejściu w
    // ten krok (app.js's ensureQuestionsDrawn) — poniższy podgląd pokazuje
    // CO faktycznie wylosowano, nie tylko sam fakt trybu.
    const roundsValueRow = [document.createTextNode(
      s.roundsQuestionsMode === "pick" ? t("control.roundsOrderFixed", { count: state.rounds._questionPool?.length ?? s.roundsPicked?.length ?? 0 }) : t("control.summaryQModeRandom")
    )];
    if (s.roundsQuestionsMode !== "pick") {
      roundsValueRow.push(h("button", { class: "btn sm", type: "button", onclick: () => emit("setup.reshuffleRounds") }, [document.createTextNode(t("control.reshuffleQuestions"))]));
    }
    const roundsPreview = questionPreviewList(state.rounds._questionPool);
    sections.push(summarySection(t("control.summaryRoundsQuestions"), h("div", {}, [
      h("div", { class: "summaryQMode c2-summary-row" }, roundsValueRow),
      roundsPreview,
    ].filter(Boolean)), "c2-summary-rounds"));

    if (hasFinal) {
      const finalValueRow = [document.createTextNode(
        s.finalQuestionsMode === "pick" ? t("control.finalPickedCount", { count: state.final.picked?.length || 0 }) : t("control.summaryQModeRandom")
      )];
      if (s.finalQuestionsMode !== "pick") {
        finalValueRow.push(h("button", { class: "btn sm", type: "button", onclick: () => emit("setup.reshuffleFinal") }, [document.createTextNode(t("control.reshuffleQuestions"))]));
      }
      const finalPreview = questionPreviewList(state.final.pickedPreview);
      sections.push(summarySection(t("control.summaryFinalQuestions"), h("div", {}, [
        h("div", { class: "summaryQMode c2-summary-row" }, finalValueRow),
        finalPreview,
      ].filter(Boolean)), "c2-summary-final-questions"));
    }

    // Sekcje ustawień układają się w dwóch kolumnach. Dźwięk dostaje cały
    // wiersz, bo jego nazwy plików i sterowanie głośnością potrzebują miejsca.
    const displaySummarySection = sections.find((section) => section.classList.contains("c2-summary-display"));
    const isQuestionSection = (section) => section.classList.contains("c2-summary-rounds") || section.classList.contains("c2-summary-final-questions");
    const questionSummarySections = sections.filter(isQuestionSection);
    const leftSummarySections = sections.filter((section) => !section.classList.contains("c2-summary-display") && !section.classList.contains("c2-summary-sound") && !isQuestionSection(section));
    const rightSummarySections = sections.filter((section) => section.classList.contains("c2-summary-sound"));

    const defaultAdvanced = {
      roundMultipliers: DEFAULT_SETTINGS.roundMultipliers,
      finalMinPoints: DEFAULT_SETTINGS.finalMinPoints,
      finalTarget: DEFAULT_SETTINGS.finalTarget,
      endScreenMode: DEFAULT_SETTINGS.endScreenMode,
      finalPrizeMultiplier: DEFAULT_SETTINGS.finalPrizeMultiplier,
      mainPrizeAmount: DEFAULT_SETTINGS.mainPrizeAmount,
    };
    const advancedLabels = {
      roundMultipliers: t("gameSettings.game.roundMultipliers"),
      finalMinPoints: t("gameSettings.game.finalMinPoints"),
      finalTarget: t("gameSettings.game.finalTarget"),
      endScreenMode: t("gameSettings.game.endModeLabel"),
      finalPrizeMultiplier: t("gameSettings.game.prizeMultiplier"),
      mainPrizeAmount: t("gameSettings.game.prizeAmount"),
    };
    const advancedRows = Object.keys(defaultAdvanced).filter((key) =>
      JSON.stringify(s[key]) !== JSON.stringify(defaultAdvanced[key])
    ).map((key) => {
      let value = Array.isArray(s[key]) ? s[key].join(" · ") : String(s[key]);
      if (key === "endScreenMode") {
        const modeLabels = { logo: t("gameSettings.game.endModeLogoShort"), points: t("gameSettings.game.endModePointsShort"), money: t("gameSettings.game.endModeMoneyShort") };
        value = modeLabels[s[key]] || value;
      }
      return h("div", { class: "c2-advanced-row" }, [
        h("span", { class: "c2-advanced-label", text: advancedLabels[key] || key }),
        h("span", { class: "c2-advanced-value", text: value }),
      ]);
    });
    if (advancedRows.length) {
      leftSummarySections.push(summarySection(t("control.summaryGame"), h("div", { class: "c2-advanced-settings" }, advancedRows), "c2-summary-advanced"));
    }
    // Po dodaniu sekcji ustawień zaawansowanych (push do leftSummarySections).
    const settingSummarySections = [...leftSummarySections, ...rightSummarySections];

    // Zgłoszone: "Gotowe przejdź do rozgrywki ma inny styl niż pozostałe
    // przyciski dalej" — to był gołe `<button class="btn gold">` (globalny
    // styl przycisków apki), nie navButton() jak KAŻDE inne "Dalej" w
    // rozgrywce (btn gold — inny padding/border-radius/
    // czcionka). Ujednolicone: ten sam komponent, ta sama busy/disabled
    // gałąź co resztę (C2-02) — finalIncomplete to statyczna walidacja
    // (disabled, bez pulsowania), boardBusy() to realne oczekiwanie na sieć
    // (busy, pulsuje).
    const start = navButton(t("control.setupDoneBtn"), {
      iconName: "arrow-right", iconAfter: true,
      onclick: () => {
        if (finalIncomplete || displaySoundNeedsUnlock || boardBusy()) return;
        stopSummarySoundPreview(); emit("setup.start");
      },
    });
    start.dataset.c2SummaryStart = "true";
    if (finalIncomplete) start.setAttribute("aria-describedby", "c2FinalIncomplete");
    start.disabled = finalIncomplete || displaySoundNeedsUnlock || boardBusy();
    start.classList.toggle("is-busy", boardBusy() && !finalIncomplete && !displaySoundNeedsUnlock);
    const changeSettings = h("button", { class: "btn sm", type: "button", onclick: () => { stopSummarySoundPreview(); emit("setup.openSettings"); } }, iconLabel("settings", t("control.summarySettingsLink")));
    // "Wstecz" (jak stare control.html's btnSetupFinishBack) — swobodny
    // powrót do Urządzeń, nic nie resetuje. c2-btn-back popycha go do
    // lewej krawędzi stopki (patrz control2.html: .stepFootButtons ma
    // justify-content:flex-end, ten jeden dostaje margin-right:auto).
    const back = h("button", { class: "btn c2-btn-back", type: "button", disabled: boardBusy() ? "" : undefined, onclick: () => { if (!boardBusy()) { stopSummarySoundPreview(); emit("setup.back"); } } }, iconLabel("arrow-left", t("common.back")));
    back.dataset.c2SummaryBack = "true";

    // Płasko, tak jak renderDevicesStep — jedno .cardBody na root, BEZ
    // zagnieżdżonego wewnątrz .card (to była druga, zbędna warstwa: root
    // już siedzi w .control-main-card, które jest jedynym widocznym
    // obramowaniem).
    bindShortcut(changeSettings, "e", () => emit("setup.openSettings"));
    bindShortcut(back, "b", () => emit("setup.back"));
    const editSettings = root.querySelector("#btnOpenGsModal");
    if (editSettings) bindShortcut(editSettings, "e", () => emit("setup.openSettings"));
    const body = [
      // .stepTitle pozostaje stabilnym selektorem E2E; postęp kroku jest
      // pokazany w topbarze, bez dodatkowego paska nad treścią karty.
      h("div", { class: "stepTitle", text: "Podsumowanie" }),
      // .c2-scroll-area: dolne przyciski (Wstecz/Zmień ustawienia/Gotowe) mają
      // zostać wyłączone z przewijania — przewija się TYLKO treść sekcji
      // podsumowania, .stepFoot zawsze zostaje widoczny na dole karty.
      h("div", { class: "c2-scroll-area c2-summary-grid" }, [
        displaySummarySection,
        h("div", { class: "c2-summary-columns" }, settingSummarySections),
        h("div", { class: `c2-summary-question-grid${hasFinal ? " has-final" : ""}` }, questionSummarySections),
      ]),
      h("div", { class: "stepFoot" }, [
        h("div", { class: "stepFootButtons" }, [back, changeSettings, start]),
      ]),
    ];

    root.appendChild(h("div", { class: "cardBody" }, body));
  }


  // ============================================================
  // Wspólny szablon 3 głównych ekranów rozgrywki (sekcja 3b):
  // jedna karta, mały stepper na górze, treść na środku, nawigacja na dole.
  // ============================================================
  function gameplayShell({ stepLabel, question, body, nav }) {
    clear();
    setTopbarProgress(stepLabel);
    // .c2-gameplay-card (720px, wyśrodkowane) tylko TU — na WŁASNYM
    // kontenerze tego szablonu, nie na #app. Urządzenia/Podsumowanie mają
    // zostać na pełną szerokość (patrz control2.html) — tylko te trzy
    // przeprojektowane ekrany rozgrywki mają być węższe (plan, sekcja 3b).
    const navNode = nav
      ? h("div", { class: "c2-gameplay-nav" }, nav)
      : h("div", { class: "c2-gameplay-nav c2-gameplay-nav-empty", "aria-hidden": "true" });
    const cardChildren = [];
    {
      // Każdy krok zachowuje ten sam górny slot (48 px), również wtedy, gdy
      // zgodnie z projektem nie pokazujemy w nim pytania, np. przy wpisywaniu
      // finału. Bez pustego slotu treść dostawała dodatkowe 48 px + odstęp,
      // przez co kafle finału były wyższe niż w pozostałych krokach.
      const questionHeader = h("div", {
        class: `c2-stepper-question${question ? "" : " c2-stepper-empty"}`,
        text: question || "",
        title: question || "",
        "aria-hidden": question ? undefined : "true",
      });
      cardChildren.push(h("div", { class: "c2-stepper" }, [questionHeader]));
    }
    cardChildren.push(
      h("div", { class: "c2-gameplay-body" }, body),
      navNode,
    );
    root.appendChild(h("div", { class: "c2-card-inner c2-gameplay c2-gameplay-card" }, cardChildren));
  }

  // ============================================================
  // Sześciorzędowa siatka współdzielona przez wszystkie kroki rozgrywki —
  // ustalona wspólnie z właścicielem projektu: jednostka to 1/3 szerokości
  // wiersza, niektóre kafle zajmują 1,5 jednostki (pół wiersza). Wewnętrznie
  // 6 kolumn (LCD z 2 i 3), żeby obie szerokości wyrazić całkowitym `span`.
  // Wiersze mają stałą wysokość; nieobecne akcje zostawiają puste miejsca,
  // zamiast przesuwać kafle w siatce.
  const THIRD = (i) => `${i * 2 + 1} / ${i * 2 + 3}`; // i=0,1,2 — 1 jednostka
  const HALF = (i) => `${i * 3 + 1} / ${i * 3 + 4}`;  // i=0,1   — 1,5 jednostki

  // Finał: Wyświetlacz ma 11 miejsc na odpowiedź. Litery, które przy
  // skracaniu odpadną, mają inny kolor (decyzja użytkownika 2026-10-22).
  // Znaki spoza fontu Wyświetlacz pomija — w Control są w czerwonym
  // prostokącie. Font wczytywany raz; do tego czasu bez zaznaczania.
  const FINAL_TEXT_CAPACITY = 11;
  let displayGlyphs = null;
  loadFont5x7().then((glyphs) => { displayGlyphs = glyphs; emit("ui.rerender"); }).catch(() => {});
  const isDisplayable = (ch) => hasDisplayGlyph(displayGlyphs, ch);
  function clipNodes(text) {
    // Spacje w odcinanej części zostają bez przekreślenia (wyglądałyby jak „-”).
    return displayTextSegments(text, FINAL_TEXT_CAPACITY, displayGlyphs ? isDisplayable : null).flatMap((seg) => {
      if (seg.kind === "kept" || seg.kind === "skip") return [document.createTextNode(seg.text)];
      if (seg.kind === "bad") return [h("span", { class: "c2-clip-bad", text: seg.text })];
      return seg.text.split(/(\s+)/).filter(Boolean).map((part) =>
        /^\s/.test(part) ? document.createTextNode(part) : h("span", { class: "c2-clip-cut", text: part }));
    });
  }
  // Pole tekstowe nie koloruje części tekstu, więc pod przezroczystym
  // tekstem pola leży warstwa z tymi samymi literami w kolorach.
  function clipField(inp) {
    const mirror = h("div", { class: "c2-clip-mirror", "aria-hidden": "true" }, clipNodes(inp.value));
    const sync = () => {
      mirror.replaceChildren(...clipNodes(inp.value));
      mirror.scrollLeft = inp.scrollLeft;
    };
    // addEventListener, nie on(): on() ustawia oninput i nadpisałoby zapis.
    for (const type of ["input", "scroll", "keyup", "select", "focus", "blur"]) inp.addEventListener(type, sync);
    return h("div", { class: "c2-clip-field" }, [inp, mirror]);
  }

  function tile(content, { row, col, shortcut, cls = "", onclick, disabled = false } = {}) {
    const el = h("button", {
      class: `c2-tile ${cls}`.trim(),
      type: "button",
      onclick: disabled ? undefined : onclick,
    }, [typeof content === "string" ? document.createTextNode(content) : content]);
    setCell(el, row, col);
    if (disabled) el.disabled = true;
    return bindShortcut(el, shortcut, onclick);
  }

  // Samodzielny przycisk nawigacji (nie kafel siatki) z tym samym
  // bezpiecznym wzorcem obsługi `disabled` co tile() — h()'s generic
  // setAttribute("disabled", false) zostawiłoby atrybut OBECNY (a więc
  // przycisk martwy) nawet przy disabled=false, więc właściwość ustawiana
  // jest wprost, TYLKO gdy true. Używane przez pięć dużych przejść planszy
  // (Rozpocznij rundę/Zakończ rundę/Rozpocznij finał/Zakończ grę×2),
  // blokowanych przez boardBusy() — patrz control/js/app.js's dispatchGated().
  // `busy` (osobno od `disabled`) oznacza WYŁĄCZNIE boardBusy() — "trwa
  // animacja/dźwięk dużego przejścia planszy", network round-trip w locie.
  // Tylko TEN stan dostaje pulsujący przycisk ("trwa coś", nie "nic się nie
  // dzieje"). `disabled` samo w sobie (np. "jeszcze nie wszystko odkryte",
  // "trwa odliczanie gracza", "punkty jeszcze nie pokazane") to zwykła,
  // NIEPULSUJĄCA blokada — przycisk po prostu jeszcze nie jest dostępny,
  // nic "nie trwa" w tle, więc nie ma czego sygnalizować.
  //
  // Zgłoszone: "wszystkie przyciski dalej migają" — przyczyna: dawniej
  // JEDEN parametr `disabled` włączał pulsowanie bezwarunkowo, więc każde
  // wywołanie, które domieszało do boardBusy() inny powód blokady (np.
  // `disabled: boardBusy() || timerRunningNow` na ekranie wpisywania finału)
  // pulsowało przez CAŁY czas trwania TEGO powodu (np. całe 15-20s
  // odliczania gracza), nie tylko podczas realnego oczekiwania na sieć/
  // dźwięk. Rozdzielenie na dwa parametry naprawia to raz, w jednym miejscu,
  // zamiast w każdym z 11 wywołań osobno.
  function navButton(label, { shortcut = "n", cls = "btn gold", onclick, disabled = false, busy = false, iconName = null, iconAfter = false } = {}) {
    const isDisabled = disabled || busy;
    const isNext = label === t("common.next");
    const children = iconName
      ? iconLabel(iconName, label, { after: iconAfter })
      : isNext ? iconLabel("arrow-right", label, { after: true }) : [document.createTextNode(label)];
    const el = h("button", { class: cls, type: "button", onclick: isDisabled ? undefined : onclick }, children);
    if (isDisabled) el.disabled = true;
    if (/^f_p[12]_entry$/.test(currentState?.step || "") && shortcut === "n") el.dataset.entryNext = "true";
    return bindShortcut(el, shortcut, onclick);
  }

  function tileGrid(tiles) {
    return h("div", { class: "c2-tilegrid" }, tiles.filter(Boolean));
  }

  // Wariant tile() z zaznacz → potwierdź (patrz armedKey wyżej): pierwsze
  // kliknięcie tylko uzbraja (dopisuje c2-tile-armed, złota obwódka w CSS),
  // drugie na tym samym kaflu odpala prawdziwe onclick.
  function armableTile(key, content, { onclick, disabled, cls = "", ...rest }) {
    const armed = !disabled && armedKey === key;
    const el = tile(content, {
      ...rest,
      disabled,
      cls: `${cls} ${armed ? "c2-tile-armed" : ""}`.trim(),
      // Pierwszy tap widocznie zaznacza kafel. Drugi tap na tym samym
      // aktywnym kaflu zatwierdza; nie polegamy na dblclick/click.detail,
      // które działają niespójnie na urządzeniach dotykowych.
      onclick: disabled ? undefined : () => {
        if (armedKey === key) {
          armedKey = null;
          onclick();
        } else {
          armedKey = key;
          emit("ui.rerender");
        }
      },
    });
    const shortcut = key.startsWith("ans:") ? key.slice(4) : key === "pass" ? "p" : key === "x" ? "x" : key.startsWith("map-answer:") || key.startsWith("map-points:") ? "reveal" : null;
    return bindShortcut(el, shortcut, onclick, () => { armedKey = key; emit("ui.rerender"); });
  }

  // Blok podpowiedzi — zawsze bezpośrednio NAD siatką/wierszami wpisywania,
  // dokładnie jak stary control/js/gameRounds.js's msgDuel/msgRoundsPlay/
  // msgSteal itd. Pusty tekst = nic nie renderujemy (nie zostawiamy pustego
  // paska).
  // `shortcuts`, gdy podane (control/js/ui.js's renderFinalEntry) — lista
  // opisów skrótów klawiszowych (web/js/gameplay/hints.js's getFinalEntryShortcuts),
  // dopisana POD głównym hintem, oddzielona własną kreską, nie zamiast niego.
  function hintBlock(text, shortcuts, extraClass = "") {
    if (!text && !(shortcuts && shortcuts.length)) return null;
    const children = [];
    if (text) children.push(h("div", { class: "c2-hint-main", text }));
    if (shortcuts && shortcuts.length) {
      children.push(h("div", { class: "c2-hint-shortcuts" }, [
        h("div", { class: "c2-hint-shortcuts-title", text: `${t("control.keyboardShortcutsTitle")}:` }),
        ...shortcuts.map((s) => h("div", { class: "c2-hint-shortcut", text: s })),
      ]));
    }
    return h("div", { class: `c2-hint ${extraClass}`.trim() }, children);
  }

  // r_duel PRZED przyjęciem zgłoszenia — patrz komentarz przy jego jedynym
  // wywołaniu w renderRounds(). Odpowiednik starego control.html's osobnego
  // data-step="r_duel": pytanie w stałym pasku nagłówka i kafle "kto naciśnie pierwszy".
  // Ten sam wspólny szablon co reszta Rund — TA SAMA siatka 6-kolumnowa
  // (tile/tileGrid) i ten sam c2-roundlayout (siatka + kreska + hint po
  // prawej), tylko zamiast odpowiedzi w kaflach siedzą przyciski
  // zatwierdzania: 2 przyciski = jeden rząd (HALF+HALF), 3 przyciski = dwa
  // w jednym rzędzie + jeden na całą szerokość w drugim (jak "Oddaj
  // kontrolę"). Nieaktywny kafel korzysta z tego samego :disabled co reszta
  // siatki (wyszarzony, nieklikalny placeholder) — nic tu nie jest osobnym,
  // bespoke komponentem.
  // Zgłoszone: oba tryby (physicalBuzzer/normalny Buzzer) mają identyczny
  // układ ekranu — rząd 1: dwie drużyny (w trybie physicalBuzzer klikalne,
  // operator nimi WSKAZUJE kto nacisnął; w trybie normalnym to czysty
  // wskaźnik duel.lastPressed, nieklikalny — zaznaczenia dokonuje realny
  // Buzzer, nie kliknięcie na tym ekranie); rząd 2: JEDEN wspólny przycisk
  // "Zatwierdź: <wskazana drużyna>", zaznacz → potwierdź (ACCEPT_BUZZ to
  // konsekwentna akcja, przyznaje kontrolę); rząd 3: "Ponów naciśnięcie"
  // (RETRY_DUEL, pojedynczy klik — bezpieczne, odwracalne otwarcie Buzzera
  // na nowo) WYŁĄCZNIE w trybie normalnym, gdy jest co odrzucić — w trybie
  // physicalBuzzer operator po prostu klika drugą drużynę, bez osobnego
  // "cofnij".
  function renderDuelAccept(state) {
    const r = state.rounds;
    const tiles = [];
    const isPhysical = state.settings.physicalBuzzer === true;
    const selectedTeam = isPhysical ? pendingPhysicalTeam : r.duel.lastPressed;

    // boardBusy(): ten sam floor co control/js/gameRounds.js's
    // enableBuzzerDuel(), które stary kod wołał DOPIERO po `await`
    // dźwięku/animacji startu rundy — ten ekran nie ma być klikalny,
    // zanim ta sekwencja (dziś: control/js/app.js's dispatchGated() po
    // "Rozpocznij rundę") się nie skończy.
    tiles.push(tile(teamName(state, "A"), {
      shortcut: isPhysical ? "a" : null, row: 1, col: HALF(0), cls: selectedTeam === "A" ? "c2-tile-primary" : "",
      disabled: isPhysical ? boardBusy() : true,
      onclick: isPhysical && !boardBusy() ? () => { pendingPhysicalTeam = "A"; emit("ui.rerender"); } : undefined,
    }));
    tiles.push(tile(teamName(state, "B"), {
      shortcut: isPhysical ? "b" : null, row: 1, col: HALF(1), cls: selectedTeam === "B" ? "c2-tile-primary" : "",
      disabled: isPhysical ? boardBusy() : true,
      onclick: isPhysical && !boardBusy() ? () => { pendingPhysicalTeam = "B"; emit("ui.rerender"); } : undefined,
    }));

    if (selectedTeam) {
      const acceptArmKey = "acceptBuzz";
      const acceptClickable = !boardBusy();
      const acceptArmed = acceptClickable && armedKey === acceptArmKey;
      tiles.push(tile(t("control.roundsBuzzAcceptTeam", { name: teamName(state, selectedTeam) }), {
        shortcut: "c", row: 2, col: "1 / 7", cls: acceptArmed ? "c2-tile-armed" : "",
        disabled: !acceptClickable,
        onclick: acceptClickable ? () => {
          if (armedKey === acceptArmKey) {
            armedKey = null;
            const team = selectedTeam;
            if (isPhysical) pendingPhysicalTeam = null;
            emit("game.dispatch", { type: "ACCEPT_BUZZ", team });
          } else {
            armedKey = acceptArmKey;
            emit("ui.rerender");
          }
        } : undefined,
      }));
    }

    const confirm = keyboardActions.get("c");
    if (confirm) {
      confirm.select = () => { armedKey = "acceptBuzz"; emit("ui.rerender"); };
      confirm.run = () => emit("game.dispatch", { type: "ACCEPT_BUZZ", team: selectedTeam });
    }
    for (const key of ["a", "b"]) {
      const teamAction = keyboardActions.get(key);
      if (teamAction) { teamAction.select = teamAction.run; teamAction.run = () => emit("game.dispatch", { type: "ACCEPT_BUZZ", team: key === "a" ? "A" : "B" }); }
    }
    if (!isPhysical && r.duel.lastPressed) {
      tiles.push(tile(t("control.roundsBuzzRetry"), { row: 3, col: "1 / 7", disabled: boardBusy(), onclick: () => emit("game.dispatch", { type: "RETRY_DUEL" }) }));
    }

    const body = [h("div", { class: "c2-roundlayout" }, [
        h("div", { class: "c2-roundlayout-main" }, [tileGrid(tiles)]),
        h("div", { class: "c2-roundlayout-divider" }),
        h("div", { class: "c2-roundlayout-side" }, [hintBlock(getRoundsHint(state))]),
      ])];

    gameplayShell({ stepLabel: t("control.stepDuelTitle", { round: r.roundNo }), question: r.question?.text, body, nav: null });
  }

  // ---- Rundy (r_intro..r_gameEnd) ----
  function renderRounds(state) {
    const r = state.rounds;
    // r_intro/r_roundStart: te same dwa przejściowe ekrany co stare
    // control.html's data-step="r_intro"/"r_roundStart" (duży tytuł +
    // wyjaśnienie co się zaraz stanie na Wyświetlaczu/u Prowadzącego + jeden
    // złoty przycisk) — nie goły "Dalej" bez kontekstu. "Rozpocznij grę"
    // odpala intro (logo+dźwięk, app.js's rounds.introNext), "Rozpocznij
    // rundę" odpala START_ROUND (pusta plansza+pytanie, dźwięk
    // round_transition — engine.js/soundReactor.js).
    if (state.step === "r_intro") {
      // Nagłówek = "Rozpoczęcie gry" — PODMIENIONY z dawnego "Intro gry"
      // (nie doklejony za myślnikiem — "Intro gry — rozpoczęcie gry" było
      // tautologią, tak samo jak przy Podsumowaniu). To jeszcze nie jest
      // sekcja Rund (zgłoszone jako mylące: "Gotowe — przejdź do rund"
      // prowadziło na ekran podpisany "Rundy", zanim runda w ogóle istnieje).
      gameplayShell({
        stepLabel: t("control.introStepTitle"),
        body: [h("div", { class: "c2-intro" }, [
          h("div", { class: "c2-intro-hint", text: t("control.roundsIntroHint") }),
        ])],
        nav: [navButton(t("control.roundsIntroBtn"), {
          busy: boardBusy(),
          onclick: () => emit("rounds.introNext"),
        })],
      });
      return;
    }
    if (state.step === "r_roundStart") {
      // Wynik pokazany dopiero OD RUNDY 2 — w rundzie 1 zawsze 0:0 (nic
      // jeszcze się nie rozegrało), więc nie niesie żadnej informacji.
      const scoreRow = r.roundNo > 1 ? h("div", { class: "c2-intro-score" }, [
        h("span", { class: "c2-intro-score-a", text: t("control.scoreLine", { name: teamName(state, "A"), points: r.totals.A }) }),
        h("span", { class: "c2-intro-score-sep", text: t("common.emDash") }),
        h("span", { class: "c2-intro-score-b", text: t("control.scoreLine", { name: teamName(state, "B"), points: r.totals.B }) }),
      ]) : null;
      gameplayShell({
        stepLabel: t("control.roundStepLabel", { round: r.roundNo }),
        body: [h("div", { class: "c2-intro" }, [
          h("div", { class: "c2-intro-hint", text: t("control.roundsStartHint") }),
          scoreRow,
        ].filter(Boolean))],
        nav: [navButton(t("control.roundsStartBtn"), {
          busy: boardBusy(),
          onclick: () => emit("game.dispatch", { type: "START_ROUND" }),
        })],
      });
      return;
    }

    // r_duel PRZED przyjęciem zgłoszenia (r.duel.firstTeam jeszcze puste) —
    // osobny, mniejszy ekran: siatka nie pokazuje jeszcze X ani timera
    // grywalne (nikt nie wygrał prawa do odpowiedzi), więc nie pokazujemy
    // tego wcale, dokładnie jak stary control.html's osobny
    // data-step="r_duel" (drużyny, zatwierdzenie zgłoszenia i pytanie;
    // X/timer pojawiają się po przyjęciu zgłoszenia) — patrz renderDuelAccept().
    if (state.phase === "DUEL" && !r.duel.firstTeam) {
      return renderDuelAccept(state);
    }
    if (pendingPhysicalTeam) {
      pendingPhysicalTeam = null; // faza się zmieniła spod nas — porzuć nieaktualne zaznaczenie
    }

    // r_play / dalsza część DUEL po przyjęciu zgłoszenia (wspólny ekran gry
    // właściwej — drużyna, która wygrała pojedynek, odpowiada na TĘ SAMĄ
    // widoczną siatkę). Pytanie jest w stałym pasku nagłówka; poniżej dwie kolumny —
    // siatka odpowiedzi (lewo) i podpowiedź za pionową kreską (prawo); pod
    // tym pasek statusu (kto gra, bank, inne info); na samym dole przyciski
    // nawigacji ("Zakończ rundę" — gameplayShell's nav, jak Finał).
    const body = [];

    // Raz osiągnięte canEndRound (wszystko odsłonięte albo kradzież już
    // rozstrzygnięta) nie ma już nic do pudłowania/odmierzania — X i zegarek
    // znikają razem, zostaje tylko "Zakończ rundę" w nav na dole.
    const xAvailable = ((state.phase === "DUEL" && r.duel.firstTeam) || state.phase === "PLAY" || state.phase === "STEAL")
      && !r.canEndRound && !r.lockPlayControls;
    const finishingGame = r.canEndRound && ["PLAY", "STEAL"].includes(state.phase) && previewPendingRoundEndDestination(state) === "GAME_END";
    const passAvailable = !finishingGame && state.phase === "PLAY" && r.allowPass && !r.passUsed;
    const stealResolved = state.phase === "STEAL" && r.steal.used === true;

    // Uzbrojony kafel z poprzedniego renderu mógł przestać być prawdziwy
    // (odpowiedź już odsłonięta gdzie indziej, runda się skończyła...) —
    // walidacja przy każdym renderze, żeby złota obwódka nigdy nie została
    // "zawieszona" na czymś nieaktualnym.
    if (armedKey) {
      const validAnswerArm = armedKey.startsWith("ans:") && !r.revealed.includes(Number(armedKey.slice(4)));
      const validPassArm = armedKey === "pass" && passAvailable;
      const validXArm = armedKey === "x" && xAvailable;
      if (!validAnswerArm && !validPassArm && !validXArm) armedKey = null;
    }

    // Siatka 3x5: wiersze 1-3 to do 6 odpowiedzi (2 na wiersz, 1,5 jednostki
    // szerokości) — TREŚĆ i PUNKTY widoczne zawsze (operator musi wiedzieć,
    // co klika i ile to warte, zanim jeszcze odsłoni), po odsłonięciu zmienia
    // się tylko KOLOR/styl kafla (zielony), nie treść. Wiersz 4: "Oddaj
    // kontrolę" (dawny Pass) — jedyny kafel w tym wierszu, widoczny tylko
    // dopóki dostępny. Wiersz 5: X (z licznikiem pudeł na przycisku) /
    // przycisk zegarka 3s, po 1,5 jednostki szerokości każdy — osobny kafel
    // licznika zniknął, bo liczba pudeł mieści się w etykiecie samego X.
    // Odpowiedź/X/Oddaj kontrolę idą przez armableTile (zaznacz → potwierdź,
    // sekcja 3a pkt 7) — to jedyne trzy kafle, które realnie zmieniają
    // wynik/przebieg rundy, więc każdy dostaje ten sam bufor przeciwko
    // przypadkowemu kliknięciu na żywej transmisji.
    const tiles = [];
    const sortedAnswers = r.answers.slice(0, 6);
    sortedAnswers.forEach((a, i) => {
      const revealed = r.revealed.includes(a.ord);
      // Punkty w nawiasie, TAK SAMO jak Finał-mapowanie (control/js/ui.js's
      // renderFinalMapping) i stary Control — dawny myślnik tutaj był
      // niespójny z resztą aplikacji (zgłoszone).
      tiles.push(armableTile(`ans:${a.ord}`, `${a.text} (${a.fixed_points})`, {
        row: Math.floor(i / 2) + 1,
        col: HALF(i % 2),
        cls: revealed ? "c2-tile-revealed" : "",
        // revealLocked(): dopóki dźwięk POPRZEDNIEGO odsłonięcia jeszcze
        // gra, żaden kolejny kafel nie jest klikalny (zgłoszone: "nie idzie
        // odsłonić następnej odpowiedzi jeśli pierwsza się nie pojawiła
        // jeszcze na ekranie"). REVEAL_ANSWER i REVEAL_LEFT zawsze zwracają
        // soundCueKey "answer_correct" (engine.js) — trafienie odpowiedzi
        // zawsze oznacza dźwięk poprawnej odpowiedzi, niezależnie od fazy.
        // Po rozstrzygniętej kradzieży zostaje tylko „Zakończ rundę” (silnik
        // i tak odrzuca kolejne odsłonięcie przed końcem rundy).
        disabled: finishingGame || revealed || stealResolved || revealLocked(),
        onclick: () => emit("game.dispatch", { type: state.phase === "REVEAL" ? "REVEAL_LEFT" : "REVEAL_ANSWER", ord: a.ord }),
      }));
    });

    // Pytanie jest w stałym pasku po lewej stronie nagłówka. Wiersze siatki
    // pozostają równe i przeznaczone na kafle akcji; "Oddaj kontrolę" jest
    // w wierszu 5, X/Timer w wierszu 6.
    if (passAvailable) {
      tiles.push(armableTile("pass", t("control.roundsPassControl"), {
        row: 5, col: "1 / 7", cls: "c2-tile-primary",
        disabled: revealLocked(),
        onclick: () => emit("game.dispatch", { type: "PASS" }),
      }));
    }

    const timer3 = r.timer3;
    const timer3Available = xAvailable;
    if (xAvailable) {
      // Licznik na X ma sens TYLKO w zwykłym PLAY (buduje się do 3, po
      // trzecim aut. STEAL) — w DUEL i w samej kradzieży to zawsze
      // pojedyncza próba, xA/xB drużyny grającej nie ma tam nic do rzeczy.
      const strikes = state.phase === "PLAY" && state.controlTeam
        ? (state.controlTeam === "A" ? r.xA : r.xB)
        : null;
      const xLabel = strikes == null ? "X" : h("div", {}, [
        document.createTextNode("X"),
        // aria-hidden: licznik jest czysto wizualny, żeby dostępna nazwa
        // przycisku ("X") zostawała stała między kliknięciami — inaczej
        // testy/czytniki ekranu widziałyby za każdym razem inny label.
        h("div", { class: "c2-tile-sub", "aria-hidden": "true", text: `${strikes} / 3` }),
      ]);
      tiles.push(armableTile("x", xLabel, {
        row: 6, col: HALF(0), cls: "c2-tile-danger",
        disabled: revealLocked(),
        onclick: () => emit("game.dispatch", { type: "ADD_X" }),
      }));
    }
    if (timer3Available) {
      const running = !!timer3?.running;
      const secLeft = running ? Math.max(0, Math.ceil((timer3.endsAt - Date.now()) / 1000)) : null;
      // Zgłoszone: da się zatrzymać zegarek ponownym kliknięciem — tak jak
      // już działa dla zegarka finału (finalTimerRow niżej). Ponowne
      // kliknięcie w trakcie odliczania dispatchuje CANCEL_TIMER3 (ten sam
      // reducer, co dziś kasuje TYLKO zastały, wygasły podczas nieobecności
      // zegarek przy wznowieniu Control — tu użyty też do świadomego,
      // ręcznego przerwania na żywo: bez naliczania X, runda zostaje
      // dokładnie tam, gdzie była). Stała, dostępna nazwa przycisku
      // ("Zatrzymaj") + cyfry aria-hidden, ten sam wzorzec co licznik X i
      // finalTimerRow — czytnik ekranu/testy nie widzą innego labelu co sekundę.
      const content = running ? h("div", {}, [
        h("span", { "aria-hidden": "true" }, [document.createTextNode(String(secLeft))]),
        h("div", { class: "c2-tile-sub", text: t("control.finalTimerStopShort") }),
      ]) : t("control.roundsStartTimer3");
      const timer3Tile = tile(content, {
        shortcut: "t", row: 6, col: HALF(1),
        cls: running ? "c2-tile-timer" : "c2-tile-timer startable",
        disabled: revealLocked(),
        onclick: () => emit("game.dispatch", { type: running ? "CANCEL_TIMER3" : "START_TIMER3" }),
      });
      // data-timer-role: pozwala tickTimers() (niżej) znaleźć TEN konkretny
      // element i podmienić tylko treść cyfr co 250ms — zgłoszone: "licznik
      // i przyciski cały czas migają" — poprzednio KAŻDY tik odliczania
      // wołał pełny render() (root.innerHTML="" + odbudowa całego drzewa),
      // co niszczyło m.in. fokus pól tekstowych wpisywania w finale i
      // restartowało animacje/hover wszystkich, niezwiązanych przycisków.
      if (running) timer3Tile.dataset.timerRole = "timer3";
      tiles.push(timer3Tile);
    }

    const roundsGrid = tileGrid(tiles);
    body.push(h("div", { class: "c2-roundlayout" }, [
      h("div", { class: "c2-roundlayout-main" }, [roundsGrid]),
      h("div", { class: "c2-roundlayout-divider" }),
      h("div", { class: "c2-roundlayout-side" }, [hintBlock(getRoundsHint(state))]),
    ]));

    // Pasek statusu — kto gra, bank, status kradzieży. Bank żył wcześniej
    // DWA razy (nad siatką i w nagłówku kroku) — teraz wyłącznie tu.
    // "Gra:" zamiast "Kontrolę ma:" — od momentu przyjęcia zgłoszenia w
    // pojedynku (jeszcze przed formalnym controlTeam z PLAY) ktoś już
    // faktycznie odpowiada, więc dawna nazwa myliła: sugerowała, że w
    // DUEL nikt nie ma "kontroli", a jednak ktoś zawsze wtedy gra.
    const activeTeam = state.controlTeam || (state.phase === "DUEL" ? r.duel.currentTeam : null);
    // Wynik obu drużyn NA ŻYWO, nie tylko na ekranie przejścia między
    // rundami (r_roundStart) — zgłoszone: operator chce wiedzieć W TRAKCIE
    // gry, czy ta runda przybliża do progu finału, bez patrzenia na
    // Wyświetlacz. Ten sam wzorzec (etykieta + pogrubiona wartość) co
    // "Gra:"/"Bank:" niżej, nie duży nagłówkowy c2-intro-score (ten ma
    // rozmiar czcionki dobrany pod pełnoekranowy ekran przejścia, nie pod
    // wąski pasek statusu).
    const statusItems = [
      h("span", {}, [document.createTextNode(`${teamName(state, "A")}: `), h("b", { text: String(r.totals.A) })]),
      h("span", {}, [document.createTextNode(`${teamName(state, "B")}: `), h("b", { text: String(r.totals.B) })]),
      ...(state.phase === "REVEAL" ? [] : [h("span", {}, [document.createTextNode(t("control.statusPlayingLabel")), h("b", { text: activeTeam ? teamName(state, activeTeam) : t("common.emDash") })])]),
      h("span", {}, [document.createTextNode(t("control.statusBankLabel")), h("b", { text: String(r.bankPts) })]),
    ];
    if (state.phase === "STEAL" && r.steal.active) {
      statusItems.push(h("span", {}, [document.createTextNode(t("control.statusStealLabel")), h("b", { text: r.steal.team ? teamName(state, r.steal.team) : t("common.emDash") })]));
    }
    // Wyniki, bank i akcja przejścia tworzą wspólny dolny pasek. gameplayShell
    // umieszcza go w stałym miejscu pod siatką, więc kafle wypełniają całą
    // przestrzeń aż do niego.
    if ((state.phase === "PLAY" || state.phase === "STEAL") && r.canEndRound) {
      const label = previewPendingRoundEndDestination(state) === "GAME_END"
        ? t("control.roundsGoToGameEndBtn") : t("control.roundsEndRound");
      statusItems.push(navButton(label, {
        cls: "btn gold c2-statusbar-end",
        busy: boardBusy(),
        onclick: () => emit("game.dispatch", { type: "END_ROUND" }),
      }));
    }
    // R8 (odkrywanie reszty nieodgadniętych odpowiedzi) — zgłoszone: ekran
    // kolejnej rundy/finału/końca gry odpalał się sam po ostatnim
    // odsłonięciu, "znikąd". Teraz to osobny, kontekstowo podpisany przycisk
    // (label z engine.js's END_ROUND, zapisany w r.roundEndDestination —
    // patrz komentarz tam), zablokowany dopóki nie odsłonięto WSZYSTKIEGO.
    if (state.phase === "REVEAL") {
      const label = r.roundEndDestination === "FINAL" ? t("control.roundsGoToFinalBtn")
        : r.roundEndDestination === "GAME_END" ? t("control.roundsGoToGameEndBtn")
        : t("control.roundsNextRoundBtn");
      statusItems.push(navButton(label, {
        cls: "btn gold c2-statusbar-end",
        disabled: r.revealed.length < r.answers.length,
        busy: boardBusy(),
        onclick: () => emit("game.dispatch", { type: "NEXT_AFTER_REVEAL" }),
      }));
    }
    const roundStatusBar = h("div", { class: "c2-statusbar" }, statusItems);

    // "— kradzież" w STEAL, "— rozgrywka" poza tym (PLAY i odkrywanie
    // reszty w REVEAL) — zgłoszone: te dwa etapy mają się rozróżniać w
    // nagłówku, tak jak pojedynek już ma swoje "— pojedynek".
    const stepLabel = state.phase === "STEAL"
      ? t("control.stepStealTitle", { round: r.roundNo })
      : t("control.stepPlayTitle", { round: r.roundNo });
    gameplayShell({ stepLabel, question: r.question?.text, body, nav: [roundStatusBar] });
  }

  // 3 przypadki końca gry — wygrana A, wygrana B, remis — jedna linia
  // zamiast osobnego wyniku każdej drużyny obok siebie (zgłoszone: "ekran
  // zakończenia można tylko napisać wygrała drużyna taka z wynikiem takim").
  function gameEndSummary(state) {
    const { A, B } = state.rounds.totals;
    if (A === B) return t("control.gameEndSummaryDraw", { a: A, b: B });
    const winner = A > B ? "A" : "B";
    return t("control.gameEndSummaryWin", { team: teamName(state, winner), hi: Math.max(A, B), lo: Math.min(A, B) });
  }

  // Co POKAŻE Wyświetlacz po "Zakończ grę" — 3 warianty (plan, sekcje R10/
  // F14), nie "logo, wynik i punkty" naraz (błąd — pokazuje się TYLKO
  // jedno z nich): remis -> zawsze logo, niezależnie od ustawienia;
  // inaczej wg detail.settings.endScreenMode — "logo"->logo, "points"->
  // wynik w punktach, "money"->pieniądze (w rundach BEZ finału 'money'
  // jest w silniku traktowane jak 'points' — nie ma z czego policzyć
  // realnej kwoty; w finale to prawdziwa, przeliczona kwota).
  function endRevealHint(state, isFinal) {
    const { A, B } = state.rounds.totals;
    const mode = state.settings.endScreenMode;
    if (A === B || mode === "logo" || !mode) {
      return t("control.endHintLogo");
    }
    if (mode === "money" && isFinal) {
      return t("control.endHintMoney");
    }
    return t("control.endHintPoints");
  }

  // Ekran końca gry — wspólny szablon dla "Koniec gry" (bez finału) i
  // "Koniec finału" (renderFinalEnd niżej), ujednolicone: ten sam dwuetapowy
  // c2-intro hero. Zawsze "Koniec gry" — finał KOŃCZY grę, to nie osobny,
  // drugi rodzaj zakończenia (było mylące: "Koniec finału" obok "Koniec
  // gry" sugerowało dwa różne ekrany). Przycisk odsłaniający wynik
  // ujednolicony na "Zakończ grę" (było osobno "Pokaż koniec gry"/"Zakończ").
  function renderEndScreen(state, { revealAction, isFinal }) {
    if (!state.locks.gameEnded) {
      // Hint opisuje co ZROBI kliknięcie (dźwięk + Wyświetlacz), tak jak
      // reszta hero-ekranów ("Na wyświetlaczu pojawi się..." w r_intro/
      // f_start) — NIE zdradza samego wyniku (kto wygrał), bo to jest
      // moment odsłonięcia dla widzów, nie wcześniej w Control.
      const introBody = [
        h("div", { class: "c2-intro-hint", text: isFinal ? t("control.finalOutroHint") : endRevealHint(state, isFinal) }),
      ];
      // Suma finału jeszcze NIE jest wtopiona w rounds.totals na tym
      // ekranie (dzieje się dopiero w FINISH_FINAL) — bez tego operator nie
      // miałby żadnego potwierdzenia wyniku finału przed kliknięciem
      // "Zakończ grę".
      if (isFinal) {
        introBody.push(h("div", { class: "c2-statusbar" }, [
          h("span", {}, [document.createTextNode(t("control.statusFinalSumLabel")), h("b", { text: String(state.final.runtime.sum) })]),
        ]));
      }
      gameplayShell({
        stepLabel: t("control.roundsGameEndTitle"),
        body: [h("div", { class: "c2-intro" }, introBody)],
        nav: [navButton(t("control.roundsGameEndBtn"), {
          busy: boardBusy(),
          onclick: () => emit("game.dispatch", revealAction),
        })],
      });
      return;
    }
    gameplayShell({
      stepLabel: t("control.roundsGameEndTitle"),
      body: [h("div", { class: "c2-intro" }, [
        h("div", { class: "c2-intro-hint", text: gameEndSummary(state) }),
      ])],
      // Gra już zakończona: outro nie blokuje ani "Zacznij od nowa", ani
      // "Wróć do moich gier" (zgłoszone 2026-10-20).
      nav: [
        navButton(t("control.restartGame"), {
          shortcut: null,
          cls: "btn",
          busy: false,
          onclick: () => emit("game.restart"),
        }),
        navButton(t("control.returnToMyGames"), {
          busy: false,
          onclick: () => emit("session.finish"),
        }),
      ],
    });
  }

  function renderGameEnd(state) {
    renderEndScreen(state, { revealAction: { type: "GAME_END_SHOW" }, isFinal: false });
  }

  // ---- Finał ----
  // f_start/f_p2_start: te same dwa "hero" ekrany przejściowe co r_intro/
  // r_roundStart (duży tytuł + wyjaśnienie + złoty przycisk) — "Rozpocznij
  // finał" faktycznie startuje i finał, i pierwszą jego rundę (gracz 1),
  // dokładnie jak "Rozpocznij grę" startuje i grę, i pierwszą rundę.
  function renderFinalStart(state) {
    gameplayShell({
      stepLabel: t("control.stepFinal"),
      body: [h("div", { class: "c2-intro" }, [
        h("div", { class: "c2-intro-hint", text: t("control.finalStartHint") }),
      ])],
      nav: [navButton(t("control.finalStartBtn"), {
        busy: boardBusy(),
        onclick: () => emit("game.dispatch", { type: "START_FINAL" }),
      })],
    });
  }

  // Co pokazać jako "Gracz 1: ..." w wierszach rundy 2 — dokładnie stare
  // control/js/gameFinal.js's resolveShownText(1, idx): jeśli operator już
  // dopasował odpowiedź gracza 1 do prawdziwej odpowiedzi z planszy (MATCH),
  // pokazujemy TĘ odpowiedź (nie surowy wpisany tekst); przy MISS pokazujemy
  // to, co gracz 1 faktycznie wpisał; SKIP/nierozstrzygnięte -> "—". Runda 1
  // zawsze kończy mapowanie (F2-F6) zanim runda 2 w ogóle się zacznie
  // (f_p2_start między nimi), więc map1[idx] jest tu już rozstrzygnięte.
  function resolveP1AnswerShown(state, idx) {
    const f = state.final;
    const row = f.runtime.map1?.[idx];
    const question = f.questions?.[idx];
    if (!row) return t("common.emDash");
    if (row.kind === "MATCH") {
      const a = (question?.answers || []).find((x) => x.id === row.matchId);
      return (a?.text || "").trim() || t("common.emDash");
    }
    if (row.kind === "MISS") return (f.runtime.p1[idx]?.text || "").trim() || t("common.emDash");
    return t("common.emDash");
  }

  // Kafel odliczania — jeden wiersz na pełną szerokość, ta sama skala co
  // reszta siatki wpisywania (zgłoszone: "akcja odliczania/zatrzymywanie ma
  // być jako 1 rząd w podobnej skali kafelkowej"). Toggle idzie przez
  // "final.toggleTimer" (control/js/app.js), reużywane też przez skrót
  // Ctrl/Cmd+Shift — jedna, wspólna logika start/wczesne-zatrzymanie zamiast
  // dwóch kopii. Wczesne zatrzymanie klikalne TYLKO gdy wszystkie pola są
  // wypełnione (dokładnie jak stare timerStopEarlyIfAllowed) — inaczej
  // odliczanie jest tylko wyświetlane, nie da się go przerwać.
  function finalTimerRow(state, round) {
    const f = state.final;
    const timer = f.runtime.timer;
    const phase = round === 1 ? "P1" : "P2";
    const running = timer.running && timer.phase === phase;
    const used = round === 1 ? timer.usedP1 : timer.usedP2;
    // Zgłoszone: start odliczania to nieodwracalna akcja (usedP1/usedP2 --
    // jednorazowa szansa na rundę, patrz engine.js's START_TIMER), a
    // zatrzymanie też niesie realne ryzyko przypadkowego kliknięcia --
    // zaznacz->potwierdź jak reszta kosztownych kafli finału, zamiast
    // natychmiastowego toggle. Skrót klawiszowy (Ctrl/Cmd+Shift, app.js)
    // zostaje jednoklikowy -- to złożony, mało przypadkowy gest, w
    // odróżnieniu od pojedynczego kliknięcia myszą.
    const armKey = `timer:${round}`;

    if (running) {
      const secLeft = Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
      const filled = round === 1
        ? f.runtime.p1.every((x) => String(x?.text || "").trim().length > 0)
        : f.runtime.p2.every((x) => String(x?.text || "").trim().length > 0);
      const clickable = filled && !revealLocked();
      const armed = clickable && armedKey === armKey;
      // Dokładnie jak stare control/js/gameFinal.js's setTimerBtnLabel: gdy
      // odliczanie trwa, przycisk ZAWSZE pokazuje etykietę "Zatrzymaj" (nie
      // tylko gdy da się kliknąć) — tylko klikalność zależy od allFilled.
      // Cyfry odliczania są aria-hidden (dekoracyjne, tykają co sekundę) —
      // stabilna, dostępna nazwa przycisku to samo "Zatrzymaj", ten sam
      // wzorzec co c2-tile-sub przy X w Rundach (renderRounds's xLabel).
      const content = h("div", {}, [
        h("span", { "aria-hidden": "true" }, [document.createTextNode(`${secLeft}s`)]),
        h("div", { class: "c2-tile-sub", text: t("control.finalTimerStopShort") }),
      ]);
      const btn = h("button", {
        class: `c2-tile c2-timer-row c2-tile-timer ${clickable ? "startable" : ""} ${armed ? "c2-tile-armed" : ""}`.trim(),
        type: "button",
        disabled: clickable ? undefined : "",
        onclick: clickable ? () => {
          if (armedKey === armKey) {
            armedKey = null;
            emit("final.toggleTimer", { round });
          } else {
            armedKey = armKey;
            emit("ui.rerender");
          }
        } : undefined,
      }, [content]);
      // data-timer-role: patrz komentarz przy timer3Tile w renderRounds —
      // ten sam mechanizm, tickTimers() aktualizuje TYLKO te cyfry co 250ms,
      // bez przebudowy reszty ekranu (a więc bez gubienia fokusu pól
      // wpisywania obok — zgłoszone: "wpisywanie nie ma blokować licznika",
      // co wymaga, żeby licznik w ogóle PRZESTAŁ niszczyć input co tik).
      btn.dataset.timerRole = "final";
      return btn;
    }
    if (used) {
      return h("button", { class: "c2-tile c2-timer-row c2-tile-timer", type: "button", disabled: "" }, [document.createTextNode(t("control.finalTimerUsed"))]);
    }
    const clickable = !revealLocked();
    const armed = clickable && armedKey === armKey;
    return h("button", {
      class: `c2-tile c2-timer-row c2-tile-timer startable ${armed ? "c2-tile-armed" : ""}`.trim(),
      type: "button",
      disabled: clickable ? undefined : "",
      onclick: clickable ? () => {
        if (armedKey === armKey) {
          armedKey = null;
          emit("final.toggleTimer", { round });
        } else {
          armedKey = armKey;
          emit("ui.rerender");
        }
      } : undefined,
    }, [document.createTextNode(round === 1 ? t("control.finalUi.timerStart15") : t("control.finalUi.timerStart20"))]);
  }

  // Wpisywanie finału — jeden wiersz na pytanie, ułożony jak kafle rund
  // (obramowanie/zaokrąglenie/tło ujednolicone z .c2-tile), a nie tabela ani
  // gołe wiersze. Runda 1: [Pytanie] [Odpowiedź gracza] (2 kafle). Runda 2:
  // [Pytanie + Odpowiedź gracza 1, jedno pod drugim W JEDNYM kaflu]
  // [Odpowiedź gracza 2] [Powtórzenie — przycisk, nie checkbox] (3 kafle) —
  // dokładnie jak stary control/js/gameFinal.js's 4-kolumnowa tabela
  // (Pytanie/Odp. gracza 1/Odpowiedź/Powtórzenie), tylko z pytaniem i
  // odpowiedzią gracza 1 połączonymi w jeden kafel zamiast dwóch osobnych
  // kolumn. Hint (+ skróty klawiszowe) po prawej, jak w Rundach — nie nad
  // siatką.
  function renderFinalEntry(state, round) {
    const f = state.final;
    const key = round === 1 ? "p1" : "p2";
    const rows = [];
    for (let i = 0; i < 5; i++) {
      const row = f.runtime[key][i] || {};
      const question = f.questions?.[i];
      const inp = h("input", { type: "text", value: row.text || "", placeholder: t("control.finalUi.playerAnswer"), autocomplete: "off" });
      // boardBusy() -- SET_ENTRY_TEXT idzie przez ten sam pełny zapis
      // detail co każda inna akcja gry (store.js's commit()), więc podlega
      // temu samemu serwerowemu locked_until (migracja 264) co przejście
      // "Rozpocznij finał"/"Start rundy 2" (gate = final_theme/
      // round_transition+reveal, kilka sekund). Bez tego pole wyglądało na
      // od razu edytowalne -- klik/wpisanie w trakcie tego intro dostawało
      // gołe "Błąd: locked" (zgłoszone przez e2e: pięć kolejnych SET_ENTRY_
      // TEXT z pięciu .fill() zaraz po "Rozpocznij finał" odrzuconych
      // 'locked', zanim serwerowa blokada z final_theme zdążyła wygasnąć).
      if (boardBusy()) inp.disabled = true;
      on(inp, "input", (e) => emit("game.dispatch", { type: "SET_ENTRY_TEXT", round, idx: i, text: e.currentTarget.value }));
      on(inp, "keydown", (e) => {
        if (e.defaultPrevented || e.repeat || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (round === 2 && e.key === "Enter" && e.shiftKey && !e.currentTarget.value.trim()) {
          e.preventDefault();
          emit("game.dispatch", { type: "SET_REPEAT", round: 2, idx: i, repeat: true });
          return;
        }
        if (e.shiftKey || !["Enter", "ArrowDown", "ArrowUp"].includes(e.key)) return;
        e.preventDefault();
        const direction = e.key === "ArrowUp" ? -1 : 1;
        for (let offset = 1; offset <= 5; offset++) {
          const idx = (i + direction * offset + 5) % 5;
          const candidate = root.querySelector(`.c2-entryrow[data-i="${idx}"] input`);
          if (candidate && !candidate.value.trim()) { candidate.focus(); break; }
        }
      });

      const cells = round === 2 ? [
        h("div", { class: "c2-entrytile" }, [
          h("div", { class: "c2-entrytile-q", text: question?.text || t("control.finalUi.questionLabel", { n: i + 1 }) }),
          h("div", { class: "c2-entrytile-p1ans" }, [document.createTextNode(t("control.finalUi.p2HintP1Prefix")), h("b", { text: resolveP1AnswerShown(state, i) })]),
        ]),
        h("div", { class: "c2-entrytile c2-entrytile-input" }, [clipField(inp)]),
      ] : [
        h("div", { class: "c2-entrytile" }, [h("div", { class: "c2-entrytile-q", text: question?.text || t("control.finalUi.questionLabel", { n: i + 1 }) })]),
        h("div", { class: "c2-entrytile c2-entrytile-input" }, [clipField(inp)]),
      ];
      if (round === 2) {
        const repeat = row.repeat === true;
        const repeatBlocked = boardBusy() || !!(row.text || "").trim();
        // boardBusy() -- SAME gap i naprawa co pole input wyżej: SET_REPEAT
        // to też pełny zapis detail, podlega temu samemu serwerowemu
        // locked_until co przejście "Start rundy 2" (gate =
        // syncedMs("round_transition","reveal"), kilka sekund). Zgłoszone
        // (e2e "finał — obaj gracze"): klik "Powtórzenie" tuż po wejściu na
        // ekran wpisywania gracza 2 dostawał 'locked' -- ta sama klasa bugu,
        // inny przycisk na tym samym ekranie.
        //
        // Repeat is an immediate sound cue; only typing removes its marker.
        const repeatBtn = h("button", {
          class: `c2-btn-repeat ${repeat ? "on" : ""}`.trim(), type: "button",
          onclick: repeatBlocked ? undefined : () => {
            armedKey = null;
            emit("game.dispatch", { type: "SET_REPEAT", round: 2, idx: i, repeat: true });
          },
        }, []);
        repeatBtn.innerHTML = repeat ? iconText("check", t("control.finalUi.p2RepeatOn")) : t("control.finalUi.p2RepeatOff");
        if (repeatBlocked) repeatBtn.disabled = true;
        cells.push(repeatBtn);
      }
      rows.push(h("div", { class: `c2-entryrow ${round === 2 ? "p2" : "p1"}`, "data-i": String(i) }, cells));
    }
    const timerButton = finalTimerRow(state, round);
    rows.push(timerButton);
    bindShortcut(timerButton, "t", () => emit("final.toggleTimer", { round }));

    // Pięć pytań jest już widocznych w pięciu rzędach formularza; szósty
    // zajmuje timer. Stepper u góry określa, który gracz wpisuje odpowiedzi.
    const body = [
      h("div", { class: "c2-roundlayout" }, [
        h("div", { class: "c2-roundlayout-main" }, [h("div", { class: "c2-entryrows" }, rows)]),
        h("div", { class: "c2-roundlayout-divider" }),
        h("div", { class: "c2-roundlayout-side" }, [hintBlock(`${getFinalHint(state)}\n${t("control.finalAnswerLengthHint", { max: FINAL_DISPLAY_MAX })}`, getFinalEntryShortcuts(round), "c2-final-hint")]),
      ]),
    ];

    // Zgłoszone: "po drugiej rundzie finału nawet nie czeka na koniec
    // timera i przechodzi dalej" — "Dalej" nie był w ogóle powiązany ze
    // stanem zegarka: klikalny przez CAŁY czas trwania 15s/20s odliczania,
    // więc operator mógł przejść do mapowania w dowolnym momencie,
    // przerywając jeszcze trwający, naturalny czas gracza (a wraz z nim —
    // dźwięk "time_over", który miał ten czas zamykać). START_MAPPING
    // (engine.js) i tak bezwarunkowo zatrzymuje zegarek przy wejściu —
    // to musi być ŚWIADOME domknięcie (naturalne wygaśnięcie ALBO ręczne
    // wczesne zatrzymanie przez sam kafel zegarka, które już wymaga
    // wypełnienia wszystkich pól — patrz finalTimerRow), nie przypadkowe
    // domknięcie przez inny przycisk na tym samym ekranie.
    const timerPhase = round === 1 ? "P1" : "P2";
    const timerRunningNow = f.runtime.timer.running && f.runtime.timer.phase === timerPhase;
    const nav = [navButton(t("common.next"), {
      cls: "btn gold",
      disabled: timerRunningNow || !f.runtime.timer[`used${timerPhase}`],
      busy: boardBusy(),
      onclick: () => emit("game.dispatch", { type: "START_MAPPING", round }),
    })];
    gameplayShell({ stepLabel: t("control.finalEntryStepLabel", { round }), body, nav });
  }

  // Dokładnie jak dzisiejsze gameFinal.js's ensureDefaultMapping(): dopóki
  // operator nie kliknął konkretnej odpowiedzi z listy, domyślne
  // rozstrzygnięcie to MISS (jest wpisany tekst) albo SKIP (pusto) — "AUTO"
  // nie robi żadnego dopasowania fuzzy, to tylko ten domyślny fallback.
  function defaultResolve(inputText) {
    const hasInput = (inputText || "").trim().length > 0;
    return hasInput
      ? { mode: "AUTO", kind: "MISS", matchId: null, outText: inputText, pts: 0 }
      : { mode: "AUTO", kind: "SKIP", matchId: null, outText: "", pts: 0 };
  }

  // Rozstrzygnięcie, które FAKTYCZNIE się odsłoni, jeśli operator jeszcze
  // niczego ręcznie nie wybrał — dokładnie jak stare gameFinal.js's
  // ensureDefaultMapping(): MISS gdy coś wpisano, SKIP gdy pusto. To NIE
  // jest zapisywane do stanu tutaj (ui.js zostaje czystym renderem) — służy
  // wyłącznie do pokazania, które MISS/SKIP jest "już wybrane" (złoty kafel
  // od razu, nie dopiero po pierwszym kliknięciu — zgłoszone: "zaznaczenie
  // zawsze jakieś jest na kafelkach wyboru, nawet domyślne"). Rzeczywisty
  // zapis tego wyboru do game_state następuje dopiero przy potwierdzeniu
  // kafla "Pokazana" (patrz niżej), dokładnie tak jak stare "Pokaż
  // odpowiedź" domyślnie rozstrzygało dopiero w momencie kliknięcia.
  function effectiveMappingResolution(row, hasTyped) {
    if (row.kind != null) return { kind: row.kind, matchId: row.matchId };
    return { kind: hasTyped ? "MISS" : "SKIP", matchId: null };
  }

  // Co DOKŁADNIE odsłoni się na Wyświetlaczu — bez żadnych dodatkowych
  // informacji (zgłoszone), tylko sama wartość: dopasowana odpowiedź z
  // listy / to co gracz wpisał (MISS) / nic (SKIP).
  function resolveMappingPreview(question, inputText, effective) {
    if (effective.kind === "MATCH") {
      const a = (question?.answers || []).find((x) => x.id === effective.matchId);
      return { text: a?.text || t("common.emDash"), pts: a ? a.fixed_points : 0 };
    }
    if (effective.kind === "MISS") return { text: inputText || t("common.emDash"), pts: 0 };
    return { text: t("common.emDash"), pts: 0 };
  }

  // Wpisywanie (finał, mapowanie): wiersz 1 to edytowalne "Wpisano" (ten sam
  // wygląd co pole w kroku wpisywania), żeby dało się poprawić literówkę tuż
  // przed rozstrzygnięciem — blokuje się dopiero po odsłonięciu odpowiedzi.
  // Wiersze 2-4: dopasowania z listy + MISS/SKIP (do 6, 2 na wiersz) — jedno
  // z nich jest ZAWSZE złote, nawet domyślnie (MISS gdy coś wpisano, SKIP
  // gdy pusto), nie dopiero po pierwszym kliknięciu. Wiersz 5 (DÓŁ, tam gdzie
  // były zawsze — zgłoszone): DWA kafle odsłaniania ("Pokaż odpowiedź"/
  // "Pokaż punkty"), ZAWSZE obecne w tym samym miejscu (nie znikają
  // warunkowo jak dawniej) — "Pokaż punkty" jest po prostu wyszarzony/
  // zablokowany dopóki odpowiedź nie jest odsłonięta. Nazwa przycisku
  // zostaje stała, druga linijka (aria-hidden) pokazuje na żywo dokładnie to,
  // co się odsłoni — resolveMappingPreview. Idą przez zaznacz->potwierdź jak
  // w Rundach (armableTile) — jedyne dwa kafle na tym ekranie, które realnie
  // coś odsłaniają na wizji — i wyszarzają się na stałe po własnym
  // odsłonięciu. "Dalej" to zwykły przycisk nawigacji na dole
  // (gameplayShell's nav), taki sam jak "Dalej" gdzie indziej — nie kafel w
  // siatce, żyje POD tą siatką (patrz nav niżej).
  function renderFinalMapping(state, round, idx) {
    const f = state.final;
    const mapArr = f.runtime[round === 1 ? "map1" : "map2"];
    const row = mapArr[idx];
    const canFinishFinal = row.revealedPoints && (f.runtime.reached200 || (round === 2 && idx === 4));
    const question = f.questions?.[idx];
    const entryKey = round === 1 ? "p1" : "p2";
    const inputText = f.runtime[entryKey][idx]?.text || "";
    const hasTyped = inputText.trim().length > 0;
    const locked = row.revealedAnswer; // po odsłonięciu odpowiedzi pole i wybór są zamrożone
    // control/js/gameFinal.js's p2IsRepeat: gdy gracz 2 oznaczył powtórzenie,
    // MISS/SKIP nie pokazują się jako aktywne mimo że row.kind==="SKIP" (to
    // właśnie ustawia SET_REPEAT) — aktywność "przechodzi" na sam kafel
    // Powtórzenie.
    const p2IsRepeat = round === 2 && f.runtime.p2[idx]?.repeat === true;

    const effective = effectiveMappingResolution(row, hasTyped);
    const preview = resolveMappingPreview(question, inputText, effective);

    // Etykieta "Wpisano" (1/3, wyśrodkowana w pionie) + pole (2/3, ten sam
    // wygląd co w kroku wpisywania) OBOK siebie, nie jedno nad drugim
    // (zgłoszone). Wiersz 1 to teraz PRAWDZIWY kafelek/kafelki (obramowanie
    // jak c2-entrytile) — zgłoszone: "pierwszy rząd mam mieć kafelek a teraz
    // nie ma". Runda 1: jeden kafelek na całą szerokość. Runda 2: DWA osobne
    // kafelki — "Wpisano" (2/3 szerokości) + "Gracz 1" (1/3 szerokości),
    // osobno od etykiety, nie jedna linijka pod spodem jak dawniej.
    const inp = h("input", { type: "text", value: inputText, placeholder: t("control.finalUi.playerAnswer"), autocomplete: "off" });
    if (locked || devicesBlocked) inp.disabled = true;
    on(inp, "input", (e) => emit("game.dispatch", { type: "SET_ENTRY_TEXT", round, idx, text: e.currentTarget.value }));
    on(inp, "keydown", async (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      // The queued write can trigger a render that normally restores focus
      // to an edited mapping field. Enter is an explicit commit-and-exit,
      // so suppress that restoration until the write has settled.
      // Po uzgodnieniu DOM `inp` jest odłączoną kopią; render sprawdza żywe pole.
      const liveInput = e.currentTarget;
      mappingInputsPendingBlur.add(liveInput);
      try {
        await emit("ui.flushTyping");
      } finally {
        const currentInput = liveInput.isConnected ? liveInput : root.querySelector(`.c2-mapinput[data-i="${idx}"] input`);
        currentInput?.blur();
        mappingInputsPendingBlur.delete(liveInput);
      }
    });
    bindShortcut(inp, "i", () => inp.focus());
    const wpisanoTile = h("div", { class: "c2-mapinput", "data-i": idx }, [
      h("div", { class: "c2-mapinput-labelcol" }, [h("div", { class: "c2-field-label", text: t("control.finalUi.mapInputLabel") })]),
      h("div", { class: "c2-entrytile-input" }, [clipField(inp)]),
    ]);

    let row1Tiles;
    if (round === 2) {
      wpisanoTile.classList.add("is-beside-p1"); // 2/3, obok kafla „Gracz 1”
      const p1Tile = h("div", { class: "c2-entrytile c2-map-p1tile" }, [
        h("div", { class: "c2-field-label", text: t("control.finalHost.player1Label") }),
        h("div", { class: "c2-entrytile-p1ans" }, [h("b", { text: resolveP1AnswerShown(state, idx) })]),
      ]);
      row1Tiles = [wpisanoTile, p1Tile];
    } else {
      row1Tiles = [wpisanoTile];
    }

    // Nazwa przycisku ZOSTAJE ("Pokaż odpowiedź"/"Pokaż punkty", ta sama co
    // dawniej) — dopisana jest tylko DRUGA LINIJKA pokazująca na bieżąco, co
    // się odsłoni po kliknięciu. Wartość w podglądzie jest aria-hidden —
    // dostępna nazwa przycisku zostaje stała, ten sam wzorzec co c2-tile-sub
    // przy X w Rundach. Wiersz 6 (DÓŁ), z CAŁYM PUSTYM wierszem 5 jako
    // przerwą przed nim (zgłoszone: "chodzi mi o cały rząd przerwy", nie
    // tylko margines) — siatka tego ekranu ma więc 6 wierszy, nie 5
    // (nadpisane inline niżej, tileGridForMapping).
    const revealAnswerTile = armableTile(`map-answer:${round}:${idx}`,
      h("div", {}, [
        document.createTextNode(t("control.finalRevealAnswerLabel")),
        h("div", { class: "c2-tile-sub", "aria-hidden": "true" }, clipNodes(row.revealedAnswer ? (row.outText || t("common.emDash")) : preview.text)),
      ]),
      {
        row: 6, col: HALF(0), cls: "c2-tile-primary",
        // Ta sama blokada co w Rundach, teraz oparta o długość dźwięku —
        // "Pokaż punkty" i tak nie odblokuje się, dopóki dźwięk "Pokaż
        // odpowiedź" (soundCueKey "reveal", REVEAL_ANSWER_ONLY) nie dogra.
        disabled: locked || revealLocked(),
        onclick: async () => {
          if (row.kind == null) await emit("game.dispatch", { type: "RESOLVE_MAPPING", round, idx, ...defaultResolve(inputText) });
          await emit("game.dispatch", { type: "REVEAL_ANSWER_ONLY", round, idx });
        },
      });
    const revealPointsTile = armableTile(`map-points:${round}:${idx}`,
      h("div", {}, [
        document.createTextNode(t("control.finalRevealPointsLabel")),
        h("div", { class: "c2-tile-sub", "aria-hidden": "true", text: row.revealedPoints ? String(row.pts) : String(preview.pts) }),
      ]),
      {
        row: 6, col: HALF(1), cls: "c2-tile-primary",
        disabled: !row.revealedAnswer || row.revealedPoints || revealLocked(),
        // REVEAL_POINTS zwraca soundCueKey "answer_correct"/"answer_wrong"
        // zależnie od row.kind (engine.js) — kind jest już znane w tym
        // momencie, bo kafel jest klikalny dopiero po odsłonięciu odpowiedzi.
        onclick: () => emit("game.dispatch", { type: "REVEAL_POINTS", round, idx }),
      });

    const matchOptions = (question?.answers || []).slice(0, 6).map((a) => ({
      key: `map-match:${round}:${idx}:${a.id}`,
      text: `${a.text} (${a.fixed_points})`,
      content: h("span", {}, [...clipNodes(a.text), document.createTextNode(` (${a.fixed_points})`)]),
      active: !p2IsRepeat && effective.kind === "MATCH" && effective.matchId === a.id,
      disabled: locked || !hasTyped || revealLocked(),
      onclick: () => {
        if (effective.kind === "MATCH" && effective.matchId === a.id && !p2IsRepeat) return;
        emit("game.dispatch", { type: "RESOLVE_MAPPING", round, idx, mode: "MANUAL", kind: "MATCH", matchId: a.id, outText: a.text, pts: a.fixed_points });
      },
    }));
    const missOption = {
      // Pod nazwą przycisku, w nawiasie, DOSŁOWNIE stała etykieta
      // "(odpowiedź gracza)" — sama WARTOŚĆ jest już widoczna na kaflu
      // odsłaniania (jego podgląd pokazuje, co konkretnie się odsłoni), więc
      // tu nie powtarzamy jej drugi raz, tylko podpisujemy, co reprezentuje
      // ta opcja. Stała nazwa + aria-hidden druga linijka, ten sam wzorzec
      // co kafle odsłaniania.
      key: `map-miss:${round}:${idx}`,
      content: hasTyped ? h("div", {}, [
        document.createTextNode(t("control.finalUi.mapBtnMiss")),
        h("div", { class: "c2-tile-sub", "aria-hidden": "true", text: t("control.finalUi.mapMissSubLabel") }),
      ]) : t("control.finalUi.mapBtnMiss"),
      active: !p2IsRepeat && effective.kind === "MISS",
      disabled: locked || !hasTyped || revealLocked(),
      danger: true,
      onclick: () => {
        if (effective.kind === "MISS" && !p2IsRepeat) return;
        emit("game.dispatch", { type: "RESOLVE_MAPPING", round, idx, mode: "MANUAL", kind: "MISS", matchId: null, outText: inputText, pts: 0 });
      },
    };
    const skipOption = {
      key: `map-skip:${round}:${idx}`,
      text: t("control.finalUi.mapBtnSkip"),
      active: !p2IsRepeat && effective.kind === "SKIP",
      disabled: locked || hasTyped || revealLocked(),
      onclick: () => {
        if (effective.kind === "SKIP" && !p2IsRepeat) return;
        emit("game.dispatch", { type: "RESOLVE_MAPPING", round, idx, mode: "MANUAL", kind: "SKIP", matchId: null, outText: "", pts: 0 });
      },
    };
    const options = [...matchOptions, missOption, skipOption];
    // Powtórzenie (tylko runda 2) — control/js/gameFinal.js's data-kind="repeat":
    // JEDNOKIERUNKOWO włącza (klik gdy już aktywne to no-op), nigdy nie
    // blokuje pozostałych przycisków (operator może potem kliknąć MATCH/MISS/
    // SKIP, co samo z siebie zgasi flagę repeat przez SET_ENTRY_TEXT/
    // RESOLVE_MAPPING — patrz app.js). Dostępne niezależnie od hasTyped
    // (allowRepeat = isR2, "nigdy disabled" poza revealedAnswer/Points).
    if (round === 2) {
      options.push({
        key: `map-repeat:${round}:${idx}`,
        text: t("control.finalUi.p2RepeatOff"),
        active: p2IsRepeat,
        disabled: locked || hasTyped || revealLocked(),
        danger: true,
        onclick: () => {
          if (locked || revealLocked() || f.runtime.p2[idx]?.repeat === true) return;
          emit("game.dispatch", { type: "SET_REPEAT", round: 2, idx, repeat: true });
        },
      });
    }

    // Siatka wyboru 3x3 (zawsze 3 rzędy, zgłoszone: "przyciski wyboru mają
    // się układać w 3 rzędach a nie dwóch") — dokładnie jak stare
    // gameFinal.js's `tiles = [...matchTiles, ...actionTiles].slice(0,9)`
    // dopełnione pustymi `mapSlot`-ami do 9, żeby rytm siatki był stały
    // niezależnie od liczby prawdziwych odpowiedzi na liście.
    // Zgłoszone: wybór dopasowania w finale (MATCH/MISS/SKIP/Powtórzenie) ma
    // reagować jak reszta konsekwentnych kafli w tej appce — zaznacz ->
    // potwierdź (armableTile, jak odpowiedzi/X/Oddaj kontrolę w Rundach), z
    // drugim tapnięciem po widocznym zaznaczeniu.
    // Wcześniej te kafle dispatchowały RESOLVE_MAPPING/SET_REPEAT od razu na
    // pierwszy klik — jedyne miejsce w tym ekranie bez bufora przeciwko
    // przypadkowemu kliknięciu.
    const optionTiles = options.slice(0, 9).map((o, i) => tile(o.content || o.text, {
      shortcut: i < matchOptions.length ? String(i + 1) : o.key.startsWith("map-miss:") ? "w" : o.key.startsWith("map-skip:") ? "o" : "r",
      row: Math.floor(i / 3) + 2,
      col: THIRD(i % 3),
      cls: [o.active && "c2-tile-primary", o.danger && "c2-tile-danger"].filter(Boolean).join(" "),
      disabled: o.disabled,
      onclick: o.onclick,
    }));
    for (const option of options) {
      const shortcut = option.key.startsWith("map-match:") ? String(matchOptions.indexOf(option) + 1) : option.key.startsWith("map-miss:") ? "w" : option.key.startsWith("map-skip:") ? "o" : "r";
      const binding = keyboardActions.get(shortcut);
      if (binding) binding.select = binding.run;
    }
    // Enter reveals only the currently available stage, never advances a question.
    const availableReveal = !row.revealedAnswer ? revealAnswerTile : revealPointsTile;
    // Skrót Enter ma tylko dostępny kafel: przy ponownym renderze tego samego
    // pytania wiązanie szuka elementu po data-shortcut, więc drugi kafel
    // z „reveal” przechwytywał Enter po [Pokaż odpowiedź] (punkty się nie odsłaniały).
    const unavailableReveal = availableReveal === revealAnswerTile ? revealPointsTile : revealAnswerTile;
    unavailableReveal.removeAttribute("data-shortcut");
    unavailableReveal.removeAttribute("aria-keyshortcuts");
    const revealBinding = keyboardActions.get("reveal");
    if (revealBinding) revealBinding.el = availableReveal;
    if (!row.revealedAnswer) keyboardActions.set("reveal", {
      el: revealAnswerTile,
      run: async () => {
        if (row.kind == null) await emit("game.dispatch", { type: "RESOLVE_MAPPING", round, idx, ...defaultResolve(inputText) });
        await emit("game.dispatch", { type: "REVEAL_ANSWER_ONLY", round, idx });
      },
    });
    while (optionTiles.length < 9) {
      const slotEl = h("div", { class: "c2-tile-slot" });
      setCell(slotEl, Math.floor(optionTiles.length / 3) + 2, THIRD(optionTiles.length % 3));
      optionTiles.push(slotEl);
    }

    // Wspólna, sześciorzędowa siatka jak w Rundach. Wiersz 5 zajmuje pytanie
    // na pełną szerokość, a kafle odsłaniania zostają w wierszu 6. Wszystkie
    // rzędy mają tę samą wysokość —
    // wcześniejsze przeważanie wiersza 1 (Wpisano) było próbą naprawienia
    // wysokości POLA przez wysokość WIERSZA; prawdziwa naprawa (zgłoszone:
    // "pola wpisywania lepiej żeby były na wysokość kafelka") jest w CSS
    // (.c2-entrytile-input input's flex:1/height:100%) — samo pole
    // wypełnia teraz cały kafelek niezależnie od tego, ile miejsca ma wiersz.
    const mappingGrid = tileGrid([...row1Tiles, ...optionTiles, revealAnswerTile, revealPointsTile]);

    // control/js/gameFinal.js's updateSumUI() — operator widział sumę na
    // żywo przez cały mapping; w pierwszym przebiegu control2 to zniknęło
    // całkowicie (Display dostaje FSUMA przez api.final.setSumaFor, ale
    // sam operator — nic). Ten sam wzorzec statusbara co w Rundach —
    // zgłoszone: "suma finału jak inne włączniki ma być niżej, nie na
    // górze" — w Rundach pasek statusu (Bank/Gra) idzie PO siatce, nie
    // przed nią (patrz renderRounds wyżej); ten ekran miał go odwrotnie.
    // Suma finału i "Dalej" są w dolnym pasku pod siatką, tak samo jak
    // wyniki i przejście w rundach.
    //
    // NEXT_QUESTION's `idx` to 1-bazowy numer PYTANIA, z którego schodzimy
    // (nextIdx = action.idx+1 w engine.js) — nie 0-bazowy indeks tablicy,
    // którym operuje reszta tego ekranu. Bez +1 operator zostawałby
    // uwięziony na tym samym pytaniu (nextIdx trafiałby z powrotem w ten
    // sam krok). Przycisk ZAWSZE widoczny (zgłoszone: "jak w starym
    // Control"), wyszarzony/nieklikalny dopóki punkty nie są odsłonięte —
    // nie znika, tylko czeka zablokowany (onclick też undefined, nie tylko
    // atrybut disabled — podwójne zabezpieczenie przed przedwczesnym
    // przejściem dalej).
    const finalStatusBar = h("div", { class: "c2-statusbar" }, [
      h("span", {}, [document.createTextNode(t("control.statusFinalSumLabel")), h("b", { text: String(f.runtime.sum) })]),
      navButton(t(canFinishFinal ? "control.finalEndBtn" : "common.next"), {
        cls: "btn gold c2-statusbar-end",
        disabled: !row.revealedPoints,
        busy: boardBusy(),
        onclick: row.revealedPoints ? () => emit("game.dispatch", { type: "NEXT_QUESTION", round, idx: idx + 1 }) : undefined,
      }),
    ]);

    const body = [
      h("div", { class: "c2-roundlayout" }, [
        h("div", { class: "c2-roundlayout-main" }, [mappingGrid]),
        h("div", { class: "c2-roundlayout-divider" }),
        h("div", { class: "c2-roundlayout-side" }, [hintBlock(getFinalHint(state), null, "c2-final-hint")]),
      ]),
    ];

    gameplayShell({ stepLabel: t("control.finalMappingStepLabel", { n: idx + 1 }), question: question?.text || t("control.finalUi.questionLabel", { n: idx + 1 }), body, nav: [finalStatusBar] });
  }

  function renderFinalP2Start(state) {
    gameplayShell({
      stepLabel: t("control.finalP2StartStepLabel"),
      body: [h("div", { class: "c2-intro" }, [
        h("div", { class: "c2-intro-hint", text: t("control.finalP2StartHint") }),
        // Próbka dźwięku powtórzenia — POD napisem, na środku (jak reszta
        // c2-intro), NIE w dolnym pasku nawigacji obok "Rozpocznij 2 rundę"
        // (stare control.html trzymało oba przyciski razem w stepFoot —
        // zgłoszone jako złe miejsce). c2-btn-repeat — TA SAMA klasa co
        // przycisk "Powtórzenie" w wierszach wpisywania (renderFinalEntry),
        // żeby "sample" był identyczny wielkościowo i kolorystycznie z
        // prawdziwym przełącznikiem powtórzenia. Czysto lokalny podgląd
        // dźwięku, bez zapisu do stanu gry (patrz app.js's "final.repeatTest").
        h("button", { class: "c2-btn-repeat", type: "button", onclick: () => emit("final.repeatTest") }, [document.createTextNode(t("control.finalRepeatSound"))]),
      ])],
      nav: [navButton(t("control.finalP2StartBtn"), {
        busy: boardBusy(),
        onclick: () => emit("game.dispatch", { type: "START_P2_ROUND" }),
      })],
    });
  }

  // Ten sam c2-intro hero co "Rozpoczęcie gry"/"Koniec gry" (zgłoszone: ma
  // wyglądać podobnie) — wcześniej goły <p>, jedyny niedopasowany ekran w
  // całym Finale. Jedna linia wyniku (gameEndSummary, ta sama co "Koniec
  // gry" — suma finału jest już wtopiona w rounds.totals, patrz engine.js's
  // FINISH_FINAL) + dwa przyciski, tak samo jak "Koniec gry".
  function renderFinalEnd(state) {
    renderEndScreen(state, { revealAction: { type: "FINISH_FINAL" }, isFinal: true });
  }

  function render(state, ctx = {}) {
    // Jedno źródło prawdy o blokadzie na cały render — patrz komentarz przy
    // boardBusy()/revealLocked() wyżej. Ustawiane TU, na początku, zamiast
    // przekazywane osobno do każdego renderXxx() — te dwie funkcje je już i
    // tak czytają z domknięcia.
    if (root.dataset.step !== state.step) keyboardTarget = null;
    const existingScreen = root.dataset.step === state.step ? root.firstElementChild : null;
    currentState = state;
    keyboardActions.clear();
    busy = !!ctx.busy;
    typingPending = !!ctx.typingPending;
    devicesBlocked = !!ctx.devicesBlocked;
    // Dla ponownego renderu tego samego kroku budujemy drzewo obok i
    // uzgadniamy je z żywym DOM. Dzięki temu zachowują się elementy, których
    // stan się nie zmienił (w tym animacje, fokus i scroll); przy zmianie
    // kroku ekran jest montowany od nowa. Pozycję scrolla zachowujemy też
    // jako zabezpieczenie, jeśli przebudowa zmieni strukturę.
    const scrollBefore = root.querySelector(".c2-scroll-area")?.scrollTop ?? 0;
    // Zgłoszone: wpisywanie odpowiedzi nie może gubić fokusu przy zapisach,
    // odświeżeniu obecności ani zmianach stanu. Zapisujemy pozycję kursora
    // dla każdego pola w wierszu [data-i]; przy renderze tego samego kroku
    // zachowuje je uzgadnianie DOM, a przy wymianie elementu można odtworzyć
    // fokus i zaznaczenie.
    const focused = document.activeElement;
    const focusedRow = focused && root.contains(focused) ? focused.closest("[data-i]") : null;
    const savedFocus = focusedRow && !mappingInputsPendingBlur.has(focused) ? {
      dataI: focusedRow.getAttribute("data-i"),
      selStart: focused.selectionStart,
      selEnd: focused.selectionEnd,
    } : null;
    updateTopbarDots(state, ctx.presenceFlags);
    const s = state.step;
    if (s === "devices_display") setTopbarProgress(t("control.stepDevices"));
    else if (s === "setup_finish") setTopbarProgress(t("control.summaryStepperTitle"));
    else setTopbarProgress("");
    const liveRoot = root;
    if (existingScreen) root = document.createElement("div");
    let freshEntry;
    try {
    if (s === "devices_display") renderDevicesStep(state, ctx);
    else if (s === "setup_finish") renderSetupFinish(state, ctx);
    else if (s === "r_intro" || s === "r_roundStart") renderRounds(state);
    else if (s === "r_duel" || s === "r_play") renderRounds(state);
    else if (s === "r_gameEnd") renderGameEnd(state);
    else if (s === "f_start") renderFinalStart(state);
    else if (s === "f_p1_entry") renderFinalEntry(state, 1);
    else if (s.startsWith("f_p1_map_q")) renderFinalMapping(state, 1, Number(s.slice(-1)) - 1);
    else if (s === "f_p2_start") renderFinalP2Start(state);
    else if (s === "f_p2_entry") renderFinalEntry(state, 2);
    else if (s.startsWith("f_p2_map_q")) renderFinalMapping(state, 2, Number(s.slice(-1)) - 1);
    else if (s === "f_end") renderFinalEnd(state);
    else {
      clear();
      root.appendChild(h("div", { class: "c2-card-inner" }, [h("p", { text: t("control.unhandledStepDebug", { step: s }) })]));
    }
    freshEntry = root.firstElementChild;
    } finally { root = liveRoot; }
    root.dataset.step = s;
    if (existingScreen && freshEntry) {
      reconcileEntry(existingScreen, freshEntry);
      for (const binding of keyboardActions.values()) {
        if (binding.el.dataset.shortcut) binding.el = root.querySelector(`[data-shortcut="${binding.el.dataset.shortcut}"]`) || binding.el;
      }
    }
    if (s === "setup_finish") syncSetupPreviews(state);
    const editButton = root.querySelector("#btnOpenGsModal");
    if (editButton) bindShortcut(editButton, "e", () => emit("setup.openSettings"));
    const hint = root.querySelector(".c2-hint");
    if (hint && !/^(devices_|setup_)/.test(s) && !hint.querySelector(".c2-hint-shortcuts")) {
      const list = h("div", { class: "c2-hint-shortcuts" }, [
        h("div", { class: "c2-hint-shortcuts-title", text: `${t("control.keyboardShortcutsTitle")}:` }),
      ]);
      const mapping = /^f_p[12]_map_q/.test(s);
      const codes = mapping
        ? ["mappingAnswers", "i", "w", "o", ...(s.startsWith("f_p2_") ? ["r"] : []), "reveal", "n", "b", "m"]
        : [...new Set([...keyboardActions].filter(([key]) => key !== "reveal" && !/^[2-6]$/.test(key)).map(([key]) => key === "1" ? "answers" : key)), "m"];
      for (const code of codes) list.append(h("div", { class: "c2-hint-shortcut", text: t(`control.shortcuts.${code}`) }));
      hint.append(list);
    }
    // Zaznaczony kafel (zaznacz → potwierdź, armableTile): sama złota obwódka
    // nie mówi, że trzeba kliknąć drugi raz -- na ten czas podpowiedź o tym.
    if (hint && root.querySelector(".c2-tile-armed")) {
      const main = hint.querySelector(".c2-hint-main") || hint.insertBefore(h("div", { class: "c2-hint-main" }), hint.firstChild);
      main.textContent = t("control.hints.armed");
    }
    // Wyświetlacz w tle tej samej przeglądarki: przeglądarka spowalnia ukryte
    // karty, więc plansza i dźwięk się spóźniają (eksport 24.10, 111 przełączeń
    // okien w jednej grze). Ostrzeżenie nad treścią podpowiedzi.
    if (hint && ctx.displayHiddenSameBrowser && !/^(devices_|setup_)/.test(s)) {
      hint.insertBefore(h("div", { class: "c2-hint-warn", role: "status", text: t("control.hints.displayHiddenSameBrowser") }), hint.firstChild);
    }
    // Brakujące urządzenie, które nie wstrzymuje gry (uśpiony Prowadzący,
    // Przycisk poza pojedynkiem — decyzja 2026-10-29): ostrzeżenie zamiast okna.
    if (hint && ctx.devicesAbsent && !/^(devices_|setup_)/.test(s)) {
      hint.insertBefore(h("div", { class: "c2-hint-warn", role: "status", text: ctx.devicesAbsent }), hint.firstChild);
    }
    const scrollArea = root.querySelector(".c2-scroll-area");
    if (scrollArea) scrollArea.scrollTop = scrollBefore;
    if (savedFocus) {
      const row = root.querySelector(`[data-i="${savedFocus.dataI}"]`);
      const input = row && row.querySelector("input");
      if (input) {
        input.focus();
        try { input.setSelectionRange(savedFocus.selStart, savedFocus.selEnd); } catch {}
      }
    }
    fitGameplayText(root);
  }

  function reconcileEntry(existing, fresh) {
    if (existing.nodeType !== fresh.nodeType || existing.nodeName !== fresh.nodeName) { existing.replaceWith(fresh); return; }
    if (existing.nodeType === 3) { if (existing.data !== fresh.data) existing.data = fresh.data; return; }
    for (const attr of [...existing.attributes]) if (!fresh.hasAttribute(attr.name)) existing.removeAttribute(attr.name);
    for (const attr of [...fresh.attributes]) if (existing.getAttribute(attr.name) !== attr.value) existing.setAttribute(attr.name, attr.value);
    for (const event of ["onclick", "oninput", "onkeydown", "onchange"]) existing[event] = fresh[event];
    if (existing.tagName === "INPUT") {
      // checked to właściwość, nie atrybut — bez tego pole zostaje w stanie
      // z ostatniego kliknięcia, nawet gdy stan gry mówi inaczej.
      if (existing.checked !== fresh.checked) existing.checked = fresh.checked;
      // Preserve a locally typed value while its preceding writes are pending.
      if (document.activeElement !== existing && existing.value !== fresh.value) existing.value = fresh.value;
      return;
    }
    const oldChildren = [...existing.childNodes], newChildren = [...fresh.childNodes];
    for (let i = 0; i < Math.max(oldChildren.length, newChildren.length); i++) {
      if (!newChildren[i]) oldChildren[i].remove();
      else if (!oldChildren[i]) existing.append(newChildren[i]);
      else reconcileEntry(oldChildren[i], newChildren[i]);
    }
  }

  // Aktualizacja SAMYCH cyfr odliczania (timer3 w Rundach / zegarek gracza
  // w Finale), BEZ wołania render() — zgłoszone: "licznik i przyciski cały
  // czas migają" + "wpisywanie nie ma blokować licznika". control/js/app.js
  // woła to co 250ms, dopóki którykolwiek zegarek leci — pełny render() w
  // tym samym rytmie niszczyłby fokus/pozycję kursora w polach wpisywania
  // finału (renderFinalEntry buduje świeże <input> przy KAŻDYM renderze) i
  // restartowałby CSS-animacje/hover WSZYSTKICH innych, niezwiązanych
  // przycisków na ekranie (stąd wrażenie ciągłego migania, nie tylko samych
  // cyfr). Elementy z odpowiednim data-timer-role muszą już istnieć w DOM
  // (ostatni pełny render() je tam umieścił, dopóki dany zegarek leci) —
  // gdy go nie ma (np. operator akurat zmienił ekran), po prostu nic nie
  // robimy, kolejny pełny render() i tak nadejdzie z prawdziwą zmianą stanu.
  function tickTimers(state) {
    const timer3 = state.rounds?.timer3;
    if (timer3?.running) {
      const el = root.querySelector('[data-timer-role="timer3"] [aria-hidden="true"]');
      if (el) el.textContent = String(Math.max(0, Math.ceil((timer3.endsAt - Date.now()) / 1000)));
    }
    const finalTimer = state.final?.runtime?.timer;
    if (finalTimer?.running) {
      const el = root.querySelector('[data-timer-role="final"] [aria-hidden="true"]');
      if (el) el.textContent = `${Math.max(0, Math.ceil((finalTimer.endsAt - Date.now()) / 1000))}s`;
    }
  }

  return { render, tickTimers };
}
