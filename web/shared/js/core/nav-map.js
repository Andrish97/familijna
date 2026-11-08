// js/core/nav-map.js
// Jedna mapa stron: kto wchodzi, dokąd prowadzi „Wstecz”, jak strona się
// nazywa. Strony nie składają same ?ret=, etykiet „Wróć do …” ani adresów
// logowania — używają linkTo(), backHref() i loginUrl().
// Decyzje: familijna-server/docs/nawigacja-mapa-plan.md (sekcje 2 i 7).
//
// Pola wpisu w PAGES:
//   path          adres strony (pasuje dokładnie; subpaths — jawne podścieżki)
//   access        "public" | "guest" (gość + konto) | "user" (tylko konto)
//   minViewportWidth  minimalna szerokość viewportu wymagana przez stronę
//   minViewportHeight minimalna wysokość viewportu w poziomie (strony robocze:
//                 listy, edytory, ustawienia -- 580 = MIN_WORK_HEIGHT); niżej guard
//                 prosi o obrót (dotyk, gdy pion pomoże) albo „Za małe okno”
//   parent        dokąd „Wstecz”, gdy nie ma poprawnego ?ret= (null — brak)
//   parentAnon    to samo dla niezalogowanego (strony publiczne)
//   parentParams  parametry adresu, które parent dostaje z bieżącej strony
//   from          strony, na które „Wstecz” wolno wrócić przez ?ret=
//                 (lista id albo "*" — każda strona z mapy)
//   manual        rozdział/podrozdział podręcznika dla przycisku „?” (np. "9.2" → /manual/?ch=9#s-9-2)
//   state         parametry stanu strony (adres z nimi trafia do ?ret=)
//   tabs          karty strony w ?tab= (pierwsza = domyślna, bez parametru
//                 w adresie); czyta je tabs.js, strony nie mają własnych list
//   buttons       przyciski nawigacji strony: id elementu → opis
//                   to      id strony docelowej (cel buduje linkTo() z ret i językiem)
//                   roles   kto widzi przycisk: podzbiór ["anon", "guest", "user"]
//                           (anon — niezalogowany, guest — gość, user — konto);
//                           brak pola — każdy, kto ma wstęp na stronę
//                   minViewportWidth  szerokość viewportu wymagana przez cel
//                   tab     karta strony docelowej (?tab=)
//                   custom  true — przed przejściem strona coś sprawdza (wybrana
//                           gra, validateGame…); initPage tylko chowa przycisk wg
//                           roles i device, a kliknięcie i adres daje strona
//   initialRedirects  możliwe cele niewidocznego przekierowania przy wejściu;
//                 decyzja i nawigacja przed odsłonięciem źródła (page-layout.js)
//   locks         blokady zasobów, które strona trzyma (familijna-server/docs/blokady-zasobow.md,
//                 sekcja 6) — sama deklaracja, mechanizm jest w resource-lock.js:
//                   type    "game" | "logo" | "base" | "logos" (pula logo użytkownika)
//                   id      parametr adresu z id zasobu (brak dla "logos")
//                   mode    "exclusive" (domyślnie) | "shared"
//
// ?ret= niesie PEŁNY bieżący adres (razem z jego własnym ret), więc łańcuch
// powrotów odtwarza się krok po kroku. Każdy poziom jest sprawdzany z listą
// from strony, która go niesie; łańcuch dłuższy niż MAX_RET_DEPTH, obcy albo
// zepsuty ret oznacza powrót do parent. Bez fallbacków i aliasów.

import { getUiLang, t } from "../../translation/translation.js?v=v2026-11-08T23180";
import { iconText } from "./icons.js?v=v2026-11-08T23180";


export const MAX_RET_DEPTH = 4;

// Nowy przegląd E19; historyczne zamknięcie E7 nie spełnia tej zależności.
export const NAV_DEPENDENCIES = {
  modalPagesReview: { completed: true, label: "przegląd przejść po usunięciu stron modalnych" },
};

export function buttonBlocked(spec) {
  return Boolean(spec.blockedUntil && !NAV_DEPENDENCIES[spec.blockedUntil]?.completed);
}

