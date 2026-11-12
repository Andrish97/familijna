// share-sections.js
// Jeden podział na sekcje wszędzie, gdzie udostępniamy zasób (baza, ankieta,
// subskrypcje, urządzenia): Subskrybenci (jeszcze bez zaproszenia) · Oczekujące
// (zaproszenie wysłane) · Aktywni (przyjęte; w ankiecie: zagłosowali) ·
// Odrzucone (tylko tam, gdzie taki stan istnieje). Ten sam nagłówek z podpisem
// i ten sam wiersz (.shareRow). Puste sekcje są ukryte.
// Wygląd: base.css (.shareSection, .shareRow). Komentarz: bez końca komentarza.

import { t } from "../../translation/translation.js?v=v2026-11-12T13461";
import { icon, sharingActionIcon } from "./icons.js?v=v2026-11-12T13461";
import { initUiSelect } from "./ui-select.js?v=v2026-11-12T13461";
import { emptyState } from "./empty-state.js?v=v2026-11-12T13461";
import "./scroll-fade.js?v=v2026-11-12T13461"; // wygaszona krawędź przewijanych list


export const SHARE_SECTION_ORDER = ["subscribers", "pending", "active", "declined"];

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wskaźnik dostępności: ikona z małym licznikiem pod spodem. */
export function shareCooldownEl() {
  const element = document.createElement("div");
  element.className = "shareActionTimer";
  element.hidden = true;
  element.innerHTML = icon("hourglass");
  const labelEl = document.createElement("span");
  labelEl.className = "shareCountdown";
  element.append(labelEl);
  return { element, labelEl };
}

/** Zwarte akcje zaznaczania listy odbiorców, wspólne dla modali udostępniania. */
export function shareBulkActionsEl({ onSelectAll, onDeselectAll }) {
  const element = document.createElement("div");
  element.className = "shareBulkActions";
  element.setAttribute("role", "group");
  const makeButton = (key, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn shareBulkAction";
    button.setAttribute("aria-label", t(`common.${key}`));
    button.title = t(`common.${key}`);
    const actionIcon = key === "selectAll" ? "select-all" : "clear-selection";
    button.innerHTML = icon(actionIcon);
    button.addEventListener("click", onClick);
    element.append(button);
    return button;
  };
  const selectAll = makeButton("selectAll", onSelectAll);
  const deselectAll = makeButton("deselectAll", onDeselectAll);
  return {
    element,
    update(inputs) {
      const available = [...inputs].filter((input) => !input.disabled);
      const checked = available.filter((input) => input.checked).length;
      element.hidden = available.length === 0;
      selectAll.disabled = available.length === 0 || checked === available.length;
      deselectAll.hidden = checked === 0;
      deselectAll.disabled = checked === 0;
    },
  };
}

// ===== Narzędzia listy w nagłówku: szukaj · filtr stanu · sortowanie =====
// Każda lista wierszy (.shareRow / .rowsRow) dostaje w nagłówku te same
// przyciski co dolny pasek Gier w wersji ikon: lupa otwiera okno do wpisania
// frazy (aktywna — złota; drugie kliknięcie czyści), filtr pojawia się, gdy
// wiersze mają co najmniej dwa różne stany (data-state), sortowanie: domyślna
// kolejność / nazwa A–Z / Z–A. Pusta lista — bez przycisków. Ustawienia
// przetrwają odświeżenie listy (ten sam klucz), ale nie przeładowanie strony.
// Wygląd: base.css (.listTools).

const listToolState = new Map();
const normText = (s) => String(s || "").toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const ROW_SELECTOR = ":scope > .shareRow, :scope > .rowsRow";
const ROW_NAME = ".shareEmail, .rowsTitle, .resource-send-friend-name";
const rowText = (row) => {
  const parts = [...row.querySelectorAll(`${ROW_NAME}, .shareNote, .rowsNote`)];
  return parts.length ? parts.map((el) => `${el.textContent} ${el.getAttribute("title") || ""}`).join(" ") : row.textContent;
};
const rowName = (row) => normText((row.querySelector(ROW_NAME) || row).textContent);
let rowSeq = 0;

