// See cloudflare/README.md for full behavior and checklist.
//
// This file is the thin router/entry point only -- all actual logic lives in
// src/lib/*.js, split by functionality (admin APIs, mail, contact form,
// inbound email/MIME parsing, SSR, E2E test bypass, Supabase client, origin
// proxying, etc). This split is purely mechanical (every line of logic moved
// verbatim into its new file, nothing rewritten) -- see git history for the
// single-file version if something here looks surprising.
import { handleResourceDuplicate, handleResourceSend } from "./lib/resource-copy/api.js";
import { parseGoLink } from "../../../web/shared/js/core/go-contract.js";
import { handleMailCenterApi } from "./lib/mail-center/api.js";
import { handleInboundEmail } from "./lib/email/inbound-email.js";
import { cleanupExpiredAttachments, cleanupExpiredE2EEmails, cleanupMailCenter } from "./lib/core/cleanup.js";
import { handleE2EApi, handleE2ELoginBypass, authorizeE2EApi } from "./lib/e2e/e2e-api.js";
import { getState } from "./lib/core/state.js";
import { json, withHeaders } from "./lib/core/http.js";
import {
  ORIGIN_BASE,
  ORIGIN_HOST,
  ORIGIN_RESOLVE,
  fetchFromOrigin,
  fetchWith404,
  isKnownHost,
  LEGACY_SERVICE_HOSTS,
  isBlockedPath,
  isLockedSnake,
  serveMaintenance,
  serveNotFoundPage,
} from "./lib/origin/origin.js";
import {
  isStaticAssetPath,
  serveStaticAsset,
  isCommonAsset,
  isMaintenanceAsset,
} from "./lib/origin/assets.js";
import { hasAdminBypass } from "./lib/core/maintenance-bypass.js";
import { handleNotifySubmission } from "./lib/notifications/telegram.js";
import { handleContactAppend, handleContactSubmit } from "./lib/email/contact.js";
import { isBot, serveDynamicSitemap } from "./lib/ssr/ssr.js";
import { tvRedirect } from "./lib/origin/tv.js";
import { withSecurityHeaders, httpsRedirect } from "./lib/core/security-headers.js";
import { isMarketPath, servePublicMarketplace } from "./lib/ssr/marketplace.js";
import { localizeHome } from "./lib/ssr/home.js";
import { localizePublicPage, invalidManualChapter } from "./lib/ssr/public-pages.js";
import { AUTH_ROUTES } from "./lib/auth/auth-api.js";
import { DEVICE_ROUTES } from "./lib/device/connect-code.js";

export default {
  async email(message, env) {
    try {
      await handleInboundEmail(message, env);
    } catch (err) {
      console.error("[email] unhandled error:", err);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      cleanupExpiredAttachments(env),
      cleanupExpiredE2EEmails(env),
      cleanupMailCenter(env),
    ]));
  },

  async fetch(request, env, ctx) {
    // Nagłówki bezpieczeństwa dla stron HTML (audyt E24, N3).
    const redirect = httpsRedirect(request);
    const response = redirect || await handleFetch(request, env, ctx);
    return withSecurityHeaders(request, localizePublicPage(request, localizeHome(request, response)));
  }
};

