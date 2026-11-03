// Jasny motyw (decyzja 2026-11-03, familijna-server/docs/jasny-motyw-plan.md):
// Auto wg systemu, wybór Auto / Jasny / Ciemny w menu języka zapamiętany
// w przeglądarce (osobny przycisk motywu obok flagi), ekrany gry (wąż) zawsze ciemne. Bez kont.
const { test, expect } = require("./helpers/production-test");
const { serveBranchCode } = require("./helpers/branch-code");

const ORIGIN = "https://www.familijna.app";

test.use({ serviceWorkers: "block", colorScheme: "light" });

test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["privacy", "404", "snake"] });
});

const bg = (page) => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

test("Auto idzie za systemem; wybór z przycisku motywu zostaje po przeładowaniu", async ({ page }) => {
  await page.goto(`${ORIGIN}/privacy?lang=pl`, { waitUntil: "domcontentloaded" });
  const html = page.locator("html");
  await expect(html).not.toHaveClass(/page-loading/);
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await bg(page)).toBe("rgb(243, 240, 232)");

  await page.locator(".theme-btn").click();
  const menu = page.locator(".theme-menu");
  await expect(menu.locator('.menu-item[data-theme="auto"]')).toHaveAttribute("aria-selected", "true");
  await menu.locator('.menu-item[data-theme="dark"]').click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  expect(await bg(page)).toBe("rgb(5, 9, 20)");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.locator(".theme-btn").click();
  await expect(menu.locator('.menu-item[data-theme="dark"]')).toHaveAttribute("aria-selected", "true");
  await menu.locator('.menu-item[data-theme="auto"]').click();
  await expect(html).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => localStorage.getItem("uiTheme"))).toBeNull();
});

test("404 (flat.css) jest jasny, wąż (ekran gry) zostaje ciemny", async ({ page }) => {
  await page.goto(`${ORIGIN}/nie-ma-takiej-strony-${Date.now()}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await bg(page)).toBe("rgb(243, 240, 232)");

  await page.goto(`${ORIGIN}/snake/?lang=pl`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('.theme-btn')).toHaveCount(0);
});
