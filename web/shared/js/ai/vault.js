// E30: sejf kluczy AI (decyzja 8, wzór: Makietka js/sejf-kluczy.js). Klucze
// API szyfruje przeglądarka hasłem do kluczy, które zna tylko użytkownik, i
// dopiero wtedy zapisuje na koncie (migracja 536). Z hasła PBKDF2-SHA256
// (310 000 powtórzeń, losowa sól) powstaje klucz AES-GCM 256, którego nie da
// się wyjąć z przeglądarki (extractable: false); urządzenie pamięta go w
// IndexedDB, więc hasło podaje się raz na urządzeniu. Zgubione hasło = sejf
// trzeba usunąć i dodać klucze od nowa.
// Zawartość sejfu: { keys: [{ id, label, provider, model, key, last4, added }], active }.

const ITERATIONS = 310000;
const CHECK_TEXT = "familijna-ai-vault-v1";
const IDB_NAME = "familijna-ai-vault";

const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function deriveKey(password, saltB64, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(saltB64), iterations, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function encrypt(key, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text));
  return { iv: b64(iv), ct: b64(ct) };
}
export async function decrypt(key, { iv, ct }) {
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, key, fromB64(ct)));
}

// ---------- pamięć urządzenia (CryptoKey bez możliwości wyjęcia) ----------
const openDb = () => new Promise((ok, fail) => {
  const r = indexedDB.open(IDB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore("keys");
  r.onsuccess = () => ok(r.result);
  r.onerror = () => fail(r.error);
});
async function store(mode, fn) {
  const db = await openDb();
  return new Promise((ok, fail) => {
    const tx = db.transaction("keys", mode);
    const req = fn(tx.objectStore("keys"));
    tx.oncomplete = () => ok(req?.result);
    tx.onerror = () => fail(tx.error);
  });
}
const defaultDevice = {
  get: (account) => store("readonly", (s) => s.get(account)).catch(() => null),
  put: (account, key) => store("readwrite", (s) => s.put(key, account)).catch(() => {}),
  forget: (account) => store("readwrite", (s) => s.delete(account)).catch(() => {}),
};

export class VaultError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Sejf konta. remote: { get() → row|null, save(row), remove() } (RPC 536; w testach atrapa),
 * account: id użytkownika (klucz pamięci urządzenia), device: pamięć CryptoKey.
 */
export function createVault({ remote, account, device = defaultDevice, iterations = ITERATIONS }) {
  let row;
  let key = null;
  let plain = null; // odszyfrowana zawartość — tylko w pamięci tej karty
  const load = async () => { if (row === undefined) row = await remote.get(); return row; };
  const persist = async () => {
    const payload = await encrypt(key, JSON.stringify(plain));
    row = { ...row, payload };
    await remote.save(row);
  };
  const vault = {
    /** "none" — brak sejfu; "locked" — trzeba podać hasło na tym urządzeniu; "open". */
    async status() {
      if (plain) return "open";
      const r = await load();
      if (!r) return "none";
      const k = await device.get(account);
      if (k) {
        try {
          if (await decrypt(k, r.check) === CHECK_TEXT) { key = k; plain = JSON.parse(await decrypt(k, r.payload)); return "open"; }
        } catch { /* hasło zmienione na innym urządzeniu */ }
        await device.forget(account);
      }
      return "locked";
    },
    async create(password) {
      if (String(password || "").length < 8) throw new VaultError("password_too_short");
      const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
      key = await deriveKey(password, salt, iterations);
      plain = { keys: [], active: null };
      row = { salt, check: await encrypt(key, CHECK_TEXT), payload: await encrypt(key, JSON.stringify(plain)) };
      await remote.save(row);
      await device.put(account, key);
    },
    async unlock(password) {
      const r = await load();
      if (!r) throw new VaultError("no_vault");
      const k = await deriveKey(password, r.salt, iterations);
      try { if (await decrypt(k, r.check) !== CHECK_TEXT) throw new Error(); } catch { throw new VaultError("wrong_password"); }
      key = k;
      plain = JSON.parse(await decrypt(k, r.payload));
      await device.put(account, key);
    },
    /** Zapomnij hasło na tym urządzeniu. */
    async lock() { key = null; plain = null; await device.forget(account); },
    /** Usunięcie sejfu z konta (np. zapomniane hasło). */
    async destroy() { await remote.remove(); row = null; key = null; plain = null; await device.forget(account); },
    /** Lista kluczy bez wartości klucza (do pokazania) i aktywny. */
    list() {
      if (!plain) return null;
      return { active: plain.active, keys: plain.keys.map(({ key: _secret, ...rest }) => rest) };
    },
    /** Klucz z wartością po id (lista modeli w ustawieniach) albo null. */
    item(id) {
      return plain?.keys.find((x) => x.id === id) || null;
    },
    /** Aktywny klucz z wartością (dla czatu) albo null. */
    active() {
      if (!plain) return null;
      return plain.keys.find((x) => x.id === plain.active) || plain.keys[0] || null;
    },
    async add({ label, provider, model = "", key: secret }) {
      if (!plain) throw new VaultError("locked");
      const value = String(secret || "").trim();
      if (!value || !provider) throw new VaultError("invalid_key");
      const item = {
        id: b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[+/=]/g, ""),
        label: String(label || "").trim().slice(0, 60), provider, model: String(model || "").trim(),
        key: value, last4: value.slice(-4), added: new Date().toISOString(),
      };
      plain.keys.push(item);
      if (!plain.active) plain.active = item.id;
      await persist();
      return item.id;
    },
    async remove(id) {
      if (!plain) throw new VaultError("locked");
      plain.keys = plain.keys.filter((x) => x.id !== id);
      if (plain.active === id) plain.active = plain.keys[0]?.id || null;
      await persist();
    },
    async setActive(id) {
      if (!plain) throw new VaultError("locked");
      if (!plain.keys.some((x) => x.id === id)) throw new VaultError("not_found");
      plain.active = id;
      await persist();
    },
    async setModel(id, model) {
      if (!plain) throw new VaultError("locked");
      const item = plain.keys.find((x) => x.id === id);
      if (!item) throw new VaultError("not_found");
      item.model = String(model || "").trim();
      await persist();
    },
  };
  return vault;
}
