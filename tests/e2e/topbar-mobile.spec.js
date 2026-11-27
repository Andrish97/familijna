// Górny pasek na telefonie (decyzja 2026-11-26/27): w pasku czat, Wskazówki
// i ☰ — kwadratowe; wygląd i język w menu ☰ (rząd z podpisami); zmiana wyglądu
// z menu działa; na komputerze wygląd i język zostają w pasku.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function sizes(page, selectors) {
  return page.evaluate((list) => list.map((s) => {
    const e = document.querySelector(s);
    if (!e || !e.getClientRects().length) return null;
    const r = e.getBoundingClientRect();
    return [Math.round(r.width), Math.round(r.height)];
  }), selectors);
}

test("telefon: w pasku czat, Wskazówki i ☰ (kwadratowe); wygląd i język w menu", async ({ browser, accounts, loginAs }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ ...PHONE, serviceWorkers: "block" });
  const page = await context.newPage();
  await serveBranchCode(context, { pages: ["account", "games"] });
  await loginAs(page, context, accounts.standard[0]);

  for (const path of ["/account/", "/games/"]) {
    await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
    const toggle = page.locator(".topbar .topbar-menu-toggle");
    await expect(toggle).toBeVisible({ timeout: 20000 });
    await expect(page.locator(".topbar .theme-btn")).toHaveCount(0);
    await expect(page.locator(".topbar .lang-btn")).toHaveCount(0);
    const [manual, menu, chat] = await sizes(page, ["#btnManual", ".topbar-menu-toggle", "#btnAiChat"]);
    for (const s of [manual, menu, chat].filter(Boolean)) expect(s[0], `${path}: kwadrat ${s}`).toBe(s[1]);

    await toggle.click();
    const prefs = page.locator(".topbar-mobile-overlay.is-open .topbar-mobile-prefs");
    await expect(prefs.locator(".theme-btn")).toHaveAttribute("data-menu-label", /\S/);
    await expect(prefs.locator(".lang-btn")).toBeVisible();
    await toggle.click();
  }

  // zmiana wyglądu z menu ☰
  await page.locator(".topbar .topbar-menu-toggle").click();
  await page.locator(".topbar-mobile-prefs .theme-btn").click();
  await page.locator('.theme-menu:not([hidden]) .menu-item[data-theme="light"]').click();
  await expect.poll(() => page.evaluate(() => globalThis.FamilijnaTheme?.getChoice())).toBe("light");
  await page.evaluate(() => globalThis.FamilijnaTheme?.setChoice("auto"));
  await context.close();
});

test("komputer: wygląd i język w pasku, przyciski-ikony kwadratowe", async ({ page, context, accounts, loginAs }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await serveBranchCode(context, { pages: ["games"] });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".topbar .theme-btn")).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".topbar .lang-btn")).toBeVisible();
  for (const s of (await sizes(page, ["#btnManual", ".topbar .theme-btn", ".topbar .lang-btn", "#btnAiChat"])).filter(Boolean)) {
    expect(s[0], `kwadrat ${s}`).toBe(s[1]);
  }
});
