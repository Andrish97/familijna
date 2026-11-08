// src/lib/core/rate-limit.js -- liczniki limitów w KV (okno stałe, TTL = okno).
// Klucze zawierają tylko skróty SHA-256 (adres IP, e-mail i login nie trafiają do KV).

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// Adres do limitów: IPv6 liczony po prefiksie /64 (jedna sieć klienta ma ich
// miliardy), IPv4 w całości (E24 R29).
export function clientIp(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return full.slice(0, 4).map((x) => (x || "0").toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

async function readCount(env, key) {
  return Number(await env.MAINT_KV.get(key)) || 0;
}

// Czy limit jest już wyczerpany (bez zużywania próby).
export async function limitReached(env, key, max) {
  return (await readCount(env, key)) >= max;
}

// Zużywa jedną próbę; false = limit wyczerpany (próba nie jest liczona).
export async function claimSlot(env, key, max, windowS) {
  const count = await readCount(env, key);
  if (count >= max) return false;
  await env.MAINT_KV.put(key, String(count + 1), { expirationTtl: Math.max(60, windowS) });
  return true;
}

// Dolicza próbę bez sprawdzania (np. nieudane logowanie).
export async function countAttempt(env, key, windowS) {
  const count = await readCount(env, key);
  await env.MAINT_KV.put(key, String(count + 1), { expirationTtl: Math.max(60, windowS) });
}

// Kilka limitów naraz: najpierw sprawdzenie wszystkich, potem zużycie.
// Odmowa jednego nie zużywa pozostałych.
export async function claimSlots(env, limits) {
  for (const { key, max } of limits) {
    if (await limitReached(env, key, max)) return false;
  }
  for (const { key, windowS } of limits) await countAttempt(env, key, windowS);
  return true;
}
