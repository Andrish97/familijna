const { expectMailDocument } = require("./helpers/mail-document");
// tests/e2e/control.spec.js
//
// Wszystkie testy E2E dla Control v2 w jednym pliku (na wyraźną prośbę —
// jeden plik zamiast kilku). Kolejne test() bloki, od najprostszego do
// najbardziej złożonego. Towarzyszy im pełny opis scenariuszy (co się klika,
// co ma pokazać każde urządzenie) w dokumencie "Rundown Control" — ten plik
// jest jego automatyczną, sprawdzalną częścią, nie zamiennikiem.
//
//   1. Parowanie urządzeń (D0/D1) — linki renderują się bez błędu, Control
//      widzi je jako online.
//   2. Pełna runda + wznowienie Control po przeładowaniu w środku rundy 2
//      (plan, sekcja 7 — to jest bezpośredni dowód na to, że hydrate()
//      faktycznie wznawia stan, zamiast go kasować jak dziś).
//   3. Mechanika rund poza ścieżką idealną: reset pojedynku obustronnym
//      pudłem, pass, kradzież wygrana/przegrana, odkrywanie reszty,
//      mnożnik, koniec gry bez finału + "Wróć do moich gier".
//   4. Finał: próg w rundzie -> finał, wczesne zakończenie po osiągnięciu
//      celu w połowie mapowania gracza 1 (pomija gracza 2 całkowicie).
//   5-7. Nietypowe zachowania operatora: physicalBuzzer + noHostTablet,
//      "Zacznij od nowa", druga karta Control blokowana (resource-lock).
//   8. QR host/buzzer niezależne na Display.
//   9. Finał BEZ wczesnego wyjścia — obaj gracze, wszystkie 10 pytań,
//       naturalne wygaśnięcie timera gracza 1, flaga "powtórzenie" u
//       gracza 2, i — najważniejsze — dowód, że odpowiedzi gracza 1
//       faktycznie wracają na Display I Host w momencie startu rundy 2
//       (dokładnie ta luka, która była naprawiana w tej sesji audytu).
//   10. Mnożnik rundy — runda 4. z ×2 faktycznie przemnaża bank.
//   11. Wyścig dwóch przycisków Buzzera naciśniętych w tej samej chwili —
//       tylko jeden zaakceptowany, oba urządzenia się zgadzają.
//   11b. Ponów naciśnięcie (RETRY_DUEL) — odrzuca błędne zgłoszenie,
//       Buzzer otwiera się na nowo.
//   12. Wyciszenie dźwięku — akcje dźwiękowe nadal się uruchamiają, ale
//       master gain jest wyciszony.
//   12b. Dźwięk ze źródła Wyświetlacz — odblokowanie, głośność z ustawień,
//       chwilowe mute w rundzie.
//   13. Zmiana języka propaguje się do Hosta, w tym samą TREŚĆ tytułu fazy
//       (nie tylko chrome strony) — regresja na dzisiejszą naprawę i18n.
//   14. Osobna strona ustawień gry — zmiana nazwy drużyny odświeża
//       zagnieżdżony podgląd Wyświetlacza, zapisuje się jawnie i wraca do
//       Control przez topbar.
//   15. Blokada logo — Control czeka, aż logo-editor.js zwolni logo
//       referencowane przez grę, wznawia się sam po zwolnieniu.
//   16. Udostępnianie urządzenia przez e-mail — realny mail + link, który
//       faktycznie łączy (@mailbox, osobny od zwykłego szybkiego cyklu).
//   17. Zerwanie i ponowne podłączenie — wszystkie trzy urządzenia tracą
//       połączenie naraz w środku rundy, operator odzyskuje je po kolei
//       przez modal kropki statusu, gra działa dalej na świeżych kartach.
//   18. Timery (3s decyzja w rundach / 15s-20s gracza w finale) wracają do
//       stanu SPRZED swojego startu, nie do stanu "po", gdy Control zastaje
//       je już wygasłe przy wznowieniu (zamknięcie/przeładowanie w trakcie
//       odliczania) — bez naliczenia X / bez trwałego zużycia jednorazowej
//       szansy gracza.
//
// Każdy test tworzy i kasuje własną grę testową — niezależne od siebie,
// można je uruchamiać pojedynczo (--grep) przy diagnozowaniu awarii.
//
// Obserwowalność dźwięku/Display: js/core/sfx.js's playSfx() zapisuje każde
// odtworzenie do window.__sfxLog, a control/display/js/main.js owija scene.api tak,
// że każde wywołanie (revealAnswerRow, setX, indicator.set, ...) ląduje w
// window.__displayLog — obie instrumentacje istnieją WYŁĄCZNIE do tych
// testów (patrz komentarze przy ich definicjach), zero wpływu na normalne
// działanie. Bez nich nie dałoby się z Playwrighta zweryfikować ani dźwięku
// (Web Audio nie zostawia śladu w DOM), ani tego, co dokładnie Display
// narysował (SVG dot-matrix, nie tekst).

const { test, expect } = require("./helpers/production-test");
const { serveBranchCode } = require("./helpers/branch-code");
test.use({ serviceWorkers: "block" });
// E25: konta wypożyczane na worker (tests/README.md „Test accounts”); Control
// i urządzenia to ciężki przebieg. Pocztę (i adres bez konta) wypożyczamy tylko,
// gdy przebieg obejmuje testy @mailbox: cały plik albo filtr z „mailbox”
// (E2E_SPEC_FILTER z workflow; lokalnie bez niej — zawsze).
const specFilter = process.env.E2E_SPEC_FILTER;
const mailNeeded = specFilter == null || !/(?:^|\s)(?:-g|--grep)[\s=]/.test(specFilter) || /mailbox/i.test(specFilter);
test.use({ needs: mailNeeded
  ? { standard: 2, noaccount: 1, resources: ["heavy", "mail"] }
  : { standard: 2, resources: ["heavy"] } });
test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE === "1") {
    await serveBranchCode(context, { pages: ["control", "settings", "games/settings", "go"] });
  }
});


// Urządzenie połączone (kropka „ok”): kanał realtime + obecność. Na produkcji
// pod obciążeniem łączenie trwało do ~13 s (przebieg 41929745543) — jeden
// próg dla całego speca zamiast mieszanki 5/15/20/30 s.
const DEVICE_OK_MS = 30000;

async function controlContext(browser, options = {}) {
  const context = await browser.newContext({ ...options, serviceWorkers: "block" });
  if (process.env.TEST_BRANCH_CODE === "1") {
    await serveBranchCode(context, { pages: ["control", "settings", "games/settings", "go"] });
  }
  return context;
}

// Pasek postępu Control rysuje „główny” i „szczegół” w osobnych spanach
// (bez „ — ” w tekście); pełna etykieta jest w atrybucie title.
function progressRe(x) {
  return x instanceof RegExp ? x : new RegExp(String(x).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("control2: TV odrzuca inne urządzenia, kod display otwiera nowy Wyświetlacz", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(120000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-TV-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const context = await controlContext(browser, { locale: "pl-PL", userAgent: "Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) TV Safari/537.36" });
  try {
    const codes = await page.evaluate(async (game) => {
      const result = {};
      for (const type of ["display", "host", "buzzer"]) {
        const { data, error } = await window.__sbClient.rpc("generate_device_connect_code", { p_game_id: game.id, p_device_type: type, p_share_key: game[`share_key_${type}`], p_game_name: "E2E-TV" });
        if (error || !data?.ok) throw new Error(error?.message || JSON.stringify(data));
        result[type] = data.code;
      }
      return result;
    }, game);
    const tv = await context.newPage();
    await tv.goto("https://www.familijna.app/");
    for (const type of ["host", "buzzer"]) {
      await tv.locator("#tvCode").fill(codes[type]);
      await tv.locator("#tvConnect").click();
      await expect(tv.locator("#tvMessage")).toContainText("nie jest kodem wyświetlacza");
      expect(new URL(tv.url()).pathname).toBe("/connect/");
    }
    await tv.locator("#tvCode").fill(codes.display);
    await tv.locator("#tvCode").press("Enter");
    await expect.poll(() => new URL(tv.url()).pathname).toBe("/control/display/");
    expect(new URL(tv.url()).searchParams.get("id")).toBe(game.id);
    await expect(tv.locator("#btnFullscreen")).toBeVisible();
    // The new Display remains directly accessible; its sound prompt works with TV OK.
    await tv.goto(`https://www.familijna.app/go/?d=display&id=${game.id}&key=${game.share_key_display}`);
    // Przy domyślnym źródle Control ekran odblokowania dźwięku na Display
    // pozostaje ukryty; pojawia się dopiero po wybraniu Display jako źródła.
    await expect(tv.locator("#audioUnlockScreen")).toBeHidden({ timeout: 15000 });
    await page.goto(`/control?id=${game.id}`);
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.locator('.toggle-item:has(input[name="soundSource"][value="display"])').click();
    await expect(tv.locator("#audioUnlockScreen")).toBeVisible({ timeout: 15000 });
    await expect(tv.locator("#btnAudioUnlock")).toBeFocused();
    await tv.keyboard.press("Enter");
    await expect(tv.locator("#audioUnlockScreen")).toBeHidden();
    await expect.poll(() => tv.evaluate(() => !!document.fullscreenElement)).toBe(true);
  } finally { await context.close(); await deleteGame(page, game.id); }
});

test("control2: własne outro ponad 30 sekund — ustawienia, zapis i podsumowanie", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(180000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-CUSTOM-OUTRO-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByLabel("Przycisk fizyczny").check();
    await page.getByLabel("Nie używaj tabletu prowadzącego").check();
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await expect(page.locator('.summarySoundRow:has(input[data-sfx-vol="show_outro"])')).toContainText("Muzyka outro programu");
    await expect(page.locator('.summarySoundRow:has(input[data-sfx-vol="reveal"])')).toContainText("Odsłanianie");
    await page.getByRole("button", { name: "Zmień ustawienia" }).click();
    // Zwykłe przejście na stronę ustawień (bez okna / iframe).
    await page.waitForURL(/\/games\/settings\//, { timeout: 15000 });
    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 15000 });
    await page.locator('.gs-sidebar-item[data-cat="sound"]').click();
    await expect(page.locator('.sfx-row[data-key="reveal"]')).toContainText("Odsłanianie");
    const fileInput = page.locator('input[data-sfx-key="show_outro"]');
    await expect(fileInput).toHaveAttribute("accept", "audio/mpeg,audio/wav,audio/ogg");
    // A real 31-second PCM WAV verifies the separate outro limit (>30s).
    const sampleRate = 8000;
    const samples = sampleRate * 31;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
    wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sampleRate) * 500), 44 + i * 2);
    await fileInput.setInputFiles({ name: "outro-test-31s.wav", mimeType: "audio/wav", buffer: wav });
    await expect(page.locator('.sfx-row:has(input[data-sfx-key="show_outro"]) .sfx-file-name')).toHaveText("outro-test-31s.wav", { timeout: 15000 });
    // Ustawienia zapisują się jawnie przyciskiem, a czyste wyjście wraca
    // bez ostrzeżenia o niezapisanych zmianach.
    await page.locator("#btnSaveAll").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "saved", { timeout: 30000 });
    await page.locator("#btnBack").click();
    // Control is intentionally opened by the production link as /control?id=…
    // (without a trailing slash); accept both canonical forms.
    await page.waitForURL(/\/control(?:\/|\?)/, { timeout: 30000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 15000 });
    const inspectAudio = () => page.evaluate(async () => {
      const resource = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname.endsWith("/shared/js/core/sfx.js"));
      if (!resource) return null;
      const sfx = await import(resource.name);
      return { duration: await sfx.getSfxDuration("show_outro"), playing: sfx.isSfxPlaying("show_outro") };
    });
    await expect.poll(async () => (await inspectAudio())?.duration, { timeout: 20000 }).toBeCloseTo(31, 1);
    const row = page.locator('.summarySoundRow:has(input[data-sfx-vol="show_outro"])');
    await row.locator(".summarySoundPlay").click();
    await expect.poll(async () => (await inspectAudio())?.playing, { timeout: 10000 }).toBe(true);
    await row.locator(".summarySoundPlay").click();
    await expect.poll(async () => (await inspectAudio())?.playing).toBe(false);
  } finally {
    await page.evaluate(async (gameId) => {
      const sb = window.__sbClient;
      if (!sb) return;
      const { data } = await sb.auth.getUser();
      if (!data.user) return;
      const { error } = await sb.storage.from("user-sounds").remove([`${data.user.id}/${gameId}/show_outro`]);
      if (error) throw new Error(error.message);
    }, game.id).catch((error) => console.warn("Custom outro cleanup:", error.message));
    for (const context of contexts) await context.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});
const { isKnownNoiseText, isKnownNoiseUrl } = require("./helpers/login");
const { clearMailbox, waitForEmail, extractHttpLinks, resetMailProviderLimits, readMailDelivery } = require("./helpers/mailbox");

test.setTimeout(150_000);

// ===== Pomocnicze =====

async function clearSfxLog(page) {
  await page.evaluate(() => { window.__sfxLog = []; });
}

async function getSfxKeys(page) {
  return page.evaluate(() => (window.__sfxLog || []).map((e) => e.key));
}

// Czeka, aż w __sfxLog pojawi się dana PODSEKWENCJA kluczy w tej kolejności
// (dopuszcza inne dźwięki między nimi) — używane zamiast sztywnego
// odliczania milisekund, bo dokładny odstęp między np. "final_theme" i
// "reveal" zależy od realnego czasu trwania pliku audio (getSfxDuration).
async function waitForSfxSequence(page, keys, timeout = 15000) {
  await expect.poll(async () => {
    const log = await getSfxKeys(page);
    let i = 0;
    for (const k of log) {
      if (k === keys[i]) i++;
      if (i === keys.length) return true;
    }
    return false;
  }, { timeout, message: `oczekiwano sekwencji dźwięków ${JSON.stringify(keys)}` }).toBe(true);
}

// Jak wyżej, ale bez wymogu kolejności — używane dla playSyncedCombo()
// (control/js/soundReactor.js), gdzie o tym, KTÓRY klucz gra pierwszy,
// decyduje realny czas trwania pliku audio (dłuższy zaczyna pierwszy),
// nie kolejność argumentów — asercja na sztywną kolejność byłaby fałszywie
// krucha względem samych plików dźwiękowych, nie logiki gry.
async function waitForSfxKeysAnyOrder(page, keys, timeout = 15000) {
  await expect.poll(async () => {
    const log = await getSfxKeys(page);
    return keys.every((k) => log.includes(k));
  }, { timeout, message: `oczekiwano kluczy dźwięku ${JSON.stringify(keys)} (w dowolnej kolejności)` }).toBe(true);
}

async function clearDisplayLog(displayPage) {
  await displayPage.evaluate(() => { window.__displayLog = []; });
}

// Kafelki odpowiedzi w Rundach (control/js/ui.js's renderRounds()) nie
// pokazują już "#N" — pokazują prawdziwy tekst odpowiedzi (i zmieniają się
// po odsłonięciu), więc nie da się ich stabilnie wybrać po treści. Kolejność
// w DOM jest za to stała: renderRounds() dopisuje kafelki odpowiedzi do
// tablicy `tiles` w kolejności `ord` PRZED kafelkami X/licznika/timera, więc
// n-ty (1-bazowy) przycisk w jedynym renderowanym `.c2-tilegrid` to zawsze
// odpowiedź o ord=n — dokładnie ten sam kafelek, który dawniej pokazywał
// tekst "#n".
function answerTile(page, n) {
  return page.locator(".c2-tilegrid button").nth(n - 1);
}

// Odpowiedź/X/"Oddaj kontrolę" idą przez zaznacz -> potwierdź
// (control/js/ui.js's armableTile): pierwsze kliknięcie tylko uzbraja
// (złota obwódka, zero zapisu — czysto lokalny "ui.rerender", bez sieci),
// drugie na TYM SAMYM elemencie faktycznie wysyła akcję (game.dispatch ->
// zapis do bazy). Locator jest "żywy" (przeliczany przy każdym użyciu),
// więc dwa kolejne .click() poprawnie trafiają w ten sam kafel mimo
// przebudowy DOM między nimi.
//
// Realny bug znaleziony na żywo (2026-09-11, "pełna runda"): Playwright's
// .click() wraca, gdy tylko zdarzenie DOM zostanie wysłane — NIE czeka na
// to, aż async handler w app.js skończy zapis do bazy i ui.js przebuduje
// DOM na podstawie potwierdzonego stanu. Pierwsza próba (czekanie aż
// klikany element zniknie z DOM) okazała się NIEWYSTARCZAJĄCA — kolejne
// wywołanie armAndConfirm mogło ruszyć, zanim POTWIERDZAJĄCY zapis
// faktycznie doleciał do serwera (dowód na żywo: druga i trzecia
// odpowiedź w rzędzie kończyły się tak, jakby to WCIĄŻ była ta sama, już
// uzbrojona odpowiedź z poprzedniego wywołania). Właściwy sygnał to sama
// odpowiedź sieciowa z RPC zapisu — dokładnie ten sam, sprawdzony wzorzec
// co record-playthrough.js's clickPaced/waitForWrite.
const WRITE_RPC_RE = /\/rpc\/(game_state_write|game_state_buzzer_press)(\?|$)/;

// Margines PO odebraniu odpowiedzi sieciowej: page.waitForResponse()
// rozstrzyga się, gdy CDP zobaczy odpowiedź na poziomie sieci — to NIE to
// samo co "JS na stronie zdążył już wywołać applyRow()/emit() i
// przemalować DOM" (osobny kanał komunikacji, bez gwarancji tej samej
// kolejki mikrozadań co strona). Krótki bufor eliminuje tę resztkową
// szczelinę zamiast dalej gonić rzadkie "prawie na czas" niedopasowania.
async function settleAfterWrite(page) {
  await page.waitForTimeout(150);
}

async function armAndConfirm(locator) {
  const page = locator.page();
  const mappingChoice = await locator.evaluate((el) => !!document.querySelector(".c2-mapinput") && /^(?:[1-6]|w|o|r)$/.test(el.dataset.shortcut || ""));
  if (mappingChoice) {
    const response = page.waitForResponse((resp) => WRITE_RPC_RE.test(resp.url()), { timeout: 15000 });
    await locator.click();
    await response; await settleAfterWrite(page); return;
  }
  await locator.click(); // uzbrojenie — lokalne, bez zapisu
  const responded = page.waitForResponse((resp) => WRITE_RPC_RE.test(resp.url()), { timeout: 15000 }).catch(() => null);
  await locator.click(); // potwierdzenie — faktyczny zapis do game_state
  await responded;
  await settleAfterWrite(page);
}

// Ten sam problem (klik wraca zanim zapis faktycznie dotarł do serwera)
// dotyczy KAŻDEGO klikniecia prowadzącego wprost do zapisu do game_state,
// nie tylko dwuklikowego armAndConfirm — np. zmiana języka UI to pojedynczy
// klik bez żadnej asercji po drodze do następnej akcji, więc ten sam wyścig.
async function clickConfirmed(locator) {
  const page = locator.page();
  const responded = page.waitForResponse((resp) => WRITE_RPC_RE.test(resp.url()), { timeout: 15000 }).catch(() => null);
  await locator.click();
  await responded;
  await settleAfterWrite(page);
}

async function revealAnswer(page, n) {
  await armAndConfirm(answerTile(page, n));
}

// DIAGNOSTYKA TYMCZASOWA — "pełna runda" wisi na "Zakończ rundę" bez
// żadnego błędu w konsoli nawet po naprawie stale_write i timingu
// armAndConfirm. console.log() z page.evaluate() NIE trafia do loga CI
// (tests/e2e/helpers/login.js's instrumentPage łapie tylko error/warning),
// więc to zwykłe console.log() PO STRONIE NODE (Playwright/test runner —
// leci prosto na stdout, widoczne w CI bez żadnego haka).
async function dumpControlState(page, label) {
  const stepper = await page.locator("#c2TopbarProgress").textContent().catch((e) => `<err: ${e.message}>`);
  const tiles = await page.locator(".c2-tilegrid button").allTextContents().catch((e) => [`<err: ${e.message}>`]);
  const endBtn = page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ });
  const endCount = await endBtn.count().catch(() => -1);
  const endVisible = endCount > 0 ? await endBtn.first().isVisible().catch(() => false) : false;
  const endEnabled = endVisible ? await endBtn.first().isEnabled().catch(() => false) : false;
  const bodyText = await page.locator("body").innerText().catch((e) => `<err: ${e.message}>`);
  console.log(`[diag:${label}] stepper=${JSON.stringify(stepper)} tiles=${JSON.stringify(tiles)} endRoundBtn(count=${endCount} visible=${endVisible} enabled=${endEnabled})`);
  console.log(`[diag:${label}] body(500)=${JSON.stringify(bodyText.slice(0, 500))}`);
}

function xTile(page) {
  return page.getByRole("button", { name: "X", exact: true });
}

async function clickX(page) {
  await armAndConfirm(xTile(page));
}

// Pytania rund z jedną prawdziwą odpowiedzią są dopełniane do 3 odpowiedzi
// (reguła play), więc po odsłonięciu jedynej odpowiedzi zostają nieodsłonięte
// "Pusta 2/3". Trzecie pudło (X) nie kończy już rundy, tylko otwiera
// kradzież drużyny przeciwnej; dopiero jej pudło (czwarty X) odblokowuje
// "Zakończ rundę" i zostawia bank przy drużynie prowadzącej.
async function strikeOutAndLoseSteal(page) {
  await clickX(page);
  await clickX(page);
  await clickX(page);
  await clickX(page);
}

// "Zakończ rundę" przy nieodsłoniętych odpowiedziach ("Pusta 2/3" z dopełnienia
// makeGame) nie kończy rundy od razu, tylko wchodzi w R8 (odkrywanie reszty):
// dopiero po odsłonięciu wszystkiego odblokowuje się kontekstowy przycisk
// ("Przejdź do następnej rundy" / "Przejdź do finału"). Wyjątek: gdy cel to
// koniec gry, END_ROUND finalizuje rundę od razu (engine.js, GAME_END).
async function endRoundAndRevealRest(page, nextButtonName, restOrds = [2, 3]) {
  await clickConfirmed(page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }));
  for (const ord of restOrds) {
    await expect(answerTile(page, ord)).toBeEnabled({ timeout: 20000 });
    await revealAnswer(page, ord);
  }
  const next = page.getByRole("button", { name: nextButtonName });
  await expect(next).toBeEnabled({ timeout: 10000 });
  await next.click();
}

// "Rozpocznij rundę" po R8 bywa klikany w chwili, gdy akcja gry jest jeszcze
// odrzucana przez busy() w handle() (dźwięk/blokada kończą się tuż po
// odświeżeniu przycisku) — wtedy START_ROUND po cichu nie idzie, a Buzzer
// zostaje na stanie poprzedniej rundy (zapalony przycisk zwycięzcy, disabled).
// Klik jest powtarzany, aż Control faktycznie wyjdzie z ekranu startu rundy.
async function startRoundConfirmed(page) {
  const start = page.getByRole("button", { name: "Rozpocznij rundę" });
  for (let attempt = 0; attempt < 4; attempt++) {
    // Pierwsza runda odblokowuje się po intro (32 s).
    await start.click({ timeout: 45000 });
    try {
      await expect(start).toHaveCount(0, { timeout: 8000 });
      return;
    } catch (e) {
      if (attempt === 3) throw e;
    }
  }
}

// Symuluje gest przesunięcia (peek) na Hoście — control/host/js/main.js's
// setupPeekSwipe(): pointerdown -> pointerup w odległości >= 60px, lokalnie
// pokazuje treść pod zasłoną pasma 2, BEZ żadnego zapisu do game_state.
// Ten sam helper co tests/e2e/record-playthrough.js's hostPeekSwipe
// (świadomie zduplikowany, nie importowany -- record-playthrough.js to
// osobny skrypt nagrania, nie biblioteka współdzielona z testami). Zasłona
// jest jednokierunkowa W SILNIKU (state.host.covered nigdy nie wraca na
// false samo) -- to NIE jest bug do naprawienia nową logiką w Control;
// jedyny sposób odsłonięcia to właśnie ten gest NA URZĄDZENIU Hosta, i to
// TEST ma go wykonywać, żeby to pokryć, nie panel.
async function hostPeekSwipe(hostPage) {
  await hostPage.mouse.move(300, 220);
  await hostPage.mouse.down();
  await hostPage.mouse.move(300, 360, { steps: 10 });
  await hostPage.mouse.up();
}

async function getDisplayCalls(displayPage, filterPrefix = "") {
  return displayPage.evaluate((prefix) => (window.__displayLog || [])
    .filter((e) => e.call.startsWith(prefix))
    .map((e) => ({ call: e.call, args: e.args })), filterPrefix);
}

async function expectMappingFieldFits(page, testInfo, label) {
  await expect(page.locator(".c2-mapinput input")).toBeVisible();
  const geometry = await page.locator(".c2-mapinput").evaluate((tile) => {
    const box = tile.getBoundingClientRect();
    const input = tile.querySelector("input").getBoundingClientRect();
    const column = tile.querySelector(".c2-mapinput-labelcol").getBoundingClientRect();
    const caption = tile.querySelector(".c2-field-label").getBoundingClientRect();
    const card = document.querySelector(".c2-gameplay-card").getBoundingClientRect();
    const main = document.querySelector(".c2-roundlayout-main").getBoundingClientRect();
    const ancestors = ["html", "body", ".wrap.wide", ".shell", ".control-tabs-card", ".control-main-card", "#app", ".c2-gameplay-card", ".c2-roundlayout"]
      .map((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { selector, missing: true };
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const parent = el.parentElement;
        const parentRect = parent?.getBoundingClientRect();
        return { selector, className: typeof el.className === "string" ? el.className : "", x: rect.x, width: rect.width, offsetLeft: el.offsetLeft, offsetWidth: el.offsetWidth, scrollLeft: el.scrollLeft, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, offsetParent: el.offsetParent?.className || el.offsetParent?.tagName || null, parentX: parentRect?.x ?? null, parentWidth: parentRect?.width ?? null, marginLeft: style.marginLeft, marginRight: style.marginRight, paddingLeft: style.paddingLeft, boxSizing: style.boxSizing, position: style.position, left: style.left, right: style.right, transform: style.transform, display: style.display, flex: style.flex, flexBasis: style.flexBasis, alignItems: style.alignItems, alignSelf: style.alignSelf, direction: style.direction, overflow: style.overflow, overflowY: style.overflowY, scrollbarGutter: style.scrollbarGutter };
      });
    return { top: input.top - box.top, bottom: box.bottom - input.bottom, right: box.right - input.right, centered: Math.abs((column.left + column.right) / 2 - (caption.left + caption.right) / 2), horizontalOverflow: tile.scrollWidth - tile.clientWidth, cardX: card.x, cardRight: card.right, viewportWidth: document.documentElement.clientWidth, cardWidth: card.width, mainX: main.x, mainRight: main.right, mainWidth: main.width, windowWidth: innerWidth, scrollX, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, ancestors };
  });
  expect(geometry.top).toBeGreaterThanOrEqual(5);
  expect(geometry.bottom).toBeGreaterThanOrEqual(5);
  expect(geometry.right).toBeGreaterThanOrEqual(5);
  expect(geometry.centered).toBeLessThanOrEqual(1);
  expect(geometry.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(geometry.cardX).toBeGreaterThanOrEqual(0);
  expect(geometry.cardRight).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.mainX).toBeGreaterThanOrEqual(geometry.cardX);
  expect(geometry.mainRight).toBeLessThanOrEqual(geometry.cardRight);
  if (label === "p1") await page.evaluate((rect) => { window.__p1MappingLayout = rect; }, geometry);
  if (label === "p2") {
    const p1 = await page.evaluate(() => window.__p1MappingLayout);
    await page.screenshot({ path: testInfo.outputPath("shot-mapping-p2.png") });
    const detail = `P1=${JSON.stringify(p1)} P2=${JSON.stringify(geometry)}`;
    expect(Math.abs(geometry.cardX - p1.cardX), `karta nie może przesuwać się w mapowaniu gracza 2; ${detail}`).toBeLessThan(1);
    expect(Math.abs(geometry.cardWidth - p1.cardWidth), `szerokość karty musi być stała między graczami; ${detail}`).toBeLessThan(1);
    expect(Math.abs(geometry.mainX - p1.mainX), `lewa kolumna mapowania nie może przesuwać się między graczami; ${detail}`).toBeLessThan(1);
    expect(Math.abs(geometry.mainWidth - p1.mainWidth), `szerokość kolumny mapowania musi być stała między graczami; ${detail}`).toBeLessThan(1);
  }
  await page.screenshot({ path: testInfo.outputPath(`shot-mapping-${label}.png`) });
}

