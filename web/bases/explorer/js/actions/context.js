// base-explorerjs/actions/context.js
// Kontekst akcji: wszystko, czego rejestr (registry.js) potrzebuje, żeby
// ocenić widoczność i dostępność akcji — liczone w jednym miejscu dla paska,
// menu kontekstowego, skrótów, przeciągania i gestów.

import { currentFolderId, hasQuery, isTrash } from "../state.js?v=v2026-11-07T19463";

// Zaznaczenie → elementy.
export function selectionInfo(state) {
  const keys = [...(state?.selection?.keys || [])];
  const folderIds = [];
  const questionIds = [];
  const trashIds = [];
  for (const k of keys) {
    if (typeof k !== "string") continue;
    if (k.startsWith("c:")) folderIds.push(k.slice(2));
    else if (k.startsWith("q:")) questionIds.push(k.slice(2));
    else if (k.startsWith("t:")) trashIds.push(k.slice(2));
  }
  const count = folderIds.length + questionIds.length;
  return {
    keys,
    folderIds,
    questionIds,
    trashIds,
    count,
    one: count === 1,
    oneQuestionId: count === 1 && questionIds.length ? questionIds[0] : null,
  };
}

/**
 * source: "toolbar" | "menu" | "keys" | "drop" | "gesture"
 * target: { kind: "root"|"cat"|"q"|"trash"|"tag"|"tags-bg"|"type", id } —
 * cel menu kontekstowego (PPM / przytrzymanie); dla paska i skrótów brak.
 */
export function buildContext(state, { source = "toolbar", target = null } = {}) {
  // Folder, w którym tworzymy / do którego wklejamy: folder z menu
  // („w środku”), wiersz „Folder główny” w drzewie (id "root") = główny,
  // inaczej bieżący folder.
  const here = target?.kind === "cat" && target.id ? target.id
    : target?.kind === "root" && target.id === "root" ? null
      : currentFolderId(state);
  return {
    state,
    source,
    target,
    canEdit: !!state?.canEdit,
    inTrash: isTrash(state),
    // wyniki filtra: elementy z całego poddrzewa, więc nie ma „tu”
    isFilterView: hasQuery(state) && !isTrash(state),
    hasTagFilter: !!state?.query?.tagIds?.length,
    sel: selectionInfo(state),
    here,
    hasClipboard: !!state?.clipboard?.mode && !!state?.clipboard?.keys?.size,
    tagSel: [...(state?.query?.tagIds || [])],
    typeSel: [...(state?.query?.types || [])],
    trashEmpty: !(state?.store?.trash || []).length,
    canUndo: !!state?.history?.info().canUndo,
    canRedo: !!state?.history?.info().canRedo,
  };
}
