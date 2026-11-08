// tests/e2e/guest-migration.spec.js
// Weryfikuje DWIE drogi migracji konta gościa na pełne konto — mają wspólny
// backend (guest_stage_migration/convertGuestToRegisteredEmailOnly/
// guest_finalize_migration) i wspólny bug znaleziony w audycie
// login/reset/confirm/account (2026-09-29), więc żyją w jednym pliku:
//
// 1) /account, #migrateSection (account.js) — gość MA już sesję i sam
//    inicjuje migrację ze strony ustawień.
// 2) /login, rejestracja z aktywną sesją gościa (login.js) — do
//    2026-09-29 ta ścieżka wołała starą, natychmiast flipującą
//    convertGuestToRegistered()/guest_convert_account() (celowo NIE
//    naprawioną migracją 249 — patrz jej komentarz "UWAGA: login.js
//    celowo NIE jest tu zmieniane"), więc porzucona/niepotwierdzona
//    migracja przez /login trwale zerowała is_guest, zanim e-mail w ogóle
//    został potwierdzony — martwe konto na zawsze (nie gość, więc pomijane
//    przez guest_cleanup_expired; nie zarejestrowany, bo e-mail
//    niepotwierdzony). Naprawione przełączeniem login.js na tę samą,
//    odroczoną architekturę co /account.
//
// Nie da się przejść PEŁNEGO cyklu w e2e (wymaga kliknięcia linku z
// prawdziwej skrzynki), więc oba testy sprawdzają to, co weryfikowalne przez
// UI + bezpośrednie zapytanie do bazy: stan "pending" po submit, i że
// profiles.is_guest NIE flipuje się przedwcześnie.
//
// Nazwa użytkownika i hasło podane w formularzu NIE trafiają do
// profiles/auth.users przy submicie — leżą zahaszowane w
// guest_migration_staging aż do realnego potwierdzenia maila
// (guest_finalize_migration(), wołane z confirm.js). Dlatego profiles.is_guest
// zostaje true przez cały test — submit migracji NIE flipuje go już
// przedwcześnie (patrz komentarz przy convertGuestToRegisteredEmailOnly
// w auth.js).
//
// Email do migracji celowo na domenie .invalid (RFC 2606 — zarezerwowana,
// nigdy nie rozwiąże się do prawdziwej skrzynki) — testujemy zachowanie UI
// po stronie klienta, nie dostarczalność maila.
//
// /account i cały front-end (js/, css/, translation/) serwowane z plików
// TEGO repo (helpers/branch-code.js), backend prawdziwy -- workflow odpalony
// na branchu testuje poprawki przed wdrożeniem. /login celowo NIE jest na
// liście `pages` (Worker podmienia tam sitekey Turnstile dla tokenu e2e --
// patrz tests/README.md), ale to nie przeszkadza: js/pages/login.js i
// js/core/auth.js i tak lądują w CODE_DIRS, więc serwują się z brancha
// niezależnie od tego, że samo login.html idzie z produkcji.

const { test, expect } = require("./helpers/e2e-test");
const { loginAsGuest } = require("./helpers/login");
const { generateE2EToken } = require("./helpers/e2e-token");
const { serveBranchCode } = require("./helpers/branch-code");
const { clearMailbox, waitForEmail, extractHttpLinks, resetMailProviderLimits, releaseMailCooldown } = require("./helpers/mailbox");

// Losowe hasło na przebieg (E24 A3): konto, którego sprzątanie by zawiodło, nie ma znanego hasła.
const TEST_PASSWORD = `Ee2!${require("node:crypto").randomBytes(12).toString("base64url")}9`;
const LOGIN_URL = "https://www.familijna.app/login";

// service worker obsłużyłby żądania z własnego cache z pominięciem page.route.
// Skrzynka bez konta (noaccount) na mail migracji; zasób "mail" (E25).
test.use({ serviceWorkers: "block", needs: { noaccount: 1, resources: ["mail"] } });

test.beforeEach(async ({ context }) => {
  await serveBranchCode(context, { pages: ["account"] });
});

// Druga wizyta na /login w tym samym teście potrzebuje WŁASNEGO, świeżego
// tokenu bypass -- ten zużyty przez loginAsGuest() jest jednorazowy (nonce)
// i już wyczyszczony z nagłówków przez tę funkcję.
async function reapplyE2EBypass(context) {
  const secret = process.env.E2E_BYPASS_SECRET;
  if (!secret) throw new Error("Brak E2E_BYPASS_SECRET w zmiennych środowiskowych");
  await context.setExtraHTTPHeaders({ "X-E2E-Token": generateE2EToken(secret) });
}