test("control2: intro logo i natychmiastowe światło Buzzera przed wysyłką", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(120000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-INTRO-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [], errors = [];
  let releasePress;
  try {
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(displayPage.locator("#blackScreen")).toBeVisible();
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await expect(displayPage.locator("#blackScreen")).toBeVisible();
    await clearDisplayLog(displayPage);
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij grę", exact: true })).toBeVisible();
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.big.clear")).length).toBeGreaterThan(0);
    expect(await getDisplayCalls(displayPage, "api.logo.show")).toEqual([]);
    await expect(displayPage.locator("#gameScreen")).toBeVisible();
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.small.long1")).at(-1)?.args[0]).toBe("Alfa");
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.small.leftDigits")).at(-1)?.args[0]).toBe("");
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.small.rightDigits")).at(-1)?.args[0]).toBe("");
    await expect(buzzerPage.locator("#btnA")).toBeVisible();
    await expect(buzzerPage.locator("#btnB")).toBeVisible();
    await expect(buzzerPage.locator("#btnA")).toBeDisabled();
    await expect(buzzerPage.locator("#btnB")).toBeDisabled();
    await clearSfxLog(page);
    await page.getByRole("button", { name: "Rozpocznij grę", exact: true }).click();
    // Intro „Klasyczne” trwa 32 s (nagranie z 2026-10-28), reveal gra po nim.
    await waitForSfxKeysAnyOrder(page, ["show_intro", "reveal"], 45000);
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.logo.show")).at(-1)?.args[0]?.ms || 0).toBeGreaterThan(14);
    await expect(page.getByRole("button", { name: "Rozpocznij rundę", exact: true })).toBeEnabled({ timeout: 22000 });
    await displayPage.screenshot({ path: testInfo.outputPath("shot-intro-logo.png") });
    // Od fencingu lease (372/374) RPC urządzenia najpierw sprawdza lease;
    // wywołanie bez niego dostaje "forbidden", zanim dojdzie do blokady.
    // Lease bierzemy z prawdziwego heartbeatu Buzzera (co 3 s), przed startem rundy.
    const buzzerLease = (await buzzerPage.waitForRequest(req => req.url().includes("/rpc/control_device_instance_heartbeat"), { timeout: 10000 })).postDataJSON();
    const roundWrite = page.waitForResponse(resp => WRITE_RPC_RE.test(resp.url()));
    await page.getByRole("button", { name: "Rozpocznij rundę", exact: true }).click();
    const written = await (await roundWrite).json();
    expect(Date.parse(written.locked_until)).toBeGreaterThan(Date.now());
    const premature = await buzzerPage.evaluate(async ({id,key,lease}) => {
      const result = await window.__sbClient.rpc("game_state_buzzer_press", {
        p_game_id:id, p_key:key, p_team:"A", p_connection_id:lease.p_connection_id, p_epoch:lease.p_epoch,
      });
      return { error: result.error?.message, pressed: result.data?.detail?.rounds?.duel?.lastPressed };
    }, {id:game.id,key:game.share_key_buzzer,lease:buzzerLease});
    expect(premature.error).toContain("locked");
    expect(premature.pressed).toBeFalsy();
    await expect(buzzerPage.locator("#btnA")).toBeEnabled({ timeout: 15000 });

    // Pause only the outgoing request; continue it to the real production RPC.
    // This proves the light appears before the network can return a winner.
    const held = new Promise((resolve) => { releasePress = resolve; });
    let requests = 0;
    await buzzerPage.route("**/rpc/game_state_buzzer_press", async (route) => { requests++; await held; await route.continue(); });
    await clearSfxLog(page);
    await buzzerPage.locator("#btnA").click();
    await expect(buzzerPage.locator("#btnA")).toHaveClass(/\blit\b/);
    await expect(buzzerPage.locator("#btnB")).toBeDisabled();
    await expect.poll(() => requests).toBe(1);
    expect(await page.getByRole("button", { name: "Zatwierdź: Alfa" }).count()).toBe(0);
    const response = buzzerPage.waitForResponse((res) => res.url().includes("/rpc/game_state_buzzer_press"));
    releasePress();
    expect((await response).ok()).toBe(true);
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 15000 });
    await waitForSfxSequence(page, ["buzzer_press"]);
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    expect((await getSfxKeys(page)).filter((key) => key === "buzzer_press")).toHaveLength(1);
    await expect(buzzerPage.locator("#btnA")).toHaveClass(/\blit\b/);
    expect(errors).toEqual([]);
  } finally {
    releasePress?.();
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// Blokada stanu "play" (guardGameState, reguła game_validate): gra musi mieć
// co najmniej 10 pytań, każde z 3-6 odpowiedziami i sumą punktów <= 100.
// Testy budują małe gry, więc makeGame dopełnia je pytaniami-wypełniaczami
// (ord 200+, poza rundami i finałem) oraz dopełnia odpowiedzi pytań rund
// zerowymi odpowiedziami do 3. Zamierzony przepływ pytań zostaje, bo
// padGame przypina pytania rund trybem "pick" (settings.questions.rounds),
// więc losowanie nie dobiera wypełniaczy.
async function padGame(page, gameId) {
  await page.evaluate(async (gid) => {
    const sb = window.__sbClient;
    const { data: qs, error: qErr } = await sb.from("questions").select("id, text, ord").eq("game_id", gid).order("ord");
    if (qErr) throw new Error("padGame read questions: " + qErr.message);
    for (let i = 0; (qs.length + i) < 10; i++) {
      const { data: fq, error: fqErr } = await sb.from("questions")
        .insert({ game_id: gid, ord: 200 + i, text: `Pytanie dopełniające ${i + 1}` }).select("id").single();
      if (fqErr) throw new Error("padGame insert question: " + fqErr.message);
      const { error: faErr } = await sb.from("answers").insert([
        { question_id: fq.id, ord: 1, text: "Wypełniacz A", fixed_points: 40 },
        { question_id: fq.id, ord: 2, text: "Wypełniacz B", fixed_points: 30 },
        { question_id: fq.id, ord: 3, text: "Wypełniacz C", fixed_points: 20 },
      ]);
      if (faErr) throw new Error("padGame insert answers: " + faErr.message);
    }
    const rounds = qs.filter((q) => q.ord < 100).map((q) => ({ id: q.id, text: q.text }));
    if (!rounds.length) return;
    const { data: cur, error: cErr } = await sb.from("games").select("settings").eq("id", gid).single();
    if (cErr) throw new Error("padGame read settings: " + cErr.message);
    const st = cur.settings || {};
    st.game = { ...(st.game || {}), roundsQuestionsMode: "pick" };
    st.questions = { final: st.questions?.final || [], rounds };
    const { error: uErr } = await sb.from("games").update({ settings: st }).eq("id", gid);
    if (uErr) throw new Error("padGame update settings: " + uErr.message);
  }, gameId);
}

async function makeGame(page, name, opts = {}) {
  const g = await makeGameRaw(page, name, opts);
  await padGame(page, g.id);
  const keys = await page.evaluate(async (gameId) => {
    const sb = window.__sbClient;
    const { data: session, error: sessionError } = await sb.rpc("control_runtime_session_touch_v2", {
      p_game_id: gameId, p_session_id: null,
    });
    if (sessionError || !session?.ok) throw new Error(sessionError?.message || session?.error || "Control runtime session failed");
    const result = {};
    for (const type of ["display", "host", "buzzer"]) {
      const { data, error } = await sb.rpc("control_runtime_device_link", { p_game_id: gameId, p_device_type: type });
      if (error || !data?.ok) throw new Error(error?.message || data?.error || `Device token failed: ${type}`);
      result[type] = data.token;
    }
    return result;
  }, g.id);
  // Existing fixture call sites use these names to build device URLs; return
  // only session-bound link tokens, never games.share_key_*.
  return { ...g, share_key_display: keys.display, share_key_host: keys.host, share_key_buzzer: keys.buzzer };
}

async function makeGameRaw(page, name, { settings = {}, roundQuestions = [], finalAnswerPts = null } = {}) {
  return page.evaluate(async ({ name, settings, roundQuestions, finalAnswerPts }) => {
    // js/pages/editor.js's clip17()/normQ() clip answer/question text
    // client-side before a real user's save ever reaches the DB (maxlength=17
    // on the input, same limit here) — the DB's CHECK constraint is a second
    // line of defense, not the primary UX. Ten test wstawia bezpośrednio przez
    // Supabase, z pominięciem tego UI, więc musi sam sobie zrobić to samo
    // obcięcie, żeby literał wpisany tutaj nigdy nie wywalał 400 z bazy.
    const clip17 = (s) => String(s ?? "").trim().slice(0, 17);
    const clip200 = (s) => String(s ?? "").trim().slice(0, 200);

    const sb = window.__sbClient;
    const { data: userData } = await sb.auth.getUser();
    const { data: g, error: gErr } = await sb
      .from("games")
      .insert({
        name, owner_id: userData.user.id, type: "prepared", status: "ready",
        settings: { teams: { teamA: "Alfa", teamB: "Beta" }, game: { hasFinal: false }, ...settings },
      })
      .select("id, share_key_display, share_key_host, share_key_buzzer")
      .single();
    if (gErr) throw new Error("insert games failed: " + gErr.message);

    for (const q of roundQuestions) {
      // reguła play (E21): min. 3 odpowiedzi po ≥4 pkt, suma ≤100 — dopełnienie po 4 pkt
      q.answers = [...q.answers];
      while (q.answers.length < 3) q.answers.push({ ord: q.answers.length + 1, text: `Pusta ${q.answers.length + 1}`, fixed_points: 4 });
      const { data: qRow, error: qErr } = await sb
        .from("questions").insert({ game_id: g.id, ord: q.ord, text: clip200(q.text) }).select("id").single();
      if (qErr) throw new Error("insert questions failed: " + qErr.message);
      const { error: aErr } = await sb.from("answers").insert(
        q.answers.map((a) => ({ ...a, question_id: qRow.id, text: clip17(a.text) }))
      );
      if (aErr) throw new Error("insert answers failed: " + aErr.message);
    }

    let finalPicked = [];
    if (finalAnswerPts) {
      for (let i = 1; i <= 5; i++) {
        const { data: fq, error: fqErr } = await sb
          .from("questions").insert({ game_id: g.id, ord: 100 + i, text: clip200(`Pytanie finałowe ${i}`) }).select("id").single();
        if (fqErr) throw new Error("insert final question failed: " + fqErr.message);
        const { error: faErr } = await sb.from("answers").insert([
          { question_id: fq.id, ord: 1, text: clip17("Odp. finałowa"), fixed_points: finalAnswerPts },
          // reguła play (E21): min. 3 odpowiedzi po ≥4 pkt na każde pytanie (także finałowe)
          { question_id: fq.id, ord: 2, text: clip17("Pusta 2"), fixed_points: 4 },
          { question_id: fq.id, ord: 3, text: clip17("Pusta 3"), fixed_points: 4 },
        ]);
        if (faErr) throw new Error("insert final answer failed: " + faErr.message);
        finalPicked.push({ id: fq.id });
      }
      const { error: upErr } = await sb.from("games").update({
        settings: {
          teams: { teamA: "Alfa", teamB: "Beta" },
          ...settings,
          game: { ...settings.game, hasFinal: true, finalQuestionsMode: "pick" },
          questions: { final: finalPicked, rounds: [] },
        },
      }).eq("id", g.id);
      if (upErr) throw new Error("update final settings failed: " + upErr.message);
    }

    return g;
  }, { name, settings, roundQuestions, finalAnswerPts });
}

const statisticsGameIds = new Set();

async function deleteGame(page, gameId) {
  if (process.env.KEEP_STATISTICS_GAMES === "1" && statisticsGameIds.has(gameId)) {
    console.log(`[statistics-review] kept production game ${gameId}`);
    return;
  }
  await page.evaluate(async (gid) => {
    const sb = window.__sbClient;
    await sb.from("games").delete().eq("id", gid);
  }, gameId).catch(() => {});
}

async function deleteStaleReconnectTestGames(page) {
  const removed = await page.evaluate(async () => {
    const sb = window.__sbClient;
    const { data, error } = await sb.from("games").select("id").like("name", "E2E-CONTROL2-RECONNECT-%");
    if (error) throw new Error("find stale reconnect test games: " + error.message);
    const ids = (data || []).map(row => row.id);
    if (!ids.length) return 0;
    const { error: deleteError } = await sb.from("games").delete().in("id", ids);
    if (deleteError) throw new Error("delete stale reconnect test games: " + deleteError.message);
    return ids.length;
  });
  if (removed) console.log(`[statistics-review] removed ${removed} stale reconnect test game(s)`);
}

async function readControl2Sessions(page, gameId) {
  statisticsGameIds.add(gameId);
  return page.evaluate(async (gid) => {
    const { data, error } = await window.__sbClient.from("game_sessions")
      .select("id,status,ended_at,rounds_played,rounds_score_a,rounds_score_b,team_a_score,team_b_score,final_points,stats_detail")
      .eq("game_id", gid).eq("control_version", 2).order("started_at");
    if (error) throw new Error("read production statistics: " + error.message);
    // Zdarzenia sesji są w osobnej tabeli (migracja 468), nie w stats_detail.
    const events = await window.__sbClient.rpc("control2_owner_session_events", { p_game_id: gid });
    if (events.error) throw new Error("read session events: " + events.error.message);
    return data.map(row => ({ ...row, stats_detail: { ...row.stats_detail, events: events.data?.[row.id] || [] } }));
  }, gameId);
}

async function attachStatistics(testInfo, label, rows) {
  const name = `statistics-${label}.json`;
  const path = testInfo.outputPath(name);
  await require("node:fs/promises").writeFile(path, JSON.stringify(rows, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}





function trackErrors(p, label, bucket) {
  p.on("pageerror", (err) => bucket.push(`${label}: ${err.message}`));
}

const TWO_QUESTIONS = [
  { ord: 1, text: "Pytanie testowe 1", answers: [
    { ord: 1, text: "Odpowiedź A", fixed_points: 40 },
    { ord: 2, text: "Odpowiedź B", fixed_points: 30 },
    { ord: 3, text: "Odpowiedź C", fixed_points: 20 },
  ] },
  { ord: 2, text: "Pytanie testowe 2", answers: [
    { ord: 1, text: "Odpowiedź A", fixed_points: 40 },
    { ord: 2, text: "Odpowiedź B", fixed_points: 30 },
    { ord: 3, text: "Odpowiedź C", fixed_points: 20 },
  ] },
];

// DIAGNOSTYKA TYMCZASOWA — do teraz TYLKO strona Control (authenticated)
// miała jakąkolwiek widoczność RPC (tests/e2e/helpers/login.js's
// instrumentPage) -- Buzzer/Host/Display (anon, otwierane tu) były całkowicie
// nieme w logu CI. Znalezione na żywo: test #2 wisi 10s na "Zatwierdź: Alfa"
// po kliknięciu "Przycisk A" na Buzzerze, zero game_state_buzzer_press w
// logu -- ale bez tego nie da się rozstrzygnąć, czy to dlatego, że RPC
// faktycznie się nie wystrzeliło (press()'s wewnętrzny guard
// deriveButtonState()!==ON go zablokował), czy wystrzeliło i dostało błąd,
// czy wystrzeliło OK ale dzwonek/hydrate po stronie Control zgubił
// potwierdzenie. Etykieta z `label` odróżnia urządzenia w jednym logu.
function instrumentAnon(p, label) {
  // Nawigacje urządzenia (go → strona urządzenia, przeładowania) — sama ścieżka.
  const t0 = Date.now();
  p.on("framenavigated", (frame) => {
    if (frame === p.mainFrame()) console.log(`[e2e-diag:${label}] nav +${Date.now() - t0}ms ${new URL(frame.url()).pathname}`);
  });
  p.on("pageerror", (err) => console.log(`[e2e-diag:${label}] pageerror`, String(err?.message || err).slice(0, 300)));
  p.on("console", (msg) => {
    if ((msg.type() === "error" || msg.type() === "warning") && !isKnownNoiseText(msg.text())) {
      console.log(`[e2e-diag:${label}] console:${msg.type()}`, msg.text());
    } else if (msg.type() === "info" && msg.text().startsWith("[device-realtime]")) {
      console.log(`[e2e-diag:${label}]`, msg.text().slice(0, 400));
    }
  });
  p.on("response", (res) => {
    if (res.url().includes("/functions/v1/device-realtime-token")) {
      if (res.status() >= 400) {
        res.json().then(({ code, message, details }) => console.log(`[e2e-diag:${label}] realtime-token error:`, JSON.stringify({ status: res.status(), code, message, details })))
          .catch(() => console.log(`[e2e-diag:${label}] realtime-token error body unavailable`, res.status()));
      } else console.log(`[e2e-diag:${label}] realtime-token HTTP`, res.status());
    }
    if (res.url().includes("/rpc/")) {
      console.log(`[e2e-diag:${label}] rpc ${res.status()}`, res.url());
    }
    if (res.url().includes("/rpc/game_state_buzzer_press")) {
      res.text().then((body) => console.log(`[e2e-diag:${label}] buzzer_press ->`, body))
        .catch((e) => console.log(`[e2e-diag:${label}] buzzer_press body read failed:`, e.message));
    }
  });
  p.on("requestfailed", (req) => {
    if (isKnownNoiseUrl(req.url())) return;
    console.log(`[e2e-diag:${label}] requestfailed`, req.failure()?.errorText, req.url());
  });
}

async function openAnon(browser, contexts, path, label, errors, { onPage } = {}) {
  const devicePaths = { "/control/display": "display", "/control/host": "host", "/control/buzzer": "buzzer" };
  const parsed = new URL(path, "https://www.familijna.app");
  const deviceType = devicePaths[parsed.pathname.replace(/\/$/, "")];
  if (deviceType && !parsed.searchParams.has("preview")) {
    parsed.pathname = "/go/";
    parsed.searchParams.set("d", deviceType);
    path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  }
  // Host and Buzzer require touch-capable devices. Simulate a large tablet
  // for device pages so the shared viewport guard exercises the actual app,
  // instead of leaving those pages behind the desktop/touch warning overlay.
  const ctx = await controlContext(browser, deviceType ? {
    hasTouch: true,
    viewport: { width: 1366, height: 1024 },
  } : {});
  contexts.push(ctx);
  const p = await ctx.newPage();
  await onPage?.(p);
  trackErrors(p, label, errors);
  instrumentAnon(p, label);
  await p.goto(path, { waitUntil: "domcontentloaded" });
  // /go/ przekierowuje na stronę urządzenia po control_device_share_resolve;
  // bez czekania evaluate trafiał w przerwaną nawigację („Execution context
  // was destroyed”, przebiegi 2029/40145858490).
  if (deviceType && parsed.pathname === "/go/") {
    await p.waitForURL((url) => url.pathname.startsWith(`/control/${deviceType}`), { waitUntil: "domcontentloaded", timeout: 20000 });
  }
  return p;
}

// ===== 1. Parowanie urządzeń =====

// Diagnostyka mieszczenia listy urządzeń: wysokości kontenerów i wierszy (bez treści).
async function devicesFitDiag(page) {
  return page.evaluate(() => {
    const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    const area = document.querySelector(".c2-devices-layout .c2-scroll-area");
    const rows = [...document.querySelectorAll(".c2-devicerows > *")].map((r) => [r.className.split(" ")[0], h(r), [...r.children].map((c) => `${String(c.className).split(" ")[0]}:${h(c)}`).join(",")]);
    return JSON.stringify({ vw: innerWidth, vh: innerHeight, sh: area?.scrollHeight, ch: area?.clientHeight, layout: h(document.querySelector(".c2-devices-layout")), foot: h(document.querySelector(".stepFoot")), side: h(document.querySelector(".c2-roundlayout-side")), topbar: h(document.querySelector(".topbar")), card: h(document.querySelector(".control-main-card")), rows });
  });
}

test("control2: parowanie urządzeń — linki renderują się bez błędu, Control widzi je jako online", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-PAIRING-${Date.now()}`, {
    settings: { game: { hasFinal: true, roundsQuestionsMode: "pick", finalQuestionsMode: "random", advanced: { finalTarget: 250 } } },
    roundQuestions: Array.from({ length: 6 }, (_, i) => ({
      ord: i + 1,
      text: `Pytanie rundy ${i + 1}`,
      answers: [{ ord: 1, text: `Odp. ${i + 1}`, fixed_points: 10 }],
    })),
  });
  await page.evaluate(async (gameId) => {
    const sb = window.__sbClient;
    const { data: questions, error: readError } = await sb.from("questions").select("id, text, ord").eq("game_id", gameId).lt("ord", 100).order("ord");
    if (readError) throw new Error(readError.message);
    const { data: current, error: gameError } = await sb.from("games").select("settings").eq("id", gameId).single();
    if (gameError) throw new Error(gameError.message);
    const settings = current.settings;
    settings.questions = {
      rounds: questions,
      final: [],
    };
    const { error } = await sb.from("games").update({ settings }).eq("id", gameId);
    if (error) throw new Error(error.message);
  }, game.id);
  const contexts = [];
  try {
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    const errors = [];
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    // Nowa gra: żaden wiersz game_state jeszcze nie istnieje, więc Display
    // powinien zostać na czarnym ekranie bez błędu — "wznowienie/pierwsze
    // wejście bez specjalnego przypadku" z planu.
    await expect(displayPage.locator("#blackScreen")).not.toHaveClass(/hidden/, { timeout: 10000 });

    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    await expect(hostPage.locator("#paperText1")).toBeVisible({ timeout: 10000 });

    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    await expect(buzzerPage.locator("#offScreen")).toBeVisible({ timeout: 10000 });
    for (const device of [displayPage, hostPage, buzzerPage]) {
      await expect(device.locator('[data-contact-modal], .btn-contact-footer, .contact-footer-entry')).toHaveCount(0);
      await expect(device.locator('body')).toHaveAttribute('data-device-screen', '');
    }


    // Wszystkie 3 urządzenia na JEDNYM ekranie (dokładnie jak stary
    // control.html: "Step 2 (host+buzzer) – usunięty, scalony z step 1") —
    // "Dalej" odblokowuje się dopiero gdy WSZYSTKIE są online.
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    // .device-row-1 (nie cały .device-row) — od dodania "Udostępnij" każdy
    // wiersz ma DRUGI .badge (znaczek udostępnienia) w device-row-2.
    // "Online" nigdy nie istniało jako realny tekst odznaki — tłumaczenia
    // (translation/pl.js's control.deviceStatusOk) dają "POŁĄCZONO" (PL),
    // "CONNECTED" (EN), "ПІДКЛЮЧЕНО" (UK); ten test od zawsze błędnie
    // oczekiwał angielskiego słowa mimo że reszta asercji w tym pliku jest
    // po polsku — nigdy wcześniej nie uruchomiony na żywo.
    await expect(page.locator('.device-row[data-device="host"] .device-row-1 .conn-status')).toHaveText("POŁĄCZONO", { timeout: 10000 });
    await expect(page.locator('.device-row[data-device="buzzer"] .device-row-1 .conn-status')).toHaveText("POŁĄCZONO", { timeout: 10000 });
    await expect(page.locator('.device-row[data-device="host"] .device-row-1 .conn-status')).toHaveClass(/\bconn-status--connected\b/);
    const deviceListFits = await page.locator(".c2-devices-layout .c2-scroll-area").evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    if (!deviceListFits) console.log("[e2e-diag] devices-fit", await devicesFitDiag(page));
    expect(deviceListFits, "Urządzenia powinny mieścić się bez przewijania przy 1366×768").toBe(true);

    await page.locator('.toggle-item:has(input[name="soundSource"][value="display"])').click();
    await expect(page.locator('.device-row:has(input[name="soundSource"][value="display"]) .hint').last())
      .toContainText("bez tego start gry będzie zablokowany");
    await expect(displayPage.locator("#audioUnlockScreen")).not.toHaveClass(/hidden/, { timeout: 10000 });

    const nextStep = page.getByRole("button", { name: "Dalej" });
    await expect(nextStep).toBeDisabled();
    await displayPage.locator("#btnAudioUnlock").click();
    await expect(displayPage.locator("#audioUnlockScreen")).toHaveClass(/hidden/);
    await expect(nextStep).toBeEnabled({ timeout: 10000 });
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await expect(page.locator(".c2-summary-rounds .c2-qpreview-text")).toHaveCount(1);
    await expect(page.locator(".c2-summary-final-questions .c2-qpreview-text")).toHaveCount(5);
    const initialRoundQuestion = await page.locator(".c2-summary-rounds .c2-qpreview-text").textContent();
    const initialFinalQuestions = await page.locator(".c2-summary-final-questions .c2-qpreview-text").allTextContents();
    expect(initialFinalQuestions).not.toContain(initialRoundQuestion);
    expect(new Set([...initialFinalQuestions, initialRoundQuestion]).size).toBe(6);
    await expect(page.locator(".c2-summary-advanced")).toContainText("250");
    const questionCards = await page.locator(".c2-summary-question-grid > .summarySection").evaluateAll((els) => els.map((el) => {
      const rect = el.getBoundingClientRect();
      return { left: rect.left, width: rect.width };
    }));
    expect(questionCards).toHaveLength(2);
    expect(questionCards[1].left).toBeGreaterThan(questionCards[0].left + questionCards[0].width - 2);
    await page.evaluate(() => { window.__originalRandom = Math.random; Math.random = () => 0.99; });
    await page.locator(".c2-summary-final-questions .c2-summary-row .btn").click();
    await expect(page.locator(".c2-summary-final-questions .c2-qpreview-text")).not.toHaveText(initialFinalQuestions);
    await expect(page.locator(".c2-summary-rounds .c2-qpreview-text")).toHaveText([initialFinalQuestions[4]]);
    await page.evaluate(() => { Math.random = window.__originalRandom; delete window.__originalRandom; });
    for (const previewId of ["#c2DisplayPreview", "#c2HostPreview"]) {
      const previewBox = await page.locator(previewId).evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const card = el.closest(".c2-device-preview-card").getBoundingClientRect();
        return { width: rect.width, height: rect.height, left: rect.left, cardLeft: card.left, cardWidth: card.width };
      });
      expect(previewBox.width).toBeLessThanOrEqual(641);
      expect(previewBox.width / previewBox.height).toBeCloseTo(16 / 9, 1);
      expect(Math.abs((previewBox.left + previewBox.width / 2) - (previewBox.cardLeft + previewBox.cardWidth / 2))).toBeLessThan(2);
    }

    const revealPreview = page.locator('.summarySoundRow:has(input[data-sfx-vol="reveal"]) .summarySoundPlay');
    const beginGame = page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" });
    await expect(beginGame).toBeEnabled();
    await expect(page.locator(".c2-audio-gate-hint")).toHaveCount(0);
    await revealPreview.click();
    await expect(revealPreview.locator(".ico")).toHaveClass(/ico-stop/);
    const introPreview = page.locator('.summarySoundRow:has(input[data-sfx-vol="show_intro"]) .summarySoundPlay');
    await introPreview.click();
    await expect(revealPreview.locator(".ico")).toHaveClass(/ico-play/);
    await expect(introPreview.locator(".ico")).toHaveClass(/ico-stop/);
    const previewState = await page.evaluate(async () => {
      const resource = performance.getEntriesByType("resource").find((entry) => new URL(entry.name).pathname.endsWith("/shared/js/core/sfx.js"));
      const sfx = await import(resource.name);
      return { reveal: sfx.isSfxPlaying("reveal"), intro: sfx.isSfxPlaying("show_intro") };
    });
    expect(previewState).toEqual({ reveal: false, intro: true });
    await introPreview.click();
    await expect(introPreview.locator(".ico")).toHaveClass(/ico-play/);
    await expect(beginGame).toBeEnabled();
    await beginGame.click();
    // Po "Gotowe" jest ekran wstępu (r_intro): .stepTitle znika (istnieje tylko
    // w krokach przygotowania), a start rundy wymaga najpierw "Rozpocznij grę".
    await expect(page.locator(".stepTitle")).toHaveCount(0, { timeout: 10000 });
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 1"), { timeout: 22000 });

    const acceptedControlVisibility = [];
    page.on("response", async (response) => {
      if (!response.url().includes("/rpc/control2_control_log") || !response.ok()) return;
      const events = response.request().postDataJSON()?.p_events || [];
      const result = await response.json().catch(() => null);
      if (!(Number(result) > 0)) return;
      for (const event of events) {
        if (event?.event_type === "page_state" && event.reason === "visibilitychange") acceptedControlVisibility.push(event.visibility);
      }
    });
    for (const visibility of ["hidden", "visible"]) {
      await page.evaluate((nextVisibility) => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          get: () => window.__e2eVisibility,
        });
        window.__e2eVisibility = nextVisibility;
        document.dispatchEvent(new Event("visibilitychange"));
      }, visibility);
      await expect.poll(() => acceptedControlVisibility.includes(visibility), { timeout: 10000 }).toBe(true);
    }

    // Odblokowanie dźwięku należy do instancji Wyświetlacza (migracja 397):
    // chwilowa utrata sieci w Control nie wymaga nowego gestu na Wyświetlaczu.
    const startRound = page.getByRole("button", { name: "Rozpocznij rundę" });
    await expect(startRound).toBeVisible();
    // Źródło dźwięku to Display: przycisk jest zablokowany do końca intro
    // (dźwięk + animacja na Display, blokada akcji). Dopiero gdy jest aktywny,
    // blokada po odzyskaniu połączenia pochodzi wyłącznie z braku gestu na
    // Display — inaczej "odblokowany po gestie" mierzyłby koniec intro.
    await expect(startRound).toBeEnabled({ timeout: 60000 });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("offline"));
      window.dispatchEvent(new Event("online"));
    });
    await expect(startRound).toBeEnabled({ timeout: 10000 });
    await page.waitForTimeout(2000); // kilka odczytów migawki po powrocie sieci
    await expect(displayPage.locator("#audioUnlockScreen")).toBeHidden();
    await expect(startRound).toBeEnabled();

    // Każde urządzenie zapisuje snapshot i kolejne przejścia widoczności po
    // rozpoczęciu rozgrywki. Emulujemy zmianę właściwości i wysyłamy natywne
    // zdarzenie, a potem czekamy na potwierdzony zapis RPC.
    const acceptedPageStates = [];
    const devices = [["display", displayPage], ["host", hostPage], ["buzzer", buzzerPage]];
    for (const [deviceType, devicePage] of devices) {
      devicePage.on("response", async (response) => {
        if (!response.url().includes("/rpc/control2_device_log") || !response.ok()) return;
        const events = response.request().postDataJSON()?.p_events || [];
        const result = await response.json().catch(() => null);
        if (!(Number(result) > 0)) return;
        for (const event of events) {
          if (event?.event_type === "page_state") acceptedPageStates.push({ deviceType, visibility: event.visibility, reason: event.reason });
        }
      });
      for (const visibility of ["hidden", "visible"]) {
        await devicePage.evaluate((nextVisibility) => {
          Object.defineProperty(document, "visibilityState", {
            configurable: true,
            get: () => window.__e2eVisibility,
          });
          window.__e2eVisibility = nextVisibility;
          document.dispatchEvent(new Event("visibilitychange"));
        }, visibility);
        await expect.poll(() => acceptedPageStates.some(event =>
          event.deviceType === deviceType && event.visibility === visibility && event.reason === "visibilitychange"
        ), { timeout: 10000 }).toBe(true);
      }
    }

    // Diagnostyka sesji (468–469): opis urządzenia od Control i każdego
    // urządzenia, zdarzenia sprzed startu gry dołączone do sesji, powrót
    // karty z czasem w tle.
    const sessions = await readControl2Sessions(page, game.id);
    const sessionEvents = sessions.at(-1)?.stats_detail.events || [];
    const sources = new Set(sessionEvents.filter(event => event.category === "device_info").map(event => event.source));
    expect([...sources].sort()).toEqual(["buzzer", "control", "display", "host"]);
    expect(sessionEvents.some(event => event.prestart === true)).toBe(true);
    expect(sessionEvents.some(event => event.category === "display_state" && event.source === "host"
      && event.metrics?.visibility === "visible" && typeof event.metrics?.hidden_duration_ms === "number")).toBe(true);

    expect(errors, "żadne z urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

test("control2: nowe otwarcie urządzenia przejmuje od razu, wyparta karta nie wraca sama", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(120000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGameRaw(page, `E2E-CONTROL2-LEASE-${Date.now()}`, {
    roundQuestions: Array.from({ length: 6 }, (_, i) => ({
      ord: i + 1, text: `Lease pytanie ${i + 1}`,
      answers: [{ ord: 1, text: `Odp. ${i + 1}`, fixed_points: 10 }],
    })),
  });
  const contexts = [];
  page.on("pageerror", error => console.log("[lease e2e pageerror]", error.message));
  page.on("console", message => {
    if (message.type() === "error") console.log("[lease e2e console]", message.text());
  });
  try {
    await padGame(page, game.id);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const routeState = await page.evaluate(() => ({
      path: location.pathname,
      title: document.title,
      headings: [...document.querySelectorAll(".stepTitle")].map(el => el.textContent),
      message: document.body.innerText.slice(0, 300),
    }));
    console.log("[lease e2e] control route state", JSON.stringify(routeState));
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    const keys = await page.evaluate(async (gameId) => {
      const sb = window.__sbClient;
      const result = {};
      for (const type of ["display", "host", "buzzer"]) {
        const { data, error } = await sb.rpc("control_runtime_device_link", { p_game_id: gameId, p_device_type: type });
        if (error || !data?.ok) throw new Error(error?.message || data?.error || `Device link failed: ${type}`);
        result[type] = data.token;
      }
      return result;
    }, game.id);

    // Migracja 472 (decyzja użytkownika 2026-10-23): nowe otwarcie z innej
    // przeglądarki przejmuje urządzenie od razu, stara karta dostaje
    // 'replaced' i wraca tylko po kliknięciu „Używaj tutaj”.
    const dotOf = { display: "#dotDisplay", host: "#dotHost", buzzer: "#dotBuzzer" };
    for (const type of ["display", "host", "buzzer"]) {
      const path = `/control/${type}?id=${game.id}&key=${keys[type]}`;
      // Stan lease z nakładki (data-lease-state); samo toBeHidden przechodzi
      // też na stronie /go/ przed przekierowaniem, gdy nakładki jeszcze nie ma.
      const leaseState = (devicePage) => devicePage.locator("#deviceLeaseOverlay");
      const first = await openAnon(browser, contexts, path, `${type}-first`, []);
      await expect(leaseState(first)).toHaveAttribute("data-lease-state", "primary", { timeout: 15000 });
      const startedAt = Date.now();
      const second = await openAnon(browser, contexts, path, `${type}-second`, []);
      await expect(leaseState(second)).toHaveAttribute("data-lease-state", "primary", { timeout: 15000 });
      await expect(leaseState(first)).toHaveAttribute("data-lease-state", "replaced", { timeout: 8000 });
      await expect(first.locator("#deviceLeaseTakeover")).toBeVisible();
      expect(Date.now() - startedAt, "przejęcie bez czekania na wygaśnięcie starej karty").toBeLessThan(15000);

      if (type === "display") {
        // Zamknięcie nowej karty: stara nie przejmuje sama nawet po
        // wygaśnięciu lease (12 s + takt heartbeatu).
        await second.context().close();
        await first.waitForTimeout(16000);
        await expect(first.locator("#deviceLeaseTakeover")).toBeVisible();
      } else {
        await second.close();
      }
      // Świadome przejęcie na starej karcie.
      await first.locator("#deviceLeaseTakeover").click();
      await expect(leaseState(first)).toHaveAttribute("data-lease-state", "primary", { timeout: 10000 });
      await expect(page.locator(dotOf[type])).toHaveClass(/\bok\b/, { timeout: 10000 });
      if (type === "display") {
        // Uśpienie dłuższe niż lease bez nowego otwarcia: heartbeat odcięty na
        // 15 s, potem ta sama karta wraca jako główna (nowa epoka), bez ekranu
        // „otwarto w innym miejscu”.
        const sleepRoute = "**/rest/v1/rpc/control_device_instance_heartbeat*";
        await first.route(sleepRoute, route => route.abort());
        await first.waitForTimeout(15000);
        await first.unroute(sleepRoute);
        await expect(leaseState(first)).toHaveAttribute("data-lease-state", "primary", { timeout: 15000 });
        await expect(first.locator("#deviceLeaseTakeover")).toBeHidden();
        await expect(page.locator(dotOf[type])).toHaveClass(/\bok\b/, { timeout: 10000 });
      }
      // Zamknięcie karty zwalnia urządzenie od razu (keepalive), bez 12–15 s.
      await first.close({ runBeforeUnload: true });
      await expect(page.locator(dotOf[type])).not.toHaveClass(/\bok\b/, { timeout: 6000 });

      if (type === "buzzer" || type === "host") {
        // Ta sama przeglądarka (np. drugi skan QR) też przejmuje od razu.
        const one = await openAnon(browser, contexts, path, `${type}-same-1`, []);
        await expect(leaseState(one)).toHaveAttribute("data-lease-state", "primary", { timeout: 15000 });
        const again = await one.context().newPage();
        await again.goto(one.url(), { waitUntil: "domcontentloaded" });
        await expect(leaseState(again)).toHaveAttribute("data-lease-state", "primary", { timeout: 10000 });
        await expect(leaseState(one)).toHaveAttribute("data-lease-state", "replaced", { timeout: 8000 });
      }
    }
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 2. Pełna runda + wznowienie po przeładowaniu =====

test("control2: pełna runda przez 4 urządzenia + wznowienie Control po przeładowaniu w środku rundy 2", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-FULLGAME-${Date.now()}`, { roundQuestions: TWO_QUESTIONS });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    // Licznik po stronie Playwright przeżywa przeładowanie urządzenia przez
    // service workera oraz odtworzenie kanału po reconnect. Czyta tylko typ
    // i topic rzeczywistych ramek; nie zmienia SDK ani obsługi wiadomości.
    const nativeCounts = { display: 0, host: 0, buzzer: 0 };
    const observeNative = (source) => (devicePage) => devicePage.on("websocket", (socket) => {
      socket.on("framereceived", ({ payload }) => {
        // Realtime (protokół 2.0) wysyła broadcast w ramkach binarnych
        // (temat + zdarzenie + treść); odpowiedzi i sterowanie — w JSON.
        if (typeof payload !== "string") {
          if (Buffer.from(payload).toString("utf8").includes("game-state:")) nativeCounts[source]++;
          return;
        }
        try {
          const frame = JSON.parse(payload);
          const event = Array.isArray(frame) ? frame[3] : frame.event;
          const topic = Array.isArray(frame) ? frame[2] : frame.topic;
          if (event === "broadcast" && String(topic).includes("game-state:")) nativeCounts[source]++;
        } catch {}
      });
    });
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors, { onPage: observeNative("display") });
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors, { onPage: observeNative("host") });
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors, { onPage: observeNative("buzzer") });

    // Potwierdź, że prawdziwe strony urządzeń dołączyły do prywatnego kanału
    // z bazy (game-state:<gra>:<połączenie>, migracje 508–510).
    for (const [kind, devicePage] of [["Display", displayPage], ["Host", hostPage], ["Buzzer", buzzerPage]]) {
      await expect.poll(() => devicePage.evaluate(() => window.__sbDeviceRealtime?.getChannels?.()
        ?.filter(channel => String(channel.topic || "").includes("game-state:"))
        .map(channel => `${channel.topic}:${channel.state}`) || []), {
        timeout: 15000,
        message: `${kind} powinien dołączyć do bezpośredniego kanału Realtime przed rozpoczęciem gry`,
      }).toEqual(expect.arrayContaining([expect.stringMatching(/:joined$/)]));


    }

    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await expect(page.getByText("Alfa vs Beta")).toBeVisible();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();

    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 1"), { timeout: 22000 });
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    const questionDuringDuel = page.locator(".c2-stepper-question");
    await expect(questionDuringDuel).toHaveText(/\S/);
    const visibleQuestion = await questionDuringDuel.textContent();
    const topbarLayout = await page.evaluate(() => {
      const progress = document.querySelector("#c2TopbarProgress").getBoundingClientRect();
      const display = document.querySelector("#dotDisplayRow").getBoundingClientRect();
      return {
        progressRight: progress.right,
        displayLeft: display.left,
        progressCenter: progress.top + progress.height / 2,
        displayCenter: display.top + display.height / 2,
        progressHeight: progress.height,
        scale: Number(document.querySelector("#controlStage").style.getPropertyValue("--control-scale")),
        deviceIconCount: document.querySelectorAll("#dotDisplayRow svg, #dotHostRow svg, #dotBuzzerRow svg").length,
      };
    });
    expect(topbarLayout.progressRight).toBeLessThan(topbarLayout.displayLeft);
    expect(Math.abs(topbarLayout.progressCenter - topbarLayout.displayCenter)).toBeLessThan(2);
    expect(topbarLayout.progressHeight / topbarLayout.scale).toBeGreaterThanOrEqual(36);
    expect(topbarLayout.deviceIconCount).toBe(3);

    // Regresja: Prowadzący musi widzieć PEŁNĄ treść i punkty KAŻDEJ
    // odpowiedzi od początku rundy, nie tylko już odsłoniętych dla widzów
    // (inaczej nie mógłby ocenić, czy to, co powiedział kontestant, pasuje
    // do listy) — wcześniejsza wersja chowała je pod "______".
    await expect(hostPage.locator("#paperText2")).toContainText("Odpowiedź B (30)", { timeout: 10000 });
    await expect(hostPage.locator("#paperText2")).toContainText("Odpowiedź C (20)", { timeout: 10000 });

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await expect(questionDuringDuel).toHaveText(visibleQuestion);

    // Kontrolowana utrata sieci jednego urządzenia w aktywnej rundzie.
    // Chromium nie zawsze zamyka już otwarty WebSocket przy samym setOffline,
    // więc zamykamy jego natywne gniazdo jawnie, gdy urządzenie jest offline.
    // To pozwala sprawdzić kod zamknięcia i automatyczne ponowne dołączenie.
    await displayPage.context().setOffline(true);
    const forcedSocketClose = await displayPage.evaluate(() => {
      const socket = window.__sbDeviceRealtime?.realtime?.socketAdapter?.socket?.conn;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      socket.close(4000, "e2e_network_interrupt");
      return true;
    });
    expect(forcedSocketClose, "E2E powinien zamknąć aktywny WebSocket Displaya").toBe(true);
    await displayPage.waitForTimeout(3500);
    await displayPage.context().setOffline(false);
    let socketEvents = [];
    try {
      await expect.poll(async () => {
        const events = (await readControl2Sessions(page, game.id))[0]?.stats_detail.events || [];
        socketEvents = events.filter(event => event.source === "display" && event.category === "device_transport"
          && ["socket_closed", "recovered", "connected"].includes(event.metrics?.phase));
        const reconnected = socketEvents.some(event => event.metrics?.phase === "recovered"
          && Number.isInteger(event.metrics?.socket_close_code))
          || socketEvents.some(event => event.metrics?.phase === "connected"
            && Number.isInteger(event.metrics?.socket_close_code)
            && Number.isFinite(event.metrics?.reconnect_ms));
        // The close observer's metadata is copied onto the successful
        // reconnect event. A separate socket_closed row may be omitted by
        // the short-event logging policy, so require the paired metadata here.
        return reconnected;
      }, { timeout: 45000, message: "Display powinien zapisać kod zamknięcia i powiązać go z ponownym połączeniem" }).toBe(true);
    } catch (error) {
      const socketProbe = await displayPage.evaluate(() => ({
        observer_attached: window.__sbDeviceRealtimeCloseObserverAttached,
        app_close: window.__sbDeviceRealtimeLastClose || null,
        connection_state: window.__sbDeviceRealtime?.realtime?.connectionState?.() || null,
      })).catch(() => null);
      const allDeviceTransportEvents = (await readControl2Sessions(page, game.id))[0]?.stats_detail.events || [];
      console.log(`[e2e-socket-close] ${JSON.stringify({
        socketProbe,
        selected: socketEvents.map(event => ({ phase: event.metrics?.phase, metrics: event.metrics })),
        device_transport: allDeviceTransportEvents.filter(event => event.source === "display" && event.category === "device_transport")
          .map(event => ({ phase: event.metrics?.phase, status: event.metrics?.status,
            code: event.metrics?.socket_close_code, reconnect_ms: event.metrics?.reconnect_ms,
            previous_status: event.metrics?.previous_status })),
      })}`);
      throw error;
    }
    await expect(questionDuringDuel).toHaveText(visibleQuestion);

    const duelGridRows = await page.locator(".c2-tilegrid").evaluate((grid) => getComputedStyle(grid).gridTemplateRows.split(" ").length);
    expect(duelGridRows).toBe(6);
    const duelTileHeight = await page.locator(".c2-tilegrid .c2-tile").first().evaluate((tile) => tile.getBoundingClientRect().height);
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    const roundTileHeight = await page.locator(".c2-tilegrid .c2-tile").first().evaluate((tile) => tile.getBoundingClientRect().height);
    expect(Math.abs(roundTileHeight - duelTileHeight)).toBeLessThan(1);
    await expect(page.locator(".c2-gameplay-nav .c2-statusbar")).toBeVisible();

    // Odpowiedź #1 ma najwyższe punkty (40) — trafienie wygrywa pojedynek.
    await dumpControlState(page, "przed-reveal-1");
    await clearSfxLog(page);
    await revealAnswer(page, 1);
    await expect.poll(() => getSfxKeys(page)).toContain("answer_correct");
    expect(await getSfxKeys(page)).not.toContain("reveal");
    await dumpControlState(page, "po-reveal-1");
    await revealAnswer(page, 2);
    await dumpControlState(page, "po-reveal-2");
    await revealAnswer(page, 3);
    await dumpControlState(page, "po-reveal-3");
    // Krótki, jawny timeout (zamiast domyślnego 150s testu) — jeśli to
    // zawiśnie, chcemy szybki, kompletny dump zamiast czekać 2.5 min na
    // każdą z dwóch prób (5 min razem) tylko po to, żeby dostać ten sam,
    // pusty "Timeout of 150000ms exceeded".
    try {
      await page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }).click({ timeout: 15000 });
    } catch (e) {
      await dumpControlState(page, "PO-TIMEOUCIE-zakoncz-runde");
      throw e;
    }

    // finalizeRound(): próg (300) nieosiągnięty, pula ma jeszcze pytanie 2.
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 2"), { timeout: 22000 });

    // The operator view updates optimistically before game_state_write commits.
    // Confirm the native persisted round first; statistics share that transaction.
    await expect.poll(async () => page.evaluate(async (gid) => {
      const { data, error } = await window.__sbClient.from("game_state")
        .select("rev,step,detail").eq("game_id", gid).single();
      if (error) throw new Error("read committed round: " + error.message);
      return { roundNo: data.detail?.rounds?.roundNo, scoreA: data.detail?.rounds?.totals?.A };
    }, game.id), { timeout: 10000 }).toEqual({ roundNo: 2, scoreA: 90 });

    // Kanał z bazy musi dostarczać rzeczywiste zmiany, nie tylko SUBSCRIBED
    // (diagnoza 2026-10-23). Przy zdrowym łączu żaden odczyt nie nadrabia
    // zmian (resync_applied — tylko po przerwie w połączeniu).
    const transportOf = sessions => {
      const events = (sessions[0]?.stats_detail.events || []).filter(event => ["display", "host", "buzzer"].includes(event.source));
      return Object.fromEntries(["display", "host", "buzzer"].map(source => {
        const sourceEvents = events.filter(event => event.source === source);
        return [source, {
          connected: sourceEvents.filter(event => event.category === "device_transport"
            && event.metrics?.phase === "connected" && event.metrics?.transport === "broadcast").length,
          resync: sourceEvents.filter(event => event.metrics?.phase === "resync_applied").map(event => ({
            trigger: event.metrics?.trigger, rev: event.metrics?.revision, previous: event.metrics?.previous_revision,
            visibility: event.metrics?.visibility, online: event.metrics?.online })),
          recoveredContext: sourceEvents.filter(event => event.category === "device_transport"
            && event.metrics?.phase === "recovered").map(event => ({ first_status: event.metrics?.first_status,
            duration_ms: event.metrics?.duration_ms, start_visibility: event.metrics?.start_visibility,
            start_online: event.metrics?.start_online, hidden_duration_ms: event.metrics?.hidden_duration_ms,
            error_class: event.metrics?.error_class })),
        }];
      }));
    };
    let lastTransportSnapshot = null;
    try {
      await expect.poll(async () => {
        const sessions = await readControl2Sessions(page, game.id);
        lastTransportSnapshot = transportOf(sessions);
        return Object.values(lastTransportSnapshot).every(item => item.connected > 0);
      }, { timeout: 20000, message: "Display/Host/Buzzer powinny zalogować transport_state connected broadcast" }).toBe(true);
    } catch (error) {
      const sessions = await readControl2Sessions(page, game.id);
      lastTransportSnapshot = transportOf(sessions);
      console.log(`[e2e-diag] connected transport timeout ${JSON.stringify(lastTransportSnapshot)}`);
      await attachStatistics(testInfo, "transport-connect-timeout", sessions);
      throw error;
    }
    const transport = transportOf(await readControl2Sessions(page, game.id));
    console.log(`[e2e-diag] device transport ${JSON.stringify(transport)}`);
    for (const [source, item] of Object.entries(transport)) {
      expect(item.resync, `${source}: przy zdrowym łączu kanał z bazy nie gubi zmian`).toEqual([]);
    }
    for (const source of Object.keys(nativeCounts)) {
      await expect.poll(() => nativeCounts[source], {
        timeout: 10000, message: `${source}: kanał z bazy dostarczył zmiany`,
      }).toBeGreaterThan(0);
    }
    console.log(`[e2e-diag] native broadcast ${JSON.stringify(nativeCounts)}`);

    // ===== KLUCZOWY MOMENT: przeładowanie Control w środku rundy 2 =====
    const beforeReload = await readControl2Sessions(page, game.id);
    expect(beforeReload).toHaveLength(1);
    expect(beforeReload[0]).toMatchObject({ rounds_played: 1, rounds_score_a: 90 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 2"), { timeout: 22000 });
    await expect(page.getByText("Alfa: 90")).toBeVisible({ timeout: 10000 });
    const afterReload = await readControl2Sessions(page, game.id);
    expect(afterReload).toHaveLength(1);
    expect(afterReload[0].id).toBe(beforeReload[0].id);
    expect(afterReload[0].rounds_played).toBe(1);
    await attachStatistics(testInfo, "reload", afterReload);

    expect(errors, "żadne z 4 urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 3. Mechanika rund: reset pojedynku, pass, kradzież win/loss, R8 =====

test("control2: reset pojedynku, pass, kradzież wygrana/przegrana, odkrywanie reszty, koniec gry + Wróć do moich gier", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(300000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-ROUNDMECH-${Date.now()}`, { roundQuestions: TWO_QUESTIONS });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);

    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    // ===== RUNDA 1 =====
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 1"), { timeout: 22000 });
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    // Zgłoszone: "X nie odtwarza żadnego dźwięku" — regresja wprost na
    // ADD_X (engine.js zawsze zwraca soundCueKey "answer_wrong" dla X,
    // niezależnie od fazy DUEL/PLAY/STEAL, patrz komentarz tam).
    await clearSfxLog(page);
    await clickX(page); // A pudłuje -> kolej B
    await waitForSfxSequence(page, ["answer_wrong"], 10000);
    // B pudłuje też -> RESET CYKLU: kolej wraca do A, BEZ nowego zgłoszenia
    // buzzera (firstTeam/secondTeam nie są czyszczone — "nie ma czegoś
    // takiego jak ponowny buzer").
    await clickX(page);

    await revealAnswer(page, 1); // A trafia (40 pkt) -> wygrywa pojedynek, BEZ nowego zgłoszenia
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });

    await clickX(page);
    await clickX(page);
    await clickX(page); // 3x pudło A -> auto-KRADZIEŻ dla B

    await revealAnswer(page, 2); // B kradnie WYGRANĄ (30 pkt)
    await expect(page.getByText("Bank: 70")).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }).click();

    // Zgłoszone: wynik na Wyświetlaczu (LEFT/RIGHT) ma skoczyć na nowy wynik
    // DOSŁOWNIE w momencie dźwięku końca rundy — nie dopiero przy starcie
    // NASTĘPNEJ rundy. Sprawdzone TU, W TRAKCIE R8 (jeszcze przed
    // odsłonięciem #3), żeby złapać regresję na wcześniejszy brak
    // jakiejkolwiek obsługi tego przejścia w control/display/js/render.js.
    await expect.poll(async () => {
      const calls = await getDisplayCalls(displayPage, "api.small.rightDigits");
      return calls.at(-1)?.args?.[0];
    }, { timeout: 10000 }).toBe("70");
    await expect.poll(async () => {
      const calls = await getDisplayCalls(displayPage, "api.small.leftDigits");
      return calls.at(-1)?.args?.[0];
    }, { timeout: 10000 }).toBe("0");

    await revealAnswer(page, 3); // #3 nieodkryte -> R8

    // Zgłoszone: ostatnie odsłonięcie w R8 NIE MA już samo odpalać ekranu
    // kolejnej rundy "znikąd" — operator musi kliknąć osobny, kontekstowo
    // podpisany przycisk (tu: "Przejdź do następnej rundy", bo próg
    // nieosiągnięty i pula ma jeszcze pytanie 2).
    const nextRoundBtn = page.getByRole("button", { name: "Przejdź do następnej rundy" });
    await expect(nextRoundBtn).toBeEnabled({ timeout: 10000 });
    await nextRoundBtn.click();

    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 2"), { timeout: 22000 });
    await expect(page.getByText("Alfa: 0")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Beta: 70")).toBeVisible({ timeout: 10000 });

    // ===== RUNDA 2 =====
    await startRoundConfirmed(page);
    // Przycisk Buzzera czeka, aż Display dokończy animację końca poprzedniej
    // rundy (display_animation_pending) — przy 4 workerach to trwa dłużej.
    await expect(buzzerPage.getByRole("button", { name: "Przycisk B" })).toBeEnabled({ timeout: 60000 });
    await buzzerPage.getByRole("button", { name: "Przycisk B" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Beta" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Beta" }));

    await revealAnswer(page, 1); // B trafia (40 pkt) -> kontrola B, allowPass
    await armAndConfirm(page.getByRole("button", { name: "Oddaj kontrolę" })); // dawny "Pass" -> kontrola A

    await revealAnswer(page, 2); // A trafia (30 pkt) -> bank 70
    await expect(page.getByText("Bank: 70")).toBeVisible({ timeout: 10000 });

    await clickX(page);
    await clickX(page);
    await clickX(page); // 3x pudło A -> auto-KRADZIEŻ dla B

    await clickX(page); // B kradnie, ale też PUDŁUJE -> kradzież PRZEGRANA
    // Pula wyczerpana (2/2), próg nieosiągnięty, hasFinal=false: cel to koniec
    // gry, więc END_ROUND finalizuje rundę od razu (engine.js, GAME_END) —
    // bez R8, mimo nieodsłoniętej odpowiedzi #3. Przycisk podpisuje się
    // "Przejdź do zakończenia gry".
    await clickConfirmed(page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }));

    // Runda 1 dała bank drużynie B (70), runda 2 zostaje przy A (70) -> remis.
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Koniec gry"), { timeout: 22000 });

    // gameEndSummary() (ui.js) renderuje się dopiero PO locks.gameEnded —
    // czyli PO tym kliknięciu, nie przed nim (poprzednia kolejność w tym
    // teście była odwrócona względem UI).
    await page.getByRole("button", { name: "Zakończ grę" }).click();
    await expect(page.getByText("Remis — 70:70")).toBeVisible({ timeout: 10000 });
    const finishBtn = page.getByRole("button", { name: "Wróć do moich gier" });
    await expect(finishBtn).toBeVisible({ timeout: 10000 });
    await expect(finishBtn).toBeEnabled({ timeout: 150000 });
    await finishBtn.click();
    await expect(page).toHaveURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 10000 });
    await page.waitForFunction(() => window.__sbClient, { timeout: 10000 }).catch(() => {});

    expect(errors, "żadne z urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 4. Finał: próg -> finał, wczesne zakończenie w połowie mapowania =====

test("control2: próg w rundzie -> finał, wczesne zakończenie po 4/5 pytaniach, pomija gracza 2", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(300000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-FINAL-${Date.now()}`, {
    roundQuestions: [{ ord: 1, text: "Pytanie testowe (runda)", answers: [{ ord: 1, text: "Odp. warta 276", fixed_points: 92 }] }],
    finalAnswerPts: 50,
    settings: { game: { advanced: { endScreenMode: "money", roundMultipliers: [3], finalMinPoints: 276 } } },
  });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await revealAnswer(page, 1); // jedyna prawdziwa odpowiedź, 92 × 3 -> bank 276 (próg 276)

    // Jedyna prawdziwa odpowiedź odsłonięta, "Pusta 2/3" nie: 3 X otwierają
    // kradzież, a dopiero jej pudło (4. X) pozwala zakończyć rundę.
    await strikeOutAndLoseSteal(page);
    await endRoundAndRevealRest(page, "Przejdź do finału");

    // Próg (276) trafiony, hasFinal=true, finalQuestionsMode="pick" + 5
    // potwierdzonych pytań -> prosto do finału.
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Finał"), { timeout: 22000 });
    await page.getByRole("button", { name: "Rozpocznij finał" }).click();

    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(/Finał\s*(—\s*)?gracz 1,\s*wpisywanie/), { timeout: 22000 });
    // Bez wpisanej odpowiedzi gracza kafel dopasowania zostaje trwale
    // disabled (ui.js's hasTyped) — ta sama luka co w drugim, pełnym teście
    // finału (linia ~846), ale tu brakowało tego kroku w ogóle.
    const p1Inputs = page.locator("#app input[type=text]");
    await expect(p1Inputs).toHaveCount(5, { timeout: 10000 });
    for (let i = 0; i < 5; i++) await p1Inputs.nth(i).fill("Odp. finałowa");
    // Start/stop zegarka gracza to teraz zaznacz->potwierdź (nieodwracalne/
    // ryzykowne kliknięcie, ui.js's finalTimerRow) — armAndConfirm jak
    // reszta kosztownych kafli finału.
    await armAndConfirm(page.getByRole("button", { name: "Rozpocznij odliczanie (15s)" }));
    // "Dalej" zablokowany, dopóki zegarek aktywnie odlicza (zgłoszone: "nie
    // czeka na koniec timera i przechodzi dalej") — zatrzymujemy legalnie,
    // przez sam kafel zegarka (wszystkie pola już wypełnione).
    await armAndConfirm(page.getByRole("button", { name: "Zatrzymaj" }));
    await page.getByRole("button", { name: "Dalej" }).click();

    for (let i = 0; i < 4; i++) {
      await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(`Finał — mapowanie ${i + 1}/5`), { timeout: 22000 });
      await armAndConfirm(page.getByRole("button", { name: "Odp. finałowa (50)" }));
      // "Pokaż odpowiedź"/"Pokaż punkty" — kafle odsłaniania (zaznacz ->
      // potwierdź, jak odpowiedzi w Rundach), nazwa stała, druga linijka to
      // żywy podgląd (aria-hidden, więc dostępna nazwa nie zawiera wartości).
      await armAndConfirm(page.getByRole("button", { name: "Pokaż odpowiedź" }));
      await armAndConfirm(page.getByRole("button", { name: "Pokaż punkty" }));
      // Na i===3 suma trafia finalTarget (200) i REVEAL_POINTS (engine.js)
      // SAMO, synchronicznie w tej samej akcji, przeskakuje do f_end —
      // kafel "Pokaż punkty" znika z DOM natychmiast, zanim ten check by
      // zdążył go zobaczyć. Suma i tak jest zweryfikowana niżej ("Suma
      // finału: 200").
      if (i < 3) {
        await expect(page.getByRole("button", { name: "Pokaż punkty" })).toContainText("50", { timeout: 10000 });
        await page.getByRole("button", { name: "Dalej" }).click();
      }
    }

    await expect(page.locator(".c2-roundlayout-side")).toContainText(/Osiągnięto \d+ pkt — cel finału/, { timeout: 10000 });
    await expect(page.getByRole("button", { name: "Pokaż odpowiedź" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Pokaż punkty" })).toBeDisabled();
    await page.getByRole("button", { name: "Zakończ finał", exact: true }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Koniec gry"), { timeout: 22000 });

    // finalStatusBar (ui.js's renderFinalMapping) istnieje tylko na
    // ekranach mapowania — tu już zeszliśmy na f_end, gdzie go nie ma.
    // Realna weryfikacja sumy (200): FINISH_FINAL wtapia ją w rounds.totals
    // (bank rundy 276 + suma finału 200 = 476), widoczne dopiero po
    // "Zakończ grę" jako gameEndSummary (ta sama funkcja co w teście
    // "reset pojedynku...", tam już sprawdzona dla remisu).
    await page.getByRole("button", { name: "Zakończ grę", exact: true }).click();
    await expect(page.getByText("Wygrała drużyna Alfa wynikiem 476:0")).toBeVisible({ timeout: 10000 });
    // The UI renders optimistically before the final RPC is committed.
    await expect.poll(async () => (await readControl2Sessions(page, game.id))[0]?.status, { timeout: 15000 }).toBe("final");
    const earlyFinalSessions = await readControl2Sessions(page, game.id);
    expect(earlyFinalSessions).toHaveLength(1);
    expect(earlyFinalSessions[0]).toMatchObject({ status: "final", rounds_score_a: 276, team_a_score: 476, final_points: 200 });
    expect(earlyFinalSessions[0].stats_detail.end_reason).toBe("final_target");
    expect(earlyFinalSessions[0].stats_detail.prize).toBe(25828); // regulamin: 276 z rund × 3 + 25000 (cel osiągnięty)
    expect(earlyFinalSessions[0].stats_detail.final.mapping1.filter(row => row.revealedPoints)).toHaveLength(4);
    expect(earlyFinalSessions[0].stats_detail.final.mapping2.filter(row => row.revealedPoints)).toHaveLength(0);
    await attachStatistics(testInfo, "early-final", earlyFinalSessions);
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.win.set")).at(-1)?.args[0], { timeout: 30000 }).toBe(25828);
    const finishBtn = page.getByRole("button", { name: "Wróć do moich gier" });
    await expect(finishBtn).toBeVisible({ timeout: 10000 });
    await expect(finishBtn).toBeEnabled({ timeout: 150000 });
    await finishBtn.click();
    await expect(page).toHaveURL(/\/games\/?(?:\?[^\/]*)?$/, { timeout: 10000 });
    await page.waitForFunction(() => window.__sbClient, { timeout: 10000 }).catch(() => {});

    expect(errors, "żadne z urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 5. physicalBuzzer + noHostTablet =====

test("control2: physicalBuzzer + noHostTablet — urządzenia pominięte, ręczny wybór drużyny", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-PHYSBUZZ-${Date.now()}`, {
    roundQuestions: [TWO_QUESTIONS[0]],
  });
  const contexts = [];
  try {
    // Wyświetlacz jest wymagany ZAWSZE — nie ma dla niego opt-outu (patrz
    // control/js/app.js's requiredOnline) — więc nawet w tym scenariuszu
    // (host+buzzer pominięte) trzeba go realnie podłączyć, inaczej "Dalej"
    // zostaje trwale zablokowane.
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });

    // "Fizyczny przycisk" -> "Przycisk fizyczny" (ujednolicenie słownictwa,
    // translation/pl.js) -- REALNA przyczyna znalezionej w CI awarii: nie
    // obciążenie runnera (sygnatura "element is not stable"), tylko
    // locator.check() nigdy nie znajdujący ŻADNEGO elementu (pusty call log,
    // bez prób retry na konkretnym węźle) przez cały test.setTimeout, co
    // dokładnie pasuje do "selector nigdy się nie zgadza", nie "niestabilny
    // DOM".
    await page.getByLabel("Przycisk fizyczny").check();
    await page.getByLabel("Nie używaj tabletu prowadzącego").check();
    // Świadoma zmiana względem starego control.html (patrz control2.html's
    // komentarz przy .c2-devicerows .device-row[data-opted-out] .device-row-2):
    // wiersz zostaje w DOM I WIDOCZNY (nazwa/badge/checkbox), tylko kod/
    // przyciski się WYSZARZAJĄ i przestają być klikalne -- NIE znikają
    // (display:none), w odróżnieniu od jednokolumnowego control.html.
    await expect(page.locator('.device-row[data-device="buzzer"]')).toHaveAttribute("data-opted-out", "", { timeout: 10000 });
    await expect(page.locator('.device-row[data-device="host"]')).toHaveAttribute("data-opted-out", "", { timeout: 10000 });
    await expect(page.locator('.device-row[data-device="buzzer"] .device-row-2')).toHaveCSS("pointer-events", "none");
    await expect(page.locator('.device-row[data-device="host"] .device-row-2')).toHaveCSS("pointer-events", "none");

    // Zgłoszone: przycisk nieaktywnego urządzenia w topbarze ma zniknąć
    // CAŁKOWICIE (nie tylko przygasnąć) — już na kroku Urządzeń, nie
    // dopiero na Podsumowaniu. Wyświetlacz (zawsze wymagany) zostaje.
    await expect(page.locator("#dotHostRow")).toHaveClass(/\bhidden\b/, { timeout: 5000 });
    await expect(page.locator("#dotBuzzerRow")).toHaveClass(/\bhidden\b/, { timeout: 5000 });
    await expect(page.locator("#dotDisplayRow")).not.toHaveClass(/\bhidden\b/);

    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    // Wyszarzenie (.device-row-2 pointer-events:none) dotyczy WYŁĄCZNIE
    // samego kroku Urządzeń -- po "Dalej" cała karta Urządzeń przestaje się
    // renderować (renderDevicesStep już nie jest wywoływane), więc wiersze
    // host/buzzer znikają naprawdę (nie ma ich już w DOM), nie tylko dalej
    // wyszarzone.
    await expect(page.locator('.device-row[data-device="host"]')).toHaveCount(0);
    await expect(page.locator('.device-row[data-device="buzzer"]')).toHaveCount(0);
    // Utrzymuje się na Podsumowaniu i dalej w rozgrywce, nie tylko na
    // samym kroku Urządzeń.
    await expect(page.locator("#dotHostRow")).toHaveClass(/\bhidden\b/);
    await expect(page.locator("#dotBuzzerRow")).toHaveClass(/\bhidden\b/);
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await expect(buzzerPage.locator("#offScreen")).toBeVisible();
    await expect(buzzerPage.locator("#btnA")).toBeDisabled();
    await expect(hostPage.locator("#paperText1")).toBeEmpty();
    await expect(hostPage.locator("#paperText2")).toBeEmpty();
    await expect.poll(async () => buzzerPage.evaluate(async ({ id, key }) => {
      const { error } = await window.__sbClient.rpc("game_state_buzzer_press", { p_game_id: id, p_key: key, p_team: "A" });
      return error?.message;
    }, { id: game.id, key: game.share_key_buzzer }), { timeout: 30000 }).toMatch(/^(device_disabled|forbidden)$/);
    // Od migracji 380 wywołanie bez połączenia/epoki urządzenia kończy się
    // "forbidden" przed sprawdzeniem physicalBuzzer — liczy się samo odrzucenie.

    await expect(page.locator("#dotHostRow")).toHaveClass(/\bhidden\b/);
    await expect(page.locator("#dotBuzzerRow")).toHaveClass(/\bhidden\b/);

    // Bez Buzzera na ekranie: zaznacz -> zmień zdanie (klik drugiej drużyny,
    // bez osobnego "Anuluj") -> zaznacz->potwierdź (ten sam wspólny kafel
    // "Zatwierdź: <drużyna>" co w trybie normalnym -- ekrany identyczne,
    // tu tylko oba kafle drużyn są klikalne). Przyciski pokazują realną
    // nazwę drużyny (Alfa/Beta), nie kod "A"/"B".
    await expect(page.getByRole("button", { name: "Alfa" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Alfa" })).toBeEnabled({ timeout: 22000 });
    await page.keyboard.press("a");
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeVisible();
    await page.keyboard.press("b");
    await expect(page.getByRole("button", { name: "Zatwierdź: Beta" })).toBeVisible();
    await page.keyboard.press("Enter");

    await expect(page.locator('[data-shortcut="1"]')).toBeEnabled();
    await page.keyboard.press("1");
    await expect(page.locator('[data-shortcut="1"]')).toHaveClass(/c2-tile-armed/);
    await page.keyboard.press("Enter"); // B trafia -> przejmuje kontrolę
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 6. "Zacznij od nowa" =====

test("control2: \"Zacznij od nowa\" w trakcie gry wraca do D0", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-RESTART-${Date.now()}`);
  const contexts = [];
  try {
    // "Dalej" wymaga WSZYSTKICH trzech urządzeń online (Wyświetlacz zawsze,
    // Prowadzący/Przycisk bez opt-outu tutaj) -- bez pełnego sparowania
    // zostaje trwale disabled, a goły .click() wisi do końca budżetu testu
    // (150s), zamiast szybko failować z jasnym powodem.
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Rozpoczęcie gry"), { timeout: 22000 });

    await page.getByRole("button", { name: "Rozpocznij grę", exact: true }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij rundę", exact: true })).toBeDisabled();
    await expect(page.locator("#btnStartOver")).toBeEnabled();
    await page.locator("#btnStartOver").click();
    // exact:true -- bez tego locator dopasowuje też przycisk "Kontakt"
    // (Playwright domyślnie dopasowuje podciąg nazwy dostępnej, a "takt"
    // w "Kontakt" zawiera "tak" jako fragment case-insensitive), co dawało
    // "strict mode violation: 2 elements match".
    await page.getByRole("button", { name: "Tak", exact: true }).click();

    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 10000 });
    await expect(displayPage.locator("#blackScreen")).toBeVisible();
    const restartedSessions = await readControl2Sessions(page, game.id);
    expect(restartedSessions).toHaveLength(1);
    expect(restartedSessions[0].status).toBe("abandoned");
    expect(restartedSessions[0].ended_at).toBeTruthy();
    expect(restartedSessions[0].stats_detail.end_reason).toBe("restart");
    await page.getByRole("button", { name: "Dalej", exact: true }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    // Readiness is not itself a new play.
    expect(await readControl2Sessions(page, game.id)).toHaveLength(1);
    await page.getByRole("button", { name: "Rozpocznij grę", exact: true }).click();
    await expect.poll(async () => (await readControl2Sessions(page, game.id)).length).toBe(2);
    const newSessions = await readControl2Sessions(page, game.id);
    expect(newSessions[1].id).not.toBe(restartedSessions[0].id);
    expect(newSessions[1].ended_at).toBeNull();
    await attachStatistics(testInfo, "restart", newSessions);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 7. Druga karta Control blokowana (resource-lock) =====

test("control2: druga karta Control na tę samą grę jest zablokowana (resource-lock, kontekst \"control\")", async ({ page, context, accounts, loginAs }, testInfo) => {
  await loginAs(page, context, accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-LOCK-${Date.now()}`);
  try {
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    // Druga karta (ta sama sesja/konto, INNY tab_id — sessionStorage nie
    // jest dzielony między kartami) musi zobaczyć overlay blokady.
    const secondTab = await context.newPage();
    await secondTab.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(secondTab.locator("#resourceLockGuard")).toBeVisible({ timeout: 15000 });
    await expect(secondTab.locator(".stepTitle")).toHaveCount(0);
    await secondTab.close();
  } finally {
    await deleteGame(page, game.id);
  }
});

// ===== 8. QR host/buzzer niezależne na Display =====

// Przycisk "QR na wyświetlaczu"/"Ukryj QR" żyje wewnątrz `.device-row` dla
// danego urządzenia (control/js/ui.js's deviceRow()) — po każdym kliknięciu
// etykieta się przełącza, więc kolejne wywołanie tej funkcji z tym samym
// `kind` musi na nowo odnaleźć przycisk po AKTUALNEJ etykiecie (stąd `wantOn`
// — czy oczekujemy stanu "wyłączony -> włącz" czy odwrotnie), a nie polegać
// na złapanym wcześniej Locatorze.
function qrToggleBtn(page, kind, wantOn) {
  // t("control.qrOnDisplayToggle")/t("control.qrHide") — translation/pl.js:
  // "QR na wyświetlaczu" / "Schowaj QR" (NIE "Ukryj QR" — literał z
  // poprzedniej wersji tego testu nie pasował do żadnego tłumaczenia w
  // ogóle, więc ten selektor nigdy realnie nie trafiał w przycisk).
  const label = wantOn ? "QR na wyświetlaczu" : "Schowaj QR";
  return page.locator(`.device-row[data-device="${kind}"] button`, { hasText: label });
}

// Krok 1: brak QR w ogóle -> mode="BLACK" -> #qrScreen ukryty CAŁKOWICIE
// (nie samo puste .qr-grid) — control/js/app.js's syncQrDisplay() ustawia
// display.mode="QR" TYLKO gdy chociaż jedno z dwóch jest show:true, inaczej
// wraca do "BLACK". Ta asercja dowodzi, że wyłączenie OBU naraz faktycznie
// gasi cały ekran QR na Display, nie zostawia go widocznego z pustą siatką.
async function expectQrOff(displayPage) {
  await expect(displayPage.locator("#qrScreen")).toHaveClass(/hidden/, { timeout: 10000 });
}
async function expectQrSingle(displayPage, visibleKind) {
  await expect(displayPage.locator("#qrScreen")).not.toHaveClass(/hidden/, { timeout: 10000 });
  await expect(displayPage.locator(".qr-grid")).toHaveClass(/qr-single/);
  const visibleCard = visibleKind === "host" ? "#qrHostCard" : "#qrBuzzerCard";
  const hiddenCard = visibleKind === "host" ? "#qrBuzzerCard" : "#qrHostCard";
  await expect(displayPage.locator(visibleCard)).not.toHaveClass(/hidden/);
  await expect(displayPage.locator(hiddenCard)).toHaveClass(/hidden/);
}
async function expectQrBoth(displayPage) {
  await expect(displayPage.locator("#qrScreen")).not.toHaveClass(/hidden/, { timeout: 10000 });
  await expect(displayPage.locator(".qr-grid")).not.toHaveClass(/qr-single/);
  await expect(displayPage.locator("#qrHostCard")).not.toHaveClass(/hidden/);
  await expect(displayPage.locator("#qrBuzzerCard")).not.toHaveClass(/hidden/);
}

test("control2: QR na wyświetlaczu — host i buzzer niezależne, każdy z osobna i oba naraz", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-DUALQR-${Date.now()}`);
  const contexts = [];
  try {
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    // Stan początkowy: żaden QR nie jest jeszcze pokazany.
    await expectQrOff(displayPage);

    // ===== Sam host: włącz -> sprawdź -> wyłącz -> sprawdź powrót do BLACK =====
    await qrToggleBtn(page, "host", true).click();
    await expectQrSingle(displayPage, "host");
    await qrToggleBtn(page, "host", false).click();
    await expectQrOff(displayPage);

    // ===== Sam buzzer: włącz -> sprawdź -> wyłącz -> sprawdź powrót do BLACK =====
    await qrToggleBtn(page, "buzzer", true).click();
    await expectQrSingle(displayPage, "buzzer");
    await qrToggleBtn(page, "buzzer", false).click();
    await expectQrOff(displayPage);

    // ===== Oba naraz: host, potem buzzer -> siatka podwójna (nie qr-single) =====
    await qrToggleBtn(page, "host", true).click();
    await expectQrSingle(displayPage, "host");
    await qrToggleBtn(page, "buzzer", true).click();
    await expectQrBoth(displayPage);

    // Wyłączenie JEDNEGO z dwóch wraca do pojedynczego układu (drugi zostaje).
    await qrToggleBtn(page, "host", false).click();
    await expectQrSingle(displayPage, "buzzer");

    // Dołożenie hosta z powrotem -> znów oba naraz (kolejność włączenia
    // odwrotna niż za pierwszym razem — dowód, że to naprawdę niezależne
    // flagi, nie sekwencja/kolejka).
    await qrToggleBtn(page, "host", true).click();
    await expectQrBoth(displayPage);

    // Wyłączenie OBU (buzzer, potem host) -> z powrotem całkowicie ukryty ekran QR.
    await qrToggleBtn(page, "buzzer", false).click();
    await expectQrSingle(displayPage, "host");
    await qrToggleBtn(page, "host", false).click();
    await expectQrOff(displayPage);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 9. Finał bez wczesnego wyjścia: obaj gracze, wszystkie 10 pytań =====
//
// Odwrotność testu 4 (który celowo pomija gracza 2). Punkty dobrane tak, że
// suma finału NIGDY nie osiąga finalTarget (200) nawet po 10 trafieniach
// (5×15 + 4×15 = 135, jedno pytanie gracza 2 to "powtórzenie" = 0 pkt) —
// gwarantuje przejście przez KAŻDY krok F1-F10, w tym ten, którego dotyczyła
// dzisiejsza naprawa: odpowiedzi gracza 1 muszą wrócić widoczne na Display
// w momencie startu rundy 2. Host NIE — ustalona zasada dla całego Control:
// zasłonięcie jest jednokierunkowe (silnik sam nigdy nie odsłania, tylko
// lokalny "peek" operatora), więc Host zostaje zasłonięty przez cały finał.

test("control2: finał — obaj gracze, wszystkie 10 pytań, naturalne wygaśnięcie timera, powtórzenie, odsłonięcie P1 na Display przy starcie P2", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  // 180s okazało się za ciasne w CI: 15s realnego oczekiwania na timer
  // gracza 1 + 10 pytań mapowania, z których KAŻDE ma teraz poprawnie
  // wymuszaną blokadę na długość dźwięku "Pokaż odpowiedź"/"Pokaż punkty"
  // (actionGate.js, migracja 264) -- test realnie docierał do pytania 8/10
  // dokładnie w 180000ms, bez żadnego faktycznego zawieszenia (potwierdzone
  // diagnostyką [e2e-diag-state]: każdy commit/lock w całym przebiegu
  // rozstrzygał się w <1s). Zapas, nie naprawa buga.
  test.setTimeout(300_000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-FINALFULL-${Date.now()}`, {
    roundQuestions: [{ ord: 1, text: "Pytanie testowe (runda)", answers: [{ ord: 1, text: "Odp. warta 276", fixed_points: 92 }] }],
    finalAnswerPts: 15,
    settings: { game: { advanced: { endScreenMode: "money", roundMultipliers: [3], finalMinPoints: 276 } } },
  });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Start rundy jest zablokowany, dopóki Display nie zakończy planszy intro
    // i dźwięku. Ten krok może trwać ok. 21 s, więc nie klikaj w trakcie gate.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    // ===== Runda jedyna: A wygrywa próg finału (276 pkt) =====
    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await page.keyboard.press("c");
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toHaveClass(/c2-tile-armed/);
    await page.keyboard.press("Enter");
    await settleAfterWrite(page);
    await expect(page.locator(".c2-tilegrid")).toBeVisible();
    const standardGameplayRowHeight = await page.locator(".c2-tilegrid").evaluate((grid) =>
      grid.firstElementChild?.getBoundingClientRect().height || 0);
    expect(standardGameplayRowHeight).toBeGreaterThan(0);
    await revealAnswer(page, 1);
    await strikeOutAndLoseSteal(page);
    await endRoundAndRevealRest(page, "Przejdź do finału");
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Finał"), { timeout: 22000 });

    // ===== F1: start finału =====
    await clearSfxLog(page);
    await clearDisplayLog(displayPage);
    await page.getByRole("button", { name: "Rozpocznij finał" }).click();
    // final_theme -> reveal, sekwencyjnie (soundReactor.js's playSequentialCombo).
    await waitForSfxSequence(page, ["final_theme", "reveal"], 15000);
    // Wskaźnik na zwycięzcy (A) i zapowiedź "15" na jego stronie (dzisiejsza naprawa) —
    // obie rzeczy widoczne w tym samym zestawie wywołań co narysowanie planszy finału.
    await expect.poll(async () => {
      const calls = await getDisplayCalls(displayPage);
      return calls.some((c) => c.call === "api.indicator.set" && c.args[0] === "ON_A")
        && calls.some((c) => c.call === "api.small.rightDigits" && c.args[0] === "15");
    }, { timeout: 10000 }).toBe(true);
    await expect(hostPage.locator("#cover2")).toHaveClass(/coverOn/, { timeout: 10000 });

    // ===== F2/F3: gracz 1 wpisuje, timer wygasa NATURALNIE (bez klikania "Dalej") =====
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(/Finał\s*(—\s*)?gracz 1,\s*wpisywanie/), { timeout: 22000 });
    const p1Inputs = page.locator("#app input[type=text]");
    await expect(p1Inputs).toHaveCount(5, { timeout: 10000 });
    await expect(page.getByRole("button", { name: "Dalej", exact: true })).toBeDisabled();
    await p1Inputs.nth(0).evaluate((input) => { window.__entryInputBefore = input; window.__entryTimerBefore = document.querySelector(".c2-timer-row"); });
    for (let i = 0; i < 5; i++) await p1Inputs.nth(i).fill(`Odp. finałowa`);
    await expect.poll(() => page.evaluate(() => window.__entryInputBefore === document.querySelector(".c2-entryrow input") && window.__entryTimerBefore === document.querySelector(".c2-timer-row"))).toBe(true);

    await clearSfxLog(page);
    // Start zegarka to zaznacz->potwierdź (nieodwracalne — usedP1 jednorazowe).
    await p1Inputs.nth(0).focus();
    await page.keyboard.press("Control+Enter");
    await expect(page.locator('[data-timer-role="final"]')).toBeVisible();
    // Bez klikania niczego: dograny dziś zegarek w control/js/app.js sam
    // dispatch'uje EXPIRE_TIMER po 15s. Zegarek jest jednorazowy (usedP1) —
    // kafel wraca WIDOCZNY (jak w starym Control), ale pokazuje "Czas
    // wykorzystany" i jest ZABLOKOWANY, bo nie da się go odpalić drugi raz
    // w tej samej rundzie.
    await expect(page.getByRole("button", { name: "Czas wykorzystany" })).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole("button", { name: "Czas wykorzystany" })).toBeDisabled();
    await expect.poll(() => getSfxKeys(page), { timeout: 5000 }).toEqual(expect.arrayContaining(["time_over"]));

    // ===== F4/F5: mapowanie gracza 1 — trafienie wszystkich 5x15 pkt =====
    await page.getByRole("button", { name: "Dalej" }).click();
    for (let i = 0; i < 5; i++) {
      await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(`Finał — mapowanie ${i + 1}/5`), { timeout: 22000 });
      if (i === 0) {
        await expectMappingFieldFits(page, testInfo, "p1");
        const field = page.locator(".c2-mapinput input");
        await page.keyboard.press("i");
        await expect(field).toBeFocused();
        await field.fill("");
        await expect(page.getByRole("button", { name: "Odp. finałowa (15)" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Nie ma na liście (0 pkt)" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Brak odpowiedzi", exact: true })).toBeEnabled();
        await field.fill("Odp. finałowa");
        await expect(field).toBeFocused();
        await expect(page.getByRole("button", { name: "Brak odpowiedzi", exact: true })).toBeDisabled();
        await page.keyboard.press("Enter");
        await expect(field).not.toBeFocused();
      }
      // Zgłoszone: wybór dopasowania w finale też idzie przez zaznacz ->
      // potwierdź (armableTile), jak reszta konsekwentnych kafli.
      await p1Inputs.first().evaluate(() => document.activeElement?.blur());
      // Klawisz podczas przejścia planszy ma być ignorowany; poczekaj na
      // faktyczne odblokowanie kafla, zamiast wyprzedzać dźwięk testem.
      await expect(page.locator('[data-shortcut="1"]')).toBeEnabled({ timeout: 22000 });
      const mappingRevBefore = await page.evaluate(async (id) =>
        (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id);
      await page.locator("#app .c2-tile").evaluateAll((tiles) => { window.__mappingTilesBefore = tiles; });
      await page.keyboard.press("1");
      await expect(page.locator('[data-shortcut="1"]')).toHaveClass(/c2-tile-primary/);
      await expect.poll(async () => page.evaluate(async (id) =>
        (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id)).toBeGreaterThan(mappingRevBefore);
      expect(await page.locator("#app .c2-tile").evaluateAll((tiles) =>
        tiles.length === window.__mappingTilesBefore.length && tiles.every((tile, i) => tile === window.__mappingTilesBefore[i]))
      ).toBe(true);
      if (i === 0) {
        const activeMappingRev = await page.evaluate(async (id) =>
          (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id);
        await page.locator('[data-shortcut="1"]').click();
        await page.waitForTimeout(300);
        expect(await page.evaluate(async (id) =>
          (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id)
        ).toBe(activeMappingRev);
      }
      if (i === 0) {
        await expect(hostPage.locator("#paperText2 .hostGreen:not(.hostStrike)")).toHaveText("z listy");
        await expect(hostPage.locator("#paperText2 .hostStrike")).toHaveText("Odp. finałowa (15)");
      }
      await armAndConfirm(page.getByRole("button", { name: "Pokaż odpowiedź" }));
      await armAndConfirm(page.getByRole("button", { name: "Pokaż punkty" }));
      // Suma widoczna na ekranie mapowania (ui.js's finalStatusBar) —
      // sprawdzona TU, na ostatnim pytaniu, PRZED "Dalej", bo ten klik
      // (NEXT_QUESTION, nextIdx>5) już przenosi na f_p2_start, gdzie tego
      // statusbara nie ma.
      if (i === 4) await expect(page.getByText("Suma finału: 75")).toBeVisible({ timeout: 10000 });
      await page.getByRole("button", { name: "Dalej" }).click();
    }
    // Suma 75 < finalTarget (200) — BEZ wczesnego wyjścia, prosto do F6.

    // ===== F6: przejście do gracza 2 — TU jest sedno testu =====
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Finał — start rundy 2"), { timeout: 22000 });
    await clearDisplayLog(displayPage);
    await page.getByRole("button", { name: "Rozpocznij 2 rundę" }).click();

    // Display: odpowiedzi gracza 1 wracają odsłonięte (przejście planszy
    // `transition`, od f235fc4e zamiast animIn), NIE placeholder.
    await expect.poll(async () => {
      const calls = await getDisplayCalls(displayPage, "api.final.setHalf");
      const last = calls.at(-1);
      return !!last
        && last.args[0] === "A"
        && !!last.args[1].transition
        && last.args[1].rows.every((r) => r.left === "Odp. finałowa" && r.a === "15");
    }, { timeout: 10000 }).toBe(true);
    // Host NIE odsłania się tutaj — ustalona zasada dla całego Control
    // (nie tylko finału): zasłonięcie wrażliwej treści jest jednokierunkowe,
    // silnik nigdy sam jej nie zdejmuje (state.host.covered ustawiane na
    // true raz, w START_FINAL, i nigdy z powrotem na false w engine.js).
    // Jedyny sposób odsłonięcia to lokalny, nieprzechowywany w game_state
    // gest "peek" operatora na urządzeniu Hosta.
    await expect(hostPage.locator("#cover2")).toHaveClass(/coverOn/, { timeout: 10000 });

    // Formalna asercja samego gestu "peek" (dotąd demonstrowana TYLKO w
    // tests/e2e/record-playthrough.js, bez pokrycia w tym pliku, zgłoszone):
    // Host odsłania się lokalnie po geście, BEZ żadnej zmiany w game_state
    // (control/host/js/render.js's `peeked`), i zasłona wraca sama przy KOLEJNEJ
    // zmianie stanu gry (nie trzeba nic specjalnie robić, żeby ją przywrócić).
    //
    // ZNALEZIONY PRZY OKAZJI REALNY BUG (nie tylko testu -- diagnostyka
    // pokazała klasę #cover2 nigdy się nie zmieniającą po geście):
    // control/host/js/main.js's setupPeekSwipe wołało
    // `renderer.setPeek(!renderer.isCovered())`. isCovered() = authoritative
    // Covered && !peeked -- na starcie gestu (zasłonięte, peeked=false)
    // isCovered() JUŻ zwraca true, więc !isCovered()=false -> setPeek(false)
    // -> peeked zostawało false, bez żadnej zmiany. Gest nigdy nie mógł
    // zadziałać za pierwszym razem w DOKŁADNIE tej sytuacji, w której
    // operator chce go użyć. Naprawione: setPeek(!isPeeked()) -- przełącza
    // WŁASNY stan, nie wypadkową dwóch zmiennych.
    await hostPeekSwipe(hostPage);
    await expect(hostPage.locator("#cover2")).toHaveClass(/coverOff/, { timeout: 5000 });

    // ===== F7: gracz 2 — pytanie #1 oznaczone jako "powtórzenie" =====
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Finał — gracz 2, wpisywanie"), { timeout: 22000 });
    await clearSfxLog(page);
    // "Powtórzenie" WŁĄCZANE jest teraz zaznacz->potwierdź (konsekwentne:
    // dźwięk + wymuszony SKIP w mapowaniu, ui.js) -- jak reszta kosztownych
    // kafli finału. Wyłączenie zostaje jednoklikowe (bezpieczne, bez efektu
    // ubocznego), ale tu włączamy, więc armAndConfirm.
    await page.getByRole("button", { name: "Powtórzenie" }).first().click();
    await expect.poll(() => getSfxKeys(page), { timeout: 5000 }).toEqual(expect.arrayContaining(["answer_repeat"]));
    // Zasłona wraca SAMA przy tej pierwszej kolejnej zmianie stanu gry po
    // peeku wyżej — bez żadnej dodatkowej akcji operatora na Hoście.
    await expect(hostPage.locator("#cover2")).toHaveClass(/coverOn/, { timeout: 10000 });

    const p2Inputs = page.locator("#app input[type=text]");
    for (const viewport of [{ width:1366, height:768 }, { width:1920, height:1080 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator(".c2-gameplay-body").evaluate(el => el.scrollHeight <= el.clientHeight + 2)).toBe(true);
    }
    await page.setViewportSize({ width:1366, height:768 });
    const p1AnswerTile = page.locator(".c2-entrytile-p1ans").first();
    const p1AnswerBounds = await p1AnswerTile.evaluate((el) => {
      const text = el.getBoundingClientRect();
      const tile = el.parentElement.getBoundingClientRect();
      return { top: text.top, bottom: text.bottom, tileTop: tile.top, tileBottom: tile.bottom, height: text.height };
    });
    expect(p1AnswerBounds.height).toBeGreaterThan(0);
    expect(p1AnswerBounds.top).toBeGreaterThanOrEqual(p1AnswerBounds.tileTop);
    expect(p1AnswerBounds.bottom).toBeLessThanOrEqual(p1AnswerBounds.tileBottom);
    await page.screenshot({ path: testInfo.outputPath("shot-final-p2-entry.png") });
    const p2EntryGrid = await page.locator(".c2-entryrows").evaluate((grid) => {
      const rect = (node) => {
        const { x, y, width, height, left, right } = node.getBoundingClientRect();
        return { x, y, width, height, left, right };
      };
      return {
        tracks: getComputedStyle(grid).gridTemplateRows.split(" ").map((value) => Number.parseFloat(value)),
        gap: Number.parseFloat(getComputedStyle(grid).rowGap),
        entry: rect(grid),
        main: rect(grid.closest(".c2-roundlayout-main")),
        layout: rect(grid.closest(".c2-roundlayout")),
        card: rect(document.querySelector(".control-main-card")),
        viewport: { width: innerWidth, scrollX, scrollWidth: document.documentElement.scrollWidth },
      };
    });
    expect(p2EntryGrid.tracks).toHaveLength(6);
    expect(p2EntryGrid.gap).toBe(10);
    expect(p2EntryGrid.layout.left).toBeGreaterThanOrEqual(p2EntryGrid.card.left);
    expect(p2EntryGrid.layout.right).toBeLessThanOrEqual(p2EntryGrid.card.right);
    expect(p2EntryGrid.viewport.scrollWidth).toBeLessThanOrEqual(p2EntryGrid.viewport.width);
    for (const height of p2EntryGrid.tracks) {
      expect(Math.abs(height - standardGameplayRowHeight), `kafle wpisywania mają tę samą wysokość co pozostałe; wpisywanie=${height}px, runda=${standardGameplayRowHeight}px, układ=${JSON.stringify(p2EntryGrid)}`).toBeLessThan(1);
    }
    const repeatFirst = page.locator(".c2-entryrow .c2-btn-repeat").first();
    await expect(repeatFirst).toHaveClass(/\bon\b/);
    await expect(repeatFirst).toBeEnabled();
    await clearSfxLog(page);
    await repeatFirst.click();
    await expect(repeatFirst).toHaveClass(/\bon\b/);
    await expect.poll(() => getSfxKeys(page)).toEqual(expect.arrayContaining(["answer_repeat"]));
    await expect(p2Inputs.nth(0)).toBeEnabled();
    await p2Inputs.nth(0).focus();
    await expect(repeatFirst).toHaveClass(/\bon\b/);
    await p2Inputs.nth(0).evaluate(() => { window.__repeatButtonBefore = document.querySelector(".c2-btn-repeat"); });
    await p2Inputs.nth(0).fill("Inna odpowiedź");
    await expect.poll(() => page.evaluate(() => window.__repeatButtonBefore === document.querySelector(".c2-btn-repeat"))).toBe(true);
    await expect(repeatFirst).not.toHaveClass(/\bon\b/);
    await expect(repeatFirst).toBeDisabled();
    await p2Inputs.nth(0).fill("");
    await page.getByRole("button", { name: "Powtórzenie" }).first().click();
    for (let i = 1; i < 5; i++) await p2Inputs.nth(i).fill("Odp. finałowa");
    // Start/stop zegarka to zaznacz->potwierdź (patrz wyżej).
    await armAndConfirm(page.getByRole("button", { name: "Rozpocznij odliczanie (20s)" }));
    // Zgłoszone: "po drugiej rundzie finału nawet nie czeka na koniec
    // timera i przechodzi dalej" — "Dalej" jest teraz zablokowany, dopóki
    // zegarek TEJ rundy aktywnie odlicza (control/js/ui.js's
    // renderFinalEntry) — nie da się już przerwać go tym przyciskiem.
    // Zatrzymujemy więc legalnie, przez sam kafel zegarka (wszystkie pola
    // gracza 2 już wypełnione/oznaczone powtórzeniem, więc wczesne
    // zatrzymanie jest dozwolone — finalTimerRow), zamiast czekać pełne 20s.
    // START_MAPPING (engine.js) nadal bezwarunkowo zeruje stan zegarka przy
    // wejściu w mapowanie — to sprawdzenie zostaje, tylko dochodzi się tam
    // teraz legalną ścieżką, nie przypadkowym przerwaniem w trakcie.
    await expect(page.getByRole("button", { name: "Zatrzymaj" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Czas wykorzystany" })).toBeVisible({ timeout: 25000 });
    await page.getByRole("button", { name: "Dalej" }).click();

    // ===== F8/F9: mapowanie gracza 2 — pytanie #1 to SKIP (powtórzenie), reszta MATCH =====
    for (let i = 0; i < 5; i++) {
      if (i === 0) {
        await expectMappingFieldFits(page, testInfo, "p2");
        await expect(page.getByRole("button", { name: "Odp. finałowa (15)" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Nie ma na liście (0 pkt)" })).toBeDisabled();
        await expect(page.getByRole("button", { name: "Brak odpowiedzi", exact: true })).toBeEnabled();
        await expect(page.getByRole("button", { name: "Powtórzenie", exact: true })).toBeEnabled();
      }
      await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(`Finał — mapowanie ${i + 1}/5`), { timeout: 22000 });
      if (i > 0) await armAndConfirm(page.getByRole("button", { name: "Odp. finałowa (15)" }));
      await armAndConfirm(page.getByRole("button", { name: "Pokaż odpowiedź" }));
      // C2-14 (engine.js's REVEAL_ANSWER_ONLY): dla kind!=MATCH (tu i=0,
      // "powtórzenie" -> SKIP) ten sam klik od razu dogrywa REVEAL_POINTS --
      // "Pokaż punkty" zostaje trwale wyszarzone (nie ma czego potwierdzać),
      // więc dla i=0 go NIE klikamy, inaczej armAndConfirm czeka w kółko na
      // przycisk, który nigdy się nie odblokuje.
      if (i > 0) await armAndConfirm(page.getByRole("button", { name: "Pokaż punkty" }));
      if (i < 4) await page.getByRole("button", { name: "Dalej" }).click();
    }
    // 75 (gracz 1) + 0 (powtórzenie) + 4x15 (gracz 2) = 135 < 200 — pełne 10/10, bez wczesnego wyjścia.
    await clearSfxLog(page);
    await page.getByRole("button", { name: "Zakończ finał", exact: true }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Koniec gry"), { timeout: 22000 });
    await expect(page.getByText("Suma finału: 135")).toBeVisible({ timeout: 10000 });

    // Najpierw kończy się przejście wyniku; dopiero potem liczymy dźwięki outro.
    await expect(page.getByRole("button", { name: "Zakończ grę", exact: true })).toBeEnabled({ timeout: 30000 });
    await waitForSfxKeysAnyOrder(page, ["final_theme", "reveal"], 10000);
    // ===== F10: koniec finału =====
    await clearSfxLog(page);
    await page.getByRole("button", { name: "Zakończ grę", exact: true }).click();
    await waitForSfxKeysAnyOrder(page, ["show_outro"], 15000);
    expect(await getSfxKeys(page)).not.toContain("round_transition");
    expect(await getSfxKeys(page)).not.toContain("reveal");
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.win.set")).at(-1)?.args[0], { timeout: 15000 }).toBe(828);
    const finalSessions = await readControl2Sessions(page, game.id);
    expect(finalSessions).toHaveLength(1);
    expect(finalSessions[0]).toMatchObject({ status: "final", final_points: 135 });
    expect(finalSessions[0].team_a_score - finalSessions[0].rounds_score_a).toBe(135);
    expect(finalSessions[0].stats_detail.final.mapping1).toHaveLength(5);
    expect(finalSessions[0].stats_detail.final.mapping2).toHaveLength(5);
    expect(finalSessions[0].stats_detail.end_reason).toBe("final_complete");
    expect(finalSessions[0].stats_detail.prize).toBe(828); // regulamin: 276 z rund × 3 (cel nieosiągnięty)
    await attachStatistics(testInfo, "full-final", finalSessions);
    await expect.poll(async () => {
      const calls = await getDisplayCalls(displayPage, "api.indicator.set");
      return calls.at(-1)?.args[0] === "ON_A";
    }, { timeout: 10000 }).toBe(true);

    expect(errors, "żadne z urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 10. Mnożnik rundy =====

test("control2: mnożnik rundy — runda 4. z domyślnym ×2 faktycznie przemnaża bank", async ({ page, browser, accounts, loginAs }, testInfo) => {
  // Ten sam wzorzec i przyczyna co przy teście "pełny finał" (patrz
  // komentarz przy jego test.setTimeout(240_000) wyżej w tym pliku) --
  // zdiagnozowane 1:1 z logów [e2e-diag-state] CI (run #299/#300, oba
  // solo I w pełnym zestawie): 4 pełne rundy x ~30-35s realnego czasu
  // (gate dźwięku/animacji + polling anon zamiast prawdziwego push +
  // RTT do produkcyjnego Supabase) to legalnie ~120-140s SAMEJ rozgrywki,
  // zanim test w ogóle dotrze do rundy 4 -- bez żadnego faktycznego
  // zawieszenia (każdy commit/lock w logach rozstrzygał się w <1s,
  // zero luk >8s w całym przebiegu). Domyślne 150_000ms z góry pliku to
  // za ciasny margines na tę długość testu, nie błąd aplikacji. Zapas,
  // nie naprawa buga.
  test.setTimeout(300_000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const roundQ = (n) => ({ ord: n, text: `Pytanie rundowe ${n}`, answers: [{ ord: 1, text: "Jedyna odpowiedź", fixed_points: 40 }] });
  // 5. pytanie (nieużywane) tylko po to, żeby pula NIE wyczerpała się po
  // rundzie 4 -- z dokładnie 4 pytaniami R9's gałąź ③ ("pula wyczerpana")
  // przenosiła grę PROSTO do r_gameEnd zaraz po "Zakończ rundę", zanim
  // asercja "Alfa: 200" zdążyła cokolwiek sprawdzić -- na tym ekranie nie
  // ma już paska statusu z wynikiem drużyn wcale (inny render, patrz
  // ui.js's renderEndScreen). Silnik liczył mnożnik CAŁKOWICIE poprawnie
  // przez cały czas (potwierdzone diagnostyką [e2e-diag-state] na żywo:
  // totals.A=200 dokładnie w momencie przejścia step -> r_gameEnd) -- to
  // był test sprawdzający złą rzecz w złym momencie, nie bug aplikacji.
  const game = await makeGame(page, `E2E-CONTROL2-MULTIPLIER-${Date.now()}`, {
    roundQuestions: [roundQ(1), roundQ(2), roundQ(3), roundQ(4), roundQ(5)],
  });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    // Rundy 1-3: mnożnik x1 (domyślne roundMultipliers [1,1,1,2,3]) — A odsłania
    // wszystkie odpowiedzi (40 + dopełnienie 4 + 4 = bank 48), a "Zakończ rundę"
    // przy wszystkim odsłoniętym finalizuje rundę od razu (bez R8). Pudła
    // i kradzież nie mają wpływu na mnożnik, a ich bramki dźwięku zjadały
    // ~40 s z limitu 240 s (2026-10-23); pełna ścieżka zostaje w rundzie 4.
    for (let round = 1; round <= 3; round++) {
      await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(`Runda ${round}`), { timeout: 22000 });
      await startRoundConfirmed(page);
      await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 60000 });
      await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
      await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
      await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
      await revealAnswer(page, 1);
      await revealAnswer(page, 2);
      await revealAnswer(page, 3);
      await clickConfirmed(page.getByRole("button", { name: "Zakończ rundę" }));
    }
    await expect(page.getByText("Alfa: 144")).toBeVisible({ timeout: 10000 });

    // Runda 4: mnożnik x2 — bank 40 ma dać +80, nie +40.
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 4"), { timeout: 22000 });
    await startRoundConfirmed(page);
    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 60000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await revealAnswer(page, 1);
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });
    await strikeOutAndLoseSteal(page);
    await endRoundAndRevealRest(page, "Przejdź do następnej rundy");

    await expect(page.getByText("Alfa: 224")).toBeVisible({ timeout: 10000 }); // 144 + 40x2, nie 184
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 11. Wyścig dwóch przycisków Buzzera =====

test("control2: wyścig — oba przyciski Buzzera naciśnięte w tej samej chwili, tylko jeden zaakceptowany", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-BUZZRACE-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    // Oba kliknięcia wystrzelone w tym samym ticku JS — dwa równoległe
    // wywołania game_state_buzzer_press ścigające się o ten sam wiersz
    // (plan, sekcja 1: atomowy warunkowy UPDATE, nie wyścig po stronie klienta).
    await buzzerPage.evaluate(() => {
      document.getElementById("btnA")?.click();
      document.getElementById("btnB")?.click();
    });

    // renderDuelAccept() pokazuje TERAZ jeden wspólny kafel "Zatwierdź:
    // <drużyna>", z nazwą tego, kto naprawdę wygrał wyścig (duel.lastPressed)
    // — tylko ten jeden kafel w ogóle istnieje w DOM. Trzeba odtworzyć literę
    // drużyny z nazwy, żeby wskazać właściwy #btnA/#btnB na stronie Buzzera.
    const acceptAlfa = page.getByRole("button", { name: "Zatwierdź: Alfa" });
    const acceptBeta = page.getByRole("button", { name: "Zatwierdź: Beta" });
    await expect.poll(async () => (await acceptAlfa.count()) + (await acceptBeta.count()), { timeout: 10000 }).toBeGreaterThan(0);
    const winner = (await acceptAlfa.count()) > 0 ? "A" : "B";
    const loser = winner === "A" ? "B" : "A";
    const winnerName = winner === "A" ? "Alfa" : "Beta";

    // control/buzzer/js/render.js's deriveButtonState czyta duel.firstTeam, nie
    // duel.lastPressed — a firstTeam ustawia dopiero ACCEPT_BUZZ (Control
    // klika "Zatwierdź: X"). Bez tego kliknięcia Buzzer zostaje w STATE.ON
    // (oba przyciski "dim") na zawsze — trzeba faktycznie przyjąć zgłoszenie,
    // zanim sprawdzimy, który przycisk się zaświecił.
    await armAndConfirm(page.getByRole("button", { name: `Zatwierdź: ${winnerName}` }));

    // Buzzer i Control muszą się zgadzać co do tego, KTO wygrał wyścig.
    await expect(buzzerPage.locator(`#btn${winner}`)).toHaveClass(/lit/, { timeout: 10000 });
    await expect(buzzerPage.locator(`#btn${loser}`)).toHaveClass(/dim/, { timeout: 10000 });
    await expect(buzzerPage.locator(`#btn${winner}`)).not.toHaveClass(/dim/);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 11b. Ponów naciśnięcie (RETRY_DUEL) =====

test("control2: Ponów naciśnięcie — odrzuca błędne zgłoszenie, Buzzer otwiera się na nowo", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-RETRYDUEL-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    // A naciska pierwszy -- Control pokazuje wspólny kafel "Zatwierdź: Alfa"
    // RAZEM z "Ponów naciśnięcie" pod nim (renderDuelAccept, tryb normalny
    // Buzzera) -- operator może albo przyjąć zgłoszenie, albo uznać je za
    // błędne/przypadkowe i otworzyć Buzzer na nowo.
    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Ponów naciśnięcie" })).toBeVisible();

    // "Ponów naciśnięcie" to bezpieczna, odwracalna akcja (RETRY_DUEL) --
    // celowo jednoklikowa, w odróżnieniu od "Zatwierdź" (zaznacz->potwierdź).
    await clickConfirmed(page.getByRole("button", { name: "Ponów naciśnięcie" }));

    // RETRY_DUEL czyści duel.lastPressed -- oba kafle (Zatwierdź/Ponów)
    // znikają, drużyny wracają do czystego, nieklikalnego stanu wskaźnika.
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ponów naciśnięcie" })).toHaveCount(0);

    // Teraz zgłasza się B -- przyjmujemy normalnie, dowód że Buzzer
    // naprawdę wrócił do nasłuchu po "Ponów naciśnięcie", nie tylko
    // wizualnie na ekranie Control.
    await buzzerPage.getByRole("button", { name: "Przycisk B" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Beta" })).toBeVisible({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Beta" }));

    await revealAnswer(page, 1); // B trafia -> przejmuje kontrolę
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 12. Wyciszenie dźwięku =====

test("control2: wyciszenie dźwięku — Mute zeruje wyjście, zachowując zdarzenia audio", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-MUTE-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    // Referencja: BEZ wyciszenia start rundy gra normalnie. Czekamy na CAŁY
    // combo (soundCueEngine.js's playSyncedCombo: "reveal", jako krótszy
    // dźwięk, leci z setTimeout PO "round_transition") — inaczej ten
    // opóźniony "reveal" wystrzeliłby dopiero PO włączeniu Mute niżej,
    // fałszywie wyglądając jak wyciek dźwięku mimo wyciszenia.
    await clearSfxLog(page);
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await waitForSfxKeysAnyOrder(page, ["round_transition", "reveal"], 10000);

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await page.keyboard.press("m");
    await expect(page.locator("#btnMute .ico-speaker-off")).toHaveCount(1);

    await clearSfxLog(page);
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await revealAnswer(page, 1); // normalnie: buzzer_press + answer_correct
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });

    const mutedSfx = await page.evaluate(() => window.__sfxLog || []);
    expect(mutedSfx.map((entry) => entry.key), "Mute nie może zatrzymywać zdarzeń dźwiękowych ani ich synchronizacji").toContain("buzzer_press");
    expect(mutedSfx.every((entry) => entry.muted), "każde zdarzenie po Mute musi przejść przez zerowy master gain").toBe(true);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 12b. Dźwięk ze źródła Wyświetlacz: odblokowanie, głośność, mute =====
//
// Zgłoszone: "dodaj testy... jeden test niech używa dźwięku z display i tez
// sprawdź mute na chwilę w jednej z rund np. i pokrec głośności" — i po
// doprecyzowaniu: "suwaki w ustawieniach a suwaki w podsumowaniu to różne
// rzeczy". Przechodzi przez CAŁĄ ścieżkę na raz: przełącznik "Dźwięk" w
// kroku Urządzeń -> #audioUnlockScreen na Display (musi się pojawić,
// kliknięcie musi je schować) -> DWA różne suwaki, dwie różne kategorie
// dźwięku (żeby nie dało się ich pomylić w asercjach): (a) osobna strona "Zmień
// ustawienia" -> games.settings.sound jako punkt wyjściowy, denormalizacja
// do game_state dopiero po powrocie z ustawień; (b) suwak BEZPOŚREDNIO w
// sekcji "Dźwięk" Podsumowania (control/js/ui.js's soundSummarySection)
// -> zapis prosto do game_state na żywo, bez przechodzenia na stronę ustawień. Oba muszą dotrzeć do
// Display (nie do Control — sprawdzone osobno, że Control zostaje cicho
// przez cały czas) -> Mute (współdzielony, patrz control/js/soundReactor.js)
// wyciszony na chwilę w środku rundy, potem wznowiony — ten sam #btnMute co
// w teście "wyciszenie dźwięku" wyżej, tylko że tym razem wycisza
// urządzenie, które FAKTYCZNIE gra (Display).

test("control2: dźwięk ze źródła Wyświetlacz — odblokowanie, głośność z ustawień, chwilowe mute w rundzie", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-SOUNDSRC-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    let displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });

    // Domyślnym źródłem jest Control, więc Display nie prosi o odblokowanie.
    await expect(displayPage.locator("#audioUnlockScreen")).toBeHidden();
    const nextStep = page.getByRole("button", { name: "Dalej" });
    await expect(nextStep).toBeEnabled({ timeout: 10000 });

    // Przełącznik dwustanowy (.toggle-group, jak "Losowo"/"Wybierz" w
    // ustawieniach gry) — widoczny tekst opcji to CSS content:attr(data-text)
    // na ::before, niewidoczny dla getByLabel/getByText; klikamy widoczną
    // etykietę .toggle-item po wartości ukrytego radio, ten sam wzorzec co
    // game-settings.spec.js's analogiczne przełączniki.
    await page.locator('.toggle-item:has(input[name="soundSource"][value="display"])').click();
    const devicesFitAfterAudioSwitch = await page.locator(".c2-devices-layout .c2-scroll-area").evaluate((el) => el.scrollHeight <= el.clientHeight + 1);
    if (!devicesFitAfterAudioSwitch) console.log("[e2e-diag] devices-fit-audio", await devicesFitDiag(page));
    expect(devicesFitAfterAudioSwitch, "włączenie dźwięku z Wyświetlacza nie powinno dodawać przewijania na normalnym ekranie").toBe(true);
    await expect(displayPage.locator("#audioUnlockScreen")).not.toHaveClass(/\bhidden\b/, { timeout: 10000 });
    await expect(nextStep).toBeDisabled({ timeout: 10000 });
    await displayPage.locator("#btnAudioUnlock").click();
    await expect(displayPage.locator("#audioUnlockScreen")).toHaveClass(/\bhidden\b/);
    await expect(nextStep).toBeEnabled({ timeout: 10000 });

    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });

    // Dwa RÓŻNE mechanizmy, dwie różne kategorie dźwięku, żeby nie dało się
    // ich pomylić w asercjach:
    //
    // (a) Osobna strona "Zmień ustawienia" -> games.settings.sound -> denormalizacja
    //     do game_state DOPIERO po powrocie z ustawień (applyGameSettingsToState() w
    //     control/js/app.js). To jest "punkt wyjściowy" — trwały, per-gra
    //     domyślny zapis, edytowalny tylko tam (warianty/pliki własne też).
    //
    // (b) Suwak BEZPOŚREDNIO w sekcji "Dźwięk" Podsumowania
    //     (control/js/ui.js's soundSummarySection) -> zapis PROSTO do
    //     game_state ("settings.setSoundVolume" w app.js), NA ŻYWO, bez
    //     dotykania games.settings i bez przechodzenia na stronę ustawień.
    //
    // Zgłoszone wprost: to są różne rzeczy, oba mają działać i oba mają być
    // przetestowane osobno — strona ustawień zmienia "round_transition", Podsumowanie
    // zmienia "reveal", więc każda asercja wiąże się jednoznacznie z jednym
    // z dwóch mechanizmów.

    // (a) games.settings jako punkt wyjściowy — zmiana jest jawnie zapisana
    // na osobnej stronie ustawień przed powrotem do Control.
    await page.getByRole("button", { name: "Zmień ustawienia" }).click();
    await page.waitForURL(/\/games\/settings\//, { timeout: 15000 });
    // #gsTeamA staje się widoczny dopiero po zakończeniu async inicjalizacji
    // (blokady, wczytanie gry) — dopiero wtedy sidebar ma podpięte handlery.
    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 15000 });
    await page.locator('.gs-sidebar-item[data-cat="sound"]').click();
    const transitionSlider = page.locator('input.sfx-vol[data-sfx-vol="round_transition"]');
    await expect(transitionSlider).toBeVisible({ timeout: 10000 });
    // .fill() na <input type="range"> nie zawsze niezawodnie odpala "input"
    // — ustawiamy value i wysyłamy zdarzenie wprost.
    await transitionSlider.evaluate((el) => {
      el.value = "70";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#btnSaveAll").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "saved", { timeout: 30000 });
    await page.locator("#btnBack").click();
    await page.waitForURL(/\/control(?:\/|\?)/, { timeout: 15000 });
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 15000 });

    await expect.poll(
      () => displayPage.evaluate(() => localStorage.getItem("sfx_vol_round_transition")),
      { timeout: 10000, message: "głośność 'round_transition' skonfigurowana na stronie ustawień powinna dotrzeć do Display" }
    ).toBe("0.7");

    // (b) game_state na żywo — suwak w Podsumowaniu, bez przechodzenia na stronę ustawień.
    const revealSlider = page.locator('input.summarySoundVol[data-sfx-vol="reveal"]');
    await expect(revealSlider).toBeVisible({ timeout: 10000 });
    // "input" (przeciąganie) tylko podgląd lokalny; dopiero "change"
    // (puszczenie suwaka) commituje do game_state — patrz komentarz w ui.js.
    await revealSlider.evaluate((el) => {
      el.value = "40";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.locator('.summarySoundRow:has(input[data-sfx-vol="reveal"]) .summarySoundVolLabel')).toHaveText("40%");

    await expect.poll(
      () => displayPage.evaluate(() => localStorage.getItem("sfx_vol_reveal")),
      { timeout: 10000, message: "głośność 'reveal' zmieniona w Podsumowaniu (game_state) powinna dotrzeć do Display natychmiast" }
    ).toBe("0.4");

    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();

    await clearSfxLog(page);
    await clearSfxLog(displayPage);
    // Start rundy czeka, aż Display skończy planszę intro z dźwiękiem (ok. 21 s).
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await waitForSfxSequence(displayPage, ["round_transition"], 10000);
    // Control ma soundSource="control" domyślnie wyłączone — zero dźwięku
    // powinno polecieć TAM, wszystko idzie przez Display.
    expect(await getSfxKeys(page), "Control nie powinien grać nic, gdy źródłem jest Wyświetlacz").toEqual([]);

    // ===== Odpowiedź #1 (bez mute) — dowód normalnego odtwarzania z Display =====
    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await clearSfxLog(displayPage);
    await revealAnswer(page, 1); // Odpowiedź A, 40 pkt -> wygrywa pojedynek
    await waitForSfxSequence(displayPage, ["answer_correct"], 10000);

    // Ponowne podłączenie Display w trakcie gry wymaga nowego gestu audio.
    // Control blokuje odsłanianie do momentu potwierdzenia przez nową kartę.
    await displayPage.context().close();
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bbad\b/, { timeout: 20000 });
    await expect(page.locator("#deviceLostOverlay")).toBeVisible({ timeout: 10000 });
    await page.locator("#deviceLostOverlay .uni-foot .btn.gold").click();
    displayPage = await reconnectViaModal(browser, page, "display", contexts, []);
    await expect(displayPage.locator("#audioUnlockScreen")).toBeVisible({ timeout: 15000 });
    await expect(answerTile(page, 2)).toBeDisabled();
    // Odblokowanie zapisuje heartbeat głównej instancji lease (migracja 397).
    const reUnlockAck = displayPage.waitForResponse((response) =>
      response.url().includes("/rpc/control_device_instance_heartbeat")
      && response.request().postDataJSON()?.p_meta?.audio_unlocked === true
    );
    await displayPage.locator("#btnAudioUnlock").click();
    const reUnlockAckResponse = await reUnlockAck;
    expect((await reUnlockAckResponse.json())?.audio_unlocked,
      "reconnected Display's unlock must be stored on its lease instance").toBe(true);
    await expect(displayPage.locator("#audioUnlockScreen")).toBeHidden({ timeout: 10000 });
    await expect(answerTile(page, 2)).toBeEnabled({ timeout: 15000 });
    // Diagnostyka: czekanie na gest trafia do statystyk z powodem i czasem.
    await expect.poll(async () => {
      const sessions = await readControl2Sessions(page, game.id);
      const unlock = (sessions[0]?.stats_detail.events || []).find(event => event.category === "audio_unlock");
      return unlock ? [unlock.metrics.reason, unlock.metrics.outcome, unlock.metrics.wait_ms > 0] : null;
    }, { timeout: 15000 }).toEqual(["new_instance", "unlocked", true]);

    // ===== Mute na chwilę w tej samej rundzie — odpowiedź #2 podczas wyciszenia =====
    await page.locator("#btnMute").click();
    await expect(page.locator("#btnMute .ico-speaker-off")).toHaveCount(1);
    await expect.poll(() => displayPage.evaluate(() => window.__sfxMuted)).toBe(true);
    await clearSfxLog(displayPage);
    await revealAnswer(page, 2); // Odpowiedź B, 30 pkt
    await expect(page.getByText("Bank: 70")).toBeVisible({ timeout: 10000 });
    // Aktualizacja planszy może dotrzeć przed końcem asynchronicznego
    // dekodowania pliku dźwiękowego. Czekamy na wywołanie playSfx, ale
    // sprawdzamy zarazem, że miało miejsce przy aktywnym wyciszeniu.
    await waitForSfxSequence(displayPage, ["answer_correct"], 10000);
    const mutedDisplaySfx = await displayPage.evaluate(() => window.__sfxLog || []);
    expect(mutedDisplaySfx.map((entry) => entry.key), "wyciszony Display nadal musi odebrać cue i zachować synchronizację").toContain("answer_correct");
    expect(mutedDisplaySfx.every((entry) => entry.muted), "Display ma wyciszyć wyjście dla każdego cue").toBe(true);

    // ===== Un-mute — odpowiedź #3 znów słyszalna =====
    await page.locator("#btnMute").click();
    await expect(page.locator("#btnMute .ico-speaker-on")).toHaveCount(1);
    await clearSfxLog(displayPage);
    await revealAnswer(page, 3); // Odpowiedź C, 20 pkt -> wszystko odkryte
    await waitForSfxSequence(displayPage, ["answer_correct"], 10000);

    // Control przez całą rundę zostaje cicho — dowód, że gating jest
    // symetryczny (nie tylko "Display gra", ale i "Control naprawdę nie gra").
    expect(await getSfxKeys(page)).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 13. Zmiana języka propaguje się do urządzeń, w tym treść Hosta =====
//
// Sprawdza całą ścieżkę na raz: przełącznik w topbarze Control -> zapis
// settings.uiLang do game_state -> odczyt przez control/host/js/main.js -> setUiLang
// -> control/host/js/render.js's t()-owane tytuły faz. Regresja na dzisiejszą
// naprawę: wcześniej control/host/js/render.js miał te napisy zaszyte na sztywno po
// polsku, więc nawet gdyby cała reszta ścieżki działała, treść by się nie
// zmieniła.

test("control2: zmiana języka w Control propaguje się do Hosta — tytuł fazy faktycznie się tłumaczy", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-LANG-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(hostPage.locator("#paperText1")).toContainText("PRZYCISK", { timeout: 10000 });
    await expect(hostPage.locator("#p2Hint")).toContainText("zasłonić");
    await expect(hostPage.locator("#cover2Swipe")).toContainText("odsłonić");

    await page.locator(".lang-btn").click();
    // Zmiana języka leci przez window "i18n:lang" -> store.commit() poza
    // kolejką engine.dispatch() (ten sam wzorzec co Mute) — bez czekania na
    // faktyczny zapis test sprawdzał Hosta, zanim uiLang w ogóle dotarło.
    await clickConfirmed(page.locator('.menu-item[data-lang="en"]'));

    await expect(hostPage.locator("#paperText1")).toContainText("BUZZER", { timeout: 10000 });
    await expect(hostPage.locator("#paperText1")).not.toContainText("PRZYCISK");
    await expect(hostPage.locator("#p2Hint")).toContainText("cover");
    await page.locator(".lang-btn").click();
    await clickConfirmed(page.locator('.menu-item[data-lang="pl"]'));
    await expect(hostPage.locator("#p2Hint")).toContainText("zasłonić");
    await expect(hostPage.locator("#cover2Swipe")).toContainText("odsłonić");
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 14. Osobna strona ustawień — podgląd, zapis i powrót do Control =====
//
// Zgłoszone: podgląd Wyświetlacza na stronie ustawień
// (games/settings/js/game-settings.js) był całkowicie martwy — sendDisplayCmd()
// tekstowe komendy do window.parent, licząc na Control, żeby je dalej
// przekazał "prawdziwemu" Displayowi (czego Control v2 nigdy nie robi —
// komend już nie ma). Naprawa: strona ustawień osadza /control/display?preview=1 i
// przesyła mu postMessage familijna:preview-row, ten sam mechanizm co D3.
// Ten test dowodzi, że to faktycznie działa: zmiana nazwy drużyny w polu
// formularza musi się pojawić w window.__displayLog ZAGNIEŻDŻONEGO iframe'a
// podglądu (control/display/js/main.js's instrumentSceneApi(), dodane też do trybu
// podglądu w tej samej naprawie) jako wywołanie api.small.long1(...).
test("control2: strona ustawień gry — zmiana nazwy drużyny odświeża podgląd Wyświetlacza", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-GSPREVIEW-${Date.now()}`);
  const contexts = [];
  try {
    // "Dalej" wymaga WSZYSTKICH trzech urządzeń online -- bez sparowania
    // zostaje trwale disabled (patrz analogiczna naprawa w teście "Zacznij
    // od nowa" wyżej).
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });

    // Ustawienia są osobną stroną. Otwieramy je widocznym przyciskiem,
    // zapisujemy jawnie i wracamy przez topbar — bez starego skrótu
    // klawiaturowego, który nie jest częścią tego scenariusza.
    await page.getByRole("button", { name: "Zmień ustawienia" }).click();
    await page.waitForURL(/\/games\/settings\//, { timeout: 15000 });

    // Kategoria "Drużyny" jest domyślnie aktywna — pole nazwy drużyny A jest
    // widoczne od razu, bez przełączania zakładek.
    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 15000 });

    // Iframe podglądu (control/display/js/main.js's bootPreview()) osadzony
    // przez samą stronę ustawień — dostępny wprost z page.frames().
    const previewFrame = () => page.frames().find((f) => f.url().includes("/control/display") && f.url().includes("preview=1"));
    await expect.poll(() => previewFrame()?.url(), { timeout: 10000 }).toBeTruthy();
    await expect.poll(async () => {
      try { return await previewFrame().evaluate(() => Array.isArray(window.__displayLog)); } catch { return false; }
    }, { timeout: 10000 }).toBe(true);

    await previewFrame().evaluate(() => { window.__displayLog = []; });
    await page.locator("#gsTeamA").fill("Testowi Mistrzy");

    await expect.poll(async () => {
      const log = await previewFrame().evaluate(() => window.__displayLog || []);
      return log.some((e) => e.call === "api.small.long1" && e.args?.[0] === "Testowi Mistrzy");
    }, { timeout: 10000 }).toBe(true);

    await page.locator("#btnSaveAll").click();
    await expect(page.locator("#gsFooterMsg")).toHaveAttribute("data-state", "saved", { timeout: 30000 });
    await page.locator("#btnBack").click();
    await page.waitForURL(/\/control(?:\/|\?)/, { timeout: 30000 });
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 15000 });
    await expect(page.locator(".c2-summary-teams .summarySectionValue")).toContainText("Testowi Mistrzy");
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 15. Blokada logo — Control (i strona ustawień gry) czekają, aż
// logo-editor.js zwolni logo referencowane przez grę =====
//
// js/core/resource-lock.js's guardResourceBusy() — dodane w tej sesji do
// control/js/app.js i js/pages/game-settings.js (patrz komentarze przy
// obu wywołaniach): to urządzenie NIE edytuje logo, tylko je referuje na
// żywo (podgląd Wyświetlacza), więc nie trzyma własnej blokady — tylko
// czeka, aż logo-editor.js (jedyny prawdziwy posiadacz "logo" locka)
// zwolni swoją. Ten sam wzorzec i te same asercje (#resourceLockGuard) co
// cross-resource-locks.spec.js's testy Warstwy A/B dla logo, tu
// zweryfikowany od strony Control v2 zamiast game-settings.js/logo-editor.js
// wprost. Blokada jest zajmowana bezpośrednio przez RPC (bez faktycznego
// otwierania logo-editor.html) — to samo, co realnie robi ta strona po
// kliknięciu "Edytuj", tylko bez UI, żeby test nie zależał od jej
// konkretnych selektorów.
function blankGlyphPayload() {
  return {
    layers: [{ color: "main", rows: Array.from({ length: 10 }, (_, i) => i === 4 ? "FAMILIJNA".padStart(19).padEnd(30) : " ".repeat(30)) }],
    source: { mode: "TEXT" },
  };
}

async function acquireLogoLock(page, logoId, tabId) {
  return page.evaluate(async ({ logoId, tabId }) => {
    const { data, error } = await window.__sbClient.rpc("acquire_edit_lock_mode", {
      p_resource_type: "logo", p_resource_id: logoId, p_tab_id: tabId, p_context: "logo-editor", p_mode: "exclusive",
    });
    if (error) throw new Error("acquire_edit_lock failed: " + error.message);
    return data;
  }, { logoId, tabId });
}

async function releaseLogoLock(page, logoId, tabId) {
  await page.evaluate(async ({ logoId, tabId }) => {
    await window.__sbClient.rpc("release_edit_lock", {
      p_resource_type: "logo", p_resource_id: logoId, p_tab_id: tabId,
    });
  }, { logoId, tabId }).catch(() => {});
}

test("control2: zablokowany, gdy logo gry jest edytowane w logo-editorze — i wznawia się samo po zwolnieniu", async ({ page, context, browser, accounts, loginAs }, testInfo) => {
  // Ten test sam zakłada wyłączny lock logo. Bierzemy drugie wypożyczone
  // konto, by wcześniejszy Control z tego samego worker-a nie zostawił jeszcze
  // wspólnego locka `logos` podczas zamykania karty i nie zablokował fixture.
  await loginAs(page, context, accounts.standard[1]);

  const logoName = `E2E-CONTROL2-LOGOLOCK-${Date.now()}`;
  const { logoId, gameId } = await page.evaluate(async ({ name, payload }) => {
    const sb = window.__sbClient;
    const { data: userData } = await sb.auth.getUser();
    const { data: logo, error: logoErr } = await sb.from("user_logos")
      .insert({ user_id: userData.user.id, name, type: "GLYPH_30x10", payload })
      .select("id").single();
    if (logoErr) throw new Error("insert logo failed: " + logoErr.message);
    const { data: game, error: gameErr } = await sb.from("games")
      .insert({
        name: `E2E-CONTROL2-LOGOLOCKGAME-${Date.now()}`,
        owner_id: userData.user.id, type: "prepared", status: "ready",
        settings: { teams: { teamA: "Alfa", teamB: "Beta" }, game: { hasFinal: false }, display: { logoId: logo.id } },
      })
      .select("id").single();
    if (gameErr) throw new Error("insert game failed: " + gameErr.message);
    return { logoId: logo.id, gameId: game.id };
  }, { name: logoName, payload: blankGlyphPayload() });

  // stan "play" wymaga >= 10 pytań, inaczej overlay stanu przykrywa blokadę logo.
  // Pytania przed sesją Control: aktywny Control blokuje treść gry
  // (game_content_locked:control_active).
  await padGame(page, gameId);
  const { hostKey, displayKey } = await page.evaluate(async (gid) => {
    const sb = window.__sbClient;
    const { data: session, error: sessionError } = await sb.rpc("control_runtime_session_touch", { p_game_id: gid, p_session_id: null });
    if (sessionError || !session?.ok) throw new Error(sessionError?.message || session?.error || "Control session failed");
    const { data: host, error: hostError } = await sb.rpc("control_runtime_device_link", { p_game_id: gid, p_device_type: "host" });
    const { data: display, error: displayError } = await sb.rpc("control_runtime_device_link", { p_game_id: gid, p_device_type: "display" });
    if (hostError || displayError || !host?.ok || !display?.ok) throw new Error(hostError?.message || displayError?.message || "Device token failed");
    return { hostKey: host.token, displayKey: display.token };
  }, gameId);
  const logoContexts = [];
  let hostPage;
  const lockTabId = `e2e-fake-logo-editor-${Date.now()}`;
  try {
    const acquired = await acquireLogoLock(page, logoId, lockTabId);
    expect(acquired, `fixture must hold an exclusive logo lock before opening Control; RPC returned ${JSON.stringify(acquired)}`).toMatchObject({ ok: true, acquired: true });
    hostPage = await openAnon(browser, logoContexts, `/control/host?id=${gameId}&key=${hostKey}`, "host", []);

    await page.goto(`/control?id=${gameId}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#resourceLockGuard")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#resourceLockGuardMsg")).toContainText("Trwa edycja logo", { timeout: 5000 });
    // Zablokowany PRZED wyrenderowaniem czegokolwiek z #app (guardResourceLocks
    // jest wołane zanim Control zdąży namalować krok "Urządzenia").
    await expect(page.locator(".stepTitle")).toHaveCount(0);

    // Host renders the pixel logo as a canvas; SVG is only used by the
    // source variant. This fixture is defaulting to the pixel renderer.
    await expect(hostPage.locator("#cover2Logo canvas")).toHaveCount(1, {timeout:10000});
    await releaseLogoLock(page, logoId, lockTabId);

    // Odzyskanie działa DWIEMA niezależnymi drogami (broadcast RELEASED +
    // polling co 5s) — ten test celowo nie synchronizuje się z broadcastem,
    // żeby przy okazji sprawdzić fallback pollingu.
    await expect(page.locator("#resourceLockGuard")).toBeHidden({ timeout: 15000 });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByLabel("Przycisk fizyczny").check();
    await openAnon(browser, logoContexts, `/control/display?id=${gameId}&key=${displayKey}`, "display", []);
    await page.getByRole("button", {name:"Dalej",exact:true}).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie");
    await expect.poll(() => hostPage.locator("#cover2Logo canvas").evaluateAll(canvases => canvases.some(canvas => {
      const pixels = canvas.getContext("2d").getImageData(0,0,canvas.width,canvas.height).data;
      return pixels.some((value,idx) => idx % 4 === 3 && value > 0);
    })), {timeout:15000}).toBe(true);
  } finally {
    await Promise.all(logoContexts.map(context => context.close().catch(() => {})));
    await releaseLogoLock(page, logoId, lockTabId);
    await page.evaluate(async (id) => { await window.__sbClient.from("games").delete().eq("id", id); }, gameId);
    await page.evaluate(async (id) => { await window.__sbClient.from("user_logos").delete().eq("id", id); }, logoId);
  }
});

// ===== 16. Udostępnianie urządzenia przez e-mail =====
//
// Jedyne dotychczasowe pokrycie tej funkcji (control/js/shareDevice.js)
// żyło WYŁĄCZNIE w tests/e2e/record-playthrough.js (scenariusz 8) — realne
// asercje, ale uruchamiane tylko ręcznie, w ramach wolnego workflow
// produkującego wideo (e2e-record.yml), nigdy w zwykłym, szybkim cyklu
// (e2e-tests.yml). Ten test to ten sam przebieg, bez nagrywania: operator
// (test1) udostępnia urządzenie Prowadzącego drugiemu, PRAWDZIWEMU kontu
// (test7 — poza pulą control2 (test1..test<workery>) i inny niż odbiorcy
// maili w bases.spec.js (test6) i subscriptions.spec.js (test8), bo
// clearMailbox kasuje całą skrzynkę odbiorcy), czeka na realny e-mail (ten sam
// tests/e2e/helpers/mailbox.js co bases.spec.js's "@mailbox" testy) i
// dowodzi, że link z maila faktycznie łączy -- NOWY, niezalogowany kontekst
// przeglądarki otwiera go i dostaje działającą stronę Prowadzącego, bez
// żadnego logowania (token jednego odbiorcy w URL-u wystarcza).
test("@mailbox control2: udostępnianie urządzenia (Prowadzący) przez e-mail -- link z maila faktycznie łączy", async ({ page, context, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(300000); // setup + pełny interwał mail-worker + otwarcie linku
  const recipient = accounts.standard[1].email;
  await loginAs(page, context, accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-SHAREMAIL-${Date.now()}`);
  const contexts = [];
  let recipientSetupPage = null, recipientUid = null, recipientOriginalFlag = null;
  try {
    await resetMailProviderLimits(page);
    await clearMailbox(recipient);

    // Zgłoszone: maile mają cooldown/suppression, żeby nie spamować -- przy
    // wielokrotnym testowaniu na TYM SAMYM koncie trzeba to ręcznie zdjąć w
    // bazie przed testem. familijna-server/docs/email-system-description.md: mail-worker
    // POMIJA wysyłkę CICHO (bez błędu), gdy user_flags.email_notifications
    // odbiorcy jest false -- wygląda identycznie jak zwykły timeout, tylko
    // mail nigdy się nie zjawi. test7 jest tu odbiorcą w WIELU przebiegach
    // tego testu (każdy dzień CI) -- zamiast liczyć na to, że nikt nigdy
    // nie zgasił tej flagi (np. inny test klikający link wypisujący),
    // wymuszamy ją z powrotem na true PRZED udostępnieniem: logujemy się
    // NA KONTO ODBIORCY w osobnym, efemerycznym kontekście (user_flags ma
    // RLS tylko na własny wiersz -- auth.uid()=user_id) i nadpisujemy.
    // Ten sam kontekst usuwa też udostępnienie z poprzedniego przebiegu
    // (e2e_shared_devices_cleanup, migracja 287) -- shared_devices ma TTL
    // 4h i UNIQUE (owner,recipient,typ) GLOBALNIE na konto, nie per-grę,
    // więc inaczej kolejny przebieg tego samego dnia zastaje już istniejące
    // udostępnienie i #shareDeviceCurrentContent nigdy nie pokaże formularza
    // "Dodaj" (zdiagnozowane w tests/e2e/record-playthrough.js's bliźniaczym
    // scenariuszu, CI run #30).
    const ownerUid = await page.evaluate(async () => {
      const { data } = await window.__sbClient.auth.getUser();
      return data?.user?.id || null;
    });
    const recipientSetupContext = await controlContext(browser);
    contexts.push(recipientSetupContext);
    recipientSetupPage = await recipientSetupContext.newPage();
    await loginAs(recipientSetupPage, recipientSetupContext, accounts.standard[1]);
    const identity = await recipientSetupPage.evaluate(async () => {
      const client = window.__sbClient, user = (await client.auth.getUser()).data.user;
      const { data, error } = await client.from("user_flags").select("email_notifications").eq("user_id", user.id).maybeSingle();
      if (error) throw new Error(error.message);
      return { id: user.id, flag: data?.email_notifications ?? true };
    });
    recipientUid = identity.id; recipientOriginalFlag = identity.flag;
    await recipientSetupPage.evaluate(async ({ ownerId, recipientId }) => {
      const client = window.__sbClient;
      const { error } = await client.from("user_flags").upsert({ user_id: recipientId, email_notifications: true }, { onConflict: "user_id" });
      if (error) throw new Error(error.message);
      if (ownerId) await client.rpc("e2e_shared_devices_cleanup", { p_other_user_id: ownerId });
    }, { ownerId: ownerUid, recipientId: recipientUid });

    // ZNALEZIONA REALNA PRZYCZYNA (run #333): list_my_device_shares() (RPC
    // za #shareDeviceCurrentContent) zwraca WSZYSTKIE udostępnienia danego
    // device_type dla operatora -- niezależnie od odbiorcy I od gry -- a UI
    // bierze po prostu pierwsze dopasowanie. test1 (operator, na stałe) ma
    // "host" udostępniony test2 z osobnego, niepowiązanego przebiegu
    // tests/e2e/record-playthrough.js (ten sam hardcodowany operator) --
    // e2e_shared_devices_cleanup wyżej czyści tylko parę (test1,test7), nie
    // (test1,test2), więc ten stary wpis został i modal pokazywał "test2"
    // zamiast świeżo dodanego "test7". Czyścimy więc TU, szeroko, każde
    // istniejące "host"-udostępnienie operatora, niezależnie od odbiorcy --
    // to jest czysto porządek testowy (operator i tak zawsze zaczyna ten
    // test z zerowym stanem), nie zmiana produktowego zachowania.
    const staleHostShares = await page.evaluate(async () => {
      const { data } = await window.__sbClient.rpc("list_my_device_shares");
      return (data || []).filter((s) => s.device_type === "host").map((s) => s.recipient_id);
    });
    for (const staleRecipientId of staleHostShares) {
      await page.evaluate(async (rid) => {
        await window.__sbClient.rpc("unshare_device", { p_recipient_user_id: rid, p_device_type: "host" });
      }, staleRecipientId);
    }

    const after = new Date(Date.now() - 2_000).toISOString();

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });

    // Dwa okna jak w Bazach: „Udostępnij” (adres + znajomi) i „Udostępnienia” (lista w tej sesji).
    await page.locator('[data-device="host"] [data-act="share-send"]').click();
    await expect(page.locator("#shareDeviceSendOverlay")).toBeVisible({ timeout: 10000 });
    // Regresja CSS: brak klamry wcześniej zagnieżdżał te reguły pod finałem.
    await expect(page.locator('[data-device="host"]')).toHaveCSS("border-top-style", "solid");
    await expect(page.locator("#shareDeviceSendOverlay .shareModal")).toHaveCSS("max-width", "720px");
    await expect(page.locator("#shareDeviceSubsList")).toHaveCSS("overflow-y", "auto");
    await page.locator("#shareDeviceEmail").fill(accounts.standard[1].username);
    await page.locator("#btnShareDeviceAdd").click();
    await expect(page.locator("#shareDeviceSendOverlay")).toBeHidden();
    await page.locator('[data-device="host"] [data-act="share-list"]').click();
    await expect(page.locator("#shareDeviceOverlay")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#shareDeviceCurrentContent")).toHaveCSS("overflow-y", "auto");
    // Potwierdzenie zapisu w UI (RPC share_device) -- niezależne od tego,
    // czy/kiedy realny e-mail dotrze. shareDevice.js's `current.recipient_
    // username || current.recipient_email` -- skoro test7 ma ustawiony
    // username, modal pokazuje SAMĄ nazwę użytkownika ("test7"), nie pełny
    // e-mail -- real finding z pierwszego przebiegu CI, nie zgadywane.
    // E25: nazwa konta (e2e.standardNN) różni się od części adresu (e2e+standardNN).
    const recipientUsername = accounts.standard[1].username;
    await expect(page.locator("#shareDeviceCurrentContent")).toContainText(recipientUsername, { timeout: 15000 });

    // Okno „Udostępnij”: dwie sekcje (adres, znajomi) i znikający wspólny komunikat.
    await page.locator("#btnShareDeviceDone").click();
    await expect(page.locator("#shareDeviceOverlay")).toBeHidden();
    await page.locator('[data-device="host"] [data-act="share-send"]').click();
    await expect(page.locator("#shareDeviceSendOverlay")).toBeVisible({ timeout: 10000 });
    await expect(page.locator("#shareDeviceSendOverlay .shareSection")).toHaveCount(2);
    page.on("response", async (res) => {
      if (!res.url().includes("/rpc/control_device_share_preflight_by_lookup")) return;
      const data = await res.json().catch(() => null);
      const row = Array.isArray(data) ? data[0] : data;
      // tylko flagi (repo publiczne: bez adresów i nazw)
      const flags = row && typeof row === "object" ? Object.fromEntries(Object.entries(row).filter(([, v]) => typeof v === "boolean" || v === null)) : row;
      console.log(`[e2e-diag] preflight_by_lookup ${res.status()} ${JSON.stringify(flags)} err=${row?.error || ""}`);
    });
    await page.locator("#shareDeviceEmail").fill(recipient);
    await expect(page.locator(".app-toast-text")).toContainText("już udostępniono", { timeout: 10000 });
    const messageShot = testInfo.outputPath("shot-control-share-message.png");
    await page.screenshot({ path: messageShot, fullPage: true });
    await testInfo.attach("control-share-message", { path: messageShot, contentType: "image/png" });
    await expect(page.locator("#btnShareDeviceAdd")).toBeDisabled();
    await expect(page.locator(".app-toast-text")).toBeHidden({ timeout: 5000 });
    // Zniknięcie komunikatu nie odblokowuje duplikatu udostępnienia.
    await expect(page.locator("#btnShareDeviceAdd")).toBeDisabled();
    const readyShot = testInfo.outputPath("shot-control-share-ready.png");
    await page.screenshot({ path: readyShot, fullPage: true });
    await testInfo.attach("control-share-ready", { path: readyShot, contentType: "image/png" });

    // Zgłoszony realny bug naprawiony migracją 287: share_device() robiło
    // ON CONFLICT DO UPDATE bez sygnalizowania wywołującemu, czy to nowy
    // wiersz czy aktualizacja -- shareDevice.js wysyłało więc pełny mail
    // przy KAŻDYM "Dodaj", nawet dla już istniejącego udostępnienia. Test
    // bezpośrednio (RPC, bez UI) powtarza share_device dla tego samego
    // odbiorcy/typu i sprawdza created=false -- to jest naprawiony sygnał,
    // na którym shareDevice.js opiera decyzję "wysłać drugi mail czy nie",
    // bez kosztu drugiego 90s oczekiwania na pocztę.
    const repeatResult = await page.evaluate(async ({ recipientId, gameId }) => {
      const { data, error } = await window.__sbClient.rpc("control_device_share_create", {
        p_recipient_user_id: recipientId,
        p_recipient_email: null,
        p_device_type: "host",
        p_game_id: gameId,
      });
      return { data, error: error?.message || null };
    }, { recipientId: recipientUid, gameId: game.id });
    expect(repeatResult.error).toBeNull();
    expect(repeatResult.data?.ok).toBe(true);
    expect(repeatResult.data?.created, "duplikat grantu dla aktywnej sesji nie tworzy nowego tokenu ani ponownego maila").toBe(false);

    // Mail-worker działa co 2 minuty. W produkcyjnym przebiegu 38129826723
    // wiadomość nadal była pending po 90 s, a dotarła po ok. 122 s;
    // używamy 150 s, żeby pokryć pełny interwał i czas dostawcy.
    const email = await waitForEmail({ recipient, after, subject: /Udostępniono urządzenie/, timeout: 150_000 });
    expectMailDocument(email, { accountFooter: true });
    const links = extractHttpLinks(email).filter((u) => u.includes("/go/") && u.includes("d=host"));
    expect(links.length, "mail musi zawierać działający link do /go/?d=host").toBeGreaterThan(0);

    await page.locator("#btnShareDeviceSendClose").click();

    // Odbiorca klika link z maila -- zupełnie NOWY, niezalogowany kontekst
    // (nie ten sam user/sesja co operator) -- dowód, że token grantu
    // URL-u wystarcza, bez żadnego logowania.
    // Prowadzący wymaga ekranu dotykowego (blokada urządzenia) — kontekst z dotykiem.
    const recipientContext = await controlContext(browser, { hasTouch: true });
    contexts.push(recipientContext);
    const recipientPage = await recipientContext.newPage();
    await recipientPage.goto(links[0], { waitUntil: "domcontentloaded" });
    // ZNALEZIONA REALNA PRZYCZYNA (diagnostyka, run #297): host2.html NIE MA
    // w ogóle elementu "#app" -- to selektor skopiowany przez pomyłkę z
    // control2.html's konwencji (tam root #app istnieje). host2.html's
    // prawdziwy, statyczny root to #paper (main.paperSplit), z #paperText1/
    // #paperText2 w środku -- diagnostyka potwierdziła, że strona faktycznie
    // działa poprawnie (game_state_get 200 w ~1s, device_ping tyka dalej w
    // nieskończoność), więc "#app" po prostu NIGDY nie mógł się znaleźć,
    // niezależnie od timeoutu -- stąd każdy dotychczasowy przebieg tego
    // testu musiał paść.
    await expect(recipientPage.locator("#paper")).toBeVisible({ timeout: 15000 });
  } finally {
    try {
      if (recipientUid && recipientOriginalFlag !== null) await recipientSetupPage.evaluate(async ({ id, value }) => {
        const { error } = await window.__sbClient.from("user_flags").upsert({ user_id: id, email_notifications: value }, { onConflict: "user_id" });
        if (error) throw new Error(error.message);
      }, { id: recipientUid, value: recipientOriginalFlag });
    } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await clearMailbox(recipient).catch(() => {});
    await deleteGame(page, game.id);
    }
  }
});

// ===== 17. Zerwanie i ponowne podłączenie urządzeń =====
//
// Jedyne dotychczasowe pokrycie tego scenariusza (zamknięcie WSZYSTKICH
// trzech urządzeń naraz w środku rundy, ponowne podłączenie przez modal
// kropki statusu w topbarze) żyło wyłącznie w tests/e2e/record-playthrough.js
// (scenariusz 6) -- znowu: realne, ale tylko w ramach wolnego workflow
// nagrywania wideo, zero pokrycia w szybkim cyklu. To jest dokładnie ten
// scenariusz, po który cała przebudowa Control na wspólną tabelę stanu
// (game_state) powstała -- dowód, że stan gry przeżywa rozłączenie każdego
// urządzenia niezależnie od Control, bez żadnej ręcznej resynchronizacji
// poza ponownym wejściem na URL urządzenia.

// Modal kropki statusu (control/js/app.js's showQrModal): Wyświetlacz ma
// bezpośredni link "Otwórz" (#qrModalOpen); Prowadzący i Przycisk — kod QR
// rysowany lokalnie (SVG, bez adresu w atrybucie) i sześciocyfrowy kod,
// który operator wpisuje na urządzeniu w /connect/.
async function readDeviceUrlFromModal(control, kind) {
  if (kind === "display") return control.locator("#qrModalOpen").getAttribute("href");
  await expect(control.locator("#qrModalImg")).toHaveAttribute("src", /^data:image\/svg/);
  const code = String(await control.locator("#qrModalCodeVal").textContent() || "").replace(/\D/g, "");
  return code.length === 6 ? `code:${code}` : "";
}

// Pełny cykl "operator odzyskuje rozłączone urządzenie": klik na kropkę
// statusu w topbarze (klikalna PRZEZ CAŁĄ GRĘ, nie tylko na kroku
// Urządzeń), odczyt linku z modala, otwarcie go w ZUPEŁNIE NOWYM kontekście
// przeglądarki (świeży localStorage/deviceId -- wierniejsza symulacja
// realnego ponownego podłączenia niż zwykły reload tej samej, wciąż
// istniejącej karty), zamknięcie modala, czekanie na zieloną kropkę.
async function reconnectViaModal(browser, control, kind, contexts, errors) {
  const rowId = `#dot${kind[0].toUpperCase()}${kind.slice(1)}Row`;
  await control.locator(rowId).click();
  const url = await readDeviceUrlFromModal(control, kind);
  if (!url) throw new Error(`modal (${kind}) nie pokazał żadnego URL-a do ponownego podłączenia`);
  // Prowadzący i Przycisk wymagają ekranu dotykowego (jak w openAnon).
  const ctx = await controlContext(browser, { hasTouch: true, viewport: { width: 1366, height: 1024 } });
  contexts.push(ctx);
  const p = await ctx.newPage();
  trackErrors(p, kind, errors);
  instrumentAnon(p, kind);
  if (url.startsWith("code:")) {
    await p.goto("/connect/", { waitUntil: "domcontentloaded" });
    await p.locator("#connectCodeInput").fill(url.slice(5));
    await p.locator("#btnConnectCode").click();
    await p.locator(".uni-foot .btn.gold").click();
    await expect.poll(() => new URL(p.url()).pathname, { timeout: 15000 }).toBe(`/control/${kind}/`);
  } else {
    await p.goto(url, { waitUntil: "domcontentloaded" });
  }
  await control.locator("#qrModalClose").click();
  await expect(control.locator(`#dot${kind[0].toUpperCase()}${kind.slice(1)}`)).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
  return p;
}

test("control2: awaria odczytu stanu urządzeń wstrzymuje akcje bez fałszywego rozłączenia", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-PRESENCE-${Date.now()}`, { roundQuestions: TWO_QUESTIONS });
  const contexts = [];
  try {
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display");
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host");
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer");

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    const startRoundButton = page.getByRole("button", { name: "Rozpocznij rundę" });
    // r_gameStart holds the game lock briefly; don't confuse that intentional
    // lock with a lease/read failure while preparing the metadata outage.
    // Intro „Klasyczne” trwa 32 s; przycisk odblokowuje się po nim.
    await expect(startRoundButton).toBeEnabled({ timeout: 60000 });
    await startRoundButton.click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    const confirm = page.getByRole("button", { name: "Zatwierdź: Alfa" });
    await expect(confirm).toBeEnabled({ timeout: 10000 });

    // Migawka control_devices_snapshot jest jedynym źródłem stanu urządzeń:
    // bez niej Control wstrzymuje akcje, ale nie ogłasza rozłączenia.
    let failedReads = 0;
    const snapshotRoute = "**/rest/v1/rpc/control_devices_snapshot*";
    await page.route(snapshotRoute, route => {
      failedReads++;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "E2E: device snapshot unavailable" }) });
    });
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    await expect(confirm).toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(7500);
    await expect(confirm).toBeDisabled();
    await expect(page.locator("#deviceLostOverlay")).toBeHidden();
    for (const id of ["dotDisplay", "dotHost", "dotBuzzer"]) {
      await expect(page.locator(`#${id}`)).toHaveClass(/\bok\b/);
    }

    const connectivityEvents = async (phase) => {
      const sessions = await readControl2Sessions(page, game.id);
      return (sessions[0]?.stats_detail.events || []).filter(event => event.category === "connectivity" && event.metrics?.phase === phase).length;
    };
    // Pierwszy nieudany odczyt przy świeżej migawce nie blokuje (decyzja 2.11),
    // drugi z rzędu już tak.
    await expect.poll(() => connectivityEvents("read_retry")).toBe(1);
    await expect.poll(() => connectivityEvents("read_error")).toBe(1);
    await page.unroute(snapshotRoute);
    await expect(confirm).toBeEnabled({ timeout: 10000 });
    await expect.poll(() => connectivityEvents("recovered")).toBe(1);
    const sessions = await readControl2Sessions(page, game.id);
    expect((sessions[0].stats_detail.events || []).filter(event => event.kind === "disconnect")).toHaveLength(0);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

test("control2: zerwanie połączenia wszystkich trzech urządzeń naraz i ponowne podłączenie przez modal", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  await deleteStaleReconnectTestGames(page);
  const game = await makeGame(page, `E2E-CONTROL2-RECONNECT-${Date.now()}`, { roundQuestions: TWO_QUESTIONS });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    let displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    let buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });

    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + animacja) blokuje start rundy przez kilkanaście sekund.
    const startRoundButton = page.getByRole("button", { name: "Rozpocznij rundę" });
    await expect(startRoundButton).toBeEnabled({ timeout: 60000 });
    await startRoundButton.click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await clearDisplayLog(displayPage);
    await revealAnswer(page, 1); // odp. #1 (top) -> wygrywa pojedynek, reszta rundy zostaje NIEODSŁONIĘTA

    // Awaria odczytu nie jest dowodem rozłączenia urządzeń.
    const snapshotRoute = "**/rest/v1/rpc/control_devices_snapshot*";
    let failedReads = 0;
    await page.route(snapshotRoute, route => {
      failedReads++;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "E2E: device snapshot unavailable" }) });
    });
    await expect.poll(() => failedReads).toBeGreaterThan(0);
    await expect(answerTile(page, 2)).toBeDisabled({ timeout: 5000 });
    await page.waitForTimeout(7500); // Przekrocz TTL urządzeń podczas awarii odczytu.
    for (const id of ["dotDisplay", "dotHost", "dotBuzzer"]) {
      await expect(page.locator(`#${id}`)).toHaveClass(/\bok\b/);
    }
    await expect(page.locator("#deviceLostOverlay")).toBeHidden();
    const unavailableSessions = await readControl2Sessions(page, game.id);
    expect((unavailableSessions[0].stats_detail.events || []).filter(event => event.kind === "disconnect")).toHaveLength(0);
    await page.unroute(snapshotRoute);
    await expect(answerTile(page, 2)).toBeEnabled({ timeout: 10000 });

    // ===== Zerwanie wszystkich trzech naraz =====
    const toClose = contexts.splice(0, contexts.length); // zdejmij z listy sprzątanej w finally -- zamykamy je TU, świadomie
    await Promise.all(toClose.map((ctx) => ctx.close()));
    // Primary lease wygasa po 12 s; pagehide release jest best-effort, więc
    // Control przełącza status dopiero po serwerowym wygaśnięciu lease.
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bbad\b/, { timeout: 15000 });
    await expect(page.locator("#dotHost")).toHaveClass(/\bbad\b/, { timeout: 15000 });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bbad\b/, { timeout: 15000 });
    await expect(answerTile(page, 2)).toBeDisabled();
    await expect(page.locator(".c2-gameplay .msg-pill")).toHaveCount(0);
    await expect(page.locator("#deviceLostOverlay")).toBeVisible();
    await expect(page.locator("#deviceLostOverlay .mSub")).toContainText("Wyświetlacz");
    await expect(page.locator("#deviceLostOverlay .uni-foot .btn.gold")).toHaveText("OK");
    await page.locator("#deviceLostOverlay .uni-foot .btn.gold").click();
    const revBefore = await page.evaluate(async (id) => (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id);
    await answerTile(page, 2).evaluate((button) => button.click());
    const revAfter = await page.evaluate(async (id) => (await window.__sbClient.from("game_state").select("rev").eq("game_id", id).single()).data.rev, game.id);
    expect(revAfter).toBe(revBefore);

    // ===== Ponowne podłączenie po kolei, przez modal =====
    // Decyzja 2026-10-29: poza pojedynkiem tylko Wyświetlacz wstrzymuje grę;
    // brak Prowadzącego/Przycisku to ostrzeżenie nad podpowiedzią.
    displayPage = await reconnectViaModal(browser, page, "display", contexts, errors);
    await expect(page.locator("#deviceLostOverlay")).toBeHidden();
    await expect(answerTile(page, 2)).toBeEnabled({ timeout: 10000 });
    await expect(page.locator(".c2-hint-warn")).toContainText("Bez połączenia");
    await expect(page.locator(".c2-hint-warn")).toContainText("Prowadzący");
    await reconnectViaModal(browser, page, "host", contexts, errors);
    await expect(page.locator("#deviceLostOverlay")).toBeHidden();
    await expect(page.locator(".c2-hint-warn")).not.toContainText("Prowadzący");
    await expect(page.locator(".c2-hint-warn")).toContainText("Przycisk");
    buzzerPage = await reconnectViaModal(browser, page, "buzzer", contexts, errors);
    await expect(page.locator(".c2-hint-warn")).toHaveCount(0, { timeout: 10000 });
    await expect(answerTile(page, 2)).toBeEnabled({ timeout: 10000 });

    // Świeżo podłączony Display musi pokazać PRAWDZIWY, aktualny obraz gry
    // (odkrytą odpowiedź #1) -- nie pusty/czarny ekran. Dowód realnego
    // wznowienia stanu, nie tylko zielonej kropki w topbarze.
    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.rounds.setAll")).length, {
      timeout: 5000,
      message: "Display powinien dokończyć malowanie aktualnej planszy po ponownym podłączeniu",
    }).toBeGreaterThan(0);
    const setAllCalls = await getDisplayCalls(displayPage, "api.rounds.setAll");
    expect(setAllCalls.length, "Display po ponownym podłączeniu musi przynajmniej raz namalować planszę rund").toBeGreaterThan(0);
    expect(setAllCalls.at(-1).args[0].rows[0]).toMatchObject({ text: "Odpowiedź A", pts: "40" });

    // ===== Dokończenie rundy 1 na świeżo podłączonych urządzeniach =====
    await revealAnswer(page, 2);
    await revealAnswer(page, 3);
    await page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }).click();
    await expect(page.getByText("Alfa: 90")).toBeVisible({ timeout: 10000 });

    // ===== Runda 2, w CAŁOŚCI na ponownie podłączonym Buzzerze -- dowód, że
    // nowe urządzenie nie tylko świeci na zielono (presence), ale faktycznie
    // bierze udział w rozgrywce (realny zapis przez game_state_buzzer_press).
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 2"), { timeout: 22000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await expect(buzzerPage.getByRole("button", { name: "Przycisk B" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk B" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Beta" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Beta" }));
    await revealAnswer(page, 1);
    await expect(page.getByText("Bank: 40")).toBeVisible({ timeout: 10000 });

    // Awaria odczytu migawki wyżej zapisuje własne read_retry/read_error/recovered;
    // tu liczy się wyłącznie incydent rozłączenia urządzeń.
    const isDeviceOutage = event => event.kind === "diagnostic" && event.category === "connectivity"
      && !["read_retry", "read_error", "recovered"].includes(event.metrics?.phase);
    await expect.poll(async () => {
      const sessions = await readControl2Sessions(page, game.id);
      return (sessions[0]?.stats_detail.events || []).filter(isDeviceOutage).length;
    }, { timeout: 20_000 }).toBe(1);
    const reconnectSessions = await readControl2Sessions(page, game.id);
    const outageEvents = reconnectSessions[0].stats_detail.events || [];
    const outage = outageEvents.find(isDeviceOutage);
    expect(outage.devices).toEqual(expect.arrayContaining(["display", "host", "buzzer"]));
    console.log(`[statistics-review] reconnect diagnostic: ${JSON.stringify(outage)}`);
    // To czas od wykrycia braku urządzeń do ich ponownego podłączenia; zależy
    // od tempa odtworzenia trzech kart, więc sprawdzamy sam fakt blokady.
    expect(outage.metrics.blocked_duration_ms).toBeGreaterThan(0);
    expect(outageEvents.filter(event => ["disconnect", "reconnect"].includes(event.kind))).toHaveLength(0);
    const syncSessions = await readControl2Sessions(page, game.id);
    // Po zerwaniu każde urządzenie raz nadrabia stan odczytem (resync_applied).
    const syncEvents = syncSessions[0].stats_detail.events.filter(event => event.kind === "diagnostic"
      && ["state_sync", "device_state_sync"].includes(event.category)
      && event.metrics?.phase !== "doorbell_sent");
    expect(syncEvents.some(event => ["requested", "acknowledged"].includes(event.metrics?.phase))).toBe(false);
    const syncSummary = {};
    for (const event of syncEvents) {
      const key = `${event.category}/${event.metrics?.phase || "-"}/${event.source || "-"}`;
      syncSummary[key] = (syncSummary[key] || 0) + 1;
    }
    console.log(`[e2e-diag] reconnect sync events ${syncEvents.length}: ${JSON.stringify(syncSummary)}`);
    expect(syncEvents.length).toBeLessThan(10);
    await attachStatistics(testInfo, "reconnect", syncSessions);
    expect(syncSessions).toHaveLength(1);
    expect(syncSessions[0].rounds_played).toBe(1);
    expect(syncSessions[0].ended_at).toBeNull();
    expect(errors, "żadne z urządzeń (stare ani świeżo podłączone) nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 18. Timery wracają do stanu SPRZED startu, gdy Control zastaje je
// już wygasłe przy wznowieniu =====
//
// Zgłoszone wprost: "rozłącz w trakcie timerów, albo zamknij Control w
// trakcie timerów -- czy one wrócą do stanu przed, a nie po, bo tak
// powinny". control/js/engine.js's CANCEL_TIMER3/CANCEL_TIMER (patrz ich
// komentarze) implementują dokładnie to.
//
// WAŻNE, znalezione przy pierwszym przebiegu tych testów w CI: zwykłe
// "poczekaj, potem page.reload()" NIE symuluje "zamknięte" -- dopóki karta
// Control żyje (nawet tylko czekając przez await), jej WŁASNY, żywy
// zegarek (app.js's scheduleTimer3Watch/scheduleFinalTimerWatch) sam
// odpala EXPIRE_TIMER3/EXPIRE_TIMER dokładnie w momencie wygaśnięcia --
// dokładnie tę gałąź "operator obecny i patrzy", którą te testy MAJĄ
// wykluczyć. Prawdziwa symulacja: page.goto("about:blank") PRZED
// czekaniem (zabija kontekst JS razem z jego setTimeout), dopiero PO
// odczekaniu powrót przez page.goto(control2 URL) -- to jest dopiero
// odpowiednik "karta była faktycznie zamknięta/rozłączona, gdy czas
// minął", analogicznie do reload-owego wznowienia z testu #2, tylko z
// deterministycznym wyłączeniem żywego zegarka na czas przerwy.

test("control2: zegarek 3s w rundach wraca do stanu SPRZED startu (bez naliczenia X), gdy Control zamknięte podczas odliczania", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-TIMER3REVERT-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await revealAnswer(page, 1); // A trafia -> przejmuje kontrolę (PLAY), 0 X na koncie

    await expect(xTile(page)).toBeVisible({ timeout: 10000 });
    await expect(xTile(page)).toContainText("0 / 3");

    // Start zegarka to zwykłe, pojedyncze kliknięcie -- tylko jego ręczne
    // ZATRZYMANIE na żywo jest zaznacz->potwierdź (timer3Tile w ui.js).
    await clearDisplayLog(displayPage);
    await clickConfirmed(page.getByRole("button", { name: "Rozpocznij odliczanie 3s" }));
    await expect(page.locator('[data-timer-role="timer3"]')).toBeVisible({ timeout: 10000 });

    // Decyzja 2026-10-20: 3s zegarek NIE zmienia Wyświetlacza — małe
    // potrójne wyświetlacze dalej pokazują wyniki, bez odliczania.
    await page.waitForTimeout(700);
    const duringCalls = await getDisplayCalls(displayPage, "api.small.leftDigits");
    expect(duringCalls.filter((c) => /^0[123]$/.test(String(c.args[0]))), "Display nie odlicza 3s zegarka").toHaveLength(0);

    // "Control zamknięte w trakcie odliczania" -- NIE page.reload() po
    // prostym waitForTimeout(): karta Control, dopóki żyje (nawet tylko
    // czekając), ma WŁASNY, na żywo działający zegarek
    // (app.js's scheduleTimer3Watch/makeTimerWatch) -- sam odpaliłby
    // EXPIRE_TIMER3 (naliczenie X, "operator obecny i patrzy") dokładnie w
    // momencie wygaśnięcia, ZANIM zdążylibyśmy przeładować -- co dowodziłoby
    // czegoś innego niż scenariusz z tego zgłoszenia. Prawdziwe "zamknięte"
    // wymaga, żeby żadna karta nie miała tego zegarka żywego przez cały czas
    // odliczania -- stąd nawigacja NA ZEWNĄTRZ (zabija kontekst JS Control,
    // razem z jego setTimeout) PRZED czekaniem, dopiero potem powrót.
    await page.goto("about:blank").catch(() => {});
    await page.waitForTimeout(3600);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });

    // CANCEL_TIMER3 (nie EXPIRE_TIMER3): zegarek znika, ale licznik X
    // zostaje DOKŁADNIE tam, gdzie był PRZED jego startem -- "0 / 3", nigdy
    // naliczone pudło za czas, kiedy nikt nie patrzył.
    await expect(xTile(page)).toBeVisible({ timeout: 15000 });
    await expect(xTile(page)).toContainText("0 / 3");
    await expect(page.locator('[data-timer-role="timer3"]')).toHaveCount(0);

    const afterCalls = await getDisplayCalls(displayPage, "api.small.leftDigits");
    expect(afterCalls.filter((c) => /^0[123]$/.test(String(c.args[0])))).toHaveLength(0);

    // Dowód, że to nie tylko wygląd po jednym renderze -- zegarek da się
    // uruchomić ponownie, nie został zablokowany w pośrednim stanie.
    await expect(page.getByRole("button", { name: "Rozpocznij odliczanie 3s" })).toBeVisible({ timeout: 10000 });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

