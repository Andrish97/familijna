// Czat AI (E30, web/shared/js/ai/panel.js): przycisk w górnym pasku i panel.
// Bez klucza panel pokazuje informację i przycisk „Dodaj klucz” (decyzja 10).
const SOURCES = ["web/shared/js/ai/", "web/shared/js/core/page-init.js", "web/shared/style/components.css", "web/assets/icons/communication/"];

const openPanel = async (view) => {
  await view.locator("#btnAiChat").click();
  await view.locator("#aiChatOverlay:not([hidden])").waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(400);
};

const vaultDb = (db) => {
  db.rpc.ai_quota_status = { ok: true, visible: true, enabled: true, daily: 20, used: 3, remaining: 17, reset_at: "2026-11-27T00:00:00+01:00" };
  db.rpc.ai_vault_get = { ok: true, vault: null };
  db.rpc.ai_vault_save = { ok: true };
  db.rpc.mcp_tokens_mine = { ok: true, tokens: [{ id: "53700000-0000-4000-8000-0000000000f1", client_name: "Claude", created_at: "2026-11-20T10:00:00Z", last_used_at: "2026-11-25T18:30:00Z", expires_at: "2027-02-18T10:00:00Z" }] };
};

module.exports = [
  // asystent Familijnej wyłączony i brak własnego klucza — przycisk do ustawień
  { id: "ai-chat-no-key", category: "Czat AI", title: "Czat AI — bez klucza", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"],
    db: (db) => { vaultDb(db); db.rpc.ai_quota_status = { ok: true, visible: true, enabled: false }; }, steps: [openPanel] },
  // asystent Familijnej: licznik wiadomości na dziś
  { id: "ai-chat-builtin", category: "Czat AI", title: "Czat AI — asystent Familijnej z dziennym limitem", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"],
    db: vaultDb, steps: [openPanel] },
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
  { id: "account-ai-keys", category: "Czat AI", title: "Konto — Asystent AI, pusta lista kluczy", path: "/account/#ai", sources: ACCOUNT_SOURCES, ready: "#ai:not([hidden])", devices: ["desktop", "phone"], db: vaultDb,
    steps: [toSection, async (view) => {
      const p = view.locator("#ai input[type=password]");
      await p.nth(0).fill("hasło-do-kluczy");
      await p.nth(1).fill("hasło-do-kluczy");
      await view.locator("#ai .btn.gold").click();
      await view.locator("#ai .account-ai-add-open").waitFor({ state: "visible", timeout: 15000 });
      await view.locator("#ai").scrollIntoViewIfNeeded();
      await view.waitForTimeout(300);
    }] },
  { id: "account-ai-add", category: "Czat AI", title: "Konto — okno dodawania klucza (z instrukcją darmowego klucza)", path: "/account/#ai", sources: ACCOUNT_SOURCES, ready: "#ai:not([hidden])", devices: ["desktop", "phone"], db: vaultDb,
    steps: [toSection, async (view) => {
      const p = view.locator("#ai input[type=password]");
      await p.nth(0).fill("hasło-do-kluczy");
      await p.nth(1).fill("hasło-do-kluczy");
      await view.locator("#ai .btn.gold").click();
      await view.locator("#ai .account-ai-add-open").click();
      await view.locator(".uni-modal .account-ai-add").waitFor({ state: "visible", timeout: 15000 });
      await view.waitForTimeout(400);
    }] },
  { id: "account-ai-list", category: "Czat AI", title: "Konto — lista kluczy (dwa klucze, aktywny zaznaczony)", path: "/account/#ai", sources: ACCOUNT_SOURCES, ready: "#ai:not([hidden])", devices: ["desktop", "phone"], db: vaultDb,
    steps: [toSection, async (view) => {
      // lista modeli u dostawcy (sprawdzenie klucza) — atrapa, bez sieci
      await view.route("https://api.anthropic.com/v1/models**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ data: [{ id: "claude-sonnet-4-5" }] }) }));
      await view.route("https://generativelanguage.googleapis.com/**", (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ models: [{ name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }] }) }));
      const p = view.locator("#ai input[type=password]");
      await p.nth(0).fill("hasło-do-kluczy");
      await p.nth(1).fill("hasło-do-kluczy");
      await view.locator("#ai .btn.gold").click();
      const addKey = async (label, key, provider) => {
        await view.locator("#ai .account-ai-add-open").click();
        const m = view.locator(".uni-modal").filter({ has: view.locator(".account-ai-add") });
        if (provider) {
          await m.locator(".ui-select-btn").click();
          await view.locator(`.ui-select-menu [data-value="${provider}"]`).click();
        }
        await m.locator("input[type=text]").fill(label);
        await m.locator("input[type=password]").fill(key);
        await m.locator(".uni-foot .btn.gold").click();
        await m.waitFor({ state: "hidden", timeout: 15000 });
      };
      await addKey("Praca", "sk-ant-zrzut-4821");
      await addKey("Darmowy", "AIza-zrzut-7710", "gemini");
      await view.locator("#ai .account-ai-key").nth(1).waitFor({ state: "visible", timeout: 15000 });
      await view.waitForTimeout(800);
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

// Wskazanie miejsca na stronie (show_on_page, shared/js/ai/pointer.js): czat
// zaznacza grę i podświetla „Ustawienia” z dymkiem; Ustawienia gry — sekcja Dźwięk.
const { IDS } = require("../data/demo.cjs");
const point = (pageId, place, text, id) => async (view) => {
  await view.evaluate(async ([p, k, t, i]) => {
    const m = await import("/shared/js/ai/pointer.js");
    await m.pointHere(p, { place: k, text: t, id: i }, { onBack() {}, onNext() {} });
  }, [pageId, place, text, id || null]);
  await view.waitForTimeout(600);
};
module.exports.push(
  { id: "ai-point-games", category: "Czat AI", title: "Czat wskazuje: Ustawienia zaznaczonej gry", path: "/games/", sources: [...SOURCES, "web/games/"],
    ready: "#grid .card", devices: ["desktop", "phone"], db: vaultDb,
    steps: [point("games", "settings", "Tu otworzysz ustawienia tej gry — kolory, logo i dźwięki.", IDS.game)] },
  { id: "ai-point-sound", category: "Czat AI", title: "Czat wskazuje: sekcja Dźwięk w Ustawieniach gry", path: `/games/settings/?id=${IDS.game}`, sources: [...SOURCES, "web/games/settings/"],
    ready: "#gsContentInner > *", devices: ["desktop", "phone"], db: vaultDb,
    steps: [point("gameSettings", "sound", "Własny dźwięk ustawisz tutaj: przy wybranym dźwięku wybierz własny plik.", IDS.game)] },
);

// Okno czatu: rozmowa z narzędziem (asystent Familijnej) i widok historii rozmów.
const CHAT_ID = "53500000-0000-4000-8000-00000000c001";
const historyDb = (db) => {
  vaultDb(db);
  db.rpc.ai_chat_list = { ok: true, chats: [
    { id: CHAT_ID, title: "Ile mam gier?", provider: "familijna", model: "gemini-3.5-flash-lite", updated_at: "2026-11-26T18:20:00Z" },
    { id: "53500000-0000-4000-8000-00000000c002", title: "Logo z sercem na wesele", provider: "familijna", model: "gemini-3.5-flash-lite", updated_at: "2026-11-25T20:05:00Z" },
    { id: "53500000-0000-4000-8000-00000000c003", title: "Jak podłączyć telewizor?", provider: "familijna", model: "gemini-3.5-flash-lite", updated_at: "2026-11-24T17:40:00Z" },
  ] };
  db.rpc.ai_chat_get = { ok: true, id: CHAT_ID, title: "Ile mam gier?", provider: "familijna", model: "gemini-3.5-flash-lite", history: [
    { role: "user", parts: [{ text: "Ile mam gier gotowych do gry?\n\n<ctx>language: Polish; page: games</ctx>" }] },
    { role: "model", parts: [{ functionCall: { name: "list_games", args: {} } }] },
    { role: "user", parts: [{ functionResponse: { name: "list_games", response: { games: [] } } }] },
    { role: "model", parts: [{ text: "Masz 8 gier, z czego 6 jest gotowych do gry: Rodzinny pojedynek, Pytania na rodzinny wieczór, Wakacyjna gra rodzinna, Wigilia firmowa 2026, Sylwester 2026 i Rodzinny wieczór gier. „Urodziny dziadka” potrzebuje jeszcze 4 pytań." }] },
  ] };
};
const withChat = async (view) => {
  await view.evaluate((id) => { sessionStorage.setItem("familijna:ai-panel", JSON.stringify({ open: true, chatId: id })); }, CHAT_ID);
  await view.reload();
  await view.locator("#aiChatOverlay:not([hidden]) .ai-msg--assistant").waitFor({ timeout: 8000 });
  await view.waitForTimeout(400);
};
module.exports.push(
  { id: "ai-chat-conversation", category: "Czat AI", title: "Czat AI — rozmowa z narzędziem", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"], db: historyDb, steps: [withChat] },
  { id: "ai-chat-history", category: "Czat AI", title: "Czat AI — historia rozmów", path: "/games/", sources: SOURCES, ready: "#btnAiChat", devices: ["desktop", "phone"], db: historyDb,
    steps: [withChat, async (view) => { await view.locator(".ai-btn-history").click(); await view.locator(".ai-chat-row").first().waitFor(); await view.waitForTimeout(300); }] },
);
