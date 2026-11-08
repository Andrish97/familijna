// Gry Społeczności (podręcznik 13.3–13.5): błędne i podejrzane działania.
// Zgłoszenie: na liście tylko gry gotowe do rozegrania, brak gry / tytułu /
// zgody zatrzymuje wysyłkę, limity długości w polu i na serwerze, zły język,
// niegotowa i cudza gra. Ocena: poza skalą, bez konta, gry nieopublikowanej
// (także własnej oczekującej). Strona z kodu brancha, baza produkcyjna.
// Działa także lokalnie (scripts/agent-tools/local-e2e) -- bez katalogu gier.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

const URL = "https://www.familijna.app/marketplace";
const PREFIX = "E2E-MKT-ACT-";

test.use({ serviceWorkers: "block", needs: { standard: 2 } });
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["marketplace"] });
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
});

async function rpc(page, name, args = {}) {
  return page.evaluate(async ({ name, args }) => {
    const { data, error } = await window.__sbClient.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }, { name, args });
}
const first = (data) => (Array.isArray(data) ? data[0] : data);
async function cleanup(page) {
  const result = await rpc(page, "e2e_marketplace_cleanup", { p_prefix: PREFIX });
  expect(result?.ok, JSON.stringify(result)).toBe(true);
}
// Gra preparowana: `count` pytań po 3 odpowiedzi z punktami (10 = gotowa do gry).
async function createGame(page, name, count) {
  return page.evaluate(async ({ name, count }) => {
    const sb = window.__sbClient;
    const { data: auth } = await sb.auth.getUser();
    const { data: game, error } = await sb.from("games").insert({
      owner_id: auth.user.id, name, type: "prepared", status: "draft", is_demo: false,
    }).select("id").single();
    if (error) throw new Error(error.message);
    const { data: qs, error: qError } = await sb.from("questions")
      .insert(Array.from({ length: count }, (_, i) => ({ game_id: game.id, ord: i + 1, text: `${name} pytanie ${i + 1}` })))
      .select("id,ord");
    if (qError) throw new Error(qError.message);
    const { error: aError } = await sb.from("answers").insert(qs.flatMap((q) => [30, 20, 10].map((points, i) => ({
      question_id: q.id, ord: i + 1, text: `Odp ${q.ord}-${i + 1}`, fixed_points: points,
    }))));
    if (aError) throw new Error(aError.message);
    return game.id;
  }, { name, count });
}
async function openSubmit(page) {
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.locator("#btnMySent").click();
  await page.locator("#btnSubmitNew").click();
  await expect(page.locator("#submitOverlay")).toBeVisible();
}

test("zgłoszenie: tylko gry gotowe na liście; bez gry, tytułu lub zgody nic nie wychodzi; pola mają limit", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const stamp = Date.now();
  const ready = `${PREFIX}READY-${stamp}`, unready = `${PREFIX}DRAFT-${stamp}`;
  try {
    await createGame(page, ready, 10);
    await createGame(page, unready, 3);
    let submits = 0;
    page.on("request", (r) => { if (r.url().endsWith("/rpc/market_submit_game")) submits++; });
    await openSubmit(page);
    await page.locator("#submitGameSelect .ui-select-btn").click();
    await expect(page.locator("#submitGameSelect .menu-item", { hasText: ready })).toHaveCount(1);
    await expect(page.locator("#submitGameSelect .menu-item", { hasText: unready })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("#submitOverlay")).toBeVisible();

    const error = page.locator("#submitError");
    await page.locator("#btnSubmitConfirm").click();
    await expect(error).toHaveText("Wybierz grę.");
    await page.locator("#submitGameSelect .ui-select-btn").click();
    await page.locator("#submitGameSelect .menu-item", { hasText: ready }).click();
    await page.locator("#submitTitle").fill("    ");
    await page.locator("#btnSubmitConfirm").click();
    await expect(error).toHaveText("Podaj tytuł.");
    await page.locator("#submitTitle").fill("T".repeat(130));
    await expect(page.locator("#submitTitle")).toHaveValue("T".repeat(120));
    await page.locator("#submitDesc").fill("D".repeat(520));
    await expect(page.locator("#submitDesc")).toHaveValue("D".repeat(500));
    await page.locator("#btnSubmitConfirm").click();
    await expect(error).toHaveText("Zaznacz potwierdzenie.");
    expect(submits).toBe(0);
    const rows = await page.evaluate(async (prefix) => (await window.__sbClient.from("market_games").select("id").like("title", `${prefix}%`)).data, PREFIX);
    expect(rows).toEqual([]);
  } finally { await cleanup(page); }
});

