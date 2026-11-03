// Granice i podpowiedzi dla ustawień rozgrywki (Ustawienia gry → Ustawienia
// gry). Decyzja użytkownika 2026-10-21: błędne wartości widać od razu przy
// polu, a progi wyliczone z pytań są tylko podpowiedzią (nie blokują zapisu).
//
// Zero importów przeglądarkowych — testowalne w gołym Node.

import { RULES } from "../../../shared/js/core/game-rules.js?v=v2026-11-03T23112";

// Twardy limit celu finału: gracz 2 nie może powtórzyć odpowiedzi gracza 1,
// więc w pytaniu razem najwyżej dwie najlepsze odpowiedzi; trzecia ma co
// najmniej PTS_MIN, a suma pytania najwyżej SUM_PREPARED — 5 × (100 − 4)
// = 480 (decyzja użytkownika 2026-10-21, wcześniej 920 = 10 × 92).
export const FINAL_TARGET_MAX = 5 * (RULES.SUM_PREPARED - RULES.PTS_MIN);

export const ADVANCED_LIMITS = {
  finalMinPoints: { min: 0, max: 9999 },
  finalTarget: { min: 1, max: FINAL_TARGET_MAX },
  mainPrizeAmount: { min: 1, max: 99999 },
  finalPrizeMultiplier: { min: 1, max: 10 },
};

/** Liczba całkowita w zakresie albo null. */
export function parseIntInRange(raw, { min, max }) {
  const text = String(raw ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}

/** Mnożniki rund „1, 1, 2, 3” albo null. */
export function parseMultipliers(raw) {
  const tokens = String(raw ?? "").trim().split(/[,\s]+/).filter(Boolean);
  if (!tokens.length || !tokens.every((token) => /^\d+$/.test(token))) return null;
  const parts = tokens.map(Number);
  return parts.every((n) => Number.isSafeInteger(n) && n > 0) ? parts : null;
}

const sortedDesc = (points) => (points || []).map(Number).filter(Number.isFinite).sort((a, b) => b - a);

/**
 * Najwyższy możliwy wynik finału: w każdym z 5 pytań dwie najwyżej
 * punktowane odpowiedzi (gracz 2 nie może powtórzyć odpowiedzi gracza 1).
 * Gdy kandydatów jest więcej niż 5 (losowanie), bierze 5 najlepszych.
 * @param {number[][]} questionsPoints punkty odpowiedzi kolejnych pytań
 * @returns {number|null} null, gdy pytań jest mniej niż 5
 */
export function finalMaxPoints(questionsPoints) {
  const perQuestion = (questionsPoints || []).map((points) => {
    const [a = 0, b = 0] = sortedDesc(points);
    return a + b;
  });
  if (perQuestion.length < 5) return null;
  return perQuestion.sort((a, b) => b - a).slice(0, 5).reduce((sum, v) => sum + v, 0);
}

/**
 * Najwyższy możliwy wynik jednej drużyny w rundach: suma punktów
 * wszystkich odpowiedzi pytania razy mnożnik rundy (ostatni mnożnik
 * powtarza się). Bez ustalonej kolejności (losowanie) najwyżej punktowane
 * pytania trafiają na najwyższe mnożniki — górne oszacowanie.
 * @param {number[][]} questionsPoints punkty odpowiedzi pytań rund
 * @param {number[]} multipliers mnożniki rund
 * @param {{ordered?: boolean}} opts ordered: kolejność pytań jest ustalona
 */
export function roundsMaxPoints(questionsPoints, multipliers, { ordered = false } = {}) {
  const totals = (questionsPoints || []).map((points) => sortedDesc(points).reduce((sum, v) => sum + v, 0));
  if (!totals.length) return 0;
  const mults = Array.isArray(multipliers) && multipliers.length ? multipliers : [1];
  const multAt = (i) => mults[Math.min(i, mults.length - 1)];
  if (ordered) return totals.reduce((sum, total, i) => sum + total * multAt(i), 0);
  const sortedTotals = totals.slice().sort((a, b) => b - a);
  const sortedMults = totals.map((_, i) => multAt(i)).sort((a, b) => b - a);
  return sortedTotals.reduce((sum, total, i) => sum + total * sortedMults[i], 0);
}
