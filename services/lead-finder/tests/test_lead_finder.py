"""Testy Lead Finder 2: python3 -m unittest discover -s services/lead-finder/tests"""

import asyncio
import json
import os
import sys
import unittest
from unittest.mock import AsyncMock, patch
import unittest.mock

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lf import classify, filters, pipeline  # noqa: E402
from lf.sources import ceidg, search  # noqa: E402


class FiltersTest(unittest.TestCase):
    def test_freemail_not_garbage(self):
        # Stary system: `mail.com` (podciąg) wycinało wszystkie @gmail.com.
        for e in ('dj.marek@gmail.com', 'kontakt@hotmail.com', 'biuro@wp.pl', 'x@interia.pl', 'biuro@djcontest.pl'):
            self.assertTrue(filters.email_ok(e), e)
        for e in ('a@example.com', 'jan@fixly.pl', 'x@sub.olx.pl', 'noreply@firma.pl', 'webmaster@dj.pl', 'logo@2x.png'):
            self.assertFalse(filters.email_ok(e), e)

    def test_extract_obfuscated(self):
        self.assertEqual(filters.extract_emails('Pisz: biuro [at] dj-max [dot] pl'), ['biuro@dj-max.pl'])
        self.assertEqual(filters.extract_emails('kontakt&#64;wodzirej.pl'), ['kontakt@wodzirej.pl'])
        key = 0x42
        enc = bytes([key]) + bytes(ord(c) ^ key for c in 'hej@quiz.pl')
        html = f'<a data-cfemail="{enc.hex()}">[email protected]</a>'
        self.assertEqual(filters.extract_emails('', html), ['hej@quiz.pl'])

    def test_domain_exact(self):
        self.assertTrue(filters.domain_in('sub.olx.pl', {'olx.pl'}))
        self.assertFalse(filters.domain_in('djolx.pl', {'olx.pl'}))
        self.assertFalse(filters.domain_in('gmail.com', {'mail.com'}))

    def test_best_email(self):
        self.assertEqual(filters.best_email(['x@gmail.com', 'biuro@djmax.pl', 'a@inna.pl'], 'djmax.pl'), 'biuro@djmax.pl')
        self.assertEqual(filters.best_email(['x@gmail.com', 'a@inna.pl'], 'djmax.pl'), 'a@inna.pl')
        self.assertIsNone(filters.best_email(['noreply@djmax.pl'], 'djmax.pl'))


class ArticleAndVenueTest(unittest.TestCase):
    """Poradnik na stronie restauracji nie jest leadem; lokal tylko z cytatem o rozrywce."""

    def test_article_urls(self):
        for url in ('https://www.restauracja3v6.pl/nowosc_jak-wybrac-lokal-na-komunie-w-bydgoszczy-praktyczny-poradnik-dla',
                    'https://dj.pl/blog/wesele-2026', 'https://sala.pl/2025/04/wesele-u-nas', 'https://x.pl/porady/muzyka',
                    'https://x.pl/aktualnosci/komunie', 'https://x.pl/ile-kosztuje-dj-na-wesele'):
            self.assertEqual(filters.article_reason(url), 'artykuł/poradnik, nie strona firmy', url)
            self.assertEqual(filters.rule_reason(url, 'Firma', '', ['a@x.pl']), 'artykuł/poradnik, nie strona firmy')
        for url in ('https://djmax.pl/', 'https://djmax.pl/oferta', 'https://wodzirej.pl/kontakt',
                    'https://animatorka-ola.pl/animacje-dla-dzieci-na-komunie', 'https://djmax.pl'):
            self.assertIsNone(filters.article_reason(url), url)

    def test_quote_in(self):
        text = 'Sala bankietowa. W cenie animator dla dzieci i wodzirej!'
        self.assertTrue(filters.quote_in('„w cenie animator dla dzieci”', text))
        self.assertFalse(filters.quote_in('własny DJ i konkursy', text))  # zmyślone
        self.assertFalse(filters.quote_in('animator', text))  # za krótkie

    def test_parse_venue(self):
        res = classify.parse_results(json.dumps({'results': [
            {'id': 'c1', 'ok': 1, 'venue': 1, 'evidence': ' w cenie  animator ', 'reason': 'lokal z animatorem'},
            {'id': 'c2', 'ok': 1, 'reason': 'DJ'}]}), ['c1', 'c2'])
        self.assertEqual((res['c1']['venue'], res['c1']['evidence'], res['c2']['venue']), (True, 'w cenie animator', False))


