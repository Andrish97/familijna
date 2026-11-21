// src/lib/e2e-api.js -- /_e2e_api/* test-only endpoints + /login captcha bypass.
// See tests/README.md for the full mechanism description.
import { json } from "../core/http.js";
import { readJson } from "../core/http.js";
import { supabaseRequest, supabaseRpc } from "../core/supabase.js";
import { fetchFromOrigin } from "../origin/origin.js";
import { handleE2ELease, isE2EPlusAddress, e2eRunOwns } from "./e2e-lease.js";

export const TURNSTILE_TEST_SITEKEY = "1x00000000000000000000AA"; // oficjalny, zawsze-przechodzący testowy sitekey Cloudflare
const E2E_TOKEN_MAX_AGE_MS = 5 * 60 * 1000; // 5 minut
const E2E_NONCE_TTL_SECONDS = 10 * 60; // 10 minut w KV, żeby pokryć zegar-skew
// Zwalniane tylko dla adresów e2e+ wypożyczonych przez ten przebieg (leaseGuard);
// reset hasła: kilka testów resetu na jednym koncie disposable (decyzja właściciela 2026-10-23).
const E2E_RELEASABLE_MAIL_COOLDOWNS = new Set(["auth:guest_upgrade_email", "auth:reset_password"]);

export function normalizeE2ERecipient(value) {
  const recipient = String(value || "").trim().toLowerCase();
  return isE2EPlusAddress(recipient) ? recipient : null;
}

// Adres e2e+ (E25) -- tylko dla przebiegu, który go wypożyczył (nagłówek X-E2E-Run).
async function leaseGuard(env, request, recipient) {
  if (await e2eRunOwns(env, request, recipient)) return null;
  return json({ ok: false, error: "not_leased" }, 403);
}

export function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

export async function verifyE2EToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigHex] = parts;

  let payload;
  try {
    payload = JSON.parse(atob(payloadB64));
  } catch {
    return null;
  }
  if (!payload || typeof payload.iat !== "number" || typeof payload.nonce !== "string" || !payload.nonce) {
    return null;
  }

  let key;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
  } catch {
    return null;
  }

  let sigBytes;
  try {
    sigBytes = hexToBytes(sigHex);
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payloadB64));
  if (!ok) return null;

  const age = Date.now() - payload.iat;
  if (age < 0 || age > E2E_TOKEN_MAX_AGE_MS) return null;

  return payload;
}

export async function authorizeE2EApi(request, env) {
  const secret = String(env.E2E_BYPASS_SECRET || "");
  if (!secret) return false;
  const token = request.headers.get("X-E2E-Token");
  return !!(await verifyE2EToken(token, secret));
}

