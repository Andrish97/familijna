# Familijna — zasady pracy (AGENTS.md — dla Codexa; treść = CLAUDE.md)

Rozmawiamy po polsku. Kod: vanilla JS (moduły ES z `?v=`, wersje
przepisuje CI), Supabase, Cloudflare Worker. Strony w `web/`.

## Zanim zaczniesz

- **Dokumentacja wdrożeń — prywatne repo `Andrish97/familijna-server`,
  katalog `docs/` (decyzja użytkownika 2026-10-28).** Tam są: przekazanie,
  `wdrozenia.md` (kolejka, Dziennik), plany etapów z sekcjami „Decyzje”, audyty,
  przewodniki dla agentów (silnik stylów, wzorce UI, zrzuty) i PROGRESS. Sesja
  potrzebuje tego repo (dodać, sklonować obok: `/home/user/familijna-server`).
  Wpisy w Dzienniku i decyzje commitować w `familijna-server`. W publicznym
  `docs/` zostaje tylko to, czego używa kod, testy lub CI: `docs/podrecznik/`
  (źródło Wskazówek), `docs/sql/` (lokalny Postgres, testy SQL w CI),
  `docs/game-state-machine.md` i `docs/nawigacja-mapy.md` (generowane,
  pilnowane testami), `docs/demo-answer-replacements.json`. Nowych planów,
  audytów ani dzienników nie dodawać do publicznego repo. Ścieżka
  `familijna-server/docs/X` w tym repo = plik `docs/X` w repo prywatnym.

- **Przekazanie z 2026-10-10:** [`familijna-server/docs/przekazanie.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/przekazanie.md) — co
  zrobione, aktualny następny krok i otwarte sprawy.

- Przeczytaj [`familijna-server/docs/wdrozenia.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/wdrozenia.md) — kolejka etapów,
  stan, zasady i odnośniki do sekcji z decyzjami. To jest plan; rozmowa
  nim nie jest.
- Decyzje użytkownika zapisuj od razu w sekcji „Decyzje” właściwego
  dokumentu (`familijna-server/docs/nawigacja-mapa-plan.md`, `familijna-server/docs/blokady-zasobow.md`,
  `familijna-server/docs/ujednolicenie-wygladu.md`, `familijna-server/docs/e19-znajomi-plan.md`, `familijna-server/docs/ankiety-refaktor.md`).
  Podręcznik (E13): `familijna-server/docs/podrecznik-plan.md` — plan uzgodniony 2026-10-20.
  Kopie Gier/Logo: `familijna-server/docs/udostepnianie-kopii-plan.md` (E19C).
  Test accounts — role i lease (E25): `familijna-server/docs/konta-testowe-plan.md`.
  Diagnostyka rozgrywek Control 2 per sesja: `familijna-server/docs/diagnostyka-sesji-plan.md`.
  Control 2 na słabym łączu (badanie 2026-10-25, przepływ akcji): `familijna-server/docs/control2-slabe-lacze.md`.
  Podział tłumaczeń na części (E27): `familijna-server/docs/tlumaczenia-podzial-plan.md`.
  Sprzątanie bazy (audyt 2026-10-23, do decyzji): `familijna-server/docs/audyt-sprzatania-bazy.md`.
  Podręcznik (E13): plan rozdziałów `familijna-server/docs/podrecznik-plan.md`.
  Lead Finder 2 (nowy system bez odwiedzania stron): `familijna-server/docs/lead-finder-nowy-plan.md`.
  Podział Lead Findera na kontakty i pytania (2026-11-07): `familijna-server/docs/wyszukiwarka-podzial-plan.md`.
