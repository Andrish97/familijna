// Ocena asystenta Familijnej (E30): prawdziwy model z ai_limits.model na koncie
// testowym. Typowe polecenia → czy model sięgnął po właściwe narzędzie (podpis
// wywołania w oknie czatu) i czy odpowiedział. Model nie jest deterministyczny,
// więc wynik to procent trafień (próg PASS_RATE), zawsze wypisany w [e2e-diag].
// Tylko na żądanie (spec_filter). Koszt: ~8 wiadomości z dziennego limitu konta.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";
const PASS_RATE = 0.75;
// [polecenie, nazwy narzędzi, z których którykolwiek oznacza trafienie]
const CASES = [
  ["Ile mam gier? Podaj liczbę.", ["list_games"]],
  ["Jakie mam bazy pytań?", ["list_bases"]],
  ["Pokaż moje logo.", ["list_logos"]],
  ["Kogo mam w znajomych?", ["list_contacts"]],
  ["Jak podłączyć telewizor jako wyświetlacz?", ["search_manual", "manual_section", "manual_chapter", "manual_contents"]],
  ["Ile odpowiedzi może mieć pytanie w grze przygotowanej?", ["search_manual", "manual_section", "manual_chapter", "manual_contents"]],
  ["Gdzie zmienię dźwięki gry? Pokaż mi to miejsce.", ["show_on_page", "open_page", "list_page_places"]],
  ["Czy mam ankiety do wypełnienia od innych?", ["list_tasks"]],
];

// Wywołane narzędzia i ostatni tekst modelu z zapisanej rozmowy (format Gemini) —
// działa też, gdy asystent przeszedł na inną stronę (show_on_page).
const fromHistory = (history = []) => ({
  tools: history.flatMap((m) => (m.parts || []).map((p) => p.functionCall?.name).filter(Boolean)),
  answer: [...history].reverse().find((m) => m.role === "model" && (m.parts || []).some((p) => p.text))?.parts.map((p) => p.text || "").join("").trim() || "",
});

test("asystent Familijnej: ocena wyboru narzędzi (procent trafień)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(CASES.length * 70_000 + 60_000);
  await serveBranchCode(context, { pages: ["games"] });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
  const status = await page.evaluate(async () => (await window.__sbClient.rpc("ai_quota_status")).data);
  test.skip(!status?.enabled, `asystent Familijnej niedostępny (${JSON.stringify(status)})`);
  test.skip((status.remaining ?? 0) < CASES.length, `za mało wiadomości na dziś (${status.remaining})`);
  await page.evaluate(() => { try { localStorage.setItem("familijna:ai-source", "builtin"); sessionStorage.removeItem("familijna:ai-panel"); } catch { /* bez pamięci */ } });

  let hits = 0;
  const ids = [];
  for (const [prompt, expected] of CASES) {
    await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
    if (!(await page.locator("#btnAiChat").isVisible({ timeout: 15000 }).catch(() => false))) {
      await page.locator("#btnAiChat").waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
        console.log(`[e2e-diag] eval brak przycisku czatu: ${await page.evaluate(() => sessionStorage.getItem("familijna:ai-access"))}`);
      });
    }
    await page.locator("#btnAiChat").click();
    const chat = page.locator("#aiChatOverlay");
    await expect(chat).toBeVisible();
    const start = page.url();
    await chat.locator(".ai-input").fill(prompt);
    await page.keyboard.press("Enter");
    // koniec tury: odpowiedź w oknie albo przejście na wskazaną stronę
    await expect.poll(async () => page.url() !== start
      || (await chat.locator(".ai-msg--assistant").count() > 0 && await chat.locator(".ai-input").isEnabled().catch(() => false)),
    { timeout: 90000 }).toBe(true);
    const moved = page.url() !== start;
    await page.waitForTimeout(1500);
    await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 20000 });
    const saved = await page.evaluate(async () => {
      const list = (await window.__sbClient.rpc("ai_chat_list", { p_limit: 1 })).data?.chats || [];
      return list[0] ? (await window.__sbClient.rpc("ai_chat_get", { p_id: list[0].id })).data : null;
    });
    const { tools, answer } = fromHistory(saved?.history);
    const ok = tools.some((x) => expected.includes(x)) && (answer.length > 0 || moved);
    if (ok) hits += 1;
    console.log(`[e2e-diag] eval ${ok ? "OK " : "MISS"} „${prompt}” → narzędzia: ${tools.join(", ") || "brak"}; odpowiedź ${answer.length} zn.${moved ? ", przejście na stronę" : ""}`);
    if (saved?.id) ids.push(saved.id);
    await page.evaluate(() => { try { sessionStorage.removeItem("familijna:ai-panel"); sessionStorage.removeItem("familijna:ai-point"); } catch { /* bez pamięci */ } });
  }
  for (const id of new Set(ids)) await page.evaluate(async (x) => window.__sbClient.rpc("ai_chat_delete", { p_id: x }), id);
  const rate = hits / CASES.length;
  console.log(`[e2e-diag] eval wynik ${hits}/${CASES.length} (${Math.round(rate * 100)}%) model=${status.model || "?"}`);
  expect(rate, `trafienia ${hits}/${CASES.length}`).toBeGreaterThanOrEqual(PASS_RATE);
});
