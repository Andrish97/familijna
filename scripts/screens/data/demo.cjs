// Dane demo dla atrapy Supabase (fake-supabase.js): tabele i RPC.
// Kolejność: najpierw dane kanoniczne ze starych zrzutów (panel.cjs) -- pierwsza
// gra, ankieta, pierwsze wpisy list -- potem dopełnienie z content.cjs, żeby
// listy były pełne. buildDb(lang, { gameState }) zwraca obiekt serializowalny
// do JSON (RPC zależne od argumentów zapisane jako "fn:<źródło>").
const fs = require("node:fs");
const path = require("node:path");
const content = require("./content.cjs");
const panel = require("./panel.cjs");

const repo = path.resolve(__dirname, "../../..");
const USER_ID = "00000000-0000-4000-8000-000000000001";
const id = (prefix, n) => `00000000-0000-4000-${prefix}-${String(n).padStart(12, "0")}`;
const daysAgo = (d, h = 0) => new Date(Date.UTC(2026, 9, 20, 12 - h, 0, 0) - d * 86400000).toISOString();
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(repo, file), "utf8"));

// Stałe identyfikatory używane przez sceny (scenes.cjs).
const IDS = {
  game: id("8000", 100),          // „Rodzinny pojedynek” -- gra wszystkich kadrów rozgrywki
  poll: id("8000", 103),          // „Weekendowy wyjazd” -- ankieta punktowa, otwarta
  textPoll: id("8000", 104),      // „Szybka ankieta” -- ankieta tekstowa, otwarta
  pollStopped: id("8000", 113),   // ankieta punktowa zatrzymana (z content.cjs)
  base: id("8400", 1),            // pierwsza baza z panelu
  logoDraw: id("8300", 44),       // „Gwiazdy wieczoru”: pełna scena Fabric do edytora rysunku
  logoText: id("8300", 40),
  logoClassic: id("8300", 1),
  tallyTie: id("8000", 130),      // ankieta tekstowa zatrzymana z remisem na granicy szóstki (E21)
};

// Dopełnienie z content.cjs: [klucz, typ, status, liczba pytań, przesunięcie w puli, dni temu, dodatki]
const MORE_GAMES = [
  ["family", "prepared", "ready", 12, 0, 4],
  ["summer", "prepared", "ready", 10, 2, 5],
  ["office", "poll_text", "poll_open", 10, 1, 6, { votes: 23 }],
  ["wedding", "poll_points", "poll_stopped", 10, 3, 7, { votes: 41 }],
  ["school", "poll_text", "ready", 10, 4, 8],
  ["birthday", "prepared", "draft", 6, 5, 9],
  ["quiz", "poll_points", "draft", 10, 0, 12],
  ["christmas", "prepared", "ready", 10, 6, 15, { from: 0 }],
  ["camp", "poll_text", "poll_open", 10, 7, 16, { votes: 12 }],
  ["teachers", "poll_points", "poll_open", 10, 8, 17, { votes: 37 }],
  ["newyear", "prepared", "ready", 11, 9, 18],
  ["seniors", "poll_text", "draft", 4, 10, 21],
  ["kids", "poll_points", "ready", 10, 11, 25],
  ["football", "prepared", "draft", 10, 3, 28, { badSum: true }],
];

function rulesState(type, status, nq, extra = {}) {
  const ok = { ok: true };
  const no = (code, params = {}) => ({ ok: false, code, params });
  const enough = extra.badSum ? no("sumTooBig", { ord: 4, max: 100, sum: 115 }) : nq >= 10 ? ok : no("minQuestions", { min: 10, n: nq });
  const poll = type !== "prepared";
  const edit = status === "poll_open" ? no("pollOpenNoEdit") : status === "poll_stopped" ? no("pollStoppedNoEdit") : ok;
  const transfer = poll && (status === "poll_open" || status === "poll_stopped") ? { ok: true, drops_votes: true } : ok;
  return {
    edit,
    change_type: edit,
    duplicate: transfer,
    send: poll && status !== "draft" ? no("sendOnlyDraft") : ok,
    play: poll && status !== "ready" ? no("playAfterPoll") : enough,
    poll_entry: poll ? ok : no("preparedNoPoll"),
    poll_open: !poll ? no("preparedNoPoll") : status === "poll_open" ? no("pollAlreadyOpen") : enough,
    poll_stop: status === "poll_open" ? ok : no("stopOnlyOpen"),
    poll_resume: status === "poll_stopped" ? ok : no("resumeOnlyStopped"),
    poll_close: status === "poll_open" || status === "poll_stopped" ? ok : no("closeOnlyOpen"),
    export: transfer,
    rules: { qn_min: 10, an_min: 3, an_max: 6, pts_min: 4, sum_max: 100 },
  };
}

