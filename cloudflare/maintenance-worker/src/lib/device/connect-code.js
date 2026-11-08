// src/lib/device/connect-code.js -- 6-cyfrowy kod urządzenia (TV, „Podłącz
// urządzenie”) -> klucz urządzenia albo ankiety. Tylko tutaj (klucz
// serwisowy): baza nie wiedziała, kto zgaduje, a kod ma 10^6 możliwości.
// Liczone są tylko nieudane próby -- pomyłki na IP i łącznie (zgadywanie
// z wielu adresów). Decyzja użytkownika 2026-10-29, migracja 514.
import { json } from "../core/http.js";
import { supabaseRpc } from "../core/supabase.js";
import { sha256Hex, clientIp, limitReached, countAttempt } from "../core/rate-limit.js";
import { verifyTurnstile } from "../auth/turnstile.js";

const SITE_ORIGIN = "https://www.familijna.app";
export const CODE_FAIL_WINDOW_IP_S = 10 * 60;
export const CODE_FAIL_MAX_PER_IP = 10;
export const CODE_FAIL_WINDOW_ALL_S = 60 * 60;
export const CODE_FAIL_MAX_ALL = 200;
const GLOBAL_KEY = "device_code_fail_all";

export async function handleDeviceCodeResolve(request, env) {
  if (request.method !== "POST") return json({ ok: false, err: "method_not_allowed" }, 405);
  const origin = request.headers.get("Origin");
  if (origin && origin !== SITE_ORIGIN) return json({ ok: false, err: "forbidden" }, 403);
  if (!String(request.headers.get("Content-Type") || "").toLowerCase().startsWith("application/json")) {
    return json({ ok: false, err: "invalid_content_type" }, 415);
  }
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, err: "invalid_json" }, 400); }
  const code = String(body?.code ?? "").replace(/\s+/g, "");
  if (!/^[0-9]{6}$/.test(code)) return json({ ok: false, err: "not_found" });

  const ipKey = `device_code_fail_ip:${await sha256Hex(clientIp(request))}`;
  if (await limitReached(env, ipKey, CODE_FAIL_MAX_PER_IP)) return json({ ok: false, err: "rate_limited" }, 429);
  // Łączny limit (zgadywanie z wielu adresów) nie blokuje wszystkich: po jego
  // wyczerpaniu kod przechodzi tylko z tokenem Turnstile (E24 R14).
  if (await limitReached(env, GLOBAL_KEY, CODE_FAIL_MAX_ALL)) {
    const check = body?.captcha_token ? await verifyTurnstile(request, env, body.captcha_token) : { ok: false };
    if (!check.ok) return json({ ok: false, err: "captcha_required" }, 429);
  }
  const rpc = await supabaseRpc(env, "resolve_device_connect_code", { p_code: code });
  if (!rpc.ok) return json({ ok: false, err: "unavailable" }, 502);
  const data = rpc.data && typeof rpc.data === "object" ? rpc.data : {};
  if (!data.ok) {
    await countAttempt(env, ipKey, CODE_FAIL_WINDOW_IP_S);
    await countAttempt(env, GLOBAL_KEY, CODE_FAIL_WINDOW_ALL_S);
    return json({ ok: false, err: "not_found" });
  }
  return json(data);
}

export const DEVICE_ROUTES = {
  "/_api/device/resolve": handleDeviceCodeResolve,
};