// handleMigrateCancel() aktualizuje UI OPTYMISTYCZNIE (#migratePendingHint
// znika, zanim RPC/updateUser w ogóle odpowiedzą) — asercja tylko na UI
// mogła więc "zaliczyć" krok anulowania, nawet gdyby backend faktycznie się
// wywalił. Realny bug (znaleziony live: podwójny addEventListener na
// #migrateCancel w account.js, wywołujący handleMigrateCancel() dwa razy na
// jeden klik) manifestował się właśnie tak — bez czytelnego błędu w UI, a
// handleDeleteAccount() później i tak trafiał w gałąź "zarejestrowany user".
// Ta funkcja czyta źródło prawdy bezpośrednio: profiles.is_guest w bazie ORAZ
// user_metadata.is_guest w świeżym JWT (to drugie czyta isGuestUser() w
// handleDeleteAccount) — obie muszą się zgadzać, żeby uznać cancel za sukces.
async function getGuestState(page) {
  return await page.evaluate(async () => {
    const sb = window.__sbClient;
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) throw new Error("getUser failed: " + (userErr?.message || "brak usera"));

    const { data: profile, error: profErr } = await sb
      .from("profiles")
      .select("is_guest")
      .eq("id", userData.user.id)
      .single();
    if (profErr) throw new Error("profiles select failed: " + profErr.message);

    return {
      profilesIsGuest: profile?.is_guest === true,
      metaIsGuest: userData.user.user_metadata?.is_guest === true,
    };
  });
}