function toolSelect(kind, iconName) {
  const wrap = document.createElement("div");
  wrap.className = `ui-select list-${kind} listTools-select`;
  wrap.innerHTML = `<button class="btn ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ui-select-icon" aria-hidden="true">${icon(iconName)}</span><span class="ui-select-label">—</span></button><div class="ui-select-menu" role="listbox"></div>`;
  return wrap;
}

/**
 * Dokleja narzędzia listy do nagłówka i pilnuje ich przy każdej zmianie wierszy.
 * @param {HTMLElement} heading  nagłówek sekcji (flex; przyciski trafiają na jego koniec,
 *                               przed ewentualnymi akcjami zaznaczania)
 * @param {HTMLElement} list     kontener wierszy .shareRow / .rowsRow
 * @param {string} key           klucz zapamiętanych ustawień (np. "contacts-friend")
 */
export function attachListTools(heading, list, key) {
  if (!heading || !list) return null;
  if (list._listTools) return list._listTools;
  const state = listToolState.get(key) || { q: "", filter: "", sort: "" };
  listToolState.set(key, state);
  // Tłumaczenie nagłówka nadpisuje całą jego treść — przenosimy je do
  // osobnego elementu, żeby przyciski zostały.
  if (heading.hasAttribute("data-i18n")) {
    const text = document.createElement("span");
    text.className = "listToolsTitle";
    text.dataset.i18n = heading.dataset.i18n;
    text.textContent = heading.textContent;
    heading.removeAttribute("data-i18n");
    heading.replaceChildren(text);
  }
  heading.classList.add("listToolsHead");
  const tools = document.createElement("div");
  tools.className = "listTools";
  const sortEl = toolSelect("sort", "sort");
  const filterEl = toolSelect("filter", "filter");
  const searchBtn = document.createElement("button");
  searchBtn.type = "button";
  searchBtn.className = "btn listTools-search";
  tools.append(sortEl, filterEl, searchBtn);
  // przed akcjami zaznaczania i przed strzałką zwijania (ona zawsze na końcu linii)
  const bulk = heading.querySelector(":scope > .shareBulkActions, :scope > [id$='BulkActions'], :scope > .rowsSectionCaret");
  if (bulk) heading.insertBefore(tools, bulk); else heading.append(tools);
  const empty = emptyState("", { hook: "shareEmpty listToolsEmpty" });
  empty.hidden = true;
  // Pole szukania nad listą (wpisywanie na żywo) — na komputerze i telefonie,
  // jak w oknie „Przenieś do” menedżera bazy (decyzja 2026-10-21).
  const inline = document.createElement("div");
  inline.className = "searchBox searchBox--field listToolsInline";
  inline.hidden = true;
  inline.innerHTML = icon("search");
  const inlineInput = document.createElement("input");
  inlineInput.type = "text";
  inlineInput.className = "searchText";
  inlineInput.setAttribute("enterkeyhint", "search");
  inlineInput.autocomplete = "off";
  const inlineClear = document.createElement("button");
  inlineClear.type = "button";
  inlineClear.className = "btn-plain searchClear";
  inlineClear.innerHTML = icon("close");
  inline.append(inlineInput, inlineClear);
  list.before(inline);
  const closeInline = () => { inline.hidden = true; inlineInput.value = ""; state.q = ""; apply(); };
  inlineInput.addEventListener("input", () => { state.q = inlineInput.value; apply(); });
  inlineInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeInline(); searchBtn.focus(); }
  });
  inlineClear.addEventListener("click", (e) => { e.stopPropagation(); closeInline(); });

  const sortOptions = () => [
    { value: "", label: t("common.sort.default") },
    { value: "name", label: t("common.sort.name") },
    { value: "nameDesc", label: t("common.sort.nameDesc") },
  ];
  let filterKeys = "";
  const filterOptions = (states) => [{ value: "", label: t("common.filterAll") }, ...states.map(([value, label]) => ({ value, label }))];
  const sortApi = initUiSelect(sortEl, { options: sortOptions(), value: state.sort, onChange: (v) => { state.sort = String(v || ""); apply(); } });
  const filterApi = initUiSelect(filterEl, { options: filterOptions([]), value: "", onChange: (v) => { state.filter = String(v || ""); apply(); } });

  const label = () => {
    sortEl.querySelector(".ui-select-btn").setAttribute("aria-label", t("common.sort.label"));
    sortEl.querySelector(".ui-select-btn").title = t("common.sort.label");
    filterEl.querySelector(".ui-select-btn").setAttribute("aria-label", t("common.filterState"));
    filterEl.querySelector(".ui-select-btn").title = t("common.filterState");
    const title = state.q ? t("common.clear") : t("common.searchByName");
    searchBtn.title = title;
    searchBtn.setAttribute("aria-label", title);
    empty.textContent = t("common.noResults");
    inlineInput.placeholder = t("common.searchByName");
    inlineInput.setAttribute("aria-label", t("common.searchByName"));
    inlineClear.title = t("common.clear");
    inlineClear.setAttribute("aria-label", inlineClear.title);
  };

  let applying = false;
  const apply = () => {
    if (applying) return;
    applying = true;
    try {
      const rows = [...list.querySelectorAll(ROW_SELECTOR)];
      for (const row of rows) if (row._listOrder == null) row._listOrder = ++rowSeq;
      // filtr: tylko gdy są co najmniej dwa różne stany
      const states = new Map();
      for (const row of rows) {
        const st = row.dataset.state;
        if (st && !states.has(st)) states.set(st, row.dataset.stateLabel || row.querySelector(".tag")?.textContent?.trim() || st);
      }
      const keys = [...states.keys()].join("|");
      if (keys !== filterKeys) { filterKeys = keys; filterApi?.setOptions(filterOptions([...states])); }
      if (state.filter && !states.has(state.filter)) state.filter = "";
      filterApi?.setValue(state.filter, { silent: true });
      filterEl.hidden = states.size < 2;
      // sortowanie (dotyka DOM tylko, gdy kolejność się zmienia)
      const cmp = state.sort === "name" ? (a, b) => rowName(a).localeCompare(rowName(b), "pl")
        : state.sort === "nameDesc" ? (a, b) => rowName(b).localeCompare(rowName(a), "pl")
        : (a, b) => a._listOrder - b._listOrder;
      const sorted = [...rows].sort(cmp);
      if (sorted.some((el, i) => el !== rows[i])) {
        const anchor = rows.at(-1).nextSibling;
        for (const el of sorted) list.insertBefore(el, anchor);
      }
      const q = normText(state.q);
      let visible = 0;
      for (const row of rows) {
        const hit = (!q || normText(rowText(row)).includes(q)) && (!state.filter || row.dataset.state === state.filter);
        row.classList.toggle("is-search-hidden", !hit);
        if (hit) visible += 1;
      }
      tools.hidden = list.hidden || rows.length === 0;
      const showEmpty = rows.length > 0 && visible === 0;
      if (showEmpty && empty.parentElement !== list) list.append(empty);
      empty.hidden = !showEmpty;
      if (state.q && inline.hidden) { inline.hidden = false; inlineInput.value = state.q; }
      if (list.hidden || rows.length === 0) inline.hidden = true;
      searchBtn.innerHTML = icon("search");
      searchBtn.classList.toggle("is-active", !!state.q || !inline.hidden);
      searchBtn.setAttribute("aria-expanded", String(!inline.hidden));
      sortEl.classList.toggle("is-active", !!state.sort);
      filterEl.classList.toggle("is-active", !!state.filter);
      label();
    } finally {
      applying = false;
    }
  };

  searchBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!inline.hidden) { closeInline(); return; }
    inline.hidden = false;
    inlineInput.value = state.q;
    apply();
    inlineInput.focus();
  });
  tools.addEventListener("click", (e) => e.stopPropagation());
  new MutationObserver(apply).observe(list, { childList: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("i18n:lang", () => { sortApi?.setOptions(sortOptions()); filterKeys = ""; apply(); });
  apply();
  list._listTools = { apply };
  return list._listTools;
}

/**
 * Pojedynczy wiersz (kafel) sekcji.
 * @param {object} row
 * @param {string|number} [row.id]
 * @param {string} row.label        nazwa / e-mail
 * @param {string} [row.title]      dymek nazwy
 * @param {{text:string,cls?:string}[]} [row.tags]  oznaczenia (kolor tylko pomocniczo)
 * @param {string} [row.note]       drobna linia pod nazwą
 * @param {HTMLElement[]} [row.extras]  dodatkowe elementy w rogu (np. lista roli)
 * @param {{key:string,icon:string,title:string,disabled?:boolean,gold?:boolean,text?:string,onClick:Function}[]} [row.actions]
 * @param {boolean} [row.selected]
 * @param {boolean} [row.disabled]
 * @param {Function} [row.onClick]  kliknięcie w wiersz (wybór)
 * @param {string} [row.role]       np. "checkbox"
 */
export function shareRowEl(row) {
  const el = document.createElement("div");
  el.className = "shareRow" + (row.compact ? " shareRow--compact" : "");
  if (row.id != null) el.dataset.id = String(row.id);
  if (row.state) { el.dataset.state = String(row.state.key ?? row.state); if (row.state.label) el.dataset.stateLabel = row.state.label; }
  if (row.selected) el.classList.add("is-selected");
  if (row.disabled) el.classList.add("blocked");
  if (row.onClick && !row.disabled) el.classList.add("pick");
  if (row.role) {
    el.setAttribute("role", row.role);
    if (row.role === "checkbox") el.setAttribute("aria-checked", row.selected ? "true" : "false");
  }
  const tags = (row.tags || []).map((x) => `<span class="tag ${esc(x.cls || "tag--muted")}">${esc(x.text)}</span>`).join("");
  el.innerHTML = `
    <div class="shareMain">
      <div class="shareEmail" title="${esc(row.title || row.label)}">${esc(row.label)}</div>
      ${tags ? `<div class="shareTags">${tags}</div>` : ""}
      ${row.note ? `<div class="shareNote">${esc(row.note)}</div>` : ""}
    </div>
    <div class="shareRowActions"></div>`;
  const acts = el.querySelector(".shareRowActions");
  for (const x of row.extras || []) acts.append(x);
  for (const a of row.actions || []) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn xs" + (a.gold ? " gold" : "");
    b.dataset.act = a.key;
    b.title = a.title || "";
    b.setAttribute("aria-label", a.title || a.key);
    if (a.disabled) b.disabled = true;
    const actionIcon = sharingActionIcon(a.key, a.icon);
    b.innerHTML = actionIcon ? icon(actionIcon) : esc(a.text || "");
    b.addEventListener("click", (e) => { e.stopPropagation(); a.onClick?.(e, b); });
    let labelEl = null;
    if (a.countdown) {
      b.classList.add("shareActionCountdown");
      labelEl = document.createElement("span");
      labelEl.className = "shareCountdown";
      labelEl.hidden = true;
      b.append(labelEl);
    }
    acts.append(b);
    a.onMount?.({ rowEl: el, button: b, labelEl });
  }
  if (row.onClick && !row.disabled) {
    el.tabIndex = 0;
    el.addEventListener("click", (e) => row.onClick(e));
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); row.onClick(e); }
    });
  }
  return el;
}

