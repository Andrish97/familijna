import { timingSafeEqual } from "../_shared/internal-auth.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore: moduły JS współdzielone z testami unit (Node)
import { buildPushRequest } from "../_shared/web-push.js";
// @ts-ignore
import { adminNotification, appNotification } from "../_shared/push-content.js";
// @ts-ignore
import { PUSH_APP_TEXTS } from "../_shared/push-app-texts.js";

// E29: wysyłka powiadomień push ze skrzynki public.push_outbox (migracja 526).
// Woła ją tylko baza (push_send_kick: pg_net po dopisaniu zdarzenia i cron co
// minutę). Uwierzytelnienie: X-Internal-Secret =
// hex(HMAC-SHA256(PUSH_SEND_SECRET, "push-send")); baza liczy to samo z Vault.
// Klucz prywatny VAPID jest tylko tutaj (functions.env).
const CONTEXT = "push-send";

async function expectedSecret(): Promise<string> {
  const base = (Deno.env.get("PUSH_SEND_SECRET") || "").trim();
  if (!base) return "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(base), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(CONTEXT)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});

const vapid = {
  publicKey: (Deno.env.get("VAPID_PUBLIC_KEY") || "").trim(),
  privateKey: (Deno.env.get("VAPID_PRIVATE_KEY") || "").trim(),
  subject: (Deno.env.get("VAPID_SUBJECT") || "").trim(),
};

type Row = { id: number; app: "main" | "admin"; user_id: string | null; event: string; category: string;
  vars: Record<string, unknown>; ttl: number; urgency: string; created_at: string };
type Sub = { id: string; endpoint: string; p256dh: string; auth: string; lang: string; kinds: string[] };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function sendOne(sub: Sub, payload: unknown, row: Row): Promise<{ ok: boolean; gone: boolean; status: number }> {
  const req = await buildPushRequest(sub, payload, vapid, { ttl: row.ttl, urgency: row.urgency, topic: (payload as any).tag });
  try {
    const res = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(10000) });
    await res.body?.cancel().catch(() => {});
    return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
  } catch {
    return { ok: false, gone: false, status: 0 };
  }
}

async function processRow(row: Row) {
  let q = admin.from("push_subscriptions").select("id,endpoint,p256dh,auth,lang,kinds").eq("app", row.app);
  q = row.app === "main" ? q.eq("user_id", row.user_id) : q.is("user_id", null);
  const { data: subs, error } = await q;
  if (error) throw new Error("subscriptions_read");
  const targets = (subs as Sub[] || []).filter((s) => !s.kinds?.length || s.kinds.includes(row.category));
  let delivered = 0, failed = 0;
  const errors = new Set<string>();
  for (const sub of targets) {
    const payload = row.app === "admin" ? adminNotification(row) : appNotification(row, sub.lang, PUSH_APP_TEXTS);
    if (!payload) { errors.add("no_content"); continue; }
    const r = await sendOne(sub, payload, row);
    if (r.ok) delivered++; else { failed++; errors.add(r.status ? `HTTP ${r.status}` : "network"); }
    await admin.rpc("push_subscription_result", { p_id: sub.id, p_ok: r.ok, p_gone: r.gone });
  }
  await admin.rpc("push_outbox_finish", {
    p_id: row.id, p_delivered: delivered, p_failed: failed,
    p_error: errors.size ? [...errors].join(", ").slice(0, 200) : null,
  });
  return { delivered, failed };
}

serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const expected = await expectedSecret();
  const got = req.headers.get("x-internal-secret") || "";
  if (!expected || !timingSafeEqual(got, expected)) return json({ ok: false, error: "forbidden" }, 403);
  if (!vapid.publicKey || !vapid.privateKey || !vapid.subject) return json({ ok: false, error: "vapid_not_configured" }, 500);

  let rows = 0, delivered = 0, failed = 0;
  for (let round = 0; round < 4; round++) {
    const { data, error } = await admin.rpc("push_outbox_claim", { p_limit: 50 });
    if (error) return json({ ok: false, error: "claim_failed" }, 500);
    const batch = (data || []) as Row[];
    if (!batch.length) break;
    for (const row of batch) {
      rows++;
      try {
        const r = await processRow(row);
        delivered += r.delivered; failed += r.failed;
      } catch (e) {
        // bez finish: wiersz wróci po 2 min (claim), najwyżej 5 prób
        console.error("[push-send] wiersz", row.id, String((e as Error)?.message || e).slice(0, 80));
      }
    }
  }
  return json({ ok: true, rows, delivered, failed });
});
