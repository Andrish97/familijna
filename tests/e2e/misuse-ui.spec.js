// Nadużycia i błędne dane w interfejsie (podręcznik 5.5–5.9, 6, 8, 9):
// nazwy z HTML na listach, wrogi plik .famlogo, błędne nazwy i hasła na
// Koncie, usunięcie konta złym hasłem. Strony z kodu brancha (serveBranchCode),
// baza i Worker produkcyjne. Strona serwera tych samych zasad:
// tests/sql/abuse-probes.sql (migracja 514).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect } = require("./helpers/e2e-test");
const { serveBranchCode } = require("./helpers/branch-code");
const { withE2EBypass, instrumentPage } = require("./helpers/login");

test.use({ serviceWorkers: "block", needs: { standard: 1, disposable: 1 } });

const ORIGIN = "https://www.familijna.app";
// Lokalnie (scripts/agent-tools/local-e2e) logowanie jest atrapą: każde hasło pasuje.
const LOCAL_AUTH = process.env.E2E_BYPASS_SECRET === "local";
const XSS = `<img src=x onerror=__xssHit=1>`;

async function toastText(page) {
  const t = page.locator(".app-toast.show .app-toast-text").last();
  await expect(t).toBeVisible({ timeout: 10000 });
  return (await t.textContent()).trim();
}

test.describe("nazwy z HTML na listach", () => {
  test.beforeEach(async ({ context }) => {
    await serveBranchCode(context, { pages: ["games", "logos", "bases"] });
  });

  test("gra, logo i baza o nazwie z HTML: widać tekst, nic się nie wykonuje", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(120_000);
    await loginAs(page, context, accounts.standard[0]);
    const stamp = Date.now();
    const name = `E2E-XSS-${stamp} ${XSS}`.slice(0, 80);
    const ids = await page.evaluate(async (name) => {
      const sb = window.__sbClient;
      const { data: u } = await sb.auth.getUser();
      const g = await sb.from("games").insert({ name, owner_id: u.user.id, type: "prepared", status: "draft" }).select("id").single();
      const l = await sb.from("user_logos").insert({ name, user_id: u.user.id, type: "GLYPH_30x10",
        payload: { layers: [{ color: "main", rows: Array.from({ length: 10 }, () => " ".repeat(30)) }], source: { mode: "TEXT" } } }).select("id").single();
      const b = await sb.from("question_bases").insert({ name, owner_id: u.user.id }).select("id").single();
      for (const r of [g, l, b]) if (r.error) throw new Error(r.error.message);
      return { game: g.data.id, logo: l.data.id, base: b.data.id };
    }, name);
    try {
      for (const [path, tile] of [["/games/", "#grid .card"], ["/logos/", ".logoTile"], ["/bases/", "#mineGrid .card"]]) {
        await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
        await expect(page.locator(tile).filter({ hasText: `E2E-XSS-${stamp}` }).first()).toBeVisible({ timeout: 20000 });
        const state = await page.evaluate(() => ({
          hit: window.__xssHit || 0,
          injected: document.querySelectorAll('img[src="x"]').length,
        }));
        expect(state, `${path}: nazwa jako tekst, bez wstawionego elementu`).toEqual({ hit: 0, injected: 0 });
        await expect(page.locator(tile).filter({ hasText: "<img src=x" }).first()).toBeVisible();
      }
    } finally {
      await page.evaluate(async (ids) => {
        const sb = window.__sbClient;
        await sb.from("games").delete().eq("id", ids.game);
        await sb.from("user_logos").delete().eq("id", ids.logo);
        await sb.from("question_bases").delete().eq("id", ids.base);
      }, ids);
    }
  });

  test("import .famlogo: obcy adres obrazu i obrazy w rysunku odrzucone, nazwa do 80 znaków", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(120_000);
    await loginAs(page, context, accounts.standard[0]);
    const stamp = Date.now();
    const longName = `E2E-HOSTILE-${stamp}-${"x".repeat(200)}`;
    const pkg = {
      kind: "PIX", name: longName,
      payload: {
        w: 150, h: 70, bits_b64: Buffer.alloc(Math.ceil(150 * 70 / 8)).toString("base64"),
        source: {
          mode: "DRAW", imageUrl: "https://tracker.example.test/pixel.png",
          fabricData: { version: "5.3.0", backgroundImage: { type: "image", src: "https://tracker.example.test/bg.png" },
            objects: [{ type: "image", src: "https://tracker.example.test/obj.png" }, { type: "rect", left: 1, top: 1, width: 5, height: 5 }] },
        },
      },
    };
    // ścieżka bez znaków spoza ASCII (katalog wyników testu ma polskie litery)
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "e2e-famlogo-")), "hostile.famlogo");
    fs.writeFileSync(file, JSON.stringify(pkg));
    const external = [];
    page.on("request", (r) => { if (r.url().includes("tracker.example.test")) external.push(r.url()); });

    await page.goto(`${ORIGIN}/logos/?tab=draw`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#btnImport")).toBeEnabled({ timeout: 20000 });
    await page.locator("#btnImport").click();
    await expect(page.locator("#logoImportOverlay")).toBeVisible({ timeout: 10000 });
    await page.setInputFiles("#inpImportLogoFile", file);
    await expect(page.locator("#logoImportFileName")).toContainText("hostile.famlogo");
    await expect(page.locator("#btnLogoImportConfirm")).toBeEnabled({ timeout: 15000 });
    await page.locator("#btnLogoImportConfirm").click();
    await expect(page.locator("#btnLogoImportDone")).toBeVisible({ timeout: 20000 });
    await page.locator("#btnLogoImportDone").click();

    const row = await page.evaluate(async (prefix) => {
      const { data, error } = await window.__sbClient.from("user_logos").select("id,name,payload").like("name", `${prefix}%`);
      if (error) throw new Error(error.message);
      return data[0] || null;
    }, `E2E-HOSTILE-${stamp}`);
    try {
      expect(row, "logo zaimportowane").not.toBeNull();
      expect(row.name.length).toBeLessThanOrEqual(80);
      expect(JSON.stringify(row.payload)).not.toContain("tracker.example.test");
      expect(row.payload.source.fabricData.objects.map((o) => o.type)).toEqual(["rect"]);
      expect(external, "żadnego żądania do obcego serwera").toEqual([]);
    } finally {
      if (row) await page.evaluate(async (id) => { await window.__sbClient.from("user_logos").delete().eq("id", id); }, row.id);
    }
  });
});

