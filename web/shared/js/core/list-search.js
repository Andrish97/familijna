// list-search.js
// Wyszukiwanie po nazwie na stronach list (gry, bazy, logo): pole w lewej
// części dolnego paska (.list-toolbar-left) filtruje kafle w siatkach strony.
// Kafel „+” (.addCard) zostaje zawsze. Filtr działa też na kafle dorysowane
// później (zmiana karty, odświeżenie) — MutationObserver na siatkach.
// Szukanej frazy nie zapamiętujemy (familijna-server/docs/ujednolicenie-wygladu.md, sekcja 1).
// Opcjonalny filtr (opcja filter): lista rozwijana przed polem szukania, ten
// sam wygląd co sortowanie w Subskrypcjach; wartość w adresie (?param=).
// Kafel niesie wartość w atrybucie data-* (filter.attr).

import { t } from "../../translation/translation.js?v=v2026-11-08T21565";
import { promptModal } from "./modal.js?v=v2026-11-08T21565";
import { icon } from "./icons.js?v=v2026-11-08T21565";
import { initUiSelect } from "./ui-select.js?v=v2026-11-08T21565";
import { filterFromSearch, filterToHref, matchesFilter, showEmptyResult } from "./list-filter.js?v=v2026-11-08T21565";
import { scrollFade } from "./scroll-fade.js?v=v2026-11-08T21565";
import { emptyState } from "./empty-state.js?v=v2026-11-08T21565";


const norm = (s) => String(s || "").toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * @param {object} o
 * @param {string} o.grids     selektor siatek (np. "#grid", "#mineGrid, #sharedGrid")
 * @param {string} o.tile      selektor kafla (np. ".card", ".logoTile")
 * @param {string} o.name      selektor nazwy w kaflu (np. ".name", ".logoName")
 * @param {object} [o.filter]
 * @param {string} o.filter.param    parametr adresu (np. "status")
 * @param {string} o.filter.attr     klucz dataset kafla (np. "status" -> data-status)
 * @param {Array<{value:string,labelKey:string}>} o.filter.options  bez pozycji „wszystko”
 * @param {string} o.filter.allKey   klucz tłumaczenia „wszystkie”
 * @param {string} o.filter.ariaKey  klucz tłumaczenia etykiety listy
 * @param {object} [o.sort]          sortowanie kafli w siatce (lista rozwijana przed filtrem)
 * @param {string} o.sort.param      parametr adresu (np. "sort")
 * @param {string} o.sort.ariaKey    klucz tłumaczenia etykiety listy
 * @param {string} o.sort.defaultKey klucz tłumaczenia pozycji domyślnej (ostatnio zmienione)
 * @param {Array<{value:"created"|"name",labelKey:string}>} o.sort.options
 *   kafel niesie data-created / data-updated (ISO) i nazwę w `name`; bez tych
 *   atrybutów (np. rynek) siatka zostaje w kolejności z serwera.
 */
