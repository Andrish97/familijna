const { expectMailDocument, escapeMailText } = require("./helpers/mail-document");
const { test, expect } = require("./helpers/e2e-test");
const path = require("node:path");
const fs = require("node:fs");
const { generateE2EToken } = require("./helpers/e2e-token");
const { clearMailbox, waitForEmail, extractHttpLinks, resetMailProviderLimits, releaseMailCooldown } = require("./helpers/mailbox");
const { withE2EBypass } = require("./helpers/login");
const { serveBranchCode } = require("./helpers/branch-code");

const LOGIN_URL = "https://www.familijna.app/login";

// E25: hasło, nazwa i e-mail -> konto disposable (adres zapasowy `.new@` jako
// nowy e-mail, jego skrzynka też jest wypożyczona); standard -- tylko jako
// "adres zajęty przez inne konto". Worker odtwarza disposable wyłącznie przy
// wypożyczeniu (start workera), więc każdy test po sukcesie sam cofa to, co
// zmienił (hasło, nazwa, e-mail, zmiana w toku, cooldowny). Po porażce
// Playwright restartuje workera -- nowy lease oddaje konto odtworzone.
test.use({ needs: { disposable: 1, standard: 1, resources: ["mail"] } });

test.describe.configure({ mode: "serial" });

const alternate = (account) => ({ ...account, email: account.email.replace("@", ".new@") });

// ─────────────────────────────────────────────────────────────────────────────
// Treść maili auth we wszystkich językach. send-email bierze teksty z sekcji
// authEmail w translation/<lang>/server.js (pobieranej ze strony w trakcie działania),
// więc tu sprawdzamy, że prawdziwy mail w danym języku ma dokładnie te teksty
// i link z tym samym ?lang=. Testy przepływu niżej (kliknięcie linku) działają
// po polsku; testy na końcu pliku sprawdzają język treści.
// ─────────────────────────────────────────────────────────────────────────────

const MAIL_LANGS = ["pl", "en", "uk"];
// GoTrue nie wyśle kolejnego maila auth temu samemu użytkownikowi szybciej
// niż co ~60 s (SMTP max frequency) — lease czyści tylko nasze cooldowny,
// nie ten. Wszystkie testy pliku używają jednego konta disposable, więc jeden
// wspólny odstęp (klucz = nazwa konta). Odstęp z zapasem.
const AUTH_MAIL_GAP_MS = 65_000;
const lastAuthMailAt = new Map();

async function loadAuthEmailCopy(lang) {
  // translation/<lang>/*.js to ESM bez "type": "module" — Node 20 w CI nie wykrywa
  // tego sam, więc import przez data: URL.
  const part = async (name) => {
    const src = fs.readFileSync(path.resolve(__dirname, "../../web/shared/translation", lang, `${name}.js`), "utf8");
    return (await import("data:text/javascript;base64," + Buffer.from(src).toString("base64"))).default;
  };
  return { authEmail: (await part("server")).authEmail, index: (await part("login")).index };
}

