const { test, expect } = require("./helpers/production-test");
const { generateE2EToken } = require("./helpers/e2e-token");
const productionGet = (request, url) => request.get(url, {headers:{"X-E2E-Token":generateE2EToken(process.env.E2E_BYPASS_SECRET)}});

// Requests and browser navigation use the deployed production files.
// No route interception or local source replacement.
test("refaktor: strony i ich bezpośrednie zasoby działają na produkcji", async ({ request }) => {
  for (const route of ["/", "/games/", "/games/settings/", "/control/", "/control/display/", "/control/host/", "/control/buzzer/", "/bases/", "/logos/", "/logos/editor/draw/", "/connect/"]) {
    const response = await productionGet(request,route);
    expect(response.status(), route).toBe(200);
    const html = await response.text();
    expect(response.headers()["content-type"], route).toContain("text/html");
    const urls = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], response.url()))
      .filter((url) => url.origin === new URL(response.url()).origin && /\.(?:js|css|png|svg|ico|woff2)(?:$)/.test(url.pathname));
    for (const url of urls) {
      const asset = await productionGet(request,url.href);
      expect(asset.status(), `${route}: ${url.pathname}`).toBe(200);
      expect(asset.headers()["content-type"], url.pathname).not.toContain("text/html");
    }
  }
});

test("refaktor: domyślne logo, fonty, tłumaczenia i outro są dostępne", async ({ request }) => {
  for (const path of ["/shared/data/logo_familijna.json", "/shared/fonts/display/font_5x7.json", "/shared/fonts/display/font_3x10.json", "/shared/fonts/display/font_win.json", "/shared/data/sounds.json", "/shared/themes/index.json"]) {
    const response = await productionGet(request,path);
    expect(response.status(), path).toBe(200);
    expect(await response.json(), path).toBeTruthy();
  }
  for (const path of ["/shared/translation/pl/common.js", "/shared/translation/en/common.js", "/shared/translation/uk/common.js", "/shared/fonts/unbounded.woff2", "/assets/audio/show_outro/classic.mp3"]) {
    const response = await productionGet(request,path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()["content-type"], path).not.toContain("text/html");
    expect((await response.body()).length, path).toBeGreaterThan(100);
  }
});

test("refaktor: strona główna uruchamia moduły z nowych ścieżek", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (/\.(?:js|css)(?:\?|$)/.test(response.url()) && response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator('script[src*="home/js/index.js"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});
