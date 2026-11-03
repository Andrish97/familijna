// Maile powiadomień z szablonów serwera (send-mail) muszą być identyczne
// z dokumentami, które dotąd budowała przeglądarka. Wzorzec niżej to wierna
// kopia dawnych budowniczych z invite-mail.js, poll-mail.js, bases.js
// i shareDevice.js (z prawdziwym t() na pełnych słownikach PL/EN/UK).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { renderMailDocument } from '../../supabase/functions/_shared/mail-document.js';
import { buildNotificationMail } from '../../supabase/functions/_shared/notification-mail.js';
import { buildTexts, renderModule, TARGET } from '../../scripts/sync-notification-mail-texts.mjs';
import { loadDict } from "./helpers/i18n.js";

const ORIGIN = 'https://www.familijna.app';
const dicts = {};
for (const lang of ['pl', 'en', 'uk']) dicts[lang] = await loadDict(lang);
// t() jak w web/shared/translation/translation.js
const tFor = (lang) => (key, vars = {}) => {
  const value = key.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : undefined), dicts[lang]);
  if (value == null) return key;
  if (typeof value === 'function') return value(vars);
  return String(value).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
};
const withLang = (path, lang) => { const u = new URL(path, ORIGIN); u.searchParams.set('lang', lang || 'pl'); return u.href; };
const TOKEN = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
const UNSUB = '11111111-2222-4333-8444-555555555555';
const SUB = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const GAME = '12345678-1234-4234-8234-123456789abc';

