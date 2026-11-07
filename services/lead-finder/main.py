"""
Lead Finder 3 — kategorie z panelu, wyszukiwarka i CEIDG równolegle, ocena
AI paczkami. Plan: familijna-server/docs/lead-finder-nowy-plan.md. Wynik:
marketing_verified_contacts (z kategorią); endpointy jak dla panelu.
"""

import asyncio
import hmac
import logging
import os
import uuid
from typing import Optional

import dns.asyncresolver
import dns.exception
import dns.resolver
import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from lf.config import cfg
from lf.db import Supabase
from lf.logging_sink import DbLogHandler
from lf.filters import FREEMAIL_DOMAINS
from lf.pipeline import Engine
from lf.sources.ceidg import Ceidg
from lf.question_bank import QuestionBank, router_for
from lf.resources import bind_db

logger = logging.getLogger('lead_finder')
logger.setLevel(logging.INFO)
_handler = logging.StreamHandler()
_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
logger.addHandler(_handler)

SUPABASE_URL = os.getenv('LEAD_FINDER_SUPABASE_URL', 'http://kong:8000')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY', os.getenv('SERVICE_ROLE_KEY', ''))
SEARXNG_URL = os.getenv('SEARXNG_URL', 'http://searxng:8080')
TELEGRAM_BOT_TOKEN = os.getenv('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT_ID = os.getenv('TELEGRAM_CHAT_ID', '')
LEAD_FINDER_API_KEY = os.getenv('LEAD_FINDER_API_KEY', '').strip()
ADMIN_ORIGIN = 'https://admin.familijna.app'

http = httpx.AsyncClient(timeout=60)
db = Supabase(SUPABASE_URL, SUPABASE_KEY)
# Limity SearXNG i DeepSeeka wspólne z drugą usługą (dzierżawy w bazie, migracja 518).
bind_db(db)


_db_handler = DbLogHandler(db)
_db_handler.setLevel(logging.INFO)
_db_handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
logger.addHandler(_db_handler)


async def notify(text):
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return
    try:
        await http.post(f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage',
                        json={'chat_id': TELEGRAM_CHAT_ID, 'text': text, 'parse_mode': 'HTML'})
    except httpx.HTTPError as e:
        print(f'[SERVER] Telegram: {e}')


_mx_cache = {}


async def mx_check(domain):
    """False tylko, gdy domena na pewno nie przyjmuje poczty (brak domeny / brak MX i A)."""
    domain = domain.lower()
    if domain in FREEMAIL_DOMAINS:
        return True
    if domain in _mx_cache:
        return _mx_cache[domain]
    ok = True
    resolver = dns.asyncresolver.Resolver()
    resolver.lifetime = 4
    try:
        await resolver.resolve(domain, 'MX')
    except dns.resolver.NXDOMAIN:
        ok = False
    except dns.resolver.NoAnswer:
        try:
            await resolver.resolve(domain, 'A')
        except (dns.resolver.NXDOMAIN, dns.resolver.NoAnswer):
            ok = False
        except dns.exception.DNSException:
            pass
    except dns.exception.DNSException:
        pass  # timeout / brak serwera DNS — nie odrzucamy
    _mx_cache[domain] = ok
    return ok


engine = Engine(db, http, SEARXNG_URL,
                ceidg=Ceidg(http, os.getenv('CEIDG_API_KEY', '').strip(), cfg('CEIDG_DETAIL_DELAY', 4)),
                mx_check=mx_check, notify=notify)


def require_api_key(authorization: Optional[str] = Header(default=None)):
    # Ten sam klucz co sekret Workera LEAD_FINDER_API_KEY. Bez klucza w env: odmowa.
    if not LEAD_FINDER_API_KEY:
        raise HTTPException(503, 'API niekonfigurowane')
    given = (authorization or '').encode('utf-8')
    if not hmac.compare_digest(given, f'Bearer {LEAD_FINDER_API_KEY}'.encode('utf-8')):
        raise HTTPException(401, 'Brak autoryzacji')


app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=[ADMIN_ORIGIN], allow_methods=['GET', 'POST'],
                   allow_headers=['Authorization', 'Content-Type'])

# Rola kontenera (podział: familijna-server/docs/wyszukiwarka-podzial-plan.md):
# leads = kontakty (Marketing), questions = pytania i aktualizacje demo,
# all = obie (jeden kontener). Limity SearXNG/DeepSeeka wspólne przez bazę.
SERVICE_ROLE = os.getenv('SERVICE_ROLE', 'all').strip() or 'all'
if SERVICE_ROLE not in ('leads', 'questions', 'all'):
    raise SystemExit(f'Nieznana rola SERVICE_ROLE={SERVICE_ROLE!r}')
