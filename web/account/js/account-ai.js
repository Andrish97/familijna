// Ustawienia konta → Asystent AI (E30, decyzje 1 i 8): klucze dostawców AI
// w sejfie szyfrowanym w przeglądarce hasłem do kluczy (shared/js/ai/vault.js,
// migracja 536). Kilka kluczy, jeden aktywny; klucz widać tylko przy wpisaniu
// — potem nazwa, dostawca, model i 4 ostatnie znaki. Tylko konta zarejestrowane.
import { t } from "../../shared/translation/translation.js";
import { confirmModal, alertModal } from "../../shared/js/core/modal.js";
import { toast } from "../../shared/js/core/toast.js";
import { icon } from "../../shared/js/core/icons.js";
import { initUiSelect } from "../../shared/js/core/ui-select.js";
import { sb } from "../../shared/js/core/supabase.js";
import { getVault, getSource, setSource, builtinStatus } from "../../shared/js/ai/keys.js";
import { PROVIDERS, listModels, ProviderError } from "../../shared/js/ai/providers.js";
import { startOpenRouterLogin, finishOpenRouterLogin, freeToolModel } from "./account-openrouter.js";

const ERRORS = {
  password_too_short: "account.ai.passwordShort",
  wrong_password: "account.ai.wrongPassword",
};

function el(tag, className = "", attrs = {}) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") n.textContent = v;
    else n.setAttribute(k, v);
  }
  return n;
}
const button = (labelKey, cls = "btn sm", iconName = "") => {
  const b = el("button", cls, { type: "button" });
  b.innerHTML = iconName ? `${icon(iconName)}<span></span>` : "<span></span>";
  b.querySelector("span").textContent = t(labelKey);
  return b;
};
const password = (placeholderKey, autocomplete) => el("input", "inp", {
  type: "password", placeholder: t(placeholderKey), "aria-label": t(placeholderKey), autocomplete,
});
const showError = (e) => toast(t(ERRORS[e?.code] || "") || e?.message || String(e), { kind: "error" });

function uiSelect(options, value, onChange, labelKey) {
  const root = el("div", "ui-select");
  root.innerHTML = `<button class="btn inp ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false">
    <span class="ui-select-label"></span><span class="ui-select-caret" aria-hidden="true"></span></button>
    <div class="ui-select-menu" role="listbox"></div>`;
  root.querySelector(".ui-select-btn").setAttribute("aria-label", t(labelKey));
  const api = initUiSelect(root, { options, value, onChange });
  return { root, api };
}

