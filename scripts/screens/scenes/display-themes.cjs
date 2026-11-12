const { IDS } = require("../data/demo.cjs");
const themes = ["classic", "modern", "wings", "radar", "cabinet", "ribbon", "bridge"];
// Domyślne tło z pliku motywu (web/shared/themes/<klucz>.json).
const themeBackground = (theme) => (require(`../../../web/shared/themes/${theme}.json`).inputs.T || {}).default;

module.exports = themes.flatMap((theme) => [
  {
    id: `display-theme-${theme}`, category: "play", title: `Wyświetlacz — ${theme}`,
    path: "/control/display/?preview=1", frame: true, devices: ["desktop-1400"],
    sources: ["web/shared/js/display/", "web/shared/themes/"],
    ready: () => document.readyState === "complete",
    steps: [async (view, { lang, page }) => {
      const { buildGameState } = await import("../data/game-state.mjs");
      const row = buildGameState(lang, "round");
      row.detail.display.theme = theme;
            row.detail.display.colors.BACKGROUND = themeBackground(theme) || row.detail.display.colors.BACKGROUND;
      await view.waitForTimeout(1200);
      await page.evaluate((row) => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row }, location.origin), row);
      await view.waitForSelector(`#baseSvg[data-display-theme="${theme}"]`);
      await view.waitForSelector("#gameScreen:not(.hidden)");
      await view.waitForTimeout(800);
    }],
  },
  {
    id: `settings-theme-${theme}`, category: "play", title: `Ustawienia motywu — ${theme}`,
    path: `/games/settings/?id=${IDS.game}`, devices: ["desktop-1400", "phone"],
    sources: ["web/shared/js/display/", "web/shared/themes/"],
    ready: "#gsContentInner",
    db: db => {
      const game = db.tables.games.find(g => g.id === IDS.game);
            const bg = themeBackground(theme);
      game.settings.display = { ...game.settings.display, theme, colors: { ...game.settings.display?.colors, ...(bg ? { BACKGROUND: bg } : {}) } };
    },
    steps: [async (view, { page }) => {
      const toggle = view.locator("#gsSidebarToggle");
      if (await toggle.isVisible()) await toggle.click();
      await view.locator('.gs-sidebar-item[data-cat="display"]').click();
      await view.locator("#gsThemeSelect .ui-select-btn").click();
      await page.mouse.move(5, 5);
    }],
  },
  ...(theme === "modern" ? [] : [false, true].map(covered => ({
    id: `host-theme-${theme}${covered ? "-covered" : ""}`, category: "play",
    title: `Prowadzący — ${theme}${covered ? " — zasłona" : ""}`,
    path: "/control/host/?preview=1", frame: true,
    devices: covered ? ["desktop-1400", "phone", "phone-landscape"] : ["desktop-1400", "phone", "tablet-landscape", "phone-landscape"],
    sources: ["web/control/host/", "web/shared/themes/"],
    ready: () => document.readyState === "complete",
    steps: [async (view, { lang, page }) => {
      const { buildGameState } = await import("../data/game-state.mjs");
      const row = buildGameState(lang, "round");
            row.detail.display.theme = theme;
      row.detail.display.colors.BACKGROUND = themeBackground(theme);
      row.detail.host.covered = covered;
      if (covered) { row.phase = "DUEL"; row.step = "r_duel"; }
      await view.waitForSelector("html[data-preview]");
      await page.evaluate(row => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row }, location.origin), row);
      await view.waitForSelector(`html[data-host-theme="${theme}"]`);
      await view.waitForSelector(`#cover2.${covered ? "coverOn" : "coverOff"}`);
      await view.evaluate(() => document.fonts.ready);
      await view.waitForTimeout(500);
    }],
  }))),
]);
