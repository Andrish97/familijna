// tests/e2e/games-actions.spec.js
// Podręcznik 6 i 7.8 („Moje gry”, „Zmień typ”): czynności z listy gier, które
// nie miały testu, oraz co się dzieje, gdy użytkownik robi coś źle lub
// podejrzanie (Anuluj, gra w złym stanie, plik o nieznanym typie, wywołanie
// RPC z pominięciem przycisku). Strony z kodu brancha (serveBranchCode),
// baza i konta produkcyjne; lokalnie scripts/agent-tools/local-e2e.
//
// Stan gry ankietowej przygotowuje helpers/game-seed.js (poll_open, import
// zamkniętej ankiety) -- statusu nie ustawia się zapisem z przeglądarki.

const fs = require("fs");
const { test, expect } = require("./helpers/e2e-test");
const { seedOpenPoll } = require("./helpers/game-seed");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games"] });
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
});

/* ================= Pomocnicze ================= */

// Gra przez API: `questions` pytań, w każdym odpowiedzi z punktami `answers`
// (pusta lista -- bez odpowiedzi). `answersAt` nadpisuje odpowiedzi pytania o danym ord.
async function seedGame(page, { type = "prepared", name, questions = 10, answers = [50, 30, 20], answersAt = {} }) {
  return await page.evaluate(async ({ type, name, questions, answers, answersAt }) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    const { data: g, error } = await sb.from("games")
      .insert({ name, owner_id: u.user.id, type, status: "draft" }).select("id").single();
    if (error) throw new Error("insert games: " + error.message);
    if (!questions) return g.id;
    const { data: qs, error: qErr } = await sb.from("questions")
      .insert(Array.from({ length: questions }, (_, i) => ({ game_id: g.id, ord: i + 1, text: `Pytanie ${i + 1}` })))
      .select("id,ord");
    if (qErr) throw new Error("insert questions: " + qErr.message);
    const rows = qs.flatMap((q) => (answersAt[q.ord] || answers)
      .map((p, j) => ({ question_id: q.id, ord: j + 1, text: `Odp ${j + 1}`, fixed_points: p })));
    if (rows.length) {
      const { error: aErr } = await sb.from("answers").insert(rows);
      if (aErr) throw new Error("insert answers: " + aErr.message);
    }
    return g.id;
  }, { type, name, questions, answers, answersAt });
}

async function gamesByName(page, name) {
  return await page.evaluate(async (name) => {
    const { data, error } = await window.__sbClient.from("games").select("id,name,type,status").eq("name", name);
    if (error) throw new Error(error.message);
    return data || [];
  }, name);
}

async function deleteGamesLike(page, prefix) {
  await page.evaluate(async (prefix) => {
    await window.__sbClient.from("games").delete().like("name", `${prefix}%`);
  }, prefix);
}

async function answersOfGame(page, id) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("questions")
      .select("ord,answers(ord,text,fixed_points)").eq("game_id", id).order("ord");
    if (error) throw new Error(error.message);
    return data.map((q) => q.answers.sort((a, b) => a.ord - b.ord));
  }, id);
}

async function openGames(page, query = "") {
  await page.goto(`${ORIGIN}/games/${query}`, { waitUntil: "domcontentloaded" });
  await page.locator("#grid > :is(.card, .addCard)").first().waitFor({ state: "visible", timeout: 30_000 });
}

const tileByName = (page, name) => page.locator("#grid .card", { has: page.locator(".name", { hasText: name }) });
const modal = (page) => page.locator(".uni-modal:visible");
const modalOk = (page) => page.locator(".uni-modal:visible .uni-foot .btn.gold");
const modalCancel = (page) => page.locator(".uni-modal:visible .uni-foot .btn:not(.gold)");

async function selectTile(page, name) {
  const tile = tileByName(page, name);
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();
  await expect(tile).toHaveClass(/is-selected/);
  await expect(page.locator("#btnPreview")).toBeEnabled({ timeout: 10_000 });
}

/* ================= 6 — nawigacja, zakładki, statusy ================= */

