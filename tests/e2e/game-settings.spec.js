// tests/e2e/game-settings.spec.js
// Weryfikuje js/pages/game-settings.js pod kątem tego samego wzorca
// "wielu miejsc naraz" co edytor gry (familijna-server/docs/plan-testy-i-poprawki.md):
// Warstwa 1 (blokada wejścia, resource-lock.js) i Warstwa 2 (bezpieczny
// zapis — CAS na całym `settings` blobie zamiast ślepego nadpisania, plus
// odświeżenie żywej listy pytań przed zapisem finału/rund).

const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
test.use({ serviceWorkers: "block" });
test.use({ needs: { standard: 1 } });
test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") {
    await serveBranchCode(context, { pages: ["games/settings", "games"] });
  }
});

// Blokada stanu "play" (guardGameState, reguła game_validate) blokuje całą
// stronę ustawień, dopóki gra nie ma >= 10 pytań, każde z 3-6 odpowiedziami
// o sumie <= 100. Dlatego createGame dopełnia grę pytaniami-wypełniaczami
// (ord 100+), chyba że test sam układa pytania (pad: false) i potem woła
// padQuestions().
async function createGame(page, { type = "prepared", name, settings, pad = true } = {}) {
  const id = await createGameRaw(page, { type, name, settings });
  if (pad) await padQuestions(page, id);
  return id;
}

async function padQuestions(page, gameId, total = 10) {
  await page.evaluate(async ({ gameId, total }) => {
    const sb = window.__sbClient;
    const { count, error: cErr } = await sb.from("questions").select("id", { count: "exact", head: true }).eq("game_id", gameId);
    if (cErr) throw new Error("count questions failed: " + cErr.message);
    for (let i = 0; (count || 0) + i < total; i++) {
      const { data: q, error } = await sb.from("questions")
        .insert({ game_id: gameId, ord: 100 + i, text: `Wypełniacz ${i + 1}` }).select("id").single();
      if (error) throw new Error("insert filler failed: " + error.message);
      const { error: aErr } = await sb.from("answers").insert([
        { question_id: q.id, ord: 1, text: "Odp. A", fixed_points: 40 },
        { question_id: q.id, ord: 2, text: "Odp. B", fixed_points: 30 },
        { question_id: q.id, ord: 3, text: "Odp. C", fixed_points: 20 },
      ]);
      if (aErr) throw new Error("insert filler answers failed: " + aErr.message);
    }
  }, { gameId, total });
}

async function createGameRaw(page, { type = "prepared", name, settings } = {}) {
  return await page.evaluate(async ({ type, name, settings }) => {
    const sb = window.__sbClient;
    const { data: userData } = await sb.auth.getUser();
    const payload = { name: name || `E2E-SETTINGS-${Date.now()}`, owner_id: userData.user.id, type };
    if (settings) payload.settings = settings;
    const { data: game, error } = await sb
      .from("games")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error("insert games failed: " + error.message);
    return game.id;
  }, { type, name, settings });
}

async function addQuestionApi(page, gameId, ord, text) {
  return await page.evaluate(async ({ gameId, ord, text }) => {
    const { data, error } = await window.__sbClient
      .from("questions")
      .insert({ game_id: gameId, ord, text })
      .select("id")
      .single();
    if (error) throw new Error("insert question failed: " + error.message);
    // reguła play: każde pytanie ma 3-6 odpowiedzi
    const { error: aErr } = await window.__sbClient.from("answers").insert([
      { question_id: data.id, ord: 1, text: "Odp. A", fixed_points: 40 },
      { question_id: data.id, ord: 2, text: "Odp. B", fixed_points: 30 },
      { question_id: data.id, ord: 3, text: "Odp. C", fixed_points: 20 },
    ]);
    if (aErr) throw new Error("insert answers failed: " + aErr.message);
    return data.id;
  }, { gameId, ord, text });
}

async function getGameRow(page, gameId) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("games").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  }, gameId);
}

async function deleteGame(page, gameId) {
  await page.evaluate(async (id) => {
    await window.__sbClient.from("games").delete().eq("id", id);
  }, gameId);
}