export async function handleE2EApi(request, env, url) {
  if (!(await authorizeE2EApi(request, env))) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const leaseResponse = await handleE2ELease(request, env, url);
  if (leaseResponse) return leaseResponse;

  if (url.pathname === "/_e2e_api/mail-trigger" && request.method === "POST") {
    let body;
    try { body = await readJson(request); } catch { return json({ ok: false, error: "invalid_body" }, 400); }
    const recipient = normalizeE2ERecipient(body?.recipient), after = Date.parse(body?.after);
    if (!recipient || !Number.isFinite(after) || after < Date.now() - 900000 || after > Date.now() + 5000) {
      return json({ ok: false, error: "invalid_mail_fixture" }, 400);
    }
    const triggerDenied = await leaseGuard(env, request, recipient);
    if (triggerDenied) return triggerDenied;
    // Select recent pending test mail only. Never reset flags, budgets, delays,
    // leases or failures; the normal worker rechecks the actual source/provider.
    const selected = await supabaseRequest(env, "/rest/v1/mail_queue?select=id&to_email=eq." + encodeURIComponent(recipient)
      + "&status=eq.pending&created_at=gte." + encodeURIComponent(new Date(after).toISOString())
      + "&not_before=lte." + encodeURIComponent(new Date().toISOString()) + "&order=created_at.asc&limit=25", { method: "GET" });
    if (!selected.ok || !Array.isArray(selected.data)) return json({ ok: false, error: "mail_fixture_selection_failed" }, 502);
    const ids = selected.data.map(row => row.id);
    if (!ids.length) return json({ ok: true, selected: 0 });
    const invoked = await supabaseRpc(env, "invoke_mail_worker_ids", { p_ids: ids, p_limit: ids.length });
    return json({ ok: invoked.ok, selected: ids.length }, invoked.ok ? 200 : 502);
  }

  // Reset dziennych limitów dostawców poczty przed testami dostarczania
  // (reset_email_limits tylko dla klucza serwisowego, migracja 448).
  if (url.pathname === "/_e2e_api/mail-limits/reset" && request.method === "POST") {
    const result = await supabaseRpc(env, "reset_email_limits", {});
    return json({ ok: result.ok }, result.ok ? 200 : 502);
  }

  // "Minęła godzina" dla blokady wysyłki per adres testowy (mail_cooldowns;
  // mail_cooldown_email_release tylko dla klucza serwisowego, migracja 448).
  if (url.pathname === "/_e2e_api/mail-cooldowns/release" && request.method === "POST") {
    let body;
    try { body = await readJson(request); } catch { return json({ ok: false, error: "invalid_body" }, 400); }
    const recipient = normalizeE2ERecipient(body?.recipient);
    const actionKey = String(body?.action_key || "");
    if (!recipient || !E2E_RELEASABLE_MAIL_COOLDOWNS.has(actionKey)) return json({ ok: false, error: "invalid_release" }, 400);
    const releaseDenied = await leaseGuard(env, request, recipient);
    if (releaseDenied) return releaseDenied;
    const result = await supabaseRpc(env, "mail_cooldown_email_release", {
      p_email: recipient, p_action_key: actionKey, p_max_age_seconds: 7200,
    });
    return json({ ok: result.ok }, result.ok ? 200 : 502);
  }

  // "Kopia była już wysłana" dla pary właściciel–odbiorca (blokada base:share /
  // poll:share). mail_cooldown_reserve tylko dla klucza serwisowego (514), więc
  // test ustawia ją tutaj, jako zalogowany właściciel zasobu z klucza.
  if (url.pathname === "/_e2e_api/mail-cooldowns/reserve-pair" && request.method === "POST") {
    const token = request.headers.get("Authorization") || "";
    if (!/^Bearer [^\s]+$/.test(token)) return json({ ok: false, error: "auth_required" }, 401);
    const user = await supabaseRequest(env, "/auth/v1/user", { headers: { Authorization: token } });
    if (!user.ok || !user.data?.id) return json({ ok: false, error: "auth_required" }, 401);
    let body;
    try { body = await readJson(request); } catch { return json({ ok: false, error: "invalid_body" }, 400); }
    const actionKey = String(body?.action_key || "");
    const targetKey = String(body?.target_key || "");
    const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    const kind = { "base:share": "base", "poll:share": "game" }[actionKey];
    const match = kind && targetKey.match(new RegExp(`^pair:(${uuid}):${uuid}:${kind}:${uuid}$`));
    if (!match || match[1] !== user.data.id) return json({ ok: false, error: "invalid_reserve" }, 400);
    const result = await supabaseRpc(env, "mail_cooldown_reserve", { p_action_key: actionKey, p_target_key: targetKey });
    return json(result.ok ? { ok: true, rows: result.data } : { ok: false }, result.ok ? 200 : 502);
  }

  if (url.pathname === "/_e2e_api/mark-test-guest" && request.method === "POST") {
    const token = request.headers.get("Authorization") || "";
    if (!token.startsWith("Bearer ")) return json({ok:false,error:"guest_token_required"},401);
    const user = await supabaseRequest(env,"/auth/v1/user",{headers:{Authorization:token}});
    if (!user.ok || !user.data?.id) return json({ok:false,error:"invalid_guest"},401);
    const profile = await supabaseRequest(env,`/rest/v1/profiles?id=eq.${encodeURIComponent(user.data.id)}&select=is_guest`);
    if (!profile.ok || profile.data?.[0]?.is_guest !== true) return json({ok:false,error:"not_guest"},403);
    const result = await supabaseRequest(env,`/auth/v1/admin/users/${encodeURIComponent(user.data.id)}`,{
      method:"PUT",body:{app_metadata:{...user.data.app_metadata,is_test_guest:true}}
    });
    return json({ok:result.ok},result.ok?200:502);
  }

  if (url.pathname === "/_e2e_api/mail-delivery" && request.method === "GET") {
    const recipient = normalizeE2ERecipient(url.searchParams.get("recipient"));
    const afterMs = Date.parse(url.searchParams.get("after") || "");
    if (!recipient || !Number.isFinite(afterMs) || afterMs < Date.now() - 25 * 60 * 60 * 1000 || afterMs > Date.now() + 60_000) {
      return json({ ok: false, error: "invalid_query" }, 400);
    }
    const deliveryDenied = await leaseGuard(env, request, recipient);
    if (deliveryDenied) return deliveryDenied;
    const after = encodeURIComponent(new Date(afterMs).toISOString());
    const results = await Promise.all([
      supabaseRequest(env, `/rest/v1/mail_queue?select=id,created_at,status,attempts,not_before,last_attempt_at,provider_used,last_error&to_email=eq.${encodeURIComponent(recipient)}&created_at=gte.${after}&order=created_at.asc&limit=30`),
      supabaseRequest(env, `/rest/v1/mail_function_logs?select=created_at,function_name,event,status,provider,queue_id,error&recipient_email=eq.${encodeURIComponent(recipient)}&created_at=gte.${after}&order=created_at.asc&limit=60`),
    ]);
    if (results.some((res) => !res.ok)) return json({ ok: false, error: "delivery_read_failed" }, 500);
    return json({ ok: true, queue: results[0].data || [], events: results[1].data || [] });
  }

  if (url.pathname === "/_e2e_api/emails" && request.method === "GET") {
    const recipient = normalizeE2ERecipient(url.searchParams.get("recipient"));
    const afterRaw = String(url.searchParams.get("after") || "");
    const afterMs = Date.parse(afterRaw);
    if (!recipient || !Number.isFinite(afterMs)) {
      return json({ ok: false, error: "invalid_query" }, 400);
    }
    // Test nie powinien moc wylistowac calej historii skrzynki po wycieku
    // pojedynczego tokenu. Maksymalne okno odpowiada TTL tabeli.
    if (afterMs < Date.now() - 25 * 60 * 60 * 1000 || afterMs > Date.now() + 60_000) {
      return json({ ok: false, error: "invalid_after" }, 400);
    }
    const readDenied = await leaseGuard(env, request, recipient);
    if (readDenied) return readDenied;

    const path = "/rest/v1/e2e_emails" +
      `?select=id,recipient,from_email,subject,body,body_html,received_at` +
      `&recipient=eq.${encodeURIComponent(recipient)}` +
      `&received_at=gte.${encodeURIComponent(new Date(afterMs).toISOString())}` +
      `&order=received_at.asc&limit=20`;
    const res = await supabaseRequest(env, path);
    if (!res.ok) return json({ ok: false, error: "mailbox_read_failed" }, res.status || 500);
    return json({ ok: true, emails: Array.isArray(res.data) ? res.data : [] });
  }

  if (url.pathname === "/_e2e_api/emails" && request.method === "DELETE") {
    const recipient = normalizeE2ERecipient(url.searchParams.get("recipient"));
    if (!recipient) return json({ ok: false, error: "invalid_recipient" }, 400);
    const clearDenied = await leaseGuard(env, request, recipient);
    if (clearDenied) return clearDenied;
    const res = await supabaseRequest(
      env,
      `/rest/v1/e2e_emails?recipient=eq.${encodeURIComponent(recipient)}`,
      { method: "DELETE", headers: { Prefer: "return=minimal" } }
    );
    if (!res.ok) return json({ ok: false, error: "mailbox_clear_failed" }, res.status || 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: "not_found" }, 404);
}

export async function handleE2ELoginBypass(request, env, url, originBase) {
  const secret = env.E2E_BYPASS_SECRET;
  if (!secret) return null;

  const token = request.headers.get("X-E2E-Token");
  if (!token) return null;

  const payload = await verifyE2EToken(token, secret);
  if (!payload) return null;

  // Jednorazowość: odrzuć jeśli nonce już użyty
  const nonceKey = `e2e_nonce:${payload.nonce}`;
  const alreadyUsed = await env.MAINT_KV.get(nonceKey);
  if (alreadyUsed) return null;
  await env.MAINT_KV.put(nonceKey, "1", { expirationTtl: E2E_NONCE_TTL_SECONDS });

  console.log("[e2e] bypass captcha for /login, nonce:", payload.nonce);

  const res = await fetchFromOrigin(request, url, originBase);
  if (res.status !== 200) return res;

  const rewriter = new HTMLRewriter().on("body", {
    element(el) {
      el.setAttribute("data-captcha-site-key", TURNSTILE_TEST_SITEKEY);
    },
  });
  const rewritten = rewriter.transform(res);

  return new Response(rewritten.body, {
    status: rewritten.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "text/html",
      "Cache-Control": "no-store",
    },
  });
}