test.describe("Moje gry: nawigacja i zakładki", () => {
  test("telefon: menu z trzema kreskami otwiera się i zamyka krzyżykiem, tłem i Escape", async ({ browser, accounts, loginAs }) => {
    const ctx = await browser.newContext({ ...PHONE, serviceWorkers: "block" });
    await serveBranchCode(ctx, { pages: ["games"] });
    await ctx.addInitScript(() => localStorage.setItem("uiLang", "pl"));
    const page = await ctx.newPage();
    try {
      await loginAs(page, ctx, accounts.standard[0]);
      await openGames(page);
      const toggle = page.locator(".topbar-menu-toggle");
      const overlay = page.locator(".topbar-mobile-overlay");
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(toggle).toHaveAttribute("aria-label", "Otwórz menu");

      // otwarcie -> przycisk staje się krzyżykiem (etykieta „Zamknij menu”), ponowne dotknięcie zamyka
      await toggle.tap();
      await expect(overlay).toHaveClass(/is-open/);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(toggle).toHaveAttribute("aria-label", "Zamknij menu");
      await expect(overlay.locator("#btnBases")).toBeVisible();
      await toggle.tap();
      await expect(overlay).not.toHaveClass(/is-open/);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");

      // Escape
      await toggle.tap();
      await expect(overlay).toHaveClass(/is-open/);
      await page.keyboard.press("Escape");
      await expect(overlay).not.toHaveClass(/is-open/);

      // dotknięcie tła poza panelem (lewa krawędź ekranu -- panel wysuwa się z prawej)
      await toggle.tap();
      await expect(overlay).toHaveClass(/is-open/);
      const onBackdrop = await page.evaluate(() => document.elementFromPoint(8, innerHeight - 40)?.classList.contains("topbar-mobile-overlay"));
      expect(onBackdrop, "lewa krawędź ekranu to tło menu, nie panel").toBe(true);
      await page.touchscreen.tap(8, 844 - 40);
      await expect(overlay).not.toHaveClass(/is-open/);
      await expect(page).toHaveURL(/\/games\/?(\?.*)?$/);
    } finally {
      await ctx.close();
    }
  });

  test("zakładki: pełne nazwy na komputerze, krótkie na telefonie; wybrana zakładka w adresie", async ({ page, context, accounts, loginAs }) => {
    await loginAs(page, context, accounts.standard[0]);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openGames(page);
    const full = { tabPollText: "Ankieta tekstowa", tabPollPoints: "Punktacja", tabPrepared: "Preparowana", tabMarket: "Gry Społeczności" };
    const short = { tabPollText: "Tekst", tabPollPoints: "Punkty", tabPrepared: "Prepar.", tabMarket: "Społeczność" };
    for (const [id, text] of Object.entries(full)) await expect(page.locator(`#${id} .only-desktop`)).toHaveText(text);
    await page.locator("#tabPollPoints").click();
    await expect(page).toHaveURL(/tab=poll_points/);

    await page.setViewportSize({ width: 390, height: 844 });
    for (const [id, text] of Object.entries(short)) {
      await expect(page.locator(`#${id} .only-mobile`)).toHaveText(text);
      await expect(page.locator(`#${id} .only-mobile`)).toBeVisible();
      await expect(page.locator(`#${id} .only-desktop`)).toBeHidden();
    }
    // nieznana zakładka w adresie -> domyślna, bez błędu
    await openGames(page, "?tab=hack");
    await expect(page.locator("#grid .addCard")).toBeVisible();
  });
});

