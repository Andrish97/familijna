// base-explorerjs/data/derived.js
// Dane pochodne magazynu (store.js), liczone raz na wersję danych: drzewo
// folderów, pytania w poddrzewach, tagi pytań, proponowana kategoria pytania
// i folderu, liczniki. Czyste funkcje — bez DOM i bez bazy.

import { normalizeText } from "./listing.js?v=v2026-11-07T22354";
import { evaluateReadiness, TYPES } from "../../../../shared/js/core/game-rules.js?v=v2026-11-07T22354";

// Proponowane kategorie (typy gry) w kolejności panelu.
export const SUGGESTED_TYPES = [TYPES.PREPARED, TYPES.POLL_POINTS, TYPES.POLL_TEXT];

// Najlepszy typ gry, do którego pytanie się nadaje (rozłącznie, decyzja
// 2026-10-20): odpowiedzi z poprawnymi punktami → preparowana, same
// odpowiedzi → punktowana, inaczej (samo pytanie) → ankieta tekstowa.
// Reguły z game-rules.js, bez warunku liczby pytań w grze.
export function suggestedType(payload) {
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  const fits = (type) => !evaluateReadiness(type, [{ answers }]).issues.some((i) => i.code !== "minQuestions");
  if (fits(TYPES.PREPARED)) return TYPES.PREPARED;
  if (fits(TYPES.POLL_POINTS)) return TYPES.POLL_POINTS;
  return TYPES.POLL_TEXT;
}

const byOrd = (a, b) => (Number(a.ord) || 0) - (Number(b.ord) || 0) || String(a.id).localeCompare(String(b.id));

export function deriveStore(store) {
  const folders = store?.categories || [];
  const questions = store?.questions || [];

  const folderById = new Map(folders.map((f) => [f.id, f]));
  const questionById = new Map(questions.map((q) => [q.id, q]));

  // Rodzic, którego nie ma w bazie (uszkodzone dane), traktujemy jak korzeń.
  const parentOf = (f) => (f.parent_id && folderById.has(f.parent_id) ? f.parent_id : null);
  const folderOf = (q) => (q.category_id && folderById.has(q.category_id) ? q.category_id : null);

  const childFolders = new Map(); // parentId|null → [folder]
  for (const f of folders) {
    const p = parentOf(f);
    if (!childFolders.has(p)) childFolders.set(p, []);
    childFolders.get(p).push(f);
  }
  for (const arr of childFolders.values()) arr.sort(byOrd);

  const folderQuestions = new Map(); // folderId|null → [question]
  for (const q of questions) {
    const p = folderOf(q);
    if (!folderQuestions.has(p)) folderQuestions.set(p, []);
    folderQuestions.get(p).push(q);
  }
  for (const arr of folderQuestions.values()) arr.sort(byOrd);

  const tagsOfQuestion = new Map(questions.map((q) => [q.id, new Set()]));
  for (const l of store?.questionTags || []) tagsOfQuestion.get(l.question_id)?.add(l.tag_id);

  const typeOfQuestion = new Map(questions.map((q) => [q.id, suggestedType(q.payload)]));

  // Pytania całego poddrzewa (z zabezpieczeniem przed cyklem w danych).
  const subtreeQ = new Map();
  function subtreeQuestionIds(folderId) {
    if (subtreeQ.has(folderId)) return subtreeQ.get(folderId);
    subtreeQ.set(folderId, []); // cykl: drugi raz ten sam folder = pusto
    const out = (folderQuestions.get(folderId) || []).map((q) => q.id);
    for (const c of childFolders.get(folderId) || []) out.push(...subtreeQuestionIds(c.id));
    subtreeQ.set(folderId, out);
    return out;
  }

  function descendantFolderIds(folderId) {
    const out = [];
    const stack = [...(childFolders.get(folderId) || [])];
    const seen = new Set();
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push(f.id);
      stack.push(...(childFolders.get(f.id) || []));
    }
    return out;
  }

  function ancestorIds(folderId) {
    const out = [];
    const seen = new Set();
    let cur = folderById.get(folderId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = parentOf(cur);
      if (!p) break;
      out.push(p);
      cur = folderById.get(p);
    }
    return out;
  }

  // Folder „ma” tag / kategorię, gdy mają je WSZYSTKIE pytania poddrzewa
  // (pusty folder nie ma żadnych).
  const folderTags = new Map();
  const folderType = new Map();
  for (const f of folders) {
    const ids = subtreeQuestionIds(f.id);
    if (!ids.length) { folderTags.set(f.id, new Set()); folderType.set(f.id, null); continue; }
    let common = null;
    for (const qid of ids) {
      const t = tagsOfQuestion.get(qid) || new Set();
      common = common ? new Set([...common].filter((x) => t.has(x))) : new Set(t);
    }
    folderTags.set(f.id, common || new Set());
    const types = new Set(ids.map((qid) => typeOfQuestion.get(qid)));
    folderType.set(f.id, types.size === 1 ? [...types][0] : null);
  }

  // Tekst do wyszukiwania (małe litery, bez polskich znaków) — liczony raz
  // na wersję danych, nie przy każdym wpisanym znaku.
  const searchText = new Map();
  const textOf = (map, id, raw) => {
    if (!map.has(id)) map.set(id, normalizeText(raw));
    return map.get(id);
  };
  const folderSearchText = new Map();

  // Bezpośrednia zawartość folderu (kolumna Info).
  const childCount = (folderId) => (childFolders.get(folderId)?.length || 0) + (folderQuestions.get(folderId)?.length || 0);

  return {
    folderById,
    questionById,
    childFolders: (id) => childFolders.get(id ?? null) || [],
    folderQuestions: (id) => folderQuestions.get(id ?? null) || [],
    tagsOfQuestion: (id) => tagsOfQuestion.get(id) || new Set(),
    typeOfQuestion: (id) => typeOfQuestion.get(id) || TYPES.POLL_TEXT,
    folderTags: (id) => folderTags.get(id) || new Set(),
    folderType: (id) => folderType.get(id) ?? null,
    subtreeQuestionIds,
    descendantFolderIds,
    ancestorIds,
    childCount,
    questionSearchText: (id) => textOf(searchText, id, questionById.get(id)?.payload?.text),
    folderSearchText: (id) => textOf(folderSearchText, id, folderById.get(id)?.name),
  };
}