export async function initAiKeysUi() {
  const section = document.getElementById("ai");
  const box = document.getElementById("aiVaultBox");
  if (!section || !box) return;
  // konto zarejestrowane (gość nie dochodzi tutaj) — sekcja od razu, bez pytania serwera
  section.hidden = false;
  if (location.hash === "#ai") requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
  void renderSource();
  const vault = await getVault();

  // Powrót z logowania OpenRouter (decyzja 32): klucz czeka, aż sejf będzie otwarty.
  let pendingOr = null;
  try { pendingOr = await finishOpenRouterLogin(); } catch { toast(t("account.ai.openrouter.failed"), { kind: "error" }); }
  if (pendingOr) requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));

  async function savePendingOr() {
    const { key, label } = pendingOr;
    pendingOr = null;
    try {
      const model = await freeToolModel();
      await vault.add({ label, provider: "openrouter", key, model });
      setSource("own");
      void renderSource();
      toast(t("account.ai.openrouter.saved"));
    } catch (e) { showError(e); }
  }

  async function render() {
    box.textContent = "";
    const status = await vault.status().catch(() => "error");
    if (status === "open" && pendingOr) await savePendingOr();
    if (pendingOr && (status === "none" || status === "locked")) {
      box.append(el("div", "callout callout--info", { text: t(status === "none" ? "account.ai.openrouter.pendingCreate" : "account.ai.openrouter.pendingUnlock") }));
    }
    if (status === "none") return renderCreate();
    if (status === "locked") return renderUnlock();
    if (status === "open") return renderKeys();
    box.append(el("div", "callout callout--bad", { text: t("account.ai.loadError") }));
  }

  function renderCreate() {
    box.append(el("div", "section-hint", { text: t("account.ai.createHint") }));
    const p1 = password("account.ai.password", "new-password");
    const p2 = password("account.ai.passwordRepeat", "new-password");
    const go = button("account.ai.create", "btn sm gold", "shield");
    go.addEventListener("click", async () => {
      if (p1.value !== p2.value) return toast(t("account.ai.passwordMismatch"), { kind: "error" });
      go.disabled = true;
      try { await vault.create(p1.value); await render(); } catch (e) { showError(e); } finally { go.disabled = false; }
    });
    const actions = el("div", "cluster cluster--end account-actions");
    actions.append(go);
    box.append(p1, p2, actions);
  }

  function renderUnlock() {
    box.append(el("div", "section-hint", { text: t("account.ai.unlockHint") }));
    const p = password("account.ai.password", "current-password");
    const go = button("account.ai.unlock", "btn sm gold", "shield");
    const forgot = el("button", "link", { type: "button", text: t("account.ai.forgot") });
    go.addEventListener("click", async () => {
      go.disabled = true;
      try { await vault.unlock(p.value); await render(); } catch (e) { showError(e); } finally { go.disabled = false; }
    });
    p.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go.click(); } });
    forgot.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: t("account.ai.forgotTitle"), text: t("account.ai.forgotText"),
        okText: t("account.ai.forgotOk"), cancelText: t("account.ai.cancel"),
      });
      if (!ok) return;
      try { await vault.destroy(); await render(); } catch (e) { showError(e); }
    });
    const actions = el("div", "cluster account-actions account-actions--split");
    actions.append(forgot, go);
    box.append(p, actions);
  }

  // Lista kluczy (zwarte wiersze) i przyciski; dodawanie i model — w oknach.
  function renderKeys() {
    const { keys, active } = vault.list();
    const list = el("div", "stack account-ai-keys");
    if (!keys.length) list.append(el("div", "hint", { text: t("account.ai.empty") }));
    for (const k of keys) {
      const provider = PROVIDERS[k.provider]?.label || k.provider;
      const row = el("div", "account-ai-key");
      const choice = el("label", "choice account-ai-key-main");
      const radio = el("input", "", { type: "radio", name: "aiActiveKey", value: k.id, "aria-label": k.label || provider });
      radio.checked = k.id === active;
      radio.addEventListener("change", async () => {
        try { await vault.setActive(k.id); toast(t("account.ai.activeSaved")); } catch (e) { showError(e); }
      });
      const text = el("div", "choice-text");
      text.append(
        el("span", "choice-label", { text: k.label || provider }),
        el("span", "hint", { text: [provider, `••••${k.last4}`, k.model || t("account.ai.modelAuto")].join(" · ") }),
      );
      choice.append(radio, text);
      const model = iconButton("settings", "account.ai.modelChange");
      model.addEventListener("click", () => openModel(k));
      const del = iconButton("trash", "account.ai.remove");
      del.addEventListener("click", async () => {
        const ok = await confirmModal({
          title: t("account.ai.removeTitle"), text: t("account.ai.removeText", { name: k.label || provider }),
          okText: t("account.ai.remove"), cancelText: t("account.ai.cancel"),
        });
        if (!ok) return;
        try { await vault.remove(k.id); await render(); } catch (e) { showError(e); }
      });
      row.append(choice, model, del);
      list.append(row);
    }
    const lock = button("account.ai.lock", "btn sm", "eye-off");
    lock.addEventListener("click", async () => { await vault.lock(); await render(); });
    const add = button("account.ai.add", "btn sm gold account-ai-add-open", "plus");
    add.addEventListener("click", () => openAdd(!keys.length));
    const actions = el("div", "cluster account-actions account-actions--split");
    actions.append(lock, add);
    box.append(list, actions);
  }

  const iconButton = (name, labelKey) => {
    const b = el("button", "btn sm icon", { type: "button", "aria-label": t(labelKey), title: t(labelKey) });
    b.innerHTML = icon(name);
    return b;
  };

  // Model klucza: lista modeli z konta dostawcy (klucz z sejfu, bez błędu dla użytkownika).
  async function openModel(k) {
    let value = k.model || "";
    const select = uiSelect([{ value: "", label: t("account.ai.modelAuto") }, ...(k.model ? [{ value: k.model, label: k.model }] : [])], value, (v) => { value = v; }, "account.ai.model");
    const body = el("div", "stack account-ai-form");
    body.append(select.root);
    const item = vault.item(k.id);
    if (item) {
      listModels(item.provider, item.key).then((models) => {
        select.api.setOptions([{ value: "", label: t("account.ai.modelAuto") }, ...models.map((m) => ({ value: m, label: m }))]);
        select.api.setValue(value, { silent: true });
      }).catch(() => { /* lista modeli niedostępna — zostaje „zalecany” */ });
    }
    const ok = await confirmModal({
      title: t("account.ai.modelTitle", { name: k.label || PROVIDERS[k.provider]?.label || k.provider }),
      text: "", body, okText: t("account.ai.save"), cancelText: t("account.ai.cancel"),
      onOk: async () => {
        try { await vault.setModel(k.id, value); return null; } catch (e) { return t(ERRORS[e?.code] || "") || e?.message || String(e); }
      },
    });
    if (ok) { toast(t("account.ai.modelSaved")); await render(); }
  }

  // Dodanie klucza w oknie. Bez kluczy — od razu instrukcja darmowego klucza (decyzja 18).
  async function openAdd(showHelp) {
    const form = el("div", "stack account-ai-form account-ai-add");
    // bez asystenta Familijnej — to nie dostawca własnego klucza
    const ids = Object.keys(PROVIDERS).filter((id) => !PROVIDERS[id].builtin);
    let provider = ids[0];
    const link = el("a", "link", { target: "_blank", rel: "noopener noreferrer", text: t("account.ai.getKey") });
    const setLink = () => { link.href = PROVIDERS[provider].keyUrl; };
    const label = el("input", "inp", { type: "text", maxlength: "60", placeholder: t("account.ai.labelPlaceholder"), "aria-label": t("account.ai.labelPlaceholder") });
    // OpenRouter: logowanie zamiast wklejania klucza (decyzja 32)
    const orLogin = button("account.ai.openrouter.login", "btn sm gold account-ai-or-login", "person");
    orLogin.addEventListener("click", () => { void startOpenRouterLogin(label.value); });
    const orBox = el("div", "stack account-ai-or");
    orBox.append(orLogin, el("div", "hint", { text: t("account.ai.openrouter.hint") }));
    const syncOr = () => { orBox.hidden = provider !== "openrouter"; };
    const prov = uiSelect(ids.map((id) => ({ value: id, label: PROVIDERS[id].label })), provider, (v) => { provider = v; setLink(); syncOr(); }, "account.ai.provider");
    setLink();
    syncOr();
    const key = el("input", "inp", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: t("account.ai.keyPlaceholder"), "aria-label": t("account.ai.keyPlaceholder") });
    const help = freeKeyHelp(() => { provider = "gemini"; prov.api.setValue("gemini", { silent: true }); setLink(); syncOr(); key.focus(); }, label);
    help.hidden = !showHelp;
    const noKey = el("button", "link", { type: "button", text: t("account.ai.noKey") });
    noKey.hidden = showHelp;
    noKey.addEventListener("click", () => { help.hidden = false; noKey.hidden = true; });
    const links = el("div", "cluster account-ai-links");
    links.append(link, noKey);
    form.append(prov.root, label, orBox, key, links, help);
    const ok = await confirmModal({
      title: t("account.ai.addTitle"), text: t("account.ai.keyHint"), body: form, sheet: { fit: true },
      okText: t("account.ai.add"), cancelText: t("account.ai.cancel"), initialFocus: key,
      onOk: async () => {
        const value = key.value.trim();
        if (!value) return t("account.ai.keyEmpty");
        try {
          // sprawdzenie klucza u dostawcy (lista modeli) — zły klucz nie trafia do sejfu
          await listModels(provider, value);
          await vault.add({ label: label.value, provider, key: value });
          return null;
        } catch (e) {
          return e instanceof ProviderError ? e.message : (t(ERRORS[e?.code] || "") || e?.message || String(e));
        }
      },
    });
    if (!ok) return;
    // dodany klucz = chęć korzystania z niego: źródło czatu „własny klucz”
    setSource("own");
    void renderSource();
    toast(t("account.ai.added"));
    await render();
  }

  // Instrukcja dla osób bez klucza (decyzja 18): darmowy klucz Google Gemini.
  // Darmowe klucze (decyzje 18 i 32): logowanie przez OpenRouter (bez kopiowania)
  // albo klucz Google Gemini z AI Studio.
  function freeKeyHelp(useGemini, labelInput) {
    const help = el("div", "callout callout--info stack account-ai-help");
    help.append(el("div", "field-label", { text: t("account.ai.freeKey.title") }));
    const or = button("account.ai.openrouter.login", "btn sm", "person");
    or.addEventListener("click", () => { void startOpenRouterLogin(labelInput?.value || ""); });
    help.append(el("div", "account-ai-help-head", { text: t("account.ai.openrouter.freeTitle") }), el("div", "hint", { text: t("account.ai.openrouter.free") }), or);
    const steps = el("ol", "account-ai-steps");
    for (const k of ["step1", "step2", "step3"]) steps.append(el("li", "", { text: t(`account.ai.freeKey.${k}`) }));
    const open = el("a", "btn sm", { href: PROVIDERS.gemini.keyUrl, target: "_blank", rel: "noopener noreferrer", text: t("account.ai.freeKey.open") });
    open.addEventListener("click", useGemini);
    help.append(el("div", "account-ai-help-head", { text: t("account.ai.freeKey.geminiTitle") }), steps, el("div", "hint", { text: t("account.ai.freeKey.note") }), open);
    return help;
  }

  await render();
  void renderConnectors();
}

