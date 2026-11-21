# Cloudflare – Familijna

## Behavior (Worker)

### 1) Rozdzielenie administracji
Panel i jego API działają w osobnym, prywatnym systemie. Ten Worker nie
serwuje plików panelu ani nie przekierowuje do niego. Na publicznych hostach
stare ścieżki panelu są blokowane. Dokumentacja administracji jest w prywatnym
repozytorium serwera.

### 2) familijna.app + www.familijna.app
- Normal app behavior.
- `/admin` and its subpaths are blocked on public hosts. The panel is served on its own subdomain.
- If origin returns 404 for HTML, worker serves `/404.html` (custom 404).
- Maintenance gate blocks everything (503 + `/maintenance`), unless bypass cookie.

### 3) Other subdomains (*.familijna.app)
- Known service hosts (`api`, `panel`, `supabase`) are passed through.
- `panel` and `supabase` can point to external origins; keep DNS proxied in Cloudflare.
- Unknown hosts:
  - Maintenance OFF → custom `/404.html`
  - Maintenance ON → `/maintenance` (503)

### Public endpoint
- `GET /maintenance-state.json` → `{ enabled:boolean, mode:"off|message|returnAt|countdown", returnAt:string|null }`

### Pliki strony (Workers Static Assets)
Worker ma binding `ASSETS` (`wrangler.toml` → `[assets]`, katalog
`_site_public` z `npm run build:site` = `scripts/version-assets.js` +
`scripts/build-public.cjs`). `run_worker_first = true`: każde żądanie przechodzi
najpierw przez Worker (bramka przerwy, blokady, SSR, nagłówki), a pliki pobiera
on sam przez `env.ASSETS.fetch` w `fetchWithOrigin()` (`src/lib/origin/origin.js`).
`html_handling = "none"` — dokładne pliki, katalog `/x/` → `/x/index.html`
robi Worker. Bez bindingu (np. wdrożenie bez sekcji `[assets]`) Worker
pobiera pliki z GitHub Pages jak wcześniej (`ORIGIN_RESOLVE`) — to droga powrotu.
Cache: URL z `?v=` (wersja z treści pliku) → `max-age=31536000, immutable`,
bez `?v=` → `max-age=600`, HTML → `no-store` (`src/lib/origin/assets.js`).

### Pretty URLs (bez .html)
Każda strona ma `<nazwa>/index.html` w artefakcie Pages. Worker pobiera ten
plik wewnętrznie dla tras `/nazwa` oraz `/nazwa/`, zachowując parametry.
Nie wymaga to przekierowania przeglądarki. Linki aplikacji używają `/nazwa/`.

**Aktualne mapowania w workerze:**
- `/games/` → Pages `/games/index.html`; analogicznie dla pozostałych znanych stron.
- Brak fallbacków zasobów pod dawnymi ścieżkami oraz brak przekierowania `/builder`.
- Frontend jest publikowany z `web/`; ta nazwa nie jest częścią adresów URL.

### Publiczny katalog Gier Społeczności
`/marketplace/` i `/marketplace/game/<slug>` otrzymują ten sam pełny HTML
niezależnie od User-Agent. Worker składa istniejący szablon Pages wspólnym
rendererem `web/marketplace/js/public.js`; pytania są w dotychczasowym oknie.
Przeglądarka przejmuje HTML bez ponownego pobierania listy. Zwykłe linki
oraz odczyt katalogu i pytań działają również bez JavaScriptu.

Źródłem listy i sitemap jest `market_public_catalog` (migracja 485),
szczegółów — `market_game_by_slug`. Worker używa wyłącznie istniejącego
`SUPABASE_ANON_KEY`; do HTML trafiają tylko jawnie dozwolone publiczne pola
opublikowanych gier. Prywatny podgląd `?game=<id>` pozostaje chroniony RPC
użytkownika i ma `noindex`. Niepubliczny slug zwraca 404, awaria API/szablonu
503 z `Retry-After`. HTML i sitemap mają `no-store`; nie ma R2 ani osobnych
odcisków. Bramka przerwy technicznej obejmuje katalog i gry.

Testy Workera: `npm test` w `cloudflare/maintenance-worker`.
Regresja przeglądarki (PL/EN/UK, 390/1400 px, JS/bez JS): po instalacji
zależności `tests` i Workera uruchomić z głównego repo
`node cloudflare/maintenance-worker/test/market-browser.mjs`.

