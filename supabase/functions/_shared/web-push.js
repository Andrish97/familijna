// Web Push bez zależności (E29): szyfrowanie treści aes128gcm (RFC 8291)
// i podpis VAPID (RFC 8292) na Web Crypto — działa w Deno (funkcja push-send)
// i w Node (testy unit). Klucze w base64url: prywatny VAPID 32 B, publiczny
// 65 B (04‖X‖Y); urządzenie podaje p256dh (65 B) i auth (16 B).

const te = new TextEncoder();

export function b64urlDecode(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concat(...parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function ecJwk(publicRaw, privateRaw) {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("invalid_public_key");
  const jwk = { kty: "EC", crv: "P-256", x: b64urlEncode(publicRaw.slice(1, 33)), y: b64urlEncode(publicRaw.slice(33, 65)), ext: true };
  if (privateRaw) {
    if (privateRaw.length !== 32) throw new Error("invalid_private_key");
    jwk.d = b64urlEncode(privateRaw);
  }
  return jwk;
}

async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// Szyfrowanie jednego rekordu aes128gcm. `opts.serverKeys`/`opts.salt` tylko
// dla wektorów testowych — w działaniu zawsze nowa para i losowa sól.
export async function encryptPayload(payload, p256dh, auth, opts = {}) {
  const uaPublic = b64urlDecode(p256dh);
  const authSecret = b64urlDecode(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error("invalid_p256dh");
  if (authSecret.length !== 16) throw new Error("invalid_auth");
  const plaintext = typeof payload === "string" ? te.encode(payload) : payload;

  let asPrivate, asPublic;
  if (opts.serverKeys) {
    asPublic = b64urlDecode(opts.serverKeys.publicKey);
    asPrivate = await crypto.subtle.importKey("jwk", ecJwk(asPublic, b64urlDecode(opts.serverKeys.privateKey)), { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } else {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const keyInfo = concat(te.encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = opts.salt ? b64urlDecode(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);

  const rs = 4096;
  if (plaintext.length + 1 + 16 > rs) throw new Error("payload_too_large");
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

// Nagłówek Authorization VAPID dla adresu usługi push.
export async function vapidAuthorization(endpoint, { publicKey, privateKey, subject }, nowSec = Math.floor(Date.now() / 1000)) {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(te.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(te.encode(JSON.stringify({ aud, exp: nowSec + 12 * 3600, sub: subject })));
  const pub = b64urlDecode(publicKey);
  const key = await crypto.subtle.importKey("jwk", ecJwk(pub, b64urlDecode(privateKey)), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, te.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64urlEncode(sig)}, k=${publicKey}`;
}

// Żądanie do usługi push (bez wysyłania — wysyła wywołujący przez fetch).
// topic: zastępuje czekające u usługi powiadomienie o tym samym temacie
// (≤ 32 znaki base64url).
/**
 * @param {{ endpoint: string, p256dh: string, auth: string }} sub
 * @param {unknown} payloadJson
 * @param {{ publicKey: string, privateKey: string, subject: string }} vapid
 * @param {{ ttl?: number, urgency?: string, topic?: string }} [opts]
 */
export async function buildPushRequest(sub, payloadJson, vapid, opts = {}) {
  const { ttl = 86400, urgency = "normal", topic } = opts;
  const body = await encryptPayload(JSON.stringify(payloadJson), sub.p256dh, sub.auth);
  const headers = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: String(Math.max(0, Math.floor(ttl))),
    Urgency: urgency,
    Authorization: await vapidAuthorization(sub.endpoint, vapid),
  };
  if (topic) headers.Topic = String(topic).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  return { url: sub.endpoint, init: { method: "POST", headers, body } };
}