/** Strzałka zwijania sekcji: osobno na końcu linii nagłówka (za narzędziami
 *  listy); klik działa jak przycisk nagłówka, który niesie stan dla czytników. */
function sectionCaret(onClick) {
  const caret = document.createElement("span");
  caret.className = "rowsSectionCaret";
  caret.setAttribute("aria-hidden", "true");
  caret.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return caret;
}

/** Wspólna sekcja także dla pustej listy i formularza dodawania odbiorcy. */
export function shareSectionEl({ key, title, rows = [], emptyText = "", collapsed, onToggle }) {
  const section = document.createElement("section");
  section.className = "shareSection";
  if (key) section.dataset.section = key;
  const heading = document.createElement("h2");
  heading.className = "section-title";
  heading.textContent = title;
  const list = document.createElement("div");
  list.className = "shareList shareList--scroll";
  for (const row of rows) list.append(shareRowEl(row));
  if (!rows.length && emptyText) {
    list.append(emptyState(emptyText, { hook: "shareEmpty" }));
  }
  if (typeof collapsed === "boolean") {
    // Jedna linia: [tytuł + licznik] … narzędzia listy … strzałka (na końcu).
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "rowsSectionHead";
    list.id = `share-list-${key}`;
    toggle.innerHTML = `<span class="rowsSectionTitle">${esc(title)}</span><span class="rowsSectionCount">${rows.length}</span>`;
    const caret = sectionCaret(() => toggle.click());
    const update = () => {
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-controls", list.id);
      caret.innerHTML = icon(collapsed ? "caret-down" : "caret-up");
      list.hidden = collapsed;
    };
    toggle.addEventListener("click", () => { collapsed = !collapsed; update(); onToggle?.(collapsed); });
    heading.replaceChildren(toggle, caret);
    update();
  }
  section.append(heading, list);
  if (key) attachListTools(heading, list, key);
  return section;
}