export const PAGES = {
  home:          { path: "/",                   access: "public", parent: null, initialRedirects: ["games", "login"] },
  login:         { path: "/login/",             access: "public", parent: "home", manual: "5", initialRedirects: ["games", "tasks", "friends", "bases", "snake", "go"] },
  loginConfirm:  { path: "/login/confirm/",     access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Jednorazowy callback potwierdzenia e-mail; nie jest celem zwykłego powrotu." },
  loginReset:    { path: "/login/reset/",       access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Przepływ resetu hasła oparty na tokenie z wiadomości." },
  games:         { path: "/games/",             access: "guest", minViewportHeight: 580,  parent: null, from: ["manual"], manual: "6", tabs: ["prepared", "poll_text", "poll_points", "market"], state: ["tab", "dialog"], dialogs: ["exportBaseOverlay", "importOverlay", "previewOverlay"], buttons: {
    btnMarketplace:      { to: "marketplace" },
    btnLogoEditor:       { to: "logoEditor" },
    btnConnectDevice:    { to: "connectDevice", roles: ["user"] },
    btnFriends:          { to: "friends", roles: ["user"] },
    btnSubscribers:      { to: "subscribers", roles: ["user"] },
    btnTasks:            { to: "tasks", roles: ["user"] },
    btnBases:            { to: "bases" },
    btnPlay:             { to: "control", minViewportWidth: 980, custom: true },
    btnSettings:         { to: "gameSettings", custom: true }, // reguła play jak btnPlay; bez ograniczenia szerokości
    btnEdit:             { to: "editor", custom: true },
    btnPoll:             { to: "polls", custom: true },
  } },
  editor:        { path: "/games/editor/",     access: "guest", minViewportHeight: 580,  parent: "games", from: ["games"], manual: "7", state: ["id", "q"], locks: [{ type: "game", id: "id" }] },
  polls:         { path: "/polls/",             access: "guest", minViewportHeight: 580,   parent: "games", from: ["games", "friends", "subscribers", "tasks"], manual: "15", tabs: ["share", "results"], state: ["id", "tab", "dialog"], dialogs: ["pollRecipientsOverlay", "pollQrModalOverlay"], buttons: {
    btnFriends: { to: "friends", roles: ["user"] },
    btnSubscribers: { to: "subscribers", roles: ["user"] },
  }, locks: [{ type: "game", id: "id" }] },
  friends:       { path: "/friends/", access: "user", minViewportHeight: 580, parent: "games", from: ["games", "bases", "polls", "logoEditor", "control", "manual"], manual: "10", tabs: ["invite", "received"], state: ["f", "tab"] },
  subscribers:   { path: "/subscribers/", access: "user", minViewportHeight: 580, parent: "games", from: ["games", "polls", "manual"], manual: "14", tabs: ["invite", "received"], state: ["tab"] },
  tasks:         { path: "/tasks/",             access: "user", minViewportHeight: 580,   parent: "games", from: ["games", "manual"], manual: "15.4", state: ["t"] },
  bases:         { path: "/bases/",             access: "guest", minViewportHeight: 580,  parent: "games", from: ["games", "friends", "subscribers", "baseExplorer", "manual"], manual: "9", tabs: ["mine", "shared"], state: ["tab", "b", "dialog"], dialogs: ["shareOverlay", "shareSendOverlay", "importOverlay"], buttons: {
    btnFriends: { to: "friends", roles: ["user"] },
    btnBrowse: { to: "baseExplorer", custom: true },
  } },
  baseExplorer:  { path: "/bases/explorer/",   access: "guest", minViewportHeight: 580,  parent: "bases", from: ["bases"], manual: "9.2", state: ["id", "folder", "dialog"], dialogs: ["drawerOverlay", "tagsOverlay", "exportOverlay", "questionOverlay", "moveOverlay", "searchOverlay"], locks: [{ type: "base", id: "id", mode: "shared" }] },
  logoEditor:    { path: "/logos/",                    access: "guest", minViewportHeight: 580,  parent: "games", from: ["games", "manual"], manual: "8", tabs: ["text", "draw", "image"], state: ["tab", "dialog"], dialogs: ["logoImportOverlay", "previewOverlay"], buttons: {
    btnFriends: { to: "friends", roles: ["user"] },
  } },
  logoText:      { path: "/logos/editor/text/",        access: "guest", minViewportHeight: 580,  parent: "logoEditor", from: ["logoEditor"], manual: "8.2", minViewportWidth: 700, deviceGuard: { formFactors: ["tablet", "desktop"] }, state: ["id", "dialog"], dialogs: ["previewOverlay"], locks: [{ type: "logo", id: "id" }] },
  logoDraw:      { path: "/logos/editor/draw/",        access: "guest", minViewportHeight: 580,  parent: "logoEditor", from: ["logoEditor"], manual: "8.3", minViewportWidth: 700, deviceGuard: { formFactors: ["tablet", "desktop"] }, state: ["id", "dialog"], dialogs: ["previewOverlay"], locks: [{ type: "logo", id: "id" }] },
  logoImage:     { path: "/logos/editor/image/",       access: "guest", minViewportHeight: 580,  parent: "logoEditor", from: ["logoEditor"], manual: "8.4", minViewportWidth: 700, deviceGuard: { formFactors: ["tablet", "desktop"] }, state: ["id", "dialog"], dialogs: ["previewOverlay"], locks: [{ type: "logo", id: "id" }] },
  control:       { path: "/control/",           access: "guest",  parent: "games", from: ["games", "gameSettings"], manual: "17", minViewportWidth: 980, deviceGuard: { formFactors: ["tablet", "desktop"] }, state: ["id"], buttons: {
    btnFriends: { to: "friends", roles: ["user"], custom: true },
  }, locks: [{ type: "game", id: "id" }, { type: "logos", mode: "shared" }] },
  gameSettings:  { path: "/games/settings/",   access: "guest", minViewportHeight: 580,  parent: "control", parentParams: ["id"], from: ["games", "control"], manual: "16", state: ["id"], buttons: {
    btnPlay: { to: "control", minViewportWidth: 980, custom: true },
  }, locks: [{ type: "game", id: "id" }, { type: "logos", mode: "shared" }] },
  marketplace:   { path: "/marketplace/",       access: "public", minViewportHeight: 580, parent: "games", parentAnon: "home", subpaths: ["game/"], from: ["home", "games", "manual"], manual: "13", tabs: ["browse", "mine"], state: ["q", "filter", "sort", "tab", "dialog", "game"], dialogs: ["gameDetailOverlay"] },
  connectDevice: { path: "/connect/",    access: "public", parent: "games", parentAnon: "home", from: ["home", "games", "manual"], manual: "17.1", state: ["share"] },
  connectTv:     { path: "/connect/tv/", access: "public", parent: "connectDevice", parentAnon: "connectDevice", from: ["connectDevice"], deviceGuard: { formFactors: ["tv"] } },
  controlDisplay:{ path: "/control/display/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Odbiornik ekranu uruchamiany kodem parowania; osobna sesja urządzenia." },
  controlHost:   { path: "/control/host/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Widok hosta sterowania otwierany przez połączone urządzenie." },
  controlBuzzer: { path: "/control/buzzer/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Widok buzzera otwierany przez połączone urządzenie." },
  snake:         { path: "/snake/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Ukryta gra w węża z kodu QR na kadrze strony głównej; nie jest celem zwykłego powrotu." },
  go:            { path: "/go/", access: "public", initialRedirects: ["pollVotePoints", "pollVoteText", "pollVoteQr", "controlDisplay", "controlHost", "controlBuzzer", "mailCenter", "snake"], parent: null, from: [], kind: "standalone", standaloneReason: "Jednorazowy link odbioru/akcji z tokenem; powrót nie może go ponownie uruchamiać." },
  pollVotePoints:{ path: "/polls/vote/points/", access: "public", parent: null, from: [], manual: "15.3", kind: "standalone", standaloneReason: "Publiczny widok głosowania punktowego identyfikowany tokenem ankiety." },
  pollVoteText:  { path: "/polls/vote/text/", access: "public", parent: null, from: [], manual: "15.3", kind: "standalone", standaloneReason: "Publiczny widok głosowania tekstowego identyfikowany tokenem ankiety." },
  pollVoteQr:    { path: "/polls/vote/qr/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Publiczny ekran QR dla głosowania, z własnym guardem urządzenia." },
  account: {
    path: "/account/", access: "guest", parent: "games",
    // Konto pokazuje e-mail i stan jego zmiany — użytkownik prosto z serwera, nie z zapisanej sesji.
    freshUser: true,
    from: ["games", "editor", "polls", "friends", "subscribers", "tasks", "bases", "baseExplorer", "logoEditor", "logoText", "logoDraw", "logoImage", "control", "gameSettings", "marketplace", "connectDevice", "manual", "privacy"],
    manual: "5",
  },
  // ch identyfikuje publiczny rozdział (nieznany = 404); from to kontekst powrotu,
  // nie wersja dokumentu do indeksowania. Język jest wspólnym parametrem mapy.
  manual:        { path: "/manual/",            access: "public",  parent: "games", parentAnon: "home", from: [], state: ["ch", "from"], buttons: {
    btnLegal: { to: "privacy" },
  } },
  mailCenter:    { path: "/mails/", access: "public", parent: "home", from: ["home"], manual: "14.5", tabs: ["subscriptions","items"], state: ["tab","m"] },
  privacy:       { path: "/privacy/",           access: "public", parent: "manual", parentAnon: "home", from: ["home", "manual"] },
  notFound:      { path: "/404.html", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Dokument noindex ze statusem 404 także pod własnym adresem; nieznany URL pozostaje w pasku adresu." },
  maintenance:   { path: "/maintenance/", access: "public", parent: null, from: [], kind: "standalone", standaloneReason: "Samodzielny dokument noindex; bramka przerwy zwraca 503 i Retry-After pod żądanym URL." },
};

// Wspólny kontakt jest budowany dynamicznie, więc nie należy do statycznych
// PAGES[id].dialogs. Jego dozwolone strony i stan URL nadal pochodzą z mapy.
export const GLOBAL_DIALOGS = {
  contactModalOverlay: Object.keys(PAGES).filter((id) => id !== "home" && id !== "login"),
};

export function dialogAllowed(pageId, dialogId) {
  return Boolean(PAGES[pageId]?.dialogs?.includes(dialogId) || GLOBAL_DIALOGS[dialogId]?.includes(pageId));
}

for (const pageId of new Set(Object.values(GLOBAL_DIALOGS).flat())) {
  const page = PAGES[pageId];
  page.state = [...new Set([...(page.state || []), "dialog"] )];
}

// Z instrukcji i prywatności wracamy na każdą stronę z topbarem; do samej
// instrukcji, prywatności, landingu i logowania nie.
// mailCenter poza powrotami: jego adres niesie token dostępu (?m=), który nie może trafić do ?ret=.
const MANUAL_EXCLUDED = new Set(["manual", "privacy", "home", "mailCenter"]);
PAGES.manual.from = Object.keys(PAGES).filter((id) => !MANUAL_EXCLUDED.has(id) && PAGES[id].kind !== "standalone");

export const ROLES = ["anon", "guest", "user"];

const ACCESS_ROLES = {
  public: ["anon", "guest", "user"],
  guest: ["guest", "user"],
  user: ["user"],
};

/** Role, które w ogóle wchodzą na stronę (access). */
export function pageRoles(pageId) {
  return ACCESS_ROLES[page(pageId).access];
}

/** Rola użytkownika: "anon" (null), "guest" (gość) albo "user" (konto). */
export function roleOf(user, isGuest) {
  if (!user) return "anon";
  return isGuest ? "guest" : "user";
}

/** Role widzące przycisk: roles z opisu, ale tylko spośród tych, które mają wstęp na stronę. */
export function buttonRoles(pageId, spec) {
  const allowed = pageRoles(pageId);
  return spec.roles ? spec.roles.filter((r) => allowed.includes(r)) : allowed;
}

/** Widoczność wynika z roli i minimalnej szerokości celu, nie z typu urządzenia. */
export function buttonVisible(pageId, spec, role, deviceProfile = null) {
  if (!buttonRoles(pageId, spec).includes(role)) return false;
  const viewportWidth = typeof deviceProfile === "number" ? deviceProfile : deviceProfile?.viewportWidth ?? Infinity;
  if (spec.minViewportWidth && viewportWidth < spec.minViewportWidth) return false;
  return true;
}

/** Adres celu przycisku (bez custom — te adresy składa strona). */
export function buttonHref(spec, ctx) {
  return linkTo(spec.to, spec.tab ? { tab: spec.tab } : {}, ctx);
}

const DUMMY_ORIGIN = "https://nav.invalid";

function defaultCtx() {
  const hasLoc = typeof location !== "undefined";
  return {
    href: hasLoc ? `${location.pathname}${location.search}${location.hash}` : "/",
    lang: hasLoc ? getUiLang() : "pl",
    anon: false,
  };
}

function resolveCtx(ctx) {
  return { ...defaultCtx(), ...(ctx || {}) };
}

function page(id) {
  const p = PAGES[id];
  if (!p) throw new Error(`nav-map: nieznana strona "${id}"`);
  return p;
}

// Tylko adresy względne w tym samym serwisie ("/ścieżka…"), bez "//host".
function parseInternal(raw) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(s)) return null;
  try {
    const u = new URL(s, DUMMY_ORIGIN);
    return u.origin === DUMMY_ORIGIN ? u : null;
  } catch {
    return null;
  }
}

// Strona jest serwowana także bez końcowego "/" (np. /game-settings), więc
// adres bieżącej strony porównujemy z tym "/" dopisanym.
export function pageIdForPath(pathname) {
  // Publiczny HTML dokumentów pod index.html ma tę samą tożsamość nawigacji.
  if (["/manual/index.html", "/privacy/index.html", "/marketplace/index.html"].includes(pathname)) pathname = pathname.replace(/index\.html$/, "");
  const withSlash = pathname.endsWith("/") || /\.[a-z0-9]+$/i.test(pathname) ? pathname : `${pathname}/`;
  let sub = null;
  for (const [id, p] of Object.entries(PAGES)) {
    if (p.path === withSlash) return id;
    const matchesSubpath = Array.isArray(p.subpaths)
      ? p.subpaths.some((prefix) => withSlash.startsWith(`${p.path}${prefix}`))
      : p.subpaths && withSlash.startsWith(p.path);
    if (matchesSubpath) sub = id;
  }
  return sub;
}

function allowedFrom(targetId, sourceId) {
  const from = PAGES[targetId]?.from;
  if (from === "*") return !!PAGES[sourceId];
  return Array.isArray(from) && from.includes(sourceId);
}

function rel(u) {
  return `${u.pathname}${u.search}${u.hash}`;
}

function applyLang(u, lang) {
  if (!lang || lang === "pl") u.searchParams.delete("lang");
  else u.searchParams.set("lang", lang);
}

// Sprawdza cały łańcuch ret zaczynając od strony ownerId. Zwraca
// { pageId, url } dla pierwszego poziomu albo null (obcy, zepsuty, za głęboki).
function resolveRet(ownerId, raw) {
  let owner = ownerId;
  let cur = raw;
  let first = null;
  for (let depth = 1; ; depth++) {
    if (depth > MAX_RET_DEPTH) return null;
    const u = parseInternal(cur);
    const pid = u ? pageIdForPath(u.pathname) : null;
    if (!pid || !allowedFrom(owner, pid)) return null;
    if (!first) first = { pageId: pid, url: u };
    const inner = u.searchParams.get("ret");
    if (inner == null) return first;
    owner = pid;
    cur = inner;
  }
}

// Przycina łańcuch ret w adresie u (strona ownerId) do poprawnych poziomów,
// nie więcej niż budget. Usuwa lang z zagnieżdżonych adresów.
function sanitizeRet(u, ownerId, budget) {
  const raw = u.searchParams.get("ret");
  if (raw == null) return;
  const iu = budget > 0 ? parseInternal(raw) : null;
  const pid = iu ? pageIdForPath(iu.pathname) : null;
  if (!pid || !allowedFrom(ownerId, pid)) {
    u.searchParams.delete("ret");
    return;
  }
  iu.searchParams.delete("lang");
  sanitizeRet(iu, pid, budget - 1);
  u.searchParams.set("ret", rel(iu));
}

/**
 * Adres strony pageId z parametrami params; ret = pełny bieżący adres,
 * jeśli bieżąca strona jest na liście from celu. params.hash — kotwica.
 * Wartości null/undefined są pomijane.
 */
export function linkTo(pageId, params = {}, ctx) {
  const c = resolveCtx(ctx);
  const target = page(pageId);
  const u = new URL(target.path, DUMMY_ORIGIN);
  let hash = "";
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    if (k === "hash") { hash = String(v); continue; }
    u.searchParams.set(k, String(v));
  }
  const cur = parseInternal(c.href);
  const curId = cur ? pageIdForPath(cur.pathname) : null;
  if (cur && curId && allowedFrom(pageId, curId)) {
    cur.searchParams.delete("lang");
    sanitizeRet(cur, curId, MAX_RET_DEPTH - 1);
    u.searchParams.set("ret", rel(cur));
  }
  applyLang(u, c.lang);
  if (hash) u.hash = hash.startsWith("#") ? hash : `#${hash}`;
  return rel(u);
}