class SourcesTest(unittest.TestCase):
    def test_search_uses_searxng_engine_settings(self):
        class Client:
            async def get(client, url, params, timeout):
                self.assertEqual(url, 'http://searxng:8080/search')
                self.assertNotIn('engines', params)
                self.assertEqual((params['q'], params['pageno']), ('DJ kontakt', 2))
                self.assertEqual(params['format'], 'json')
                class Response:
                    status_code = 200
                    def json(self):
                        return {'results': [{'url': 'https://dj.pl'}], 'unresponsive_engines': []}
                return Response()
        results, dead = run(search.search(Client(), 'http://searxng:8080', 'DJ kontakt', 2))
        self.assertEqual((results, dead), ([{'url': 'https://dj.pl'}], []))

    def test_result_to_candidate(self):
        c = search.result_to_candidate({'url': 'https://www.djmax.pl/oferta', 'title': 'DJ Max',
                                        'content': 'Wesela, kontakt: biuro@djmax.pl'})
        self.assertEqual((c['domain'], c['emails']), ('djmax.pl', ['biuro@djmax.pl']))
        self.assertIsNone(search.result_to_candidate({'url': 'https://www.facebook.com/djmax', 'title': 'DJ'}))
        fb = search.result_to_candidate({'url': 'https://facebook.com/djmax', 'title': 'DJ', 'content': 'djmax@gmail.com'})
        self.assertEqual((fb['domain'], fb['emails']), ('', ['djmax@gmail.com']))

    def test_ceidg_candidate(self):
        firm = {'id': 'abc', 'nazwa': 'DJ Max Jan Nowak', 'adresDzialalnosci': {'miasto': 'Lublin'},
                'email': 'Biuro@DJMax.pl', 'www': 'djmax.pl', 'pkd': [{'kod': '93.29.Z'}]}
        c = ceidg.firm_to_candidate(firm)
        self.assertEqual((c['source_ref'], c['emails'], c['domain'], c['pkd']), ('abc', ['biuro@djmax.pl'], 'djmax.pl', ['93.29.Z']))
        self.assertIsNone(ceidg.firm_to_candidate({'id': 'x', 'nazwa': 'Bez kontaktu'}))


class ParseTest(unittest.TestCase):
    def test_parse_results(self):
        content = 'Wynik: ' + json.dumps({'results': [
            {'id': 'c1', 'ok': 1, 'group': 'a', 'title': ' DJ  Max ', 'reason': 'DJ weselny'},
            {'id': 'c2', 'ok': 0, 'reason': 'szkoła'},
            {'id': 'c2', 'ok': 1, 'reason': 'duplikat id'},
            {'id': 'c9', 'ok': 1, 'reason': 'nieznane id'},
            {'id': 'c3', 'ok': 'tak', 'reason': 'zła wartość'},
            {'id': 'c4', 'ok': 1},
        ]})
        res = classify.parse_results(content, ['c1', 'c2', 'c3', 'c4'])
        self.assertEqual(set(res), {'c1', 'c2'})
        self.assertEqual((res['c1']['title'], res['c1']['group'], res['c2']['ok']), ('DJ Max', 'A', False))
        with self.assertRaises(ValueError):
            classify.parse_results('brak', ['c1'])

    def test_prompts(self):
        p = classify.build_prompt([{'id': 'c1', 'name': 'Łódź DJ'}], {'name': 'Szkoły', 'description': 'Szkoły podstawowe'})
        self.assertIn('"Łódź DJ"', p)
        self.assertIn('KATEGORIA: Szkoły', p)
        self.assertIn('Szkoły podstawowe', p)
        self.assertNotIn('{', p.split('KANDYDACI:')[0].replace('{"results"', ''))
        e = classify.build_expand_prompt('Wodzireje')
        self.assertIn('KATEGORIA: Wodzireje', e)
        self.assertNotIn('{category}', e)

    def test_parse_category(self):
        res = classify.parse_category(json.dumps({
            'description': ' DJ-e  weselni ', 'queries': ['DJ wesele kontakt', 'dj wesele kontakt', 'DJ @gmail.com', 'oprawa muzyczna', ''],
            'pkd': ['9329Z', '90.01.Z', 'zły', '93.29.Z']}))
        self.assertEqual(res, {'description': 'DJ-e weselni', 'queries': ['DJ wesele kontakt', 'DJ @gmail.com', 'oprawa muzyczna'],
                               'pkd': ['93.29.Z', '90.01.Z']})
        with self.assertRaises(ValueError):
            classify.parse_category('{"description": "x", "queries": ["a"]}')


