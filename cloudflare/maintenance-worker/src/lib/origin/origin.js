// src/lib/origin.js -- pliki strony z Workers Static Assets (binding ASSETS,
// wrangler.toml [assets]), strony przerwy i 404, klasyfikacja hostów i ścieżek.
import { withHeaders } from "../core/http.js";
import { isScreenshotId } from "../../../../../web/shared/js/core/poll-links.js";

// Adres bazowy plików strony; z bindingu ASSETS liczy się tylko ścieżka.
export const ORIGIN_BASE = "https://www.familijna.app";

// Binding jest stały dla wdrożenia, więc wystarczy go zapamiętać na początku
// każdego wywołania (fetch/email/scheduled) — wszystkie pobrania plików strony
// przechodzą przez fetchWithOrigin() niżej.
let staticAssets = null;
export function bindStaticAssets(env) {
  staticAssets = env?.ASSETS && typeof env.ASSETS.fetch === "function" ? env.ASSETS : null;
}

// html_handling = "none" serwuje dokładne pliki; katalog (ścieżka z „/” na
// końcu) dostaje index.html.
function assetRequest(url, request) {
  const target = new URL(url);
  if (target.pathname.endsWith("/")) target.pathname += "index.html";
  return new Request(target.toString(), { method: request.method || "GET", headers: request.headers, redirect: "manual" });
}

export async function serveMaintenance(request, originBase) {
  const maintUrl = new URL("/maintenance/index.html", originBase);
  const res = await fetchWithOrigin(maintUrl.toString(), request);

  return new Response(res.body, {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "300"
    }
  });
}

export async function serveNotFoundPage(request, originBase) {
  const notFoundUrl = new URL("/404.html", originBase);
  const res = await fetchWithOrigin(notFoundUrl.toString(), request);

  const base = new Response(res.body, {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, follow"
    }
  });

  return withHeaders(base, {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.familijna.app",
    "X-Content-Type-Options": "nosniff"
  });
}

export const KNOWN_HOSTS = [
  "familijna.app",
  "www.familijna.app",
  "admin.familijna.app",
  "panel.familijna.app",
  "supabase.familijna.app",
  "api.familijna.app",
];

const BLOCKED_PATHS = [
  {
    hosts: ["familijna.app", "www.familijna.app"],
    paths: ["/admin", "/admin/", "/admin.html", "/tools", "/tools/", "/admin-tools", "/admin-tools/"],
  },
];

// Ukryta gra w węża otwiera się tylko z linku z kodu QR na kadrze strony
// głównej (/go/ przekierowuje na /snake/?qr=<id demo>); bez niego -- 404.
const SNAKE_PAGES = ["/snake", "/snake/", "/snake/index.html"];
export function isLockedSnake(url) {
  return SNAKE_PAGES.includes(url.pathname) && !isScreenshotId(url.searchParams.get("qr"));
}

// Przeprowadzka domeny (plan rebrandingu): stare adresy usług do 2027-12-31
// przechodzą do serwera bez zmian (linki z maili, otwarte karty, panel admina
// na admin.familiada.online). Strony starej domeny obsługuje
// cloudflare/legacy-domain-worker; usunąć razem z nim.
export const LEGACY_SERVICE_HOSTS = [
  "api.familiada.online", "supabase.familiada.online", "panel.familiada.online", "docker.familiada.online",
];

export function isKnownHost(host) {
  return KNOWN_HOSTS.includes(host);
}

export function isBlockedPath(host, pathname) {
  for (const rule of BLOCKED_PATHS) {
    if (!rule.hosts.includes(host)) continue;
    if (rule.paths.includes(pathname)) return true;
    if (pathname.startsWith("/tools/")) return true;
    if (pathname.startsWith("/admin-tools/") || pathname.startsWith("/admin/")) return true;
  }
  return false;
}

export function fetchFromOrigin(request, url, originBase) {
  const isTvConnect = ["/connect", "/connect/", "/connect/index.html"].includes(url.pathname)
    && url.searchParams.get("tv") === "1";
  const targetPath = isTvConnect ? "/connect/tv/index.html" : pageIndexPath(url.pathname);
  const target = new URL(targetPath + url.search, originBase);
  return fetchWithOrigin(target.toString(), request);
}