test("zgłoszenie z pominięciem okna: serwer odrzuca długie pola, zły język, niegotową i cudzą grę", async ({ page, context, browser, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const other = await browser.newContext({ serviceWorkers: "block" });
  const otherPage = await other.newPage();
  const stamp = Date.now();
  try {
    await loginAs(otherPage, other, accounts.standard[1]);
    await otherPage.goto(URL, { waitUntil: "domcontentloaded" });
    await cleanup(otherPage);
    const ready = await createGame(page, `${PREFIX}READY-${stamp}`, 10);
    const unready = await createGame(page, `${PREFIX}DRAFT-${stamp}`, 3);
    const foreign = await createGame(otherPage, `${PREFIX}FOREIGN-${stamp}`, 10);
    const submit = async (id, over = {}) => first(await rpc(page, "market_submit_game", {
      p_game_id: id, p_title: `${PREFIX}${stamp}`, p_description: "", p_lang: "pl", p_payload: {}, ...over,
    }));
    expect(await submit(ready, { p_title: "T".repeat(121) })).toMatchObject({ ok: false, err: "invalid_title" });
    expect(await submit(ready, { p_title: "   " })).toMatchObject({ ok: false, err: "invalid_title" });
    expect(await submit(ready, { p_description: "D".repeat(501) })).toMatchObject({ ok: false, err: "invalid_description" });
    expect(await submit(ready, { p_lang: "de" })).toMatchObject({ ok: false, err: "invalid_lang" });
    expect(await submit(unready)).toMatchObject({ ok: false, err: "game_not_playable" });
    expect(await submit(foreign)).toMatchObject({ ok: false, err: "game_not_found" });
    const rows = await page.evaluate(async (prefix) => (await window.__sbClient.from("market_games").select("id").like("title", `${prefix}%`)).data, PREFIX);
    expect(rows).toEqual([]);
    // granice dozwolone: 120 znaków tytułu i 500 opisu przechodzą
    expect(await submit(ready, { p_title: `${PREFIX}${"T".repeat(120 - PREFIX.length)}`, p_description: "D".repeat(500) })).toMatchObject({ ok: true });
  } finally {
    await cleanup(page);
    await cleanup(otherPage).catch(() => {});
    await other.close();
  }
});

test("ocena: poza skalą, bez konta i gry nieopublikowanej (własnej oczekującej) odrzucona", async ({ page, context, browser, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await cleanup(page);
  const anon = await browser.newContext({ serviceWorkers: "block" });
  try {
    const gameId = await createGame(page, `${PREFIX}RATE-${Date.now()}`, 10);
    const sent = first(await rpc(page, "market_submit_game", { p_game_id: gameId, p_title: `${PREFIX}RATE`, p_description: "", p_lang: "pl", p_payload: {} }));
    expect(sent, JSON.stringify(sent)).toMatchObject({ ok: true });
    const rate = async (p, id, stars) => first(await rpc(p, "market_rate_game", { p_market_game_id: id, p_stars: stars }));
    for (const stars of [0, 6, -1]) expect(await rate(page, sent.market_id, stars), String(stars)).toMatchObject({ ok: false, err: "invalid_stars" });
    expect(await rate(page, sent.market_id, 3)).toMatchObject({ ok: false, err: "game_not_found" });
    // podgląd własnego zgłoszenia nie ma gwiazdek
    await page.locator("#btnMySent").click();
    await page.locator(".mkt-sent-row", { hasText: `${PREFIX}RATE` }).locator("[data-preview]").click();
    await expect(page.locator("#gameDetailOverlay")).toBeVisible();
    await expect(page.locator(".mkt-star-input")).toHaveCount(0);

    if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(anon, { pages: ["marketplace"] });
    const anonPage = await anon.newPage();
    await anonPage.goto(URL, { waitUntil: "domcontentloaded" });
    expect(await rate(anonPage, sent.market_id, 3)).toMatchObject({ ok: false, err: "not_authenticated" });
    // opublikowana gra z katalogu (na produkcji): zła ocena nie zapisuje się
    const catalog = await rpc(page, "market_browse", { p_lang: "pl", p_search: "", p_limit: 5, p_offset: 0 });
    if (catalog?.length) {
      const published = catalog[0].id;
      expect(await rate(anonPage, published, 4)).toMatchObject({ ok: false, err: "not_authenticated" });
      expect(await rate(page, published, 9)).toMatchObject({ ok: false, err: "invalid_stars" });
      const stored = await page.evaluate(async (id) => (await window.__sbClient.from("market_game_ratings").select("stars").eq("market_game_id", id)).data, published);
      expect(stored).toEqual([]);
    }
    const ratings = await page.evaluate(async () => (await window.__sbClient.from("market_game_ratings").select("market_game_id")).data);
    expect(ratings).toEqual([]);
  } finally {
    await cleanup(page);
    await anon.close();
  }
});
