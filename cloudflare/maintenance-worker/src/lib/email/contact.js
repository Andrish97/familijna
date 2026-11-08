// src/lib/contact.js -- public contact-form endpoints.
import { json, readJsonOr400 } from "../core/http.js";
import { supabaseRpc, supabaseRequest, normalizeRpcValue, summarizeSupabaseError } from "../core/supabase.js";
import { uploadToStorage } from "../core/storage.js";
import { buildContactEmail } from "./contact-email.js";
import { htmlToPlainTextPreview } from "./html-to-text.js";
import { normalizeLang } from "../core/utils.js";
import { sha256Hex, clientIp, claimSlots } from "../core/rate-limit.js";
import { verifyTurnstile, CAPTCHA_STATUS } from "../auth/turnstile.js";

async function captchaRefusal(request, env, body) {
  const check = await verifyTurnstile(request, env, body?.captcha_token);
  return check.ok ? null : json({ ok: false, error: check.error }, CAPTCHA_STATUS[check.error] || 400);
}

// Formularz kontaktu (okno 1 h): na adres IP i łącznie dla całej strony.
// Limit na adres e-mail jest w bazie (save_form_message, rate_limited_email).
const SUBMIT_WINDOW_S = 3600;
export const SUBMIT_MAX_PER_IP = 5;
export const SUBMIT_MAX_GLOBAL = 100;

export async function handleContactSubmit(request, env) {
  const body = await readJsonOr400(request);
  if (body instanceof Response) return body;
  if (!body || typeof body !== "object") return json({ ok: false, error: "invalid_body" }, 400);

  const { email, subject, message, lang = "pl", attachments: formAttachments = [] } = body;
  const refused = await captchaRefusal(request, env, body);
  if (refused) return refused;

  const allowed = await claimSlots(env, [
    { key: `contact_submit_ip:${await sha256Hex(clientIp(request))}`, max: SUBMIT_MAX_PER_IP, windowS: SUBMIT_WINDOW_S },
    { key: "contact_submit_global", max: SUBMIT_MAX_GLOBAL, windowS: SUBMIT_WINDOW_S },
  ]);
  if (!allowed) return json({ ok: false, error: "rate_limited" }, 429);

  const rpc = await supabaseRpc(env, "save_form_message", {
    p_email:   String(email   || "").trim().toLowerCase(),
    p_subject: String(subject || "").trim(),
    p_body:    String(message || "").trim(),
    p_lang:    String(lang    || "pl"),
  });

  if (!rpc.ok) {
    return json({ ok: false, error: "rpc_failed", details: summarizeSupabaseError(rpc) }, rpc.status || 500);
  }

  const row = normalizeRpcValue(rpc.data);
  if (!row?.ok) {
    const err = row?.err || "submit_failed";
    const status = err === "rate_limited_email" ? 429 : 422;
    return json({ ok: false, error: err }, status);
  }

  const ticket = row.ticket_number;
  const msgId = row.message_id;
  const safeLang = normalizeLang(lang);

  // Save form attachments
  if (msgId && Array.isArray(formAttachments) && formAttachments.length) {
    for (const att of formAttachments.slice(0, 5)) {
      try {
        const filename = String(att.filename || "file").replace(/[^\w.\-]/g, "_").slice(0, 100);
        const mimeType = String(att.mime_type || "application/octet-stream");
        const data_b64 = String(att.data_b64 || "");
        if (!data_b64) continue;
        const size = Math.round(data_b64.length * 0.75);
        if (size > 5 * 1024 * 1024) continue;
        const objectKey = `form_${msgId}_${filename}`;
        const storagePath = `message-attachments/${objectKey}`;
        await uploadToStorage(env, storagePath, data_b64, mimeType);
        await supabaseRpc(env, "save_attachment", {
          p_message_id: msgId, p_filename: filename, p_mime_type: mimeType,
          p_size: size, p_storage_path: storagePath, p_inline: false,
        });
      } catch (err) {
        console.error("[contact] attachment upload failed:", err);
      }
    }
  }

  // Send confirmation email
  try {
    const { subject: confirmSubject, html } = await buildContactEmail({
      type: "confirmation",
      lang: safeLang,
      ticket,
      subject: String(subject || "").trim(),
      message: String(message || "").trim(),
    });
    
    const emailText = htmlToPlainTextPreview(html);

    // cooldown_action_key/cooldown_target_key: wymagane przez trigger na
    // mail_queue (ujednolicenie cooldownów, migracja 289) -- "contact:
    // confirmation" ma enforce=false w mail_cooldown_policies (ten mail
    // ma już własny rate-limit wyżej, w save_form_message), więc trigger
    // nie rezerwuje tu niczego -- wymaga tylko ROZPOZNANEGO action_key.
    const toEmailNorm = String(email || "").trim().toLowerCase();
    await supabaseRequest(env, "/rest/v1/mail_queue", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        to_email: toEmailNorm,
        subject: confirmSubject,
        html: html,
        text: emailText,
        from_email: "no-reply@familijna.app",
        meta: { type: "contact_confirmation", ticket },
        contact_message_id: msgId,
        cooldown_action_key: "contact:confirmation",
        cooldown_target_key: `email:${toEmailNorm}`,
      },
    });
  } catch (err) {
    console.error("[worker] contact: mail_queue insert failed:", err);
  }

  // Powiadomienie admina: push z bazy (trigger na messages, E29).
  return json({ ok: true, ticket_number: ticket });
}

