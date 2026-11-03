"""Ocena AI paczkami: jedno zapytanie na 20–30 kandydatów, odpowiedź sprawdzana w kodzie.

AI nie podaje e-maila (e-mail zawsze ze źródła). Każdy id z paczki musi
wrócić dokładnie raz; brakujące i błędne pozycje wracają do kolejnej paczki.
"""

import json
import logging
import os
import re

from .config import cfg, load_text
from .resources import deepseek, BudgetUnavailable, ProviderUnavailable

log = logging.getLogger('lead_finder')

SYSTEM = ('You are a precise classifier. Return ONLY one valid JSON object, no markdown, '
          'no explanation outside JSON.')

# Jedyny dostawca AI Lead Findera (decyzja użytkownika 2026-10-25): DeepSeek.
# Stan (wyłączony, cooldown po limicie) w marketing_ai_providers — rozpoznawany
# przez get_available_ai_providers / set_ai_provider_cooldown.
PROVIDER = 'deepseek'
DEEPSEEK = {'key': os.getenv('DEEP_SEEK_API_KEY', ''), 'model': os.getenv('DEEPSEEK_MODEL', 'deepseek-chat'),
            'endpoint': 'https://api.deepseek.com/chat/completions'}

QUOTA_WORDS = ('day', 'daily', 'quota', 'credit', 'unauthorized', 'insufficient', 'billing')


def item_for_lead(cid, c):
    item = {'id': cid, 'name': c.get('name') or '', 'site': c.get('domain') or c.get('url') or ''}
    if c.get('snippet'):
        item['text'] = c['snippet'][:cfg('AI_ITEM_TEXT_LIMIT', 600)]
    if c.get('pkd'):
        item['pkd'] = c['pkd']
    if c.get('emails'):
        item['email_domains'] = sorted({e.rpartition('@')[2] for e in c['emails']})
    return item


def build_prompt(items, category):
    """Ocena paczki według kategorii (nazwa + opis z rozwinięcia AI)."""
    base = load_text('ai_prompt.txt')
    return (base.replace('{category}', category.get('name') or '')
                .replace('{description}', category.get('description') or '(brak opisu — oceniaj według nazwy kategorii)')
                .replace('{items}', json.dumps(items, ensure_ascii=False)))


def build_expand_prompt(name):
    return load_text('ai_category_prompt.txt').replace('{category}', name)


def build_more_queries_prompt(category, used):
    return (load_text('ai_more_queries_prompt.txt').replace('{category}', category.get('name') or '')
            .replace('{description}', category.get('description') or '')
            .replace('{used}', json.dumps(used[-120:], ensure_ascii=False)))


def _clean(v, limit):
    return ' '.join(str(v or '').split())[:limit]


def parse_results(content, ids):
    """JSON modelu → {id: {ok, title, short_description, reason}} tylko dla znanych id."""
    data = _json_object(content)
    rows = data.get('results') if isinstance(data, dict) else None
    if not isinstance(rows, list):
        raise ValueError('brak listy results')
    out, wanted = {}, set(ids)
    for r in rows:
        if not isinstance(r, dict):
            continue
        rid = str(r.get('id', ''))
        if rid not in wanted or rid in out:
            continue
        ok = r.get('ok')
        if ok in (1, True, '1', 'true'):
            ok = True
        elif ok in (0, False, '0', 'false'):
            ok = False
        else:
            continue
        reason = _clean(r.get('reason'), 300)
        if not reason:
            continue
        out[rid] = {
            'ok': ok,
            'group': _clean(r.get('group'), 2).upper(),
            'title': _clean(r.get('title'), 200),
            'short_description': _clean(r.get('short_description'), 300),
            'reason': reason,
            # Lokal (sala, restauracja, hotel…) przyjęty tylko z cytatem o własnej
            # rozrywce dla gości; cytat sprawdza kod (pipeline, filters.quote_in).
            'venue': r.get('venue') in (1, True, '1', 'true'),
            'evidence': _clean(r.get('evidence'), 300),
        }
    return out


def _json_object(content):
    m = re.search(r'\{.*\}', content or '', re.DOTALL)
    if not m:
        raise ValueError('brak JSON w odpowiedzi')
    return json.loads(m.group())


PKD_RE = re.compile(r'^\d{2}\.\d{2}\.[A-Z]$')


