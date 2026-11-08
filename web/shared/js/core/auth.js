import { redirectPage } from "./page-layout.js?v=v2026-11-08T17365";
// js/core/auth.js
import { icon } from "./icons.js?v=v2026-11-08T17365";
import { sb, buildSiteUrl } from "./supabase.js?v=v2026-11-08T17365";
import { t, withLangParam } from "../../translation/translation.js?v=v2026-11-08T17365";


const GUEST_LOCAL_MARKER_KEY = "fam:guest:session_seen";
const GUEST_DISCARD_RPC_MISSING_KEY = "fam:guest:discard_rpc_missing";

function buildAuthRedirect(page, lang) {
  // page: "/login/confirm/" lub "/login/reset/"
  const p = String(page || "").trim();
  const path = p.startsWith("/") ? p : `/${p}`;
  const url = new URL(buildSiteUrl(path)); // buildSiteUrl zwraca absolutny URL w Twoim projekcie
  const l = String(lang || "").trim().toLowerCase();
  if (l) url.searchParams.set("lang", l);
  return url.toString();
}

export function niceAuthError(e) {
  // Goal: keep Supabase / GoTrue error *content*, but show it in UI language when we know how.
  // If we don't recognize the message, we return the original message (better than hiding details).
  const msg =
    (e?.message ||
      e?.error_description ||
      e?.description ||
      (typeof e === "string" ? e : "") ||
      // Obiekt bez komunikatu: ogólny tekst zamiast „[object Object]”.
      (e && typeof e === "object" ? "" : String(e || ""))).trim();

  if (!msg) return t("auth.loginFailed");

  const low = msg.toLowerCase();
  const status = Number(e?.status || e?.statusCode || 0) || 0;

  // 1) Very common auth messages (stable)
  if (low.includes("email not confirmed")) return t("auth.emailNotConfirmed");
  if (low.includes("invalid login credentials")) return t("auth.invalidCredentials");
  if (low.includes("anonymous sign-ins are disabled")) {
    return "Anonymous sign-ins are disabled. Enable Anonymous auth and CAPTCHA in Supabase Auth settings.";
  }

  // Limit częstotliwości maili GoTrue: "...you can only request this after 53 seconds."
  const wait = low.match(/only request this after (\d+) seconds?/);
  if (wait) return t("auth.errResendCooldown", { time: `${wait[1]} s` });

  // 2) "New password should be different from the old password."
  if (low.includes("new password should be different")) return t("auth.passwordMustDiffer");

  // 3) Password length (Supabase sometimes enforces min 6 even if app uses stronger rules)
  // Examples: "Password should be at least 6 characters."
  let m = low.match(/password\s+should\s+be\s+at\s+least\s+(\d+)\s+characters?/i);
  if (m && m[1]) return t("auth.passwordTooShortMin", { min: Number(m[1]) });

  // 4) Rate limit with seconds:
  // "For security purposes, you can only request this once every 60 seconds."
  m = low.match(/for security purposes[\s\S]*once every\s+(\d+)\s+seconds?/i);
  if (m && m[1]) return t("auth.errSecurityOnceEvery", { seconds: Number(m[1]) });

  // 5) Email rate limit:
  // "Email rate limit exceeded"
  if (low.includes("email rate limit exceeded")) return t("auth.errEmailRateLimitExceeded");

  // 6) Generic "Too many requests" (without seconds) - translate, but keep meaning
  if (low.includes("too many requests")) return t("auth.tooManyRequests");

  if (
    low.includes("captcha") &&
    (low.includes("invalid") || low.includes("failed") || low.includes("required"))
  ) {
    // Auth API can sometimes return 5xx with captcha-related text although the issue is backend-side.
    // In that case, showing a hard captcha prompt is misleading and blocks normal login UX.
    if (status >= 500 || low.includes("unexpected_failure") || low.includes("internal")) {
      return t("auth.loginFailed");
    }
    return t("auth.captchaRequired");
  }

  // 7) Links / tokens
  if (
    low.includes("invalid or expired") ||
    (low.includes("token") && low.includes("expired")) ||
    (low.includes("otp") && low.includes("expired")) ||
    (low.includes("token") && low.includes("invalid")) ||
    low.includes("invalid otp")
  ) {
    return t("auth.linkInvalidOrExpired");
  }

  // 8) Registration duplicates
  if (low.includes("user already registered") || (low.includes("already") && low.includes("registered"))) {
    return t("auth.userAlreadyRegistered");
  }

  return msg;
}