class DeepSeekOnlyTest(unittest.TestCase):
    """Lead Finder używa wyłącznie DeepSeeka (decyzja 2026-10-25)."""

    class Db:
        def __init__(self, available, provider=None):
            self.available, self.cooldowns = available, []
            self.provider = provider or {'is_active': True, 'cooldown_until': None}

        async def rpc(self, fn, params=None):
            if fn == 'get_available_ai_providers':
                return self.available.pop(0) if self.available and isinstance(self.available[0], list) else self.available
            self.cooldowns.append(params)
            return True

        async def select(self, table, params=None):
            return [self.provider]

    def ask(self, available, reply, provider=None):
        db = self.Db(available, provider)
        c = classify.Classifier(db, None)

        async def fake_call(prompt):
            return reply
        c._call = fake_call
        return run(c._ask('p', lambda text: {'ok': text})), db

    def test_only_deepseek(self):
        res, db = self.ask([{'name': 'groq'}, {'name': 'anthropic'}], (200, 'x', None))
        self.assertIsNone(res)  # inni dostawcy nie są używani
        res, _ = self.ask([{'name': 'deepseek'}], (200, 'x', None))
        self.assertEqual(res, {'ok': 'x'})
        res, db = self.ask([{'name': 'deepseek'}], (402, None, 'insufficient balance'))
        self.assertIsNone(res)
        self.assertEqual(db.cooldowns[0]['p_name'], 'deepseek')
        res, db = self.ask([{'name': 'deepseek'}], (503, None, 'busy'))
        self.assertEqual(res, {})

    def test_short_cooldown_is_waited_not_treated_as_quota(self):
        # 30 s po złym formacie odpowiedzi: czekamy i pytamy dalej (wcześniej przerywało przebieg).
        from datetime import datetime, timedelta, timezone
        soon = (datetime.now(timezone.utc) + timedelta(seconds=2)).isoformat()
        with patch('lf.classify.asyncio.sleep', new=AsyncMock()) as slept:
            res, _ = self.ask([[], [{'name': 'deepseek'}]], (200, 'x', None), {'is_active': True, 'cooldown_until': soon})
        self.assertEqual(res, {'ok': 'x'})
        slept.assert_awaited()

    def test_long_cooldown_or_disabled_stops(self):
        from datetime import datetime, timedelta, timezone
        day = (datetime.now(timezone.utc) + timedelta(hours=20)).isoformat()
        res, _ = self.ask([[]], (200, 'x', None), {'is_active': True, 'cooldown_until': day})
        self.assertIsNone(res)
        res, _ = self.ask([[]], (200, 'x', None), {'is_active': False, 'cooldown_until': None})
        self.assertIsNone(res)


