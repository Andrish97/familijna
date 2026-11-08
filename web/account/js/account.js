import { ensureUsernameAvailable } from "../../shared/js/core/username-availability.js?v=v2026-11-08T20154";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T20154";
import { cooldownGet, cooldownReserve, cooldownRelease, mailCooldownEmailReserve } from "../../shared/js/core/cooldown.js?v=v2026-11-08T20154";
import { updateUserLanguage, validatePassword, validateUsername, preloadUsernameRules, signOut, niceAuthError, initPasswordToggles, convertGuestToRegisteredEmailOnly, reauthWithPassword } from "../../shared/js/core/auth.js?v=v2026-11-08T20154";
import { getUserEmailNotificationsFlag, setUserEmailNotificationsFlag } from "../../shared/js/core/user-flags.js?v=v2026-11-08T20154";
import { pushSupport, getPushState, enablePush, disablePush, savePushKinds } from "../../shared/js/core/push.js?v=v2026-11-08T20154";
import { initI18n, t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-08T20154";
import { linkTo, loginUrl } from "../../shared/js/core/nav-map.js?v=v2026-11-08T20154";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T20154";
import { toast } from "../../shared/js/core/toast.js?v=v2026-11-08T20154";
import { confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-08T20154";
import { isGuestUser, hideForGuest } from "../../shared/js/core/guest-mode.js?v=v2026-11-08T20154";
import "../../shared/js/core/contact-modal.js?v=v2026-11-08T20154";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-11-08T20154";
import { openRatingEditor } from "../../shared/js/core/rating-system.js?v=v2026-11-08T20154";

const usernameInput = document.getElementById("username");
const emailInput = document.getElementById("email");
const emailRepeatInput = document.getElementById("email2");
const emailActions = document.getElementById("emailActions");
const pass1 = document.getElementById("pass1");
const pass2 = document.getElementById("pass2");
const deletePassword = document.getElementById("deletePassword");

const emailNotificationsChk = document.getElementById("emailNotifications");
const emailNotifSaved = document.getElementById("emailNotifSaved");

const saveUsername = document.getElementById("saveUsername");
const saveEmail = document.getElementById("saveEmail");
const savePass = document.getElementById("savePass");
const deleteAccount = document.getElementById("deleteAccount");
const backToGames = document.getElementById("backToGames");

const usernameCooldownEl = document.getElementById("usernameCooldown");
const emailCooldownEl = document.getElementById("emailCooldown");
const passwordCooldownEl = document.getElementById("passwordCooldown");

const emailPendingActions = document.getElementById("emailPendingActions");
const emailPendingHint = document.getElementById("emailPendingHint");
const resendEmailChange = document.getElementById("resendEmailChange");
const cancelEmailChange = document.getElementById("cancelEmailChange");

const migrateSection = document.getElementById("migrateSection");
const migrateUsername = document.getElementById("migrateUsername");
const migrateEmail = document.getElementById("migrateEmail");
const migratePass1 = document.getElementById("migratePass1");
const migratePass2 = document.getElementById("migratePass2");
const btnMigrate = document.getElementById("btnMigrate");
const migratePendingActions = document.getElementById("migratePendingActions");
const migratePendingHint = document.getElementById("migratePendingHint");
const migrateResend = document.getElementById("migrateResend");
const migrateCancel = document.getElementById("migrateCancel");

// Komunikat po akcji = wspólny dymek (toast); pola #status na stronie nie ma.
function setStatus(m = "") { if (m) toast(m); }

// Błąd = dymek błędu (toast kind:"error"); pustego wywołania nie ma, bo dymek zastępuje poprzedni.
function setErr(m = "") { if (m) toast(m, { kind: "error" }); }
let emailNotifTimer = null;

function showEmailNotifSaved(msg = "", kind = "check") {
  if (!emailNotifSaved) return;
  if (emailNotifTimer) clearTimeout(emailNotifTimer);
  if (!msg) {
    emailNotifSaved.hidden = true;
    emailNotifSaved.textContent = "";
    return;
  }
  emailNotifSaved.innerHTML = iconText(kind, msg);
  emailNotifSaved.hidden = false;
  emailNotifTimer = setTimeout(() => {
    if (emailNotifSaved) emailNotifSaved.hidden = true;
  }, 2200);
}

async function initEmailNotificationsUi(user) {
  if (!emailNotificationsChk || !user?.id) return;

  try {
    const enabled = await getUserEmailNotificationsFlag(user.id);
    emailNotificationsChk.checked = enabled !== false;
  } catch (e) {
    console.warn("email_notifications load failed", e);
    emailNotificationsChk.disabled = true;
    showEmailNotifSaved(t("account.emailNotifLoadFailed"), "error");
    return;
  }

  emailNotificationsChk.addEventListener("change", async () => {
    const next = !!emailNotificationsChk.checked;

    if (!next) {
      const ok = await confirmModal({
        title: t("account.emailNotifDisableTitle"),
        text: t("account.emailNotifDisableConfirm"),
        okText: t("common.modal.promptOk"),
        cancelText: t("common.modal.promptCancel"),
        danger: true,
      });

      if (!ok) {
        emailNotificationsChk.checked = true;
        return;
      }
    }

    emailNotificationsChk.disabled = true;
    try {
      await setUserEmailNotificationsFlag(user.id, next);
      showEmailNotifSaved(next ? t("account.emailNotifSavedOn") : t("account.emailNotifSavedOff"));
    } catch (e) {
      console.error(e);
      emailNotificationsChk.checked = !next; // rollback
      showEmailNotifSaved(t("account.emailNotifSaveFailed"), "error");
    } finally {
      emailNotificationsChk.disabled = false;
    }
  });
}

// --- powiadomienia push na tym urządzeniu (E29) ---
const pushSection = document.getElementById("pushNotifSection");
const pushChk = document.getElementById("pushNotifications");
const pushKinds = document.getElementById("pushKinds");
const pushStatus = document.getElementById("pushStatus");
const pushSaved = document.getElementById("pushSaved");
let pushSavedTimer = null;

function showPushSaved(msg = "", kind = "check") {
  if (!pushSaved) return;
  if (pushSavedTimer) clearTimeout(pushSavedTimer);
  pushSaved.innerHTML = iconText(kind, msg);
  pushSaved.hidden = !msg;
  pushSavedTimer = setTimeout(() => { if (pushSaved) pushSaved.hidden = true; }, 2500);
}

function pushKindInputs() {
  return [...(pushKinds?.querySelectorAll('input[type="checkbox"]') || [])];
}

// Wszystkie zaznaczone = [] (także przyszłe rodzaje); inaczej wybrane.
function selectedPushKinds() {
  const inputs = pushKindInputs();
  const on = inputs.filter((i) => i.checked).map((i) => i.value);
  return on.length === inputs.length ? [] : on;
}

function renderPushSupport() {
  const support = pushSupport();
  const key = { blocked: "account.pushBlocked", "ios-install": "account.pushIosInstall", unsupported: "account.pushUnsupported" }[support];
  if (pushStatus) {
    pushStatus.textContent = key ? t(key) : "";
    pushStatus.hidden = !key;
  }
  if (pushChk) pushChk.disabled = support !== "ok";
  return support;
}

function renderPushState({ subscribed, kinds }) {
  if (pushChk) pushChk.checked = subscribed;
  if (pushKinds) pushKinds.hidden = !subscribed;
  for (const input of pushKindInputs()) input.checked = !kinds.length || kinds.includes(input.value);
}

async function initPushUi() {
  if (!pushSection || !pushChk) return;
  const support = renderPushSupport();
  if (support === "ok") {
    try { renderPushState(await getPushState()); } catch (e) { console.warn("push state", e); }
  }

  pushChk.addEventListener("change", async () => {
    const next = pushChk.checked;
    pushChk.disabled = true;
    try {
      if (next) await enablePush(selectedPushKinds());
      else await disablePush();
      renderPushState(next ? { subscribed: true, kinds: selectedPushKinds() } : { subscribed: false, kinds: [] });
      showPushSaved(next ? t("account.pushSavedOn") : t("account.pushSavedOff"));
    } catch (e) {
      console.warn("push toggle", e);
      pushChk.checked = !next;
      if (pushKinds) pushKinds.hidden = !pushChk.checked;
      const msg = e?.message === "blocked" ? "account.pushBlocked" : e?.message === "dismissed" ? "account.pushDismissed" : "account.pushSaveFailed";
      showPushSaved(t(msg), "error");
    } finally {
      renderPushSupport();
    }
  });

  for (const input of pushKindInputs()) {
    input.addEventListener("change", async () => {
      if (!pushKindInputs().some((i) => i.checked)) { input.checked = true; return; }
      try {
        await savePushKinds(selectedPushKinds());
        showPushSaved(t("account.pushSaved"));
      } catch (e) {
        console.warn("push kinds", e);
        input.checked = !input.checked;
        showPushSaved(t("account.pushSaveFailed"), "error");
      }
    });
  }
}

// --- cooldowns (anti-spam) ---
// Per-user (server-side) cooldown via RPC (cross-device).
// DB is the source of truth; UI only renders countdown.
const COOLDOWN_SECONDS = 60 * 60;

const CD = {
  username: "account:username",
  email: "account:email",
  password: "account:password",
};

const cooldownBindings = [];
let cooldownTimer = null;
let cooldownTickDelayMs = 1000;

// in-memory cache of next_allowed timestamps (ms)
const cooldownEndMs = new Map();

function getCooldownEnd(key) {
  return cooldownEndMs.get(key) || 0;
}

function getRemainingMs(key) {
  const end = getCooldownEnd(key);
  return Math.max(0, end - Date.now());
}

function formatRemaining(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function bindCooldown({ key, labelEl, disableEls }) {
  cooldownBindings.push({ key, labelEl, disableEls });
}

function tickCooldowns() {
  let hasActiveCooldown = false;
  cooldownBindings.forEach(({ key, labelEl, disableEls }) => {
    const rem = getRemainingMs(key);
    if (rem > 0) hasActiveCooldown = true;
    const active = rem > 0;
    if (labelEl) {
      labelEl.hidden = !active;
      labelEl.textContent = active ? t("account.cooldown", { time: formatRemaining(rem) }) : "";
    }

    (disableEls || []).forEach((el) => {
      if (!el) return;
      if (active) el.disabled = true;
      else if (!el.dataset.locked) el.disabled = false;
    });
  });

  const nextDelay = hasActiveCooldown ? 1000 : 5000;
  if (cooldownTickDelayMs !== nextDelay) {
    cooldownTickDelayMs = nextDelay;
    if (cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = setInterval(tickCooldowns, cooldownTickDelayMs);
    }
  }
}

function startCooldownTicker() {
  if (cooldownTimer) return;
  cooldownTimer = setInterval(tickCooldowns, cooldownTickDelayMs);
  tickCooldowns();
}

async function loadCooldownsFromServer() {
  const keys = Object.values(CD);
  const map = await cooldownGet(keys);
  keys.forEach((k) => cooldownEndMs.set(k, map.get(k) || 0));
  tickCooldowns();
}

// Atomically reserves the cooldown window in DB (cross-device anti-spam).
async function reserveCooldownOrThrow(key) {
  const res = await cooldownReserve(key, COOLDOWN_SECONDS);

  if (Number.isFinite(res.nextAllowedAtMs) && res.nextAllowedAtMs > 0) {
    cooldownEndMs.set(key, res.nextAllowedAtMs);
  }
  tickCooldowns();

  if (!res.ok) {
    const rem = getRemainingMs(key);
    throw new Error(t("account.errCooldown", { time: formatRemaining(rem) }));
  }
  return res;
}

// --- Migracja konta gościa ---
// Ten sam klucz co w login.js (guest-migrate flow) — cooldown w bazie jest
// per-email, więc musi być identyczny niezależnie skąd gość próbuje, inaczej
// mógłby obejść 1h limit przełączając się między /login a /account.
const GUEST_UPGRADE_ACTION_KEY = "auth:guest_upgrade_email";
// Czas trwania (1h) jest teraz DANE w mail_cooldown_policies (migracja
// 288/293), nie parametrem wywołania.

let migratePendingEmail = "";

function lockMigrateEl(el, locked) {
  if (!el) return;
  if (locked) el.dataset.locked = "1";
  else delete el.dataset.locked;
  el.disabled = !!locked;
}

function setMigratePendingUi(pendingEmail) {
  migratePendingEmail = pendingEmail || "";
  const hasPending = !!migratePendingEmail;

  if (migratePendingActions) migratePendingActions.hidden = !hasPending;
  if (btnMigrate) btnMigrate.hidden = hasPending;

  if (migratePendingHint) {
    migratePendingHint.hidden = !hasPending;
    migratePendingHint.textContent = hasPending
      ? t("account.migratePendingHint", { email: migratePendingEmail })
      : "";
  }

  [migrateUsername, migrateEmail, migratePass1, migratePass2].forEach((el) => lockMigrateEl(el, hasPending));
  if (hasPending && migrateEmail) migrateEmail.value = migratePendingEmail;
}

async function refreshMigrateState() {
  try {
    // Z serwera (getUser), nie z tokenu sesji: token po wysłaniu linku bywa
    // nieaktualny -- "Anuluj" uznawał wtedy, że nie ma czego anulować, i link
    // z maila dalej przenosił konto (jak w refreshAuthEmailState).
    const { data, error } = await sb().auth.getUser();
    if (error) throw error;
    setMigratePendingUi(extractPendingEmail(data?.user));
  } catch (e) {
    console.warn("[migrate] refreshMigrateState failed:", e);
  }
}

async function handleMigrateSubmit() {
  try {
    const mail = String(migrateEmail?.value || "").trim().toLowerCase();
    if (!mail || !mail.includes("@")) throw new Error(t("auth.errInvalidEmail"));

    const pwd = migratePass1?.value || "";
    if (pwd !== (migratePass2?.value || "")) throw new Error(t("account.errPasswordMismatch"));
    validatePassword(pwd);

    // Opcjonalna — jeśli puste, po potwierdzeniu i tak zadziała istniejący
    // fallback (login.js pokaże ekran ustawienia nazwy, tak jak dla każdego
    // konta bez username).
    const rawUsername = String(migrateUsername?.value || "").trim();
    const username = rawUsername ? validateUsername(rawUsername) : "";

    const reserve = await mailCooldownEmailReserve(GUEST_UPGRADE_ACTION_KEY, mail);
    if (!reserve.ok) {
      const left = (reserve.nextAllowedAtMs || 0) - Date.now();
      throw new Error(
        left > 0
          ? t("auth.errResendCooldown", { time: formatRemaining(left) })
          : t("auth.errResendCooldownGeneric")
      );
    }

    // Hasło i nazwa NIE trafiają do auth.users/profiles teraz — leżą
    // zahaszowane w guest_migration_staging aż do realnego potwierdzenia
    // maila (guest_finalize_migration() w confirm.js). Dzięki temu konto
    // zostaje gościem (is_guest=true) przez cały czas oczekiwania — patrz
    // komentarz przy convertGuestToRegisteredEmailOnly w auth.js.
    const { data: stageData, error: stageErr } = await sb().rpc("guest_stage_migration", {
      p_username: username || null,
      p_password: pwd,
    });
    if (stageErr) throw stageErr;
    if (!stageData?.ok) {
      if (stageData?.error === "invalid_username") throw new Error(t("auth.usernameChars"));
      throw new Error(stageData?.error || t("account.errCancelMigrationFailed"));
    }

    await convertGuestToRegisteredEmailOnly(mail, getUiLang());

    setStatus(t("account.statusMigrateSent"));
    setMigratePendingUi(mail);
  } catch (e) {
    console.error(e);
    setErr(niceAuthError(e));
  }
}

async function handleMigrateResend() {
  try {
    if (!migratePendingEmail) throw new Error(t("account.errNoPendingEmail"));

    const reserve = await mailCooldownEmailReserve(GUEST_UPGRADE_ACTION_KEY, migratePendingEmail);
    if (!reserve.ok) {
      const left = (reserve.nextAllowedAtMs || 0) - Date.now();
      throw new Error(
        left > 0
          ? t("auth.errResendCooldown", { time: formatRemaining(left) })
          : t("auth.errResendCooldownGeneric")
      );
    }

    const language = getUiLang();
    const redirect = new URL("/login/confirm/", location.origin);
    redirect.searchParams.set("lang", language);
    redirect.searchParams.set("to", migratePendingEmail);

    // Ta sama droga co pierwsza wysyłka. auth.resend szuka konta po obecnym
    // adresie, więc z nowym adresem kończył się "sukcesem" bez maila.
    const { error } = await sb().auth.updateUser(
      { email: migratePendingEmail },
      { emailRedirectTo: redirect.toString() }
    );
    if (error) throw error;

    setStatus(t("account.statusMigrateResent"));
  } catch (e) {
    console.error(e);
    setErr(niceAuthError(e));
  }
}

async function handleMigrateCancel() {
  let emailBeforeCancel = "";
  try {
    await refreshMigrateState();
    if (!migratePendingEmail) {
      return;
    }
    emailBeforeCancel = migratePendingEmail; // setMigratePendingUi("") poniżej nadpisuje migratePendingEmail

    setMigratePendingUi(""); // optymistyczna aktualizacja UI

    // Odkąd submit migracji już NIE flipuje profiles.is_guest przedwcześnie
    // (patrz komentarz przy guest_migration_staging w migracji 249), samo
    // konto cały czas jest gościem — guest_cancel_migration() tylko czyści
    // pending e-mail/token/staging (username+hasło czekające na potwierdzenie)
    // i odświeża guest_expires_at. Działa dopóki e-mail faktycznie nie
    // został jeszcze potwierdzony.
    const { data: rpcData, error: rpcErr } = await sb().rpc("guest_cancel_migration");
    if (rpcErr) throw rpcErr;
    if (!rpcData?.ok) throw new Error(rpcData?.error || t("account.errCancelMigrationFailed"));

    // Metadane JWT (familijna_email_change_pending/intent) trzeba wyczyścić
    // osobno — RPC dotyka tylko profiles/auth.users, nie user_metadata.
    const { error: metaErr } = await sb().auth.updateUser({
      data: { familijna_email_change_pending: "", familijna_email_change_intent: "" },
    });
    if (metaErr) throw metaErr;

    // Weryfikacja u źródła: ten sam mechanizm, którego UI używa do wykrywania
    // stanu pending, musi teraz pokazywać "brak pending" — inaczej "Anuluj"
    // kłamałoby o sukcesie (dokładnie ten bug, który złapał e2e test wcześniej).
    await refreshMigrateState();
    if (migratePendingEmail) throw new Error(t("account.errCancelMigrationFailed"));

    setStatus(t("account.statusMigrateCancelled"));
  } catch (e) {
    console.error(e);
    if (emailBeforeCancel) setMigratePendingUi(emailBeforeCancel); // cofnij optymistyczną aktualizację — anulowanie się nie udało
    setErr(niceAuthError(e));
  }
}

// --- email change pending state ---
let currentEmail = "";
let pendingEmail = "";

function extractPendingEmail(u) {
  const candidates = [
    u?.new_email,
    u?.newEmail,
    u?.email_change?.new_email,
    u?.email_change?.email,
    u?.user_metadata?.new_email,
    u?.user_metadata?.newEmail,
    u?.user_metadata?.familijna_email_change_pending,
  ];
  return candidates.find((v) => typeof v === "string" && v.includes("@")) || "";
}

function lockEl(el, locked) {
  if (!el) return;
  if (locked) el.dataset.locked = "1";
  else delete el.dataset.locked;
  el.disabled = !!locked;
}

function setEmailPendingUi(nextPendingEmail) {
  pendingEmail = nextPendingEmail || "";
  const hasPending = !!pendingEmail && pendingEmail !== currentEmail;

  if (emailPendingActions) emailPendingActions.hidden = !hasPending;
  if (emailActions) emailActions.hidden = hasPending;
  if (emailRepeatInput) emailRepeatInput.value = "";

  if (emailPendingHint) {
    emailPendingHint.hidden = !hasPending;
    emailPendingHint.textContent = hasPending ? t("account.emailPendingText", { email: pendingEmail }) : "";
  }

  if (hasPending) {
    if (emailInput) {
      emailInput.value = pendingEmail;
      lockEl(emailInput, true);
    }
    lockEl(saveEmail, true);
  } else {
    if (emailInput) {
      emailInput.value = currentEmail || "";
      lockEl(emailInput, false);
    }
    lockEl(saveEmail, false);
  }

  // cooldown may additionally disable resend (cancel is always allowed)
  tickCooldowns();
}

async function refreshAuthEmailState() {
  try {
    // getUser() reads GoTrue's current user record. The access token returned by
    // getSession() can still contain old metadata after updateUser(email, data),
    // even after a page reload; treating it as authoritative hid the pending UI.
    const { data, error } = await sb().auth.getUser();
    if (error) throw error;
    const u = data?.user;
    if (!u) return;
    currentEmail = u.email || currentEmail;
    setEmailPendingUi(extractPendingEmail(u));
  } catch (e) {
    console.warn("refreshAuthEmailState failed:", e);
    // A temporary GoTrue failure must not erase the currently displayed state.
  }
}

let emailStateTimer = null;

function startEmailStateWatcher() {
  if (emailStateTimer) return;
  const tick = () => {
    if (document.visibilityState !== "visible") return;
    refreshAuthEmailState();
  };
  // refresh when user returns to the tab/window
  window.addEventListener("focus", tick);
  document.addEventListener("visibilitychange", tick);
  // periodic refresh (cross-device confirmations)
  emailStateTimer = setInterval(tick, 30_000);
}


async function loadUserRating(userId) {
  const container = document.getElementById("userRatingInfo");
  if (!container) return;

  let data = null;
  try {
    const res = await sb()
      .from("app_ratings")
      .select("stars,comment")
      .eq("user_id", userId)
      .maybeSingle();
    if (res.error) throw res.error;
    data = res.data;
  } catch (e) {
    console.warn("loadUserRating failed", e);
    return;
  }

  container.replaceChildren();
  if (data) {
    const info = document.createElement("div");
    info.className = "rating-info";
    info.innerHTML = `
      <div class="rating-stars">
        <span class="label">${t("common.rating.account.stars")}</span>
        <span class="value gold">${icon("star").repeat(data.stars) + icon("star-empty").repeat(5 - data.stars)}</span>
      </div>`;
    if (data.comment) {
      const box = document.createElement("div");
      box.className = "rating-comment-box";
      const label = document.createElement("span");
      label.className = "label";
      label.textContent = t("common.rating.account.comment");
      const value = document.createElement("div");
      value.className = "value italic";
      value.textContent = `"${data.comment}"`;
      box.append(label, value);
      info.append(box);
    }
    container.append(info);
  } else {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = t("common.rating.account.notRated");
    container.append(hint);
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "ratingEditBtn";
  btn.className = `btn sm${data ? "" : " gold"}`;
  btn.innerHTML = iconText(data ? "pencil" : "star", t(data ? "common.rating.account.change" : "common.rating.account.rate"));
  btn.addEventListener("click", async () => {
    if (!(await openRatingEditor(userId, data))) return;
    toast(t("common.rating.account.saved"));
    await loadUserRating(userId);
  });
  container.append(btn);
}

async function wireDemoActions(user) {
  const btn = document.getElementById("demoRestoreBtn");
  if (!btn || !user?.id) return;

  btn.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: t("manual.demo.modalTitle"),
      text: t("manual.demo.modalText"),
      okText: t("manual.demo.modalOk"),
      cancelText: t("manual.demo.modalCancel"),
    });
    if (!ok) return;
    const lang = localStorage.getItem("uiLang") || "pl";

    const { error } = await sb().rpc("restore_my_demo", { p_lang: lang });
    if (error) {
      console.error("restore_my_demo error:", error);
      toast(t("manual.demo.restoreFailed"), { kind: "error" });
      return;
    }

    // Pliki usuniętych gier i logo sprząta baza (migracja 313).
    location.href = linkTo("games");
  });
}

