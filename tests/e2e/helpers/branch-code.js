// tests/e2e/helpers/branch-code.js
// "Kopia" strony do testów bez wdrażania: prawdziwa produkcja (konta testowe,
// prawdziwa baza, Worker, Turnstile-bypass), ale wybrane strony oraz CAŁY
// kod front-endu (js/, css/, translation/, web/js/gameplay/, base-explorer/) serwowane z plików tego
// repo -- czyli z brancha, na którym odpalono workflow. Dzięki temu poprawki
// można sprawdzić na prawdziwym backendzie ZANIM trafią na main/produkcję.
//
// Strona logowania zawsze idzie z produkcji (Worker podmienia w niej sitekey
// Turnstile dla tokenu e2e -- patrz tests/README.md), stąd jawna lista stron.
// Service worker musi być zablokowany (test.use({ serviceWorkers: "block" })),
// inaczej obsłużyłby żądania z własnego cache z pominięciem page.route.

const fs = require("fs");
const path = require("path");

// CI gałęzi serwuje dokładnie minifikowany artefakt przeznaczony do publikacji.
const REPO_ROOT = process.env.E2E_WEB_ROOT ? path.resolve(process.env.E2E_WEB_ROOT) : path.resolve(__dirname, "..", "..", "..", "web");
const PROD_ORIGIN = "https://www.familijna.app";
// Próba generalna przeprowadzki serwera: E2E_API_ORIGIN (np.
// https://api2.familiada.online) podmienia adres API w kodzie z brancha.
const PROD_API_ORIGIN = "https://api.familijna.app";
const API_ORIGIN = (process.env.E2E_API_ORIGIN || "").replace(/\/+$/, "");
// base-explorer/ -- JS i CSS bazy pytań leżą obok strony, nie w js/ i css/
const CODE_DIRS = ["login/", "shared/", "assets/", "home/", "games/", "bases/", "account/", "marketplace/", "polls/", "friends/", "subscribers/", "tasks/", "connect/", "control/", "logo/", "logos/", "manual/", "privacy/", "go/", "mail/", "mails/", "maintenance/", "404/", "snake/"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
};

function localFileFor(pathname, pages, { productionHtml = false } = {}) {
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  if (rel === "404.html" && pages.includes("404")) return path.join(REPO_ROOT, "404.html");
  // Strona główna jest serwowana pod "/", a nie "/index". Bez tego
  // pages:["index"] cicho testowało produkcyjny HTML zamiast pliku z brancha.
  if (!rel && pages.includes("index")) return path.join(REPO_ROOT, "index.html");
  // Główne HTML logowania zwykle zostaje po stronie Workera ze względu na
  // Turnstile; galeria E20 przechwytuje je jawnie. Strony potwierdzenia i
  // resetu nie korzystają z Turnstile, więc bierzemy ich HTML z brancha.
  if (rel.startsWith("login/") && !/\.(js|css)$/.test(rel)) {
    const loginPage = rel.replace(/\/$/, "");
    if (loginPage !== "login" && pages.includes(loginPage)) return path.join(REPO_ROOT, `${loginPage}/index.html`);
    return null;
  }
  const page = rel.replace(/\.html$/, "").replace(/\/$/, "");
  if (pages.includes(page)) return path.join(REPO_ROOT, `${page}/index.html`);
  // Trasy typu /marketplace/game/<slug> są obsługiwane przez tę samą stronę
  // SPA. Bez tego deep-link w teście brał HTML produkcyjny zamiast z brancha.
  // Najpierw prawdziwy plik z repo (np. /subscriptions/js/subscriptions.js):
  // bez tego reguła trasy SPA niżej oddawała HTML strony zamiast skryptu
  // strony leżącego w jej folderze („Failed to load module script”).
  if (CODE_DIRS.some((d) => rel.startsWith(d))) {
    const abs = path.join(REPO_ROOT, rel);
    if (abs.startsWith(REPO_ROOT + path.sep) && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
    // Nested page folders such as /logos/editor/draw/ have their own
    // index.html. Resolve that before the SPA fallback to /logos/index.html.
    // productionHtml: HTML stron zawsze z produkcji (Worker wybiera stronę po
    // UA, np. /connect/ dla telewizora to strona TV) — tv.spec.
    if (productionHtml) return null;
    const nestedIndex = path.join(REPO_ROOT, rel, "index.html");
    if (nestedIndex.startsWith(REPO_ROOT + path.sep) && fs.existsSync(nestedIndex) && fs.statSync(nestedIndex).isFile()) return nestedIndex;
  }
  const routedPage = pages.find((name) => rel.startsWith(`${name}/`));
  if (routedPage) return path.join(REPO_ROOT, `${routedPage}/index.html`);
  return null;
}

// Adres strony -> zawartość <meta name="i18n-parts"> z HTML brancha.
function branchI18nParts() {
  const out = {};
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (!["img", "audio", "fonts", "vendor"].includes(ent.name)) walk(full); continue; }
      if (!ent.name.endsWith(".html")) continue;
      const meta = /<meta name="i18n-parts" content="([^"]*)">/.exec(fs.readFileSync(full, "utf8"));
      if (!meta) continue;
      const rel = path.relative(REPO_ROOT, full).split(path.sep).join("/");
      out[rel.endsWith("index.html") ? `/${rel.slice(0, -"index.html".length)}` : `/${rel}`] = meta[1];
    }
  };
  walk(REPO_ROOT);
  return out;
}

/**
 * @param {import('@playwright/test').BrowserContext} context
 * @param {{ pages: string[], productionHtml?: boolean }} opts  np. { pages: ["bases"] } -> /bases z repo;
 *   productionHtml: katalogi stron (…/) bez index.html z repo — HTML wybiera Worker
 */