test.describe("Moje gry: statusy ankiet i przyciski działań", () => {
  test("otwarta ankieta: OTWARTA z liczbą głosów; zatrzymana: ZATRZYMANA i „do podliczenia”; edycja, typ, gra i wysyłka wyłączone z powodem", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(120_000);
    await loginAs(page, context, accounts.standard[0]);
    const prefix = `E2E-GA-ST-${Date.now()}`;
    const open = `${prefix}-OPEN`;
    const stopped = `${prefix}-STOP`;
    try {
      await openGames(page);
      await seedOpenPoll(page, { type: "poll_text", name: open });
      const stoppedId = await seedOpenPoll(page, { type: "poll_points", name: stopped });
      await page.evaluate(async (id) => {
        const { error } = await window.__sbClient.rpc("poll_stop", { p_game_id: id });
        if (error) throw new Error("poll_stop: " + error.message);
      }, stoppedId);

      await openGames(page, "?tab=poll_text");
      const openTile = tileByName(page, open);
      await expect(openTile.locator(".cardStatus")).toHaveText(/^otwarta$/i, { timeout: 20_000 });
      await expect(openTile.locator(".pollBadge")).toHaveText("0 głosów");
      await selectTile(page, open);
      const reasons = {
        "#btnEdit": "Ankieta jest otwarta — edycja zablokowana.",
        "#btnChangeType": "Ankieta jest otwarta — edycja zablokowana.",
        "#btnPlay": "Gra będzie dostępna dopiero po zamknięciu ankiety.",
        "#btnSettings": "Gra będzie dostępna dopiero po zamknięciu ankiety.",
        "#btnSendCopy": "Wysłać można tylko szkic gry (bez wyników ankiety).",
      };
      for (const [sel, reason] of Object.entries(reasons)) {
        await expect(page.locator(sel), sel).toBeDisabled();
        await expect(page.locator(sel), sel).toHaveAttribute("data-tooltip", reason);
      }
      // ankietę, podgląd, kopię i eksport wolno
      for (const sel of ["#btnPoll", "#btnPreview", "#btnDuplicate", "#btnExport", "#btnExportBase"]) await expect(page.locator(sel), sel).toBeEnabled();

      await openGames(page, "?tab=poll_points");
      const stoppedTile = tileByName(page, stopped);
      await expect(stoppedTile.locator(".cardStatus")).toHaveText(/^zatrzymana$/i, { timeout: 20_000 });
      await expect(stoppedTile.locator(".pollBadge")).toHaveText("do podliczenia");
      await selectTile(page, stopped);
      await expect(page.locator("#btnEdit")).toBeDisabled();
      await expect(page.locator("#btnEdit")).toHaveAttribute("data-tooltip", "Ankieta jest zatrzymana — edycja zablokowana. Przerwij ankietę, żeby edytować.");
      await expect(page.locator("#btnChangeType")).toBeDisabled();
      await expect(page.locator("#btnPlay")).toBeDisabled();
      await expect(page.locator("#btnPoll")).toBeEnabled();

      // filtr stanu: tylko zatrzymane
      await openGames(page, "?tab=poll_points&status=stopped");
      await expect(tileByName(page, stopped)).toBeVisible({ timeout: 20_000 });
      await openGames(page, "?tab=poll_points&status=open");
      await expect(tileByName(page, stopped)).toBeHidden();

      // podejrzanie: zmiana typu otwartej ankiety z pominięciem przycisku -- baza odmawia
      const res = await page.evaluate(async (name) => {
        const sb = window.__sbClient;
        const { data: g } = await sb.from("games").select("id").eq("name", name).single();
        const { data, error } = await sb.rpc("game_change_type", { p_game_id: g.id, p_type: "prepared", p_reset: true, p_keep: false });
        const { data: after } = await sb.from("games").select("type,status").eq("id", g.id).single();
        return { ok: !error && !!data?.ok, after };
      }, open);
      expect(res.ok, "game_change_type przy otwartej ankiecie").toBe(false);
      expect(res.after).toEqual({ type: "poll_text", status: "poll_open" });
    } finally {
      await deleteGamesLike(page, prefix);
    }
  });

  test("bez zaznaczenia działa tylko Importuj; preparowana nie ma ankiety; szkic ankiety z brakami nie uruchomi ankiety (powód na kafelku i w podpowiedzi)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const prefix = `E2E-GA-BTN-${Date.now()}`;
    try {
      await openGames(page);
      await seedGame(page, { name: `${prefix}-PREP` });
      await seedGame(page, { type: "poll_text", name: `${prefix}-TXT9`, questions: 9, answers: [] });
      await seedGame(page, { type: "poll_points", name: `${prefix}-PTS`, answers: [0, 0, 0], answersAt: { 3: [0, 0] } });

      await openGames(page, "?tab=prepared");
      for (const sel of ["#btnPlay", "#btnSettings", "#btnEdit", "#btnPreview", "#btnPoll", "#btnDuplicate", "#btnChangeType", "#btnExport", "#btnExportBase", "#btnSendCopy"]) {
        await expect(page.locator(sel), `${sel} bez zaznaczenia`).toBeDisabled();
      }
      await expect(page.locator("#btnImport")).toBeEnabled();
      await selectTile(page, `${prefix}-PREP`);
      await expect(page.locator("#btnPoll")).toBeDisabled();
      await expect(page.locator("#btnPoll")).toHaveAttribute("data-tooltip", "Gra preparowana nie ma ankiety.");
      for (const sel of ["#btnPlay", "#btnSettings", "#btnEdit", "#btnChangeType", "#btnDuplicate", "#btnExport", "#btnSendCopy"]) await expect(page.locator(sel), sel).toBeEnabled();
      // klik w puste miejsce siatki odznacza
      await page.locator("#grid").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("#btnEdit")).toBeDisabled();

      await openGames(page, "?tab=poll_text");
      await expect(tileByName(page, `${prefix}-TXT9`).locator(".rules")).toHaveText("Gra musi mieć co najmniej 10 pytań (masz: 9).", { timeout: 20_000 });
      await selectTile(page, `${prefix}-TXT9`);
      await expect(page.locator("#btnPoll")).toBeDisabled();
      await expect(page.locator("#btnPoll")).toHaveAttribute("data-tooltip", "Gra musi mieć co najmniej 10 pytań (masz: 9).");
      await expect(page.locator("#btnPlay")).toHaveAttribute("data-tooltip", "Gra będzie dostępna dopiero po zamknięciu ankiety.");
      await expect(page.locator("#btnEdit")).toBeEnabled();

      await openGames(page, "?tab=poll_points");
      const pts = tileByName(page, `${prefix}-PTS`);
      await expect(pts.locator(".rules")).toHaveText("Pytanie #3: musi mieć 3–6 odpowiedzi (masz: 2).", { timeout: 20_000 });
      await expect(pts.locator(".cardStatus")).toHaveText(/^szkic$/i);
      await selectTile(page, `${prefix}-PTS`);
      await expect(page.locator("#btnPoll")).toBeDisabled();

      // podejrzanie: uruchomienie ankiety z brakami z pominięciem przycisku -- baza odmawia
      const opened = await page.evaluate(async (name) => {
        const sb = window.__sbClient;
        const { data: g } = await sb.from("games").select("id,share_key_poll").eq("name", name).single();
        const { error } = await sb.rpc("poll_open", { p_game_id: g.id, p_key: g.share_key_poll });
        const { data: after } = await sb.from("games").select("status").eq("id", g.id).single();
        return { error: !!error, status: after.status };
      }, `${prefix}-TXT9`);
      expect(opened).toEqual({ error: true, status: "draft" });
    } finally {
      await deleteGamesLike(page, prefix);
    }
  });
});

