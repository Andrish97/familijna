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

// Wygląd wspólny dla strony przenosin i strony końcowej: tło i kolory aplikacji,
// logo (ten sam rysunek co web/assets/img/familijna-icon.svg), napis w języku
// użytkownika (zapisany uiLang albo język przeglądarki), przycisk przejścia.
const LOGO = `<svg class="logo" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="100" fill="#0f0f0f"/><g fill="#e5f34f"><circle cx="160" cy="116" r="28"/><circle cx="209" cy="116" r="28"/><circle cx="258" cy="116" r="28"/><circle cx="307" cy="116" r="28"/><circle cx="356" cy="116" r="28"/><circle cx="160" cy="165" r="28"/><circle cx="160" cy="214" r="28"/><circle cx="160" cy="263" r="28"/><circle cx="209" cy="263" r="28"/><circle cx="258" cy="263" r="28"/><circle cx="307" cy="263" r="28"/><circle cx="160" cy="312" r="28"/><circle cx="160" cy="361" r="28"/><circle cx="160" cy="410" r="28"/></g></svg>`;

const TEXTS = {
  pl: { moving: "Przenosimy Cię na nowy adres", moved: "Familijna działa pod nowym adresem", go: "Przejdź teraz" },
  en: { moving: "Taking you to our new address", moved: "Familijna has moved to a new address", go: "Go now" },
  uk: { moving: "Переносимо вас на нову адресу", moved: "Familijna працює за новою адресою", go: "Перейти зараз" },
};

const STYLE = `:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;padding:24px 16px;
background:radial-gradient(120% 80% at 50% 0%,#14203d 0%,#050914 60%) #050914;color:#f4f6fb;
font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;text-align:center}
main{width:100%;max-width:420px;display:flex;flex-direction:column;align-items:center;gap:14px}
.logo{width:88px;height:88px;border-radius:22px;box-shadow:0 10px 40px rgba(229,243,79,.18)}
h1{margin:10px 0 0;font-size:22px;font-weight:600;line-height:1.3}
.addr{margin:0;font-size:18px;font-weight:700;letter-spacing:.02em;color:#e5f34f}
.bar{width:180px;height:4px;border-radius:2px;background:rgba(255,255,255,.12);overflow:hidden}
.bar i{display:block;width:40%;height:100%;border-radius:2px;background:#e5f34f;animation:slide 1.1s ease-in-out infinite}
@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
@media (prefers-reduced-motion:reduce){.bar i{animation:none;width:100%}}
.btn{margin-top:8px;display:inline-block;padding:12px 22px;border-radius:12px;background:#e5f34f;color:#0b1020;
font-weight:700;text-decoration:none}
.btn:focus-visible{outline:3px solid #fff;outline-offset:3px}`;

function langScript(key) {
  // Podmienia teksty na język użytkownika; bez JS zostaje polski.
  return `(function(){try{var T=${JSON.stringify(TEXTS)},l="";try{l=localStorage.getItem("uiLang")||"";}catch(e){}
l=(l||navigator.language||"pl").slice(0,2).toLowerCase();
if(l==="ua")l="uk";var t=T[l];if(!t||l==="pl")return;document.documentElement.lang=l;
document.getElementById("t").textContent=t.${key};document.getElementById("b").textContent=t.go;}catch(e){}})();`;
}

function page({ title, key, href, extraHead = "", bar = false, script = "" }) {
  const t = TEXTS.pl;
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#050914"><title>${title}</title>${extraHead}<style>${STYLE}</style></head>
<body><main>${LOGO}<h1 id="t">${t[key]}</h1><p class="addr">familijna.app</p>${bar ? '<div class="bar" aria-hidden="true"><i></i></div>' : ""}
<a class="btn" id="b" href="${href}">${t.go}</a></main><script>${langScript(key)}</script>${script ? `<script>${script}</script>` : ""}</body></html>`;
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
    title: "Familijna — familijna.app",
    key: "moving",
    href,
    bar: true,
    extraHead: `<meta http-equiv="refresh" content="3;url=${href}">`,
    script,
  });
}

export function gonePage(origin) {
  return page({ title: "Familijna — familijna.app", key: "moved", href: escapeHtml(origin + "/") });
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
