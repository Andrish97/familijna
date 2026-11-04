import { escapeHtmlAttribute as esc } from "../../../shared/js/core/html-escape.js?v=v2026-11-04T10143";
// base-explorerjs/render.js
// Rysowanie menedżera bazy z magazynu (state.store / state.d) i jednego
// modelu „co pokazać” (data/listing.js). Bez bazy i bez akcji. Zmiana samego
// zaznaczenia przełącza tylko klasy (renderSelection), bez przebudowy.

import { TYPE_DEFS, isTrash, currentFolderId, hasQuery } from "./state.js?v=v2026-11-04T10143";
import { computeListing } from "./data/listing.js?v=v2026-11-04T10143";
import { SUGGESTED_TYPES } from "./data/derived.js?v=v2026-11-04T10143";
import { t } from "../../../shared/translation/translation.js?v=v2026-11-04T10143";
import { icon } from "../../../shared/js/core/icons.js?v=v2026-11-04T10143";
import { toolbarButtonsHtml, updateToolbarButtons } from "./ui/toolbar.js?v=v2026-11-04T10143";
import { treeToggleHtml, treeIconName, treeRowInner, treeLines } from "./ui/tree-row.js?v=v2026-11-04T10143";
import { emptyStateHtml } from "../../../shared/js/core/empty-state.js?v=v2026-11-04T10143";
import { setWidth, widthAttr } from "../../../shared/js/core/geometry.js?v=v2026-11-04T10143";

/* ================= DOM ================= */
const elToolbar = document.getElementById("toolbar");
const elTree = document.getElementById("tree");
const elTags = document.getElementById("tags");
const elTypes = document.getElementById("matchedCategories");
const elBreadcrumbs = document.getElementById("breadcrumbs");
const elList = document.getElementById("list");

/* ================= Pomocnicze ================= */


