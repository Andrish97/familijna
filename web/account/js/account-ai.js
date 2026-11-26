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
  section.hidden = false;
  if (location.hash === "#ai") requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
  void renderSource();
  const vault = await getVault();

  async function render() {
    box.textContent = "";
    const status = await vault.status().catch(() => "error");
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

  function renderKeys() {
    const { keys, active } = vault.list();
    const list = el("div", "stack account-ai-keys");
    if (!keys.length) list.append(el("div", "hint", { text: t("account.ai.empty") }));
    for (const k of keys) {
      const row = el("div", "account-ai-key");
      const choice = el("label", "choice account-ai-key-main");
      const radio = el("input", "", { type: "radio", name: "aiActiveKey", value: k.id });
      radio.checked = k.id === active;
      const name = el("span", "", { text: `${k.label || PROVIDERS[k.provider]?.label || k.provider} · ${PROVIDERS[k.provider]?.label || k.provider} · ••••${k.last4}` });
      choice.append(radio, name);
      radio.addEventListener("change", async () => {
        try { await vault.setActive(k.id); toast(t("account.ai.activeSaved")); } catch (e) { showError(e); }
      });
      const auto = { value: "", label: t("account.ai.modelAuto") };
      const model = uiSelect([auto, ...(k.model ? [{ value: k.model, label: k.model }] : [])], k.model || "", async (value) => {
        try { await vault.setModel(k.id, value); toast(t("account.ai.modelSaved")); } catch (e) { showError(e); }
      }, "account.ai.model");
      const del = el("button", "btn sm icon", { type: "button", "aria-label": t("account.ai.remove"), title: t("account.ai.remove") });
      del.innerHTML = icon("trash");
      del.addEventListener("click", async () => {
        const ok = await confirmModal({
          title: t("account.ai.removeTitle"), text: t("account.ai.removeText", { name: k.label || k.provider }),
          okText: t("account.ai.remove"), cancelText: t("account.ai.cancel"),
        });
        if (!ok) return;
        try { await vault.remove(k.id); await render(); } catch (e) { showError(e); }
      });
      row.append(choice, model.root, del);
      list.append(row);
      void fillModels(k, model.api);
    }
    if (!keys.length) box.append(list, renderFreeKeyHelp(), renderAdd());
    else box.append(list, renderAdd());
    const lock = button("account.ai.lock", "btn sm", "eye-off");
    lock.addEventListener("click", async () => { await vault.lock(); await render(); });
    const actions = el("div", "cluster cluster--end account-actions");
    actions.append(lock);
    box.append(actions);
  }

  // Modele z listy dostawcy (klucz z sejfu tej karty; bez błędu dla użytkownika).
  async function fillModels(k, api) {
    const item = vaultItem(k.id);
    if (!item || !api) return;
    try {
      const models = await listModels(item.provider, item.key);
      api.setOptions([{ value: "", label: t("account.ai.modelAuto") }, ...models.map((m) => ({ value: m, label: m }))]);
      api.setValue(item.model || "", { silent: true });
    } catch { /* lista modeli niedostępna — zostaje „automatycznie” */ }
  }
  const vaultItem = (id) => vault.item(id);

  // Instrukcja dla osób bez klucza (decyzja 18): darmowy klucz Google Gemini.
  function renderFreeKeyHelp() {
    const box = el("div", "callout callout--info stack account-ai-help");
    box.append(el("div", "field-label", { text: t("account.ai.freeKey.title") }));
    const steps = el("ol", "account-ai-steps");
    for (const k of ["step1", "step2", "step3"]) steps.append(el("li", "", { text: t(`account.ai.freeKey.${k}`) }));
    const open = el("a", "btn sm", { href: PROVIDERS.gemini.keyUrl, target: "_blank", rel: "noopener noreferrer", text: t("account.ai.freeKey.open") });
    box.append(steps, el("div", "section-hint", { text: t("account.ai.freeKey.note") }), open);
    return box;
  }

  function renderAdd() {
    const form = el("div", "stack account-ai-add");
    form.append(el("div", "field-label", { text: t("account.ai.addTitle") }));
    const ids = Object.keys(PROVIDERS);
    let provider = ids[0];
    const link = el("a", "link", { target: "_blank", rel: "noopener noreferrer", text: t("account.ai.getKey") });
    const setLink = () => { link.href = PROVIDERS[provider].keyUrl; };
    const prov = uiSelect(ids.map((id) => ({ value: id, label: PROVIDERS[id].label })), provider, (v) => { provider = v; setLink(); }, "account.ai.provider");
    setLink();
    const label = el("input", "inp", { type: "text", maxlength: "60", placeholder: t("account.ai.labelPlaceholder"), "aria-label": t("account.ai.labelPlaceholder") });
    const key = el("input", "inp", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: t("account.ai.keyPlaceholder"), "aria-label": t("account.ai.keyPlaceholder") });
    const hint = el("div", "section-hint", { text: t("account.ai.keyHint") });
    const add = button("account.ai.add", "btn sm gold", "plus");
    add.addEventListener("click", async () => {
      const value = key.value.trim();
      if (!value) return toast(t("account.ai.keyEmpty"), { kind: "error" });
      add.disabled = true;
      try {
        // sprawdzenie klucza u dostawcy (lista modeli) — zły klucz nie trafia do sejfu
        await listModels(provider, value);
        await vault.add({ label: label.value, provider, key: value });
        key.value = "";
        toast(t("account.ai.added"));
        await render();
      } catch (e) {
        toast(e instanceof ProviderError ? e.message : (t(ERRORS[e?.code] || "") || e?.message || String(e)), { kind: "error" });
      } finally { add.disabled = false; }
    });
    const actions = el("div", "cluster account-actions account-actions--split");
    actions.append(link, add);
    form.append(prov.root, label, key, hint, actions);
    return form;
  }

  await render();
  void renderConnectors();
}