class FakeDb:
    def __init__(self):
        self.tables = {'marketing_verified_contacts': [], 'marketing_candidates': [], 'marketing_categories': [],
                       'marketing_search_queries_log': [], 'marketing_run_stats': [], 'marketing_search_logs': []}
        self.n = 0

    def _match(self, row, filters_):
        for k, v in filters_.items():
            if k in ('select', 'limit', 'order', 'offset'):
                continue
            op, _, val = v.partition('.')
            cur = row.get(k)
            cur = str(cur).lower() if isinstance(cur, bool) else cur
            if op == 'eq' and str(cur) != val:
                return False
            if op == 'in' and str(cur) not in val.strip('()').split(','):
                return False
            if op == 'is' and val == 'null' and cur is not None:
                return False
        return True

    async def select(self, table, params):
        rows = [r for r in self.tables[table] if self._match(r, params)]
        return rows[:int(params.get('limit', 10 ** 6))]

    async def select_all(self, table, columns, page=1000, extra=None):
        return await self.select(table, extra or {})

    async def insert(self, table, data, upsert_on=None, ignore_duplicates=False):
        rows = data if isinstance(data, list) else [data]
        for row in rows:
            if upsert_on:
                keys = upsert_on.split(',')
                old = next((r for r in self.tables[table] if all(r.get(k) == row.get(k) for k in keys)), None)
                if old:
                    if not ignore_duplicates:
                        old.update(row)
                    continue
            self.n += 1
            self.tables[table].append({'id': f'id{self.n}', 'created_at': self.n, **row})
        return rows

    async def update(self, table, data, filters_):
        for r in self.tables[table]:
            if self._match(r, filters_):
                r.update(data)
        return True

    async def delete(self, table, filters_):
        return True

    async def rpc(self, fn, params=None):
        return [{'name': 'groq'}] if fn == 'get_available_ai_providers' else True


class FakeClassifier:
    """Akceptuje kandydatów z „DJ” w nazwie; rozwija kategorię w stałe frazy."""

    def __init__(self, *a, **kw):
        self.calls = 0
        self.categories = []

    async def classify(self, items, category):
        self.calls += 1
        self.categories.append(category['name'])
        return {i['id']: {'ok': 'DJ' in i['name'], 'group': '', 'title': i['name'], 'short_description': 'opis',
                          'reason': 'test'} for i in items}

    async def expand(self, name):
        return {'description': f'opis {name}', 'queries': [f'{name} kontakt', f'{name} @gmail.com', f'{name} oferta'], 'pkd': ['93.29.Z']}

    fresh = []

    async def more_queries(self, category, used):
        self.more_calls = getattr(self, 'more_calls', 0) + 1
        return [q for q in self.fresh if q not in used]


def run(coro):
    return asyncio.run(coro)


CAT = {'id': 'k1', 'name': 'DJ', 'description': 'DJ-e', 'queries': ['dj'], 'pkd': []}


