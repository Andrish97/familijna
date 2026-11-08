// js/core/question-form.js
// Wspólne dla obu miejsc, w których edytuje się pytanie z odpowiedziami:
// edytor gry (js/pages/editor.js, autozapis każdego pola) i modal pytania w
// bazie pytań (base-explorer/js/question-modal.js, jeden "Zapisz").
// Wcześniej każde miało własne limity i własną obsługę pola punktów -- w
// edytorze dało się wpisać 250 pkt i "-5", w modalu to samo pole ucinało do
// 0–100; modal zapisywał puste odpowiedzi i zdublowane numery, edytor nie.
//
// Liczby to te same co w bazie (CHECK-i tabel questions/answers, reguły w
// game_validate) -- tu tylko do pilnowania pól i podpowiedzi w UI; o tym,
// czy grę wolno otworzyć / grać, decyduje baza (js/core/game-validate.js).

import { RULES, TYPES } from "./game-rules.js?v=v2026-11-08T22523";
import { t } from "../../translation/translation.js?v=v2026-11-08T22523";
import { icon } from "./icons.js?v=v2026-11-08T22523";
import { loadFont5x7 } from "./logo-preview.js?v=v2026-11-08T22523";
import { QUESTION_MAX, ANSWER_MAX, FINAL_DISPLAY_MAX, clipChars, nfc, answerInvalidChars } from "./answer-text.js?v=v2026-11-08T22523";


export const LIMITS = {
  Q_TEXT: QUESTION_MAX, // questions_text_len (E21: 100)
  A_TEXT: ANSWER_MAX,   // answers_text_len
  AN_MIN: RULES.AN_MIN,
  AN_MAX: RULES.AN_MAX, // answers_ord_range
  PTS_MAX: 100,
  SUM_MAX: RULES.SUM_PREPARED,
};

/* ================= Tekst ================= */

// Znaki liczymy jak baza (char_length: pełne znaki Unicode po NFC), nie
// jednostki UTF-16 -- emoji to 1 znak, para zastępcza nie jest rozcinana.
// W trakcie pisania: tylko twardy limit, bez trim -- inaczej spacja na końcu
// znika przy każdej pauzie i słowa się sklejają.
export const clipQuestionText = (s) => clipChars(nfc(s), LIMITS.Q_TEXT);
export const clipAnswerText = (s) => clipChars(nfc(s), LIMITS.A_TEXT);

// Do zapisu.
export const normQuestionText = (s) => clipChars(nfc(s).trim(), LIMITS.Q_TEXT).trim();
export const normAnswerText = (s) => clipChars(nfc(s).trim(), LIMITS.A_TEXT).trim();

/**
 * Twardy limit znaków w polu, także przy wklejaniu (maxlength liczy jednostki
 * UTF-16 i nie działa przy programowym .value). onInput dostaje przyciętą wartość.
 */
export function wireTextLimit(el, max, onInput) {
  if (!el) return;
  el.addEventListener("input", () => {
    const clipped = clipChars(nfc(el.value), max);
    if (clipped !== el.value) el.value = clipped;
    onInput?.(el.value);
  });
}

/* ================= Znaki odpowiedzi (czcionka Wyświetlacza) ================= */

// Czcionka 5x7 Wyświetlacza (jak w ustawieniach gry) -- raz na stronę.
let glyphsPromise = null;
let glyphs = null;
export function loadAnswerGlyphs() {
  if (!glyphsPromise) {
    glyphsPromise = loadFont5x7().then((g) => { glyphs = g; return g; }).catch((e) => {
      console.warn("[question-form] font 5x7:", e);
      glyphsPromise = null;
      return null;
    });
  }
  return glyphsPromise;
}

/** Problem pola odpowiedzi albo null -- odpowiedź z takim problemem się nie zapisuje. */
export function answerFieldProblem(value) {
  const chars = answerInvalidChars(value, glyphs);
  return chars.length ? { code: "answerChars", params: { chars: chars.join(" ") } } : null;
}

/**
 * Pole odpowiedzi w obu edytorach (gra i baza pytań): limit 17 także przy
 * wklejaniu, a znaki spoza czcionki Wyświetlacza oznaczają pole jako błędne
 * (klasa qf-invalid + podpowiedź). onInput(value, problem).
 */