async function waitForAuthMailSlot(account, testInfo) {
  // Po porażce Playwright restartuje workera (mapa znika) — przy retry czekamy zawsze.
  const last = lastAuthMailAt.get(account.name) ?? (testInfo.retry > 0 ? Date.now() : 0);
  const wait = last + AUTH_MAIL_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function expectMailInLanguage(email, copy, lang, label, typeKey, { actionPattern = /token_hash=/, vars = {} } = {}) {
  expectMailDocument(email, { lang });
  const html = email.body_html || "";
  // Znacznik wstawiany tylko przez send-email czytający tłumaczenia strony —
  // stara wersja z tekstami w kodzie (identycznymi) go nie ma. "@lang" wyklucza
  // też ciche przejście na polski przy brakującym tłumaczeniu.
  // Dostawca (Brevo) może przepisać kolejność atrybutów i cudzysłowy w <meta>;
  // liczy się wartość znacznika.
  expect(html, `${label}: mail nie powstał z translation/${lang}/server.js`)
    .toContain(`authEmail.${typeKey}@${lang}`);
  expect(email.subject, `${label}: temat`).toBe(copy.subject);
  for (const field of ["subtitle", "title", "desc", "btn", "ignore", "footer"]) {
    const text = Object.entries(vars).reduce((acc, [k, v]) => acc.replaceAll(`{${k}}`, v), copy[field]);
    expect(html, `${label}: brak pola ${field}`).toContain(escapeMailText(text));
  }
  const action = extractHttpLinks(email).find((link) => actionPattern.test(link));
  expect(action, `${label}: brak linku akcji`).toBeTruthy();
  expect(new URL(action).searchParams.get("lang"), `${label}: lang w linku`).toBe(lang);
}

// Blokada resetu hasła (mail_cooldowns "auth:reset_password", 1 h na adres)
// zostaje po poprzednim teście w tym samym workerze: lease czyści ją tylko przy
// wypożyczeniu (e2e_reset_identity), dawniej robił to restoreTestAccount przed
// każdym testem. Bez zwolnienia login.js pokazuje "Wysłano" bez wysyłki.
// Wymaga "auth:reset_password" w E2E_RELEASABLE_MAIL_COOLDOWNS Workera.
async function releaseResetCooldown(account) {
  await releaseMailCooldown(account.email, "auth:reset_password");
}

async function openLoginWithCaptchaBypass(page, context) {
  const secret = process.env.E2E_BYPASS_SECRET;
  await context.addInitScript(() => localStorage.setItem("uiLang", "pl"));
  await context.setExtraHTTPHeaders({ "X-E2E-Token": generateE2EToken(secret) });
  await page.goto(LOGIN_URL, { waitUntil: "networkidle" });
  // Nagłówek zostaje: reset po adresie e-mail idzie przez Worker (/_api/auth/reset,
  // migracja 514), który testowy token Turnstile przyjmuje tylko z X-E2E-Token.
}

// Hasło konta z powrotem na TEST_PASSWORD (to samo, które ustawia lease) --
// zalogowana sesja na stronie aplikacji, ta sama metoda co account.js.
// GoTrue wymaga obecnego hasła (SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD).
async function restoreTestPassword(page, currentPassword) {
  await page.evaluate(async ({ password, current }) => {
    const { error } = await window.__sbClient.auth.updateUser({ password, current_password: current });
    if (error) throw new Error("restore password: " + error.message);
  }, { password: process.env.TEST_PASSWORD, current: currentPassword });
}

test("konto disposable: reset hasla przez prawdziwy e-mail i przywrocenie stanu", async ({ page, context, accounts }, testInfo) => {
  test.setTimeout(240_000);
  const [account] = accounts.disposable;
  const temporaryPassword = `E2e-${Date.now()}-Aa!`;

  await clearMailbox(account.email);
  await releaseResetCooldown(account);
  await waitForAuthMailSlot(account, testInfo);
  const after = new Date(Date.now() - 2_000).toISOString();

  try {
    await openLoginWithCaptchaBypass(page, context);
    await page.locator("#email").fill(account.email);
    await page.locator("#btnForgot").click();
    lastAuthMailAt.set(account.name, Date.now());
    await expect(page.locator("#status")).toContainText("Wysłano", { timeout: 30_000 });

    const email = await waitForEmail({ recipient: account.email, after, subject: /has|reset|odzysk/i });
    // Supabase moze wyslac albo bezposredni /login/reset?token_hash=..., albo
    // najpierw swoj /auth/v1/verify?...&redirect_to=/login/reset. Oba warianty
    // sa prawidlowym linkiem akcji i koncza na ekranie resetu.
    const resetLink = extractHttpLinks(email).find((link) =>
      /\/login\/reset(?:[?#]|$)|\/auth\/v1\/verify|token_hash=|type=recovery/i.test(link)
    );
    expect(resetLink, "mail resetu powinien zawierac link odzyskiwania").toBeTruthy();

    await page.goto(resetLink, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#form")).toBeVisible({ timeout: 30_000 });
    await page.locator("#p1").fill(temporaryPassword);
    await page.locator("#p2").fill(temporaryPassword);
    await page.locator("#save").click();
    // Po sukcesie reset.js pokazuje krotki status i automatycznie wraca do
    // /login po 900 ms; URL jest stabilniejszym sygnalem niz migajacy tekst.
    await page.waitForURL(/\/login\/?(?:[?#]|$)/, { timeout: 30_000 });

    // Reset linkiem (sesja recovery) nie wymaga obecnego hasła, a GoTrue wysyła
    // powiadomienie o zmianie hasła (hook send-email, teksty authEmail.passwordChangedNotice).
    const notice = await waitForEmail({ recipient: account.email, after, subject: /Hasło zostało zmienione/i });
    expect(notice, "powiadomienie o zmianie hasła").toBeTruthy();

    await openLoginWithCaptchaBypass(page, context);
    await page.locator("#email").fill(account.email);
    await page.locator("#pass").fill(temporaryPassword);
    await page.locator("#btnPrimary").click();
    await page.waitForURL(/\/games\/?(?:[?#]|$)/, { timeout: 30_000 });

    // Przywrócenie stanu: kolejne testy logują się hasłem testowym.
    await restoreTestPassword(page, temporaryPassword);
  } finally {
    await clearMailbox(account.email);
  }
});

// Nazwa tożsamości (prefiks e2e) nie przejdzie walidacji formularza -- wraca
// bezpośrednio, tymi samymi zapisami co account.js (profiles + metadata),
// i zwalniamy cooldown zmiany nazwy.
async function restoreUsername(page, username) {
  await page.evaluate(async (name) => {
    const sb = window.__sbClient;
    const { data: { user } } = await sb.auth.getUser();
    const { error } = await sb.from("profiles").update({ username: name }).eq("id", user.id);
    if (error) throw new Error("restore username: " + error.message);
    const { error: metaError } = await sb.auth.updateUser({ data: { username: name } });
    if (metaError) throw new Error("restore username metadata: " + metaError.message);
    const { error: cdError } = await sb.rpc("cooldown_release", { p_action_key: "account:username", p_max_age_seconds: 7200 });
    if (cdError) throw new Error("cooldown_release: " + cdError.message);
  }, username);
}

test("konto disposable: zmiana nazwy i przywrocenie", async ({ page, context, accounts, loginAs }) => {
  const [account] = accounts.disposable;
  // Prefiks "e2e" jest zarezerwowany dla tożsamości testowych (migracja 460).
  const changedUsername = `zmiana_${Date.now().toString(36)}`;

  await loginAs(page, context, account);
  await page.goto("https://www.familijna.app/account", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-skel-step].skel-step-ready", { timeout: 20_000 });
  await page.locator("#username").fill(changedUsername);
  await page.locator("#saveUsername").click();
  await expect(page.locator("#appToast")).toContainText("zapis", { timeout: 20_000 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-skel-step].skel-step-ready", { timeout: 20_000 });
  await expect(page.locator("#username")).toHaveValue(changedUsername);

  await restoreUsername(page, account.username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-skel-step].skel-step-ready", { timeout: 20_000 });
  await expect(page.locator("#username")).toHaveValue(account.username);
});

// ─────────────────────────────────────────────────────────────────────────────
// Zmiana e-maila: wszystko, co może zrobić użytkownik (adres konta disposable →
// jego adres zapasowy `.new@`, prawdziwe skrzynki). Bez "secure email change":
// link tylko na nowy adres, na stary samo powiadomienie. Przed każdym testem
// czyścimy zmianę w toku i cooldown, po sukcesie test sam cofa swoje zmiany.
// ─────────────────────────────────────────────────────────────────────────────

const ACCOUNT_URL = "https://www.familijna.app/account";
const isEmailChangeLink = (link) =>
  /\/login\/confirm(?:[?#]|$)|\/auth\/v1\/verify|token_hash=|type=email_change/i.test(link);

// Konto i strona potwierdzenia z plików brancha (helpers/branch-code.js) --
// po wdrożeniu to ten sam kod co na produkcji.
async function branchContext(browser) {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await serveBranchCode(context, { pages: ["account", "login/confirm"] });
  return context;
}

async function openAccount(page) {
  await page.goto(ACCOUNT_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-skel-step].skel-step-ready", { timeout: 20_000 });
}

async function submitEmailChange(page, first, second = first) {
  await page.locator("#email").fill(first);
  await page.locator("#email2").fill(second);
  await page.locator("#saveEmail").click();
}

async function expectToast(page, pattern, { error = false } = {}) {
  const toast = page.locator("#appToast");
  await expect(toast).toContainText(pattern, { timeout: 30_000 });
  if (error) await expect(toast).toHaveClass(/error/);
  else await expect(toast).not.toHaveClass(/error/);
  await dismissToast(page);
}

// Błąd zostaje do kliknięcia; zamykamy, żeby następna asercja widziała nowy dymek.
async function dismissToast(page) {
  const toast = page.locator("#appToast");
  if (await toast.evaluate((el) => el.classList.contains("show")).catch(() => false)) await toast.click();
  await expect(toast).not.toHaveClass(/\bshow\b/, { timeout: 5_000 });
}

async function expectNoEmail(recipient, after, timeout = 20_000) {
  let email = null;
  try { email = await waitForEmail({ recipient, after, timeout }); } catch {}
  expect(email, `${recipient}: nie powinien dostac maila`).toBeNull();
}

// Mail na stary adres: powiadomienie z nowym adresem i linkiem do logowania, bez potwierdzenia.
function expectOldAddressNotice(email, newAddress) {
  const html = email.body_html || "";
  expect(html).toContain('content="authEmail.emailChangeNotice@pl"');
  expect(html).toContain(escapeMailText(newAddress));
  const links = extractHttpLinks(email);
  expect(links.find(isEmailChangeLink), "stary adres: bez linku potwierdzajacego").toBeFalsy();
  const loginLink = links.find((link) => /\/login\/\?lang=pl/.test(link));
  expect(loginLink, "stary adres: link do logowania").toBeTruthy();
  return loginLink;
}

function confirmLinkFrom(email) {
  expect(email.body_html || "").toContain('content="authEmail.emailChange@pl"');
  const link = extractHttpLinks(email).find(isEmailChangeLink);
  expect(link, "nowy adres: link potwierdzajacy").toBeTruthy();
  return link;
}

async function openConfirmLink(browser, link) {
  const context = await branchContext(browser);
  const page = await context.newPage();
  await page.goto(link, { waitUntil: "domcontentloaded" });
  // Po sukcesie strona po chwili sama przechodzi dalej -- zapamiętujemy ostatni
  // komunikat, zanim #status zniknie.
  const final = /gotowe|nie udało|anulowana|już użyty|nieprawidłowy|zapisane|brak kodu|potwierdzone/i;
  let text = "";
  await expect.poll(async () => {
    const now = await page.locator("#status").textContent({ timeout: 500 }).catch(() => null);
    if (now) text = now;
    return final.test(text);
  }, { timeout: 30_000, intervals: [100] }).toBe(true);
  console.log("[e2e-diag] link potwierdzajacy:", text.trim());
  await context.close();
  return text;
}

async function expectLoginFails(browser, username) {
  const context = await branchContext(browser);
  const page = await context.newPage();
  await withE2EBypass(context);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => {
    const status = document.querySelector("#status")?.textContent?.trim() || "";
    return !document.documentElement.classList.contains("page-loading") && !!status && !/checking|sprawdzam/i.test(status);
  }, null, { timeout: 20_000 });
  await page.fill("#email", username);
  await page.fill("#pass", process.env.TEST_PASSWORD);
  await page.click("#btnPrimary");
  await expect(page.locator("#err")).not.toBeEmpty({ timeout: 20_000 });
  expect(page.url()).not.toMatch(/\/games/);
  await context.close();
}

async function currentAuthEmail(page) {
  return page.evaluate(async () => (await window.__sbClient.auth.getUser()).data.user?.email);
}

async function releaseEmailCooldown(page) {
  await page.evaluate(async () => {
    const { error } = await window.__sbClient.rpc("cooldown_release", { p_action_key: "account:email", p_max_age_seconds: 7200 });
    if (error) throw new Error("cooldown_release: " + error.message);
  });
}

// Konto bez zmiany e-maila w toku i bez cooldownu "account:email" (to samo co
// account-email-resend.spec.js) -- dawniej robiło to restoreTestAccount przed
// i po każdym teście. Wołane na zalogowanej stronie, przed /account.
async function resetEmailChangeState(page) {
  await page.evaluate(async () => {
    const sb = window.__sbClient;
    const { error: rpcError } = await sb.rpc("cancel_my_email_change");
    if (rpcError) throw new Error("cancel_my_email_change failed: " + rpcError.message);
    const { error: metaError } = await sb.auth.updateUser({
      data: { familijna_email_change_pending: "", familijna_email_change_intent: "" },
    });
    if (metaError) throw new Error("clearing pending metadata failed: " + metaError.message);
    await sb.auth.refreshSession();
  });
  await releaseEmailCooldown(page);
}

async function startEmailChangeTest(account, testInfo) {
  // Przydział dostawców poczty bywa wyczerpany przez wcześniejsze przebiegi -- wtedy maile nie wychodzą.
  await resetMailProviderLimits();
  await clearMailbox(account.email);
  await clearMailbox(alternate(account).email);
  await waitForAuthMailSlot(account, testInfo);
}

async function finishEmailChangeTest(account) {
  await clearMailbox(account.email).catch(() => {});
  await clearMailbox(alternate(account).email).catch(() => {});
}

// Po potwierdzonej zmianie konto loguje się adresem `.new@` -- wracamy tą samą
// drogą co użytkownik (zmiana na pierwotny adres i link z jego skrzynki).
async function revertConfirmedEmailChange(browser, account, loginAs, testInfo) {
  const changed = alternate(account);
  await clearMailbox(account.email);
  await clearMailbox(changed.email);
  await waitForAuthMailSlot(account, testInfo);
  const context = await branchContext(browser);
  const page = await context.newPage();
  let backEmail;
  try {
    await loginAs(page, context, changed);
    await resetEmailChangeState(page);
    await openAccount(page);
    const after = new Date(Date.now() - 2_000).toISOString();
    await submitEmailChange(page, account.email);
    lastAuthMailAt.set(account.name, Date.now());
    await expectToast(page, "Wysłano");
    backEmail = await waitForEmail({ recipient: account.email, after });
  } finally {
    await context.close().catch(() => {});
  }
  const status = await openConfirmLink(browser, confirmLinkFrom(backEmail));
  expect(status, "powrot na pierwotny adres").toMatch(/gotowe/i);

  const checkContext = await branchContext(browser);
  const checkPage = await checkContext.newPage();
  try {
    await loginAs(checkPage, checkContext, account);
    expect(await currentAuthEmail(checkPage)).toBe(account.email);
    await resetEmailChangeState(checkPage);
  } finally {
    await checkContext.close().catch(() => {});
  }
}

test("zmiana e-maila: bledne dane nic nie wysylaja", async ({ browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(180_000);
  const [account] = accounts.disposable;
  const newAddress = alternate(account).email;
  // Adres zajęty przez inne (wypożyczone) konto.
  const takenAddress = accounts.standard[0].email;
  await startEmailChangeTest(account, testInfo);
  const after = new Date(Date.now() - 2_000).toISOString();
  const context = await branchContext(browser);
  const page = await context.newPage();
  try {
    await loginAs(page, context, account);
    await resetEmailChangeState(page);
    await openAccount(page);

    await submitEmailChange(page, newAddress.replace("@", ""));
    await expectToast(page, "Podaj poprawny e-mail", { error: true });

    await submitEmailChange(page, account.email.toUpperCase(), account.email);
    await expectToast(page, "To jest Twój obecny adres e-mail", { error: true });

    await submitEmailChange(page, newAddress, newAddress.slice(0, -1));
    await expectToast(page, "Adresy e-mail nie są takie same", { error: true });

    // Adres zajęty przez inne konto: błąd z serwera, nic nie zostaje w toku.
    await submitEmailChange(page, takenAddress);
    const toast = page.locator("#appToast");
    await expect(toast).toHaveClass(/\bshow\b/, { timeout: 30_000 });
    await expect(toast).toHaveClass(/error/);
    console.log("[e2e-diag] zajety adres:", (await toast.textContent())?.trim());

    await openAccount(page);
    await expect(page.locator("#emailPendingActions")).toBeHidden();
    await expect(page.locator("#emailCooldown")).toBeHidden();
    await expect(page.locator("#email")).toHaveValue(account.email);
    await expectNoEmail(account.email, after);
    await expectNoEmail(newAddress, after, 5_000);
    await resetEmailChangeState(page);
  } finally {
    await context.close().catch(() => {});
    await finishEmailChangeTest(account);
  }
});

test("zmiana e-maila: pelna zmiana, maile, link raz, logowanie nowym adresem", async ({ browser, accounts, loginAs }, testInfo) => {
  // Z powrotem na pierwotny adres (drugi mail auth, odstęp GoTrue) -- dłuższy limit.
  test.setTimeout(420_000);
  const [account] = accounts.disposable;
  const changed = alternate(account);
  await startEmailChangeTest(account, testInfo);
  const after = new Date(Date.now() - 2_000).toISOString();
  const context = await branchContext(browser);
  const page = await context.newPage();
  try {
    await loginAs(page, context, account);
    await resetEmailChangeState(page);
    await openAccount(page);
    // Wielkość liter i spacje nie mają znaczenia przy porównaniu pól.
    await submitEmailChange(page, ` ${changed.email.toUpperCase()} `, changed.email);
    lastAuthMailAt.set(account.name, Date.now());
    await expectToast(page, "Wysłano");

    await openAccount(page);
    await expect(page.locator("#emailPendingActions")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#emailActions")).toBeHidden();
    await expect(page.locator("#email")).toHaveValue(changed.email);
    await expect(page.locator("#emailPendingHint")).toContainText(changed.email);

    const [oldEmail, newEmail] = await Promise.all([
      waitForEmail({ recipient: account.email, after }),
      waitForEmail({ recipient: changed.email, after }),
    ]);
    const loginLink = expectOldAddressNotice(oldEmail, changed.email);
    const confirmLink = confirmLinkFrom(newEmail);

    // Przycisk z powiadomienia prowadzi na stronę logowania.
    const noticeContext = await branchContext(browser);
    const noticePage = await noticeContext.newPage();
    const res = await noticePage.goto(loginLink, { waitUntil: "domcontentloaded" });
    expect(res?.status()).toBeLessThan(400);
    await expect(noticePage.locator("#btnPrimary")).toBeVisible({ timeout: 20_000 });
    await noticeContext.close();

    // Przed potwierdzeniem nadal loguje stary adres.
    expect(await currentAuthEmail(page)).toBe(account.email);
    await context.close();

    const first = await openConfirmLink(browser, confirmLink);
    expect(first, "pierwsze klikniecie linku").toMatch(/gotowe/i);
    const second = await openConfirmLink(browser, confirmLink);
    expect(second, "drugie klikniecie tego samego linku").not.toMatch(/gotowe/i);

    // Logowanie nowym adresem tego samego konta disposable (adres zapasowy).
    const loginContext = await branchContext(browser);
    const loginPage = await loginContext.newPage();
    await loginAs(loginPage, loginContext, changed);
    expect(await currentAuthEmail(loginPage)).toBe(changed.email);
    await openAccount(loginPage);
    await expect(loginPage.locator("#email")).toHaveValue(changed.email);
    await expect(loginPage.locator("#emailPendingActions")).toBeHidden();
    await loginContext.close();

    await expectLoginFails(browser, account.email);
    // Po potwierdzeniu nikt nie dostaje kolejnych maili.
    const afterConfirm = new Date().toISOString();
    await expectNoEmail(account.email, afterConfirm, 10_000);

    // Przywrócenie stanu dla kolejnych testów w tym workerze.
    await revertConfirmedEmailChange(browser, account, loginAs, testInfo);
  } finally {
    await context.close().catch(() => {});
    await finishEmailChangeTest(account);
  }
});

test("zmiana e-maila: ponowne wyslanie uniewaznia stary link, anulowanie nowy", async ({ browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(300_000);
  const [account] = accounts.disposable;
  const changed = alternate(account);
  await startEmailChangeTest(account, testInfo);
  const after = new Date(Date.now() - 2_000).toISOString();
  const context = await branchContext(browser);
  const page = await context.newPage();
  try {
    await loginAs(page, context, account);
    await resetEmailChangeState(page);
    await openAccount(page);
    await submitEmailChange(page, changed.email);
    lastAuthMailAt.set(account.name, Date.now());
    await expectToast(page, "Wysłano");
    const [oldEmail, newEmail] = await Promise.all([
      waitForEmail({ recipient: account.email, after }),
      waitForEmail({ recipient: changed.email, after }),
    ]);
    expectOldAddressNotice(oldEmail, changed.email);
    const firstLink = confirmLinkFrom(newEmail);

    // "Minęła godzina" (ta sama RPC co rollback w account.js) i odstęp GoTrue.
    await releaseEmailCooldown(page);
    await waitForAuthMailSlot(account, testInfo);
    await openAccount(page);
    await expect(page.locator("#resendEmailChange")).toBeEnabled({ timeout: 15_000 });
    const resendAfter = new Date(Date.now() - 1_000).toISOString();
    await page.locator("#resendEmailChange").click();
    lastAuthMailAt.set(account.name, Date.now());
    await expectToast(page, "Wysłano ponownie");
    await expect(page.locator("#emailCooldown")).toBeVisible({ timeout: 15_000 });

    const resent = await waitForEmail({ recipient: changed.email, after: resendAfter });
    const secondLink = confirmLinkFrom(resent);
    expect(secondLink).not.toBe(firstLink);
    let resentNotice = null;
    try { resentNotice = await waitForEmail({ recipient: account.email, after: resendAfter, timeout: 20_000 }); } catch {}
    if (resentNotice) expectOldAddressNotice(resentNotice, changed.email);
    console.log("[e2e-diag] powiadomienie na stary adres po ponownym wyslaniu:", !!resentNotice);

    const oldLinkStatus = await openConfirmLink(browser, firstLink);
    expect(oldLinkStatus, "link sprzed ponownego wyslania").not.toMatch(/gotowe/i);

    await page.locator("#cancelEmailChange").click();
    await expectToast(page, "Anulowano zmianę e-maila");
    const newLinkStatus = await openConfirmLink(browser, secondLink);
    expect(newLinkStatus, "link po anulowaniu").toMatch(/anulowana/i);

    await openAccount(page);
    await expect(page.locator("#emailPendingActions")).toBeHidden({ timeout: 15_000 });
    expect(await currentAuthEmail(page)).toBe(account.email);
    await resetEmailChangeState(page);
  } finally {
    await context.close().catch(() => {});
    await finishEmailChangeTest(account);
  }
});

test("zmiana e-maila: anulowanie z drugiego urzadzenia, blokada, link niewazny", async ({ browser, accounts, loginAs }, testInfo) => {
  test.setTimeout(240_000);
  const [account] = accounts.disposable;
  const changed = alternate(account);
  await startEmailChangeTest(account, testInfo);
  const after = new Date(Date.now() - 2_000).toISOString();
  const context = await branchContext(browser);
  const page = await context.newPage();
  const otherContext = await branchContext(browser);
  const otherPage = await otherContext.newPage();
  try {
    await loginAs(page, context, account);
    await resetEmailChangeState(page);
    await openAccount(page);
    await submitEmailChange(page, changed.email);
    lastAuthMailAt.set(account.name, Date.now());
    await expectToast(page, "Wysłano");

    // Blokada 1 h: licznik widoczny, "Wyślij ponownie" wyłączone, "Anuluj" dostępne.
    await openAccount(page);
    await expect(page.locator("#emailCooldown")).toContainText("Ponowna akcja możliwa za", { timeout: 15_000 });
    await expect(page.locator("#resendEmailChange")).toBeDisabled();
    await expect(page.locator("#cancelEmailChange")).toBeEnabled();

    const [, newEmail] = await Promise.all([
      waitForEmail({ recipient: account.email, after }),
      waitForEmail({ recipient: changed.email, after }),
    ]);
    const confirmLink = confirmLinkFrom(newEmail);

    // Drugie urządzenie widzi zmianę w toku i ją anuluje.
    await loginAs(otherPage, otherContext, account);
    await openAccount(otherPage);
    await expect(otherPage.locator("#emailPendingActions")).toBeVisible({ timeout: 15_000 });
    await expect(otherPage.locator("#email")).toHaveValue(changed.email);
    await otherPage.locator("#cancelEmailChange").click();
    await expectToast(otherPage, "Anulowano zmianę e-maila");

    // Pierwsze urządzenie po odświeżeniu: brak zmiany w toku, stary adres.
    await openAccount(page);
    await expect(page.locator("#emailPendingActions")).toBeHidden({ timeout: 15_000 });
    await expect(page.locator("#email")).toHaveValue(account.email);

    const status = await openConfirmLink(browser, confirmLink);
    expect(status, "link po anulowaniu").toMatch(/anulowana/i);

    await otherContext.close();
    await context.close();
    const loginContext = await branchContext(browser);
    const loginPage = await loginContext.newPage();
    await loginAs(loginPage, loginContext, account);
    expect(await currentAuthEmail(loginPage)).toBe(account.email);
    await resetEmailChangeState(loginPage);
    await loginContext.close();
  } finally {
    await otherContext.close().catch(() => {});
    await context.close().catch(() => {});
    await finishEmailChangeTest(account);
  }
});

test("Auth: reset hasla dociera przy wylaczonych powiadomieniach", async ({ page, context, accounts, loginAs }, testInfo) => {
  test.setTimeout(240_000);
  const [account] = accounts.disposable;
  let previousFlag;
  await clearMailbox(account.email);
  try {
    await loginAs(page, context, account);
    previousFlag = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: { user } } = await sb.auth.getUser();
      const { data, error } = await sb.from("user_flags").select("email_notifications").eq("user_id", user.id).single();
      if (error) throw error;
      return data.email_notifications;
    });
    await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: { user } } = await sb.auth.getUser();
      const updated = await sb.from("user_flags").update({ email_notifications: false }).eq("user_id", user.id).select("email_notifications").single();
      if (updated.error) throw updated.error;
      if (updated.data.email_notifications !== false) throw new Error("Notification flag was not disabled");
      await sb.auth.signOut();
    });
    await releaseResetCooldown(account);
    await waitForAuthMailSlot(account, testInfo);
    const after = new Date(Date.now() - 2_000).toISOString();
    await openLoginWithCaptchaBypass(page, context);
    await page.locator("#email").fill(account.email);
    await page.locator("#btnForgot").click();
    lastAuthMailAt.set(account.name, Date.now());
    await expect(page.locator("#status")).toContainText("Wysłano", { timeout: 30_000 });
    const email = await waitForEmail({ recipient: account.email, after, subject: /has|reset|odzysk/i });
    expectMailDocument(email, { lang: "pl" });
    expect(email.body_html).not.toContain("data-familijna-mail-center");
    expect(extractHttpLinks(email).some(link => /token_hash=|type=recovery/.test(link))).toBeTruthy();
  } finally {
    if (previousFlag !== undefined) {
      await loginAs(page, context, account);
      await page.evaluate(async (enabled) => {
        const sb = window.__sbClient;
        const { data: { user } } = await sb.auth.getUser();
        const { error } = await sb.from("user_flags").update({ email_notifications: enabled }).eq("user_id", user.id);
        if (error) throw error;
      }, previousFlag);
    }
    await clearMailbox(account.email);
  }
});

for (const lang of MAIL_LANGS) {
  test(`mail resetu hasla (${lang}) ma teksty z translation/${lang}/server.js`, async ({ page, context, accounts }, testInfo) => {
    test.setTimeout(240_000);
    const [account] = accounts.disposable;
    const { authEmail, index } = await loadAuthEmailCopy(lang);

    await clearMailbox(account.email);
    await releaseResetCooldown(account);
    await waitForAuthMailSlot(account, testInfo);
    const after = new Date(Date.now() - 2_000).toISOString();

    try {
      const secret = process.env.E2E_BYPASS_SECRET;
      await context.addInitScript((l) => localStorage.setItem("uiLang", l), lang);
      await context.setExtraHTTPHeaders({ "X-E2E-Token": generateE2EToken(secret) });
      await page.goto(lang === "pl" ? LOGIN_URL : `${LOGIN_URL}?lang=${lang}`, { waitUntil: "networkidle" });

      // Nagłówek zostaje na czas wysyłki: podpisany e2e reset omija limit KV
      // Workera na IP (wspólny adres runnerów), cooldown w bazie zostaje.
      await page.locator("#email").fill(account.email);
      await page.locator("#btnForgot").click();
      lastAuthMailAt.set(account.name, Date.now());
      await expect(page.locator("#status")).toContainText(index.statusResetSent, { timeout: 30_000 });
      await context.setExtraHTTPHeaders({});

      const email = await waitForEmail({ recipient: account.email, after });
      expectMailInLanguage(email, authEmail.recovery, lang, `reset ${lang}`, "recovery");
    } finally {
      await clearMailbox(account.email);
    }
  });
}

for (const lang of MAIL_LANGS) {
  test(`maile zmiany e-maila (${lang}) maja teksty z translation/${lang}/server.js`, async ({ page, context, accounts, loginAs }, testInfo) => {
    test.setTimeout(240_000);
    const [account] = accounts.disposable;
    const changed = alternate(account);
    const { authEmail } = await loadAuthEmailCopy(lang);

    await clearMailbox(account.email);
    await clearMailbox(changed.email);
    await waitForAuthMailSlot(account, testInfo);

    try {
      await loginAs(page, context, account);
      await resetEmailChangeState(page);
      const after = new Date(Date.now() - 2_000).toISOString();
      // ?lang= ma pierwszeństwo przed uiLang=pl ustawianym przez loginAs.
      await page.goto(`https://www.familijna.app/account${lang === "pl" ? "" : `?lang=${lang}`}`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-skel-step].skel-step-ready", { timeout: 20_000 });
      await page.locator("#email").fill(changed.email);
      await page.locator("#email2").fill(changed.email);
      await page.locator("#saveEmail").click();
      lastAuthMailAt.set(account.name, Date.now());

      // Linków nie klikamy — przepływ sprawdza test PL wyżej; zmianę w toku cofa
      // resetEmailChangeState niżej.
      const [oldEmail, newEmail] = await Promise.all([
        waitForEmail({ recipient: account.email, after }),
        waitForEmail({ recipient: changed.email, after }),
      ]);
      expectMailInLanguage(oldEmail, authEmail.emailChangeNotice, lang, `zmiana e-maila ${lang} (powiadomienie na stary adres)`,
        "emailChangeNotice", { actionPattern: /\/login\/\?lang=/, vars: { email: changed.email } });
      expectMailInLanguage(newEmail, authEmail.emailChange, lang, `zmiana e-maila ${lang} (nowy adres)`, "emailChange");
      await resetEmailChangeState(page);
    } finally {
      await clearMailbox(account.email);
      await clearMailbox(changed.email);
    }
  });
}
