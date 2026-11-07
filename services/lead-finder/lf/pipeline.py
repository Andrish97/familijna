"""Przebieg wyszukiwania (Lead Finder 3, familijna-server/docs/lead-finder-nowy-plan.md):
kategorie z panelu -> rozwinięcie AI (opis, frazy, PKD; raz, w bazie) ->
wyszukiwarka i CEIDG równolegle -> odsiew w kodzie -> ocena AI paczkami
według kategorii -> marketing_verified_contacts z kategorią."""

import asyncio
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx

from . import fetch, filters
from .classify import Classifier, item_for_lead
from .logging_sink import describe_error
from .config import cfg
from .sources import ceidg as ceidg_src
from .sources import search as search_src

log = logging.getLogger('lead_finder')

STAT_KEYS = ('search_queries', 'search_results', 'search_engine_errors', 'ceidg_records', 'candidates',
             'dropped_no_email', 'dropped_duplicate', 'dropped_public', 'dropped_rule', 'pages_fetched',
             'sent_to_ai', 'ai_calls', 'ai_accepted', 'ai_rejected', 'errors')


def now_iso():
    return datetime.now(timezone.utc).isoformat()


class NoQuota(Exception):
    pass


class Stopped(Exception):
    pass


def search_queries(cat, pages):
    """Klucze zapytań wyszukiwarki kategorii: search:<kategoria>:<strona>:<fraza>."""
    # Frazy ze słowem wykluczającym (np. „pokaz ognia na wesele”) nie są szukane.
    queries = [q for q in cat.get('queries') or [] if not filters.has_keyword(q, filters.NEGATIVE_KEYWORDS)]
    return [f'search:{cat["id"]}:{p}:{q}' for p in range(1, pages + 1) for q in queries]


def ceidg_queries(cat):
    return [f'ceidg:{cat["id"]}:{pkd}:1' for pkd in cat.get('pkd') or []]


def ceidg_run_queue(categories, done):
    """Każdy kod PKD raz na przebieg: kilka kategorii z tym samym PKD dostałoby
    te same firmy (odrzucane potem jako duplikaty) po kilka minut na stronę."""
    queue, seen = [], set()
    for cat in categories:
        for q in ceidg_queries(cat):
            pkd = q.split(':')[2]
            if pkd in seen:
                continue
            seen.add(pkd)
            if q not in done:
                queue.append(q)
    return queue


