import { resolveDeviceCode } from "../../../shared/js/core/device-code.js?v=v2026-11-03T22592";
import { initI18n, t, getUiLang } from "../../../shared/translation/translation.js?v=v2026-11-03T22592";
import { getDeviceProfile, TV_HD_RESOLUTION } from "../../../shared/js/core/device-guard.js?v=v2026-11-03T22592";
import { showPageGuard } from "../../../shared/js/core/page-overlay.js?v=v2026-11-03T22592";

await initI18n();
const profile = getDeviceProfile();
const isTv = profile.formFactor === "tv";
const screenTooSmall = isTv && (
  Math.max(profile.screenPixelWidth, profile.screenPixelHeight) < TV_HD_RESOLUTION.width
  || Math.min(profile.screenPixelWidth, profile.screenPixelHeight) < TV_HD_RESOLUTION.height
);
const tvGuardBlocked = !isTv || screenTooSmall;
if (tvGuardBlocked) {
  document.documentElement.removeAttribute("data-device-guard-pending");
  if (screenTooSmall) {
    showPageGuard({ kind: "device", state: "screen", iconName: "fullscreen-enter", titleKey: "pageGuard.screenTitle", messageKey: "pageGuard.screenMessage", backHref: "/connect/" });
  } else {
    showPageGuard({ kind: "device", state: "tv-only", iconName: "display", titleKey: "pageGuard.tvOnlyTitle", messageKey: "pageGuard.tvOnlyMessage", backHref: "/connect/" });
  }
} else {
  document.documentElement.removeAttribute("data-device-guard-pending");
}
if (!tvGuardBlocked) {
const form = document.getElementById("tvConnectForm");
const input = document.getElementById("tvCode");
const button = document.getElementById("tvConnect");
const message = document.getElementById("tvMessage");
let pending = false;
let messageKey = "";
const langButton = document.querySelector(".lang-btn");
const langMenu = document.querySelector(".lang-menu");
function setMessage(key) { messageKey = key; message.textContent = key ? t(`connectDevice.tv.${key}`) : ""; }
langButton?.addEventListener("click", () => {
  if (langMenu && !langMenu.hidden) langMenu.querySelector(`[data-lang="${getUiLang()}"]`)?.focus();
});
window.addEventListener("i18n:lang", () => {
  setMessage(messageKey);
  if (langMenu?.contains(document.activeElement)) langButton?.focus();
});
input.addEventListener("input", () => { input.value = input.value.replace(/\D/g, "").slice(0, 6); });
document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
  if (langMenu && !langMenu.hidden && langMenu.contains(active)) {
    const options = [...langMenu.querySelectorAll(".menu-item")];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      options[(options.indexOf(active) + direction + options.length) % options.length]?.focus();
      return;
    }
    if (["Escape", "BrowserBack", "Backspace"].includes(event.key)) {
      event.preventDefault(); langMenu.hidden = true; langButton?.focus(); return;
    }
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const controls = [langButton, input, button].filter(node => node && !node.disabled);
    const direction = event.key === "ArrowDown" ? 1 : -1;
    controls[(controls.indexOf(active) + direction + controls.length) % controls.length]?.focus();
    return;
  }
  if (event.key === "Select" || event.keyCode === 23) {
    event.preventDefault();
    if (active?.tagName === "BUTTON") active.click();
    else if (active === input) form.requestSubmit();
  }
});
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (pending) return;
  const code = input.value.trim();
  if (!/^\d{6}$/.test(code)) { setMessage("invalidFormat"); input.focus(); return; }
  pending = true;
  button.disabled = true;
  setMessage("checking");
  try {
    const data = await resolveDeviceCode(code);
    if (!data?.ok) { setMessage(data?.err === "rate_limited" ? "tooManyAttempts" : "invalidCode"); return; }
    if (!["display", "poll_qr"].includes(data.device_type)) { setMessage("wrongDevice"); return; }
    if (!data.game_id || !data.share_key) throw new Error("missing display credentials");
    const target = new URL("/go/", location.origin);
    target.searchParams.set("d", data.device_type === "poll_qr" ? "qr" : "display");
    target.searchParams.set("id", data.game_id);
    target.searchParams.set("key", data.share_key);
    target.searchParams.set("lang", getUiLang());
    location.replace(target.href);
  } catch {
    setMessage("networkError");
  } finally {
    pending = false;
    button.disabled = false;
  }
});

input.disabled = false;
button.disabled = false;
// Najpierw odsłonić krok szkieletu (visibility:hidden nie przyjmuje fokusu), potem fokus.
document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
input.focus();
}
