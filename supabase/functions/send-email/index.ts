import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";
import { getEmailCopy, type CopyBlock, type EmailLang, type EmailType } from "./email-templates.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { renderMailDocument } from "../_shared/mail-document.js";
import { createMailTransport, type MailProvider } from "../_shared/mail-providers.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const sbAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

type HookPayload = {
  user: {
    id?: string;
    email: string;
    user_metadata?: Record<string, unknown>;
    email_new?: string;
  };
  email_data: {
    token?: string;
    token_hash?: string;
    token_new?: string;
    token_hash_new?: string;
    action_link?: string;
    old_email?: string;
    new_email?: string;
    redirect_to?: string;
    email_action_type:
      | "signup"
      | "recovery"
      | "email_change"
      | "email_change_current"
      | "email_change_new"
      | string;
  };
};

async function loadProviderOrder(): Promise<string[]> {
  if (!sbAdmin) {
    console.warn("[send-email] no sbAdmin → fallback default order");
    return [];
  }
  try {
    const { data } = await sbAdmin
      .from("email_providers")
      .select("name")
      .eq("is_active", true) // Rygorystyczne filtrowanie po is_active
      .order("priority")
      .limit(10);
    return (data || []).map(p => p.name);
  } catch (e) {
    console.warn("[send-email] loadProviderOrder:error", String(e));
    return [];
  }
}


const mailTransport = createMailTransport();

const HOOK_SECRET_RAW = Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "";
const HOOK_SECRET = HOOK_SECRET_RAW.replace("v1,whsec_", "");
const webhook = new Webhook(HOOK_SECRET);

function scrubEmail(email: string) {
  const e = String(email || "").trim();
  const at = e.indexOf("@");
  if (at <= 1) return e ? "***" : "";
  return `${e.slice(0, 2)}***${e.slice(at)}`;
}

function clampError(message: unknown, max = 2000) {
  return String(message ?? "").slice(0, max);
}

type LogLevel = "debug" | "info" | "warn" | "error";

async function writeLog(entry: {
  requestId: string;
  level?: LogLevel;
  event: string;
  status?: string;
  actorUserId?: string | null;
  recipientEmail?: string | null;
  provider?: string | null;
  error?: string | null;
  meta?: Record<string, unknown>;
}) {
  if (!sbAdmin) return;
  try {
    const { error } = await sbAdmin.from("mail_function_logs").insert({
      function_name: "send-email",
      level: entry.level || "info",
      event: entry.event,
      request_id: entry.requestId,
      actor_user_id: entry.actorUserId || null,
      recipient_email: entry.recipientEmail || null,
      provider: entry.provider || null,
      status: entry.status || null,
      error: entry.error ? clampError(entry.error) : null,
      meta: entry.meta || {},
    });
    if (error) {
      console.warn("[send-email] log:insert_failed", { error });
    }
  } catch (err) {
    console.warn("[send-email] log:insert_failed", { error: String(err) });
  }
}

async function loadUserEmailFallbacks(userId: string): Promise<{
  email: string;
  emailNew: string;
  pendingMetaEmail: string;
}> {
  if (!sbAdmin) return { email: "", emailNew: "", pendingMetaEmail: "" };

  try {
    const { data, error } = await sbAdmin.auth.admin.getUserById(userId);
    if (error) throw error;

    const user = data?.user;
    const pendingMetaEmail = String(user?.user_metadata?.familijna_email_change_pending || "").trim();
    return {
      email: String(user?.email || "").trim(),
      emailNew: String((user as { email_change?: string } | undefined)?.email_change || "").trim(),
      pendingMetaEmail,
    };
  } catch (err) {
    console.warn("[send-email] fallback user load failed", { userId, error: String(err) });
    return { email: "", emailNew: "", pendingMetaEmail: "" };
  }
}

async function loadProviderLimits(): Promise<Map<string, { name: string; rem_worker: number; rem_immediate: number; is_active: boolean }>> {
  if (!sbAdmin) throw new Error("missing_supabase_service_credentials");
  const { data, error } = await sbAdmin
    .from("email_providers")
    .select("name,rem_worker,rem_immediate,is_active")
    .eq("is_active", true);
  if (error) {
    console.warn("[send-email] load_provider_limits:error", error);
    return new Map();
  }
  const map = new Map<string, { name: string; rem_worker: number; rem_immediate: number; is_active: boolean }>();
  for (const p of data || []) {
    map.set(p.name, { name: p.name, rem_worker: p.rem_worker, rem_immediate: p.rem_immediate, is_active: p.is_active });
  }
  return map;
}