export function initListSearch({ grids, tile, name, filter, sort }) {
  const slot = document.querySelector(".list-toolbar-left");
  if (!slot) return;
  // Komputer: pole jak w oknie „Przenieś do” (lupa w polu, X czyści frazę).
  // Telefon: sam przycisk lupy otwiera okno z takim samym polem; po
  // wyszukaniu lupa zmienia się w X, który czyści frazę.
  const search = document.createElement("div");
  search.className = "list-search";
  const box = document.createElement("label");
  box.className = "searchBox searchBox--field";
  box.innerHTML = icon("search");
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "btn-plain searchClear";
  clear.innerHTML = icon("close");
  clear.hidden = true;
  const input = document.createElement("input");
  input.type = "text";
  input.setAttribute("enterkeyhint", "search");
  input.className = "searchText";
  const mobileSearch = document.createElement("button");
  mobileSearch.type = "button";
  mobileSearch.className = "btn list-search-open";
  mobileSearch.innerHTML = icon("search");
  const label = () => {
    input.placeholder = t("common.searchByName");
    input.setAttribute("aria-label", t("common.searchByName"));
    mobileSearch.title = input.value ? t("common.clear") : t("common.searchByName");
    mobileSearch.setAttribute("aria-label", mobileSearch.title);
    clear.title = t("common.clear");
    clear.setAttribute("aria-label", clear.title);
  };
  label();
  box.append(input, clear);
  search.append(box, mobileSearch);
  slot.append(search);

  let filterValue = "";
  let filterApi = null;
  if (filter) {
    filterValue = filterFromSearch(location.search, filter.param, filter.options.map((o) => o.value));
    const wrap = document.createElement("div");
    wrap.className = "ui-select list-filter";
    wrap.innerHTML = `<button class="btn sm ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ui-select-icon" aria-hidden="true"><i class="ico" data-icon="filter"></i></span><span class="ui-select-label">—</span><span class="ui-select-caret" aria-hidden="true"><i class="ico" data-icon="caret-down"></i></span></button><div class="ui-select-menu" role="listbox"></div>`;
    slot.insertBefore(wrap, search);
    const opts = () => [{ value: "", label: t(filter.allKey) }, ...filter.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))];
    const aria = () => wrap.querySelector(".ui-select-btn")?.setAttribute("aria-label", t(filter.ariaKey));
    aria();
    filterApi = initUiSelect(wrap, {
      options: opts(),
      value: filterValue,
      onChange: (val) => {
        filterValue = String(val || "");
        history.replaceState(history.state, "", filterToHref(location.href, filter.param, filterValue));
        wrap.classList.toggle("is-active", !!filterValue);
        apply();
      },
    });
    window.addEventListener("i18n:lang", () => { aria(); filterApi.setOptions(opts()); });
  }

  let sortValue = "";
  if (sort) {
    sortValue = filterFromSearch(location.search, sort.param, sort.options.map((o) => o.value));
    const wrapS = document.createElement("div");
    wrapS.className = "ui-select list-sort";
    wrapS.innerHTML = `<button class="btn sm ui-select-btn" type="button" aria-haspopup="listbox" aria-expanded="false"><span class="ui-select-icon" aria-hidden="true"><i class="ico" data-icon="sort"></i></span><span class="ui-select-label">—</span><span class="ui-select-caret" aria-hidden="true"><i class="ico" data-icon="caret-down"></i></span></button><div class="ui-select-menu" role="listbox"></div>`;
    slot.insertBefore(wrapS, slot.firstChild);
    const optsS = () => [{ value: "", label: t(sort.defaultKey) }, ...sort.options.map((o) => ({ value: o.value, label: t(o.labelKey) }))];
    const ariaS = () => wrapS.querySelector(".ui-select-btn")?.setAttribute("aria-label", t(sort.ariaKey));
    ariaS();
    const apiS = initUiSelect(wrapS, {
      options: optsS(),
      value: sortValue,
      onChange: (val) => {
        sortValue = String(val || "");
        history.replaceState(history.state, "", filterToHref(location.href, sort.param, sortValue));
        wrapS.classList.toggle("is-active", !!sortValue);
        apply();
      },
    });
    window.addEventListener("i18n:lang", () => { ariaS(); apiS.setOptions(optsS()); apply(); });
  }

  // Układa kafle wg wybranego sortowania: kafel „+” (.addCard) zawsze
  // pierwszy, zaraz po nim kafle propozycji (data-proposed, proposed-tile.js),
  // potem reszta. Dotyka DOM tylko, gdy kolejność się zmienia (MutationObserver nie zapętla się).
  const sortGrid = (grid) => {
    if (!sort) return;
    const own = [...grid.children].filter((el) => (el.matches(tile) || el.classList.contains("addCard")) && !el.classList.contains("list-empty"));
    const tiles = own.filter((el) => !el.classList.contains("addCard"));
    if (tiles.some((el) => !el.dataset.updated && !el.dataset.created)) return;
    const stamp = (el, k) => Date.parse(el.dataset[k] || el.dataset.created || "") || 0;
    const nm = (el) => norm(el.querySelector(name)?.textContent);
    const cmp = sortValue === "name" ? (a, b) => nm(a).localeCompare(nm(b), "pl")
      : sortValue === "created" ? (a, b) => stamp(b, "created") - stamp(a, "created")
      : (a, b) => stamp(b, "updated") - stamp(a, "updated");
    const sorted = [
      ...own.filter((el) => el.classList.contains("addCard")),
      ...tiles.filter((el) => el.dataset.proposed === "1").sort(cmp),
      ...tiles.filter((el) => el.dataset.proposed !== "1").sort(cmp),
    ];
    if (sorted.every((el, i) => el === own[i])) return;
    for (const el of sorted) grid.appendChild(el);
  };

  const emptyEls = new Map();
  const emptyFor = (grid) => {
    let el = emptyEls.get(grid);
    if (!el) {
      el = emptyState("", { variant: "tile", hook: "list-empty" });
      el.hidden = true;
      emptyEls.set(grid, el);
    }
    // ponowny render siatki (innerHTML) usuwa komunikat — dopinamy go z powrotem
    if (el.parentElement !== grid) grid.append(el);
    const message = t("common.noResults");
    if (el.textContent !== message) el.textContent = message;
    return el;
  };

  const apply = () => {
    const q = norm(input.value);
    const selectedFilterOption = filter?.options.find((option) => option.value === filterValue);
    mobileSearch.innerHTML = icon(q ? "close" : "search");
    mobileSearch.classList.toggle("is-active", !!q);
    mobileSearch.title = q ? t("common.clear") : t("common.searchByName");
    mobileSearch.setAttribute("aria-label", mobileSearch.title);
    clear.hidden = !q;
    if (filter) document.querySelector(".list-filter")?.classList.toggle("is-active", !!filterValue);
    if (sort) document.querySelector(".list-sort")?.classList.toggle("is-active", !!sortValue);
    for (const grid of document.querySelectorAll(grids)) {
      sortGrid(grid);
      let total = 0, visible = 0;
      for (const el of grid.querySelectorAll(tile)) {
        if (el.classList.contains("addCard") || el.classList.contains("list-empty")) continue;
        total++;
        const hit = (!q || norm(el.querySelector(name)?.textContent).includes(q))
          && (!filterValue || (selectedFilterOption?.matches
            ? selectedFilterOption.matches(el)
            : matchesFilter(el.dataset[filter.attr], filterValue)));
        el.hidden = !hit;
        if (hit) visible++;
      }
      // sekcje udostępniania (share-sections.js): bez widocznych wierszy znikają razem z nagłówkiem
      for (const sec of grid.querySelectorAll(".shareSection, .rowsSection")) {
        sec.hidden = ![...sec.querySelectorAll(tile)].some((e) => !e.hidden);
      }
      emptyFor(grid).hidden = !showEmptyResult({ hasQuery: !!q, filterValue, total, visible });
    }
  };
  input.addEventListener("input", apply);
  clear.addEventListener("click", (e) => { e.preventDefault(); input.value = ""; apply(); input.focus(); });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); input.value = ""; apply(); } });
  mobileSearch.addEventListener("click", async () => {
    if (input.value) {
      input.value = "";
      apply();
      return;
    }
    const searchFieldVisible = getComputedStyle(box).display !== "none" && box.getClientRects().length > 0;
    if (searchFieldVisible) {
      input.focus();
      return;
    }
    const value = await promptModal({
      title: t("common.searchByName"),
      value: input.value,
      placeholder: t("common.searchByName"),
      text: "",
      okText: t("common.modal.alertOk"),
      search: true,
      onReady: ({ overlay, okBtn }) => overlay.querySelector(".uni-inp")?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") { event.preventDefault(); okBtn.click(); }
      }),
    });
    if (value !== null) {
      input.value = value;
      apply();
    }
  });
  const mo = new MutationObserver((records) => {
    const listChanged = records.some((record) => {
      if (record.target.closest?.(".list-empty")) return false;
      return [...record.addedNodes, ...record.removedNodes].some((node) =>
        !(node.nodeType === Node.ELEMENT_NODE && (node.matches?.(".list-empty") || node.closest?.(".list-empty")))
      );
    });
    if (listChanged && (input.value || filterValue || sortValue || sort)) apply();
  });
  for (const grid of document.querySelectorAll(grids)) mo.observe(grid, { childList: true, subtree: true });

  // Wygaszona krawędź przewijanej siatki — wspólny kod list (scroll-fade.js).
  for (const grid of document.querySelectorAll(grids)) scrollFade(grid);
  window.addEventListener("i18n:lang", () => { label(); apply(); });
  if (filter) document.querySelector(".list-filter")?.classList.toggle("is-active", !!filterValue);
  if (sort) document.querySelector(".list-sort")?.classList.toggle("is-active", !!sortValue);
  apply();
}