async function openSettings(page, gameId, extraQuery = "") {
  await page.goto(`https://www.familijna.app/games/settings?id=${gameId}${extraQuery}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function switchTab(page, cat) {
  await page.locator(`.gs-sidebar-item[data-cat="${cat}"]`).click();
}

// Czekamy na sam network response zapisu — Playwright nie może „przegapić”
// response, który przechwytuje na poziomie stosu sieciowego.
async function waitForGamesSave(page, action = async () => {}) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/rest/v1/games") && res.request().method() === "PATCH",
      { timeout: 10000 }
    ),
    action(),
  ]);
  expect(response.ok(), `zapis powinien się udać (status ${response.status()})`).toBe(true);
}

// Ustawienia zapisują się jawnie przyciskiem „Zapisz” (decyzja 2026-10-14).
async function saveAndWait(page) {
  await waitForGamesSave(page, () => page.locator("#btnSaveAll").click());
  await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "saved", { timeout: 10000 });
}

/* ================= A: Warstwa 1 — blokada wejścia ================= */
test("ustawienia gry: dwie karty — druga karta jest blokowana overlayem, wchodzi po zamknięciu pierwszej", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  await page.route("**/rest/v1/rpc/control_game_settings_status", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, in_progress: false }),
  }));
  try {
    const pageA = await context.newPage(); // trzyma blokadę, zostanie zamknięta żeby ją zwolnić
    const pageB = page; // fixture page — druga karta, też służy do końcowego sprzątania
    await pageA.route("**/rest/v1/rpc/control_game_settings_status", route => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, in_progress: false }),
    }));

    await openSettings(pageA, gameId);
    await openSettings(pageB, gameId);

    // Karta B: overlay blokady, treść ustawień (budowana dynamicznie przez
    // renderCat) w ogóle nie została wyrenderowana pod spodem.
    await expect(pageB.locator("#resourceLockGuard")).toBeVisible({ timeout: 10000 });
    await expect(pageB.locator("#gsTeamA")).toHaveCount(0);

    await pageA.close();

    await expect(pageB.locator("#resourceLockGuard")).toBeHidden({ timeout: 40000 });
    await expect(pageB.locator("#gsTeamA")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= B: Warstwa 2 — CAS przy zapisie ================= */
// saveAll() nadpisywało kiedyś CAŁY blob `settings` bez żadnej kontroli
// wersji — druga karta (albo bezpośrednie wywołanie z pominięciem UI)
// mogła zapisać w międzyczasie, a ten zapis i tak by ją nadpisał w
// całości. Teraz zapis jest warunkowy (CAS na całej kolumnie `settings`)
// i w razie konfliktu pokazuje jawny komunikat zamiast cichego nadpisania.
test("ustawienia gry: Warstwa 2 — zapis po zmianie ustawień z pominięciem UI kończy się jawnym konfliktem, nie cichym nadpisaniem", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);

    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 10000 });
    await page.locator("#gsTeamA").fill("Ekipa A");
    await saveAndWait(page);

    // Symulacja ominięcia UI: zapis ustawień bezpośrednio w bazie, z
    // pominięciem tej karty — ta sama karta dalej "myśli", że zna
    // aktualny stan settings sprzed tej zmiany.
    await page.evaluate(async (id) => {
      const { data } = await window.__sbClient.from("games").select("settings").eq("id", id).single();
      const next = { ...data.settings, teams: { ...data.settings.teams, teamA: "Zmienione gdzie indziej" } };
      const { error } = await window.__sbClient.from("games").update({ settings: next }).eq("id", id);
      if (error) throw new Error(error.message);
    }, gameId);

    await page.locator("#gsTeamB").fill("Ekipa B");

    // Zapis trafia w konflikt: stan w pasku akcji i komunikat w toaście, bez okna.
    await page.locator("#btnSaveAll").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "conflict", { timeout: 10000 });
    await expect(page.locator(".app-toast-text")).toHaveText(
      "Te ustawienia zostały w międzyczasie zmienione w innym miejscu. Odśwież stronę i wprowadź zmiany ponownie.",
      { timeout: 10000 }
    );

    const game = await getGameRow(page, gameId);
    expect(game.settings.teams.teamA, "zmiana zapisana bezpośrednio w bazie nie powinna zostać cicho nadpisana").toBe("Zmienione gdzie indziej");
    expect(game.settings.teams.teamB, "zapis karty w konflikcie nie powinien się wykonać wcale").not.toBe("Ekipa B");
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= C: Warstwa 2 — odświeżenie żywej listy pytań ================= */
// questions.final/rounds mogły trzymać martwe odniesienie do pytania
// usuniętego w międzyczasie gdzie indziej (np. w edytorze, inna karta).
// saveAll() teraz odświeża żywą listę pytań tuż przed zapisem i filtruje
// takie martwe id, zamiast zapisać do bazy wskazanie na coś, co już nie
// istnieje.
test("ustawienia gry: Warstwa 2 — zapis filtruje pytanie finału usunięte w międzyczasie zamiast zapisać martwe id", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, {
    settings: { game: { hasFinal: true, finalQuestionsMode: "random" } },
  });
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    const q2Id = await addQuestionApi(page, gameId, 2, "Q2");

    // Ustaw martwe odniesienie w settings.questions.final (symuluje stan
    // sprzed usunięcia Q2 — mode "random" żeby nie trafić w walidację
    // "pick wymaga 5 pytań", która sprawdza coś innego).
    await page.evaluate(async ({ id, qid, ord }) => {
      const { data } = await window.__sbClient.from("games").select("settings").eq("id", id).single();
      const next = { ...data.settings, questions: { ...data.settings.questions, final: [{ id: qid, ord, text: "Q2" }] } };
      const { error } = await window.__sbClient.from("games").update({ settings: next }).eq("id", id);
      if (error) throw new Error(error.message);
    }, { id: gameId, qid: q2Id, ord: 2 });

    // Usuń Q2 — symulacja edycji w innym miejscu, PO tym jak ustawienia
    // już wskazywały na nie jako finałowe.
    await page.evaluate(async (id) => {
      await window.__sbClient.from("questions").delete().eq("id", id);
    }, q2Id);

    await openSettings(page, gameId);
    // Samo otwarcie niczego nie zapisuje — zapis po drobnej zmianie przed
    // wysłaniem odświeża listę pytań i filtruje martwe id.
    await page.locator("#gsTeamA").fill("Ekipa");
    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    const finalIds = (game.settings.questions.final || []).map((q) => q.id);
    expect(finalIds, "usunięte pytanie nie powinno zostać zapisane jako wciąż wybrane do finału").not.toContain(q2Id);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= Rozszerzone pokrycie game-settings.js ================= */
// Reszta rzeczywistej logiki biznesowej modułu (nie tylko dwie warstwy
// ochrony wyżej) — po jednym teście na każdą nietrywialną gałąź kodu w
// każdej zakładce, analogicznie do głębi editor.spec.js.

test("ustawienia gry: drużyny — zapis nazw persystuje po przeładowaniu strony", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await page.locator("#gsTeamA").fill("Czerwoni");
    await page.locator("#gsTeamB").fill("Niebiescy");
    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.teams.teamA).toBe("Czerwoni");
    expect(game.settings.teams.teamB).toBe("Niebiescy");

    // Świeże otwarcie (nie ten sam stan JS) — potwierdza że wartość jest
    // realnie w bazie, nie tylko w pamięci strony.
    await openSettings(page, gameId);
    await expect(page.locator("#gsTeamA")).toHaveValue("Czerwoni");
    await expect(page.locator("#gsTeamB")).toHaveValue("Niebiescy");
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: nowe motywy — domyślne tła, zachowane kolory drużyn i własne tło po przeładowaniu", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(180_000);
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page, { settings: { display: { colors: { A: "#25a56a", B: "#ef8e24", BACKGROUND: "#123456", DOT: "#d7ff3d" } } } });
  try {
    await openSettings(page, gameId);
    // Skrzydła są motywem domyślnym: wybrane jako ostatnie (po innym motywie) zapisują się jawnie.
    for (const [key, label, bg] of [["radar", "Radar", "#103d43"], ["cabinet", "Kaseton", "#352719"], ["ribbon", "Wstęga", "#36233f"], ["bridge", "Most", "#252e35"], ["wings", "Skrzydła", "#152238"]]) {
      await switchTab(page, "display");
      await page.locator("#gsThemeSelect .ui-select-btn").click();
      await page.locator(`#gsThemeSelect [role="option"][data-value="${key}"]`).click();
      await expect(page.locator("#gsThemeSelect .ui-select-label")).toHaveText(label);
      // Nazwa pola trzeciego koloru pochodzi z motywu (inputs.T.label).
      await expect(page.locator('.colorItem:has(.swatchBtn[data-color-key="BACKGROUND"]) .field-label')).toHaveText("Tło");
      await saveAndWait(page);
      const saved = (await getGameRow(page, gameId)).settings.display;
      expect(saved.theme).toBe(key);
      expect(saved.colors.BACKGROUND.toLowerCase()).toBe(bg);
      expect(saved.colors.A.toLowerCase()).toBe("#25a56a");
      expect(saved.colors.B.toLowerCase()).toBe("#ef8e24");
      await page.reload();
      await expect(page.locator("#gsContentInner")).toBeVisible();
      await switchTab(page, "display");
      await expect(page.locator("#gsThemeSelect .ui-select-label")).toHaveText(label);
    }
    await page.locator('.swatchBtn[data-color-key="BACKGROUND"]').click();
    const modal = page.locator(".uni-modal:has(#gsColorHex)");
    await page.locator("#gsColorHex").fill("345678");
    await page.locator("#gsColorHex").press("Tab");
    await modal.locator(".uni-foot .btn.gold").click();
    await saveAndWait(page);
    await page.reload();
    await expect(page.locator("#gsContentInner")).toBeVisible();
    expect((await getGameRow(page, gameId)).settings.display.colors.BACKGROUND.toLowerCase()).toBe("#345678");
    await switchTab(page, "display");
    await page.locator("#gsThemeSelect .ui-select-btn").click();
    await page.locator('#gsThemeSelect [role="option"][data-value="modern"]').click();
    await expect(page.locator('.swatchBtn[data-color-key="BACKGROUND"]')).toBeDisabled();
    await expect(page.locator('.colorItem:has(.swatchBtn[data-color-key="BACKGROUND"]) .field-label')).toHaveText("Trzeci kolor");
    await saveAndWait(page);
    expect((await getGameRow(page, gameId)).settings.display.colors.BACKGROUND.toLowerCase()).toBe("#345678");
  } finally { await deleteGame(page, gameId); }
});

