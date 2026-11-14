const { test, expect } = require("./helpers/production-test");
const { serveBranchCode, serveBranchLoginHtml } = require("./helpers/branch-code");
const { touchSwipe } = require("./helpers/touch-swipe");

const ORIGIN = "https://www.familijna.app";

test.use({ serviceWorkers: "block" });
// E25: konto wypożyczane na worker (tests/README.md „Test accounts”).
test.use({ needs: { standard: 1 } });

// Na produkcji treść Wskazówek przychodzi gotowa z Workera i odnośniki da się
// kliknąć, zanim manual.js je przechwyci (wtedy działają jak zwykłe linki, bez
// from=). Testy zachowania JS czekają na gotowość strony.
const manualReady = async (page) => {
  const t0 = Date.now();
  try {
    await expect(page.locator("html")).toHaveAttribute("data-manual-ready", "true", { timeout: 15000 });
  } finally {
    // [e2e-diag]: czas do gotowości i zasoby Wskazówek, które jeszcze się wczytywały.
    const slow = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter((e) => e.duration > 1500 || !e.responseEnd)
      .map((e) => `${new URL(e.name).pathname} ${Math.round(e.duration)}ms`).slice(0, 12)).catch(() => []);
    console.log(`[e2e-diag] manual ready po ${Date.now() - t0} ms; wolne zasoby: ${slow.join(", ") || "brak"}`);
  }
};

test.beforeEach(async ({ context }) => {
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["privacy", "manual"] });
});

test("privacy: treść, tytuł i opis SEO przełączają się w PL/EN/UK", async ({ page }) => {
  const cases = [
    { lang: "pl", heading: "Polityka Prywatności", description: "Polityka prywatności" },
    { lang: "en", heading: "Privacy Policy", description: "privacy policy" },
    { lang: "uk", heading: "Політика конфіденційності", description: "Політика конфіденційності" },
  ];

  for (const item of cases) {
    await page.goto(`${ORIGIN}/privacy?lang=${item.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).not.toHaveClass(/page-loading/);
    await expect(page.locator("h1")).toContainText(item.heading);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", new RegExp(item.description, "i"));
    await expect(page.locator(".m-doc h2")).toHaveCount(9);
    const canonical = `${ORIGIN}/privacy${item.lang === "pl" ? "" : `?lang=${item.lang}`}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
  }
});

test("manual: publiczny rozdział i metadane działają anonimowo w PL/EN/UK", async ({ page }) => {
  for (const lang of ["pl", "en", "uk"]) {
    await page.goto(`${ORIGIN}/manual/?ch=6&lang=${lang}&from=9&ret=%2Fgames%2F`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".m-doc .m-h2").first()).toBeVisible();
    const canonical = `${ORIGIN}/manual/?ch=6${lang === "pl" ? "" : `&lang=${lang}`}`;
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", canonical);
    const heading = await page.locator("#manualArticle h1").textContent();
    await expect(page).toHaveTitle(new RegExp(heading));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");
    await page.locator('.m-pager-link.next').click();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical.replace('ch=6', 'ch=7'));
    await page.locator('#manualArticle a[data-ch=""]').click();
    await expect(page.locator('.m-parts')).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", `${ORIGIN}/manual/${lang === "pl" ? "" : `?lang=${lang}`}`);
  }
});

