// E29: treść powiadomień push (push-content.js) i kopia tekstów aplikacji
// (push-app-texts.js generowana z tłumaczeń przez scripts/sync-push-texts.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  adminNotification, appNotification, APP_EVENTS, plPlural, clip, TITLE_MAX, BODY_MAX,
} from '../../supabase/functions/_shared/push-content.js';
import { PUSH_APP_TEXTS } from '../../supabase/functions/_shared/push-app-texts.js';
import { buildTexts, renderModule, TARGET } from '../../scripts/sync-push-texts.mjs';

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const LONG = 'Bardzo długa nazwa, która nie mieści się w tytule powiadomienia ani w treści';
const row = (event, vars = {}, app = 'admin') => ({ id: 1, app, event, vars, created_at: '2026-11-08T14:20:00Z' });

function checkShape(n, where) {
  assert.ok(n, `${where}: brak treści`);
  assert.ok(n.title.length <= TITLE_MAX, `${where}: tytuł ${n.title.length} > ${TITLE_MAX}: ${n.title}`);
  assert.ok(n.body.length <= BODY_MAX, `${where}: treść ${n.body.length} > ${BODY_MAX}: ${n.body}`);
  assert.doesNotMatch(n.title + n.body, EMOJI, `${where}: emotka`);
  assert.doesNotMatch(n.title + n.body, /\{\w+\}/, `${where}: niewypełnione miejsce`);
  assert.match(n.icon, /\.png$/);
  assert.match(n.badge, /\/badge-[a-z-]+\.png$/);
  assert.ok(n.actions.length <= 2);
  for (const a of n.actions) { assert.ok(a.title, `${where}: przycisk bez nazwy`); assert.match(a.icon, /\/action-[a-z-]+\.png$/); }
  assert.ok(n.tag && n.url && Array.isArray(n.vibrate) && Number.isFinite(n.timestamp));
}

test('polska odmiana i przycinanie', () => {
  assert.deepEqual([1, 2, 4, 5, 12, 14, 22, 25].map((n) => plPlural(n, 'a', 'b', 'c')), ['a', 'b', 'b', 'c', 'c', 'c', 'b', 'c']);
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('  a \n b  ', 10), 'a b');
});

test('panel admina: wszystkie zdarzenia mieszczą się, bez emotek, właściwe karty', () => {
  const cases = [
    ['mail', { from: 'ktos@example.com', subject: LONG, n: 1 }, '/?tab=reports', 'Nowy e-mail'],
    ['mail', { from: 'ktos@example.com', subject: 'x', n: 5 }, '/?tab=reports', '5 nowych e-maili'],
    ['mail', { from: 'ktos@example.com', subject: 'x', n: 3 }, '/?tab=reports', '3 nowe e-maile'],
    ['ticket', { ticket: 'T-1234', subject: LONG, from: 'a@b.pl' }, '/?tab=reports', 'Zgłoszenie #T-1234'],
    ['market', { title: LONG }, '/?tab=marketplace', 'Gra do zatwierdzenia'],
    ['collect_done', { what: 'contacts', added: 37, target: 50, minutes: 42 }, '/?tab=marketing', 'Zbieranie kontaktów zakończone'],
    ['collect_done', { what: 'questions', added: 85, target: 100, lang: 'pl' }, '/?tab=generator', 'Zbieranie pytań zakończone'],
    ['collect_paused', { what: 'questions', lang: 'uk' }, '/?tab=generator', 'Zbieranie wstrzymane'],
    ['job_error', { what: 'questions', reason: LONG }, '/?tab=generator', 'Błąd: zbieranie pytań'],
    ['job_error', { what: 'contacts' }, '/?tab=marketing', 'Błąd: zbieranie kontaktów'],
    ['job_error_repeat', { what: 'contacts', n: 3, since: '2026-11-08T13:20:00Z' }, '/?tab=marketing', 'Zbieranie kontaktów nie działa'],
    ['test', {}, '/?tab=maintenance', 'Test powiadomień'],
  ];
  for (const [event, vars, url, title] of cases) {
    const n = adminNotification(row(event, vars));
    checkShape(n, event);
    assert.equal(n.url, url, event);
    assert.equal(n.title, title, event);
  }
  const rep = adminNotification(row('job_error_repeat', { what: 'contacts', n: 3, since: '2026-11-08T13:20:00Z' }));
  assert.equal(rep.body, '3 błędy od 14:20. Wymaga sprawdzenia.');
  assert.equal(rep.requireInteraction, true);
  assert.deepEqual(rep.vibrate, [120, 80, 120, 80, 120]);
  assert.equal(adminNotification(row('mail', { n: 1, from: 'a' })).requireInteraction, false);
  assert.equal(adminNotification(row('nieznane')), null);
});

test('aplikacja: każde zdarzenie w PL/EN/UK, nazwy przycięte, bez emotek', () => {
  const vars = { owner: LONG, name: LONG, base: LONG, type: 'Wyświetlacz', id: 'x' };
  for (const event of Object.keys(APP_EVENTS)) {
    for (const lang of ['pl', 'en', 'uk']) checkShape(appNotification(row(event, vars, 'main'), lang, PUSH_APP_TEXTS), `${event}/${lang}`);
  }
  const pl = appNotification(row('copy:game', { owner: 'Ania', name: 'Quiz' }, 'main'), 'pl', PUSH_APP_TEXTS);
  assert.equal(pl.title, 'Kopia gry');
  assert.equal(pl.body, 'Ania przesyła Ci kopię gry „Quiz”.');
  assert.equal(appNotification(row('copy:game', {}, 'main'), 'de', PUSH_APP_TEXTS).title, 'Kopia gry', 'nieznany język → PL');
  assert.equal(appNotification(row('nieznane', {}, 'main'), 'pl', PUSH_APP_TEXTS), null);
  assert.equal(appNotification(row('device:share', { owner: 'Ania', type: 'buzzer' }, 'main'), 'uk', PUSH_APP_TEXTS).body,
    'Ania надає тобі доступ до пристрою: Кнопка для поєдинку.');
  assert.equal(appNotification(row('friend:invite', { owner: 'Ania', url: '/go/?f=abc' }, 'main'), 'en', PUSH_APP_TEXTS).url, '/go/?f=abc');
});

test('teksty PL/UK bezosobowe (bez form rodzajowych o nadawcy)', () => {
  for (const lang of ['pl', 'uk']) {
    for (const [k, v] of Object.entries(PUSH_APP_TEXTS[lang])) {
      assert.doesNotMatch(v, /\(a\)|\(-?ла\)|\bwysłał|\budostępnił|надіслав|надав/, `${lang}:${k}`);
    }
  }
});

test('kopia tekstów zgodna z tłumaczeniami (node scripts/sync-push-texts.mjs)', async () => {
  assert.equal(fs.readFileSync(TARGET, 'utf8'), renderModule(await buildTexts()));
});