async function loadProfile(user) {
  if (!user) return; // initPage przekierował na logowanie

  if (isGuestUser(user)) {
    // Gość nie ma username/email/hasła ani demo (demo dotyka wyłącznie
    // zwykłych kont) — zostaje mu ocena systemu (jak każdemu, 527), sekcja
    // usuwania konta (uproszczone potwierdzenie, patrz handleDeleteAccount)
    // oraz sekcja migracji (zamiany konta gościa na pełne, patrz niżej).
    hideForGuest(user, [
      document.getElementById("usernameSection"),
      document.getElementById("emailSection"),
      document.getElementById("passwordSection"),
      document.getElementById("emailNotifSection"),
      document.getElementById("demoSection"),
      // pole hasła siedzi w .pass-wrap razem z przyciskiem „pokaż hasło”
      deletePassword?.closest(".pass-wrap") || deletePassword,
    ]);
    const deleteHintEl = document.getElementById("deleteHint");
    if (deleteHintEl) deleteHintEl.textContent = t("account.deleteHintGuest");

    if (migrateSection) migrateSection.hidden = false;
    window.addEventListener("i18n:lang", () => loadUserRating(user.id));
    await loadUserRating(user.id);
    await refreshMigrateState();

    return;
  }

  const syncLanguage = () => updateUserLanguage(getUiLang());
  await syncLanguage();
  window.addEventListener("i18n:lang", () => {
    syncLanguage();
    // refresh dynamic texts after language switch
    setEmailPendingUi(pendingEmail);
    loadUserRating(user.id);
    tickCooldowns();
  });

  usernameInput.value = user.username || "";
  emailInput.value = user.email || "";
  currentEmail = user.email || "";

  await initEmailNotificationsUi(user);
  void initPushUi();
  await loadUserRating(user.id);
  await wireDemoActions(user);

  await refreshAuthEmailState();
  await loadCooldownsFromServer();
  startEmailStateWatcher();
}

