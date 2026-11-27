// Logowanie przez OpenRouter zamiast kopiowania klucza (E30, decyzja 32).
// PKCE S256: strona OpenRouter po zalogowaniu wraca na Ustawienia konta
// z ?code=…, przeglądarka wymienia kod na klucz (POST /api/v1/auth/keys)
// i zapisuje go w sejfie kluczy. Weryfikator PKCE tylko w sessionStorage tej karty.
const AUTH_URL = "https://openrouter.ai/auth";
const KEYS_URL = "https://openrouter.ai/api/v1/auth/keys";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const STORE = "familijna:openrouter-pkce";
const FLAG = "openrouter";

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Adres powrotu: Ustawienia konta z ?openrouter=1 (OpenRouter dokleja &code=…). */
export const callbackUrl = (origin = location.origin) => `${origin}/account/?${FLAG}=1`;

/** Przejście na logowanie OpenRouter. label — nazwa klucza w sejfie. */
export async function startOpenRouterLogin(label = "") {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  try { sessionStorage.setItem(STORE, JSON.stringify({ verifier, label: String(label || "").slice(0, 60), at: Date.now() })); } catch { /* bez pamięci */ }
  const q = new URLSearchParams({ callback_url: callbackUrl(), code_challenge: challenge, code_challenge_method: "S256" });
  location.assign(`${AUTH_URL}?${q}`);
}

/**
 * Po powrocie z OpenRouter: { key, label } albo null (to nie powrót z logowania).
 * Usuwa kod z adresu i weryfikator z pamięci. Błąd wymiany → wyjątek.
 */
export async function finishOpenRouterLogin({ fetchImpl = fetch } = {}) {
  const url = new URL(location.href);
  if (url.searchParams.get(FLAG) !== "1") return null;
  const code = url.searchParams.get("code") || "";
  url.searchParams.delete(FLAG);
  url.searchParams.delete("code");
  url.hash = "ai";
  history.replaceState(history.state, "", url);
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(STORE) || "null"); sessionStorage.removeItem(STORE); } catch { saved = null; }
  if (!code || !saved?.verifier) throw new Error("openrouter_no_code");
  const res = await fetchImpl(KEYS_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: saved.verifier, code_challenge_method: "S256" }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.key) throw new Error("openrouter_exchange");
  return { key: data.key, label: saved.label || "OpenRouter" };
}

// Darmowe modele z narzędziami — kolejność preferencji (rodziny dobrze wołające narzędzia).
const FREE_ORDER = [/gemini.*flash/, /deepseek.*(chat|v3)/, /qwen3?.*(235b|instruct|coder)/, /llama-(3\.3-70b|4)/, /mistral|devstral/, /./];

/** Wybór darmowego modelu z narzędziami (lista OpenRouter), "" gdy brak. */
export function pickFreeModel(models = []) {
  const free = models.filter((m) => {
    const p = m?.pricing || {};
    const isFree = String(m?.id || "").endsWith(":free") || (Number(p.prompt) === 0 && Number(p.completion) === 0);
    return isFree && (m?.supported_parameters || []).includes("tools");
  }).map((m) => m.id);
  for (const re of FREE_ORDER) {
    const hit = free.find((id) => re.test(id));
    if (hit) return hit;
  }
  return "";
}

/** Lista modeli OpenRouter (publiczna) → darmowy model z narzędziami. */
export async function freeToolModel({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(MODELS_URL);
    return pickFreeModel((await res.json())?.data || []);
  } catch { return ""; }
}