test("ustawienia gry: wygląd — zmiana koloru przez modal zapisuje się do settings", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await switchTab(page, "display");
    await page.locator('.swatchBtn[data-color-key="A"]').click();
    // Wybór koloru to wspólne okno (.uni-modal) z polem HEX i „Zapisz”.
    const colorModal = page.locator(".uni-modal:has(#gsColorHex)");
    await expect(colorModal).toBeVisible();

    await page.locator("#gsColorHex").fill("00FF00");
    await page.locator("#gsColorHex").press("Tab"); // wymusza 'change' na polu hex
    await colorModal.locator(".uni-foot .btn.gold").click();
    await expect(colorModal).toHaveCount(0);
    await expect(page.locator('.swatchBtn[data-color-key="A"]')).toHaveCSS("background-color", "rgb(0, 255, 0)");

    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.display.colors.A).toBe("#00FF00");
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: wygląd — reset sekcji przywraca domyślne kolory", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, {
    settings: { display: { colors: { A: "#111111", B: "#222222", BACKGROUND: "#333333", DOT: "#444444" }, theme: "modern", logoId: null } },
  });
  try {
    await openSettings(page, gameId);
    await switchTab(page, "display");
    await expect(page.locator('.swatchBtn[data-color-key="A"]')).toHaveCSS("background-color", "rgb(17, 17, 17)");
    // Podgląd Wyświetlacza w motywie z ustawień (paski motywu „modern”).
    const display = page.frameLocator("#gsDisplayIframeHolder iframe");
    await expect(display.locator(".modern-slot").first()).toBeAttached({ timeout: 20_000 });

    await page.locator("#btnDisplayReset").click();
    await page.locator(".uni-foot .btn.gold:visible").click(); // potwierdź reset sekcji

    // Reset wraca też do motywu domyślnego w podglądzie (dawniej zostawał poprzedni).
    await expect(display.locator(".modern-slot")).toHaveCount(0, { timeout: 20_000 });

    // Domyślny kolor A z DEFAULT_SETTINGS to #FF8C1A = rgb(255,140,26) (zapis: wielkie litery, core/color.js)
    await expect(page.locator('.swatchBtn[data-color-key="A"]')).toHaveCSS("background-color", "rgb(255, 140, 26)");

    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.display.colors.A).toBe("#FF8C1A");
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: dźwięk — 'Własny' bez pliku blokuje zapis komunikatem, baza bez zmian", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await switchTab(page, "sound");
    await expect(page.locator(".sfx-row").first()).toBeVisible({ timeout: 10000 });

    const firstRow = page.locator(".sfx-row").first();
    const key = await firstRow.getAttribute("data-key");
    await firstRow.locator(".sfx-variant-select .ui-select-btn").click();
    await firstRow.locator('.menu-item[data-value="__custom__"]').click();
    await expect(firstRow.locator("[data-sfx-preview]")).toBeDisabled();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "dirty");

    // Zapis z „Własnym” bez pliku: okno z powodem, bez zapisu do bazy.
    await page.locator("#btnSaveAll").click();
    await expect(page.locator(".uni-modal")).toContainText("Wybrano własny dźwięk ale nie wgrano pliku");
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "dirty");
    const game = await getGameRow(page, gameId);
    expect(game.settings?.sound?.variants?.[key]).toBeUndefined();

  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: zajęty zasób daje zwykły Resource Guard, po zwolnieniu aktywna rozgrywka ma osobny guard", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page);
  const holderTab = await context.newPage();
  let cancelCalled = false;
  let settingsStatusCalls = 0;
  await holderTab.route("**/rest/v1/rpc/control_game_settings_status", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, in_progress: false }),
  }));
  await page.route("**/rest/v1/rpc/control_game_settings_status", async route => {
    settingsStatusCalls++;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, in_progress: true, expires_at: new Date(Date.now() + 90_000).toISOString() }),
    });
  });
  await page.route("**/rest/v1/rpc/control_game_cancel_for_settings", async route => {
    cancelCalled = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, cancelled: true, in_progress: false }) });
  });
  try {
    // Control i ustawienia używają tego samego wyłącznego zasobu game:G.
    // Karta-holder symuluje zajęcie tego zasobu przez aktywną kartę Control.
    await openSettings(holderTab, gameId);
    await openSettings(page, gameId);
    await expect(page.locator("#resourceLockGuard")).toBeVisible();
    await expect(page.locator("#ingameGuard")).toHaveCount(0);
    await expect(page.locator("#resourceLockGuardBack")).toBeVisible();
    await expect(page.locator("#resourceLockGuard button")).toHaveCount(1);
    expect(settingsStatusCalls).toBe(0);

    // Zwolnienie zasobu odsłania drugi stan: karta trzymająca zasób jest
    // zamknięta, ale zapis aktywnego przebiegu jeszcze nie wygasł.
    await holderTab.close();
    await expect(page.locator("#ingameGuard")).toBeVisible({ timeout: 40_000 });
    await expect(page.locator("#ingameGuardCountdown")).toContainText("Blokada rozgrywki wygaśnie");
    expect(settingsStatusCalls).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Zakończ rozgrywkę i otwórz ustawienia" }).click();
    await expect(page.locator("#ingameGuard")).toHaveCount(0);
    await expect(page.locator("#gsSidebar")).toBeVisible();
    expect(cancelCalled).toBe(true);
  } finally {
    await holderTab.close().catch(() => {});
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: podgląd kolejnego dźwięku zatrzymuje poprzedni", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  await page.route("**/rest/v1/rpc/control_game_settings_status", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, in_progress: false }),
  }));
  try {
    await openSettings(page, gameId);
    await switchTab(page, "sound");
    const previews = page.locator("[data-sfx-preview]");
    await expect(previews.nth(1)).toBeEnabled({ timeout: 10000 });
    await previews.nth(0).click();
    await expect(previews.nth(0).locator(".ico")).toHaveClass(/ico-stop/);
    await previews.nth(1).click();
    await expect(previews.nth(0).locator(".ico")).toHaveClass(/ico-play/);
    await expect(previews.nth(1).locator(".ico")).toHaveClass(/ico-stop/);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: dźwięk — zmiana głośności zapisuje się do settings", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await switchTab(page, "sound");
    const firstRow = page.locator(".sfx-row").first();
    await expect(firstRow).toBeVisible({ timeout: 10000 });
    const key = await firstRow.getAttribute("data-key");

    // input[type=range] nie wspiera .fill() w Playwright — ustaw wartość i
    // wywołaj 'input' ręcznie, tak jak robi to przeciąganie suwaka.
    await firstRow.locator(".sfx-vol").evaluate((el) => {
      el.value = "42";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.sound.volumes[key]).toBe(42);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: niepełny finał w trybie wyboru blokuje zapis komunikatem, baza bez zmian", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    await addQuestionApi(page, gameId, 2, "Q2");

    await openSettings(page, gameId);
    await switchTab(page, "questions");
    // Klikamy widoczną etykietę (.toggle-item), nie sam <input> — natywny
    // radio tych przełączników jest celowo niewidoczny (.toggle-item
    // input{opacity:0;width:0;height:0} w game-settings.css), więc
    // .check() na samym inpucie czeka w nieskończoność na "widoczność"
    // (akcje Playwright nie mają domyślnego limitu na pojedynczą akcję),
    // aż zabije to test.setTimeout — potwierdzone w CI (run #57). Klik na
    // <label> zawierającym input przełącza go tak samo jak realny klik
    // użytkownika w widoczny .toggle-slider.
    await page.locator('.toggle-item:has(input[name="gsHasFinal"][value="yes"])').click();
    await page.locator('.toggle-item:has(input[name="gsFinalMode"][value="pick"])').click();

    await switchTab(page, "finale");
    await page.locator("#gsFinalePool .qRow").first().click(); // wybierz tylko 1 z 2

    // Tryb „wybierz” wymaga dokładnie 5 pytań: zapis pokazuje powód i nic nie zapisuje.
    await page.locator("#btnSaveAll").click();
    await expect(page.locator(".uni-modal")).toContainText("Wybierz 5 pytań finałowych (wybrano 1/5).");
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "dirty");
    // Komunikat przenosi na zakładkę Finał; wybór trybu zostaje bez zmian.
    await switchTab(page, "questions");
    await expect(page.locator('input[name="gsFinalMode"][value="pick"]')).toBeChecked();
    const game = await getGameRow(page, gameId);
    expect(game.settings?.game?.hasFinal).not.toBe(true);

  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: finał — wybranie dokładnie 5 z 10 pytań zapisuje się, wyklucza je z rund, limit 5 pilnowany w UI", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { pad: false });
  try {
    for (let i = 1; i <= 10; i++) await addQuestionApi(page, gameId, i, `Q${i}`);

    await openSettings(page, gameId);
    await switchTab(page, "questions");
    // Klikamy widoczną etykietę (.toggle-item), nie sam <input> — natywny
    // radio tych przełączników jest celowo niewidoczny (.toggle-item
    // input{opacity:0;width:0;height:0} w game-settings.css), więc
    // .check() na samym inpucie czeka w nieskończoność na "widoczność"
    // (akcje Playwright nie mają domyślnego limitu na pojedynczą akcję),
    // aż zabije to test.setTimeout — potwierdzone w CI (run #57). Klik na
    // <label> zawierającym input przełącza go tak samo jak realny klik
    // użytkownika w widoczny .toggle-slider.
    await page.locator('.toggle-item:has(input[name="gsHasFinal"][value="yes"])').click();
    await page.locator('.toggle-item:has(input[name="gsFinalMode"][value="pick"])').click();

    await switchTab(page, "finale");
    for (let i = 0; i < 5; i++) {
      await page.locator("#gsFinalePool .qRow").first().click();
    }
    await expect(page.locator(".gs-badge-row .tag b")).toHaveText("5");
    await expect(page.locator("#gsFinalePool .qRow")).toHaveCount(5);

    // Próba dodania 6-go — handler odrzuca po limicie, bez re-renderu
    await page.locator("#gsFinalePool .qRow").first().click();
    await expect(page.locator(".gs-badge-row .tag b")).toHaveText("5");
    await expect(page.locator("#gsFinalePool .qRow")).toHaveCount(5);

    // localSettings.questions.rounds wypełnia się automatycznie dopiero przy
    // wejściu w zakładkę Rundy (renderRounds()) — bez tego zostaje puste
    // (roundsQuestionsMode="random" i tak je ignoruje w realnej rozgrywce).
    // Wchodzimy tu celowo, żeby faktycznie sprawdzić wykluczenie pytań
    // finałowych z auto-uzupełnionej puli rund, a nie tylko z pustej tablicy.
    await switchTab(page, "questions");
    await page.locator('.toggle-item:has(input[name="gsRoundsMode"][value="pick"])').click();
    await switchTab(page, "rounds");
    await expect(page.locator("#gsRoundsOrderList .roundsOrderItem")).toHaveCount(5);

    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.questions.final).toHaveLength(5);
    expect(game.settings.questions.rounds).toHaveLength(5);
    const finalIds = new Set(game.settings.questions.final.map((q) => q.id));
    for (const q of game.settings.questions.rounds) {
      expect(finalIds.has(q.id), "pytanie finałowe nie powinno jednocześnie zostać zapisane jako rundowe").toBe(false);
    }
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: wyłączenie finału zwraca jego pytania na koniec puli rund", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page, { pad: false });
  try {
    const ids = [];
    for (let i = 1; i <= 15; i++) ids.push(await addQuestionApi(page, gameId, i, `Q${i}`));
    await page.evaluate(async ({ id, ids }) => {
      const { data, error: readError } = await window.__sbClient.from("games").select("settings").eq("id", id).single();
      if (readError) throw new Error(readError.message);
      const question = (qid, i) => ({ id: qid, ord: i + 1, text: `Q${i + 1}` });
      const settings = {
        ...data.settings,
        game: { ...(data.settings?.game || {}), hasFinal: true, finalQuestionsMode: "pick", roundsQuestionsMode: "pick" },
        questions: {
          ...(data.settings?.questions || {}),
          final: ids.slice(0, 5).map(question),
          rounds: ids.slice(5).map((id, index) => question(id, index + 5)),
        },
      };
      const { error } = await window.__sbClient.from("games").update({ settings }).eq("id", id);
      if (error) throw new Error(error.message);
    }, { id: gameId, ids });

    await openSettings(page, gameId);
    await switchTab(page, "questions");
    await page.locator('.toggle-item:has(input[name="gsHasFinal"][value="no"])').click();
    // Zapis bez wchodzenia do zakładki Rundy musi zachować pytania finału.
    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.game.hasFinal).toBe(false);
    expect(game.settings.questions.final).toHaveLength(0);
    expect(game.settings.questions.rounds.map((q) => q.id)).toEqual([...ids.slice(5), ...ids.slice(0, 5)]);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: rundy — zmiana kolejności strzałką zapisuje nową kolejność", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { pad: false });
  try {
    const q1 = await addQuestionApi(page, gameId, 1, "Alfa");
    const q2 = await addQuestionApi(page, gameId, 2, "Beta");
    const q3 = await addQuestionApi(page, gameId, 3, "Gamma");
    await padQuestions(page, gameId); // wypełniacze (ord 100+) trafiają za Gammę

    await openSettings(page, gameId);
    // Zakładka "rundy" jest domyślnie zablokowana w sidebarze (roundsQuestionsMode
    // startuje jako "random", updateSubTabStates dodaje gs-sidebar-item-disabled)
    // — trzeba najpierw przełączyć na "ustalona kolejność", żeby ją odblokować.
    await switchTab(page, "questions");
    await page.locator('.toggle-item:has(input[name="gsRoundsMode"][value="pick"])').click(); // patrz komentarz przy gsHasFinal wyżej

    await switchTab(page, "rounds");
    await expect(page.locator("#gsRoundsOrderList .roundsOrderItem")).toHaveCount(10);

    // Alfa (pozycja 1) w dół -> Beta, Alfa, Gamma
    await page.locator(`.roundsOrderItem[data-qid="${q1}"] .roundsOrderBtn[data-dir="down"]`).click();

    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.questions.rounds.slice(0, 3).map((q) => q.id)).toEqual([q2, q1, q3]);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: niepoprawne wartości — komunikat przy polu, zapis wstrzymany, w bazie poprzednia wartość", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await switchTab(page, "game");
    await expect(page.locator("#gsMultipliers")).toHaveValue("1, 1, 1, 2, 3");

    // Najpierw poprawna wartość, zapisana jawnie (nowa gra ma puste settings).
    await page.locator("#gsMultipliers").fill("1, 2, 3, 4, 5");
    await page.locator("#gsMultipliers").press("Tab");
    await saveAndWait(page);

    await page.locator("#gsMultipliers").fill("abc, xyz");
    await expect(page.locator("#gsMultipliersMsg")).toBeVisible();
    await expect(page.locator("#gsMultipliers")).toHaveClass(/\bis-invalid\b/);
    await page.locator("#gsFinalTarget").fill("481");
    await expect(page.locator("#gsFinalTargetMsg")).toContainText("480");

    // Zapis wstrzymany oknem; wpisane wartości zostają w polach.
    await page.locator("#btnSaveAll").click();
    await expect(page.locator(".uni-modal")).toContainText("niepoprawne");
    await page.locator(".uni-foot .btn").first().click();
    await expect(page.locator("#gsMultipliers")).toHaveValue("abc, xyz");

    const game = await getGameRow(page, gameId);
    expect(
      game.settings.game.advanced.roundMultipliers,
      "niepoprawna wartość nie może trafić do bazy"
    ).toEqual([1, 2, 3, 4, 5]);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: reset wszystkich ustawień przywraca domyślne, zapis po kliknięciu Zapisz", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId);
    await page.locator("#gsTeamA").fill("Do skasowania");
    await saveAndWait(page);

    await page.locator("#btnResetAll").click();
    await expect(page.locator(".uni-modal")).toContainText("Przywrócić ustawienia domyślne?");
    await page.locator(".uni-foot .btn.gold:visible").click();
    // Reset zmienia formularz; do bazy trafia dopiero po „Zapisz”.
    await expect(page.locator("#gsTeamA")).toHaveValue("");
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "dirty");
    expect((await getGameRow(page, gameId)).settings.teams.teamA).toBe("Do skasowania");
    await saveAndWait(page);

    const game = await getGameRow(page, gameId);
    expect(game.settings.teams.teamA).toBe("");
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: Wstecz z niezapisanymi zmianami pyta; po zapisie wraca na ret bez pytania", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId, "&ret=%2Fgames%2F");
    // Niezapisana zmiana: „Wstecz” pyta, anulowanie zostawia stronę i zmianę.
    await page.locator("#gsTeamA").fill("Coś nowego");
    await page.locator("#btnBack").click();
    await expect(page.locator(".uni-modal")).toContainText("Masz niezapisane zmiany.");
    await page.locator(".uni-foot .btn:not(.gold):visible").click();
    await expect(page).toHaveURL(/games\/settings/);
    await expect(page.locator("#gsTeamA")).toHaveValue("Coś nowego");
    // Po zapisie „Wstecz” wraca bez okna.
    await saveAndWait(page);
    await page.locator("#btnBack").click();
    await expect(page.locator(".uni-modal")).toHaveCount(0);
    await expect(page).toHaveURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 10000 });
    // toHaveURL łapie tylko zmianę adresu — window.__sbClient na /games
    // jeszcze się nie zdążył ustawić, a deleteGame() w finally z niego
    // korzysta. Bez tego czekania cleanup pada z "Cannot read properties
    // of undefined (reading 'from')" mimo że sam test już przeszedł.
    await page.waitForLoadState("networkidle");

    const game = await getGameRow(page, gameId);
    expect(game.settings.teams.teamA).toBe("Coś nowego");
  } finally {
    await deleteGame(page, gameId);
  }
});


