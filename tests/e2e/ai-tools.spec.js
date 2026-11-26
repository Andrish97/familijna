// Narzędzia czatu AI (E30) na prawdziwej bazie — bez modelu AI: spec woła
// runTool tak, jak robi to czat (te same endpointy, RLS, blokady, maile).
// Wyłapuje złe parametry RPC i kształty odpowiedzi, których nie widać
// w testach unit z atrapą bazy. Kod z brancha (serveBranchCode), baza,
// Worker (/_api/resource-*) i send-mail produkcyjne; konta wypożyczone.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 2, resources: ["mail"] } });

const ORIGIN = "https://www.familijna.app";
const STAMP = `e2e-ai-${Date.now().toString(36)}`;

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games", "bases", "logos", "polls"] });
});

async function open(page, path = "/games/") {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
}

/** Narzędzie czatu w przeglądarce, z potwierdzeniem „tak” (jak po kliknięciu „Wykonaj”). */
async function tool(page, name, args = {}) {
  const out = await page.evaluate(async ([n, a]) => {
    const { runTool } = await import("/shared/js/ai/chat.js");
    const { browserToolEnv } = await import("/shared/js/ai/env-browser.js");
    const env = await browserToolEnv({ navigate() {} });
    const ctx = { lang: "pl", pageId: "games", changed() {}, confirm: async () => true, navigate() {}, ...env, pointAt: undefined };
    const r = await runTool(n, a, ctx);
    return { error: r.error, value: JSON.parse(r.text) };
  }, [name, args]);
  if (out.error) console.log(`[e2e-diag] ${name} ${JSON.stringify(out.value).slice(0, 400)}`);
  return out;
}
async function ok(page, name, args) {
  const r = await tool(page, name, args);
  expect(r.error, `${name}: ${JSON.stringify(r.value).slice(0, 300)}`).toBe(false);
  return r.value;
}

const answers = (n) => [{ text: `ODP A${n}`, points: 50 }, { text: `ODP B${n}`, points: 30 }, { text: `ODP C${n}`, points: 20 }];
const questions = (count, withAnswers = true) => Array.from({ length: count }, (_, i) => ({ text: `Pytanie ${i + 1}?`, ...(withAnswers ? { answers: answers(i + 1) } : {}) }));

