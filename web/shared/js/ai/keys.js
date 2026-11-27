// E30: klucze dostawców dla czatu — sejf konta (vault.js, migracja 536).
// Klucze dodaje się w Ustawieniach konta (decyzja 1): kilka, jeden aktywny.
import { sb } from "../core/supabase.js";
import { createVault } from "./vault.js";
import { listModels, recommendedModel, BUILTIN_MODEL } from "./providers.js";

async function rpc(fn, args = {}) {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw error;
  if (data?.ok === false) throw Object.assign(new Error(data.error || "vault_error"), { code: data.error });
  return data;
}

const remote = {
  async get() { return (await rpc("ai_vault_get")).vault || null; },
  async save(row) { await rpc("ai_vault_save", { p_salt: row.salt, p_check: row.check, p_payload: row.payload }); },
  async remove() { await rpc("ai_vault_delete"); },
};

let vaultP = null;
/** Sejf zalogowanego konta (jeden na kartę). */
export function getVault() {
  if (!vaultP) {
    vaultP = sb().auth.getUser().then(({ data }) => {
      const account = data?.user?.id;
      if (!account) throw new Error("not_authenticated");
      return createVault({ remote, account });
    });
    vaultP.catch(() => { vaultP = null; });
  }
  return vaultP;
}

/** "none" (brak sejfu albo kluczy), "locked" (hasło na tym urządzeniu), "ready". */
export async function keyStatus() {
  const vault = await getVault();
  const s = await vault.status();
  if (s === "locked") return "locked";
  return s === "open" && vault.active() ? "ready" : "none";
}

// Źródło czatu (decyzja 25): „builtin” — asystent Familijnej (domyślnie),
// „own” — aktywny klucz z sejfu. Wybór per przeglądarka.
const SOURCE = "familijna:ai-source";
export function getSource() {
  try { return localStorage.getItem(SOURCE) === "own" ? "own" : "builtin"; } catch { return "builtin"; }
}
export function setSource(source) {
  try { localStorage.setItem(SOURCE, source === "own" ? "own" : "builtin"); } catch { /* bez pamięci */ }
}

/**
 * Stan czatu dla konta: { visible (czy pokazać czat — etap próbny: konta
 * testowe), enabled (klucz Familijnej), daily, used, remaining, reset_at }.
 */
export async function builtinStatus() {
  const { data, error } = await sb().rpc("ai_quota_status");
  // failed: błąd połączenia (nie zapamiętujemy); bez ok — odpowiedź serwera „nie”
  if (error) return { visible: false, enabled: false, failed: true };
  if (!data?.ok) return { visible: false, enabled: false };
  return data;
}

// Czy pokazać czat: pamięć karty na 5 minut (bez zapytania na każdej stronie).
const ACCESS = "familijna:ai-access";
export async function aiVisible(userId) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(ACCESS) || "null");
    if (saved && saved.user === userId && Date.now() - saved.at < 5 * 60 * 1000) return !!saved.visible;
  } catch { /* bez pamięci */ }
  const status = await builtinStatus().catch(() => ({ visible: false, failed: true }));
  // chwilowy błąd sieci nie chowa czatu na 5 minut — tylko odpowiedź serwera trafia do pamięci
  if (!status.failed) {
    try { sessionStorage.setItem(ACCESS, JSON.stringify({ user: userId, at: Date.now(), visible: !!status.visible })); } catch { /* bez pamięci */ }
  }
  return !!status.visible;
}
const userToken = async () => (await sb().auth.getSession()).data?.session?.access_token || "";

/**
 * Aktywne źródło { provider, model, key, quota? } albo null: asystent Familijnej,
 * gdy włączony i wybrany (albo gdy nie ma własnego klucza), inaczej klucz z sejfu.
 */
export async function activeKey() {
  const own = await ownKey().catch(() => null);
  if (getSource() === "own" && own) return own;
  const status = await builtinStatus().catch(() => ({ enabled: false }));
  if (status.enabled) return { provider: "familijna", model: BUILTIN_MODEL, key: userToken, quota: status };
  return own;
}

/** Aktywny klucz z sejfu { provider, model, key } albo null. Bez modelu — zalecany z listy dostawcy. */
export async function ownKey() {
  const vault = await getVault();
  if (await vault.status() !== "open") return null;
  const item = vault.active();
  if (!item) return null;
  let model = item.model;
  if (!model) {
    try { model = recommendedModel(item.provider, await listModels(item.provider, item.key)); } catch { model = ""; }
  }
  return model ? { provider: item.provider, model, key: item.key } : null;
}
