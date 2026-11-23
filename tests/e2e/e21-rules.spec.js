// tests/e2e/e21-rules.spec.js
// E21 (familijna-server/docs/reguly-gier-transfer-plan.md): punktowe scenariusze nowych reguł
// na prawdziwej bazie -- edytor pytań (limit 17, znaki czcionki Wyświetlacza,
// podpowiedzi z finałem 11, pytanie ≤100), walidacja serwera, „Zmień typ”
// tego samego rekordu, próg 4 pkt gotowości preparowanej oraz blokada
// edycji przy aktywnej rozgrywce Control. Strony z plików brancha
// (serveBranchCode), baza i konta produkcyjne.

const { test, expect } = require("./helpers/e2e-test");
const { importClosedPoll } = require("./helpers/game-seed");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block" });
test.use({ needs: { standard: 1 } });
test.describe.configure({ retries: 0 });
test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE === "1") {
    await serveBranchCode(context, { pages: ["games", "games/editor"] });
  }
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
});

const ORIGIN = "https://www.familijna.app";

async function seedGame(page, { type = "prepared", name, questions = 1, answers = [40, 30, 20] } = {}) {
  return await page.evaluate(async ({ type, name, questions, answers }) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    const { data: g, error } = await sb.from("games").insert({ name, owner_id: u.user.id, type }).select("id").single();
    if (error) throw new Error("insert game: " + error.message);
    const { data: qs, error: qErr } = await sb.from("questions")
      .insert(Array.from({ length: questions }, (_, i) => ({ game_id: g.id, ord: i + 1, text: `Pytanie ${i + 1}` }))).select("id,ord");
    if (qErr) throw new Error("insert questions: " + qErr.message);
    if (answers.length) {
      const { error: aErr } = await sb.from("answers").insert(qs.flatMap((q) => answers.map((p, i) => ({ question_id: q.id, ord: i + 1, text: `Odp ${i + 1}`, fixed_points: p }))));
      if (aErr) throw new Error("insert answers: " + aErr.message);
    }
    return { id: g.id, questionIds: qs.sort((a, b) => a.ord - b.ord).map((q) => q.id) };
  }, { type, name, questions, answers });
}

async function deleteGame(page, id) {
  await page.evaluate(async (id) => { await window.__sbClient.from("games").delete().eq("id", id); }, id);
}

async function answersOf(page, questionId) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("answers").select("ord,text,fixed_points").eq("question_id", id).order("ord");
    if (error) throw new Error(error.message);
    return data;
  }, questionId);
}

