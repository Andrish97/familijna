# 15. Ankiety i zbieranie odpowiedzi

## 15.1 Przygotowanie i uruchomienie ankiety

Ankieta należy do gry rodzaju **Ankieta tekstowa** albo **Punktacja** (→ 7.1). Z jej wyników
powstaje tablica odpowiedzi z punktami (→ 2.4).

Zanim uruchomisz ankietę, gra musi mieć **co najmniej 10 pytań**, a w grze „Punktacja” — od 3 do
6 odpowiedzi w każdym pytaniu (→ 7.6). Dopóki gra tych warunków nie spełnia, przycisk [Ankieta]
w *Moich grach* jest nieaktywny, a strona ankiety (np. otwarta z zapisanego adresu) blokuje się
w całości komunikatem „Niedostępne w tym stanie gry” z powodem, na przykład „Gra musi mieć co
najmniej 10 pytań (masz: 4).”.

1. W *Moich grach* zaznacz grę i wybierz [Ankieta].
2. Wybierz [Uruchom] i potwierdź w oknie „Uruchomić ankietę?”. Link, kod QR i zaproszenia dla
   odbiorców są dostępne dopiero po uruchomieniu (→ 15.2).

![Szkic ankiety](zrzut:polls-draft-points)
![Szkic — za mało pytań](zrzut:polls-draft-text-blocked)
![Uruchomienie ankiety](zrzut:polls-open-confirm)

Od tej chwili ankieta jest **otwarta**: głosujący mogą odpowiadać, a gry nie można edytować
(→ 7.5).

| Stan ankiety | Co się dzieje |
|---|---|
| Szkic | Ankieta nie jest uruchomiona. |
| Otwarta | Trwa zbieranie odpowiedzi. |
| Zatrzymana | Zbieranie jest wstrzymane; możesz je wznowić albo podliczyć głosy. |
| Gotowa | Ankieta jest zamknięta, a gra gotowa do rozegrania. |

## 15.2 Wybór sposobu głosowania

Na karcie „Udostępnianie” są dwa sposoby:

**Anonimowo** — dla każdego, kto dostanie odnośnik:

- [Kopiuj link] kopiuje odnośnik do głosowania, a [Otwórz] otwiera ankietę w nowej karcie,
- kod QR do zeskanowania telefonem — kliknij go, żeby pokazać go na cały ekran.

Głosujący są anonimowi — widzisz tylko liczbę głosów. Na jednym urządzeniu kolejna osoba może zagłosować po 30 sekundach (np. gdy kilka osób dzieli się telefonem). Głosów z linku nie da się przypisać do osób — ktoś może zagłosować kilka razy, np. z innej przeglądarki. Gdy wynik ma znaczenie, zaproś odbiorców (niżej): każdy z nich zagłosuje raz.

![Udostępnianie — link i kod QR](zrzut:poll-share)
![Udostępnianie — link i kod QR — telefon](zrzut:poll-share-phone@phone)
![Powiększony kod QR](zrzut:polls-qr-vote-modal)

**Kod QR na telewizorze lub rzutniku.** [QR na wyświetlaczu] pokazuje 6-cyfrowy kod ekranu
„Wyświetlacz QR” — to kod do podłączenia ekranu, a nie do głosowania. Na telewizorze otwórz
familijna.app → [Podłącz urządzenie] i wpisz kod (logowanie nie jest potrzebne). Ekran pokaże
duży kod QR do głosowania, który uczestnicy skanują telefonami. [Otwórz] otwiera ten ekran na
bieżącym urządzeniu (np. żeby przesłać go przez HDMI), a [Kopiuj] kopiuje kod. Ekran ma przycisk
pełnego ekranu, a po zamknięciu ankiety pokazuje „Ankieta została zamknięta”. Przycisk działa
dopiero po uruchomieniu ankiety.

![QR na wyświetlaczu — kod podłączenia ekranu](zrzut:polls-qr-display-modal)
![Wyświetlacz QR z kodem do głosowania](zrzut:polls-vote-qr)

