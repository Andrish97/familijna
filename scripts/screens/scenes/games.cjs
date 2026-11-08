// Seria zrzutów obszaru „games”: /games/ (zakładki, stany kafli, okna) i /games/editor/
// (typy gier, warunki gotowości, okno importu TXT, blokada edycji i reset po ankiecie).
// Prawdziwy kod stron, dane tylko w atrapie Supabase (db: (db, lang) => …).
const { id, IDS, panel } = require("../data/demo.cjs");

const CAT = "games";
const page = (dir) => [`web/${dir}/index.html`, `web/${dir}/js/`, `web/${dir}/css/`];
const GAMES = page("games");
const EDITOR = [...page("games/editor"), "web/shared/js/core/question-form.js", "web/shared/js/core/game-rules.js", "web/shared/css/question-form.css"];

// Gry demo (data/demo.cjs, MORE_GAMES): id("8000", 110 + indeks).
const G = {
  family: id("8000", 110), office: id("8000", 112), wedding: id("8000", 113), school: id("8000", 114),
  birthday: id("8000", 115), quiz: id("8000", 116), christmas: id("8000", 117), camp: id("8000", 118),
  teachers: id("8000", 119), seniors: id("8000", 121), kids: id("8000", 122), football: id("8000", 123),
};

const tile = (gameId) => `#grid .card[data-game-id="${gameId}"]`;
const wait = (ms) => async (view) => { await view.waitForTimeout(ms); };
// Po kliknięciu kursor odjeżdża z przycisku, żeby podpowiedź (title) nie zasłaniała menu.
const click = (selector, ms = 400) => async (view) => { await view.locator(selector).first().click(); await view.mouse.move(2, 140); await view.waitForTimeout(ms); };
const select = (gameId) => async (view) => {
  await view.locator(tile(gameId)).click();
  await view.waitForTimeout(400);
};
// Okno z prawdziwego przycisku; czeka na widoczne okno.
const open = (button, modal = ".overlay:visible") => async (view) => {
  await view.locator(button).first().click();
  await view.locator(modal).first().waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(400);
};
const gameRow = (db, gameId) => db.tables.games.find((g) => g.id === gameId);

// Plik gry do okna importu: „Rodzinny pojedynek” z danych panelu (format 2).
function importPackage(lang) {
  const p = panel[lang];
  return {
    format_version: 2,
    game: { name: p.otherGames[0], type: "prepared", state: "draft" },
    questions: p.gameQuestions.map(([text, answers]) => ({ text, answers: answers.map(([a, pts]) => ({ text: a, fixed_points: pts })) })),
  };
}
const TXT = {
  pl: "@Wieczór quizowy\n#Co zabierasz na piknik?\n1 Koc /34\n2 Kanapki /24\n3 Owoce /16\n4 Napoje /12\n\n#Wymień popularne imię psa\nBurek /38\nAzor /22\nReksio /17\nMax /12\n\n#Co robisz w niedzielę rano?\n1. Śpię\n2. Jem śniadanie\n3. Spaceruję\n\n#Gdzie jedziesz na wakacje?\nNad morze\nW góry\nZa granicę\n",
  en: "@Quiz night\n#What do you take on a picnic?\n1 Blanket /34\n2 Sandwiches /24\n3 Fruit /16\n4 Drinks /12\n\n#Name a popular dog name\nRex /38\nMax /22\nBella /17\nBuddy /12\n\n#What do you do on Sunday morning?\n1. Sleep\n2. Eat breakfast\n3. Go for a walk\n\n#Where do you go on holiday?\nSeaside\nMountains\nAbroad\n",
  uk: "@Вечір вікторини\n#Що береш на пікнік?\n1 Ковдру /34\n2 Бутерброди /24\n3 Фрукти /16\n4 Напої /12\n\n#Назви популярну кличку собаки\nБарсик /38\nРекс /22\nДжек /17\nМакс /12\n\n#Що робиш у неділю вранці?\n1. Сплю\n2. Снідаю\n3. Гуляю\n\n#Куди їдеш у відпустку?\nНа море\nУ гори\nЗа кордон\n",
};
const TXT_BAD = { pl: "Koc /34\n#Co zabierasz na piknik?\n1 Kanapki /24\n", en: "Blanket /34\n#What do you take on a picnic?\n1 Sandwiches /24\n", uk: "Ковдру /34\n#Що береш на пікнік?\n1 Бутерброди /24\n" };
const SENDERS = { pl: ["aleksandra_nowak", "jan_kowalski"], en: ["aleksandra_nowak", "jan_kowalski"], uk: ["aleksandra_nowak", "jan_kowalski"] };
const RECEIVED = {
  pl: ["Quiz o Krakowie", "Sąsiedzki turniej"], en: ["London quiz", "Neighbourhood quiz night"], uk: ["Вікторина про Київ", "Сусідська Familijna"],
};

