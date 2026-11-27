// Miejsca na stronach, które czat może wskazać (narzędzie show_on_page): gdy
// czegoś nie zrobi sam (wgranie pliku, rysowanie, podłączenie urządzenia,
// przyciski w Control), przechodzi na stronę i podświetla element z dymkiem.
// Czyste dane — bez DOM (kopia trafia też na serwer MCP, który zwraca link).
//   sel     — selektor elementu do podświetlenia;
//   select  — zaznacz najpierw kafel z id (game | logo | base) — tylko widok;
//   before  — kliknięcia odsłaniające (karta, sekcja, menu „Więcej”) — tylko widok;
//   about   — opis dla modelu (po angielsku);
//   phoneBefore — kliknięcia odsłaniające tylko w układzie telefonu (szuflada);
//   computerOnly — miejsce niedostępne na telefonie (strona albo funkcja tylko na komputerze);
//   sometimes — element pokazuje się tylko w pewnym stanie (opis warunku w about).
// Elementy z menu ☰ (telefon) pointer.js odsłania sam. Audyt wszystkich miejsc:
// scripts/screens/audit-pointer.mjs (telefon i komputer).
// Zasada: before i select niczego nie zapisują i nie wysyłają. W Control
// (decyzja 7) bez kliknięć — tylko podświetlenie.

const MORE = ["#btnMore"];

