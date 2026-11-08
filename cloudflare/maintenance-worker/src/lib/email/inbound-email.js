// src/lib/inbound-email.js -- Cloudflare Email Routing inbound handler + MIME parsing.
import { normalizeE2ERecipient } from "../e2e/e2e-api.js";
import { isE2EPlusAddress, e2eIdentityName } from "../e2e/e2e-lease.js";
import { supabaseRequest, supabaseRpc, summarizeSupabaseError, normalizeRpcValue } from "../core/supabase.js";
import { uploadToStorage, safeStorageName } from "../core/storage.js";
import { getTelegramConfig, sendTelegram, claimNotifySlot } from "../notifications/telegram.js";
import { findTicketOwner } from "./contact.js";
import { recordMarketingReactions } from "./marketing-reactions.js";
import { htmlToPlainTextPreview } from "./html-to-text.js";

export function decodeMimeWords(str) {
  if (!str || typeof str !== "string") return str || "";
  // Whitespace between two adjacent encoded-words is part of the encoding, not content
  const joined = str.replace(/(\?=)[ \t]+(=\?)/g, "$1$2");
  return joined.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (match, charset, enc, text) => {
    try {
      let bytes;
      if (enc.toLowerCase() === "b") {
        const bin = atob(text.replace(/\s+/g, ""));
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        const hexDecoded = text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
        bytes = new Uint8Array(hexDecoded.length);
        for (let i = 0; i < hexDecoded.length; i++) bytes[i] = hexDecoded.charCodeAt(i);
      }
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      return match;
    }
  });
}

// Gdyby Cloudflare podał adres bez części +detail (e2e@), adresat z nagłówka To.
function inboundRecipient(message) {
  const to = String(message.to || "").trim();
  if (!/^e2e@familijna\.app$/i.test(to)) return to;
  const header = String(message.headers?.get?.("to") || "");
  const match = header.match(/e2e\+[a-z]+[0-9]{2}(?:\.new)?@familijna\.app/i);
  return match ? match[0] : to;
}