// Jeden mail z limitu dostawcy: najpierw rezerwa „od razu”, potem pula kolejki
// (migracja 483). Zwraca false, gdy dostawca nie ma już żadnego limitu.
async function takeImmediateLimit(provider: string): Promise<boolean> {
  if (!sbAdmin) throw new Error("missing_supabase_service_credentials");
  const { data } = await sbAdmin.from("email_providers").select("id").eq("name", provider).single();
  if (!data?.id) return false;
  const { data: pool, error } = await sbAdmin.rpc("take_provider_immediate", { p_id: data.id });
  if (error) {
    console.warn("[send-email] take_immediate:error", error);
    return false;
  }
  return pool !== "none";
}

async function sendWithFallbacks(
  to: string,
  subject: string,
  html: string,
  opts: { requestId: string; actorUserId?: string | null } | null = null,
) {
  const limits = await loadProviderLimits();
  const order = await loadProviderOrder();

  const errs: string[] = [];
  let usedProvider: string | null = null;

  for (const p of order) {
    const limit = limits.get(p);
    if (!limit || limit.rem_immediate + limit.rem_worker <= 0) {
      errs.push(`${p}:no_immediate_quota`);
      continue;
    }
    try {
      // Zmniejszamy limit za każdą podjętą próbę (zgodnie z prośbą użytkownika)
      if (!(await takeImmediateLimit(p))) {
        errs.push(`${p}:no_immediate_quota`);
        continue;
      }

      await mailTransport.send(p as MailProvider, { to, subject, html, mode: "immediate" });

      usedProvider = p;

      if (opts?.requestId) {
        await writeLog({
          requestId: opts.requestId,
          event: "provider_success",
          status: "sent",
          actorUserId: opts.actorUserId || null,
          recipientEmail: to,
          provider: p,
        });
      }
      return { provider: p };
    } catch (e) {
      const msg = String((e as any)?.message || e);
      console.warn("[send-email] provider failed", { provider: p, error: msg });
      if (opts?.requestId) {
        await writeLog({
          requestId: opts.requestId,
          level: "warn",
          event: "provider_failed",
          status: "failed",
          actorUserId: opts.actorUserId || null,
          recipientEmail: to,
          provider: p,
          error: msg,
        });
      }
      errs.push(`${p}:${msg}`);
    }
  }

  console.error("[send-email] all providers exhausted", errs);
  if (opts?.requestId) {
    await writeLog({
      requestId: opts.requestId,
      level: "warn",
      event: "all_providers_exhausted",
      status: "failed",
      actorUserId: opts.actorUserId || null,
      recipientEmail: to,
      error: errs.join("|"),
    });
  }

  // Account actions remain direct. Never pass them to the notification queue.
  throw new Error(errs.join("|") || "no_available_email_provider");
}

function getRedirectUrl(payload: HookPayload): URL | null {
  const redirect = String(payload.email_data.redirect_to || "").trim();
  if (!redirect) return null;
  try {
    return new URL(redirect);
  } catch {
    console.warn("[send-email] invalid redirect_to (ignored)", { redirect });
    return null;
  }
}

// E24 R23: link z tokenem tylko na własną domenę — redirect_to spoza listy
// (GoTrue sprawdza listę przekierowań, to druga zapora) idzie na SITE_URL.
const OWN_ORIGINS = new Set(["https://www.familijna.app", "https://familijna.app"]);
function siteOrigin(): string | null {
  try { return new URL(String(Deno.env.get("SITE_URL") || "").trim()).origin; } catch { return null; }
}

