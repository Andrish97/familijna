// Sceny zrzutów. Każda scena to jedna strona (albo jej stan) z danymi demo.
//   id        -- nazwa katalogu wyniku i wartość dla --scenes
//   category  -- grupa w galerii; sceny z homepage: true to kadry strony głównej
//                (familijna-server/docs/e13-zrzuty-strona-glowna.md)
//   path      -- adres strony (lang=… dopisuje runner)
//   sources   -- prefiksy plików, których zmiana oznacza scenę w --changed
//   ready     -- selektor CSS albo funkcja (w stronie) zwracająca true, gdy widok jest gotowy
//   steps     -- kroki Playwrighta przed zrzutem: async (view, { lang, device, page }) => {}
//   devices   -- tylko te urządzenia (np. ["phone"]); size -- własny rozmiar zamiast urządzeń
//   gameState -- wiersz game_state w atrapie (data/game-state.mjs: round | finale | main)
//   previewRow-- stan wysłany do trybu podglądu urządzenia (?preview=1); frame -- przez ramkę rodzica
//   guest     -- odwiedzający bez konta i sesji (atrapa nie zwraca użytkownika)
//   safeArea  -- emulacja strefy bezpiecznej { top, bottom, … } (env(safe-area-inset-*) w CSS strony)
//   initScript -- funkcja uruchamiana na stronie przed jej skryptami (np. przeglądarka iPhone'a)
//   deviceFrame -- "iphone": ekran w ramce iPhone'a na czarnym tle (frameSize: { width, height, scale })
//   db        -- (db, lang) => {} -- zmiana danych atrapy tylko dla tej sceny (pusty stan, błąd, inny stan)
// Sceny obszarów (pełna seria stron, okien i stanów) są w scenes/<obszar>.cjs i dołączane na końcu.
// Przy zmianie strony: dopisz/popraw tu scenę i dane w data/, potem
//   node scripts/screens/run.cjs --changed
const { id, IDS } = require("./data/demo.cjs");

// Bazy → Udostępnione: dwa zaproszenia (kafle propozycji), dwie przyjęte bazy
// i dwie odrzucone przeze mnie (pasek u dołu).
function sharedBasesDemo(db, lang) {
  const names = {
    pl: ["Pytania na wesele", "Quiz rodzinny", "Baza szkolna 2026", "Wieczór filmowy", "Sport i rekreacja", "Kuchnia świata"],
    en: ["Wedding questions", "Family quiz", "School base 2026", "Movie night", "Sports and leisure", "World cuisine"],
    uk: ["Питання на весілля", "Сімейна вікторина", "Шкільна база 2026", "Кіновечір", "Спорт і відпочинок", "Кухні світу"],
  }[lang];
  const owners = [["aleksandra_nowak", "ola.nowak@example.test"], ["jan_kowalski", "jan.k@example.test"]];
  const row = (i, extra) => ({ id: id("8b10", i + 1), name: names[i], owner_id: id("8810", 50 + (i % 2)), owner_username: owners[i % 2][0], owner_email: owners[i % 2][1], created_at: `2026-10-${20 - i}T09:00:00Z`, updated_at: `2026-10-${20 - i}T09:00:00Z`, shared_role: null, proposed: false, task_id: null, task_status: null, proposed_role: null, ...extra });
  db.rpc.list_shared_bases_ext = [
    row(0, { proposed: true, task_id: id("8b20", 1), task_status: "pending", proposed_role: "editor" }),
    row(1, { proposed: true, task_id: id("8b20", 2), task_status: "opened", proposed_role: "viewer" }),
    row(2, { shared_role: "editor" }),
    row(3, { shared_role: "viewer" }),
  ];
  db.rpc.base_declines_list_mine = [4, 5].map((i) => ({ id: id("8b20", i + 1), base_id: id("8b10", i + 1), name: names[i], owner_label: owners[i % 2][0], role: "viewer", token: id("8b30", i), declined_at: "2026-10-18T10:00:00Z", expires_at: "2026-11-17T10:00:00Z" }));
  db.rpc.bases_count_incoming_share_invites = 2;
}

const page = (dir) => [`web/${dir}/index.html`, `web/${dir}/js/`, `web/${dir}/css/`];
const DISPLAY = ["web/control/display/", "web/shared/js/gameplay/", "web/shared/fonts/"];
const clickTab = (selector) => async (view) => {
  await view.locator(selector).first().click();
  await view.waitForTimeout(400);
};
// Ustawienia gry: na tablecie i telefonie sekcje są w wysuwanym panelu.
const gsCat = (name) => async (view) => {
  const toggle = view.locator("#gsSidebarToggle");
  if (await toggle.isVisible()) { await toggle.click(); await view.waitForTimeout(300); }
  await view.locator(`.gs-sidebar-item[data-cat="${name}"]`).first().click();
  await view.waitForTimeout(400);
};
const openModal = (selector, modal = ".overlay:visible") => async (view) => {
  await view.locator(selector).first().click();
  await view.locator(modal).first().waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(250);
};
// Podręcznik: na telefonie pole jest w wysuwanym spisie treści — otwiera je przycisk z lupą.
const manualSearch = (query, result = ".m-search-hit") => async (view) => {
  const toggle = view.locator("#manualSearchToggle");
  if (await toggle.isVisible()) await toggle.click();
  await view.locator("#manualSearch .searchText").fill(query);
  await view.locator(`#manualSearch ${result}`).first().waitFor({ timeout: 5000 });
  await view.waitForTimeout(250);
};
const scrollPreview = async (view) => {
  await view.locator('.gs-logo-tile[data-logo-id="default"]').click();
  await view.locator("#gsLivePreviewWrap").scrollIntoViewIfNeeded();
  await view.waitForTimeout(1500);
};
// Zalogowany gość: znacznik is_guest w metadanych, okno informacji gościa już widziane.
const asGuest = (db) => {
  db.user = { ...db.user, is_anonymous: true, email: null, user_metadata: { ...db.user.user_metadata, is_guest: true } };
  db.localStorage = { ...(db.localStorage || {}), [`fam:guest:info_shown:${db.user.id}`]: "1" };
  db.rpc.guest_is_expired = false;
  db.rpc.guest_touch = null;
};
const selectTile = (selector) => async (view) => {
  await view.locator(selector).first().click();
  await view.waitForTimeout(250);
};