/**
 * Wyrysowuje sekcje w kontenerze. Kolejność zawsze jak SHARE_SECTION_ORDER;
 * pusta sekcja nie powstaje.
 * @param {HTMLElement} host
 * @param {Record<string,{rows:object[],subtitle?:string,title?:string,header?:HTMLElement}>} groups
 * @param {{grid?:boolean}} [opts]  grid: kafle w kilku kolumnach (strony), inaczej lista (okna)
 */
export function renderShareSections(host, groups, opts = {}) {
  const frag = document.createDocumentFragment();
  for (const key of SHARE_SECTION_ORDER) {
    const g = groups[key];
    if (!g || !g.rows?.length) continue;
    const sec = document.createElement("section");
    sec.className = "shareSection shareSection--" + key;
    sec.dataset.section = key;
    const title = document.createElement("div");
    title.className = "section-title";
    title.textContent = g.title || t(`shareSections.${key}`);
    const sub = document.createElement("div");
    sub.className = "shareSectionSub";
    sub.textContent = g.subtitle || t(`shareSections.${key}Sub`);
    const list = document.createElement("div");
    list.className = "shareList" + (opts.grid ? " shareList--grid" : "");
    for (const r of g.rows) list.append(shareRowEl(r));
    sec.append(title, sub, list);
    frag.append(sec);
  }
  host.replaceChildren(frag);
}