const PAGE_ROUTES = new Set([
  "account", "bases", "bases/explorer",
  "connect", "connect/ai", "connect/tv", "control", "control/buzzer", "control/display", "control/host",
  "games", "games/editor", "games/settings", "login", "login/confirm", "login/reset",
  "logos", "logos/editor/draw", "logos/editor/image", "logos/editor/text",
  "maintenance", "manual", "marketplace", "go", "mails", "snake",
  "polls", "polls/vote/points", "polls/vote/qr", "polls/vote/text",
  "privacy", "friends", "subscribers", "tasks",
]);

export function isKnownPagePath(pathname) {
  if (pathname === "/" || pathname === "/index.html") return true;
  const route = String(pathname || "")
    .replace(/^\/+/, "")
    .replace(/\/index\.html$/, "")
    .replace(/\/$/, "");
  return PAGE_ROUTES.has(route) || route.startsWith("marketplace/game/");
}

export function pageIndexPath(pathname) {
  if (pathname === "/") return "/index.html";
  const route = pathname.replace(/^\//, "").replace(/\/$/, "");
  return PAGE_ROUTES.has(route) ? `/${route}/index.html` : pathname;
}

export async function fetchWith404(request, originBase) {
  const url = new URL(request.url);
  if (url.pathname === "/404.html") {
    return serveNotFoundPage(request, originBase);
  }
  const originStart = Date.now();
  const res = await fetchFromOrigin(request, url, originBase);
  const originMs = Date.now() - originStart;
  if (res.status >= 300 && res.status < 400) return res;
  if (res.status !== 404) {
    // HTML bez no-store = cache w przeglądarce → stale wersje
    const ct = res.headers.get("Content-Type") || "";
    if (ct.includes("text/html")) {
      return new Response(res.body, {
        status: res.status,
        headers: {
          "Content-Type": ct,
          "Cache-Control": "no-store",
          // Czas pobrania pliku strony (ASSETS) — pomiar TTFB, 2026-11-05.
          "Server-Timing": `origin;dur=${originMs}`,
          ...(["/maintenance", "/maintenance/", "/maintenance/index.html"].includes(url.pathname)
            ? { "X-Robots-Tag": "noindex, follow" } : {}),
        }
      });
    }
    return res;
  }

  // Brakujący adres dostaje stronę 404 niezależnie od nagłówka Accept
  // (ASSETS z not_found_handling "none" oddaje puste 404).
  return serveNotFoundPage(request, originBase);
}

export async function fetchWithOrigin(url, request, opts = {}) {
  if (!staticAssets) throw new Error("Brak bindingu ASSETS (wrangler.toml [assets])");
  const res = await staticAssets.fetch(assetRequest(url, request));
  const headers = request.headers;

  // Preserve origin redirects, including Location, rather than returning
  // their HTML body without a destination.
  if (res.status >= 300 && res.status < 400 && res.headers.has("Location")) {
    return withHeaders(res, { "Cache-Control": "no-store" });
  }

  const ct = res.headers.get("Content-Type") || "";
  const accept = headers.get("Accept") || "";

  // Wywołane wyłącznie przez serveStaticAsset(): odwrotność reszty tej
  // funkcji, która celowo wymusza no-store na WSZYSTKICH innych odpowiedziach
  // (łącznie z tymi samymi rozszerzeniami niżej) - HTML z bramki maintenance,
  // odpowiedzi SSR itd. muszą zostać świeże. Tylko ta jedna ścieżka wie, że
  // serwuje coś, co faktycznie wolno cache'ować.
  if (opts.staticAsset && res.status === 200) {
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": ct, "Cache-Control": opts.cacheControl || "public, max-age=600" }
    });
  }

  if (ct.includes("text/html") || accept.includes("text/html")) {
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store"
      }
    });
  }

  const pathname = new URL(url).pathname;
  if (
    ct.includes("application/javascript") ||
    ct.includes("text/css") ||
    ct.includes("application/json") ||
    pathname.match(/\.(js|css|json|woff2?|ttf|otf|webp|avif|ico|png|jpg|jpeg|gif|svg)$/i)
  ) {
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": ct,
        "Cache-Control": "no-store"
      }
    });
  }

  return res;
}