async function handleUsernameSave() {
  let reserved = false;
  try {
    const username = validateUsername(usernameInput.value || "");
    const { data: userData, error: userError } = await sb().auth.getUser();
    if (userError || !userData?.user) throw new Error(t("auth.errNoSession"));
    await ensureUsernameAvailable(username);

    await reserveCooldownOrThrow(CD.username);
    reserved = true;

    const { error } = await sb()
      .from("profiles")
      .update({ username })
      .eq("id", userData.user.id);
    if (error) throw error;

    const { error: metaErr } = await sb().auth.updateUser({ data: { username } });
    if (metaErr) throw metaErr;

    setStatus(t("account.statusUsernameSaved"));
    await loadCooldownsFromServer();
  } catch (e) {
    console.error(e);
    if (reserved) {
      try {
        await cooldownRelease(CD.username, 60);
        await loadCooldownsFromServer();
      } catch {}
    }
    setErr(niceAuthError(e));
  }
}

async function handleEmailSave() {
  let reserved = false;
  try {
    if (pendingEmail && pendingEmail !== currentEmail) {
      throw new Error(t("account.errEmailPending"));
    }

    const mail = String(emailInput.value || "").trim();
    if (!mail || !mail.includes("@")) throw new Error(t("account.errInvalidEmail"));

    const normalizedMail = mail.toLowerCase();
    if (normalizedMail === currentEmail.toLowerCase()) throw new Error(t("account.errEmailSameAsCurrent"));
    // Potwierdza tylko nowy adres, więc literówka = link w cudzej skrzynce.
    const repeated = String(emailRepeatInput?.value || "").trim().toLowerCase();
    if (repeated !== normalizedMail) throw new Error(t("account.errEmailMismatch"));

    const language = getUiLang();

    const confirmUrl = new URL("/login/confirm/", location.origin);
    confirmUrl.searchParams.set("lang", language);
    confirmUrl.searchParams.set("to", normalizedMail);

    await reserveCooldownOrThrow(CD.email);
    reserved = true;

    const { error } = await sb().auth.updateUser(
      { email: normalizedMail, data: { language, familijna_email_change_pending: normalizedMail } },
      { emailRedirectTo: confirmUrl.toString() }
    );
    if (error) throw error;

    // Record pending intent so auth-email-status reflects current state
    await sb().rpc("initiate_email_change_intent", { p_new_email: normalizedMail });

    await refreshAuthEmailState();
    await loadCooldownsFromServer();
    // Odświeżenie pending UI ustawia ogólny status „zmiana w toku”. Po
    // zakończonej operacji ważniejszy jest jednoznaczny komunikat sukcesu.
    setStatus(t("account.statusEmailSaved"));
  } catch (e) {
    console.error(e);
    if (reserved) {
      try {
        await cooldownRelease(CD.email, 60);
        await loadCooldownsFromServer();
      } catch {}
    }
    setErr(niceAuthError(e));
  }
}

