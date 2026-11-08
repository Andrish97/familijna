// E24 R12: ścisła CSP Workera (bez 'unsafe-inline'/'unsafe-eval') na kluczowych
// stronach — przed zdjęciem nadpisującej reguły strefy Cloudflare. Polityka
// liczona tym samym kodem co w Workerze (security-headers.js) i nakładana na
// dokument strony; każde naruszenie (securitypolicyviolation) = błąd testu.
const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("./helpers/e2e-test");

const WWW = "https://www.familijna.app";
test.use({ serviceWorkers: "block", needs: { standard: 1 } });

async function strictPolicy() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "..", "cloudflare", "maintenance-worker", "src", "lib", "core", "security-headers.js")).href);
  const res = mod.withSecurityHeaders(new Request(`${WWW}/games/`), new Response("<p></p>", { headers: { "Content-Type": "text/html" } }));
  return res.headers.get("Content-Security-Policy");
}

async function enforce(context, policy) {
  await context.addInitScript(() => {
    window.__cspv = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspv.push(`${e.effectiveDirective} ${e.blockedURI || "inline"} ${e.sourceFile || ""}:${e.lineNumber || ""}`);
    });
  });
  await context.route("**/*", async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    if (req.resourceType() !== "document" || u.hostname !== "www.familijna.app") return route.fallback();
    const resp = await route.fetch();
    const headers = { ...resp.headers(), "content-security-policy": policy };
    return route.fulfill({ response: resp, headers });
  });
}

async function visit(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const v = await page.evaluate(() => window.__cspv || []);
  console.log(`[e2e-diag] csp ${url} -> ${v.length}${v.length ? " " + v.join(" | ") : ""}`);
  return v;
}

test("E24 R12: ścisła CSP — strony publiczne bez naruszeń", async ({ page, context }) => {
  test.setTimeout(180000);
  const policy = await strictPolicy();
  expect(policy).not.toContain("unsafe-inline");
  await enforce(context, policy);
  const all = [];
  for (const p of ["/", "/login/", "/manual/", "/marketplace/", "/privacy/"]) all.push(...await visit(page, WWW + p));
  expect(all).toEqual([]);
});

test("E24 R12: ścisła CSP — strony po zalogowaniu bez naruszeń", async ({ page, context, accounts, loginAs }) => {
  test.setTimeout(240000);
  const policy = await strictPolicy();
  await loginAs(page, context, accounts.standard[0]);
  await enforce(context, policy);
  const all = [];
  for (const p of ["/games/", "/bases/", "/logos/", "/account/", "/polls/", "/control/", "/friends/"]) all.push(...await visit(page, WWW + p));
  expect(all).toEqual([]);
});

test("E24 R12: nagłówek CSP produkcji (diagnostyka: czy reguła strefy nadpisuje Workera)", async ({ request }) => {
  const res = await request.get(`${WWW}/games/`, { headers: { Accept: "text/html" } });
  const csp = res.headers()["content-security-policy"] || "";
  const script = csp.split(";").map((p) => p.trim()).find((p) => p.startsWith("script-src")) || "";
  console.log(`[e2e-diag] csp prod: frame-ancestors=${csp.includes("frame-ancestors")} unsafe-inline=${script.includes("unsafe-inline")} hashes=${(script.match(/sha256-/g) || []).length} jsdelivr=${script.includes("jsdelivr")}`);
  expect(res.status()).toBe(200);
});