// ===== Wiersze z sekcjami wg strony (E19: Zadania, Znajomi, Subskrybenci) =====
// Sekcje podaje strona w swojej kolejności (nie ma stałej listy jak wyżej).
// Wiersz: inicjał w kółku, tytuł, szara linijka stanu, opcjonalny kanał
// (friend|subscriber|mail), akcje po prawej w wierszu. Komputer: tekst
// akcji, telefon: sama ikona (aria-label zostaje); usuwanie zawsze ikoną.
// Wygląd: base.css (.rowsPage, .rowsSection, .rowsRow).

const ROW_CHANNELS = ["friend", "subscriber", "mail"];

/**
 * Pojedynczy wiersz.
 * @param {object} row
 * @param {string|number} [row.id]
 * @param {string} row.title
 * @param {string} [row.avatar]   tekst, z którego bierzemy inicjał (domyślnie tytuł)
 * @param {string} [row.avatarIcon] ikona pochodzenia zamiast inicjału
 * @param {string} [row.note]     szara linijka stanu
 * @param {string} [row.noteMobile] skrócony opis na telefonie
 * @param {"friend"|"subscriber"|"mail"} [row.channel]
 * @param {Record<string,string>} [row.data]  atrybuty data-* wiersza (np. kind)
 * @param {{key:string,text?:string,icon?:string,title?:string,gold?:boolean,iconOnly?:boolean,disabled?:boolean,onClick:Function}[]} [row.actions]
 */
