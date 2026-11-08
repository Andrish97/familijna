// E21: wspólne limity treści gry i reguły znaków odpowiedzi.
// Znaki liczymy jak SQL char_length (pełne znaki Unicode, nie jednostki
// UTF-16). O dozwolonych znakach odpowiedzi decyduje czcionka Wyświetlacza
// font_5x7.json (glyphs = loadFont5x7(), jak w ustawieniach gry) przez
// hasDisplayGlyph; SQL stosuje tę samą regułę (public.fam_answer_invalid_chars,
// public.fam_answer_clean).
import { hasDisplayGlyph } from "../display/fonts.js?v=v2026-11-08T18113";

export const GAME_NAME_MAX = 80;
export const QUESTION_MAX = 100;
export const ANSWER_MAX = 17;
// Pole finału na Wyświetlaczu -- skrót dotyczy tylko prezentacji.
export const FINAL_DISPLAY_MAX = 11;

// Odpowiednik JS \s zapisany jawnie, żeby SQL miał identyczną klasę.
const WS_CLASS = "[\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]";
const WS = new RegExp(WS_CLASS, "u");
const WS_RUN = new RegExp(`${WS_CLASS}+`, "gu");

export const charLength = (value) => Array.from(String(value ?? "")).length;

/** Początek napisu o długości najwyżej max pełnych znaków (bez rozcinania par UTF-16). */
export const clipChars = (value, max) => Array.from(String(value ?? "")).slice(0, max).join("");

export const nfc = (value) => String(value ?? "").normalize("NFC");

const isAnswerChar = (glyphs, ch) => WS.test(ch) || hasDisplayGlyph(glyphs, ch);

/** Niedozwolone znaki odpowiedzi (bez powtórzeń, w kolejności wystąpienia). Bez czcionki: []. */
export function answerInvalidChars(value, glyphs) {
  if (!glyphs) return [];
  const out = [];
  for (const ch of Array.from(nfc(value))) {
    if (!isAnswerChar(glyphs, ch) && !out.includes(ch)) out.push(ch);
  }
  return out;
}

/**
 * Oczyszczona odpowiedź (podliczanie ankiety tekstowej, transfer, migracja):
 * NFC, bez znaków spoza czcionki, białe znaki → pojedyncza spacja, bez spacji
 * na brzegach, najwyżej 17 znaków. Może zwrócić "".
 */
export function cleanAnswerText(value, glyphs) {
  const chars = Array.from(nfc(value));
  const kept = glyphs ? chars.filter((ch) => isAnswerChar(glyphs, ch)).join("") : chars.join("");
  return clipChars(kept.replace(WS_RUN, " ").trim(), ANSWER_MAX).trim();
}

/** Wpis z pola odpowiedzi: NFC i limit 17 (znaki sprawdza answerInvalidChars). */
export const limitAnswerInput = (value) => clipChars(nfc(value), ANSWER_MAX);

export const limitQuestionInput = (value) => clipChars(nfc(value), QUESTION_MAX);
