// Ustawienia konta → Asystent AI (E30, decyzje 1 i 8): klucze dostawców AI
// w sejfie szyfrowanym w przeglądarce hasłem do kluczy (shared/js/ai/vault.js,
// migracja 536). Kilka kluczy, jeden aktywny; klucz widać tylko przy wpisaniu
// — potem nazwa, dostawca, model i 4 ostatnie znaki. Tylko konta zarejestrowane.
import { t } from "../../shared/translation/translation.js";
import { confirmModal } from "../../shared/js/core/modal.js";
import { toast } from "../../shared/js/core/toast.js";
import { icon } from "../../shared/js/core/icons.js";
import { initUiSelect } from "../../shared/js/core/ui-select.js";
import { getVault } from "../../shared/js/ai/keys.js";
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
}
