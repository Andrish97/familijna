// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Wspólny kontrakt transferu gry (E21, familijna-server/docs/reguly-gier-transfer-plan.md §4):
// eksport pliku .famgame, Powiel, Wyślij i tworzenie gry z bazy pytań. Ten
// sam pakiet normalizuje i zapisuje SQL (_game_package_normalize,
// _game_import_package -- migracja 406); tu: budowa pakietu i te same reguły
// dla podglądu. Stan runtime, właściciel, ustawienia, kontakty i pliki są poza
// formatem. Moduł bez importów -- używa go też Worker kopii.
//
// Pakiet v2: { format_version: 2, game: { name, type, state }, questions:
// [{ text, answers: [{ text, fixed_points }] }] }, dokładnie pięć wariantów:
// prepared/draft, poll_points/draft, poll_text/draft, poll_points/closed,
// poll_text/closed. Kopia „market” nie podlega transferowi.

export const GAME_FORMAT_VERSION = 2;
export const SOURCE_TYPES = ['prepared', 'poll_points', 'poll_text'];
export const LIMITS = { name: 80, question: 100, answer: 17, answers: 6 };

export class GameTransferError extends Error {
  constructor(code) { super(code); this.code = code; }
}

const POLLS = new Set(['poll_points', 'poll_text']);

/** Wariant transferu gry z bazy: { type, state } albo GameTransferError (market, nieznany typ). */
export function gameTransferVariant(game) {
  const type = String(game?.type || '');
  if (type === 'market') throw new GameTransferError('market_not_transferable');
  if (!SOURCE_TYPES.includes(type)) throw new GameTransferError('unknown_type');
  const status = String(game?.status || 'draft');
  return { type, state: POLLS.has(type) && status === 'ready' ? 'closed' : 'draft' };
}

/** Ankieta z bieżącymi głosami, które transfer pominie (ostrzeżenie przed eksportem/powieleniem). */
export const gameTransferDropsVotes = (game) =>
  POLLS.has(String(game?.type || '')) && ['poll_open', 'poll_stopped'].includes(String(game?.status || ''));

const byOrd = (list) => (list || [])
  .map((item, index) => ({ item, index }))
  .sort((a, b) => {
    const ao = Number(a.item?.ord);
    const bo = Number(b.item?.ord);
    return Number.isFinite(ao) && Number.isFinite(bo) && ao !== bo ? ao - bo : a.index - b.index;
  })
  .map(({ item }) => item);

/**
 * Pakiet v2 z rekordu gry i jej pytań. Otwarta/zatrzymana ankieta -> szkic
 * tego samego typu bez bieżących głosów; zamknięta -> wariant zamknięty
 * z zatwierdzonymi odpowiedziami i punktami (bez liczby głosów).
 */
export function gameExportSnapshot(game, questions, fallbackName) {
  const { type, state } = gameTransferVariant(game);
  const withAnswers = type !== 'poll_text' || state === 'closed';
  const keepPoints = type === 'prepared' || state === 'closed';
  return {
    format_version: GAME_FORMAT_VERSION,
    game: { name: game?.name ?? fallbackName, type, state },
    questions: byOrd(questions).map((question) => ({
      text: question.text,
      answers: !withAnswers ? [] : byOrd(question.answers).map((answer) => ({
        text: answer.text,
        fixed_points: keepPoints ? Number(answer.fixed_points) || 0 : 0,
      })),
    })),
  };
}

/* ================= Normalizacja (ta sama co SQL _game_package_normalize) ================= */

const clip = (value, max) => Array.from(String(value ?? '').normalize('NFC').trim()).slice(0, max).join('').trim();

/** Punkty: liczba (także liczbowy tekst) 0–100 -> floor; reszta (ujemne, >100, NaN, ∞, inne typy) -> 0. */
export function transferPoints(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return 0;
  const s = String(value).trim();
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.floor(n) : 0;
}

/**
 * Pakiet bez format_version (v1, historyczny): typ rozpoznany zostaje
 * szkicem; nieznany/alias/brak -> jawne odzyskanie preparowanej w szkicu
 * (recovered). Punkty v1: fixed_points, a gdy brak -- points (format TXT).
 */
