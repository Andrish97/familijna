// tests/e2e/game-settings-actions.spec.js
// Podręcznik 16 (Ustawienia rozgrywki): czynności bez testu i warianty „źle /
// podejrzanie” -- nazwy drużyn (za długie, znaki spoza Wyświetlacza), finał
// i ekran końcowy (widoczność pól, domyślne „Tak” i „Kwota nagrody”), znacznik
// zapisu w ikonie Zapisz, przywracanie sekcji „Ustawienia gry”, ułamkowe
// mnożniki, wejście z adresu do gry niegotowej, „Gra w toku” → Wróć, za długi
// własny dźwięk. Strony z kodu brancha, baza produkcyjna; lokalnie
// scripts/agent-tools/local-e2e.

const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block", needs: { standard: 1 } });

const ORIGIN = "https://www.familijna.app";

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games/settings", "games"] });
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
});

/* ================= Pomocnicze ================= */

// Gra preparowana: `questions` pytań po 3 odpowiedzi (40/30/20) -- przy 10 gotowa.
async function seedGame(page, { name, questions = 10, type = "prepared", settings } = {}) {
  return await page.evaluate(async ({ name, questions, type, settings }) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    const row = { name, owner_id: u.user.id, type };
    if (settings) row.settings = settings;
    const { data: g, error } = await sb.from("games").insert(row).select("id").single();
    if (error) throw new Error("insert game: " + error.message);
    if (questions) {
      const { data: qs, error: qErr } = await sb.from("questions")
        .insert(Array.from({ length: questions }, (_, i) => ({ game_id: g.id, ord: i + 1, text: `Pytanie ${i + 1}` }))).select("id");
      if (qErr) throw new Error("insert questions: " + qErr.message);
      if (type !== "poll_text") {
        const { error: aErr } = await sb.from("answers")
          .insert(qs.flatMap((q) => [40, 30, 20].map((p, j) => ({ question_id: q.id, ord: j + 1, text: `Odp ${j + 1}`, fixed_points: type === "prepared" ? p : 0 }))));
        if (aErr) throw new Error("insert answers: " + aErr.message);
      }
    }
    return g.id;
  }, { name, questions, type, settings });
}

async function settingsOf(page, id) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("games").select("settings").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data.settings || {};
  }, id);
}

async function deleteGame(page, id) {
  await page.evaluate(async (id) => { await window.__sbClient.from("games").delete().eq("id", id); }, id);
}

async function bootstrap(page, context, loginAs, identity) {
  await loginAs(page, context, identity);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 30_000 });
}

async function openSettings(page, id) {
  await page.goto(`${ORIGIN}/games/settings?id=${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#gsSidebar")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 30_000 });
}

const switchTab = (page, cat) => page.locator(`.gs-sidebar-item[data-cat="${cat}"]`).click();

async function saveAndWait(page) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/rest/v1/rpc/game_settings_save") && r.request().method() === "POST", { timeout: 15_000 }),
    page.locator("#btnSaveAll").click(),
  ]);
  expect(res.ok(), `zapis (status ${res.status()})`).toBe(true);
  await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "saved", { timeout: 10_000 });
}

// Cisza PCM 16 bit, 8 kHz, mono, `seconds` sekund.
function wavBuffer(seconds) {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

/* ================= 16.2 — drużyny ================= */

test("drużyny: za długa nazwa ucięta z komunikatem, znaki spoza Wyświetlacza nieprzyjęte; zapis bez nich", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-TEAM-${Date.now()}` });
  try {
    await openSettings(page, id);
    const a = page.locator("#gsTeamA");
    await a.fill("W".repeat(60));
    await expect(page.locator("#gsTeamAMeasure")).toHaveText("Dłuższa nazwa nie zmieści się na Wyświetlaczu.");
    const clipped = await a.inputValue();
    expect(clipped.length, "nazwa ucięta do tego, co mieści Wyświetlacz").toBeLessThan(60);
    expect(clipped).toMatch(/^W+$/);

    const b = page.locator("#gsTeamB");
    await b.fill("Kot😀 Ala");
    await expect(page.locator("#gsTeamBMeasure")).toHaveText("Znaki 😀 są niedozwolone — Wyświetlacz ich nie ma.");
    await expect(b).not.toHaveValue(/😀/);
    const typedB = await b.inputValue();
    await saveAndWait(page);
    const saved = (await settingsOf(page, id)).teams;
    expect(saved).toEqual({ teamA: clipped, teamB: typedB });
    expect(saved.teamB).not.toContain("😀");
  } finally {
    await deleteGame(page, id);
  }
});