// Otrzymane kopie czekające na decyzję: wiersze gier odbiorcy (jak w bazie)
// + oferty resource_copy_inbox z game_id; liczniki wypustek z resource_copy_badges.
function receivedCopies(db, lang) {
  const base = db.tables.games.find((g) => g.type === "prepared");
  const textBase = db.tables.games.find((g) => g.type === "poll_text");
  const rows = [
    { ...base, id: id("8f40", 1), name: RECEIVED[lang][0], type: "prepared", status: "draft", received_from_label: SENDERS[lang][0], received_from_identity: { username: SENDERS[lang][0] }, created_at: "2026-10-21T08:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
    { ...base, id: id("8f40", 2), name: RECEIVED[lang][1], type: "prepared", status: "draft", received_from_label: SENDERS[lang][1], received_from_identity: { username: SENDERS[lang][1] }, created_at: "2026-10-20T08:00:00Z", updated_at: "2026-10-20T08:00:00Z" },
    { ...textBase, id: id("8f40", 3), name: { pl: "Ankieta: ulubione wakacje", en: "Poll: favourite holidays", uk: "Опитування: улюблена відпустка" }[lang], type: "poll_text", status: "draft", received_from_label: SENDERS[lang][0], received_from_identity: { username: SENDERS[lang][0] }, created_at: "2026-10-19T08:00:00Z", updated_at: "2026-10-19T08:00:00Z" },
  ];
  db.tables.games.push(...rows);
  db.rpc.resource_copy_inbox = { ok: true, items: rows.map((g, i) => ({ id: id("8f30", i + 1), name: g.name, sender_label: g.received_from_label, variant: g.type, resource_kind: "game", game_id: g.id, created_at: g.created_at })) };
  db.rpc.resource_copy_badges = { ok: true, items: [{ kind: "game", variant: "prepared", count: 2 }, { kind: "game", variant: "poll_text", count: 1 }, { kind: "logo", variant: "GLYPH_30x10", mode: "TEXT", count: 1 }] };
}

// Zaznaczony kafel przy górnej krawędzi przewijanej siatki (kursor nad nim:
// uniesienie przy najechaniu); na telefonie siatka przewinięta tak, żeby
// kafel stał dokładnie przy krawędzi. Obwódka ma być widoczna w całości.
const selectAtTopEdge = (selector) => async (view) => {
  const el = view.locator(selector).first();
  await el.click();
  await view.waitForTimeout(300);
  await el.evaluate((t) => {
    const grid = t.closest(".grid");
    const pad = parseFloat(getComputedStyle(grid).paddingTop) || 0;
    grid.scrollTop += t.getBoundingClientRect().top - grid.getBoundingClientRect().top - pad;
  });
  await view.waitForTimeout(300);
};

module.exports = [
  // ---------- /games/: zakładki i stany kafli ----------
  { id: "games-selected-top-edge", category: CAT, title: "Moje gry — zaznaczony kafel przy górnej krawędzi listy (cała obwódka widoczna)", path: "/games/", sources: GAMES, ready: "#grid .card",
    devices: ["desktop", "phone"], steps: [selectAtTopEdge("#grid .card:not(.addCard)")] },
  { id: "logos-selected-top-edge", category: CAT, title: "Logo — zaznaczony kafel przy górnej krawędzi listy (cała obwódka widoczna)", path: "/logos/", sources: [...page("logos"), "web/logos/js/list.js"], ready: ".logoTile",
    devices: ["desktop", "phone"], steps: [selectAtTopEdge(".logoTile")] },
  { id: "games-prepared-states", category: CAT, title: "Moje gry — Preparowane: gotowa, szkic z powodem blokady, kopia od znajomego", path: "/games/", sources: GAMES, ready: "#grid .card",
    steps: [select(G.football)] },
  { id: "games-prepared-not-ready", category: CAT, title: "Moje gry — zaznaczona gra niegotowa (za mało pytań): Graj i Ustawienia gry wyłączone, powód na kafelku", path: "/games/", sources: GAMES, ready: "#grid .card",
    steps: [select(G.birthday), async (view) => { await view.locator(tile(G.birthday)).scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
  { id: "games-prepared-received", category: CAT, title: "Moje gry — zaznaczona kopia od znajomego", path: "/games/", sources: GAMES, ready: "#grid .card",
    steps: [select(G.christmas), async (view) => { await view.locator(tile(G.christmas)).scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
  { id: "games-poll-text-open", category: CAT, title: "Moje gry — Ankieta tekstowa: zaznaczona otwarta ankieta (liczba głosów)", path: "/games/?tab=poll_text", sources: GAMES, ready: "#grid .card",
    steps: [select(G.office)] },
  { id: "games-poll-text-draft", category: CAT, title: "Moje gry — Ankieta tekstowa: szkic z powodem blokady (za mało pytań)", path: "/games/?tab=poll_text", sources: GAMES, ready: "#grid .card",
    steps: [select(G.seniors)] },
  { id: "games-poll-points-stopped", category: CAT, title: "Moje gry — Punktacja: zaznaczona ankieta zatrzymana („do podliczenia”)", path: "/games/?tab=poll_points", sources: GAMES, ready: "#grid .card",
    steps: [select(G.wedding)] },
  { id: "games-poll-points-ready", category: CAT, title: "Moje gry — Punktacja: zaznaczona gotowa gra po ankiecie", path: "/games/?tab=poll_points", sources: GAMES, ready: "#grid .card",
    steps: [select(G.kids)] },
  { id: "games-market", category: CAT, title: "Moje gry — Gry Społeczności (biblioteka, kopia archiwalna)", path: "/games/", sources: GAMES, ready: "#grid .card",
    db: (db, lang) => {
      const m = require("../data/content.cjs")[lang].market;
      db.rpc.market_my_library = [
        { market_game_id: id("8b00", 1), game_id: id("8000", 301), title: m[0][0], lang, archived: false },
        { market_game_id: id("8b00", 2), game_id: null, title: m[1][0], lang, archived: false },
        { market_game_id: id("8b00", 3), game_id: id("8000", 303), title: m[2][0], lang, archived: false },
        { market_game_id: null, game_id: id("8000", 304), title: m[3][0], lang, archived: true },
      ];
    },
    steps: [click("#tabMarket", 600), click("#grid .card[data-market-id]")] },
  { id: "games-market-empty", category: CAT, title: "Moje gry — Gry Społeczności: pusta biblioteka", path: "/games/", sources: GAMES, ready: "#grid .card",
    steps: [click("#tabMarket", 600)] },
  { id: "games-market-preview", category: CAT, title: "Moje gry — Gry Społeczności: podgląd gry z biblioteki", path: "/games/", sources: GAMES, ready: "#grid .card",
    db: (db, lang) => {
      const c = require("../data/content.cjs")[lang];
      db.rpc.market_my_library = [{ market_game_id: id("8b00", 1), game_id: id("8000", 301), title: c.market[0][0], lang, archived: false }];
      db.rpc.market_game_detail = [{ id: id("8b00", 1), payload: { questions: c.questions.slice(0, 10).map(([text, answers], i) => ({ ord: i + 1, text, answers: answers.map(([t, pts], ai) => ({ ord: ai + 1, text: t, fixed_points: pts })) })) } }];
    },
    steps: [click("#tabMarket", 600), click("#grid .card[data-market-id]"), open("#btnPreview", "#previewOverlay"), async (view) => { await view.locator("#previewQuestions .q-preview-item").first().waitFor(); await view.waitForTimeout(300); }] },
  { id: "games-empty", category: CAT, title: "Moje gry — pusta biblioteka (tylko kafel „Nowa gra”)", path: "/games/", sources: GAMES, ready: "#grid .addCard",
    db: (db) => { db.tables.games = []; db.tables.questions = []; db.tables.answers = []; db.rpc.polls_vote_counts = []; } },
  { id: "games-received-copies", category: CAT, title: "Moje gry — otrzymane kopie jako kafle propozycji zaraz po kaflu „Nowa gra” (✓/✕ w rogu, „Propozycja” + „Od”), liczniki w linii na wypustkach", path: "/games/", sources: [...GAMES, "web/shared/js/core/resource-copy-inbox.js", "web/shared/js/core/proposed-tile.js"], ready: "#grid .card[data-proposed]",
    db: receivedCopies },
  { id: "games-received-selected", category: CAT, title: "Moje gry — zaznaczona kopia do przyjęcia (tylko podgląd)", path: "/games/", sources: [...GAMES, "web/shared/js/core/proposed-tile.js"], ready: "#grid .card[data-proposed]",
    db: receivedCopies, steps: [click("#grid .card[data-proposed] .name")] },
  { id: "games-received-poll-tab", category: CAT, title: "Moje gry — Ankieta tekstowa: kopia do przyjęcia, licznik na aktywnej wypustce", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/proposed-tile.js"], ready: "#grid .card[data-proposed]",
    db: receivedCopies },

  // ---------- wyszukiwanie, filtr, sortowanie ----------
  { id: "games-search", category: CAT, title: "Moje gry — wyszukiwanie po nazwie", path: "/games/", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .card", devices: ["desktop"],
    steps: [async (view, { lang }) => {
      const q = { pl: "wi", en: "ni", uk: "ві" }[lang];
      const field = view.locator(".list-toolbar .searchText").first();
      // Wąski pasek (dłuższe napisy UK): pole szukania zwinięte do przycisku z oknem.
      if (await field.isVisible()) await field.fill(q);
      else { await view.locator(".list-search-open").click(); await view.locator(".uni-modal .uni-inp").fill(q); await view.locator(".uni-modal .uni-foot .btn.gold").click(); }
      await view.waitForTimeout(500);
    }] },
  { id: "games-filter-menu", category: CAT, title: "Moje gry — filtr stanu (menu otwarte)", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .card",
    steps: [click(".list-filter .ui-select-btn:visible", 400)] },
  { id: "games-filter-open", category: CAT, title: "Moje gry — filtr „Otwarta” na zakładce Punktacja", path: "/games/?tab=poll_points&status=open", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .card" },
  { id: "games-filter-received", category: CAT, title: "Moje gry — filtr „Otrzymane” (kopie od znajomych)", path: "/games/?status=received", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .card:not([hidden]):not(.addCard)" },
  { id: "games-filter-empty", category: CAT, title: "Moje gry — filtr bez wyników (pusty stan)", path: "/games/?status=stopped", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .list-empty" },
  { id: "games-sort-menu", category: CAT, title: "Moje gry — sortowanie według nazwy (menu otwarte)", path: "/games/?sort=name", sources: [...GAMES, "web/shared/js/core/list-search.js"], ready: "#grid .card",
    steps: [click(".list-sort .ui-select-btn:visible", 400)] },

  // ---------- okna /games/ ----------
  { id: "games-new-poll-text", category: CAT, title: "Moje gry — okno tworzenia ankiety tekstowej", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/modal.js"], ready: "#grid .card",
    steps: [open("#grid .addCard", ".uni-modal"), async (view, { lang }) => { await view.locator(".uni-modal .uni-inp").fill({ pl: "Rodzinny zjazd", en: "Family reunion", uk: "Родинна зустріч" }[lang]); await view.waitForTimeout(200); }] },
  { id: "games-new-empty-name", category: CAT, title: "Moje gry — okno tworzenia: błąd pustej nazwy", path: "/games/", sources: [...GAMES, "web/shared/js/core/modal.js"], ready: "#grid .card",
    steps: [open("#grid .addCard", ".uni-modal"), async (view) => { await view.locator(".uni-modal .uni-inp").fill("   "); await view.locator(".uni-modal .uni-foot .btn.gold").click(); await view.waitForTimeout(400); }] },
  { id: "games-rename", category: CAT, title: "Moje gry — okno zmiany nazwy (podwójne kliknięcie kafla)", path: "/games/", sources: [...GAMES, "web/shared/js/core/modal.js", "web/shared/js/core/rename-gesture.js"], ready: "#grid .card",
    steps: [async (view) => { await view.locator(tile(IDS.game)).dblclick(); await view.locator(".uni-modal").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(400); }] },
  { id: "games-delete", category: CAT, title: "Moje gry — okno usuwania gry", path: "/games/", sources: [...GAMES, "web/shared/js/core/modal.js"], ready: "#grid .card",
    steps: [async (view) => { await view.locator(`${tile(id("8000", 101))} .x`).click(); await view.locator(".uni-modal").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(400); }] },
  { id: "games-delete-open-poll", category: CAT, title: "Moje gry — usuwanie otwartej ankiety (ankieta zostanie przerwana)", path: "/games/?tab=poll_points", sources: [...GAMES, "web/shared/js/core/modal.js"], ready: "#grid .card",
    steps: [async (view) => { await view.locator(`${tile(IDS.poll)} .x`).click(); await view.locator(".uni-modal").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(400); }] },
  { id: "games-change-type-closed-text", category: CAT, title: "Moje gry — Zmień typ zamkniętej ankiety tekstowej: Preparowana, domyślnie bez wyników ankiety", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/game-validate.js", "web/games/js/change-type.js"], ready: "#grid .card",
    db: (db) => { gameRow(db, G.school).rules_state.change_type = { ok: true, needs_reset: true }; },
    steps: [select(G.school), open("#btnChangeType", ".change-type"), async (view) => { await view.locator('.change-type-option:has(input[value="prepared"]) input[type="radio"]').check(); await view.waitForTimeout(300); }] },
  { id: "games-change-type-closed-points", category: CAT, title: "Moje gry — Zmień typ zamkniętej punktacji: Preparowana z zaznaczonym „Zachowaj punkty”", path: "/games/?tab=poll_points", sources: [...GAMES, "web/shared/js/core/game-validate.js", "web/games/js/change-type.js"], ready: "#grid .card",
    db: (db) => { gameRow(db, G.kids).rules_state.change_type = { ok: true, needs_reset: true }; },
    steps: [select(G.kids), open("#btnChangeType", ".change-type"), async (view) => { const o = view.locator('.change-type-option:has(input[value="prepared"])'); await o.locator('input[type="radio"]').check(); await o.locator(".change-type-keep input").check(); await view.waitForTimeout(300); }] },
  { id: "games-edit-after-poll", category: CAT, title: "Moje gry — Edytuj grę po ankiecie: potwierdzenie resetu wyników", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/game-validate.js"], ready: "#grid .card",
    db: (db) => { gameRow(db, G.school).rules_state.edit = { ok: true, needs_reset: true }; },
    steps: [select(G.school), open("#btnEdit", ".uni-modal")] },
  { id: "games-duplicate-votes", category: CAT, title: "Moje gry — Powiel otwartą ankietę: ostrzeżenie „Bez bieżących głosów”", path: "/games/?tab=poll_text", sources: [...GAMES, "web/shared/js/core/resource-duplicate.js", "web/shared/js/core/game-transfer-format.js"], ready: "#grid .card",
    steps: [select(G.office), open("#btnDuplicate", ".uni-modal")] },
  { id: "games-duplicate-done", category: CAT, title: "Moje gry — Powiel: nowa kopia zaznaczona na liście", path: "/games/", sources: [...GAMES, "web/shared/js/core/resource-duplicate.js"], ready: "#grid .card",
    db: (db, lang) => {
      const src = gameRow(db, id("8000", 101));
      const copyId = id("8000", 401);
      db.tables.games.push({ ...src, id: copyId, name: `${src.name} ${{ pl: "kopia", en: "copy", uk: "копія" }[lang]}`, created_at: "2026-10-21T09:00:00.000Z", updated_at: "2026-10-21T09:00:00.000Z" });
      db.http["/_api/resource-duplicate"] = { ok: true, id: copyId };
    },
    steps: [select(id("8000", 101)), async (view) => { await view.locator("#btnDuplicate").click(); await view.locator(`${tile(id("8000", 401))}.selected`).waitFor({ timeout: 5000 }); await view.waitForTimeout(400); }] },
  { id: "games-send-history", category: CAT, title: "Moje gry — Wyślij kopię znajomemu: zaznaczony znajomy i historia wysyłek", path: "/games/", sources: [...GAMES, "web/shared/js/core/resource-send.js"], ready: "#grid .card",
    db: (db) => {
      db.rpc.resource_copy_history = { ok: true, items: [
        { recipient_label: "aleksandra_nowak", sent_at: "2026-10-18T17:42:00.000Z" },
        { recipient_label: "jan_kowalski", sent_at: "2026-10-12T09:15:00.000Z" },
      ] };
    },
    steps: [select(IDS.game), open("#btnSendCopy", "#resourceSendOverlay"), async (view) => {
      await view.locator("#resourceSendOverlay .resource-send-friend input").first().check();
      await view.locator("#resourceSendOverlay .resource-send-history summary").click();
      await view.waitForTimeout(400);
    }] },
  { id: "games-send-no-friends", category: CAT, title: "Moje gry — Wyślij kopię: brak znajomych", path: "/games/", sources: [...GAMES, "web/shared/js/core/resource-send.js"], ready: "#grid .card",
    db: (db) => { db.rpc.friends_list = []; },
    steps: [select(IDS.game), open("#btnSendCopy", "#resourceSendOverlay")] },
  { id: "games-import", category: CAT, title: "Moje gry — okno importu (bez pliku)", path: "/games/", sources: [...GAMES, "web/shared/js/core/file-picker.js"], ready: "#grid .card",
    steps: [open("#btnImport", "#importOverlay")] },
  { id: "games-import-preview", category: CAT, title: "Moje gry — okno importu z podglądem pliku", path: "/games/", sources: [...GAMES, "web/shared/js/core/game-transfer-format.js"], ready: "#grid .card",
    steps: [open("#btnImport", "#importOverlay"), async (view, { lang }) => {
      await view.locator("#importFile").setInputFiles({ name: "rodzinny-pojedynek.famgame", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(importPackage(lang))) });
      await view.locator("#importPreview").waitFor({ state: "visible", timeout: 5000 });
      await view.waitForTimeout(300);
    }] },
  { id: "games-import-error", category: CAT, title: "Moje gry — okno importu: plik nie jest grą (błąd)", path: "/games/", sources: [...GAMES, "web/shared/js/core/game-transfer-format.js"], ready: "#grid .card",
    steps: [open("#btnImport", "#importOverlay"), async (view) => {
      await view.locator("#importFile").setInputFiles({ name: "notatki.json", mimeType: "application/json", buffer: Buffer.from("{ \"hello\": 1 ") });
      await view.locator("#importErr").waitFor({ state: "visible", timeout: 5000 });
      await view.waitForTimeout(300);
    }] },
  { id: "games-export-base", category: CAT, title: "Moje gry — okno Eksportuj do bazy (wybór bazy)", path: "/games/", sources: GAMES, ready: "#grid .card",
    db: (db) => { const b = db.tables.question_bases.at(-1); db.tables.question_base_shares.push({ base_id: b.id, user_id: db.user.id, role: "editor", created_at: b.created_at }); b.owner_id = id("8410", 1); },
    steps: [select(IDS.game), open("#btnExportBase", "#exportBaseOverlay"), wait(300)] },
  { id: "games-export-base-many", category: CAT, title: "Moje gry — Eksportuj do bazy: dużo baz (przewija się tylko lista), długa nazwa (dopisek pod nazwą)", path: "/games/", sources: GAMES, ready: "#grid .card",
    db: (db) => {
      const base = db.tables.question_bases[0];
      for (let i = 0; i < 14; i++) db.tables.question_bases.push({ ...base, id: id("8420", i + 1), name: i === 1 ? "Pytania z rodzinnych spotkań świątecznych, urodzinowych i imieninowych u dziadków" : `${base.name} ${i + 2}`, updated_at: base.updated_at });
    },
    steps: [select(IDS.game), open("#btnExportBase", "#exportBaseOverlay"), wait(300)] },
  { id: "games-export-base-empty", category: CAT, title: "Moje gry — Eksportuj do bazy: brak baz", path: "/games/", sources: GAMES, ready: "#grid .card",
    db: (db) => { db.tables.question_bases = []; },
    steps: [select(IDS.game), open("#btnExportBase", "#exportBaseOverlay"), wait(300)] },
  { id: "games-export-votes", category: CAT, title: "Moje gry — Eksportuj otwartą ankietę: ostrzeżenie „Bez bieżących głosów”", path: "/games/?tab=poll_points", sources: [...GAMES, "web/shared/js/core/game-transfer-format.js"], ready: "#grid .card",
    steps: [select(IDS.poll), open("#btnExportBase", ".uni-modal")] },
  { id: "games-preview", category: CAT, title: "Moje gry — podgląd gry preparowanej", path: "/games/", sources: GAMES, ready: "#grid .card",
    steps: [select(IDS.game), open("#btnPreview", "#previewOverlay"), async (view) => { await view.locator("#previewQuestions .q-preview-item").first().waitFor(); await view.waitForTimeout(300); }] },
  { id: "games-preview-poll", category: CAT, title: "Moje gry — podgląd ankiety: przełącznik Gra · Ankieta, wyniki głosowania", path: "/games/?tab=poll_points", sources: [...GAMES, "web/shared/js/core/poll-results.js"], ready: "#grid .card",
    steps: [select(IDS.poll), open("#btnPreview", "#previewOverlay"), click("#btnPreviewModePoll", 800)] },
  { id: "games-preview-poll-text", category: CAT, title: "Moje gry — podgląd ankiety tekstowej (same pytania)", path: "/games/?tab=poll_text", sources: GAMES, ready: "#grid .card",
    steps: [select(IDS.textPoll), open("#btnPreview", "#previewOverlay"), wait(500)] },

  // ---------- /games/editor/: typy gier i warunki gotowości ----------
  { id: "games-editor-list-phone", devices: ["phone"], category: CAT, title: "Edycja gry na telefonie — lista pytań i warunki gotowości", path: `/games/editor/?id=${IDS.game}`, sources: EDITOR, ready: "#qList > *:nth-child(2)" },
  { id: "games-editor-prepared-missing", category: CAT, title: "Edycja gry preparowanej — warunki gotowości z brakami (6 z 10 pytań)", path: `/games/editor/?id=${G.birthday}`, sources: EDITOR, ready: "#qList > *:nth-child(2)" },
  { id: "games-editor-prepared-sum", category: CAT, title: "Edycja gry preparowanej — suma punktów ponad 100 w pytaniu", path: `/games/editor/?id=${G.football}`, sources: EDITOR, ready: "#qList > *:nth-child(2)",
    db: (db) => {
      const q = db.tables.questions.filter((x) => x.game_id === G.football).sort((a, b) => a.ord - b.ord)[3];
      db.tables.answers.filter((a) => a.question_id === q.id).forEach((a, i) => { if (i === 0) a.fixed_points += 15; });
    },
    steps: [click("#qList .qcard[data-id] >> nth=3", 600)] },
  { id: "games-editor-poll-text", category: CAT, title: "Edycja ankiety tekstowej — same pytania, braki (4 z 10)", path: `/games/editor/?id=${G.seniors}`, sources: EDITOR, ready: "#qList > *:nth-child(2)" },
  { id: "games-editor-poll-points", category: CAT, title: "Edycja ankiety punktowej — odpowiedzi bez punktów", path: `/games/editor/?id=${G.quiz}`, sources: EDITOR, ready: "#qList > *:nth-child(2)",
    db: (db) => { const qs = new Set(db.tables.questions.filter((q) => q.game_id === G.quiz).map((q) => q.id)); db.tables.answers.forEach((a) => { if (qs.has(a.question_id)) a.fixed_points = 0; }); } },
  { id: "games-editor-poll-points-sheet", devices: ["phone"], category: CAT, title: "Edycja ankiety punktowej na telefonie — pytanie w oknie od dołu", path: `/games/editor/?id=${G.quiz}`, sources: [...EDITOR, "web/shared/js/core/modal-sheet.js"], ready: "#qList > *:nth-child(2)",
    db: (db) => { const qs = new Set(db.tables.questions.filter((q) => q.game_id === G.quiz).map((q) => q.id)); db.tables.answers.forEach((a) => { if (qs.has(a.question_id)) a.fixed_points = 0; }); },
    steps: [async (view) => { await view.locator("#qList .qcard[data-id]").first().click(); await view.locator("#questionSheetOverlay.sheet-active").waitFor({ timeout: 5000 }); await view.waitForTimeout(500); }] },
  { id: "games-editor-poll-text-sheet", devices: ["phone"], category: CAT, title: "Edycja ankiety tekstowej na telefonie — pytanie w oknie od dołu", path: `/games/editor/?id=${G.seniors}`, sources: [...EDITOR, "web/shared/js/core/modal-sheet.js"], ready: "#qList > *:nth-child(2)",
    steps: [async (view) => { await view.locator("#qList .qcard[data-id]").first().click(); await view.locator("#questionSheetOverlay.sheet-active").waitFor({ timeout: 5000 }); await view.waitForTimeout(500); }] },
  { id: "games-editor-delete-question", category: CAT, title: "Edycja gry — potwierdzenie usunięcia pytania", path: `/games/editor/?id=${IDS.game}`, sources: [...EDITOR, "web/shared/js/core/modal.js"], ready: "#qList > *:nth-child(2)", devices: ["desktop"],
    steps: [async (view) => { await view.locator("#qList .qcard[data-id] .x").nth(1).click(); await view.locator(".uni-modal").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(300); }] },

  // ---------- okno importu TXT ----------
  { id: "games-editor-txt-import", category: CAT, title: "Edycja gry — okno importu TXT (puste)", path: `/games/editor/?id=${IDS.game}`, sources: EDITOR, ready: "#qList > *:nth-child(2)",
    steps: [open("#btnImportTxt", "#txtImportOverlay")] },
  { id: "games-editor-txt-import-preview", category: CAT, title: "Edycja gry — okno importu TXT z podglądem na żywo", path: `/games/editor/?id=${G.birthday}`, sources: EDITOR, ready: "#qList > *:nth-child(2)",
    steps: [open("#btnImportTxt", "#txtImportOverlay"), async (view, { lang }) => { await view.locator("#txtTa").fill(TXT[lang]); await view.locator("#txtTa").evaluate((el) => { el.scrollTop = 0; }); await view.locator("#txtPreviewBody .txt-preview-summary").waitFor({ timeout: 5000 }); await view.waitForTimeout(300); }] },
  { id: "games-editor-txt-import-error", category: CAT, title: "Edycja gry — okno importu TXT: błąd w treści", path: `/games/editor/?id=${G.birthday}`, sources: EDITOR, ready: "#qList > *:nth-child(2)",
    steps: [open("#btnImportTxt", "#txtImportOverlay"), async (view, { lang }) => { await view.locator("#txtTa").fill(TXT_BAD[lang]); await view.locator("#txtPreviewBody.is-error").waitFor({ timeout: 5000 }); await view.waitForTimeout(300); }] },
  { id: "games-editor-txt-import-confirm", category: CAT, title: "Edycja gry — import TXT: potwierdzenie zastąpienia pytań", path: `/games/editor/?id=${G.birthday}`, sources: EDITOR, ready: "#qList > *:nth-child(2)", devices: ["desktop"],
    steps: [open("#btnImportTxt", "#txtImportOverlay"), async (view, { lang }) => { await view.locator("#txtTa").fill(TXT[lang]); await view.waitForTimeout(300); await view.locator("#btnTxtImport").click(); await view.locator(".uni-modal").waitFor({ state: "visible", timeout: 5000 }); await view.waitForTimeout(300); }] },

  // ---------- blokada edycji i reset po ankiecie ----------
  { id: "games-editor-locked-poll", category: CAT, title: "Edycja gry — zablokowana: ankieta otwarta (komunikat na całą stronę)", path: `/games/editor/?id=${IDS.poll}`, sources: [...EDITOR, "web/shared/js/core/resource-lock.js", "web/shared/css/blocking-overlay.css"],
    ready: ".blocking-card" },
  { id: "games-editor-locked-stopped", category: CAT, title: "Edycja gry — zablokowana: ankieta zatrzymana", path: `/games/editor/?id=${G.wedding}`, sources: [...EDITOR, "web/shared/js/core/resource-lock.js"],
    ready: ".blocking-card" },
  { id: "games-editor-locked-busy", category: CAT, title: "Edycja gry — zablokowana: gra otwarta w innym miejscu", path: `/games/editor/?id=${IDS.game}`, sources: [...EDITOR, "web/shared/js/core/resource-lock.js"],
    db: (db) => { db.rpc.acquire_edit_locks = { ok: false, error: "locked", blocker_type: "game", blocker_context: "control", resource: { type: "game", id: IDS.game } }; },
    ready: ".blocking-card" },
  { id: "games-editor-reset-after-poll", category: CAT, title: "Edycja gry po ankiecie — potwierdzenie resetu wyników przed edycją", path: `/games/editor/?id=${G.school}`, sources: [...EDITOR, "web/shared/js/core/game-validate.js"],
    db: (db) => { gameRow(db, G.school).rules_state.edit = { ok: true, needs_reset: true }; },
    ready: ".uni-modal" },
];