// Kadry strony głównej: jedna wersja każdego -- widok komputerowy 1440×900,
// taki sam na stronie głównej w każdym widoku (telefon i komputer). Wyjątek:
// głosowanie (poll-vote-mobile) -- ekran telefonu w ramce iPhone'a.
const H = { homepage: true, devices: ["desktop"] };
module.exports = [
{ ...H, id: "games", category: "Gry i bazy", title: "Moje gry — Preparowane", path: "/games/", sources: page("games"), ready: "#grid .card", steps: [selectTile("#grid .card:not(.addCard)")] },
{ ...H, id: "game-editor", category: "Gry i bazy", title: "Edycja gry", path: `/games/editor/?id=${IDS.game}`, sources: page("games/editor"), ready: "#qList > *:nth-child(2)" },
{ ...H, id: "bases", category: "Gry i bazy", title: "Bazy pytań", path: "/bases/", sources: page("bases"), ready: "#mineGrid > *:nth-child(2)" },
{ ...H, id: "base-explorer", category: "Gry i bazy", title: "Eksplorator bazy", path: `/bases/explorer/?id=${IDS.base}`, sources: page("bases/explorer"), ready: "#list > *" },
{ ...H, id: "friends", category: "Znajomi, zadania i ankiety", title: "Znajomi", path: "/friends/", sources: [...page("friends"), "web/shared/js/core/contacts-page.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0 },
{ ...H, id: "subscribers", category: "Znajomi, zadania i ankiety", title: "Subskrybenci", path: "/subscribers/", sources: [...page("subscribers"), "web/shared/js/core/contacts-page.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0 },
{ ...H, id: "tasks", category: "Znajomi, zadania i ankiety", title: "Zadania", path: "/tasks/", sources: page("tasks"), ready: "#tasksHost > *" },
{ id: "connect-device", category: "Znajomi, zadania i ankiety", title: "Podłącz urządzenie", path: "/connect/", sources: page("connect"), ready: ".games-shell.skel-step-ready" },
{ ...H, id: "poll-share", category: "Znajomi, zadania i ankiety", title: "Udostępnianie ankiety", path: `/polls/?id=${IDS.poll}`, sources: page("polls"), ready: "#cardMain" },
{ ...H, id: "poll-vote-mobile", category: "Znajomi, zadania i ankiety", title: "Głosowanie anonimowe — telefon", path: `/polls/vote/points/?id=${IDS.poll}&key=poll103KEY`, sources: ["web/polls/vote/points/", "web/shared/js/core/poll"], ready: "#qbox", devices: ["phone"],
    // Jak w dawnym panelu: iPhone 14 (safe area 47/34) na tle strony (motyw zrzutu) 1440×900.
    safeArea: { top: 47, bottom: 34 }, deviceFrame: "iphone", frameSize: { width: 1440, height: 900, scale: 1 } },
{ ...H, id: "poll-results", category: "Znajomi, zadania i ankiety", title: "Głosy i wyniki ankiety", path: `/polls/?id=${IDS.poll}`, sources: [...page("polls"), "web/shared/js/core/poll-results.js"], ready: "#cardMain", steps: [clickTab("#tabResults")] },
{ ...H, id: "appearance", category: "Wygląd i logo", title: "Ustawienia wyglądu", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), ...DISPLAY], ready: "#gsContentInner", steps: [gsCat("display")], devices: ["desktop"], settle: 1500 },
{ ...H, id: "sound", category: "Wygląd i logo", title: "Ustawienia dźwięku", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsContentInner", steps: [clickTab('.gs-sidebar-item[data-cat="sound"]')], devices: ["desktop"] },
{ ...H, id: "logos", category: "Wygląd i logo", title: "Biblioteka logo", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile" },
{
    ...H, id: "logo-draw", category: "Wygląd i logo", title: "Edytor rysunku", path: `/logos/editor/draw/?id=${IDS.logoDraw}`,
    sources: ["web/logos/editor/draw/", "web/logos/js/draw", "web/logos/js/editor-draw.js", "web/logos/js/editor-page.js"],
    ready: () => window.__drawFabric?.getObjects().length > 0,
  },
{ ...H, id: "control-round", category: "Rozgrywka", title: "Panel sterowania — runda", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "round", ready: "#app", devices: ["desktop"], settle: 1200 },
{ ...H, id: "host-round", category: "Rozgrywka", title: "Prowadzący — runda", path: "/control/host/?preview=1", sources: ["web/control/host/", "web/shared/js/gameplay/"], previewRow: "round", frame: true, ready: "#paper.skel-step-ready", devices: ["desktop"] },
{ ...H, id: "display-round", category: "Rozgrywka", title: "Wyświetlacz — runda", path: "/control/display/?preview=1", sources: DISPLAY, previewRow: "round", ready: "#gameScreen:not(.hidden)", devices: ["desktop"], settle: 1500 },
{ ...H, id: "control-finale", category: "Rozgrywka", title: "Panel sterowania — finał", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "finale", ready: "#app", devices: ["desktop"], settle: 1200 },
{ id: "control-devices", category: "Rozgrywka", title: "Panel sterowania — urządzenia", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "devices", ready: ".device-row", devices: ["desktop"], settle: 1200 },
{ id: "control-summary", category: "Rozgrywka", title: "Panel sterowania — podsumowanie", path: `/control/?id=${IDS.game}`, sources: [...page("control"), "web/control/host/", "web/control/display/"], gameState: "summary", ready: ".c2-summary-display", devices: ["desktop"], settle: 2500 },
{ id: "control-round-armed", category: "Rozgrywka", title: "Panel sterowania — zaznaczony kafel (podpowiedź o drugim kliknięciu)", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "round", ready: "#app", devices: ["desktop"], settle: 800,
    steps: [async (view) => { const tile = view.locator(".c2-tilegrid button.c2-tile:not([disabled])").first(); await tile.waitFor(); await tile.click(); await view.waitForSelector(".c2-tile-armed"); }] },
{ id: "control-round-display-hidden", category: "Rozgrywka", title: "Panel sterowania — Wyświetlacz w tle tej samej przeglądarki (ostrzeżenie nad podpowiedzią)", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "round", ready: ".c2-hint-warn", devices: ["desktop"], settle: 800,
    db: (db) => { db.rpc.control_devices_snapshot = `fn:() => { const ctx = localStorage.getItem("familijna:browser-context:${IDS.game}"); return { ok: true, server_time: new Date().toISOString(), devices: Object.fromEntries(["display", "host", "buzzer"].map((k) => [k, { primary_online: true, audio_unlocked: true, visibility: k === "display" ? "hidden" : "visible", focused: k !== "display", waiting_count: 0, last_seen_at: new Date().toISOString(), meta: { page_visibility: k === "display" ? "hidden" : "visible", browser_context_id: k === "display" ? ctx : null } }])) }; }`; } },
{ id: "control-finale-p2", category: "Rozgrywka", title: "Panel sterowania — finał, gracz 2", path: `/control/?id=${IDS.game}`, sources: page("control"), gameState: "finale2", ready: "#app", devices: ["desktop"], settle: 1200 },
{ ...H, id: "og-image", category: "Rozgrywka", title: "Podgląd linku (og:image)", path: "/control/display/?preview=1", sources: DISPLAY, previewRow: "main", ready: "#gameScreen:not(.hidden)", size: { width: 1200, height: 630, scale: 2 }, settle: 1500 },
{ id: "games-poll-text", category: "Dodatkowe", title: "Moje gry — ankiety tekstowe", path: "/games/", sources: page("games"), ready: "#grid .card", steps: [clickTab("#tabPollText")] },
{ id: "games-poll-points", category: "Dodatkowe", title: "Moje gry — punktacja", path: "/games/", sources: page("games"), ready: "#grid .card", steps: [clickTab("#tabPollPoints")] },
{ id: "games-new", category: "Dodatkowe", title: "Moje gry — nowa gra", path: "/games/", sources: page("games"), ready: "#grid .card", steps: [openModal("#grid .addCard")] },
{ id: "game-settings", category: "Dodatkowe", title: "Ustawienia gry — drużyny", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsContentInner", devices: ["desktop", "tablet", "phone"] },
{ id: "game-settings-team-limit", category: "Dodatkowe", title: "Ustawienia gry — nazwa drużyny dłuższa niż Wyświetlacz", path: `/games/settings/?id=${IDS.game}`, devices: ["desktop", "phone"], sources: [...page("games/settings"), "web/shared/js/display/long-text.js"], ready: "#gsTeamA",
    steps: [async (view) => {
      await view.waitForFunction(() => performance.getEntriesByType("resource").some((r) => r.name.includes("font_5x7.json")));
      await view.locator("#gsTeamA").fill("");
      await view.locator("#gsTeamA").pressSequentially("Wesołe Króliczki z Wąchocka");
      await view.locator("#gsTeamB").fill("Zajączki 😀");
      await view.waitForFunction(() => ["A", "B"].every((k) => document.getElementById(`gsTeam${k}Measure`)?.classList.contains("is-warn")));
    }] },
{ id: "game-settings-display", category: "Dodatkowe", title: "Ustawienia gry — wygląd i logo Prowadzącego", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/control/host/", "web/control/display/"], ready: "#gsTeamA", devices: ["desktop", "phone"], settle: 2500,
    steps: [gsCat("display"), scrollPreview] },
{ id: "game-settings-display-modern", category: "Dodatkowe", title: "Ustawienia gry — podgląd Prowadzącego w motywie nowoczesnym", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/control/host/", "web/control/display/"], ready: "#gsTeamA", devices: ["desktop", "phone"], settle: 2500,
    db: (db) => { const g = db.tables.games.find((x) => x.id === IDS.game); g.settings = { ...(g.settings || {}), display: { ...(g.settings?.display || {}), theme: "modern" } }; },
    steps: [gsCat("display"), scrollPreview] },
{ id: "game-settings-prize", category: "Dodatkowe", title: "Ustawienia gry — kwota nagrody po finale (wyjaśnienie wzoru)", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/shared/js/gameplay/endScreen.js"], ready: "#gsTeamA", devices: ["desktop", "phone"], settle: 600,
    steps: [async (view) => {
      await gsCat("questions")(view);
      await view.locator("label:has([name='gsHasFinal'][value='yes'])").click();
      await gsCat("game")(view);
      await view.locator("label:has([name='gsEndMode'][value='money'])").click();
      await view.locator("#gsPrizeSettingsRow").scrollIntoViewIfNeeded();
      await view.waitForTimeout(300);
    }] },
{ id: "game-settings-color", category: "Dodatkowe", title: "Ustawienia gry — okno koloru (jak kolor tagów)", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/shared/css/game-settings.css"], ready: "#gsTeamA", devices: ["desktop", "phone"], settle: 800,
    steps: [gsCat("display"), async (view) => { await view.locator("[data-color-key]").first().click(); await view.locator("#gsColorHex").waitFor({ state: "visible" }); await view.waitForTimeout(400); }] },
{ id: "game-settings-questions", category: "Dodatkowe", title: "Ustawienia gry — pytania (finał)", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsTeamA", devices: ["desktop"],
    steps: [clickTab('.gs-sidebar-item[data-cat="questions"]')] },
{ id: "game-settings-game", category: "Dodatkowe", title: "Ustawienia gry — rozgrywka (ekran końcowy)", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsTeamA", devices: ["desktop"],
    steps: [clickTab('.gs-sidebar-item[data-cat="game"]')] },
{ id: "game-settings-game-invalid", category: "Dodatkowe", title: "Ustawienia gry — błędna wartość i podpowiedzi progów", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsTeamA", devices: ["desktop"],
    steps: [clickTab('.gs-sidebar-item[data-cat="game"]'), async (view) => {
      await view.locator("#gsFinalTarget").fill("500");
      await view.locator("#gsFinalMinPts").fill("5000");
      await view.locator("#gsMultipliers").fill("1, 0, 2");
      await view.waitForTimeout(800);
    }] },
{ id: "game-settings-display-pixel", category: "Dodatkowe", title: "Ustawienia gry — logo domyślne w trybie Piksele", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/control/host/", "web/control/display/"], ready: "#gsTeamA", devices: ["desktop", "phone"], settle: 2500,
    steps: [gsCat("display"), clickTab(".gs-host-logo-mode .toggle-item"), scrollPreview] },
{ id: "game-settings-phone-landscape", category: "Dodatkowe", title: "Ustawienia gry — telefon w poziomie: prośba o obrót (działa tylko w pionie)", path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/shared/js/core/device-guard.js"], ready: () => !!document.querySelector("#pageGuard, .page-guard"), devices: ["phone-landscape"], settle: 600 },
{ id: "guard-height-tablet", category: "Dodatkowe", title: "Moje gry — tablet w poziomie, niski viewport (1200×560): prośba o obrót", path: "/games/", sources: [...page("games"), "web/shared/js/core/device-guard.js"], ready: () => document.documentElement.dataset.deviceGuard === "rotate", devices: ["tablet-landscape-short"], settle: 600 },
{ id: "guard-height-desktop", category: "Dodatkowe", title: "Moje gry — niskie okno komputera (1400×550): Za małe okno", path: "/games/", sources: [...page("games"), "web/shared/js/core/device-guard.js"], ready: () => document.documentElement.dataset.deviceGuard === "small", devices: ["desktop-short"], settle: 600 },
{ id: "guard-height-display", guest: true, category: "Dodatkowe", title: "Wyświetlacz — niskie okno komputera (1400×550): Za małe okno", path: "/control/display/", sources: ["web/control/display/", "web/shared/js/core/device-guard.js"], ready: () => document.documentElement.dataset.deviceGuard === "small", size: { width: 1400, height: 550 }, settle: 600 },
{ id: "guard-height-none-host", guest: true, category: "Dodatkowe", title: "Prowadzący — dotykowe okno 1400×550: bez blokady wysokości", path: `/control/host/?id=${IDS.game}&key=hst${IDS.game.slice(-3)}KEY`, sources: ["web/control/host/", "web/shared/js/core/device-guard.js"], gameState: "round", ready: () => document.documentElement.dataset.deviceGuard === "ok", devices: ["tablet-short-1400"], settle: 2500 },
{ id: "guard-height-none-buzzer", guest: true, category: "Dodatkowe", title: "Przycisk — dotykowe okno 1400×550: bez blokady wysokości (poza pojedynkiem ekran wygaszony)", path: `/control/buzzer/?id=${IDS.game}&key=bzr${IDS.game.slice(-3)}KEY`, sources: ["web/control/buzzer/", "web/shared/js/core/device-guard.js"], gameState: "round", ready: () => document.documentElement.dataset.deviceGuard === "ok", devices: ["tablet-short-1400"], settle: 2500 },
{ id: "device-lease-replaced", guest: true, category: "Dodatkowe", title: "Przycisk — urządzenie otwarto w innym miejscu (Używaj tutaj)", path: `/control/buzzer/?id=${IDS.game}&key=bzr${IDS.game.slice(-3)}KEY`, sources: ["web/control/buzzer/", "web/shared/js/core/device-lease.js"], gameState: "round",
    db: (db) => { const replaced = { mode: "lease", state: "replaced", epoch: null, queue_position: null, waiting_count: 0, audio_unlocked: false }; db.rpc.control_device_instance_register = replaced; db.rpc.control_device_instance_heartbeat = replaced; },
    ready: "#deviceLeaseTakeover", devices: ["tablet", "phone-landscape"], settle: 800 },
{ id: "guard-height-none-snake", guest: true, category: "Dodatkowe", title: "Ukryta gra w węża — okno 1400×550: bez blokady wysokości", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", sources: [...page("snake"), "web/shared/js/core/device-guard.js"], ready: "#snakeFrame[data-mode=intro]", devices: ["desktop-short"], settle: 800 },
{ id: "guard-height-ok", category: "Dodatkowe", title: "Moje gry — komputer 1400×900: bez blokady", path: "/games/", sources: [...page("games"), "web/shared/js/core/device-guard.js"], ready: "#grid .card", devices: ["desktop-1400"] },
{ id: "game-settings-sound", category: "Dodatkowe", title: "Ustawienia gry — dźwięki (telefon: nazwa nad kontrolkami)", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsContentInner", devices: ["phone", "tablet"], steps: [gsCat("sound")] },
{ id: "game-settings-sound-custom", category: "Dodatkowe", title: "Ustawienia gry — własne dźwięki: plik z długą nazwą i „Własny” bez pliku", path: `/games/settings/?id=${IDS.game}`, sources: page("games/settings"), ready: "#gsContentInner", devices: ["desktop", "tablet", "phone"], settle: 600,
    steps: [gsCat("sound"), async (view) => {
      // Pierwszy wiersz: własny plik o długiej nazwie (cisza WAV, bez dźwięku w zrzucie).
      const wav = Buffer.alloc(44 + 800); wav.write("RIFF", 0); wav.writeUInt32LE(36 + 800, 4); wav.write("WAVEfmt ", 8);
      wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
      wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write("data", 36); wav.writeUInt32LE(800, 40);
      await view.locator(".sfx-row .sfx-file-input").first().setInputFiles({ name: "Nasza-muzyka-na-wejscie-druzyn-wersja-finalna.wav", mimeType: "audio/wav", buffer: wav });
      await view.locator(".sfx-row .sfx-file-tag").first().waitFor({ timeout: 5000 });
      // Drugi wiersz: „Własny” bez pliku — przycisk wyboru pliku.
      await view.locator(".sfx-row").nth(1).locator(".ui-select-btn").click();
      await view.locator(".sfx-row").nth(1).locator(".menu-item").last().click();
      await view.waitForTimeout(300);
    }] },
{ id: "games-guest", category: "Dodatkowe", title: "Moje gry — gość: pasek akcji (Powiel, bez Wyślij)", path: "/games/", sources: page("games"), ready: "#grid .card", db: asGuest, steps: [selectTile("#grid .card:not(.addCard)")] },
{ id: "logos-guest", category: "Dodatkowe", title: "Biblioteka logo — gość: pasek akcji (Powiel, bez Wyślij)", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile", db: asGuest, steps: [selectTile(".logoTile")] },
{ id: "logos-received", category: "Dodatkowe", title: "Biblioteka logo — otrzymane logo (plakietka „Od: …” i filtr OTRZYMANE)", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile",
    db: (db) => { const l = db.tables.user_logos.find((x) => x.type === "GLYPH_30x10" || x.type) ; l.received_from_label = "aleksandra_nowak"; l.received_from_identity = "user:demo-friend"; },
    steps: [async (view) => { await view.locator(".list-filter .ui-select-btn:visible").first().click(); await view.waitForTimeout(400); }] },
{ id: "logos-draw", category: "Dodatkowe", title: "Biblioteka logo — rysunki", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile", steps: [clickTab("#tabLogoDraw")] },
{ id: "logos-image", category: "Dodatkowe", title: "Biblioteka logo — obrazy", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile", steps: [clickTab("#tabLogoImage")] },
{ id: "logo-text", category: "Dodatkowe", title: "Edytor logo — tekst", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: ["web/logos/editor/text/", "web/logos/js/text.js", "web/logos/js/editor-text.js", "web/logos/js/editor-page.js"], ready: "#logoName", devices: ["desktop", "tablet"] },
{ id: "logo-image", category: "Dodatkowe", title: "Edytor logo — obraz", path: `/logos/editor/image/?id=${id("8300", 47)}`, sources: ["web/logos/editor/image/", "web/logos/js/editor-image.js", "web/logos/js/editor-page.js"], ready: "#logoName", devices: ["desktop", "tablet"], settle: 1500 },
{ id: "logo-text-space", category: "Dodatkowe", title: "Edytor logo — tekst ze spacją (odstęp między słowami)", path: `/logos/editor/text/?id=${IDS.logoText}`, sources: ["web/logos/editor/text/", "web/logos/js/text.js", "web/logos/js/editor-text.js", "web/logos/js/editor-page.js"], ready: "#logoName", devices: ["desktop", "tablet"], devices: ["desktop"], steps: [async (view) => { await view.locator("#textValue").fill("QUIZ 2026"); await view.waitForTimeout(300); }] },
{ id: "login", guest: true, category: "Dodatkowe", title: "Logowanie — górne przyciski (powrót; „i” i język po prawej)", path: "/login/", sources: ["web/login/", "web/shared/translation/translation.js"], ready: "#btnPrimary" },
{ id: "login-from-snake", guest: true, category: "Dodatkowe", title: "Logowanie otwarte z gry w węża — powrót „Wąż” do gry", path: "/login/?next=snake&qr=00000000-0000-4000-8000-000000000103", sources: ["web/login/", "web/snake/"], ready: () => /\/snake\//.test(document.getElementById("btnBackHome")?.getAttribute("href") || "") },
{ id: "login-confirm", guest: true, category: "Dodatkowe", title: "Potwierdzenie konta — wspólna powłoka logowania (.auth-body)", path: "/login/confirm/", sources: ["web/login/confirm/", "web/shared/css/auth-landing.css"], ready: ".auth-shell.skel-step-ready" },
{ id: "login-reset", guest: true, category: "Dodatkowe", title: "Reset hasła — wspólna powłoka logowania (.auth-body)", path: "/login/reset/", sources: ["web/login/reset/", "web/shared/css/auth-landing.css"], ready: ".auth-shell.skel-step-ready" },
{ id: "login-register", guest: true, category: "Dodatkowe", title: "Logowanie — tryb zakładania konta (ikony przycisków po zmianie trybu)", path: "/login/", sources: ["web/login/"], ready: "#btnPrimary",
    steps: [async (view) => { await view.locator("#btnToggle").click(); await view.waitForTimeout(300); }] },
{ id: "subscribers-search", category: "Dodatkowe", title: "Subskrybenci — wyszukiwanie (pole nad listą, jak „Przenieś do”)", path: "/subscribers/", sources: [...page("subscribers"), "web/shared/js/core/contacts-page.js", "web/shared/js/core/share-sections.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0,
    steps: [async (view, { device }) => {
      const tab = view.locator("#contactsTabReceived");
      if (await tab.isVisible()) { await tab.click(); await view.waitForTimeout(300); }
      await view.locator("#contactsReceived .listTools-search:visible").first().click();
      await view.locator("#contactsReceived .listToolsInline .searchText").fill("k");
      await view.waitForTimeout(300);
    }] },
{ id: "games-search-prompt", category: "Dodatkowe", title: "Moje gry — okno wyszukiwania na telefonie (pole jak „Przenieś do”)", devices: ["phone"], path: "/games/", sources: [...page("games"), "web/shared/js/core/list-search.js", "web/shared/js/core/modal.js"], ready: "#grid .card",
    steps: [async (view) => { await view.locator(".list-search-open").click(); await view.locator(".uni-modal .uni-inp").fill("rodz"); await view.waitForTimeout(300); }] },
{ id: "subscribers-filter", category: "Dodatkowe", title: "Subskrybenci — filtr stanu (oczekujące i odrzucone)", path: "/subscribers/", sources: [...page("subscribers"), "web/shared/js/core/contacts-page.js", "web/shared/js/core/share-sections.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0,
    steps: [async (view) => {
      const tab = view.locator("#contactsTabInvite");
      if (await tab.isVisible()) { await tab.click(); await view.waitForTimeout(300); }
      await view.locator("#contactsOutgoing .list-filter .ui-select-btn:visible").first().click();
      await view.waitForTimeout(300);
    }] },
{ id: "tasks-tools", category: "Dodatkowe", title: "Zadania — przyciski listy w nagłówku sekcji", path: "/tasks/", sources: [...page("tasks"), "web/shared/js/core/share-sections.js"], ready: "#tasksHost > *" },
{ id: "tasks-decline-confirm", category: "Dodatkowe", title: "Zadania — potwierdzenie odrzucenia (wspólne okno)", path: "/tasks/", sources: [...page("tasks"), "web/shared/js/core/modal.js"], ready: "#tasksHost > *",
    steps: [async (view) => { await view.locator('.rowsAct').filter({ hasText: /Odrzu|Decline|Відхил/ }).first().click(); await view.locator(".overlay:visible .uni-modal").first().waitFor({ timeout: 5000 }); await view.waitForTimeout(400); }] },
{ id: "tooltip", category: "Dodatkowe", title: "Podpowiedź po najechaniu (core/tooltips.js)", path: "/games/", sources: [...page("games"), "web/shared/js/core/tooltips.js"], ready: "#grid .card", devices: ["desktop"],
    steps: [async (view) => { await view.locator("#btnManual").hover(); await view.waitForTimeout(400); }] },
{ id: "tasks-search", category: "Dodatkowe", title: "Zadania — wyszukiwanie w sekcji", path: "/tasks/", sources: [...page("tasks"), "web/shared/js/core/share-sections.js"], ready: "#tasksHost > *",
    steps: [async (view) => { await view.locator(".listTools-search").first().click(); await view.locator(".listToolsInline .searchText").first().fill("we"); await view.waitForTimeout(400); }] },
{ id: "games-account-menu", category: "Dodatkowe", title: "Gry — hamburger z ustawieniami konta i wylogowaniem", path: "/games/", sources: [...page("games"), "web/shared/js/core/topbar-controller.js"], ready: "#grid .card",
    steps: [async (view) => {
      const toggle = view.locator(".topbar-menu-toggle");
      if (await toggle.isVisible()) await toggle.click(); else await view.locator(".account-btn").first().click();
      await view.locator("#topbarAccountMenu .menu-item").first().waitFor({ state: "visible" });
      await view.locator("#topbarAccountMenu .menu-item").last().waitFor({ state: "visible" });
      await view.waitForTimeout(300);
    }] },
{ id: "theme-menu", category: "Dodatkowe", title: "Menu wyglądu (Automatyczny / Jasny / Ciemny)", path: "/tasks/", sources: [...page("tasks"), "web/shared/js/core/theme-switcher.js", "web/shared/js/core/page-boot.js"], ready: "#tasksHost > *",
    steps: [async (view) => {
      await view.locator(".theme-btn").first().click();
      await view.waitForTimeout(400);
    }] },
{ id: "tasks-account-menu", category: "Dodatkowe", title: "Zadania — menu konta (komputer) i menu telefonu", path: "/tasks/", sources: [...page("tasks"), "web/shared/js/core/topbar-controller.js"], ready: "#tasksHost > *",
    steps: [async (view) => {
      const toggle = view.locator(".topbar-menu-toggle");
      if (await toggle.isVisible()) await toggle.click(); else await view.locator(".account-btn").first().click();
      await view.waitForTimeout(500);
    }] },
{ id: "empty-state-games", category: "Dodatkowe", title: "Pusty stan — Moje gry, wyszukiwanie bez wyników", path: "/games/", sources: [...page("games"), "web/shared/js/core/list-search.js"], ready: "#grid .card", devices: ["desktop"],
    steps: [async (view) => {
      // Dłuższe napisy (UK) zwijają pasek do ikon: wtedy wyszukiwanie otwiera lupa.
      const open = view.locator(".list-toolbar .list-search-open");
      if (await open.isVisible()) { await open.click(); await view.waitForTimeout(300); }
      await view.locator(".list-toolbar .searchText:visible, .searchText:visible").first().fill("zzzz");
      await view.waitForTimeout(500);
    }] },
{ id: "empty-state-friends", category: "Dodatkowe", title: "Pusty stan — Znajomi, wyszukiwanie bez wyników", path: "/friends/", sources: [...page("friends"), "web/shared/js/core/share-sections.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0, devices: ["desktop"],
    steps: [async (view) => { await view.locator(".listTools-search").first().click(); await view.locator(".listToolsInline .searchText").first().fill("zzzz"); await view.waitForTimeout(400); }] },
{ id: "friends-tools", category: "Dodatkowe", title: "Znajomi — przyciski listy w nagłówku sekcji", path: "/friends/", sources: [...page("friends"), "web/shared/js/core/contacts-page.js", "web/shared/js/core/share-sections.js"], ready: () => document.querySelector("#contactsReceived")?.children.length > 0 },
{ id: "bases-shared-proposed", category: "Dodatkowe", title: "Bazy — Udostępnione: zaproszenia jako kafle propozycji na początku listy (✓/✕ w rogu), licznik w linii na wypustce", path: "/bases/?tab=shared", sources: [...page("bases"), "web/shared/js/core/proposed-tile.js"], ready: "#sharedGrid .card[data-proposed]",
    db: sharedBasesDemo },
{ id: "bases-shared-declined-open", category: "Dodatkowe", title: "Bazy — Udostępnione: rozwinięta sekcja „Odrzucone” (narzędzia listy w linii nagłówka)", path: "/bases/?tab=shared", sources: [...page("bases"), "web/shared/js/core/share-sections.js"], ready: "#sharedGrid .card[data-proposed]",
    db: sharedBasesDemo, steps: [async (view) => { const head = view.locator("#baseDeclinesHost .rowsSectionHead").first(); await head.scrollIntoViewIfNeeded(); await head.click(); await view.waitForTimeout(400); await view.locator("#baseDeclinesHost .shareRow").last().scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
{ id: "bases-share-tools", category: "Dodatkowe", title: "Bazy — okno „Udostępnienia” (górny pasek): lista udostępnionych, uprawnienie przy osobie, Zamknij", path: "/bases/", sources: [...page("bases"), "web/shared/js/core/share-sections.js"], ready: "#mineGrid > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#mineGrid .card:not(.addCard)").first().click(); await view.locator("#btnShare").click(); await view.locator("#shareOverlay").waitFor({ state: "visible" }); await view.waitForTimeout(600); }] },
{ id: "bases-share-send", category: "Dodatkowe", title: "Bazy — okno „Udostępnij bazę” (dolny pasek, jak „Wyślij” w Grach): adres, znajomi, w stopce uprawnienie + Anuluj + Udostępnij", path: "/bases/", sources: [...page("bases"), "web/shared/js/core/share-sections.js"], ready: "#mineGrid > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#mineGrid .card:not(.addCard)").first().click(); await view.locator("#btnShareSend").click(); await view.locator("#shareSendOverlay").waitFor({ state: "visible" }); await view.locator("#baseShareFriends input").first().check(); await view.waitForTimeout(600); }] },
{ id: "bases-share-long-name", category: "Dodatkowe", title: "Bazy — udostępnione: długa nazwa użytkownika (wielokropek, stała wysokość kafla)", path: "/bases/", sources: [...page("bases"), "web/shared/js/core/share-sections.js"], ready: "#mineGrid > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#mineGrid .card:not(.addCard)").first().click(); await view.locator("#btnShare").click(); await view.locator("#shareOverlay").waitFor({ state: "visible" }); await view.waitForTimeout(600); await view.locator("#shareSectionsHost").evaluate((el) => { el.scrollTop = el.scrollHeight; }); await view.waitForTimeout(200); }] },
{ id: "control-share-device", category: "Dodatkowe", title: "Panel sterowania — okno „Udostępnienia” urządzenia (lista w tej sesji, Zamknij)", path: `/control/?id=${IDS.game}`, sources: [...page("control"), "web/shared/js/core/share-sections.js"], gameState: "devices", ready: ".device-row", devices: ["desktop"], settle: 800,
    steps: [async (view) => { await view.locator('.device-row [data-act="share-list"]').first().click(); await view.locator("#shareDeviceOverlay").waitFor({ state: "visible" }); await view.waitForTimeout(600); }] },
{ id: "control-share-send", category: "Dodatkowe", title: "Panel sterowania — okno „Udostępnij” urządzenia (adres, znajomi, Anuluj + Udostępnij)", path: `/control/?id=${IDS.game}`, sources: [...page("control"), "web/shared/js/core/share-sections.js"], gameState: "devices", ready: ".device-row", devices: ["desktop"], settle: 800,
    steps: [async (view) => { await view.locator('.device-row [data-act="share-send"]').first().click(); await view.locator("#shareDeviceSendOverlay").waitFor({ state: "visible" }); await view.locator("#shareDeviceSubsList input").first().check(); await view.waitForTimeout(600); }] },
{ id: "poll-recipients-tools", category: "Dodatkowe", title: "Ankieta — okno odbiorców z przyciskami list", path: `/polls/?id=${IDS.poll}`, sources: [...page("polls"), "web/shared/js/core/share-sections.js"], ready: "#cardMain",
    steps: [async (view) => { const b = view.locator("#btnAddRecipients"); if (!(await b.isVisible())) { const tab = view.locator(".slot-recipients button, #tabRecipients").first(); if (await tab.count()) await tab.click(); } await view.locator("#btnAddRecipients").click(); await view.waitForTimeout(600); }] },
{ id: "mails-tools", category: "Dodatkowe", title: "Mails — listy subskrypcji i zadań z przyciskami", path: "/mails/", sources: ["web/mails/", "web/mail/", "web/shared/js/core/share-sections.js"], ready: "#subscriptionList > *" },
{ id: "games-send-tools", category: "Dodatkowe", title: "Moje gry — okno Wyślij kopię (lista znajomych z przyciskami)", path: "/games/", sources: [...page("games"), "web/shared/js/core/resource-send.js", "web/shared/js/core/share-sections.js"], ready: "#grid .card",
    steps: [selectTile("#grid .card:not(.addCard)"), async (view) => { await view.locator("#btnSendCopy").click(); await view.locator("#resourceSendOverlay").waitFor({ state: "visible" }); await view.waitForTimeout(500); }] },
{ id: "games-send-history", category: "Dodatkowe", title: "Moje gry — okno Wyślij kopię, rozwinięta Historia wysyłek", path: "/games/", sources: [...page("games"), "web/shared/js/core/resource-send.js", "web/shared/js/core/share-sections.js"], ready: "#grid .card",
    db: (db) => { db.rpc.resource_copy_history = { ok: true, items: [
      { recipient_label: "aleksandra_nowak", sent_at: "2026-10-28T18:20:00Z" },
      { recipient_label: "jan_kowalski", sent_at: "2026-10-21T09:05:00Z" },
      { recipient_label: "anna.nowak", sent_at: "2026-10-12T16:40:00Z" },
    ] }; },
    steps: [selectTile("#grid .card:not(.addCard)"), async (view) => { await view.locator("#btnSendCopy").click(); await view.locator("#resourceSendOverlay").waitFor({ state: "visible" }); await view.locator("#resourceSendOverlay .resource-send-history > summary").click(); await view.waitForTimeout(500); }] },
{ id: "game-editor-answer-rules", category: "Dodatkowe", title: "Edycja gry — warunki gotowości, odpowiedź ze znakiem spoza Wyświetlacza i poniżej 4 pkt, podpowiedzi 17/finał 11", path: `/games/editor/?id=${IDS.game}`, sources: [...page("games/editor"), "web/shared/js/core/question-form.js", "web/shared/js/core/game-rules.js", "web/shared/css/question-form.css"], ready: "#qList > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#qList .qcard:not(.addCard)").first().click(); const inp = view.locator("#aList .qf-row:not(.qf-add) .qf-text").first(); await inp.fill("kawa😀"); const pts = view.locator("#aList .qf-row:not(.qf-add) .qf-pts").nth(3); await pts.fill("2"); await pts.blur(); await view.waitForTimeout(600); }] },
{ id: "games-change-type", category: "Dodatkowe", title: "Moje gry — Zmień typ", path: "/games/", sources: [...page("games"), "web/shared/js/core/game-validate.js"], ready: "#grid .card",
    steps: [selectTile("#grid .card:not(.addCard)"), openModal("#btnChangeType", ".change-type"), async (view) => { await view.locator('.change-type-option:has(input[value="poll_text"])').click(); await view.waitForTimeout(250); }] },
{ id: "base-explorer-create-game", category: "Dodatkowe", title: "Eksplorator bazy — Utwórz grę (braki informacyjnie)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer"), "web/shared/js/core/game-rules.js"], ready: "#list > *",
    steps: [async (view) => { await view.locator("#list .row[data-kind=\"q\"]").first().click(); await view.locator("#list .row[data-kind=\"q\"]").nth(1).click({ modifiers: ["Control"] }); await view.locator('#toolbar button[data-act="createGame"]').click(); await view.locator("#exportOverlay").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(300); }] },
{ id: "base-explorer-tags", category: "Dodatkowe", title: "Eksplorator bazy — okno tagów zaznaczonego pytania", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click(); await view.locator('#toolbar button[data-act="editTags"]').click(); await view.locator("#tagsOverlay").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(500); }] },
{ id: "base-explorer-tags-edit", category: "Dodatkowe", title: "Eksplorator bazy — okno tagów: dodawanie tagu", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click(); await view.locator('#toolbar button[data-act="editTags"]').click(); await view.locator("#tagsAddNew").click(); await view.locator("#tagsL2").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(500); }] },
{ id: "base-explorer-tags-color", category: "Dodatkowe", title: "Eksplorator bazy — okno tagów: wybór koloru", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click(); await view.locator('#toolbar button[data-act="editTags"]').click(); await view.locator("#tagsAddNew").click(); await view.locator("#tagsEditColorTile").click(); await view.locator("#tagsL3").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(500); }] },
{ id: "base-explorer-drawer", category: "Dodatkowe", title: "Eksplorator bazy — lewy panel na telefonie (hamburger)", devices: ["phone", "tablet"], path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { if (await view.locator("#btnDrawerToggle").isVisible()) await view.locator("#btnDrawerToggle").click(); await view.waitForTimeout(300); }] },
{ id: "base-explorer-left-tags", category: "Dodatkowe", title: "Eksplorator bazy — lewy panel: widok tagów (przycisk przy wyszukiwarce / na telefonie)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('[data-left-view="tags"]:visible').click(); await view.locator('#tags .row[data-kind="tag"]').first().click(); await view.waitForTimeout(500); }] },
{ id: "base-explorer-left-types", category: "Dodatkowe", title: "Eksplorator bazy — lewy panel: widok proponowanych kategorii", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('[data-left-view="types"]:visible').click(); await view.waitForTimeout(500); }] },
{ id: "base-explorer-search-sheet", devices: ["phone", "tablet"], category: "Dodatkowe", title: "Eksplorator bazy — telefon: okno Szukaj (tekst; filtry w panelu)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => {
      await view.locator("#btnSearchSheet").click();
      await view.locator("#searchOverlay.sheet-active").waitFor({ timeout: 5000 });
      await view.locator("#searchText").pressSequentially("co");
      await view.waitForTimeout(500);
    }] },
{ id: "base-explorer-search-filters", category: "Dodatkowe", title: "Eksplorator bazy — tekst w wyszukiwarce razem z tagiem z panelu (licznik na przycisku)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => {
      await view.locator('[data-left-view="tags"]:visible').first().click();
      const rows = view.locator('#tags .row[data-kind="tag"]');
      await rows.nth(0).click();
      const narrow = await view.locator(".left-view-tabs").isVisible();
      if (narrow) {
        await view.locator('.left-view-tabs [data-left-view="tags"]').click();
        await view.locator("#btnSearchSheet").click();
        await view.locator("#searchText").pressSequentially("co");
        await view.locator("#searchSheetDone").click();
      } else {
        await view.locator("#searchText").pressSequentially("co");
        await view.locator("#searchText").blur();
      }
      await view.waitForTimeout(500);
    }] },
{ id: "base-explorer-move", category: "Dodatkowe", title: "Eksplorator bazy — Przenieś do… (drzewo folderów z wyszukiwaniem)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click({ button: "right" }); await view.locator('#contextMenu .menu-item[data-action="item.moveTo"]').click(); await view.locator("#moveOverlay .moveRow").first().waitFor({ timeout: 5000 }); await view.locator("#moveList .tree-toggle").nth(1).click(); await view.locator("#moveList .tree-toggle").nth(2).click(); await view.locator('#moveList .moveRow[aria-expanded="true"] + .moveRow').last().click(); await view.waitForTimeout(400); }] },
{ id: "base-explorer-move-search", category: "Dodatkowe", title: "Eksplorator bazy — Przenieś do…: wyszukiwanie folderu", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click({ button: "right" }); await view.locator('#contextMenu .menu-item[data-action="item.copyTo"]').click(); await view.locator("#moveSearch").fill("o"); await view.waitForTimeout(400); }] },
{ id: "base-explorer-trash", category: "Dodatkowe", title: "Eksplorator bazy — Kosz jako folder (dni do usunięcia, Przywróć w pasku)", path: `/bases/explorer/?id=${IDS.base}&trash=1`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="trash"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="trash"]').first().click(); await view.waitForTimeout(300); }] },
{ id: "base-explorer-menu", category: "Dodatkowe", title: "Eksplorator bazy — menu kontekstowe (telefon: arkusz od dołu)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().click({ button: "right" }); await view.locator("#contextMenu:not([hidden])").waitFor({ timeout: 5000 }); await view.waitForTimeout(300); }] },
{ id: "base-explorer-filter", category: "Dodatkowe", title: "Eksplorator bazy — wyniki filtra (tag z lewego panelu, liczba trafień w folderach)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer")], ready: '#list .row[data-kind="q"]',
    steps: [async (view) => {
      await view.locator('[data-left-view="tags"]:visible').first().click();
      await view.locator('#tags .row[data-kind="tag"]').first().click();
      if (await view.locator(".left-view-tabs").isVisible()) await view.locator('.left-view-tabs [data-left-view="tags"]').click();
      await view.waitForTimeout(400);
    }] },
{ id: "game-editor-question-sheet", devices: ["phone"], category: "Dodatkowe", title: "Edycja gry na telefonie — pytanie w oknie od dołu", path: `/games/editor/?id=${IDS.game}`, sources: [...page("games/editor"), "web/shared/js/core/modal-sheet.js", "web/shared/css/question-form.css"], ready: "#qList > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#qList .qcard[data-id]").first().click(); await view.locator("#questionSheetOverlay.sheet-active").waitFor({ timeout: 5000 }); await view.locator("#aList .qf-row:not(.qf-add)").first().waitFor({ timeout: 5000 }); await view.waitForTimeout(500); }] },
{ id: "base-explorer-question-modal", category: "Dodatkowe", title: "Eksplorator bazy — edycja pytania (podpowiedzi nad kafelkiem dodawania)", path: `/bases/explorer/?id=${IDS.base}`, sources: [...page("bases/explorer"), "web/shared/js/core/question-form.js", "web/shared/css/question-form.css"], ready: "#list > *",
    steps: [async (view) => { await view.locator('#list .row[data-kind="q"]').first().dblclick(); await view.locator("#questionOverlay").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(400); }] },
{ id: "polls-tally-tie", category: "Dodatkowe", title: "Podliczanie ankiety tekstowej — remis na granicy szóstki", path: `/polls/?id=${IDS.tallyTie}`, sources: [...page("polls"), "web/shared/js/core/poll-tally-math.js", "web/shared/js/core/poll-results.js"], ready: "#cardMain",
    steps: [clickTab("#tabResults"), async (view) => { await view.locator("#btnTallyPoll").click(); await view.locator(".tallyTieInfo:not([hidden])").first().waitFor({ timeout: 8000 }); await view.waitForTimeout(400); }] },
{ id: "poll-vote-text", category: "Dodatkowe", title: "Głosowanie tekstowe — podpowiedź (17 znaków, pomijane znaki)", path: `/polls/vote/text/?id=${IDS.textPoll}&key=poll104KEY`, sources: ["web/polls/vote/text/", "web/shared/js/core/answer-text.js"], ready: "#answerInput", devices: ["phone"] },
{ id: "polls-text", category: "Dodatkowe", title: "Ankieta tekstowa — głosy", path: `/polls/?id=${IDS.textPoll}`, sources: [...page("polls"), "web/shared/js/core/poll-results.js"], ready: "#cardMain", steps: [clickTab("#tabResults")] },
{ id: "polls-tally-points", category: "Dodatkowe", title: "Podliczanie ankiety punktowej (zamykanie)", path: `/polls/?id=${IDS.pollStopped}`, sources: [...page("polls"), "web/shared/js/core/poll-tally-math.js", "web/shared/js/core/poll-results.js"], ready: "#cardMain",
    steps: [clickTab("#tabResults"), async (view) => { await view.locator("#btnTallyPoll").click(); await view.locator("#tallyBar:not([hidden])").waitFor({ timeout: 8000 }); await view.waitForTimeout(400); }] },
{ id: "polls-stopped", category: "Dodatkowe", title: "Ankieta zatrzymana — głosy", path: `/polls/?id=${IDS.pollStopped}`, sources: [...page("polls"), "web/shared/js/core/poll-results.js"], ready: "#cardMain", steps: [clickTab("#tabResults")] },
{ id: "marketplace", category: "Dodatkowe", title: "Społeczność", path: "/marketplace/", sources: page("marketplace"), ready: ".mkt-card" },
{ id: "marketplace-my-sent", category: "Dodatkowe", title: "Społeczność — okno Moje wysłane", path: "/marketplace/", sources: page("marketplace"), ready: ".mkt-card", steps: [openModal("#btnMySent", "#mySentOverlay")] },
{ id: "snake-iphone", guest: true, category: "Dodatkowe", title: "Ukryta gra w węża — iPhone w poziomie (wcięcie i pasek gestu)", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", devices: ["phone-landscape"], safeArea: { left: 59, right: 59, bottom: 21 },
    sources: [...page("snake")], ready: "#snakeFrame[data-mode=intro]" },
{ id: "snake-a2hs", guest: true, category: "Dodatkowe", title: "Ukryta gra w węża — iPhone: dodaj do ekranu początkowego", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", devices: ["phone-landscape"], safeArea: { left: 59, right: 59, bottom: 21 },
    sources: [...page("snake")], ready: "#snakeFrame[data-mode=intro]",
    steps: [async (view) => { await view.evaluate(() => { document.documentElement.classList.add("showA2HS"); document.getElementById("snakeA2HS").setAttribute("aria-hidden", "false"); }); await view.waitForTimeout(200); }] },
{ id: "snake-lang", guest: true, category: "Dodatkowe", title: "Ukryta gra w węża — przełącznik języka (menu otwarte)", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", devices: ["desktop", "phone-landscape"],
    sources: [...page("snake")], ready: "#snakeFrame[data-mode=intro]",
    steps: [async (view) => { await view.locator(".lang-floating .lang-btn").click(); await view.locator(".lang-menu:not([hidden])").waitFor(); await view.waitForTimeout(200); }] },
{ id: "not-found", category: "Dodatkowe", title: "Strona nie istnieje (404)", path: "/404.html", sources: ["web/404.html", "web/404/", "web/maintenance/css/"], ready: ".notfound-card" },
{ id: "maintenance", category: "Dodatkowe", title: "Przerwa techniczna — komunikat", path: "/maintenance/", sources: page("maintenance"), ready: ".block-card", settle: 600,
    db: (db) => { db.http = { ...(db.http || {}), "/maintenance-state.json*": { enabled: true, mode: "message" } }; } },
  { id: "privacy", category: "Dodatkowe", title: "Polityka prywatności — początek", path: "/privacy/", sources: [...page("privacy"), "web/manual/css/manual.css"], ready: ".m-doc .m-h2" },
  { id: "privacy-scrolled", category: "Dodatkowe", title: "Polityka prywatności — po przewinięciu (cała strona się przewija)", path: "/privacy/", sources: [...page("privacy"), "web/manual/css/manual.css"], ready: ".m-doc .m-h2", steps: [async (view) => { await view.locator(".m-doc .m-h2").nth(5).scrollIntoViewIfNeeded(); await view.waitForTimeout(300); }] },
  { id: "manual-start", category: "Dodatkowe", title: "Podręcznik — spis treści", path: "/manual/", sources: [...page("manual"), "web/manual/content/"], ready: ".m-parts" },
  { id: "manual-chapter", category: "Dodatkowe", title: "Podręcznik — rozdział z przyciskami i tabelą", path: "/manual/?ch=6", sources: [...page("manual"), "web/manual/content/"], ready: ".m-doc .m-h2" },
  { id: "manual-return", category: "Dodatkowe", title: "Podręcznik — powrót po odnośniku, ramki", path: "/manual/?ch=16&from=6.4#s-16-4", sources: [...page("manual"), "web/manual/content/"], ready: () => [...document.querySelectorAll("[data-return]")].some((el) => el.getClientRects().length && !el.hidden) },
  { id: "manual-licenses", category: "Dodatkowe", title: "Podręcznik — 21.3 Wykorzystanie komercyjne (muzyka, czcionki)", path: "/manual/?ch=21#s-21-3", devices: ["desktop", "phone"], sources: [...page("manual"), "web/manual/content/"], ready: ".m-doc .m-h2", steps: [async (view) => { await view.locator("#s-21-3").scrollIntoViewIfNeeded(); await view.waitForTimeout(400); }] },
  { id: "manual-toc-phone", category: "Dodatkowe", title: "Podręcznik — spis treści na telefonie", path: "/manual/?ch=17#s-17-3", devices: ["phone"], sources: [...page("manual"), "web/manual/content/"], ready: ".m-doc .m-h2", steps: [async (view) => { if (await view.locator("#manualTocToggle").isVisible()) await view.locator("#manualTocToggle").click(); await view.evaluate(() => window.scrollTo(0, 0)); await view.waitForTimeout(300); }] },
  { id: "manual-device-wake", category: "Dodatkowe", title: "Podręcznik — telefon i tablet nie mogą zgasnąć (ramka Uwaga)", path: "/manual/?ch=17", devices: ["desktop", "phone"], sources: [...page("manual"), "web/manual/content/", "web/manual/img/"], ready: ".m-doc .m-warn", steps: [async (view) => { const box = view.locator(".m-doc .m-warn:has(ul)").first(); for (let i = 0; i < 3; i++) { await box.evaluate((el) => el.scrollIntoView({ block: "end" })); await view.waitForTimeout(600); } }] },
  { id: "manual-shots", category: "Dodatkowe", title: "Podręcznik — karuzela widoków przy prowadzeniu rundy", path: "/manual/?ch=17#s-17-3", sources: [...page("manual"), "web/manual/content/", "web/manual/img/"], ready: ".m-carousel-nav", steps: [async (view) => { await view.locator(".m-carousel img").first().scrollIntoViewIfNeeded(); await view.locator(".m-carousel img").first().evaluate((img) => img.decode()); await view.waitForTimeout(300); }] },
  { id: "manual-shot-zoom", category: "Dodatkowe", title: "Wskazówki — podgląd zrzutu (jak na stronie głównej; telefon: okno od dołu z przybliżaniem)", path: "/manual/?ch=6#s-6-1", sources: [...page("manual"), "web/manual/content/", "web/manual/img/", "web/shared/js/core/image-viewer.js", "web/shared/css/image-viewer.css"], ready: ".m-shot-zoom img", steps: [async (view) => { await view.locator(".m-shot-zoom").first().click(); await view.locator("#imgvOverlay.is-open .imgv-img").evaluate((img) => img.decode()); await view.waitForTimeout(400); }] },
  { id: "manual-problems-devices", category: "Dodatkowe", title: "Wskazówki — 19.5 problemy z urządzeniami (komunikaty blokady okna)", path: "/manual/?ch=19#s-19-5", sources: [...page("manual"), "web/manual/content/"], ready: "#s-19-5" },
  { id: "manual-short", category: "Dodatkowe", title: "Wskazówki — krótki rozdział (stopka na dole okna)", path: "/manual/?ch=1", devices: ["desktop", "tablet", "phone"], sources: [...page("manual"), "web/manual/content/"], ready: ".m-doc" },
  { id: "manual-support", category: "Dodatkowe", title: "Wskazówki — O projekcie i wsparcie (rozdz. 21)", path: "/manual/?ch=21", sources: [...page("manual"), "web/manual/content/"], ready: ".m-doc .m-h2" },
  { id: "manual-guard-narrow", devices: ["tablet"], category: "Dodatkowe", title: "Wskazówki — nakładka „Za wąskie okno” (wspólny styl blokady)", path: "/manual/?ch=6", sources: [...page("manual"), "web/shared/css/blocking-overlay.css"], ready: ".m-doc .m-h2", steps: [async (view) => { await view.evaluate(async () => { const m = await import("/shared/js/core/device-guard.js"); m.showDeviceGuard("narrow", "/"); }); await view.waitForTimeout(400); }] },
  { id: "manual-search", category: "Dodatkowe", title: "Podręcznik — wyszukiwanie (wyniki na żywo)", path: "/manual/", sources: [...page("manual"), "web/manual/content/"], ready: ".m-part-card", steps: [manualSearch("kradzież")] },
  { id: "manual-search-empty", category: "Dodatkowe", title: "Podręcznik — wyszukiwanie bez wyników (wspólny pusty stan)", path: "/manual/", sources: [...page("manual"), "web/manual/content/"], ready: ".m-part-card", devices: ["desktop", "phone"], steps: [manualSearch("qqzzxx", ".empty-state")] },
  { id: "manual-search-hit", category: "Dodatkowe", title: "Podręcznik — wybrany wynik z zaznaczonymi trafieniami", path: "/manual/", sources: [...page("manual"), "web/manual/content/"], ready: ".m-part-card", steps: [manualSearch("kradzież"), async (view) => { await view.locator("#manualSearch .searchText").press("Enter"); await view.locator("mark.m-hit").first().waitFor({ timeout: 5000 }); await view.waitForTimeout(300); }] },
  { id: "account", category: "Dodatkowe", title: "Konto", path: "/account/", sources: page("account"), ready: "main" },
  // E29: powiadomienia na tym urządzeniu włączone (atrapa zgody przeglądarki i subskrypcji usługi push).
  { id: "account-push", category: "Dodatkowe", title: "Konto — powiadomienia na tym urządzeniu (włączone, wybrane rodzaje)", path: "/account/", sources: [...page("account"), "web/shared/js/core/push.js"], fullPage: true,
    initScript: () => {
      const sub = { endpoint: "https://fcm.googleapis.com/fcm/send/demo", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/demo", keys: { p256dh: "x", auth: "y" } }), unsubscribe: async () => true };
      const reg = { pushManager: { getSubscription: async () => sub, subscribe: async () => sub } };
      window.PushManager = window.PushManager || function PushManager() {};
      Object.defineProperty(window, "Notification", { configurable: true, value: Object.assign(function Notification() {}, { permission: "granted", requestPermission: async () => "granted" }) });
      Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => reg, ready: Promise.resolve(reg), addEventListener() {}, controller: null } });
    },
    db: (db) => { db.rpc.push_subscription_get = { subscribed: true, kinds: ["friend", "poll", "copy"] }; },
    ready: () => !document.getElementById("pushKinds")?.hidden },
  // Karty formularzy: zmiana e-maila w toku (Anuluj zmianę + Wyślij ponownie), hasło, usuwanie konta — cała strona.
  { id: "account-email-pending", category: "Dodatkowe", title: "Konto — zmiana e-maila w toku, hasło i usuwanie konta (cała strona)", path: "/account/", sources: page("account"), fullPage: true,
    db: (db) => { db.user = { ...db.user, new_email: "nowy.adres@example.com" }; },
    ready: () => !document.getElementById("emailPendingActions")?.hidden },
{ id: "account-guest", category: "Dodatkowe", title: "Konto gościa — zapis danych (migracja) i usuwanie konta", path: "/account/", sources: page("account"), fullPage: true,
    db: (db) => { db.user = { ...db.user, is_anonymous: true, email: null, user_metadata: { ...db.user.user_metadata, is_guest: true } }; db.rpc.guest_is_expired = false; db.rpc.guest_touch = null; },
    ready: "main", steps: [async (view) => { await view.getByRole("button", { name: /Rozumiem|Got it|Зрозуміло/ }).click({ timeout: 5000 }).catch(() => {}); await view.waitForFunction(() => !document.getElementById("migrateSection")?.hidden, null, { timeout: 5000 }).catch(() => {}); await view.waitForTimeout(400); }] },
{ id: "games-name-create", category: "Dodatkowe", title: "Moje gry — okno nazwy nowej gry (wspólne promptModal)", path: "/games/", sources: [...page("games"), "web/shared/js/core/modal.js"], ready: "#grid .card", steps: [openModal("#grid .addCard", ".uni-modal")] },
{ id: "bases-name-create", category: "Dodatkowe", title: "Bazy — okno nazwy nowej bazy (wspólne promptModal)", path: "/bases/", sources: [...page("bases"), "web/shared/js/core/modal.js"], ready: "#mineGrid > *:nth-child(2)", steps: [openModal("#mineGrid .addCard", ".uni-modal")] },
{ id: "logos-name-create", devices: ["desktop"], category: "Dodatkowe", title: "Logo — okno nazwy nowego logo (wspólne promptModal)", path: "/logos/", sources: [...page("logos"), "web/shared/js/core/modal.js"], ready: ".logoTile", steps: [openModal("#grid .addCard", ".uni-modal")] },
{ id: "games-export-progress", category: "Dodatkowe", title: "Moje gry — okno postępu eksportu (wspólne progressModal)", path: "/games/", sources: [...page("games"), "web/shared/js/core/modal.js"], ready: "#grid .card", steps: [selectTile("#grid .card[data-game-id]"), openModal("#btnExport", ".uni-modal")] },
{ id: "rating-prompt", category: "Dodatkowe", title: "Prośba o ocenę — trzy przyciski (wspólne choiceModal)", path: "/games/", sources: ["web/shared/js/core/rating-system.js", "web/shared/js/core/modal.js"], ready: "#grid .card", steps: [async (view) => {
    await view.evaluate(async () => {
      const m = await import("/shared/js/core/rating-system.js");
      // okno pokazuje się po 7 dniach od rejestracji i bez wcześniejszej odmowy
      try { for (const k of Object.keys(localStorage)) if (k.startsWith("fam:app_rat")) localStorage.removeItem(k); } catch {}
      void m.initRatingSystem({ id: "screens-user", created_at: "2026-01-01T00:00:00Z" });
    });
    await view.locator("#ratingOverlay").waitFor({ state: "visible", timeout: 5000 });
    await view.locator('#ratingOverlay .star-btn[data-value="4"]').click();
    await view.waitForTimeout(300);
  }] },
{ id: "account-rating-modal", category: "Dodatkowe", title: "Konto — okno oceny", path: "/account/", sources: [...page("account"), "web/shared/js/core/rating-system.js"], ready: "#ratingEditBtn", steps: [openModal("#ratingEditBtn", "#ratingEditOverlay")] },
{ id: "account-rating-saved", category: "Dodatkowe", title: "Konto — zapisana ocena", path: "/account/", sources: [...page("account"), "web/shared/js/core/rating-system.js"], ready: "#ratingEditBtn", steps: [async (view) => {
    await openModal("#ratingEditBtn", "#ratingEditOverlay")(view);
    await view.locator('#ratingEditOverlay .star-btn[data-value="4"]').click();
    await view.locator("#ratingEditOverlay .rating-comment").fill("Świetna zabawa na rodzinnych spotkaniach, <b>bez</b> HTML.");
    await view.locator("#ratingEditOverlay .uni-foot .btn.gold").click();
    await view.locator("#ratingEditOverlay").waitFor({ state: "detached", timeout: 5000 });
    await view.locator("#userRatingInfo .rating-info").waitFor({ timeout: 5000 });
    await view.waitForTimeout(300);
  }] },
{ id: "home", guest: true, category: "Dodatkowe", title: "Strona główna", path: "/", sources: ["web/index.html", ...page("home"), "web/assets/img/"], ready: ".tile-shot img.is-loaded", fullPage: true },
{ id: "home-gallery", guest: true, category: "Dodatkowe", title: "Strona główna — karuzela kadrów w kaflu", path: "/", sources: ["web/index.html", ...page("home"), "web/assets/img/"], ready: ".tile-shot img.is-loaded",
    steps: [async (view) => { const shot = view.locator(".tile-shot").nth(1); await shot.scrollIntoViewIfNeeded(); await view.evaluate(() => window.scrollBy(0, -120)); await shot.locator(".shot-carousel-next").click(); await shot.locator(".shot-carousel-next").click(); await view.waitForFunction(() => document.querySelectorAll(".tile-shot")[1].querySelector("img.is-loaded")); await view.waitForTimeout(400); }] },
{ id: "home-viewer-iphone", guest: true, category: "Dodatkowe", title: "Strona główna — podgląd kadru na iPhonie (wcięcie, otwarty z dołu strony)", path: "/", devices: ["phone"], safeArea: { top: 47, bottom: 34 },
    sources: ["web/index.html", ...page("home"), "web/shared/css/", "web/shared/js/core/modal-sheet.js"], ready: ".tile-shot img.is-loaded",
    steps: [async (view) => { const shot = view.locator(".tile-shot").nth(3); await shot.scrollIntoViewIfNeeded(); await shot.locator(".shot-img").click(); await view.locator(".imgv-overlay.is-open .imgv-img").waitFor(); await view.waitForTimeout(600); }] },
{ id: "snake", category: "Dodatkowe", title: "Ukryta gra w węża — start (telefon w pionie: prośba o obrót)", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", sources: [...page("snake"), "web/shared/js/core/snake-log.js", "web/shared/js/display/"], ready: () => document.querySelector("#snakeFrame[data-mode]") || document.querySelector("#pageGuard") },
{ id: "snake-account", category: "Dodatkowe", title: "Ukryta gra w węża — zalogowany: nazwa konta zamiast przycisku konta", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", devices: ["desktop", "phone-landscape"], sources: [...page("snake")], ready: () => document.querySelector("#snakeFrame[data-mode=intro]") && !document.getElementById("snakeAccount")?.hidden },
{ id: "snake-play", guest: true, category: "Dodatkowe", title: "Ukryta gra w węża — rozgrywka (bez konta)", path: "/snake/?qr=00000000-0000-4000-8000-000000000103", devices: ["desktop", "phone-landscape"], sources: [...page("snake"), "web/shared/js/core/snake-log.js"], ready: "#snakeFrame[data-mode=intro]",
    steps: [async (view) => { await view.locator("body").press("ArrowUp"); await view.waitForTimeout(450); await view.locator("body").press("ArrowRight"); await view.waitForTimeout(1500); }] },
{ id: "home-viewer", guest: true, category: "Dodatkowe", title: "Strona główna — podgląd kadru z przybliżaniem", path: "/", sources: ["web/index.html", ...page("home"), "web/assets/img/"], ready: ".tile-shot img.is-loaded",
    steps: [async (view) => { const shot = view.locator(".tile-shot").nth(3); await shot.scrollIntoViewIfNeeded(); await shot.locator(".shot-carousel-next").click(); await shot.locator(".shot-img").click(); await view.locator(".imgv-overlay.is-open .imgv-img").waitFor(); await view.waitForTimeout(600); }] },
{ id: "support-footer", category: "Dodatkowe", title: "Stopka — Postaw kawę obok Kontaktu", path: "/games/", sources: ["web/shared/js/core/support-modal.js", "web/shared/js/core/contact-dialog.js"], ready: ".btn-support-footer",
    steps: [async (view) => { await view.locator(".footer").scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
{ id: "support-footer-home", guest: true, category: "Dodatkowe", title: "Strona główna — stopka z Postaw kawę", path: "/", sources: ["web/shared/js/core/support-modal.js", "web/shared/js/core/contact-dialog.js"], ready: ".btn-support-footer",
    steps: [async (view) => { await view.locator(".footer").scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
{ id: "home-faq-support", guest: true, category: "Dodatkowe", title: "Strona główna — FAQ: Wsparcie projektu", path: "/", sources: ["web/index.html", ...page("home"), "web/shared/js/core/support-modal.js"], ready: ".btn-support-footer",
    steps: [async (view) => { const q = view.locator('[data-i18n="home.faq.q31.q"]'); await q.scrollIntoViewIfNeeded(); await q.click(); await view.locator('[data-i18n="home.faq.cat6"]').scrollIntoViewIfNeeded(); await view.waitForTimeout(300); }] },
{ id: "support-modal", category: "Dodatkowe", title: "Okno Postaw kawę", path: "/games/", sources: ["web/shared/js/core/support-modal.js", "web/shared/js/core/contact-dialog.js"], ready: ".btn-support-footer",
    steps: [async (view) => { await view.locator(".btn-support-footer").click(); await view.locator(".support-modal").waitFor({ state: "visible" }); await view.waitForTimeout(300); }] }
];

// Seria zrzutów: każda strona, okno i stan — pliki obszarów (scenes/*.cjs).
const fs = require("node:fs");
const path = require("node:path");
const areaDir = path.join(__dirname, "scenes");
if (fs.existsSync(areaDir)) {
  for (const file of fs.readdirSync(areaDir).filter((f) => f.endsWith(".cjs")).sort()) {
    // Błąd w jednym pliku obszaru nie może wyłączyć pozostałych scen.
    try { module.exports.push(...require(path.join(areaDir, file))); }
    catch (e) { console.error(`[scenes] pominięty ${file}: ${e.message}`); }
  }
}


module.exports.push({ id: "settings-drawer", category: "Dodatkowe", title: "Ustawienia gry — wysuwane sekcje",
  path: `/games/settings/?id=${IDS.game}`, sources: [...page("games/settings"), "web/shared/js/core/drawer.js"],
  ready: "#gsContentInner", devices: ["phone"], steps: [async view => {
    if (await view.locator("#gsSidebarToggle").isVisible()) await view.locator("#gsSidebarToggle").click(); await view.waitForTimeout(300);
  }] });

// Wskazówki: strony list wyglądają na telefonie wyraźnie inaczej (jedna kolumna,
// ikony dolnego paska, okna od dołu) — obok zrzutu z komputera osobny zrzut z
// telefonu (uwaga właściciela 2026-11-05). Bliźniaki scen kadrów strony głównej,
// tylko na telefon i bez flagi homepage (kadry strony głównej bez zmian).
for (const id of ["games", "bases", "friends", "subscribers", "poll-share", "marketplace", "logos"]) {
  const base = module.exports.find((s) => s.id === id);
  module.exports.push({ ...base, id: `${id}-phone`, homepage: false, devices: ["phone"], category: "Dodatkowe", title: `${base.title} — telefon` });
}