/* ================= 16.5 / 16.6 — finał i ekran końcowy ================= */

test("finał i ekran końcowy: domyślnie „Tak” i „Kwota nagrody”; bez finału znika cel, kwota i pola nagrody; „Logo” ukrywa pola nagrody", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-FINAL-${Date.now()}` });
  try {
    await openSettings(page, id);
    await switchTab(page, "questions");
    await expect(page.locator('input[name="gsHasFinal"][value="yes"]')).toBeChecked();
    await switchTab(page, "game");
    await expect(page.locator('input[name="gsEndMode"][value="money"]')).toBeChecked();
    await expect(page.locator("#gsFinalTargetField")).toBeVisible();
    await expect(page.locator("#gsPrizeSettingsRow")).toBeVisible();
    await expect(page.locator("#gsFinalMinPts")).toHaveValue("300");
    await expect(page.locator("#gsFinalTarget")).toHaveValue("200");
    await expect(page.locator("#gsMainPrize")).toHaveValue("25000");
    await expect(page.locator("#gsPrizeMultiplier")).toHaveValue("3");

    // „Logo” -> pola nagrody znikają
    await page.locator('label.choice:has(input[name="gsEndMode"][value="logo"])').click();
    await expect(page.locator("#gsPrizeSettingsRow")).toBeHidden();
    await page.locator('label.choice:has(input[name="gsEndMode"][value="money"])').click();
    await expect(page.locator("#gsPrizeSettingsRow")).toBeVisible();

    // bez finału: cel finału, opcja „Kwota nagrody” i pola nagrody ukryte; sekcja finału wyłączona
    await switchTab(page, "questions");
    await page.locator('label.toggle-item:has(input[name="gsHasFinal"][value="no"])').click();
    await expect(page.locator("#gsFinalModeField")).toBeHidden();
    await expect(page.locator('.gs-sidebar-item[data-cat="finale"]')).toHaveClass(/gs-sidebar-item-disabled/);
    await switchTab(page, "game");
    await expect(page.locator("#gsFinalTargetField")).toBeHidden();
    await expect(page.locator("#gsEndModeMoneyLabel")).toBeHidden();
    await expect(page.locator("#gsPrizeSettingsRow")).toBeHidden();
    await saveAndWait(page);
    expect((await settingsOf(page, id)).game.hasFinal).toBe(false);
  } finally {
    await deleteGame(page, id);
  }
});

/* ================= 16.6 / 16.7 — wartości, przywracanie, zapis ================= */

test("„Ustawienia gry”: ułamkowe i zerowe mnożniki odrzucone; przywracanie sekcji wraca do domyślnych; znacznik zapisu znika po kolejnej zmianie", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-GAME-${Date.now()}` });
  try {
    await openSettings(page, id);
    await switchTab(page, "game");
    const mult = page.locator("#gsMultipliers");
    for (const bad of ["1.5, 2", "0, 1", "1, -2"]) {
      await mult.fill(bad);
      await expect(page.locator("#gsMultipliersMsg"), bad).toHaveText("Wpisz liczby całkowite większe od zera, oddzielone przecinkami, np. 1, 1, 1, 2, 3.");
      await expect(mult).toHaveAttribute("aria-invalid", "true");
    }
    await page.locator("#gsPrizeMultiplier").fill("2.5");
    await expect(page.locator("#gsPrizeMultiplierMsg")).toHaveText("Wpisz liczbę całkowitą od 1 do 10.");
    await page.locator("#gsMainPrize").fill("0");
    await expect(page.locator("#gsMainPrizeMsg")).toHaveText("Wpisz liczbę całkowitą od 1 do 99999.");

    // przywrócenie sekcji: najpierw Anuluj (bez zmian), potem potwierdzenie
    await page.locator("#btnGameReset").click();
    await expect(page.locator(".uni-modal:visible")).toContainText("Przywrócić domyślne ustawienia tej sekcji?");
    await page.locator(".uni-modal:visible .uni-foot .btn:not(.gold)").click();
    await expect(mult).toHaveValue("1, -2");
    await page.locator("#btnGameReset").click();
    await page.locator(".uni-modal:visible .uni-foot .btn.gold").click();
    await expect(page.locator("#gsMultipliers")).toHaveValue("1, 1, 1, 2, 3");
    await expect(page.locator("#gsMultipliersMsg")).toBeEmpty();
    await expect(page.locator("#gsMainPrize")).toHaveValue("25000");
    await expect(page.locator("#gsPrizeMultiplier")).toHaveValue("3");
    await expect(page.locator("#gsMainPrizeMsg")).toBeEmpty();
    await expect(page.locator("#gsFooterMsg")).toHaveText("Niezapisane zmiany");

    // poprawna wartość, zapis: znacznik w ikonie Zapisz; kolejna zmiana go usuwa
    await page.locator("#gsMultipliers").fill("1, 2");
    await saveAndWait(page);
    await expect(page.locator("#btnSaveAll")).toHaveAttribute("data-icon-state", "saved");
    await expect(page.locator("#gsFooterMsg")).toBeHidden();
    expect((await settingsOf(page, id)).game.advanced.roundMultipliers).toEqual([1, 2]);
    await page.locator("#gsFinalMinPts").fill("250");
    await expect(page.locator("#btnSaveAll")).toHaveAttribute("data-icon-state", "dirty");
    await expect(page.locator("#gsFooterMsg")).toHaveText("Niezapisane zmiany");
  } finally {
    await deleteGame(page, id);
  }
});