async function handleEmailResend() {
  let reserved = false;
  try {
    if (!pendingEmail || pendingEmail === currentEmail) {
      throw new Error(t("account.errNoPendingEmail"));
    }

    const language = getUiLang();
    const confirmUrl = new URL("/login/confirm/", location.origin);
    confirmUrl.searchParams.set("lang", language);
    confirmUrl.searchParams.set("to", pendingEmail);

    await reserveCooldownOrThrow(CD.email);
    reserved = true;

    // Ta sama droga co pierwsza wysyłka (nowy token, nowy mail). auth.resend
    // szuka konta po obecnym adresie, więc z nowym kończył się "sukcesem" bez maila.
    const { error } = await sb().auth.updateUser(
      { email: pendingEmail },
      { emailRedirectTo: confirmUrl.toString() }
    );
    if (error) throw error;

    // Optymistyczna aktualizacja UI, aby przycisk Anuluj pojawił się natychmiast
    setEmailPendingUi(pendingEmail);

    await refreshAuthEmailState();
    await loadCooldownsFromServer();
    // setEmailPendingUi() poprawnie zachowuje pending e-mail, ale jego ogólny
    // status nie może zasłaniać informacji, że ponowne wysłanie się udało.
    setStatus(t("account.statusEmailResent"));
  } catch (e) {
    console.error(e);
    if (reserved) {
      try {
        await cooldownRelease(CD.email, 60);
        await loadCooldownsFromServer();
      } catch {}
    }
    setErr(niceAuthError(e));
  }
}

