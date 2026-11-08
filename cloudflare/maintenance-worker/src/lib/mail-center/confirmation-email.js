import { renderMailDocument } from '../email/mail-document.js';
import { normalizeLang } from '../core/utils.js';

const COPY = {
  pl: { title: 'Moje powiadomienia w Familijnej', body: 'Otwórz centrum, aby zarządzać swoimi subskrypcjami, zaproszeniami i powiadomieniami. Link jest ważny przez 15 minut.', action: 'Otwórz moje powiadomienia', ignore: 'Jeśli nie proszono o ten link, możesz pominąć tę wiadomość.', footer: 'Powiadomienia i rezygnacja' },
  en: { title: 'My Familijna notifications', body: 'Open the center to manage your subscriptions, invitations and notifications. This link is valid for 15 minutes.', action: 'Open my notifications', ignore: 'If you did not request this link, you can ignore this email.', footer: 'Notifications and unsubscribe' },
  uk: { title: 'Мої сповіщення у Familijna', body: 'Відкрий центр, щоб керувати підписками, запрошеннями та сповіщеннями. Посилання дійсне протягом 15 хвилин.', action: 'Відкрити мої сповіщення', ignore: 'Якщо запит на це посилання надійшов не від тебе, можеш пропустити цей лист.', footer: 'Сповіщення та відмова' },
};
export function buildMailCenterConfirmation(lang) {
  lang = normalizeLang(lang);
  const copy = COPY[lang];
  const url = 'https://www.familijna.app/go/?m=MAIL_CENTER_ACCESS_TOKEN';
  // The private queue transaction replaces this marker with the verification
  // capability. Its footer shares the same single-use proof and deadline.
  return { subject: copy.title, html: renderMailDocument({ lang, title: copy.title,
    body: copy.body, actionLabel: copy.action, actionUrl: url, ignoreNote: copy.ignore,
    footerLinks: [{ url, label: copy.footer }], source: 'mailCenterEmail.confirmation' }) };
}