/**
 * Cel „Wstecz” strony pageId: { pageId, href }. ret z łańcucha dozwolonego
 * przez from, inaczej parent (null, gdy strona nie ma rodzica).
 */
export function backTarget(pageId, ctx) {
  const c = resolveCtx(ctx);
  const p = page(pageId);
  const cur = parseInternal(c.href) || new URL("/", DUMMY_ORIGIN);
  const raw = cur.searchParams.get("ret");
  if (raw != null) {
    const r = resolveRet(pageId, raw);
    if (r) {
      r.url.searchParams.delete("lang");
      applyLang(r.url, c.lang);
      return { pageId: r.pageId, href: rel(r.url) };
    }
  }
  const anonParent = c.anon && p.parentAnon;
  const parentId = anonParent || p.parent;
  if (!parentId) return null;
  const u = new URL(page(parentId).path, DUMMY_ORIGIN);
  if (!anonParent) {
    for (const k of p.parentParams || []) {
      const v = cur.searchParams.get(k);
      if (v != null) u.searchParams.set(k, v);
    }
  }
  applyLang(u, c.lang);
  return { pageId: parentId, href: rel(u) };
}

/** Adres podręcznika w miejscu PAGES[pageId].manual (np. "9.2" → /manual/?ch=9#s-9-2), z ret wg mapy. */
export function manualHref(pageId, ctx) {
  const section = String(page(pageId).manual || "");
  const ch = section.split(".")[0] || null;
  return linkTo("manual", { ch, hash: section.includes(".") ? `s-${section.replace(/\./g, "-")}` : null }, ctx);
}

