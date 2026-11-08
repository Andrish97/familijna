// Tłumaczenia PL — część „resources”.
const pl = {
  resourceDuplicate: {
  "action": "Powiel",
  "busy": "Zasób jest zajęty. Spróbuj ponownie.",
  "pending": "Najpierw zaakceptuj otrzymany zasób.",
  "notExportable": "Tej gry nie można teraz powielić.",
  "missing": "Nie ma już tego zasobu.",
  "expired": "Ta próba wygasła. Spróbuj ponownie.",
  "unavailable": "Powielanie jest teraz niedostępne.",
  "image": "Nie udało się skopiować obrazu. Spróbuj ponownie.",
  "failed": "Nie udało się powielić zasobu. Spróbuj ponownie."
},
  resourceSend: {
  "action": "Wyślij",
  "title": "Wyślij znajomym",
  "selectFriends": "Wybierz znajomych",
  "proposedTitle": "Kopia czeka na Twoją decyzję",
  "history": "Historia wysyłek",
  "from": "Od: {name}",
  "goTitle": "Otrzymano kopię",
  "goBody": "{sender} wysyła Ci: {name}.",
  "goAccepted": "Kopia dodana do Twoich zasobów.",
  "goDeclined": "Odrzucono propozycję.",
  "openResource": "Otwórz zasób",
  "game": "grę",
  "logo": "logo",
  "mailBody": "{owner} przesyła Ci {kind}: {name}. Kopia jest już gotowa do przyjęcia.",
  "mailAction": "Zobacz kopię",
  "mailFailed": "Kopia została wysłana, ale e-mail nie został wysłany.",
  "noFriends": "Nie masz jeszcze aktywnych znajomych.",
  "sent": "Wysłano do znajomych: {count}.",
  "errors": {"not_sendable":"Wysłać można tylko szkic gry (bez wyników ankiety).","failed":"Nie udało się wysłać kopii. Spróbuj ponownie.","not_friend":"Ta osoba nie jest już znajomym.","already_sent":"Kopia została już wysłana.","declined_cooldown":"Nie można teraz wysłać nowej kopii tej osobie.","auth_required":"Zaloguj się ponownie.","decisionFailed":"Nie udało się zapisać decyzji. Spróbuj ponownie."},
    "proposed": "Propozycja",
    "accept": "Przyjmij",
    "decline": "Odrzuć"
  },
  resourceLock: {
    title: "Zajęte w innym miejscu",
    back: "Wróć",
    goneTitle: "Zasób został usunięty",
    goneMessage: "To, co próbujesz otworzyć, zostało w międzyczasie usunięte gdzie indziej.",
    forbiddenTitle: "Utracono dostęp do edycji",
    forbiddenMessage: "Twoje uprawnienia do edycji tego zasobu zostały cofnięte w trakcie tej sesji.",
    // Wspólny komunikat dla gry — edytor, ustawienia (i docelowo ankieta/
    // control) wzajemnie się wykluczają dla tej samej gry, więc komunikat
    // rozróżnia tylko TYP zasobu, nie która konkretnie strona trzyma blokadę.
    gameMessage: "Ta gra jest otwarta gdzie indziej.",
    logoMessage: "To logo jest właśnie edytowane w innej karcie lub przez inne urządzenie.",
    // Zgłoszone: w Control/ustawieniach gry operator NIE wie, które
    // konkretnie logo jest zablokowane (gra może korzystać z dowolnego
    // logo z puli) — w odróżnieniu od logoMessage (edytor logo, gdzie
    // zawsze chodzi o jedno, wprost otwarte logo), ten komunikat celowo
    // NIE sugeruje jednego, konkretnego logo.
    baseItemMessage: "Ten element bazy jest właśnie edytowany w innej karcie lub przez innego użytkownika.",
    // Cała pula logo użytkownika jest blokowana, gdy Control lub
    // game-settings.js mają aktywną którąkolwiek jego grę — niezależnie od
    // tego, czy TO logo jest przez nią referencowane.
    logoPoolBusyControl: "Nie możesz edytować ani usunąć logo, bo prowadzisz rozgrywkę.",
    logoPoolBusySettings: "Nie możesz edytować ani usunąć logo, bo zmieniasz ustawienia gry.",
    lostTitle: "Utracono blokadę",
    lostMessage: "W międzyczasie ten zasób przejęła inna karta (np. po uśpieniu komputera). Odśwież stronę, żeby wejść ponownie.",
    // Gra otwarta (ustawienia / Control) zajmuje całą pulę logo; edycja któregokolwiek logo
    // zatrzymuje wejście do Control i ustawień każdej gry.
    logoEditBlocksControl: "Trwa edycja logo — zamknij edytor logo, żeby otworzyć rozgrywkę.",
    logoEditBlocksSettings: "Trwa edycja logo — zamknij edytor logo, żeby otworzyć ustawienia.",
    logoPoolBusyControlEntry: "Trwa rozgrywka.",
    logoPoolBusySettingsEntry: "Otwarte ustawienia gry.",
    logoPoolBusy: "Trwa rozgrywka albo otwarte ustawienia gry.",
    baseOpenMessage: "Baza jest otwarta — zmiana całej bazy niemożliwa.",
    baseChangingMessage: "Trwa zmiana całej bazy.",
    baseAccessRevokedTitle: "Odebrano Ci dostęp",
    baseAccessRevokedMessage: "Odebrano Ci dostęp do tej bazy.",
  },
};

export default pl;
