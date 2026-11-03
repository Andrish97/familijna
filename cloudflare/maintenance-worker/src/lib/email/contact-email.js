// src/lib/contact-email.js -- contact form email templates (teksty z tłumaczeń strony).
import { renderRichMailDocument, MAIL_QUOTE_ATTRS } from "./mail-document.js";
import { escEmailText as esc, nl2br } from "./html-escape.js";
import { normalizeLang } from "../core/utils.js";
import { formatText, getTranslationSection } from "../core/translations.js";

export async function buildContactEmail(opts) {
  const { type, lang = "pl", ticket, subject, message, originalMessage, replyMessage } = opts;

  // Teksty: sekcja contactEmail w translation/<lang>/server.js (pobierana z originu).
  const tr = await getTranslationSection(normalizeLang(lang), "contactEmail");
  const vars = { ticket: ticket || "", subject: subject || "" };
  const c = {
    greeting: tr.greeting,
    closing: tr.closing,
    confirmation: {
      body: formatText(tr.confirmationBody, vars),
      quote: message || "",
      mailSubject: formatText(tr.confirmationSubject, vars),
    },
    reply: {
      quoteLabel: formatText(tr.replyQuoteLabel, vars),
      mailSubject: formatText(tr.replySubject, vars),
    },
    compose: {
      mailSubject: subject || tr.composeSubject,
    },
  };

  let mailSubject = "";
  let contentHtml = "";

  if (type === "confirmation") {
    mailSubject = c.confirmation.mailSubject;
    contentHtml = `
      <p style="margin:0 0 20px">${nl2br(c.confirmation.body)}</p>
      ${c.confirmation.quote ? `<blockquote ${MAIL_QUOTE_ATTRS}><div style="white-space:pre-wrap">${esc(c.confirmation.quote)}</div></blockquote>` : ""}
    `;
  } else if (type === "reply") {
    mailSubject = c.reply.mailSubject;
    contentHtml = `
      ${originalMessage ? `<blockquote ${MAIL_QUOTE_ATTRS}><strong>${esc(c.reply.quoteLabel)}</strong><br><br><span style="white-space:pre-wrap">${esc(originalMessage)}</span></blockquote>` : ""}
      <p style="margin:0">${nl2br(replyMessage || "")}</p>
    `;
  } else {
    // compose
    mailSubject = c.compose.mailSubject;
    contentHtml = `
      ${opts.reply_as ? `<blockquote ${MAIL_QUOTE_ATTRS}><div style="white-space:pre-wrap">${esc(opts.reply_as)}</div></blockquote>` : ""}
      <p style="margin:0">${nl2br(message || "")}</p>
    `;
  }

  const closingLines = c.closing.split("\n");

  const html = renderRichMailDocument({ lang: normalizeLang(lang), title: mailSubject,
    subtitle: "familijna.app",
    bodyHtml: `<p style="margin:0 0 18px;">${esc(c.greeting)}</p>${contentHtml}<p style="margin:24px 0 0;">${closingLines.map(esc).join("<br>")}</p>`,
  });

  return { subject: mailSubject, html };
}
