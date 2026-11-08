// js/pages/editor.js
// Edytor gry: lista pytań po lewej, pytanie z odpowiedziami po prawej.
// Każde pole zapisuje się samo (tekst: po pauzie w pisaniu i przy wyjściu z
// pola, punkty: przy wyjściu z pola). Limity i obsługa pól są wspólne z
// modalem pytania w bazie pytań (js/core/question-form.js).
import { sb } from "../../../shared/js/core/supabase.js?v=v2026-11-08T15440";
import { initPage } from "../../../shared/js/core/page-init.js?v=v2026-11-08T15440";
import { alertModal, confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-08T15440";
import { parseQaText } from "../../../shared/js/core/text-import.js?v=v2026-11-08T15440";
import { gameRuleErrorMessage, guardGameState, editGate, RULES as GV_RULES, TYPES } from "../../../shared/js/core/game-validate.js?v=v2026-11-08T15440";
import { readinessChecklist } from "../../../shared/js/core/game-rules.js?v=v2026-11-08T15440";

import {
  LIMITS, normQuestionText, normAnswerText, parsePoints,
  wireTextLimit, wirePointsInput, sumPoints, renderSumPill, questionProblems,
  wireAnswerInput, answerFieldProblem, buildAnswerHints, loadAnswerGlyphs,
  buildAnswerRow, buildAddAnswerTile,
} from "../../../shared/js/core/question-form.js?v=v2026-11-08T15440";
import { guardResourceLock, showBlockingOverlay } from "../../../shared/js/core/resource-lock.js?v=v2026-11-08T15440";
import { updateChecked, ROW_GONE } from "../../../shared/js/core/db-guard.js?v=v2026-11-08T15440";
import { initI18n, t } from "../../../shared/translation/translation.js?v=v2026-11-08T15440";
import { backHref, backLabel } from "../../../shared/js/core/nav-map.js?v=v2026-11-08T15440";
import "../../../shared/js/core/contact-modal.js?v=v2026-11-08T15440";
import { icon, iconText } from "../../../shared/js/core/icons.js?v=v2026-11-08T15440";
import { questionFromSearch, questionHref } from "./question-url.js?v=v2026-11-08T15440";
import { openDialog, closeDialog, setOverlayOpen, isSheetViewport } from "../../../shared/js/core/modal-sheet.js?v=v2026-11-08T15440";
import { bindLocalizedFilePicker } from "../../../shared/js/core/file-picker.js?v=v2026-11-08T15440";
import { toast } from "../../../shared/js/core/toast.js?v=v2026-11-08T15440";

// initI18n + remove('page-loading') są w boot() — przed requireAuth, żeby body pojawiło się przed auth/danymi

const MSG = {
  defaultGameName: () => t("editor.defaultGameName"),
  questionDefault: (ord) => t("editor.defaults.question", { ord }),
  answerDefault: (ord) => t("editor.defaults.answer", { ord }),
  cannotEdit: () => t("editor.alert.cannotEdit"),
  gameNotFound: () => t("editor.alert.gameNotFound"),
  nameSaveError: () => t("editor.status.nameSaveError"),
  addQuestionError: () => t("editor.status.addQuestionError"),
  deleteQuestionConfirm: () => t("editor.confirm.deleteQuestion"),
  deleteQuestionError: () => t("editor.status.questionDeleteError"),
  deleteAnswerConfirm: () => t("editor.confirm.deleteAnswer"),
  addAnswerError: () => t("editor.status.answerAddError"),
  deleteAnswerError: () => t("editor.status.answerDeleteError"),
  saveError: () => t("editor.status.saveError"),
  pointsSaveError: () => t("editor.status.pointsSaveError"),
  loadError: () => t("editor.status.loadError"),
  rowGone: () => t("editor.status.rowGone"),
  deleteLabel: () => t("editor.actions.delete"),
  addQuestionLabel: () => t("editor.actions.addQuestion"),
  questionLabel: (ord) => t("editor.labels.questionNumber", { ord }),
  questionsOnly: () => t("editor.labels.questionsOnly"),
  answersSum: (count, max, sum, sumMax) =>
    t("editor.labels.answersSum", { count, max, sum, sumMax }),
  answersCount: (count, max) => t("editor.labels.answersCount", { count, max }),
  answerLimitReached: () => t("editor.status.answerLimitReached"),
  importFileFailed: () => t("editor.import.fileFailed"),
  importChooseFile: () => t("editor.import.chooseFile"),
  importPastePrompt: () => t("editor.import.pastePrompt"),
  importParseError: (code, params) => t(`editor.import.errors.${code}`, params || {}),
  importConfirm: () => t("editor.import.confirm"),
  importCancelled: () => t("editor.import.cancelled"),
  importRunning: () => t("editor.import.running"),
  importError: (msg) => t("editor.import.error", { error: msg }),
  minQuestions: (min, count) => t("editor.status.minQuestions", { min, count }),
  minQuestionsOk: () => t("editor.status.minQuestionsOk"),
  editorError: () => t("editor.alert.editorError"),
};

const QN_MIN = GV_RULES.QN_MIN; // 10
const AN_MAX = LIMITS.AN_MAX;   // 6
const SUM_MAX = LIMITS.SUM_MAX; // 100

/* ================= DOM helpers ================= */
const $ = (id) => document.getElementById(id);

function showError(msg) {
  if (msg) toast(msg, { kind: "error" });
}

// Baza odrzuciła zapis, bo zmieniły się reguły gry (np. ankietę właśnie
// otwarto w innej karcie -- migracja 274). Dalsze pisanie i tak by się nie
// zapisało, więc zamiast samego komunikatu ten sam overlay co przy blokadzie
// zasobu, z powrotem do listy gier. Zwraca komunikat (albo "").
function ruleBlocked(e) {
  const msg = gameRuleErrorMessage(e);
  // Odrzucona treść (limit / znaki, migracja 404) -- do poprawy w polu, bez blokady strony.
  if (msg && String(e?.message || "").includes("content_invalid:")) return msg;
  if (msg) {
    showBlockingOverlay({ title: t("gameValidate.lockedTitle"), message: msg, backHref: backHref("editor") });
  }
  return msg;
}

function openOverlay(id, on) {
  const el = $(id);
  if (!el) return;
  if (!on) closeDialog(el);
  else if (id === "txtImportOverlay") openDialog(el, { onClose: () => openOverlay(id, false) });
  else setOverlayOpen(el, true);
}

// debounce z flush(): przy przełączeniu pytania / wyjściu ze strony
// oczekujący zapis ma pójść od razu, a nie przepaść.
function debounce(fn, ms = 350) {
  let timer = null;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...lastArgs); }, ms);
  };
  wrapped.cancel = () => { clearTimeout(timer); timer = null; };
  wrapped.flush = () => {
    if (!timer) return;
    wrapped.cancel();
    fn(...lastArgs);
  };
  return wrapped;
}