def parse_category(content):
    """Rozwinięcie kategorii: {description, queries[], pkd[]} sprawdzone w kodzie."""
    data = _json_object(content)
    desc = _clean(data.get('description'), 800)
    queries, seen = [], set()
    for q in data.get('queries') or []:
        q = _clean(q, 120)
        if q and q.lower() not in seen:
            seen.add(q.lower())
            queries.append(q)
    pkd = []
    for code in data.get('pkd') or []:
        code = str(code).strip().upper().replace(' ', '')
        if re.fullmatch(r'\d{4}[A-Z]', code):
            code = f'{code[:2]}.{code[2:4]}.{code[4]}'
        if PKD_RE.fullmatch(code) and code not in pkd:
            pkd.append(code)
    if not desc or len(queries) < 3:
        raise ValueError('za mało danych w rozwinięciu kategorii')
    return {'description': desc, 'queries': queries[:40], 'pkd': pkd[:8]}


def parse_more_queries(content, used):
    """Nowe frazy: bez powtórzeń względem użytych (bez wielkości liter i odstępów)."""
    data = _json_object(content)
    seen = {' '.join(str(q).lower().split()) for q in used}
    out = []
    for q in data.get('queries') or []:
        q = _clean(q, 120)
        key = q.lower()
        if q and key not in seen:
            seen.add(key)
            out.append(q)
    if len(out) < 3:
        raise ValueError('za mało nowych fraz')
    return out[:30]


class Classifier:
    def __init__(self, db, client, stats=None):
        self.db = db
        self.client = client
        self.stats = stats

    async def _call(self, prompt):
        try:
            result = await deepseek(self.db, self.client, prompt, service='marketing', max_tokens=cfg('AI_MAX_TOKENS', 6000))
            return 200, json.dumps(result, ensure_ascii=False), None
        except BudgetUnavailable:
            return 402, None, 'local_budget'
        except ProviderUnavailable as error:
            return 503, None, str(error)

    async def _cooldown(self, name, seconds, msg):
        await self.db.rpc('set_ai_provider_cooldown', {'p_name': name, 'p_seconds': seconds, 'p_error': msg[:500]})

    async def _ask(self, prompt, parse):
        """Odpowiedź DeepSeeka po parse(); None = DeepSeek wyłączony albo
        zablokowany limitem, {} = chwilowy błąd (ponowić później)."""
        available = await self.db.rpc('get_available_ai_providers')
        rows = available if isinstance(available, list) else [available] if available else []
        if not any(isinstance(p, dict) and p.get('name') == PROVIDER for p in rows):
            return None
        if self.stats:
            self.stats['ai_calls'] += 1
        status, content, err = await self._call(prompt)
        if status == 402 and err == 'local_budget':
            return None  # Własny budżet Marketingu nie blokuje budżetu pytań.
        if status == 200:
            try:
                return parse(content)
            except (ValueError, json.JSONDecodeError) as e:
                log.error(f'DeepSeek: niepoprawna odpowiedź ({e})')
                await self._cooldown(PROVIDER, 30, f'zły format: {e}')
                return {}
        if any(w in str(err) for w in QUOTA_WORDS):
            await self._cooldown(PROVIDER, cfg('PROVIDER_COOLDOWN_QUOTA', 86400), f'limit ({status}): {err}')
            return None
        if status == 429:
            await self._cooldown(PROVIDER, cfg('PROVIDER_COOLDOWN_SECONDS', 60), f'429: {err}')
        else:
            await self._cooldown(PROVIDER, cfg('PROVIDER_COOLDOWN_LONG', 300), f'błąd {status}: {err}')
        log.info(f'DeepSeek: błąd {status}')
        return {}

    async def classify(self, items, category):
        """{id: wynik} albo None (brak dostawców) / {} (chwilowo niedostępni)."""
        ids = [i['id'] for i in items]
        res = await self._ask(build_prompt(items, category), lambda c: parse_results(c, ids))
        if res:
            log.info(f'Ocena „{category.get("name")}”: {len(res)}/{len(ids)} pozycji')
        return res

    async def expand(self, name):
        """Rozwinięcie kategorii albo None/{} jak wyżej."""
        return await self._ask(build_expand_prompt(name), parse_category)

    async def more_queries(self, category, used):
        """Nowe frazy po wyczerpaniu dotychczasowych; lista, None albo {} jak wyżej."""
        return await self._ask(build_more_queries_prompt(category, used), lambda c: parse_more_queries(c, used))
