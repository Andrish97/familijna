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
  // etap próbny: sekcje AI tylko dla kont, które widzą czat (ai_limits.chat_audience)
  const status = await builtinStatus().catch(() => ({ visible: false }));
  if (!status.visible) return;
  section.hidden = false;
  if (location.hash === "#ai") requestAnimationFrame(() => section.scrollIntoView({ block: "start" }));
  void renderSource(status);
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
    const prov = uiSelect(ids.map((id) => ({ value: id, label: PROVIDERS[id].label })), provider, (v) => { provider = v; setLink(); }, "account.ai.provider");
    setLink();
    const label = el("input", "inp", { type: "text", maxlength: "60", placeholder: t("account.ai.labelPlaceholder"), "aria-label": t("account.ai.labelPlaceholder") });
    const key = el("input", "inp", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: t("account.ai.keyPlaceholder"), "aria-label": t("account.ai.keyPlaceholder") });
    const help = freeKeyHelp(() => { provider = "gemini"; prov.api.setValue("gemini", { silent: true }); setLink(); key.focus(); });
    help.hidden = !showHelp;
    const noKey = el("button", "link", { type: "button", text: t("account.ai.noKey") });
    noKey.hidden = showHelp;
    noKey.addEventListener("click", () => { help.hidden = false; noKey.hidden = true; });
    const links = el("div", "cluster account-ai-links");
    links.append(link, noKey);
    form.append(prov.root, label, key, links, help);
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
  function freeKeyHelp(useGemini) {
    const help = el("div", "callout callout--info stack account-ai-help");
    help.append(el("div", "field-label", { text: t("account.ai.freeKey.title") }));
    const steps = el("ol", "account-ai-steps");
    for (const k of ["step1", "step2", "step3"]) steps.append(el("li", "", { text: t(`account.ai.freeKey.${k}`) }));
    const open = el("a", "btn sm", { href: PROVIDERS.gemini.keyUrl, target: "_blank", rel: "noopener noreferrer", text: t("account.ai.freeKey.open") });
    open.addEventListener("click", useGemini);
    help.append(steps, el("div", "hint", { text: t("account.ai.freeKey.note") }), open);
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