### Nagłówki stron
Worker dodaje do odpowiedzi HTML (www, apex, settings, nieznane subdomeny; bez usług panel/supabase/api/leads): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy: frame-ancestors 'self'`, `Permissions-Policy` i `Content-Security-Policy-Report-Only` (lista źródeł w `src/lib/core/security-headers.js`).

Paczka SEO/HTTPS 2026-10-24: CSP Workera dodatkowo obejmuje `object-src 'none'`,
`base-uri 'self'` i `form-action 'self'`. HTTP na hostach www/apex/admin jest
przekierowywany 308 na HTTPS przed obsługą sesji i API. Odpowiedzi HTTPS tych
hostów mają HSTS `max-age=604800` (bez subdomen/preload; istniejąca silniejsza
polityka jest zachowana). Reguła strefy nadpisująca CSP wymaga zmiany w panelu
Cloudflare — szczegóły i kolejność publikacji w
[`familijna-server/docs/seo-bezpieczenstwo-plan.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/seo-bezpieczenstwo-plan.md).

Strona główna: Worker tłumaczy HTML, metadane i JSON-LD zgodnie z `?lang=en|uk`
dla wszystkich odwiedzających. `/` pozostaje wersją PL; canonical i
Content-Language odpowiadają wersji. Unity: `node --test tests/unit/homeSeo.test.js`;
test silnika Worker: `cd cloudflare/maintenance-worker && npm ci && npm test`.

Publiczne dokumenty (wdrożone 2026-10-25):
`/manual/` oraz `/privacy` (także warianty ze slash i `index.html`) otrzymują
pełny HTML PL/EN/UK z gotowych modułów treści i słowników. Odczyt dokumentu
nie wymaga Supabase ani sesji; brak podziału według User-Agent. Wskazówki
używają tego samego renderera co klient, `?ch=` wybiera rozdział; nieznany
rozdział daje 404. Canonical/hreflang pomijają kontekst `from`, `ret` i filtry.
GET/HEAD zwracają zgodne statusy i język. Sitemap zawiera wszystkie publiczne
rozdziały i wersje językowe prywatności. `/404.html` ma 404/noindex także
bezpośrednio; samodzielne `/maintenance/` jest noindex, a bramka przerwy
zachowuje 503/Retry-After. Bez nowego bucketa, bindingu i zmian SSR gier.

### Dostęp i stan przerwy
`workers_dev = false` i `preview_urls = false`: wdrożenie działa tylko przez
trasy domeny. Panel zapisuje stan w tej samej przestrzeni MAINT_KV, z której
czyta publiczny Worker. Podpis ciasteczka obejścia i jego klucz są wspólne;
format i ważność pozostają zgodne. Publiczny Worker nie udostępnia API zapisu
przerwy ani wystawiania ciasteczka. Zmiana stanu może uwzględniać dotychczasowy
30-sekundowy cache odczytu KV.

### Worker vars/secrets
- `SUPABASE_URL` (var) → base URL to Supabase (`https://api.familijna.app`)
- `SUPABASE_SERVICE_ROLE_KEY` (secret) → poczta, zasoby użytkowników, sprzątanie i wypożyczanie kont testowych
- `ADMIN_BYPASS_TOKEN` (secret) → klucz HMAC ciasteczka obejścia (sama wartość nie trafia do przeglądarki; zmiana unieważnia wydane ciasteczka)

Example:
- `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
- `wrangler secret put ADMIN_BYPASS_TOKEN`

---

## Checklist (quick test)

### Basic routing
1. `https://familijna.app/` → main site
2. `https://www.familijna.app/` → main site
3. `https://www.familijna.app/admin/` → **404**
4. `https://admin.familijna.app/` → admin panel
5. `https://admin.familijna.app/admin.html` → **404**

### Maintenance
1. Wyłącznie właściciel włącza przerwę w panelu; agent nie zmienia stanu produkcji do testów.
2. `https://familijna.app/` → maintenance page (503)
3. `https://www.familijna.app/` → maintenance page (503)
4. Unknown subdomain (e.g. `https://x.familijna.app/`) → maintenance page (503)
5. `https://admin.familijna.app/` → still works

### Bypass
1. In settings panel click **Bypass ON**
2. `https://familijna.app/` should open normally for this browser
3. Click **Bypass OFF** → maintenance applies again

### Custom 404
1. `https://familijna.app/this-does-not-exist` → custom 404 page
2. `https://x.familijna.app/` (unknown host) → custom 404 (when maintenance OFF)

---

## DNS (recap)
- `@` (apex): A records for GitHub Pages
- `www`: CNAME → `andrish97.github.io` (Proxy ON)
- `*`: CNAME → `andrish97.github.io` (Proxy ON)
- `panel`: CNAME → your panel origin (Proxy ON if routed through worker)
- `supabase`: CNAME → your supabase origin (Proxy ON if routed through worker)
- `api`: CNAME → your API origin (Proxy ON if routed through worker)


Regresja przejęcia HTML Wskazówek: po `npm ci` w `tests` i w katalogu
Workera uruchomić z głównego repo
`node cloudflare/maintenance-worker/test/public-browser.mjs`.
Celowo wstrzymuje import treści; sprawdza wczesne linki HTML i zachowanie
istniejącego obrazu po starcie JS przy 390/1400 px. Zwykły `npm test` Workera
pozostaje bez zależności od Playwrighta.
