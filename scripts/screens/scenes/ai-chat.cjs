// Czat AI (E30, web/shared/js/ai/panel.js): przycisk w górnym pasku i panel.
// Bez klucza panel pokazuje informację i przycisk „Dodaj klucz” (decyzja 10).
const SOURCES = ["web/shared/js/ai/", "web/shared/js/core/page-init.js", "web/shared/style/components.css", "web/assets/icons/communication/"];

const openPanel = async (view) => {
  await view.locator("#btnAiChat").click();
  await view.locator("#aiPanel.is-open").waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(400);
};

module.exports = [
  { id: "ai-chat-no-key", category: "Czat AI", title: "Czat AI — bez klucza", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"], steps: [openPanel] },
];