function toTime(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = v ? Date.parse(String(v)) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(v) {
  const time = toTime(v);
  if (!time) return t("baseExplorer.common.dash");
  const d = new Date(time);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;
// Ile pełnych dni zostało do automatycznego usunięcia z kosza (0 = dziś).
export function trashDaysLeft(expiresAt, now = Date.now()) {
  const ms = Date.parse(expiresAt) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY_MS) : 0;
}

function daysLeftText(n) {
  if (n <= 0) return t("baseExplorer.trash.today");
  if (n === 1) return t("baseExplorer.trash.dayLeft");
  return t("baseExplorer.trash.daysLeft", { n });
}

const keyOf = (kind, id) => (kind === "cat" ? `c:${id}` : kind === "q" ? `q:${id}` : kind === "trash" ? `t:${id}` : id);

function isSelected(state, pane, key) {
  return state.selection.pane === pane && state.selection.keys.has(key);
}

/* ================= Kropki: tagi i proponowana kategoria ================= */

function tagDotsHtml(state, tagIdSet) {
  if (!tagIdSet?.size) return "";
  const tags = (state.store?.tags || []).filter((tg) => tagIdSet.has(tg.id)); // w kolejności tagów
  const max = 3;
  const dot = (tg) => `<span class="tag-dot"${tg.color ? ` style="--c:${esc(tg.color)}"` : ""} data-tooltip="#${esc(tg.name || t("baseExplorer.defaults.tag"))}"></span>`;
  const rest = tags.slice(max);
  const more = rest.length
    ? `<span class="tag-more" data-tooltip="${esc(rest.map((tg) => `#${tg.name}`).join(" "))}">+${rest.length}</span>`
    : "";
  return `<span class="tag-dots">${tags.slice(0, max).map(dot).join("")}${more}</span>`;
}

function typeDotHtml(type) {
  const def = type ? TYPE_DEFS[type] : null;
  if (!def) return "";
  return `<span class="tag-dots"><span class="meta-dot" style="--c:${esc(def.color)}" data-tooltip="${esc(t(def.nameKey))}"></span></span>`;
}

/* ================= Całość ================= */

export function renderAll(state) {
  if (!state?.d) return;
  renderToolbar(state);
  renderTree(state);
  renderLeft(state);
  renderBreadcrumbs(state);
  renderList(state);
}

// Zmiana samego zaznaczenia: tylko klasy wierszy i przyciski paska.
export function renderSelection(state) {
  for (const [el, pane] of [[elList, "list"], [elTree, "tree"]]) {
    el?.querySelectorAll(".row[data-key]").forEach((row) => {
      row.classList.toggle("is-selected", isSelected(state, pane, row.dataset.key));
    });
  }
  renderToolbar(state);
}

/* ================= Pasek narzędzi ================= */

// Widoki lewego panelu (decyzja użytkownika 2026-10-21): jeden naraz, na
// pełną wysokość; state.leftView, przełączanie w ui/left-view.js.
export const LEFT_VIEWS = [
  { id: "tree", icon: "folder", labelKey: "baseExplorer.leftView.tree" },
  { id: "tags", icon: "tag", labelKey: "baseExplorer.leftView.tags" },
  { id: "types", icon: "categories", labelKey: "baseExplorer.leftView.types" },
];

export function renderToolbar(state) {
  if (!elToolbar) return;

  // szkielet raz — pole wyszukiwania nie traci fokusu przy odświeżeniach
  if (elToolbar.dataset.ready !== "1") {
    elToolbar.innerHTML = `
      <div class="search-row">
        <div class="searchBox" id="searchBox">
          ${icon("search", { className: "searchBoxIco" })}
          <input id="searchText" class="searchText" type="search" autocomplete="off" />
          <button id="searchSubmitBtn" class="btn-plain searchClear" type="button" hidden>${icon("close")}</button>
        </div>
        ${LEFT_VIEWS.filter((v) => v.id !== "tree").map((v) => `<button class="btn icon left-view-btn explorer-wide-only" type="button" data-left-view="${v.id}" aria-controls="explorerLeft">${icon(v.icon)}<span class="badge"></span></button>`).join("")}
      </div>
      <div class="toolbar-btns-row">
        <div class="left-view-tabs explorer-narrow-only">
          ${LEFT_VIEWS.map((v) => `<button${v.id === "tree" ? ' id="btnDrawerToggle"' : ""} class="btn icon left-view-btn" type="button" data-left-view="${v.id}" aria-controls="explorerLeft">${icon(v.icon)}<span class="badge"></span></button>`).join("")}
          <button id="btnSearchSheet" class="btn icon" type="button" aria-controls="searchOverlay">${icon("search")}</button>
        </div>
        ${toolbarButtonsHtml()}
      </div>`;
    elToolbar.dataset.ready = "1";
  }

  const inp = document.getElementById("searchText");
  if (inp) {
    inp.placeholder = t("baseExplorer.search.placeholder");
    const text = String(state.query.text ?? "");
    if (document.activeElement !== inp && inp.value !== text) inp.value = text;
  }
  // „X” w polu: czyści tekst i filtry; widoczny, gdy coś jest włączone
  const active = hasQuery(state) && !isTrash(state);
  const btn = document.getElementById("searchSubmitBtn");
  if (btn) {
    const label = t("common.clear");
    btn.hidden = !active;
    btn.setAttribute("aria-label", label);
    btn.setAttribute("data-tooltip", label);
  }
  // telefon: sam przycisk „Szukaj” (okno z polem); złoty, gdy jest tekst
  const sheetBtn = document.getElementById("btnSearchSheet");
  if (sheetBtn) {
    const label = t("baseExplorer.search.sheetTitle");
    sheetBtn.setAttribute("aria-label", label);
    sheetBtn.setAttribute("data-tooltip", label);
    sheetBtn.classList.toggle("is-active", !!String(state.query.text || "").trim());
  }

  // Widoki lewego panelu (radio): komputer — Tagi / Kategorie obok wyszukiwarki
  // (oba zgaszone = drzewo); telefon — drzewo / tagi / kategorie otwierają
  // panel z tym widokiem. Plakietka: liczba włączonych filtrów danego rodzaju.
  const drawerOpen = document.getElementById("explorerLeft")?.classList.contains("is-open");
  for (const b of elToolbar.querySelectorAll("[data-left-view]")) {
    const v = LEFT_VIEWS.find((x) => x.id === b.dataset.leftView);
    const mobile = !!b.closest(".left-view-tabs");
    const on = state.leftView === v.id && (mobile ? !!drawerOpen : v.id !== "tree");
    const n = v.id === "tags" ? (state.query.tagIds?.length || 0) : v.id === "types" ? (state.query.types?.length || 0) : 0;
    const label = t(v.labelKey);
    b.setAttribute("aria-label", label);
    b.setAttribute("data-tooltip", label);
    b.setAttribute("aria-pressed", String(on));
    b.classList.toggle("is-active", on);
    b.classList.toggle("has-filter", n > 0);
    const badge = b.querySelector(".badge");
    if (badge) badge.textContent = n ? String(n) : "";
  }

  updateToolbarButtons(elToolbar, state);
}

/* ================= Drzewo (z Koszem jako zwykłym folderem) ================= */

export function renderTree(state) {
  if (!elTree) return;
  const d = state.d;
  const open = state.treeOpen;
  const here = currentFolderId(state);

  // wspólny wygląd z oknem „Przenieś do” (ui/tree-row.js); aktywny folder złoty
  function row({ kind, id, depth, label, canToggle, isOpen, active, dots = "", count = null, lines = [] }) {
    const key = kind === "cat" ? `c:${id}` : id; // "root" / "trash"
    const draggable = kind === "cat" && state.canEdit ? ` draggable="true"` : "";
    const inner = treeRowInner({
      lines,
      toggle: treeToggleHtml(id, { canToggle, isOpen }),
      iconName: treeIconName(kind, isOpen),
      label,
      extra: dots ? `<span class="tree-dots">${dots}</span>` : "",
      count,
    });
    return `
      <div class="row tree-row${kind === "root" ? " is-root" : ""}${isSelected(state, "tree", key) ? " is-selected" : ""}${active ? " is-current" : ""}"${draggable}
           data-kind="${kind}" data-id="${esc(id)}" data-key="${esc(key)}" style="--depth:${depth}"${canToggle ? ` aria-expanded="${isOpen}"` : ""}>${inner}</div>`;
  }

  // cont: czy przodkowie mają dalsze rodzeństwo (linie │ na ich poziomach)
  function subtree(parentId, depth, seen, cont) {
    let out = "";
    const kids = d.childFolders(parentId).filter((f) => !seen.has(f.id)); // uszkodzone dane: cykl
    kids.forEach((f, i) => {
      seen.add(f.id);
      const isLast = i === kids.length - 1;
      const canToggle = d.childFolders(f.id).length > 0;
      const isOpen = canToggle && open.has(f.id);
      out += row({
        kind: "cat", id: f.id, depth,
        label: f.name || t("baseExplorer.defaults.folder"),
        canToggle, isOpen,
        active: here === f.id && !isTrash(state),
        dots: tagDotsHtml(state, d.folderTags(f.id)) + typeDotHtml(d.folderType(f.id)),
        count: d.subtreeQuestionIds(f.id).length,
        lines: treeLines(cont, isLast),
      });
      if (isOpen) out += subtree(f.id, depth + 1, seen, [...cont, !isLast]);
    });
    return out;
  }

  const rootHasChildren = d.childFolders(null).length > 0;
  const rootOpen = !rootHasChildren || open.has("root");
  const rootRow = row({
    kind: "root", id: "root", depth: 0,
    label: t("baseExplorer.tree.root"),
    canToggle: rootHasChildren, isOpen: rootOpen,
    active: state.location.kind === "root",
    count: d.questionById.size,
  });
  const folders = rootOpen ? subtree(null, 1, new Set(), []) : "";
  // Kosz: zwykły wiersz folderu pod wszystkimi folderami, bez licznika
  // (decyzja 2026-10-20); widzą go właściciel i edytorzy.
  const trashRow = state.canEdit
    ? row({
      kind: "trash", id: "trash", depth: 0,
      label: t("baseExplorer.trash.title"),
      canToggle: false, isOpen: false,
      active: isTrash(state),
    })
    : "";

  elTree.innerHTML = `
    <div class="left-panel-heading">${esc(t("baseExplorer.tree.folders"))}</div>
    <div class="treeList">
      ${rootRow}
      ${rootHasChildren ? folders : emptyStateHtml(t("baseExplorer.tree.empty"), { variant: "inline" })}
      ${trashRow}
    </div>`;
}

/* ================= Lewy panel: proponowane kategorie i tagi ================= */

export function renderLeft(state) {
  if (!elTags || !elTypes) return;
  const left = document.getElementById("explorerLeft");
  if (left) left.dataset.view = state.leftView || "tree";
  const q = state.query;

  const typeRows = SUGGESTED_TYPES.map((id) => {
    const def = TYPE_DEFS[id];
    const sel = q.types.includes(id);
    return `
      <div class="row${sel ? " is-selected" : ""}" data-kind="meta" data-id="${esc(id)}" data-key="meta:${esc(id)}">
        <span class="meta-dot" style="--c:${esc(def.color)}"></span>
        <div class="title-text">${esc(t(def.nameKey))}</div>
      </div>`;
  }).join("");
  elTypes.innerHTML = `
    <div class="tagList">
      <div class="left-panel-heading">${esc(t("baseExplorer.tags.metaHeader"))}</div>
      ${typeRows}
    </div>`;

  const tags = state.store?.tags || [];
  const tagRows = tags.map((tg) => {
    const sel = q.tagIds.includes(tg.id);
    return `
      <div class="row${sel ? " is-selected" : ""}" data-kind="tag" data-id="${esc(tg.id)}" data-key="tag:${esc(tg.id)}">
        <span class="tag-dot"${tg.color ? ` style="--c:${esc(tg.color)}"` : ""}></span>
        <div class="title-text">#${esc(tg.name || t("baseExplorer.defaults.tag"))}</div>
      </div>`;
  }).join("");
  const addBtn = state.canEdit
    ? `<button id="btnAddTag" class="btn" type="button">${icon("plus")} ${esc(t("baseExplorer.tags.addTag"))}</button>`
    : "";
  elTags.innerHTML = `
    <div class="tagList">
      <div class="left-panel-heading">${esc(t("baseExplorer.tags.header"))}</div>
      ${addBtn}
      ${tags.length ? tagRows : emptyStateHtml(t("baseExplorer.tags.empty"), { variant: "inline" })}
    </div>`;
}

/* ================= Ścieżka ================= */

export function renderBreadcrumbs(state) {
  if (!elBreadcrumbs) return;
  const d = state.d;
  const parts = [{ kind: "root", id: "", name: t("baseExplorer.tree.root") }];
  if (isTrash(state)) {
    parts.push({ kind: "trash", id: "trash", name: t("baseExplorer.trash.title") });
  } else if (state.location.kind === "folder") {
    const chain = [state.location.folderId, ...d.ancestorIds(state.location.folderId)].reverse();
    for (const id of chain) parts.push({ kind: "crumb", id, name: d.folderById.get(id)?.name || t("baseExplorer.defaults.folder") });
  }
  const crumbs = parts.map((p, i) => {
    const sep = i ? `<span class="crumb-sep">/</span>` : "";
    return `${sep}<span class="crumb" data-kind="${p.kind}"${p.id ? ` data-id="${esc(p.id)}"` : ""}>${esc(p.name)}</span>`;
  }).join("");
  const results = hasQuery(state) && !isTrash(state)
    ? `<span class="crumb-results">${esc(t("baseExplorer.search.results"))}</span>`
    : "";
  elBreadcrumbs.innerHTML = crumbs + results;
}

/* ================= Lista: kolumny i sortowanie ================= */

// Jedna definicja kolumn: nagłówek, szerokość (px, telefon osobno), minimum,
// domyślny kierunek sortowania. Nazwa nie ma szerokości — wypełnia resztę.
export const LIST_COLUMNS = [
  { key: "num",  cls: "h-num",  labelKey: "baseExplorer.list.colNumber", width: 44, narrow: 40 },
  { key: "name", cls: "h-main", labelKey: "baseExplorer.list.colName", min: 160, narrowMin: 150, sort: "asc" },
  { key: "type", cls: "h-type", labelKey: "baseExplorer.list.colType", width: 160, narrow: 110, min: 80, sort: "asc" },
  { key: "date", cls: "h-date", labelKey: "baseExplorer.list.colDate", width: 180, narrow: 140, min: 110, sort: "desc" },
  { key: "info", cls: "h-meta", labelKey: "baseExplorer.list.colInfo", width: 120, narrow: 100, min: 80, sort: "desc" },
];

export const isNarrow = () => typeof window !== "undefined" && window.matchMedia?.("(max-width: 980px)").matches;
const colsKey = () => (isNarrow() ? "base-explorer:cols:narrow:v4" : "base-explorer:cols:v4");

function loadCols() {
  try {
    const o = JSON.parse(localStorage.getItem(colsKey()) || "{}");
    return o && typeof o === "object" ? o : {};
  } catch { return {}; }
}

function saveCols(cols) {
  try { localStorage.setItem(colsKey(), JSON.stringify(cols || {})); } catch {}
}

function colWidth(col, saved) {
  const def = isNarrow() ? (col.narrow ?? col.width) : col.width;
  if (!col.min) return def;
  const w = parseInt(saved[col.key], 10);
  return Math.max(col.min, Number.isFinite(w) ? w : def);
}

const TYPE_RANK = { prepared: 0, poll_points: 1, poll_text: 2 };

// Wiersze listy z modelu (data/listing.js).
function listItems(state, listing) {
  const d = state.d;
  if (listing.mode === "trash") {
    return listing.entries.map((e) => ({
      kind: "trash", id: e.id, isFolder: e.kind === "folder",
      name: e.label || t("baseExplorer.common.dash"),
      typeRank: e.kind === "folder" ? 0 : 1,
      date: toTime(e.deleted_at),
      info: trashDaysLeft(e.expires_at),
      raw: e,
    }));
  }
  const folders = listing.folders.map((f) => ({
    kind: "cat", id: f.id, isFolder: true,
    name: f.name || t("baseExplorer.defaults.folder"),
    type: d.folderType(f.id),
    typeRank: TYPE_RANK[d.folderType(f.id)] ?? 3,
    date: toTime(f.updated_at || f.created_at),
    info: listing.mode === "results" ? (listing.matchCount.get(f.id) || 0) : d.childCount(f.id),
    ord: Number(f.ord) || 0,
    raw: f,
  }));
  const questions = listing.questions.map((q) => ({
    kind: "q", id: q.id, isFolder: false,
    name: String(q.payload?.text || t("baseExplorer.defaults.question")),
    type: d.typeOfQuestion(q.id),
    typeRank: TYPE_RANK[d.typeOfQuestion(q.id)] ?? 3,
    date: toTime(q.updated_at || q.created_at),
    info: Array.isArray(q.payload?.answers) ? q.payload.answers.length : 0,
    ord: Number(q.ord) || 0,
    raw: q,
  }));
  return folders.concat(questions);
}

// Foldery zawsze przed pytaniami (decyzja 2026-10-20); w grupie wg kolumny,
// remis: nazwa rosnąco → kolejność → id.
function sortItems(items, sort) {
  const mul = sort.dir === "desc" ? -1 : 1;
  const byName = (a, b) => a.name.localeCompare(b.name, "pl", { sensitivity: "base", numeric: true });
  const field = { name: null, type: "typeRank", date: "date", info: "info" }[sort.key];
  return items.slice().sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    const r = field ? (a[field] - b[field]) * mul : byName(a, b) * mul;
    return r || byName(a, b) || (a.ord || 0) - (b.ord || 0) || String(a.id).localeCompare(String(b.id));
  });
}