test("ustawienia gry: niepoprawny stan — Wstecz ostrzega, anulowanie zostawia stronę, potwierdzenie wychodzi bez zapisu", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page);
  try {
    await openSettings(page, gameId, "&ret=%2Fgames%2F");
    await switchTab(page, "game");
    await page.locator("#gsMultipliers").fill("abc, 2");
    await page.locator("#gsMultipliers").press("Tab");
    await page.locator("#btnBack").click();
    await expect(page.locator(".uni-modal")).toContainText("Masz niezapisane zmiany.");
    await page.locator(".uni-foot .btn:not(.gold)").click();
    await expect(page).toHaveURL(/games\/settings/);
    await expect(page.locator("#gsMultipliers")).toHaveValue("abc, 2");
    await page.locator("#btnBack").click();
    await page.locator(".uni-foot .btn.gold").click();
    await expect(page).toHaveURL(/\/games\/?(?:\?[^\/]*)?$/);
    await page.waitForLoadState("networkidle");
    // Wyjście bez zapisu: w bazie nie ma ani niepoprawnej, ani żadnej nowej wartości.
    const game = await getGameRow(page, gameId);
    expect(game.settings?.game?.advanced?.roundMultipliers ?? [1, 1, 1, 2, 3]).toEqual([1, 1, 1, 2, 3]);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("ustawienia gry: własny dźwięk z chmury zostaje po zapisie i wyjściu bez otwierania Dźwięku", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60000);
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page);
  try {
    const key = await page.evaluate(async gameId => {
      const sb = window.__sbClient;
      const { data: auth } = await sb.auth.getUser();
      const { categories } = await (await fetch("/shared/data/sounds.json")).json();
      const key = categories[0].key;
      const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" });
      const { error: uploadError } = await sb.storage.from("user-sounds").upload(`${auth.user.id}/${gameId}/${key}`, blob, { upsert: true });
      if (uploadError) throw uploadError;
      const { error } = await sb.from("games").update({ settings: { sound: { variants: { [key]: "__custom__" }, filenames: { [key]: "cloud.mp3" } } } }).eq("id", gameId);
      if (error) throw error;
      return key;
    }, gameId);
    await openSettings(page, gameId, "&ret=%2Fgames%2F");
    await page.locator("#gsTeamA").fill("Zachowany dźwięk");
    await saveAndWait(page);
    await page.locator("#btnBack").click();
    await expect(page).toHaveURL(/\/games\/?(?:\?[^\/]*)?$/);
    await page.waitForLoadState("networkidle");
    const game = await getGameRow(page, gameId);
    expect(game.settings.sound.variants[key]).toBe("__custom__");
    expect(game.settings.sound.filenames[key]).toBe("cloud.mp3");
    expect(game.settings.teams.teamA).toBe("Zachowany dźwięk");
  } finally { await deleteGame(page, gameId); }
});