function getBaseOrigin(payload: HookPayload, redirectUrl: URL | null): string {
  if (redirectUrl && (OWN_ORIGINS.has(redirectUrl.origin) || redirectUrl.origin === siteOrigin())) return redirectUrl.origin;
  if (redirectUrl) console.warn("[send-email] redirect_to outside own origins (ignored)");

  const actionLink = String(payload.email_data.action_link || "").trim();
  if (actionLink) {
    try {
      const o = new URL(actionLink).origin;
      if (OWN_ORIGINS.has(o) || o === siteOrigin()) return o;
    } catch {
      console.warn("[send-email] invalid action_link origin (ignored)");
    }
  }

  const siteUrl = String(Deno.env.get("SITE_URL") || "").trim();
  if (siteUrl) {
    try {
      return new URL(siteUrl).origin;
    } catch {
      console.warn("[send-email] invalid SITE_URL origin (ignored)");
    }
  }

  throw new Error("Cannot resolve base origin (no valid redirect_to/action_link/SITE_URL)");
}

function getLangFromRedirect(url: URL): EmailLang | "" {
  const lang = (url.searchParams.get("lang") || "").toLowerCase();
  if (lang === "uk") return "uk";
  if (lang === "en") return "en";
  if (lang === "pl") return "pl";
  return "";
}

function extractTargetEmail(payload: HookPayload, redirectUrl: URL | null): string {
  const fromRedirect =
    String(redirectUrl?.searchParams.get("to") || "").trim() ||
    String(redirectUrl?.searchParams.get("email") || "").trim() ||
    String(redirectUrl?.searchParams.get("new_email") || "").trim() ||
    String(redirectUrl?.searchParams.get("email_new") || "").trim();
  if (fromRedirect) return fromRedirect;

  const actionLink = String(payload.email_data.action_link || "").trim();
  if (actionLink) {
    try {
      const u = new URL(actionLink);
      const fromAction =
        String(u.searchParams.get("to") || "").trim() ||
        String(u.searchParams.get("email") || "").trim() ||
        String(u.searchParams.get("new_email") || "").trim() ||
        String(u.searchParams.get("email_new") || "").trim();
      if (fromAction) return fromAction;
    } catch {
      console.warn("[send-email] invalid action_link while extracting target email");
    }
  }

  const fromUserNew = String(payload.user.email_new || "").trim();
  if (fromUserNew) return fromUserNew;

  const fromEmailDataNew = String(payload.email_data.new_email || "").trim();
  if (fromEmailDataNew) return fromEmailDataNew;

  const fromEmailDataOld = String(payload.email_data.old_email || "").trim();
  if (fromEmailDataOld) return fromEmailDataOld;

  const fromMeta = String(payload.user.user_metadata?.familijna_email_change_pending || "").trim();
  if (fromMeta) return fromMeta;

  return "";
}

function firstEmail(...values: (string | undefined)[]): string {
  for (const value of values) {
    const email = String(value || "").trim();
    if (email) return email;
  }
  return "";
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  opts: { requestId: string; actorUserId?: string | null } | null = null,
) {
  await sendWithFallbacks(to, subject, html, opts);
}

