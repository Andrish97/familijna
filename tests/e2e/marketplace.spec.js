const { test, expect } = require("./helpers/e2e-test");
const { loginAsGuest } = require("./helpers/login");
const { serveBranchCode } = require("./helpers/branch-code");

const URL = "https://www.familijna.app/marketplace";
const PREFIX = "E2E-MKT-";

test.use({ serviceWorkers: "block" });
// E25: jedno wypożyczone konto zwykłe (czyszczone przy wypożyczeniu).
test.use({ needs: { standard: 1 } });
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["marketplace"] });
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
});

test("E20: Marketplace na telefonie używa ikon wyszukiwania i filtrów", async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["marketplace"] });
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
  const page = await context.newPage();
  try {
    await page.goto(`${URL}?sort=newest`, { waitUntil: "domcontentloaded" });
    const firstCard = page.locator("#browseGrid .mkt-card").first();
    await expect(firstCard).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#searchInput")).toBeHidden();
    await expect(page.locator("#btnSearchFocus")).toBeVisible();
    await expect(page.locator("#langFilter")).toBeVisible();
    await expect(page.locator("#langFilter .ui-select-icon svg")).toBeVisible();
    // ikona języka: globus z pliku SVG (icons.js), nie tekst
    await expect(page.locator("#langFilter .ui-select-icon svg.ico-globe")).toHaveCount(1);
    await expect(page.locator("#langFilter .mkt-filter-btn #langFilterLabel")).toHaveText("Język");
    await expect(page.locator("#sortSelect")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const title = (await firstCard.locator(".mkt-card-title").innerText()).trim();
    const language = (await firstCard.locator(".mkt-lang-badge").innerText()).trim().toLowerCase();
    await page.locator("#btnSearchFocus").click();
    const searchModal = page.locator(".uni-modal");
    await expect(searchModal).toBeVisible();
    await searchModal.locator(".uni-inp").fill(title);
    await searchModal.locator(".uni-foot .gold").click();
    await expect(page.locator("#searchInput")).toHaveValue(title);
    await expect(page).toHaveURL(/q=/);
    await expect(page.locator("#browseGrid .mkt-card-title").first()).toContainText(title);

    await page.locator("#langFilter .ui-select-btn").click();
    await page.locator(`#langFilter .menu-item[data-value="${language}"]`).click();
    await expect(page).toHaveURL(new RegExp(`filter=${language}`));
    await expect(page.locator("#browseGrid .mkt-card-title").first()).toContainText(title);
    await page.locator("#sortSelect .ui-select-btn").click();
    await page.locator('#sortSelect .menu-item[data-value="newest"]').click();
    await expect(page).toHaveURL(/sort=newest/);

    await firstCard.click();
    await expect(page.locator("#gameDetailOverlay")).toBeVisible();
    await expect(page.locator("#detailTitle")).toContainText(title);
    await page.screenshot({ path: testInfo.outputPath("shot-e20-marketplace-phone-detail.png"), fullPage: true });
    // Na telefonie okno od dołu: „×” ukryty, zamyka pasek u góry okna.
    await page.locator("#gameDetailOverlay .sheet-handle").click();
    await expect(page.locator("#gameDetailOverlay")).toBeHidden();
    await expect(page.locator("#searchInput")).toHaveValue(title);
    await expect(page.locator("#browseGrid .mkt-card-title").first()).toContainText(title);
  } finally {
    await context.close();
  }
});

async function rpc(page, name, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    const { data, error } = await window.__sbClient.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }, { name, args });
}

async function cleanup(page) {
  const result = await rpc(page, "e2e_marketplace_cleanup", { p_prefix: PREFIX });
  expect(result?.ok, JSON.stringify(result)).toBe(true);
}

async function publishedGame(page) {
  const rows = await rpc(page, "market_browse", {
    p_lang: "pl", p_search: "", p_limit: 100, p_offset: 0,
  });
  const game = rows.find((row) => row.origin === "producer") || rows[0];
  expect(game, "produkcyjny katalog musi zawierać opublikowaną grę").toBeTruthy();
  return game;
}

async function removeLibraryCopy(page, id) {
  const rows = await rpc(page, "market_remove_from_library", { p_market_game_id: id });
  expect(rows?.[0]?.ok, JSON.stringify(rows)).toBe(true);
}

