// Miejsca na stronach, które czat może wskazać (narzędzie show_on_page): gdy
// czegoś nie zrobi sam (wgranie pliku, rysowanie, podłączenie urządzenia,
// przyciski w Control), przechodzi na stronę i podświetla element z dymkiem.
// Czyste dane — bez DOM (kopia trafia też na serwer MCP, który zwraca link).
//   sel     — selektor elementu do podświetlenia;
//   select  — zaznacz najpierw kafel z id (game | logo | base) — tylko widok;
//   before  — kliknięcia odsłaniające (karta, sekcja, menu „Więcej”) — tylko widok;
//   about   — opis dla modelu (po angielsku).
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
    play: { sel: "#btnPlay", select: "game", about: "Play the selected game (opens Control)" },
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
    install: { sel: "#btnInstall", about: "Install Familijna on the device (shown when the browser allows it)" },
    language: { sel: ".lang-btn", about: "Language of the service (flag button in the top bar)" },
    appearance: { sel: ".theme-btn", about: "Appearance: automatic, light or dark" },
    menu_more: { sel: "#btnMore", about: "Menu “More”: logos, bases, friends, subscribers, tasks, Market, connect a device" },
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
    play: { sel: "#btnPlay", about: "Play the game" },
  },
  polls: {
    share: { sel: "#secShare", before: ["#tabShare"], about: "Poll link and QR code to share" },
    copy_link: { sel: "#btnCopy", before: ["#tabShare"], about: "Copy the poll link" },
    qr: { sel: "#qr", before: ["#tabShare"], about: "QR code of the poll (click to enlarge)" },
    recipients: { sel: "#btnAddRecipients", before: ["#tabRecipients"], about: "Add recipients (friends, subscribers)" },
    results: { sel: "#secResults", before: ["#tabResults"], about: "Poll results" },
    open: { sel: "#btnOpenPoll", about: "Start the poll" },
    stop: { sel: "#btnStopPoll", about: "Stop the poll" },
    tally: { sel: "#btnTallyPoll", about: "Tally the poll" },
  },
  logoEditor: {
    tab_text: { sel: "#tabLogoText", about: "Tab: text logos" },
    tab_draw: { sel: "#tabLogoDraw", about: "Tab: drawn logos" },
    tab_image: { sel: "#tabLogoImage", about: "Tab: logos from an image (upload a picture)" },
    new_logo: { sel: ".addCard", about: "Tile that creates a new logo in the current tab" },
    new_image_logo: { sel: ".addCard", before: ["#tabLogoImage"], about: "Create a logo from an image file (upload)" },
    edit: { sel: "#btnEdit", select: "logo", about: "Edit the selected logo" },
    preview: { sel: "#btnPreview", select: "logo", about: "Preview the selected logo" },
    export_file: { sel: "#btnExport", select: "logo", about: "Export the selected logo to a file" },
    import_file: { sel: "#btnImport", about: "Import a logo from a file" },
    send_copy: { sel: "#btnSendCopy", select: "logo", about: "Send a copy of the selected logo to friends" },
  },
  logoDraw: {
    toolbar: { sel: "#editorToolbar", about: "Drawing tools: brush, eraser, shapes, text, undo" },
    canvas: { sel: "#drawStageHost", about: "Drawing area" },
  },
  logoImage: {
    pick: { sel: "#btnPickImage", about: "Choose an image file" },
    adjust: { sel: "#imgPanels", about: "Brightness, contrast, crop of the image" },
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
    tree: { sel: "#tree", about: "Folders of the base" },
    tags: { sel: "#tags", about: "Tags" },
    list: { sel: "#list", about: "Questions and folders in the current folder" },
    toolbar: { sel: "#toolbar", about: "Actions: new question/folder, move, delete, tags, create a game" },
  },
  friends: {
    invite: { sel: "#btnInvite", before: ["#contactsTabInvite"], about: "Invite a friend" },
    received: { sel: "#contactsTabReceived", about: "Invitations received" },
  },
  subscribers: {
    invite: { sel: "#btnInvite", before: ["#contactsTabInvite"], about: "Add a subscriber (e-mail)" },
  },
  marketplace: {
    search: { sel: "#btnSearchFocus", about: "Search the Market" },
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
    device_display: { sel: '[data-device="display"]', about: "Display: code, open, share" },
    device_host: { sel: '[data-device="host"]', about: "Host tablet: code, QR, share" },
    device_buzzer: { sel: '[data-device="buzzer"]', about: "Buzzer phone: code, QR, share" },
    device_status: { sel: "#dotDisplayRow", about: "Connection status of devices (top bar)" },
    mute: { sel: "#btnMute", about: "Mute sounds" },
    no_host_tablet: { sel: '[data-device="host"] .device-row-opt', about: "Option: play without the host tablet" },
    physical_buzzer: { sel: '[data-device="buzzer"] .device-row-opt', about: "Option: physical buzzers instead of the phone" },
    test_mode: { sel: ".control-test-choice", about: "Test mode: all screens in one window for a rehearsal" },
    start_over: { sel: "#btnStartOver", about: "Start the game over" },
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
