// Import motywów: wgrane motywy w Ustawieniach gry i na Wyświetlaczu.
// Plik motywu z publicznego bucketu podaje trasa db.http (jak prawdziwy adres).
const { IDS } = require("../data/demo.cjs");
const sample = require("../data/theme-sample.json");

const THEME_ID = "6d1f2c3a-4b5e-4f60-8a7b-9c0d1e2f3a4b";
const KEY = `custom:${THEME_ID}`;
const http = { [`/storage/v1/object/public/user-themes/${THEME_ID}.json`]: sample };
const SOURCES = ["web/shared/js/display/", "web/games/settings/", "web/shared/css/game-settings.css", "scripts/screens/data/theme-sample.json"];
const myThemes = (canImport) => ({
  can_import: canImport, limit: 20,
  themes: [
    { id: THEME_ID, name: sample.name, background: sample.background, uses_background: false, created_at: "2026-10-28T10:00:00Z" },
    { id: "0f8fad5b-d9cb-469f-a165-70867728950e", name: "Studio jesień", background: "#352719", uses_background: true, background_label: { pl: "Obręcz", en: "Rim", uk: "Обідок" }, created_at: "2026-10-28T11:00:00Z" },
  ],
});
const openDisplay = async (view) => {
  const toggle = view.locator("#gsSidebarToggle");
  if (await toggle.isVisible()) { await toggle.click(); await view.waitForTimeout(300); }
  await view.locator('.gs-sidebar-item[data-cat="display"]').first().click();
  await view.waitForTimeout(2500);
};

module.exports = [
  {
    id: "settings-theme-import", category: "play", title: "Ustawienia gry — wgrane motywy (konto z importem)",
    path: `/games/settings/?id=${IDS.game}`, devices: ["desktop-1400", "phone"], sources: SOURCES, ready: "#gsContentInner",
    db: (db) => {
      db.rpc.my_display_themes = myThemes(true);
      db.http = { ...(db.http || {}), ...http };
      const game = db.tables.games.find((g) => g.id === IDS.game);
      game.settings.display = { ...game.settings.display, theme: KEY };
    },
    steps: [openDisplay],
  },
  {
    id: "settings-theme-import-list", category: "play", title: "Ustawienia gry — lista motywów z wgranymi",
    path: `/games/settings/?id=${IDS.game}`, devices: ["desktop-1400"], sources: SOURCES, ready: "#gsContentInner",
    db: (db) => { db.rpc.my_display_themes = myThemes(true); db.http = { ...(db.http || {}), ...http }; },
    steps: [openDisplay, async (view, { page }) => { await view.locator("#gsThemeSelect .ui-select-btn").click(); await page.mouse.move(5, 5); }],
  },
  {
    id: "settings-theme-import-third", category: "play", title: "Ustawienia gry — wgrany motyw z własną nazwą trzeciego koloru",
    path: `/games/settings/?id=${IDS.game}`, devices: ["desktop-1400"], sources: SOURCES, ready: "#gsContentInner",
    db: (db) => {
      db.rpc.my_display_themes = myThemes(true);
      db.http = { ...(db.http || {}), ...http };
      const game = db.tables.games.find((g) => g.id === IDS.game);
      game.settings.display = { ...game.settings.display, theme: "custom:0f8fad5b-d9cb-469f-a165-70867728950e" };
    },
    steps: [openDisplay],
  },
  {
    id: "settings-theme-import-revoked", category: "play", title: "Ustawienia gry — dostęp odebrany, wgrane motywy zostają",
    path: `/games/settings/?id=${IDS.game}`, devices: ["desktop-1400"], sources: SOURCES, ready: "#gsContentInner",
    db: (db) => { db.rpc.my_display_themes = myThemes(false); db.http = { ...(db.http || {}), ...http }; },
    steps: [openDisplay],
  },
  {
    id: "display-theme-custom", category: "play", title: "Wyświetlacz — motyw wgrany",
    path: "/control/display/?preview=1", frame: true, devices: ["desktop-1400"], sources: SOURCES,
    db: (db) => { db.http = { ...(db.http || {}), ...http }; },
    ready: () => document.readyState === "complete",
    steps: [async (view, { lang, page }) => {
      const { buildGameState } = await import("../data/game-state.mjs");
      const row = buildGameState(lang, "round");
      row.detail.display.theme = KEY;
      await view.waitForTimeout(1200);
      await page.evaluate((row) => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row }, location.origin), row);
      await view.waitForSelector(`#baseSvg[data-display-theme="${KEY}"]`);
      await view.waitForSelector("#gameScreen:not(.hidden)");
      await view.waitForTimeout(800);
    }],
  },
  {
    id: "host-theme-custom", category: "play", title: "Prowadzący — motyw wgrany (ramki z pliku)",
    path: "/control/host/?preview=1", frame: true, devices: ["desktop-1400", "phone"], sources: [...SOURCES, "web/control/host/"],
    db: (db) => { db.http = { ...(db.http || {}), ...http }; },
    ready: () => document.readyState === "complete",
    steps: [async (view, { lang, page }) => {
      const { buildGameState } = await import("../data/game-state.mjs");
      const row = buildGameState(lang, "round");
      row.detail.display.theme = KEY;
      await view.waitForSelector("html[data-preview]");
      await page.evaluate((row) => document.getElementById("screensFrame").contentWindow.postMessage({ type: "familijna:preview-row", row }, location.origin), row);
      await view.waitForSelector(`html[data-host-theme="${KEY}"]`);
      await view.evaluate(() => document.fonts.ready);
      await view.waitForTimeout(500);
    }],
  },
];