**Odbiorcy** — imienne zaproszenia dla znajomych (→ 10) i subskrybentów (→ 14):

1. Wybierz [Dodaj odbiorców] i zaznacz osoby.
2. Wybierz [Wyślij zaproszenia]. Każda osoba dostanie zadanie w serwisie (→ 15.4) lub wiadomość
   e-mail z odnośnikiem.

Przy każdym odbiorcy widać status: czeka, otwarto, zagłosował albo odrzucił, a nad listą
podsumowanie „Zaproszeni · Zagłosowali · Odrzucili”. Osobom, które jeszcze nie odpowiedziały,
możesz wysłać [Przypomnij] — najwyżej dwa razy. [Usuń udostępnienie] wycofuje zaproszenie.

![Dodaj odbiorców](zrzut:poll-recipients-tools)
![Statusy odbiorców](zrzut:polls-open-recipients-tab@phone)

Oba sposoby możesz łączyć — głosy liczą się razem.

Subskrybent bez konta może przejrzeć swoje zaproszenia i z nich zrezygnować na stronie
*Moje powiadomienia*.

## 15.3 Oddawanie głosu

Głosujący otwiera ankietę z odnośnika, kodu QR, wiadomości e-mail albo zadania.

- Pytania wyświetlają się po jednym („Pytanie 3/10”).
- W ankiecie tekstowej wpisuje się własną odpowiedź — do 17 znaków. Emotki i znaki, których
  nie pokaże Wyświetlacz, zostaną pominięte.
- W ankiecie „Punktacja” wybiera się jedną z podanych odpowiedzi.
- Nie można pominąć pytania ani wrócić do poprzedniego. W ankiecie „Punktacja” kliknięcie
  odpowiedzi od razu przechodzi dalej, a w ankiecie tekstowej trzeba coś wpisać.
- Odpowiedzi są wysyłane razem **po ostatnim pytaniu**. Kto wyjdzie wcześniej, nie zostanie
  policzony.
- Na końcu pojawia się „Dziękujemy za udział!”.

![Głosowanie w ankiecie „Punktacja”](zrzut:polls-vote-points-progress@phone)
![Głosowanie tekstowe — licznik znaków](zrzut:polls-vote-text-typing@phone)
![Dziękujemy za udział!](zrzut:polls-vote-text-thanks@phone)
![Ankieta zatrzymana](zrzut:polls-vote-text-stopped@phone)

Osoba zaproszona imiennie głosuje tak samo; jej status u ankietującego zmieni się na
„zagłosował”. Osoba bez konta może otworzyć ankietę z wiadomości albo ze strony
*Moje powiadomienia*.

## 15.4 Zadania i zaproszenia do głosowania

Zadanie to zaproszenie do ankiety, które dostałeś od znajomego. Znajdziesz je na stronie
*Zadania*:

- „Do zrobienia” — ankiety, które czekają na Twój głos: [Głosuj] otwiera ankietę, [Odrzuć]
  rezygnuje z udziału (ankieta zniknie z listy),
- „Zrobione” — ankiety, w których już głosowałeś (zwinięte, widoczne przez 5 dni).

![Zadania](zrzut:tasks)
![Zrobione](zrzut:tasks-done-open)

Osoby bez konta mają swoje zadania na stronie *Moje powiadomienia*.

## 15.5 Prowadzenie głosowania

Na karcie „Głosy” widać postęp: liczbę oddanych głosów i — przy zaproszeniach — statusy odbiorców.

- [Zatrzymaj] — wstrzymuje zbieranie odpowiedzi. Odnośnik nadal działa, ale głosujący zobaczy
  „Ankieta jest zatrzymana”.
- [Wznów głosowanie] — ponownie otwiera zbieranie.
- [Podlicz głosy] — dostępne, gdy ankieta jest zatrzymana (→ 15.6).
- [Przerwij] — kończy ankietę i przywraca szkic. **Wszystkie głosy przepadną.**