export async function handleInboundEmail(message, env) {
  const from    = message.from || "";
  const recipient = normalizeE2ERecipient(inboundRecipient(message));
  // E25: jedna reguła Cloudflare e2e@ (+ Subaddressing) -- przyjmujemy tylko
  // adresy znanych tożsamości testowych; reszta e2e+ odrzucona, nigdy do admina.
  if (!recipient && /^e2e(\+[^@]*)?@familijna\.app$/i.test(String(message.to || "").trim())) {
    message.setReject?.("Unknown test address");
    return;
  }
  if (recipient && isE2EPlusAddress(recipient) && !(await e2eIdentityName(env, recipient))) {
    console.log("[e2e-email] rejected unknown identity");
    message.setReject?.("Unknown test address");
    return;
  }
  // Envelope sender, not visible From/To headers. Keep exact test destinations
  // in the test mailbox; our provider's technical copies are not admin mail.
  if (!recipient && /^bounce\+[a-z0-9_-]+@bounce-zem\.familiada\.online$/i.test(from.trim())) {
    console.log("[email] ignored own provider technical copy");
    return;
  }
  const subject = decodeMimeWords(message.headers.get("subject") || "");

  // Parse body from raw MIME stream
  let body = "";
  let bodyHtml = null;
  let inboundAttachments = [];
  try {
    const rawText = await new Response(message.raw).text();
    console.log("[email] raw length:", rawText.length);
    const parts = extractMimeParts(rawText);
    console.log("[email] parsed:", { textLen: parts.text?.length, htmlLen: parts.html?.length, attCount: parts.attachments?.length });
    // HTML-only mail still needs a text body for persistence and previews.
    body = parts.text || htmlToPlainTextPreview(parts.html, 5000);
    bodyHtml = parts.html || null;
    inboundAttachments = parts.attachments || [];
  } catch (err) {
    console.error("[email] body parse failed:", err);
  }
  body = body.slice(0, 5000).trim();
  if (bodyHtml) bodyHtml = bodyHtml.slice(0, 200000);

  // Dokladne reguly Cloudflare kieruja konta testowe tutaj. Te wiadomosci
  // sa test fixtures: nie trafiaja do skrzynki admina, Telegrama ani na
  // prywatny forwarding. Pozostale maile zachowuja dotychczasowy przebieg.
  if (recipient) {
    const saved = await supabaseRequest(env, "/rest/v1/e2e_emails", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        recipient,
        from_email: from || null,
        subject: subject.slice(0, 500),
        body: body.slice(0, 5000).trim(),
        body_html: bodyHtml,
      },
    });
    if (!saved.ok) {
      console.error("[e2e-email] save failed:", summarizeSupabaseError(saved));
      throw new Error("e2e_email_save_failed");
    }
    console.log("[e2e-email] saved for", recipient);
    return;
  }

  // Forward copy to iCloud (best-effort)
  const forwardTo = env.FORWARD_EMAIL || "";
  if (forwardTo) {
    try { await message.forward(forwardTo); } catch (err) {
      console.error("[email] forward failed:", err);
    }
  }

  // Detect ticket number in subject: [TICKET-YYYY-NNNN] or [YYYY-NNNN].
  // Dopięcie do zgłoszenia tylko od adresu zgłoszenia (jak /_api/contact/
  // append; audyt E24, N6). Inny nadawca -> skrzynka bez zgłoszenia.
  const ticketMatch = subject.match(/\[(?:TICKET-)?(\d{4}-\d{4})\]/i);
  const ticketArg = ticketMatch ? await ticketForSender(env, ticketMatch[1], from) : null;

  // Reakcja odbiorcy na mail marketingowy: nadawca (albo adresat zwrotki)
  // dopasowany do kontaktu Lead Findera. Dodatkowo, jak dotąd, podobny temat.
  let isReplyToMarketing = false;
  try {
    isReplyToMarketing = await recordMarketingReactions(env, { from, subject, body });
  } catch (err) {
    console.error("[email] marketing reaction failed:", err);
  }
  const cleanSubject = subject.replace(/^(Re|Fwd|FW):\s*/gi, '').trim().toLowerCase();
  if (cleanSubject && !isReplyToMarketing) {
    try {
      // Check if any existing marketing email has similar subject
      const checkRes = await supabaseRequest(env, `/rest/v1/messages?select=id&direction=eq.outbound&is_marketing=eq.true&subject=ilike.%${cleanSubject}%&limit=1`, { method: "GET" });
      if (checkRes.ok && Array.isArray(checkRes.data) && checkRes.data.length > 0) {
        isReplyToMarketing = true;
        console.log("[email] Reply to marketing detected:", subject);
      }
    } catch (err) {
      console.error("[email] marketing check failed:", err);
    }
  }

  if (!from || (!body && !inboundAttachments.length)) {
    console.log("[email] skipping - no from or body, body:", body?.slice(0, 100), "attachments:", inboundAttachments.length);
    return;
  }

  let finalBody = body || "";
  if (!finalBody && inboundAttachments.length > 0) {
    const names = inboundAttachments.map(a => a.filename).join(", ");
    finalBody = `(Wiadomość zawiera tylko załączniki: ${names})`;
  } else if (!finalBody) {
    finalBody = "(brak treści)";
  }

  console.log("[email] saving:", { from, subject: subject.slice(0, 50), bodyLen: finalBody.length, htmlLen: bodyHtml?.length || 0 });
  const rpc = await supabaseRpc(env, "save_inbound_message", {
    p_from_email:    from,
    p_subject:       subject.slice(0, 500),
    p_body:          finalBody,
    p_body_html:     bodyHtml,
    p_ticket_number: ticketArg,
  });

  // If this is a reply to marketing, mark it as marketing
  if (rpc.ok && isReplyToMarketing) {
    const msgRow = Array.isArray(rpc.data) && rpc.data.length ? rpc.data[0] : null;
    const msgId = msgRow?.id;
    if (msgId) {
      try {
        await supabaseRequest(env, `/rest/v1/messages?id=eq.${encodeURIComponent(msgId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: { is_marketing: true },
        });
        console.log("[email] Marked reply as marketing:", msgId);
      } catch (err) {
        console.error("[email] marketing mark failed:", err);
      }
    }
  }

  if (rpc.ok) {
    const msgRow = Array.isArray(rpc.data) && rpc.data.length ? rpc.data[0] : null;
    const msgId = msgRow?.id;
    if (msgId && inboundAttachments.length) {
      for (const att of inboundAttachments) {
        try {
          const objectKey = `inbound_${msgId}_${safeStorageName(att.filename)}`;
          const storagePath = `message-attachments/${objectKey}`;
          await uploadToStorage(env, storagePath, att.data_b64, att.mimeType);
          const saveRes = await supabaseRpc(env, "save_attachment", {
            p_message_id: msgId,
            p_filename:   att.filename,
            p_mime_type:  att.mimeType,
            p_size:       att.size,
            p_storage_path: storagePath,
            p_content_id: att.cid || null,
            p_inline:     att.inline,
          });
          if (!saveRes.ok) {
            console.error("[email] save_attachment failed:", att.filename, summarizeSupabaseError(saveRes));
          }
        } catch (err) {
          console.error("[email] attachment_upload_failed:", att.filename, err);
        }
      }
    }
  }

  if (!rpc.ok) {
    console.error("[email] save_inbound_message failed:", summarizeSupabaseError(rpc));
    return;
  }

  const row = Array.isArray(rpc.data) && rpc.data.length ? rpc.data[0] : normalizeRpcValue(rpc.data);
  const savedTicket = row?.ticket_number || null;

  // Notify admin via Telegram (best-effort, rate-limited)
  try {
    const tg = getTelegramConfig(env);
    if (tg && await claimNotifySlot(env, "notify_email_ts")) {
      const label = savedTicket ? `#${savedTicket}` : "(nowe)";
      await sendTelegram(tg, `📧 Familijna — nowy email\nWiadomość ${label} od ${from}`);
    }
  } catch {}
}

export function decodeCharsetBytes(bytes, charset) {
  try {
    return new TextDecoder(charset).decode(bytes);
  } catch {
    try { return new TextDecoder("utf-8").decode(bytes); } catch { return null; }
  }
}

export function decodeMimePart(part, content) {
  const charsetMatch = part.match(/charset=\"?([^\"\r\n;]+)\"?/i);
  const charset = charsetMatch ? charsetMatch[1].trim().toLowerCase() : "utf-8";

  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(part)) {
    const latin = content.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    const bytes = new Uint8Array(latin.length);
    for (let i = 0; i < latin.length; i++) bytes[i] = latin.charCodeAt(i);
    return decodeCharsetBytes(bytes, charset) ?? latin;
  }
  if (/Content-Transfer-Encoding:\s*base64/i.test(part)) {
    try {
      const latin = atob(content.replace(/\s+/g, ""));
      const bytes = new Uint8Array(latin.length);
      for (let i = 0; i < latin.length; i++) bytes[i] = latin.charCodeAt(i);
      const decoded = decodeCharsetBytes(bytes, charset);
      if (decoded !== null) return decoded;
    } catch {}
  }
  return content;
}

export function unfoldHeaderBlock(s) {
  return s.replace(/\r\n[ \t]/g, " ").replace(/\n[ \t]/g, " ");
}

export function findMultipartBoundary(unfoldedHeaderBlock) {
  if (!/Content-Type:\s*multipart\//i.test(unfoldedHeaderBlock)) return null;
  const m = unfoldedHeaderBlock.match(/boundary\s*=\s*"?([^"\r\n;]+)"?/i);
  return m ? m[1].trim() : null;
}

export function splitHeadersAndBody(part) {
  let idx = part.indexOf("\r\n\r\n");
  if (idx !== -1) return { headers: part.slice(0, idx), body: part.slice(idx + 4) };
  idx = part.indexOf("\n\n");
  if (idx !== -1) return { headers: part.slice(0, idx), body: part.slice(idx + 2) };
  return null;
}

export function guessBoundaryFromBody(raw) {
  const counts = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^--([!-~]{8,}?)(?:--)?$/);
    if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best = null, bestCount = 1;
  for (const [token, count] of counts) {
    if (count > bestCount) { best = token; bestCount = count; }
  }
  return best;
}

