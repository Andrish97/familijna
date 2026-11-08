// base-explorerjs/state.js
// Stan menedżera bazy: GDZIE jestem (location) i CO filtruję (query) +
// zaznaczenie, schowek, sortowanie, rozwinięte foldery drzewa. Dane bazy są
// w state.store (data/store.js), pochodne w state.d (data/derived.js), a „co
// pokazać” liczy data/listing.js — tu nie ma żadnej pamięci podręcznej.

import { emptyQuery, isQueryEmpty } from "./data/listing.js?v=v2026-11-08T20163";

// Proponowane kategorie (typy gry, game-rules.js) — etykieta i kolor kropki.
export const TYPE_DEFS = {
  prepared:    { id: "prepared",    nameKey: "baseExplorer.meta.prepared",    color: "rgba(77, 163, 255, .95)" },
  poll_points: { id: "poll_points", nameKey: "baseExplorer.meta.pollPoints", color: "rgba(255, 200, 77, .95)" },
  poll_text:   { id: "poll_text",   nameKey: "baseExplorer.meta.pollText",   color: "rgba(160, 160, 160, .95)" },
};

/* ===== Rozwinięte foldery drzewa — localStorage per baza =====
   Stan widoku, za długi do adresu (otwarty folder jest w ?folder=). */
export const TREE_KEY_PREFIX = "explorer:tree:";

export function treeStorageKey(baseId) {
  return `${TREE_KEY_PREFIX}${baseId}`;
}

/** Zbiór rozwiniętych węzłów z zapisanego JSON-a; "root" zawsze rozwinięty. */
export function parseTreeOpen(raw) {
  const out = new Set(["root"]);
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) for (const id of arr) if (typeof id === "string") out.add(id);
  } catch {}
  return out;
}

export function loadTreeOpen(baseId, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  let raw = null;
  try { raw = storage?.getItem(treeStorageKey(baseId)) ?? null; } catch {}
  return parseTreeOpen(raw);
}

export function saveTreeOpen(baseId, treeOpen, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try { storage?.setItem(treeStorageKey(baseId), JSON.stringify([...treeOpen])); } catch {}
}

/** Zostawia tylko foldery, które istnieją w bazie (usunięte znikają z zapisu). */
export function pruneTreeOpen(treeOpen, categories) {
  const ids = new Set((categories || []).map((c) => c.id));
  for (const id of [...treeOpen]) if (id !== "root" && !ids.has(id)) treeOpen.delete(id);
  return treeOpen;
}

/* ===== Sortowanie listy — localStorage (wspólne dla baz) ===== */
const SORT_KEY = "base-explorer:sort:v1";
const SORT_KEYS = new Set(["name", "type", "date", "info"]);

function loadSort() {
  try {
    const s = JSON.parse(localStorage.getItem(SORT_KEY) || "null");
    if (s && SORT_KEYS.has(s.key) && (s.dir === "asc" || s.dir === "desc")) return s;
  } catch {}
  return { key: "name", dir: "asc" };
}

export function setSort(state, key, dir) {
  if (!SORT_KEYS.has(key)) return;
  state.sort = { key, dir: dir === "desc" ? "desc" : "asc" };
  try { localStorage.setItem(SORT_KEY, JSON.stringify(state.sort)); } catch {}
}

export function createState({ baseId, role = "viewer" }) {
  return {
    baseId,
    role,                    // "owner" | "editor" | "viewer"
    canEdit: role !== "viewer",
    user: null,
    baseMeta: null,

    // Dane: store = wiersze bazy (+ kosz), d = pochodne; ustawia data/store.js.
    store: null,
    d: null,
    tags: [],                // = store.tags (okna tagów czytają state.tags)

    // GDZIE: folder główny / folder / kosz
    location: { kind: "root", folderId: null },
    // CO: jedno zapytanie — pole wyszukiwania i lewy panel to te same dane
    query: emptyQuery(),

    // lewy panel: "tree" | "tags" | "types" (jeden widok, ui/left-view.js)
    leftView: "tree",

    // drzewo folderów: które węzły są rozwinięte ("root" zawsze)
    treeOpen: loadTreeOpen(baseId),

    // zaznaczenie: klucze "c:<id>" (folder), "q:<id>" (pytanie),
    // "t:<id>" (wpis kosza); pane = panel, do którego należy (lista / drzewo)
    selection: { keys: new Set(), anchorKey: null, pane: "list" },

    // schowek: same klucze; kopię robi baza przy wklejeniu
    clipboard: { mode: null, keys: new Set() },

    sort: loadSort(),
  };
}

