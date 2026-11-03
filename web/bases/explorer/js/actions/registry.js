// base-explorerjs/actions/registry.js
// Rejestr akcji menedżera bazy: każda akcja zdefiniowana raz. Pasek narzędzi,
// menu kontekstowe, skróty klawiszowe, przeciąganie i gesty tylko z niego
// czytają — etykieta, ikona, skrót, widoczność, dostępność, wykonanie
// i komunikat błędu są w jednym miejscu.
//
// Pola wpisu:
//   id        nazwa akcji (przestrzenie: folder., question., item., clip., trash., …)
//   label     (ctx) => klucz tłumaczenia (menu; pasek bierze go do dymka)
//   icon, danger, primary
//   toolbar   { act, group } — przycisk paska (act = data-act, grupa = separator)
//   menu      cele menu kontekstowego: "root" | "cat" | "q" | "trash" | "trash-folder" | "tag" | "tags-bg" | "type"
//   menuGroup kolejność grup w menu (separator między grupami)
//   shortcut  { key: KeyboardEvent.code, mod?, shift?, alt? }
//   altShortcut drugi skrót tej samej akcji (bez pokazywania w dymku)
//   visible   (ctx) => bool — „ma sens tu” (nie → przycisk/pozycja znika)
//   enabled   (ctx) => true | klucz powodu — „można teraz” (nie → szara,
//             powód w dymku; ze skrótu ten sam powód jako komunikat)
//   run       (ctx) => Promise
//   errorKey  komunikat, gdy wykonanie się nie uda (bez własnego komunikatu)

import * as cmd from "../commands.js?v=v2026-11-03T23203";
import { setQuery } from "../state.js?v=v2026-11-03T23203";
import { renderAll } from "../render.js?v=v2026-11-03T23203";

const R = "baseExplorer.reasons.";

const needEdit = (ctx) => (ctx.canEdit ? true : `${R}readOnly`);
const needSel = (ctx) => (ctx.sel.count ? true : `${R}selectSomething`);
const needOne = (ctx) => (ctx.sel.one ? true : `${R}selectOne`);
const needTrashSel = (ctx) => (ctx.sel.trashIds.length ? true : `${R}selectSomething`);
// Tworzenie i wklejanie ma sens tylko „gdzieś”: w folderze (nie w wynikach
// filtra ani w koszu); menu na konkretnym folderze wskazuje to miejsce.
const inPlace = (ctx) => !ctx.inTrash && (!ctx.isFilterView || ctx.target?.kind === "cat" || ctx.target?.id === "root");
// Działania na elementach bazy (nie na wpisach kosza).
const onItems = (ctx) => ctx.canEdit && !ctx.inTrash;
// Tag z menu kontekstowego panelu (PPM na tagu), inaczej tagi z filtra.
const tagTargets = (ctx) => (ctx.target?.kind === "tag" && ctx.target.id ? [ctx.target.id] : ctx.tagSel);