async function handleEmailCancel() {
  try {
    // state might have changed on another device (confirmed already)
    await refreshAuthEmailState();

    if (!pendingEmail || pendingEmail === currentEmail) {
      setEmailPendingUi("");
      return;
    }

    // Optymistyczna aktualizacja UI, aby przycisk Anuluj zniknął natychmiast
    setEmailPendingUi("");

    // 1. Clear new_email + tokens from auth.users via SECURITY DEFINER RPC
    const { error: rpcErr } = await sb().rpc("cancel_my_email_change");
    if (rpcErr) console.warn("[cancel_my_email_change] rpc error:", rpcErr.message);

    // 2. Clear pending metadata from user_metadata
    const { error: metaErr } = await sb().auth.updateUser({
      data: { familijna_email_change_pending: "", familijna_email_change_intent: "" },
    });
    if (metaErr) throw metaErr;

    // 3. Odświeżenie sesji (token z aktualnymi metadanymi dla innych stron)
    await sb().auth.refreshSession();

    setStatus(t("account.statusEmailCancelled"));
    await refreshAuthEmailState();
    await loadCooldownsFromServer();
  } catch (e) {
    console.error(e);
    setErr(niceAuthError(e));
  }
}

async function handlePassSave() {
  let reserved = false;
  try {
    const a = String(pass1.value || "");
    const b = String(pass2.value || "");
    if (a !== b) throw new Error(t("account.errPasswordMismatch"));
    validatePassword(a);

    await reserveCooldownOrThrow(CD.password);
    reserved = true;

    const { error } = await sb().auth.updateUser({ password: a });
    if (error) throw error;

    pass1.value = "";
    pass2.value = "";
    setStatus(t("account.statusPasswordSaved"));
    await loadCooldownsFromServer();
  } catch (e) {
    console.error(e);
    if (reserved) {
      try {
        await cooldownRelease(CD.password, 60);
        await loadCooldownsFromServer();
      } catch {}
    }
    setErr(niceAuthError(e));
  }
}