function buildDb(lang, extras = {}) {
  const c = content[lang];
  const p = panel[lang];
  const user = { id: USER_ID, email: p.user.email, is_anonymous: false, user_metadata: { username: p.user.username }, app_metadata: {}, created_at: daysAgo(200) };
  const tables = {
    games: [], questions: [], answers: [], user_logos: [], question_bases: [], qb_categories: [], qb_questions: [], qb_tags: [],
    qb_question_tags: [], qb_category_tags: [], question_base_shares: [], profiles: [], user_flags: [], app_ratings: [], edit_locks: [],
    poll_votes: [], poll_text_entries: [], game_state: [], device_presence: [], display_audio_unlock: [], game_state_display_completion: [],
  };
  // Głosy ankiet: id pytania -> [[odpowiedź, głosy], ...] (wyniki get_poll_preview).
  const pollVotes = {};
  const voteCounts = [];

  // ---------- gry ----------
  let qn = 0; let an = 0;
  function addGame(gameId, { name, type, status, questions, age, from = null, votes = 0, badSum = false }) {
    const withAnswers = !(type === "poll_text" && status !== "ready");
    questions.forEach(([text, answers], i) => {
      const q = { id: id("8100", ++qn), game_id: gameId, ord: i + 1, text, created_at: daysAgo(age) };
      tables.questions.push(q);
      // Ankieta tekstowa przed podliczeniem nie ma jeszcze odpowiedzi (powstają z głosów).
      if (withAnswers) answers.forEach(([atext, pts], ai) => tables.answers.push({ id: id("8200", ++an), question_id: q.id, ord: ai + 1, text: atext, fixed_points: type === "prepared" || status === "ready" ? pts : 0, created_at: daysAgo(age) }));
      if (votes) pollVotes[q.id] = answers.map(([atext, v]) => [atext, type === "poll_points" && v < 20 ? v : Math.max(1, Math.round((v * votes) / 100))]);
    });
    if (votes) {
      const table = type === "poll_text" ? "poll_text_entries" : "poll_votes";
      tables.questions.filter((q) => q.game_id === gameId).forEach((q) => {
        for (let i = 0; i < votes; i++) tables[table].push({ id: id("8c00", tables[table].length + 1), game_id: gameId, question_id: q.id });
      });
      voteCounts.push({ game_id: gameId, votes });
    }
    tables.games.push({
      id: gameId, owner_id: USER_ID, name, type, status, created_at: daysAgo(age), updated_at: daysAgo(age, 2),
      poll_opened_at: status.startsWith("poll_") ? daysAgo(age) : null, poll_closed_at: null,
      share_key_poll: `poll${gameId.slice(-3)}KEY`, share_key_control: `ctl${gameId.slice(-3)}KEY`, share_key_display: `dsp${gameId.slice(-3)}KEY`, share_key_host: `hst${gameId.slice(-3)}KEY`, share_key_buzzer: `bzr${gameId.slice(-3)}KEY`,
      is_demo: false, source_market_id: null, settings: { logo_id: IDS.logoClassic }, rules_state: rulesState(type, status, questions.length, { badSum }),
      received_from_label: from, received_from_identity: from ? { username: from } : null,
    });
  }
  const rotate = (list, n) => list.map((_, i) => list[(i + n) % list.length]);
  // Panel: gra kadrów rozgrywki, dwie kolejne preparowane, ankieta punktowa i tekstowa.
  addGame(IDS.game, { name: p.game, type: "prepared", status: "ready", questions: p.gameQuestions, age: 0 });
  addGame(id("8000", 101), { name: p.otherGames[0], type: "prepared", status: "ready", questions: rotate(p.gameQuestions, 3), age: 1 });
  addGame(id("8000", 102), { name: p.otherGames[1], type: "prepared", status: "ready", questions: rotate(p.gameQuestions, 6), age: 2 });
  const pollQuestions = [...p.pollQuestions, ...c.questions.slice(0, 10 - p.pollQuestions.length).map(([text, answers]) => [text, answers.slice(0, 4).map(([a, pts]) => [a, Math.max(1, Math.round(pts / 6))])])];
  addGame(IDS.poll, { name: p.poll, type: "poll_points", status: "poll_open", questions: pollQuestions, age: 1, votes: 18 });
  addGame(IDS.textPoll, { name: p.textPoll, type: "poll_text", status: "poll_open", questions: c.questions.slice(2, 12), age: 3, votes: 15 });
  // Dopełnienie z content.cjs.
  MORE_GAMES.forEach(([key, type, status, count, offset, age, extra = {}], gi) => {
    const questions = Array.from({ length: count }, (_, i) => c.questions[(offset + i) % c.questions.length]);
    addGame(id("8000", 110 + gi), { name: c.games[key], type, status, questions, age, from: extra.from != null ? p.friends.accepted[extra.from][0] : null, votes: extra.votes || 0, badSum: !!extra.badSum });
  });

  // E21: zatrzymana ankieta tekstowa z remisem głosów na granicy szóstki
  // (pytanie 1: 6. i 7. odpowiedź mają po tyle samo głosów) -- podliczanie.
  addGame(IDS.tallyTie, { name: c.games.office + " · 2", type: "poll_text", status: "poll_stopped", questions: c.questions.slice(5, 15), age: 2 });
  const tieCounts = [5, 4, 3, 2, 2, 1, 1];
  tables.questions.filter((q) => q.game_id === IDS.tallyTie).forEach((q, qi) => {
    const pool = c.questions[(5 + qi) % c.questions.length][1].map(([t]) => t);
    const extra = ["Lody", "Kawa", "Pizza", "Sok", "Ryż", "Ser", "Zupa"];
    const texts = [...pool, ...extra].slice(0, 7);
    pollVotes[q.id] = texts.map((t, i) => [t, qi === 0 ? tieCounts[i] : [6, 5, 4, 3, 1, 1, 0][i]]).concat(qi === 0 ? [["😀", 2]] : []);
  });
  voteCounts.push({ game_id: IDS.tallyTie, votes: 20 });

  // ---------- logo ----------
  // Bez materiałów DEMO: klasyczne FAMILIADA (czcionka planszy) i logo
  // wypalone prawdziwymi edytorami (bake-logos.cjs). „Gwiazdy wieczoru” ma
  // pełną scenę Fabric dla edytora rysunku; reszcie wystarczą kropki/znaki.
  const logo = (n, name, type, payload, age) => tables.user_logos.push({ id: id("8300", n), user_id: USER_ID, name, type, payload, created_at: daysAgo(age), updated_at: daysAgo(age), is_demo: false, received_from_label: null, received_from_identity: null });
  logo(1, p.logos.classic, "GLYPH_30x10", { ...readJson("web/shared/data/logo_familiada.json"), source: { mode: "TEXT", text: "FAMILIADA" } }, 0);
  const bakedFile = path.join(__dirname, "logos.baked.json");
  if (fs.existsSync(bakedFile)) {
    JSON.parse(fs.readFileSync(bakedFile, "utf8")).forEach((item, i) => logo(40 + i, item.names[lang] || item.names.pl, item.type, item.payloads?.[lang] || item.payload, item.age || 5));
  }

  // ---------- bazy pytań ----------
  [...p.bases.map((name, i) => [name, i]), ...Object.values(c.bases).filter((v) => typeof v === "string").map((name, i) => [name, 6 + i * 7])]
    .forEach(([name, age], i) => tables.question_bases.push({ id: id("8400", i + 1), owner_id: USER_ID, name, created_at: daysAgo(age), updated_at: daysAgo(age, 1), is_demo: false }));
  const mainBase = IDS.base;
  c.bases.tags.forEach(([name, color], i) => tables.qb_tags.push({ id: id("8500", i + 1), base_id: mainBase, name, color, ord: i + 1, created_at: daysAgo(30) }));
  const folders = [...new Set([...p.folders, ...c.bases.folders.slice(0, 5)])];
  folders.forEach((name, i) => tables.qb_categories.push({ id: id("8600", i + 1), base_id: mainBase, parent_id: null, name, ord: i + 1, created_at: daysAgo(30), updated_at: daysAgo(30) }));
  // podfoldery (drzewo w oknie „Przenieś do”): folder 4 > Śniadania, Desery > Na słodko
  const [sub1, sub2, sub3] = c.bases.subfolders;
  [[90, 4, sub1, 1], [91, 4, sub2, 2], [92, 91, sub3, 1]].forEach(([n, parent, name, ord]) =>
    tables.qb_categories.push({ id: id("8600", n), base_id: mainBase, parent_id: id("8600", parent), name, ord, created_at: daysAgo(30), updated_at: daysAgo(30) }));
  // Pytania z panelu w pierwszych folderach, dalej pula content.cjs.
  const baseQuestions = [...p.gameQuestions.slice(1, 7), ...c.questions];
  baseQuestions.forEach(([text, answers], i) => {
    const qid = id("8700", i + 1);
    const folder = i < 2 ? null : id("8600", ((i - 2) % folders.length) + 1);
    tables.qb_questions.push({ id: qid, base_id: mainBase, category_id: folder, ord: i + 1, payload: { text, answers: answers.map(([t, pts], ai) => ({ ord: ai + 1, text: t, fixed_points: pts })) }, created_at: daysAgo(20 - (i % 20)), updated_at: daysAgo(10 - (i % 10)), updated_by: USER_ID });
    tables.qb_question_tags.push({ question_id: qid, tag_id: id("8500", (i % 3) + 1), created_at: daysAgo(10) });
    if (i % 4 === 0) tables.qb_question_tags.push({ question_id: qid, tag_id: id("8500", 4), created_at: daysAgo(10) });
  });
  tables.qb_category_tags.push({ category_id: id("8600", 2), tag_id: id("8500", 1), created_at: daysAgo(10) });

  tables.profiles.push({ id: USER_ID, username: p.user.username, email: p.user.email, language: lang, created_at: daysAgo(200) });

  // ---------- znajomi, subskrybenci, zadania ----------
  let fn = 0;
  const friend = (label, email, direction, status) => ({ id: id("8800", ++fn), label, email, friend_user_id: id("8810", fn), direction, status, created_at: daysAgo(fn * 2), resend_available_at: daysAgo(1), email_enabled: true });
  const friends = [
    ...p.friends.accepted.map(([l, e]) => friend(l, e, "friend", "active")),
    ...c.friends.slice(0, 3).map(([l, e]) => friend(l, e, "friend", "active")),
    // Przed przyjęciem znajomości bez adresu drugiej strony (migracja 457);
    // pierwsze wysłane zaproszenie -- na adres wpisany przez użytkownika.
    ...p.friends.incoming.map(([l]) => friend(l, null, "incoming", "pending")),
    ...p.friends.outgoing.map(([l, e, s], i) => friend(l, i === 0 ? e : null, "outgoing", s)),
  ];
  let sn = 0;
  const sub = (email, status) => ({ id: id("8900", ++sn), email, label: email, status, friend_user_id: sn <= 2 ? id("8910", sn) : null, created_at: daysAgo(sn * 3), resend_available_at: daysAgo(1), email_enabled: true });
  const subscribers = [
    ...p.subscribers.map((e) => sub(e, "active")),
    ...c.subscribers.slice(0, 3).map((e) => sub(e, "active")),
    ...p.invitations.map(([e, s]) => sub(e, s)),
  ];
  let tn = 0;
  const task = (title, owner, state, pollType, age) => ({ kind: "poll", id: id("8a00", ++tn), state, title, owner_label: owner, created_at: daysAgo(age, 3), done_at: state === "done" ? daysAgo(age) : null, token: id("8a10", tn), poll_type: pollType, game_id: id("8000", 200 + tn) });
  const owners = p.friends.accepted.map(([l]) => l);
  const tasks = [
    task(p.game, owners[0], "todo", "poll_points", 0),
    task(c.games.wedding, owners[1], "todo", "poll_points", 1),
    task(c.games.quiz, c.friends[0][0], "todo", "poll_text", 2),
    task(p.poll, owners[0], "done", "poll_points", 3),
    task(c.games.school, c.friends[1][0], "done", "poll_text", 4),
  ];

  // Udostępnianie ankiety: znajomi i subskrybenci z różnymi stanami zaproszeń.
  const sharePanel = {
    ok: true,
    friends: friends.filter((f) => f.direction === "friend").map((f) => ({ user_id: f.friend_user_id, email: f.email, label: f.label, email_enabled: true })),
    subscribers: subscribers.filter((s) => s.status === "active").map((s) => ({ id: s.id, email: s.email, email_enabled: true })),
    tasks: [
      { id: id("8d00", 1), recipient_user_id: friends[0].friend_user_id, recipient_email: friends[0].email, label: friends[0].label, status: "done", reminder_count: 0, email_enabled: true },
      { id: id("8d00", 2), recipient_user_id: null, recipient_email: subscribers[0].email, label: subscribers[0].email, status: "done", reminder_count: 0, email_enabled: true },
      { id: id("8d00", 3), recipient_user_id: null, recipient_email: subscribers[1].email, label: subscribers[1].email, status: "pending", reminder_count: 1, email_enabled: true },
      { id: id("8d00", 4), recipient_user_id: null, recipient_email: subscribers[2].email, label: subscribers[2].email, status: "pending", reminder_count: 0, email_enabled: true },
    ],
  };

  // ---------- rozgrywka ----------
  if (extras.gameState) {
    tables.game_state.push({ game_id: IDS.game, ...extras.gameState });
    const now = new Date().toISOString();
    for (const device_type of ["display", "host", "buzzer"]) tables.device_presence.push({ game_id: IDS.game, device_type, last_seen_at: now, meta: { page_visibility: "visible" } });
    tables.display_audio_unlock.push({ game_id: IDS.game, request_nonce: "screens", acknowledged_nonce: "screens" });
  }

  // ---------- RPC ----------
  const rpc = {
    // Urządzenia Prowadzący/Przycisk otwarte z klucza (bez ?preview): jedyne aktywne połączenie, logo domyślne.
    control_device_instance_register: { mode: "lease", state: "primary", epoch: 1, queue_position: null, waiting_count: 0, audio_unlocked: false },
    control_device_instance_heartbeat: { mode: "lease", state: "primary", epoch: 1, queue_position: null, waiting_count: 0, audio_unlocked: false },
    host2_logo_get_public: { logo: null },
    control2_device_log: 1,
    game_state_display_is_ready: true,
    poll_share_panel: sharePanel,
    get_poll_preview: `fn:(args, db) => {
      const votes = ${JSON.stringify(pollVotes)};
      const g = db.tables.games.find((x) => x.id === args.p_game_id);
      if (!g) return null;
      const questions = db.tables.questions.filter((q) => q.game_id === g.id).sort((a, b) => a.ord - b.ord).map((q) => {
        const pool = votes[q.id] || [];
        const answers = db.tables.answers.filter((a) => a.question_id === q.id).sort((a, b) => a.ord - b.ord)
          .map((a) => ({ id: a.id, ord: a.ord, text: a.text, fixed_points: a.fixed_points, votes: (pool.find(([t]) => t === a.text) || [0, 0])[1] }));
        const text_rows = pool.map(([text, val]) => ({ text: text.toLowerCase(), val }));
        return { id: q.id, ord: q.ord, text: q.text, answers, text_rows };
      });
      return { ok: true, status: g.status, type: g.type, questions };
    }`,
    contacts_list: `fn:(args) => (args.p_kind === "friends" ? ${JSON.stringify(friends)} : ${JSON.stringify(subscribers)})`,
    // Okno udostępniania bazy: znajomi do zaznaczenia, wysłane (oczekujące/odrzucone) i aktywne udostępnienia.
    base_share_panel: {
      ok: true,
      friends: friends.filter((f) => f.direction === "friend").slice(2).map((f) => ({ user_id: f.friend_user_id, label: f.label, email: f.email, cooldown_until: null })),
      // pierwsze zaproszenie z aktywnym licznikiem ponownej wysyłki (5 h)
      outgoing: friends.filter((f) => f.direction === "friend").slice(0, 1).map((f, i) => ({ task_id: id("8e00", i + 1), user_id: f.friend_user_id, label: f.label, email: f.email, status: "pending", role: "viewer", is_friend: true, email_enabled: true, cooldown_until: new Date(Date.now() + 5 * 3600e3 + 7 * 60e3).toISOString() }))
        .concat(friends.filter((f) => f.direction === "outgoing").slice(0, 1).map((f, i) => ({ task_id: id("8e00", i + 5), user_id: f.friend_user_id, label: f.label, email: f.email, status: "declined", role: "viewer", is_friend: false, email_enabled: true, cooldown_until: null }))),
      active: friends.filter((f) => f.direction === "friend").slice(1, 2).map((f, i) => ({ task_id: id("8e00", i + 9), user_id: f.friend_user_id, label: f.label, email: f.email, status: "done", role: "editor", is_friend: true, email_enabled: true }))
        // długa nazwa: sprawdza wielokropek i stałą wysokość kafla
        .concat([{ task_id: id("8e00", 12), user_id: id("8810", 99), label: "bardzo_dluga_nazwa_uzytkownika_do_testu", email: "bardzo.dluga.nazwa.uzytkownika@example.test", status: "pending", role: "editor", is_friend: true, email_enabled: true, cooldown_until: null }]),
    },
    tasks_list: tasks,
    resource_copy_inbox: [],
    snake_log: { ok: true, best: 23, games: 7 },
    // Migracja 445: zajętość nazwy i e-mail właściciela zaproszenia przez RPC.
    username_taken: false, poll_go_owner_email_match: null,
    // Control: wszystkie urządzenia na miejscu (migracja 397).
    control_devices_snapshot: `fn:() => ({ ok: true, server_time: new Date().toISOString(), devices: Object.fromEntries(["display", "host", "buzzer"].map((k) => [k, { primary_online: true, audio_unlocked: true, visibility: "visible", focused: true, waiting_count: 0, last_seen_at: new Date().toISOString(), meta: { page_visibility: "visible" } }])) })`,
    // Kosz menedżera bazy (migracja 428): foldery spoza głównej bazy demo
    // i pytanie z panelu, różny wiek wpisów (licznik dni, ostrzeżenie ≤ 3).
    qb_trash_list: `fn:() => ${JSON.stringify([
      [c.bases.folders[5], "folder", 2, 4, 1], [p.gameQuestions[0][0], "question", 12, 1, 0], [c.bases.folders[6], "folder", 27, 7, 2],
    ].map(([label, kind, age, nq, nf], i) => ({ id: id("8800", i + 1), kind, label, item_id: id("8801", i + 1), origin_id: null, n_questions: nq, n_folders: nf, age })))}
      .map(({ age, ...it }) => ({ ...it, deleted_at: new Date(Date.now() - age * 864e5 - 36e5).toISOString(), expires_at: new Date(Date.now() + (30 - age) * 864e5 - 36e5).toISOString() }))`,
    // E22 (430): cała zawartość bazy menedżera jednym zapytaniem
    qb_base_content: `fn:(args, db) => {
      const id = args.p_base_id;
      const byOrd = (a, b) => (a.ord || 0) - (b.ord || 0) || String(a.id).localeCompare(String(b.id));
      const questions = db.tables.qb_questions.filter((q) => q.base_id === id).sort(byOrd);
      const qids = new Set(questions.map((q) => q.id));
      return {
        categories: db.tables.qb_categories.filter((c) => c.base_id === id).sort(byOrd),
        tags: db.tables.qb_tags.filter((t) => t.base_id === id).sort(byOrd),
        questions,
        questionTags: db.tables.qb_question_tags.filter((l) => qids.has(l.question_id)).map(({ question_id, tag_id }) => ({ question_id, tag_id })),
      };
    }`,
    reserved_username_prefixes_list: [], site_activity_ping: null,
    acquire_edit_lock_mode: { ok: true }, release_edit_lock: { ok: true }, release_edit_lock_mode: { ok: true }, refresh_edit_lock: { ok: true },
    // E22 (431): blokady zbiorcze
    acquire_edit_locks: { ok: true }, release_edit_locks: { ok: true }, expire_edit_locks_absent: { ok: true, removed: 0 },
    // E22 (430): przypisania tagów wskazanych pytań (okno tagów)
    qb_question_tag_links: `fn:(args, db) => {
      const ids = new Set(args.p_question_ids || []);
      return db.tables.qb_question_tags.filter((l) => ids.has(l.question_id)).map(({ question_id, tag_id }) => ({ question_id, tag_id }));
    }`,
    list_shared_bases_ext: [], base_declines_list_mine: [], bases_count_incoming_share_invites: 0,
    resource_copy_inbox_list: [], resource_copy_badges: [],
    badges_get: { friends_pending: p.friends.incoming.length }, list_shared_devices_for_me: [
      { share_id: "00000000-0000-4000-9300-000000000001", device_type: "display", owner_username: "aleksandra_nowak", game_name: "Rodzinny pojedynek", game_id: IDS.game, share_key: "demo-key" },
      { share_id: "00000000-0000-4000-9300-000000000002", device_type: "host", owner_username: "aleksandra_nowak", game_name: "Rodzinny pojedynek", game_id: IDS.game, share_key: "demo-key" },
      { share_id: "00000000-0000-4000-9300-000000000003", device_type: "buzzer", owner_username: "jan_kowalski", game_name: "Wesele Ani i Tomka", game_id: IDS.game, share_key: "demo-key" },
      { share_id: "00000000-0000-4000-9300-000000000004", device_type: "display", owner_username: "jan_kowalski", game_name: "Wesele Ani i Tomka", game_id: IDS.game, share_key: "demo-key" },
    ],
    polls_vote_counts: voteCounts,
    // E21: dane podliczania (N pełnych ankiet, głosy pełnych ankiet, teksty już oczyszczone).
    poll_tally_source: `fn:(args, db) => {
      const votes = ${JSON.stringify(pollVotes)};
      const g = db.tables.games.find((x) => x.id === args.p_game_id);
      if (!g) return null;
      const qs = db.tables.questions.filter((q) => q.game_id === g.id).sort((a, b) => a.ord - b.ord);
      const n = 20;
      return { n, min: 10, questions: qs.map((q) => {
        const pool = votes[q.id] || [];
        if (g.type === "poll_points") return { question_id: q.id, ord: q.ord, answers: db.tables.answers.filter((a) => a.question_id === q.id).map((a) => ({ id: a.id, ord: a.ord, votes: (pool.find(([t]) => t === a.text) || [0, 0])[1] })) };
        const clean = pool.filter(([t, v]) => v > 0 && !t.includes("😀"));
        return { question_id: q.id, ord: q.ord, dropped: pool.filter(([t]) => t.includes("😀")).reduce((s, [, v]) => s + v, 0),
          items: clean.map(([text, count]) => ({ text: text.toLowerCase(), count })) };
      }) };
    }`,
    poll_text_tally_draft_get: { draft: null, saved_at: null },
    market_my_library: [],
    market_public_catalog: ["pl", "en", "uk"].flatMap((mlang) => content[mlang].market.map(([title, description, author], i) => ({
      id: id("8b00", ["pl", "en", "uk"].indexOf(mlang) * 100 + i + 1), slug: `demo-${mlang}-${i+1}`, lang: mlang, title, description,
      author_username: author || "", origin: author ? "community" : "producer",
      library_count: [184, 152, 97, 73, 61, 45, 38, 22][i], avg_rating: [4.8, 4.6, 4.4, 4.7, 4.1, 3.9, 4.5, 4.2][i], rating_count: [56, 41, 23, 19, 12, 8, 11, 5][i],
      in_library: mlang === lang && i === 1, created_at: daysAgo(i * 5 + 2),
    }))),
    get_my_email_notifications: true, set_my_email_notifications: null, cooldown_get: [],
    get_app_rating_stats: { avg_stars: 4.8, total_count: 126 },
    friend_invites_from_subscriptions: { ok: true },
    control_game_settings_status: { ok: true, in_progress: false },
    game_validate: `fn:(args, db) => { const g = db.tables.games.find((x) => x.id === args.p_game_id); const s = g?.rules_state || {}; return { ok: !!g, game: g ? { id: g.id, type: g.type, status: g.status, rev: 1 } : null, ...s }; }`,
    update_logo_checked: { ok: true },
    game_state_get: `fn:(args, db) => db.tables.game_state.find((r) => r.game_id === args.p_game_id) || null`,
    // Kadry rozgrywki: wszystkie urządzenia połączone, dźwięk Wyświetlacza odblokowany.
    control_devices_snapshot: { ok: true, devices: Object.fromEntries(["display", "host", "buzzer"].map((kind) => [kind, {
      primary_online: true, waiting_count: 0, visibility: "visible", focused: true, audio_unlocked: true, meta: {},
    }])) },
    // Zapis stanu z Control (kroki Urządzenia/Podsumowanie zapisują od razu
    // po starcie): ten sam wiersz z kolejną rewizją, jak game_state_write.
    game_state_write: `fn:(args, db) => {
      const row = db.tables.game_state.find((r) => r.game_id === args.p_game_id);
      if (!row) return null;
      Object.assign(row, { rev: (row.rev || 0) + 1, step: args.p_step, top_card: args.p_top_card, phase: args.p_phase,
        control_team: args.p_control_team, detail: args.p_detail ?? row.detail,
        sound_cue_key: args.p_sound_cue_key, sound_cue_seq: (row.sound_cue_seq || 0) + (args.p_sound_cue_key ? 1 : 0) });
      return { ...row };
    }`,
    game_state_set_ui_lang: `fn:(args, db) => ({ ...(db.tables.game_state.find((r) => r.game_id === args.p_game_id) || {}) })`,
    control_device_shares_list: [], control_device_share_preflight: { ok: true, mail_allowed: true }, market_my_submissions: [
      { id: id("mkt-sent-1"), title: "Rodzinny pojedynek", lang: "pl", status: "published", library_count: 42, avg_rating: 4.6, rating_count: 12 },
      { id: id("mkt-sent-2"), title: "Wesele Ani i Tomka", lang: "pl", status: "pending", library_count: 0 },
      { id: id("mkt-sent-3"), title: "Pubowy quiz czwartkowy", lang: "pl", status: "rejected", library_count: 0, moderation_note: "Za mało pytań w rundzie finałowej." },
    ], friends_list: friends.filter((f) => f.direction === "friend").map((f) => ({ user_id: f.friend_user_id, label: f.label, email: f.email, direction: "friend", status: "active" })), resource_copy_history: { ok: true, items: [] },
    control_runtime_session_touch_v2: { ok: true, session_id: id("8e00", 1), device_protocol: 2, expired: false },
    control2_session_ping: null, control2_control_log: 1, control2_net_ping: null,
    control_runtime_device_link: { ok: true, token: "screensDeviceKey" }, generate_device_connect_code: { ok: true, code: "482193" },
    // Głosowanie z linku (anonimowo): stan i treść ankiety.
    poll_state: `fn:(args, db) => { const g = db.tables.games.find((x) => x.id === args.p_game_id); return g ? { ok: true, state: g.status === "poll_open" ? "open" : "ended", type: g.type } : { ok: false, state: "not_found" }; }`,
    poll_get_payload: `fn:(args, db) => {
      const g = db.tables.games.find((x) => x.id === args.p_game_id);
      if (!g) return null;
      const questions = db.tables.questions.filter((q) => q.game_id === g.id).sort((a, b) => a.ord - b.ord).map((q) => ({
        id: q.id, ord: q.ord, text: q.text,
        answers: db.tables.answers.filter((a) => a.question_id === q.id).sort((a, b) => a.ord - b.ord).map((a) => ({ id: a.id, ord: a.ord, text: a.text })),
      }));
      return { game: { id: g.id, name: g.name, type: g.type, status: g.status }, questions };
    }`,
  };

  return {
    user, tables, rpc,
    // Funkcje Edge: token Realtime urządzenia (Prowadzący/Przycisk z klucza).
    functions: { "device-realtime-token": { token: "demo-realtime-token" } },
    relations: {
      "games.questions": { fk: "game_id" },
      "questions.answers": { fk: "question_id" },
      "question_base_shares.question_bases": { local: "base_id", one: true },
      "qb_question_tags.qb_questions": { local: "question_id", one: true },
    },
    localStorage: { "sb-api-auth-token": "screens" },
    http: {
      "/_api/mail/session": { ok: true, email: p.user.email, notifications_enabled: true,
        subscriptions: friends.filter((f) => f.direction === "friend").slice(0, 4).map((f, i) => ({ kind: "subscription", id: id("8f00", i + 1), owner_label: f.label, status: i === 1 ? "pending" : "active" })),
        items: [
          ...tasks.filter((x) => x.state === "todo").map((x, i) => ({ kind: "poll", id: id("8f10", i + 1), name: x.title, owner_label: x.owner_label, status: i === 0 ? "opened" : "pending", link: `/go/?t=${x.token}` })),
          { kind: "device", id: id("8f20", 1), name: p.game, owner_label: friends[0].label, device_type: "host", link: "/go/?t=00000000-0000-4000-8000-0000000000aa" },
        ] },
      // Panel admina (/admin/): odpowiedzi API Workera za Cloudflare Access.
      "/_admin_api/me": { ok: true, email: "admin@example.com" },
      "/_admin_api/activity*": { ok: true, history: { hour: [], day: [], week: [] }, games: [], pages: [], locks: [] },
      "/_admin_api/state": { enabled: false, mode: "message", message: "" },
      // Liczniki powiadomień panelu: 3 nieprzeczytane maile, 2 otwarte zgłoszenia, 4 gry do zatwierdzenia.
      "/_admin_api/messages?filter=inbox*": { ok: true, rows: [1, 2, 3, 4].map((n) => ({ id: `m${n}`, direction: "inbound", is_read: n === 4, report_id: null, subject: `Pytanie ${n}`, created_at: "2026-10-20T10:00:00Z" })) },
      "/_admin_api/reports?status=all*": { ok: true, rows: [
        { id: "r1", status: "open", ticket_number: "TICKET-2026-0007", subject: "Nie działa dźwięk na Wyświetlaczu", created_at: "2026-10-22T18:10:00Z", message_count: 2 },
        { id: "r2", status: "open", ticket_number: "TICKET-2026-0006", subject: "Błąd w pytaniu finałowym", created_at: "2026-10-20T09:30:00Z", message_count: 3, author_account_deleted_at: "2026-10-21T12:00:00Z" },
        { id: "r3", status: "closed", ticket_number: "TICKET-2026-0005", subject: "Pytanie o import gry", created_at: "2026-10-18T15:45:00Z", message_count: 1 },
      ] },
      "/_admin_api/marketplace/list?status=pending*": { ok: true, rows: ["Rodzinny quiz", "Wieczór filmowy", "Szkolna Familiada", "Kuchnia świata", "Gra producenta"].map((title, i) => ({ id: `mk${i}`, title, lang: "pl", status: "pending", origin: i === 4 ? "producer" : "user", author_username: "ania.k", created_at: "2026-10-19T18:00:00Z", library_count: 0 })) },
      // Poczta: treść HTML maila w podglądzie (iframe sandbox bez skryptów --
      // skrypt i onerror z treści nie mogą nic zmienić; audyt E24, Ś6).
      "/_admin_api/messages/read*": { ok: true },
      "/_admin_api/messages?filter=all*": { ok: true, rows: [] },
      "/_admin_api/messages/detail*": { ok: true, message: { id: "m1", direction: "inbound", source: "email", is_read: true, lang: "pl",
        from_email: "anna.nowak@example.com", to_email: "kontakt@familiada.online", subject: "Pytanie 1", created_at: "2026-10-20T10:00:00Z",
        body: "Dzień dobry, mam pytanie o finał.",
        body_html: '<p>Dzień dobry,</p><p>mam pytanie o <b>finał</b> — czy można zmienić czas odpowiedzi?</p><p><a href="https://www.familiada.online/manual/" target="_blank">Podręcznik</a></p><script>document.body.innerHTML = "<h1 style=\'color:red\'>SKRYPT Z MAILA DZIAŁA</h1>";</script><img src="x:" onerror="document.body.style.background=\'red\'">' } },
      "/_admin_api/attachments?message_id=*": { ok: true, attachments: [] },
      // Kontakty marketingowe: stan zlecenia lead-findera przez Worker (Ś2).
      "/_admin_api/leads/search-runs/status": { status: "paused", run_id: "0f1e2d3c-4b5a-4987-8654-3210fedcba98", verified: 12, errors: 0 },
      // Lead Finder 3: kategorie i kontakty z wysyłkami i odpowiedziami.
      "/_admin_api/marketing/categories": { ok: true, rows: [
        { id: "a1000000-0000-4000-8000-000000000001", name: "DJ na wesela", is_active: true, contacts: 2, expanded_at: "2026-10-25T09:00:00Z",
          description: "DJ-e i wodzireje prowadzący wesela i imprezy firmowe; bez sklepów i kursów DJ.", queries: ["DJ na wesele kontakt e-mail", "DJ weselny @gmail.com", "wodzirej i DJ oferta"], pkd: ["93.29.Z", "90.01.Z"] },
        { id: "a1000000-0000-4000-8000-000000000002", name: "Agencje eventowe", is_active: true, contacts: 1, expanded_at: null, description: null, queries: [], pkd: [] },
        { id: "a1000000-0000-4000-8000-000000000003", name: "Szkoły", is_active: false, contacts: 0, expanded_at: null, description: null, queries: [], pkd: [] },
      ] },
      "/_admin_api/marketing/contacts/emails?*": { ok: true, emails: ["kontakt@wodzirej-example.test"], total: 1 },
      "/_admin_api/marketing/contacts?*": { ok: true, total: 4, rows: [
        { id: "c1", email: "biuro@djmax-example.test", title: "DJ Max — wesela i imprezy", url: "https://djmax-example.test", category_id: "a1000000-0000-4000-8000-000000000001", added_at: "2026-10-25T09:00:00Z", sent_count: 1, last_sent_at: "2026-10-20T09:00:00Z", reaction: "replied" },
        { id: "c2", email: "kontakt@wodzirej-example.test", title: "Wodzirej Anna", url: "https://wodzirej-example.test", category_id: "a1000000-0000-4000-8000-000000000001", added_at: "2026-10-24T09:00:00Z", sent_count: 0, last_sent_at: null, reaction: null },
        { id: "c3", email: "events@agencja-example.test", title: "Agencja eventowa Fala", url: "https://agencja-example.test", category_id: "a1000000-0000-4000-8000-000000000002", added_at: "2026-10-18T09:00:00Z", sent_count: 2, last_sent_at: "2026-10-22T09:00:00Z", reaction: null },
        { id: "c4", email: "biuro@stare-example.test", title: "Studio imprez Bis", url: "https://stare-example.test", category_id: null, added_at: "2026-09-18T09:00:00Z", sent_count: 1, last_sent_at: null, reaction: "declined" },
      ] },
      "/_admin_api/marketing/logs": { ok: true, rows: [
        { created_at: "2026-10-20T10:01:00Z", level: "info", message: "Zlecenie wstrzymane" },
        { created_at: "2026-10-20T10:00:00Z", level: "success", message: "Zweryfikowano kontakt" },
      ] },
      // E25: wykluczenia ze statystyk -- automatyczne z rolą konta testowego, ręczne z przyciskiem
      "/_admin_api/stats/excluded": { ok: true, rows: [
        ...["e2e.standard01", "e2e.standard02", "e2e.standard03"].map((username) => ({ user_id: `00000000-0000-4000-8000-0000000000${username.slice(-2)}`, username, email: `e2e+${username.slice(4)}@familiada.online`, reason: "test:standard", automatic: true, added_at: "2026-10-22T20:30:00Z" })),
        { user_id: "00000000-0000-4000-8000-0000000000d1", username: "e2e.disposable01", email: "e2e+disposable01@familiada.online", reason: "test:disposable", automatic: true, added_at: "2026-10-22T20:30:00Z" },
        { user_id: "00000000-0000-4000-8000-0000000000e1", username: "e2e.dedicated01", email: "e2e+dedicated01@familiada.online", reason: "test:dedicated", automatic: true, added_at: "2026-10-22T20:30:00Z" },
        { user_id: "00000000-0000-4000-8000-0000000000f1", username: "guest_3fa9c2d1", email: "", reason: "test_guest", automatic: true, added_at: "2026-10-22T20:31:00Z" },
        { user_id: "00000000-0000-4000-8000-0000000000aa", username: "wlasciciel", email: "admin@example.com", reason: "manual", automatic: false, added_at: "2026-10-01T09:00:00Z" },
      ] },
      // Migracja 466: przebieg rozgrywki z pomiarami łącza (start, spowolnienie, powrót).
      "/_admin_api/stats/detail?type=gameplay*": { ok: true, rows: [{
        game_name: "Quiz rodzinny", owner: "jan.kowalski", control_version: 2, status: "playing", effective_status: "playing",
        started_at: "2026-10-22T21:00:00Z", ended_at: null, rounds_played: 2, rounds_score_a: 62, rounds_score_b: 100,
        team_a_score: 62, team_b_score: 100, final_step: null, final_points: null, winner_team: null, error_count: 0,
        stats_detail: { last_step: "r_play", teams: { teamA: "Drużyna A", teamB: "Drużyna B" }, events: [
          { kind: "diagnostic", category: "device_network", at: "2026-10-22T21:00:05Z", devices: ["display"], message: "Pomiar łącza na starcie gry.",
            metrics: { source: "probe", phase: "baseline", verdict: "ok", edge_ms: 48, db_ms: 131, connection_type: "wifi", effective_type: "4g", browser_rtt_ms: 50, downlink_mbps: 9.6 } },
          { kind: "diagnostic", category: "device_network", at: "2026-10-22T21:00:06Z", devices: ["control"], message: "Pomiar łącza na starcie gry.",
            metrics: { source: "probe", phase: "baseline", verdict: "ok", edge_ms: 39, db_ms: 118 } },
          { kind: "diagnostic", category: "device_network", at: "2026-10-22T21:23:31Z", devices: ["display"], message: "Wolne łącze urządzenia (już do Cloudflare).",
            metrics: { source: "probe", phase: "slow", verdict: "device_network", edge_ms: 2140, db_ms: 2390, connection_type: "wifi", effective_type: "3g", browser_rtt_ms: 900, downlink_mbps: 0.8 } },
          { kind: "diagnostic", category: "device_network", at: "2026-10-22T21:24:40Z", devices: ["display"], message: "Łącze i odpowiedź serwera wróciły do normy.",
            metrics: { source: "probe", phase: "recovered", verdict: "device_network", duration_ms: 69000, samples: 12, device_network_samples: 12, server_samples: 0, max_edge_ms: 4810, max_db_ms: 5000, edge_ms: 61, db_ms: 140 } },
          { kind: "diagnostic", category: "device_network", at: "2026-10-22T21:40:02Z", devices: ["control"], message: "Wolna odpowiedź serwera przy sprawnym łączu urządzenia.",
            metrics: { source: "probe", phase: "slow", verdict: "server", edge_ms: 44, db_ms: 2730 } },
          // Diagnostyka per sesja (468–469): opis urządzeń, uśpienie telefonu, blokada ekranu.
          { kind: "diagnostic", category: "device_info", source: "display", prestart: true, at: "2026-10-22T20:58:10Z", devices: ["display"], message: "Urządzenie i przeglądarka.",
            metrics: { device_class: "phone", browser: "safari", os: "ios", battery_level: 30, charging: false } },
          { kind: "diagnostic", category: "wake_lock", source: "display", prestart: true, at: "2026-10-22T20:58:11Z", devices: ["display"], message: "Przeglądarka odmówiła blokady wygaszania ekranu.",
            metrics: { phase: "denied", error_name: "NotAllowedError" } },
          { kind: "diagnostic", category: "device_info", source: "control", prestart: true, at: "2026-10-22T20:57:40Z", devices: ["control"], message: "Urządzenie i przeglądarka.",
            metrics: { device_class: "desktop", browser: "chrome", os: "windows" } },
          { kind: "diagnostic", category: "display_state", source: "display", at: "2026-10-22T21:12:00Z", devices: ["display"], message: "Stan karty Wyświetlacz: w tle (zmiana widoczności).",
            metrics: { reason: "page_state", visibility: "hidden", visibility_reason: "visibilitychange" } },
          { kind: "diagnostic", category: "device_lease", source: "display", at: "2026-10-22T21:12:20Z", devices: ["display"], message: "Blokada urządzenia wygasła.",
            metrics: { from_state: "primary", to_state: "expired", epoch: 1 } },
          { kind: "diagnostic", category: "display_state", source: "display", at: "2026-10-22T21:13:05Z", devices: ["display"], message: "Stan karty Wyświetlacz: widoczna (zmiana widoczności).",
            metrics: { reason: "page_state", visibility: "visible", visibility_reason: "visibilitychange", hidden_duration_ms: 65000, since_heartbeat_ms: 64000 } },
        ] },
        diag: { event_count: 11, dropped_count: 0, summary: {
          display: {
            "device_network:baseline": { n: 1 }, "device_network:slow:device_network": { n: 1, max_ms: 2390 }, "device_network:recovered": { n: 1, dur_ms: 69000 },
            "device_info:device_info": { n: 1 }, "wake_lock:denied": { n: 1 },
            "display_state:page_state:hidden": { n: 1 }, "display_state:page_state:visible": { n: 1, hidden_ms: 65000 },
            "device_lease:expired": { n: 1 }, "device_lease:primary": { n: 2 },
          },
          control: { "device_network:baseline": { n: 1 }, "device_network:slow:server": { n: 1, max_ms: 2730 }, "device_info:device_info": { n: 1 } },
        } },
      }, {
        game_name: "Familiada w biurze", owner: "ola", control_version: 2, status: "final", effective_status: "final",
        started_at: "2026-10-21T18:00:00Z", ended_at: "2026-10-21T18:42:00Z", rounds_played: 5, rounds_score_a: 310, rounds_score_b: 180,
        team_a_score: 445, team_b_score: 180, final_step: "finished", final_points: 135, winner_team: "A", error_count: 0,
        stats_detail: { last_step: "f_end", teams: { teamA: "Księgowość", teamB: "IT" }, events: [] },
        diag: { event_count: 4, dropped_count: 0, summary: { host: { "display_state:page_state:hidden": { n: 2 }, "display_state:page_state:visible": { n: 2, hidden_ms: 14000 } } } },
      }, {
        game_name: "Wieczór quizowy", owner: "kuba2009", control_version: 2, status: "final", effective_status: "final",
        started_at: "2026-10-20T19:00:00Z", ended_at: "2026-10-20T19:35:00Z", rounds_played: 4, rounds_score_a: 220, rounds_score_b: 260,
        team_a_score: 220, team_b_score: 260, final_step: null, final_points: null, winner_team: "B", error_count: 0,
        stats_detail: { last_step: "r_gameEnd", teams: { teamA: "Kowalscy", teamB: "Nowakowie" }, events: [] },
        diag: { event_count: 6, dropped_count: 0, summary: {} },
      }] },
      "/_admin_api/stats/snake": { ok: true, stats: {
        kinds: { scan: { total: 142, today: 6, last_7d: 41, visitors: 118 }, enter: { total: 131, today: 6, last_7d: 38, visitors: 109 },
          start: { total: 388, today: 21, last_7d: 120, visitors: 87 }, finish: { total: 371, today: 19, last_7d: 115, visitors: 85 } },
        scores: { max: 61, avg: 9.4 }, players: 23,
        top: [["ania.k", 61, 40], ["Wujek_Staszek", 48, 12], ["quizmaster", 37, 55], ["ola", 29, 8], ["kuba2009", 22, 31]]
          .map(([username, best, games]) => ({ username, best, games, best_at: "2026-10-18T19:20:00Z" })),
        daily: Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(7 + i).padStart(2, "0")}`, scan: [3, 5, 2, 8, 12, 9, 4, 6, 15, 11, 7, 10, 14, 6][i], enter: [3, 4, 2, 7, 11, 9, 4, 5, 14, 10, 6, 9, 13, 6][i], start: [8, 12, 5, 20, 31, 22, 9, 14, 40, 28, 15, 26, 37, 21][i] })),
      } },
    },
  };
}

module.exports = { buildDb, USER_ID, id, IDS, panel };