serve(async (req) => {
  const requestId = crypto.randomUUID();
  await writeLog({
    requestId,
    event: "request_start",
    status: "started",
    meta: { method: req.method, contentType: req.headers.get("content-type") || "" },
  });

  if (req.method !== "POST") {
    await writeLog({
      requestId,
      level: "warn",
      event: "method_not_allowed",
      status: "failed",
      meta: { method: req.method },
    });
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!mailTransport.hasAnyProvider) {
    console.error("[send-email] config:missing_mail_keys");
    await writeLog({
      requestId,
      level: "error",
      event: "config_missing_mail_keys",
      status: "failed",
    });
    return json({ ok: false, error: "Missing mail provider keys (BREVO_API_KEY, MAILGUN_API_KEY, SENDPULSE, or ZEPTOMAIL_API_KEY)" }, 500);
  }

  if (!HOOK_SECRET) {
    console.error("[send-email] config:missing_SEND_EMAIL_HOOK_SECRET");
    await writeLog({
      requestId,
      level: "error",
      event: "config_missing_hook_secret",
      status: "failed",
    });
    return json({ ok: false, error: "Missing SEND_EMAIL_HOOK_SECRET env" }, 500);
  }

  const raw = await req.text();
  const sig = req.headers.get("webhook-signature") || "";
  const ts = req.headers.get("webhook-timestamp") || "";
  const id = req.headers.get("webhook-id") || "";

  let payload: HookPayload;
  try {
    payload = webhook.verify(raw, {
      "webhook-id": id,
      "webhook-timestamp": ts,
      "webhook-signature": sig,
    }) as HookPayload;
  } catch (err) {
    console.error("[send-email] request:invalid_signature", { error: String(err) });
    await writeLog({
      requestId,
      level: "error",
      event: "request_invalid_signature",
      status: "failed",
      error: String(err),
    });
    return json({ ok: false, error: `Invalid signature: ${String(err)}` }, 401);
  }

  try {
    const redirectUrl = getRedirectUrl(payload);
    const actorUserId = String(payload.user.id || "").trim() || null;
    await writeLog({
      requestId,
      event: "payload_verified",
      status: "ok",
      actorUserId,
      meta: {
        actionType: payload.email_data.email_action_type,
        redirectTo: payload.email_data.redirect_to || "",
      },
    });
    const baseOrigin = getBaseOrigin(payload, redirectUrl);
    const lang = pickLang(payload, redirectUrl);
    const type = payload.email_data.email_action_type;

    if (type === "email_change" || type === "email_change_current" || type === "email_change_new") {
      const userId = String(payload.user.id || "").trim();
      const fallbackUser = userId ? await loadUserEmailFallbacks(userId) : { email: "", emailNew: "", pendingMetaEmail: "" };
      const currentEmail = firstEmail(payload.user.email, fallbackUser.email).trim();
      const currentEmailNormalized = currentEmail.toLowerCase();
      const oldEmail = String(payload.email_data.old_email || "").trim();
      const newEmail = String(payload.email_data.new_email || "").trim();
      const pendingMetaEmail = firstEmail(
        String(payload.user.user_metadata?.familijna_email_change_pending || ""),
        fallbackUser.pendingMetaEmail,
      ).trim();
      const intent = String(payload.user.user_metadata?.familijna_email_change_intent || "").trim().toLowerCase();
      const isGuestMigrate = intent === "guest_migrate";

      const targetEmail = firstEmail(
        extractTargetEmail(payload, redirectUrl),
        newEmail,
        payload.user.email_new,
        fallbackUser.emailNew,
        pendingMetaEmail,
        oldEmail,
      ).trim();
      const targetEmailNormalized = targetEmail.toLowerCase();

      const tokenHash = payload.email_data.token_hash || "";
      const tokenHashNew = payload.email_data.token_hash_new || "";

      const emailTemplate: EmailType = isGuestMigrate ? "guest_migrate" : "email_change";
      const copy = await getEmailCopy(emailTemplate, lang);

      // Dwa tokeny = "secure email change" (potwierdza stary i nowy adres).
      // Jeden token = potwierdza tylko nowy adres; nie może trafić na stary,
      // bo kliknięcie tam zatwierdziłoby zmianę bez sprawdzenia nowej skrzynki.
      const secureChange = Boolean(tokenHash && tokenHashNew);
      const thCurrent = secureChange ? tokenHash : "";
      const thNew = tokenHashNew || tokenHash;

      const linkCurrent =
        `${baseOrigin}/login/confirm/?token_hash=${encodeURIComponent(thCurrent)}&type=email_change&lang=${lang}`;
      // to= pozwala stronie potwierdzenia rozpoznać anulowaną zmianę (email_intents).
      const linkTarget =
        `${baseOrigin}/login/confirm/?token_hash=${encodeURIComponent(thNew)}&type=email_change&lang=${lang}` +
        (targetEmail ? `&to=${encodeURIComponent(targetEmail.toLowerCase())}` : "");

      if (currentEmail && thCurrent) {
        const htmlCurrent = renderEmail(copy, linkCurrent, lang);
        await sendEmail(currentEmail, copy.subject, htmlCurrent, { requestId, actorUserId });
      }

      if (targetEmail && thNew && targetEmailNormalized !== currentEmailNormalized) {
        const htmlTarget = renderEmail(copy, linkTarget, lang);
        await sendEmail(targetEmail, copy.subject, htmlTarget, { requestId, actorUserId });
      }

      // Bez "secure email change" stary adres nie dostaje linku, więc dostaje
      // samo powiadomienie (zabezpieczenie przy przejętej sesji). Błąd tutaj
      // nie blokuje zmiany — mail z potwierdzeniem już wyszedł.
      if (!secureChange && !isGuestMigrate && currentEmail && targetEmail &&
          targetEmailNormalized !== currentEmailNormalized) {
        try {
          const notice = await getEmailCopy("email_change_notice", lang);
          const noticeCopy = { ...notice, desc: notice.desc.replaceAll("{email}", targetEmail) };
          const linkLogin = `${baseOrigin}/login/?lang=${lang}`;
          const htmlNotice = renderEmail(noticeCopy, linkLogin, lang);
          await sendEmail(currentEmail, notice.subject, htmlNotice, { requestId, actorUserId });
        } catch (err) {
          await writeLog({
            requestId,
            level: "error",
            event: "email_change_notice_failed",
            status: "error",
            actorUserId,
            error: String(err),
          });
        }
      }

      await writeLog({
        requestId,
        event: "request_done",
        status: "ok",
        actorUserId,
        meta: { actionType: type, flow: "email_change", secureChange },
      });
      return json({ ok: true });
    }


    const actionLink = buildActionLink(payload, lang, baseOrigin);
    const template = templateFor(type);
    const copy = await getEmailCopy(template, lang);
    const subject = copy.subject;
    const html = renderEmail(copy, actionLink, lang);

    const to =
      type === "email_change_new"
        ? payload.user.email_new || payload.user.email
        : payload.user.email;

    await sendEmail(to, subject, html, { requestId, actorUserId: String(payload.user.id || "").trim() || null });
    await writeLog({
      requestId,
      event: "request_done",
      status: "ok",
      actorUserId: String(payload.user.id || "").trim() || null,
      recipientEmail: to,
      meta: { actionType: type },
    });

    return json({ ok: true });
  } catch (err) {
    console.error("[send-email] request:error", { error: String(err) });
    await writeLog({
      requestId,
      level: "error",
      event: "request_error",
      status: "failed",
      actorUserId: String(payload.user.id || "").trim() || null,
      error: String(err),
      meta: { actionType: payload.email_data.email_action_type || "" },
    });
    return json({ ok: false, error: `Hook error: ${String(err)}` }, 500);
  }
});