class PipelineTest(unittest.TestCase):
    def setUp(self):
        self.db = FakeDb()
        self.engine = pipeline.Engine(self.db, None, 'http://searx')
        self.engine.run_id, self.engine.status, self.engine.target = 'r1', 'running', 10

    def cand(self, ref, name, domain, emails, source='search', cat='k1'):
        return {'source': source, 'source_ref': ref, 'name': name, 'url': f'https://{domain}', 'domain': domain,
                'emails': emails, 'snippet': '', 'category_id': cat}

    def test_venue_needs_real_quote(self):
        db, e = self.db, self.engine
        run(e.load_known())
        run(e.admit({**self.cand('https://sala-a.pl', 'Sala A', 'sala-a.pl', ['a@sala-a.pl']), 'snippet': 'Przyjęcia komunijne, catering.'}))
        run(e.admit({**self.cand('https://sala-b.pl', 'Sala B', 'sala-b.pl', ['b@sala-b.pl']), 'snippet': 'Wesela z naszym wodzirejem w cenie.'}))

        class VenueAi:
            async def classify(self, items, category):
                return {i['id']: {'ok': True, 'venue': True, 'title': i['name'], 'short_description': '', 'reason': 'lokal',
                                  'evidence': 'własny wodzirej i konkursy' if i['name'] == 'Sala A' else 'z naszym wodzirejem w cenie'}
                        for i in items}
        run(e.classify_once(VenueAi(), CAT))
        self.assertEqual([v['email'] for v in db.tables['marketing_verified_contacts']], ['b@sala-b.pl'])
        a = next(c for c in db.tables['marketing_candidates'] if c['source_ref'] == 'https://sala-a.pl')
        self.assertEqual((a['status'], a['reject_reason']), ('rejected', 'lokal bez potwierdzonej rozrywki dla gości'))

    def test_admit_and_classify_with_category(self):
        db, e = self.db, self.engine
        db.tables['marketing_verified_contacts'].append({'id': 'v1', 'email': 'old@djstary.pl', 'url': 'https://djstary.pl'})
        run(e.load_known())
        cands = [
            self.cand('https://djmax.pl', 'DJ Max', 'djmax.pl', ['biuro@djmax.pl']),
            self.cand('https://djmax.pl', 'DJ Max', 'djmax.pl', ['biuro@djmax.pl']),
            self.cand('https://djstary.pl/x', 'DJ', 'djstary.pl', ['nowy@djstary.pl']),
            self.cand('https://apteka.pl', 'Apteka Zdrowie', 'apteka.pl', ['a@apteka.pl']),
            self.cand('f1', 'Sala Weselna', 'sala.pl', ['sala@gmail.com'], source='ceidg'),
            # Szkoła przechodzi odsiew w kodzie — o szkołach decyduje kategoria.
            self.cand('https://sp5.edu.pl', 'Szkoła Podstawowa nr 5', 'sp5.edu.pl', ['sekretariat@sp5.edu.pl'], cat='k2'),
        ]
        self.assertEqual([run(e.admit(c)) for c in cands], [True, False, False, False, True, True])
        self.assertEqual((e.stats['dropped_duplicate'], e.stats['dropped_rule']), (2, 1))
        fc = FakeClassifier()
        self.assertEqual(run(e.classify_once(fc, CAT)), 2)
        self.assertEqual(fc.categories, ['DJ'])
        verified = db.tables['marketing_verified_contacts']
        self.assertEqual([v['email'] for v in verified], ['old@djstary.pl', 'biuro@djmax.pl'])
        self.assertEqual((verified[1]['category_id'], verified[1]['source'], verified[1]['title']), ('k1', 'search', 'DJ Max'))
        statuses = {c['source_ref']: c['status'] for c in db.tables['marketing_candidates']}
        self.assertEqual(statuses['https://djmax.pl'], 'accepted')
        self.assertEqual(statuses['f1'], 'rejected')
        self.assertEqual(statuses['https://sp5.edu.pl'], 'new')  # inna kategoria — inna paczka

    def test_no_quota_and_provider_failure(self):
        e = self.engine
        run(e.admit(self.cand('u', 'DJ', 'dj.pl', ['a@dj.pl'])))

        class Down:
            def __init__(self, result):
                self.result = result

            async def classify(self, items, category):
                return self.result
        self.assertEqual(run(e.classify_once(Down({}), CAT)), -1)
        self.assertEqual(self.db.tables['marketing_candidates'][0]['status'], 'new')
        with self.assertRaises(pipeline.NoQuota):
            run(e.classify_once(Down(None), CAT))
        self.assertEqual(self.db.tables['marketing_candidates'][0]['status'], 'new')

    def test_categories_expanded_once_and_saved(self):
        db, e = self.db, self.engine
        db.tables['marketing_categories'] = [
            {'id': 'k1', 'name': 'DJ', 'is_active': True, 'description': None, 'queries': [], 'pkd': [], 'expanded_at': None, 'created_at': 1},
            {'id': 'k2', 'name': 'Szkoły', 'is_active': False, 'queries': [], 'pkd': [], 'expanded_at': None, 'created_at': 2},
            {'id': 'k3', 'name': 'Agencje', 'is_active': True, 'description': 'gotowe', 'queries': ['a', 'b', 'c'], 'pkd': [], 'expanded_at': 'x', 'created_at': 3},
        ]
        cats = run(e.load_categories(FakeClassifier()))
        self.assertEqual([c['name'] for c in cats], ['DJ', 'Agencje'])
        saved = db.tables['marketing_categories'][0]
        self.assertEqual((saved['description'], saved['pkd'], len(saved['queries'])), ('opis DJ', ['93.29.Z'], 3))
        self.assertTrue(saved['expanded_at'])
        self.assertEqual(pipeline.search_queries(cats[1], 2)[:2], ['search:k3:1:a', 'search:k3:1:b'])
        self.assertEqual(pipeline.ceidg_queries(cats[0]), ['ceidg:k1:93.29.Z:1'])

    def test_search_down_queries_return_to_pool(self):
        db, e = self.db, self.engine
        db.tables['marketing_categories'] = [
            {'id': 'k1', 'name': 'DJ', 'is_active': True, 'description': 'x', 'queries': [f'q{i}' for i in range(20)], 'pkd': [], 'expanded_at': 'x', 'created_at': 1}]

        async def blocked(client, base, phrase, pageno=1, timeout=25):
            return [], [['google', 'CAPTCHA'], ['bing', 'timeout']]
        orig_search, orig_cls = search.search, pipeline.Classifier
        search.search, pipeline.Classifier = blocked, FakeClassifier
        try:
            run(e.run_search(5))
        finally:
            search.search, pipeline.Classifier = orig_search, orig_cls
        self.assertEqual(db.tables['marketing_search_queries_log'], [])  # nic nie „zużyte”
        self.assertLessEqual(e.stats['search_queries'], 12)  # wstrzymane po serii odmów
        self.assertEqual(e.search_reasons, {'google': 'CAPTCHA', 'bing': 'timeout'})

    def test_run_search_end_to_end(self):
        db, e = self.db, self.engine
        db.tables['marketing_categories'] = [
            {'id': 'k1', 'name': 'DJ', 'is_active': True, 'description': 'x', 'queries': ['dj wesele'], 'pkd': [], 'expanded_at': 'x', 'created_at': 1}]

        async def fake_search(client, base, phrase, pageno=1, timeout=25):
            if pageno > 1:
                return [], []
            return [{'url': 'https://djmax.pl', 'title': 'DJ Max', 'content': 'kontakt biuro@djmax.pl'},
                    {'url': 'https://www.facebook.com/x', 'title': 'Profil', 'content': ''}], [['google', 'CAPTCHA']]
        orig_search, orig_cls = search.search, pipeline.Classifier
        search.search, pipeline.Classifier = fake_search, FakeClassifier
        try:
            run(e.run_search(5))
        finally:
            search.search, pipeline.Classifier = orig_search, orig_cls
        self.assertEqual([v['email'] for v in db.tables['marketing_verified_contacts']], ['biuro@djmax.pl'])
        self.assertEqual(e.stats['search_queries'], 2)
        self.assertEqual(e.stats['search_engine_errors'], 1)
        self.assertEqual({r['query_text'] for r in db.tables['marketing_search_queries_log']},
                         {'search:k1:1:dj wesele', 'search:k1:2:dj wesele'})

    def test_exhausted_phrases_refreshed_once_and_saved(self):
        db, e = self.db, self.engine
        db.tables['marketing_categories'] = [
            {'id': 'k1', 'name': 'DJ', 'is_active': True, 'description': 'x', 'queries': ['dj wesele'], 'pkd': [], 'expanded_at': 'x', 'created_at': 1}]
        db.tables['marketing_search_queries_log'] = [{'id': 1, 'query_text': 'search:k1:1:dj wesele'}, {'id': 2, 'query_text': 'search:k1:2:dj wesele'}]
        asked = []

        async def fake_search(client, base, phrase, pageno=1, timeout=25):
            asked.append((phrase, pageno))
            return [], []

        class Fresh(FakeClassifier):
            fresh = ['didżej na urodziny', 'dj wesele']
        orig_search, orig_cls = search.search, pipeline.Classifier
        search.search, pipeline.Classifier = fake_search, Fresh
        try:
            run(e.run_search(5))
        finally:
            search.search, pipeline.Classifier = orig_search, orig_cls
        # Tylko nowa fraza (bez powtórki starej), dwie strony, potem koniec bez pętli.
        self.assertEqual(asked, [('didżej na urodziny', 1), ('didżej na urodziny', 2)])
        self.assertEqual(db.tables['marketing_categories'][0]['queries'], ['dj wesele', 'didżej na urodziny'])

    def test_partial_batch_judged_after_wait_while_ceidg_runs(self):
        db, e = self.db, self.engine
        db.tables['marketing_categories'] = [
            {'id': 'k1', 'name': 'DJ', 'is_active': True, 'description': 'x', 'queries': [], 'pkd': ['93.29.Z'], 'expanded_at': 'x', 'created_at': 1}]
        run(e.admit(self.cand('https://djmax.pl', 'DJ Max', 'djmax.pl', ['biuro@djmax.pl'])))
        e.verified = 0
        release = asyncio.Event()

        class SlowCeidg:
            enabled = True

            async def list_firms(self, pkd, page):
                await release.wait()  # CEIDG „wisi” — źródła się nie kończą
                return [], False
        e.ceidg = SlowCeidg()
        orig_cls, orig_cfg, orig_search = pipeline.Classifier, pipeline.cfg, search.search

        async def no_results(client, base, phrase, pageno=1, timeout=25):
            return [], []
        pipeline.Classifier, search.search = FakeClassifier, no_results
        # Czas oczekiwania 0 s zamiast 300 s: niepełna paczka ocenia się od razu,
        # chociaż CEIDG nadal pracuje.
        pipeline.cfg = lambda key, default: 0 if key == 'PARTIAL_BATCH_WAIT' else orig_cfg(key, default)
        try:
            async def scenario():
                await asyncio.wait_for(e.run_search(1), 5)
            run(scenario())
        finally:
            pipeline.Classifier, pipeline.cfg, search.search = orig_cls, orig_cfg, orig_search
        self.assertEqual([v['email'] for v in db.tables['marketing_verified_contacts']], ['biuro@djmax.pl'])


