
## Pytania i gry Producenta

`POST /api/questions/{overview,collect,control,create,publish,unpublish,delete,disassemble,update_question}` wymaga
tego samego nagłówka Bearer co Marketing. Dostęp z panelu prowadzi przez
prywatny Worker i funkcję Edge `question-bank`; klucz nie trafia do przeglądarki.
PL/EN/UK mają oddzielne pule. Zlecenie zapisuje cel nowych pytań i trwały
postęp; restart nie kasuje kolejki. Brak wyników albo limit dostawcy nie
oznaczają ukończenia zlecenia.

- `kind=search`: DeepSeek proponuje do 6 znanych pytań ankietowych; kod bez AI
  szuka dokładnej treści pytania w SearXNG, pobiera do 2 stron i zapisuje tylko
  pytania znalezione na stronie (adres i fragment w `source`). Punkty „ze
  źródła”, gdy każda odpowiedź stoi przy swojej liczbie; z opcją `enrich`
  pozostałe są szacunkiem AI. Strona, która potwierdziła pytanie, trafia do
  kolejki zlecenia i dopiero ją AI czyta w całości (pamięć 7 dni).
- Wczesne odsiewanie powtórzeń (migracja 502): każda paczka propozycji (DeepSeek,
  odczyt strony, generowanie) od razu dostaje wektory i trafia do `qf_known_questions`;
  pytania znane z puli, historii lub gier Producenta odpadają przed wyszukiwaniem stron
  i kontrolą jakości AI. Ta sama reguła (`qf_is_known`) działa w `qf_offer`; wektory
  liczone raz na krok.
- Dziennik zleceń: `producer_question_logs` (migracja 501), wpisy przy zleceniu,
  sterowaniu i każdym kroku (propozycje, potwierdzone strony, dodane, powtórzenia,
  oczekiwanie na AI). Panel czyta go przez Worker; wpisy starsze niż 7 dni
  znikają przy nowym zleceniu danego języka.
- `disassemble`: gra nieopublikowana wraca do puli jako pojedyncze pytania
  (`qf_disassemble`, migracja 501); usługa liczy wektory pytań, baza pomija
  pytania w złym formacie i powtórzenia, usuwa grę i jej ślady w historii.
- `delete`: gra nieopublikowana (wycofana albo nigdy nieopublikowana) przez
  `qf_delete` (migracja 500); pytania dawnej gry Producenta przechodzą do
  historii powtórzeń, więc nie wrócą do puli.
- `kind=generated`: małe partie, walidacja długości/odpowiedzi/punktów,
  dodatkowa ocena jakości, sprawdzenie powtórzeń w puli i historii gier.
- `create`: minimum 10 pytań w grze. Wybór ręczny, automatyczny albo
  znaczeniowo według kategorii. Cały zestaw gier zapisuje jedna transakcja;
  niedobór lub wyścig nie zużywają części puli. Nazwa i opis są wymagane.

Marketing (parametry w `config.txt` z familijna-server, wartości domyślne w kodzie):
`PARTIAL_BATCH_WAIT=300` — po tylu sekundach niepełna paczka kandydatów kategorii
idzie do oceny, nawet gdy CEIDG jeszcze pracuje; przebieg szuka do skutku: DeepSeek dopisuje nowe frazy kategorii, której
wszystkie frazy są sprawdzone, bez limitu, dopóki dają kontakty —
`REFRESH_DRY_LIMIT=3` dopisań z rzędu bez nowego kontaktu kończy daną kategorię
(`CATEGORY_QUERIES_MAX=400` fraz na kategorię); odmowy wyszukiwarek
(`SEARCH_DOWN_LIMIT=8` zapytań z rzędu) to przerwa `SEARCH_PAUSE_S=600`, nie koniec;
przebieg przed celem kończy się tylko, gdy żadna kategoria nie daje już kontaktów,
a CEIDG jest sprawdzony (log: „brak dalszych źródeł”);
`CEIDG_QUERY_ATTEMPTS=2` — próby jednej strony CEIDG w przebiegu (potem następny
przebieg). Kod PKD wspólny dla kilku kategorii jest pobierany raz, a firm już
znanych nie dopytujemy o szczegóły. Zapytanie CEIDG ma twardy limit 60 s.

SearXNG współdzieli uczciwą kolejkę `SEARCH_GATE` z Marketingiem. DeepSeek
wykonuje jedno wywołanie naraz (`AI_GATE`), naprzemiennie dopuszczając usługi.
`QUESTION_DAILY_TOKENS=100000`, `MARKETING_DAILY_TOKENS=500000` w `config.txt`
ustalają osobne limity dzienne (UTC). Rezerwacja jest atomowa w bazie przed
wywołaniem i rozliczana według `usage`; nieudane wywołanie bez `usage`
zachowuje rezerwację. Wyczerpanie limitu zapisuje stan oczekiwania i nie
obniża celu. Pamięć źródeł ogranicza ponowne pobieranie i ekstrakcję.

Druga pętla usługi wykonuje `admin_demo_apply_next`: aktualizuje kolejkę
nieedytowanych demo, ponownie sprawdzając treść i blokady przed zapisem.
Nie zmienia wzorców bez żądania administratora z podglądem wersji.

## Dziennik Marketingu

Nowe zlecenie zachowuje logi z ostatnich 7 dni. Ostrzeżenia i błędy operacji
bazy są widoczne w panelu; awaria samej tabeli dziennika trafia tylko do stderr,
żeby nie tworzyć pętli zapisu. Błędy wyszukiwarki, CEIDG i przebiegu zawierają
typ wyjątku oraz traceback (limit wpisu 16000 znaków). Timeout z pustym
komunikatem jest opisany jawnie jako np. `ReadTimeout`.