function pickLang(payload: HookPayload, redirectUrl?: URL | null): EmailLang {
  const url = redirectUrl || (() => {
    return getRedirectUrl(payload);
  })();

  if (url) {
    const l = getLangFromRedirect(url);
    if (l) return l;
  }

  const metaLang = String(payload.user.user_metadata?.language || "").toLowerCase();
  if (metaLang === "uk") return "uk";
  if (metaLang === "en") return "en";
  return "pl";
}

function buildActionLink(payload: HookPayload, lang: EmailLang, baseOrigin: string): string {
  const type = payload.email_data.email_action_type;
        const tokenHash = payload.email_data.token_hash || "";
  const tokenHashNew = payload.email_data.token_hash_new || "";

  const mk = (page: "login/confirm/" | "login/reset/", th: string, t: string) => {
    if (!th) throw new Error(`Missing token_hash for type=${type}`);
    return `${baseOrigin}/${page}?token_hash=${encodeURIComponent(th)}&type=${encodeURIComponent(t)}&lang=${lang}`;
  };

  if (type === "signup") return mk("login/confirm/", tokenHash, "signup");
  if (type === "recovery") return mk("login/reset/", tokenHash, "recovery");

  if (type === "email_change") return mk("login/confirm/", tokenHash, "email_change");
  if (type === "email_change_current") return mk("login/confirm/", tokenHash, "email_change");
  if (type === "email_change_new") return mk("login/confirm/", tokenHashNew || tokenHash, "email_change");

  return mk("login/confirm/", tokenHash, type);
}

function templateFor(type: string): EmailType {
  if (type === "guest_migrate") return "guest_migrate";
  if (type === "recovery") return "recovery";
  if (type === "email_change" || type === "email_change_current" || type === "email_change_new") return "email_change";
  return "signup";
}

function renderEmail(t: CopyBlock, link: string, lang: EmailLang): string {
  return renderMailDocument({ lang, title: t.title, subtitle: t.subtitle, body: t.desc,
    actionLabel: t.btn, actionUrl: link, ignoreNote: t.ignore,
    linkHint: t.linkLabel ?? t.copyHint, autoNote: t.footer, source: t.source });
}