![Karta „Głosy”](zrzut:polls-text)
![Zatrzymanie ankiety](zrzut:polls-stop-confirm)
![Ankieta zatrzymana — Podlicz głosy](zrzut:polls-stopped)
![Przerwanie ankiety](zrzut:polls-abort-confirm)

## 15.6 Podliczanie i opracowywanie odpowiedzi

Podliczanie i zamknięcie ankiety to osobne kroki. Najpierw zatrzymaj ankietę i wybierz
[Podlicz głosy]. Możesz to zrobić od **10 pełnych ankiet** (osób, które odpowiedziały na
wszystkie pytania), nawet jeśli wynik nie spełnia jeszcze warunków zamknięcia.

**Jak serwis liczy punkty:**

1. Punkty odpowiedzi to procent pełnych ankiet, w których się pojawiła, zaokrąglony w dół.
2. Odpowiedzi poniżej **4 punktów** są pomijane.
3. Na tablicę trafia najwyżej **6** najpopularniejszych odpowiedzi.
4. Aby zamknąć ankietę, każde pytanie potrzebuje **co najmniej 3** odpowiedzi z co najmniej
   4 punktami.

**Ankieta tekstowa** — przed zatwierdzeniem uporządkuj odpowiedzi:

- identyczne wpisy serwis łączy sam (bez względu na wielkość liter i dodatkowe spacje); [Scal identyczne] zrobi to
  ponownie po Twoich poprawkach,
- przeciągnij odpowiedź na inną, aby je **połączyć** (na przykład „banan” i „banany”) — na
  telefonie użyj przycisku „Połącz z…”,
- kliknij tekst odpowiedzi, aby poprawić literówkę (do 17 znaków),
- [Usuń] usuwa odpowiedź z wyników,
- [Cofnij] i [Ponów] cofają i przywracają zmiany.

Po każdej zmianie serwis przelicza punkty i kolejność. Licznik „Odpowiedzi: … (wymagane 3–6)”
pokazuje, czy pytanie spełnia warunki. Gdy na granicy szóstki kilka odpowiedzi ma tyle samo
głosów, serwis pokaże remis — [Zmień wybór w remisie] zmienia, które z nich trafią na tablicę.
Poprawki zapisują się na bieżąco, więc możesz przerwać i wrócić później.

![Łączenie odpowiedzi](zrzut:polls-tally-text-merge)
![Po połączeniu — warunki spełnione](zrzut:polls-tally-text-merged)
![Remis na granicy szóstki](zrzut:polls-tally-tie)

**Ankieta „Punktacja”** — odpowiedzi są stałe; zobaczysz tylko podgląd punktów (odpowiedzi poniżej
4 punktów są wyszarzone).

![Podliczanie ankiety „Punktacja”](zrzut:polls-tally-points)

Gdy wszystko się zgadza, wybierz [Zatwierdź] i potwierdź w oknie („Zatwierdzić odpowiedzi?”
w ankiecie tekstowej, „Podliczyć głosy?” w „Punktacji”). Ankieta przejdzie w stan GOTOWA
z dopiskiem „można grać”.
[Wyjdź z podliczania] wraca do zatrzymanej ankiety bez zamykania.

![Zatwierdzenie podliczenia](zrzut:polls-tally-text-approve)

## 15.7 Wyniki i wykorzystanie ich w grze

Po zatwierdzeniu ankieta jest zamknięta, a gra ma status GOTOWA — możesz ją rozegrać
przyciskiem [Graj] (→ 17). Wyniki obejrzysz w [Podgląd] w *Moich grach*, przełączając widok
na „Ankieta”.

![Gotowa ankieta — ostateczne punkty](zrzut:polls-ready-text)
![Podgląd gry — widok „Ankieta” z głosami](zrzut:games-preview-poll)

- [Uruchom ponownie] otwiera nową ankietę dla tej samej gry — dotychczasowe głosy i wyniki
  zostaną usunięte.
- Edycja gry (→ 7.5) lub zmiana jej rodzaju (→ 7.8) także usuwa wyniki — po potwierdzeniu.
- Aby zachować wynik i jednocześnie zebrać nową ankietę, najpierw powiel grę (→ 6.6).