async function handleFetch(request, env, ctx) {
  const url = new URL(request.url);
  const host = url.host.toLowerCase();
  // Panel ma osobny Worker; tutaj pozostaje jedynie odmowa przy błędnym routingu.
  if (host === "admin.familijna.app") return new Response("Not Found", { status: 404 });
  if (host === "www.familijna.app" || host === "familijna.app") {
    const redirect = tvRedirect(request, url);
    if (redirect) {
      // Jeśli prace techniczne trwają, telewizor ma dostać Maintenance.
      // W pozostałych stanach nadal wymuszamy ekran podłączania TV, również
      // przy aktywnym bypassie administratora.
      if (await hasAdminBypass(request, env)) return redirect;
      const tvState = await getState(env);
      if (!tvState.enabled || tvState.mode === "off") return redirect;
    }
  }

  // Prywatne API testow produkcyjnych. Obslugiwane przed redirectem apex
  // i maintenance gate, ale zawsze wymaga krotkozyjacego tokenu HMAC.
  if (
    (host === "www.familijna.app" || host === "familijna.app") &&
    url.pathname.startsWith("/_e2e_api/")
  ) {
    return handleE2EApi(request, env, url);
  }

  // PUBLIC STATE ENDPOINT (works on every host/subdomain, ignore ?v= cache-busting)
  if (url.pathname === "/maintenance-state.json") {
    const state = await getState(env);
    return json(state);
  }

  // Redirect apex → www (301 permanent, SEO canonical)
  if (host === "familijna.app") {
    return Response.redirect(
      "https://www.familijna.app" + url.pathname + url.search,
      301
    );
  }

  // Known service hosts (no maintenance gate here)
  if (
    host === "panel.familijna.app" ||
    host === "supabase.familijna.app" ||
    host === "api.familijna.app" ||
    host === "docker.familijna.app" ||
    LEGACY_SERVICE_HOSTS.includes(host)
  ) {
    // Pomiar łącza urządzeń (migracja 466): odpowiedź prosto z Cloudflare,
    // bez serwera — porównywana z czasem lekkiego RPC control2_net_ping.
    if ((host === "api.familijna.app" || host === "api.familiada.online") && url.pathname === "/_ping") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
    }
    // NIE dodawaj tu cf.resolveOverride wskazującego z powrotem na ten sam
    // `host` — to nie jest "wymuszenie użycia rekordu DNS", tylko każe
    // temu subrequestowi z Workera ponownie wejść w edge Cloudflare dla
    // TEJ SAMEJ strefy/hosta. panel.familijna.app i
    // supabase.familijna.app mają politykę Cloudflare Access — taki
    // subrequest (bez sesji/ciasteczka logowania) wpada w bramkę Access i
    // origin staje się nieosiągalny (błąd "3 warstwy Cloudflare" widoczny
    // 15.09 po wdrożeniu tej zmiany, cofniętej w tym samym commicie).
    // resolveOverride ma sens tylko gdy wskazuje NA ZEWNĄTRZ strefy (patrz
    // ORIGIN_RESOLVE = "andrish97.github.io" niżej) - żeby ominąć
    // zapętlenie subrequestu w tego samego Workera, nie żeby "użyć DNS".
    return fetch(request);
  }

  // Unknown subdomains: 404 when maintenance OFF, maintenance page when ON
  if (host.endsWith(".familijna.app") && !isKnownHost(host)) {
    if (isCommonAsset(url.pathname)) {
      return fetchFromOrigin(request, url, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
    }
    const state = await getState(env);
    if (!state.enabled || state.mode === "off") {
      return serveNotFoundPage(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
    }
    return serveMaintenance(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // Statyczne assety (dowolny folder, dopasowane po rozszerzeniu, nie po
  // prefiksie ścieżki) — omijają całkowicie GLOBAL GATE i KV. Tu host jest
  // zawsze www.familijna.app: apex zawsze przekierowuje wyżej, a
  // settings/panel/supabase/api/nieznane subdomeny już zwróciły
  // odpowiedź w blokach powyżej. Patrz isStaticAssetPath — jeden wyjątek
  // (/maintenance-state.json) zostaje w normalnej bramce, bo czyta KV.
  if ((request.method === "GET" || request.method === "HEAD") && isStaticAssetPath(url.pathname)) {
    return serveStaticAsset(request, url, ctx, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  if (["GET", "HEAD"].includes(request.method) && invalidManualChapter(url)) {
    return serveNotFoundPage(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // E2E test bypass — tylko strona logowania, tylko z poprawnym jednorazowym
  // tokenem (patrz tests/README.md). Podmienia data-captcha-site-key na
  // oficjalny, zawsze-przechodzący testowy sitekey Turnstile — nic więcej.
  if (
    (host === "www.familijna.app" || host === "familijna.app") &&
    ["/login", "/login/", "/login/index.html"].includes(url.pathname) &&
    request.method === "GET"
  ) {
    const e2eRes = await handleE2ELoginBypass(request, env, url, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
    if (e2eRes) return e2eRes;
  }

  if (url.pathname === "/_api/resource-duplicate") {
    const state = await getState(env);
    if (state.enabled && state.mode !== "off" && !await hasAdminBypass(request, env) && !await authorizeE2EApi(request, env)) {
      return json({ok:false,error:"maintenance"},503);
    }
    const work = handleResourceDuplicate(request, env);
    ctx.waitUntil(work.then(() => undefined));
    return work;
  }

  if (url.pathname === "/_api/resource-send") {
    const state = await getState(env);
    if (state.enabled && state.mode !== "off" && !await hasAdminBypass(request, env) && !await authorizeE2EApi(request, env)) {
      return json({ok:false,error:"maintenance"},503);
    }
    const work = handleResourceSend(request, env);
    ctx.waitUntil(work.then(() => undefined));
    return work;
  }

  if (url.pathname.startsWith("/_api/mail/")) return handleMailCenterApi(request, env);

  // Logowanie/reset po nazwie i stan adresu przy rejestracji (audyt E24, B7/B8).
  // Przed bramką obejścia: z ciasteczkiem obejścia trasa trafiałaby do origin.
  // Kod urządzenia (TV, „Podłącz urządzenie”) z limitem prób -- ta sama reguła przerwy.
  const authRoute = Object.hasOwn(AUTH_ROUTES, url.pathname) ? AUTH_ROUTES[url.pathname]
    : Object.hasOwn(DEVICE_ROUTES, url.pathname) ? DEVICE_ROUTES[url.pathname] : null;
  if (authRoute) {
    const state = await getState(env);
    if (state.enabled && state.mode !== "off" && !await hasAdminBypass(request, env) && !await authorizeE2EApi(request, env)) {
      return json({ ok: false, error: "maintenance" }, 503);
    }
    return authRoute(request, env);
  }

  // Footer/confirmation links use Go as the canonical entry, with no GET action.
  if (["GET","HEAD"].includes(request.method) && ["/go","/go/","/go/index.html"].includes(url.pathname) && parseGoLink(url.searchParams).kind === "m") {
    const center = new URL("https://www.familijna.app/mails/");
    center.searchParams.set("m",url.searchParams.get("m") || "");
    const lang=url.searchParams.get("lang"); if (["pl","en","uk"].includes(lang)) center.searchParams.set("lang",lang);
    return Response.redirect(center.toString(),302);
  }

  const isBypass = await hasAdminBypass(request, env);

  if (["GET", "HEAD"].includes(request.method) && isMarketPath(url.pathname)) {
    const state = await getState(env);
    if (state.enabled && state.mode !== "off" && !isBypass && !await authorizeE2EApi(request, env)) {
      return serveMaintenance(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
    }
    return servePublicMarketplace(request, env, url, ctx);
  }

  // Dynamic sitemap — includes all published game URLs
  if (["GET", "HEAD"].includes(request.method) && url.pathname === "/sitemap.xml") {
    const response = await serveDynamicSitemap(env, ctx);
    return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
  }


  // Bypass → przepuszcza WSZYSTKO (nawet przy włączonym maintenance)
  if (isBypass) {
    return fetchWith404(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // Admin API should not be exposed on public hosts
  if (url.pathname.startsWith("/_admin_api")) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Explicit language parameters must survive proxying. Removing lang=pl
  // would make a fresh English-language browser render English instead.

  // Public notification endpoint (rate-limited, no auth required) - for marketplace, lead-finder etc
  if (url.pathname === "/_api/notify-submission" && request.method === "POST") {
    return handleNotifySubmission(request, env);
  }

  // Public contact form endpoint
  if (url.pathname === "/_api/contact/append") {
    return handleContactAppend(request, env);
  }
  if (url.pathname === "/_api/contact" && request.method === "POST") {
    return handleContactSubmit(request, env);
  }

  // Boty zawsze dostają prawdziwą treść niezależnie od maintenance
  if (request.method === "GET" && isBot(request)) {
    const p = url.pathname;
    if (p === "/" || p === "/index.html" || p.startsWith("/privacy")) {
      return fetchWith404(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
    }
  }

  // Block settings on public hosts (serve custom 404)
  if (isBlockedPath(host, url.pathname) || isLockedSnake(url)) {
    return serveNotFoundPage(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // Signed, short-lived production-test token bypasses maintenance only.
  // It grants no account session or access to admin endpoints.
  if (host === "www.familijna.app" && ["GET", "HEAD"].includes(request.method)
      && await authorizeE2EApi(request, env)) {
    return fetchWith404(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // GLOBAL GATE
  const state = await getState(env);

  if (!state.enabled || state.mode === "off" || isBypass) {
    if (["/connect/", "/connect", "/connect/index.html"].includes(url.pathname) && url.searchParams.get("tv") === "1") {
      const tvUrl = new URL(url);
      tvUrl.pathname = "/connect/tv/index.html";
      return withHeaders(await fetchFromOrigin(request, tvUrl, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE), { "Cache-Control": "no-store", Vary: "User-Agent" });
    }
    return fetchWith404(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE); // brak prac
  }

  // allow access to the maintenance page and its assets
  if (isMaintenanceAsset(url.pathname)) {
    return fetchWith404(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
  }

  // block everything else
  return serveMaintenance(request, ORIGIN_BASE, ORIGIN_HOST, ORIGIN_RESOLVE);
}