/* ================= 16.1 — wejście i blokady ================= */

test("wejście z adresu do ustawień gry niegotowej albo z nieskończoną ankietą: blokada z powodem, powrót do Moich gier", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const stamp = Date.now();
  const notReady = await seedGame(page, { name: `E2E-GSA-NR-${stamp}`, questions: 4 });
  const poll = await seedGame(page, { name: `E2E-GSA-POLL-${stamp}`, type: "poll_points" });
  try {
    for (const [id, reason] of [[notReady, "Gra musi mieć co najmniej 10 pytań (masz: 4)."], [poll, "Gra będzie dostępna dopiero po zamknięciu ankiety."]]) {
      await page.goto(`${ORIGIN}/games/settings?id=${id}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("#resourceLockGuard")).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("#resourceLockGuardMsg")).toHaveText(reason);
      await expect(page.locator("#gsTeamA")).toHaveCount(0);
    }
    await page.locator("#resourceLockGuardBack").click();
    await page.waitForURL(/\/games\/?(?:\?[^/]*)?$/, { timeout: 15_000 });
    await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 30_000 });
    expect(await settingsOf(page, notReady)).toEqual({});
  } finally {
    await deleteGame(page, notReady);
    await deleteGame(page, poll);
  }
});

test("„Gra w toku”: [Wróć] wraca do Moich gier i nie kończy rozgrywki", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-INGAME-${Date.now()}` });
  let cancelCalled = false;
  await page.route("**/rest/v1/rpc/control_game_settings_status", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, in_progress: true, expires_at: new Date(Date.now() + 45 * 60_000).toISOString() }),
  }));
  await page.route("**/rest/v1/rpc/control_game_cancel_for_settings", (route) => {
    cancelCalled = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cancelled: true }) });
  });
  try {
    // wejście jak użytkownik: Moje gry -> zaznaczenie -> [Ustawienia gry]
    await page.goto(`${ORIGIN}/games/?tab=prepared`, { waitUntil: "domcontentloaded" });
    const tile = page.locator("#grid .card", { has: page.locator(".name", { hasText: "E2E-GSA-INGAME-" }) });
    await tile.click();
    await expect(page.locator("#btnSettings")).toBeEnabled({ timeout: 15_000 });
    await page.locator("#btnSettings").click();
    await expect(page.locator("#ingameGuard")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("#ingameGuardTitle")).toHaveText("Gra w toku");
    await expect(page.locator("#ingameGuardCountdown")).toContainText("Blokada rozgrywki wygaśnie po");
    await page.getByRole("button", { name: "Wróć" }).click();
    await page.waitForURL(/\/games\/?(?:\?[^/]*)?$/, { timeout: 15_000 });
    expect(cancelCalled, "Wróć nie kończy rozgrywki").toBe(false);
    await page.unroute("**/rest/v1/rpc/control_game_settings_status");
    await page.waitForFunction(() => !!window.__sbClient, null, { timeout: 30_000 });
  } finally {
    await deleteGame(page, id);
  }
});