// Limity dopisywania do zgłoszenia (KV, okno godzinowe): na adres e-mail
// i na IP (skrót SHA-256, bez zapisywania adresu IP).
const APPEND_WINDOW_S = 3600;
const APPEND_MAX_PER_EMAIL = 5;
const APPEND_MAX_PER_IP = 20;

async function claimAppendSlot(env, key, max) {
  const count = Number(await env.MAINT_KV.get(key)) || 0;
  if (count >= max) return false;
  await env.MAINT_KV.put(key, String(count + 1), { expirationTtl: APPEND_WINDOW_S });
  return true;
}

// Zgłoszenie i adres, do którego należy: adres z pierwszej wiadomości
// zgłoszenia (formularz: nadawca; zgłoszenie założone przez admina: odbiorca).
export async function findTicketOwner(env, ticket) {
  const clean = ticket.replace(/^TICKET-/, "");
  const variants = Array.from(new Set([ticket, `TICKET-${clean}`]));
  const list = variants.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",");
  const rep = await supabaseRequest(env, `/rest/v1/reports?select=id,ticket_number&ticket_number=in.(${encodeURIComponent(list)})&limit=1`);
  if (!rep.ok) return { error: true };
  const report = Array.isArray(rep.data) ? rep.data[0] : null;
  if (!report?.id) return { report: null };
  const first = await supabaseRequest(env, `/rest/v1/messages?select=direction,from_email,to_email&report_id=eq.${encodeURIComponent(report.id)}&order=created_at.asc&limit=1`);
  if (!first.ok) return { error: true };
  const msg = Array.isArray(first.data) ? first.data[0] : null;
  const owner = msg ? (msg.direction === "outbound" ? msg.to_email : msg.from_email) : "";
  return { report, owner: String(owner || "").trim().toLowerCase() };
}

export async function handleContactAppend(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  const body = await readJsonOr400(request);
  if (body instanceof Response) return body;

  const { email, ticket, message } = body || {};
  if (!email || typeof email !== "string" || !email.includes("@")) return json({ ok: false, error: "invalid_email" }, 422);
  if (!ticket || typeof ticket !== "string") return json({ ok: false, error: "missing_ticket" }, 422);
  if (!message || String(message).trim().length < 2) return json({ ok: false, error: "invalid_message" }, 422);

  const refused = await captchaRefusal(request, env, body);
  if (refused) return refused;
  const emailNorm = email.trim().toLowerCase();
  const ticketStr = ticket.trim().slice(0, 64);
  const ipHash = await sha256Hex(request.headers.get("CF-Connecting-IP") || "unknown");
  if (!await claimAppendSlot(env, `contact_append_ip:${ipHash}`, APPEND_MAX_PER_IP)
      || !await claimAppendSlot(env, `contact_append_email:${await sha256Hex(emailNorm)}`, APPEND_MAX_PER_EMAIL)) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  // Bez zapisu, gdy zgłoszenia nie ma albo adres nie jest adresem zgłoszenia
  // (ta sama odpowiedź -- nie zdradzamy, czy numer istnieje).
  const found = await findTicketOwner(env, ticketStr);
  if (found.error) return json({ ok: false, error: "rpc_failed" }, 500);
  if (!found.report || !found.owner || found.owner !== emailNorm) {
    return json({ ok: false, error: "ticket_not_found" }, 404);
  }

  const rpc = await supabaseRpc(env, "save_inbound_message", {
    p_from_email:    emailNorm,
    p_subject:       `Re: [${found.report.ticket_number}]`,
    p_body:          String(message).trim().slice(0, 5000),
    p_body_html:     null,
    p_ticket_number: found.report.ticket_number,
  });

  if (!rpc.ok) return json({ ok: false, error: "rpc_failed" }, 500);
  const row = Array.isArray(rpc.data) && rpc.data.length ? rpc.data[0] : null;
  if (!row?.report_id) return json({ ok: false, error: "ticket_not_found" }, 404);

  return json({ ok: true, ticket_number: found.report.ticket_number });
}
