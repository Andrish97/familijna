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

// Data rejestracji w odpowiedzi /auth/v1/user przesunięta o `days` dni wstecz
// (konta e2e i goście są świeże, a prośba o ocenę liczy dni od rejestracji).
async function registeredDaysAgo(context, days) {
  await context.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const user = await response.json().catch(() => null);
    if (!response.ok() || !user?.id) return route.fulfill({ response });
    user.created_at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    await route.fulfill({ response, json: user });
  });
}

test.describe("system ocen", () => {
  test("modal pojawia się zalogowanemu użytkownikowi bez oceny po 2 dniach", async ({ page, context, accounts, loginAs }) => {
    await registeredDaysAgo(context, 2.1);
    await loginAs(page, context, accounts.standard[0], { suppressRating: false });
    await expect(page.locator("#ratingOverlay .rating-modal")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#ratingOverlay .star-btn")).toHaveCount(5);
  });

  test("modal nie pojawia się przed upływem 2 dni od rejestracji", async ({ page, context, accounts, loginAs }) => {
    await registeredDaysAgo(context, 1.5);
    await loginAs(page, context, accounts.standard[0], { suppressRating: false });
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
    await expect(page.locator("#ratingOverlay")).toHaveCount(0);
  });

  test("gość (tylko CI) też dostaje prośbę o ocenę po 2 dniach", async ({ page, context }) => {
    test.skip(LOCAL, "konto gościa zakłada Worker");
    test.setTimeout(120_000);
    await registeredDaysAgo(context, 2.1);
    await loginAsGuest(page, context, { suppressRating: false });
    // Pierwsza wizyta gościa: najpierw okno informacji dla gościa (helper
    // oznacza je jako widziane), więc prośbę o ocenę sprawdzamy po przeładowaniu.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#ratingOverlay .rating-modal")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#ratingOverlay .star-btn")).toHaveCount(5);
  });
});