async function createPlayableGame(page, name, questionPrefix = name) {
  return page.evaluate(async ({ name, questionPrefix }) => {
    const sb = window.__sbClient;
    const { data: auth } = await sb.auth.getUser();
    const { data: game, error: gameError } = await sb.from("games").insert({
      owner_id: auth.user.id, name, type: "prepared", status: "draft", is_demo: false,
    }).select("id").single();
    if (gameError) throw new Error(gameError.message);

    const questions = Array.from({ length: 10 }, (_, index) => ({
      game_id: game.id, ord: index + 1, text: `${questionPrefix} pytanie ${index + 1}`,
    }));
    const { data: inserted, error: qError } = await sb.from("questions").insert(questions).select("id,ord");
    if (qError) throw new Error(qError.message);
    const answers = inserted.flatMap((q) => [30, 20, 10].map((points, index) => ({
      question_id: q.id, ord: index + 1, text: `Odp ${q.ord}-${index + 1}`, fixed_points: points,
    })));
    const { error: aError } = await sb.from("answers").insert(answers);
    if (aError) throw new Error(aError.message);
    return game.id;
  }, { name, questionPrefix });
}

test("anonim: lista, wyszukiwanie, filtr, sortowanie, URL, klawiatura i i18n", async ({ page }) => {
  await page.goto(`${URL}?sort=newest`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#browseGrid .mkt-card").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#btnMySent")).toBeHidden();
  await expect(page.locator("#btnGoGames")).toContainText("Strona główna");

  const first = page.locator("#browseGrid .mkt-card").first();
  const title = (await first.locator(".mkt-card-title").innerText()).trim();
  await page.locator("#searchInput").fill(title);
  await expect(page).toHaveURL(/q=/);
  await expect(page.locator("#browseGrid .mkt-card-title").first()).toContainText(title);

  const lang = (await page.locator("#browseGrid .mkt-lang-badge").first().innerText()).toLowerCase();
  const langFilter = page.locator("#langFilter");
  await expect(langFilter).toHaveClass(/ui-select/);
  await langFilter.locator(".ui-select-btn").click();
  await langFilter.locator(`.menu-item[data-value="${lang}"]`).click();
  await expect(page.locator("#browseGrid .mkt-lang-badge").first()).toHaveText(lang.toUpperCase());
  const sortSelect = page.locator("#sortSelect");
  await expect(sortSelect).toHaveClass(/ui-select/);
  await sortSelect.locator(".ui-select-btn").click();
  await sortSelect.locator('.menu-item[data-value="title"]').click();
  await expect(page).toHaveURL(/sort=title/);

  await page.locator("#searchInput").fill("");
  await langFilter.locator(".ui-select-btn").click();
  await langFilter.locator('.menu-item[data-value="all"]').click();
  await page.locator("#browseGrid .mkt-card").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#gameDetailOverlay")).toBeVisible();
  await expect(page).toHaveURL(/\/marketplace\/game\/[^/?]+/);
  const detailUrl = page.url();
  await page.goto(detailUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#gameDetailOverlay")).toBeVisible();
  await expect(page.locator("#detailTitle")).toContainText(title);
  const refreshed = await page.reload({ waitUntil: "domcontentloaded" });
  expect(refreshed?.status()).toBe(200);
  await expect(page.locator("#gameDetailOverlay")).toBeVisible();
  await expect(page.locator("#detailTitle")).toContainText(title);
  const gameId = await first.getAttribute("data-id");
  await page.goto(`${URL}/?game=${encodeURIComponent(gameId)}&sort=title`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#gameDetailOverlay")).toBeVisible();
  await expect(page.locator("#detailTitle")).toContainText(title);
  await expect(page).toHaveURL(/\/marketplace\/game\/[^/?]+/);
  await page.keyboard.press("Escape");
  await page.locator(".lang-btn").click();
  await page.locator('.menu-item[data-lang="en"]').click();
  await expect(page.locator("#sortSelect .ui-select-label")).toHaveText("Title A–Z");
  await page.locator("#browseGrid .mkt-card").first().click();
  await expect(page.locator("#btnAddLibrary")).toHaveText("Add to my games");
  await expect(page.locator("#detailQuestions .q-preview-pts").first()).toContainText("pts");
  await page.keyboard.press("Escape");
  await expect(page.locator("#gameDetailOverlay")).toBeHidden();
  await expect(page).toHaveURL(/sort=title/);

  await page.locator("#browseGrid .mkt-card").first().click();
  await page.goBack();
  await expect(page.locator("#gameDetailOverlay")).toBeHidden();
  await expect(page).toHaveURL(/sort=title/);
});

test("wolny prawdziwy backend: publiczna siatka pozostaje odsłonięta i działa po odpowiedzi", async ({ page }) => {
  await page.route("**/rest/v1/rpc/market_public_catalog", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  // stopniowe ładowanie (decyzja 2026-10-20): przy pierwszym odczycie bez napisu „Ładowanie…",
  // siatka odsłania się razem z kartami
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#browseGrid")).toBeVisible();
  await expect(page.locator("#browseInfo")).not.toHaveText("Ładowanie…");
  await expect(page.locator("#browseGrid .mkt-card").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("#browseGrid")).toHaveClass(/skel-step-ready/);

  // Statusy 404 są sprawdzane na rzeczywistym Workerze (marketplace.test.mjs).

});

test("konto: dodanie jest atomowe i idempotentne, kopia ma poprawny typ i zawartość", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const game = await publishedGame(page);
  await removeLibraryCopy(page, game.id);

  try {
    await page.locator(`#browseGrid .mkt-card[data-id="${game.id}"]`).click();
    await expect(page.locator("#btnAddLibrary")).toBeVisible();
    await page.locator("#btnAddLibrary").evaluate((button) => { button.click(); button.click(); });
    await expect(page.locator("#addedBadge")).toBeVisible();
    await expect(page.locator("#btnAddLibrary")).toBeHidden();

    const result = await page.evaluate(async (marketId) => {
      const sb = window.__sbClient;
      const { data: copies, error } = await sb.from("games")
        .select("id,type,status,source_market_id,questions(count)")
        .eq("source_market_id", marketId);
      if (error) throw new Error(error.message);
      const detail = await sb.rpc("market_game_detail", { p_id: marketId }).single();
      return { copies, sourceCount: detail.data.payload.questions.length };
    }, game.id);
    expect(result.copies).toHaveLength(1);
    expect(result.copies[0]).toMatchObject({ type: "market", status: "ready", source_market_id: game.id });
    expect(result.copies[0].questions[0].count).toBe(result.sourceCount);

    const again = await rpc(page, "market_add_to_library", { p_market_game_id: game.id });
    expect(again[0].ok).toBe(true);
    const count = await page.evaluate(async (id) => {
      const { count, error } = await window.__sbClient.from("games")
        .select("id", { count: "exact", head: true }).eq("source_market_id", id);
      if (error) throw new Error(error.message);
      return count;
    }, game.id);
    expect(count).toBe(1);
  } finally {
    await removeLibraryCopy(page, game.id);
    await cleanup(page);
  }
});

test("konto: ocenę można zmienić, a UI i baza pokazują nową wartość", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  // HTML SSR z opublikowanego Workera, pozostałe zasoby nadal z brancha.
  // Wcześnie widoczne karty pozwalają otworzyć grę przed końcem danych konta.
  await page.route(/^https:\/\/www\.familijna\.app\/marketplace(?:[/?]|$)/, route =>
    route.request().resourceType() === "document" ? route.continue() : route.fallback());
  let releaseLibrary;
  const libraryGate = new Promise(resolve => { releaseLibrary = resolve; });
  await page.route("**/rest/v1/rpc/market_my_library", async route => {
    await libraryGate;
    await route.continue();
  });
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const game = await publishedGame(page);

  try {
    await page.locator(`#browseGrid .mkt-card[data-id="${game.id}"]`).click();
    await expect(page.locator('.mkt-star-btn[data-stars="2"]')).toBeVisible();
    releaseLibrary();
    await page.locator('.mkt-star-btn[data-stars="2"]').click();
    await expect(page.locator('.mkt-star-btn[data-stars="2"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator('.mkt-star-btn[data-stars="4"]').click();
    await expect(page.locator('.mkt-star-btn[data-stars="4"]')).toHaveAttribute("aria-pressed", "true");
    const stars = await page.evaluate(async (id) => {
      const { data, error } = await window.__sbClient.from("market_game_ratings")
        .select("stars").eq("market_game_id", id).single();
      if (error) throw new Error(error.message);
      return data.stars;
    }, game.id);
    expect(stars).toBe(4);
  } finally {
    releaseLibrary();
    await cleanup(page);
  }
});

test("gość może dodać i usunąć kopię, ale nie ocenia ani nie wysyła gry", async ({ page, context }) => {
  test.setTimeout(90_000);
  await loginAsGuest(page, context);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  // jednorazowe okno informacji dla gościa loginAsGuest oznacza już jako
  // widziane (fam:guest:info_shown:<id>), więc strona startuje bez „OK”
  const game = await publishedGame(page);
  try {
    // bezpośredni link do gry: siatka pokazuje 20 kart naraz, a kolejność zależy od katalogu
    await page.goto(`${URL}/game/${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#btnAddLibrary")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".mkt-star-input")).toHaveCount(0);
    await expect(page.locator("#btnMySent")).toBeHidden();
    await page.locator("#btnAddLibrary").click();
    await expect(page.locator("#btnRemoveLibrary")).toBeVisible();
    await page.locator("#btnRemoveLibrary").click();
    await expect(page.locator("#btnAddLibrary")).toBeVisible();
  } finally {
    await removeLibraryCopy(page, game.id);
  }
});

test("wysłanie gry tworzy dokładnie jedno pending i sprząta cały stan", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const name = `${PREFIX}${Date.now()}`;
  await createPlayableGame(page, name);

  try {
    await page.locator("#btnMySent").click();
    await page.locator("#btnSubmitNew").click();
    await page.locator("#submitGameSelect .ui-select-btn").click();
    await page.locator("#submitGameSelect .menu-item", { hasText: name }).click();
    await page.locator("#submitTitle").fill(name);
    await page.locator("#submitDesc").fill("Bezpieczny test zgłoszenia marketplace");
    await page.locator("#submitConfirm").check();
    await page.locator("#btnSubmitConfirm").evaluate((button) => { button.click(); button.click(); });
    await expect(page.locator("#submitOverlay")).toBeHidden({ timeout: 20_000 });
    const rows = await page.evaluate(async (title) => {
      const { data, error } = await window.__sbClient.from("market_games")
        .select("id,status,title").eq("title", title);
      if (error) throw new Error(error.message);
      return data;
    }, name);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
    const sentRow = page.locator(".mkt-sent-row", { hasText: name });
    await expect(sentRow).toContainText("Oczekuje na weryfikację");
    await sentRow.locator("[data-preview]").click();
    await expect(page.locator("#gameDetailOverlay")).toBeVisible();
    await expect(page.locator("#detailTitle")).toHaveText(name);
    await expect(page).toHaveURL(new RegExp(`[?&]game=${rows[0].id}`));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    const refreshResponse = await page.reload({ waitUntil: "domcontentloaded" });
    expect(refreshResponse?.status()).toBe(200);
    await expect(page.locator("#gameDetailOverlay")).toBeVisible();
    await expect(page.locator("#detailTitle")).toHaveText(name);
    await page.keyboard.press("Escape");

    const duplicate = await rpc(page, "market_submit_game", {
      p_game_id: await page.evaluate(async (gameName) => {
        const { data } = await window.__sbClient.from("games").select("id").eq("name", gameName).single();
        return data.id;
      }, name),
      p_title: name,
      p_description: "retry",
      p_lang: "pl",
      p_payload: {},
    });
    expect(duplicate[0]).toMatchObject({ ok: false, err: "already_submitted" });
  } finally {
    await cleanup(page);
  }
});

test("unikalność treści: kopia pod nowym ID, tytułem i językiem jest blokowana", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const name = `${PREFIX}UNIQUE-${Date.now()}`;
  try {
    const first = await createPlayableGame(page, name);
    const copy = await createPlayableGame(page, `${name}-copy`, name);
    const submit = id => rpc(page, "market_submit_game", { p_game_id: id, p_title: id === first ? name : `${name}-renamed`, p_description: "Test kontroli kopii", p_lang: id === first ? "pl" : "uk", p_payload: {} });
    expect((await submit(first))[0].ok).toBe(true);
    expect((await submit(copy))[0]).toMatchObject({ ok: false, err: "duplicate_content", market_id: null });
    const rows = await page.evaluate(async prefix => {
      const { data, error } = await window.__sbClient.from("market_games").select("id").like("title", `${prefix}%`);
      if (error) throw error;
      return data;
    }, name);
    expect(rows).toHaveLength(1);
  } finally { await cleanup(page); }
});

test("backend nie ujawnia listy oceniających anonimowi ani zwykłemu użytkownikowi", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  const game = await publishedGame(page);
  const rows = await rpc(page, "market_game_raters", { p_market_game_id: game.id });
  expect(rows).toEqual([]);

  const anon = await context.browser().newContext({ serviceWorkers: "block" });
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(anon, { pages: ["marketplace"] });
  const anonPage = await anon.newPage();
  try {
    await anonPage.goto(URL, { waitUntil: "domcontentloaded" });
    const anonRows = await rpc(anonPage, "market_game_raters", { p_market_game_id: game.id });
    expect(anonRows).toEqual([]);
  } finally {
    await anon.close();
  }
});