export function wireAnswerInput(el, onInput) {
  if (!el) return;
  const mark = () => {
    const problem = answerFieldProblem(el.value);
    el.classList.toggle("qf-invalid", !!problem);
    el.setAttribute("aria-invalid", problem ? "true" : "false");
    if (problem) el.title = t("gameValidate.answerChars", problem.params);
    else el.removeAttribute("title");
    return problem;
  };
  wireTextLimit(el, LIMITS.A_TEXT, (v) => onInput?.(v, mark()));
  if (glyphs) mark();
  else void loadAnswerGlyphs().then(() => mark());
}

/** Stałe podpowiedzi pod listą odpowiedzi (oba edytory). */
export function buildAnswerHints() {
  const box = document.createElement("div");
  box.className = "qf-hints";
  for (const key of ["answerLimit", "finalDisplay"]) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = t(`questionForm.hints.${key}`, { max: LIMITS.A_TEXT, final: FINAL_DISPLAY_MAX });
    box.appendChild(p);
  }
  return box;
}

/* ================= Punkty ================= */

/**
 * Wartość pola punktów: liczba całkowita 0–100 albo null (puste).
 * "12.7" -> 12, "-5" -> 0, "250" -> 100, "abc" -> null.
 */
export function parsePoints(raw) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.min(LIMITS.PTS_MAX, Math.max(0, Math.floor(n)));
}

/**
 * Pole punktów: tylko cyfry, najwyżej 100 (pojedyncza odpowiedź nigdy nie
 * może mieć więcej, niż wynosi cała pula). type="text" + inputmode="numeric"
 * zamiast type="number": number przepuszcza "e", "-", "1.5", a przy
 * niepoprawnej treści .value jest "", więc nie da się jej poprawić.
 * onInput dostaje liczbę albo null (puste pole).
 */
export function wirePointsInput(el, onInput) {
  if (!el) return;
  el.type = "text";
  el.inputMode = "numeric";
  el.autocomplete = "off";
  el.maxLength = 3;
  el.addEventListener("input", () => {
    // wklejone "-50" to 0 (jak w parsePoints/imporcie), a nie "50" --
    // samo wycięcie znaków niebędących cyframi odwracałoby znak
    const negative = /^\s*-/.test(el.value);
    const digits = negative ? "0" : el.value.replace(/\D/g, "").slice(0, 3);
    const val = digits === "" ? null : Math.min(LIMITS.PTS_MAX, Number(digits));
    const shown = val === null ? "" : String(val);
    if (el.value !== shown) el.value = shown;
    onInput?.(val);
  });
}

export function sumPoints(answers) {
  let s = 0;
  for (const a of answers || []) {
    const n = Number(a?.fixed_points);
    if (Number.isFinite(n)) s += n;
  }
  return s;
}

/** Nagłówek listy odpowiedzi z dopiskiem „Suma x/100” -- czerwony
 *  (klasa "over") powyżej puli. Wygląd jak nagłówki list (decyzja 2026-10-20). */
export function renderSumPill(el, sum) {
  if (!el) return;
  el.classList.toggle("over", sum > LIMITS.SUM_MAX);
  el.innerHTML = "";
  const label = document.createElement("span");
  label.className = "section-title";
  label.textContent = t("questionForm.answersHeading");
  const val = document.createElement("span");
  val.className = "qf-sumChip";
  const num = document.createElement("b");
  num.textContent = `${sum}/${LIMITS.SUM_MAX}`;
  val.append(t("questionForm.sumLabel"), num);
  el.append(label, val);
}

/* ================= Wiersze listy odpowiedzi (css/question-form.css) ================= */

/**
 * Wiersz odpowiedzi: [tekst] [punkty] [kosz]. Samo DOM -- limity podpina
 * wołający (wireTextLimit / wirePointsInput), bo edytor zapisuje każde pole
 * od razu, a modal dopiero po "Zapisz".
 */