export const ACTIONS = [
  // ===== Historia =====
  {
    id: "history.undo",
    label: () => "baseExplorer.menu.undo",
    icon: "undo",
    toolbar: { act: "undo", group: "history" },
    menu: ["root"], menuGroup: "history",
    shortcut: { key: "KeyZ", mod: true },
    visible: (ctx) => ctx.canEdit,
    enabled: (ctx) => (ctx.canUndo ? true : `${R}nothingToUndo`),
    run: (ctx) => cmd.undo(ctx.state),
    errorKey: "baseExplorer.errors.historyFailed",
  },
  {
    id: "history.redo",
    label: () => "baseExplorer.menu.redo",
    icon: "redo",
    toolbar: { act: "redo", group: "history" },
    menu: ["root"], menuGroup: "history",
    shortcut: { key: "KeyY", mod: true },
    altShortcut: { key: "KeyZ", mod: true, shift: true },
    visible: (ctx) => ctx.canEdit,
    enabled: (ctx) => (ctx.canRedo ? true : `${R}nothingToRedo`),
    run: (ctx) => cmd.redo(ctx.state),
    errorKey: "baseExplorer.errors.historyFailed",
  },

  // ===== Tworzenie =====
  {
    id: "folder.create",
    label: (ctx) => (ctx.target?.kind === "cat" ? "baseExplorer.menu.newFolderIn" : "baseExplorer.menu.newFolder"),
    icon: "folder-plus",
    toolbar: { act: "newFolder", group: "create" },
    menu: ["root", "cat"], menuGroup: "create",
    shortcut: { key: "KeyN", mod: true, shift: true },
    visible: (ctx) => ctx.canEdit && inPlace(ctx),
    enabled: needEdit,
    run: (ctx) => cmd.createFolder(ctx.state, ctx.here),
    errorKey: "baseExplorer.errors.createFolderFailed",
  },
  {
    id: "question.create",
    label: (ctx) => (ctx.target?.kind === "cat" ? "baseExplorer.menu.newQuestionIn" : "baseExplorer.menu.newQuestion"),
    icon: "file-plus",
    toolbar: { act: "newQuestion", group: "create" },
    menu: ["root", "cat"], menuGroup: "create",
    shortcut: { key: "KeyN", mod: true },
    visible: (ctx) => ctx.canEdit && inPlace(ctx),
    enabled: needEdit,
    run: (ctx) => cmd.createQuestion(ctx.state, ctx.here),
    errorKey: "baseExplorer.errors.createQuestionFailed",
  },

  // ===== Nawigacja =====
  {
    id: "folder.open",
    label: () => "baseExplorer.menu.openFolder",
    icon: "folder",
    menu: ["cat"], menuGroup: "open",
    shortcut: { key: "Enter" },
    visible: (ctx) => !ctx.inTrash,
    enabled: (ctx) => (ctx.sel.one && ctx.sel.folderIds.length === 1 ? true : `${R}selectFolder`),
    run: (ctx) => cmd.openFolderFromList(ctx.state, ctx.sel.folderIds[0]),
    errorKey: "baseExplorer.errors.operationFailed",
  },

  // ===== Kosz =====
  {
    id: "trash.open",
    label: () => "baseExplorer.trash.openTrash",
    icon: "trash",
    menu: ["trash-folder"], menuGroup: "open",
    visible: (ctx) => ctx.canEdit && !ctx.inTrash,
    enabled: () => true,
    run: (ctx) => cmd.openTrash(ctx.state),
    errorKey: "baseExplorer.errors.operationFailed",
  },
  {
    id: "trash.restore",
    label: () => "baseExplorer.trash.restore",
    icon: "restore",
    toolbar: { act: "restore", group: "edit" },
    menu: ["trash"], menuGroup: "edit",
    visible: (ctx) => ctx.canEdit && ctx.inTrash,
    enabled: needTrashSel,
    run: (ctx) => cmd.restoreFromTrash(ctx.state),
    errorKey: "baseExplorer.trash.actionFailed",
  },
  {
    id: "trash.empty",
    label: () => "baseExplorer.trash.emptyAll",
    icon: "trash-forever",
    danger: true,
    toolbar: { act: "emptyTrash", group: "edit" },
    menu: ["root", "trash-folder"], menuGroup: "danger",
    visible: (ctx) => ctx.canEdit && (ctx.inTrash || ctx.target?.kind === "trash-folder"),
    enabled: (ctx) => (ctx.trashEmpty ? `${R}trashEmpty` : true),
    run: (ctx) => cmd.purgeTrash(ctx.state, null),
    errorKey: "baseExplorer.trash.actionFailed",
  },

  // ===== Edycja =====
  {
    id: "question.edit",
    label: () => "baseExplorer.menu.editQuestion",
    icon: "edit-paper",
    toolbar: { act: "editQuestion", group: "edit" },
    menu: ["q"], menuGroup: "edit",
    shortcut: { key: "KeyE", mod: true },
    visible: onItems,
    enabled: (ctx) => (ctx.sel.oneQuestionId ? true : `${R}selectQuestion`),
    run: (ctx) => cmd.editQuestion(ctx.state, ctx.sel.oneQuestionId),
    errorKey: "baseExplorer.errors.questionOpenSaveFailed",
  },
  {
    id: "item.tags",
    label: () => "baseExplorer.menu.tags",
    icon: "tag",
    toolbar: { act: "editTags", group: "edit" },
    menu: ["cat", "q"], menuGroup: "tags",
    shortcut: { key: "KeyT", mod: true },
    visible: onItems,
    enabled: needSel,
    run: (ctx) => cmd.openTagsWindow(ctx.state, { mode: "assign" }),
    errorKey: "baseExplorer.tags.errors.saveAssignFailed",
  },
  {
    id: "item.rename",
    label: (ctx) => (ctx.sel.oneQuestionId ? "baseExplorer.menu.renameQuestion" : "baseExplorer.menu.rename"),
    icon: "pencil",
    toolbar: { act: "rename", group: "edit" },
    menu: ["cat", "q"], menuGroup: "edit",
    shortcut: { key: "F2" },
    visible: onItems,
    enabled: needOne,
    run: (ctx) => cmd.renameSelected(ctx.state),
    errorKey: "baseExplorer.errors.renameFailed",
  },
  {
    id: "item.untag",
    label: () => "baseExplorer.menu.untag",
    icon: "tag",
    danger: true,
    toolbar: { act: "untag", group: "edit" },
    menu: ["cat", "q"], menuGroup: "danger",
    visible: (ctx) => onItems(ctx) && ctx.hasTagFilter,
    enabled: needSel,
    run: (ctx) => cmd.untagSelected(ctx.state),
    errorKey: "baseExplorer.errors.removeTagsFailed",
  },
  {
    // w koszu ten sam przycisk usuwa trwale (decyzja 2026-10-20)
    id: "item.delete",
    label: (ctx) => (ctx.inTrash ? "baseExplorer.trash.purge" : "baseExplorer.menu.delete"),
    icon: "trash",
    danger: true,
    toolbar: { act: "delete", group: "edit" },
    menu: ["cat", "q", "trash"], menuGroup: "danger",
    shortcut: { key: "Delete" },
    visible: (ctx) => ctx.canEdit,
    enabled: (ctx) => (ctx.inTrash ? needTrashSel(ctx) : needSel(ctx)),
    run: (ctx) => cmd.deleteSelected(ctx.state),
    errorKey: "baseExplorer.errors.deleteFailed",
  },

  // ===== Schowek =====
  {
    id: "clip.copy",
    label: () => "baseExplorer.menu.copy",
    icon: "copy",
    toolbar: { act: "copy", group: "clipboard" },
    menu: ["cat", "q"], menuGroup: "clipboard",
    shortcut: { key: "KeyC", mod: true },
    visible: onItems,
    enabled: needSel,
    run: (ctx) => cmd.copyToClipboard(ctx.state, "copy"),
    errorKey: "baseExplorer.errors.operationFailed",
  },
  {
    id: "clip.cut",
    label: () => "baseExplorer.menu.cut",
    icon: "cut",
    toolbar: { act: "cut", group: "clipboard" },
    menu: ["cat", "q"], menuGroup: "clipboard",
    shortcut: { key: "KeyX", mod: true },
    visible: onItems,
    enabled: needSel,
    run: (ctx) => cmd.copyToClipboard(ctx.state, "cut"),
    errorKey: "baseExplorer.errors.operationFailed",
  },
  {
    id: "clip.paste",
    label: () => "baseExplorer.menu.paste",
    icon: "paste",
    toolbar: { act: "paste", group: "clipboard" },
    menu: ["root", "cat"], menuGroup: "clipboard",
    shortcut: { key: "KeyV", mod: true },
    visible: (ctx) => ctx.canEdit && inPlace(ctx),
    enabled: (ctx) => (ctx.hasClipboard ? true : `${R}clipboardEmpty`),
    // menu na folderze: wklej do tego folderu; inaczej do bieżącego
    run: (ctx) => cmd.paste(ctx.state, ctx.here),
    errorKey: "baseExplorer.errors.pasteFailed",
  },
  {
    id: "item.duplicate",
    label: () => "baseExplorer.menu.duplicate",
    icon: "duplicate",
    toolbar: { act: "duplicate", group: "clipboard" },
    menu: ["cat", "q"], menuGroup: "clipboard",
    shortcut: { key: "KeyD", mod: true },
    // kopia powstaje w bieżącym folderze, więc w wynikach filtra jej nie ma
    visible: (ctx) => onItems(ctx) && !ctx.isFilterView,
    enabled: needSel,
    run: (ctx) => cmd.duplicateSelected(ctx.state),
    errorKey: "baseExplorer.errors.duplicateFailed",
  },

  // ===== Przenieś do / Kopiuj do (okno z drzewem) =====
  {
    id: "item.moveTo",
    label: () => "baseExplorer.menu.moveTo",
    icon: "folder",
    menu: ["cat", "q"], menuGroup: "clipboard",
    visible: onItems,
    enabled: needSel,
    run: (ctx) => cmd.moveOrCopyTo(ctx.state, "move"),
    errorKey: "baseExplorer.errors.moveFailed",
  },
  {
    id: "item.copyTo",
    label: () => "baseExplorer.menu.copyTo",
    icon: "copy",
    menu: ["cat", "q"], menuGroup: "clipboard",
    visible: onItems,
    enabled: needSel,
    run: (ctx) => cmd.moveOrCopyTo(ctx.state, "copy"),
    errorKey: "baseExplorer.errors.operationFailed",
  },

  // ===== Gra =====
  {
    id: "game.create",
    label: () => "baseExplorer.menu.createGame",
    icon: "gamepad",
    primary: true,
    toolbar: { act: "createGame", group: "game" },
    menu: ["cat", "q"], menuGroup: "game",
    shortcut: { key: "KeyG", mod: true },
    // także czytelnik: gra jest kopią pytań w jego własnych grach
    visible: (ctx) => !ctx.inTrash,
    enabled: needSel,
    run: (ctx) => cmd.createGame(ctx.state),
    errorKey: "baseExplorer.errors.createGameFailed",
  },

  // ===== Widok =====
  {
    id: "view.refresh",
    label: () => "baseExplorer.toolbar.refreshView",
    icon: "refresh",
    toolbar: { act: "refreshView", group: "view" },
    shortcut: { key: "KeyR", mod: true, alt: true },
    visible: () => true,
    enabled: () => true,
    run: (ctx) => cmd.refresh(ctx.state),
    errorKey: "baseExplorer.errors.operationFailed",
  },

  // ===== Tagi i proponowane kategorie (lewy panel) =====
  {
    id: "tag.show",
    label: () => "baseExplorer.menu.show",
    icon: "eye",
    menu: ["tag"], menuGroup: "open",
    visible: () => true,
    enabled: (ctx) => (tagTargets(ctx).length ? true : `${R}selectTag`),
    run: (ctx) => { setQuery(ctx.state, { tagIds: tagTargets(ctx) }); renderAll(ctx.state); },
    errorKey: "baseExplorer.errors.operationFailed",
  },
  {
    id: "type.show",
    label: () => "baseExplorer.menu.show",
    icon: "eye",
    menu: ["type"], menuGroup: "open",
    visible: () => true,
    enabled: (ctx) => (ctx.target?.id ? true : `${R}selectType`),
    run: (ctx) => { setQuery(ctx.state, { types: [ctx.target.id] }); renderAll(ctx.state); },
    errorKey: "baseExplorer.errors.operationFailed",
  },
  {
    id: "tag.create",
    label: () => "baseExplorer.menu.addTag",
    icon: "plus",
    menu: ["tag", "tags-bg"], menuGroup: "create",
    visible: (ctx) => ctx.canEdit,
    enabled: () => true,
    run: (ctx) => cmd.openTagsWindow(ctx.state, { mode: "create" }),
    errorKey: "baseExplorer.tags.errors.saveFailed",
  },
  {
    id: "tag.edit",
    label: () => "baseExplorer.menu.editTag",
    icon: "pencil",
    menu: ["tag"], menuGroup: "edit",
    visible: (ctx) => ctx.canEdit,
    enabled: (ctx) => (tagTargets(ctx).length === 1 ? true : `${R}selectOneTag`),
    run: (ctx) => cmd.openTagsWindow(ctx.state, { mode: "edit", tagId: tagTargets(ctx)[0] }),
    errorKey: "baseExplorer.tags.errors.saveFailed",
  },
  {
    id: "tag.delete",
    label: (ctx) => (tagTargets(ctx).length > 1 ? "baseExplorer.menu.deleteTags" : "baseExplorer.menu.deleteTag"),
    icon: "trash",
    danger: true,
    menu: ["tag"], menuGroup: "danger",
    visible: (ctx) => ctx.canEdit,
    enabled: (ctx) => (tagTargets(ctx).length ? true : `${R}selectTag`),
    run: (ctx) => cmd.deleteTags(ctx.state, tagTargets(ctx)),
    errorKey: "baseExplorer.errors.deleteTagsFailed",
  },
];

export const MENU_GROUPS = ["open", "history", "create", "clipboard", "tags", "edit", "game", "danger"];
export const TOOLBAR_GROUPS = ["history", "create", "edit", "clipboard", "game", "view"];

const BY_ID = new Map(ACTIONS.map((a) => [a.id, a]));
export function actionById(id) {
  return BY_ID.get(id) || null;
}

// Stan akcji w kontekście: { visible, enabled (bool), reason (klucz|null) }.
export function actionState(action, ctx) {
  const visible = !!action.visible(ctx);
  const r = visible ? action.enabled(ctx) : false;
  return { visible, enabled: r === true, reason: r === true ? null : (typeof r === "string" ? r : null) };
}
