// Ustawienia konta (podręcznik 5.4–5.9): czynności, których nie sprawdzają
// account-password-email / misuse-ui / account-rating, i ich wersje „źle/podejrzanie”:
// zajęta i zarezerwowana nazwa, odliczanie „raz na godzinę”, wyłączenie maili
// z potwierdzeniem, [Anuluj] w oknach demo i usuwania, usunięcie bez hasła,
// to samo hasło co obecne, widok i błędne dane konta gościa.
// Kod strony z brancha (serveBranchCode), baza i Worker produkcyjne.
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
const { loginAsGuest } = require("./helpers/login");

test.use({ serviceWorkers: "block", needs: { standard: 1, disposable: 1 } });

const ORIGIN = "https://www.familijna.app";
const LOCAL = process.env.E2E_BYPASS_SECRET === "local";

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["account", "games"] });
});

async function openAccount(page) {
  await page.goto(`${ORIGIN}/account/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-skel-step]").first()).toHaveClass(/skel-step-ready/, { timeout: 20000 });
}

// Dymek: tekst i rodzaj; błąd zostaje do kliknięcia, więc go zamykamy.
async function expectToast(page, text, { error = false } = {}) {
  const toast = page.locator("#appToast");
  await expect(toast).toContainText(text, { timeout: 20000 });
  if (error) await expect(toast).toHaveClass(/error/);
  else await expect(toast).not.toHaveClass(/error/);
  if (await toast.evaluate((el) => el.classList.contains("show")).catch(() => false)) await toast.click();
  await expect(toast).not.toHaveClass(/\bshow\b/, { timeout: 5000 });
}

async function profileName(page) {
  return page.evaluate(async () => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    return (await sb.from("profiles").select("username").eq("id", u.user.id).single()).data.username;
  });
}

async function restoreUsername(page, name) {
  await page.evaluate(async (name) => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    const { error } = await sb.from("profiles").update({ username: name }).eq("id", u.user.id);
    if (error) throw new Error("restore username: " + error.message);
    await sb.auth.updateUser({ data: { username: name } });
    await sb.rpc("cooldown_release", { p_action_key: "account:username", p_max_age_seconds: 7200 });
  }, name);
}

test("nazwa: zajęta i zarezerwowana nie zapisują się i nie blokują zmiany na godzinę", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  const [account] = accounts.disposable;
  await loginAs(page, context, account);
  await openAccount(page);
  const cases = [[accounts.standard[0].username, "Ta nazwa użytkownika jest już zajęta."], [accounts.standard[0].username.toUpperCase(), "Ta nazwa użytkownika jest już zajęta."]];
  // Zarezerwowane początki nazw przychodzą z bazy (lokalny schemat nie ma wierszy tej tabeli).
  if (!LOCAL) cases.push(["admin.kowalski", "Ta nazwa użytkownika jest już zajęta."], ["familijna_team", "Ta nazwa użytkownika jest już zajęta."]);
  for (const [value, msg] of cases) {
    await page.fill("#username", value);
    await page.click("#saveUsername");
    await expectToast(page, msg, { error: true });
    await expect(page.locator("#usernameCooldown"), value).toBeHidden();
    await expect(page.locator("#saveUsername")).toBeEnabled();
  }
  expect(await profileName(page)).toBe(account.username);
});

test("nazwa: po zapisaniu odliczanie „raz na godzinę”, pole zablokowane także po odświeżeniu", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  const [account] = accounts.disposable;
  await loginAs(page, context, account);
  await openAccount(page);
  const fresh = `godzina_${Date.now().toString(36)}`;
  try {
    await page.fill("#username", fresh);
    await page.click("#saveUsername");
    await expectToast(page, "Nazwa użytkownika zapisana.");
    for (let round = 0; round < 2; round++) {
      await expect(page.locator("#usernameCooldown")).toHaveText(/^Ponowna akcja możliwa za (60:00|59:[0-5]\d)\.$/, { timeout: 20000 });
      await expect(page.locator("#username")).toBeDisabled();
      await expect(page.locator("#saveUsername")).toBeDisabled();
      await expect(page.locator("#username")).toHaveValue(fresh);
      if (round === 0) await openAccount(page);
    }
    // Ominięcie zablokowanego przycisku: rezerwacja na serwerze odmawia.
    const again = await page.evaluate(async () => {
      const { data, error } = await window.__sbClient.rpc("cooldown_reserve", { p_action_key: "account:username", p_cooldown_seconds: 3600 });
      return error ? "error" : (Array.isArray(data) ? data[0] : data)?.ok;
    });
    expect(again, "druga zmiana w ciągu godziny").not.toBe(true);
  } finally {
    await restoreUsername(page, account.username);
  }
});

test("powiadomienia e-mail: wyłączenie pyta o potwierdzenie; [Anuluj] nic nie zmienia, potwierdzenie zapisuje na stałe", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.standard[0]);
  const flag = () => page.evaluate(async () => {
    const sb = window.__sbClient;
    const { data: u } = await sb.auth.getUser();
    return (await sb.rpc("get_my_email_notifications", { p_user_id: u.user.id })).data;
  });
  await openAccount(page);
  const box = page.locator("#emailNotifications");
  try {
    if (!(await box.isChecked())) {
      await box.click();
      await expect(page.locator("#emailNotifSaved")).toContainText("Powiadomienia e-mail zostały włączone.");
    }
    await box.click();
    const dialog = page.locator(".uni-modal:visible");
    await expect(dialog).toContainText("Wyłączyć wiadomości e-mail?");
    await expect(dialog).toContainText("Nadal zobaczysz wszystkie propozycje i zadania bezpośrednio na stronie.");
    await dialog.getByRole("button", { name: "Anuluj" }).click();
    await expect(box).toBeChecked();
    expect(await flag()).toBe(true);

    await box.click();
    await page.locator(".uni-modal:visible .uni-foot .btn.gold").click();
    await expect(page.locator("#emailNotifSaved")).toContainText("Powiadomienia e-mail zostały wyłączone.");
    await expect(box).not.toBeChecked();
    expect(await flag()).toBe(false);
    await openAccount(page);
    await expect(box).not.toBeChecked();

    // Włączenie nie pyta o potwierdzenie.
    await box.click();
    await expect(page.locator(".uni-modal:visible")).toHaveCount(0);
    await expect(page.locator("#emailNotifSaved")).toContainText("Powiadomienia e-mail zostały włączone.");
    expect(await flag()).toBe(true);
  } finally {
    await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: u } = await sb.auth.getUser();
      await sb.rpc("set_my_email_notifications", { p_user_id: u.user.id, p_enabled: true });
    });
  }
});

test("[Przywróć pliki demo] i [Usuń konto i dane]: [Anuluj] i puste hasło niczego nie usuwają", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.disposable[0]);
  const sent = [];
  page.on("request", (r) => { if (/rpc\/restore_my_demo|functions\/v1\/delete-account|auth\/v1\/token\?grant_type=password/.test(r.url())) sent.push(new URL(r.url()).pathname); });
  await openAccount(page);

  await page.click("#demoRestoreBtn");
  const dialog = page.locator(".uni-modal:visible");
  await expect(dialog).toContainText("Przywrócić pliki demo?");
  await dialog.getByRole("button", { name: "Anuluj" }).click();
  await expect(dialog).toHaveCount(0);

  await page.fill("#deletePassword", "");
  await page.click("#deleteAccount");
  await expectToast(page, "Podaj hasło, aby potwierdzić.", { error: true });
  await expect(page).toHaveURL(/\/account\//);
  expect(sent, "bez przywracania demo, sprawdzania hasła i usuwania konta").toEqual([]);
  const alive = await page.evaluate(async () => !!(await window.__sbClient.auth.getUser()).data?.user?.id);
  expect(alive).toBe(true);
});

test("hasło (tylko CI): to samo co obecne — komunikat, bez blokady na godzinę", async ({ page, context, accounts, loginAs }) => {
  test.skip(LOCAL, "lokalna atrapa logowania nie zna haseł");
  test.setTimeout(90_000);
  await loginAs(page, context, accounts.disposable[0]);
  await openAccount(page);
  await page.fill("#pass1", process.env.TEST_PASSWORD);
  await page.fill("#pass2", process.env.TEST_PASSWORD);
  await page.click("#savePass");
  await expectToast(page, "Nowe hasło musi być inne niż poprzednie.", { error: true });
  await expect(page.locator("#passwordCooldown")).toBeHidden();
  await expect(page.locator("#savePass")).toBeEnabled();
});

test("konto gościa (tylko CI): „Zapisz swoje dane”, ocena systemu i usuwanie; błędne dane migracji nic nie wysyłają; [Nie] zostawia konto", async ({ page, context }) => {
  test.skip(LOCAL, "konto gościa zakłada Worker");
  test.setTimeout(150_000);
  await loginAsGuest(page, context);
  const sent = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/rpc\/guest_stage_migration|rpc\/mail_cooldown|functions\/v1\/delete-account/.test(u) || (u.includes("/auth/v1/user") && r.method() === "PUT" && /"email"/.test(r.postData() || ""))) sent.push(new URL(u).pathname);
  });
  try {
    await openAccount(page);
    await expect(page.locator("#migrateSection")).toBeVisible();
    for (const id of ["usernameSection", "emailSection", "passwordSection", "emailNotifSection", "demoSection"]) {
      await expect(page.locator(`#${id}`), id).toBeHidden();
    }
    // Ocena systemu jak u każdego konta (527): sekcja i przycisk „Oceń”.
    await expect(page.locator("#ratingSection")).toBeVisible();
    await expect(page.locator("#ratingEditBtn")).toBeVisible();
    await expect(page.locator("#deletePassword")).toBeHidden();
    await expect(page.locator("#deleteHint")).not.toContainText("Wpisz hasło");

    for (const [mail, p1, p2, user, msg] of [
      ["bez-malpy", "Dobre-Haslo-1!", "Dobre-Haslo-1!", "", "Podaj poprawny e-mail."],
      ["gosc@example.test", "Dobre-Haslo-1!", "Inne-Haslo-1!", "", "Hasła nie są takie same."],
      ["gosc@example.test", "slabe", "slabe", "", "Brakuje:"],
      ["gosc@example.test", "Dobre-Haslo-1!", "Dobre-Haslo-1!", "<b>x</b>", "Dozwolone znaki"],
      ["gosc@example.test", "Dobre-Haslo-1!", "Dobre-Haslo-1!", "admin_gosc", "Ta nazwa użytkownika jest już zajęta."],
    ]) {
      await page.fill("#migrateEmail", mail);
      await page.fill("#migratePass1", p1);
      await page.fill("#migratePass2", p2);
      await page.fill("#migrateUsername", user);
      await page.click("#btnMigrate");
      await expectToast(page, msg, { error: true });
    }
    await expect(page.locator("#migratePendingActions")).toBeHidden();

    await page.click("#deleteAccount");
    const dialog = page.locator(".uni-modal:visible");
    await expect(dialog).toContainText("Usunąć konto gościa?");
    await dialog.getByRole("button", { name: "Nie", exact: true }).click();
    await expect(page).toHaveURL(/\/account\//);
    expect(sent, "nic nie wysłane").toEqual([]);
    expect(await page.evaluate(async () => !!(await window.__sbClient.auth.getUser()).data?.user?.id)).toBe(true);
  } finally {
    // Sprzątanie gościa przez prawdziwe UI (tests/README.md „Tryby logowania”).
    await openAccount(page);
    await page.click("#deleteAccount");
    await page.locator(".uni-modal:visible").getByRole("button", { name: "Usuń", exact: true }).click();
    await page.waitForURL(/\/login/, { timeout: 30000 });
  }
});