export function rowEl(row) {
  const el = document.createElement("div");
  el.className = "rowsRow";
  if (row.id != null) el.dataset.id = String(row.id);
  if (row.state) { el.dataset.state = String(row.state.key ?? row.state); if (row.state.label) el.dataset.stateLabel = row.state.label; }
  for (const [k, v] of Object.entries(row.data || {})) el.dataset[k] = String(v);
  const initial = Array.from(String(row.avatar || row.title || "?").trim())[0] || "?";
  const channel = ROW_CHANNELS.includes(row.channel) ? row.channel : "";
  const noteParts = [];
  if (channel) noteParts.push(`<span class="rowsChannel rowsChannel--${channel}">${esc(t(`shareSections.channel.${channel}`))}</span>`);
  if (row.note) noteParts.push(esc(row.note));
  el.innerHTML = `
    <span class="rowsAvatar" aria-hidden="true">${row.avatarIcon ? icon(row.avatarIcon) : esc(initial.toLocaleUpperCase())}</span>
    <div class="rowsMain">
      <div class="rowsTitle" title="${esc(row.title)}">${esc(row.title)}</div>
      ${noteParts.length ? `<div class="rowsNote${row.noteMobile != null ? " rowsNote--desktop" : ""}">${noteParts.join(" · ")}</div>` : ""}
      ${row.noteMobile != null ? `<div class="rowsNote rowsNote--mobile">${esc(row.noteMobile)}</div>` : ""}
    </div>
    <div class="rowsActions"></div>`;
  const acts = el.querySelector(".rowsActions");
  for (const a of row.actions || []) {
    const label = a.title || a.text || a.key;
    const actionIcon = sharingActionIcon(a.key, a.icon);
    const iconOnly = a.iconOnly || actionIcon === "trash" || !a.text;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn xs rowsAct" + (a.gold ? " gold" : "") + (iconOnly ? " rowsAct--icon" : "");
    b.dataset.act = a.key;
    b.title = label;
    b.setAttribute("aria-label", label);
    if (a.disabled) b.disabled = true;
    // ikona przed napisem, jak w pozostałych przyciskach aplikacji
    b.innerHTML = (actionIcon ? `<span class="rowsActIcon">${icon(actionIcon)}</span>` : "")
      + (a.text && !iconOnly ? `<span class="rowsActText">${esc(a.text)}</span>` : "");
    b.addEventListener("click", (e) => { e.stopPropagation(); a.onClick?.(e, b); });
    acts.append(b);
  }
  return el;
}

/**
 * Wyrysowuje sekcje w kolejności podanej przez stronę; pusta sekcja nie powstaje.
 * Sekcja z polem `collapsed` (true/false) jest zwijana; ostatni wybór
 * użytkownika zostaje w hoście przy kolejnych rysowaniach.
 * @param {HTMLElement} host
 * @param {{key:string,title:string,rows:object[],collapsed?:boolean}[]} sections
 * @param {{emptyText?:string}} [opts]  emptyText: tekst, gdy żadna sekcja nie ma wierszy
 */
export function renderRowSections(host, sections, opts = {}) {
  const state = host._rowsCollapsed || (host._rowsCollapsed = {});
  const frag = document.createDocumentFragment();
  for (const s of sections) {
    if (!s.rows?.length) continue;
    const sec = document.createElement("section");
    sec.className = "rowsSection rowsSection--" + s.key;
    sec.dataset.section = s.key;
    const collapsible = typeof s.collapsed === "boolean";
    const collapsed = collapsible && (s.key in state ? state[s.key] : s.collapsed);
    const head = document.createElement(collapsible ? "button" : "div");
    head.className = "rowsSectionHead";
    if (collapsible) {
      head.type = "button";
      head.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    head.innerHTML = `<span class="rowsSectionTitle">${esc(s.title)}</span><span class="rowsSectionCount">${s.rows.length}</span>`;
    const caret = collapsible ? sectionCaret(() => head.click()) : null;
    if (caret) caret.innerHTML = icon(collapsed ? "caret-down" : "caret-up");
    const list = document.createElement("div");
    list.className = "rowsList";
    list.hidden = collapsed;
    for (const r of s.rows) list.append(rowEl(r));
    if (collapsible) {
      head.addEventListener("click", () => {
        const now = !list.hidden;
        list.hidden = now;
        // Rozwinięcie: lista wjeżdża płynnie (tylko po kliknięciu, nie przy odświeżeniu).
        if (!now) {
          list.classList.add("is-expanding");
          list.addEventListener("animationend", () => list.classList.remove("is-expanding"), { once: true });
        }
        state[s.key] = now;
        head.setAttribute("aria-expanded", now ? "false" : "true");
        caret.innerHTML = icon(now ? "caret-down" : "caret-up");
      });
    }
    const headRow = document.createElement("div");
    headRow.className = "rowsSectionHeadRow";
    headRow.append(head);
    if (caret) headRow.append(caret);
    sec.append(headRow, list);
    attachListTools(headRow, list, `rows-${s.key}`);
    frag.append(sec);
  }
  if (!frag.childNodes.length && opts.emptyText) {
    frag.append(emptyState(opts.emptyText, { hook: "rowsEmpty" }));
  }
  host.replaceChildren(frag);
}