test.describe("Konto: błędne dane", () => {
  test.beforeEach(async ({ context }) => {
    await serveBranchCode(context, { pages: ["account"] });
  });

  test("nazwa użytkownika i hasło niezgodne z zasadami nie trafiają do bazy (UI i bezpośredni zapis)", async ({ page, context, accounts, loginAs }) => {
    test.setTimeout(120_000);
    await loginAs(page, context, accounts.standard[0]);
    await page.goto(`${ORIGIN}/account/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#username")).toBeVisible({ timeout: 20000 });
    const before = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: u } = await sb.auth.getUser();
      return (await sb.from("profiles").select("username,is_guest,guest_expires_at").eq("id", u.user.id).single()).data;
    });

    for (const [value, msg] of [
      ["ab", "min. 3 znaki"],
      ["a".repeat(21), "max. 20 znaków"],
      ["<b>zly</b>", "Dozwolone znaki"],
      ["jan kowalski", "Dozwolone znaki"],
      ["guest_podszywka", "guest_ jest zarezerwowany"],
    ]) {
      await page.fill("#username", value);
      await page.click("#saveUsername");
      expect(await toastText(page), value).toContain(msg);
    }

    await page.click("#savePass");
    expect(await toastText(page)).toContain("Podaj obecne hasło");
    await page.fill("#passCurrent", "Obecne-Haslo-1!");
    await page.fill("#pass1", "Dobre-Haslo-1");
    await page.fill("#pass2", "Inne-Haslo-1");
    await page.click("#savePass");
    expect(await toastText(page)).toContain("Hasła nie są takie same");
    await page.fill("#pass1", "slabe");
    await page.fill("#pass2", "slabe");
    await page.click("#savePass");
    expect(await toastText(page)).toContain("Brakuje:");

    // Ominięcie interfejsu: serwer trzyma te same zasady i nie oddaje kolumn gościa (514).
    const direct = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: u } = await sb.auth.getUser();
      const id = u.user.id;
      const tries = {};
      for (const [key, patch] of Object.entries({
        html: { username: "<b>zly</b>" }, empty: { username: "" }, guestPrefix: { username: "guest_x1" },
        guestFlag: { is_guest: true }, expires: { guest_expires_at: "9999-01-01T00:00:00Z" },
        email: { email: "ktos-inny@example.test" },
      })) {
        const { error } = await sb.from("profiles").update(patch).eq("id", id);
        tries[key] = error ? "odmowa" : "zapisane";
      }
      const after = (await sb.from("profiles").select("username,is_guest,guest_expires_at").eq("id", id).single()).data;
      return { tries, after };
    });
    expect(direct.tries).toEqual({ html: "odmowa", empty: "odmowa", guestPrefix: "odmowa", guestFlag: "odmowa", expires: "odmowa", email: "odmowa" });
    expect(direct.after).toEqual(before);
  });

  test("usunięcie konta złym hasłem nie usuwa konta", async ({ page, context, accounts, loginAs }) => {
    test.skip(LOCAL_AUTH, "lokalna atrapa logowania przyjmuje każde hasło");
    test.setTimeout(120_000);
    const [account] = accounts.disposable;
    await loginAs(page, context, account);
    await page.goto(`${ORIGIN}/account/`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("#deletePassword")).toBeVisible({ timeout: 20000 });
    await page.fill("#deletePassword", "Zle-Haslo-e2e-1!");
    await page.click("#deleteAccount");
    // okno potwierdzenia (jeśli jest) -- potwierdź; hasło sprawdza się przed usunięciem
    const ok = page.locator(".uni-modal .uni-foot .btn.gold:visible");
    if (await ok.isVisible().catch(() => false)) await ok.click();
    await toastText(page);
    const alive = await page.evaluate(async () => {
      const { data, error } = await window.__sbClient.auth.getUser();
      return !error && !!data?.user?.id;
    });
    expect(alive, "sesja i konto zostają").toBe(true);
    await expect(page).toHaveURL(/\/account/);
  });
});

test.describe("Logowanie i reset hasła: błędne dane", () => {
  // Strona logowania zawsze z produkcji (Worker podmienia klucz Turnstile, helpers/branch-code.js).
  async function openLogin(browser, path = "/login") {
    const ctx = await browser.newContext({ serviceWorkers: "block" });
    await withE2EBypass(ctx);
    const page = await ctx.newPage();
    instrumentPage(page);
    await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded" });
    return { ctx, page };
  }

  async function submitLogin(page, login, password) {
    await page.fill("#email", login);
    await page.fill("#pass", password);
    await page.locator("#err").evaluate((el) => { el.textContent = ""; });
    await page.click("#btnPrimary");
    await expect(page.locator("#err")).not.toHaveText("", { timeout: 20000 });
    return (await page.locator("#err").textContent()).trim();
  }

  test("puste pola i złe hasło do adresu e-mail: komunikat nie zdradza, czy konto istnieje", async ({ browser, accounts }) => {
    test.skip(LOCAL_AUTH, "lokalna atrapa logowania przyjmuje każde hasło");
    test.setTimeout(120_000);
    const { ctx, page } = await openLogin(browser);
    try {
      await page.waitForFunction(() => !document.documentElement.classList.contains("page-loading"), null, { timeout: 20000 });
      expect(await submitLogin(page, "", "")).toContain("Podaj e-mail/nazwę użytkownika i hasło");
      const wrong = await submitLogin(page, accounts.standard[0].email, "Zle-Haslo-e2e-1!");
      const unknown = await submitLogin(page, `nikt-${Date.now().toString(36)}@example.test`, "Zle-Haslo-e2e-1!");
      expect(wrong).toBeTruthy();
      expect(unknown, "ta sama odpowiedź dla nieznanego adresu").toBe(wrong);
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await ctx.close();
    }
  });

  test("reset hasła bez ważnego linku: komunikat, formularz ukryty", async ({ browser }) => {
    test.setTimeout(60_000);
    const { ctx, page } = await openLogin(browser, "/login/reset/");
    try {
      await expect(page.locator("#err")).toContainText(/link/i, { timeout: 20000 });
      await expect(page.locator("#form")).toBeHidden();
      await expect(page.locator("#back")).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});