// Źródło czatu (decyzja 25): asystent Familijnej (domyślnie, z limitem
// dziennym) albo własny klucz z sejfu niżej. Wybór zapamiętuje przeglądarka.
async function renderSource(known = null) {
  const box = document.getElementById("aiSourceBox");
  if (!box) return;
  const status = known || await builtinStatus().catch(() => ({ enabled: false }));
  box.textContent = "";
  box.hidden = !status.enabled;
  if (!status.enabled) return;
  const current = getSource();
  const option = (value, label, hint) => {
    const row = el("label", "choice");
    const radio = el("input", "", { type: "radio", name: "aiSource", value });
    radio.checked = current === value;
    radio.addEventListener("change", () => { setSource(value); toast(t("account.ai.source.saved")); });
    const text = el("div", "choice-text");
    text.append(el("span", "choice-label", { text: label }), el("span", "hint", { text: hint }));
    row.append(radio, text);
    return row;
  };
  box.append(
    el("div", "field-label", { text: t("account.ai.source.title") }),
    option("builtin", t("account.ai.source.builtin"), t("account.ai.source.builtinHint", { daily: status.daily, remaining: status.remaining })),
    option("own", t("account.ai.source.own"), t("account.ai.source.ownHint")),
  );
}

const MCP_URL = "https://api.familijna.app/mcp";
const OPENAPI_URL = "https://api.familijna.app/mcp/api/openapi.json";
const API_KEY_ERRORS = { too_many_keys: "account.ai.apiKeys.tooMany", rate_limited: "account.ai.apiKeys.rateLimited", invalid_name: "account.ai.apiKeys.nameEmpty" };