test("control2: zegarek gracza w finale (15s) wraca do stanu SPRZED startu (usedP1 cofnięte), gdy Control zamknięte podczas odliczania", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-FINALTIMERREVERT-${Date.now()}`, {
    roundQuestions: [{ ord: 1, text: "Pytanie testowe (runda)", answers: [{ ord: 1, text: "Odp. warta 276", fixed_points: 92 }] }],
    finalAnswerPts: 50,
    settings: { game: { advanced: { roundMultipliers: [3], finalMinPoints: 276 } } },
  });
  const contexts = [];
  try {
    const buzzerPage = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(buzzerPage.getByRole("button", { name: "Przycisk A" })).toBeEnabled({ timeout: 10000 });
    await buzzerPage.getByRole("button", { name: "Przycisk A" }).click();
    await expect(page.getByRole("button", { name: "Zatwierdź: Alfa" })).toBeEnabled({ timeout: 10000 });
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));
    await revealAnswer(page, 1); // jedyna prawdziwa odpowiedź, 92 × 3 = 276 -> próg trafiony
    await strikeOutAndLoseSteal(page);
    await endRoundAndRevealRest(page, "Przejdź do finału");

    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Finał"), { timeout: 22000 });
    await page.getByRole("button", { name: "Rozpocznij finał" }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe(/Finał\s*(—\s*)?gracz 1,\s*wpisywanie/), { timeout: 22000 });

    const p1Inputs = page.locator("#app input[type=text]");
    await expect(p1Inputs).toHaveCount(5, { timeout: 10000 });
    for (let i = 0; i < 5; i++) await p1Inputs.nth(i).fill("Odp. finałowa");

    await armAndConfirm(page.getByRole("button", { name: "Rozpocznij odliczanie (15s)" }));
    await expect(page.locator('[data-timer-role="final"]')).toBeVisible({ timeout: 10000 });

    // "Control zamknięte w trakcie odliczania" -- NIE page.reload() po
    // prostym waitForTimeout() (patrz identyczny komentarz w teście
    // timera3 wyżej): dopóki karta Control żyje, jej WŁASNY żywy zegarek
    // (scheduleFinalTimerWatch) sam odpaliłby EXPIRE_TIMER dokładnie w
    // momencie wygaśnięcia, zanim zdążylibyśmy przeładować -- to byłby
    // scenariusz "operator obecny i patrzy", nie "zamknięte". Nawigacja na
    // zewnątrz PRZED czekaniem zabija ten kontekst JS na czas odliczania.
    await page.goto("about:blank").catch(() => {});
    await page.waitForTimeout(15500);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });

    // CANCEL_TIMER (nie EXPIRE_TIMER): zegarek zniknął, ale usedP1 wraca do
    // false -- "Rozpocznij odliczanie (15s)" da się kliknąć PONOWNIE,
    // zamiast trwale zablokowanego "Czas wykorzystany" (co by oznaczało, że
    // EXPIRE_TIMER jednak się odpalił, zużywając jednorazową szansę gracza
    // za czas, kiedy nikt nie patrzył).
    await expect(page.locator('[data-timer-role="final"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Czas wykorzystany" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Rozpocznij odliczanie (15s)" })).toBeVisible({ timeout: 15000 });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// ===== 21. Koniec gry bez finału w trybie "punkty" — Wyświetlacz pokazuje
// WIN, nie logo =====
//
// Zgłoszone wprost: "Pytanie czemu ani jedna rozgrywka nie kończy się
// alternatywnym zamiast logo punktami lub wygraną, trzeba to poprawić...
// Jedno z zakończeń gry bez finału ma pokazać punkty." Silnik
// (web/shared/js/gameplay/endScreen.js's resolveRoundsEndScreen) już obsługiwał warianty
// "points"/"money" (pokryte testami jednostkowymi w
// tests/unit/settings.branching.test.js) — ale ŻADEN e2e/nagraniowy
// scenariusz nigdy faktycznie nie ustawiał endScreenMode!=="logo" i nie
// sprawdzał, że Wyświetlacz naprawdę woła api.win.set (nie api.logo.show).
// To jest właśnie ten brakujący, rzeczywisty dowód.
//
// Najkrótsza możliwa ścieżka do r_gameEnd: 1 pytanie w puli (wyczerpanie
// puli samo, niezależnie od progu, wymusza r_gameEnd — engine.js's
// finalizeRound()/previewRoundEndDestination), physicalBuzzer+
// noHostTablet (zero potrzeby otwierania Host/Buzzera), wszystkie 3
// odpowiedzi odsłonięte PRZED "Zakończ rundę" (END_ROUND z
// r.revealed.length>=r.answers.length finalizuje rundę OD RAZU, bez
// pośredniego kroku R8 "Przejdź do...").
test("control2: koniec gry bez finału w trybie \"punkty\" — Wyświetlacz pokazuje WIN, nie logo", async ({ page, browser, accounts, loginAs }, testInfo) => {
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-ENDPOINTS-${Date.now()}`, {
    roundQuestions: [TWO_QUESTIONS[0]],
    settings: { game: { hasFinal: false, advanced: { endScreenMode: "points" } } },
  });
  const contexts = [];
  const errors = [];
  try {
    trackErrors(page, "control", errors);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);

    const hostPage = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await page.getByLabel("Przycisk fizyczny").check();

    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Runda 1"), { timeout: 22000 });
    // Bramka intro (dźwięk + plansza Wyświetlacza) trwa ok. 21 s -- czekaj, zamiast klikać w trakcie.
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    await expect(page.getByRole("button", { name: "Alfa" })).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "Alfa" }).click();
    await armAndConfirm(page.getByRole("button", { name: "Zatwierdź: Alfa" }));

    await revealAnswer(page, 1); // 40
    await revealAnswer(page, 2); // 30 -> bank 70
    await revealAnswer(page, 3); // 20 -> bank 90, wszystko odsłonięte

    // END_ROUND z wszystkim już odsłoniętym finalizuje rundę od razu --
    // pula (1 pytanie) wyczerpana -> prosto do r_gameEnd, bez R8.
    await expect(hostPage.locator("#paperText2")).not.toBeEmpty();
    await page.getByRole("button", { name: /^(Zakończ rundę|Przejdź do zakończenia gry)$/ }).click();
    await expect(page.locator("#c2TopbarProgress")).toHaveAttribute("data-tooltip", progressRe("Koniec gry"), { timeout: 22000 });
    await expect(hostPage.locator("#paperText1")).toBeEmpty();
    await expect(hostPage.locator("#paperText2")).toBeEmpty();

    await expect.poll(async () => (await getDisplayCalls(displayPage, "api.win.set")).at(-1)?.args?.[0]).toBe(90);
    await clearDisplayLog(displayPage);
    await page.getByRole("button", { name: "Zakończ grę" }).click();
    await expect(page.getByText("Wygrała drużyna Alfa wynikiem 90:0")).toBeVisible({ timeout: 10000 });
    // Control rysuje ekran wyniku z lokalnego stanu, zanim game_state_write
    // (GAME_END_SHOW, locks.gameEnded) się zatwierdzi; statystyki sesji liczy
    // wyzwalacz tego zapisu -- czekamy na zatwierdzony stan.
    await expect.poll(async () => (await readControl2Sessions(page, game.id))[0]?.status, { timeout: 10000 }).toBe("final");
    const completedSessions = await readControl2Sessions(page, game.id);
    expect(completedSessions).toHaveLength(1);
    expect(completedSessions[0]).toMatchObject({ status: "final", rounds_played: 1, rounds_score_a: 90, rounds_score_b: 0, team_a_score: 90, final_points: null });
    expect(completedSessions[0].ended_at).toBeTruthy();
    expect(completedSessions[0].stats_detail.end_reason).toBe("questions_exhausted");
    expect(completedSessions[0].stats_detail.rounds["1"].awarded_a).toBe(90);
    await attachStatistics(testInfo, "no-final", completedSessions);

    // Outro does not repeat the result animation.
    expect(await getDisplayCalls(displayPage, "api.win.set")).toEqual([]);
    // Logo NIE powinno się pojawić w tej ścieżce (endScreenMode="points",
    // bez remisu) -- dowód, że to rozróżnienie faktycznie działa, nie
    // tylko że WIN czasem leci.
    const logoCalls = await getDisplayCalls(displayPage, "api.logo.show");
    expect(logoCalls, "logo nie powinno się pojawić przy endScreenMode=\"points\" bez remisu").toEqual([]);

    expect(errors, "żadne z urządzeń nie powinno rzucić błędu JS: " + errors.join(" | ")).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