class Engine:
    def __init__(self, db, client, searx_url, ceidg=None, mx_check=None, notify=None):
        self.db = db
        self.client = client
        self.searx_url = searx_url
        self.ceidg = ceidg
        self.mx_check = mx_check
        self.notify = notify
        self.status = 'idle'
        self.run_id = None
        self.target = 0
        self.verified = 0
        self.stats = dict.fromkeys(STAT_KEYS, 0)
        self.known_emails, self.known_domains, self.known_refs = set(), set(), set()
        self.done_queries = set()
        self.categories = []
        self.fetch_budget = 0
        self.attempts = {}
        self.search_down = 0          # kolejne zapytania bez wyników z odmową silników
        self.search_reasons = {}      # silnik -> powód odmowy (do logu)
        # Przebieg w bazie (migracja 519): dzierżawa, puls, przejęcie po restarcie.
        self.lease = None
        self.kick = asyncio.Event()

    # --- stan ---

    def snapshot(self):
        return {'status': self.status, 'run_id': self.run_id, 'verified': self.verified, 'target': self.target,
                'errors': self.stats['errors'], 'stats': dict(self.stats),
                'categories': [c['name'] for c in self.categories]}

    async def _checkpoint(self):
        while self.status == 'paused':
            await asyncio.sleep(2)
        if self.status != 'running':
            raise Stopped()

    async def save_stats(self, finished=False):
        row = {'run_id': self.run_id, 'kind': 'search', 'target': self.target, **self.stats}
        if finished:
            row['finished_at'] = now_iso()
        await self.db.insert('marketing_run_stats', row, upsert_on='run_id')

    # --- przygotowanie ---

    async def load_known(self):
        verified = await self.db.select_all('marketing_verified_contacts', 'id,email,url') or []
        for v in verified:
            self.known_emails.add((v.get('email') or '').strip().lower())
            d = filters.url_domain(v.get('url') or '')
            if d and not filters.is_portal(d):
                self.known_domains.add(d)
        cands = await self.db.select_all('marketing_candidates', 'id,source,source_ref,domain') or []
        for c in cands:
            self.known_refs.add((c['source'], c['source_ref']))
            if c.get('domain'):
                self.known_domains.add(c['domain'])
        logs = await self.db.select_all('marketing_search_queries_log', 'id,query_text') or []
        self.done_queries = {r['query_text'] for r in logs}

    async def load_categories(self, classifier):
        """Aktywne kategorie; nierozwinięte rozwija AI (opis, frazy, PKD) i zapisuje."""
        rows = await self.db.select('marketing_categories', {
            'select': 'id,name,description,queries,pkd,expanded_at', 'is_active': 'eq.true', 'order': 'created_at'}) or []
        ready = []
        for cat in rows:
            await self._checkpoint()
            if not cat.get('expanded_at') or not cat.get('queries'):
                exp = await classifier.expand(cat['name'])
                if exp is None:
                    raise NoQuota()
                if not exp:
                    log.error(f'Kategoria „{cat["name"]}”: AI nie przygotowała fraz — pomijam w tym przebiegu.')
                    continue
                cat = {**cat, **exp, 'expanded_at': now_iso()}
                await self.db.update('marketing_categories', {**exp, 'expanded_at': cat['expanded_at']},
                                     {'id': f'eq.{cat["id"]}'})
                log.info(f'Kategoria „{cat["name"]}”: {len(exp["queries"])} fraz, PKD: {", ".join(exp["pkd"]) or "brak"}.')
            ready.append(cat)
        self.categories = ready
        return ready

    # --- odsiew i zapis kandydata ---

    async def _mx_ok(self, emails):
        if not self.mx_check:
            return emails
        return [e for e in emails if await self.mx_check(e.rpartition('@')[2])]

    async def admit(self, c):
        """Odsiew kandydata i zapis do marketing_candidates. True, gdy czeka na ocenę."""
        self.stats['candidates'] += 1
        ref = (c['source'], c['source_ref'])
        emails = [e for e in c.get('emails') or [] if e not in self.known_emails]
        if ref in self.known_refs or (c.get('emails') and not emails) or \
                (c.get('domain') and c['domain'] in self.known_domains):
            self.stats['dropped_duplicate'] += 1
            return False
        self.known_refs.add(ref)
        emails = await self._mx_ok(emails)
        c = {**c, 'emails': emails, 'run_id': self.run_id}
        if not emails and not c.get('domain'):
            self.stats['dropped_no_email'] += 1
            return False
        reason = filters.rule_reason(c.get('url', ''), c.get('name', ''), c.get('snippet', ''), emails)
        if reason:
            self.stats['dropped_rule'] += 1
            await self.db.insert('marketing_candidates', {**c, 'status': 'rejected', 'reject_reason': reason},
                                 upsert_on='source,source_ref', ignore_duplicates=True)
            return False
        if c.get('domain'):
            self.known_domains.add(c['domain'])
        await self.db.insert('marketing_candidates', {**c, 'status': 'new'},
                             upsert_on='source,source_ref', ignore_duplicates=True)
        return True

    async def _log_query(self, q, found, added):
        self.done_queries.add(q)
        await self.db.insert('marketing_search_queries_log',
                             {'query_text': q, 'urls_found': found, 'urls_added': added, 'status': 'completed'},
                             upsert_on='query_text')

    # --- źródła ---

    async def run_search_query(self, q):
        _, cat_id, page, phrase = q.split(':', 3)
        found = added = 0
        self.stats['search_queries'] += 1
        try:
            results, dead = await search_src.search(self.client, self.searx_url, phrase, int(page),
                                                    timeout=cfg('TIMEOUT_SEARCH', 25))
        except Exception as e:  # SearXNG niedostępny, zły JSON
            self.stats['errors'] += 1
            log.error('Wyszukiwarka: %s', describe_error(e), exc_info=True)
            return 0
        self.stats['search_results'] += len(results)
        self.stats['search_engine_errors'] += len(dead)
        if not results and dead:
            # Silniki odmówiły (blokada, CAPTCHA, limit) — zapytanie wraca do puli
            # na kolejny przebieg, zamiast przepaść jako „zrobione”.
            self.search_down += 1
            for eng in dead:
                if isinstance(eng, (list, tuple)) and eng:
                    self.search_reasons[str(eng[0])] = str(eng[1] if len(eng) > 1 else '')[:80]
            return 0
        self.search_down = 0
        for res in results:
            c = search_src.result_to_candidate(res)
            if c:
                found += 1
                added += await self.admit({**c, 'category_id': cat_id})
            else:
                self.stats['dropped_no_email'] += 1
        await self._log_query(q, found, added)
        return added

    async def ceidg_producer(self):
        """CEIDG w tle (limit zapytań: odstęp między szczegółami wpisów)."""
        if not self.ceidg or not self.ceidg.enabled:
            return
        queue = ceidg_run_queue(self.categories, self.done_queries)
        failures = {}
        while queue and self.status in ('running', 'paused') and self.verified < self.target:
            q = queue.pop(0)
            _, cat_id, pkd, page = q.split(':', 3)
            found = added = 0
            try:
                firms, has_next = await self.ceidg.list_firms(pkd, int(page))
                for firm in firms:
                    await self._checkpoint()
                    firm_id = ceidg_src.firm_id(firm)
                    if firm_id and ('ceidg', firm_id) in self.known_refs:
                        # Firma już oceniana w poprzednich przebiegach: bez zapytania
                        # o szczegóły (każde czeka CEIDG_DETAIL_DELAY sekund).
                        self.stats['ceidg_records'] += 1
                        self.stats['dropped_duplicate'] += 1
                        continue
                    detail = await self.ceidg.details(firm)
                    self.stats['ceidg_records'] += 1
                    c = ceidg_src.firm_to_candidate(detail)
                    if c:
                        found += 1
                        added += await self.admit({**c, 'category_id': cat_id})
                    else:
                        self.stats['dropped_no_email'] += 1
                if has_next:
                    queue.append(f'ceidg:{cat_id}:{pkd}:{int(page) + 1}')
            except Stopped:
                return
            except Exception as e:
                self.stats['errors'] += 1
                failures[q] = failures.get(q, 0) + 1
                retry = failures[q] < cfg('CEIDG_QUERY_ATTEMPTS', 2)
                if retry:
                    queue.append(q)
                note = 'ponowię później w tym przebiegu' if retry else 'pomijam do następnego przebiegu'
                if isinstance(e, (httpx.TimeoutException, asyncio.TimeoutError)):
                    log.error('CEIDG %s s. %s: %s (serwer rejestru nie odpowiedział; %s)', pkd, page, describe_error(e), note)
                else:
                    log.error('CEIDG %s s. %s: %s (%s)', pkd, page, describe_error(e), note, exc_info=True)
                await asyncio.sleep(30)
                continue
            await self._log_query(q, found, added)
            log.info(f'CEIDG {pkd} s. {page}: {found} firm z kontaktem, {added} do oceny')

    # --- ocena ---

    async def accept(self, c, res, email):
        row = {'email': email, 'url': c.get('url') or '', 'title': (res.get('title') or c.get('name') or '')[:200],
               'short_description': res.get('short_description') or None, 'verify_reason': res['reason'],
               'source': c['source'], 'category_id': c.get('category_id'),
               'quality': 'good', 'quality_reason': res['reason'], 'reviewed_at': now_iso()}
        if await self.db.insert('marketing_verified_contacts', row):
            self.known_emails.add(email)
            self.verified += 1
            self.stats['ai_accepted'] += 1
            log.info(f'Dodano: {row["title"] or c.get("url")} — {res["reason"]}')
            return True
        self.stats['errors'] += 1
        return False

    async def classify_once(self, classifier, cat):
        """Jedna paczka kandydatów kategorii. Liczba ocenionych, -1 = AI chwilowo niedostępne."""
        rows = await self.db.select('marketing_candidates', {
            'select': '*', 'status': 'eq.new', 'category_id': f'eq.{cat["id"]}', 'order': 'created_at',
            'limit': cfg('AI_BATCH_SIZE', 25)}) or []
        if not rows:
            return 0
        ids = [r['id'] for r in rows]
        await self.db.update('marketing_candidates', {'status': 'classifying'}, {'id': f'in.({",".join(ids)})'})
        items = {f'c{i + 1}': r for i, r in enumerate(rows)}
        self.stats['sent_to_ai'] += len(rows)
        results = await classifier.classify([item_for_lead(cid, r) for cid, r in items.items()], cat)
        if not results:
            await self.db.update('marketing_candidates', {'status': 'new'}, {'id': f'in.({",".join(ids)})'})
            if results is None:
                raise NoQuota()
            return -1
        for cid, c in items.items():
            if self.verified >= self.target:
                await self.db.update('marketing_candidates', {'status': 'new'}, {'id': f'eq.{c["id"]}'})
                continue
            res = results.get(cid)
            if not res:
                n = self.attempts.get(c['id'], 0) + 1
                self.attempts[c['id']] = n
                await self.db.update('marketing_candidates',
                                     {'status': 'rejected', 'reject_reason': 'brak oceny AI'} if n >= 3 else {'status': 'new'},
                                     {'id': f'eq.{c["id"]}'})
                continue
            if res['ok'] and res.get('venue') and not filters.quote_in(
                    res.get('evidence'), f'{c.get("name") or ""} {c.get("snippet") or ""}'):
                # Lokal bez prawdziwego cytatu o własnej rozrywce (model zgadł albo zmyślił).
                res = {**res, 'ok': False, 'reason': 'lokal bez potwierdzonej rozrywki dla gości'}
            if not res['ok']:
                self.stats['ai_rejected'] += 1
                await self.db.update('marketing_candidates', {'status': 'rejected', 'reject_reason': res['reason']},
                                     {'id': f'eq.{c["id"]}'})
                continue
            emails = c.get('emails') or []
            if not emails and c.get('domain') and self.fetch_budget > 0:
                self.fetch_budget -= 1
                emails, pages = await fetch.find_emails(self.client, c['url'])
                self.stats['pages_fetched'] += pages
                emails = await self._mx_ok([e for e in emails if e not in self.known_emails])
            email = filters.best_email(emails, c.get('domain') or '')
            if not email:
                await self.db.update('marketing_candidates', {'status': 'rejected', 'reject_reason': 'pasuje, ale bez e-maila'},
                                     {'id': f'eq.{c["id"]}'})
                continue
            ok = await self.accept(c, res, email)
            await self.db.update('marketing_candidates', {'status': 'accepted' if ok else 'new'}, {'id': f'eq.{c["id"]}'})
        return len(rows)

    async def _pending(self, cat):
        rows = await self.db.select('marketing_candidates', {
            'select': 'id', 'status': 'eq.new', 'category_id': f'eq.{cat["id"]}', 'limit': cfg('AI_BATCH_SIZE', 25)})
        return len(rows or [])

    async def refresh_queries(self, classifier, cat):
        """Nowe frazy kategorii, gdy wszystkie dotychczasowe są już sprawdzone
        (dziennik zapytań jest trwały, więc bez tego kolejne przebiegi mają
        wyłącznie CEIDG). Zwraca nowe zapytania albo []."""
        used = list(cat.get('queries') or [])
        fresh = await classifier.more_queries(cat, used)
        if not isinstance(fresh, list) or not fresh:
            log.info(f'Kategoria „{cat["name"]}”: brak nowych fraz w tym przebiegu.')
            return []
        cat['queries'] = (used + fresh)[-cfg('CATEGORY_QUERIES_MAX', 400):]
        await self.db.update('marketing_categories', {'queries': cat['queries']}, {'id': f'eq.{cat["id"]}'})
        log.info(f'Kategoria „{cat["name"]}”: wszystkie frazy sprawdzone — dodano {len(fresh)} nowych.')
        return [q for q in search_queries({**cat, 'queries': fresh}, cfg('SEARCH_PAGES', 2)) if q not in self.done_queries]

    # --- przebieg ---

    async def run_search(self, target):
        classifier = Classifier(self.db, self.client, self.stats)
        batch = cfg('AI_BATCH_SIZE', 25)
        parallel = cfg('SEARCH_PARALLEL', 4)
        self.fetch_budget = cfg('FETCH_BUDGET_PER_RUN', 20)
        await self.db.update('marketing_candidates', {'status': 'new'}, {'status': 'eq.classifying'})
        await self.load_known()
        cats = await self.load_categories(classifier)
        if not cats:
            log.error('Brak aktywnych kategorii z frazami — dodaj kategorię w panelu.')
            return
        log.info(f'Kategorie: {", ".join(c["name"] for c in cats)}. CEIDG: {"tak" if self.ceidg and self.ceidg.enabled else "brak klucza"}.')
        queues = {c['id']: [q for q in search_queries(c, cfg('SEARCH_PAGES', 2)) if q not in self.done_queries] for c in cats}
        refreshes = dict.fromkeys(queues, 0)
        search_stopped = False
        partial_wait = cfg('PARTIAL_BATCH_WAIT', 300)
        waiting_since = {}
        ceidg_task = asyncio.create_task(self.ceidg_producer())
        try:
            turn = 0
            while self.verified < target:
                await self._checkpoint()
                # Runda wyszukiwarki: po kilka fraz naraz, kategorie po kolei.
                picked = []
                for i in range(len(cats)):
                    if len(picked) >= parallel:
                        break
                    cat = cats[(turn + i) % len(cats)]
                    q = queues[cat['id']]
                    if not q and not search_stopped and refreshes[cat['id']] < cfg('QUERY_REFRESH_PER_RUN', 2):
                        refreshes[cat['id']] += 1
                        q.extend(await self.refresh_queries(classifier, cat))
                    picked += [q.pop(0) for _ in range(min(len(q), max(1, parallel // len(cats))))]
                turn += 1
                if picked:
                    await asyncio.gather(*(self.run_search_query(q) for q in picked))
                    if self.search_down >= cfg('SEARCH_DOWN_LIMIT', 8):
                        reasons = ', '.join(f'{k} ({v})' if v else k for k, v in sorted(self.search_reasons.items())) or 'brak szczegółów'
                        log.error(f'Wyszukiwarka nie zwraca wyników — silniki odmawiają: {reasons}. '
                                  'Wstrzymuję wyszukiwarkę w tym przebiegu (frazy wracają do puli).')
                        queues = {k: [] for k in queues}
                        search_stopped = True
                sources_left = any(queues.values()) or not ceidg_task.done()
                # Ocena: pełne paczki; niepełne, gdy źródła się skończyły albo
                # kandydaci czekają dłużej niż PARTIAL_BATCH_WAIT (np. sam CEIDG
                # dostarcza kilka firm na kilka minut — bez tego przebieg stoi).
                judged = False
                for cat in cats:
                    while self.verified < target:
                        await self._checkpoint()
                        n = await self._pending(cat)
                        if not n:
                            waiting_since.pop(cat['id'], None)
                            break
                        waited = time.monotonic() - waiting_since.setdefault(cat['id'], time.monotonic())
                        if n < batch and sources_left and waited < partial_wait:
                            break
                        done = await self.classify_once(classifier, cat)
                        waiting_since.pop(cat['id'], None)
                        judged = True
                        if done == -1:
                            log.info('DeepSeek chwilowo niedostępny — ponowię za 30 s.')
                            await asyncio.sleep(30)
                            break
                await self.save_stats()
                if not picked and not judged:
                    if not sources_left:
                        log.info('Wszystkie frazy i wpisy CEIDG sprawdzone — koniec przebiegu.')
                        break
                    await asyncio.sleep(5)  # czekamy na CEIDG
        finally:
            ceidg_task.cancel()

    # --- przebieg w bazie (marketing_runs, migracja 519) ---

    LEASE_TTL = 120
    BEAT_EVERY = 10

    async def supervise(self):
        """Pętla usługi: przejmuje aktywny przebieg z bazy — nowy (po starcie
        z panelu) albo przerwany restartem (po wygaśnięciu dzierżawy)."""
        while True:
            try:
                if self.status in ('idle', 'starting'):
                    lease = str(uuid.uuid4())
                    run = await self.db.rpc('mk_run_claim', {'p_lease': lease, 'p_ttl_s': self.LEASE_TTL})
                    if isinstance(run, dict) and run.get('run_id'):
                        await self.run_claimed(run, lease)
                        continue
                try:
                    await asyncio.wait_for(self.kick.wait(), timeout=5)
                except asyncio.TimeoutError:
                    pass
                self.kick.clear()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.error('Pętla przebiegów: %s', describe_error(e))
                await asyncio.sleep(10)

    async def _beat_loop(self):
        """Puls dzierżawy: zapis licznika, pauza/anulowanie z panelu, utrata dzierżawy."""
        while True:
            await asyncio.sleep(self.BEAT_EVERY)
            st = await self.db.rpc('mk_run_heartbeat', {'p_run': self.run_id, 'p_lease': self.lease,
                                                        'p_verified': self.verified, 'p_ttl_s': self.LEASE_TTL})
            if st == 'paused' and self.status == 'running':
                self.status = 'paused'
            elif st == 'running' and self.status == 'paused':
                self.status = 'running'
            elif st == 'cancel_requested' and self.status in ('running', 'paused'):
                self.status = 'cancelled'
            elif st is None and self.status in ('running', 'paused'):
                # Dzierżawa utracona (przejął inny proces albo błąd bazy) — kończymy bez zapisu.
                log.error('Utracona dzierżawa przebiegu — przerywam w tym procesie.')
                self.status = 'lost'

    async def _release(self):
        try:
            await self.save_stats()
            await self.db.rpc('mk_run_release', {'p_run': self.run_id, 'p_lease': self.lease, 'p_verified': self.verified})
        except Exception as e:
            log.error('Oddanie przebiegu: %s', describe_error(e))

    async def _load_run_stats(self):
        rows = await self.db.select('marketing_run_stats', {'select': ','.join(STAT_KEYS), 'run_id': f'eq.{self.run_id}', 'limit': 1})
        if rows:
            for k in STAT_KEYS:
                if isinstance(rows[0].get(k), int):
                    self.stats[k] = rows[0][k]

    async def run_claimed(self, run, lease):
        self.run_id, self.target, self.verified = run['run_id'], int(run['target']), int(run.get('verified') or 0)
        self.lease = lease
        self.stats = dict.fromkeys(STAT_KEYS, 0)
        self.attempts = {}
        self.categories = []
        resumed = int(run.get('resumed') or 0) > 0
        self.status = {'paused': 'paused', 'cancel_requested': 'cancelled'}.get(run.get('status'), 'running')
        if resumed:
            await self._load_run_stats()
            log.info(f'Wznawiam przerwany przebieg: {self.verified}/{self.target} kontaktów.')
        else:
            cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            await self.db.delete('marketing_search_logs', {'created_at': f'lt.{cutoff}'})
            log.info(f'Zlecono {self.target} kontaktów.')
        await self.save_stats()
        beat = asyncio.create_task(self._beat_loop())
        final = 'error'
        interrupted = False
        try:
            await self.run_search(self.target)
            if self.status in ('lost', 'cancelled'):
                raise Stopped()
            self.status = 'completed'
            final = 'completed'
            msg = f'Zlecenie zakończone. Nowe kontakty: {self.verified}/{self.target}.'
            log.info(msg)
            if self.notify:
                await self.notify(f'✅ <b>Lead Finder</b>\n{msg}')
        except Stopped:
            final = 'cancelled'
            if self.status != 'lost':
                log.info('Zlecenie przerwane.')
        except NoQuota:
            self.status = 'cancelled'
            final = 'cancelled'
            log.error('DeepSeek niedostępny (wyłączony albo limit). Przerywam.')
            if self.notify:
                await self.notify('⚠️ <b>Zlecenie przerwane</b>\nDeepSeek niedostępny (wyłączony albo limit).')
        except asyncio.CancelledError:
            # Zatrzymanie usługi (wdrożenie, restart): przebieg zostaje aktywny,
            # dzierżawa oddana — nowy proces przejmie go od razu.
            interrupted = True
            raise
        except Exception as e:
            self.status = 'error'
            self.stats['errors'] += 1
            log.error('Błąd przebiegu: %s', describe_error(e), exc_info=True)
            if self.notify:
                await self.notify('❌ <b>Błąd Lead Findera</b> — szczegóły w logach panelu.')
        finally:
            beat.cancel()
            if interrupted:
                log.info(f'Zatrzymanie usługi — przebieg wznowi nowy proces ({self.verified}/{self.target}).')
                await asyncio.shield(self._release())
            else:
                if self.status != 'lost':
                    await self.save_stats(finished=True)
                    await self.db.rpc('mk_run_finish', {'p_run': self.run_id, 'p_lease': self.lease,
                                                        'p_status': final, 'p_verified': self.verified})
                await asyncio.sleep(3)
            self.status = 'idle'
            self.lease = None
