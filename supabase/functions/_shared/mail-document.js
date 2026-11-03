// Wspólny dokument maila. Nagłówki i linki są zwykłym tekstem.
// Treść ma osobne wejścia dla tekstu i jawnego HTML edytora.
export function escapeMailText(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function mailHref(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid mail link protocol');
  return url.href;
}
// Wygląd (decyzja 2026-11-03, familijna-server/docs/jasny-motyw-plan.md):
// jasny w stylach inline, ciemny przez @media (prefers-color-scheme: dark)
// w programach, które to obsługują (klasy fm-*; !important wygrywa z inline).
const MAIL_DARK_CSS = ':root{color-scheme:light dark;supported-color-schemes:light dark}'
  + '@media (prefers-color-scheme: dark){'
  + '.fm-body{background:#050914!important;color:#ffffff!important}'
  + '.fm-text{color:#ffffff!important}'
  + '.fm-head{background:#0b1020!important;border-color:#293044!important}'
  + '.fm-brand,.fm-title,.fm-link{color:#ffeaa6!important}'
  + '.fm-sub,.fm-note{color:#bbc2d1!important}'
  + '.fm-card{background:#111827!important;border-color:#303747!important}'
  + '.fm-btn{background:#2a2b1a!important;border-color:#817447!important;color:#ffeaa6!important}'
  + '.fm-url{background:#0a0f1e!important;border-color:#303747!important}'
  + '.fm-foot{color:#a6adbc!important}'
  + '.fm-quote{background:#0a0f1e!important;border-color:#5f5838!important;color:#b8bcc6!important}'
  + '}';
// Cytat w treści maila (kontakt: zgłoszenie, odpowiedź) — ten sam wygląd wszędzie.
export const MAIL_QUOTE_ATTRS = 'class="fm-quote" style="margin:0 0 20px;padding:12px 16px;border-left:3px solid #d8c48f;background:#f6f4ee;border-radius:0 8px 8px 0;color:#4a5060;font-size:13px;"';
// Stopka centrum powiadomień (mail-center-footer.js).
export const MAIL_FOOTER_ATTRS = 'class="fm-foot" style="margin:14px auto;padding:0 16px;max-width:560px;text-align:center;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:11px;line-height:1.5;color:#6b7180;"';
export const MAIL_LINK_ATTRS = 'class="fm-link" style="color:#7a5400;text-decoration:underline;"';
function renderDocument({ lang, title, subtitle = '', actionLabel = '', actionUrl = '',
  ignoreNote = '', linkHint = '', autoNote = '', footerText = '', footerLinks = [], source = '' }, bodyMarkup) {
  if (!['pl', 'en', 'uk'].includes(lang)) throw new Error('Unsupported mail language');
  if (!!actionLabel !== !!actionUrl) throw new Error('Mail action requires both a label and URL');
  const href = actionUrl ? mailHref(actionUrl) : '', esc = escapeMailText;
  const text = value => esc(value).replace(/\r?\n/g, '<br>');
  const links = footerLinks.map(link => `<a href="${esc(mailHref(link.url))}" ${MAIL_LINK_ATTRS}>${esc(link.label)}</a>`).join(' &nbsp;·&nbsp; ');
  return `<!doctype html>
<html lang="${lang}"><head>
<meta charset="utf-8">${source ? `\n<meta name="familijna-i18n" content="${esc(source)}">` : ''}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<style>${MAIL_DARK_CSS}</style>
</head><body class="fm-body" style="margin:0;padding:0;background:#f3f0e8;color:#161b28;">
<div class="fm-text" style="max-width:560px;margin:0 auto;padding:26px 16px;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#161b28;overflow-wrap:anywhere;word-break:break-word;">
 <div class="fm-head" style="padding:14px;background:#ffffff;border:1px solid #e2ddd1;border-radius:18px;">
  <div class="fm-brand" style="font-weight:800;letter-spacing:.18em;color:#7a5400;">FAMILIJNA</div>
  ${subtitle ? `<div class="fm-sub" style="margin-top:6px;font-size:12px;color:#5b6170;">${esc(subtitle)}</div>` : ''}
 </div>
 <div class="fm-card" style="margin-top:14px;padding:18px;border-radius:20px;border:1px solid #e2ddd1;background:#ffffff;">
  <h1 class="fm-title" style="font-weight:800;font-size:18px;color:#7a5400;margin:0 0 10px;">${esc(title)}</h1>
  <div style="font-size:14px;line-height:1.5;margin:0 0 14px;">${bodyMarkup}</div>
  ${href ? `<div style="margin:16px 0;"><a class="fm-btn" href="${esc(href)}" style="display:block;text-align:center;padding:12px 14px;border-radius:14px;border:1px solid #c9a95a;background:#fbf3dc;color:#6b4a00;text-decoration:none;font-weight:800;">${esc(actionLabel)}</a></div>` : ''}
  ${ignoreNote ? `<div class="fm-note" style="margin-top:14px;font-size:12px;color:#5b6170;line-height:1.5;">${text(ignoreNote)}</div>` : ''}
  ${href ? `<div class="fm-note" style="margin-top:14px;font-size:12px;color:#5b6170;line-height:1.5;">
   ${esc(linkHint)}<div class="fm-url" style="margin-top:6px;padding:10px 12px;border-radius:14px;border:1px solid #e2ddd1;background:#f6f4ee;word-break:break-all;">${esc(href)}</div>
  </div>` : ''}
 </div>
 ${autoNote ? `<div class="fm-foot" style="margin-top:14px;font-size:12px;color:#6b7180;text-align:center;">${text(autoNote)}</div>` : ''}
 ${footerText || links ? `<div class="fm-foot" style="margin-top:10px;font-size:11px;line-height:1.5;color:#6b7180;text-align:center;">${text(footerText)}${footerText && links ? '<br>' : ''}${links}</div>` : ''}
</div></body></html>`;
}

export function renderMailDocument(options) {
  return renderDocument(options, escapeMailText(options.body).replace(/\r?\n/g, '<br>'));
}
// HTML wytworzony przez edytor wiadomości lub escapowane bloki cytatów.
// Pozostałe pola (tytuł, podpisy, linki) są nadal zwykłym tekstem.
export function renderRichMailDocument(options) {
  return renderDocument(options, String(options.bodyHtml || ''));
}
