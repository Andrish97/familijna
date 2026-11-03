const { test, expect } = require("@playwright/test");
const { serveBranchCode } = require("./helpers/branch-code");
// Kod TV (JS/CSS) i HTML /connect/tv/ z brancha; inne strony z produkcji (Worker podaje stronę TV dla UA telewizora).
test.use({ serviceWorkers: "block" });
test.beforeEach(async ({ context }) => {
  if (process.env.GITHUB_REF_NAME !== "main" && process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["connect/tv"], productionHtml: true });
});
const ua = "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 TV Safari/537.36";
test.use({ locale: "pl-PL", userAgent: ua, viewport: { width: 1920, height: 1080 } });
test("TV: każda strona kieruje do samego kodu, bez logowania", async ({ page }, testInfo) => {
  // [e2e-diag]: błędy strony i stan DOM, gdy pole kodu się nie pojawia.
  page.on("pageerror", (e) => console.log(`[e2e-diag] pageerror ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") console.log(`[e2e-diag] console ${m.text()}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log(`[e2e-diag] nav ${new URL(f.url()).pathname}`); });
  for (const path of ["/", "/login/", "/games/", "/control/", "/control/", "/control/host/?id=x&key=y", "/control/buzzer/?id=x&key=y"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#tvCode")).toBeVisible().catch(async (e) => {
      const state = await page.evaluate(() => ({ path: location.pathname, theme: document.documentElement.dataset.theme,
        cls: document.documentElement.className, attrs: [...document.documentElement.attributes].map((a) => a.name).join(","),
        body: document.body?.className, ids: [...document.querySelectorAll("[id]")].slice(0, 25).map((n) => n.id).join(",") })).catch(() => null);
      console.log(`[e2e-diag] brak #tvCode dla ${path}: ${JSON.stringify(state)}`);
      throw e;
    });
    await expect(page.locator("#tvCode")).toBeFocused();
    await expect(page.locator("body")).toHaveCSS("background-image", "none");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(5, 9, 20)");
    await expect(page.locator("#tvCode")).toHaveCSS("outline-width", "0px");
    expect(new URL(page.url()).pathname).toBe("/connect/");
    await expect(page.locator("#tvConnectForm button")).toHaveCount(1);
    const brand = page.locator(".tv-topbar .brand");
    await expect(brand).toBeVisible();
    // Napis jest w HTML strony TV, który Worker podaje z produkcji (także w przebiegu z brancha):
    // treść sprawdza przebieg kontrolny na produkcji, kolor i położenie — każdy przebieg.
    const branchRun = process.env.GITHUB_REF_NAME !== "main" && process.env.TEST_BRANCH_CODE !== "0";
    if (!branchRun) await expect(brand).toHaveText("FAMILIJNA");
    await expect(brand).toHaveCSS("color", "rgb(255, 234, 166)");
    const topbar = await page.locator(".tv-topbar").boundingBox();
    expect(topbar.y).toBe(0);
    expect(topbar.width).toBe(1920);
    await expect(page.locator(".tv-logo")).toHaveCount(0);
    await expect(page.locator("#tvConnect")).toHaveClass(/btn gold/);
    await expect(page.locator("#tvConnect")).toHaveCSS("color", "rgb(255, 234, 166)");
    if (path === "/") await testInfo.attach("tv-connect-screen", { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("#tvConnect")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.locator("#tvCode")).toBeFocused();
  }
});


test("TV: język zmienia cały formularz i komunikaty, pilot obsługuje menu", async ({ page }) => {
  await page.goto("/connect/tv/", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#tvCode")).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".lang-btn")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('.menu-item[data-lang="pl"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.menu-item[data-lang="en"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("h1")).toHaveText("Connect display");
  await expect(page.locator("#tvConnect")).toHaveText("Connect");
  await page.locator("#tvCode").fill("12");
  await page.locator("#tvConnect").click();
  await expect(page.locator("#tvMessage")).toContainText("6-digit");
  await page.locator(".lang-btn").click();
  await page.locator('.menu-item[data-lang="uk"]').click();
  await expect(page.locator("h1")).toHaveText("Підключи дисплей");
  await expect(page.locator("#tvMessage")).toContainText("6-значний");
  await expect(page.locator("#tvCode")).toHaveValue("12");
  await page.reload();
  await expect(page.locator("h1")).toHaveText("Підключи дисплей");
});


test("TV: pierwszy wybór języka pochodzi z przeglądarki telewizora", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, locale: "en-US", userAgent: ua, viewport: { width: 1920, height: 1080 } });
  try {
    const page = await context.newPage();
    await page.goto("/connect/tv/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toHaveText("Connect display");
    await expect(page.locator("#tvConnect")).toHaveText("Connect");
  } finally { await context.close(); }
});

test("TV: wygląd idzie za ustawieniem telewizora, pilot zmienia go przyciskiem obok flagi", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/connect/tv/", { waitUntil: "domcontentloaded" });
  const html = page.locator("html");
  await expect(page.locator("#tvCode")).toBeFocused();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(243, 240, 232)");
  await page.keyboard.press("ArrowUp");
  await expect(page.locator(".lang-btn")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".theme-btn")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('.theme-menu .menu-item[data-theme="auto"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.theme-menu .menu-item[data-theme="dark"]')).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".theme-btn")).toBeFocused();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).toHaveAttribute("data-theme", "dark");
});
