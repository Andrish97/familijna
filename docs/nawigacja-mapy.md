# Nawigacja — mapy przycisków (wygenerowane)

Sześć diagramów (rola × urządzenie) z `PAGES` w `web/shared/js/core/nav-map.js`.
Plik generuje `node scripts/nav-maps.mjs`; test `tests/unit/navButtons.test.js`
pilnuje zgodności. Decyzje dotyczące nawigacji są w prywatnym repo
`familijna-server` (`familijna-server/docs/nawigacja-mapa-plan.md`).

<!-- nav-maps:start -->

<!-- WYGENEROWANE z PAGES przez scripts/nav-maps.mjs — nie edytuj ręcznie. -->

Strzałka ciągła: przycisk z `PAGES[...].buttons` (nazwa = id elementu;
`*` — przycisk z własnym sprawdzeniem przed przejściem). Strzałka kreskowana:
↩ „Wstecz” bez `?ret=` (rodzic z mapy). `?` (instrukcja) prowadzi z każdej
strony z topbarem i nie jest tu rysowane. Przejścia z elementów list
(kafelki gier, baz, logo) nie są przyciskami mapy.
Linia bez strzałki: widoczny, zablokowany przycisk; podpis wskazuje zależność z mapy.

#### Diagram A1 — Niezalogowany, komputer

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  manual -->|btnLegal| privacy
  login -.->|↩| home
  marketplace -.->|↩| home
  connectDevice -.->|↩| home
  connectTv -.->|↩| connectDevice
  manual -.->|↩| home
  mailCenter -.->|↩| home
  privacy -.->|↩| home
```

#### Diagram A2 — Niezalogowany, telefon

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  manual -->|btnLegal| privacy
  login -.->|↩| home
  marketplace -.->|↩| home
  connectDevice -.->|↩| home
  connectTv -.->|↩| connectDevice
  manual -.->|↩| home
  mailCenter -.->|↩| home
  privacy -.->|↩| home
```

