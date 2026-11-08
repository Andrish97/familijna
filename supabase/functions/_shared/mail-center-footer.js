import { escapeMailText, MAIL_FOOTER_ATTRS, MAIL_LINK_ATTRS } from './mail-document.js';

const copy = {
  pl: { text: 'Zarządzaj powiadomieniami lub zrezygnuj z wiadomości e-mail.', link: 'Moje powiadomienia' },
  en: { text: 'Manage notifications or stop receiving emails.', link: 'My notifications' },
  uk: { text: 'Керуй сповіщеннями або відмовся від електронних листів.', link: 'Мої сповіщення' },
};

export function appendMailCenterFooter(html, token, lang) {
  if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw new Error('invalid_mail_center_footer');
  const language = Object.hasOwn(copy, lang) ? lang : 'pl';
  const url = `https://www.familijna.app/go/?m=${token}&lang=${language}`;
  const labels = copy[language];
  const footer = `<div data-familijna-mail-center="true" ${MAIL_FOOTER_ATTRS}>${escapeMailText(labels.text)}<br><a href="${escapeMailText(url)}" ${MAIL_LINK_ATTRS}>${escapeMailText(labels.link)}</a></div>`;
  const document = String(html || '');
  return /<\/body\s*>/i.test(document) ? document.replace(/<\/body\s*>/i, footer + '</body>') : document + footer;
}

// Repeated delivery checks receive a fresh original document, never a previous
// rendered copy; footer capabilities stay only in the outgoing transport.
export async function prepareMailDelivery(rpc, id) {
  const { data, error } = await rpc('mail_queue_delivery_context', { p_id: id });
  if (error || !data || data.ok !== true || typeof data.allowed !== 'boolean') throw new Error('mail_delivery_check_failed');
  if (!data.allowed) return { allowed: false, reason: data.reason || 'skipped_source' };
  if (typeof data.to_email !== 'string' || !data.to_email.includes('@') || typeof data.subject !== 'string' || typeof data.html !== 'string' || typeof data.verification !== 'boolean') throw new Error('invalid_mail_delivery_context');
  const lang = data.html.match(/<html\b[^>]*\blang=["'](pl|en|uk)["']/i)?.[1] || 'pl';
  const html = data.verification ? data.html : appendMailCenterFooter(data.html, data.footer_token, lang);
  // Rebuild the plain alternative from the actual sent HTML, including footer.
  const text = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, url, label) => `${label} (${url})`)
    .replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return { allowed: true, to: data.to_email, subject: data.subject, html, text };
}