export function setRole(state, role) {
  state.role = role;
  state.canEdit = role === "owner" || role === "editor";
}

/* ===== Miejsce ===== */

export function isTrash(state) {
  return state.location.kind === "trash";
}

export function currentFolderId(state) {
  return state.location.kind === "folder" ? state.location.folderId : null;
}

export function hasQuery(state) {
  return !isQueryEmpty(state.query);
}

// Przejście do miejsca: folder główny (null), folder (id) albo kosz ("trash").
export function goTo(state, where) {
  if (where === "trash") state.location = { kind: "trash", folderId: null };
  else if (where) state.location = { kind: "folder", folderId: where };
  else state.location = { kind: "root", folderId: null };
  selectionClear(state);
  syncLocationUrl(state);
}

function syncLocationUrl(state) {
  if (!state?._syncUrl || typeof location === "undefined") return;
  const url = new URL(location.href);
  if (state.location.kind === "folder") url.searchParams.set("folder", state.location.folderId);
  else url.searchParams.delete("folder");
  if (state.location.kind === "trash") url.searchParams.set("trash", "1");
  else url.searchParams.delete("trash");
  // replaceState: przeglądarkowe „Wstecz” wraca do poprzedniej STRONY, nie
  // przewija folderów (familijna-server/docs/nawigacja-mapa-plan.md, karty i stan strony).
  if (url.href !== location.href) history.replaceState(history.state, "", url);
}

/* ===== Zapytanie ===== */

export function setQuery(state, patch) {
  state.query = { ...state.query, ...patch };
  selectionClear(state);
}

export function clearQuery(state) {
  state.query = emptyQuery();
  selectionClear(state);
}

/* ===== Zaznaczenie ===== */

export function selectionClear(state) {
  state.selection.keys = new Set();
  state.selection.anchorKey = null;
}

export function selectionSetSingle(state, key, pane = state.selection.pane) {
  state.selection.pane = pane;
  state.selection.keys = new Set(key ? [key] : []);
  state.selection.anchorKey = key || null;
}

export function selectionToggle(state, key, pane = state.selection.pane) {
  if (!key) return;
  if (pane !== state.selection.pane) { selectionSetSingle(state, key, pane); return; }
  if (state.selection.keys.has(key)) state.selection.keys.delete(key);
  else state.selection.keys.add(key);
  state.selection.anchorKey = key;
}

// Zakres Shift: od kotwicy do klikniętego, w kolejności wierszy panelu.
export function selectionRange(state, orderedKeys, key, pane = state.selection.pane) {
  const a = pane === state.selection.pane ? state.selection.anchorKey : null;
  const i1 = a ? orderedKeys.indexOf(a) : -1;
  const i2 = orderedKeys.indexOf(key);
  if (i1 === -1 || i2 === -1) { selectionSetSingle(state, key, pane); return; }
  const [from, to] = i1 < i2 ? [i1, i2] : [i2, i1];
  state.selection.pane = pane;
  state.selection.keys = new Set(orderedKeys.slice(from, to + 1));
  // kotwica zostaje (kolejny Shift+klik liczy od tego samego miejsca)
}

// Po przeładowaniu danych: z zaznaczenia i schowka znikają elementy, których
// już nie ma (usunięte gdzie indziej) albo nie są widoczne.
export function pruneSelection(state, visibleKeys) {
  const keep = new Set([...state.selection.keys].filter((k) => visibleKeys.has(k)));
  state.selection.keys = keep;
  if (state.selection.anchorKey && !keep.has(state.selection.anchorKey)) state.selection.anchorKey = null;
}
