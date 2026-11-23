// Czat AI na kluczu użytkownika (E30): klucz w Ustawieniach konta (sejf
// szyfrowany w przeglądarce), rozmowa z narzędziem, historia na koncie,
// okno wraca otwarte po przejściu na inną stronę, potwierdzenie przed
// zmianą nieodwracalną. Dostawca to atrapa (Playwright przechwytuje
// api.anthropic.com) — bez prawdziwego klucza i bez kosztów.
// Kod strony z brancha (serveBranchCode), baza i Worker produkcyjne.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";
const PASSWORD = "e2e-haslo-do-kluczy";

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["account", "games"] });
});

// Odpowiedź strumieniem SSE w formacie Anthropic Messages.
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const toolUse = (name, input) => sse([
  { type: "message_start", message: { id: "m1", role: "assistant", content: [] } },
  { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: `tu_${name}`, name, input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "tool_use" } },
  { type: "message_stop" },
]);
const text = (value) => sse([
  { type: "message_start", message: { id: "m2", role: "assistant", content: [] } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: value } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
]);
// Ostatni wynik narzędzia z historii wysłanej do dostawcy.
const lastToolResult = (body) => {
  const last = body.messages.at(-1);
  const block = Array.isArray(last?.content) ? last.content.find((b) => b.type === "tool_result") : null;
  return block ? JSON.parse(block.content) : null;
};

/** Atrapa dostawcy: reply(body) → tekst SSE. Zwraca listę żądań. */
async function fakeAnthropic(context, reply) {
  const requests = [];
  await context.route("https://api.anthropic.com/v1/models**", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ data: [{ id: "claude-sonnet-5-5" }, { id: "claude-haiku-5-5" }] }),
  }));
  await context.route("https://api.anthropic.com/v1/messages", (route) => {
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST" } });
    }
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill({ status: 200, contentType: "text/event-stream", headers: { "access-control-allow-origin": "*" }, body: reply(body, requests.length) });
  });
  return requests;
}

async function cleanup(page) {
  await page.evaluate(async () => {
    const sb = window.__sbClient;
    const chats = (await sb.rpc("ai_chat_list", { p_limit: 200 })).data?.chats || [];
    for (const c of chats) await sb.rpc("ai_chat_delete", { p_id: c.id });
    await sb.rpc("ai_vault_delete");
    try { sessionStorage.removeItem("familijna:ai-panel"); } catch { /* bez pamięci */ }
  }).catch(() => {});
}

async function addKey(page) {
  await page.goto(`${ORIGIN}/account/#ai`, { waitUntil: "domcontentloaded" });
  const section = page.locator("#ai");
  await expect(section).toBeVisible({ timeout: 20000 });
  await cleanup(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  const pass = section.locator("input[type=password]");
  await expect(pass).toHaveCount(2, { timeout: 20000 });
  await pass.nth(0).fill(PASSWORD);
  await pass.nth(1).fill(PASSWORD);
  await section.locator(".btn.gold").click();
  const add = section.locator(".account-ai-add");
  await expect(add).toBeVisible({ timeout: 20000 });
  await add.locator("input[type=password]").fill("sk-ant-e2e-test-0000");
  await add.locator(".btn.gold").click();
  await expect(section.locator(".account-ai-key")).toContainText("••••0000", { timeout: 20000 });
}

async function openChat(page) {
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.locator("#btnAiChat").click();
  await expect(page.locator("#aiChatOverlay")).toBeVisible();
}

test("czat: klucz w sejfie, narzędzie, historia na koncie, okno wraca po przejściu na inną stronę", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  const requests = await fakeAnthropic(context, (body, n) => (n === 1
    ? toolUse("list_games", {})
    : text(`Masz gier: ${lastToolResult(body)?.games?.length ?? "?"}.`)));
  try {
    await addKey(page);
    // klucz nie trafia do bazy jawnie
    const stored = await page.evaluate(async () => JSON.stringify((await window.__sbClient.rpc("ai_vault_get")).data));
    expect(stored).not.toContain("sk-ant-e2e-test");

    await openChat(page);
    const own = await page.evaluate(async () => (await window.__sbClient.from("games").select("id").neq("type", "market")).data.length);
    await page.locator("#aiChatOverlay .ai-input").fill("Ile mam gier?");
    await page.keyboard.press("Enter");
    await expect(page.locator("#aiChatOverlay .ai-msg--assistant").last()).toHaveText(`Masz gier: ${own}.`, { timeout: 20000 });
    await expect(page.locator("#aiChatOverlay .ai-msg--tool")).toContainText("Lista gier");
    expect(requests[0].tools.some((x) => x.name === "list_games")).toBe(true);
    expect(requests[0].system).toContain("Polish");

    // historia na koncie
    await expect.poll(async () => page.evaluate(async () => (await window.__sbClient.rpc("ai_chat_list", { p_limit: 5 })).data?.chats?.length), { timeout: 10000 }).toBe(1);

    // inna strona: okno otwarte od razu, z tą samą rozmową
    await page.goto(`${ORIGIN}/account/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#aiChatOverlay")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#aiChatOverlay .ai-msg--user")).toHaveText("Ile mam gier?", { timeout: 20000 });
    await expect(page.locator("#aiChatOverlay .ai-msg--assistant").last()).toHaveText(`Masz gier: ${own}.`);
  } finally {
    await cleanup(page);
  }
});

test("czat: usunięcie gry wymaga potwierdzenia; odmowa nic nie usuwa", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  let gameId = null;
  const requests = await fakeAnthropic(context, (body, n) => (n === 1
    ? toolUse("delete_game", { game_id: gameId })
    : text(lastToolResult(body)?.error === "declined_by_user" ? "Nie usunąłem gry." : "Usunięto.")));
  try {
    await addKey(page);
    gameId = await page.evaluate(async () => (await window.__sbClient.rpc("game_create", { p_type: "prepared", p_name: `E2E-AI-${Date.now()}` })).data.id);
    await openChat(page);
    await page.locator("#aiChatOverlay .ai-input").fill("Usuń tę grę");
    await page.keyboard.press("Enter");
    const confirm = page.locator(".overlay:not([hidden]) .modal", { hasText: "Usunięcie gry" });
    await expect(confirm).toBeVisible({ timeout: 20000 });
    await confirm.getByRole("button", { name: "Nie" }).click();
    await expect(page.locator("#aiChatOverlay .ai-msg--assistant").last()).toHaveText("Nie usunąłem gry.", { timeout: 20000 });
    expect(requests).toHaveLength(2);
    const left = await page.evaluate(async (id) => (await window.__sbClient.from("games").select("id").eq("id", id)).data.length, gameId);
    expect(left).toBe(1);
  } finally {
    if (gameId) await page.evaluate(async (id) => window.__sbClient.rpc("delete_resource_checked", { p_resource_type: "game", p_resource_id: id, p_tab_id: null }), gameId).catch(() => {});
    await cleanup(page);
  }
});
