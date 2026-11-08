// Odbiór przenosin ze starej domeny (plan rebrandingu, familijna-server/docs/rebranding-familijna-plan.md).
// Strona przenosin na familiada.online (cloudflare/legacy-domain-worker) przenosi
// localStorage — w tym sesję `sb-api-auth-token` — w części `#fam-handoff=` adresu.
// Część po `#` nie trafia na serwer. Wołane synchronicznie przed createClient,
// więc pierwsze sprawdzenie sesji już ją widzi. Istniejących wpisów nie nadpisuje.
// Plik do usunięcia po 2026-12-01 (koniec przenosin).

const PREFIX = "#fam-handoff=";

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function parseLegacyHandoff(hash) {
  if (typeof hash !== "string" || !hash.startsWith(PREFIX)) return null;
  try {
    const data = JSON.parse(fromBase64Url(hash.slice(PREFIX.length)));
    if (!data || data.v !== 1 || typeof data.items !== "object" || !data.items) return null;
    const items = {};
    for (const [key, value] of Object.entries(data.items)) {
      if (typeof key === "string" && typeof value === "string") items[key] = value;
    }
    return { items, hash: typeof data.h === "string" && data.h.startsWith("#") ? data.h : "" };
  } catch {
    return null;
  }
}

// Paczkę przyjmujemy tylko po przejściu ze strony przenosin starej domeny
// (Referrer-Policy: origin). Link z innej strony mógłby podsunąć cudzą sesję
// (E24 R8) — wtedy hash jest tylko zdejmowany.
const LEGACY_ORIGINS = ["https://www.familiada.online", "https://familiada.online"];
export function fromLegacyDomain(referrer) {
  try { return LEGACY_ORIGINS.includes(new URL(String(referrer || "")).origin); } catch { return false; }
}

export function applyLegacyHandoff(loc = globalThis.location, storage = globalThis.localStorage, hist = globalThis.history, referrer = globalThis.document?.referrer) {
  const parsed = parseLegacyHandoff(loc?.hash);
  if (!parsed) return false;
  try { hist?.replaceState(hist.state, "", loc.pathname + loc.search + parsed.hash); } catch {}
  if (!fromLegacyDomain(referrer)) return false;
  for (const [key, value] of Object.entries(parsed.items)) {
    try { if (storage.getItem(key) === null) storage.setItem(key, value); } catch {}
  }
  return true;
}