function emptyText(state, listing) {
  if (listing.mode === "trash") return t("baseExplorer.trash.empty");
  if (listing.mode === "results") return t("baseExplorer.list.noResults");
  return t("baseExplorer.list.empty");
}

// Kolumny listy. W koszu bez Typu (ikona mówi, czy to folder, czy pytanie),
// a „Usunie się” zaraz za nazwą — na telefonie widać ją bez przewijania.
const TRASH_ORDER = ["num", "name", "info", "date"];
function columnsFor(listing) {
  if (listing.mode !== "trash") return LIST_COLUMNS;
  return TRASH_ORDER.map((key) => LIST_COLUMNS.find((c) => c.key === key));
}

export function currentListing(state) {
  return computeListing(state.store, state.d, { location: state.location, query: isTrash(state) ? {} : state.query });
}

// Przy zmianie miejsca lista wraca na górę (przewinięcie zostaje tylko
// w obrębie tego samego folderu / zapytania).
let shownPlace = "";

export function renderList(state) {
  if (!elList) return;
  const place = `${state.location.kind}:${state.location.folderId || ""}`;
  if (place !== shownPlace) {
    shownPlace = place;
    elList.scrollTop = 0;
  }
  const listing = currentListing(state);
  const items = sortItems(listItems(state, listing), state.sort);
  state.visibleListKeys = items.map((it) => keyOf(it.kind, it.id));

  if (!items.length) {
    elList.innerHTML = emptyStateHtml(emptyText(state, listing), { hook: "list-empty" });
    return;
  }

  const columns = columnsFor(listing);
  const saved = loadCols();
  const narrow = isNarrow();
  const cols = columns.map((c) => (c.key === "name" ? `<col>` : `<col ${widthAttr(colWidth(c, saved))}>`)).join("");
  const minW = columns.reduce((s, c) => s + (c.key === "name" ? (narrow ? c.narrowMin : c.min) : colWidth(c, saved)), 0);

  const head = columns.map((c) => {
    // w koszu kolumna Info mówi, kiedy wpis zniknie na zawsze
    const label = esc(t(c.key === "info" && listing.mode === "trash" ? "baseExplorer.list.colPurge" : c.labelKey));
    if (!c.sort) return `<th class="${c.cls}">${label}</th>`;
    const active = state.sort.key === c.key;
    const caret = active ? icon(state.sort.dir === "asc" ? "caret-up" : "caret-down", { className: "sort-caret" }) : "";
    return `<th class="${c.cls}${active ? " active" : ""}" data-sort-key="${c.key}">${label}${caret}</th>`;
  }).join("");

  const draggable = state.canEdit && !isTrash(state) ? ` draggable="true"` : "";
  const rows = items.map((it, i) => {
    const key = keyOf(it.kind, it.id);
    const sel = isSelected(state, "list", key) ? " is-selected" : "";
    const cut = state.clipboard.mode === "cut" && state.clipboard.keys.has(key) ? " is-cut" : "";
    let title, type, info;
    let dots = "";
    if (it.kind === "trash") {
      title = `${icon(it.isFolder ? "folder" : "file-doc", { className: "list-ico" })} ${esc(it.name)}`;
      type = esc(t(it.isFolder ? "baseExplorer.list.folderType" : "baseExplorer.list.questionType"));
      info = `<span class="tag ${it.info <= 3 ? "tag--warn" : "tag--muted"}">${esc(daysLeftText(it.info))}</span>`;
    } else if (it.kind === "cat") {
      title = `${icon("folder", { className: "list-ico" })} ${esc(it.name)}`;
      dots = tagDotsHtml(state, state.d.folderTags(it.id));
      type = `<span class="type-label">${esc(t("baseExplorer.list.folderType"))}</span>${typeDotHtml(it.type)}`;
      info = esc(t("baseExplorer.list.folderCount", { count: it.info }));
    } else {
      title = esc(it.name);
      dots = tagDotsHtml(state, state.d.tagsOfQuestion(it.id));
      type = `<span class="type-label">${esc(t("baseExplorer.list.questionType"))}</span>${typeDotHtml(it.type)}`;
      info = esc(t("baseExplorer.list.answerCount", { count: it.info }));
    }
    const cell = {
      num: `<td class="col-num">${i + 1}</td>`,
      name: `<td class="col-main"><div class="title-line"><span class="title-text">${title}</span>${dots}</div></td>`,
      type: `<td class="col-type">${type}</td>`,
      date: `<td class="col-date">${esc(fmtDate(it.date))}</td>`,
      info: `<td class="col-meta">${info}</td>`,
    };
    return `
      <tr class="row${sel}${cut}"${it.kind === "trash" ? "" : draggable} data-kind="${it.kind}" data-id="${esc(it.id)}" data-key="${esc(key)}">
        ${columns.map((c) => cell[c.key]).join("")}
      </tr>`;
  }).join("");

  elList.innerHTML = `
    <table class="list-table geo-min-w" style="--geo-min-w:${minW}px">
      <colgroup>${cols}</colgroup>
      <thead><tr class="list-head">${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  initColumnResizers(columns);
}

// Uchwyty zmiany szerokości (bez kolumny Nazwa, która wypełnia resztę);
// dwuklik przywraca domyślną szerokość.
function initColumnResizers(columns) {
  const table = elList?.querySelector(".list-table");
  const head = table?.querySelector(".list-head");
  if (!table || !head) return;
  const colEls = table.querySelectorAll("colgroup col");

  columns.forEach((c, i) => {
    if (!c.min || c.key === "name") return;
    const th = head.children[i];
    const col = colEls[i];
    if (!th || !col) return;
    const handle = document.createElement("div");
    handle.className = "col-resizer";
    handle.setAttribute("data-tooltip", t("baseExplorer.list.resizeColumn"));
    th.appendChild(handle);

    handle.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      handle.setPointerCapture(ev.pointerId);
      const startX = ev.clientX;
      const startW = th.getBoundingClientRect().width;
      const onMove = (e) => {
        setWidth(col, Math.max(c.min, Math.round(startW + e.clientX - startX)));
      };
      const onUp = () => {
        handle.releasePointerCapture(ev.pointerId);
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        saveCols({ ...loadCols(), [c.key]: col.style.getPropertyValue("--geo-w") });
      };
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });
    handle.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const next = loadCols();
      delete next[c.key];
      saveCols(next);
      setWidth(col, colWidth(c, next));
    });
  });
}