// --- dawne budowniczowie (przeglądarka) ---
function legacyInvite(t, lang, { to, link, ownerLabel, unsubToken = null, kind, reminder = false }) {
  const friend = kind === 'friend';
  const subject = reminder ? t(friend ? 'sharingMail.friendReminderSubject' : 'sharingMail.subscriberReminderSubject', { owner: ownerLabel }) : friend ? t('contacts.mail.friendTitle', { owner: ownerLabel }) : t('pollsHubSubscriptions.mail.subscriptionTitle', { owner: ownerLabel });
  const isRegistered = friend;
  const footerLinks = isRegistered
    ? [{ url: withLang('/account/', lang), label: t('pollGo.mailAccountSettingsLink') }]
    : unsubToken ? [{ url: withLang(`/go/?u=${encodeURIComponent(unsubToken)}`, lang), label: t('pollGo.mailUnsubGlobal') }] : [];
  const html = renderMailDocument({ lang, title: subject, subtitle: t('pollsHubSubscriptions.mail.subtitle'),
    body: reminder ? t(friend ? 'sharingMail.friendReminderBody' : 'sharingMail.subscriberReminderBody', { owner: ownerLabel }) : friend ? t('contacts.mail.friendBody', { owner: ownerLabel }) : t('pollsHubSubscriptions.mail.subscriptionBody', { owner: ownerLabel }),
    actionLabel: friend ? t('contacts.mail.friendAction') : t('pollsHubSubscriptions.mail.subscriptionAction'), actionUrl: withLang(link, lang),
    ignoreNote: t('pollsHubSubscriptions.mail.ignoreNote'), linkHint: t('pollsHubSubscriptions.mail.linkHint'), autoNote: t('pollsHubSubscriptions.mail.autoNote'),
    footerText: isRegistered ? t('pollGo.mailAccountSettings') : '', footerLinks });
  return { subject, html };
}
function legacyCopy(t, lang, { link, ownerLabel, name, kind }) {
  const label = kind === 'logo' ? t('resourceSend.logo') : t('resourceSend.game');
  const subject = t('sharingMail.copySubject', { owner: ownerLabel });
  const html = renderMailDocument({ lang, title: subject, subtitle: t('pollsHubSubscriptions.mail.subtitle'),
    body: t('resourceSend.mailBody', { owner: ownerLabel, name, kind: label }), actionLabel: t('resourceSend.mailAction'), actionUrl: withLang(link, lang),
    ignoreNote: t('pollsHubSubscriptions.mail.ignoreNote'), linkHint: t('pollsHubSubscriptions.mail.linkHint'), autoNote: t('pollsHubSubscriptions.mail.autoNote'),
    footerText: t('pollGo.mailAccountSettings'), footerLinks: [{ url: withLang('/account/', lang), label: t('pollGo.mailAccountSettingsLink') }] });
  return { subject, html };
}
function legacyPoll(t, lang, { item, pollName, ownerName, unsubInfo, reminder }) {
  const ownerLabel = ownerName || t('pollsHubPolls.ownerFallback');
  const name = pollName || t('pollsHubPolls.pollFallback');
  const safeName = pollName ? t('pollsHubPolls.pollNameLabel', { name: pollName }) : t('pollsHubPolls.pollFallback');
  const isRegistered = !unsubInfo, subToken = unsubInfo?.sub_token || null, unsubToken = unsubInfo?.unsub_token || null;
  const footerLinks = [];
  if (isRegistered) footerLinks.push({ url: withLang('/account/', lang), label: t('pollGo.mailAccountSettingsLink') });
  else {
    if (subToken) footerLinks.push({ url: withLang(`/go/?s=${encodeURIComponent(subToken)}&action=unsub`, lang), label: t('pollGo.mailUnsubOwner', { owner: ownerLabel || '' }) });
    if (unsubToken) footerLinks.push({ url: withLang(`/go/?u=${encodeURIComponent(unsubToken)}`, lang), label: t('pollGo.mailUnsubGlobal') });
  }
  const subject = reminder ? t('polls.share.mailReminderSubject', { name }) : t('pollsHubPolls.mail.taskSubject', { name });
  const html = renderMailDocument({ lang, title: reminder ? t('polls.share.mailReminderTitle') : t('pollsHubPolls.mail.taskTitle'),
    subtitle: t('pollsHubPolls.mail.subtitle'),
    body: t(reminder ? 'sharingMail.pollReminderBody' : 'pollsHubPolls.mail.taskBody', { owner: ownerLabel, name: safeName }),
    actionLabel: t('pollsHubPolls.mail.taskAction'), actionUrl: withLang(item.link, lang),
    ignoreNote: t('pollsHubPolls.mail.ignoreNote'), linkHint: t('pollsHubPolls.mail.linkHint'), autoNote: t('pollsHubPolls.mail.autoNote'),
    footerText: isRegistered ? t('pollGo.mailAccountSettings') : '', footerLinks });
  return { subject, html };
}
function legacyBase(t, lang, { link, baseName, ownerLabel, role, reminder }) {
  const html = renderMailDocument({ lang, title: t(reminder ? 'sharingMail.baseReminderTitle' : 'bases.mail.title'),
    body: t(reminder ? 'sharingMail.baseReminderBody' : 'sharingMail.baseBody', { owner: ownerLabel || '—', base: baseName || '—', role: t(`sharingMail.${role}`) }),
    actionLabel: t('sharingMail.baseAction'), actionUrl: withLang(link, lang),
    subtitle: t('bases.mail.subtitle'), ignoreNote: t('bases.mail.footer'), linkHint: t('bases.mail.linkLabel'),
    autoNote: t('pollsHubSubscriptions.mail.autoNote'), footerText: t('pollGo.mailAccountSettings'),
    footerLinks: [{ url: withLang('/account/', lang), label: t('pollGo.mailAccountSettingsLink') }] });
  return { subject: t(reminder ? 'sharingMail.baseReminderSubject' : 'bases.mail.subject', { base: baseName || '—' }), html };
}
function legacyDevice(t, lang, { ownerLabel, deviceType, gameId, gameName, shareKey, isRegistered }) {
  const typeLabel = t(`control.shareDeviceModal.${{ host: 'typeHost', buzzer: 'typeBuzzer', display: 'typeDisplay' }[deviceType]}`);
  const subject = t('control.shareDeviceModal.mailSubject', { type: typeLabel });
  const body = t('control.shareDeviceModal.mailBody', { owner: ownerLabel, type: typeLabel, game: gameName || '—' });
  const html = renderMailDocument({ lang, title: subject, body,
    // Dawny przycisk wołał t() bez {type} („Otwórz: {type}”); szablon serwera wstawia typ.
    actionLabel: t('control.shareDeviceModal.openDevice', { type: typeLabel }),
    actionUrl: withLang(`/go/?d=${deviceType}&id=${gameId}&key=${shareKey}`, lang),
    subtitle: t('sharingMail.deviceSubtitle'), linkHint: t('pollsHubSubscriptions.mail.linkHint'), autoNote: t('pollsHubSubscriptions.mail.autoNote'),
    footerText: isRegistered ? t('pollGo.mailAccountSettings') : '',
    footerLinks: isRegistered ? [{ url: withLang('/account/', lang), label: t('pollGo.mailAccountSettingsLink') }] : [] });
  return { subject, html };
}

test('teksty maili w funkcji Edge są aktualną kopią tłumaczeń strony', async () => {
  assert.equal(fs.readFileSync(TARGET, 'utf8'), renderModule(await buildTexts()),
    'uruchom: node scripts/sync-notification-mail-texts.mjs');
});