test("control2: opóźnione potwierdzenie Display blokuje następną akcję i buzzer po końcu dźwięku", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(150000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-ACK-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  let release;
  const held = new Promise(resolve => { release = resolve; });
  try {
    const display = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);
    const buzzer = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator(".c2-hint-shortcuts")).toHaveCount(0);
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".c2-hint-shortcuts")).toHaveCount(0);
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    let intercepted = false;
    await display.route("**/rpc/game_state_display_complete", async route => {
      intercepted = true;
      await held;
      await route.continue();
    });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await expect.poll(() => intercepted, { timeout: 20000 }).toBe(true);
    // The actual scene has finished, and the full sound lock has elapsed,
    // but its real completion has not reached the server yet.
    await page.waitForTimeout(2000);
    await expect(buzzer.locator("#btnA")).toBeDisabled();
    const readyBefore = await page.evaluate(async id => (await window.__sbClient.from("game_state_display_completion").select("rendered_rev,requested_rev").eq("game_id",id).single()).data, game.id);
    expect(readyBefore.rendered_rev).toBeLessThan(readyBefore.requested_rev);
    release();
    await expect(buzzer.locator("#btnA")).toBeEnabled({ timeout: 15000 });
    await display.unroute("**/rpc/game_state_display_complete");
    await buzzer.locator("#btnA").click();
    await armAndConfirm(page.getByRole("button", { name: /^Zatwierdź:/ }));
    await expect(page.locator('[data-shortcut="1"]')).toBeEnabled({ timeout: 15000 });
    intercepted = false;
    const heldScore = new Promise(resolve => { release = resolve; });
    await display.route("**/rpc/game_state_display_complete", async route => {
      intercepted = true;
      await heldScore;
      await route.continue();
    });
    await armAndConfirm(page.locator('[data-shortcut="1"]'));
    await expect.poll(() => intercepted, { timeout: 15000 }).toBe(true);
    await page.waitForTimeout(2000);
    await expect(page.locator('[data-shortcut="2"]')).toBeDisabled();
    release();
    await expect(page.locator('[data-shortcut="2"]')).toBeEnabled({ timeout: 15000 });
  } finally {
    release();
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// Słabe łącze (badanie 2026-10-25): każde zapytanie REST Control i urządzeń
// dostaje +700 ms (pełna podróż jak na słabym LTE). Runda z Przyciskiem musi
// przejść bez błędów, a zerwany zapis kończy się przetłumaczonym komunikatem
// i odzyskaniem stanu — bez rozjazdu panelu z Wyświetlaczem.
async function addLatency(context, ms) {
  await context.route("**/rest/v1/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fallback();
  });
}

