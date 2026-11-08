// Seria zrzutów obszaru „people”: znajomi, subskrybenci, Centrum maili, konto,
// logowanie (z resetem hasła i potwierdzeniem), przerwa techniczna, polityka
// prywatności i strona 404 -- każda zakładka, okno i ważny stan.
//
// Zasada: prawdziwy kod strony, atrapa tylko warstwy danych. Dwie rzeczy, których
// atrapa Supabase nie ma, dokładamy w krokach sceny (via):
//   - metody auth, które zwracają wynik z serwera (exchangeCodeForSession,
//     signInWithPassword, signUp, resetPasswordForEmail, verifyOtp) -- podmiana
//     na stronie przed jej skryptami (addInitScript) i ponowne wczytanie,
//   - Cloudflare Turnstile (captcha logowania) -- atrapa skryptu, która od razu
//     oddaje token; bez niej żadne wysłanie formularza logowania nie przejdzie.
const { USER_ID } = require("../data/demo.cjs");
const panel = require("../data/panel.cjs");

const page = (dir) => [`web/${dir}/index.html`, `web/${dir}/js/`, `web/${dir}/css/`];
const CONTACTS = ["web/shared/js/core/contacts-page.js", "web/shared/js/core/share-sections.js", "web/shared/css/contacts.css"];
const FRIENDS = [...page("friends"), ...CONTACTS];
const SUBS = [...page("subscribers"), ...CONTACTS];
const MAILS = ["web/mails/", "web/mail/"];
const ACCOUNT = [...page("account"), "web/shared/js/core/auth.js", "web/shared/js/core/cooldown.js"];
const LOGIN = ["web/login/index.html", "web/login/js/", "web/login/css/", "web/shared/js/core/auth.js"];
const RESET = ["web/login/reset/", "web/login/css/", "web/shared/js/core/auth.js"];
const CONFIRM = ["web/login/confirm/", "web/login/css/", "web/shared/js/core/auth.js"];
const MAINT = page("maintenance");
const C = "people";

const contactsReady = () => document.querySelector("#contactsHost.skel-step-ready") && document.querySelector("#contactsReceived")?.children.length > 0;
const MODAL = ".overlay .uni-modal";
const wait = (ms) => async (view) => { await view.waitForTimeout(ms); };
const click = (selector) => async (view) => { await view.locator(selector).first().click(); await view.waitForTimeout(300); };
const openModal = (selector, modal = MODAL) => async (view) => {
  await view.locator(selector).first().click();
  await view.locator(modal).first().waitFor({ state: "visible", timeout: 5000 });
  await view.waitForTimeout(300);
};
const waitFor = (selector) => async (view) => { await view.locator(selector).first().waitFor({ state: "visible", timeout: 8000 }); await view.waitForTimeout(250); };
const toastShown = async (view) => { await view.locator("#appToast.show").waitFor({ timeout: 8000 }); await view.waitForTimeout(350); };
// Wartość może zależeć od języka sceny: (lang) => tekst (np. e-mail użytkownika demo).
const fill = (pairs) => async (view, { lang } = {}) => { for (const [sel, value] of pairs) await view.locator(sel).first().fill(typeof value === "function" ? value(lang) : value); };
const USER_EMAIL = (lang) => panel[lang].user.email;
const textIn = (selector, minLength = 1) => async (view) => {
  await view.waitForFunction(([s, n]) => (document.querySelector(s)?.textContent || "").trim().length >= n, [selector, minLength], { timeout: 8000 });
  await view.waitForTimeout(200);
};

// Atrapa Cloudflare Turnstile: render() od razu oddaje token przez callback.
const TURNSTILE = `window.turnstile = {
  render(el, o) { setTimeout(() => { try { o && o.callback && o.callback("screens-captcha-token"); } catch (e) {} }, 30); return "screens-widget"; },
  remove() {}, reset() {}, execute() {}, getResponse() { return "screens-captcha-token"; }
};`;

// Podmiana metod auth w atrapie Supabase przed skryptami strony (spec: { metoda: { error?, session?, user? } }).
function patchAuth(spec) {
  let real;
  Object.defineProperty(window, "supabase", {
    configurable: true,
    get: () => real,
    set(value) {
      const create = value.createClient;
      real = { ...value, createClient: (...args) => {
        const client = create(...args);
        for (const [name, r] of Object.entries(spec)) {
          client.auth[name] = async () => {
            if (r.error) return { data: { user: null, session: null }, error: { message: r.error, status: r.status || 400 } };
            const user = r.user || window.__SCREENS_DB__.user;
            const session = r.session === false || !user ? null : { access_token: "screens-token", refresh_token: "screens-refresh", token_type: "bearer", expires_at: 4102444800, user };
            return { data: { user, session }, error: null };
          };
        }
        return client;
      } };
    },
  });
}

