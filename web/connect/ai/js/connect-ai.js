// Zgoda na dostęp łącznika AI do konta (E30, decyzja 19): Claude, ChatGPT albo
// inny klient MCP przekierowuje tu z /mcp/oauth/authorize (?request=…).
// Konto zarejestrowane (initPage, access: user). Zgoda → adres powrotu klienta
// z jednorazowym kodem; odmowa → adres powrotu z error=access_denied.
import { sb } from "../../../shared/js/core/supabase.js";
import { initI18n, t } from "../../../shared/translation/translation.js";
import { initPage } from "../../../shared/js/core/page-init.js";

const $ = (id) => document.getElementById(id);

function showError(key) {
  $("aiConsent").hidden = true;
  const box = $("aiConsentError");
  box.textContent = t(key);
  box.hidden = false;
}

async function decide(requestId, allow) {
  $("btnAiAllow").disabled = true;
  $("btnAiDeny").disabled = true;
  const { data, error } = await sb().rpc("mcp_authorize_decide", { p_request: requestId, p_allow: allow });
  if (error || !data?.ok || !data.redirect) {
    showError("connectAi.expired");
    return;
  }
  location.replace(data.redirect);
}

(async () => {
  const i18nP = initI18n({ withSwitcher: true });
  const user = await initPage("connectAi", { ready: i18nP });
  await i18nP;
  document.documentElement.classList.remove("page-loading");
  document.querySelectorAll("[data-skel-step]").forEach((el) => el.classList.add("skel-step-ready"));
  if (!user) return;
  const requestId = new URLSearchParams(location.search).get("request") || "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return showError("connectAi.expired");
  const { data, error } = await sb().rpc("mcp_authorize_info", { p_request: requestId });
  if (error || !data?.ok) return showError(data?.error === "registered_account_required" ? "connectAi.needAccount" : "connectAi.expired");
  $("aiConsentHead").textContent = t("connectAi.wants", { name: data.client_name });
  $("aiConsentReturn").textContent = t("connectAi.returnTo", { host: data.redirect_host || "" });
  $("aiConsent").hidden = false;
  $("btnAiAllow").addEventListener("click", () => decide(requestId, true));
  $("btnAiDeny").addEventListener("click", () => decide(requestId, false));
})();