test("control2: słabe łącze — runda z Przyciskiem przy +700 ms na zapytanie i zerwany zapis", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(240000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-SLOW-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  const errors = [];
  try {
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    const buzzer = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    for (const ctx of contexts) await addLatency(ctx, 700);
    await addLatency(page.context(), 700);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click({ timeout: 30000 });
    await page.getByRole("button", { name: "Rozpocznij grę" }).click({ timeout: 30000 });
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();

    // Zgłoszenie Przyciskiem musi dotrzeć do Control mimo opóźnień.
    await expect(buzzer.locator("#btnA")).toBeEnabled({ timeout: 45000 });
    const pressAt = Date.now();
    await buzzer.locator("#btnA").click();
    await armAndConfirm(page.getByRole("button", { name: /^Zatwierdź:/ }));
    console.log(`[e2e-diag] slow: zgłoszenie → zatwierdzone ${Date.now() - pressAt} ms`);
    await expect(page.locator('[data-shortcut="1"]')).toBeEnabled({ timeout: 30000 });

    // Odsłonięcie: następna akcja dostępna po animacji i potwierdzeniu
    // Wyświetlacza; mierzymy czas, żeby widzieć narzut łącza w logu.
    const revealAt = Date.now();
    await armAndConfirm(page.locator('[data-shortcut="1"]'));
    await expect(page.locator('[data-shortcut="2"]')).toBeEnabled({ timeout: 30000 });
    console.log(`[e2e-diag] slow: odsłonięcie → kolejna akcja ${Date.now() - revealAt} ms`);

    // Zerwany zapis: komunikat po polsku zamiast „Błąd: TypeError…”, a stan
    // panelu wraca do tego z serwera (odpowiedź 2 nadal do odsłonięcia).
    await page.route("**/rpc/game_state_write", (route) => route.abort("connectionfailed"));
    await page.locator('[data-shortcut="2"]').click();
    await page.locator('[data-shortcut="2"]').click();
    await expect(page.getByText("Nie udało się zapisać akcji")).toBeVisible({ timeout: 30000 });
    await page.unroute("**/rpc/game_state_write");
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.locator('[data-shortcut="2"]')).toBeEnabled({ timeout: 30000 });
    await armAndConfirm(page.locator('[data-shortcut="2"]'));
    await expect(page.locator('[data-shortcut="3"]')).toBeEnabled({ timeout: 30000 });
    expect(errors.filter((e) => !/Failed to fetch|ERR_FAILED|connectionfailed|net::/i.test(String(e)))).toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// Telefon schowany na kilkanaście sekund (eksport 25.10, iPhone): timery
// stoją, lease wygasa, a po powrocie odczyt stanu i token kanału szły jeszcze
// starą epoką i dostawały odmowę. Zamrożenie = heartbeat wisi bez odpowiedzi.
async function setPageVisibility(p, visible) {
  await p.evaluate((isVisible) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (isVisible ? "visible" : "hidden") });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => !isVisible });
    document.dispatchEvent(new Event("visibilitychange"));
  }, visible);
}

