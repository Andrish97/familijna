import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { md5Hex } from "../_shared/md5.js";
import { parseNotificationItem, parseMailLang, prepareNotificationRow } from "../_shared/notification-send.js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const sbAnon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sbAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

// Goście (konta anonimowe) nie wysyłają żadnych maili.
async function isGuest(user: any): Promise<boolean> {
  if (user?.is_anonymous === true || user?.user_metadata?.is_guest === true || user?.app_metadata?.is_guest === true) return true;
  const { data, error } = await sbAdmin.from("profiles").select("is_guest").eq("id", user.id).maybeSingle();
  if (error) throw error;
  return data?.is_guest === true;
}

// Dostęp do danych dla szablonów (klucz serwisowy; tylko odczyt).
function notificationDb(user: any) {
  const one = async (query: any) => { const { data, error } = await query; if (error) throw error; return data; };
  return {
    allocation: (uid: string, kind: string, token: string) => one(sbAdmin.from("mail_notification_allocations")
      .select("to_email,recipient_id,snapshot,copy_offer_id").eq("owner_id", uid).eq("source_kind", kind).eq("source_token", token)
      .is("consumed_at", null).is("revoked_at", null).gt("enqueue_before", new Date().toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle()),
    ownerLabel: async (uid: string) => {
      const row = await one(sbAdmin.from("profiles").select("username").eq("id", uid).maybeSingle());
      return String(row?.username || "").trim() || String(user?.email || "").trim();
    },
    baseName: async (id: string) => (await one(sbAdmin.from("question_bases").select("name").eq("id", id).maybeSingle()))?.name || "",
    gameName: async (id: string) => (await one(sbAdmin.from("games").select("name").eq("id", id).maybeSingle()))?.name || "",
    copyOffer: (id: string) => one(sbAdmin.from("resource_copy_offers").select("name,resource_kind,source_id").eq("id", id).maybeSingle()),
    unsubToken: async (email: string) => (await one(sbAdmin.from("email_unsub_tokens").select("token").eq("email", email).maybeSingle()))?.token || null,
    pollUnsubInfo: async (uid: string, email: string) => {
      const rows = await one(sbAdmin.rpc("get_unsub_info_for_task_emails", { p_owner_id: uid, p_emails: [email] }));
      return (Array.isArray(rows) ? rows : []).find((row: any) => String(row?.email || "").toLowerCase() === email) || null;
    },
    md5Hex,
  };
}

function insertError(error: any): string {
  const message = String(error?.message || "");
  if (message.includes("cooldown_active")) return "cooldown";
  if (message.includes("invalid_notification")) return "invalid_notification";
  return "insert_failed";
}

// Maile powiadomień wyłącznie z szablonów serwera (audyt E24):
// { lang, items: [{ action, token, reminder? }] }.
async function sendNotificationItems(body: any, user: any, batchMax: number) {
  const lang = parseMailLang(body.lang);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map(parseNotificationItem);
  if (!lang || !items.length || items.some((item: any) => !item)) return json({ ok: false, error: "invalid_notification_request" }, 400);
  const db = notificationDb(user);
  const results: any[] = [];
  let queued = 0;
  for (const [index, item] of items.entries()) {
    if (index >= batchMax) { results.push({ token: item.token, ok: false, queued: false, error: "batch_limit" }); continue; }
    const prepared = await prepareNotificationRow({ uid: user.id, lang, item, db });
    if (!prepared.row) { results.push({ token: item.token, ok: true, queued: false, skipped: true, reason: prepared.skip }); continue; }
    const { data: inserted, error } = await sbAdmin.from("mail_queue").insert(prepared.row).select("id");
    if (error) { results.push({ token: item.token, ok: false, queued: false, error: insertError(error) }); continue; }
    const count = Array.isArray(inserted) ? inserted.length : 0;
    queued += count;
    results.push(count ? { token: item.token, ok: true, queued: true }
      : { token: item.token, ok: true, queued: false, skipped: true, reason: "notifications_disabled" });
  }
  if (results.every((r) => !r.ok)) {
    const cooldown = results.some((r) => r.error === "cooldown");
    return json({ ok: false, error: cooldown ? "cooldown" : results[0].error, results }, cooldown ? 429 : 500);
  }
  return json({ ok: true, queued, results });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return json({ ok: false, error: "Missing token" }, 401);

    const { data: userData, error: authError } = await sbAnon.auth.getUser(token);
    if (authError || !userData?.user) return json({ ok: false, error: "Invalid JWT" }, 401);
    if (await isGuest(userData.user)) return json({ ok: false, error: "guest_forbidden" }, 403);

    const raw = await req.text();
    if (!raw.trim()) return json({ ok: false, error: "Empty body" }, 400);

    let body: any;
    try { body = JSON.parse(raw); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "Invalid body" }, 400);

    const settings = await sbAdmin.from("mail_settings").select("delay_ms,batch_max").eq("id", 1).maybeSingle();
    const batchMax = Math.min(500, Math.max(1, Number(settings?.data?.batch_max) || 100));

    // Tylko szablony serwera: przeglądarka nie przekazuje treści ani odbiorcy.
    return await sendNotificationItems(body, userData.user, batchMax);
  } catch (e) {
    console.error("[send-mail] failed:", String(e).slice(0, 300));
    return json({ ok: false, error: "send_failed" }, 500);
  }
});