test("manual: zrzuty mają wersję z treści obrazu i wczytują się", async ({ page }) => {
  // Wydanie dopisuje ?v=h<skrót treści> (scripts/content-hash-assets.cjs): zmieniony
  // zrzut ma nowy adres od razu, niezmieniony zostaje w pamięci na rok.
  await page.goto(`${ORIGIN}/manual/?ch=17`, { waitUntil: "domcontentloaded" });
  const shot = page.locator('.m-shot img[src*="play-display-play-desktop.webp"]:visible').first();
  await expect(shot).toHaveAttribute("src", /\/manual\/img\/pl\/(light\/)?play-display-play-desktop\.webp\?v=h[0-9a-f]{16}$/);
  await shot.scrollIntoViewIfNeeded();
  await expect.poll(() => shot.evaluate((img) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
  const res = await page.request.get(new URL(await shot.getAttribute("src"), ORIGIN).href);
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toContain("immutable");
});

test("privacy: parametr ret dopuszcza tylko bezpieczny powrót w obrębie serwisu", async ({ page, context, accounts, loginAs }) => {
  // Powrót prowadzi do instrukcji, która wymaga sesji (bez niej: logowanie).
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/privacy?lang=en&ret=${encodeURIComponent("https://example.com/phishing")}`);
  await expect(page.locator(".topbar.topbar-ready")).toBeAttached(); // „Wstecz” podpina initPage
  await page.locator("#btnBack").click();
  await page.waitForURL((url) => url.origin === ORIGIN && !url.pathname.startsWith("/privacy"));
  expect(new URL(page.url()).origin).toBe(ORIGIN);

  const safeBack = "/manual/?ch=15#s-15-4";
  await page.goto(`${ORIGIN}/privacy?lang=uk&ret=${encodeURIComponent(safeBack)}`);
  await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
  await page.locator("#btnBack").click();
  await page.waitForURL(/\/manual/);
  const returned = new URL(page.url());
  expect(returned.origin).toBe(ORIGIN);
  expect(returned.searchParams.get("ch")).toBe("15");
  expect(returned.searchParams.get("lang")).toBe("uk");
  await expect(page.locator("#s-15-4")).toBeVisible();
});

// Regresja 2026-10-22: blokada body z układu Podręcznika (.manual-body) zamrażała politykę.
test("privacy: treść przewija się palcem na telefonie i kółkiem na komputerze", async ({ browser }) => {
  const scrolled = (page) => page.evaluate(() => document.scrollingElement.scrollTop);
  for (const device of [
    { name: "telefon", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    { name: "komputer", viewport: { width: 1400, height: 900 } },
  ]) {
    const { name, ...opts } = device;
    const context = await browser.newContext({ ...opts, serviceWorkers: "block" });
    try {
      if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["privacy", "manual"] });
      const page = await context.newPage();
      await page.goto(`${ORIGIN}/privacy?lang=pl`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("html")).not.toHaveClass(/page-loading/);
      const last = page.locator(".m-doc h2").last();
      await expect(last).not.toBeInViewport();
      if (opts.hasTouch) {
        const cdp = await context.newCDPSession(page);
        // Przesunięcie palcem w górę (zdarzenia dotyku jak w touchSwipe).
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: 700 }] });
        for (let i = 1; i <= 10; i++) {
          await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: 700 - i * 50 }] });
        }
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(700, 500);
        await page.mouse.wheel(0, 1500);
      }
      await expect.poll(() => scrolled(page), { message: `przewinięcie (${name})` }).toBeGreaterThan(500);
      await page.keyboard.press("End");
      await expect(last).toBeInViewport();
    } finally {
      await context.close();
    }
  }
});

test("manual: spis treści (części → rozdziały) w PL/EN/UK, bez ?modal=", async ({ page, context, accounts, loginAs }) => {
  await loginAs(page, context, accounts.standard[0]);
  const cases = [
    { lang: "pl", title: "Wskazówki dla użytkownika", part: "Część I", toc: "Spis treści wskazówek" },
    { lang: "en", title: "Help for users", part: "Part I", toc: "Help contents" },
    { lang: "uk", title: "Підказки для користувача", part: "Частина I", toc: "Зміст підказок" },
  ];
  for (const item of cases) {
    await page.goto(`${ORIGIN}/manual/?lang=${item.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("html")).not.toHaveClass(/page-loading/);
    await expect(page.locator(".modal-tabs")).toHaveCount(0);
    await expect(page.locator(".m-article h1")).toHaveText(item.title);
    await expect(page.locator(".m-part-card")).toHaveCount(3);
    await expect(page.locator(".m-part-title").first()).toContainText(item.part);
    await expect(page.locator("#manualToc")).toHaveAttribute("aria-label", item.toc);
    await expect(page.locator("#manualToc .m-side-item:not(.m-side-sub)")).toHaveCount(20);
  }
});

test("manual: rozdział w ?ch= (replaceState), podrozdział w #s-…, odnośnik → i poprzedni/następny", async ({ page, context, accounts, loginAs }, testInfo) => {
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/manual/?lang=pl`, { waitUntil: "domcontentloaded" });
  await manualReady(page);
  const historyBefore = await page.evaluate(() => history.length);

  await page.locator('#manualToc a.m-side-item[data-ch="6"]').first().click();
  await expect(page.locator(".m-article h1")).toContainText("Moje gry");
  await expect(page).toHaveURL(/[?&]ch=6(?:&|#|$)/);
  await expect(page.locator("#manualToc .m-side-sub")).toHaveCount(7);
  await expect(page.locator(".m-doc .m-control").first()).toBeVisible();
  await expect(page.locator(".m-doc .m-control svg.ico").first()).toBeVisible();

  await page.locator('.m-doc a.m-ref[href*="ch=7"][href$="#s-7-1"]').first().click();
  await expect(page.locator(".m-article h1")).toContainText("Tworzenie i edycja gry");
  await expect(page).toHaveURL(/[?&]ch=7&from=6\.1#s-7-1$/);
  await expect(page.locator("#s-7-1")).toBeInViewport();
  await expect(page.locator(".m-return")).toBeVisible();

  await page.locator(".m-pager-link.next").click();
  await expect(page).toHaveURL(/[?&]ch=8(?:&|#|$)/);
  expect(await page.evaluate(() => history.length)).toBe(historyBefore);
  if (testInfo) await page.screenshot({ path: testInfo.outputPath("shot-manual-chapter-pl.png") });

  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=16#s-16-5-2`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#s-16-5-2")).toBeInViewport();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".m-article h1")).toContainText("Ustawienia rozgrywki");

  // Nieznany rozdział daje teraz 404 w Workerze. Ten kontrakt sprawdza
  // public-pages.test.mjs; serveBranchCode testuje tu samą nawigację frontu.
});

test("manual: przycisk pomocy strony otwiera jej rozdział, Wstecz wraca", async ({ page, context, accounts, loginAs }) => {
  await serveBranchCode(context, { pages: ["privacy", "manual", "bases"] });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/bases/?lang=pl`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
  await page.locator("#btnManual").click();
  await page.waitForURL(/\/manual\/\?.*ch=9/);
  await expect(page.locator(".m-article h1")).toContainText("Bazy pytań");
  await page.locator("#btnBack").click();
  await page.waitForURL(/\/bases\//);
});

test("manual: telefon — spis treści pod przyciskiem", async ({ page, context, accounts, loginAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=17`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#manualToc")).toBeHidden();
  await page.locator("#manualTocToggle").click();
  await expect(page.locator("#manualToc")).toBeVisible();
  await page.locator('#manualToc a.m-side-item[data-ch="15"]').first().click();
  await expect(page.locator(".m-article h1")).toContainText("Ankiety");
  await expect(page.locator("#manualToc")).toBeHidden();
});

test("manual: wyszukiwanie — wyniki na żywo, wybór otwiera podrozdział z zaznaczeniem", async ({ page }) => {
  await page.goto(`${ORIGIN}/manual/?lang=pl`, { waitUntil: "domcontentloaded" });
  const input = page.locator("#manualSearch .searchText");
  await input.fill("kradzież");
  await expect(page.locator("#manualSearch .m-search-hit").first()).toBeVisible();
  await input.press("Enter");
  await expect(page).toHaveURL(/[?&]ch=\d+#s-[\d-]+$/);
  await expect(page.locator(".m-doc mark.m-hit").first()).toBeInViewport();

  await input.fill("qqzzxx");
  await expect(page.locator("#manualSearch .empty-state")).toBeVisible();
  await page.locator("#manualSearch .searchClear").click();
  await expect(page.locator("#manualSearch .m-search-results")).toBeHidden();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#manualSearchToggle").click();
  await expect(input).toBeFocused();
  await input.fill("mnożnik");
  await page.locator("#manualSearch .m-search-hit").first().click();
  await expect(page.locator("#manualToc")).toBeHidden();
  await expect(page.locator(".m-doc mark.m-hit").first()).toBeInViewport();
});

test("manual: nazwa strony prowadzi do serwisu, „←” wraca do tego samego podrozdziału", async ({ page, context, accounts, loginAs }) => {
  await serveBranchCode(context, { pages: ["privacy", "manual", "bases"] });
  await loginAs(page, context, accounts.standard[0]);
  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=12#s-12-2`, { waitUntil: "domcontentloaded" });
  await page.locator('#s-12-2 ~ * a.m-go[data-page="bases"]').first().click();
  await page.waitForURL(/\/bases\/\?ret=/);
  await expect(page.locator(".topbar.topbar-ready")).toBeAttached();
  await expect(page.locator("#btnBack")).toContainText("Wskazówki");
  await page.locator("#btnBack").click();
  await page.waitForURL(/\/manual\/\?ch=12#s-12-2$/);
  await expect(page.locator("#s-12-2")).toBeInViewport();
});

test("manual: przycisk na logowaniu otwiera rozdział o koncie, „←” wraca na logowanie", async ({ page, context }) => {
  await serveBranchCode(context, { pages: ["privacy", "manual", "login"] });
  // HTML logowania zwykle idzie z Workera (Turnstile); tu bez logowania — bierzemy go z brancha.
  if (process.env.TEST_BRANCH_CODE !== "0") await context.route(/^https:\/\/www\.familijna\.app\/login\/?(?:\?.*)?$/, serveBranchLoginHtml);
  await page.goto(`${ORIGIN}/login/?lang=en`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#btnManual")).toHaveAttribute("href", /^\/manual\/\?ch=5&ret=%2Flogin%2F&lang=en$/);
  // „i” po prawej, potem przycisk wyglądu i języka (jak sekcja 3 topbara stron aplikacji;
  // przycisk wyglądu od 2026-11-03, jasny-motyw-plan.md).
  await expect(page.locator(".login-top-right #btnManual + .theme-switcher + .lang-switcher .lang-btn")).toBeVisible();
  const [info, theme, lang] = await Promise.all([page.locator("#btnManual").boundingBox(), page.locator(".theme-btn").boundingBox(), page.locator(".lang-btn").boundingBox()]);
  expect(Math.round(theme.x - (info.x + info.width))).toBe(8);
  expect(Math.round(lang.x - (theme.x + theme.width))).toBe(8);
  expect(Math.round(info.y)).toBe(Math.round(lang.y));
  expect(info.x).toBeGreaterThan(page.viewportSize().width / 2);
  await page.locator("#btnManual").click();
  await page.waitForURL(/\/manual\/\?ch=5/);
  await expect(page.locator(".m-article h1")).toBeVisible();
  await page.locator("#btnBack").click();
  await page.waitForURL(/\/login\/\?lang=en$/);
});

test("manual: zrzuty — karuzela widoków (strzałki, kropki) i powiększenie", async ({ page }) => {
  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=17#s-17-3`, { waitUntil: "domcontentloaded" });
  const carousel = page.locator("#s-17-3 ~ .m-carousel").first();
  const dots = carousel.locator(".m-carousel-dot");
  await expect(dots.first()).toBeVisible();
  const n = await dots.count();
  expect(n).toBeGreaterThanOrEqual(3);
  await expect(dots.nth(0)).toHaveClass(/active/);
  await carousel.locator('[data-step="1"]').click();
  await expect(dots.nth(1)).toHaveClass(/active/);
  await dots.nth(n - 1).click();
  await expect(dots.nth(n - 1)).toHaveClass(/active/);
  // Zrzut ma wersję ciemną i jasną (jasny-motyw-plan.md) — sprawdzamy widoczną.
  await expect.poll(() => carousel.locator(".m-shot").nth(n - 1).locator("img:visible").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  await carousel.locator(".m-shot-zoom").nth(n - 1).click();
  await expect(page.locator("#imgvOverlay.is-open .imgv-img")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#imgvOverlay")).toBeHidden();
});

test("manual: telefon — przesunięcie palcem zmienia widok karuzeli, nie otwiera podglądu", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["privacy", "manual"] });
    const page = await context.newPage();
    // Bez kotwicy w adresie: przewinięcie do podrozdziału przy wczytywaniu zrzutów nie rusza strony w trakcie gestu.
    await page.goto(`${ORIGIN}/manual/?lang=pl&ch=17`, { waitUntil: "domcontentloaded" });
    const carousel = page.locator("#s-17-3 ~ .m-carousel").first();
    const dots = carousel.locator(".m-carousel-dot");
    await carousel.scrollIntoViewIfNeeded();
    await expect.poll(() => carousel.locator("img").first().evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await expect(dots.nth(0)).toHaveClass(/active/);
    await touchSwipe(page, carousel.locator(".m-carousel-track"), { dx: -180 });
    await expect(dots.nth(1)).toHaveClass(/active/);
    await touchSwipe(page, carousel.locator(".m-carousel-track"), { dx: 180 });
    await expect(dots.nth(0)).toHaveClass(/active/);
    await expect(page.locator("#imgvOverlay.is-open")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("manual: telefon — „Spis treści” działa od razu, także gdy treść jeszcze się wczytuje", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Opóźniona treść Wskazówek: kliknięcie w trakcie wczytywania nie może przepaść ani zostać cofnięte.
  await page.route(/\/manual\/content\/pl\.js/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.fallback(); });
  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=17`, { waitUntil: "domcontentloaded" });
  await page.locator("#manualTocToggle").click();
  await expect(page.locator("#manualToc")).toBeVisible();
  await expect(page.locator("#manualToc a.m-side-item").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#manualToc")).toBeVisible();
});

test("manual: wyszukiwanie wpisane w trakcie wczytywania treści dostaje wyniki po wczytaniu", async ({ page }) => {
  await page.route(/\/manual\/content\/pl\.js/, async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.fallback(); });
  await page.goto(`${ORIGIN}/manual/?lang=pl`, { waitUntil: "domcontentloaded" });
  const input = page.locator("#manualSearch .searchText");
  await input.fill("kradzież");
  await expect(page.locator("#manualSearch .m-search-hit").first()).toBeVisible({ timeout: 15_000 });
});

test("manual: telefon — podgląd zrzutu: pole przybliżania wypełnia okno, obraz mieści się w ekranie", async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["privacy", "manual"] });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/manual/?lang=pl&ch=6`, { waitUntil: "domcontentloaded" });
    // Treść SSR jest czytelna wcześniej; powiększanie wymaga gotowego JS.
    await expect(page.locator("html")).toHaveAttribute("data-manual-ready", "true");
    const shot = page.locator(".m-shot-zoom").first();
    await shot.scrollIntoViewIfNeeded();
    await shot.click();
    await expect(page.locator("#imgvOverlay.is-open .imgv-img")).toBeVisible();
    const r = await page.evaluate(() => {
      const box = (s) => document.querySelector(s).getBoundingClientRect();
      return { vw: innerWidth, stage: box("#imgvStage"), zoom: box(".imgv-zoom"), img: box(".imgv-img") };
    });
    expect(r.zoom.height).toBeGreaterThan(r.stage.height - 2);
    expect(r.zoom.height).toBeGreaterThan(400);
    expect(r.img.left).toBeGreaterThanOrEqual(-1);
    expect(r.img.right).toBeLessThanOrEqual(r.vw + 1);
  } finally {
    await context.close();
  }
});

test("manual: telefon — „Wróć do: …” w pasku ze „Spis treści” po odnośniku w treści", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${ORIGIN}/manual/?lang=pl&ch=6`, { waitUntil: "domcontentloaded" });
  await manualReady(page);
  await page.locator('.m-doc a.m-ref[href*="ch=7"][href$="#s-7-1"]').first().click();
  await expect(page.locator(".m-article h1")).toContainText("Tworzenie i edycja gry");
  const back = page.locator("#manualReturnBar");
  await expect(back).toBeVisible();
  await expect(back).toContainText("Wróć do:");
  await expect(page.locator(".m-return-bar")).toBeHidden();
  await back.click();
  await expect(page.locator(".m-article h1")).toContainText("Moje gry");
  await expect(back).toBeHidden();
});

test("manual: podzielony ekran tabletu — Wskazówki działają, nakładka blokady ma wspólny styl", async ({ browser }) => {
  // iPad w poziomie, połowa ekranu: strona bez progu szerokości nie jest blokowana.
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 590, height: 820 }, screen: { width: 1180, height: 820 }, serviceWorkers: "block" });
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(context, { pages: ["manual"] });
  const page = await context.newPage();
  try {
    await page.goto(`${ORIGIN}/manual/?ch=6`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".m-doc .m-h2").first()).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-device-guard", "ok");
    await expect(page.locator("#pageGuard")).toHaveCount(0);
    // Strona z progiem (np. wąż 640 px) w tym samym widoku dostaje „Za wąskie okno”, ze stylem.
    const state = await page.evaluate(async () => {
      const m = await import("/shared/js/core/device-guard.js");
      const s = m.deviceGuardState(640);
      m.showDeviceGuard(s, "/");
      return s;
    });
    expect(state).toBe("narrow");
    const overlay = page.locator("#pageGuard.blocking-overlay");
    await expect(overlay).toBeVisible();
    expect(await overlay.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
  } finally {
    await context.close();
  }
});

test("manual: podgląd zrzutu — na komputerze cały obraz w oknie i przybliżanie myszą, na tablecie palcami", async ({ browser }) => {
  const open = async (page) => {
    await page.goto(`${ORIGIN}/manual/?lang=pl&ch=6#s-6-1`, { waitUntil: "domcontentloaded" });
    await manualReady(page);
    const shot = page.locator(".m-shot-zoom").first();
    await expect.poll(() => shot.locator("img:visible").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
    await shot.click();
    await expect(page.locator("#imgvOverlay.is-open .imgv-zoom .imgv-img")).toBeVisible();
    await page.waitForTimeout(400);
  };
  // Komputer, okno 1440×760: obraz w całości wewnątrz okna podglądu i ekranu.
  const desk = await browser.newContext({ viewport: { width: 1440, height: 760 }, serviceWorkers: "block" });
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(desk, { pages: ["manual"] });
  const page = await desk.newPage();
  try {
    await open(page);
    const box = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { zoom: r("#imgvOverlay .imgv-zoom"), panel: r("#imgvOverlay .imgv-panel"), h: innerHeight };
    });
    expect(box.zoom.bottom).toBeLessThanOrEqual(box.panel.bottom + 1);
    expect(box.panel.bottom).toBeLessThanOrEqual(box.h);
    expect(box.zoom.height).toBeGreaterThan(300);
    // Mysz: kółko przybliża, podwójne kliknięcie wraca do całości.
    const img = page.locator("#imgvOverlay .imgv-img");
    const scaleOf = () => img.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
    await page.mouse.move(box.zoom.x + box.zoom.width / 2, box.zoom.y + box.zoom.height / 2);
    await page.mouse.wheel(0, -400);
    await expect.poll(scaleOf).toBeGreaterThan(1.2);
    await page.mouse.dblclick(box.zoom.x + box.zoom.width / 2, box.zoom.y + box.zoom.height / 2);
    await expect.poll(scaleOf).toBe(1);
  } finally { await desk.close(); }
  // Tablet w poziomie (dotyk): okno od dołu z polem przybliżania palcami.
  const tab = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
  if (process.env.TEST_BRANCH_CODE !== "0") await serveBranchCode(tab, { pages: ["manual"] });
  const tpage = await tab.newPage();
  try {
    await open(tpage);
    await expect(tpage.locator("#imgvOverlay")).toHaveClass(/sheet-active/);
    expect(await tpage.locator("#imgvOverlay .imgv-zoom").evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
  } finally { await tab.close(); }
});
