// tests/e2e/editor.spec.js
// Weryfikuje edytor gier (js/pages/editor.js) — kreator pytań/odpowiedzi
// używany do przygotowania każdego typu gry (poll_text, poll_points,
// prepared). Zamiast tylko "happy path" (dodaj pytanie, dodaj odpowiedź),
// celujemy w nietypowe zachowania znalezione czytając kod i schema.sql:
// limity (albo ich brak), co się dzieje przy naruszeniu CHECK constraintów
// w bazie, asymetrię walidacji pytanie/odpowiedź, dziury w numeracji (ord),
// blokady stanu gry (poll_open/ready) i — najciekawsze — co się dzieje gdy
// ta sama gra jest edytowana w dwóch kartach naraz (editor.js nie ma żadnej
// synchronizacji w czasie rzeczywistym ani re-walidacji stanu gry per-akcja).
//
// Gry zakładane bezpośrednio przez API (jak w polls.spec.js/game-deletion.spec.js)
// — kreator sam w sobie jest przedmiotem testu, więc seedujemy tylko to, co
// potrzebne do konkretnego scenariusza.

//
// Od audytu strony (familijna-server/docs/audyt-stron.md) strona /editor i cały front-end są
// serwowane z plików TEGO repo (helpers/branch-code.js), a backend jest
// prawdziwy -- workflow odpalony na branchu testuje poprawki przed
// wdrożeniem. Regresje z audytu: sekcja "editor: audyt" na końcu pliku.

const { test, expect } = require("./helpers/e2e-test");
const { importClosedPoll } = require("./helpers/game-seed");
const { serveBranchCode } = require("./helpers/branch-code");

// service worker obsłużyłby żądania z własnego cache z pominięciem page.route
test.use({ serviceWorkers: "block" });
test.use({ needs: { standard: 1 } });

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["games/editor", "bases/explorer"] });
});

/* ================= Seed / DB helpers (bezpośrednio przez window.__sbClient) ================= */

async function createGame(page, { type = "prepared", name } = {}) {
  return await page.evaluate(async ({ type, name }) => {
    const sb = window.__sbClient;
    const { data: userData } = await sb.auth.getUser();
    const { data: game, error } = await sb
      .from("games")
      .insert({ name: name || `E2E-EDITOR-${Date.now()}`, owner_id: userData.user.id, type })
      .select("id")
      .single();
    if (error) throw new Error("insert games failed: " + error.message);
    return game.id;
  }, { type, name });
}

async function addQuestionApi(page, gameId, ord, text) {
  return await page.evaluate(async ({ gameId, ord, text }) => {
    const { data, error } = await window.__sbClient
      .from("questions")
      .insert({ game_id: gameId, ord, text })
      .select("id")
      .single();
    if (error) throw new Error("insert question failed: " + error.message);
    return data.id;
  }, { gameId, ord, text });
}

async function addAnswerApi(page, questionId, ord, text, points = 0) {
  return await page.evaluate(async ({ questionId, ord, text, points }) => {
    const { data, error } = await window.__sbClient
      .from("answers")
      .insert({ question_id: questionId, ord, text, fixed_points: points })
      .select("id")
      .single();
    if (error) throw new Error("insert answer failed: " + error.message);
    return data.id;
  }, { questionId, ord, text, points });
}

async function getGameRow(page, gameId) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("games").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  }, gameId);
}

async function getQuestionsRows(page, gameId) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient
      .from("questions").select("*").eq("game_id", id).order("ord");
    if (error) throw new Error(error.message);
    return data || [];
  }, gameId);
}

async function getAnswersRows(page, questionId) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient
      .from("answers").select("*").eq("question_id", id).order("ord");
    if (error) throw new Error(error.message);
    return data || [];
  }, questionId);
}

async function deleteGame(page, gameId) {
  await page.evaluate(async (id) => {
    await window.__sbClient.from("games").delete().eq("id", id);
  }, gameId);
}

async function openEditor(page, gameId) {
  await page.goto(`https://www.familijna.app/games/editor?id=${gameId}`, { waitUntil: "domcontentloaded" });
  // editor.js wiąże listenery/renderuje dopiero po asynchronicznym
  // requireAuth+initI18n+loadGame w boot() — ten sam wyścig co gdzie indziej.
  await page.waitForLoadState("networkidle");
}

const qCard = (page, i) => page.locator("#qList .qcard:not(.addCard)").nth(i);
const aRow = (page, i) => page.locator("#aList .qf-row:not(.qf-add)").nth(i);
const aRows = (page) => page.locator("#aList .qf-row:not(.qf-add)");

// Import to jedno RPC (migracja 276): po sukcesie modal się zamyka (bez
// komunikatu -- pole #msg zastąpił dymek błędów, E16).
async function expectImportDone(page) {
  await expect(page.locator("#txtImportOverlay")).toBeHidden({ timeout: 20000 });
}

// trg_assert_game_answers_minmax (schema.sql) blokuje UPDATE games.status na
// poll_open/ready dla poll_text/poll_points, jeśli gra ma <10 pytań albo (dla
// poll_points) jakieś pytanie ma <3 lub >6 odpowiedzi — więc każdy test, który
// wymusza status='ready'/'poll_open' wprost przez API, musi wcześniej
// nasadzić pełne, poprawne dane (dokładnie jak realny poll_open przez UI by
// wymagał). Zwraca id pierwszego pytania i jego pierwszej odpowiedzi.
async function seedPollPointsFull(page, gameId, { firstAnswerPoints = 0 } = {}) {
  let firstQ = null;
  let firstA = null;
  for (let ord = 1; ord <= 10; ord++) {
    const qId = await addQuestionApi(page, gameId, ord, `Pytanie ${ord}`);
    if (ord === 1) firstQ = qId;
    for (let a = 1; a <= 4; a++) {
      const aId = await addAnswerApi(page, qId, a, `Odp ${ord}.${a}`, ord === 1 && a === 1 ? firstAnswerPoints : 0);
      if (ord === 1 && a === 1) firstA = aId;
    }
  }
  return { qId: firstQ, aId: firstA };
}

