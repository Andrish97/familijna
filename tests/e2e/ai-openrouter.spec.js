// E30 (decyzja 32): logowanie przez OpenRouter — wszystko po stronie Familijnej
// (prawdziwe konto testowe i sejf), OpenRouter jako atrapa: powrót z kodem PKCE,
// wymiana na klucz, zapis w sejfie z darmowym modelem z narzędziami.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";
const PASSWORD = "Haslo-do-kluczy-e2e-1";
const VERIFIER = "e2e-verifier-0123456789abcdefghijklmnopqrstuv";

test("OpenRouter: powrót z kodem → klucz w sejfie z darmowym modelem", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await serveBranchCode(context, { pages: ["account"] });
  const exchanged = [];
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST" };
  await context.route("https://openrouter.ai/api/v1/auth/keys", (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    exchanged.push(route.request().postDataJSON());
    return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ key: "sk-or-v1-e2e-test-0000" }) });
  });
  await context.route("https://openrouter.ai/api/v1/models**", (route) => route.fulfill({
    status: 200, contentType: "application/json", headers: cors,
    body: JSON.stringify({ data: [
      { id: "paid/model", supported_parameters: ["tools"], pricing: { prompt: "0.1", completion: "0.1" } },
      { id: "google/gemini-e2e-flash:free", supported_parameters: ["tools"], pricing: { prompt: "0", completion: "0" } },
    ] }),
  }));

  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/account/#ai`, { waitUntil: "domcontentloaded" });
  const section = page.locator("#ai");
  await expect(section).toBeVisible({ timeout: 20000 });
  await page.evaluate(async () => { await window.__sbClient.rpc("ai_vault_delete"); });
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    const pass = section.locator("input[type=password]");
    await expect(pass).toHaveCount(2, { timeout: 20000 });
    await pass.nth(0).fill(PASSWORD);
    await pass.nth(1).fill(PASSWORD);
    await section.locator(".btn.gold").click();
    await expect(section.locator(".account-ai-add-open")).toBeVisible({ timeout: 20000 });

    // jak po powrocie ze strony OpenRouter (weryfikator zapisany przed przejściem)
    await page.evaluate((v) => sessionStorage.setItem("familijna:openrouter-pkce", JSON.stringify({ verifier: v, label: "OR e2e", at: Date.now() })), VERIFIER);
    await page.goto(`${ORIGIN}/account/?openrouter=1&code=e2e-code-123`, { waitUntil: "domcontentloaded" });
    const row = section.locator(".account-ai-key", { hasText: "••••0000" });
    await expect(row).toBeVisible({ timeout: 20000 });
    await expect(row).toContainText("OpenRouter");
    await expect(row).toContainText("gemini-e2e-flash:free");
    expect(exchanged).toEqual([{ code: "e2e-code-123", code_verifier: VERIFIER, code_challenge_method: "S256" }]);
    expect(new URL(page.url()).searchParams.has("code"), "kod usunięty z adresu").toBe(false);
    // klucz nie trafia do bazy jawnie, źródło czatu: własny klucz
    const stored = await page.evaluate(async () => JSON.stringify((await window.__sbClient.rpc("ai_vault_get")).data));
    expect(stored).not.toContain("sk-or-v1-e2e");
    expect(await page.evaluate(() => localStorage.getItem("familijna:ai-source"))).toBe("own");
  } finally {
    await page.evaluate(async () => { await window.__sbClient.rpc("ai_vault_delete"); }).catch(() => {});
  }
});