test("migracja konta gościa: stan pending po submit, cooldown na resend, anulowanie czyści stan", async ({ page, context }) => {
  test.setTimeout(60_000);

  await loginAsGuest(page, context);

  try {
    await page.goto("https://www.familijna.app/account", { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Sekcja migracji jest jedną z dwóch widocznych dla gościa (obok usuwania
    // konta) — reszta (username/email/hasło/oceny/demo) jest schowana przez
    // hideForGuest() w loadProfile().
    await expect(page.locator("#migrateSection")).toBeVisible();
    await expect(page.locator("#usernameSection")).toBeHidden();

    const migrateEmail = `e2e-migrate-${Date.now()}@example.invalid`;
    // Prefiks "e2e" jest zarezerwowany dla tożsamości testowych (migracja 460).
    const migrateUsername = `gmigrate${Date.now() % 1000000}`;

    await page.locator("#migrateUsername").fill(migrateUsername);
    await page.locator("#migrateEmail").fill(migrateEmail);
    await page.locator("#migratePass1").fill(TEST_PASSWORD);
    await page.locator("#migratePass2").fill(TEST_PASSWORD);
    await page.locator("#btnMigrate").click();

    // Po sukcesie: hint "sprawdź maila" widoczny z adresem, przycisk submit
    // znika na rzecz pary Wyślij ponownie/Anuluj, pola formularza zablokowane.
    await expect(page.locator("#migratePendingHint")).toBeVisible({ timeout: 15000 });
    await expect(page.locator("#migratePendingHint")).toContainText(migrateEmail);
    await expect(page.locator("#btnMigrate")).toBeHidden();
    await expect(page.locator("#migratePendingActions")).toBeVisible();
    await expect(page.locator("#migrateEmail")).toBeDisabled();
    await expect(page.locator("#migrateEmail")).toHaveValue(migrateEmail);

    // Kluczowa właściwość nowej architektury: dopóki e-mail nie jest
    // potwierdzony, konto MUSI zostać gościem — inaczej wraca stary bug
    // (usuwanie/inne funkcje traktują niedomigrowane konto jak pełne).
    await expect.poll(() => getGuestState(page), { timeout: 10000 }).toEqual({
      profilesIsGuest: true,
      metaIsGuest: true,
    });

    // Cooldown (1h, per e-mail, klucz auth:guest_upgrade_email — ten sam co
    // login.js) był właśnie zarezerwowany przez submit powyżej, więc
    // natychmiastowy klik "Wyślij ponownie" MUSI zostać odrzucony, nie wysłać
    // kolejnego maila. To realna ochrona przed spamem, nie tylko UI-owy detal.
    await page.locator("#migrateResend").click();
    await expect(page.locator("#appToast.show")).not.toHaveText("", { timeout: 10000 });

    // Mimo aktywnego cooldownu na resend, "Anuluj" musi zadziałać od razu —
    // to inna operacja (czyści new_email), nie objęta tym limitem.
    await page.locator("#migrateCancel").click();
    await expect(page.locator("#migratePendingHint")).toBeHidden({ timeout: 15000 });
    await expect(page.locator("#btnMigrate")).toBeVisible();
    await expect(page.locator("#migratePendingActions")).toBeHidden();
    await expect(page.locator("#migrateEmail")).toBeEnabled();

    // Weryfikacja u źródła prawdy, nie tylko po UI (patrz komentarz przy
    // getGuestState) — obie flagi muszą wrócić na true, inaczej
    // handleDeleteAccount() w finally poniżej trafi w złą gałąź i zawiśnie
    // czekając na przycisk "Usuń", który nigdy się nie pojawi.
    await expect.poll(() => getGuestState(page), { timeout: 15000 }).toEqual({
      profilesIsGuest: true,
      metaIsGuest: true,
    });
  } finally {
    // Obowiązkowe sprzątanie kont gościa w e2e (patrz tests/README.md) —
    // przez prawdziwy UI flow, ta sama sekcja #deleteSection jest widoczna
    // na tej samej stronie /account, więc bez dodatkowej nawigacji.
    await page.locator("#deleteAccount").click();
    await page.getByRole("button", { name: "Usuń", exact: true }).click();
    await page.waitForURL(/login/, { timeout: 20000 });
  }
});

// Skrzynka noaccount (E25) nie ma konta: link otwierany dopiero po anulowaniu
// (nie przenosi konta), gość usunięty, więc żadne konto na tym adresie nie powstaje.
test("migracja konta gościa: mail i ponowne wysłanie docierają do skrzynki, anulowanie unieważnia link", async ({ page, context, browser, accounts }) => {
  test.setTimeout(240_000);
  const MAILBOX = accounts.noaccount[0].email;
  await resetMailProviderLimits();
  await clearMailbox(MAILBOX);
  await loginAsGuest(page, context);
  const isConfirmLink = (link) => /\/login\/confirm\/\?token_hash=/.test(link);

  try {
    await page.goto("https://www.familijna.app/account", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#migrateSection")).toBeVisible({ timeout: 30000 });
    await expect(page.locator("#btnMigrate")).toBeVisible();
    await releaseMailCooldown(MAILBOX, "auth:guest_upgrade_email"); // blokada z poprzedniego przebiegu
    const after = new Date(Date.now() - 2_000).toISOString();
    await page.locator("#migrateUsername").fill(`gmig${Date.now() % 1000000}`);
    await page.locator("#migrateEmail").fill(MAILBOX);
    await page.locator("#migratePass1").fill(TEST_PASSWORD);
    await page.locator("#migratePass2").fill(TEST_PASSWORD);
    await page.locator("#btnMigrate").click();
    await expect(page.locator("#migratePendingHint")).toBeVisible({ timeout: 15000 });
    const sentAt = Date.now();

    const first = await waitForEmail({ recipient: MAILBOX, after });
    expect(first.body_html || "").toContain('content="authEmail.guestMigrate@pl"');
    const firstLink = extractHttpLinks(first).find(isConfirmLink);
    expect(firstLink, "link migracji").toBeTruthy();

    // "Minęła godzina" dla blokady per adres i odstęp GoTrue (60 s na użytkownika).
    await releaseMailCooldown(MAILBOX, "auth:guest_upgrade_email");
    const wait = sentAt + 65_000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);

    const resendAfter = new Date(Date.now() - 1_000).toISOString();
    await page.locator("#migrateResend").click();
    await expect(page.locator("#appToast")).toContainText("Wysłano", { timeout: 20000 });
    await expect(page.locator("#appToast")).not.toHaveClass(/error/);
    const resent = await waitForEmail({ recipient: MAILBOX, after: resendAfter });
    const secondLink = extractHttpLinks(resent).find(isConfirmLink);
    expect(secondLink, "link po ponownym wyslaniu").toBeTruthy();
    expect(secondLink).not.toBe(firstLink);

    await page.locator("#migrateCancel").click();
    // Podpowiedź znika optymistycznie przed odpowiedzią serwera -- czekamy na
    // komunikat po zakończonym anulowaniu, inaczej link wyprzedza anulowanie.
    await expect(page.locator("#appToast")).toContainText("Migracja anulowana", { timeout: 20000 });
    await expect(page.locator("#migratePendingHint")).toBeHidden({ timeout: 15000 });
    await expect.poll(() => getGuestState(page), { timeout: 15000 }).toEqual({ profilesIsGuest: true, metaIsGuest: true });

    // Po anulowaniu link z maila nie przenosi konta.
    const linkContext = await browser.newContext({ serviceWorkers: "block" });
    await serveBranchCode(linkContext, { pages: ["login/confirm"] });
    const linkPage = await linkContext.newPage();
    await linkPage.goto(secondLink, { waitUntil: "domcontentloaded" });
    await expect(linkPage.locator("#status")).toContainText(/anulowana/i, { timeout: 20000 });
    console.log("[e2e-diag] link migracji po anulowaniu:", (await linkPage.locator("#status").textContent())?.trim());
    await linkContext.close();
    await expect.poll(() => getGuestState(page), { timeout: 10000 }).toEqual({ profilesIsGuest: true, metaIsGuest: true });
  } catch (error) {
    console.log("[e2e-diag] migracja: blad w tresci testu:", error.message.split("\n")[0], "url:", page.url());
    throw error;
  } finally {
    try {
      if (!/\/account/.test(page.url())) await page.goto("https://www.familijna.app/account", { waitUntil: "domcontentloaded" });
      await page.locator("#deleteAccount").click({ timeout: 30000 });
      await page.getByRole("button", { name: "Usuń", exact: true }).click();
      await page.waitForURL(/login/, { timeout: 20000 });
    } catch (cleanupError) {
      console.log("[e2e-diag] migracja: sprzatanie goscia nieudane:", cleanupError.message.split("\n")[0]);
    }
    await clearMailbox(MAILBOX);
  }
});

test("migracja konta gościa przez /login (rejestracja z aktywną sesją gościa): is_guest zostaje true po submit", async ({ page, context, request }) => {
  test.setTimeout(60_000);

  await loginAsGuest(page, context);

  // JWT gościa jest bezstanowy i zostaje ważny do swojego exp niezależnie od
  // późniejszego signOut() w login.js (ten sam fakt wykorzystuje już
  // account-deletion.spec.js) — potrzebny, żeby po tym signOut() dało się
  // zapytać profiles.is_guest bezpośrednio przez REST, oraz posprzątać konto
  // na końcu bez przechodzenia przez UI (przeglądarka będzie już wylogowana).
  const authInfo = await page.evaluate(async () => {
    const sb = window.__sbClient;
    const { data: userData } = await sb.auth.getUser();
    const { data: sess } = await sb.auth.getSession();
    return {
      userId: userData.user.id,
      supabaseUrl: sb.supabaseUrl,
      anonKey: sb.supabaseKey,
      accessToken: sess.session?.access_token,
    };
  });
  expect(authInfo.accessToken, "brak access_token gościa przed migracją").toBeTruthy();

  try {
    await reapplyE2EBypass(context);
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");
    // Przy aktywnej sesji gościa przycisk wraca do niej, nie zakłada nowego gościa.
    await expect(page.locator("#btnGuest")).toContainText("Wróć do konta gościa");

    await page.click("#btnToggle"); // Załóż konto -> mode=register
    const migrateEmail = `e2e-login-migrate-${Date.now()}@example.invalid`;
    await page.fill("#email", migrateEmail);
    await page.fill("#pass", TEST_PASSWORD);
    await page.fill("#pass2", TEST_PASSWORD);
    await page.click("#btnPrimary");

    // confirmModal "Przenieść konto gościa?" (guestMigrateTitle/guestMigrateOk)
    await page.getByRole("button", { name: "Tak, przenieś dane", exact: true }).click();

    // Sukces: status "Sprawdź e-mail…", potem alertModal z dalszą instrukcją.
    await expect(page.locator("#status")).toContainText("Sprawdź e-mail", { timeout: 20000 });
    await page.getByRole("button", { name: "OK", exact: true }).click();

    // Sesja gościa zostaje; Ustawienia konta pokazują oczekującą zamianę
    // z „Wyślij ponownie” i „Anuluj”.
    await page.waitForURL(/\/account\//, { timeout: 20000 });
    await expect(page.locator("#migratePendingHint")).toContainText(migrateEmail, { timeout: 20000 });
    await expect(page.locator("#migratePendingActions")).toBeVisible();

    // Kluczowa właściwość (ta sama co w teście /account powyżej): dopóki
    // e-mail nie jest potwierdzony, konto MUSI zostać gościem. Przed
    // 2026-09-29 login.js wołał tu convertGuestToRegistered(), który
    // flipował profiles.is_guest na false NATYCHMIAST — dokładnie ten stary
    // bug z komentarza przy migracji 249. Zapytanie bezpośrednio przez REST
    // tokenem gościa sprzed migracji.
    const res = await request.get(
      `${authInfo.supabaseUrl}/rest/v1/profiles?id=eq.${authInfo.userId}&select=is_guest`,
      { headers: { Authorization: `Bearer ${authInfo.accessToken}`, apikey: authInfo.anonKey } }
    );
    expect(res.ok(), "zapytanie REST do profiles nie powiodło się").toBeTruthy();
    const rows = await res.json();
    expect(rows?.[0]?.is_guest, "profiles.is_guest powinno zostać true dopóki e-mail niepotwierdzony").toBe(true);
  } finally {
    // Sprzątanie bezpośrednio przez tę samą edge function co
    // account-deletion.spec.js, z tym samym (wciąż ważnym) tokenem gościa —
    // konto zostało gościem (is_guest=true), więc delete-account je usuwa.
    await request.post(`${authInfo.supabaseUrl}/functions/v1/delete-account`, {
      headers: { Authorization: `Bearer ${authInfo.accessToken}`, apikey: authInfo.anonKey },
    }).catch(() => {});
  }
});
