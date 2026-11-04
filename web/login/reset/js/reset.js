import { guardViewportWidth } from "../../../shared/js/core/device-guard.js?v=v2026-11-04T23474";
guardViewportWidth({ minWidth: 0 });
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-04T23474";
import { updateUserLanguage, validatePassword, niceAuthError, getPasswordRulesText, discardCurrentGuestAccount, initPasswordToggles } from "../../../shared/js/core/auth.js?v=v2026-11-04T23474";
import { initI18n, t, getUiLang, withLangParam } from "../../../shared/translation/translation.js?v=v2026-11-04T23474";
import { confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-04T23474";
import { isGuestUser } from "../../../shared/js/core/guest-mode.js?v=v2026-11-04T23474";
import "../../../shared/js/core/contact-modal.js?v=v2026-11-04T23474";


const status = document.getElementById("status");
const err = document.getElementById("err");
const form = document.getElementById("form");
const pwdHint = document.getElementById("pwdHint");
const p1 = document.getElementById("p1");
const p2 = document.getElementById("p2");
const save = document.getElementById("save");
const back = document.getElementById("back");

function setStatus(m){ status.textContent = m; document.querySelector("body > [data-skel-step]")?.classList.add("skel-step-ready"); }
function setErr(m=""){ err.textContent = m; }

function qp(name){
  return new URL(location.href).searchParams.get(name);
}

function hashParams(){
  return new URLSearchParams(location.hash.replace(/^#/, ""));
}

function hp(name){
  return hashParams().get(name);
}

async function requireNoActiveSessionBeforeAuthFlow() {
  let currentUser = null;
  try {
    const { data } = await sb().auth.getUser();
    currentUser = data?.user || null;
  } catch {}

  if (!currentUser) return true;

  const who =
    currentUser.user_metadata?.username ||
    currentUser.email ||
    currentUser.id;

  const ok = await confirmModal({
    title: t("reset.sessionSwitchTitle"),
    text: isGuestUser(currentUser)
      ? t("reset.sessionSwitchGuestText", { who })
      : t("reset.sessionSwitchText", { who }),
    okText: t("reset.sessionSwitchOk"),
    cancelText: t("reset.sessionSwitchCancel"),
  });

  if (!ok) return false;

  if (isGuestUser(currentUser)) {
    await discardCurrentGuestAccount().catch(() => {});
  } else {
    await sb().auth.signOut();
  }
  return true;
}

document.addEventListener("DOMContentLoaded", async () => {
  await initI18n({ withSwitcher: true });
  document.documentElement.classList.remove('page-loading');
  initPasswordToggles();
  if (pwdHint) pwdHint.textContent = getPasswordRulesText();
  setErr("");
  if (back) back.href = withLangParam(back.dataset.baseHref || "/login/");
  const syncLanguage = () => updateUserLanguage(getUiLang());
  window.addEventListener("i18n:lang", syncLanguage);

  const code = qp("code") || hp("code");
  const accessToken = hp("access_token");
  const refreshToken = hp("refresh_token");
  const hashType = hp("type");
  const tokenHash = qp("token_hash") || qp("token") || hp("token_hash") || hp("token");
  const otpType = qp("type") || hashType || "recovery";
  
  const hasAuthPayload = Boolean(code || accessToken || refreshToken || tokenHash);
  if (hasAuthPayload) {
    const ok = await requireNoActiveSessionBeforeAuthFlow();
    if (!ok) {
      setStatus(t("reset.sessionSwitchCancelled"));
      setErr(t("reset.sessionSwitchCancelledHint"));
      back.hidden = false;
      document.documentElement.classList.remove('page-loading');
      return;
    }
  }

  try{
    setStatus(t("reset.statusVerifying"));
    let data = null;

    if (code) {
      const { data: exchangeData, error } = await sb().auth.exchangeCodeForSession(code);
      if (error) throw error;
      data = exchangeData;
    } else if (tokenHash) {
      const { data: verifyData, error } = await sb().auth.verifyOtp({ token_hash: tokenHash, type: otpType });
      if (error) throw error;
      data = verifyData;
    } else if (accessToken || refreshToken || hashType) {
      const { data: sessionData, error } = await sb().auth.getSessionFromUrl({ storeSession: true });
      if (error) throw error;
      data = sessionData;
    } else {
      setStatus(t("reset.missingCode"));
      setErr(t("reset.missingCodeHint"));
      back.hidden = false;
      return;
    }

    if (!data?.session) {
      setStatus(t("reset.startFailed"));
      setErr(t("reset.noSession"));
      back.hidden = false;
      return;
    }

    await syncLanguage();
    setStatus(t("reset.linkOk"));
    form.hidden = false;
  } catch(e){
    console.error(e);
    setStatus(t("reset.verifyFailed"));
    setErr(niceAuthError(e));
    back.hidden = false;
    document.documentElement.classList.remove('page-loading');
    return;
  }

  document.documentElement.classList.remove('page-loading');

  let saveBusy = false;

  save.addEventListener("click", async () => {
    if (saveBusy) return;
    setErr("");

    const a = p1.value;
    const b = p2.value;

    if (a !== b) return setErr(t("reset.errPasswordMismatch"));
    try {
      validatePassword(a);
    } catch (e) {
      return setErr(niceAuthError(e));
    }

    saveBusy = true;
    save.disabled = true;
    try{
      setStatus(t("reset.statusSaving"));
      const { error } = await sb().auth.updateUser({ password: a });
      if (error) throw error;

      setStatus(t("reset.statusSaved"));
      form.hidden = true;
      back.hidden = false;

      // wyloguj sesję recovery dla czystości
      try { await sb().auth.signOut(); } catch {}

      setTimeout(() => (location.href = withLangParam("/login/")), 900);
    } catch(e){
      console.error(e);
      setStatus(t("reset.saveFailed"));
      setErr(niceAuthError(e));
    } finally {
      saveBusy = false;
      save.disabled = false;
    }
  });

  p1?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    p2?.focus();
  });

  p2?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    save?.click();
  });
});