test("control2: Przycisk wraca z tła po wygaśnięciu lease bez odmowy odczytu i tokenu", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(180000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-RESUME-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  const errors = [];
  try {
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    // iPad: Chromium bez gestu odmawia blokady wygaszania (NotAllowedError),
    // jak Safari — ekran „Nie wygaszaj ekranu” (wake-prompt.js).
    const buzzer = await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors, {
      onPage: (p) => p.addInitScript(() => Object.defineProperty(navigator, "userAgent", {
        get: () => "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      })),
    });
    const wakeOverlay = buzzer.locator("#deviceWakeOverlay.is-open");
    await expect(wakeOverlay).toBeVisible({ timeout: 20000 });
    await buzzer.locator("#deviceWakeConfirm").click();
    await expect(wakeOverlay).toHaveCount(0);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });

    const denied = [];
    let resumedAt = null;
    buzzer.on("response", (res) => {
      if (resumedAt == null || res.status() < 400) return;
      if (/\/rpc\/game_state_get|\/functions\/v1\/device-realtime-token/.test(res.url())) {
        denied.push(`${res.status()} ${new URL(res.url()).pathname} +${Date.now() - resumedAt}ms`);
      }
    });
    const held = [];
    await buzzer.route("**/rpc/control_device_instance_heartbeat", (route) => { held.push(route); });
    await setPageVisibility(buzzer, false);
    await expect(page.locator("#dotBuzzer")).not.toHaveClass(/\bok\b/, { timeout: 40000 });

    resumedAt = Date.now();
    await setPageVisibility(buzzer, true);
    await buzzer.waitForTimeout(500);
    await buzzer.unroute("**/rpc/control_device_instance_heartbeat");
    for (const route of held) await route.continue().catch(() => {});
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    console.log(`[e2e-diag] resume: Przycisk z powrotem po ${Date.now() - resumedAt} ms`);
    // Po powrocie z tła ekran wraca (poza pojedynkiem), w pojedynku znika.
    await expect(wakeOverlay).toBeVisible({ timeout: 10000 });

    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await expect(buzzer.locator("#btnA")).toBeEnabled({ timeout: 30000 });
    await expect(wakeOverlay).toHaveCount(0);
    await buzzer.locator("#btnA").click();
    await expect(page.getByRole("button", { name: /^Zatwierdź:/ })).toBeVisible({ timeout: 20000 });
    expect(denied, "odmowy po powrocie z tła").toEqual([]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// Ciche zerwanie gniazda (np. telefon przechodzi z Wi-Fi na LTE): WebSocket
// nie dostaje zamknięcia, tylko przestaje przepuszczać ramki. Urządzenie
// wykrywa to sygnałem kontrolnym Realtime (co 10 s, REALTIME_OPTIONS),
// dołącza ponownie i odczytuje stan. Przy domyślnych 25 s trwało to 25–50 s.
test("control2: ciche zerwanie gniazda Prowadzącego — nadrobienie zmiany bez przeładowania", async ({ page, browser, accounts, loginAs }) => {
  test.setTimeout(180000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-SILENT-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  const errors = [];
  const sockets = [];
  try {
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    const host = await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors, {
      onPage: (p) => p.routeWebSocket(/\/realtime\//, (ws) => {
        const socket = { dead: false };
        sockets.push(socket);
        const server = ws.connectToServer();
        ws.onMessage((message) => { if (!socket.dead) server.send(message); });
        server.onMessage((message) => { if (!socket.dead) ws.send(message); });
      }),
    });
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors);
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await page.getByRole("button", { name: "Dalej" }).click();
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    await expect(page.getByRole("button", { name: "Rozpocznij rundę" })).toBeEnabled({ timeout: 60000 });
    await expect(host.locator("#paperText2")).not.toContainText("Odpowiedź B (30)");

    expect(sockets.length, "Prowadzący ma gniazdo Realtime").toBeGreaterThan(0);
    for (const socket of sockets) socket.dead = true;
    await page.waitForTimeout(1000);
    const changedAt = Date.now();
    await page.getByRole("button", { name: "Rozpocznij rundę" }).click();
    await expect(host.locator("#paperText2")).toContainText("Odpowiedź B (30)", { timeout: 40000 });
    const caughtUpMs = Date.now() - changedAt;
    console.log(`[e2e-diag] silent-socket: Prowadzący nadrobił zmianę po ${caughtUpMs} ms, gniazd: ${sockets.length}`);
    expect(sockets.length, "nowe gniazdo po wykryciu zerwania").toBeGreaterThan(1);
    expect(caughtUpMs, "wykrycie cichego zerwania szybciej niż domyślne 25 s").toBeLessThan(25000);
    // Lease nie wygasł (heartbeat HTTP działał) — w panelu Prowadzący cały czas połączony.
    await expect(page.locator("#dotHost")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

// e2e 40185039280 (25.10): 503 na jednym module tuż po wdrożeniu zatrzymał
// stronę Przycisku bez komunikatu; Control czekał na niego w nieskończoność.
// module-boot-guard.js przeładowuje stronę po nieudanym wczytaniu modułu.
test("control2: Przycisk sam się przeładowuje po nieudanym wczytaniu modułu (503)", async ({ page, browser, accounts, loginAs }) => {
  test.setTimeout(120000);
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-BOOT-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  const errors = [];
  let failed = 0;
  try {
    await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", errors);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", errors);
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", errors, {
      onPage: (p) => p.route("**/shared/js/core/game-state-subscribe.js*", async (route) => {
        if (failed === 0) { failed += 1; await route.fulfill({ status: 503, body: "Service Unavailable" }); return; }
        await route.fallback();
      }),
    });
    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#dotBuzzer")).toHaveClass(/\bok\b/, { timeout: 45000 });
    expect(failed).toBe(1);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});

test("@mailbox control358: adres bez konta, globalne mail-off, znajomy i nieaktualny checkbox", async ({ page, context, browser, accounts, loginAs }) => {
  test.setTimeout(300_000);
  const email = accounts.noaccount[0].email;
  const rpc = (target, name, args = {}) => target.evaluate(async ({ name, args }) => {
    const { data, error } = await window.__sbClient.rpc(name, args);
    if (error) throw new Error(`${name}: ${error.message}`);
    return data;
  }, { name, args });
  await loginAs(page, context, accounts.standard[0]);
  const recipientContext = await controlContext(browser);
  const recipient = await recipientContext.newPage();
  const anonymous = await controlContext(browser, { hasTouch: true }); // Prowadzący wymaga dotyku
  let game = null, peer = null, oldFlag = null;
  try {
    await loginAs(recipient, recipientContext, accounts.standard[1]);
    peer = await recipient.evaluate(async () => {
      const user = (await window.__sbClient.auth.getUser()).data.user;
      const {data,error}=await window.__sbClient.from("profiles").select("username").eq("id",user.id).single();
      if(error)throw error; return {...user,username:data.username};
    });
    oldFlag = await recipient.evaluate(async id => {
      const { data, error } = await window.__sbClient.from("user_flags").select("email_notifications").eq("user_id",id).single();
      if (error) throw error; return data.email_notifications;
    }, peer.id);
    // Stan wypisania adresu czyści wypożyczenie (migracja 460).
    expect((await rpc(page,"e2e_subscriber_email_cleanup",{p_email:email})).ok).toBe(true);
    expect((await rpc(page,"e2e_friendships_cleanup",{p_other_user_id:peer.id})).ok).toBe(true);
    const invited = await rpc(page,"friends_invite",{p_handle:peer.email});
    expect(invited, `friends_invite response: ${JSON.stringify(invited)}`).toMatchObject({ok:true});
    expect((await rpc(recipient,"friends_accept",{p_id:invited.id})).ok).toBe(true);
    game = await makeGame(page,`E2E-CONTROL358-${Date.now()}`);
    await clearMailbox(email); await resetMailProviderLimits(page);
    const after = new Date().toISOString();
    await page.goto(`/control/?id=${game.id}`);
    try {
      await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", {timeout:15_000});
    } catch(error) {
      console.log("[e2e-diag] control358 initial view",JSON.stringify({url:page.url(),body:(await page.locator("body").innerText()).slice(0,1200)}));
      throw error;
    }
    const open = async type => {
      await page.locator(`[data-device="${type}"] [data-act="share-send"]`).click();
      await expect(page.locator("#shareDeviceSendOverlay")).toBeVisible();
      await expect(page.locator("#shareDeviceSubsList input").first()).toBeVisible();
    };
    // Po wysłaniu okno „Udostępnij” zamyka się; lista jest w oknie „Udostępnienia”.
    const openShares = async type => {
      await expect(page.locator("#shareDeviceSendOverlay")).toBeHidden();
      await page.locator(`[data-device="${type}"] [data-act="share-list"]`).click();
      await expect(page.locator("#shareDeviceOverlay")).toBeVisible();
    };
    await open("host");
    await page.locator("#shareDeviceEmail").fill(email);
    await page.locator("#btnShareDeviceAdd").click();
    await openShares("host");
    await expect(page.locator("#shareDeviceCurrentContent")).toContainText(email);
    await page.locator("#btnShareDeviceDone").click();
    const shares = await rpc(page,"control_device_shares_list",{p_game_id:game.id,p_device_type:"host"});
    const host = shares.find(row=>row.recipient_email===email);
    expect(host.recipient_id).toBeNull();
    expect(host.recipient_kind).toBe("mail");
    const duplicate = await rpc(page,"control_device_share_create_by_lookup",{p_game_id:game.id,p_device_type:"host",p_lookup:email});
    expect(duplicate).toMatchObject({ok:true,created:false,mail_allowed:false});
    const delivered = await waitForEmail({recipient:email,after,subject:/Udostępniono urządzenie/,timeout:150_000});
    expectMailDocument(delivered,{globalUnsub:true,text:["E2E-CONTROL358"]});
    const links = extractHttpLinks(delivered);
    const device = links.find(url=>new URL(url).searchParams.get("d")==="host");
    const unsub = links.find(url=>/^[a-f0-9]{64}$/.test(new URL(url).searchParams.get("m") || ""));
    expect(device).toBeTruthy(); expect(unsub).toBeTruthy();
    const gateway = await anonymous.newPage();
    await gateway.goto(device);
    await expect(gateway).toHaveURL(/\/control\/host\//);
    await expect(gateway.locator("#paper")).toBeVisible({timeout:15_000});
    await gateway.goto(unsub);
    await expect(gateway.locator("#mailAddress")).toHaveText(email);
    await gateway.locator("#mailPreferenceButton").click();
    await gateway.locator(".uni-foot .btn.gold").click();
    await expect(gateway.locator("#mailPreferenceTitle")).toHaveText("Powiadomienia są wyłączone");
    expect((await rpc(page,"control_device_share_resolve",{p_token:host.share_token})).ok).toBe(false);
    const mutedAfter = new Date().toISOString();
    await open("buzzer");
    await page.locator("#shareDeviceEmail").fill(email);
    await expect(page.locator(".app-toast-text")).toContainText("Ta osoba zrezygnowała z zaproszeń i udostępnień");
    await expect(page.locator("#btnShareDeviceAdd")).toBeDisabled();
    expect(await rpc(page,"control_device_share_create_by_lookup",{p_game_id:game.id,p_device_type:"buzzer",p_lookup:email})).toMatchObject({ok:false,error:"notifications_disabled"});
    expect((await rpc(page,"control_device_shares_list",{p_game_id:game.id,p_device_type:"buzzer"})).some(row=>row.recipient_email===email)).toBe(false);
    const delivery = await readMailDelivery({recipient:email,after:mutedAfter});
    expect(delivery.queue).toEqual([]); expect(delivery.events).toEqual([]);
    await page.locator("#btnShareDeviceSendClose").click();
    await recipient.evaluate(async id=>{
      const {error}=await window.__sbClient.from("user_flags").upsert({user_id:id,email_notifications:false},{onConflict:"user_id"});
      if(error)throw error;
    },peer.id);
    await open("display");
    expect(await rpc(page,"control_device_share_preflight",{p_game_id:game.id,p_device_type:"display",p_recipient_user_id:peer.id})).toMatchObject({ok:true,already_shared:false,mail_disabled:true,mail_allowed:false});
    const friendShareAfter = new Date().toISOString();
    const choice = page.locator(`#shareDeviceSubsList input[value="${peer.id}"]`);
    await choice.check();
    await page.locator("#btnShareDeviceAdd").click();
    await openShares("display");
    await expect(page.locator("#shareDeviceCurrentContent")).toContainText(peer.username);
    const display = (await rpc(page,"control_device_shares_list",{p_game_id:game.id,p_device_type:"display"})).find(row=>row.recipient_id===peer.id);
    expect(display.cooldown_until).toBeNull();
    expect((await rpc(page,"friends_remove",{p_id:invited.id})).ok).toBe(true);
    expect((await rpc(page,"control_device_share_resolve",{p_token:display.share_token})).ok).toBe(true);
    const friendDelivery = await readMailDelivery({recipient:peer.email,after:friendShareAfter});
    expect(friendDelivery.queue).toEqual([]); expect(friendDelivery.events).toEqual([]);
    expect((await rpc(page,"e2e_friendships_cleanup",{p_other_user_id:peer.id})).ok).toBe(true);
    const fresh = await rpc(page,"friends_invite",{p_handle:peer.email});
    expect(fresh.ok).toBe(true); expect((await rpc(recipient,"friends_accept",{p_id:fresh.id})).ok).toBe(true);
    await page.locator("#btnShareDeviceClose").click();
    await open("buzzer");
    await choice.check();
    expect((await rpc(page,"friends_remove",{p_id:fresh.id})).ok).toBe(true);
    await page.locator("#btnShareDeviceAdd").click();
    await expect(page.locator(".app-toast-text")).toContainText("Ta osoba nie jest już na liście znajomych");
    expect((await rpc(page,"control_device_shares_list",{p_game_id:game.id,p_device_type:"buzzer"})).some(row=>row.recipient_id===peer.id)).toBe(false);
  } finally {
    try {
      await rpc(page,"e2e_subscriber_email_cleanup",{p_email:email});
      if(peer){
        await rpc(page,"e2e_friendships_cleanup",{p_other_user_id:peer.id});
        if(oldFlag!==null)await recipient.evaluate(async ({id,value})=>{
          const {error}=await window.__sbClient.from("user_flags").upsert({user_id:id,email_notifications:value},{onConflict:"user_id"});
          if(error)throw error;
        },{id:peer.id,value:oldFlag});
      }
    } finally {
      if(game)await deleteGame(page,game.id);
      await anonymous.close(); await recipientContext.close();
    }
  }
});


test("control2: tryb testowy — guard, trzy iframe, odświeżenie, buzzer i zapis statystyk", async ({ page, accounts, loginAs }, testInfo) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1400, height: 900 });
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL-TESTMODE-${Date.now()}`, { roundQuestions: TWO_QUESTIONS, settings:{teams:{teamA:"",teamB:""}} });
  const assertFits = async () => {
    await expect.poll(() => page.evaluate(() => {
      const area = document.querySelector('#controlStagePanel').getBoundingClientRect();
      const elements = [...document.querySelectorAll('#app *')].filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      return elements.filter(el => {
        const box = el.getBoundingClientRect();
        if (el.closest('.c2-summary-grid')) return false;
        return box.width > 0 && box.height > 0 && (box.left < area.left - 2 || box.right > area.right + 2 || box.bottom > area.bottom + 2);
      }).map(el => el.className);
    })).toEqual([]);
  };
  try {
    await page.goto(`/control?id=${game.id}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.stepTitle')).toHaveText('Urządzenia', { timeout: 20000 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#pageGuard')).toBeVisible();
    await page.screenshot({ path:testInfo.outputPath('shot-control-mobile-guard.png') });
    await page.setViewportSize({ width: 1100, height: 768 });
    await expect(page.locator('#controlTestToggle')).toBeDisabled();
    await expect(page.locator('#pageGuard')).toBeHidden();
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.locator('#btnFriends')).toBeVisible();
    await page.locator('#controlTestToggle').check();
    await expect(page.locator('#controlTestDevices iframe')).toHaveCount(3);
    await expect(page.getByLabel('Nie używaj tabletu prowadzącego')).toBeDisabled();
    await expect(page.getByLabel('Przycisk fizyczny')).toBeDisabled();
    for (const kind of ['display', 'host', 'buzzer']) {
      const frame = page.frameLocator(`iframe[data-test-device="${kind}"]`);
      await expect(frame.locator('body')).toBeVisible({ timeout: 20000 });
      const viewport = await frame.locator('body').evaluate(() => ({ width:innerWidth, height:innerHeight }));
      expect(viewport).toEqual({ width:1024, height:768 });
      await expect(frame.locator('#btnFullscreen')).toBeHidden();
    }
    await expect(page.getByRole('button', { name:'Dalej', exact:true })).toBeEnabled({ timeout:30000 });
    await assertFits();
    const chromeLayout = await page.evaluate(() => {
      const bar = document.querySelector('#controlSurface > .topbar').getBoundingClientRect();
      const side = document.querySelector('#controlTestDevices').getBoundingClientRect();
      const friends = document.querySelector('#btnFriends').getBoundingClientRect();
      const device = document.querySelector('#dotDisplayRow').getBoundingClientRect();
      return {barRight:bar.right, sideLeft:side.left, sideTop:side.top, sideBottom:side.bottom, height:innerHeight,
        radius:getComputedStyle(document.querySelector('#controlTestDevices')).borderRadius,
        friendsGap:device.left-friends.right};
    });
    expect(Math.abs(chromeLayout.barRight-chromeLayout.sideLeft)).toBeLessThan(2);
    expect(chromeLayout.sideTop).toBe(0);
    expect(chromeLayout.sideBottom).toBe(chromeLayout.height);
    expect(chromeLayout.radius).toBe('0px');
    expect(chromeLayout.friendsGap).toBeGreaterThanOrEqual(0);
    expect(chromeLayout.friendsGap).toBeLessThan(12);
    await page.setViewportSize({width:1280,height:650});
    await expect(page.locator('#pageGuard')).toBeHidden();
    await assertFits();
    await page.setViewportSize({width:1400,height:900});
    await page.screenshot({ path:testInfo.outputPath('shot-test-mode-devices.png') });
    await page.reload({ waitUntil:'domcontentloaded' });
    await expect(page.locator('#controlTestToggle')).toBeChecked({ timeout:20000 });
    await expect(page.locator('#controlTestDevices iframe')).toHaveCount(3);
    await page.setViewportSize({ width:1100, height:768 });
    await expect(page.locator('#pageGuard')).toBeVisible();
    await page.setViewportSize({ width:1400, height:900 });
    await expect(page.locator('#pageGuard')).toBeHidden();
    await page.locator('#controlTestToggle').uncheck();
    await expect(page.locator('#controlTestDevices iframe')).toHaveCount(0);
    await expect(page.getByLabel('Nie używaj tabletu prowadzącego')).toBeEnabled();
    await expect(page.getByLabel('Przycisk fizyczny')).toBeEnabled();
    await expect(page.locator('#btnFriends')).toBeVisible();
    await page.locator('#controlTestToggle').check();
    await expect(page.locator('#controlTestDevices iframe')).toHaveCount(3);
    await page.locator('.toggle-item:has(input[name="soundSource"][value="display"])').click();
    const display = page.frameLocator('iframe[data-test-device="display"]');
    await expect(display.locator('#btnAudioUnlock')).toBeVisible({ timeout:20000 });
    await expect(page.getByRole('button', { name:'Dalej', exact:true })).toBeDisabled();
    await display.locator('#btnAudioUnlock').click();
    await page.getByRole('button', { name:'Dalej', exact:true }).click({ timeout:30000 });
    await expect(page.locator('.stepTitle')).toHaveText('Podsumowanie');
    await expect(page.locator('#btnFriends')).toBeHidden();
    const summaryScroll = await page.evaluate(() => {
      const list = document.querySelector('.c2-summary-grid');
      const footer = document.querySelector('.stepFoot');
      const before = footer.getBoundingClientRect().bottom;
      list.scrollTop = list.scrollHeight;
      const result = {scrolled:list.scrollTop>0, footerMovement:Math.abs(footer.getBoundingClientRect().bottom-before)};
      list.scrollTop=0;
      return result;
    });
    expect(summaryScroll.scrolled).toBe(true);
    expect(summaryScroll.footerMovement).toBeLessThan(1);
    await expect(page.locator('.c2-summary-columns')).toBeVisible();
    await expect(page.locator('.c2-summary-tabs')).toHaveCount(0);
    const previewCenters = await page.locator('.c2-device-preview-card').evaluateAll(cards => cards.map(card => {
      const box = card.getBoundingClientRect();
      const preview = card.querySelector('#c2DisplayPreview,#c2HostPreview').getBoundingClientRect();
      return Math.abs((preview.left + preview.right) / 2 - (box.left + box.right) / 2);
    }));
    expect(previewCenters).toHaveLength(2);
    for (const difference of previewCenters) expect(difference).toBeLessThan(2);
    await assertFits();
    await page.screenshot({ path:testInfo.outputPath('shot-test-mode-summary.png') });
    await page.getByRole('button', { name:'Gotowe — przejdź do rozgrywki' }).click();
    for (const [call, expected] of [['api.small.long1','Drużyna A'],['api.small.long2','Drużyna B'],['api.small.leftDigits',''],['api.small.rightDigits','']]) {
      await expect.poll(() => display.locator('body').evaluate((_body, call) => (window.__displayLog || []).filter(item => item.call === call).at(-1)?.args[0], call)).toBe(expected);
    }
    for (const [lang, nameA, nameB] of [['en','Team A','Team B'],['uk','Команда A','Команда B'],['pl','Drużyna A','Drużyna B']]) {
      await page.locator('.lang-btn').click();
      await page.locator(`.menu-item[data-lang="${lang}"]`).click();
      for (const [call, expected] of [['api.small.long1',nameA],['api.small.long2',nameB]]) {
        await expect.poll(() => display.locator('body').evaluate((_body, call) => (window.__displayLog || []).filter(item => item.call === call).at(-1)?.args[0], call)).toBe(expected);
      }
    }
    await page.screenshot({path:testInfo.outputPath('shot-test-mode-default-team-names.png')});
    await page.getByRole('button', { name:'Rozpocznij grę', exact:true }).click();
    await expect.poll(async () => (await readControl2Sessions(page, game.id))[0]?.stats_detail?.settings?.testMode).toBe(true);
    await page.getByRole('button', { name:'Rozpocznij rundę', exact:true }).click({ timeout:60000 });
    const buzzer = page.frameLocator('iframe[data-test-device="buzzer"]');
    await expect(buzzer.locator('#btnA')).toBeEnabled({ timeout:30000 });
    await buzzer.locator('#btnA').click();
    await expect(page.getByRole('button', { name:/Zatwierdź/ })).toBeEnabled({ timeout:15000 });
    await expect(page.locator('#btnFriends')).toBeHidden();
    await assertFits();
    await attachStatistics(testInfo, 'test-mode', await readControl2Sessions(page, game.id));
  } finally { await deleteGame(page, game.id); }
});

