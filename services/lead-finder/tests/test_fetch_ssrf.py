"""E24 R13: pobieranie stron kandydatów nie wychodzi do adresów prywatnych/Dockera."""
import asyncio

import httpx

from lf import fetch


def test_private_and_docker_addresses_refused():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(200, html='<p>a@b.pl</p>')

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            for url in ('http://127.0.0.1/', 'http://meta:8080/', 'http://10.0.0.5/', 'http://[::1]/', 'http://localhost/'):
                assert await fetch._get(client, url) is None
    asyncio.run(run())
    assert calls == []


def test_redirect_to_private_address_refused(monkeypatch):
    seen = []

    async def fake_public(url):
        from urllib.parse import urlsplit
        p = urlsplit(url)
        if p.hostname == 'firma.example':
            return p, '93.184.216.34'
        raise ValueError('unsafe_address')

    monkeypatch.setattr(fetch, 'public_address', fake_public)

    def handler(request):
        seen.append(request.headers.get('host'))
        return httpx.Response(302, headers={'location': 'http://meta:8080/query'})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            assert await fetch._get(client, 'http://firma.example/') is None
    asyncio.run(run())
    assert seen == ['firma.example']