test('szablony serwera = dawne dokumenty przeglądarki (PL/EN/UK, wszystkie rodzaje)', () => {
  const owner = 'Ala <b>&';
  for (const lang of ['pl', 'en', 'uk']) {
    const t = tFor(lang);
    const same = (actual, expected, label) => { assert.equal(actual.subject, expected.subject, `${lang} ${label} temat`); assert.equal(actual.html, expected.html, `${lang} ${label} treść`); };
    for (const reminder of [false, true]) {
      same(buildNotificationMail({ action: reminder ? 'friend:resend' : 'friend:invite', lang, data: { ownerLabel: owner, token: TOKEN } }),
        legacyInvite(t, lang, { link: `/go/?f=${TOKEN}`, ownerLabel: owner, kind: 'friend', reminder }), `friend ${reminder}`);
      for (const unsubToken of [UNSUB, null]) {
        same(buildNotificationMail({ action: 'poll:resend', lang, reminder, data: { ownerLabel: owner, token: TOKEN, unsubToken } }),
          legacyInvite(t, lang, { link: `/go/?s=${TOKEN}`, ownerLabel: owner, unsubToken, kind: 'subscriber', reminder }), `subscriber ${reminder}`);
      }
      for (const [pollName, unsubInfo] of [['Ankieta "1"', null], ['', { sub_token: SUB, unsub_token: UNSUB }], ['X', { sub_token: SUB, unsub_token: null }]]) {
        same(buildNotificationMail({ action: 'poll:share', lang, reminder, data: { ownerLabel: owner, token: TOKEN, pollName,
          subToken: unsubInfo?.sub_token || null, unsubToken: unsubInfo?.unsub_token || null, isRegistered: !unsubInfo } }),
        legacyPoll(t, lang, { item: { link: `/go/?t=${TOKEN}` }, pollName, ownerName: owner, unsubInfo, reminder }), `poll ${reminder}`);
      }
      for (const role of ['editor', 'viewer']) {
        same(buildNotificationMail({ action: 'base:share', lang, reminder, data: { ownerLabel: owner, token: TOKEN, baseName: 'Baza <1>', role } }),
          legacyBase(t, lang, { link: `/go/?b=${TOKEN}`, baseName: 'Baza <1>', ownerLabel: owner, role, reminder }), `base ${role} ${reminder}`);
      }
    }
    for (const kind of ['game', 'logo']) {
      same(buildNotificationMail({ action: 'copy:send', lang, data: { ownerLabel: owner, token: TOKEN, name: 'Gra & logo', resourceKind: kind } }),
        legacyCopy(t, lang, { link: `/go/?c=${encodeURIComponent(TOKEN)}`, ownerLabel: owner, name: 'Gra & logo', kind }), `copy ${kind}`);
    }
    for (const deviceType of ['host', 'buzzer', 'display']) for (const isRegistered of [true, false]) {
      same(buildNotificationMail({ action: 'device:share', lang, data: { ownerLabel: owner, token: TOKEN, deviceType, gameId: GAME, gameName: 'Gra', isRegistered } }),
        legacyDevice(t, lang, { ownerLabel: owner, deviceType, gameId: GAME, gameName: 'Gra', shareKey: TOKEN, isRegistered }), `device ${deviceType}`);
    }
  }
});

test('szablony odrzucają nieznaną akcję, język i rodzaj urządzenia', () => {
  assert.throws(() => buildNotificationMail({ action: 'admin:compose', lang: 'pl', data: {} }));
  assert.throws(() => buildNotificationMail({ action: 'friend:invite', lang: 'de', data: { token: TOKEN } }));
  assert.throws(() => buildNotificationMail({ action: 'device:share', lang: 'pl', data: { token: TOKEN, deviceType: 'x', gameId: GAME } }));
});

test('treść maili powiadomień bez dosłownych znaczników HTML (zgłoszenie 2026-11-03)', () => {
  const token = '0f1e2d3c-4b5a-4968-8776-5a4b3c2d1e0f';
  const cases = [
    { action: 'friend:invite', data: { ownerLabel: 'O', token } },
    { action: 'poll:resend', data: { ownerLabel: 'O', token, unsubToken: 'u' } },
    { action: 'poll:share', data: { ownerLabel: 'O', token, pollName: 'P', isRegistered: true } },
    { action: 'base:share', data: { ownerLabel: 'O', token, baseName: 'B', role: 'editor' } },
    { action: 'copy:send', data: { ownerLabel: 'O', token, name: 'N', resourceKind: 'game' } },
    { action: 'device:share', data: { ownerLabel: 'O', token, deviceType: 'host', gameId: token, gameName: 'G' } },
  ];
  for (const lang of ['pl', 'en', 'uk']) for (const c of cases) for (const reminder of [false, true]) {
    const { html } = buildNotificationMail({ ...c, lang, reminder });
    assert.doesNotMatch(html, /&lt;\/?[a-z]/i, `${lang} ${c.action}`);
  }
});