// Strona otwierana dopiero w kroku sceny: najpierw pusta ramka runnera, potem
// atrapa Turnstile i podmienione auth (przed skryptami strony), potem właściwy
// adres. Tak strona logowania nie zgłasza błędu ładowania captchy (CDN Cloudflare
// jest w zrzutach zablokowany), a wynik auth jest gotowy od pierwszego wczytania.
const BLANK = "/__screens__/frame.html?src=about:blank";
function via(scene, { auth = null, turnstile = true } = {}) {
  const { path: target, ready } = scene;
  return { ...scene, path: BLANK, ready: "#screensFrame", steps: [async (view, { page, lang }) => {
    if (turnstile) await page.route(/^https:\/\/challenges\.cloudflare\.com\//, (route) => route.fulfill({ contentType: "text/javascript", body: TURNSTILE }));
    if (auth) await page.addInitScript(patchAuth, typeof auth === "function" ? auth(lang) : auth);
    const url = new URL(target, page.url());
    url.searchParams.set("lang", lang);
    await page.goto(url.href, { waitUntil: "domcontentloaded" });
    if (typeof ready === "string") await page.waitForSelector(ready, { state: "visible", timeout: 15000 });
    else if (ready) await page.waitForFunction(ready, null, { timeout: 15000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains("page-loading"), null, { timeout: 8000 }).catch(() => {});
  }, ...(scene.steps || [])] };
}

// RPC zależne od danych demo: nowa funkcja dostaje wynik starej (prev), args i dane sceny.
function patchRpc(db, name, fn, data = null) {
  const old = db.rpc[name];
  const prev = typeof old === "string" && old.startsWith("fn:") ? old.slice(3) : `() => (${JSON.stringify(old ?? null)})`;
  db.rpc[name] = `fn:(args, db) => (${fn})((${prev})(args, db), args, ${JSON.stringify(data)})`;
}
// Podział wysokości karty między sekcje (decyzja 2026-10-21): wielu znajomych,
// 2 propozycje (otrzymane zaproszenia) i 2 odrzucone; subskrybenci i wysłane
// zaproszenia też powielone, żeby listy wychodziły poza połowę karty.
const MANY_DECLINED = [
  { id: "00000000-0000-4000-8800-000000000091", label: "marek_wisniewski", email: null, friend_user_id: "00000000-0000-4000-8810-000000000091", direction: "incoming", status: "declined", created_at: "2026-10-12T10:00:00Z", resend_available_at: "2026-10-12T10:00:00Z", email_enabled: true },
  { id: "00000000-0000-4000-8800-000000000092", label: "zosia_k", email: null, friend_user_id: "00000000-0000-4000-8810-000000000092", direction: "incoming", status: "declined", created_at: "2026-10-08T10:00:00Z", resend_available_at: "2026-10-08T10:00:00Z", email_enabled: true },
];
const manyContacts = (db) => patchRpc(db, "contacts_list", (prev, args, declined) => {
  const copy = (r, k, i) => ({ ...r, id: r.id.slice(0, -4) + String(9000 + k * 100 + i), friend_user_id: r.friend_user_id ? r.friend_user_id.slice(0, -4) + String(9000 + k * 100 + i) : null });
  if (args.p_kind === "friends") {
    const base = prev.filter((r) => r.direction === "friend");
    const extra = [];
    for (let k = 1; k <= 3; k++) base.forEach((r, i) => extra.push({ ...copy(r, k, i), label: `${r.label}_${k + 1}`, email: `${k + 1}.${r.email}` }));
    return [...prev, ...extra, ...declined];
  }
  const extra = [];
  for (let k = 1; k <= 3; k++) prev.forEach((r, i) => extra.push({ ...copy(r, k, i), email: `${k + 1}.${r.email}`, label: `${k + 1}.${r.label}` }));
  return [...prev, ...extra];
}, MANY_DECLINED);
const openDeclined = async (view) => { await view.locator('[data-section="declined"] .rowsSectionHead:visible').first().click(); await view.waitForTimeout(400); };

const futureRows = (keys, minutes) => `fn:() => ${JSON.stringify(keys)}.map((action_key, i) => ({ action_key, next_allowed_at: new Date(Date.now() + (${JSON.stringify(minutes)}[i] || 30) * 60e3).toISOString() }))`;

// Konto gościa (anonimowe logowanie z is_guest).
function asGuest(db, { infoShown = true } = {}) {
  db.user = { id: USER_ID, email: null, is_anonymous: true, user_metadata: { is_guest: true }, app_metadata: {}, created_at: "2026-10-19T10:00:00Z" };
  const profile = db.tables.profiles.find((p) => p.id === USER_ID);
  Object.assign(profile, { username: "guest_7f3a2c", email: null, is_guest: true, guest_expires_at: "2026-10-25T10:00:00Z" });
  db.rpc.guest_is_expired = false;
  db.rpc.guest_touch = null;
  db.localStorage = { ...(db.localStorage || {}) };
  if (infoShown) db.localStorage[`fam:guest:info_shown:${USER_ID}`] = "1";
}
// Użytkownik zwrócony przez link z e-maila (reset hasła, potwierdzenie konta) --
// ten sam użytkownik demo co na pozostałych zrzutach (panel.cjs), w języku sceny.
const linkAuth = (lang) => ({ exchangeCodeForSession: { user: { id: USER_ID, email: panel[lang].user.email, email_confirmed_at: "2026-04-03T10:00:00Z", user_metadata: { username: panel[lang].user.username } } } });
const nowPlus = (minutes) => new Date(Date.now() + minutes * 60e3).toISOString();

module.exports = [
  // ================= Znajomi =================
  { id: "people-friends-received", category: C, title: "Znajomi — zakładka Znajomi na telefonie (lista i zaproszenia otrzymane)", path: "/friends/?tab=received", devices: ["phone"], sources: FRIENDS, ready: contactsReady },
  { id: "people-friends-declined", category: C, title: "Znajomi — rozwinięta sekcja odrzuconych zaproszeń", path: "/friends/?tab=received", sources: FRIENDS, ready: contactsReady,
    db: (db) => patchRpc(db, "contacts_list", (prev, args, extra) => (args.p_kind === "friends" ? [...prev, ...extra] : prev), [
      { id: "00000000-0000-4000-8800-000000000091", label: "marek_wisniewski", email: null, friend_user_id: "00000000-0000-4000-8810-000000000091", direction: "incoming", status: "declined", created_at: "2026-10-12T10:00:00Z", resend_available_at: "2026-10-12T10:00:00Z", email_enabled: true },
      { id: "00000000-0000-4000-8800-000000000092", label: "zosia_k", email: null, friend_user_id: "00000000-0000-4000-8810-000000000092", direction: "incoming", status: "declined", created_at: "2026-10-08T10:00:00Z", resend_available_at: "2026-10-08T10:00:00Z", email_enabled: true },
    ]),
    steps: [async (view) => { const head = view.locator('[data-section="declined"] .rowsSectionHead').first(); await head.scrollIntoViewIfNeeded(); await head.click(); await view.waitForTimeout(400); await view.locator('[data-section="declined"] .shareRow').first().scrollIntoViewIfNeeded(); await view.waitForTimeout(200); }] },
  { id: "people-friends-half", category: C, title: "Znajomi — zakładka Znajomi: wiele osób, 2 propozycje, odrzucone zwinięte (sekcje dzielą wysokość karty)", path: "/friends/?tab=received", devices: ["phone", "desktop"], sources: FRIENDS, ready: contactsReady, db: manyContacts },
  { id: "people-friends-half-declined", category: C, title: "Znajomi — zakładka Znajomi: wiele osób, 2 propozycje, odrzucone rozwinięte (trzy sekcje dzielą wysokość)", path: "/friends/?tab=received", devices: ["phone", "desktop"], sources: FRIENDS, ready: contactsReady, db: manyContacts, steps: [openDeclined] },
  { id: "people-friends-empty", category: C, title: "Znajomi — pusta lista (brak znajomych i zaproszeń)", path: "/friends/", sources: FRIENDS, ready: "#contactsHost.skel-step-ready",
    db: (db) => { patchRpc(db, "contacts_list", (prev, args) => (args.p_kind === "friends" ? [] : prev)); db.rpc.badges_get = { friends_pending: 0 }; } },
  { id: "people-friends-empty-received", category: C, title: "Znajomi — pusta zakładka Znajomi na telefonie", path: "/friends/?tab=received", devices: ["phone"], sources: FRIENDS, ready: "#contactsHost.skel-step-ready",
    db: (db) => { patchRpc(db, "contacts_list", (prev, args) => (args.p_kind === "friends" ? [] : prev)); db.rpc.badges_get = { friends_pending: 0 }; } },
  { id: "people-friends-confirm-remove", category: C, title: "Znajomi — potwierdzenie usunięcia znajomego", path: "/friends/?tab=received", sources: FRIENDS, ready: contactsReady,
    steps: [openModal('[data-section="friend"] .shareRow button[data-act="remove"]')] },
  { id: "people-friends-confirm-cancel", category: C, title: "Znajomi — potwierdzenie wycofania wysłanego zaproszenia", path: "/friends/", sources: FRIENDS, ready: contactsReady,
    steps: [openModal('#contactsOutgoing .shareRow button[data-act="cancel"]')] },
  { id: "people-friends-confirm-reject", category: C, title: "Znajomi — potwierdzenie odrzucenia otrzymanego zaproszenia", path: "/friends/?tab=received", sources: FRIENDS, ready: contactsReady,
    steps: [openModal('[data-section="incoming"] .shareRow button[data-act="reject"]')] },
  { id: "people-friends-resend-cooldown", category: C, title: "Znajomi — wysłane zaproszenia z odliczaniem do ponownej wysyłki", path: "/friends/", sources: [...FRIENDS, "web/shared/js/core/cooldown.js"], ready: contactsReady,
    db: (db) => patchRpc(db, "contacts_list", (prev, args) => prev.map((r, i) => (args.p_kind === "friends" && r.direction === "outgoing" && r.status === "pending" ? { ...r, resend_available_at: new Date(Date.now() + (47 + i * 13) * 60e3).toISOString() } : r))),
    steps: [wait(1200)] },
  { id: "people-friends-invite-sent", category: C, title: "Znajomi — zaproszenie wysłane (komunikat)", path: "/friends/", sources: FRIENDS, ready: contactsReady,
    db: (db) => { db.rpc.friends_invite = { ok: true, mail_allowed: false, id: "00000000-0000-4000-8800-000000000099" }; },
    steps: [fill([["#inviteInput", "ewa_lis"]]), click("#btnInvite"), toastShown] },
  { id: "people-friends-invite-already", category: C, title: "Znajomi — zaproszenie do kogoś, kto już jest znajomym (komunikat i wskazanie wiersza)", path: "/friends/", sources: FRIENDS, ready: contactsReady,
    db: (db) => { db.rpc.friends_invite = { ok: false, err: "already", status: "active", direction: "friend", id: "00000000-0000-4000-8800-000000000001" }; },
    steps: [fill([["#inviteInput", "aleksandra_nowak"]]), click("#btnInvite"), toastShown] },
  { id: "people-friends-invite-email-only", category: C, title: "Znajomi — adres bez konta: okno z przejściem do Subskrybentów", path: "/friends/", sources: FRIENDS, ready: contactsReady,
    db: (db) => { db.rpc.friends_invite = { ok: false, err: "not_found", has_email_only: true }; },
    steps: [fill([["#inviteInput", "ktos@example.test"]]), openModal("#btnInvite")] },
  { id: "people-friends-load-failed", category: C, title: "Znajomi — błąd wczytywania listy (przycisk Ponów)", path: "/friends/", sources: FRIENDS, ready: "#contactsLoadRetryWrap:not([hidden])",
    db: (db) => { db.rpc.contacts_list = { ok: false, err: "network" }; },
    steps: [wait(300)] },
  { id: "people-friends-guest", category: C, title: "Znajomi — konto gościa: strona niedostępna (nakładka)", path: "/friends/", sources: [...FRIENDS, "web/shared/js/core/page-overlay.js"], ready: ".blocking-overlay",
    db: (db) => asGuest(db) },

  // ================= Subskrybenci =================
  { id: "people-subscribers-received", category: C, title: "Subskrybenci — zakładka Subskrybenci na telefonie (aktywni)", path: "/subscribers/?tab=received", devices: ["phone"], sources: SUBS, ready: contactsReady },
  { id: "people-subscribers-half", category: C, title: "Subskrybenci — wiele subskrybentów i wysłanych zaproszeń (sekcje dzielą wysokość karty)", path: "/subscribers/?tab=received", devices: ["phone", "desktop"], sources: SUBS, ready: contactsReady, db: manyContacts },
  { id: "people-subscribers-half-invite", category: C, title: "Subskrybenci — zakładka Zaproś: formularz i długa lista wysłanych zaproszeń", path: "/subscribers/", devices: ["phone"], sources: SUBS, ready: contactsReady, db: manyContacts },
  { id: "people-subscribers-empty", category: C, title: "Subskrybenci — pusta lista (brak subskrybentów i zaproszeń)", path: "/subscribers/", sources: SUBS, ready: "#contactsHost.skel-step-ready",
    db: (db) => patchRpc(db, "contacts_list", (prev, args) => (args.p_kind === "friends" ? prev : [])) },
  { id: "people-subscribers-empty-received", category: C, title: "Subskrybenci — pusta zakładka Subskrybenci na telefonie", path: "/subscribers/?tab=received", devices: ["phone"], sources: SUBS, ready: "#contactsHost.skel-step-ready",
    db: (db) => patchRpc(db, "contacts_list", (prev, args) => (args.p_kind === "friends" ? prev : [])) },
  { id: "people-subscribers-confirm-remove", category: C, title: "Subskrybenci — potwierdzenie usunięcia subskrybenta", path: "/subscribers/?tab=received", sources: SUBS, ready: contactsReady,
    steps: [openModal('[data-section="active"] .shareRow button[data-act="remove"]')] },
  { id: "people-subscribers-confirm-cancel", category: C, title: "Subskrybenci — potwierdzenie usunięcia oczekującego zaproszenia", path: "/subscribers/", sources: SUBS, ready: contactsReady,
    steps: [openModal('#contactsOutgoing .shareRow button[data-act="remove"]')] },
  { id: "people-subscribers-resend-cooldown", category: C, title: "Subskrybenci — oczekujące zaproszenie z odliczaniem do ponownej wysyłki", path: "/subscribers/", sources: [...SUBS, "web/shared/js/core/cooldown.js"], ready: contactsReady,
    db: (db) => patchRpc(db, "contacts_list", (prev, args) => prev.map((r) => (args.p_kind !== "friends" && r.status === "pending" ? { ...r, resend_available_at: new Date(Date.now() + 38 * 60e3).toISOString() } : r))),
    steps: [wait(1200)] },
  { id: "people-subscribers-has-account", category: C, title: "Subskrybenci — adres z kontem: okno z przejściem do Znajomych", path: "/subscribers/", sources: SUBS, ready: contactsReady,
    db: (db) => { db.rpc.subscribers_invite = { ok: false, err: "has_account" }; },
    steps: [fill([["#inviteInput", "aleksandra@example.com"]]), openModal("#btnInvite")] },

  // ================= Centrum maili =================
  { id: "people-mails-items", category: C, title: "Centrum maili — zakładka Zadania (ankiety i urządzenia)", path: "/mails/?tab=items", sources: MAILS, ready: "#itemsList > *" },
  { id: "people-mails-empty", category: C, title: "Centrum maili — puste listy subskrypcji", path: "/mails/", sources: MAILS, ready: "#subscriptionList > *",
    db: (db) => { db.http["/_api/mail/session"] = { ...db.http["/_api/mail/session"], subscriptions: [], items: [] }; } },
  { id: "people-mails-empty-items", category: C, title: "Centrum maili — pusta zakładka Zadania", path: "/mails/?tab=items", sources: MAILS, ready: "#itemsList > *",
    db: (db) => { db.http["/_api/mail/session"] = { ...db.http["/_api/mail/session"], items: [] }; } },
  { id: "people-mails-disabled", category: C, title: "Centrum maili — powiadomienia wyłączone (wypisany adres)", path: "/mails/", sources: MAILS, ready: "#mailSummary.skel-step-ready",
    db: (db) => { db.http["/_api/mail/session"] = { ...db.http["/_api/mail/session"], notifications_enabled: false }; } },
  { id: "people-mails-resign-confirm", category: C, title: "Centrum maili — potwierdzenie wypisania z powiadomień", path: "/mails/", sources: MAILS, ready: "#subscriptionList > *",
    steps: [openModal("#mailPreferenceButton")] },
  { id: "people-mails-decline-confirm", category: C, title: "Centrum maili — potwierdzenie rezygnacji z subskrypcji", path: "/mails/", sources: MAILS, ready: "#subscriptionList > *",
    steps: [openModal(".mail-row--subscription .shareRowActions button:last-child")] },
  { id: "people-mails-decline-poll", category: C, title: "Centrum maili — potwierdzenie odrzucenia ankiety", path: "/mails/?tab=items", sources: MAILS, ready: "#itemsList > *",
    steps: [openModal(".mail-row--poll .shareRowActions button")] },
  { id: "people-mails-entry", category: C, title: "Centrum maili — wejście bez sesji (formularz adresu)", path: "/mails/", guest: true, sources: MAILS, ready: "#mailForm:not([hidden])",
    db: (db) => { db.http["/_api/mail/session"] = { ok: false, error: "no_session" }; } },
  { id: "people-mails-sent", category: C, title: "Centrum maili — link wysłany (odliczanie do ponownej wysyłki)", path: "/mails/", guest: true, sources: MAILS, ready: "#mailForm:not([hidden])",
    db: (db) => { db.http["/_api/mail/session"] = { ok: false, error: "no_session" }; db.http["/_api/mail/request"] = { ok: true, cooldown_seconds: 60 }; },
    steps: [fill([["#mailInput", "anna.nowak@example.com"]]), click("#mailForm button[type=submit]"), wait(600)] },
  { id: "people-mails-registered", category: C, title: "Centrum maili — adres z kontem: zaloguj się", path: "/mails/", guest: true, sources: MAILS, ready: "#mailActions:not([hidden])",
    db: (db, lang) => { db.http["/_api/mail/session"] = { ok: false, error: "requires_login", email: USER_EMAIL(lang) }; } },
  { id: "people-mails-expired", category: C, title: "Centrum maili — link wygasł", path: "/mails/", guest: true, sources: MAILS, ready: "#mailForm:not([hidden])",
    db: (db) => { db.http["/_api/mail/session"] = { ok: false, error: "expired_session" }; } },
  { id: "people-mails-confirm", category: C, title: "Centrum maili — potwierdzenie adresu z linku (Otwórz centrum)", path: "/mails/?m=screensAccessToken", guest: true, sources: MAILS, ready: "#mailActions:not([hidden])",
    db: (db) => { db.http["/_api/mail/session"] = { ok: false, error: "no_session" }; db.http["/_api/mail/peek"] = { ok: true, purpose: "verification" }; } },

  // ================= Konto =================
  { id: "people-account-email-pending", category: C, title: "Konto — zmiana e-maila w toku (Anuluj / Wyślij ponownie)", path: "/account/", sources: ACCOUNT, ready: "#emailPendingActions:not([hidden])",
    db: (db) => { db.user.user_metadata = { ...db.user.user_metadata, familijna_email_change_pending: "jan.nowy@example.com" }; } },
  { id: "people-account-cooldowns", category: C, title: "Konto — blokady czasowe po zmianie nazwy, e-maila i hasła", path: "/account/", sources: ACCOUNT, ready: "#usernameCooldown:not([hidden])",
    db: (db) => { db.rpc.cooldown_get = futureRows(["account:username", "account:email", "account:password"], [42, 18, 55]); } },
  { id: "people-account-username-saved", category: C, title: "Konto — nazwa użytkownika zapisana (komunikat)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    db: (db) => { db.rpc.cooldown_reserve = `fn:() => [{ ok: true, next_allowed_at: new Date(Date.now() + 3600e3).toISOString() }]`; },
    steps: [fill([["#username", "Jan_Kowalski_2"]]), click("#saveUsername"), toastShown] },
  { id: "people-account-password-mismatch", category: C, title: "Konto — zmiana hasła: hasła różnią się (błąd)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [fill([["#pass1", "NoweHaslo#2026"], ["#pass2", "NoweHaslo#2025"]]), click("#savePass"), toastShown] },
  { id: "people-account-password-weak", category: C, title: "Konto — zmiana hasła: za słabe hasło (błąd)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [fill([["#pass1", "haslo"], ["#pass2", "haslo"]]), click("#savePass"), toastShown] },
  { id: "people-account-email-sent", category: C, title: "Konto — zmiana e-maila wysłana (komunikat)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    db: (db) => { db.rpc.cooldown_reserve = `fn:() => [{ ok: true, next_allowed_at: new Date(Date.now() + 3600e3).toISOString() }]`; db.rpc.initiate_email_change_intent = { ok: true }; },
    steps: [fill([["#email", "jan.nowy@example.com"], ["#email2", "jan.nowy@example.com"]]), click("#saveEmail"), toastShown] },
  { id: "people-account-email-mismatch", category: C, title: "Konto — zmiana e-maila: adresy różnią się (błąd)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [fill([["#email", "jan.nowy@example.com"], ["#email2", "jan.nowy@exmaple.com"]]), click("#saveEmail"), toastShown] },
  { id: "people-account-notif-confirm", category: C, title: "Konto — potwierdzenie wyłączenia powiadomień e-mail", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [async (view) => { await view.locator("#emailNotifSection").scrollIntoViewIfNeeded(); }, openModal("#emailNotifications")] },
  { id: "people-account-demo-confirm", category: C, title: "Konto — potwierdzenie przywrócenia materiałów demo", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [async (view) => { await view.locator("#demoSection").scrollIntoViewIfNeeded(); }, openModal("#demoRestoreBtn")] },
  { id: "people-account-delete-missing", category: C, title: "Konto — usuwanie bez hasła (błąd)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [async (view) => { await view.locator("#deleteSection").scrollIntoViewIfNeeded(); }, click("#deleteAccount"), toastShown] },
  via({ id: "people-account-delete-wrong", category: C, title: "Konto — usuwanie z błędnym hasłem (błąd)", path: "/account/", sources: ACCOUNT, ready: "#ratingEditBtn",
    steps: [async (view) => { await view.locator("#deleteSection").scrollIntoViewIfNeeded(); }, fill([["#deletePassword", "ZleHaslo#1"]]), click("#deleteAccount"), toastShown] },
  { turnstile: false, auth: { signInWithPassword: { error: "Invalid login credentials" } } }),
  { id: "people-account-guest", category: C, title: "Konto gościa — zachęta do zapisania danych (zamiana na konto)", path: "/account/", sources: [...ACCOUNT, "web/shared/js/core/guest-mode.js"], ready: "#migrateSection:not([hidden])",
    db: (db) => asGuest(db) },
  { id: "people-account-guest-info", category: C, title: "Konto gościa — okno informacji dla gościa (jak zapisać dane)", path: "/account/", sources: [...ACCOUNT, "web/shared/js/core/guest-info-modal.js"], ready: MODAL,
    db: (db) => asGuest(db, { infoShown: false }) },
  { id: "people-account-guest-migrate-sent", category: C, title: "Konto gościa — wysłany link potwierdzający zamianę na konto", path: "/account/", sources: ACCOUNT, ready: "#migrateSection:not([hidden])",
    db: (db) => { asGuest(db); db.rpc.mail_cooldown_email_reserve = `fn:() => [{ ok: true, next_allowed_at: new Date(Date.now() + 3600e3).toISOString() }]`; db.rpc.guest_stage_migration = { ok: true }; },
    steps: [fill([["#migrateUsername", "ola_gra"], ["#migrateEmail", "ola@example.test"], ["#migratePass1", "Familijna#2026"], ["#migratePass2", "Familijna#2026"]]), click("#btnMigrate"), waitFor("#migratePendingActions:not([hidden])"), toastShown] },
  { id: "people-account-guest-delete", category: C, title: "Konto gościa — potwierdzenie usunięcia konta", path: "/account/", sources: ACCOUNT, ready: "#migrateSection:not([hidden])",
    db: (db) => asGuest(db),
    steps: [openModal("#deleteAccount")] },

  // ================= Logowanie =================
  // Każda scena logowania przez via(): atrapa Turnstile od pierwszego wczytania.
  ...[
    { id: "people-login", guest: true, title: "Logowanie — formularz", steps: [textIn("#status", 3)] },
    { id: "people-login-missing", guest: true, title: "Logowanie — brak loginu lub hasła (błąd)",
      steps: [textIn("#status", 3), click("#btnPrimary"), textIn("#err")] },
    { id: "people-login-wrong-password", guest: true, title: "Logowanie — błędne hasło",
      db: (db) => { (db.http ||= {})["/_api/auth/login"] = { ok: false, error: "invalid_credentials" }; },
      steps: [textIn("#status", 3), fill([["#email", USER_EMAIL], ["#pass", "ZleHaslo#1"]]), click("#btnPrimary"), textIn("#err")] },
    { id: "people-login-unknown-user", guest: true, title: "Logowanie — nieznana nazwa użytkownika",
      db: (db) => { (db.http ||= {})["/_api/auth/login"] = { ok: false, error: "invalid_credentials" }; },
      steps: [textIn("#status", 3), fill([["#email", "nieznany_gracz"], ["#pass", "Haslo#2026"]]), click("#btnPrimary"), textIn("#err")] },
    { id: "people-login-register-mismatch", guest: true, title: "Rejestracja — hasła różnią się (błąd)",
      db: (db) => { (db.http ||= {})["/_api/auth/email-status"] = { ok: true, status: "none", intent: "signup" }; },
      steps: [textIn("#status", 3), click("#btnToggle"), fill([["#email", "nowy@example.test"], ["#pass", "Familijna#2026"], ["#pass2", "Familijna#2025"]]), click("#btnPrimary"), textIn("#err")] },
    { id: "people-login-register-weak", guest: true, title: "Rejestracja — za słabe hasło (błąd i zasady hasła)",
      db: (db) => { (db.http ||= {})["/_api/auth/email-status"] = { ok: true, status: "none", intent: "signup" }; },
      steps: [textIn("#status", 3), click("#btnToggle"), fill([["#email", "nowy@example.test"], ["#pass", "haslo"], ["#pass2", "haslo"]]), click("#btnPrimary"), textIn("#err")] },
    { id: "people-login-register-sent", guest: true, title: "Rejestracja — link aktywacyjny wysłany",
      db: (db) => { db.http ||= {}; db.http["/_api/auth/email-status"] = { ok: true, status: "none", intent: "signup" }; db.http["/_api/auth/signup"] = { ok: true }; },
      steps: [textIn("#status", 3), click("#btnToggle"), fill([["#email", "nowy@example.test"], ["#pass", "Familijna#2026"], ["#pass2", "Familijna#2026"]]), click("#btnPrimary"),
        async (view) => { await view.waitForFunction(() => !document.getElementById("btnPrimary").disabled, null, { timeout: 8000 }); await view.waitForTimeout(300); }] },
    { id: "people-login-email-registered", guest: true, title: "Rejestracja — adres już zarejestrowany (okno)",
      db: (db) => { (db.http ||= {})["/_api/auth/email-status"] = { ok: true, status: "confirmed", intent: "signup" }; },
      steps: [textIn("#status", 3), click("#btnToggle"), fill([["#email", USER_EMAIL], ["#pass", "Familijna#2026"], ["#pass2", "Familijna#2026"]]), openModal("#btnPrimary")] },
    { id: "people-login-email-pending", guest: true, title: "Rejestracja — konto czeka na potwierdzenie (wysłać link ponownie?)",
      db: (db) => { (db.http ||= {})["/_api/auth/email-status"] = { ok: true, status: "pending", intent: "signup" }; },
      steps: [textIn("#status", 3), click("#btnToggle"), fill([["#email", "nowy@example.test"], ["#pass", "Familijna#2026"], ["#pass2", "Familijna#2026"]]), openModal("#btnPrimary")] },
    { id: "people-login-forgot-missing", guest: true, title: "Przypomnienie hasła — brak loginu (błąd)",
      steps: [textIn("#status", 3), click("#btnForgot"), textIn("#err")] },
    { id: "people-login-forgot-sent", guest: true, title: "Przypomnienie hasła — link wysłany (odliczanie)", auth: { resetPasswordForEmail: {} },
      db: (db) => { db.rpc.mail_cooldown_email_reserve = `fn:() => [{ ok: true, next_allowed_at: new Date(Date.now() + 3600e3).toISOString() }]`; },
      steps: [textIn("#status", 3), fill([["#email", USER_EMAIL]]), wait(600), click("#btnForgot"), waitFor("#forgotCooldown:not([hidden])")] },
    { id: "people-login-forgot-username", guest: true, title: "Przypomnienie hasła po nazwie użytkownika — link wysłany (odliczanie)",
      db: (db) => { (db.http ||= {})["/_api/auth/reset"] = { ok: true, sent: true, next_allowed_at: new Date(Date.now() + 3600e3).toISOString() }; },
      steps: [textIn("#status", 3), fill([["#email", "jan_kowalski"]]), click("#btnForgot"), waitFor("#forgotCooldown:not([hidden])")] },
    { id: "people-login-guest-expired", guest: true, title: "Logowanie — konto gościa wygasło (okno)", path: "/login/?guest_expired=1", ready: MODAL },
    { id: "people-login-force-auth", title: "Logowanie z konta gościa — informacja o zalogowaniu (okno)", path: "/login/?force_auth=1", ready: MODAL, db: (db) => asGuest(db) },
    { id: "people-login-guest-loss", title: "Logowanie z sesją gościa — ostrzeżenie o utracie danych gościa", db: (db) => asGuest(db),
      steps: [textIn("#status", 10), fill([["#email", USER_EMAIL], ["#pass", "Familijna#2026"]]), openModal("#btnPrimary")] },
    { id: "people-login-guest-migrate", title: "Rejestracja z sesji gościa — przenieść dane gościa? (okno)",
      db: (db) => { asGuest(db); (db.http ||= {})["/_api/auth/email-status"] = { ok: true, status: "none", intent: "signup" }; },
      steps: [textIn("#status", 10), click("#btnToggle"), fill([["#email", "ola@example.test"], ["#pass", "Familijna#2026"], ["#pass2", "Familijna#2026"]]), openModal("#btnPrimary")] },
    { id: "people-login-guest-session", title: "Logowanie — aktywna sesja gościa (powrót do konta gościa)", steps: [textIn("#status", 10)],
      db: (db) => asGuest(db) },
    { id: "people-login-setup-username", title: "Pierwsze logowanie — ustaw nazwę użytkownika", ready: "#setupCard:not([hidden])",
      db: (db) => { db.user.user_metadata = {}; db.tables.profiles.find((p) => p.id === USER_ID).username = null; } },
  ].map(({ auth, db: sceneDb, ...s }) => via({ category: C, path: "/login/", sources: LOGIN, ready: "#btnPrimary", ...s,
    // Odliczanie „Przypomnij hasło” sprawdzane po wpisaniu adresu: domyślnie brak blokady.
    db: (db, lang) => { db.rpc.mail_cooldown_email_check = [{ ok: true, next_allowed_at: null }]; if (sceneDb) sceneDb(db, lang); } }, { auth })),

  // ================= Reset hasła =================
  { id: "people-reset-missing", guest: true, category: C, title: "Reset hasła — brak kodu w linku", path: "/login/reset/", sources: RESET, ready: "#back:not([hidden])" },
  via({ id: "people-reset-form", guest: true, category: C, title: "Reset hasła — formularz nowego hasła", path: "/login/reset/?code=screensResetCode", sources: RESET, ready: "#form" },
    { turnstile: false, auth: linkAuth }),
  via({ id: "people-reset-mismatch", guest: true, category: C, title: "Reset hasła — hasła różnią się (błąd)", path: "/login/reset/?code=screensResetCode", sources: RESET, ready: "#form",
    steps: [fill([["#p1", "Familijna#2026"], ["#p2", "Familijna#2025"]]), click("#save"), textIn("#err")] },
  { turnstile: false, auth: linkAuth }),
  via({ id: "people-reset-saved", guest: true, category: C, title: "Reset hasła — hasło zapisane", path: "/login/reset/?code=screensResetCode", sources: RESET, ready: "#form", settle: 50,
    steps: [fill([["#p1", "Familijna#2026"], ["#p2", "Familijna#2026"]]), click("#save"), waitFor("#back")] },
  { turnstile: false, auth: linkAuth }),
  via({ id: "people-reset-failed", guest: true, category: C, title: "Reset hasła — link nieważny lub wygasł", path: "/login/reset/?code=screensResetCode", sources: RESET, ready: "#back:not([hidden])" },
    { turnstile: false, auth: { exchangeCodeForSession: { error: "Email link is invalid or has expired", status: 403 } } }),
  { id: "people-reset-session-switch", category: C, title: "Reset hasła — zalogowany na innym koncie (okno przełączenia)", path: "/login/reset/?code=screensResetCode", sources: RESET, ready: MODAL },

  // ================= Potwierdzenie konta =================
  { id: "people-confirm-missing", guest: true, category: C, title: "Potwierdzenie konta — brak kodu w linku", path: "/login/confirm/", sources: CONFIRM, ready: "#back:not([hidden])" },
  { id: "people-confirm-invalid", guest: true, category: C, title: "Potwierdzenie konta — link nieważny", path: "/login/confirm/?error=access_denied&error_description=Email+link+is+invalid+or+has+expired", sources: CONFIRM, ready: "#back:not([hidden])" },
  { id: "people-confirm-used", guest: true, category: C, title: "Potwierdzenie konta — link już użyty", path: "/login/confirm/?error_description=Link+has+already+been+used", sources: CONFIRM, ready: "#back:not([hidden])" },
  { id: "people-confirm-first-link", guest: true, category: C, title: "Zmiana e-maila — pierwszy link potwierdzony, czeka drugi", path: "/login/confirm/?message=Confirmation+link+accepted.+Please+proceed+to+confirm+link+sent+to+the+other+email", sources: CONFIRM, ready: "#back:not([hidden])" },
  // Po „konto aktywne” strona sama przechodzi dalej po 0,7 s -- zrzut od razu (settle).
  via({ id: "people-confirm-done", guest: true, category: C, title: "Potwierdzenie konta — konto aktywne (Przejdź do panelu)", path: "/login/confirm/?code=screensConfirmCode", sources: CONFIRM, ready: "#go:not([hidden])", settle: 50 },
    { turnstile: false, auth: linkAuth }),
  via({ id: "people-confirm-email-change-cancelled", guest: true, category: C, title: "Zmiana e-maila — zmiana anulowana (link nieaktualny)", path: "/login/confirm/?token_hash=screensHash&type=email_change&to=jan.nowy%40example.com", sources: CONFIRM, ready: "#back:not([hidden])",
    db: (db) => { db.rpc.get_email_intent_status = "expired"; } },
  { turnstile: false, auth: { verifyOtp: { error: "Token has expired or is invalid", status: 403 } } }),
  { id: "people-confirm-session-switch", category: C, title: "Potwierdzenie konta — zalogowany na innym koncie (okno przełączenia)", path: "/login/confirm/?code=screensConfirmCode", sources: CONFIRM, ready: MODAL },

  // ================= Przerwa techniczna =================
  { id: "people-maintenance", guest: true, category: C, title: "Przerwa techniczna — komunikat", path: "/maintenance/", sources: MAINT, ready: "main.skel-step-ready",
    db: (db) => { db.http["/maintenance-state.json*"] = { enabled: true, mode: "message" }; } },
  { id: "people-maintenance-return-at", guest: true, category: C, title: "Przerwa techniczna — godzina powrotu", path: "/maintenance/", sources: MAINT, ready: "#countdown:not([hidden])",
    db: (db) => { db.http["/maintenance-state.json*"] = { enabled: true, mode: "returnAt", returnAt: "2026-11-02T18:30:00+01:00" }; } },
  { id: "people-maintenance-countdown", guest: true, category: C, title: "Przerwa techniczna — odliczanie do powrotu", path: "/maintenance/", sources: MAINT, ready: "#countdown:not([hidden])",
    db: (db) => { db.http["/maintenance-state.json*"] = { enabled: true, mode: "countdown", returnAt: nowPlus(24 * 60 * 3 + 125) }; } },
  { id: "people-maintenance-custom", guest: true, category: C, title: "Przerwa techniczna — własny komunikat z licznikiem", path: "/maintenance/", sources: MAINT, ready: "#customContent:not([hidden])",
    db: (db) => { db.http["/maintenance-state.json*"] = { enabled: true, mode: "countdown", returnAt: nowPlus(24 * 60 * 2 + 30), useStandardText: false,
      customComments: { pl: "Aktualizujemy bazę pytań i Wyświetlacz.\nWracamy za #timer — dziękujemy za cierpliwość!", en: "We are updating the question bases and the Display.\nBack in #timer — thanks for your patience!", uk: "Оновлюємо бази питань і Дисплей.\nПовернемося через #timer — дякуємо за терпіння!" } }; } },

  // ================= Prywatność i 404 =================
  { id: "people-privacy", guest: true, category: C, title: "Polityka prywatności — bez konta", path: "/privacy/", sources: page("privacy"), ready: "main.skel-step-ready" },
  { id: "people-privacy-user", category: C, title: "Polityka prywatności — zalogowany (konto w nagłówku)", path: "/privacy/", sources: page("privacy"), ready: "main.skel-step-ready" },
  { id: "people-404", guest: true, category: C, title: "Strona 404 — bez konta", path: "/404.html", sources: ["web/404.html", "web/404/"], ready: "main.skel-step-ready" },
  { id: "people-404-user", category: C, title: "Strona 404 — zalogowany (powrót do Moich gier)", path: "/404.html", sources: ["web/404.html", "web/404/"], ready: "#notFoundMyGames:not([hidden])" },
];