/* ================= 6.3 / 6.5 — tworzenie, usuwanie ================= */

test.describe("Moje gry: tworzenie i usuwanie", () => {
  test("nowa gra: nazwa ponad 80 znaków ucięta, nowa gra zaznaczona; Anuluj nic nie tworzy", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const prefix = `E2E-GA-NEW-${Date.now()}`;
    const long = `${prefix}-${"x".repeat(100)}`;
    try {
      await openGames(page, "?tab=poll_points");
      await page.locator("#grid .addCard").click();
      await expect(modal(page)).toContainText("Podaj nazwę gry.");
      await page.locator(".uni-modal .uni-inp").fill(long);
      await expect(page.locator(".uni-modal .uni-inp")).toHaveValue(long.slice(0, 80));
      await page.locator(".uni-modal .uni-inp").press("Enter");
      await expect(page.locator(".uni-modal")).toBeHidden({ timeout: 15_000 });
      const created = await gamesByName(page, long.slice(0, 80));
      expect(created).toMatchObject([{ type: "poll_points", status: "draft" }]);
      const tile = tileByName(page, long.slice(0, 80));
      await expect(tile).toHaveClass(/is-selected/);
      await expect(tile.locator(".cardStatus")).toHaveText(/^szkic$/i);
      await expect(page.locator("#btnEdit")).toBeEnabled({ timeout: 10_000 });

      // nazwa z samych spacji -> komunikat, okno zostaje
      await page.locator("#grid .addCard").click();
      await page.locator(".uni-modal .uni-inp").fill("   ");
      await modalOk(page).click();
      await expect(page.locator(".uni-modal .importMsg")).toHaveText("Podaj nazwę.");
      // Anuluj -> nic nie powstaje
      await page.locator(".uni-modal .uni-inp").fill(`${prefix}-CANCEL`);
      await modalCancel(page).click();
      await expect(page.locator(".uni-modal")).toBeHidden();
      expect(await gamesByName(page, `${prefix}-CANCEL`)).toHaveLength(0);
    } finally {
      await deleteGamesLike(page, prefix);
    }
  });

  test("usuwanie: Anuluj w oknie zostawia grę; okno podaje nazwę gry", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-DEL-${Date.now()}`;
    try {
      await openGames(page);
      await seedGame(page, { name, questions: 1 });
      await openGames(page, "?tab=prepared");
      await tileByName(page, name).locator(".x").click();
      await expect(modal(page)).toContainText(`Czy na pewno chcesz usunąć „${name}”?`);
      await expect(modal(page)).not.toContainText("Ankieta zostanie przerwana.");
      await modalCancel(page).click();
      await expect(page.locator(".uni-modal")).toBeHidden();
      await expect(tileByName(page, name)).toBeVisible();
      expect(await gamesByName(page, name)).toHaveLength(1);
    } finally {
      await deleteGamesLike(page, name);
    }
  });
});

/* ================= 6.6 / 6.7 — kopie, eksport, import ================= */

test.describe("Moje gry: kopie, eksport i import", () => {
  test("otwarta ankieta: Powiel i Eksportuj do pliku najpierw pytają „Bez bieżących głosów”; Anuluj nic nie tworzy ani nie pobiera", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-VOTES-${Date.now()}`;
    const duplicateCalls = [];
    page.on("request", (req) => { if (req.url().includes("/_api/resource-duplicate")) duplicateCalls.push(req.url()); });
    let downloads = 0;
    page.on("download", () => { downloads++; });
    try {
      await openGames(page);
      await seedOpenPoll(page, { type: "poll_points", name });
      await openGames(page, "?tab=poll_points");
      await selectTile(page, name);

      await page.locator("#btnDuplicate").click();
      await expect(modal(page)).toContainText("Bez bieżących głosów");
      await expect(modal(page)).toContainText("Kopia powstanie jako szkic tego samego typu — bieżące głosy nie zostaną zachowane.");
      await modalCancel(page).click();
      await expect(page.locator(".uni-modal")).toBeHidden();

      await page.locator("#btnExport").click();
      await expect(modal(page)).toContainText("Bez bieżących głosów");
      await modalCancel(page).click();
      await expect(page.locator(".uni-modal")).toBeHidden();
      await page.waitForTimeout(1000);

      expect(duplicateCalls, "Anuluj nie wysyła żądania kopii").toEqual([]);
      expect(downloads, "Anuluj nie pobiera pliku").toBe(0);
      expect(await gamesByName(page, `${name} kopia`)).toHaveLength(0);
      expect(await gamesByName(page, name)).toMatchObject([{ status: "poll_open" }]);
    } finally {
      await deleteGamesLike(page, name);
    }
  });

  test("eksport do bazy bez żadnej bazy: „Brak baz do wyboru.”, Eksportuj wyłączony", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-NOBASE-${Date.now()}`;
    try {
      await openGames(page);
      const bases = await page.evaluate(async () => {
        const sb = window.__sbClient;
        const { data: u } = await sb.auth.getUser();
        // konto testowe: własne bazy usuwamy (lease i tak je czyści), udostępnionych nie ruszamy
        await sb.from("question_bases").delete().eq("owner_id", u.user.id);
        const { data } = await sb.from("question_bases").select("id");
        return (data || []).length;
      });
      test.skip(bases > 0, "konto ma bazy udostępnione przez innych -- okno pokaże listę");
      await seedGame(page, { name });
      await openGames(page, "?tab=prepared");
      await selectTile(page, name);
      await page.locator("#btnExportBase").click();
      await expect(page.locator("#exportBaseOverlay")).toBeVisible();
      await expect(page.locator("#exportBaseOverlay")).toContainText("Brak baz do wyboru.", { timeout: 15_000 });
      await expect(page.locator("#btnExportBaseDo")).toBeDisabled();
    } finally {
      await deleteGamesLike(page, name);
    }
  });

  test("import: podgląd pokazuje nazwę, typ, liczbę pytań i uwagę o niepełnym wyniku; tworzy nową grę obok istniejącej; plik z nieznanym typem odrzucony", async ({ page, context, accounts, loginAs }, testInfo) => {
    test.setTimeout(120_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-IMP-${Date.now()}`;
    const partial = testInfo.outputPath("partial.famgame");
    // zamknięta ankieta z odpowiedziami poniżej 4 pkt -- wynik niepełny, import da szkic
    fs.writeFileSync(partial, JSON.stringify({
      format_version: 2,
      game: { name, type: "poll_points", state: "closed" },
      questions: Array.from({ length: 10 }, (_, i) => ({ text: `Pytanie ${i + 1}`, answers: [3, 2, 1].map((p, j) => ({ text: `Odp ${j + 1}`, fixed_points: p })) })),
    }));
    const market = testInfo.outputPath("market.famgame");
    fs.writeFileSync(market, JSON.stringify({ format_version: 2, game: { name: `${name}-M`, type: "market" }, questions: [{ text: "P?", answers: [] }] }));
    try {
      await openGames(page);
      const existingId = await seedGame(page, { type: "poll_points", name, questions: 2, answers: [0, 0, 0] });
      await openGames(page, "?tab=poll_points");

      await page.locator("#btnImport").click();
      await expect(page.locator("#importOverlay")).toBeVisible();
      await page.locator("#importFile").setInputFiles(market);
      await expect(page.locator("#importErr")).toBeVisible({ timeout: 10_000 });
      await expect(page.locator("#importErr")).not.toBeEmpty();
      await expect(page.locator("#btnImportJson")).toBeDisabled();

      await page.locator("#importFile").setInputFiles(partial);
      const preview = page.locator("#importPreview");
      await expect(preview).toContainText(`Nazwa: ${name}`, { timeout: 10_000 });
      await expect(preview).toContainText("Typ: PUNKTACJA");
      await expect(preview).toContainText("Pytania: 10");
      await expect(preview.locator(".import-note")).toHaveText("Wynik ankiety w pliku jest niepełny — gra zostanie zaimportowana jako szkic ankiety.");
      await page.locator("#btnImportJson").click();
      await expect(page.locator("#btnImportJson")).toHaveAttribute("data-i18n", "games.import.done", { timeout: 30_000 });
      await page.locator("#btnImportJson").click();
      await expect(page.locator("#importOverlay")).toBeHidden({ timeout: 30_000 });

      const games = await gamesByName(page, name);
      expect(games).toHaveLength(2);
      const imported = games.find((g) => g.id !== existingId);
      expect(imported).toMatchObject({ type: "poll_points", status: "draft" });
      expect((await answersOfGame(page, existingId)).length, "istniejąca gra bez zmian").toBe(2);
      expect((await answersOfGame(page, imported.id)).length).toBe(10);
      expect(await gamesByName(page, `${name}-M`)).toHaveLength(0);
    } finally {
      await deleteGamesLike(page, name);
    }
  });
});

