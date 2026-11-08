import { getTurnstileToken } from "./turnstile.js?v=v2026-11-08T23264";
// 6-cyfrowy kod urządzenia -> { ok, device_type, game_id, share_key, … } przez
// Worker (/_api/device/resolve, limit nieudanych prób; migracja 514).
// err: "not_found" | "rate_limited" | "unavailable".
// Po wyczerpaniu łącznego limitu pomyłek Worker chce tokenu Turnstile
// (captcha_required, E24 R14) — wtedy jedno ponowienie z tokenem.
export async function resolveDeviceCode(code, captcha_token) {
  const res = await fetch("/_api/device/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: String(code || ""), ...(captcha_token ? { captcha_token } : {}) }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 429 && data?.err === "captcha_required" && !captcha_token) {
    const host = document.createElement("div");
    host.className = "contact-captcha";
    host.hidden = true;
    document.body.append(host);
    try {
      const token = await getTurnstileToken(host, { lang: document.documentElement.lang || "pl" });
      return await resolveDeviceCode(code, token);
    } catch {
      return { ok: false, err: "rate_limited" };
    } finally { host.remove(); }
  }
  if (res.status === 429) return { ok: false, err: "rate_limited" };
  if (!data || typeof data !== "object") throw new Error(`device code: HTTP ${res.status}`);
  return data;
}