export function extractMimeParts(raw) {
  const textParts = [];
  const htmlParts = [];
  const attachments = [];
  const cidMap = {};

  function parseLevel(content, boundary) {
    if (!boundary) return;
    const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rawParts = content.split(new RegExp(`--${escaped}(?:\r?\n|--)`, "")).slice(1);

    for (const rawPart of rawParts) {
      if (rawPart.trim() === "" || rawPart.trim() === "--") continue;

      const split = splitHeadersAndBody(rawPart);
      if (!split) continue;

      const headers = unfoldHeaderBlock(split.headers);
      let body = split.body;
      // Remove trailing CRLF if present before the next boundary
      if (body.endsWith("\r\n")) body = body.slice(0, -2);

      const ctMatch = headers.match(/Content-Type:\s*([^;\r\n]+)/i);
      const mimeType = ctMatch ? ctMatch[1].trim().toLowerCase() : "application/octet-stream";

      const subBoundary = findMultipartBoundary(headers);
      if (subBoundary && mimeType.startsWith("multipart/")) {
        parseLevel(body, subBoundary);
        continue;
      }

      const dispMatch = headers.match(/Content-Disposition:\s*(attachment|inline)/i);
      const cidMatch = headers.match(/Content-ID:\s*<([^>]+)>/i);
      const fnMatch = headers.match(/filename\*?=(?:.*?'')?["']?([^"'\r\n;]+)["']?/i);
      const isB64 = /Content-Transfer-Encoding:\s*base64/i.test(headers);
      const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(headers);

      if (mimeType === "text/plain" && !dispMatch) {
        textParts.push(decodeMimePart(headers, body).trim());
      } else if (mimeType === "text/html" && !dispMatch) {
        htmlParts.push(decodeMimePart(headers, body).trim());
      } else {
        // Attachment or Inline
        const isAttachment = dispMatch || cidMatch || (mimeType.startsWith("image/") && !textParts.length && !htmlParts.length);
        if (isAttachment) {
          const b64 = isB64
            ? body.replace(/\s+/g, "")
            : btoa(String.fromCharCode(...new TextEncoder().encode(isQP ? decodeMimePart(headers, body) : body)));

          const filename = fnMatch ? decodeURIComponent(fnMatch[1].trim()) : `attachment_${Date.now()}_${attachments.length}`;
          const cid = cidMatch ? cidMatch[1] : null;
          if (cid) cidMap[cid] = `data:${mimeType};base64,${b64}`;

          attachments.push({
            filename,
            mimeType,
            data_b64: b64,
            cid,
            inline: !!cidMatch,
            size: Math.round(b64.length * 0.75)
          });
        }
      }
    }
  }

  // Independent safety net: if the declared Content-Type/boundary pair
  // couldn't be found (or found but yielded nothing), look directly for a
  // repeated "--token" delimiter line in the body. This catches whatever
  // we failed to anticipate in the header - it's the same delimiter the
  // sender actually used to split parts, detected structurally instead of
  // by trusting our header regex.
  const topBoundary = findMultipartBoundary(unfoldHeaderBlock(raw)) || guessBoundaryFromBody(raw);
  if (topBoundary) {
    parseLevel(raw, topBoundary);
    let html = htmlParts.join("\n");
    if (html && Object.keys(cidMap).length) {
      for (const [cid, dataUri] of Object.entries(cidMap)) {
        html = html.split(`cid:${cid}`).join(dataUri);
      }
    }
    if (textParts.length || htmlParts.length || attachments.length) {
      return { text: textParts.join("\n"), html, attachments };
    }
    // Boundary was declared but nothing came out of it (e.g. a deeper
    // parsing mismatch) - fall through to the non-multipart path below
    // rather than silently returning an empty message.
  }

  // Non-multipart (or multipart parsing above yielded nothing usable)
  const split = splitHeadersAndBody(raw);
  const content = split ? split.body.trim() : "";
  const headers = unfoldHeaderBlock(split?.headers || "");
  const decoded = decodeMimePart(headers, content);
  const mimeType = headers.match(/^Content-Type:\s*([^;\r\n]+)/im)?.[1].trim().toLowerCase();
  // text/html may contain only a fragment (<div>, <p>...), with no <html>.
  // An explicit text/plain remains text, even when it describes HTML code.
  const isHtml = mimeType === "text/html" || (!mimeType && /^\s*(?:<!doctype\s+html|<html(?:\s|>))/i.test(decoded));
  return { text: isHtml ? "" : decoded, html: isHtml ? decoded : "", attachments: [] };
}

// Numer zgłoszenia, gdy nadawca (adres koperty) jest adresem zgłoszenia;
// w przeciwnym razie null (wiadomość trafia do skrzynki bez zgłoszenia).
export async function ticketForSender(env, ticket, from) {
  const sender = String(from || "").trim().toLowerCase();
  if (!sender) return null;
  const found = await findTicketOwner(env, ticket);
  if (found.error || !found.report || !found.owner || found.owner !== sender) {
    console.log("[email] ticket in subject not attached (sender is not ticket address)");
    return null;
  }
  return found.report.ticket_number;
}