export const POINT_TARGETS = {
  games: {
    tab_poll_text: { sel: "#tabPollText", about: "Tab: text poll games" },
    tab_poll_points: { sel: "#tabPollPoints", about: "Tab: poll games with given answers" },
    tab_prepared: { sel: "#tabPrepared", about: "Tab: prepared games (points by hand)" },
    tab_market: { sel: "#tabMarket", about: "Tab: games from the Market library" },
    new_game: { sel: ".addCard:not(.addCard--static)", about: "Tile that creates a new game in the current tab" },
    play: { sel: "#btnPlay", select: "game", computerOnly: true, about: "Play the selected game (opens Control — on a computer only)" },
    settings: { sel: "#btnSettings", select: "game", about: "Settings of the selected game" },
    edit: { sel: "#btnEdit", select: "game", about: "Editor of the selected game" },
    preview: { sel: "#btnPreview", select: "game", about: "Preview of the selected game" },
    poll: { sel: "#btnPoll", select: "game", about: "Poll of the selected game" },
    duplicate: { sel: "#btnDuplicate", select: "game", about: "Duplicate the selected game" },
    change_type: { sel: "#btnChangeType", select: "game", about: "Change the type of the selected game" },
    export_file: { sel: "#btnExport", select: "game", about: "Export the selected game to a file" },
    import_file: { sel: "#btnImport", about: "Import a game from a file" },
    export_to_base: { sel: "#btnExportBase", select: "game", about: "Copy the selected game's questions to a question base" },
    send_copy: { sel: "#btnSendCopy", select: "game", about: "Send a copy of the selected game to friends" },
    connect_device: { sel: "#btnConnectDevice", before: MORE, about: "Connect a device (display, host tablet, buzzer) with a code" },
    install: { sel: "#btnInstall", sometimes: true, about: "Install Familijna on the device (shown only when the browser allows installing and the app is not installed yet)" },
    language: { sel: ".lang-btn", about: "Language of the service (flag button in the top bar)" },
    appearance: { sel: ".theme-btn", about: "Appearance: automatic, light or dark" },
    coffee: { sel: ".btn-support-footer", about: "Buy a coffee (voluntary support, in the footer next to Contact; payment on buycoffee.to)" },
    menu_more: { sel: "#btnMore, .topbar-menu-toggle", about: "Menu “More” (on a phone the ☰ menu): logos, bases, friends, subscribers, tasks, Market, connect a device" },
  },
  editor: {
    import_txt: { sel: "#btnImportTxt", about: "Import questions from a text file into the game" },
    questions: { sel: "#qList", about: "List of questions of the game" },
  },
  gameSettings: {
    teams: { sel: "#gsContentInner", before: ['[data-cat="teams"]'], about: "Section Teams: team names" },
    display: { sel: "#gsContentInner", before: ['[data-cat="display"]'], about: "Section Appearance: colours, board theme, logo, host logo" },
    sound: { sel: "#gsContentInner", before: ['[data-cat="sound"]'], about: "Section Sound: sound variants, volumes, own sound files (upload)" },
    questions: { sel: "#gsContentInner", before: ['[data-cat="questions"]'], about: "Section Questions — settings: random or chosen questions, final on/off" },
    final_questions: { sel: "#gsContentInner", before: ['[data-cat="finale"]'], about: "Section Questions — Final: choose final questions" },
    round_questions: { sel: "#gsContentInner", before: ['[data-cat="rounds"]'], about: "Section Questions — Rounds: choose and order round questions" },
    game: { sel: "#gsContentInner", before: ['[data-cat="game"]'], about: "Section Game settings: final threshold and target, end screen, prizes, round multipliers" },
    save: { sel: "#btnSaveAll", about: "Save settings" },
    play: { sel: "#btnPlay", sometimes: true, computerOnly: true, about: "Play the game (shown when the game is ready to play; Control works on a computer only)" },
  },
  polls: {
    share: { sel: "#secShare", before: ["#tabShare"], about: "Poll link and QR code to share" },
    copy_link: { sel: "#btnCopy", before: ["#tabShare"], about: "Copy the poll link" },
    qr: { sel: "#qr", before: ["#tabShare"], about: "QR code of the poll (click to enlarge)" },
    recipients: { sel: "#btnAddRecipients", before: ["#tabRecipients"], about: "Add recipients (friends, subscribers)" },
    results: { sel: "#secResults", before: ["#tabResults"], about: "Poll results" },
    open: { sel: "#btnOpenPoll", sometimes: true, about: "Start the poll (shown only for a poll that has not started yet)" },
    stop: { sel: "#btnStopPoll", sometimes: true, about: "Stop the poll (shown only while the poll is open)" },
    tally: { sel: "#btnTallyPoll", sometimes: true, about: "Tally the poll (shown only after the poll is stopped)" },
  },
  logoEditor: {
    tab_text: { sel: "#tabLogoText", about: "Tab: text logos" },
    tab_draw: { sel: "#tabLogoDraw", about: "Tab: drawn logos" },
    tab_image: { sel: "#tabLogoImage", about: "Tab: logos from an image (upload a picture)" },
    new_logo: { sel: ".addCard", computerOnly: true, about: "Tile that creates a new logo in the current tab (logo editors work on a computer only)" },
    new_image_logo: { sel: ".addCard", before: ["#tabLogoImage"], computerOnly: true, about: "Create a logo from an image file (upload; on a computer only)" },
    edit: { sel: "#btnEdit", select: "logo", computerOnly: true, about: "Edit the selected logo (on a computer only)" },
    preview: { sel: "#btnPreview", select: "logo", about: "Preview the selected logo" },
    export_file: { sel: "#btnExport", select: "logo", about: "Export the selected logo to a file" },
    import_file: { sel: "#btnImport", about: "Import a logo from a file" },
    send_copy: { sel: "#btnSendCopy", select: "logo", about: "Send a copy of the selected logo to friends" },
  },
  logoDraw: {
    toolbar: { sel: "#editorToolbar", computerOnly: true, about: "Drawing tools: brush, eraser, shapes, text, undo" },
    canvas: { sel: "#drawStageHost", computerOnly: true, about: "Drawing area" },
  },
  logoImage: {
    pick: { sel: "#btnPickImage", computerOnly: true, about: "Choose an image file" },
    adjust: { sel: "#imgPanels", computerOnly: true, about: "Brightness, contrast, crop of the image" },
  },
  bases: {
    tab_mine: { sel: "#tabBasesMine", about: "Tab: my bases" },
    tab_shared: { sel: "#tabBasesShared", about: "Tab: bases shared with me" },
    new_base: { sel: ".addCard", before: ["#tabBasesMine"], about: "Tile that creates a new base" },
    browse: { sel: "#btnBrowse", select: "base", about: "Open the selected base in the explorer" },
    share: { sel: "#btnShare", select: "base", about: "Share the selected base" },
    duplicate: { sel: "#btnDuplicate", select: "base", about: "Duplicate the selected base" },
    export_file: { sel: "#btnExport", select: "base", about: "Export the selected base to a file" },
    import_file: { sel: "#btnImport", about: "Import a base from a file" },
  },
  baseExplorer: {
    tree: { sel: "#tree", phoneBefore: ["#btnDrawerToggle"], about: "Folders of the base" },
    tags: { sel: "#tags", phoneBefore: ["#btnDrawerToggle"], before: ['[data-left-view="tags"]'], about: "Tags" },
    list: { sel: "#list", about: "Questions and folders in the current folder" },
    toolbar: { sel: "#toolbar", about: "Actions: new question/folder, move, delete, tags, create a game" },
  },
  friends: {
    invite: { sel: "#btnInvite", before: ["#contactsTabInvite"], about: "Invite a friend" },
    received: { sel: "#contactsTabReceived, #contactsReceived", about: "Invitations received" },
  },
  subscribers: {
    invite: { sel: "#btnInvite", before: ["#contactsTabInvite"], about: "Add a subscriber (e-mail)" },
  },
  marketplace: {
    search: { sel: "#btnSearchFocus, #searchInput", about: "Search the Market" },
    my_sent: { sel: "#btnMySent", about: "My submissions to the Market" },
    submit: { sel: "#btnSubmitNew", before: ["#btnMySent"], about: "Submit one of my games to the Market" },
  },
  tasks: {
    list: { sel: "main", about: "Polls to fill in from other people" },
  },
  account: {
    username: { sel: "#usernameSection", about: "Change the user name (once per hour)" },
    email: { sel: "#emailSection", about: "Change the e-mail address (confirmation link to the new address)" },
    delete_account: { sel: "#deleteSection", about: "Delete the account and all data (cannot be undone)" },
    rating: { sel: "#ratingSection", about: "The user's rating of the service" },
    demo: { sel: "#demoSection", about: "Restore demo materials" },
    ai_keys: { sel: "#ai", about: "AI assistant keys" },
    ai_connect: { sel: "#aiConnect", about: "Claude and ChatGPT connector" },
    notifications: { sel: "#emailNotifSection", about: "Notifications" },
    password: { sel: "#passwordSection", about: "Change password" },
  },
  control: {
    device_display: { computerOnly: true, sometimes: true, sel: '[data-device="display"]', about: "Display: code, open, share (devices step before the game starts)" },
    device_host: { computerOnly: true, sometimes: true, sel: '[data-device="host"]', about: "Host tablet: code, QR, share (devices step before the game starts)" },
    device_buzzer: { computerOnly: true, sometimes: true, sel: '[data-device="buzzer"]', about: "Buzzer phone: code, QR, share (devices step before the game starts)" },
    device_status: { computerOnly: true, sel: "#dotDisplayRow", about: "Connection status of devices (top bar)" },
    mute: { computerOnly: true, sel: "#btnMute", about: "Mute sounds" },
    no_host_tablet: { computerOnly: true, sometimes: true, sel: '[data-device="host"] .device-row-opt', about: "Option: play without the host tablet (devices step)" },
    physical_buzzer: { computerOnly: true, sometimes: true, sel: '[data-device="buzzer"] .device-row-opt', about: "Option: physical buzzers instead of the phone (devices step)" },
    test_mode: { computerOnly: true, sometimes: true, sel: ".control-test-choice", about: "Test mode: all screens in one window for a rehearsal (devices step)" },
    start_over: { computerOnly: true, sel: "#btnStartOver", about: "Start the game over" },
  },
};

export const SELECT_TILE = {
  game: (id) => `[data-game-id="${id}"]`,
  logo: (id) => `[data-key="${id}"]`,
  base: (id) => `[data-base-id="${id}"]`,
};

export const POINT_PAGES = Object.keys(POINT_TARGETS);

// Adresy stron (jak nav-map) — dla serwera MCP, który zwraca link zamiast wskazywać.
export const PAGE_PATHS = {
  games: "/games/", editor: "/games/editor/", gameSettings: "/games/settings/", polls: "/polls/",
  logoEditor: "/logos/", logoDraw: "/logos/editor/draw/", logoImage: "/logos/editor/image/",
  bases: "/bases/", baseExplorer: "/bases/explorer/", friends: "/friends/", subscribers: "/subscribers/",
  marketplace: "/marketplace/", account: "/account/", control: "/control/", tasks: "/tasks/",
};
// Strony pokazujące jedną rzecz — potrzebują id (gra, baza, logo).
export const NEEDS_ID = new Set(["editor", "gameSettings", "polls", "baseExplorer", "logoDraw", "logoImage"]);