/* ================= A: pytanie z pustym tekstem -> fallback do domyślnego tekstu ================= */
// questions_text_len (schema.sql) wymaga char_length>=1. Wcześniej
// saveQuestionNow() (w przeciwieństwie do odpowiedzi) nie miało fallbacku na
// tekst domyślny gdy pole jest puste — update leciał do bazy, baza go
// odrzucała, a UI pokazywał generyczny błąd zostawiając textarea pustą, mimo
// że w bazie wciąż był stary tekst. Naprawione: puste pole -> ten sam
// fallback do domyślnej etykiety, jakiego już używają odpowiedzi.
test("edytor: puste pole pytania zapisuje się jako domyślna etykieta (nie błąd, nie desync)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    const qId = await addQuestionApi(page, gameId, 1, "Pytanie testowe");
    await openEditor(page, gameId);

    await expect(page.locator("#qText")).toHaveValue("Pytanie testowe", { timeout: 15000 });

    await page.locator("#qText").fill("");
    await page.locator("#qText").blur();

    // Pole powinno odzwierciedlać fallback, nie zostać puste (desync).
    await expect(page.locator("#qText")).toHaveValue("Pytanie 1", { timeout: 10000 });

    await expect.poll(async () => (await getQuestionsRows(page, gameId)).find((x) => x.id === qId)?.text,
      { timeout: 10000, message: "pusty tekst -> fallback do domyślnej etykiety w bazie" }).toBe("Pytanie 1");
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= B: import zawsze wipeuje istniejącą zawartość ================= */
test("E20 import TXT pokazuje podgląd na żywo, błąd formatu i bezpieczny tekst", async ({ page, context, accounts, loginAs }, testInfo) => {
  await loginAs(page, context, accounts.standard[0]);
  const gameId = await createGame(page, { type: "prepared" });
  try {
    await openEditor(page, gameId);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("@Demo\n#Pytanie A\n1 Odpowiedź A\n2 Odpowiedź B\n#Pytanie B\n1 <img src=x onerror=alert(1)>");
    const preview = page.locator("#txtPreviewBody");
    await expect(preview).toContainText("Pytanie A");
    await expect(preview).toContainText("Odpowiedź A");
    await expect(preview.locator("img")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("shot-e20-editor-txt-preview-390.png"), fullPage: true });

    await page.locator("#txtTa").fill("Odpowiedź przed pytaniem");
    await expect(preview).toHaveClass(/is-error/);
    await page.locator("#txtTa").fill("#Poprawione pytanie\n1 Poprawiona odpowiedź");
    await expect(preview).toContainText("Poprawione pytanie");
    await expect(preview).not.toHaveClass(/is-error/);
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.screenshot({ path: testInfo.outputPath("shot-e20-editor-txt-preview-1400.png"), fullPage: true });
    expect(await getQuestionsRows(page, gameId)).toHaveLength(0);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("edytor: import tekstowy zawsze zastępuje (wipeuje) istniejącą zawartość gry", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    const oldQ = await addQuestionApi(page, gameId, 1, "Stare pytanie");
    await addAnswerApi(page, oldQ, 1, "Stara odp", 0);

    await openEditor(page, gameId);

    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Nowe pytanie\n1 Nowa odpowiedź /10");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click(); // potwierdzenie importu
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    expect(questions, "po imporcie powinno zostać dokładnie jedno (nowe) pytanie").toHaveLength(1);
    expect(questions[0].text).toBe("Nowe pytanie");
    expect(questions[0].id, "stare pytanie powinno zniknąć (wipe), nie zostać nadpisane").not.toBe(oldQ);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= C: nieudany parse importu NIE kasuje zawartości ================= */
test("edytor: import bez '#' pokazuje błąd formatu i nie rusza istniejącej zawartości", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await addQuestionApi(page, gameId, 1, "Zostaw mnie");

    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    // Sama linia "@Nazwa" bez żadnego "#" — pętla kończy się z pustym items,
    // bez przechodzenia przez gałąź "odpowiedź przed pierwszym pytaniem"
    // (to inny, wcześniejszy błąd, na który wcześniej przypadkiem trafiał ten test).
    await page.locator("#txtTa").fill("@Tylko nazwa, bez pytań");
    await page.locator("#btnTxtImport").click();

    await expect(page.locator("#txtMsg")).toHaveText(
      "Brak pytań. Pamiętaj o liniach zaczynających się od #.",
      { timeout: 10000 }
    );
    // Overlay musi zostać otwarty (parse zawiódł PRZED confirmModal/wipe'em).
    await expect(page.locator("#txtImportOverlay")).toBeVisible();

    const questions = await getQuestionsRows(page, gameId);
    expect(questions).toHaveLength(1);
    expect(questions[0].text).toBe("Zostaw mnie");
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= D: odpowiedź zaczynająca się od cyfry zostaje okaleczona ================= */
test("edytor: import okalecza odpowiedź zaczynającą się od cyfry (myli ją z numerem listy)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Test\n5 sztuk\nCoś tam");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    const answers = await getAnswersRows(page, questions[0].id);
    const texts = answers.map((a) => a.text);
    expect(texts, "'5 sztuk' powinno stracić '5' (wzięte za numer porządkowy)").toContain("sztuk");
    expect(texts).not.toContain("5 sztuk");
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= E: ostatni "/" w linii zawsze traktowany jako punkty ================= */
test("edytor: import dwuznacznie tnie tekst na ostatnim '/', nawet gdy to część treści odpowiedzi", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Test\nFormuła 1/2");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    const answers = await getAnswersRows(page, questions[0].id);
    expect(answers[0].text, "'Formuła 1/2' zostaje rozbite na tekst + punkty, mimo że '/2' mogło być częścią treści").toBe("Formuła 1");
    expect(answers[0].fixed_points).toBe(2);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= F: ujemne i dziesiętne punkty z importu są przycinane ================= */
test("edytor: import przycina ujemne punkty do 0 i zaokrągla w dół dziesiętne", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Test\nOdp A /-5\nOdp B /3.7");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    const answers = await getAnswersRows(page, questions[0].id);
    const byText = Object.fromEntries(answers.map((a) => [a.text, a.fixed_points]));
    expect(byText["Odp A"], "ujemne punkty importu -> nonNegativeInt clamp do 0").toBe(0);
    expect(byText["Odp B"], "dziesiętne punkty importu -> Math.floor").toBe(3);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= G: import ucina odpowiedzi powyżej AN_MAX bez ostrzeżenia ================= */
test("edytor: import po cichu ucina odpowiedzi powyżej limitu 6 na pytanie", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    const lines = ["#Test", ...Array.from({ length: 8 }, (_, i) => `Odp ${i + 1}`)].join("\n");
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill(lines);
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    const answers = await getAnswersRows(page, questions[0].id);
    expect(answers, "8 odpowiedzi w źródle -> tylko 6 zapisanych, bez błędu/ostrzeżenia").toHaveLength(6);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= H: import ignoruje punkty dla poll_points ================= */
test("edytor: import ignoruje punkty z tekstu dla typu poll_points (zawsze zapisuje 0)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "poll_points" });
  try {
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Test\nOdp /50");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    const answers = await getAnswersRows(page, questions[0].id);
    expect(answers[0].fixed_points, "poll_points ma ignoreImportPoints=true — /50 z tekstu ma zostać zignorowane").toBe(0);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= I: suma punktów >100 (prepared) NIE blokuje zapisu ================= */
test("edytor: suma punktów >100 dla 'prepared' to tylko wizualne ostrzeżenie, zapis i tak przechodzi", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    const qId = await addQuestionApi(page, gameId, 1, "Pytanie");
    await addAnswerApi(page, qId, 1, "A1", 0);
    await addAnswerApi(page, qId, 2, "A2", 0);

    await openEditor(page, gameId);
    await expect(aRow(page, 0)).toBeVisible({ timeout: 15000 });

    await aRow(page, 0).locator(".qf-pts").fill("80");
    await aRow(page, 0).locator(".qf-pts").blur();
    await aRow(page, 1).locator(".qf-pts").fill("50");
    await aRow(page, 1).locator(".qf-pts").blur();

    await expect(page.locator(".qf-sum")).toHaveClass(/over/, { timeout: 5000 });
    await expect(page.locator(".qf-sum .qf-sumChip b")).toHaveText("130/100");

    // zapis potwierdza stan w bazie
    await expect.poll(async () => {
      const answers = await getAnswersRows(page, qId);
      return answers.reduce((s, a) => s + a.fixed_points, 0);
    }, { timeout: 10000, message: "obie wartości mają zostać naprawdę zapisane w bazie mimo przekroczenia 100" }).toBe(130);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= J: usunięcie odpowiedzi ze środka -> nowa wypełnia zwolniony ord ================= */
test("edytor: nowa odpowiedź zajmuje zwolniony numer (ord) po usunięciu ze środka, nie doklejana na koniec", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    const qId = await addQuestionApi(page, gameId, 1, "Pytanie");
    const a2Id = await addAnswerApi(page, qId, 1, "A1", 0);
    const toDelete = await addAnswerApi(page, qId, 2, "A2", 0);
    await addAnswerApi(page, qId, 3, "A3", 0);
    await addAnswerApi(page, qId, 4, "A4", 0);

    await openEditor(page, gameId);
    await expect(page.locator("#aList .qf-row:not(.qf-add)")).toHaveCount(4, { timeout: 15000 });

    // usuń odpowiedź o ord=2 ("A2")
    await aRow(page, 1).locator(".qf-del").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expect(page.locator("#aList .qf-row:not(.qf-add)")).toHaveCount(3, { timeout: 10000 });

    await page.locator("#aList .qf-add").click();
    await expect(page.locator("#aList .qf-row:not(.qf-add)")).toHaveCount(4, { timeout: 10000 });

    const answers = await getAnswersRows(page, qId);
    const newOne = answers.find((a) => a.id !== a2Id && a.id !== toDelete && !["A1", "A3", "A4"].includes(a.text));
    expect(newOne, "powinna istnieć nowo dodana odpowiedź").toBeTruthy();
    expect(newOne.ord, "nowa odpowiedź powinna zająć zwolniony slot ord=2, nie ord=5").toBe(2);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= ?q=: otwarte pytanie w adresie ================= */
test("edytor: otwarte pytanie jest w adresie (?q=) i wejście z ?q= otwiera to pytanie", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    const q2Id = await addQuestionApi(page, gameId, 2, "Q2");

    await openEditor(page, gameId);
    await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(2, { timeout: 15000 });
    await qCard(page, 1).click();
    await expect(page.locator("#qText")).toHaveValue("Q2", { timeout: 10000 });
    await expect(page).toHaveURL(new RegExp(`[?&]q=${q2Id}`));

    await page.goto(`https://www.familijna.app/games/editor?id=${gameId}&q=${q2Id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#qText")).toHaveValue("Q2", { timeout: 15000 });
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= K: usunięcie pytania ze środka przenumerowuje resztę ================= */
test("edytor: usunięcie pytania ze środka przenumerowuje resztę, aktywne pytanie zachowuje treść i odpowiedzi", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    await addQuestionApi(page, gameId, 2, "Q2");
    const q3Id = await addQuestionApi(page, gameId, 3, "Q3");
    await addAnswerApi(page, q3Id, 1, "A3text", 0);

    await openEditor(page, gameId);
    await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(3, { timeout: 15000 });

    await qCard(page, 2).click(); // Q3
    await expect(page.locator("#qText")).toHaveValue("Q3", { timeout: 10000 });
    await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("A3text");

    await qCard(page, 1).locator(".x").click(); // usuń Q2 (środek)
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(2, { timeout: 10000 });

    // Q3 dalej aktywne, treść/odpowiedzi bez zmian mimo zmiany numeru porządkowego
    await expect(page.locator("#qText")).toHaveValue("Q3");
    await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("A3text");

    const questions = await getQuestionsRows(page, gameId);
    const q3 = questions.find((q) => q.id === q3Id);
    expect(q3.ord, "Q3 powinno zostać przenumerowane z ord=3 na ord=2").toBe(2);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= L: brak twardego limitu liczby pytań ================= */
test("edytor: nie ma twardego limitu liczby pytań — dodanie wielu ponad minimum nie rzuca błędu", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  const TARGET = 15; // wyraźnie ponad QN_MIN=10, bez przesady w czasie testu
  try {
    await openEditor(page, gameId);

    for (let i = 1; i <= TARGET; i++) {
      await page.locator("#qList .addCard").click();
      await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(i, { timeout: 10000 });
    }

    const questions = await getQuestionsRows(page, gameId);
    expect(questions, `powinno dać się dodać ${TARGET} pytań bez odrzucenia`).toHaveLength(TARGET);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= M: wejście do edytora gdy ankieta poll_open -> blokada ================= */
test("edytor: wejście na edytor gdy ankieta jest otwarta (poll_open) -> pełna blokada strony, brak dostępu", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "poll_points" });
  try {
    await seedPollPointsFull(page, gameId);

    const game = await getGameRow(page, gameId);
    await page.evaluate(async ({ gameId, key }) => {
      const { error } = await window.__sbClient.rpc("poll_open", { p_game_id: gameId, p_key: key });
      if (error) throw new Error(error.message);
    }, { gameId, key: game.share_key_poll });

    await page.goto(`https://www.familijna.app/games/editor?id=${gameId}`, { waitUntil: "domcontentloaded" });
    // Blokada stanu (familijna-server/docs/blokady-zasobow.md): pełnoekranowa blokada z powodem
    // z game_validate, strona zostaje na miejscu, wyjście tylko do listy gier.
    await expect(page.locator("#resourceLockGuard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#resourceLockGuardMsg")).toContainText(/ankiet/i);
    await expect(page).toHaveURL(/\/games\/editor/);
    await page.locator("#resourceLockGuardBack").click();
    await page.waitForURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 15000 });
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= N/O: wejście gdy ankieta 'ready' -> confirm reset (Anuluj / OK) ================= */
test("edytor: wejście gdy ankieta jest 'ready' i Anuluj w confirmie -> nic się nie resetuje", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  // gra po zamkniętej ankiecie -- import .famgame (stanu nie ustawia się zapisem z przeglądarki, 514)
  const imported = await importClosedPoll(page, { type: "poll_points", name: `E2E-EDITOR-READY-${Date.now()}` });
  const gameId = imported.id;
  try {
    const qId = imported.questionIds[0];
    const aId = imported.answerIds[0];

    await page.goto(`https://www.familijna.app/games/editor?id=${gameId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".uni-modal")).toBeVisible({ timeout: 15000 });
    await page.locator(".uni-foot .btn:not(.gold)").click(); // Anuluj
    await page.waitForURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 15000 });

    const game = await getGameRow(page, gameId);
    expect(game.status, "Anuluj nie powinno zresetować statusu").toBe("ready");
    const answers = await getAnswersRows(page, qId);
    expect(answers.find((a) => a.id === aId)?.fixed_points, "Anuluj nie powinno wyzerować punktów").toBe(42);
  } finally {
    await deleteGame(page, gameId);
  }
});

test("edytor: wejście gdy ankieta jest 'ready' i OK w confirmie -> realny reset do draft + zerowanie punktów", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  // gra po zamkniętej ankiecie -- import .famgame (stanu nie ustawia się zapisem z przeglądarki, 514)
  const imported = await importClosedPoll(page, { type: "poll_points", name: `E2E-EDITOR-READY-${Date.now()}` });
  const gameId = imported.id;
  try {
    const qId = imported.questionIds[0];
    const aId = imported.answerIds[0];

    await page.goto(`https://www.familijna.app/games/editor?id=${gameId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".uni-modal")).toBeVisible({ timeout: 15000 });
    await page.locator(".uni-foot .btn.gold:visible").click(); // OK — resetuj

    await expect(page.locator("#qText")).toHaveValue("Pytanie 1", { timeout: 15000 });

    const game = await getGameRow(page, gameId);
    expect(game.status).toBe("draft");
    expect(game.poll_opened_at).toBeNull();
    expect(game.poll_closed_at).toBeNull();
    const answers = await getAnswersRows(page, qId);
    expect(answers.find((a) => a.id === aId)?.fixed_points, "OK powinno wyzerować punkty").toBe(0);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= P: dwie karty — usunięcie w A, edycja usuniętego w B to cichy no-op ================= */
// editor.js nie ma żadnej synchronizacji w czasie rzeczywistym między kartami.
// UPDATE ... WHERE id = <usunięte> pasuje do 0 wierszy — Supabase/PostgREST NIE
// zwraca błędu w takiej sytuacji, więc UI karty B pokazuje "Zapisano.", mimo że
// nic nie zostało zapisane (wiersz już nie istnieje).
// Ta sama gra dwiema kartami naraz USTAWIAŁA kiedyś sytuację "cichego
// sukcesu" (karta B edytowała pytanie usunięte w karcie A, zapis pozornie
// się udawał). Warstwa 1 (familijna-server/docs/plan-testy-i-poprawki.md) usuwa ten problem
// u źródła: karta B w ogóle nie wchodzi w tryb edycji, dopóki karta A
// trzyma blokadę zasobu (resource-lock.js, edit_locks). Warstwa 2
// (updateChecked, obrona przed ominięciem blokady — patrz test niżej) to
// dodatkowa, niezależna linia obrony — ten test sprawdza samą Warstwę 1.
test("edytor: dwie karty — druga karta jest blokowana overlayem zamiast cichej edycji, zwalnia się po zamknięciu pierwszej", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    await addQuestionApi(page, gameId, 2, "Q2");

    const pageA = await context.newPage(); // trzyma blokadę, zostanie zamknięta żeby ją zwolnić
    const pageB = page; // fixture page — druga karta, też służy do końcowego sprzątania

    await openEditor(pageA, gameId);
    await openEditor(pageB, gameId);

    // Karta B: overlay blokady, ZERO dostępu do edytowalnej treści pod spodem
    await expect(pageB.locator("#resourceLockGuard")).toBeVisible({ timeout: 10000 });
    await expect(pageB.locator("#qList .qcard:not(.addCard)")).toHaveCount(0);

    // Zamknięcie karty A zwalnia blokadę — best-effort przez pagehide+broadcast,
    // a jeśli to zawiedzie, fallback to TTL (120 s) + polling w karcie B (do 5s) —
    // stąd hojny timeout na kolejny expect zamiast zakładania natychmiastowego zwolnienia.
    await pageA.close();

    await expect(pageB.locator("#resourceLockGuard")).toBeHidden({ timeout: 40000 }); // keepalive przy pagehide; TTL 120 s to ostateczność
    await expect(pageB.locator("#qList .qcard:not(.addCard)")).toHaveCount(2, { timeout: 10000 });
  } finally {
    await deleteGame(page, gameId);
  }
});

// Warstwa 2: nawet gdy Warstwa 1 (blokada) zostanie ominięta — np. usunięcie
// pytania przez proces spoza UI, albo bezpośrednie wywołanie RPC/klienta z
// pominięciem edytora — zapis w TEJ SAMEJ karcie, która wciąż "myśli", że
// edytuje usunięte już pytanie, musi się jawnie nie udać (updateChecked w
// db-guard.js), zamiast pokazać fałszywe "Zapisano." (0-row UPDATE nie
// zwraca błędu z Supabase/PostgREST — patrz komentarz w db-guard.js).
test("edytor: Warstwa 2 — zapis pytania usuniętego z pominięciem blokady kończy się jawnym komunikatem, nie fałszywym 'Zapisano.'", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await addQuestionApi(page, gameId, 1, "Q1");
    const q2Id = await addQuestionApi(page, gameId, 2, "Q2");

    await openEditor(page, gameId);

    await qCard(page, 1).click();
    await expect(page.locator("#qText")).toHaveValue("Q2", { timeout: 10000 });

    // Symulacja ominięcia Warstwy 1: usunięcie pytania bezpośrednio w bazie,
    // z pominięciem edytora — ta sama karta dalej "myśli", że je edytuje.
    await page.evaluate(async (id) => {
      await window.__sbClient.from("questions").delete().eq("id", id);
    }, q2Id);

    await page.locator("#qText").fill("Nowy tekst po usunięciu gdzie indziej");
    await page.locator("#qText").blur();

    await expect(page.locator(".app-toast-text")).toHaveText(
      "Ten element został zmieniony lub usunięty w innym miejscu. Odśwież stronę.",
      { timeout: 10000 }
    );

    const questions = await getQuestionsRows(page, gameId);
    expect(questions.find((q) => q.id === q2Id), "usunięty wiersz nie powinien zostać wskrzeszony przez zapis").toBeUndefined();

    // Karta sama zauważa zniknięcie — kafelek Q2 znika z listy bez odświeżania strony
    await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(1, { timeout: 10000 });
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= Q: dwie karty — otwarcie ankiety w B blokuje zapis w A (Warstwa 2) ================= */
// Uprawnienie do edycji (game_validate().edit, Warstwa 1) sprawdzane jest RAZ
// w boot() — edytor otwarty wcześniej jako szkic nie wie, że ankietę właśnie
// otwarto w innej karcie/urządzeniu. Dawniej zapisywał dalej (luka "Warstwa 2
// zero" z familijna-server/docs/plan-testy-i-poprawki.md); od migracji 274 baza sama odrzuca
// zapis treści gry z otwartą ankietą, a edytor pokazuje overlay z powodem.
test("edytor: dwie karty — otwarcie ankiety w karcie B blokuje zapis w karcie A (baza odrzuca)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "poll_points" });
  try {
    const { qId: firstQId } = await seedPollPointsFull(page, gameId);

    const pageA = page;
    await openEditor(pageA, gameId); // ładuje się jako draft

    const pageB = await context.newPage();
    // window.__sbClient istnieje dopiero po załadowaniu strony aplikacji —
    // świeża karta zaczyna na about:blank, więc trzeba ją najpierw nawigować.
    // NIE otwieramy tu edytora: od Warstwy 1 (resource-lock) druga karta na
    // tej samej grze byłaby zablokowana overlayem, co psułoby sens tego
    // testu (sprawdza brak re-walidacji stanu w karcie A, nie blokadę) —
    // wystarczy dowolna zalogowana strona, żeby mieć klienta do wywołania RPC.
    await pageB.goto("https://www.familijna.app/games", { waitUntil: "domcontentloaded" });
    await pageB.waitForLoadState("networkidle");
    const game = await getGameRow(pageB, gameId);
    await pageB.evaluate(async ({ gameId, key }) => {
      const { error } = await window.__sbClient.rpc("poll_open", { p_game_id: gameId, p_key: key });
      if (error) throw new Error(error.message);
    }, { gameId, key: game.share_key_poll });
    const gameAfter = await getGameRow(pageB, gameId);
    expect(gameAfter.status, "sanity: ankieta faktycznie otwarta w tle").toBe("poll_open");

    // Karta A dalej "myśli", że jest draft — próbuje zapisać (tekst mieści
    // się w limicie 17 znaków pola odpowiedzi).
    const before = (await getAnswersRows(pageA, firstQId))[0].text;
    await expect(aRow(pageA, 0).locator(".qf-text")).toBeVisible({ timeout: 10000 });
    await aRow(pageA, 0).locator(".qf-text").fill("Zmieniona w A!");
    await aRow(pageA, 0).locator(".qf-text").blur();
    // ten sam pełnoekranowy overlay co blokada zasobu, z powodem z bazy
    await expect(pageA.locator("#resourceLockGuard")).toBeVisible({ timeout: 10000 });
    await expect(pageA.locator("#resourceLockGuardMsg")).toContainText("Ankieta jest otwarta");

    const answers = await getAnswersRows(pageA, firstQId);
    expect(answers[0].text, "baza musi odrzucić zapis treści gry z otwartą ankietą").toBe(before);

    await pageB.close();
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= R: import do poll_text w ogóle nie tworzy odpowiedzi ================= */
// cfgFromGameType(POLL_TEXT).allowAnswers = false — import warunkuje tworzenie
// odpowiedzi tym flagiem, więc dla poll_text odpowiedzi z importowanego tekstu
// są całkowicie pomijane (nie tylko punkty, jak dla poll_points — same wiersze
// answers() nigdy nie powstają).
test("edytor: import do gry typu poll_text nie tworzy żadnych odpowiedzi (allowAnswers=false)", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "poll_text" });
  try {
    await openEditor(page, gameId);
    await page.locator("#btnImportTxt").click();
    await page.locator("#txtTa").fill("#Test\n1 Odpowiedź A\n2 Odpowiedź B");
    await page.locator("#btnTxtImport").click();
    await page.locator(".uni-foot .btn.gold:visible").click();
    await expectImportDone(page);

    const questions = await getQuestionsRows(page, gameId);
    expect(questions).toHaveLength(1);
    const answers = await getAnswersRows(page, questions[0].id);
    expect(answers, "poll_text nie pokazuje/nie tworzy sekcji odpowiedzi w edytorze wcale").toHaveLength(0);
  } finally {
    await deleteGame(page, gameId);
  }
});

/* ================= S: nazwa gry — pusta -> fallback do domyślnej, >80 znaków -> ucięta ================= */
test("edytor: pusta nazwa gry po blur zapisuje się jako domyślna, nie jako pusty string", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared", name: "Moja gra testowa" });
  try {
    await openEditor(page, gameId);
    await expect(page.locator("#gameName")).toHaveValue("Moja gra testowa", { timeout: 15000 });

    await page.locator("#gameName").fill("");
    await page.locator("#gameName").blur();
    await expect.poll(async () => (await getGameRow(page, gameId)).name,
      { timeout: 10000, message: "pusta nazwa -> fallback do 'Nowa gra', nie błąd i nie pusty string" }).toBe("Nowa gra");
  } finally {
    await deleteGame(page, gameId);
  }
});

test("edytor: nazwa gry dłuższa niż 80 znaków zostaje ucięta do 80", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(60_000);
  await loginAs(page, context, accounts.standard[0]);

  const gameId = await createGame(page, { type: "prepared" });
  try {
    await openEditor(page, gameId);
    const longName = "X".repeat(120);
    await page.locator("#gameName").fill(longName);
    await page.locator("#gameName").blur();
    await expect.poll(async () => (await getGameRow(page, gameId)).name,
      { timeout: 10000, message: "nazwa w bazie nie powinna przekroczyć 80 znaków (games_name_len)" }).toBe("X".repeat(80));
  } finally {
    await deleteGame(page, gameId);
  }
});

/* =====================================================================
   editor: audyt (familijna-server/docs/audyt-stron.md) -- regresje poprawionych błędów
   ===================================================================== */

async function newUserContext(browser, loginAs, identity, contextOptions = {}) {
  const ctx = await browser.newContext({ serviceWorkers: "block", ...contextOptions });
  await serveBranchCode(ctx, { pages: ["games/editor", "bases/explorer"] });
  const pg = await ctx.newPage();
  await loginAs(pg, ctx, identity);
  return { ctx, page: pg };
}

// Spowalnia wybrane żądania do Supabase (prawdziwy backend, tylko opóźnienie),
// żeby wyścigi "zapis w toku + kolejna akcja" były powtarzalne.
async function delayRequests(page, { path, method, ms, match = () => true }) {
  await page.route(`**/rest/v1/${path}*`, async (route) => {
    const req = route.request();
    if (req.method() === method && match(req.url())) await new Promise((r) => setTimeout(r, ms));
    await route.fallback();
  });
}

// Zapis treści gry: endpoint game_content_apply (migracja 534).
const isContentSave = (res) => res.url().includes("/rest/v1/rpc/game_content_apply") && res.request().method() === "POST";

async function seedPrepared(page, gameId, questions) {
  const ids = [];
  for (let i = 0; i < questions.length; i++) {
    const [text, answers = []] = questions[i];
    const qId = await addQuestionApi(page, gameId, i + 1, text);
    const aIds = [];
    for (let j = 0; j < answers.length; j++) {
      aIds.push(await addAnswerApi(page, qId, j + 1, answers[j][0], answers[j][1] ?? 0));
    }
    ids.push({ qId, aIds });
  }
  return ids;
}

test.describe("editor: audyt -- pisanie i zapisy", () => {

  test("pauza po spacji w treści pytania nie zjada spacji (autozapis nie nadpisuje pola)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId }] = await seedPrepared(page, gameId, [["Start"]]);
      await openEditor(page, gameId);
      const qText = page.locator("#qText");
      await expect(qText).toHaveValue("Start", { timeout: 15000 });

      await qText.click();
      await page.keyboard.press("Control+A");
      const saved = page.waitForResponse(isContentSave);
      await page.keyboard.type("Ala ");
      await saved; // autozapis po pauzie -- wcześniej wpisywał "Ala" (trim) z powrotem do pola
      await page.waitForTimeout(300);
      await page.keyboard.type("ma kota");
      await expect(qText).toHaveValue("Ala ma kota");

      await qText.blur();
      await expect.poll(async () => (await getQuestionsRows(page, gameId)).find((q) => q.id === qId).text,
        { timeout: 10000 }).toBe("Ala ma kota");
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("przełączenie pytania w trakcie zapisu nie przenosi tekstu do następnego pytania", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "poll_text" });
    try {
      const [{ qId: q1 }, { qId: q2 }] = await seedPrepared(page, gameId, [["Q1"], ["Q2"]]);
      await openEditor(page, gameId);
      const qText = page.locator("#qText");
      await expect(qText).toHaveValue("Q1", { timeout: 15000 });

      await delayRequests(page, { path: "questions", method: "PATCH", ms: 1500 });
      await qText.fill("Nowy tekst Q1");
      await qCard(page, 1).click(); // blur -> wolny zapis Q1 w tle
      await expect(qText).toHaveValue("Q2");
      await page.waitForTimeout(2500); // zapis Q1 już wrócił
      await expect(qText, "spóźniony zapis Q1 nie może wpisać swojego tekstu do pola Q2").toHaveValue("Q2");

      // wejście i wyjście z pola nie może zapisać tekstu Q1 do Q2
      await qText.click();
      await qText.blur();
      await page.waitForTimeout(2500);

      const qs = await getQuestionsRows(page, gameId);
      expect(qs.find((q) => q.id === q1).text).toBe("Nowy tekst Q1");
      expect(qs.find((q) => q.id === q2).text).toBe("Q2");
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("zapis punktów nie przebudowuje listy: kursor zostaje w następnym polu, wpisany tekst się zapisuje", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ aIds }] = await seedPrepared(page, gameId, [["Pytanie", [["A1"], ["A2"], ["A3"]]]]);
      await openEditor(page, gameId);
      await expect(aRows(page)).toHaveCount(3, { timeout: 15000 });
      await aRow(page, 1).evaluate((el) => { el.dataset.e2eMark = "1"; });

      await aRow(page, 0).locator(".qf-pts").fill("40");
      const next = aRow(page, 1).locator(".qf-text");
      await next.click(); // blur punktów -> zapis
      await page.keyboard.press("End");
      await page.keyboard.type("BC");
      await page.waitForTimeout(1500); // zapis punktów + autozapis tekstu

      await expect(next).toBeFocused();
      await expect(next).toHaveValue("A2BC");
      await expect(page.locator('#aList [data-e2e-mark="1"]'), "ten sam element wiersza (bez render())").toHaveCount(1);
      await expect(page.locator("#pointsRemainTop .qf-sum b")).toHaveText("40/100");
      await expect(qCard(page, 0).locator(".qmeta")).toContainText("40/100");

      await next.blur();
      const firstQ = (await getQuestionsRows(page, gameId))[0].id;
      await expect.poll(async () => {
        const rows = await getAnswersRows(page, firstQ);
        return [rows.find((a) => a.id === aIds[0]).fixed_points, rows.find((a) => a.id === aIds[1]).text];
      }, { timeout: 10000 }).toEqual([40, "A2BC"]);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("klik w kosz innej odpowiedzi zaraz po wpisaniu punktów działa za pierwszym razem", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId, aIds }] = await seedPrepared(page, gameId, [["Pytanie", [["A1"], ["A2"], ["A3"]]]]);
      await openEditor(page, gameId);
      await expect(aRows(page)).toHaveCount(3, { timeout: 15000 });

      await aRow(page, 0).locator(".qf-pts").fill("30");
      await aRow(page, 2).locator(".qf-del").click();
      await expect(page.locator(".uni-modal"), "potwierdzenie usunięcia po pierwszym kliknięciu").toBeVisible({ timeout: 5000 });
      await page.locator(".uni-foot .btn.gold:visible").click();
      await expect(aRows(page)).toHaveCount(2, { timeout: 10000 });

      const rows = await getAnswersRows(page, qId);
      expect(rows.map((a) => a.id)).toEqual([aIds[0], aIds[1]]);
      expect(rows[0].fixed_points).toBe(30);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("pole punktów: same cyfry, najwyżej 100, minus i puste dają 0", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId, aIds }] = await seedPrepared(page, gameId, [["Pytanie", [["A1", 5], ["A2"], ["A3"]]]]);
      await openEditor(page, gameId);
      const pts = aRow(page, 0).locator(".qf-pts");
      await expect(pts).toHaveValue("5", { timeout: 15000 });

      await pts.fill("250");
      await expect(pts).toHaveValue("100");
      await pts.fill("-7");
      await expect(pts).toHaveValue("0");
      await pts.fill("abc");
      await expect(pts).toHaveValue("");
      await pts.blur();
      await expect(pts).toHaveValue("0");
      await expect.poll(async () => (await getAnswersRows(page, qId)).find((a) => a.id === aIds[0]).fixed_points,
        { timeout: 10000 }).toBe(0);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("podwójny klik w 'Dodaj odpowiedź' i 'Dodaj pytanie' dodaje jedno, nie dwa", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId }] = await seedPrepared(page, gameId, [["Pytanie"]]);
      await openEditor(page, gameId);
      await expect(page.locator("#aList .qf-add")).toBeVisible({ timeout: 15000 });

      await page.locator("#aList .qf-add").dblclick();
      await page.waitForTimeout(2000);
      await expect(aRows(page)).toHaveCount(1);
      expect(await getAnswersRows(page, qId)).toHaveLength(1);

      await page.locator("#qList .addCard").dblclick();
      await page.waitForTimeout(2000);
      await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(2);
      expect(await getQuestionsRows(page, gameId)).toHaveLength(2);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("'Moje gry' zaraz po wpisaniu czeka na zapis zamiast go przerwać", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId }] = await seedPrepared(page, gameId, [["Stary tekst"]]);
      await openEditor(page, gameId);
      await expect(page.locator("#qText")).toHaveValue("Stary tekst", { timeout: 15000 });

      await delayRequests(page, { path: "questions", method: "PATCH", ms: 1500 });
      await page.locator("#qText").fill("Tekst przed wyjściem");
      await page.locator("#btnBack").click();
      await page.waitForURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 15000 });

      const qs = await getQuestionsRows(page, gameId);
      expect(qs.find((q) => q.id === qId).text).toBe("Tekst przed wyjściem");
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("szybkie klikanie pytań A -> B: spóźnione odpowiedzi A nie nadpisują B", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      const [{ qId: q1 }] = await seedPrepared(page, gameId, [["Q1", [["Q1-A"]]], ["Q2", [["Q2-A"]]], ["Q3", [["Q3-A"]]]]);
      await openEditor(page, gameId);
      await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("Q1-A", { timeout: 15000 });

      await qCard(page, 2).click();
      await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("Q3-A", { timeout: 10000 });

      // odpowiedzi Q1 przychodzą z opóźnieniem
      await delayRequests(page, { path: "answers", method: "GET", ms: 2000, match: (u) => u.includes(q1) });
      await qCard(page, 0).click();
      await qCard(page, 1).click();
      await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("Q2-A", { timeout: 10000 });
      await page.waitForTimeout(2500);
      await expect(page.locator("#qText")).toHaveValue("Q2");
      await expect(aRows(page)).toHaveCount(1);
      await expect(aRow(page, 0).locator(".qf-text")).toHaveValue("Q2-A");
    } finally {
      await deleteGame(page, gameId);
    }
  });
});

test.describe("editor: audyt -- import i wejście na stronę", () => {

  test("'Wczytaj plik' / wybór pliku wczytuje treść do pola i import działa", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      await openEditor(page, gameId);
      await page.locator("#btnImportTxt").click();
      await page.locator("#txtFile").setInputFiles({
        name: "pytania.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("#Pytanie z pliku\nSłoń /30\nŻyrafa /20\nLew /10\n", "utf8"),
      });
      await expect(page.locator("#txtTa")).toHaveValue(/#Pytanie z pliku/, { timeout: 5000 });
      await page.locator("#btnTxtImport").click();
      await page.locator(".uni-foot .btn.gold:visible").click();
      await expectImportDone(page);

      const qs = await getQuestionsRows(page, gameId);
      expect(qs.map((q) => q.text)).toEqual(["Pytanie z pliku"]);
      const as = await getAnswersRows(page, qs[0].id);
      expect(as.map((a) => [a.text, a.fixed_points])).toEqual([["Słoń", 30], ["Żyrafa", 20], ["Lew", 10]]);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("import jest jedną transakcją: błąd w połowie nie rusza starej zawartości (game_import_content)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      await seedPrepared(page, gameId, [["Stare 1", [["S1"]]], ["Stare 2", [["S2"]]]]);
      await openEditor(page, gameId);

      // drugie pytanie z pustą treścią -> CHECK questions_text_len (puste
      // odpowiedzi od E21/406 import po prostu pomija, więc nie wywołują błędu)
      const err = await page.evaluate(async (id) => {
        const { error } = await window.__sbClient.rpc("game_import_content", {
          p_game_id: id,
          p_name: "Nie zmieniaj nazwy",
          p_questions: [
            { text: "Nowe 1", answers: [{ text: "N1", points: 10 }] },
            { text: "", answers: [{ text: "N2", points: 10 }] },
          ],
        });
        return error?.message || null;
      }, gameId);
      expect(err, "baza musi odrzucić import").toBeTruthy();

      const qs = await getQuestionsRows(page, gameId);
      expect(qs.map((q) => q.text)).toEqual(["Stare 1", "Stare 2"]);
      expect((await getAnswersRows(page, qs[0].id)).map((a) => a.text)).toEqual(["S1"]);
      expect((await getGameRow(page, gameId)).name).not.toBe("Nie zmieniaj nazwy");
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("import przy otwartej ankiecie odrzuca baza (Warstwa 2 działa też dla RPC importu)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "poll_points" });
    try {
      await seedPollPointsFull(page, gameId);
      await openEditor(page, gameId);
      const game = await getGameRow(page, gameId);
      const err = await page.evaluate(async ({ id, key }) => {
        const sb = window.__sbClient;
        const open = await sb.rpc("poll_open", { p_game_id: id, p_key: key });
        if (open.error) throw new Error(open.error.message);
        const { error } = await sb.rpc("game_import_content", {
          p_game_id: id, p_name: null, p_questions: [{ text: "X", answers: [] }],
        });
        return error?.message || null;
      }, { id: gameId, key: game.share_key_poll });
      expect(err).toContain("game_content_locked:poll_open");
      expect(await getQuestionsRows(page, gameId)).toHaveLength(10);
    } finally {
      await deleteGame(page, gameId);
    }
  });

  test("nieistniejąca gra: komunikat zostaje do kliknięcia OK, potem powrót do listy gier", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    await page.goto("https://www.familijna.app/games/editor?id=00000000-0000-4000-8000-000000000000", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".uni-modal .mSub")).toHaveText("Ta gra nie istnieje albo nie masz do niej dostępu.", { timeout: 15000 });
    await expect(page).toHaveURL(/\/games\/editor/);
    await page.locator(".uni-foot .btn.gold:visible").click();
    await page.waitForURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 15000 });
  });

  test("usunięcie pytania: jedno RPC usuwa i przenumerowuje (bez dziur w numeracji)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const gameId = await createGame(page, { type: "prepared" });
    try {
      await seedPrepared(page, gameId, [["Q1"], ["Q2"], ["Q3"], ["Q4"]]);
      await openEditor(page, gameId);
      await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(4, { timeout: 15000 });

      const rpc = page.waitForResponse((r) => r.url().includes("/rpc/game_question_delete"));
      await qCard(page, 1).locator(".x").click();
      await page.locator(".uni-foot .btn.gold:visible").click();
      expect((await rpc).status()).toBe(200);
      await expect(page.locator("#qList .qcard:not(.addCard)")).toHaveCount(3, { timeout: 10000 });
      await expect(qCard(page, 2).locator(".qord")).toHaveText("Pytanie 3");

      const qs = await getQuestionsRows(page, gameId);
      expect(qs.map((q) => [q.ord, q.text])).toEqual([[1, "Q1"], [2, "Q3"], [3, "Q4"]]);
    } finally {
      await deleteGame(page, gameId);
    }
  });
});