function classifyAuthError(error) {
  const status = Number(error?.status || error?.statusCode || 0) || 0;
  const code = String(error?.code || error?.error_code || "").trim().toLowerCase();
  const rawMessage = String(
    error?.message || error?.error_description || error?.description || ""
  ).trim();

  let kind = "unknown";
  if (status === 0 || status >= 500) kind = "network";
  if (code.includes("captcha")) kind = "security";
  if (code === "invalid_login_credentials") kind = "invalid_login";
  if (status === 400 || status === 401) {
    if (/invalid|credential|password|email/i.test(rawMessage)) kind = "invalid_login";
  }

  return { status, code, rawMessage, kind };
}

// Logowanie, reset hasła i stan adresu przy rejestracji po stronie Workera
// (audyt E24, B7/B8): nazwa użytkownika -> e-mail tylko na serwerze.
async function authApi(path, body) {
  let res;
  try {
    res = await fetch(`/_api/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw Object.assign(new Error(t("auth.loginFailed")), { status: 0 });
  }
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data: data || {} };
}

// Błąd Workera w kształcie błędu GoTrue (te same komunikaty i ścieżki captcha).
function authApiError(status, code) {
  const raw = {
    invalid_credentials: "Invalid login credentials",
    email_not_confirmed: "Email not confirmed",
    captcha_failed: "captcha verification process failed",
    rate_limited: "Too many requests",
  }[code] || "";
  const err = new Error(raw ? niceAuthError({ message: raw, status }) : t("auth.loginFailed"));
  err.status = status;
  err.errorCode = code === "captcha_failed" ? "captcha_failed" : code || "";
  err.rawMessage = raw;
  err.errorKind = code === "invalid_credentials" ? "invalid_login" : code === "captcha_failed" ? "security" : status >= 500 ? "network" : "unknown";
  return err;
}

import { reservedUsernameReason, loadReservedUsernamePrefixes } from "./reserved-usernames.js?v=v2026-11-08T17365";

// Strony z polem nazwy (logowanie, Konto) pobierają listę zastrzeżonych przedrostków od wejścia.
export function preloadUsernameRules() { loadReservedUsernamePrefixes(sb()); }


export function validateUsername(un, { allowEmpty = false } = {}) {
  preloadUsernameRules();
  const v = String(un || "").trim();
  if (!v) {
    if (allowEmpty) return "";
    throw new Error(t("auth.enterUsername"));
  }
  // Reserve guest_* namespace for auto-generated guest usernames.
  // NOTE: guests will be prompted to change it after account upgrade.
  if (v.toLowerCase().startsWith("guest_")) throw new Error(t("auth.usernameReservedGuest"));
  const reserved=reservedUsernameReason(v);
  if (reserved) throw new Error(t("auth.errUsernameTaken"));
  if (v.length < 3) throw new Error(t("auth.usernameMin"));
  if (v.length > 20) throw new Error(t("auth.usernameMax"));
  if (!/^[a-zA-Z0-9_.-]+$/.test(v)) throw new Error(t("auth.usernameChars"));
  return v;
}

export function validatePassword(pwd) {
  const v = String(pwd || "");
  const hints = [];
  if (v.length < 8) hints.push(t("auth.passwordHintMin"));
  if (!/[a-z]/.test(v)) hints.push(t("auth.passwordHintLower"));
  if (!/[A-Z]/.test(v)) hints.push(t("auth.passwordHintUpper"));
  if (!/[0-9]/.test(v)) hints.push(t("auth.passwordHintNumber"));
  if (!/[^A-Za-z0-9]/.test(v)) hints.push(t("auth.passwordHintSpecial"));
  if (hints.length) {
    // Pełna lista wymagań stoi już w podpowiedzi przy polu -- błąd mówi tylko, czego brakuje.
    throw new Error(t("auth.passwordMissing", { hints: hints.join(", ") }));
  }
  return v;
}


function passwordRulesAllHints() {
  return [
    t("auth.passwordHintMin"),
    t("auth.passwordHintLower"),
    t("auth.passwordHintUpper"),
    t("auth.passwordHintNumber"),
    t("auth.passwordHintSpecial"),
  ];
}

/** Consistent password policy text to show in UI (index / reset / account). */
export function getPasswordRulesText() {
  return t("auth.passwordRules", { hints: passwordRulesAllHints().join(", ") });
}

let _unameCache = { userId: null, username: null, ts: 0 };

function normalizeUsername(v) {
  return String(v || "").trim();
}

function isGuestFromMetadata(user) {
  if (!user) return false;
  if (user?.user_metadata?.is_guest === true) return true;
  if (user?.app_metadata?.is_guest === true) return true;
  return false;
}

function isPlaceholderUsername(v) {
  const un = normalizeUsername(v).toLowerCase();
  if (!un) return true;
  // Placeholder / guest-like usernames should not count as a real username.
  // This fixes the case where the DB contains e.g. "guest_000000" for a registered user.
  if (un === "guest_000000") return true;
  if (un.startsWith("guest_")) return true;
  return false;
}

// cache ~2 min per user: { userId, username, is_guest, guest_expires_at, ts }
// Równoległe wywołania (initPage i przycisk konta w topbarze) czekają na
// jedno zapytanie zamiast wysyłać dwa (pomiar 2026-11-04).
let _profileInFlight = null; // { userId, promise }
async function fetchProfileRow(user) {
  if (!user?.id) return null;

  const now = Date.now();
  if (
    _unameCache.userId === user.id &&
    (now - _unameCache.ts) < 120_000
  ) {
    return _unameCache;
  }
  if (_profileInFlight?.userId === user.id) return _profileInFlight.promise;

  const promise = (async () => {
    try {
      const { data, error } = await sb()
        .from("profiles")
        .select("username,is_guest,guest_expires_at")
        .eq("id", user.id)
        .maybeSingle();

      if (!error && data) {
        const cached = {
          userId: user.id,
          username: data.username || null,
          is_guest: !!data.is_guest,
          guest_expires_at: data.guest_expires_at || null,
          ts: Date.now(),
        };
        _unameCache = cached;
        return cached;
      }
    } catch {}
    return null;
  })();
  const entry = { userId: user.id, promise };
  _profileInFlight = entry;
  promise.finally(() => { if (_profileInFlight === entry) _profileInFlight = null; });
  return promise;
}

async function fetchUsername(user) {
  if (!user?.id) return null;

  const row = await fetchProfileRow(user);

  // 1) profiles (źródło prawdy)
  if (row) {
    const candidate = normalizeUsername(row.username);
    const allowGuestPlaceholder = row.is_guest || isGuestFromMetadata(user);
    if (candidate && (!isPlaceholderUsername(candidate) || allowGuestPlaceholder)) {
      return candidate;
    }
  }

  // 2) fallback: user_metadata (np. świeża rejestracja)
  const un = normalizeUsername(user?.user_metadata?.username);
  const allowGuestPlaceholder = isGuestFromMetadata(user);
  if (un && (!isPlaceholderUsername(un) || allowGuestPlaceholder)) {
    return un;
  }

  // 3) guest fallback from email or id (when profile row is missing)
  if (isGuestFromMetadata(user)) {
    const mail = String(user?.email || "").trim().toLowerCase();
    if (mail.startsWith("guest_") && mail.endsWith("@guest.local")) {
      const candidate = mail.split("@")[0];
      if (candidate) return candidate;
    }
    if (user?.id) {
      const compact = String(user.id).replace(/-/g, "");
      return `guest_${compact.slice(0, 6)}`;
    }
  }

  return null;
}

async function enrichUser(u) {
  if (!u) return null;

  const row = await fetchProfileRow(u);

  const username = await fetchUsername(u);

  // Prefer DB flag, but keep metadata fallback to avoid transient races
  // right after anonymous sign-in when profile row may lag.
  const isGuest = (row ? row.is_guest : false) || isGuestFromMetadata(u);
  const guestExpiresAt = row?.guest_expires_at || null;

  return { ...u, username, is_guest: isGuest, guest_expires_at: guestExpiresAt };
}

// Użytkownik z sesji zapisanej w przeglądarce (getSession) — bez zapytania
// do serwera logowania przy każdym wejściu na stronę (jedna runda mniej,
// pomiar 2026-11-04). Baza i tak sprawdza token przy każdym zapytaniu.
// Raz na wczytanie strony sesję sprawdza serwer w tle; odrzucona (konto
// usunięte, wylogowanie na innym urządzeniu) → wylogowanie lokalne
// i przeładowanie, czyli zwykła ścieżka „brak sesji”.
// fresh: true — rekord prosto z serwera (aktualny e-mail i metadane:
// Konto, Go). Równoległe wywołania dzielą jedno zapytanie.
let _userInFlight = { fast: null, fresh: null };
let _sessionVerified = false;

function isRejectedSession(error) {
  if (!error) return false;
  if (error.name === "AuthSessionMissingError") return true;
  const status = Number(error.status || 0);
  return status === 401 || status === 403 || status === 404;
}

function verifySessionInBackground() {
  if (_sessionVerified) return;
  _sessionVerified = true;
  void (async () => {
    try {
      const { data, error } = await sb().auth.getUser();
      if (isRejectedSession(error) || (!error && !data?.user)) {
        try { await sb().auth.signOut({ scope: "local" }); } catch {}
        _unameCache = { userId: null, username: null, ts: 0 };
        location.reload();
      }
    } catch {}
  })();
}

async function loadUser(fresh) {
  try {
    if (!fresh) {
      const { data } = await sb().auth.getSession();
      const sessionUser = data?.session?.user || null;
      if (!sessionUser) return null;
      // Zapisanej sesji ufamy tylko, gdy baza przyjęła token (profil się
      // wczytał). Brak profilu (nieważny token, konto usunięte, świeża
      // rejestracja) — sprawdzenie u serwera jak dawniej, zanim strona
      // cokolwiek zdecyduje (inaczej nieważna sesja przekierowywała na
      // „ustaw nazwę”, e2e index „fałszywa sesja”, 2026-11-05).
      if (!(await fetchProfileRow(sessionUser))) return await loadUser(true);
      verifySessionInBackground();
      return await enrichUser(sessionUser);
    }
    const { data, error } = await sb().auth.getUser();
    _sessionVerified = true;
    if (error) return null;
    return await enrichUser(data.user || null);
  } catch {
    return null;
  }
}

export function getUser({ fresh = false } = {}) {
  const key = fresh ? "fresh" : "fast";
  if (_userInFlight[key]) return _userInFlight[key];
  const promise = loadUser(fresh);
  _userInFlight[key] = promise;
  promise.finally(() => { if (_userInFlight[key] === promise) _userInFlight[key] = null; });
  return promise;
}

export async function requireAuth(redirect, { fresh = false } = {}) {
  const u = await getUser({ fresh });
  if (!u) {
    redirectPage(withLangParam(redirect));
    return null; // na wypadek, gdyby ktoś jednak kontynuował kod
  }

  // Guest TTL check + touch
  if (u?.is_guest) {
    try {
      const { data: expired } = await sb().rpc("guest_is_expired", { p_user_id: u.id });
      if (expired === true) {
        await sb().auth.signOut();
        redirectPage(withLangParam("/login/?guest_expired=1"));
        return null;
      }
      await sb().rpc("guest_touch", { p_ttl_days: 5 });
    } catch {
      // fail-open: nie blokuj flow przy chwilowym błędzie RPC
    }
  }

  const username = await fetchUsername(u);
  // Guest accounts may not have a persisted username yet; do not bounce them.
  if (!username && !u?.is_guest) {
    redirectPage(withLangParam("/login/?setup=username"));
    return null;
  }
  // After guest -> registered upgrade, keep forcing a real username.
  if (!u?.is_guest && String(username || "").toLowerCase().startsWith("guest_")) {
    redirectPage(withLangParam("/login/?setup=username&guest_username=1"));
    return null;
  }
  return { ...u, username };
}

export async function signInGuest(captchaToken = null) {
  const options = { data: { is_guest: true } };
  if (captchaToken) options.captchaToken = captchaToken;

  const { data, error } = await sb().auth.signInAnonymously({ options });
  if (error) throw new Error(niceAuthError(error));
  const user = data?.user || null;
  if (!user) throw new Error(t("auth.loginFailed"));
  try { localStorage.setItem(GUEST_LOCAL_MARKER_KEY, "1"); } catch {}
  return user;
}


export function hasGuestLocalMarker() {
  try { return localStorage.getItem(GUEST_LOCAL_MARKER_KEY) === "1"; } catch { return false; }
}

export function clearGuestLocalMarker() {
  try { localStorage.removeItem(GUEST_LOCAL_MARKER_KEY); } catch {}
}

export function guestAuthEntryUrl() {
  return withLangParam("/login/?force_auth=1");
}

/**
 * Guest upgrade flow (migrate data): attach only email, require password/username
 * separately via guest_stage_migration() (caller's job). Nothing in profiles/
 * auth.users actually flips until the email is confirmed — guest_finalize_migration()
 * (called from confirm.js) does that. is_guest stays true the whole time: an
 * abandoned or cancelled attempt must never leave the account in limbo (neither
 * guest nor registered), which is exactly what happened before this account
 * used to flip is_guest here immediately, before confirmation.
 */
export async function convertGuestToRegisteredEmailOnly(email, language, captchaToken = null) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail || !mail.includes("@")) throw new Error(t("auth.errInvalidEmail"));

  const payload = {
    email: mail,
    data: {
      familijna_email_change_pending: mail,
      familijna_email_change_intent: "guest_migrate",
    },
  };
  if (language) payload.data.language = language;

  const confirmUrl = new URL(buildAuthRedirect("/login/confirm/", language));
  confirmUrl.searchParams.set("to", mail);

  const options = { emailRedirectTo: confirmUrl.toString() };
  if (captchaToken) options.captchaToken = captchaToken;

  const { data, error } = await sb().auth.updateUser(payload, options);
  if (error) throw new Error(niceAuthError(error));

  // Stan 'pending' w email_intents: po ewentualnym anulowaniu ('expired')
  // strona potwierdzenia rozpozna anulowaną zamianę, a nowa zamiana go zeruje.
  try { await sb().rpc("initiate_email_change_intent", { p_new_email: mail }); } catch {}

  return data?.user || null;
}

export async function discardCurrentGuestAccount() {
  let skipRpc = false;
  try {
    skipRpc = localStorage.getItem(GUEST_DISCARD_RPC_MISSING_KEY) === "1";
  } catch {}

  try {
    if (!skipRpc) {
      const { error } = await sb().rpc("guest_discard_current");
      if (error) {
        const status = Number(error?.status || error?.statusCode || 0) || 0;
        const msg = String(error?.message || error?.error || "").toLowerCase();
        // In environments without the RPC deployed yet, ignore 404 and memoize.
        if (status === 404 || msg.includes("not found")) {
          try { localStorage.setItem(GUEST_DISCARD_RPC_MISSING_KEY, "1"); } catch {}
        } else {
          throw new Error(niceAuthError(error));
        }
      }
    }
  } finally {
    clearGuestLocalMarker();
  }
}

async function signInWithUsername(username, password, captchaToken) {
  const { status, data } = await authApi("login", { login: username, password, ...(captchaToken ? { captcha_token: captchaToken } : {}) });
  if (status !== 200 || !data.ok || !data.session?.access_token) throw authApiError(status, data.error);
  const { data: set, error } = await sb().auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  if (error) throw new Error(niceAuthError(error));
  return set?.user || set?.session?.user || null;
}

export async function signIn(login, password, captchaToken = null) {
  const value = String(login || "").trim();
  if (!value) throw Object.assign(new Error(t("auth.unknownUsername")), { status: 400, errorCode: "unknown_username" });

  let user;
  if (value.includes("@")) {
    const payload = { email: value.toLowerCase(), password };
    if (captchaToken) payload.options = { captchaToken };

    const { data, error } = await sb().auth.signInWithPassword(payload);
    if (error) {
      const classified = classifyAuthError(error);
      const wrapped = new Error(niceAuthError(error));
      wrapped.status = classified.status;
      wrapped.errorCode = classified.code;
      wrapped.rawMessage = classified.rawMessage;
      wrapped.errorKind = classified.kind;
      throw wrapped;
    }
    user = data.user;
  } else {
    user = await signInWithUsername(value, password, captchaToken);
  }
  if (!user) throw new Error(t("auth.loginFailed"));

  if (!user.email_confirmed_at) {
    await sb().auth.signOut();
    throw new Error(t("auth.confirmEmailFirst"));
  }
  _unameCache = { userId: null, username: null, ts: 0 };
  return user;
}

export async function signUp(email, password, redirectTo, usernameInput, language, captchaToken = null) {
  const username = validateUsername(usernameInput, { allowEmpty: true });
  const userData = username ? { username } : null;

  // ✅ absolutny redirect + lang (bez withLangParam)
  const emailRedirectTo = redirectTo || buildAuthRedirect("/login/confirm/", language);

  const options = { emailRedirectTo };
  if (userData || language) {
    options.data = { ...(userData || {}) };
    if (language) options.data.language = language;
  }
  if (captchaToken) options.captchaToken = captchaToken;

  const { error } = await sb().auth.signUp({ email, password, options });
  if (error) throw new Error(niceAuthError(error));
}

export async function getEmailStatus(email, captchaToken = null) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) throw new Error(t("auth.errInvalidEmail"));

  const { status, data } = await authApi("email-status", { email: normalized, ...(captchaToken ? { captcha_token: captchaToken } : {}) });
  if (status === 429) throw new Error(t("auth.tooManyRequests"));
  if (data.error === "captcha_failed") throw authApiError(status, data.error);
  if (status !== 200 || !data.ok) throw new Error(t("auth.statusError"));

  const statusRaw = String(data.status || "").trim().toLowerCase();
  return {
    status: statusRaw === "confirmed" || statusRaw === "pending" ? statusRaw : "none",
    intent: data.intent === "guest_migrate" ? "guest_migrate" : "signup",
  };
}

// Ponowne wysłanie potwierdzenia: rezerwacja cooldownu na serwerze.
// { allowed, nextAllowedAtMs } -- bez informacji o stanie konta.
export async function prepareConfirmationResend(email, intent, captchaToken = null) {
  const { status, data } = await authApi("resend-prepare", {
    email: String(email || "").trim().toLowerCase(),
    intent: intent === "guest_migrate" ? "guest_migrate" : "signup",
    ...(captchaToken ? { captcha_token: captchaToken } : {}),
  });
  if (status === 429) throw new Error(t("auth.tooManyRequests"));
  if (data.error === "captcha_failed") throw authApiError(status, data.error);
  if (status !== 200 || !data.ok) throw new Error(t("auth.statusError"));
  return { allowed: !!data.allowed, nextAllowedAtMs: data.next_allowed_at ? Date.parse(data.next_allowed_at) || 0 : 0 };
}

export async function getPendingIntent(email) {
  const info = await getEmailStatus(email);
  return info.status === "pending" ? info.intent : null;
}

export async function sendSignupConfirmation(email, password, redirectTo, language, captchaToken = null) {
  return signUp(email, password, redirectTo, null, language, captchaToken);
}

export async function sendGuestMigrateConfirmation(email, language) {
  return convertGuestToRegisteredEmailOnly(email, language);
}

export async function signOut() {
  await sb().auth.signOut();
  _unameCache = { userId: null, username: null, ts: 0 };
  clearGuestLocalMarker();
}

// Reset hasła po nazwie użytkownika albo adresie e-mail: Worker rozwiązuje
// nazwę, rezerwuje cooldown (tylko serwer, migracja 514) i wysyła link; adres
// e-mail konta nie wraca do przeglądarki. { sent, nextAllowedAtMs }
export async function resetPasswordByLogin(login, language, captchaToken = null) {
  const { status, data } = await authApi("reset", {
    login: String(login || "").trim(),
    lang: language,
    ...(captchaToken ? { captcha_token: captchaToken } : {}),
  });
  if (status === 404) throw new Error(t("auth.errResetMissingLogin"));
  if (status !== 200 || !data.ok) throw authApiError(status, data.error);
  return { sent: !!data.sent, nextAllowedAtMs: data.next_allowed_at ? Date.parse(data.next_allowed_at) || 0 : 0 };
}

export async function updateUserLanguage(language) {
  if (!language) return;
  try {
    const { data } = await sb().auth.getSession();
    if (!data?.session?.user) return;
    const { error } = await sb().auth.updateUser({ data: { language } });
    if (error) console.warn("[auth] updateUserLanguage failed:", error);
  } catch (e) {
    console.warn("[auth] updateUserLanguage failed:", e);
  }
}

const PASSWORD_ICON = icon("eye", { animation: "password" });

export function resetPasswordToggles() {
  document.querySelectorAll(".pass-wrap input").forEach((input) => {
    input.type = "password";
  });
  document.querySelectorAll(".pass-toggle").forEach((btn) => {
    btn.setAttribute("aria-pressed", "false");
  });
}

export function initPasswordToggles() {
  // Group password inputs by their closest common parent
  const allInputs = [...document.querySelectorAll('input[type="password"]')]
    .filter(input => !input.closest('.pass-wrap'));
  const groups = new Map();
  allInputs.forEach((input) => {
    const parent = input.parentElement;
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(input);
  });

  groups.forEach((inputs) => {
    inputs.forEach((input) => {
      const wrap = document.createElement("div");
      wrap.className = "pass-wrap";
      input.parentNode.insertBefore(wrap, input);
      wrap.appendChild(input);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pass-toggle";
      btn.dataset.i18nAriaLabel = "common.passwordVisibility";
      btn.setAttribute("aria-label", t("common.passwordVisibility"));
      btn.setAttribute("aria-pressed", "false");
      if (input.id) btn.setAttribute("aria-controls", input.id);
      btn.innerHTML = PASSWORD_ICON;
      wrap.appendChild(btn);

      btn.addEventListener("click", () => {
        const show = input.type === "password";
        // Toggle all inputs in the same group
        inputs.forEach((i) => { i.type = show ? "text" : "password"; });
        // Update all buttons in the group
        inputs.forEach((i) => {
          i.parentElement.querySelector(".pass-toggle").setAttribute("aria-pressed", String(show));
        });
      });
    });
  });
}
