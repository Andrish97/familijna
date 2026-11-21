// src/lib/assets.js -- static asset path classification + serving from ASSETS.
import { fetchWithOrigin } from "./origin.js";

// Dopasowanie po rozszerzeniu, nie po folderze — assety żyją w dziesiątkach
// osobnych katalogów (css/, js/, img/, audio/, translation/, plus własny
// js/ dla każdej strony: display/, display/, control/, control/, host/,
// buzzer/, logo/, base-explorer/...) i lista przybywa z każdą nową
// stroną. Rozszerzenie jest stałe niezależnie od tego, gdzie plik leży.
const STATIC_ASSET_RE = /\.(?:js|mjs|css|json|webmanifest|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp3|wav|ogg|mp4|webm|txt)$/i;

// Jedyny wyjątek: /maintenance-state.json ma rozszerzenie .json, ale czyta
// KV na żywo i musi zostać w normalnej bramce (patrz PUBLIC STATE ENDPOINT
// wyżej) - nie wolno mu omijać GLOBAL GATE ani być cache'owanym.
const DYNAMIC_JSON_PATHS = new Set(["/maintenance-state.json"]);

// isBlockedPath() dalej w tym pliku 404-uje /tools/* i /admin-tools/*
// na publicznym hoście (te ścieżki mają działać tylko z poziomu
// admin.familijna.app) - ale ten skrót działa WCZEŚNIEJ w fetch(),
// więc bez tego wykluczenia np. /admin-tools/tools.json (rozszerzenie
// .json) omijałby tamten blok i wyciekał publicznie mimo blokady.
function isPubliclyBlockedAssetPath(pathname) {
  return pathname.startsWith("/tools/") || pathname.startsWith("/admin-tools/") || pathname.startsWith("/admin/");
}

export function isStaticAssetPath(pathname) {
  return STATIC_ASSET_RE.test(pathname)
    && !DYNAMIC_JSON_PATHS.has(pathname)
    && !isPubliclyBlockedAssetPath(pathname);
}

// scripts/version-assets.js dopisuje ?v=<deploy> do każdej wersjonowanej
// referencji, więc URL z ?v= jest z definicji unikalny per deploy - wolno go
// cache'ować długo i "na sztywno" (immutable). Coś bez ?v= (przeoczone albo
// referencja spoza konwencji wersjonowania) dostaje ostrożny, krótki TTL,
// żeby ewentualna pomyłka nie zostawiła kogoś na starej wersji na długo.
function cacheControlFor(url) {
  return url.searchParams.has("v")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=600";
}

// Pliki z bindingu ASSETS leżą już w sieci Cloudflare — bez osobnej pamięci
// caches.default; nagłówek Cache-Control decyduje o pamięci przeglądarki.
export async function serveStaticAsset(request, url, ctx, originBase) {
  const target = new URL(url.pathname + url.search, originBase);
  const res = await fetchWithOrigin(target.toString(), request, {
    staticAsset: true,
    cacheControl: cacheControlFor(url),
  });

  if ((res.headers.get("Content-Type") || "").includes("text/html") && res.status === 200) {
    return new Response("Invalid static asset response", { status: 502, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
  }
  return res;
}

// Zasoby strony przerwy i wspólny silnik wyglądu. Panel ma własny origin.
function isSharedAssetPath(pathname) {
  const allowedPrefixes = ["/shared/", "/assets/", "/maintenance/css/", "/maintenance/js/", "/404/css/", "/404/js/"];
  for (const prefix of allowedPrefixes) {
    if (pathname.startsWith(prefix)) return true;
  }
  const allowedFiles = ["/favicon.ico", "/logo.svg", "/manifest.json"];
  return allowedFiles.includes(pathname);
}

export function isMaintenanceAsset(pathname) {
  if (["/maintenance", "/maintenance/", "/maintenance/index.html"].includes(pathname)) return true;
  return isSharedAssetPath(pathname);
}

export function isCommonAsset(pathname) {
  if (pathname === "/404.html") return true;
  if (isMaintenanceAsset(pathname)) return true;
  return ["/games/css/", "/control/host/fonts/"].some(prefix => pathname.startsWith(prefix));
}