async function serveBranchCode(context, { pages, safeAreaInsets = null, productionHtml = false }) {
  if (context) context.__e2eBranchRouted = true;
  if (safeAreaInsets) {
    await context.addInitScript((insets) => {
      const applyInsets = () => {
        const root = document.documentElement;
        if (!root) return;
        for (const side of ["top", "right", "bottom", "left"]) {
          root.style.setProperty(`--e20-safe-area-inset-${side}`, `${Number(insets[side]) || 0}px`);
        }
        root.dataset.e20SafeAreaInjected = "true";
      };
      if (document.documentElement) applyInsets();
      else document.addEventListener("DOMContentLoaded", applyInsets, { once: true });
    }, safeAreaInsets);
  }
  // HTML z produkcji (logowanie, strony spoza `pages`) przy translation.js
  // z brancha: bez meta i18n-parts strona wczytałaby tylko część wspólną
  // słownika (familijna-server/docs/tlumaczenia-podzial-plan.md). Meta z HTML brancha trafia
  // do <head> zanim wykonają się moduły strony.
  await context.addInitScript((partsByPath) => {
    const key = location.pathname.endsWith("/") || location.pathname.endsWith(".html") ? location.pathname : `${location.pathname}/`;
    const content = partsByPath[key];
    if (content == null || location.origin !== "https://www.familijna.app") return;
    const add = () => {
      if (!document.head || document.head.querySelector('meta[name="i18n-parts"]')) return false;
      const meta = document.createElement("meta");
      meta.name = "i18n-parts";
      meta.content = content;
      document.head.prepend(meta);
      return true;
    };
    const observer = new MutationObserver(() => { if (document.head) { add(); observer.disconnect(); } });
    observer.observe(document, { childList: true, subtree: true });
  }, branchI18nParts());
  await context.route(`${PROD_ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    const file = localFileFor(url.pathname, pages, { productionHtml });
    // Pozwól kolejnym handlerom Playwrighta dodać np. kontrolowany bypass
    // konserwacji dla testu; bez nich fallback zachowuje zwykłe żądanie sieciowe.
    if (!file) {
      // Próba generalna: strony z produkcji (np. logowanie przez Workera) mają
      // CSP z connect-src tylko na api.familijna.app — podmieniamy adres API.
      if (API_ORIGIN && API_ORIGIN !== PROD_API_ORIGIN && route.request().resourceType?.() === "document") {
        // maxRedirects 0: przekierowanie Workera (np. TV z „/” na /connect/?tv=1)
        // ma zmienić adres w przeglądarce, a nie podać treść pod starym adresem.
        const response = await route.fetch({ headers: await route.request().allHeaders(), maxRedirects: 0 });
        if (response.status() >= 300 && response.status() < 400) return route.fulfill({ response });
        const apiHost = new URL(API_ORIGIN).host;
        const swap = (value) => String(value).split("api.familijna.app").join(apiHost);
        const headers = Object.fromEntries(Object.entries(response.headers()).map(([k, v]) => [k, /content-security-policy/i.test(k) ? swap(v) : v]));
        delete headers["content-encoding"];
        delete headers["content-length"];
        return route.fulfill({ response, headers, body: swap(await response.text()) });
      }
      return route.fallback();
    }
    let body = fs.readFileSync(file);
    if (API_ORIGIN && API_ORIGIN !== PROD_API_ORIGIN && [".js", ".html"].includes(path.extname(file))) {
      body = body.toString("utf8").split(PROD_API_ORIGIN).join(API_ORIGIN);
    }
    if (safeAreaInsets && path.extname(file) === ".css") {
      body = body.toString("utf8").replace(/env\(\s*safe-area-inset-(top|right|bottom|left)(?:\s*,\s*[^)]+)?\s*\)/g,
        (_match, side) => `var(--e20-safe-area-inset-${side}, 0px)`);
    }
    return route.fulfill({
      status: 200,
      contentType: MIME[path.extname(file)] || "application/octet-stream",
      headers: { "cache-control": "no-store" },
      body,
    });
  });
}

async function serveBranchLoginHtml(route) {
  let productionResponse;
  let testSiteKey = "";
  // route.fetch() does not reliably inherit browser context extra headers.
  // Forward the actual navigation headers so the Worker can validate the
  // one-time E2E bypass token and inject the Turnstile test key.
  const requestHeaders = await route.request().allHeaders();
  for (let attempt = 1; attempt <= 7; attempt++) {
    productionResponse = await route.fetch({ headers: requestHeaders });
    const productionHtml = await productionResponse.text();
    testSiteKey = productionHtml.match(/data-captcha-site-key="([^"]*)"/)?.[1] || "";
    if (testSiteKey) break;
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  if (!testSiteKey) {
    throw new Error(`Worker nie zwrócił testowego klucza Turnstile dla sesji E2E po 7 próbach (HTTP ${productionResponse?.status?.() ?? "brak odpowiedzi"})`);
  }
  const file = path.join(REPO_ROOT, "login", "index.html");
  const html = fs.readFileSync(file, "utf8").replace(/data-captcha-site-key="[^"]*"/, `data-captcha-site-key="${testSiteKey}"`);
  await route.fulfill({ response: productionResponse, headers: { "cache-control": "no-store" }, body: html });
}

// Próba generalna: kontekst, który test otworzył bez serveBranchCode (np. drugi
// użytkownik z browser.newContext()), też musi mówić z API_ORIGIN.
async function ensureApiOriginRouting(context) {
  if (!API_ORIGIN || API_ORIGIN === PROD_API_ORIGIN || !context || context.__e2eBranchRouted) return;
  await serveBranchCode(context, { pages: [] });
}

module.exports = { serveBranchCode, serveBranchLoginHtml, localFileFor, ensureApiOriginRouting };
