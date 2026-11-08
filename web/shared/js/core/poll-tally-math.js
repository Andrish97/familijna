// Wspólne przeliczenie ankiet punktowych i tekstowych (E21, familijna-server/docs/reguly-gier-transfer-plan.md §3).
// Ten sam algorytm co SQL (migracja 405: _poll_share, _poll_text_tally_select):
//  * N -- liczba pełnych ankiet bieżącego uruchomienia (poll_tally_source.n);
//  * udział = 0 bez głosów, dodatni <1% -> 1%, poza tym floor(100*głosy/N);
//  * odpowiedź kwalifikuje się od 4%, jej punkty = udział (równe głosy = równe
//    punkty, bez rozdzielania reszt), suma wybranych ≤100;
//  * tekstowa: wpisy oczyszczone czcionką Wyświetlacza i zgrupowane (wielkie
//    litery), ranking: głosy malejąco, potem kolejność wejścia; do gry
//    najwyżej 6 kwalifikujących; remis głosów na granicy szóstki rozstrzyga
//    użytkownik (cykliczny wybór), SQL sprawdza wybór.
import { cleanAnswerText } from "./answer-text.js?v=v2026-11-08T15293";

export const ANSWERS_MIN = 3;
export const ANSWERS_MAX = 6;
export const MIN_ANSWER_PERCENT = 4;
export const MIN_FULL_SUBMISSIONS = 10;

const whole = (x) => Math.max(0, Math.floor(Number(x) || 0));

/** Udział odpowiedzi w procentach (= punkty, jeśli się kwalifikuje). */
export function sharePercent(votes, total) {
  const v = whole(votes);
  const n = whole(total);
  if (!v || !n) return 0;
  return Math.max(1, Math.floor((100 * v) / n));
}

/**
 * Ankieta punktowa: [{ votes, percent, qualifies, skipped, points }] w kolejności wejścia.
 * total -- N pełnych ankiet (domyślnie suma głosów).
 */
export function pointsPollAnalysis(counts, total) {
  const votes = (counts || []).map(whole);
  const n = total ?? votes.reduce((s, x) => s + x, 0);
  return votes.map((count) => {
    const percent = sharePercent(count, n);
    const qualifies = percent >= MIN_ANSWER_PERCENT;
    return { votes: count, percent, qualifies, skipped: !qualifies, points: qualifies ? percent : 0 };
  });
}

export const pointsPollPreview = (counts, total) => pointsPollAnalysis(counts, total).map((row) => row.points);

/** Wszystkie k-elementowe podzbiory indeksów 0..n-1 w porządku leksykograficznym. */
function* combinations(n, k, start = 0, acc = []) {
  if (acc.length === k) { yield acc.slice(); return; }
  for (let i = start; i <= n - (k - acc.length); i++) {
    acc.push(i);
    yield* combinations(n, k, i + 1, acc);
    acc.pop();
  }
}

/**
 * Ankieta tekstowa jednego pytania.
 * @param {Array<{text: string, count: number}>} answers -- po scaleniach użytkownika
 * @param {{ total?: number, glyphs?: Map, selected?: string[] }} opts
 *   total -- N pełnych ankiet; glyphs -- czcionka (czyszczenie znaków);
 *   selected -- teksty wybrane z remisu na granicy szóstki (szkic podliczania).
 * @returns {{ rows, selectedKeys: string[], tie: null|{keys: string[], slots: number}, valid: boolean }}
 *   rows: [{ key, text, count, idx, percent, qualifies, selected, inTie }] w kolejności rankingu.
 */
export function textTallyAnalysis(answers, { total, glyphs = null, selected = null } = {}) {
  const groups = new Map();
  (answers || []).forEach((a, idx) => {
    const text = cleanAnswerText(a?.text, glyphs);
    const count = typeof a?.count === "number" && Number.isFinite(a.count) ? whole(a.count) : 0;
    if (!text || count <= 0) return;
    const key = text.toUpperCase();
    const group = groups.get(key);
    if (group) group.count += count;
    else groups.set(key, { key, idx, text, count });
  });

  const n = total ?? [...groups.values()].reduce((s, g) => s + g.count, 0);
  const rows = [...groups.values()]
    .sort((a, b) => b.count - a.count || a.idx - b.idx)
    .map((g) => {
      const percent = sharePercent(g.count, n);
      return { ...g, percent, qualifies: percent >= MIN_ANSWER_PERCENT, selected: false, inTie: false };
    });

  const q = rows.filter((r) => r.qualifies);
  let keys;
  let tie = null;
  if (q.length <= ANSWERS_MAX) {
    keys = q.map((r) => r.key);
  } else {
    const cut = q[ANSWERS_MAX - 1].count;
    const above = q.filter((r) => r.count > cut);
    const group = q.filter((r) => r.count === cut);
    const slots = ANSWERS_MAX - above.length;
    keys = above.map((r) => r.key);
    if (group.length > slots) {
      group.forEach((r) => { r.inTie = true; });
      tie = { keys: group.map((r) => r.key), slots };
      const wanted = new Set((selected || []).map((s) => cleanAnswerText(s, glyphs).toUpperCase()));
      const fromTie = group.filter((r) => wanted.has(r.key)).map((r) => r.key);
      const validChoice = fromTie.length === slots
        && [...wanted].every((k) => keys.includes(k) || fromTie.includes(k))
        && keys.every((k) => wanted.has(k));
      keys = keys.concat(validChoice ? fromTie : group.slice(0, slots).map((r) => r.key));
    } else {
      keys = keys.concat(group.map((r) => r.key));
    }
  }
  const chosen = new Set(keys);
  for (const r of rows) r.selected = chosen.has(r.key);
  const selectedKeys = rows.filter((r) => r.selected).map((r) => r.key);
  return { rows, selectedKeys, tie, valid: selectedKeys.length >= ANSWERS_MIN };
}

/**
 * Następny wybór z remisu (przycisk „Zmień wybór w remisie”): kolejny zestaw
 * slots odpowiedzi z grupy remisowej, cyklicznie -- każdy zestaw osiągalny.
 * Zwraca teksty wszystkich wybranych odpowiedzi albo null, gdy remisu nie ma.
 */
export function nextTieSelection(analysis) {
  if (!analysis?.tie) return null;
  const { keys: tieKeys, slots } = analysis.tie;
  const current = tieKeys.map((k, i) => (analysis.selectedKeys.includes(k) ? i : -1)).filter((i) => i >= 0);
  const all = [...combinations(tieKeys.length, slots)];
  const at = all.findIndex((c) => c.join(",") === current.join(","));
  const next = all[(at + 1) % all.length];
  const nextTie = new Set(next.map((i) => tieKeys[i]));
  return analysis.rows
    .filter((r) => (r.selected && !r.inTie) || nextTie.has(r.key))
    .map((r) => r.text);
}

/** Odpowiedzi do zapisu: [{ text, points }] wybranych, w kolejności rankingu. */
export function textTallyPoints(answers, opts) {
  return textTallyAnalysis(answers, opts).rows
    .filter((r) => r.selected)
    .map(({ text, percent }) => ({ text, points: percent }));
}