async function handleDeleteAccount() {
  try {
    const { data: userData, error: userError } = await sb().auth.getUser();
    if (userError || !userData?.user) throw new Error(t("auth.errNoSession"));

    // isGuestUser(userData.user) sam w sobie czyta TYLKO metadane JWT
    // (user_metadata.is_guest) — te potrafią być spóźnione względem
    // profiles.is_guest tuż po guest_cancel_migration()/guest_convert_account()
    // (potwierdzone live: świeży getUser() zaraz po "Anuluj" pokazywał
    // poprawne is_guest=true, a getUser() wywołany tu chwilę później — już
    // nie). profiles.is_guest jest jedynym źródłem prawdy (ustawiane tylko
    // przez SECURITY DEFINER RPC), więc dociągamy je bezpośrednio zamiast
    // ufać wyłącznie metadanym.
    const { data: profileRow } = await sb()
      .from("profiles")
      .select("is_guest")
      .eq("id", userData.user.id)
      .maybeSingle();
    const isGuest = profileRow?.is_guest === true || isGuestUser(userData.user);

    if (isGuest) {
      // Gość nie ma hasła — jedno potwierdzenie modalem zamiast weryfikacji hasłem.
      const ok = await confirmModal({
        title: t("account.deleteGuestModalTitle"),
        text: t("account.deleteGuestModalText"),
        okText: t("account.deleteGuestModalOk"),
      });
      if (!ok) return;
    } else {
      const pwd = String(deletePassword.value || "");
      if (!pwd) throw new Error(t("account.errDeletePasswordMissing"));
      if (!userData.user.email) throw new Error(t("auth.errNoSession"));

      if (!await reauthWithPassword(pwd)) throw new Error(t("account.errInvalidPassword"));
    }

    const { data, error } = await sb().functions.invoke("delete-account");
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || t("account.errDeleteFailed"));

    await signOut();
    location.href = loginUrl();
  } catch (e) {
    console.error(e);
    setErr(niceAuthError(e));
    toast(niceAuthError(e), { kind: "error" });
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  preloadUsernameRules(); // pole nazwy: lista zastrzeżonych przedrostków z bazy
  const i18nP = initI18n({ withSwitcher: true });
  // Dostęp, „Wstecz”, „Wskazówki” i konto w topbarze wg mapy (auth równolegle z i18n).
  const userP = initPage("account", { ready: i18nP, back: backToGames });
  await i18nP;
  document.documentElement.classList.remove('page-loading');
  initPasswordToggles();

  // cooldown: server state (cross-device)
  bindCooldown({ key: CD.username, labelEl: usernameCooldownEl, disableEls: [usernameInput, saveUsername] });
  bindCooldown({ key: CD.email, labelEl: emailCooldownEl, disableEls: [emailInput, emailRepeatInput, saveEmail, resendEmailChange] });
  bindCooldown({ key: CD.password, labelEl: passwordCooldownEl, disableEls: [pass1, pass2, savePass] });
  startCooldownTicker();

  try {
    await loadProfile(await userP);
  } catch (error) {
    console.error("[account] initial profile load failed:", error);
    setErr(niceAuthError(error));
  }

  saveUsername?.addEventListener("click", handleUsernameSave);
  saveEmail?.addEventListener("click", handleEmailSave);
  savePass?.addEventListener("click", handlePassSave);
  deleteAccount?.addEventListener("click", handleDeleteAccount);

  resendEmailChange?.addEventListener("click", handleEmailResend);
  cancelEmailChange?.addEventListener("click", handleEmailCancel);

  btnMigrate?.addEventListener("click", handleMigrateSubmit);
  migrateResend?.addEventListener("click", handleMigrateResend);
  migrateCancel?.addEventListener("click", handleMigrateCancel);

  usernameInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    saveUsername?.click();
  });

  emailInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    emailRepeatInput?.focus();
  });

  emailRepeatInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    saveEmail?.click();
  });

  pass1?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    pass2?.focus();
  });

  pass2?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    savePass?.click();
  });

  deletePassword?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    deleteAccount?.click();
  });

  // Odsłoń konto dopiero po danych i po podpięciu wszystkich akcji formularzy.
  document.querySelectorAll('[data-skel-step]').forEach(el => el.classList.add('skel-step-ready'));
});
