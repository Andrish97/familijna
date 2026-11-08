// Worker starej domeny familiada.online — przeprowadzka na familijna.app
// (plan: familijna-server/docs/rebranding-familijna-plan.md, „Przekierowania”).
// Fazy według dat z wrangler.toml, bez ręcznych kroków:
//   do LEGACY_HANDOFF_UNTIL — przenosiny: przeglądarka dostaje małą stronę, która
//     przenosi localStorage (sesję gościa/konta, język, dźwięki) w części `#`
//     adresu na nową domenę (odbiór: web/shared/js/core/legacy-handoff.js);
//     roboty i żądania inne niż strona HTML — 301;
//   do LEGACY_REDIRECT_UNTIL — 301 na tę samą ścieżkę pod nową domeną;
//   potem — 410 ze stroną „Serwis działa pod adresem familijna.app”.
// Daty są włącznie (cały dzień UTC).

const DAY_MS = 86_400_000;
const PAGE_HOSTS = new Set(["familiada.online", "www.familiada.online"]);
const SERVICE_HOSTS = new Set(["api.familiada.online", "supabase.familiada.online"]);
const BOT_RE = /bot|google|bing|crawl|spider|slurp|facebookexternalhit|embedly|preview|whatsapp|telegram|discord|skype/i;

function endOfDay(date) {
  const t = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(t) ? t + DAY_MS : 0;
}

export function phase(env, now = Date.now()) {
  if (now < endOfDay(env.LEGACY_HANDOFF_UNTIL)) return "handoff";
  if (now < endOfDay(env.LEGACY_REDIRECT_UNTIL)) return "redirect";
  return "gone";
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const HTML_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
};

// Wygląd: ten sam wzorzec `.page--block` co strona 404 i przerwa techniczna
// (web/404.html) — belka z marką, karta, złoty przycisk, stopka. Style aplikacji
// z nowej domeny, podawane przez ten Worker spod STYLE_PATH (ten sam origin, więc
// CSP strefy `style-src 'self'` ich nie blokuje). Własnych kolorów brak.
// BOOT_PATH: skrypt startowy aplikacji (page-boot.js) — motyw jasny/ciemny
// użytkownika i atrybuty urządzenia, od których zależą rozmiary w silniku.
export const STYLE_PATH = "/__familijna/style.css";
export const BOOT_PATH = "/__familijna/boot.js";
const BOOT_FILE = "/shared/js/core/page-boot.js";
const STYLE_FILES = [
  "/shared/style/tokens.css",
  "/shared/style/flat.css",
  "/shared/css/tv-layout.css",
  "/404/css/404.css",
];

const TEXTS = {
  pl: { title: "Familijna ma nowy adres", moving: "Przenosimy Cię na familijna.app.", moved: "Serwis działa pod adresem familijna.app.",
    go: "Przejdź na familijna.app", hint: "Za chwilę przejdziesz automatycznie.", footer: "© 2026 Familijna — system do gry na żywo", contact: "Masz pytania?" },
  en: { title: "Familijna has a new address", moving: "Taking you to familijna.app.", moved: "The service now runs at familijna.app.",
    go: "Go to familijna.app", hint: "You will be taken there in a moment.", footer: "© 2026 Familijna — live game system", contact: "Questions?" },
  uk: { title: "Familijna має нову адресу", moving: "Переносимо тебе на familijna.app.", moved: "Сервіс працює за адресою familijna.app.",
    go: "Перейти на familijna.app", hint: "За мить тебе буде перенаправлено.", footer: "© 2026 Familijna — система для гри наживо", contact: "Маєш питання?" },
};

function langScript(key) {
  // Teksty w języku użytkownika (zapisany uiLang albo język przeglądarki); bez JS polski.
  return `(function(){try{var T=${JSON.stringify(TEXTS)},l="";try{l=localStorage.getItem("uiLang")||"";}catch(e){}
l=(l||navigator.language||"pl").slice(0,2).toLowerCase();if(l==="ua")l="uk";var t=T[l];if(t&&l!=="pl"){
document.documentElement.lang=l;["title","text","go","hint","footer","contact"].forEach(function(id){var e=document.getElementById("t-"+id);
if(e)e.textContent=t[id==="text"?"${key}":id];});}}catch(e){}finally{
/* page-boot.js zasłania stronę do zgłoszenia gotowości; tu treść jest od razu pełna */
try{globalThis.FamilijnaPageBoot&&FamilijnaPageBoot.finish();}catch(e){}}})();`;
}