export function backHref(pageId, ctx) {
  return backTarget(pageId, ctx)?.href ?? null;
}

/**
 * Adres logowania — po zalogowaniu zawsze /games/ (wyjątki: next= z maila
 * oraz next=snake&qr=… z ukrytej gry w węża -- powrót do gry).
 * ctx.forceAuth — gość, który chce przejść do logowania mimo otwartej sesji.
 */
export function loginUrl(ctx) {
  const c = resolveCtx(ctx);
  const u = new URL(PAGES.login.path, DUMMY_ORIGIN);
  if (c.forceAuth) u.searchParams.set("force_auth", "1");
  applyLang(u, c.lang);
  return rel(u);
}

/** Etykieta przycisku „Wstecz”: „{strona}”. */
export function backLabel(pageId, ctx) {
  const target = backTarget(pageId, ctx);
  if (!target) return "";
  return t("nav.backTo", { page: t(`nav.page.${target.pageId}`) });
}

/**
 * Wstawia do przycisku ikonę i etykietę „{strona}” i odświeża ją przy
 * zmianie języka. getCtx — funkcja zwracająca kontekst (np. { anon }).
 */
export function renderBackLabel(btn, pageId, getCtx) {
  if (!btn) return;
  const render = () => {
    const label = backLabel(pageId, getCtx ? getCtx() : undefined);
    if (label) btn.innerHTML = iconText("arrow-left", label);
  };
  render();
  // Ponowne wywołanie dla tego samego przycisku zastępuje poprzedni nasłuch.
  if (btn._navBackRender) window.removeEventListener("i18n:lang", btn._navBackRender);
  btn._navBackRender = render;
  window.addEventListener("i18n:lang", render);
}