// Adres do skopiowania (pole tylko do odczytu + Kopiuj).
function copyRow(value, labelKey) {
  const row = el("div", "account-ai-mcp-url");
  const input = el("input", "inp", { type: "text", readonly: "", value, "aria-label": t(labelKey) });
  const copy = button("account.ai.mcp.copy", "btn sm", "copy");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(value); toast(t("account.ai.mcp.copied")); }
    catch { input.select(); }
  });
  row.append(input, copy);
  return row;
}

// Wiersz tokenu: nazwa, daty, Odłącz/Usuń.
function tokenRow(c, revokeKey) {
  const item = el("div", "account-ai-key");
  const used = c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : "—";
  const text = el("div", "choice-text account-ai-key-main");
  text.append(el("span", "choice-label", { text: c.client_name }), el("span", "hint", { text: t("account.ai.mcp.lastUsed", { date: used }) }));
  const revoke = button(revokeKey, "btn sm danger");
  revoke.addEventListener("click", async () => {
    const ok = await confirmModal({
      title: t(c.kind === "api_key" ? "account.ai.apiKeys.revokeTitle" : "account.ai.mcp.revokeTitle"),
      text: t(c.kind === "api_key" ? "account.ai.apiKeys.revokeText" : "account.ai.mcp.revokeText", { name: c.client_name }),
      okText: t(revokeKey), cancelText: t("account.ai.cancel"),
    });
    if (!ok) return;
    await sb().rpc("mcp_token_revoke", { p_id: c.id });
    await renderConnectors();
  });
  item.append(text, revoke);
  return item;
}

// Nowy klucz API: nazwa w oknie, potem klucz pokazany raz (do skopiowania).
async function createApiKey() {
  const name = el("input", "inp", { type: "text", maxlength: "60", placeholder: t("account.ai.apiKeys.namePlaceholder"), "aria-label": t("account.ai.apiKeys.namePlaceholder") });
  let token = "";
  const ok = await confirmModal({
    title: t("account.ai.apiKeys.createTitle"), text: t("account.ai.apiKeys.warning"), body: name, sheet: { fit: true },
    okText: t("account.ai.apiKeys.create"), cancelText: t("account.ai.cancel"), initialFocus: name,
    onOk: async () => {
      const { data, error } = await sb().rpc("mcp_api_key_create", { p_name: name.value });
      if (error || !data?.ok) return t(API_KEY_ERRORS[data?.error] || "account.ai.loadError");
      token = data.token;
      return null;
    },
  });
  if (!ok || !token) return;
  await alertModal({ title: t("account.ai.apiKeys.createdTitle"), text: t("account.ai.apiKeys.createdText"), body: copyRow(token, "account.ai.apiKeys.title"), okText: t("account.ai.apiKeys.done"), sheet: { fit: true } });
  await renderConnectors();
}