- **Kompletna mapa stron i nawigacji (decyzja 2026-10-17):** dodanie,
  usunięcie, zmiana adresu albo zachowania dowolnej strony wymaga równoczesnej
  aktualizacji centralnej mapy nawigacji `web/shared/js/core/nav-map.js`
  (`PAGES` i `pageIdForPath`), dokumentacji tras oraz powiązanych testów i
  generatorów, jeśli ich dotyczy. Dotyczy to także auth/sesji, przekierowań,
  urządzeń, powrotu, deep linków i stanów strony. Każda istniejąca trasa HTML
  musi być ujęta w inwentarzu mapy. Trasy techniczne, tokenowe, serwisowe,
  administracyjne i urządzeń, które nie należą do zwykłej nawigacji, wpisuj
  jawnie jako samodzielne z opisem ich roli i powodem wyłączenia z nawigacji;
  nie pomijaj ich po cichu. Zasada i audyt: `familijna-server/docs/nawigacja-mapa-plan.md`,
  `familijna-server/docs/audyt-initpage-trasy.md`.

## Cykl wdrożenia (decyzja 2026-10-10) — każda zmiana potwierdzona testem na produkcji

1. **Baza najpierw, bezpiecznie**: migracja dodająca (zgodna wstecz z
   działającym kodem) — lokalny Postgres + test SQL → push na `main` →
   sprawdzić log zastosowania (`supabase/migration_logs/latest.log`).
2. **Testy kodu z brancha na produkcyjnej bazie**: e2e z
   `serveBranchCode` (`tests/e2e/helpers/branch-code.js` — strony i cały
   front z plików brancha, baza/Worker/konta produkcyjne), workflow uruchomiony
   na branchu (`REF=<branch>`). Nowy katalog strony dopisać do `CODE_DIRS`.
3. **Wdrożenie Pages** (push na `main`) dopiero po zielonych testach z pkt 2.
4. **Testy kontrolne na produkcji** po wdrożeniu — te same, punktowe spece.
5. Etap jest zrobiony dopiero po pkt 4 (wpis w Dzienniku z numerem przebiegu).

Testy zawsze **punktowo** (wybrane spece / `--grep` na konkretne testy),
nigdy cały zestaw — szybciej; przy niejasnym błędzie dołożyć logi
szczątkowe (diagnostyka `[e2e-diag]`, zrzuty) zamiast puszczać więcej testów.
Migracje zmieniające zachowanie — razem z kodem, który ich wymaga (pkt 2
na branchu przed migracją jest wtedy niemożliwy: przetestować na lokalnym
Postgresie, wdrożyć razem i od razu testy kontrolne).

**Szybsze e2e (decyzja użytkownika 2026-10-22):**
- **Kilka speców w jednym przebiegu:** `spec_filter` trafia wprost do
  `npx playwright test`, więc podawaj kilka plików oddzielonych spacją
  (np. `spec_filter="e2e/a.spec.js e2e/b.spec.js"`) z `max_failures` > 1, żeby
  jeden błąd nie zatrzymał reszty — oszczędza przygotowanie maszyny na każdym
  przebiegu. Razem idą spece bez skrzynek (`@mailbox`) i bez kont na stałe;
  spece ze skrzynkami, kontami na stałe (test11/12/15) i ciężkie (Control,
  wyświetlacz) — osobno.
- **Nie powtarzać zielonych:** spec zielony na danym kodzie nie jest puszczany
  ponownie, jeśli późniejsze zmiany (scalenie, poprawka) nie dotknęły plików,
  które testuje. Przed kolejnym przebiegiem porównać diff z plikami speca.
- **Równoległe przebiegi:** spece z wypożyczaniem kont (`helpers/e2e-test`)
  idą równolegle bez umawiania się — konta, skrzynki i zasoby `mail`/`heavy`
  rozdziela lease; workflow nie przydziela kont.
- Powód zasobów `mail`/`heavy`: wspólne limity wysyłki i mały serwer bazy.
- **Mniej e2e przy zmianach wyglądu (decyzja użytkownika 2026-10-22):**
  logikę pokrywają testy unit i zrzuty (`scripts/screens`); e2e tylko na 2–3
  stronach najbardziej dotkniętych zmianą, w jednym zbiorczym przebiegu,
  równolegle wolno (lease). Kontrola produkcji przy zmianach wyglądu/UI bez
  bazy, logowania i bezpieczeństwa: jeden szybki przebieg tych samych speców.
  Pełny zestaw kontrolny tylko przy migracjach, logowaniu, poczcie
  i bezpieczeństwie.

