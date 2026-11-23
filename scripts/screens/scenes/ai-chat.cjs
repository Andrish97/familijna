// Czat AI (E30, web/shared/js/ai/panel.js): przycisk w górnym pasku i panel.
// Bez klucza panel pokazuje informację i przycisk „Dodaj klucz” (decyzja 10).
const SOURCES = ["web/shared/js/ai/", "web/shared/js/core/page-init.js", "web/shared/style/components.css", "web/assets/icons/communication/"];

const openPanel = async (view) => {
  await view.locator("#btnAiChat").click();
  await view.locator("#aiPanel.is-open").waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(400);
};

const vaultDb = (db) => { db.rpc.ai_vault_get = { ok: true, vault: null }; db.rpc.ai_vault_save = { ok: true }; };

module.exports = [
  { id: "ai-chat-no-key", category: "Czat AI", title: "Czat AI — bez klucza", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"], db: vaultDb, steps: [openPanel] },
];

// Ustawienia konta → Asystent AI (web/account/js/account-ai.js): bez sejfu
// (utworzenie) i po utworzeniu (pusta lista, dodawanie klucza).
const ACCOUNT_SOURCES = ["web/account/", "web/shared/js/ai/vault.js", "web/shared/js/ai/keys.js"];
const toSection = async (view) => {
  await view.locator("#ai .inp").first().waitFor({ state: "visible", timeout: 8000 });
  await view.locator("#ai").scrollIntoViewIfNeeded();
  await view.waitForTimeout(300);
};
module.exports.push(
  { id: "account-ai-create", category: "Czat AI", title: "Konto — Asystent AI, utworzenie sejfu kluczy", path: "/account/#ai", sources: ACCOUNT_SOURCES, ready: "#ai:not([hidden])", devices: ["desktop", "phone"], db: vaultDb, steps: [toSection] },
  { id: "account-ai-keys", category: "Czat AI", title: "Konto — Asystent AI, dodawanie klucza", path: "/account/#ai", sources: ACCOUNT_SOURCES, ready: "#ai:not([hidden])", devices: ["desktop", "phone"], db: vaultDb,
    steps: [toSection, async (view) => {
      const p = view.locator("#ai input[type=password]");
      await p.nth(0).fill("hasło-do-kluczy");
      await p.nth(1).fill("hasło-do-kluczy");
      await view.locator("#ai .btn.gold").click();
      await view.locator("#ai .account-ai-add").waitFor({ state: "visible", timeout: 15000 });
      await view.locator("#ai .account-ai-add").scrollIntoViewIfNeeded();
      await view.waitForTimeout(300);
    }] },
);
