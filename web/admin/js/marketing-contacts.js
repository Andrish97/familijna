// admin/js/marketing-contacts.js — Marketing: kategorie Lead Findera, wyszukiwanie,
// tabela kontaktów z widokami kategorii, adresy do wysyłki.
// Plan: docs/lead-finder-nowy-plan.md (Lead Finder 3). Wysyłka: marketing.js.

import { initUiSelect } from "../../shared/js/core/ui-select.js?v=v2026-10-25T16362";
import { alertModal, confirmModal } from "../../shared/js/core/modal.js?v=v2026-10-25T16362";
import { icon, iconText } from "../../shared/js/core/icons.js?v=v2026-10-25T16362";
import { adminFetch, adminGet, adminPost } from "./core.js?v=v2026-10-25T16362";
import { addMarketingRecipients } from "./marketing.js?v=v2026-10-25T16362";

const MC_PAGE_SIZE = 50;
const MC_SENT_FILTERS = [
  { value: "", label: "Wszystkie" },
  { value: "unsent", label: "Niewysłane" },
  { value: "waiting", label: "Wysłane, bez odpowiedzi" },
  { value: "replied", label: "Odpowiedzieli" },
  { value: "blocked", label: "Odmowa lub odbity" },
];
const MC_REACTION_LABEL = { replied: "Odpowiedź", declined: "Odmowa", bounced: "Odbity" };
const MC_REACTION_CLASS = { replied: " mc-reaction--replied", declined: " mc-reaction--declined", bounced: " mc-reaction--bounced" };