export function migrateGamePackageV1(pkg) {
  const raw = String(pkg?.game?.type ?? '');
  const recognized = SOURCE_TYPES.includes(raw);
  return {
    format_version: GAME_FORMAT_VERSION,
    recovered: !recognized,
    game: { name: pkg?.game?.name, type: recognized ? raw : 'prepared', state: 'draft' },
    questions: (Array.isArray(pkg?.questions) ? pkg.questions : []).map((q) => ({
      text: q?.text,
      answers: (Array.isArray(q?.answers) ? q.answers : []).map((a) => ({
        text: a?.text,
        fixed_points: a && Object.hasOwn(a, 'fixed_points') ? a.fixed_points : a?.points,
      })),
    })),
  };
}

/**
 * Kanoniczny pakiet do zapisu, bez pytania użytkownika: teksty obcięte do
 * 80/100/17 (pełne znaki), niepoprawne punkty -> 0, przy >6 odpowiedziach
 * sześć najwyżej punktowanych (remis: kolejność wejścia). Puste odpowiedzi
 * pomija; pustego pytania nie zgaduje (błąd). Znaki odpowiedzi spoza
 * czcionki usuwa SQL (fam_answer_clean) -- cleanAnswer pozwala zrobić to samo
 * w podglądzie. Ankieta tekstowa w szkicu nie ma odpowiedzi, punktowa w
 * szkicu -- punktów.
 */
export function normalizeGamePackage(input, { defaultName = '', cleanAnswer = (s) => s } = {}) {
  if (!input || typeof input !== 'object' || !input.game || typeof input.game !== 'object' || !Array.isArray(input.questions)) {
    throw new GameTransferError('invalid_payload');
  }
  const version = input.format_version;
  if (version !== undefined && version !== GAME_FORMAT_VERSION) throw new GameTransferError('unsupported_version');
  const pkg = version === undefined ? migrateGamePackageV1(input) : input;
  const type = String(pkg.game.type || '');
  if (!SOURCE_TYPES.includes(type)) throw new GameTransferError('unknown_type');
  const wantsClosed = POLLS.has(type) && pkg.game.state === 'closed';
  const full = pkg.questions.map((q) => {
    const text = clip(q?.text, LIMITS.question);
    if (!text) throw new GameTransferError('invalid_payload');
    let answers = (Array.isArray(q?.answers) ? q.answers : [])
      .map((a, index) => ({ index, text: clip(cleanAnswer(String(a?.text ?? '')), LIMITS.answer), fixed_points: transferPoints(a?.fixed_points) }))
      .filter((a) => a.text);
    if (answers.length > LIMITS.answers) {
      answers = answers.sort((a, b) => b.fixed_points - a.fixed_points || a.index - b.index).slice(0, LIMITS.answers);
    }
    return { text, answers: answers.map(({ text: t, fixed_points }) => ({ text: t, fixed_points })) };
  });
  // Zamknięty wynik tylko poprawny (jak zamknięcie ankiety): ≥10 pytań,
  // 3–6 odpowiedzi po ≥4 pkt, suma ≤100; inaczej szkic tego samego typu.
  const closedOk = wantsClosed && full.length >= 10 && full.every((q) => q.answers.length >= 3
    && q.answers.every((a) => a.fixed_points >= 4) && q.answers.reduce((s, a) => s + a.fixed_points, 0) <= 100);
  const state = closedOk ? 'closed' : 'draft';
  const withAnswers = type !== 'poll_text' || state === 'closed';
  const keepPoints = type === 'prepared' || state === 'closed';
  return {
    format_version: GAME_FORMAT_VERSION,
    recovered: !!pkg.recovered,
    closed_downgraded: wantsClosed && !closedOk,
    game: { name: clip(pkg.game.name, LIMITS.name) || clip(defaultName, LIMITS.name), type, state },
    questions: full.map((q) => ({
      text: q.text,
      answers: !withAnswers ? [] : q.answers.map((a) => ({ text: a.text, fixed_points: keepPoints ? a.fixed_points : 0 })),
    })),
  };
}