// Telefon (decyzja 2026-10-21): Ustawienia gry działają na telefonie. W Moich
// grach widać „Ustawienia gry” bez „Graj” (Control na telefonie niedostępny);
// w Ustawieniach brak „Graj”, powrót to sama strzałka, sekcje nie wystają
// poza ekran, a zapis działa.
test.describe("ustawienia gry: telefon", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("ustawienia gry: telefon — wejście z Moich gier, bez Graj, sekcje mieszczą się, zapis działa", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(90_000);
    await loginAs(page, context, accounts.standard[0]);
    const name = `E2E-SETTINGS-PHONE-${Date.now()}`;
    const gameId = await createGame(page, { name });
    try {
      await page.goto("https://www.familijna.app/games/?tab=prepared", { waitUntil: "domcontentloaded" });
      const tile = page.locator("#grid .card", { has: page.locator(".name", { hasText: name }) });
      await tile.tap();
      await expect(page.locator("#btnPlay")).toBeHidden();
      await expect(page.locator("#btnSettings")).toBeVisible();
      await page.locator("#btnSettings").tap();
      await page.waitForURL(/\/games\/settings\/?\?id=/);
      await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 15000 });
      await expect(page.locator("#pageGuard, .page-guard")).toHaveCount(0);
      await expect(page.locator(".gs-actionbar #btnPlay")).toBeHidden();
      // powrót: sama strzałka (tekst tylko dla czytnika ekranu)
      const backFont = await page.locator("#btnBack").evaluate((el) => getComputedStyle(el).fontSize);
      expect(backFont).toBe("0px");

      const overflow = () => page.evaluate(() => [...document.querySelectorAll("#gsContentInner *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && el.getClientRects().length).length);
      for (const cat of ["sound", "display", "questions", "game"]) {
        await page.locator("#gsSidebarToggle").tap();
        await page.locator(`.gs-sidebar-item[data-cat="${cat}"]`).tap();
        await expect(page.locator("#gsSidebar")).not.toHaveClass(/is-open/);
        await page.waitForTimeout(400);
        expect(await overflow(), `sekcja ${cat} wystaje poza ekran`).toBe(0);
      }

      await page.locator("#gsSidebarToggle").tap();
      await page.locator('.gs-sidebar-item[data-cat="teams"]').tap();
      await page.locator("#gsTeamA").fill("Telefon A");
      await saveAndWait(page);
      expect((await getGameRow(page, gameId)).settings.teams.teamA).toBe("Telefon A");
    } finally {
      await deleteGame(page, gameId);
    }
  });
});