function page({ key, href, extraHead = "", hint = false, script = "" }) {
  const t = TEXTS.pl;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex"><title>Familijna — familijna.app</title>
${script ? `<script>${script}</script>` : ""}${extraHead}<script src="${BOOT_PATH}"></script><link rel="stylesheet" href="${STYLE_PATH}"></head>
<body class="page--block">
<header class="topbar topbar-layout-4 topbar-mobile-keep-brand">
<div class="topbar-section topbar-section-1"><div class="brand brand-static">Familijna</div></div>
<div class="topbar-section topbar-section-2"></div><div class="topbar-section topbar-section-3"></div><div class="topbar-section topbar-section-4"></div>
</header>
<main class="block-main"><section class="block-card notfound-card" role="status" aria-live="polite"><div class="block-card-top">
<h1 class="block-title" id="t-title">${t.title}</h1>
<p class="block-text" id="t-text">${t[key]}</p>
<div class="cluster cluster--center notfound-actions"><a class="btn gold" id="t-go" href="${href}">${t.go}</a></div>
${hint ? `<p class="hint notfound-redirect" id="t-hint">${t.hint}</p>` : ""}
</div></section></main>
<footer class="footer wrap"><span id="t-footer">${t.footer}</span><span><span id="t-contact">${t.contact}</span> <a href="mailto:kontakt@familijna.app">kontakt@familijna.app</a></span></footer>
<script>${langScript(key)}</script></body></html>`;
}

// Arkusz stylów strony: pliki aplikacji z nowej domeny sklejone w jeden
// (pamięć podręczna Cloudflare na dobę). Gdy któregoś nie ma — pomijany.
// Skrypt startowy aplikacji spod tego samego originu (pamięć podręczna na dobę).
export async function bootResponse(origin, upstream = fetch) {
  let body = "";
  try {
    const res = await upstream(origin + BOOT_FILE, { cf: { cacheTtl: 86400, cacheEverything: true } });
    if (res.ok) body = await res.text();
  } catch {}
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}

export async function styleResponse(origin, upstream = fetch) {
  const parts = await Promise.all(STYLE_FILES.map(async (path) => {
    try {
      const res = await upstream(origin + path, { cf: { cacheTtl: 86400, cacheEverything: true } });
      return res.ok ? `/* ${path} */\n${await res.text()}` : "";
    } catch { return ""; }
  }));
  return new Response(parts.join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
}

// Strona przenosin. Bez localStorage od razu przejście; po przeniesieniu znacznik
// `fam:handoff:done`, żeby kolejne wejście (np. po wylogowaniu na nowej domenie)
// nie przenosiło starej sesji drugi raz. Duża paczka → tylko najważniejsze klucze.
// Odświeżenie po 3 s to zabezpieczenie, gdy skrypt nie zadziała (np. zablokowany):
// wtedy przejście bez przenoszenia sesji zamiast pustej strony.
export function handoffPage(origin, target) {
  const script = `(function(){var O=${JSON.stringify(origin)},T=O+location.pathname+location.search;
try{var s=localStorage;if(s.getItem("fam:handoff:done")!=="1"){var it={},n=0;
for(var i=0;i<s.length;i++){var k=s.key(i);if(!k||k.indexOf("familiada:")===0||k.indexOf("supabase.gotrue")===0)continue;it[k]=s.getItem(k);n++;}
if(n){var j=JSON.stringify({v:1,items:it,h:location.hash});
if(j.length>30000){var p={};["sb-api-auth-token","uiLang","fam:guest:session_seen","auth:guest_upgrade_pending"].forEach(function(k){if(it[k]!=null)p[k]=it[k];});j=JSON.stringify({v:1,items:p,h:location.hash});}
var b=btoa(unescape(encodeURIComponent(j))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
s.setItem("fam:handoff:done","1");location.replace(T+"#fam-handoff="+b);return;}}}catch(e){}
location.replace(T+location.hash);})();`;
  const href = escapeHtml(target);
  return page({
    key: "moving",
    href,
    hint: true,
    extraHead: `<meta http-equiv="refresh" content="3;url=${href}">`,
    script,
  });
}

export function gonePage(origin) {
  return page({ key: "moved", href: escapeHtml(origin + "/") });
}

function wantsHtmlPage(request) {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  const mode = request.headers.get("Sec-Fetch-Mode");
  if (mode && mode !== "navigate") return false;
  return (request.headers.get("Accept") || "").includes("text/html");
}

export async function handle(request, env, now = Date.now(), upstream = fetch) {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  const origin = env.NEW_ORIGIN || "https://www.familijna.app";
  const current = phase(env, now);

  if (SERVICE_HOSTS.has(host)) {
    // Stare adresy API obsługuje Worker `familiada` (trasy tego Workera to tylko
    // apex i www); tu na wypadek błędnej trasy — przejście do końca przekierowań.
    return current === "gone" ? new Response("Gone", { status: 410 }) : upstream(request);
  }
  if (!PAGE_HOSTS.has(host)) return new Response("Not Found", { status: 404 });

  if (url.pathname === STYLE_PATH && ["GET", "HEAD"].includes(request.method)) return styleResponse(origin, upstream);
  if (url.pathname === BOOT_PATH && ["GET", "HEAD"].includes(request.method)) return bootResponse(origin, upstream);
  if (current === "gone") return new Response(gonePage(origin), { status: 410, headers: HTML_HEADERS });

  const target = origin + url.pathname + url.search;
  // Strona przenosin tylko dla przeglądarki po https (GET): localStorage z http to
  // inna pamięć, a narzędzia Google (zmiana adresu w Search Console) muszą
  // zobaczyć 301 także pod http:// i przy HEAD.
  if (current === "handoff" && url.protocol === "https:" && request.method === "GET"
    && wantsHtmlPage(request) && !BOT_RE.test(request.headers.get("User-Agent") || "")) {
    return new Response(handoffPage(origin, target), { status: 200, headers: HTML_HEADERS });
  }
  return new Response(null, { status: 301, headers: { Location: target, "Cache-Control": "public, max-age=3600" } });
}

export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
