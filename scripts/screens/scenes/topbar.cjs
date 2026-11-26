// Górny pasek na telefonie (decyzja 2026-11-26): w pasku czat, Wskazówki i ☰;
// motyw i język w rzędzie na górze menu ☰ (web/shared/js/core/topbar-controller.js).
const SOURCES = ["web/shared/js/core/topbar-controller.js", "web/shared/style/components.css", "web/assets/icons/communication/"];
const quota = (db) => { db.rpc.ai_quota_status = { ok: true, visible: true, enabled: true, daily: 20, used: 3, remaining: 17, reset_at: "2026-11-27T00:00:00+01:00" }; };
const openMenu = async (view) => {
  await view.locator(".topbar-menu-toggle").click();
  await view.locator(".topbar-mobile-overlay.is-open").waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(500);
};
module.exports = [
  { id: "topbar-menu-games", category: "Pasek", title: "Telefon — menu ☰ z motywem i językiem (Moje gry)", path: "/games/", sources: SOURCES,
    ready: ".topbar-menu-toggle", devices: ["phone"], db: quota, steps: [openMenu] },
  { id: "topbar-menu-account", category: "Pasek", title: "Telefon — menu ☰ z samym motywem i językiem (Ustawienia konta)", path: "/account/", sources: SOURCES,
    ready: ".topbar-menu-toggle", devices: ["phone"], db: quota, steps: [openMenu] },
  { id: "topbar-menu-theme", category: "Pasek", title: "Telefon — wybór wyglądu z menu ☰", path: "/account/", sources: SOURCES,
    ready: ".topbar-menu-toggle", devices: ["phone"], db: quota,
    steps: [openMenu, async (view) => { await view.locator(".topbar-mobile-prefs .theme-btn").click(); await view.waitForTimeout(400); }] },
];
