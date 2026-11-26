// Czat AI (E30, web/shared/js/ai/panel.js): przycisk w górnym pasku i panel.
// Bez klucza panel pokazuje informację i przycisk „Dodaj klucz” (decyzja 10).
const SOURCES = ["web/shared/js/ai/", "web/shared/js/core/page-init.js", "web/shared/style/components.css", "web/assets/icons/communication/"];

const openPanel = async (view) => {
  await view.locator("#btnAiChat").click();
  await view.locator("#aiChatOverlay:not([hidden])").waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(400);
};

const vaultDb = (db) => {
  db.rpc.ai_vault_get = { ok: true, vault: null };
  db.rpc.ai_vault_save = { ok: true };
  db.rpc.mcp_tokens_mine = { ok: true, tokens: [{ id: "53700000-0000-4000-8000-0000000000f1", client_name: "Claude", created_at: "2026-11-20T10:00:00Z", last_used_at: "2026-11-25T18:30:00Z", expires_at: "2027-02-18T10:00:00Z" }] };
};

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

// Zgoda na dostęp łącznika AI (decyzje 19–20): okno w Ustawieniach konta po
// przekierowaniu z Claude (/login/?next=account&ai=…).
module.exports.push(
  {
    id: "account-ai-consent", category: "Czat AI", title: "Konto — okno zgody łącznika AI (Claude chce dostępu)",
    path: "/account/?ai=53700000-0000-4000-8000-000000000001", sources: ACCOUNT_SOURCES,
    ready: ".overlay:not([hidden]) .modal", devices: ["desktop", "phone"],
    db: (db) => { vaultDb(db); db.rpc.mcp_authorize_info = { ok: true, client_name: "Claude", redirect_host: "claude.ai" }; },
  },
  {
    id: "account-ai-full", category: "Czat AI", title: "Konto — cała strona z Asystentem AI i łącznikiem", fullPage: true,
    path: "/account/", sources: ACCOUNT_SOURCES, ready: "#aiConnect:not([hidden]) .account-ai-key", devices: ["desktop", "phone"],
    db: (db) => { vaultDb(db); db.rpc.ai_vault_get = { ok: true, vault: null }; },
  },
);