const normName = (s) => (String(s ?? "").trim() || MSG.defaultGameName()).slice(0, 80);

/* ================= DB ================= */
async function loadGame(gameId) {
  const { data, error } = await sb()
    .from("games")
    .select("id,name,type,status")
    .eq("id", gameId)
    .maybeSingle();
  // zmyślony identyfikator w adresie (nie UUID) -- to też „nie ma takiej gry”,
  // a nie ogólny błąd edytora
  if (error?.code === "22P02") return null;
  if (error) throw error;
  return data; // null = nie ma albo cudza (RLS)
}

async function saveGameName(gameId, name) {
  await updateChecked("games", { id: gameId }, { name });
}

// Pytania razem z liczbą odpowiedzi i sumą punktów -- jedno zapytanie
// (wcześniej osobne zapytanie o odpowiedzi dla każdego pytania, po każdej
// zmianie punktów).
// Odpowiedzi z id i ord: pierwsze pytanie po wejściu pokazuje je bez
// osobnego zapytania (selectQuestion z preloaded).
async function listQuestionsWithStats(gameId) {
  const { data, error } = await sb()
    .from("questions")
    .select("id,ord,text,answers(id,ord,text,fixed_points)")
    .eq("game_id", gameId)
    .order("ord", { ascending: true });
  if (error) throw error;
  const byOrd = (a, b) => Number(a.ord) - Number(b.ord);
  return (data || []).map((q) => ({ id: q.id, ord: q.ord, text: q.text, answers: [...(q.answers || [])].sort(byOrd) }));
}

async function listAnswers(questionId) {
  const { data, error } = await sb()
    .from("answers")
    .select("id,ord,text,fixed_points")
    .eq("question_id", questionId)
    .order("ord", { ascending: true });
  if (error) throw error;
  return data || [];
}

async function createQuestion(gameId, ord) {
  const { data, error } = await sb()
    .from("questions")
    .insert({ game_id: gameId, ord, text: MSG.questionDefault(ord) })
    .select("id,ord,text")
    .single();
  if (error) throw error;
  return { ...data, answers: [] };
}

// RPC z migracji 276: usunięcie + przenumerowanie w jednej transakcji.
async function deleteQuestionRpc(qId) {
  const { data, error } = await sb().rpc("game_question_delete", { p_question_id: qId });
  if (error) throw error;
  if (!data?.ok) {
    const e = new Error(data?.error || "delete_failed");
    if (data?.error === "not_found") e.code = ROW_GONE;
    throw e;
  }
}

async function renumberQuestionsRpc(gameId) {
  const { error } = await sb().rpc("game_questions_renumber", { p_game_id: gameId });
  if (error) throw error;
}

async function createAnswer(questionId, ord) {
  const { data, error } = await sb()
    .from("answers")
    .insert({ question_id: questionId, ord, text: MSG.answerDefault(ord), fixed_points: 0 })
    .select("id,ord,text,fixed_points")
    .single();
  if (error) throw error;
  return data;
}

async function deleteAnswer(aId) {
  const { data, error } = await sb().from("answers").delete().eq("id", aId).select("id");
  if (error) throw error;
  if (!data?.length) {
    const e = new Error("answer gone");
    e.code = ROW_GONE;
    throw e;
  }
}