## Wygląd (decyzja 2026-10-10)

- **Silnik stylów — jak korzystać (E23):** [`familijna-server/docs/silnik-stylow-uzycie.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/silnik-stylow-uzycie.md)
  — pliki i warstwy, tokeny, katalog elementów i modułów JS, zasady (bez
  `!important`, bez kolorów i stylów inline, Android), kroki dla nowej strony
  i nowego elementu. Nowa strona składa elementy silnika; plik strony = układ.
- Zasady: **symetria, równowaga i spójność** — elementy podobne funkcjonalnie
  (kafle, wiersze, paski akcji, okna, karty, filtry, puste stany) wyglądają
  i zachowują się tak samo na wszystkich stronach. Źródło wzorców:
  [`familijna-server/docs/wzorce-ui.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/wzorce-ui.md) (etap ujednolicenia E18; reszta
  poprawek wstrzymana — lista w `familijna-server/docs/przekazanie.md`).
- **Zrzuty po wykonaniu (decyzja użytkownika 2026-10-11):** zmiany wyglądu
  dokumentować zrzutami z przykładowymi danymi (telefon 390 px i komputer
  1400 px). Kontynuować bez czekania na ocenę lub zatwierdzenie użytkownika.
- **System zrzutów `scripts/screens/` (decyzja użytkownika 2026-10-20):**
  każda zmiana strony w `web/` kończy się zrzutem tej strony. Najpierw
  dopasować scenę w `scripts/screens/scenes.cjs` (nowa strona/stan/okno =
  nowa scena) i dane w `scripts/screens/data/`, gdy strona potrzebuje nowych
  danych lub RPC (runner wypisuje „brak danych: rpc:…/table:…”). Potem
  `node scripts/screens/run.cjs --changed` (albo `--scenes=…`), obejrzeć
  zrzuty i pokazać je użytkownikowi. Prawdziwy kod strony, atrapa tylko
  warstwy Supabase; nigdy gałęzi „tylko dla zrzutów” w kodzie aplikacji.
  Instrukcja: [`familijna-server/docs/zrzuty-system.md`](https://github.com/Andrish97/familijna-server/blob/main/docs/zrzuty-system.md).

## Tok pracy

- **Aktualizacje postępu (decyzja użytkownika 2026-10-12):** podczas pracy
  częściej przekazywać krótkie, konkretne aktualizacje (około30–60 sekund):
  bieżąca zmiana/sprawdzenie, wynik i następny krok. Aktualizacja nie kończy
  pracy i nie zastępuje wykonania planu.

- **Nadrzędna zasada ciągłości (decyzja użytkownika 2026-10-12):** realizować
  uzgodniony plan do końca bez oczekiwania na kolejne „kontynuuj”. Pytanie
  o postęp, odpowiedź ze statusem, zakończenie paczki ani skrócenie kontekstu
  nie kończą pracy. Po krótkiej aktualizacji wracać do bieżącego zadania,
  a po jego zamknięciu przechodzić do następnego z kolejki. Stan odtwarzać
  z dokumentów repo; nie wymagać nowej rozmowy. Przerwać wyłącznie na
  wyraźne polecenie użytkownika, przy rzeczywistej blokadzie wykonania
  albo kluczowej decyzji architektonicznej bez wystarczających ustaleń.
  Nie deklarować pracy w tle, jeśli żaden proces faktycznie nie działa.

- **Środowisko Codexa (decyzja użytkownika 2026-10-11):** można wykonywać
  cięższe zadania lokalne, w tym przeglądarkowe podglądy, SQL i testy.
  Nie obowiązuje wcześniejsze ograniczenie dla Termuxa. Zachować punktowe
  E2E i wymagane bramki wdrożenia; nie mnożyć ciężkich procesów bez potrzeby.

- Zasady działania i kolejka: `familijna-server/docs/wdrozenia.md` (sekcje „Kolejka”,
  „Zasady działania”). Praca w tle bez pytania o zgodę.

- **Kontynuacja (decyzja użytkownika 2026-10-11):** zawsze kontynuować bez
  pytania, także po zakończeniu paczki. Zatrzymać się tylko przy kluczowej
  decyzji architektonicznej, której brak w ustaleniach. Manual zawsze na końcu.
- Najpierw branch roboczy, testy, potem push na `main`.
- **Stała zgoda na push na `main` (decyzja użytkownika 2026-11-08):** agent
  wypycha na `main` (migracje, Pages, panel admina) bez pytania o zgodę za
  każdym razem — bramki wdrożenia (testy, log migracji, kontrola produkcji)
  obowiązują dalej.
- Unit: `cd tests && node --test unit/*.test.js`.
- E2E: workflow `e2e-tests.yml` (workflow_dispatch) z niepustym
  `spec_filter` — nigdy całego zestawu (`scripts/agent-tools/e2e-seq.sh`). Spece z `tests/e2e/helpers/local-site.js`
  testują kod brancha; pozostałe chodzą po produkcji.
- **Test accounts (decyzja użytkownika 2026-10-22, E25):** role `standard`,
  `noaccount`, `disposable`, `dedicated`, `guest`; zasoby `mail`, `heavy`.
  `dedicated` = konto przypisane na stałe do jednej czynności (rejestr w
  `tests/README.md` „Dedicated accounts”); brak wolnych → prośba do użytkownika.
  Spec deklaruje potrzeby (`test.use({ needs })` na górze pliku, wzór
  `tests/e2e/e2e-lease.spec.js`), worker
  wypożycza (lease) konta na wyłączność — równoległe przebiegi bez umawiania
  się. Nazwy `e2e.<role><NN>`, e-mail `e2e+<role><NN>@familiada.online`
  (jedna reguła Cloudflare `e2e@` + Subaddressing). Nazewnictwo po angielsku.
  Stare zasady (`test1`…`test17`, `testAccountUsername`, pula, `test_accounts`)
  wycofane — nie dopisywać nowych użyć. Zasady: `tests/README.md`
  „Test accounts”; plan i pakiety: `familijna-server/docs/konta-testowe-plan.md`.
- **Przepisywanie speców stopniowo (decyzja użytkownika 2026-10-22):** kto
  zmienia spec ze starymi kontami, przepisuje go na `helpers/e2e-test` w tym
  samym etapie (przewodnik: `tests/README.md` „Jak przepisać stary spec”);
  zapadka `unit/legacyTestAccounts.test.js` — przepisany plik usunąć
  z `unit/legacy-test-accounts.json`. Spece ze starymi kontami: jeden przebieg
  naraz jak dotąd. Konta `test1`…`test17` i reguły Cloudflare `testN@`
  usunięte (2026-10-22, migracja 463) — spece ze starymi kontami nie przejdą
  przed przepisaniem.
- **Poprawianie speców e2e (decyzja użytkownika 2026-10-24):** agent poprawia
  spec bez pytania, gdy test rozjechał się z zamierzoną zmianą (próg, tekst
  z tłumaczeń, ścieżka pliku, token koloru) — intencja testu zostaje, powód
  w opisie commita. Dawna zasada „nie poprawiać bez polecenia” wycofana.
- **Odczyt produkcji bez migracji (2026-10-20):** workflow `db-read.yml`
  (`workflow_dispatch`, wejście `sql_file`) z plikiem `scripts/db-read/<nazwa>.sql`
  — jedno zapytanie SELECT bez `;` i `\`, sesja tylko do odczytu, wynik tylko
  liczby/bool/UUID/daty (`scripts/db-read.sh` odrzuca tekst i JSON), połączenie
  jako rola `agent_reader` (414: SELECT tylko na tabelach gier/baz/ankiet
  i aktywności, bez `auth`, profili, poczty; nie superużytkownik; nowa tabela
  do odczytu = GRANT w migracji). Repo jest
  publiczne: żadnych treści gier, nazw ani e-maili w logach. Migracje
  diagnostyczne już niepotrzebne. Z agenta: `scripts/agent-tools/gh-run.sh
  db-read.yml sql_file=…` (uruchamia, czeka, wypisuje wynik z adnotacji).
- **Środowisko `production` (E24 R5, 2026-11-08):** workflowy z kluczem SSH serwera
  lub tokenem Cloudflare (`db-read`, `db-migrate`, `deploy-*`, `maintenance`,
  `cloudflare-token-sync`, `market-model-preflight`) działają w środowisku GitHuba
  `production` z regułą gałęzi `main` — zapytanie `db-read` najpierw na `main`,
  potem `gh-run.sh` z `REF=main`.
- **Przerwa techniczna (decyzja użytkownika 2026-10-20):** włącza i wyłącza
  ją **wyłącznie właściciel w panelu admina**. Agent nie ma do tego narzędzia.
  Agent ocenia, czy praca wymaga przerwy: zmiany jawne i nieszkodliwe dla
  użytkowników (dodające migracje, odczyty, wdrożenia zgodne wstecz) idą bez
  przerwy; gdy zmiana może zaszkodzić albo przerwać czyjąś pracę — prosi
  użytkownika o przerwę (powód i czas), wcześniej podaje, czy ktoś pracuje
  (`scripts/db-read/maintenance-blockers.sql`: gra w Control, edycja, osoby
  w edytorach/ustawieniach/Eksploratorze/logo/ankietach, głosy z 10 min),
  a pracę zaczyna dopiero, gdy `maintenance.yml` (tylko odczyt: stan przerwy
  i aktywność) potwierdzi, że przerwa jest włączona.
- Migracje bezpieczne (dodające) od razu na `main`, potem testy.
- **Prawa nowych funkcji (E24, 2026-11-08):** każda nowa funkcja w `public`
  ma w tej samej migracji `REVOKE … ON FUNCTION … FROM PUBLIC` (prawo domyślne
  Postgresa = także `anon`); funkcja wołana ze strony dostaje jawne
  `GRANT EXECUTE … TO anon/authenticated`. Nowa tabela — `ENABLE ROW LEVEL
  SECURITY`. Zapadka `unit/migrationGrants.test.js` (od migracji 529).
- Migracje tylko do przodu: `supabase/migrations/YYYY-MM-DD_NNN_*.sql`,
  stosowane po pushu na `main`; `schema.sql` aktualizuje CI.
- Scalanie `main` z konfliktami wersji `?v=`: `python3 scripts/resolve-version-conflicts.py`
  (po `git -c merge.conflictstyle=diff3 merge`; rozwiązuje tylko hunki, gdzie jedna strona zmieniła same wersje), resztę ręcznie, potem
  `node scripts/version-assets.js`; przed commitem unit (test `noConflictMarkers`). **Nigdy `git checkout --ours -- web`** ani `git add -A` przy nierozwiązanych konfliktach — zgubiło
  zmiany innych sesji (2026-10-09).
- Bez fallbacków: żadnych aliasów starych adresów ani przekierowań.
- Komentarz w JS nie może zawierać `*/` (np. `editor-*/` w ścieżce).
- **Tłumaczenia przy każdej zmianie (decyzja użytkownika 2026-10-23):** kto zmienia
  kod lub teksty strony, pilnuje tłumaczeń w tym samym commicie:
  - nowy lub zmieniony tekst — od razu w `web/shared/translation/{pl,en,uk}/<część>.js`
    (wszystkie trzy języki, ta sama treść znaczeniowa), nigdy tekst na sztywno w JS/HTML
    (poza zapasowym tekstem w HTML przy `data-i18n`, zgodnym z PL);
  - **części słownika (E27, decyzja użytkownika 2026-10-23):** `common` (każda strona),
    części stron (`games`, `control`, `polls`…) i `server` (teksty serwera — strony
    jej nie wczytują). Nowy klucz w sekcji, w której już leżą teksty tej strony;
    moduł wspólny (`web/shared/js`) bierze teksty z `common`, nie z sekcji jednej
    strony. Po zmianie kluczy użytych na stronie: `node scripts/i18n-parts.mjs`
    (meta `i18n-parts` w HTML; zapadka `unit/i18nParts.test.js`). Plan:
    `familijna-server/docs/tlumaczenia-podzial-plan.md`;
  - **panel admina (decyzja użytkownika 2026-10-23):** teksty `web/admin` mogą
    być wpisane na sztywno po polsku; tłumaczenia tylko dla tego, co trafia do
    użytkowników (maile, podgląd strony przerwy);
  - tekst, który przestał być używany — usunąć klucz z trzech języków
    (`node scripts/i18n-prune.mjs`); klucz użyty w kodzie musi istnieć w słowniku;
  - zmiana tekstu użytego w mailach powiadomień → `node scripts/sync-notification-mail-texts.mjs`;
  - sprawdzenie: `node scripts/i18n-unused.mjs` (nieużywane, brakujące, różnice
    między językami) i zapadka `unit/i18nUnused.test.js`.
  - **wyjątek — panel admina (`web/admin/`, decyzja użytkownika 2026-10-23):**
    teksty wpisane na sztywno po polsku, bez kluczy w tłumaczeniach strony.
- **Podręcznik przy zmianach działania (decyzja użytkownika 2026-10-23):** zmiana,
  która wyraźnie zmienia wygląd strony albo sposób korzystania z funkcji (nowy lub
  usunięty przycisk, inny gest, kolejność kroków, nowe ograniczenie, nowy komunikat
  ważny dla użytkownika), w tym samym etapie aktualizuje Wskazówki: tekst
  `docs/podrecznik/*.md` w PL, EN i UK (tylko stan obecny, bez „wcześniej”/„teraz już”),
  sceny zrzutów użyte w treści (`![Podpis](zrzut:scena)`, nowa scena, gdy podręcznik
  pokazuje nowy stan), potem `node scripts/manual/build-content.mjs`. Zrzuty
  Wskazówek odświeża CI po pushu na `main`. Drobne poprawki bez wpływu na opis — bez zmian
  w podręczniku. Plan i zasady: `familijna-server/docs/podrecznik-plan.md`.
- **Podpowiedzi (decyzja użytkownika 2026-10-23):** podpowiedź jest skuteczna, jasna,
  trafna (zgodna z faktycznym działaniem i etykietą przycisku), sensowna i mówi tylko
  to, co **nieoczywiste** — oczywistych rzeczy nie podpowiadamy; ten sam tekst nie
  stoi dwa razy w jednym widoku (podpowiedź nie powtarza kafla, tytułu, nagłówka,
  przycisku ani listy warunków); bez „na dole okna”, „po lewej” itp., gdy na telefonie
  układ jest inny — element wskazujemy nazwą. W Control podpowiedzi są krótkie i zawsze mieszczą
  się bez przewijania (`unit/hints.test.js`, ≤ 90 znaków). Pełne zasady:
  `familijna-server/docs/wzorce-ui.md` „A16. Podpowiedzi”; audyt: `familijna-server/docs/audyt-podpowiedzi.md`.

## Stan i wznawianie

- Po każdym kroku (commit, przebieg e2e, decyzja) wpis w „Dzienniku”
  w `familijna-server/docs/wdrozenia.md` — kolejna sesja kontynuuje z samych dokumentów.
- Pauza na prośbę użytkownika („poczekaj”, „nie wznawiamy”): przerwać
  biegnące e2e, wznowienie dopiero po „wracamy”.
- Narzędzia: `scripts/agent-tools/` (e2e po kolei, lint `no-undef`, podgląd
  stron z atrapą Supabase).