#### Diagram B1 — Gość, komputer

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  games["/games/"]
  editor["/games/editor/"]
  polls["/polls/"]
  bases["/bases/"]
  baseExplorer["/bases/explorer/"]
  logoEditor["/logos/"]
  logoText["/logos/editor/text/"]
  logoDraw["/logos/editor/draw/"]
  logoImage["/logos/editor/image/"]
  control["/control/"]
  gameSettings["/games/settings/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  account["/account/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  games -->|btnMarketplace| marketplace
  games -->|btnLogoEditor| logoEditor
  games -->|btnBases| bases
  games -->|btnPlay*| control
  games -->|btnSettings*| gameSettings
  games -->|btnEdit*| editor
  games -->|btnPoll*| polls
  bases -->|btnBrowse*| baseExplorer
  gameSettings -->|btnPlay*| control
  manual -->|btnLegal| privacy
  login -.->|↩| home
  editor -.->|↩| games
  polls -.->|↩| games
  bases -.->|↩| games
  baseExplorer -.->|↩| bases
  logoEditor -.->|↩| games
  logoText -.->|↩| logoEditor
  logoDraw -.->|↩| logoEditor
  logoImage -.->|↩| logoEditor
  control -.->|↩| games
  gameSettings -.->|↩| control
  marketplace -.->|↩| games
  connectDevice -.->|↩| games
  connectTv -.->|↩| connectDevice
  account -.->|↩| games
  manual -.->|↩| games
  mailCenter -.->|↩| home
  privacy -.->|↩| manual
```

#### Diagram B2 — Gość, telefon

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  games["/games/"]
  editor["/games/editor/"]
  polls["/polls/"]
  bases["/bases/"]
  baseExplorer["/bases/explorer/"]
  logoEditor["/logos/"]
  gameSettings["/games/settings/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  account["/account/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  games -->|btnMarketplace| marketplace
  games -->|btnLogoEditor| logoEditor
  games -->|btnBases| bases
  games -->|btnSettings*| gameSettings
  games -->|btnEdit*| editor
  games -->|btnPoll*| polls
  bases -->|btnBrowse*| baseExplorer
  manual -->|btnLegal| privacy
  login -.->|↩| home
  editor -.->|↩| games
  polls -.->|↩| games
  bases -.->|↩| games
  baseExplorer -.->|↩| bases
  logoEditor -.->|↩| games
  marketplace -.->|↩| games
  connectDevice -.->|↩| games
  connectTv -.->|↩| connectDevice
  account -.->|↩| games
  manual -.->|↩| games
  mailCenter -.->|↩| home
  privacy -.->|↩| manual
```

#### Diagram C1 — Konto, komputer

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  games["/games/"]
  editor["/games/editor/"]
  polls["/polls/"]
  friends["/friends/"]
  subscribers["/subscribers/"]
  tasks["/tasks/"]
  bases["/bases/"]
  baseExplorer["/bases/explorer/"]
  logoEditor["/logos/"]
  logoText["/logos/editor/text/"]
  logoDraw["/logos/editor/draw/"]
  logoImage["/logos/editor/image/"]
  control["/control/"]
  gameSettings["/games/settings/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  account["/account/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  games -->|btnMarketplace| marketplace
  games -->|btnLogoEditor| logoEditor
  games -->|btnConnectDevice| connectDevice
  games -->|btnFriends| friends
  games -->|btnSubscribers| subscribers
  games -->|btnTasks| tasks
  games -->|btnBases| bases
  games -->|btnPlay*| control
  games -->|btnSettings*| gameSettings
  games -->|btnEdit*| editor
  games -->|btnPoll*| polls
  polls -->|btnFriends| friends
  polls -->|btnSubscribers| subscribers
  bases -->|btnFriends| friends
  bases -->|btnBrowse*| baseExplorer
  logoEditor -->|btnFriends| friends
  control -->|btnFriends*| friends
  gameSettings -->|btnPlay*| control
  manual -->|btnLegal| privacy
  login -.->|↩| home
  editor -.->|↩| games
  polls -.->|↩| games
  friends -.->|↩| games
  subscribers -.->|↩| games
  tasks -.->|↩| games
  bases -.->|↩| games
  baseExplorer -.->|↩| bases
  logoEditor -.->|↩| games
  logoText -.->|↩| logoEditor
  logoDraw -.->|↩| logoEditor
  logoImage -.->|↩| logoEditor
  control -.->|↩| games
  gameSettings -.->|↩| control
  marketplace -.->|↩| games
  connectDevice -.->|↩| games
  connectTv -.->|↩| connectDevice
  account -.->|↩| games
  manual -.->|↩| games
  mailCenter -.->|↩| home
  privacy -.->|↩| manual
```

#### Diagram C2 — Konto, telefon

```mermaid
flowchart LR
  home["/"]
  login["/login/"]
  loginConfirm["/login/confirm/"]
  loginReset["/login/reset/"]
  games["/games/"]
  editor["/games/editor/"]
  polls["/polls/"]
  friends["/friends/"]
  subscribers["/subscribers/"]
  tasks["/tasks/"]
  bases["/bases/"]
  baseExplorer["/bases/explorer/"]
  logoEditor["/logos/"]
  gameSettings["/games/settings/"]
  marketplace["/marketplace/"]
  connectDevice["/connect/"]
  connectTv["/connect/tv/"]
  controlDisplay["/control/display/"]
  controlHost["/control/host/"]
  controlBuzzer["/control/buzzer/"]
  snake["/snake/"]
  go["/go/"]
  pollVotePoints["/polls/vote/points/"]
  pollVoteText["/polls/vote/text/"]
  pollVoteQr["/polls/vote/qr/"]
  account["/account/"]
  manual["/manual/"]
  mailCenter["/mails/"]
  privacy["/privacy/"]
  notFound["/404.html"]
  maintenance["/maintenance/"]
  games -->|btnMarketplace| marketplace
  games -->|btnLogoEditor| logoEditor
  games -->|btnConnectDevice| connectDevice
  games -->|btnFriends| friends
  games -->|btnSubscribers| subscribers
  games -->|btnTasks| tasks
  games -->|btnBases| bases
  games -->|btnSettings*| gameSettings
  games -->|btnEdit*| editor
  games -->|btnPoll*| polls
  polls -->|btnFriends| friends
  polls -->|btnSubscribers| subscribers
  bases -->|btnFriends| friends
  bases -->|btnBrowse*| baseExplorer
  logoEditor -->|btnFriends| friends
  manual -->|btnLegal| privacy
  login -.->|↩| home
  editor -.->|↩| games
  polls -.->|↩| games
  friends -.->|↩| games
  subscribers -.->|↩| games
  tasks -.->|↩| games
  bases -.->|↩| games
  baseExplorer -.->|↩| bases
  logoEditor -.->|↩| games
  marketplace -.->|↩| games
  connectDevice -.->|↩| games
  connectTv -.->|↩| connectDevice
  account -.->|↩| games
  manual -.->|↩| games
  mailCenter -.->|↩| home
  privacy -.->|↩| manual
```

<!-- nav-maps:end -->