export async function initMarketingContacts() {
  // Lead Finder przez Worker (/_admin_api/leads/*): klucz usługi zostaje po
  // stronie serwera (audyt E24, Ś2). Zwraca odpowiedź usługi (JSON).
  async function mcLeads(path, method = "GET") {
    const res = await adminFetch(`/leads/${path}`, { method });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
    return data || {};
  }
  let mcSentFilter = "";
  let mcSearchValue = "";
  let mcState = {
    categories: [],
    view: "",            // "" = wszystkie, "none" = bez kategorii, inaczej id kategorii
    contacts: [],
    selectedCells: [],
    page: 1,
    sortCol: "added_at",
    sortDir: "desc",
    logs: [],
    logRun: null,
    logTimer: null,
    status: "idle",
  };

  function mcEsc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function mcDate(v) { return v ? new Date(v).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "2-digit" }) : ""; }
  function plural(n, one, few, many) {
    const d = n % 10, t = n % 100;
    return n === 1 ? one : d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
  }
  function catName(id) { return mcState.categories.find((c) => c.id === id)?.name || ""; }

  // ── Kategorie ───────────────────────────────────────────────────────────
  async function mcLoadCategories() {
    try {
      mcState.categories = (await adminGet("/marketing/categories", "rows")) || [];
    } catch (e) {
      mcState.categories = [];
      document.getElementById("mcCatList").innerHTML = `<div class="mc-empty">Błąd: ${mcEsc(e.message)}</div>`;
      return;
    }
    mcRenderCategories();
    mcRenderViews();
  }

  function mcRenderCategories() {
    const el = document.getElementById("mcCatList");
    if (!mcState.categories.length) {
      el.innerHTML = '<div class="mc-empty">Brak kategorii — dodaj pierwszą, np. „DJ na wesela”.</div>';
      return;
    }
    el.innerHTML = mcState.categories.map((c) => {
      const nq = c.queries?.length || 0;
      const state = c.expanded_at ? `${nq} ${plural(nq, "fraza", "frazy", "fraz")}, PKD: ${c.pkd?.length || 0}` : "AI przygotuje frazy przy wyszukiwaniu";
      return `<div class="mc-cat-row" data-id="${c.id}">
        <label class="mc-cat-toggle"><input type="checkbox" data-act="active" ${c.is_active ? "checked" : ""}> <span class="mc-cat-name">${mcEsc(c.name)}</span></label>
        <span class="mc-meta">${c.contacts ?? 0} ${plural(c.contacts ?? 0, "kontakt", "kontakty", "kontaktów")} · ${mcEsc(state)}</span>
        <button class="btn sm" type="button" data-act="details" aria-label="Szczegóły">${icon("eye")}</button>
        <button class="btn sm danger" type="button" data-act="delete" aria-label="Usuń kategorię">${icon("trash")}</button>
        <div class="mc-cat-details" hidden>
          ${c.description ? `<p class="mc-cat-desc">${mcEsc(c.description)}</p>` : ""}
          ${c.queries?.length ? `<div class="mc-meta">Frazy: ${c.queries.map(mcEsc).join(" · ")}</div>` : ""}
          ${c.pkd?.length ? `<div class="mc-meta">PKD: ${c.pkd.map(mcEsc).join(", ")}</div>` : ""}
        </div>
      </div>`;
    }).join("");
  }

  async function mcAddCategory() {
    const input = document.getElementById("mcCatName");
    const name = input.value.trim();
    if (!name) return;
    try {
      await adminPost("/marketing/categories", { name });
      input.value = "";
      await mcLoadCategories();
    } catch (e) { alertModal({ text: "Błąd: " + e.message }); }
  }

  document.getElementById("mcCatAddBtn")?.addEventListener("click", mcAddCategory);
  document.getElementById("mcCatName")?.addEventListener("keydown", (e) => { if (e.key === "Enter") mcAddCategory(); });
  document.getElementById("mcCatList")?.addEventListener("click", async (e) => {
    const row = e.target.closest(".mc-cat-row");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!row || !act) return;
    const id = row.dataset.id;
    if (act === "details") { const d = row.querySelector(".mc-cat-details"); d.hidden = !d.hidden; return; }
    if (act === "delete") {
      if (!await confirmModal({ text: `Usunąć kategorię „${catName(id)}”? Kontakty zostają (bez kategorii).` })) return;
      try { await adminPost("/marketing/categories/delete", { id }); } catch (err) { alertModal({ text: "Błąd: " + err.message }); }
      if (mcState.view === id) mcState.view = "";
      await mcLoadCategories();
      mcLoadContacts();
    }
  });
  document.getElementById("mcCatList")?.addEventListener("change", async (e) => {
    if (e.target.dataset.act !== "active") return;
    const id = e.target.closest(".mc-cat-row")?.dataset.id;
    try { await adminPost("/marketing/categories/update", { id, is_active: e.target.checked }); }
    catch (err) { alertModal({ text: "Błąd: " + err.message }); e.target.checked = !e.target.checked; }
  });

  // ── Widoki tabeli: Wszystkie + kategorie ────────────────────────────────
  function mcRenderViews() {
    const el = document.getElementById("mcViews");
    const views = [{ id: "", name: "Wszystkie" }, ...mcState.categories, { id: "none", name: "Bez kategorii" }];
    el.innerHTML = views.map((v) =>
      `<button class="btn sm${mcState.view === v.id ? " is-active" : ""}" type="button" role="tab" data-view="${v.id}">${mcEsc(v.name)}${v.contacts != null ? ` <span class="badge">${v.contacts}</span>` : ""}</button>`
    ).join("");
  }
  document.getElementById("mcViews")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    mcState.view = btn.dataset.view;
    mcState.page = 1;
    mcState.selectedCells = [];
    mcRenderViews();
    mcLoadContacts();
  });

  function mcQuery() {
    const q = new URLSearchParams({ page: String(mcState.page), sort: mcState.sortCol, dir: mcState.sortDir });
    if (mcState.view) q.set("category", mcState.view);
    if (mcSentFilter) q.set("sent", mcSentFilter);
    const search = mcSearchValue.trim();
    if (search) q.set("search", search);
    return q;
  }

  // ── Wyszukiwanie (przebiegi Lead Findera) ───────────────────────────────
  function mcUpdateButtons() {
    const actionBtn = document.getElementById("mcActionBtn");
    const cancelBtn = document.getElementById("mcCancelBtn");
    const targetInput = document.getElementById("mcTargetCount");
    if (!actionBtn || !cancelBtn) return;
    actionBtn.disabled = false;
    cancelBtn.disabled = false;
    switch (mcState.status) {
      case "starting":
      case "running":
        actionBtn.innerHTML = iconText("pause", "Wstrzymaj");
        actionBtn.className = "btn sm warning";
        cancelBtn.hidden = false;
        targetInput.disabled = true;
        break;
      case "paused":
        actionBtn.innerHTML = iconText("play", "Wznów");
        actionBtn.className = "btn sm gold";
        cancelBtn.hidden = false;
        targetInput.disabled = true;
        break;
      default:
        actionBtn.innerHTML = iconText("play", "Uruchom");
        actionBtn.className = "btn sm gold";
        cancelBtn.hidden = true;
        targetInput.disabled = false;
        break;
    }
  }

  async function mcLoadRuns() {
    try {
      const data = await mcLeads("search-runs/status");
      mcState.status = data.status || "idle";
      mcState.logRun = data.run_id;
    } catch {
      mcState.status = "idle";
    }
    mcUpdateButtons();
  }

  async function mcStartRun() {
    const actionBtn = document.getElementById("mcActionBtn");
    const count = parseInt(document.getElementById("mcTargetCount").value) || 50;
    if (!mcState.categories.some((c) => c.is_active)) {
      alertModal({ text: "Dodaj albo włącz co najmniej jedną kategorię wyszukiwania." });
      mcUpdateButtons();
      return;
    }
    actionBtn.disabled = true;
    try {
      mcState.logs = [];
      mcRenderLogs();
      const data = await mcLeads(`search-runs?target_count=${count}`, "POST");
      mcState.status = "running";
      mcState.logRun = data.run_id;
      mcUpdateButtons();
      mcStartLogAutoRefresh();
    } catch (e) {
      alertModal({ text: "Błąd: " + e.message });
      mcUpdateButtons();
    }
  }

  document.getElementById("mcActionBtn")?.addEventListener("click", async () => {
    const actionBtn = document.getElementById("mcActionBtn");
    const cancelBtn = document.getElementById("mcCancelBtn");
    actionBtn.disabled = true;
    cancelBtn.disabled = true;
    if (mcState.status !== "running" && mcState.status !== "paused" && mcState.status !== "starting") {
      await mcStartRun();
      return;
    }
    try {
      if (mcState.status === "paused") {
        await mcLeads(`search-runs/${mcState.logRun}/resume`, "POST");
        mcState.status = "running";
        mcStartLogAutoRefresh();
      } else {
        await mcLeads(`search-runs/${mcState.logRun}/pause`, "POST");
        mcState.status = "paused";
        mcStopLogAutoRefresh();
      }
      mcUpdateButtons();
    } catch (e) {
      alertModal({ text: "Błąd: " + e.message });
      await mcLoadRuns();
    }
  });

  document.getElementById("mcCancelBtn")?.addEventListener("click", async () => {
    if (!await confirmModal({ text: "Anulować wyszukiwanie?" })) return;
    await mcLeads(`search-runs/${mcState.logRun}/cancel`, "POST").catch(() => {});
    mcState.status = "idle";
    mcUpdateButtons();
    mcStopLogAutoRefresh();
    mcLoadContacts();
  });

  // ── Tabela ──────────────────────────────────────────────────────────────
  async function mcLoadContacts() {
    const tbody = document.getElementById("mcTableBody");
    try {
      const { rows, total } = await adminGet(`/marketing/contacts?${mcQuery()}`);
      mcState.contacts = rows || [];
      mcState.total = total || 0;
      mcRenderContacts();
      mcUpdateSortHeaders();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6" class="mc-empty mc-empty--cell">Błąd: ${mcEsc(e.message)}</td></tr>`;
    }
  }

  function mcUpdateSortHeaders() {
    document.querySelectorAll(".mc-sortable").forEach((th) => {
      const col = th.dataset.col;
      const arrow = col === mcState.sortCol ? " " + icon(mcState.sortDir === "asc" ? "caret-up" : "caret-down") : "";
      th.innerHTML = th.dataset.label + arrow;
    });
  }

  function mcInitSorting() {
    document.querySelectorAll(".mc-sortable").forEach((th) => {
      th.dataset.label = th.textContent.trim();
      th.addEventListener("click", () => {
        const col = th.dataset.col;
        if (mcState.sortCol === col) mcState.sortDir = mcState.sortDir === "asc" ? "desc" : "asc";
        else { mcState.sortCol = col; mcState.sortDir = "desc"; }
        mcState.page = 1;
        mcLoadContacts();
      });
    });
  }

  function mcSentText(c) {
    if (!c.sent_count) return "—";
    const when = mcDate(c.last_sent_at);
    return c.sent_count > 1 ? `×${c.sent_count}${when ? ", " + when : ""}` : (when || "tak");
  }

  function mcRenderContacts() {
    const tbody = document.getElementById("mcTableBody");
    mcState.selectedCells = [];
    if (!mcState.contacts.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="mc-empty mc-empty--cell">Brak kontaktów</td></tr>';
    } else {
      tbody.innerHTML = mcState.contacts.map((c, i) => `<tr class="${c.sent_count ? "mc-used" : ""}" data-id="${c.id}">
        <td class="mc-cell mc-selectable" data-row="${i}" data-col="0" title="${mcEsc(c.short_description || "")}">${mcEsc(c.title || "")}</td>
        <td class="mc-cell mc-selectable" data-row="${i}" data-col="1">${mcEsc(c.email || "")}</td>
        <td class="mc-cell mc-selectable" data-row="${i}" data-col="2">${mcEsc(c.url || "")}</td>
        <td class="mc-cell mc-selectable" data-row="${i}" data-col="3">${mcEsc(catName(c.category_id))}</td>
        <td class="mc-cell mc-selectable" data-row="${i}" data-col="4">${mcSentText(c)}</td>
        <td class="mc-cell mc-selectable${MC_REACTION_CLASS[c.reaction] || ""}" data-row="${i}" data-col="5">${MC_REACTION_LABEL[c.reaction] || "—"}</td>
      </tr>`).join("");
    }
    mcUpdatePagination(mcState.total || 0);
    mcUpdateSelectionInfo();
    mcUpdateRowButtons();
  }

  function mcSetupTableSelection() {
    const tbody = document.getElementById("mcTableBody");
    let isDragging = false;
    let dragStart = null;
    let autoScrollTimer = null;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let existingSelection = [];
    let touchToggleMode = false;
    let tapStartX = 0;
    let tapStartY = 0;

    function highlight() {
      tbody.querySelectorAll('.mc-cell-selected').forEach(c => c.classList.remove('mc-cell-selected'));
      mcState.selectedCells.forEach(({row, col}) => {
        const el = tbody.querySelector(`.mc-selectable[data-row="${row}"][data-col="${col}"]`);
        if (el) el.classList.add('mc-cell-selected');
      });
      mcUpdateSelectionInfo();
      mcUpdateRowButtons();
    }

    function selectRange(r1, c1, r2, c2) {
      const rMin = Math.min(r1, r2), rMax = Math.max(r1, r2);
      const cMin = Math.min(c1, c2), cMax = Math.max(c1, c2);
      const newRange = [];
      for (let r = rMin; r <= rMax; r++)
        for (let c = cMin; c <= cMax; c++)
          newRange.push({row: r, col: c});
      if (touchToggleMode) {
        const rangeKeys = new Set(newRange.map(c => `${c.row}:${c.col}`));
        const existMap = new Map(existingSelection.map(c => [`${c.row}:${c.col}`, c]));
        const result = existingSelection.filter(c => !rangeKeys.has(`${c.row}:${c.col}`));
        for (const c of newRange) { if (!existMap.has(`${c.row}:${c.col}`)) result.push(c); }
        mcState.selectedCells = result;
      } else {
        const existSet = new Set(existingSelection.map(c => `${c.row}:${c.col}`));
        mcState.selectedCells = [
          ...existingSelection,
          ...newRange.filter(c => !existSet.has(`${c.row}:${c.col}`))
        ];
      }
      highlight();
    }

    function cellAt(x, y) {
      const el = document.elementFromPoint(x, y);
      return el ? el.closest('.mc-selectable') : null;
    }

    function stopAutoScroll() {
      if (autoScrollTimer) { clearInterval(autoScrollTimer); autoScrollTimer = null; }
    }

    function startAutoScroll(getXY) {
      if (autoScrollTimer) return;
      const tableWrap = document.getElementById("mcContactsTable")?.parentElement;
      autoScrollTimer = setInterval(() => {
        if (!isDragging) { stopAutoScroll(); return; }
        const {x, y} = getXY();
        const thresh = 80, speed = 18;
        if (y < thresh) window.scrollBy(0, -speed);
        else if (y > window.innerHeight - thresh) window.scrollBy(0, speed);
        if (tableWrap) {
          const rect = tableWrap.getBoundingClientRect();
          if (x < rect.left + thresh) tableWrap.scrollLeft -= speed;
          else if (x > rect.right - thresh) tableWrap.scrollLeft += speed;
        }
        const cell = cellAt(x, y);
        if (cell && dragStart) {
          selectRange(dragStart.row, dragStart.col, parseInt(cell.dataset.row), parseInt(cell.dataset.col));
        }
      }, 20);
    }

    // ── Mouse ──────────────────────────────────────────────────────────────
    tbody.addEventListener('mousedown', e => {
      const cell = e.target.closest('.mc-selectable');
      if (!cell) return;
      e.preventDefault();
      const row = parseInt(cell.dataset.row), col = parseInt(cell.dataset.col);
      if (e.shiftKey && mcState.selectedCells.length) {
        existingSelection = [];
        const last = mcState.selectedCells[mcState.selectedCells.length - 1];
        selectRange(last.row, last.col, row, col);
        return;
      }
      existingSelection = [];
      isDragging = true;
      dragStart = {row, col};
      mcState.selectedCells = [{row, col}];
      highlight();
      startAutoScroll(() => ({x: lastTouchX, y: lastTouchY}));
    });

    document.addEventListener('mousemove', e => {
      if (!isDragging || !dragStart) return;
      lastTouchX = e.clientX; lastTouchY = e.clientY;
      const cell = cellAt(e.clientX, e.clientY);
      if (cell) selectRange(dragStart.row, dragStart.col, parseInt(cell.dataset.row), parseInt(cell.dataset.col));
    });

    document.addEventListener('mouseup', () => {
      isDragging = false; dragStart = null; stopAutoScroll();
    });

    // ── Touch: 1 palec = scroll / tap kasuje; 2 palce = dodawanie do zaznaczenia ──
    tbody.addEventListener('touchstart', e => {
      if (e.touches.length === 1) {
        tapStartX = e.touches[0].clientX; tapStartY = e.touches[0].clientY;
        return;
      }
      if (e.touches.length < 2) return;
      const anchor = cellAt(e.touches[0].clientX, e.touches[0].clientY);
      if (!anchor) return;
      isDragging = true;
      touchToggleMode = true;
      existingSelection = [...mcState.selectedCells];
      dragStart = {row: parseInt(anchor.dataset.row), col: parseInt(anchor.dataset.col)};
      lastTouchX = e.touches[1].clientX; lastTouchY = e.touches[1].clientY;
      const cursor = cellAt(lastTouchX, lastTouchY);
      if (cursor) selectRange(dragStart.row, dragStart.col, parseInt(cursor.dataset.row), parseInt(cursor.dataset.col));
      else {
        const key = `${dragStart.row}:${dragStart.col}`;
        if (!existingSelection.some(c => `${c.row}:${c.col}` === key))
          mcState.selectedCells = [...existingSelection, {row: dragStart.row, col: dragStart.col}];
        highlight();
      }
      startAutoScroll(() => ({x: lastTouchX, y: lastTouchY}));
    }, {passive: true});

    tbody.addEventListener('touchmove', e => {
      if (e.touches.length < 2 || !isDragging || !dragStart) return;
      e.preventDefault();
      lastTouchX = e.touches[1].clientX; lastTouchY = e.touches[1].clientY;
      const cell = cellAt(lastTouchX, lastTouchY);
      if (cell) selectRange(dragStart.row, dragStart.col, parseInt(cell.dataset.row), parseInt(cell.dataset.col));
    }, {passive: false});

    tbody.addEventListener('touchend', e => {
      if (!isDragging && e.changedTouches.length === 1) {
        const t = e.changedTouches[0];
        const dx = t.clientX - tapStartX, dy = t.clientY - tapStartY;
        if (Math.hypot(dx, dy) < 12) {
          const cell = cellAt(t.clientX, t.clientY);
          if (cell) {
            existingSelection = [];
            mcState.selectedCells = [{row: parseInt(cell.dataset.row), col: parseInt(cell.dataset.col)}];
            highlight();
          }
        }
      }
      isDragging = false; dragStart = null; touchToggleMode = false; stopAutoScroll();
    });

    // ── Klik poza tabelą → odznacz ─────────────────────────────────────────
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('#mcContactsTable') &&
          !e.target.closest('#mcVisitUrlBtn') &&
          !e.target.closest('#mcToRecipientsBtn') &&
          !e.target.closest('#mcDeleteBtn') &&
          !e.target.closest('#mcCopyBtn')) {
        mcState.selectedCells = [];
        highlight();
      }
    });

    // ── Kopiowanie ─────────────────────────────────────────────────────────
    document.addEventListener('copy', e => {
      if (!mcState.selectedCells.length) return;
      const panel = document.getElementById("marketingContactsPanel");
      if (panel && panel.hidden) return;
      e.preventDefault();
      const rows = {};
      mcState.selectedCells.forEach(({row, col}) => { (rows[row] = rows[row] || []).push(col); });
      const sortedRows = Object.keys(rows).map(Number).sort((a, b) => a - b);
      const allCols = [...new Set(mcState.selectedCells.map(c => c.col))].sort((a, b) => a - b);
      const lines = sortedRows.map(r =>
        allCols.map(c => {
          const el = tbody.querySelector(`.mc-selectable[data-row="${r}"][data-col="${c}"]`);
          return el ? el.textContent.trim() : '';
        }).join('\t')
      );
      e.clipboardData.setData('text/plain', lines.join('\n'));
    });
  }


  function mcSelectedContacts() {
    const rows = new Set(mcState.selectedCells.map((c) => c.row));
    return [...rows].map((i) => mcState.contacts[i]).filter(Boolean);
  }

  function mcUpdateSelectionInfo() {
    const info = document.getElementById("mcSelectionInfo");
    const urlBtn = document.getElementById("mcVisitUrlBtn");
    const copyBtn = document.getElementById("mcCopyBtn");
    const cells = mcState.selectedCells;
    if (info) {
      const rowCount = new Set(cells.map((c) => c.row)).size;
      info.textContent = cells.length ? (rowCount === 1 ? "1 wiersz" : `${rowCount} wierszy`) : "";
    }
    if (copyBtn) copyBtn.hidden = !cells.length;
    if (urlBtn) {
      const contact = cells.length === 1 && cells[0].col === 2 ? mcState.contacts[cells[0].row] : null;
      if (contact?.url && /^https?:\/\//i.test(contact.url)) { urlBtn.href = contact.url; urlBtn.hidden = false; }
      else urlBtn.hidden = true;
    }
  }

  function mcUpdateRowButtons() {
    const any = mcSelectedContacts().length > 0;
    const toRec = document.getElementById("mcToRecipientsBtn");
    const del = document.getElementById("mcDeleteBtn");
    if (toRec) toRec.hidden = !any;
    if (del) del.hidden = !any;
  }

  async function mcDeleteSelected() {
    const selected = mcSelectedContacts();
    if (!selected.length) return;
    if (!await confirmModal({ text: `Usunąć ${selected.length} kontaktów?` })) return;
    try {
      await adminPost("/marketing/contacts/delete", { ids: selected.map((c) => c.id) });
      mcLoadContacts();
      mcLoadCategories();
    } catch (e) { alertModal({ text: "Błąd: " + e.message }); }
  }

  function mcUpdatePagination(total) {
    const pages = Math.ceil(total / MC_PAGE_SIZE) || 1;
    document.getElementById("mcPageInfo").textContent = `Strona ${mcState.page} / ${pages} (${total})`;
    document.getElementById("mcPrevPage").disabled = mcState.page <= 1;
    document.getElementById("mcNextPage").disabled = mcState.page >= pages;
  }

  // ── Do wysyłki: zaznaczone albo cały widok ──────────────────────────────
  function mcSendable(c) { return c.email && c.reaction !== "declined" && c.reaction !== "bounced"; }

  document.getElementById("mcToRecipientsBtn")?.addEventListener("click", () => {
    const emails = mcSelectedContacts().filter(mcSendable).map((c) => c.email);
    const n = addMarketingRecipients(emails);
    if (!n) alertModal({ text: "Zaznaczone adresy są już na liście albo odmówiły / odbiły." });
  });

  document.getElementById("mcViewToRecipientsBtn")?.addEventListener("click", async () => {
    try {
      const q = mcQuery();
      q.delete("page");
      const data = await adminGet(`/marketing/contacts/emails?${q}`);
      const emails = data.emails || [];
      if (!emails.length) { alertModal({ text: "W tym widoku nie ma adresów do wysyłki." }); return; }
      const more = data.total > emails.length ? ` Widok ma ${data.total} adresów — jedna wysyłka to najwyżej ${emails.length}.` : "";
      if (!await confirmModal({ text: `Dodać ${emails.length} adresów z widoku do wysyłki?${more}` })) return;
      addMarketingRecipients(emails);
    } catch (e) { alertModal({ text: "Błąd: " + e.message }); }
  });

  document.addEventListener("mkt-sent", () => { mcLoadContacts(); });

  // ── Logi ────────────────────────────────────────────────────────────────
  async function mcLoadLogs() {
    const el = document.getElementById("mcLogsContainer");
    try {
      const data = await adminGet("/marketing/logs", "rows");
      mcState.logs = (data || []).reverse();
      mcRenderLogs();
    } catch (e) { el.innerHTML = `<div class="mc-empty">Błąd: ${mcEsc(e.message)}</div>`; }
  }
  function mcRenderLogs() {
    const el = document.getElementById("mcLogsContainer");
    if (!mcState.logs.length) { el.innerHTML = '<div class="mc-empty">Brak logów</div>'; return; }
    el.innerHTML = mcState.logs.map((l) => {
      const time = new Date(l.created_at).toLocaleString("pl-PL", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const levelClass = { info: "info", success: "success", warning: "warning", error: "error" }[l.level] || "info";
      const levelText = { info: "INFO", success: "OK", warning: "WARN", error: "ERR" }[l.level] || l.level;
      return `<div class="mc-log-entry"><span class="mc-log-time">${time}</span><span class="mc-log-level ${levelClass}">${levelText}</span><span class="mc-log-message">${mcEsc(l.message)}</span></div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  }

  function mcStartLogAutoRefresh() {
    if (mcState.logTimer) return;
    mcState.logTimer = setInterval(async () => {
      let data;
      try { data = await mcLeads("search-runs/status"); } catch { mcStopLogAutoRefresh(); return; }
      mcState.status = data.status || "idle";
      mcState.logRun = data.run_id;
      mcUpdateButtons();
      if (mcState.page === 1) mcLoadContacts();
      if (mcState.status !== "running" && mcState.status !== "starting") {
        mcStopLogAutoRefresh();
        mcLoadCategories();
      }
    }, 3000);
    mcState.logPollTimer = setInterval(() => mcLoadLogs(), 2000);
  }

  function mcStopLogAutoRefresh() {
    if (mcState.logTimer) { clearInterval(mcState.logTimer); mcState.logTimer = null; }
    if (mcState.logPollTimer) { clearInterval(mcState.logPollTimer); mcState.logPollTimer = null; }
  }

  // ── Zdarzenia ───────────────────────────────────────────────────────────
  document.getElementById("mcRefreshBtn")?.addEventListener("click", () => { mcLoadRuns(); mcLoadCategories(); mcLoadContacts(); mcLoadLogs(); });
  {
    let mcSearchTimer = null;
    const searchInput = document.getElementById("mcSearchInput");
    const searchClearBtn = document.getElementById("mcSearchClearBtn");
    searchInput?.addEventListener("input", (e) => {
      if (searchClearBtn) searchClearBtn.hidden = !e.target.value;
      clearTimeout(mcSearchTimer);
      mcSearchTimer = setTimeout(() => { mcSearchValue = e.target.value; mcState.page = 1; mcLoadContacts(); }, 300);
    });
    searchClearBtn?.addEventListener("click", () => {
      if (!searchInput) return;
      searchInput.value = "";
      searchClearBtn.hidden = true;
      clearTimeout(mcSearchTimer);
      mcSearchValue = "";
      mcState.page = 1;
      mcLoadContacts();
      searchInput.focus();
    });
  }
  initUiSelect(document.getElementById("mcFilterSent"), {
    options: MC_SENT_FILTERS,
    value: "",
    onChange: (val) => { mcSentFilter = val; mcState.page = 1; mcLoadContacts(); },
  });
  document.getElementById("mcDeleteBtn")?.addEventListener("click", mcDeleteSelected);
  document.getElementById("mcCopyBtn")?.addEventListener("click", () => {
    if (!mcState.selectedCells.length) return;
    const tbody = document.getElementById("mcTableBody");
    const rows = {};
    mcState.selectedCells.forEach(({ row, col }) => { (rows[row] = rows[row] || []).push(col); });
    const sortedRows = Object.keys(rows).map(Number).sort((a, b) => a - b);
    const allCols = [...new Set(mcState.selectedCells.map((c) => c.col))].sort((a, b) => a - b);
    const text = sortedRows.map((r) => allCols.map((c) => {
      const el = tbody?.querySelector(`.mc-selectable[data-row="${r}"][data-col="${c}"]`);
      return el ? el.textContent.trim() : "";
    }).join("\t")).join("\n");
    const btn = document.getElementById("mcCopyBtn");
    const flash = (ok) => {
      const orig = btn.innerHTML;
      btn.innerHTML = ok ? iconText("check", "Skopiowano") : iconText("error", "Błąd");
      setTimeout(() => { btn.innerHTML = orig; }, 1200);
    };
    navigator.clipboard?.writeText(text).then(() => flash(true), () => flash(false));
  });
  document.getElementById("mcPrevPage")?.addEventListener("click", () => { if (mcState.page > 1) { mcState.page--; mcLoadContacts(); } });
  document.getElementById("mcNextPage")?.addEventListener("click", () => { mcState.page++; mcLoadContacts(); });
  document.getElementById("mcAutoRefreshLogs")?.addEventListener("change", (e) => { if (e.target.checked) mcStartLogAutoRefresh(); else mcStopLogAutoRefresh(); });
  mcInitSorting();
  mcSetupTableSelection();

  // Dane przy wejściu na kartę Marketing.
  const panel = document.getElementById("marketingPanel");
  const onShow = async () => {
    if (panel?.hidden) return;
    await mcLoadCategories();
    mcLoadContacts();
    await mcLoadRuns();
    mcLoadLogs();
    if (mcState.status === "running" && document.getElementById("mcAutoRefreshLogs")?.checked) mcStartLogAutoRefresh();
  };
  if (panel) new MutationObserver(onShow).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  mcUpdateButtons();
  onShow();
}