test("narzędzia czatu: gry, ustawienia, bazy, logo, ankiety, Rynek, wskazywanie — jedno konto", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(300_000);
  await loginAs(page, context, accounts.standard[0]);
  await open(page);
  const created = { games: [], bases: [], logos: [] };
  try {
    // gra przygotowana z 10 pytaniami
    const game = await ok(page, "create_game", { type: "prepared", name: `${STAMP} gra`, questions: questions(10) });
    created.games.push(game.id);
    let g = await ok(page, "get_game", { game_id: game.id });
    expect(g.questions).toHaveLength(10);
    expect(g.can_play?.ok ?? g.can_play).toBeTruthy();

    // treść: nazwa, nowe pytanie, zmiana odpowiedzi, usunięcie pytania
    const q1 = g.questions[0];
    await ok(page, "edit_game", { game_id: game.id, operations: [
      { op: "rename", name: `${STAMP} gra 2` },
      { op: "add_question", text: "Dodane pytanie?", answers: answers(99) },
      { op: "update_answer", answer_id: q1.answers[0].id, text: "NOWA", points: 45 },
      { op: "delete_question", question_id: g.questions[9].id },
    ] });
    g = await ok(page, "get_game", { game_id: game.id });
    expect(g.game.name).toBe(`${STAMP} gra 2`);
    expect(g.questions.map((q) => q.text)).toContain("Dodane pytanie?");
    expect(g.questions[0].answers[0]).toMatchObject({ text: "NOWA", points: 45 });

    // ustawienia: drużyny, kolory, motyw, finał i rundy, dźwięk
    const s0 = await ok(page, "get_game_settings", { game_id: game.id });
    expect(s0.options.questions).toHaveLength(10);
    const ids = s0.options.questions.map((q) => q.id);
    const sound = Object.keys(s0.options.sounds)[0];
    await ok(page, "update_game_settings", {
      game_id: game.id, team_a_name: "Kowalscy", colors: { team_a: "#f80" }, theme: s0.options.themes[1],
      final_questions: { mode: "pick", question_ids: ids.slice(0, 5) },
      round_questions: { mode: "pick", question_ids: ids.slice(5).reverse() },
      sounds: [{ sound, variant: s0.options.sounds[sound][0], volume: 40 }],
      main_prize_amount: 5000, end_screen: "points",
    });
    const s1 = (await ok(page, "get_game_settings", { game_id: game.id })).settings;
    expect(s1).toMatchObject({ team_a_name: "Kowalscy", theme: s0.options.themes[1], main_prize_amount: 5000, end_screen: "points" });
    expect(s1.colors.team_a).toBe("#FF8800");
    expect(s1.final_questions).toEqual({ mode: "pick", question_ids: ids.slice(0, 5) });
    expect(s1.round_questions.question_ids).toEqual(ids.slice(5).reverse());
    expect(s1.sounds.volumes[sound]).toBe(40);
    expect((await tool(page, "update_game_settings", { game_id: game.id, final_questions: { mode: "pick", question_ids: ids.slice(0, 4) } })).value.error).toBe("final_needs_5");

    // duplikat (Worker /_api/resource-duplicate) i zmiana typu
    const dup = await ok(page, "duplicate", { kind: "game", source_id: game.id });
    const after = (await ok(page, "list_games", {})).games.filter((x) => x.name.startsWith(STAMP));
    expect(after.length, JSON.stringify(dup)).toBe(2);
    for (const x of after) if (!created.games.includes(x.id)) created.games.push(x.id);
    const copyId = after.find((x) => x.id !== game.id).id;
    await ok(page, "change_game_type", { game_id: copyId, type: "poll_points" });
    expect((await ok(page, "get_game", { game_id: copyId })).game.type).toBe("poll_points");

    // baza: pytania w folderze, tag, kopia, kosz, gra z pytań bazy, usunięcie
    const base = await ok(page, "create_base", { name: `${STAMP} baza` });
    created.bases.push(base.id);
    await ok(page, "add_base_questions", { base_id: base.id, folder_name: "Folder AI", questions: questions(3) });
    let b = await ok(page, "get_base", { base_id: base.id });
    expect(b.questions).toHaveLength(3);
    const folder = b.folders.find((f) => f.name === "Folder AI");
    await ok(page, "base_tag", { base_id: base.id, action: "save", name: "ai", color: "#33aa55" });
    b = await ok(page, "get_base", { base_id: base.id });
    const tag = b.tags.find((x) => x.name === "ai");
    await ok(page, "base_tag", { base_id: base.id, action: "attach", tag_ids: [tag.id], question_ids: [b.questions[0].id] });
    b = await ok(page, "get_base", { base_id: base.id });
    expect(b.questions.find((q) => q.id === b.questions[0].id).tag_ids).toContain(tag.id);
    await ok(page, "copy_base_items", { base_id: base.id, folder_ids: [folder.id] });
    expect((await ok(page, "get_base", { base_id: base.id })).questions).toHaveLength(6);
    await ok(page, "delete_base_items", { base_id: base.id, question_ids: [b.questions[1].id] });
    const trash = await ok(page, "base_trash", { base_id: base.id, action: "list" });
    const trashIds = trash.items.map((x) => x.id);
    expect(trashIds.length, JSON.stringify(trash).slice(0, 300)).toBeGreaterThan(0);
    await ok(page, "base_trash", { base_id: base.id, action: "restore", trash_ids: trashIds });
    expect((await ok(page, "get_base", { base_id: base.id })).questions).toHaveLength(6);
    const fromBase = await ok(page, "create_game_from_base", { base_id: base.id, name: `${STAMP} z bazy`, type: "prepared", folder_ids: [folder.id] });
    created.games.push(fromBase.id);
    expect(fromBase.questions).toBe(3);
    await ok(page, "delete_base", { base_id: base.id });
    created.bases = [];

    // logo: rysunek z podglądem, tekstowe, usunięcie
    const preview = await ok(page, "draw_logo", { name: `${STAMP} rys`, preview_only: true, shapes: [{ type: "ellipse", cx: 30, cy: 35, rx: 20, ry: 20 }, { type: "text", x: 75, y: 28, text: "AI" }] });
    expect(preview.saved).toBe(false);
    expect(preview.warnings).toEqual([]);
    const drawn = await ok(page, "draw_logo", { name: `${STAMP} rys`, shapes: [{ type: "ellipse", cx: 30, cy: 35, rx: 20, ry: 20 }, { type: "text", x: 75, y: 28, text: "AI" }] });
    created.logos.push(drawn.id);
    const textLogo = await ok(page, "create_text_logo", { name: `${STAMP} tekst`, text: "AI" });
    created.logos.push(textLogo.id);
    const logos = (await ok(page, "list_logos", {})).logos.filter((l) => l.name.startsWith(STAMP));
    expect(logos.map((l) => l.type).sort()).toEqual(["GLYPH_30x10", "PIX_150x70"]);
    await ok(page, "update_game_settings", { game_id: game.id, logo_id: drawn.id });

    // ankieta tekstowa: start, link, pauza, wznowienie, przerwanie
    const poll = await ok(page, "create_game", { type: "poll_text", name: `${STAMP} ankieta`, questions: questions(10, false) });
    created.games.push(poll.id);
    await ok(page, "open_poll", { game_id: poll.id });
    const link = await ok(page, "get_poll_link", { game_id: poll.id });
    expect(link.link).toContain(`/go/?p=anon&id=${poll.id}`);
    await ok(page, "stop_poll", { game_id: poll.id });
    await ok(page, "resume_poll", { game_id: poll.id });
    await ok(page, "abort_poll", { game_id: poll.id });

    // odczyty: Zadania, Rynek, ustawienia miejsc
    await ok(page, "list_tasks", {});
    const market = await ok(page, "search_market", {});
    expect(Array.isArray(market.games)).toBe(true);
    await ok(page, "market_library", {});
    if (market.games[0]) await ok(page, "get_market_game", { market_id: market.games[0].market_id });
    expect((await ok(page, "list_page_places", { page: "gameSettings" })).places.length).toBeGreaterThan(3);

    // wskazanie na stronie: zaznaczony kafel i podświetlone „Ustawienia”
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator(`[data-game-id="${game.id}"]`).waitFor({ timeout: 20000 }).catch(() => {});
    const shown = await page.evaluate(async (id) => (await import("/shared/js/ai/pointer.js")).pointHere("games", { place: "settings", id, text: "Tutaj" }), game.id);
    expect(shown).toMatchObject({ ok: true, shown: true });
    await expect(page.locator(".ai-pointer-note")).toContainText("Tutaj");
    await expect(page.locator(`[data-game-id="${game.id}"]`)).toHaveClass(/is-selected/);
  } finally {
    for (const id of created.games) await tool(page, "delete_game", { game_id: id });
    for (const id of created.logos) await tool(page, "delete_logo", { logo_id: id });
    for (const id of created.bases) await tool(page, "delete_base", { base_id: id });
  }
});