// RPC z migracji 276: wyczyszczenie gry i wgranie pytań w jednej
// transakcji. Wcześniej ~80 osobnych zapytań po skasowaniu starej treści --
// błąd w połowie zostawiał grę pustą albo z połową pytań.
async function importContentRpc(gameId, name, questions) {
  const { data, error } = await sb().rpc("game_import_content", {
    p_game_id: gameId,
    p_name: name || null,
    p_questions: questions,
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error || "import_failed");
}

function nextAnswerOrd(answers) {
  const used = new Set((answers || []).map((a) => a.ord));
  for (let i = 1; i <= AN_MAX; i++) if (!used.has(i)) return i;
  return null;
}

/* ================= UI config by type ================= */
function cfgFromGameType(type) {
  if (type === TYPES.POLL_TEXT) {
    return {
      type,
      title: t("editor.config.pollText.title"),
      hintTop: t("editor.config.pollText.hintTop"),
      hintBottom: t("editor.config.pollText.hintBottom"),
      allowAnswers: false,
      allowPoints: false,
    };
  }
  if (type === TYPES.POLL_POINTS) {
    return {
      type,
      title: t("editor.config.pollPoints.title"),
      hintTop: t("editor.config.pollPoints.hintTop"),
      hintBottom: t("editor.config.pollPoints.hintBottom"),
      allowAnswers: true,
      allowPoints: false,
    };
  }
  return {
    type,
    title: t("editor.config.prepared.title"),
    hintTop: t("editor.config.prepared.hintTop"),
    // Punkty i sumę pokazuje już lista warunków nad pytaniami -- bez powtórki na dole.
    hintBottom: "",
    allowAnswers: true,
    allowPoints: true,
  };
}

// Pytania z importu -> payload dla game_import_content. Te same limity i
// domyślne teksty co przy ręcznej edycji.
function importPayload(items, cfg) {
  return items.map((it, qi) => ({
    text: normQuestionText(it.qText) || MSG.questionDefault(qi + 1),
    answers: !cfg.allowAnswers ? [] : (it.answers || []).slice(0, AN_MAX).map((a, ai) => ({
      text: normAnswerText(a.text) || MSG.answerDefault(ai + 1),
      points: cfg.allowPoints ? (parsePoints(a.points) ?? 0) : 0,
    })),
  }));
}

// Pierwsza importowana odpowiedź ze znakami spoza czcionki Wyświetlacza --
// import TXT zapisuje odpowiedzi tak jak ręczna edycja, więc ich nie przyjmie.
function invalidImportAnswer(items, cfg) {
  if (!cfg.allowAnswers) return null;
  for (const [qi, it] of items.entries()) {
    for (const [ai, a] of (it.answers || []).slice(0, AN_MAX).entries()) {
      const problem = answerFieldProblem(a.text);
      if (problem) return { q: qi + 1, ord: ai + 1, chars: problem.params.chars };
    }
  }
  return null;
}

/* ================= Boot ================= */
async function leaveTo(text) {
  if (text) await alertModal({ text });
  location.href = backHref("editor");
}

async function boot() {
  /* ---------- i18n + early body reveal ---------- */
  const i18nP = initI18n({ withSwitcher: true }); // auth startuje równolegle (initPage)
  // flushSaves działa na strukturach tworzonych po wczytaniu gry; do tego czasu
  // „Wstecz” / „Wskazówki” nie mają czego dopychać.
  let flushHook = async () => {};
  const userP = initPage("editor", {
    ready: i18nP,
    // Wstecz zależy od trybu edycji, który znamy dopiero po wczytaniu gry.
    deferTopbarReady: true,
    // Etykietę „Wstecz” ustawia syncMobileEditingState (tryb edycji pytania).
    backLabel: false,
    // Oczekujące zapisy przed wyjściem; na telefonie „Wstecz” zamyka pytanie.
    onBack: async (href) => {
      if (document.body.classList.contains("mobile-editing")) {
        leaveQuestionEditor();
        return;
      }
      await flushHook();
      location.href = href;
    },
    onManual: async (href) => {
      await flushHook();
      location.href = href;
    },
  });
  // Gra i pytania idą od razu, równolegle z sesją, blokadą i stanem gry
  // (RLS i tak sprawdza token). Pokazane dopiero po przejściu blokady
  // i stanu; po resecie ankiety / przenumerowaniu — wczytane ponownie.
  const earlyId = new URLSearchParams(location.search).get("id");
  const early = (load) => { const p = earlyId ? load(earlyId) : null; p?.catch(() => {}); return p; };
  const gameP = early(loadGame);
  let questionsP = early(listQuestionsWithStats);

  await i18nP;
  document.documentElement.classList.remove("page-loading");

  /* ---------- auth/topbar ---------- */
  const user = await userP;
  if (!user) return; // initPage przekierował na logowanie

  const btnBack = $("btnBack");

  // Enter w polu jednowierszowym = koniec edycji (blur zapisuje)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const el = e.target;
    if (el instanceof HTMLInputElement && el.type !== "file") {
      e.preventDefault();
      el.blur();
    }
  });

  /* ---------- game ---------- */
  // Komunikaty przed przekierowaniem czekają na OK -- wcześniej
  // location.href szło od razu i alert znikał, zanim dało się go przeczytać.
  const gameId = new URLSearchParams(location.search).get("id");
  if (!gameId) return leaveTo(t("editor.alert.missingId"));

  let game = await gameP;
  if (!game) return leaveTo(MSG.gameNotFound());

  // resourceType: "game" — wspólny klucz z game-settings.js (i docelowo
  // polls.js/control): edytor i ustawienia operują na tych samych,
  // powiązanych danych (pytania ↔ wybór finału/rund), więc wzajemnie się
  // wykluczają dla tej samej gry, nie tylko w obrębie tej samej strony.
  const lock = await guardResourceLock({
    resourceType: "game",
    resourceId: gameId,
    context: "editor",
    message: t("resourceLock.gameMessage"),
    backHref: backHref("editor"),
  });
  if (!lock.ok) return;

  // Czy wolno edytować (i czy trzeba zresetować zamkniętą ankietę) — baza.
  // Najpierw blokada zasobu, potem stan (reset zamkniętej ankiety tylko
  // z wziętą blokadą gry). Niedozwolony stan (np. otwarta ankieta) blokuje
  // stronę w całości — także przy wejściu wpisanym adresem.
  const editInfo = await guardGameState(gameId, "edit");
  if (!editInfo) return;

  if (editInfo.needsReset) {
    // To samo potwierdzenie i pełny reset co lista Gier i „Zmień typ”.
    const gate = await editGate(gameId);
    if (!gate.ok) return leaveTo("");
    game = await loadGame(gameId);
    if (!game) return leaveTo(MSG.gameNotFound());
    questionsP = null; // reset mógł zmienić pytania
  }

  let cfg = cfgFromGameType(game.type);

  /* ---------- state ---------- */
  let questions = [];   // { id, ord, text, answers: [{ text, fixed_points }] } -- do kafelków
  let activeQId = null;
  let answers = [];     // odpowiedzi aktywnego pytania { id, ord, text, fixed_points }
  let answersSeq = 0;   // numer ostatniego wczytania odpowiedzi (spóźnione odpowiedzi odrzucamy)
  const busy = new Set(); // akcje w toku (podwójny klik)
  const pendingSaves = new Set();

  // Zapis w toku -- żeby "Moje gry" / "Wstecz" poczekało na niego zamiast
  // przerwać żądanie nawigacją (ostatnio wpisany tekst przepadał).
  function track(p) {
    pendingSaves.add(p);
    p.finally(() => pendingSaves.delete(p));
    return p;
  }

  const once = (key, fn) => async (...args) => {
    if (busy.has(key)) return;
    busy.add(key);
    try { return await fn(...args); } finally { busy.delete(key); }
  };

  /* ---------- refs ---------- */
  const qList = $("qList");
  const qText = $("qText");
  const aList = $("aList");
  const pointsRemainTop = $("pointsRemainTop");
  const rightPanel = document.querySelector(".rightPanel");
  const gameName = $("gameName");

  const isMobileLayout = () => window.matchMedia("(max-width: 980px)").matches;
  const activeQuestion = () => questions.find((x) => x.id === activeQId) || null;

  /* ---------- header ---------- */
  function renderHeader() {
    cfg = cfgFromGameType(game.type);
    $("pageTitle").textContent = cfg.title;
    $("hintTop").textContent = cfg.hintTop;
    renderRules();
    $("hintBottom").textContent = cfg.hintBottom;
    $("hintBottom").hidden = !cfg.hintBottom;
    document.body.classList.toggle("only-questions", !cfg.allowAnswers);
    document.body.classList.toggle("no-points", !cfg.allowPoints);
  }

  // Telefon i tablet dotykowy: pytanie edytuje się w oknie od dołu (jak okno
  // pytania w Eksploratorze; decyzja użytkownika 2026-10-20). Węższe okno
  // komputera zostaje przy widoku pytania z „Wstecz”.
  const editorBox = $("editor");
  const sheetOverlay = $("questionSheetOverlay");
  let sheetOpen = false;
  const useQuestionSheet = () => isMobileLayout() && isSheetViewport() && !!activeQId;

  function openQuestionSheet() {
    sheetOpen = true;
    $("qSheetBody").append(editorBox);
    openDialog(sheetOverlay, { onClose: leaveQuestionEditor });
  }

  function closeQuestionSheet() {
    sheetOpen = false;
    closeDialog(sheetOverlay);
    rightPanel?.append(editorBox);
  }

  function syncMobileEditingState() {
    const sheet = useQuestionSheet();
    if (sheet && !sheetOpen) openQuestionSheet();
    else if (!sheet && sheetOpen) closeQuestionSheet();
    if (sheetOpen) $("qSheetTitle").textContent = MSG.questionLabel(activeQuestion()?.ord ?? "");
    const on = isMobileLayout() && !!activeQId && !sheet;
    document.body.classList.toggle("mobile-editing", on);
    if (btnBack) btnBack.innerHTML = iconText("arrow-left", on ? t("editor.backToQuestions") : backLabel("editor"));
  }

  /* ---------- game name ---------- */
  gameName.maxLength = 80;
  gameName.value = game.name || "";
  let lastSavedName = normName(game.name);

  async function saveNameNow() {
    const cur = normName(gameName.value);
    if (cur === lastSavedName) {
      if (gameName.value !== cur) gameName.value = cur;
      return;
    }
    try {
      await saveGameName(gameId, cur);
      lastSavedName = cur;
      // pusta nazwa zapisuje się jako domyślna -- pokaż to w polu
      if (document.activeElement !== gameName) gameName.value = cur;
    } catch (e) {
      console.error(e);
      showError(MSG.nameSaveError());
    }
  }
  gameName.addEventListener("blur", () => track(saveNameNow()));

  /* ---------- question list ---------- */
  function cardMeta(q) {
    if (!cfg.allowAnswers) return MSG.questionsOnly();
    if (cfg.allowPoints) return MSG.answersSum(q.answers.length, AN_MAX, sumPoints(q.answers), SUM_MAX);
    return MSG.answersCount(q.answers.length, AN_MAX);
  }

  // Kolor kafelka: zielony, gdy pytanie spełnia reguły typu (podpowiedź --
  // o grze i tak decyduje baza przez game_validate).
  function cardOk(q) {
    if (!cfg.allowAnswers) return null;
    return questionProblems(q, cfg.type).length === 0;
  }

  function updateCard(q) {
    const card = qList?.querySelector(`.qcard[data-id="${q.id}"]`);
    if (!card) return;
    card.querySelector(".qord").textContent = MSG.questionLabel(q.ord);
    card.querySelector(".qprev").textContent = (q.text || "").trim() || MSG.questionLabel(q.ord);
    card.querySelector(".qmeta").textContent = cardMeta(q);
    const ok = cardOk(q);
    card.classList.toggle("good", ok === true);
    card.classList.toggle("bad", ok === false);
    renderRules();
  }

  // Warunki gotowości na żywo (ten sam silnik co baza: readinessChecklist).
  function renderRules() {
    const box = $("rulesList");
    if (!box || !cfg) return;
    box.innerHTML = "";
    for (const item of readinessChecklist(cfg.type, questions)) {
      const li = document.createElement("li");
      li.className = item.ok ? "ok" : "bad";
      const where = item.ok || !item.ords.length ? "" : " — " + t("editor.rules.where", { list: item.ords.join(", ") });
      li.innerHTML = icon(item.ok ? "check" : "warning");
      li.append(t(`editor.rules.${item.key}`, item.params) + where);
      box.appendChild(li);
    }
  }

  function renderAddQuestionTile() {
    renderRules();
    const sub = qList?.querySelector(".addCard .sub");
    if (sub) sub.textContent = questions.length >= QN_MIN ? MSG.minQuestionsOk() : MSG.minQuestions(QN_MIN, questions.length);
  }

  function renderQuestions() {
    if (!qList) return;
    qList.innerHTML = "";

    const addQ = document.createElement("button");
    addQ.type = "button";
    addQ.className = "addCard";
    addQ.innerHTML = `
      <div class="plus">${icon("plus")}</div>
      <div class="txt"></div>
      <div class="sub"></div>
    `;
    addQ.querySelector(".txt").textContent = MSG.addQuestionLabel().replace(/^[+＋]\s*/, "");
    addQ.addEventListener("click", addQuestion);
    qList.appendChild(addQ);

    for (const q of questions) {
      const card = document.createElement("div");
      card.className = "qcard";
      card.dataset.id = q.id;
      card.classList.toggle("active", q.id === activeQId);
      card.innerHTML = `
        <div class="qord"></div>
        <div class="qprev"></div>
        <div class="qmeta"></div>
        <button type="button" class="x">${icon("trash")}</button>
      `;
      const x = card.querySelector(".x");
      x.title = MSG.deleteLabel();
      x.setAttribute("aria-label", MSG.deleteLabel());
      x.addEventListener("click", (ev) => {
        ev.stopPropagation();
        deleteQuestion(q.id);
      });
      card.addEventListener("click", () => selectQuestion(q.id));
      qList.appendChild(card);
      updateCard(q);
    }
    renderAddQuestionTile();
  }

  // Zmiana pytania: przełączenie klasy, nie przebudowa listy.
  function markActiveCard() {
    qList?.querySelectorAll(".qcard[data-id]").forEach((el) => {
      el.classList.toggle("active", el.dataset.id === activeQId);
    });
  }

  // preloaded: odpowiedzi tego pytania wczytane razem z listą (wejście na stronę).
  async function selectQuestion(id, preloaded = null) {
    if (id === activeQId) return;
    // oczekujący zapis poprzedniego pytania idzie od razu (ze swoim id)
    saveQuestionDebounced.flush();
    activeQId = id;
    answers = [];
    const href = questionHref(location.href, id);
    if (href !== location.pathname + location.search + location.hash) history.replaceState(history.state, "", href);
    markActiveCard();
    renderEditor();

    if (!cfg.allowAnswers || !id) return;
    const seq = ++answersSeq;
    if (preloaded) {
      answers = preloaded.map(({ id: aId, ord, text, fixed_points }) => ({ id: aId, ord, text, fixed_points }));
      renderAnswers();
      return;
    }
    try {
      const rows = await listAnswers(id);
      // szybkie klikanie A -> B: odpowiedzi A nie mogą nadpisać B
      if (seq !== answersSeq || activeQId !== id) return;
      answers = rows;
      renderAnswers();
    } catch (e) {
      console.error(e);
      if (seq === answersSeq) showError(MSG.loadError());
    }
  }

  function leaveQuestionEditor() {
    if (!activeQId) return;
    selectQuestion(null);
  }

  // Blokada podwójnego kliknięcia obejmuje tylko zapis -- kolejne "Dodaj
  // pytanie" zaraz po pojawieniu się kafelka ma działać, nawet gdy
  // odpowiedzi nowego pytania jeszcze się wczytują.
  const insertQuestion = once("addQuestion", async () => {
    try {
      const ord = questions.reduce((m, q) => Math.max(m, Number(q.ord) || 0), 0) + 1;
      const q = await createQuestion(gameId, ord);
      questions.push(q);
      renderQuestions();
      return q;
    } catch (e) {
      console.error(e);
      showError(ruleBlocked(e) || MSG.addQuestionError());
      return null;
    }
  });

  async function addQuestion() {
    const q = await insertQuestion();
    if (!q) return;
    await selectQuestion(q.id);
    // domyślna treść zaznaczona -- od razu można pisać własną
    if (activeQId === q.id) {
      qText?.focus();
      qText?.select();
    }
  }

  const deleteQuestion = once("deleteQuestion", async (qId) => {
    const ok = await confirmModal({ text: MSG.deleteQuestionConfirm() });
    if (!ok) return;
    try {
      await deleteQuestionRpc(qId);
    } catch (e) {
      console.error(e);
      if (e?.code === ROW_GONE) showError(MSG.rowGone());
      else return showError(ruleBlocked(e) || MSG.deleteQuestionError());
    }
    await reloadQuestions(activeQId === qId ? defaultActiveQuestionId : null);
  });

  function defaultActiveQuestionId() {
    return questionFromSearch(location.search, questions)
      || (isMobileLayout() ? null : (questions[0]?.id || null));
  }

  // pickActive: funkcja wybierająca aktywne pytanie po wczytaniu (null =
  // zostaw obecne, jeśli nadal istnieje)
  async function reloadQuestions(pickActive = null) {
    questions = await listQuestionsWithStats(gameId);
    let next = pickActive ? pickActive() : activeQId;
    if (next && !questions.some((q) => q.id === next)) next = defaultActiveQuestionId();
    renderQuestions();
    activeQId = undefined; // wymuś wczytanie odpowiedzi w selectQuestion
    await selectQuestion(next);
  }

  /* ---------- question text ---------- */
  // Zapis z id pytania z chwili pisania: po przełączeniu na inne pytanie
  // spóźniony zapis nie może wpisać tekstu poprzedniego do pola (wcześniej
  // tak się działo i następne wyjście z pola nadpisywało nim nowe pytanie).
  async function saveQuestionNow(qId, raw, { final } = {}) {
    const q = questions.find((x) => x.id === qId);
    if (!q) return;
    // questions_text_len wymaga min. 1 znaku -- pusty tekst zapisuje się
    // jako domyślna etykieta
    const text = normQuestionText(raw) || MSG.questionDefault(q.ord);
    try {
      if (text !== q.text) {
        await updateChecked("questions", { id: qId }, { text });
        q.text = text;
        updateCard(q);
      }
      // Pole poprawiamy tylko przy wyjściu z niego -- w trakcie pisania
      // trim() zjadał spację na końcu przy każdej pauzie (słowa się sklejały)
      // i przestawiał kursor na koniec.
      if (final && activeQId === qId && qText && document.activeElement !== qText && qText.value !== text) {
        qText.value = text;
      }
    } catch (e) {
      console.error(e);
      if (e?.code === ROW_GONE) {
        showError(MSG.rowGone());
        await reloadQuestions();
        return;
      }
      showError(ruleBlocked(e) || MSG.saveError());
    }
  }
  const saveQuestionDebounced = debounce((qId, raw) => track(saveQuestionNow(qId, raw)), 350);

  wireTextLimit(qText, LIMITS.Q_TEXT, () => {
    if (!activeQId) return;
    saveQuestionDebounced(activeQId, qText.value);
  });
  qText?.addEventListener("blur", () => {
    if (!activeQId) return;
    saveQuestionDebounced.cancel();
    track(saveQuestionNow(activeQId, qText.value, { final: true }));
  });

  /* ---------- answers ---------- */
  function refreshActiveStats() {
    const q = activeQuestion();
    if (!q) return;
    q.answers = answers.map((a) => ({ text: a.text, fixed_points: a.fixed_points }));
    updateCard(q);
  }

  // Suma na żywo z pól (także niezapisanych jeszcze punktów).
  function updateSumFromInputs() {
    if (!cfg.allowPoints || !pointsRemainTop) return;
    let sum = 0;
    const minPts = cfg.type === TYPES.PREPARED ? GV_RULES.PTS_MIN : 0;
    aList?.querySelectorAll("input.qf-pts").forEach((inp) => {
      const pts = parsePoints(inp.value) ?? 0;
      sum += pts;
      // preparowana: odpowiedź poniżej progu punktów (gra nie będzie gotowa)
      inp.classList.toggle("qf-invalid", pts < minPts);
    });
    renderSumPill(pointsRemainTop.querySelector(".qf-sum"), sum);
  }

  const addAnswer = once("addAnswer", async () => {
    const qId = activeQId;
    if (!qId) return;
    const ord = nextAnswerOrd(answers);
    if (!ord) return showError(MSG.answerLimitReached());
    try {
      const a = await createAnswer(qId, ord);
      if (activeQId !== qId) return;
      answers = [...answers, a].sort((x, y) => x.ord - y.ord);
      refreshActiveStats();
      renderAnswers();
      // nowa odpowiedź od razu do wpisania
      const inp = aList?.querySelector(`.qf-row[data-id="${a.id}"] .qf-text`);
      inp?.focus();
      inp?.select();
    } catch (e) {
      console.error(e);
      showError(ruleBlocked(e) || MSG.addAnswerError());
    }
  });

  const removeAnswer = once("removeAnswer", async (aId) => {
    const qId = activeQId;
    const ok = await confirmModal({ text: MSG.deleteAnswerConfirm() });
    if (!ok) return;
    try {
      await deleteAnswer(aId);
    } catch (e) {
      console.error(e);
      if (e?.code !== ROW_GONE) return showError(ruleBlocked(e) || MSG.deleteAnswerError());
      showError(MSG.rowGone());
    }
    if (activeQId !== qId) return;
    answers = answers.filter((x) => x.id !== aId);
    refreshActiveStats();
    renderAnswers();
  });

  // Odpowiedź zniknęła gdzie indziej -- zdejmij ją z listy.
  function dropGoneAnswer(aId) {
    answers = answers.filter((x) => x.id !== aId);
    refreshActiveStats();
    renderAnswers();
    showError(MSG.rowGone());
  }

  function answerRow(a) {
    // ten sam wiersz co w modalu pytania w bazie pytań (question-form.js)
    const { row, iText, iPts, bDel } = buildAnswerRow({
      text: a.text || "",
      points: parsePoints(a.fixed_points) ?? 0,
      placeholder: MSG.answerDefault(a.ord),
      showPoints: cfg.allowPoints,
    });
    row.dataset.id = a.id;

    // Zapisy odpowiedzi zmieniają tylko ten wiersz i kafelek pytania --
    // wcześniej zapis punktów przebudowywał całą listę: kursor wyskakiwał z
    // pola, do którego przeszło się Tabem, a klik w kosz innego wiersza
    // (który zdejmował focus z punktów) trafiał w usunięty element.
    const saveText = async ({ final } = {}) => {
      // Znaki spoza czcionki Wyświetlacza: odpowiedź się nie zapisuje (baza
      // też by ją odrzuciła); pole zostaje oznaczone, komunikat przy wyjściu.
      const problem = answerFieldProblem(iText.value);
      if (problem) {
        if (final) showError(t("gameValidate.answerChars", problem.params));
        return;
      }
      const text = normAnswerText(iText.value) || MSG.answerDefault(a.ord);
      try {
        if (text !== a.text) {
          await updateChecked("answers", { id: a.id }, { text });
          a.text = text;
        }
        if (final && document.activeElement !== iText && iText.value !== text) iText.value = text;
      } catch (e) {
        console.error(e);
        if (e?.code === ROW_GONE) return dropGoneAnswer(a.id);
        showError(ruleBlocked(e) || MSG.saveError());
      }
    };
    const saveTextDebounced = debounce(() => track(saveText()), 350);

    wireAnswerInput(iText, (_v, problem) => {
      if (problem) saveTextDebounced.cancel();
      else saveTextDebounced();
    });
    iText.addEventListener("blur", () => {
      saveTextDebounced.cancel();
      track(saveText({ final: true }));
    });

    if (iPts) {
      wirePointsInput(iPts, updateSumFromInputs);
      iPts.addEventListener("blur", () => track((async () => {
        const val = parsePoints(iPts.value) ?? 0;
        if (iPts.value !== String(val)) iPts.value = String(val);
        if (val === Number(a.fixed_points)) return;
        try {
          await updateChecked("answers", { id: a.id }, { fixed_points: val });
          a.fixed_points = val;
          refreshActiveStats();
        } catch (e) {
          console.error(e);
          if (e?.code === ROW_GONE) return dropGoneAnswer(a.id);
          showError(ruleBlocked(e) || MSG.pointsSaveError());
        }
      })()));
    }

    bDel.addEventListener("click", () => removeAnswer(a.id));
    return row;
  }

  function renderAnswers() {
    if (!cfg.allowAnswers || !aList) return;
    aList.innerHTML = "";
    if (pointsRemainTop) pointsRemainTop.innerHTML = "";

    // podpowiedzi nad kafelkiem dodawania (jak warunki nad „Dodaj pytanie”)
    aList.appendChild(buildAnswerHints());
    const addA = buildAddAnswerTile(answers.length);
    addA.addEventListener("click", addAnswer);
    aList.appendChild(addA);

    if (pointsRemainTop) {
      // nagłówek „Odpowiedzi” zawsze; znacznik sumy tylko z punktami
      const box = document.createElement("div");
      box.className = "qf-sum";
      pointsRemainTop.appendChild(box);
      renderSumPill(box, 0);
    }

    for (const a of answers) aList.appendChild(answerRow(a));
    updateSumFromInputs();
  }

  function renderEditor() {
    rightPanel?.classList.toggle("hasQ", !!activeQId);
    syncMobileEditingState();

    if (!activeQId) {
      if (qText) qText.value = "";
      if (aList) aList.innerHTML = "";
      if (pointsRemainTop) pointsRemainTop.innerHTML = "";
      return;
    }
    if (qText) qText.value = activeQuestion()?.text || "";
    renderAnswers();
  }

  // Oczekujące zapisy (pauza w pisaniu / pole z focusem) -- przed wyjściem.
  async function flushSaves() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    saveQuestionDebounced.flush();
    await Promise.allSettled([...pendingSaves]);
  }
  flushHook = flushSaves;

  /* ---------- import ---------- */
  const txtFile = $("txtFile");
  const txtFilePicker = bindLocalizedFilePicker({
    input: txtFile,
    button: $("btnTxtLoadFile"),
    fileName: $("txtFileName"),
    t,
  });
  const txtTa = $("txtTa");
  const btnTxtImport = $("btnTxtImport");

  const txtPreviewBody = $("txtPreviewBody");
  let txtPreviewTimer = 0;
  let importing = false;

  const setTxtMsg = (s) => { $("txtMsg").textContent = s || ""; };
  function renderTxtPreview() {
    if (!txtPreviewBody) return;
    const raw = String(txtTa?.value || "");
    if (!raw.trim()) {
      txtPreviewBody.classList.remove("is-error");
      txtPreviewBody.textContent = t("editor.importModal.previewEmpty");
      return;
    }
    const parsed = parseQaText(raw);
    if (!parsed.ok) {
      txtPreviewBody.classList.add("is-error");
      txtPreviewBody.textContent = t("editor.importModal.previewError", {
        error: MSG.importParseError(parsed.code, parsed.params),
      });
      return;
    }
    const bad = invalidImportAnswer(parsed.items, cfg);
    if (bad) {
      txtPreviewBody.classList.add("is-error");
      txtPreviewBody.textContent = t("editor.importModal.invalidChars", bad);
      return;
    }
    txtPreviewBody.classList.remove("is-error");
    const summary = document.createElement("div");
    summary.className = "import-preview-summary";
    summary.textContent = t("editor.importModal.previewSummary", {
      questions: parsed.items.length,
      answers: parsed.items.reduce((sum, item) => sum + item.answers.length, 0),
    });
    const list = document.createElement("div");
    list.className = "import-preview-list";
    for (const [index, item] of parsed.items.slice(0, 3).entries()) {
      const row = document.createElement("div");
      row.className = "import-preview-item";
      const question = document.createElement("strong");
      question.textContent = `${index + 1}. ${item.qText}`;
      const answers = document.createElement("div");
      answers.className = "import-preview-answers";
      answers.textContent = item.answers.slice(0, 5).map(answer => answer.text).join(" · ");
      if (item.answers.length > 5) answers.textContent += " · …";
      row.append(question, answers);
      list.append(row);
    }
    if (parsed.items.length > 3) {
      const more = document.createElement("div");
      more.className = "import-preview-answers";
      more.textContent = t("editor.importModal.previewMore", { count: parsed.items.length - 3 });
      list.append(more);
    }
    txtPreviewBody.replaceChildren(summary, list);
  }
  function scheduleTxtPreview() {
    clearTimeout(txtPreviewTimer);
    txtPreviewTimer = setTimeout(renderTxtPreview, 160);
  }

  function setImporting(on) {
    importing = on;
    for (const id of ["btnTxtClose", "btnTxtCancel", "btnTxtImport", "btnTxtLoadFile", "txtFile", "txtTa"]) {
      const el = $(id);
      if (el) el.disabled = on;
    }
  }

  function closeImport() {
    if (!importing) openOverlay("txtImportOverlay", false);
  }

  $("btnImportTxt")?.addEventListener("click", () => {
    void loadAnswerGlyphs().then(renderTxtPreview);
    txtTa.value = "";
    txtFilePicker.reset();
    setTxtMsg("");
    renderTxtPreview();
    openOverlay("txtImportOverlay", true);
    txtTa.focus();
  });
  $("btnTxtClose")?.addEventListener("click", closeImport);
  $("btnTxtCancel")?.addEventListener("click", closeImport);

  // Wybrany plik od razu wczytuje swoją treść do pola edycji.
  async function loadFileIntoTextarea() {
    const file = txtFile.files?.[0];
    if (!file) return setTxtMsg(MSG.importChooseFile());
    try {
      txtTa.value = await file.text();
      setTxtMsg("");
      renderTxtPreview();
    } catch (e) {
      console.error(e);
      setTxtMsg(MSG.importFileFailed());
    }
  }
  txtFile?.addEventListener("change", loadFileIntoTextarea);
  txtTa?.addEventListener("input", scheduleTxtPreview);
  window.addEventListener("i18n:lang", renderTxtPreview);

  btnTxtImport?.addEventListener("click", async () => {
    if (importing) return;
    const raw = String(txtTa.value || "");
    if (!raw.trim()) return setTxtMsg(MSG.importPastePrompt());

    const parsed = parseQaText(raw);
    if (!parsed.ok) return setTxtMsg(MSG.importParseError(parsed.code, parsed.params));
    await loadAnswerGlyphs();
    const bad = invalidImportAnswer(parsed.items, cfg);
    if (bad) return setTxtMsg(t("editor.importModal.invalidChars", bad));

    setImporting(true);
    try {
      const ok = await confirmModal({ text: MSG.importConfirm() });
      if (!ok) return setTxtMsg(MSG.importCancelled());

      await flushSaves();
      setTxtMsg(MSG.importRunning());
      const name = parsed.name ? normName(parsed.name) : null;
      await importContentRpc(gameId, name, importPayload(parsed.items, cfg));

      if (name) {
        lastSavedName = name;
        gameName.value = name;
      }
      await reloadQuestions(defaultActiveQuestionId);
      setImporting(false);
      closeImport();
    } catch (e) {
      console.error(e);
      // cała operacja jest w jednej transakcji -- przy błędzie gra zostaje
      // taka, jak była
      setTxtMsg(ruleBlocked(e) || MSG.importError(e?.message || String(e)));
    } finally {
      setImporting(false);
    }
  });

  /* ---------- init ---------- */
  renderHeader();
  questions = await (questionsP || listQuestionsWithStats(gameId));
  // dziury w numeracji (stare dane / przerwane usuwanie sprzed migracji 276)
  if (questions.some((q, i) => Number(q.ord) !== i + 1)) {
    await renumberQuestionsRpc(gameId);
    questions = await listQuestionsWithStats(gameId);
  }
  renderQuestions();
  activeQId = undefined;
  const firstId = defaultActiveQuestionId();
  await selectQuestion(firstId, questions.find((q) => q.id === firstId)?.answers || null);
  document.querySelector(".topbar")?.classList.add("topbar-ready");
  document.querySelectorAll("[data-skel-step]").forEach((el) => el.classList.add("skel-step-ready"));

  window.addEventListener("resize", syncMobileEditingState);

  window.addEventListener("i18n:lang", async () => {
    await flushSaves();
    renderHeader();
    renderQuestions();
    renderEditor();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  boot().catch((e) => {
    console.error(e);
    const back = $("btnBack");
    if (back) back.innerHTML = iconText("arrow-left", backLabel("editor"));
    document.querySelector(".topbar")?.classList.add("topbar-ready");
    void alertModal({ text: MSG.editorError() });
  });
});
