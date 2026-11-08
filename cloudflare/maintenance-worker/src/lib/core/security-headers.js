// src/lib/core/security-headers.js -- nagłówki bezpieczeństwa dla stron HTML
// (audyt E24, N3). Dotyczy hostów serwowanych przez Worker z Pages (www,
// apex, settings, nieznane subdomeny ze stroną prac/404); usługi przepuszczane
// bez zmian (panel/supabase/api/docker) zostają bez nowych nagłówków.
//
// Pełna CSP w trybie Report-Only (naruszenia w konsoli przeglądarki).
// Egzekwowane są ograniczenia osadzania, obiektów, bazowego URL i formularzy
// (podglądy Control/ustawień gry i narzędzia panelu osadzają strony z tego
// samego hosta).

import { LEGACY_SERVICE_HOSTS } from "../origin/origin.js";
import { INLINE_SCRIPT_HASHES } from "./csp-hashes.js";

const PASSTHROUGH_HOSTS = new Set([
  "panel.familijna.app",
  "supabase.familijna.app",
  "api.familijna.app",
  "docker.familijna.app",
  ...LEGACY_SERVICE_HOSTS,
]);

const APP_HOSTS = new Set(["familijna.app", "www.familijna.app", "admin.familijna.app"]);
const CSP_BASELINE = ["frame-ancestors 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"];
const CAPTCHA_HOSTS = "https://challenges.cloudflare.com https://js.hcaptcha.com https://hcaptcha.com https://*.hcaptcha.com";
// E24 R12: strony aplikacji bez 'unsafe-inline'/'unsafe-eval' i bez CDN —
// skrypty z własnej domeny, captcha, Web Analytics oraz stałe skrypty wbudowane
// po hashu (scripts/csp-hashes.mjs, zapadka unit/cspHashes.test.js).
const CSP_SOURCE_POLICY = [
  `script-src 'self' ${INLINE_SCRIPT_HASHES.join(" ")} ${CAPTCHA_HOSTS} https://static.cloudflareinsights.com`,
  `connect-src 'self' https://api.familijna.app wss://api.familijna.app https://cloudflareinsights.com ${CAPTCHA_HOSTS}`,
  `frame-src 'self' ${CAPTCHA_HOSTS}`,
];
// Panel admina (osobny Worker; tu tylko na wypadek trasy przez ten Worker):
// TinyMCE z CDN i obsługa zdarzeń wbudowana — dawna, luźniejsza polityka.
const CSP_SOURCE_POLICY_ADMIN = [
  "script-src 'unsafe-inline' 'unsafe-eval' 'self' https://cdn.jsdelivr.net https://challenges.cloudflare.com",
  "connect-src 'self' https://api.familijna.app wss://api.familijna.app https://cdn.jsdelivr.net",
  "frame-src 'self' https://challenges.cloudflare.com",
];

export function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== "http:" || !APP_HOSTS.has(url.hostname)) return null;
  url.protocol = "https:";
  url.port = "";
  if (url.hostname === "familijna.app") url.hostname = "www.familijna.app";
  // 308 zachowuje metodę i treść żądania; żadnej obsługi API/sesji po HTTP.
  return Response.redirect(url.toString(), 308);
}

const CAPTCHA = "https://challenges.cloudflare.com https://hcaptcha.com https://*.hcaptcha.com";

// Źródła z web/: biblioteki stron z własnej domeny (web/shared/vendor:
// supabase-js, fabric, jsQR); z cdn.jsdelivr.net już tylko panel admina
// (TinyMCE, opentype), opentype też z cdnjs (narzędzia panelu),
// captcha (Turnstile/hCaptcha), API i Realtime Supabase, pliki Storage.
// Skrypty i style inline są używane (JSON-LD, style="..."), stąd 'unsafe-inline'.
export const CSP_REPORT_ONLY = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://static.cloudflareinsights.com ${CAPTCHA}`,
  `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net ${CAPTCHA}`,
  "img-src 'self' data: blob: https://api.familijna.app https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "media-src 'self' data: blob: https://api.familijna.app",
  `connect-src 'self' https://api.familijna.app wss://api.familijna.app https://cdn.jsdelivr.net https://cdnjs.cloudflare.com ${CAPTCHA}`,
  `frame-src 'self' blob: data: ${CAPTCHA}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

export const PERMISSIONS_POLICY = "camera=(self), microphone=(), geolocation=(), payment=(), usb=()";

export function securityHeadersApply(host, response) {
  if (!(host === "familijna.app" || host.endsWith(".familijna.app")) || PASSTHROUGH_HOSTS.has(host)) return false;
  const type = String(response.headers.get("Content-Type") || "").toLowerCase();
  return type.includes("text/html");
}

export function withSecurityHeaders(request, response) {
  try {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const html = securityHeadersApply(host, response);
    const hsts = url.protocol === "https:" && APP_HOSTS.has(host);
    if (!html && !hsts) return response;
    const headers = new Headers(response.headers);
    // Tylko sprawdzone hosty aplikacji: bez includeSubDomains ani preload.
    if (hsts && !headers.has("Strict-Transport-Security")) headers.set("Strict-Transport-Security", "max-age=604800");
    if (!html) return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("X-Frame-Options", "SAMEORIGIN");
    headers.set("Permissions-Policy", PERMISSIONS_POLICY);
    const csp = headers.get("Content-Security-Policy") || "";
    const directives = new Set(csp.split(";").map((part) => part.trim().split(/\s+/)[0].toLowerCase()));
    const missing = CSP_BASELINE.filter((part) => !directives.has(part.split(" ")[0]));
    // Nie zastępujemy bardziej restrykcyjnego default-src jego luźniejszym
    // wyjątkiem dla skryptów/połączeń/ramek.
    const policy = host === "admin.familijna.app" ? CSP_SOURCE_POLICY_ADMIN : CSP_SOURCE_POLICY;
    const sources = directives.has("default-src") ? []
      : policy.filter((part) => !directives.has(part.split(" ")[0]));
    headers.set("Content-Security-Policy", [csp, ...missing, ...sources].filter(Boolean).join("; "));
    if (!headers.has("Content-Security-Policy-Report-Only")) {
      headers.set("Content-Security-Policy-Report-Only", CSP_REPORT_ONLY);
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return response;
  }
}