test("narzędzia czatu: znajomi, kopia gry, udostępnienie bazy — dwa konta", async ({ browser, accounts, loginAs }) => {
  test.setTimeout(300_000);
  const [owner, friend] = accounts.standard;
  const ctxA = await browser.newContext({ serviceWorkers: "block" });
  const ctxB = await browser.newContext({ serviceWorkers: "block" });
  await serveBranchCode(ctxA, { pages: ["games", "bases"] });
  await serveBranchCode(ctxB, { pages: ["games", "bases"] });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await loginAs(a, ctxA, owner);
  await loginAs(b, ctxB, friend);
  await open(a);
  await open(b);
  let gameId = null;
  let baseId = null;
  try {
    // znajomość: zaproszenie i przyjęcie — albo odtworzenie po wcześniejszym
    // przebiegu (usunięcie znajomego blokuje nowe zaproszenie na 30 dni)
    const rowsOf = async (page) => { const r = await ok(page, "list_contacts", { kind: "friends" }); return Array.isArray(r) ? r : r.rows || []; };
    const about = (rows, name) => rows.find((r) => r.label === name);
    let mine = about(await rowsOf(a), friend.username);
    let theirs = about(await rowsOf(b), owner.username);
    if (theirs?.status === "declined") await ok(b, "manage_contact", { kind: "friends", id: theirs.id, action: "undo_reject" });
    if (mine?.status === "declined") await ok(a, "manage_contact", { kind: "friends", id: mine.id, action: "undo_reject" });
    mine = about(await rowsOf(a), friend.username);
    if (!mine) expect((await ok(a, "invite_contact", { kind: "friend", value: friend.username })).ok).toBe(true);
    theirs = about(await rowsOf(b), owner.username);
    if (theirs?.status === "pending" && theirs.direction === "incoming") await ok(b, "manage_contact", { kind: "friends", id: theirs.id, action: "accept" });
    mine = about(await rowsOf(a), friend.username);
    if (mine?.status === "pending" && mine.direction === "incoming") await ok(a, "manage_contact", { kind: "friends", id: mine.id, action: "accept" });
    const fr = about(await rowsOf(a), friend.username);
    expect(fr, JSON.stringify(await rowsOf(a)).slice(0, 400)).toMatchObject({ status: "active", direction: "friend" });

    // kopia gry: wysłanie (Worker /_api/resource-send) i przyjęcie
    gameId = (await ok(a, "create_game", { type: "prepared", name: `${STAMP} do wysłania`, questions: questions(10) })).id;
    const sent = await ok(a, "send_copy", { kind: "game", source_id: gameId, friend_user_ids: [fr.user_id] });
    expect(sent.results[0], JSON.stringify(sent)).toMatchObject({ ok: true });
    const inbox = await ok(b, "list_received_copies", { kind: "game" });
    const offer = inbox.copies.find((c) => c.name.startsWith(STAMP));
    expect(offer, JSON.stringify(inbox).slice(0, 300)).toBeTruthy();
    await ok(b, "answer_received_copy", { offer_id: offer.offer_id, decision: "accept" });
    const bGames = (await ok(b, "list_games", {})).games.filter((x) => x.name.startsWith(STAMP));
    expect(bGames.length).toBe(1);
    await tool(b, "delete_game", { game_id: bGames[0].id });

    // baza: udostępnienie znajomemu, propozycja, przyjęcie, odebranie dostępu
    baseId = (await ok(a, "create_base", { name: `${STAMP} wspólna` })).id;
    const share = await ok(a, "share_base", { base_id: baseId, role: "viewer", friend_user_ids: [fr.user_id] });
    expect(share.results[0], JSON.stringify(share)).toMatchObject({ ok: true });
    const proposed = (await ok(b, "list_bases", {})).bases.find((x) => x.id === baseId);
    expect(proposed, "propozycja widoczna u znajomego").toMatchObject({ proposed: true });
    await ok(b, "answer_base_share", { task_id: proposed.task_id, decision: "accept" });
    expect((await ok(b, "list_bases", {})).bases.find((x) => x.id === baseId)).toMatchObject({ owned: false, role: "viewer" });
    const sharing = await ok(a, "get_base_sharing", { base_id: baseId });
    expect(sharing.with_access.map((p) => p.user_id)).toContain(fr.user_id);
    await ok(a, "unshare_base", { base_id: baseId, user_id: fr.user_id });
    expect((await ok(b, "list_bases", {})).bases.find((x) => x.id === baseId)).toBeFalsy();
  } finally {
    if (gameId) await tool(a, "delete_game", { game_id: gameId });
    if (baseId) await tool(a, "delete_base", { base_id: baseId });
    // sprzątanie znajomości (obie strony mogą mieć wiersz)
    for (const [page] of [[a], [b]]) {
      const rows = await tool(page, "list_contacts", { kind: "friends" });
      const list = Array.isArray(rows.value) ? rows.value : rows.value?.rows || [];
      for (const r of list) {
        if (![owner.username, friend.username].includes(r.label) && ![owner.username, friend.username].includes(r.username)) continue;
        await tool(page, "manage_contact", { kind: "friends", id: r.id, action: r.status === "active" ? "remove" : r.direction === "incoming" ? "reject" : "cancel" });
      }
    }
    await ctxA.close();
    await ctxB.close();
  }
});