/* ================= 6.4 — Gry Społeczności ================= */

test("Gry Społeczności: pusta biblioteka -- komunikat zamiast kafla „Nowa gra”, przyciski działań wyłączone", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await openGames(page, "?tab=market");
  const empty = page.locator("#grid .addCard--static");
  const hasLibrary = await page.locator("#grid .card[data-market-id]").count();
  test.skip(hasLibrary > 0, "konto ma gry ze Społeczności w bibliotece");
  await expect(empty).toContainText("Twoja biblioteka jest pusta.");
  await expect(empty).toContainText("Dodaj gry ze Społeczności.");
  await expect(page.locator("#grid .addCard:not(.addCard--static)")).toHaveCount(0);
  for (const sel of ["#btnPlay", "#btnSettings", "#btnEdit", "#btnPreview", "#btnPoll", "#btnDuplicate", "#btnChangeType", "#btnExport", "#btnExportBase", "#btnSendCopy"]) {
    await expect(page.locator(sel), sel).toBeDisabled();
  }
});

/* ================= 7.8 — Zmień typ ================= */

test.describe("Zmień typ", () => {
  test("preparowana -> Punktacja: odpowiedzi zostają, punkty usunięte; Anuluj nic nie zmienia", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-CT-P-${Date.now()}`;
    try {
      await openGames(page);
      const id = await seedGame(page, { name, questions: 2, answers: [40, 30, 20] });
      await openGames(page, "?tab=prepared");
      await selectTile(page, name);
      await expect(page.locator("#btnChangeType")).toBeEnabled();

      // Anuluj
      await page.locator("#btnChangeType").click();
      await expect(modal(page)).toContainText("Zmienia się ta sama gra (to nie kopia) i wraca do szkicu.");
      await page.locator(".change-type-option", { has: page.locator('input[value="poll_points"]') }).click();
      await modalCancel(page).click();
      await expect(page.locator(".change-type")).toHaveCount(0);
      expect(await gamesByName(page, name)).toMatchObject([{ id, type: "prepared" }]);

      // Zmień
      await page.locator("#btnChangeType").click();
      const option = page.locator(".change-type-option", { has: page.locator('input[value="poll_points"]') });
      await option.click();
      await expect(option.locator(".change-type-desc")).toHaveText("Zachowasz pytania i odpowiedzi. Punkty usuniemy.");
      await modalOk(page).click();
      await expect.poll(async () => (await gamesByName(page, name)).map((g) => `${g.id === id}/${g.type}/${g.status}`), { timeout: 15_000 })
        .toEqual(["true/poll_points/draft"]);
      const answers = await answersOfGame(page, id);
      expect(answers.map((q) => q.map((a) => `${a.text}:${a.fixed_points}`))).toEqual([
        ["Odp 1:0", "Odp 2:0", "Odp 3:0"], ["Odp 1:0", "Odp 2:0", "Odp 3:0"],
      ]);
      await expect(page).toHaveURL(/tab=poll_points/);
      await expect(tileByName(page, name)).toBeVisible();
    } finally {
      await deleteGamesLike(page, name);
    }
  });

  test("ankieta tekstowa -> preparowana: zostają same pytania, gra jest szkicem z brakami", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-GA-CT-T-${Date.now()}`;
    try {
      await openGames(page);
      const id = await seedGame(page, { type: "poll_text", name, questions: 10, answers: [] });
      await openGames(page, "?tab=poll_text");
      await selectTile(page, name);
      await page.locator("#btnChangeType").click();
      await expect(page.locator('.change-type input[value="poll_text"]')).toBeDisabled();
      const option = page.locator(".change-type-option", { has: page.locator('input[value="prepared"]') });
      await option.click();
      await expect(option.locator(".change-type-desc")).toHaveText("Pytania i odpowiedzi zostaną.");
      await modalOk(page).click();
      await expect.poll(async () => (await gamesByName(page, name)).map((g) => `${g.type}/${g.status}`), { timeout: 15_000 }).toEqual(["prepared/draft"]);
      const answers = await answersOfGame(page, id);
      expect(answers).toHaveLength(10);
      expect(answers.every((q) => q.length === 0)).toBe(true);
      await expect(tileByName(page, name).locator(".rules")).toHaveText("Pytanie #1: musi mieć 3–6 odpowiedzi (masz: 0).", { timeout: 15_000 });
    } finally {
      await deleteGamesLike(page, name);
    }
  });
});