test("E21 edytor: emoji blokuje zapis odpowiedzi, limit 17 przy wklejaniu, pytanie ≤100, podpowiedzi z finałem 11, lista warunków", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(120_000);
  await loginAs(page, context, accounts.standard[0]);
  const game = await seedGame(page, { name: `E2E-E21-EDITOR-${Date.now()}` });
  try {
    await page.goto(`${ORIGIN}/games/editor?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    await page.locator("#qList .qcard:not(.addCard)").first().click();
    const first = page.locator("#aList .qf-row:not(.qf-add) .qf-text").first();
    await expect(first).toHaveValue("Odp 1", { timeout: 15000 });

    await expect(page.locator("#aList .qf-hints")).toContainText("W finale wyświetlacz mieści 11 znaków. Dłuższe odpowiedzi zostaną na nim skrócone.");
    await expect(page.locator("#aList .qf-hints")).toContainText("Maksymalnie 17 znaków.");

    // warunki gotowości na żywo: 1 pytanie z 3 odpowiedziami
    await expect(page.locator("#rulesList li.bad")).toContainText("Co najmniej 10 pytań (jest 1)");
    await expect(page.locator("#rulesList li.ok")).toHaveCount(3);
    const pts = page.locator("#aList .qf-row:not(.qf-add) .qf-pts").nth(2);
    await pts.fill("2");
    await expect(pts).toHaveClass(/qf-invalid/);
    await pts.blur();
    await expect(page.locator("#rulesList li.bad", { hasText: "Każda odpowiedź co najmniej 4 pkt" })).toContainText("pytania: 1", { timeout: 10000 });
    await pts.fill("20");
    await pts.blur();
    await expect(page.locator("#rulesList li.bad")).toHaveCount(1, { timeout: 10000 });

    // znak spoza czcionki: pole oznaczone, zapis wstrzymany
    await first.fill("kawa😀");
    await expect(first).toHaveClass(/qf-invalid/);
    await first.blur();
    await expect(page.locator(".app-toast").last()).toContainText("😀", { timeout: 10000 });
    await page.waitForTimeout(800);
    expect((await answersOf(page, game.questionIds[0]))[0].text).toBe("Odp 1");

    // wklejenie 20 znaków -> 17 (zapis dopuszcza 17, finał tylko skraca wyświetlanie)
    await first.fill("x".repeat(20));
    await expect(first).toHaveValue("x".repeat(17));
    await expect(first).not.toHaveClass(/qf-invalid/);
    await first.blur();
    await expect.poll(async () => (await answersOf(page, game.questionIds[0]))[0].text, { timeout: 10000 }).toBe("x".repeat(17));

    // polskie małe litery są poprawne (wielkie odpowiedniki w czcionce)
    await first.fill("żółć");
    await expect(first).not.toHaveClass(/qf-invalid/);

    // pytanie: limit 100 znaków także przy wklejaniu
    await page.locator("#qText").fill("p".repeat(120));
    await expect(page.locator("#qText")).toHaveValue("p".repeat(100));

    // serwer odrzuca ten sam zapis z pominięciem edytora
    const direct = await page.evaluate(async (qid) => {
      const { error } = await window.__sbClient.from("answers").insert({ question_id: qid, ord: 5, text: "x👍", fixed_points: 5 });
      return error?.message || "ok";
    }, game.questionIds[0]);
    expect(direct).toContain("content_invalid:answerChars");
  } finally {
    await deleteGame(page, game.id);
  }
});

test("E21 reguły: preparowana wymaga ≥4 pkt; aktywny Control blokuje edycję treści", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const game = await seedGame(page, { name: `E2E-E21-RULES-${Date.now()}`, questions: 10, answers: [40, 30, 3] });
  try {
    const res = await page.evaluate(async (id) => {
      const sb = window.__sbClient;
      const before = (await sb.rpc("game_validate", { p_game_id: id })).data;
      await sb.from("answers").update({ fixed_points: 4 }).eq("fixed_points", 3).in("question_id",
        ((await sb.from("questions").select("id").eq("game_id", id)).data || []).map((q) => q.id));
      const after = (await sb.rpc("game_validate", { p_game_id: id })).data;
      const touch = await sb.rpc("control_runtime_session_touch_v2", { p_game_id: id, p_session_id: null });
      const locked = (await sb.rpc("game_validate", { p_game_id: id })).data;
      const insert = await sb.from("questions").insert({ game_id: id, ord: 11, text: "Nowe" });
      return { before: before.play, after: after.play, touch: touch.error?.message || "ok", locked: locked.edit, insert: insert.error?.message || "ok" };
    }, game.id);
    expect(res.before).toMatchObject({ ok: false, code: "answerMinPoints" });
    expect(res.after).toMatchObject({ ok: true });
    expect(res.touch).toBe("ok");
    expect(res.locked).toMatchObject({ ok: false, code: "controlActive" });
    expect(res.insert).toContain("game_content_locked:control_active");
  } finally {
    await deleteGame(page, game.id);
  }
});

test("E21 Zmień typ: preparowana -> ankieta tekstowa na tym samym rekordzie (UI)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const name = `E2E-E21-TYPE-${Date.now()}`;
  const game = await seedGame(page, { name, questions: 2 });
  try {
    await page.goto(`${ORIGIN}/games/?tab=prepared`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    const tile = page.locator("#grid .card", { has: page.locator(".name", { hasText: name }) });
    await tile.click();
    await expect(page.locator("#btnChangeType")).toBeEnabled({ timeout: 15000 });
    await page.locator("#btnChangeType").click();
    await expect(page.locator(".change-type:not(#baseSelectWrap)")).toBeVisible();
    await expect(page.locator('.change-type input[value="prepared"]')).toBeDisabled();
    const option = page.locator(".change-type-option", { has: page.locator('input[value="poll_text"]') });
    await option.click();
    await expect(option.locator(".change-type-desc")).toContainText("Odpowiedzi i punkty usuniemy");
    await page.locator(".uni-foot .btn.gold:visible").click();

    await expect.poll(async () => page.evaluate(async (id) => {
      const { data } = await window.__sbClient.from("games").select("id,type,status").eq("id", id).single();
      return data && `${data.type}/${data.status}`;
    }, game.id), { timeout: 15000 }).toBe("poll_text/draft");
    expect(await answersOf(page, game.questionIds[0])).toEqual([]);
    await expect(page).toHaveURL(/tab=poll_text/);
  } finally {
    await deleteGame(page, game.id);
  }
});

// Decyzja 2026-10-21 (migracja 441): zamknięta ankieta — „Zmień typ” bez
// pytania o reset; pod wybranym typem „Zachowaj …” (domyślnie odznaczone).
test("Zmień typ: zamknięta ankieta -> preparowana z zachowanymi punktami, bez pytania o reset (UI)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const name = `E2E-E21-KEEP-${Date.now()}`;
  // zamknięta ankieta -- import .famgame (stanu nie ustawia się zapisem z przeglądarki, 514)
  const game = await importClosedPoll(page, { type: "poll_points", name, points: [40, 30, 20] });
  try {
    await page.goto(`${ORIGIN}/games/?tab=poll_points`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    const tile = page.locator("#grid .card", { has: page.locator(".name", { hasText: name }) });
    await tile.click();
    await expect(page.locator("#btnChangeType")).toBeEnabled({ timeout: 15000 });
    await page.locator("#btnChangeType").click();
    await expect(page.locator(".change-type:not(#baseSelectWrap)")).toBeVisible();
    await expect(page.locator(".uni-modal")).toContainText("Ankieta jest zamknięta");
    const option = page.locator(".change-type-option", { has: page.locator('input[value="prepared"]') });
    await option.locator('input[type="radio"]').check();
    const keep = option.locator(".change-type-keep input");
    await expect(keep).toBeVisible();
    // domyślnie odznaczone: wyniki ankiety znikają
    await expect(keep).not.toBeChecked();
    await expect(option.locator(".change-type-desc")).toContainText("Punkty usuniemy");
    await keep.check();
    await expect(option.locator(".change-type-desc")).toHaveText("Pytania, odpowiedzi i punkty z ankiety zostaną.");
    await page.locator(".uni-foot .btn.gold:visible").click();

    await expect.poll(async () => page.evaluate(async (id) => {
      const { data } = await window.__sbClient.from("games").select("type,status").eq("id", id).single();
      return data && `${data.type}/${data.status}`;
    }, game.id), { timeout: 15000 }).toBe("prepared/draft");
    expect((await answersOf(page, game.questionIds[0])).map((a) => a.fixed_points)).toEqual([40, 30, 20]);
    await expect(page.locator(".uni-modal")).toHaveCount(0);
  } finally {
    await deleteGame(page, game.id);
  }
});
