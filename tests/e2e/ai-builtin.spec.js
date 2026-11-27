// Asystent Familijnej (E30, decyzje 25–30): prawdziwy Gemini 2.5 Flash-Lite
// przez funkcję Edge ai-chat, na koncie testowym. Działa, gdy w panelu admina
// asystent ma dostępność „tylko konta testowe” (albo „wszyscy”) — inaczej spec
// się pomija. Sprawdza: odpowiedź modelu z narzędziem (list_games → liczba gier
// z bazy), licznik dzienny w oknie czatu, podpowiedź własnego klucza, historię.
// Koszt: kilka zapytań Flash-Lite na przebieg.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games", "account"] });
  context.on("response", async (res) => {
    if (!res.url().includes("/functions/v1/ai-chat")) return;
    console.log(`[e2e-diag] ai-chat ${res.status()} remaining=${res.headers()["x-ai-remaining"] ?? "-"}`);
    if (!res.ok()) console.log(`[e2e-diag] ai-chat body ${(await res.text().catch(() => "")).slice(0, 300)}`);
  });
});

test("asystent Familijnej: odpowiedź z narzędziem, licznik, podpowiedź własnego klucza", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(180_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const status = await page.evaluate(async () => (await window.__sbClient.rpc("ai_quota_status")).data);
  test.skip(!status?.enabled, `asystent Familijnej niedostępny dla kont testowych (${JSON.stringify(status)})`);
  await page.evaluate(() => { try { localStorage.setItem("familijna:ai-source", "builtin"); sessionStorage.removeItem("familijna:ai-panel"); } catch { /* bez pamięci */ } });
  await page.reload({ waitUntil: "domcontentloaded" });

  const own = await page.evaluate(async () => (await window.__sbClient.from("games").select("id").neq("type", "market")).data.length);
  await page.locator("#btnAiChat").click();
  const chat = page.locator("#aiChatOverlay");
  await expect(chat).toBeVisible();
  await expect(chat.locator(".ai-quota")).toContainText(String(status.daily), { timeout: 15000 });
  await expect(chat.locator(".ai-quota-own")).toBeVisible();
  const before = status.remaining;

  await chat.locator(".ai-input").fill("Ile mam gier? Sprawdź narzędziem i podaj samą liczbę.");
  await page.locator("#aiChatOverlay .ai-form button[type=submit]").click();
  await expect(chat.locator(".ai-msg--tool").first()).toContainText("Lista gier", { timeout: 60000 });
  await expect(chat.locator(".ai-msg--assistant").last()).toContainText(String(own), { timeout: 60000 });
  await expect(chat.locator(".ai-quota")).toContainText(`${before - 1} z ${status.daily}`, { timeout: 15000 });

  // historia na koncie: rozmowa zapisana z dostawcą „familijna”
  const chats = await page.evaluate(async () => (await window.__sbClient.rpc("ai_chat_list", { p_limit: 5 })).data?.chats || []);
  expect(chats[0]?.provider).toBe("familijna");
  await page.evaluate(async (id) => window.__sbClient.rpc("ai_chat_delete", { p_id: id }), chats[0].id);
});
