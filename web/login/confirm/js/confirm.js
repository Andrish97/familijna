import { guardViewportWidth } from "../../../shared/js/core/device-guard.js?v=v2026-11-08T15035";
guardViewportWidth({ minWidth: 0 });
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-08T15035";
import { niceAuthError } from "../../../shared/js/core/auth.js?v=v2026-11-08T15035";
import { updateUserLanguage, discardCurrentGuestAccount } from "../../../shared/js/core/auth.js?v=v2026-11-08T15035";
import { initI18n, t, getUiLang, withLangParam } from "../../../shared/translation/translation.js?v=v2026-11-08T15035";
import { confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-08T15035";
import { isGuestUser } from "../../../shared/js/core/guest-mode.js?v=v2026-11-08T15035";
import "../../../shared/js/core/contact-modal.js?v=v2026-11-08T15035";


const status = document.getElementById("status");
const err = document.getElementById("err");
const go = document.getElementById("go");
const back = document.getElementById("back");
let sessionInfo = "";

function setStatus(m){ status.textContent = m; document.querySelector("body > [data-skel-step]")?.classList.add("skel-step-ready"); }
function setErr(m=""){ err.textContent = m || sessionInfo; }

function qp(name){
  return new URL(location.href).searchParams.get(name);
}

function hashParams(){
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

function hp(name){
  return hashParams().get(name);
}

async function handleEmailChangeFailed(toEmail, e) {
  console.error(e);
  if (toEmail) {
    try {
      const { data: intentStatus } = await sb().rpc("get_email_intent_status", { p_email: toEmail });
      if (intentStatus === "expired") {
        setStatus(t("confirm.emailChangeCancelled"));
        setErr(t("confirm.emailChangeCancelledHint"));
        back.hidden = false;
        return;
      }
    } catch {}
  }
  setStatus(t("confirm.failed"));
  setErr(niceAuthError(e));
  back.hidden = false;
}

async function requireNoActiveSessionBeforeAuthFlow() {
  let currentUser = null;
  try {
    const { data } = await sb().auth.getUser();
    currentUser = data?.user || null;
  } catch {}

  if (!currentUser) return true;

  // Link zmiany adresu (albo migracji gościa) tego samego konta, otwarty w jego
  // sesji: nic nie przełączamy -- usunięcie gościa skasowałoby przenoszone konto.
  const pendingTo = String(currentUser.user_metadata?.familijna_email_change_pending || "").trim().toLowerCase();
  const linkTo = String(qp("to") || "").trim().toLowerCase();
  if ((qp("type") || hp("type")) === "email_change" && pendingTo && pendingTo === linkTo) return true;

  const who =
    currentUser.user_metadata?.username ||
    currentUser.email ||
    currentUser.id;

  const ok = await confirmModal({
    title: t("confirm.sessionSwitchTitle"),
    text: isGuestUser(currentUser)
      ? t("confirm.sessionSwitchGuestText", { who })
      : t("confirm.sessionSwitchText", { who }),
    okText: t("confirm.sessionSwitchOk"),
    cancelText: t("confirm.sessionSwitchCancel"),
  });

  if (!ok) return false;

  if (isGuestUser(currentUser)) {
    await discardCurrentGuestAccount().catch(() => {});
  } else {
    await sb().auth.signOut();
  }
  return true;
}

async function syncProfileEmail(user) {
  if (!user?.id || !user?.email) return;
  try {
    await sb().from("profiles").update({ email: user.email }).eq("id", user.id);
  } catch (e) {
    console.warn("Profile email update failed:", e);
  }
}

function isPlaceholderUsername(username) {
  const un = String(username || "").trim().toLowerCase();
  if (!un) return true;
  return un.startsWith("guest_");
}

async function shouldSetupUsername(user) {
  if (!user?.id) return false;
  try {
    const { data } = await sb()
      .from("profiles")
      .select("username")
      .eq("id", user.id)
      .maybeSingle();
    if (isPlaceholderUsername(data?.username)) return true;
  } catch {}
  return isPlaceholderUsername(user?.user_metadata?.username);
}

async function markEmailIntentConfirmed(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return;
  try {
    await sb().rpc("email_mark_confirmed", { p_email: e });
  } catch {}
}

// Woływane po realnym potwierdzeniu zmiany e-maila (kliknięty link). Dla
// zwykłej zmiany e-maila zarejestrowanego usera to tylko sprzątanie pending
// flag. Dla migracji gościa (intent="guest_migrate") to jest TEN moment,
// w którym is_guest faktycznie przełącza się na false — patrz komentarz przy
// convertGuestToRegisteredEmailOnly w auth.js. Intent trzeba odczytać z
// metadanych PRZED ich wyczyszczeniem poniżej.
async function finishEmailChangeConfirmation(user) {
  const intent = user?.user_metadata?.familijna_email_change_intent || "";
  try {
    await sb().auth.updateUser({ data: { familijna_email_change_pending: "", familijna_email_change_intent: "" } });
  } catch {}
  if (intent === "guest_migrate") {
    try {
      const { data: finData, error: finErr } = await sb().rpc("guest_finalize_migration");
      if (finErr) console.error("[confirm] guest_finalize_migration failed:", finErr);
      else if (!finData?.ok) console.error("[confirm] guest_finalize_migration returned error:", finData?.error);
    } catch (e) {
      console.error("[confirm] guest_finalize_migration threw:", e);
    }
  }
  await markEmailIntentConfirmed(user?.email || "");
}

async function redirectAfterConfirm(user) {
  if (await shouldSetupUsername(user)) {
    location.href = withLangParam("/login/?setup=username");
    return;
  }
  location.href = withLangParam("/games/");
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
  await initI18n({ withSwitcher: true });
  document.documentElement.classList.remove('page-loading');
  setErr("");
  if (go) go.href = withLangParam(go.dataset.baseHref || "/games/");
  if (back) back.href = withLangParam(back.dataset.baseHref || "/login/");
  const syncLanguage = () => updateUserLanguage(getUiLang());
  window.addEventListener("i18n:lang", syncLanguage);

  try {
    const { data } = await sb().auth.getSession();
    if (data?.session?.user) {
      await syncLanguage();
      sessionInfo = t("confirm.sessionInfo");
      setErr("");
    }
  } catch {}

  const hashError = hp("error_description") || hp("error");
  const hashMessage = hp("message");
  const queryError = qp("error_description") || qp("error");
  const queryMessage = qp("message");
  if (hashError || queryError) {
    const raw = hashError || queryError;
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    if (decoded.toLowerCase().includes("already") || decoded.toLowerCase().includes("used")) {
      setStatus(t("confirm.linkAlreadyUsed"));
      setErr(t("confirm.linkAlreadyUsedHint"));
    } else {
      setStatus(t("confirm.linkInvalid"));
      setErr(decoded);
    }
    back.hidden = false;
    return;
  }

  const code = qp("code") || hp("code");
  const accessToken = hp("access_token");
  const refreshToken = hp("refresh_token");
  const hashType = hp("type");
  const tokenHash = qp("token_hash") || qp("token") || hp("token_hash") || hp("token");
  const otpType = qp("type") || hashType;
  
  const hasAuthPayload = Boolean(code || accessToken || refreshToken || tokenHash);
  if (hasAuthPayload) {
    const ok = await requireNoActiveSessionBeforeAuthFlow();
    if (!ok) {
      setStatus(t("confirm.sessionSwitchCancelled"));
      setErr(t("confirm.sessionSwitchCancelledHint"));
      back.hidden = false;
      return;
    }
  }

  if ((hashMessage || queryMessage) && !code && !accessToken && !refreshToken) {
    const raw = hashMessage || queryMessage;
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    if (decoded.toLowerCase().includes("confirm link sent to the other email")) {
      setStatus(t("confirm.firstLinkConfirmed"));
      setErr(t("confirm.firstLinkConfirmedHint"));
    } else {
      setStatus(decoded);
      setErr(t("confirm.checkOtherEmail"));
    }
    back.hidden = false;
    return;
  }
  
  if (!code) {
    if (tokenHash && otpType) {
      try {
        setStatus(t("confirm.activating"));
        const { data, error } = await sb().auth.verifyOtp({ token_hash: tokenHash, type: otpType });
        if (error) throw error;
        if (data?.session) {
          await syncLanguage();
          await syncProfileEmail(data.session.user);
          if (otpType === "email_change") {
            await finishEmailChangeConfirmation(data.session.user);
          }
          setStatus(t("confirm.done"));
          go.hidden = false;
          setTimeout(() => { void redirectAfterConfirm(data.session.user); }, 700);
          return;
        }
        setStatus(t("confirm.savedNoSession"));
        back.hidden = false;
        return;
      } catch (e) {
        if (otpType === "email_change") { await handleEmailChangeFailed(qp("to"), e); return; }
        console.error(e);
        setStatus(t("confirm.failed"));
        setErr(niceAuthError(e));
        back.hidden = false;
        return;
      }
    }
    if (accessToken || refreshToken || hashType) {
      try {
        setStatus(t("confirm.activating"));
        const { data, error } = await sb().auth.getSessionFromUrl({ storeSession: true });
        if (error) throw error;

        if (data?.session) {
          await syncLanguage();
          await syncProfileEmail(data.session.user);
          if (otpType === "email_change") {
            await finishEmailChangeConfirmation(data.session.user);
          }
          setStatus(t("confirm.done"));
          go.hidden = false;
          setTimeout(() => { void redirectAfterConfirm(data.session.user); }, 700);
          return;
        }

        setStatus(t("confirm.savedNoSession"));
        back.hidden = false;
        return;
      } catch (e) {
        if (otpType === "email_change") { await handleEmailChangeFailed(qp("to"), e); return; }
        console.error(e);
        setStatus(t("confirm.failed"));
        setErr(niceAuthError(e));
        back.hidden = false;
        return;
      }
    }

    setStatus(t("confirm.missingCode"));
    setErr(t("confirm.missingCodeHint"));
    back.hidden = false;
    return;
  }

  try{
    setStatus(t("confirm.activating"));
    const { data, error } = await sb().auth.exchangeCodeForSession(code);
    if (error) throw error;

    if (data?.session) {
      await syncLanguage();
      await syncProfileEmail(data.session.user);
      if (otpType === "email_change") {
        await finishEmailChangeConfirmation(data.session.user);
      }
      setStatus(t("confirm.done"));
      go.hidden = false;
      setTimeout(() => { void redirectAfterConfirm(data.session.user); }, 700);
    } else {
      setStatus(t("confirm.confirmedNoSession"));
      back.hidden = false;
    }
  } catch(e){
    if (otpType === "email_change") { await handleEmailChangeFailed(qp("to"), e); return; }
    console.error(e);
    const msg = e?.message || String(e);
    const low = msg.toLowerCase();
    if (low.includes("already") || low.includes("used")) {
      setStatus(t("confirm.linkAlreadyUsed"));
      setErr(t("confirm.linkAlreadyUsedHint"));
    } else {
      setStatus(t("confirm.failed"));
      setErr(msg);
    }
    back.hidden = false;
  }
  } finally {
    document.documentElement.classList.remove('page-loading');
  }
});