// Familijna w innych aplikacjach AI (decyzje 19, 34, 35): łącznik MCP (OAuth),
// klucze API (MCP bez logowania, API HTTP z opisem OpenAPI), połączone aplikacje.
async function renderConnectors() {
  const box = document.getElementById("aiConnectorsBox");
  if (!box) return;
  box.textContent = "";
  document.getElementById("aiConnect").hidden = false;

  box.append(el("div", "field-label", { text: t("account.ai.mcp.connectorTitle") }), copyRow(MCP_URL, "account.ai.mcp.urlLabel"));
  const steps = el("ol", "account-ai-steps");
  for (const k of ["step1", "step2", "step3"]) steps.append(el("li", "", { text: t(`account.ai.mcp.${k}`) }));
  box.append(steps);

  let list = [];
  try {
    const { data } = await sb().rpc("mcp_tokens_mine");
    list = data?.ok ? data.tokens : [];
  } catch { list = []; }
  const apps = list.filter((c) => c.kind !== "api_key");
  const keys = list.filter((c) => c.kind === "api_key");

  const api = el("div", "stack account-ai-api");
  api.append(el("div", "field-label", { text: t("account.ai.apiKeys.title") }), el("div", "hint", { text: t("account.ai.apiKeys.hint") }));
  for (const c of keys) api.append(tokenRow(c, "account.ai.apiKeys.revoke"));
  const create = button("account.ai.apiKeys.create", "btn sm account-ai-api-create", "plus");
  create.addEventListener("click", () => { void createApiKey(); });
  const actions = el("div", "cluster cluster--end account-actions");
  actions.append(create);
  api.append(actions, el("div", "hint", { text: t("account.ai.apiKeys.openapi") }), copyRow(OPENAPI_URL, "account.ai.apiKeys.openapi"));
  box.append(api);

  if (!apps.length) return;
  box.append(el("div", "field-label", { text: t("account.ai.mcp.connected") }));
  for (const c of apps) box.append(tokenRow(c, "account.ai.mcp.revoke"));
}

// Zgoda na dostęp łącznika AI (decyzja 19/20): Claude albo ChatGPT kieruje przez
// /login/?next=account&ai=<prośba> tutaj; okno silnika zamiast osobnej strony.
// Zgoda → adres powrotu klienta z jednorazowym kodem; odmowa → error=access_denied.
export function aiConnectRequest() {
  const id = new URLSearchParams(location.search).get("ai") || "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

function dropRequestParam() {
  const url = new URL(location.href);
  url.searchParams.delete("ai");
  history.replaceState(history.state, "", url);
}

export async function openConnectConsent({ guest = false } = {}) {
  const requestId = aiConnectRequest();
  if (!requestId) return;
  dropRequestParam();
  const refuse = (key) => alertModal({ title: t("account.ai.mcp.title"), text: t(key) });
  if (guest) return refuse("account.ai.mcp.consent.needAccount");
  const { data, error } = await sb().rpc("mcp_authorize_info", { p_request: requestId });
  if (error || !data?.ok) return refuse(data?.error === "registered_account_required" ? "account.ai.mcp.consent.needAccount" : "account.ai.mcp.consent.expired");
  const body = el("div", "hint", { text: t("account.ai.mcp.consent.returnTo", { host: data.redirect_host || "" }) });
  const allow = await confirmModal({
    title: t("account.ai.mcp.consent.wants", { name: data.client_name }),
    text: `${t("account.ai.mcp.consent.what")} ${t("account.ai.mcp.consent.revoke")}`,
    body,
    okText: t("account.ai.mcp.consent.allow"),
    cancelText: t("account.ai.mcp.consent.deny"),
  });
  const res = await sb().rpc("mcp_authorize_decide", { p_request: requestId, p_allow: !!allow });
  if (res.error || !res.data?.ok || !res.data.redirect) return refuse("account.ai.mcp.consent.expired");
  location.replace(res.data.redirect);
}