test("E19N: Control otwiera Znajomych i Wstecz wraca do tej samej gry", async ({ page, accounts, loginAs }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1400, height: 960 });
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-E19N-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  try {
    await page.goto(`/control/?id=${encodeURIComponent(game.id)}&lang=pl`);
    await expect(page.locator("#btnFriends")).toBeVisible({ timeout: 20000 });
    await page.locator("#btnFriends").click();
    await page.waitForURL(/\/friends\//, { timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
    const ret = new URL(page.url()).searchParams.get("ret");
    expect(ret).toBe(`/control/?id=${game.id}`);
    await page.locator("#btnBack").click();
    await page.waitForURL(url => url.pathname === "/control/" && url.searchParams.get("id") === game.id, { timeout: 20000, waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar.topbar-ready")).toBeAttached();

    const controlUrl = `/control/?id=${encodeURIComponent(game.id)}&lang=pl`;
    const settingsWithControl = `/games/settings/?id=${encodeURIComponent(game.id)}&lang=pl&ret=${encodeURIComponent(controlUrl)}`;
    await page.locator("#btnFriends").click();
    await page.waitForURL(/\/friends\//, { timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
    await page.goto(settingsWithControl);
    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#btnPlay")).toBeHidden();

    await page.locator("#btnBack").click();
    await page.waitForURL(url => url.pathname === "/control/" && url.searchParams.get("id") === game.id, { timeout: 20000, waitUntil: "domcontentloaded" });
    await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
    await page.locator("#btnFriends").click();
    await page.waitForURL(/\/friends\//, { timeout: 15000 });
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
    await page.goto(`/games/settings/?id=${encodeURIComponent(game.id)}&lang=pl&ret=%2Fgames%2F`);
    await expect(page.locator("#gsTeamA")).toBeVisible({ timeout: 20000 });
    await expect(page.locator("#btnPlay")).toBeVisible();
  } finally {
    await deleteGame(page, game.id);
  }
});

test("control2: powrót do Control ze Wskazówek w trakcie rundy zapisuje parę zdarzeń", async ({ page, browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(240000);
  await page.setViewportSize({ width: 1366, height: 768 });
  await loginAs(page, page.context(), accounts.standard[0]);
  const game = await makeGame(page, `E2E-CONTROL2-RETURN-${Date.now()}`, { roundQuestions: [TWO_QUESTIONS[0]] });
  const contexts = [];
  try {
    await openAnon(browser, contexts, `/control/buzzer?id=${game.id}&key=${game.share_key_buzzer}`, "buzzer", []);
    const displayPage = await openAnon(browser, contexts, `/control/display?id=${game.id}&key=${game.share_key_display}`, "display", []);
    await openAnon(browser, contexts, `/control/host?id=${game.id}&key=${game.share_key_host}`, "host", []);

    await page.goto(`/control?id=${game.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".stepTitle")).toHaveText("Urządzenia", { timeout: 15000 });
    await expect(page.locator("#dotDisplay")).toHaveClass(/\bok\b/, { timeout: DEVICE_OK_MS });
    await expect(displayPage.locator("#audioUnlockScreen")).toBeHidden();
    await page.getByRole("button", { name: "Dalej" }).click();
    await expect(page.locator(".stepTitle")).toHaveText("Podsumowanie", { timeout: 10000 });
    await page.getByRole("button", { name: "Gotowe — przejdź do rozgrywki" }).click();
    await page.getByRole("button", { name: "Rozpocznij grę" }).click();
    const startRound = page.getByRole("button", { name: "Rozpocznij rundę" });
    await expect(startRound).toBeEnabled({ timeout: 60000 });
    await startRound.click();
    await expect(page.locator(".c2-tilegrid")).toBeVisible({ timeout: 10000 });

    // Zwykły powrót (Wyświetlacz bez zmian): odblokowanie z bazy nadal
    // obowiązuje, więc Control jest gotowy bez nowego gestu na Wyświetlaczu.
    const unlockScreen = displayPage.locator("#audioUnlockScreen");
    for (let round = 1; round <= 2; round++) {
      await page.locator("#btnManual").click();
      await page.waitForURL(/\/manual\//, { timeout: 15000 });
      await expect(page.locator(".topbar.topbar-ready")).toBeAttached({ timeout: 15000 });
      const startedAt = Date.now();
      await page.locator("#btnBack").click();
      await page.waitForURL(/\/control(?:\/|\?)/, { timeout: 15000 });
      // Stan gry jest w bazie: po powrocie Control wznawia trwającą rundę
      // (pojedynek), a nie wraca do ekranu „Rozpocznij rundę”.
      const resumed = await page.locator(".c2-tilegrid").waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false);
      const navLabels = await page.evaluate(() => [...document.querySelectorAll(".c2-gameplay-nav button, #app button.gold")].map((b) => b.textContent.trim()));
      console.log(`[e2e-diag] control-return round=${round} resumed=${resumed} ms=${Date.now() - startedAt} nav=${JSON.stringify(navLabels)}`);
      expect(resumed, "po powrocie ze Wskazówek Control pokazuje trwającą rundę").toBe(true);
      await expect(startRound).toHaveCount(0);
      await expect(unlockScreen).toHaveClass(/\bhidden\b/);
    }

    // Wyjście do Wskazówek i powrót są dozwolone w trakcie rundy:
    // mają zostać sparowane w logu i nie mogą utworzyć nowej sesji gry.
    await expect.poll(async () => {
      const sessions = await readControl2Sessions(page, game.id);
      const events = sessions[0]?.stats_detail.events || [];
      return {
        sessions: sessions.length,
      opens: events.filter(event => event.source === "control" && event.metrics?.phase === "manual_open").length,
      returns: events.filter(event => event.source === "control" && event.metrics?.phase === "manual_return").length,
    };
    }, { timeout: 15000 }).toEqual({ sessions: 1, opens: 2, returns: 2 });
    const navigationEvents = (await readControl2Sessions(page, game.id))[0].stats_detail.events
      .filter(event => event.source === "control" && ["manual_open", "manual_return"].includes(event.metrics?.phase));
    const navigationIds = new Map();
    for (const event of navigationEvents) {
      const id = event.metrics?.navigation_id;
      expect(typeof id, "nawigacja do Wskazówek musi mieć identyfikator pary").toBe("string");
      const phases = navigationIds.get(id) || [];
      phases.push(event.metrics.phase);
      navigationIds.set(id, phases);
      if (event.metrics.phase === "manual_return") expect(event.metrics.duration_ms).toBeGreaterThanOrEqual(0);
    }
    expect([...navigationIds.values()]).toEqual([[
      "manual_open", "manual_return",
    ], ["manual_open", "manual_return"]]);
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    await deleteGame(page, game.id);
  }
});
