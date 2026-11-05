import { ensureUsernameAvailable } from "../../shared/js/core/username-availability.js?v=v2026-11-05T21201";
import { holdPageLayout, redirectPage } from "../../shared/js/core/page-layout.js?v=v2026-11-05T21201";
// js/pages/login.js
import { guardViewportWidth } from "../../shared/js/core/device-guard.js?v=v2026-11-05T21201";

guardViewportWidth({ minWidth: 0 });
import {
  getUser,
  signIn,
  signInGuest,
  getEmailStatus,
  sendSignupConfirmation,
  convertGuestToRegisteredEmailOnly,
  discardCurrentGuestAccount,
  resetPasswordByLogin,
  prepareConfirmationResend,
  updateUserLanguage,
  validatePassword,
  validateUsername,
  preloadUsernameRules,
  niceAuthError,
  getPasswordRulesText,
  hasGuestLocalMarker,
  clearGuestLocalMarker,
  initPasswordToggles,
  resetPasswordToggles,
} from "../../shared/js/core/auth.js?v=v2026-11-05T21201";
import { isGuestUser } from "../../shared/js/core/guest-mode.js?v=v2026-11-05T21201";
import { alertModal, confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-05T21201";

import { PAGES, manualHref } from "../../shared/js/core/nav-map.js?v=v2026-11-05T21201";
import { copyGoReturnUrl, isScreenshotId } from "../../shared/js/core/poll-links.js?v=v2026-11-05T21201";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-05T21201";
import { mailCooldownEmailCheck, mailCooldownEmailReserve } from "../../shared/js/core/cooldown.js?v=v2026-11-05T21201";
import { initI18n, t, getUiLang, withLangParam, applyTranslations } from "../../shared/translation/translation.js?v=v2026-11-05T21201";
import { iconText } from "../../shared/js/core/icons.js?v=v2026-11-05T21201";
import "../../shared/js/core/contact-modal.js?v=v2026-11-05T21201";

const $ = (s) => document.querySelector(s);
const email = $("#email");
const pass = $("#pass");
const pass2 = $("#pass2");
const status = $("#status");
const err = $("#err");
const pwdHint = $("#pwdHint");
const btnPrimary = $("#btnPrimary");
const btnToggle = $("#btnToggle");
const btnForgot = $("#btnForgot");
const btnGuest = $("#btnGuest");
const forgotCooldown = $("#forgotCooldown");
const loginCard = $("#loginCard");
const setupCard = $("#setupCard");
const usernameFirst = $("#usernameFirst");
const usernameErr = $("#usernameErr");
const btnUsernameSave = $("#btnUsernameSave");
const setupTitleEl = setupCard?.querySelector(".setup-title");
const setupSubEl = setupCard?.querySelector(".setup-sub");
const baseUrls = document.body?.dataset || {};
const confirmUrl = baseUrls.confirmUrl || "/login/confirm/";
const gamesUrl = baseUrls.gamesUrl || "/games/";
const captchaProvider = String(baseUrls.captchaProvider || "hcaptcha").trim().toLowerCase();
const captchaSiteKey = String(baseUrls.captchaSiteKey || "").trim();
let captchaLoadPromise = null;

const LOGIN_CAPTCHA_FAIL_THRESHOLD = 3;
const loginFailuresByIdentity = new Map();

function isSecurityRelevantLoginError(e) {
  const code = String(e?.errorCode || "").trim().toLowerCase();
  if (code === "invalid_login_credentials") return true;
  if (code === "unknown_email" || code === "unknown_username") return true;

  // Some providers return "captcha_required" or similar when abuse is detected.
  if (code === "captcha_required") return true;

  // As a fallback, treat explicit 400/401 invalid-credential responses as security-related.
  const status = Number(e?.status || 0) || 0;
  if ((status === 400 || status === 401) && /invalid|credential|password|email/i.test(String(e?.rawMessage || e?.message || ""))) {
    return true;
  }
  return false;
}

function isCaptchaError(e) {
  const code = String(e?.errorCode || "").trim().toLowerCase();
  if (code === "captcha_required") return true;
  if (String(e?.errorKind || "").toLowerCase() === "security") return true;
  const msg = String(e?.rawMessage || e?.message || "").toLowerCase();
  if (msg.includes("captcha")) return true;
  return false;
}

function getLoginFailureKey(loginOrEmail) {
  return String(loginOrEmail || "").trim().toLowerCase();
}

function getLoginFailureCount(loginOrEmail) {
  return loginFailuresByIdentity.get(getLoginFailureKey(loginOrEmail)) || 0;
}

function bumpLoginFailureCount(loginOrEmail) {
  const key = getLoginFailureKey(loginOrEmail);
  if (!key) return 0;
  const next = getLoginFailureCount(key) + 1;
  loginFailuresByIdentity.set(key, next);
  return next;
}

function resetLoginFailureCount(loginOrEmail) {
  const key = getLoginFailureKey(loginOrEmail);
  if (!key) return;
  loginFailuresByIdentity.delete(key);
}

function getLoginCaptchaPolicy(loginOrEmail) {
  const failures = getLoginFailureCount(loginOrEmail);
  return {
    failures,
    requireCaptcha: failures >= LOGIN_CAPTCHA_FAIL_THRESHOLD,
  };
}

// Token Turnstile jest jednorazowy (Worker weryfikuje go po stronie serwera):
// pobrany z pamięci podręcznej token od razu z niej znika.
async function takeSilentCaptchaToken() {
  const token = await getSilentCaptchaToken();
  setCachedSilentCaptchaToken("");
  return token;
}

async function getCaptchaPromptForLogin(loginOrEmail) {
  if (!captchaSiteKey) return null;
  const policy = getLoginCaptchaPolicy(loginOrEmail);
  if (policy.requireCaptcha) return await askCaptchaToken();
  const silent = await takeSilentCaptchaToken();
  if (silent) return silent;
  return await askCaptchaToken();
}

async function getCaptchaTokenOrPrompt() {
  if (!captchaSiteKey) return null;
  const silent = await takeSilentCaptchaToken();
  if (silent) return silent;
  return await askCaptchaToken();
}

// Wywołanie Workera z tokenem; odrzucony token -> widoczne wyzwanie i jedna ponowna próba.
async function withCaptcha(call) {
  try {
    return await call(await getCaptchaTokenOrPrompt());
  } catch (e) {
    if (!isCaptchaError(e)) throw e;
    return await call(await askCaptchaToken());
  }
}

function getCaptchaLang() {
  const fromPage = document.documentElement?.lang;
  if (fromPage) return String(fromPage).trim().toLowerCase();
  return getUiLang() || "pl";
}

function loadCaptchaApi() {
  if (!captchaSiteKey) return Promise.resolve(null);

  if (captchaProvider === "hcaptcha") {
    const captchaLang = getCaptchaLang();
    const existing = document.querySelector('script[data-captcha="hcaptcha"]');
    const existingLang = existing?.dataset?.captchaLang || "";

    if (window.hcaptcha && existing && existingLang === captchaLang) {
      return Promise.resolve(window.hcaptcha);
    }
    if (existing && existingLang && existingLang !== captchaLang) {
      try { existing.remove(); } catch {}
      try { delete window.hcaptcha; } catch {}
      captchaLoadPromise = null;
    }

    if (captchaLoadPromise) return captchaLoadPromise;
    captchaLoadPromise = new Promise((resolve, reject) => {
      const onloadCallback = "__familijnaHcaptchaOnLoad";
      const cleanup = () => { try { delete window[onloadCallback]; } catch {} };
      window[onloadCallback] = () => {
        cleanup();
        resolve(window.hcaptcha || null);
      };
      const reuse = document.querySelector('script[data-captcha="hcaptcha"]');
      if (reuse) {
        if (window.hcaptcha && reuse.dataset.captchaLang === captchaLang) {
          cleanup();
          resolve(window.hcaptcha);
          return;
        }
        reuse.addEventListener("load", () => resolve(window.hcaptcha || null), { once: true });
        reuse.addEventListener("error", () => reject(new Error("hCaptcha failed to load")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = `https://js.hcaptcha.com/1/api.js?render=explicit&onload=${encodeURIComponent(onloadCallback)}&hl=${encodeURIComponent(captchaLang)}`;
      script.async = true;
      script.defer = true;
      script.dataset.captcha = "hcaptcha";
      script.dataset.captchaLang = captchaLang;
      script.onload = () => {
        if (window.hcaptcha) {
          cleanup();
          resolve(window.hcaptcha);
        }
      };
      script.onerror = () => {
        cleanup();
        console.error("[captcha] hcaptcha failed to load");
        reject(new Error("hCaptcha failed to load"));
      };
      document.head.appendChild(script);
    });
    return captchaLoadPromise;
  }

  if (window.turnstile) {
    return Promise.resolve(window.turnstile);
  }
  if (captchaLoadPromise) return captchaLoadPromise;
  captchaLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-captcha="turnstile"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(window.turnstile || null), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.dataset.captcha = "turnstile";
    script.onload = () => resolve(window.turnstile || null);
    script.onerror = () => {
      console.error("[captcha] turnstile failed to load");
      reject(new Error("Turnstile failed to load"));
    };
    document.head.appendChild(script);
  });
  return captchaLoadPromise;
}

// -------------------------
// Silent captcha token (Variant B)
// -------------------------

let _silentCaptchaCache = { token: "", expMs: 0 };
let _silentCaptchaInFlight = null;
let _visibleCaptchaInFlight = null;

function getCachedSilentCaptchaToken() {
  const now = Date.now();
  if (_silentCaptchaCache.token && now < (_silentCaptchaCache.expMs || 0)) return _silentCaptchaCache.token;
  return "";
}

function setCachedSilentCaptchaToken(token) {
  const tkn = String(token || "").trim();
  if (!tkn) {
    _silentCaptchaCache = { token: "", expMs: 0 };
    return;
  }
  // Tokens are short-lived; cache briefly to avoid re-render on rapid clicks.
  _silentCaptchaCache = { token: tkn, expMs: Date.now() + 90_000 };
}

async function getSilentCaptchaToken() {
  if (!captchaSiteKey) return null;
  const cached = getCachedSilentCaptchaToken();
  if (cached) return cached;
  if (_silentCaptchaInFlight) return _silentCaptchaInFlight;

  _silentCaptchaInFlight = (async () => {
    const captcha = await loadCaptchaApi();
    if (!captcha?.render) return null;

    const mount = document.createElement("div");
    // Needs real dimensions — Turnstile measures container size during execution.
    // visibility:hidden keeps it invisible but renderable (unlike display:none or 0x0).
    mount.className = "captcha-silent";
    mount.dataset.theme = "dark";
    document.body.appendChild(mount);

    let token = "";
    let widgetId = null;

    const tokenPromise = new Promise((resolve) => {
      const done = () => resolve(String(token || "").trim());
    const timer = setTimeout(done, 6000);

      const setToken = (value) => {
        token = String(value || "");
        clearTimeout(timer);
        done();
      };

      try {
        if (captchaProvider === "hcaptcha") {
          widgetId = captcha.render(mount, {
            sitekey: captchaSiteKey,
            theme: "dark",
            size: "invisible",
            callback: setToken,
            "expired-callback": () => { token = ""; },
            "error-callback": () => { token = ""; },
          });
          try { captcha.execute(widgetId); } catch {}
        } else {
        widgetId = captcha.render(mount, {
          sitekey: captchaSiteKey,
          theme: "dark",
          language: getCaptchaLang(),
          size: "flexible",
          appearance: "interaction-only",
          execution: "render",
          callback: setToken,
          "expired-callback": () => { token = ""; },
          "error-callback": () => { token = ""; },
        });
        }
      } catch {
        clearTimeout(timer);
        console.error("[captcha] silent render failed");
        resolve("");
      }
    });

    try {
      const tkn = await tokenPromise;
      if (!tkn) console.warn("[captcha] silent token empty");
      if (tkn) setCachedSilentCaptchaToken(tkn);
      return tkn || null;
    } finally {
      try {
        if (widgetId !== null && widgetId !== undefined) {
          if (captchaProvider === "hcaptcha") captcha.reset(widgetId);
          else captcha.remove(widgetId);
        }
      } catch {}
      try { mount.remove(); } catch {}
    }
  })();

  try {
    return await _silentCaptchaInFlight;
  } finally {
    _silentCaptchaInFlight = null;
  }
}

async function askCaptchaToken() {
  if (!captchaSiteKey) return null;
  if (_visibleCaptchaInFlight) return _visibleCaptchaInFlight;

  _visibleCaptchaInFlight = (async () => {
  const captcha = await loadCaptchaApi();
  if (!captcha?.render) throw new Error(t("auth.captchaRequired"));

  const status = document.createElement("div");
  status.className = "captcha-status";
  status.textContent = t("index.captchaStatusPending");

  const mount = document.createElement("div");
  mount.dataset.theme = "dark";
  mount.className = "captcha-mount";
  mount.appendChild(status);

  let token = "";
  let okBtnRef = null;
  const widgetId = captchaProvider === "hcaptcha"
    ? captcha.render(mount, {
      sitekey: captchaSiteKey,
      theme: "dark",
      size: "normal",
      callback: (value) => {
        token = String(value || "");
        if (token) {
          status.textContent = t("index.captchaStatusOk");
          if (okBtnRef) okBtnRef.click();
        }
      },
      "expired-callback": () => { token = ""; },
      "error-callback": () => { token = ""; },
    })
    : captcha.render(mount, {
      sitekey: captchaSiteKey,
      theme: "dark",
      language: getCaptchaLang(),
      size: "normal",
      callback: (value) => {
        token = String(value || "");
        if (token) {
          status.textContent = t("index.captchaStatusOk");
          if (okBtnRef) okBtnRef.click();
        }
      },
      "expired-callback": () => { token = ""; },
      "error-callback": () => {
        token = "";
        status.textContent = t("index.captchaError");
        if (okBtnRef) { okBtnRef.hidden = false; okBtnRef.disabled = true; }
      },
    });

  try {
    const ok = await confirmModal({
      title: t("index.captchaTitle"),
      text: t("index.captchaText"),
      okText: t("index.captchaOk"),
      cancelText: t("index.captchaCancel"),
      body: mount,
      initialFocus: mount,
      onReady: ({ okBtn }) => {
        okBtnRef = okBtn;
        if (okBtnRef) okBtnRef.hidden = true;
      },
    });

    if (!ok) throw new Error(t("auth.captchaRequired"));
    if (!token) {
      console.warn("[captcha] visible token empty");
      throw new Error(t("auth.captchaRequired"));
    }
    return token;
  } finally {
      try {
        if (captchaProvider === "hcaptcha") captcha.reset(widgetId);
        else captcha.remove(widgetId);
      } catch {}
    }
  })();

  try {
    return await _visibleCaptchaInFlight;
  } finally {
    _visibleCaptchaInFlight = null;
  }
}

let mode = "login"; // login | register

let isBusy = false;

 // 1h
const RESET_ACTION_KEY = "auth:reset_password";
// Czas trwania cooldownu (1h) jest teraz DANE w mail_cooldown_policies
// (migracja 288/293), nie parametrem wywołania -- stąd brak tu już
// *_COOLDOWN_SECONDS (dawniej przekazywane do cooldownEmailReserve).
const GUEST_UPGRADE_ACTION_KEY = "auth:guest_upgrade_email";

let _forgotTimer = null;
let _forgotDebounce = null;

// in-memory cache (truth is in DB; we refresh on interactions)
const forgotUntilByEmail = new Map();

function getForgotUntil(email) {
  const e = String(email || "").trim().toLowerCase();
  return forgotUntilByEmail.get(e) || 0;
}

function setForgotUntil(email, untilMs) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  forgotUntilByEmail.set(e, Number(untilMs) || 0);
}

async function refreshForgotUntil(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return 0;
  const { ok, nextAllowedAtMs } = await mailCooldownEmailCheck(RESET_ACTION_KEY, e);
  const until = ok ? 0 : nextAllowedAtMs;
  setForgotUntil(e, until);
  return until;
}

function formatLeft(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function stopForgotTimer() {
  if (_forgotTimer) clearInterval(_forgotTimer);
  _forgotTimer = null;
}

function hideForgotCooldown() {
  stopForgotTimer();
  if (forgotCooldown) {
    forgotCooldown.hidden = true;
    forgotCooldown.textContent = "";
  }
}

function showForgotCooldownForEmail(resolvedEmail) {
  stopForgotTimer();

  const resolved = String(resolvedEmail || "").trim().toLowerCase();
  const tick = () => {
    // pokazuj tylko, gdy aktualnie w polu jest ten sam email (lub user wpisał username → wtedy i tak kliknie)
    const current = String(email?.value || "").trim().toLowerCase();
    if (current.includes("@") && current !== String(resolvedEmail).toLowerCase()) {
      hideForgotCooldown();
      btnForgot.disabled = false;
      return;
    }

    const until = getForgotUntil(resolved);
    const left = until - Date.now();

    if (left <= 0) {
      hideForgotCooldown();
      btnForgot.disabled = false;
      return;
    }

    if (forgotCooldown) {
      forgotCooldown.hidden = false;
      forgotCooldown.textContent = t("index.resetCooldown", { time: formatLeft(left) });
    }

    // blokuj resend tylko dla tego maila
    if (current.includes("@")) btnForgot.disabled = true;
  };

  tick();
  _forgotTimer = setInterval(tick, 1000);
}

function setBusy(v) {
  isBusy = v;
  if (btnPrimary) btnPrimary.disabled = v;
  if (btnToggle) btnToggle.disabled = v;
  if (btnForgot) btnForgot.disabled = v;
  if (btnGuest) btnGuest.disabled = v;
  if (btnUsernameSave) btnUsernameSave.disabled = v;
}

const params = new URLSearchParams(location.search);
const nextTarget = params.get("next");
const nextTask = params.get("t");
const nextBase = params.get("b");
const nextFriend = params.get("f");
const nextTab = params.get("tab");
// Ukryta gra w węża: powrót tylko z ważnym linkiem z kodu QR (inaczej /snake/ = 404).
const nextSnakeQr = params.get("qr");
// account: centrum maili („Masz konto w Familijnej”) prowadzi do Ustawień konta (powiadomienia).
const NEXT_TARGETS = ["tasks", "friends", "bases", "account"];
if (isScreenshotId(nextSnakeQr)) NEXT_TARGETS.push("snake");
// copy: link kopii gry lub logo (/go/?c=…) -- po zalogowaniu powrót do tego linku.
if (copyGoReturnUrl(params, location.origin)) NEXT_TARGETS.push("copy");
const hasNextTarget = NEXT_TARGETS.includes(nextTarget);
const guestUsername = params.get("guest_username") === "1";
const setupUsername = params.get("setup") === "username";
const guestExpired = params.get("guest_expired") === "1";
const forceAuth = params.get("force_auth") === "1";

function buildAuthRedirect(page) {
  // page: "/login/confirm/" lub "/login/reset/"
  const p = String(page || "").trim();

  // Wymuś ścieżkę absolutną w obrębie tego samego origin
  const path = p.startsWith("http://") || p.startsWith("https://")
    ? new URL(p).pathname
    : (p.startsWith("/") ? p : `/${p}`);

  const url = new URL(path, location.origin);
  url.searchParams.set("lang", getUiLang());
  return url.toString();
}

function buildNextUrl() {
  if (nextTarget === "copy") return copyGoReturnUrl(params, location.origin, getUiLang());
  if (nextTarget === "snake") {
    const snake = new URL(PAGES.snake.path, location.origin);
    snake.searchParams.set("qr", nextSnakeQr);
    snake.searchParams.set("lang", getUiLang());
    return snake.toString();
  }
  const url = new URL(nextTarget === "friends" ? "/friends/" : nextTarget === "bases" ? "/bases/" : nextTarget === "account" ? PAGES.account.path : "/tasks/", location.origin);
  if (nextTarget === "friends" && nextFriend) url.searchParams.set("f", nextFriend);
  if (nextTarget === "tasks" && nextTask) url.searchParams.set("t", nextTask);
  if (nextTarget === "bases" && nextBase) url.searchParams.set("b", nextBase);
  if (PAGES[nextTarget]?.tabs?.includes(nextTab)) url.searchParams.set("tab", nextTab);

  url.searchParams.set("lang", getUiLang());
  return url.toString();
}

function setErr(m = "") { err.textContent = m; }
function setStatus(m = "") { status.textContent = m; }
function setUsernameErr(m = "") { if (usernameErr) usernameErr.textContent = m; }

async function waitForUserSession({ maxMs = 2500, stepMs = 150 } = {}) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const user = await getUser();
    if (user) return user;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

async function confirmDiscardGuestIfActive() {
  try {
    const current = await getUser();
    if (!current || !isGuestUser(current)) return true;

    const who =
      current.username ||
      current.user_metadata?.username ||
      current.email ||
      current.id;

    const ok = await confirmModal({
      title: t("index.guestSessionLossTitle"),
      text: t("index.guestSessionLossText", { who }),
      okText: t("index.guestSessionLossOk"),
      cancelText: t("index.guestSessionLossCancel"),
    });

    if (!ok) {
      try {
        if (email) email.value = "";
        if (pass) pass.value = "";
        if (pass2) pass2.value = "";
      } catch {}
      return false;
    }

    await discardCurrentGuestAccount();
    return true;
  } catch {
    // If we can't reliably detect, do not block login.
    return true;
  }
}

async function handlePendingEmailResend(emailAddr, pendingIntent) {
  // Migrację gościa da się ponowić tylko z jego sesji: konto gościa nie ma
  // adresu, więc auth.resend go nie znajdzie (kończył się "sukcesem" bez maila).
  let guest = null;
  if (pendingIntent === "guest_migrate") {
    try { guest = await getUser(); } catch {}
    const guestPending = String(guest?.user_metadata?.familijna_email_change_pending || "").trim().toLowerCase();
    if (!guest || !isGuestUser(guest) || guestPending !== String(emailAddr || "").trim().toLowerCase()) {
      void alertModal({ text: t("index.pendingGuestMigrateElsewhere", { email: emailAddr }) });
      return true;
    }
  }

  const ok = await confirmModal({
    title: t("index.pendingEmailTitle"),
    text: t("index.pendingEmailText", { email: emailAddr }),
    okText: t("index.pendingEmailOk"),
    cancelText: t("index.pendingEmailCancel"),
  });
  if (!ok) return true;

  const intent = pendingIntent === "guest_migrate" ? "guest_migrate" : "signup";
  const { allowed: reserveOk, nextAllowedAtMs } = await withCaptcha((token) => prepareConfirmationResend(emailAddr, intent, token));

  if (!reserveOk) {
    const left = (nextAllowedAtMs || 0) - Date.now();
    if (left > 0) setErr(t("auth.errResendCooldown", { time: formatLeft(left) }));
    else setErr(t("auth.errResendCooldownGeneric"));
    return true;
  }

  const language = getUiLang();
  const redirect = new URL("/login/confirm/", location.origin);
  redirect.searchParams.set("lang", language);
  redirect.searchParams.set("to", emailAddr);

  if (intent === "guest_migrate") {
    // Ta sama droga co pierwsza wysyłka (jak „Wyślij ponownie” w Ustawieniach konta).
    const { error: resendErr } = await sb().auth.updateUser(
      { email: emailAddr },
      { emailRedirectTo: redirect.toString() }
    );
    if (resendErr) throw resendErr;
  } else {
    const { error: resendErr } = await sb().auth.resend({
      type: "signup",
      email: emailAddr,
      options: { emailRedirectTo: redirect.toString() },
    });
    if (resendErr) throw resendErr;
  }

  setStatus(t("index.statusCheckEmail"));
  void alertModal({ text: t("index.pendingEmailResent") });
  return true;
}

function openUsernameSetup() {
  if (loginCard) loginCard.hidden = true;
  if (setupCard) setupCard.hidden = false;
  document.body.classList.add("setup-mode");

  if (guestUsername) {
    if (setupTitleEl) setupTitleEl.textContent = t("index.setupGuestPrompt");
    if (setupSubEl) setupSubEl.textContent = t("index.setupGuestSub");
  } else {
    if (setupTitleEl) setupTitleEl.textContent = t("index.setupPrompt");
    if (setupSubEl) setupSubEl.textContent = t("index.setupSub");
  }

  if (usernameFirst) usernameFirst.focus();
}

function closeUsernameSetup() {
  if (loginCard) loginCard.hidden = false;
  if (setupCard) setupCard.hidden = true;
  document.body.classList.remove("setup-mode");
}


async function saveUsername() {
  setUsernameErr("");
  try {
    const username = validateUsername(usernameFirst?.value || "");
    const { data: userData, error: userError } = await sb().auth.getUser();

    if (userError || !userData?.user) throw new Error(t("auth.errNoSession"));

    await ensureUsernameAvailable(username);

    const res = await sb()
      .from("profiles")
      .update({ username })
      .eq("id", userData.user.id)
      .select("id, username")
      .single();

    // Sprawdzenie w ensureUsernameAvailable() nie jest atomowe z tym update'em —
    // przy realnym wyścigu o tę samą nazwę łapie to dopiero unique index
    // (profiles_username_ci_uq), więc zamiast surowego błędu Postgresa pokaż
    // ten sam komunikat co przy zwykłej kolizji.
    if (res.error) {
      if (res.error.code === "23505") throw new Error(t("auth.errUsernameTaken"));
      throw res.error;
    }

    const meta = await sb().auth.updateUser({ data: { username } });

    if (meta.error) throw meta.error;

    closeUsernameSetup();
    location.href = withLangParam(gamesUrl);
  } catch (e) {
    console.error("[saveUsername] FAIL", e);
    setUsernameErr(niceAuthError(e));
  }
}

function setButton(btn, key, iconName) {
  btn.dataset.i18n = key;
  btn.dataset.i18nIcon = iconName;
  btn.innerHTML = iconText(iconName, t(key));
}

function applyMode() {
  if (mode === "login") {
    setButton(btnPrimary, "index.btnLogin", "arrow-right");
    setButton(btnToggle, "index.btnToggleRegister", "plus");
    email.placeholder = t("index.placeholderLogin");
    if (pass2) {
      pass2.value = "";
      pass2.disabled = true;
    }
  } else {
    email.placeholder = t("index.placeholderEmail");
    setButton(btnToggle, "index.btnToggleLogin", "person");
    if (pwdHint) pwdHint.textContent = getPasswordRulesText();
    setButton(btnPrimary, "index.btnRegister", "plus");
    if (pass2) pass2.disabled = false;
  }

  document.body.classList.toggle("mode-login", mode === "login");
  document.body.classList.toggle("mode-register", mode === "register");
  if (pwdHint && mode !== "register") pwdHint.textContent = "";
  setErr("");

  // Reset password visibility on mode switch
  resetPasswordToggles();
}

async function resolveInitialRoute(syncLanguage) {
  const u = await getUser();
  if (!u && hasGuestLocalMarker()) {
    // If we just initiated a guest upgrade, do not show the "deleted by inactivity" message.
    const pending = String(localStorage.getItem("auth:guest_upgrade_pending") || "");
    clearGuestLocalMarker();
    if (!pending) {
      void alertModal({ text: t("index.guestDeletedByInactivity") });
    } else {
      try { localStorage.removeItem("auth:guest_upgrade_pending"); } catch {}
    }
  }
  if (u) {
    if (isGuestUser(u)) {
      const who = u.username || u.email || u.id || "";
      setStatus(t("index.statusGuestSession", { who }));
      // Ten sam przycisk wraca do istniejącej sesji gościa (bez nowego konta).
      if (btnGuest) {
        btnGuest.setAttribute("data-i18n", "index.btnGuestContinue");
        applyTranslations(btnGuest.parentElement || document);
      }
    } else if (forceAuth) {
      setStatus(t("index.statusLoggedOut"));
    } else {
      await syncLanguage();
      if (setupUsername || !u.username) {
        openUsernameSetup();
      } else if (hasNextTarget) {
        redirectPage(buildNextUrl());
      } else {
        redirectPage(withLangParam(gamesUrl));
      }
      return !(setupUsername || !u.username);
    }
  }

  if (!u || !isGuestUser(u)) setStatus(t("index.statusLoggedOut"));

  return false;
}

document.addEventListener("DOMContentLoaded", async () => {
  preloadUsernameRules(); // pole nazwy: lista zastrzeżonych przedrostków z bazy
  try {
    await initI18n({ withSwitcher: true });
  } catch (e) {
    console.error("[i18n] init failed", e);
    try { applyTranslations(document); } catch {}
  }
  document.documentElement.classList.remove('page-loading');
  document.querySelector('.topbar')?.classList.add('topbar-ready');
  // Podręcznik: adres z mapy (ret wraca na logowanie, język z bieżącej strony).
  const btnManual = document.getElementById("btnManual");
  const syncManual = () => btnManual?.setAttribute("href", manualHref("login"));
  syncManual();
  window.addEventListener("i18n:lang", syncManual);
  // Logowanie z gry w węża: powrót do gry (ten sam kod QR), także po nieudanej próbie.
  const btnBackHome = document.getElementById("btnBackHome");
  if (btnBackHome && hasNextTarget && nextTarget === "snake") {
    btnBackHome.dataset.i18n = "index.backSnake";
    const syncBack = () => {
      const u = new URL(buildNextUrl());
      btnBackHome.setAttribute("href", `${u.pathname}${u.search}`);
      btnBackHome.innerHTML = iconText("arrow-left", t("index.backSnake"));
    };
    syncBack();
    window.addEventListener("i18n:lang", syncBack);
  }
  const syncLanguage = () => updateUserLanguage(getUiLang());
  applyMode();
  initPasswordToggles();
  setStatus(t("index.statusChecking"));
  // Formularz jest przygotowany, ale bramka trasy poniżej czeka na decyzję
  // sesji. Captcha i późniejsze dane nie opóźniają odsłonięcia logowania.
  document.querySelector("body > [data-skel-step]")?.classList.add("skel-step-ready");
  if (guestExpired) {
    void alertModal({ text: t("index.guestExpired") });
  }
  if (forceAuth) {
    void alertModal({ text: t("index.forceAuthInfo") });
  }

  const usernameForm = document.querySelector("#usernameForm");

  usernameForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isBusy) return;
    setBusy(true);
    try {
      await saveUsername();
    } finally {
      setBusy(false);
    }
  });

  const redirected = await holdPageLayout(resolveInitialRoute(syncLanguage).catch((error) => {
    console.warn("[login] session check failed", error?.name);
    return false;
  }));
  if (redirected) return;

  // Preload captcha API script only — token is fetched on first user interaction
  if (captchaSiteKey) void loadCaptchaApi();

  window.addEventListener("i18n:lang", syncLanguage);

  btnToggle.addEventListener("click", async () => {
    const nextMode = mode === "login" ? "register" : "login";
    mode = nextMode;

    applyMode();
  });

  btnPrimary.addEventListener("click", async () => {
    if (isBusy) return;
    setBusy(true);

    setErr("");
    const loginOrEmail = String(email.value || "").trim();
    const pwd = String(pass.value || "");

    if (mode === "login") {
      if (!loginOrEmail || !pwd) {
        setBusy(false);
        return setErr(t("index.errMissingLogin"));
      }
    } else {
      if (!loginOrEmail) {
        setBusy(false);
        return setErr(t("auth.errInvalidEmail"));
      }
      if (!pwd) {
        setBusy(false);
        return setErr(t("index.errMissingLogin"));
      }
    }

    try {
      if (mode === "register") {
        const mail = loginOrEmail;

        if (!mail || !mail.includes("@")) return setErr(t("auth.errInvalidEmail"));

        const statusInfo = await withCaptcha((token) => getEmailStatus(mail, token));
        if (statusInfo.status === "confirmed") {
          void alertModal({ text: t("index.emailAlreadyRegistered") });
          mode = "login";
          applyMode();
          return;
        }

        if (statusInfo.status === "pending") {
          await handlePendingEmailResend(mail, statusInfo.intent || "");
          return;
        }

        let current = null;
        try { current = await getUser(); } catch {}

        let migrateGuest = false;
        if (current && isGuestUser(current)) {
          migrateGuest = await confirmModal({
            title: t("index.guestMigrateTitle"),
            text: t("index.guestMigrateText"),
            okText: t("index.guestMigrateOk"),
            cancelText: t("index.guestMigrateCancel"),
          });
        }

        // Guest migrate: email-only + 1h resend cooldown.
        if (migrateGuest) {
          const reserve = await mailCooldownEmailReserve(GUEST_UPGRADE_ACTION_KEY, mail);
          if (!reserve.ok) {
            const left = (reserve.nextAllowedAtMs || 0) - Date.now();
            if (left > 0) return setErr(t("auth.errResendCooldown", { time: formatLeft(left) }));
            return setErr(t("auth.errResendCooldownGeneric"));
          }

          setStatus(t("index.statusRegistering"));

          if (current && isGuestUser(current)) {
            if (pass2.value !== pwd) return setErr(t("index.errPasswordMismatch"));
            try {
              validatePassword(pwd);
            } catch (e) {
              return setErr(niceAuthError(e));
            }

            // Hasło NIE trafia do auth.users teraz — leży zahaszowane w
            // guest_migration_staging aż do potwierdzenia maila
            // (guest_finalize_migration() w confirm.js). Inaczej is_guest
            // flipuje na false natychmiast (guest_convert_account), zanim user
            // w ogóle kliknął link — porzucona konwersja zostaje wtedy na
            // zawsze jako martwe konto: nie gość (czyszczenie po TTL pomija
            // is_guest=false), nie zarejestrowany (mail nigdy niepotwierdzony).
            // Ten sam bug był już raz naprawiony dla /account, patrz komentarz
            // przy convertGuestToRegisteredEmailOnly w auth.js.
            const { data: stageData, error: stageErr } = await sb().rpc("guest_stage_migration", {
              p_password: pwd,
            });
            if (stageErr) throw stageErr;
            if (!stageData?.ok) throw new Error(stageData?.error || t("auth.statusError"));

            let captchaToken = await getCaptchaTokenOrPrompt();
            setStatus(t("index.statusRegistering"));
            try {
              await convertGuestToRegisteredEmailOnly(mail, getUiLang(), captchaToken);
            } catch (e) {
              if (isCaptchaError(e)) {
                captchaToken = await getCaptchaTokenOrPrompt();
                await convertGuestToRegisteredEmailOnly(mail, getUiLang(), captchaToken);
              } else {
                throw e;
              }
            }

            // Sesja gościa zostaje: do potwierdzenia linku gość dalej korzysta
            // z konta, a w Ustawieniach konta ma „Wyślij ponownie” i „Anuluj”.
            // Ustawienia konta czytają oczekującą zmianę z tokenu sesji.
            try { await sb().auth.refreshSession(); } catch {}
            setStatus(t("index.statusCheckEmail"));
            await alertModal({ text: t("index.guestMigrateConfirmEmail", { email: mail }) });
            location.href = withLangParam(PAGES.account.path);
            return;
          }
        }

        if (pass2.value !== pwd) return setErr(t("index.errPasswordMismatch"));
        try {
          validatePassword(pwd);
        } catch (e) {
          return setErr(niceAuthError(e));
        }

        let captchaToken = await getCaptchaTokenOrPrompt();
        setStatus(t("index.statusRegistering"));
        const redirectTo = buildAuthRedirect(confirmUrl);
        try {
          await sendSignupConfirmation(mail, pwd, redirectTo, getUiLang(), captchaToken);
        } catch (e) {
          if (isCaptchaError(e)) {
            captchaToken = await getCaptchaTokenOrPrompt();
            await sendSignupConfirmation(mail, pwd, redirectTo, getUiLang(), captchaToken);
          } else {
            throw e;
          }
        }
        setStatus(t("index.statusCheckEmail"));
      } else {
        // If a guest session is active, warn that logging in will discard guest data.
        const okToLogin = await confirmDiscardGuestIfActive();
        if (!okToLogin) return;

        setStatus(t("index.statusLoggingIn"));
        let captchaToken = await getCaptchaPromptForLogin(loginOrEmail);
        try {
          await signIn(loginOrEmail, pwd, captchaToken); // <-- może być username
        } catch (e) {
          if (isCaptchaError(e)) {
            captchaToken = await askCaptchaToken();
            await signIn(loginOrEmail, pwd, captchaToken);
          } else {
            throw e;
          }
        }
        resetLoginFailureCount(loginOrEmail);

        const authed = await getUser();
        await syncLanguage();
        if (!authed?.username) {
          openUsernameSetup();
        } else if (hasNextTarget) {
          location.href = buildNextUrl();
        } else {
          location.href = withLangParam(gamesUrl);
        }
      }
    } catch (e) {
      if (mode === "login" && isSecurityRelevantLoginError(e)) bumpLoginFailureCount(loginOrEmail);
      console.error(e);
      setStatus(t("auth.statusError"));
      setErr(niceAuthError(e));
    } finally {
      setBusy(false);
    }
  });

  btnGuest?.addEventListener("click", async () => {
    if (isBusy) return;
    setBusy(true);
    setErr("");
    setStatus(t("index.statusLoggingIn"));
    try {
      const current = await getUser();
      if (current && isGuestUser(current)) {
        location.href = withLangParam(gamesUrl);
        return;
      }
      let captchaToken = await getCaptchaTokenOrPrompt();
      try {
        await signInGuest(captchaToken);
      } catch (e) {
        if (isCaptchaError(e)) {
          captchaToken = await getCaptchaTokenOrPrompt();
          await signInGuest(captchaToken);
        } else {
          throw e;
        }
      }
      const guestUser = await waitForUserSession();
      if (!guestUser) throw new Error(t("auth.loginFailed"));
      location.href = withLangParam(gamesUrl);
    } catch (e) {
      console.error(e);
      setStatus(t("auth.statusError"));
      setErr(niceAuthError(e));
    } finally {
      setBusy(false);
    }
  });

  btnForgot.addEventListener("click", async () => {
    if (isBusy) return;
    setBusy(true);
    setErr("");

    const loginOrEmail = email.value.trim();
    if (!loginOrEmail) {
      setBusy(false);
      return setErr(t("auth.errResetMissingLogin"));
    }

    try {
      // Worker rozwiązuje nazwę (adres e-mail konta nie trafia do przeglądarki),
      // pilnuje cooldownu i limitów, wysyła link -- tak samo dla adresu e-mail.
      const key = loginOrEmail.toLowerCase();
      // Adres e-mail: odliczanie z serwera (także z innego urządzenia).
      if (key.includes("@")) await refreshForgotUntil(key);
      if (getForgotUntil(key) > Date.now()) {
        setStatus(t("index.statusResetSent"));
        setErr("");
        showForgotCooldownForEmail(key);
        return;
      }
      setStatus(t("index.statusResetSending"));
      let captchaToken = await getCaptchaTokenOrPrompt();
      let result;
      try {
        result = await resetPasswordByLogin(loginOrEmail, getUiLang(), captchaToken);
      } catch (e) {
        if (!isCaptchaError(e)) throw e;
        captchaToken = await getCaptchaTokenOrPrompt();
        result = await resetPasswordByLogin(loginOrEmail, getUiLang(), captchaToken);
      }
      if (result.nextAllowedAtMs) setForgotUntil(key, result.nextAllowedAtMs);
      setStatus(t("index.statusResetSent"));
      hideForgotCooldown();
      showForgotCooldownForEmail(key);
} catch (e) {
      console.error(e);
      setStatus(t("auth.statusError"));
      setErr(niceAuthError(e));
    } finally {
      setBusy(false);
    }
  });

  btnForgot.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    btnForgot.click();
  });

  email.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    pass.focus();
  });

  email.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;

    if (document.activeElement === email && e.shiftKey === false) {
      e.preventDefault();
      if (mode === "login") {
        pass.focus();
      }
    }
  });

  email?.addEventListener("input", () => {
    const v = String(email.value || "").trim().toLowerCase();
    if (!v.includes("@")) {
      hideForgotCooldown();
      btnForgot.disabled = false;
      return;
    }

    if (_forgotDebounce) clearTimeout(_forgotDebounce);
    _forgotDebounce = setTimeout(async () => {
      try {
        await refreshForgotUntil(v);
        const until = getForgotUntil(v);
        if (until > Date.now()) {
          showForgotCooldownForEmail(v);
        } else {
          hideForgotCooldown();
          btnForgot.disabled = false;
        }
      } catch {
        // Jeśli RPC jest niedostępne, ukryj odliczanie (nie blokuj UI).
        hideForgotCooldown();
        btnForgot.disabled = false;
      }
    }, 400);
  });

  pass.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();

    if (mode === "register") {
      pass2.focus();
    } else {
      btnPrimary.click(); // 🔴 jedyne miejsce wywołania
    }
  });

  pass2.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    btnPrimary.click(); // 🔴 jedyne miejsce wywołania
  });

});