/* ================= Modal pytania w bazie pytań: wspólny formularz ================= */

const BASE_URL = "https://www.familijna.app/bases/explorer";

async function createBase(page, name) {
  return await page.evaluate(async (name) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    const { data, error } = await sb.from("question_bases").insert({ name, owner_id: u.user.id }).select("id").single();
    if (error) throw new Error("insert question_bases: " + error.message);
    return data.id;
  }, name);
}

async function createBaseQuestion(page, baseId, payload) {
  return await page.evaluate(async ({ baseId, payload }) => {
    const { data, error } = await window.__sbClient.from("qb_questions")
      .insert({ base_id: baseId, ord: 1, payload }).select("id").single();
    if (error) throw new Error("insert qb_questions: " + error.message);
    return data.id;
  }, { baseId, payload });
}

async function getBaseQuestion(page, id) {
  return await page.evaluate(async (id) => {
    const { data, error } = await window.__sbClient.from("qb_questions").select("payload").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data?.payload || null;
  }, id);
}

async function deleteBase(page, baseId) {
  await page.evaluate(async (id) => {
    await window.__sbClient.from("question_bases").delete().eq("id", id);
  }, baseId);
}

async function openQuestionModal(page, baseId, qid) {
  await page.goto(`${BASE_URL}?id=${baseId}`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const row = page.locator(`#list .row[data-kind="q"][data-id="${qid}"]`);
  await expect(row).toBeVisible({ timeout: 15000 });
  await row.click();
  await expect(page.locator('#toolbar button[data-act="editQuestion"]')).toBeEnabled({ timeout: 5000 });
  await page.keyboard.press("Control+e");
  await expect(page.locator("#questionOverlay")).toBeVisible({ timeout: 5000 });
}

const mRows = (page) => page.locator("#qAnswers .qf-row:not(.qf-add)");

test.describe("editor: audyt -- modal pytania w bazie (ten sam formularz co edytor)", () => {

  test("ten sam układ co edytor: kafelek '+ Dodaj odpowiedź n/6', pasek SUMA, wiersze qf-row", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-LAYOUT-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, { text: "Pytanie", answers: [{ text: "A", fixed_points: 30 }, { text: "B", fixed_points: 20 }] });
      await openQuestionModal(page, baseId, qid);

      await expect(page.locator("#qAnswers .qf-add")).toHaveText(/Dodaj odpowiedź\s*2\/6/);
      await expect(mRows(page)).toHaveCount(2);
      await expect(mRows(page).first().locator(".qf-text")).toHaveValue("A");
      await expect(mRows(page).first().locator(".qf-pts")).toHaveValue("30");
      await expect(page.locator("#qSumPill b")).toHaveText("50/100");
      await expect(page.locator("#qText")).toHaveClass(/qf-qtext/);
    } finally {
      await deleteBase(page, baseId);
    }
  });

  test("usunięcie ze środka i dodanie nowej: numery odpowiedzi po kolei (bez duplikatu)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-ORD-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, {
        text: "Pytanie", answers: [{ ord: 1, text: "A1" }, { ord: 2, text: "A2" }, { ord: 3, text: "A3" }],
      });
      await openQuestionModal(page, baseId, qid);
      await mRows(page).nth(1).locator(".qf-del").click();
      await page.locator("#qAdd").click();
      await mRows(page).nth(2).locator(".qf-text").fill("A4");
      await Promise.all([page.waitForResponse((res) => res.url().includes("/rest/v1/rpc/qb_save_question")), page.locator("#qSave").click()]);
      await expect(page.locator("#questionOverlay")).toBeHidden({ timeout: 10000 });

      const payload = await getBaseQuestion(page, qid);
      expect(payload.answers.map((a) => [a.ord, a.text])).toEqual([[1, "A1"], [2, "A3"], [3, "A4"]]);
    } finally {
      await deleteBase(page, baseId);
    }
  });

  test("pusta odpowiedź blokuje zapis z komunikatem (wcześniej zapisywała się pusta)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-EMPTY-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, { text: "Pytanie", answers: [] });
      await openQuestionModal(page, baseId, qid);
      await page.locator("#qAdd").click();
      await page.locator("#qSave").click();
      await expect(page.locator("#qErr")).toHaveText("Odpowiedź 1 nie może być pusta.");
      await expect(page.locator("#questionOverlay")).toBeVisible();
      expect((await getBaseQuestion(page, qid)).answers).toHaveLength(0);
    } finally {
      await deleteBase(page, baseId);
    }
  });

  test("nieudany zapis zostawia modal otwarty z wpisaną treścią", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-FAIL-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, { text: "Stara treść", answers: [] });
      await openQuestionModal(page, baseId, qid);
      // Zapis pytania idzie przez funkcję SQL qb_save_question (migracja 427).
      await page.route("**/rest/v1/rpc/qb_save_question*", (route) => route.abort());
      await page.locator("#qText").fill("Nowa treść");
      await page.locator("#qSave").click();
      await expect(page.locator("#qErr")).toHaveText("Nie udało się zapisać pytania. Spróbuj ponownie.", { timeout: 10000 });
      await expect(page.locator("#questionOverlay")).toBeVisible();
      await expect(page.locator("#qText")).toHaveValue("Nowa treść");
      expect((await getBaseQuestion(page, qid)).text).toBe("Stara treść");
    } finally {
      await page.unroute("**/rest/v1/rpc/qb_save_question*");
      await deleteBase(page, baseId);
    }
  });

  test("zamknięcie ze zmianami pyta o porzucenie; bez zmian zamyka od razu", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-DIRTY-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, { text: "Treść", answers: [] });
      await openQuestionModal(page, baseId, qid);
      await page.locator("#qClose").click();
      await expect(page.locator("#questionOverlay")).toBeHidden({ timeout: 5000 });
      await expect(page.locator(".uni-modal")).toHaveCount(0);

      await page.locator(`#list .row[data-kind="q"][data-id="${qid}"]`).click();
      await page.keyboard.press("Control+e");
      await expect(page.locator("#questionOverlay")).toBeVisible({ timeout: 5000 });
      await page.locator("#qText").fill("Zmieniona");
      await page.locator("#qClose").click();
      await expect(page.locator(".uni-modal .mSub")).toHaveText("Porzucić niezapisane zmiany w pytaniu?");
      await page.locator(".uni-foot .btn:not(.gold)").click(); // Edytuj
      await expect(page.locator("#questionOverlay")).toBeVisible();
      await expect(page.locator("#qText")).toHaveValue("Zmieniona");

      await page.locator("#qClose").click();
      await page.locator(".uni-foot .btn.gold:visible").click(); // Porzuć
      await expect(page.locator("#questionOverlay")).toBeHidden({ timeout: 5000 });
      expect((await getBaseQuestion(page, qid)).text).toBe("Treść");
    } finally {
      await deleteBase(page, baseId);
    }
  });

  test("pole punktów jak w edytorze: 250 -> 100; przy 6 odpowiedziach kafelek dodawania wyłączony", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(60_000);
    await loginAs(page, context, accounts.standard[0]);
    const baseId = await createBase(page, `E2E-QF-PTS-${Date.now()}`);
    try {
      const qid = await createBaseQuestion(page, baseId, {
        text: "Pytanie", answers: Array.from({ length: 5 }, (_, i) => ({ text: `A${i + 1}` })),
      });
      await openQuestionModal(page, baseId, qid);
      await page.locator("#qAdd").click();
      await expect(page.locator("#qAdd")).toBeDisabled();
      await expect(page.locator("#qAdd")).toContainText("6/6");

      const pts = mRows(page).nth(5).locator(".qf-pts");
      await pts.fill("250");
      await expect(pts).toHaveValue("100");
      await expect(page.locator("#qSumPill b")).toHaveText("100/100");
    } finally {
      await deleteBase(page, baseId);
    }
  });
});

