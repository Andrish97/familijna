"""Pobranie strony w budżecie (bez Chromium): tylko dla kandydata ocenionego
przez AI jako dobry, ze stroną www, bez e-maila. Strona główna, potem
podstrony kontaktu, do pierwszego znalezionego adresu."""

import re
from urllib.parse import urljoin, urlparse

import httpx

from . import filters
from .config import cfg, load_lines
from .question_bank import public_address

CONTACT_PATHS = load_lines('subpage_paths.txt')
MAX_BYTES = 600_000
_TAG_RE = re.compile(r'<(script|style)[^>]*>.*?</\1>|<[^>]+>', re.DOTALL | re.IGNORECASE)


async def _get(client, url):
    """Pobranie z adresem przypiętym do publicznego IP; każde przekierowanie
    sprawdzane od nowa (E24 R13: bez dostępu do sieci Dockera i adresów prywatnych)."""
    try:
        for _ in range(5):
            parsed, address = await public_address(url)
            pinned = httpx.URL(url).copy_with(host=address)
            async with client.stream('GET', pinned, timeout=cfg('TIMEOUT_SCRAPE', 12), follow_redirects=False,
                                     extensions={'sni_hostname': parsed.hostname},
                                     headers={'Host': parsed.netloc, 'User-Agent': 'Mozilla/5.0 (compatible; FamilijnaLeadFinder/2.0)'}) as r:
                if r.status_code in (301, 302, 303, 307, 308):
                    url = urljoin(url, r.headers.get('location', ''))
                    continue
                if r.status_code != 200 or 'html' not in r.headers.get('content-type', 'text/html'):
                    return None
                body = b''
                async for chunk in r.aiter_bytes():
                    body += chunk
                    if len(body) > MAX_BYTES:
                        break
                return body.decode(r.encoding or 'utf-8', errors='replace')
        return None
    except (httpx.HTTPError, UnicodeDecodeError, ValueError, OSError):
        return None


async def find_emails(client, url, max_pages=3):
    """Zwraca (e-maile, liczba pobranych stron)."""
    parsed = urlparse(url)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname:
        return [], 0
    root = f'{parsed.scheme}://{parsed.hostname}/'
    pages = [root] + [urljoin(root, p) for p in CONTACT_PATHS]
    fetched = 0
    for page in pages[:max_pages]:
        raw = await _get(client, page)
        fetched += 1
        if not raw:
            continue
        emails = filters.extract_emails(_TAG_RE.sub(' ', raw), raw)
        if emails:
            return emails, fetched
    return [], fetched