test("przypomnienie gościa (5.4): raz dziennie z [Migruj teraz]; [Zamknij] tylko na dziś, „Nie pokazuj więcej” na stałe", async ({ page, context, accounts, loginAs }) => {
  // Baner pokazuje strona Moje gry (teksty w części wspólnej tłumaczeń); konto gościa
  // podstawione w wywołaniu — zakładanie gościa sprawdza account-deletion.spec.js.
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/games/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#grid")).toBeVisible({ timeout: 20000 });
  const show = (user) => page.evaluate(async (user) => {
    const m = await import("/shared/js/core/guest-migrate-reminder.js");
    document.getElementById("guestMigrateReminder")?.remove();
    m.maybeShowGuestMigrateReminder(user);
    return !!document.getElementById("guestMigrateReminder");
  }, user);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("fam:guest:migrate_")).forEach((k) => localStorage.removeItem(k)));

  expect(await show({ id: "e2e-konto", is_guest: false }), "zwykłe konto: bez przypomnienia").toBe(false);
  expect(await show({ id: "e2e-gosc", is_guest: true })).toBe(true);
  const bar = page.locator("#guestMigrateReminder");
  await expect(bar).toContainText("Konto gościa zostanie usunięte za kilka dni.");
  await expect(bar.getByRole("link", { name: "Migruj teraz" })).toHaveAttribute("href", /\/account\//);
  await bar.getByRole("button", { name: "Zamknij" }).click();
  await expect(bar).toHaveCount(0);
  expect(await show({ id: "e2e-gosc", is_guest: true }), "drugi raz tego samego dnia").toBe(false);

  // Następny dzień: wraca; „Nie pokazuj więcej” wyłącza na stałe.
  await page.evaluate(() => localStorage.setItem("fam:guest:migrate_last_shown:e2e-gosc", "2000-01-01"));
  expect(await show({ id: "e2e-gosc", is_guest: true })).toBe(true);
  await page.locator("#guestMigrateReminder").getByRole("button", { name: "Nie pokazuj więcej" }).click();
  await page.evaluate(() => localStorage.setItem("fam:guest:migrate_last_shown:e2e-gosc", "2000-01-01"));
  expect(await show({ id: "e2e-gosc", is_guest: true }), "po „Nie pokazuj więcej”").toBe(false);
  expect(await show({ id: "e2e-inny-gosc", is_guest: true }), "inne konto gościa ma własne ustawienie").toBe(true);
});