// Źródło czatu (decyzja 25): asystent Familijnej (domyślnie, z limitem
// dziennym) albo własny klucz z sejfu niżej. Wybór zapamiętuje przeglądarka.
async function renderSource() {
  const box = document.getElementById("aiSourceBox");
  if (!box) return;
  const status = await builtinStatus().catch(() => ({ enabled: false }));
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

// Claude i ChatGPT (decyzja 19): adres łącznika i połączone aplikacje z odwołaniem dostępu.
async function renderConnectors() {
  const box = document.getElementById("aiConnectorsBox");
  if (!box) return;
  box.textContent = "";
  document.getElementById("aiConnect").hidden = false;
  const row = el("div", "account-ai-mcp-url");
  const url = el("input", "inp", { type: "text", readonly: "", value: MCP_URL, "aria-label": t("account.ai.mcp.urlLabel") });
  const copy = button("account.ai.mcp.copy", "btn sm", "copy");
  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(MCP_URL); toast(t("account.ai.mcp.copied")); }
    catch { url.select(); }
  });
  row.append(url, copy);
  box.append(row);
  const steps = el("ol", "account-ai-steps");
  for (const k of ["step1", "step2", "step3"]) steps.append(el("li", "", { text: t(`account.ai.mcp.${k}`) }));
  box.append(steps);

  let list = [];
  try {
    const { data } = await sb().rpc("mcp_tokens_mine");
    list = data?.ok ? data.tokens : [];
  } catch { list = []; }
  if (!list.length) return;
  box.append(el("div", "field-label", { text: t("account.ai.mcp.connected") }));
  for (const c of list) {
    const item = el("div", "account-ai-key");
    const used = c.last_used_at ? new Date(c.last_used_at).toLocaleDateString() : "—";
    item.append(el("span", "account-ai-key-main", { text: `${c.client_name} · ${t("account.ai.mcp.lastUsed", { date: used })}` }));
    const revoke = button("account.ai.mcp.revoke", "btn sm danger");
    revoke.addEventListener("click", async () => {
      const ok = await confirmModal({
        title: t("account.ai.mcp.revokeTitle"), text: t("account.ai.mcp.revokeText", { name: c.client_name }),
        okText: t("account.ai.mcp.revoke"), cancelText: t("account.ai.cancel"),
      });
      if (!ok) return;
      await sb().rpc("mcp_token_revoke", { p_id: c.id });
      await renderConnectors();
    });
    item.append(revoke);
    box.append(item);
  }
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