/* ================= Zrzuty ekranu nowego wyglądu (artefakt e2e-shots) ================= */

test.describe("editor: audyt -- zrzuty ekranu", () => {
  for (const [label, opts] of [
    ["desktop", { viewport: { width: 1280, height: 860 } }],
    ["mobile", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
  ]) {
    test(`zrzut: edytor i modal pytania (${label})`, async ({ browser, accounts, loginAs }, testInfo) => {
      test.setTimeout(90_000);
      const { ctx, page } = await newUserContext(browser, loginAs, accounts.standard[0], opts);
      const gameId = await createGame(page, { type: "prepared", name: `E2E-SHOT-${Date.now()}` });
      const baseId = await createBase(page, `E2E-SHOT-${Date.now()}`);
      try {
        await seedPrepared(page, gameId, [
          ["Co zabierasz na plażę?", [["Ręcznik", 35], ["Parasol", 25], ["Krem", 20], ["Książkę", 10]]],
          ["Najpopularniejsze zwierzę domowe?", [["Pies", 50], ["Kot", 40], ["Rybki", 20]]],
        ]);
        await openEditor(page, gameId);
        if (label === "mobile") await qCard(page, 0).click();
        await expect(aRows(page)).toHaveCount(4, { timeout: 15000 });
        await page.screenshot({ path: testInfo.outputPath(`shot-editor-${label}.png`) });

        const qid = await createBaseQuestion(page, baseId, {
          text: "Co zabierasz na plażę?",
          answers: [{ text: "Ręcznik", fixed_points: 35 }, { text: "Parasol", fixed_points: 25 }, { text: "Krem", fixed_points: 20 }, { text: "Książkę" }],
        });
        await openQuestionModal(page, baseId, qid);
        await page.screenshot({ path: testInfo.outputPath(`shot-modal-${label}.png`) });
      } finally {
        await deleteGame(page, gameId);
        await deleteBase(page, baseId);
        await ctx.close();
      }
    });
  }
});