RUN_LEADS = SERVICE_ROLE in ('leads', 'all')
RUN_QUESTIONS = SERVICE_ROLE in ('questions', 'all')
logger.info('Rola usługi: %s', SERVICE_ROLE)

question_bank = QuestionBank(db, http, SEARXNG_URL, LEAD_FINDER_API_KEY)
if RUN_QUESTIONS:
    app.include_router(router_for(question_bank, require_api_key))


@app.on_event('startup')
async def start_question_worker():
    if RUN_QUESTIONS:
        question_bank.task = asyncio.create_task(question_bank.worker())
        question_bank.demo_task = asyncio.create_task(demo_updates())
    if RUN_LEADS:
        engine.supervisor = asyncio.create_task(engine.supervise())


async def demo_updates():
    while True:
        try:
            result = await db.rpc('admin_demo_apply_next')
            await asyncio.sleep(0.2 if result and result.get('status') == 'updated' else 3)
        except asyncio.CancelledError:
            raise
        except Exception:
            await asyncio.sleep(15)


@app.on_event('shutdown')
async def stop_question_worker():
    if getattr(engine, 'supervisor', None):
        # Anulowanie oddaje dzierżawę trwającego przebiegu (run_claimed) — czekamy na to.
        engine.supervisor.cancel()
        try:
            await asyncio.wait_for(engine.supervisor, 10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    if getattr(question_bank, 'demo_task', None):
        question_bank.demo_task.cancel()
    if getattr(question_bank, 'task', None):
        question_bank.task.cancel()
        try:
            await question_bank.task
        except asyncio.CancelledError:
            pass


@app.post('/api/search-runs', dependencies=[Depends(require_api_key), Depends(lambda: _role('leads'))])
async def start_search(target_count: int = 50):
    # Przebieg w bazie (migracja 519): przejmuje go pętla engine.supervise —
    # także po restarcie usługi, gdy wygaśnie dzierżawa poprzedniego procesu.
    if engine.status != 'idle':
        raise HTTPException(400, f'System zajęty ({engine.status})')
    run_id = str(uuid.uuid4())
    created = await db.rpc('mk_run_create', {'p_run': run_id, 'p_target': max(1, min(1000, target_count))})
    if not isinstance(created, dict):
        raise HTTPException(400, 'System zajęty (trwa inny przebieg)')
    engine.status = 'starting'
    engine.run_id = run_id
    engine.kick.set()
    return {'ok': True, 'run_id': run_id}


@app.get('/api/search-runs/status', dependencies=[Depends(require_api_key), Depends(lambda: _role('leads'))])
async def status():
    s = engine.snapshot()
    if s['status'] in ('idle', 'lost'):
        # Przebieg czeka na przejęcie (np. tuż po restarcie usługi).
        active = await db.rpc('mk_run_active')
        if isinstance(active, dict) and active.get('run_id'):
            s.update({'status': 'starting', 'run_id': active['run_id'], 'target': active.get('target', 0),
                      'verified': active.get('verified', 0)})
    s['ceidg'] = engine.ceidg.enabled
    return s


def _role(needed):
    if needed == 'leads' and not RUN_LEADS:
        raise HTTPException(404, 'Kontakty obsługuje inny kontener')


async def _command(run_id, command, allowed, new_status):
    active = await db.rpc('mk_run_active')
    if not isinstance(active, dict) or active.get('run_id') != run_id:
        raise HTTPException(404, 'Nieznane zlecenie')
    if engine.run_id == run_id and engine.status not in allowed:
        raise HTTPException(400, f'Nie można: stan {engine.status}')
    result = await db.rpc('mk_run_command', {'p_run': run_id, 'p_command': command})
    if not isinstance(result, str):
        raise HTTPException(400, 'Nie można zmienić stanu zlecenia')
    if engine.run_id == run_id and engine.status in allowed:
        engine.status = new_status
    return {'ok': True, 'status': new_status}


@app.post('/api/search-runs/{run_id}/pause', dependencies=[Depends(require_api_key), Depends(lambda: _role('leads'))])
async def pause(run_id: str):
    return await _command(run_id, 'pause', ('running',), 'paused')


@app.post('/api/search-runs/{run_id}/resume', dependencies=[Depends(require_api_key), Depends(lambda: _role('leads'))])
async def resume(run_id: str):
    return await _command(run_id, 'resume', ('paused',), 'running')


@app.post('/api/search-runs/{run_id}/cancel', dependencies=[Depends(require_api_key), Depends(lambda: _role('leads'))])
async def cancel(run_id: str):
    return await _command(run_id, 'cancel', ('running', 'paused', 'starting'), 'cancelled')


@app.get('/health')
async def health():
    return {'status': 'ok'}


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8001)