class CeidgProducerTest(unittest.IsolatedAsyncioTestCase):
    def engine(self, firms_by_page, categories):
        calls, details = [], []

        class Fake:
            enabled = True

            async def list_firms(self, pkd, page):
                calls.append((pkd, page))
                return firms_by_page.get((pkd, page), ([], False))

            async def details(self, firm):
                details.append(firm['id'])
                return {**firm, 'email': f'biuro@{firm["id"]}.pl'}
        e = pipeline.Engine(FakeDb(), None, 'http://searx', ceidg=Fake())
        e.run_id, e.status, e.target = 'r1', 'running', 10
        e.categories = categories
        return e, calls, details

    async def test_same_pkd_once_and_known_firms_without_details(self):
        cats = [{'id': 'k1', 'pkd': ['93.29.Z', '90.01.Z']}, {'id': 'k2', 'pkd': ['93.29.Z']}]
        e, calls, details = self.engine({('93.29.Z', 1): ([{'id': 'f1'}, {'id': 'f2'}], False)}, cats)
        e.known_refs.add(('ceidg', 'f1'))
        with unittest.mock.patch('lf.pipeline.asyncio.sleep', new=unittest.mock.AsyncMock()):
            await e.ceidg_producer()
        self.assertEqual(calls, [('93.29.Z', 1), ('90.01.Z', 1)])
        self.assertEqual(details, ['f2'])
        self.assertEqual(e.stats['dropped_duplicate'], 1)

    async def test_failed_query_retried_once_then_skipped(self):
        e, calls, _ = self.engine({}, [{'id': 'k1', 'pkd': ['93.29.Z']}])
        failing = unittest.mock.AsyncMock(side_effect=httpx.ReadTimeout(''))
        e.ceidg.list_firms = failing
        with unittest.mock.patch('lf.pipeline.asyncio.sleep', new=unittest.mock.AsyncMock()):
            await asyncio.wait_for(e.ceidg_producer(), 5)
        self.assertEqual(failing.await_count, 2)
        self.assertEqual(e.stats['errors'], 2)
        self.assertNotIn('ceidg:k1:93.29.Z:1', e.done_queries)  # wraca w następnym przebiegu

    async def test_ceidg_get_retries_timeout_once(self):
        responses = [httpx.ReadTimeout(''), None]

        class Response:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return {'firmy': [{'id': 'x'}], 'links': {}}

        class Client:
            async def get(self, url, params=None, headers=None, timeout=None):
                item = responses.pop(0)
                if item:
                    raise item
                return Response()
        source = ceidg.Ceidg(Client(), 'token')
        with unittest.mock.patch('lf.sources.ceidg.asyncio.sleep', new=unittest.mock.AsyncMock()):
            firms, has_next = await source.list_firms('93.29.Z')
        self.assertEqual((firms, has_next), ([{'id': 'x'}], False))

    async def test_ceidg_hanging_request_has_deadline(self):
        class Client:
            calls = 0

            async def get(self, url, params=None, headers=None, timeout=None):
                Client.calls += 1
                await asyncio.sleep(3600)
        source = ceidg.Ceidg(Client(), 'token', request_deadline=0.01)
        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(source.list_firms('93.29.Z'), 5)
        self.assertEqual(Client.calls, 2)


if __name__ == '__main__':
    unittest.main()
