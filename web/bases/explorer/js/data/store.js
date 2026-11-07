// base-explorerjs/data/store.js
// Magazyn danych menedżera: cała baza (foldery, tagi, pytania, tagi pytań)
// i kosz, ładowane jednym reload() — po wejściu na stronę, po każdym
// zapisie i po „Odśwież”. Starsza odpowiedź nigdy nie nadpisuje nowszej.

import { loadBaseContent } from "../repo.js?v=v2026-11-07T23331";
import * as ops from "../ops.js?v=v2026-11-07T23331";
import { deriveStore } from "./derived.js?v=v2026-11-07T23331";
import { pruneTreeOpen, saveTreeOpen, goTo } from "../state.js?v=v2026-11-07T23331";

export async function reload(state) {
  const seq = (state._loadSeq || 0) + 1;
  state._loadSeq = seq;

  const [content, trash] = await Promise.all([
    loadBaseContent(state.baseId),
    // kosz widzą właściciel i edytorzy (qb_trash_list sprawdza uprawnienia)
    state.canEdit ? ops.trashList(state.baseId).catch((e) => { console.warn("trash list failed:", e); return []; }) : [],
  ]);
  if (seq !== state._loadSeq) return false; // w międzyczasie ruszyło nowsze ładowanie

  state.store = { ...content, trash: trash || [] };
  state.d = deriveStore(state.store);
  state.tags = content.tags;

  // folder, w którym jesteśmy, mógł zniknąć (usunięty gdzie indziej)
  if (state.location.kind === "folder" && !state.d.folderById.has(state.location.folderId)) goTo(state, null);
  if (state.location.kind === "trash" && !state.canEdit) goTo(state, null);

  if (pruneTreeOpen(state.treeOpen, content.categories)) saveTreeOpen(state.baseId, state.treeOpen);
  return true;
}
