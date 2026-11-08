const fs = require("fs");
const path = require("path");
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
const { loginAsGuest } = require("./helpers/login");

const LOCAL = process.env.E2E_BYPASS_SECRET === "local";

test.use({ serviceWorkers: "block" });
test.use({ needs: { standard: 1 } });
test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games"] });
  // Serwuj moduły tej strony z checkouta, bo test celuje w kod z brancha.
  await context.route("**/games/js/*.js*", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/games\//, "");
    const file = path.resolve(__dirname, "../../web/games", pathname.replace(/^js\//, "js/"));
    await route.fulfill({
      status: 200,
      contentType: "text/javascript; charset=utf-8",
      body: fs.readFileSync(file),
    });
  });
  await context.route("**/rest/v1/app_ratings*", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    } else {
      await route.continue();
    }
  });
});

// Data rejestracji przesunięta o `days` dni wstecz (konta e2e i goście mają
// inną datę, a prośba o ocenę liczy dni od rejestracji). Strona bierze
// użytkownika z sesji zapisanej w przeglądarce (auth.js loadUser), więc
// zmieniamy ją tam i przeładowujemy; /auth/v1/user -- dla ścieżki „fresh”.
async function registeredDaysAgo(page, context, days) {
  const createdAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  await context.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch().catch(() => null);
    if (!response) return route.abort().catch(() => {});
    const user = await response.json().catch(() => null);
    if (!response.ok() || !user?.id) return route.fulfill({ response });
    user.created_at = createdAt;
    await route.fulfill({ response, json: user });
  });
  const changed = await page.evaluate((iso) => {
    let n = 0;
    for (const key of Object.keys(localStorage)) {
      if (!/^sb-.*-auth-token$/.test(key)) continue;
      const session = JSON.parse(localStorage.getItem(key) || "null");
      if (!session?.user) continue;
      session.user.created_at = iso;
      localStorage.setItem(key, JSON.stringify(session));
      n += 1;
    }
    return n;
  }, createdAt);
  expect(changed, "sesja Supabase w localStorage").toBeGreaterThan(0);
  await page.reload({ waitUntil: "domcontentloaded" });
}

test.describe("system ocen", () => {
  test("modal pojawia się zalogowanemu użytkownikowi bez oceny po 2 dniach", async ({ page, context, accounts, loginAs }) => {
    await loginAs(page, context, accounts.standard[0], { suppressRating: false });
    await registeredDaysAgo(page, context, 2.1);
    await expect(page.locator("#ratingOverlay .rating-modal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#ratingOverlay .star-btn")).toHaveCount(5);
  });

  test("modal nie pojawia się przed upływem 2 dni od rejestracji", async ({ page, context, accounts, loginAs }) => {
    // Bez oceny i bez „Później”: przed 2 dniami okno się nie pojawia.
    await loginAs(page, context, accounts.standard[0], { suppressRating: false });
    await registeredDaysAgo(page, context, 1.5);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await expect(page.locator("#ratingOverlay")).toHaveCount(0);
  });

  test("gość (tylko CI) też dostaje prośbę o ocenę po 2 dniach", async ({ page, context }) => {
    test.skip(LOCAL, "konto gościa zakłada Worker");
    test.setTimeout(120_000);
    await loginAsGuest(page, context, { suppressRating: false });
    // Okno informacji dla gościa helper oznacza jako widziane; po przeładowaniu
    // z datą rejestracji sprzed 2 dni zostaje sama prośba o ocenę.
    await registeredDaysAgo(page, context, 2.1);
    await expect(page.locator("#ratingOverlay .rating-modal")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#ratingOverlay .star-btn")).toHaveCount(5);
  });
});