export function buildAnswerRow({ text = "", points = null, placeholder = "", pointsPlaceholder = "", showPoints = true } = {}) {
  const row = document.createElement("div");
  row.className = "qf-row";

  const iText = document.createElement("input");
  iText.className = "qf-text";
  iText.type = "text";
  iText.autocomplete = "off";
  iText.value = text;
  iText.placeholder = placeholder;
  row.appendChild(iText);

  let iPts = null;
  if (showPoints) {
    // punkty z dopiskiem „pkt” w jednym polu
    const wrap = document.createElement("label");
    wrap.className = "qf-ptsWrap";
    iPts = document.createElement("input");
    iPts.className = "qf-pts";
    iPts.value = points === null || points === undefined ? "" : String(points);
    iPts.placeholder = pointsPlaceholder;
    const suffix = document.createElement("span");
    suffix.className = "qf-ptsSuffix";
    suffix.textContent = t("questionForm.pointsSuffix");
    wrap.append(iPts, suffix);
    row.appendChild(wrap);
  }

  const bDel = document.createElement("button");
  bDel.type = "button";
  bDel.className = "btn icon danger qf-del";
  bDel.innerHTML = icon("trash");
  bDel.title = t("questionForm.deleteAnswer");
  bDel.setAttribute("aria-label", bDel.title);
  row.appendChild(bDel);

  return { row, iText, iPts, bDel };
}

/** Kafelek dodawania odpowiedzi z ikoną i licznikiem; przy limicie wyłączony. */
export function buildAddAnswerTile(count) {
  const canAdd = count < LIMITS.AN_MAX;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "qf-row qf-add";
  btn.disabled = !canAdd;
  const plus = document.createElement("span");
  plus.className = "qf-addPlus";
  plus.setAttribute("aria-hidden", "true");
  plus.innerHTML = icon("plus");
  const lbl = document.createElement("span");
  lbl.className = "qf-addLbl";
  lbl.textContent = canAdd ? t("questionForm.addAnswer").replace(/^[+＋]\s*/, "") : t("questionForm.answerLimit");
  const cnt = document.createElement("span");
  cnt.className = "qf-addCnt";
  cnt.textContent = `${count}/${LIMITS.AN_MAX}`;
  btn.append(plus, lbl, cnt);
  return btn;
}

/* ================= Walidacja pytania ================= */

/**
 * Problemy pytania dla danego typu gry (albo "base" -- pytanie w bazie
 * pytań, gdzie liczba odpowiedzi jest dowolna 0–6, a punkty opcjonalne).
 * Zwraca listę { code, params }; tekst: questionMessage(problem).
 *
 *   textEmpty, answerEmpty {ord}, answerChars {ord, chars}, answersMin
 *   {min,count}, answersMax {max}, sumOver {sum,max}
 */
export function questionProblems(q, type) {
  const out = [];
  const answers = Array.isArray(q?.answers) ? q.answers : [];

  if (!normQuestionText(q?.text)) out.push({ code: "textEmpty", params: {} });
  if (type === TYPES.POLL_TEXT) return out;

  answers.forEach((a, i) => {
    if (!normAnswerText(a?.text)) out.push({ code: "answerEmpty", params: { ord: i + 1 } });
    const bad = answerFieldProblem(a?.text);
    if (bad) out.push({ code: "answerChars", params: { ord: i + 1, chars: bad.params.chars } });
  });

  if (answers.length > LIMITS.AN_MAX) {
    out.push({ code: "answersMax", params: { max: LIMITS.AN_MAX } });
  }
  if (type !== "base" && answers.length < LIMITS.AN_MIN) {
    out.push({ code: "answersMin", params: { min: LIMITS.AN_MIN, count: answers.length } });
  }
  if (type === TYPES.PREPARED) {
    const low = answers.findIndex((a) => !(Number(a?.fixed_points) >= RULES.PTS_MIN));
    if (low >= 0) out.push({ code: "answerMinPoints", params: { min: RULES.PTS_MIN, ord: low + 1 } });
  }
  if (type !== TYPES.POLL_POINTS) {
    const sum = sumPoints(answers);
    if (sum > LIMITS.SUM_MAX) out.push({ code: "sumOver", params: { sum, max: LIMITS.SUM_MAX } });
  }
  return out;
}

export function questionMessage(problem) {
  return problem ? t(`questionForm.errors.${problem.code}`, problem.params || {}) : "";
}