/* ================= 16.4 — dźwięk ================= */

test("dźwięk: własny plik dłuższy niż limit (2 s dla przycisku) odrzucony komunikatem, wariant się nie zmienia", async ({ page, context, accounts, loginAs }, testInfo) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-SFX-${Date.now()}` });
  try {
    await openSettings(page, id);
    await switchTab(page, "sound");
    const row = page.locator('.sfx-row[data-key="buzzer_press"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".sfx-row")).toHaveCount(10);
    await row.locator('input.sfx-file-input[data-sfx-key="buzzer_press"]').setInputFiles({ name: "dlugi.wav", mimeType: "audio/wav", buffer: wavBuffer(3) });
    await expect(page.locator(".uni-modal:visible")).toContainText("Maksymalna długość to 2s", { timeout: 10_000 });
    await page.locator(".uni-modal:visible .uni-foot .btn").first().click();
    await expect(row.locator(".sfx-file-tag")).toBeHidden();
    await expect(page.locator("#gsFooterMsg")).not.toHaveAttribute("data-state", "dirty");
    expect((await settingsOf(page, id)).sound?.variants?.buzzer_press).toBeUndefined();
  } finally {
    await deleteGame(page, id);
  }
});

test("dźwięk: plik, który nie jest dźwiękiem (tekst z rozszerzeniem .mp3), nie zostaje przyjęty jako własny dźwięk", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await bootstrap(page, context, loginAs, accounts.standard[0]);
  const id = await seedGame(page, { name: `E2E-GSA-SFXBAD-${Date.now()}` });
  try {
    await openSettings(page, id);
    await switchTab(page, "sound");
    const row = page.locator('.sfx-row[data-key="answer_correct"]');
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.locator('input.sfx-file-input[data-sfx-key="answer_correct"]').setInputFiles({ name: "nie-dzwiek.mp3", mimeType: "audio/mpeg", buffer: Buffer.from("<script>to nie jest dźwięk</script>") });
    await expect(page.locator(".uni-modal:visible")).toContainText("To nie jest plik dźwiękowy. Wybierz plik mp3, wav lub ogg.", { timeout: 10_000 });
    await page.locator(".uni-modal:visible .uni-foot .btn").first().click();
    await expect(row.locator(".sfx-file-tag")).toBeHidden();
    await expect(page.locator("#gsFooterMsg")).not.toHaveAttribute("data-state", "dirty");

    // prawdziwy, krótki dźwięk przechodzi jak dotąd
    await row.locator('input.sfx-file-input[data-sfx-key="answer_correct"]').setInputFiles({ name: "krotki.wav", mimeType: "audio/wav", buffer: wavBuffer(1) });
    await expect(row.locator(".sfx-file-tag")).toBeVisible({ timeout: 10_000 });
    await expect(row.locator(".sfx-file-tag")).toContainText("krotki.wav");
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "dirty");
  } finally {
    await deleteGame(page, id);
  }
});
