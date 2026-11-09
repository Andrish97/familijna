// Podliczanie głosów w karcie Wyniki — płynna zmiana TYCH SAMYCH wierszy
// (familijna-server/docs/ankiety-refaktor.md, „Podliczanie w karcie Wyniki”).
//
// Dane: poll_tally_source (E21) -- N pełnych ankiet bieżącego uruchomienia
// i głosy tylko tych ankiet; tekstowe już oczyszczone ze znaków spoza czcionki.
// Ankieta punktowa: głosy i procent zamieniają się w punkty (podgląd liczony tu
// tym samym algorytmem co baza: poll-tally-math.js); odpowiedzi <4% są szare.
// „Zatwierdź” -> poll_points_tally (strona).
//
// Ankieta tekstowa: wiersze dostają uchwyt (przeciągnij na inny = połącz), pole
// edycji tekstu, kosz; punkty na żywo (algorytm bazy), licznik „3–6 odpowiedzi”
// przy pytaniu, Cofnij / Ponów. Remis głosów na granicy szóstki: przycisk
// zmienia cyklicznie wybór z grupy remisowej (zapisany w szkicu, sprawdza SQL). Poprawki zapisują się w bazie (szkic,
// poll_text_tally_draft_save, z opóźnieniem) i wracają po ponownym wejściu.
// „Zatwierdź” -> poll_text_tally_apply (strona; punkty liczy baza).
//
// Moduł zmienia tylko DOM wyników przekazanych przez pollResults.slots();
// stan ankiety, przyciski i potwierdzenia zostają w polls.js.
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-09T12154";
import { t } from "../../shared/translation/translation.js?v=v2026-11-09T12154";
import { icon } from "../../shared/js/core/icons.js?v=v2026-11-09T12154";
import { makeResultRow } from "../../shared/js/core/poll-results.js?v=v2026-11-09T12154";
import { sortAnswersByPoints } from "../../shared/js/core/answer-order.js?v=v2026-11-09T12154";
import { loadFont5x7 } from "../../shared/js/core/logo-preview.js?v=v2026-11-09T12154";
import { ANSWER_MAX, clipChars, cleanAnswerText } from "../../shared/js/core/answer-text.js?v=v2026-11-09T12154";

import {
  pointsPollAnalysis,
  textTallyAnalysis,
  nextTieSelection,
} from "../../shared/js/core/poll-tally-math.js?v=v2026-11-09T12154";
import { setProgress } from "../../shared/js/core/ui-metrics.js?v=v2026-11-09T12154";

// Dotyk: bez przeciągania (page-init.js), scalanie tylko przyciskiem.
const TOUCH = !!globalThis.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches;

const SAVE_DEBOUNCE_MS = 900;
const UNDO_LIMIT = 100;

function mk(tag, cls, html) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (html != null) el.innerHTML = html;
  return el;
}

function setPct(r, pct) {
  setProgress(r.bar, pct, 1);
}

/**
 * @param {object} cfg
 * @param {string} cfg.gameId
 * @param {{slots:()=>Map, reset:()=>void}} cfg.pollResults
 * @param {object} cfg.ui  { barEl, hintEl, toolsEl, saveEl, undoBtn, redoBtn,
 *                           onValidity(boolean), onError(message), onSaved() }
 */
export function createTally({ gameId, pollResults, ui }) {
  let mode = ""; // "" | "points" | "text"
  let model = []; // tekst: [{ question_id, ord, text, items:[{id,text,count}] }]
  let states = new Map(); // question_id -> { q, slot, rows: Map(itemId -> r), meta }

  let undo = [];
  let redo = [];
  let sig = 0;
  let dirty = false;
  let saveTimer = null;
  let savingChain = Promise.resolve();
  let drag = null; // { qid, id }
  let mergeSrc = null; // { qid, id } — tryb łączenia na dotyku
  let pointRows = [];
  let fullN = 0; // pełne ankiety bieżącego uruchomienia (mianownik udziałów)
  let glyphs = null; // czcionka Wyświetlacza -- czyszczenie poprawianych tekstów
  const pendingQuestionUpdates = new Map();

  async function loadSource() {
    const { data, error } = await sb().rpc("poll_tally_source", { p_game_id: gameId });
    if (error) throw error;
    fullN = Math.max(0, Number(data?.n) || 0);
    return data || { n: 0, questions: [] };
  }

  const isActive = () => !!mode;

  /* ---------- wspólne: meta pod tytułem pytania ---------- */

  function ensureMeta(slot, { withCounter, withMergeDup, qs }) {
    const box = slot.list.parentElement;
    let meta = box.querySelector(":scope > .tallyMeta");
    if (!meta) {
      meta = mk("div", "tallyMeta on tallyMetaInstant");
      meta.innerHTML = `
        <span class="tallyCounter"></span>
        <span class="tallyVotesTotal"></span>
        <span class="tallySum"></span>
          <button class="btn xs tcMergeDup" type="button">${icon("merge")}<span></span></button>
          <button class="btn xs tcTieBtn" type="button" hidden>${icon("tie-switch")}<span></span></button>
        <span class="tallyTieInfo" hidden></span>`;
      box.insertBefore(meta, slot.list);
    }
    meta.querySelector(".tallyCounter").hidden = !withCounter;
    const dup = meta.querySelector(".tcMergeDup");
    dup.hidden = !withMergeDup;
      dup.querySelector("span").textContent = t("polls.tally.mergeDup");
    dup.title = t("polls.tally.mergeDup"); // telefon: sama ikona
    dup.onclick = withMergeDup && qs ? () => mutate(qs, () => mergeDuplicates(qs.q)) : null;
    return meta;
  }

  function dropMeta(slot) {
    const meta = slot.list.parentElement.querySelector(":scope > .tallyMeta");
    meta?.remove();
  }

  /* ---------- ankieta punktowa ---------- */

  async function enterPoints(data) {
    const source = await loadSource();
    const fullVotes = new Map();
    for (const q of source.questions || []) for (const a of q.answers || []) fullVotes.set(a.id, Math.max(0, Number(a.votes) || 0));
    mode = "points";
    pointRows = [];
    ui.hintEl.textContent = t("polls.tally.hintPoints");
    ui.barEl.hidden = false;
    ui.toolsEl.hidden = true;
    const slots = pollResults.slots();

    for (const q of data.questions || []) {
      const slot = slots.get(q.id);
      if (!slot) continue;
      const answers = (q.answers || []).map((a) => ({ ...a, votes: fullVotes.get(a.id) ?? 0 }));
      const analysis = pointsPollAnalysis(answers.map((a) => a.votes), fullN);
      const meta = ensureMeta(slot, { withCounter: false, withMergeDup: false });
      let sum = 0;
      const totalVotes = fullN;
      slot.list.classList.add("tally", "tallyPoints");
      const ranked = answers.map((a, i) => ({
        ...a,
        _sourceIndex: i,
        fixed_points: analysis[i]?.skipped ? 0 : analysis[i]?.points,
      }));
      for (const a of sortAnswersByPoints(ranked)) {
        const i = a._sourceIndex;
        const result = analysis[i];
        const r = slot.rows.get(a.id);
        if (!r) continue;
        const votes = Math.max(0, Number(a.votes) || 0);
        let voteLabel = r.row.querySelector(".tallyVotes");
        if (!voteLabel) {
          voteLabel = mk("span", "tcCnt tallyVotes");
          r.val.before(voteLabel);
        }
        voteLabel.textContent = t("polls.tally.votesPercent", { n: votes, pct: result.percent });
        r.row.classList.add("tallyRow");
        r.row.classList.toggle("tallySkipped", result.skipped);
        r.row.title = result.skipped ? t("polls.tally.skippedTitle", { pct: result.percent }) : "";
        if (result.skipped) r.val.textContent = t("polls.results.pointsUnitCount", { n: "—" });
        else {
          sum += result.points;
          r.val.textContent = t("polls.results.pointsUnitCount", { n: result.points });
        }
        setPct(r, result.points);
        pointRows.push({ r, votes, totalVotes });
        slot.list.appendChild(r.row);
      }
      meta.querySelector(".tallySum").textContent = t("polls.tally.sum", { n: sum });
      meta.querySelector(".tallyVotesTotal").textContent = t("polls.tally.fullSubmissions", { n: fullN });
    }
    ui.onValidity(true);
  }

  function leavePoints() {
    for (const slot of pollResults.slots().values()) {
      slot.list.classList.remove("tally", "tallyPoints");
      slot.list.querySelectorAll(".tallyRow, .tallySkipped").forEach((el) => {
        el.classList.remove("tallyRow", "tallySkipped");
        el.removeAttribute("title");
      });
      slot.list.querySelectorAll(".tallyVotes").forEach((el) => el.remove());
      dropMeta(slot);
    }
    for (const { r, votes, totalVotes } of pointRows) {
      r.val.textContent = t("polls.results.votesUnitCount", { n: votes });
      setPct(r, totalVotes ? (100 * votes) / totalVotes : 0);
    }
    pointRows = [];
  }

  /* ---------- ankieta tekstowa: wczytanie ---------- */

  async function loadTextModel() {
    const source = await loadSource();
    let n = 1;
    let total = 0;
    const out = (source.questions || []).map((q) => {
      const items = (q.items || []).map((it) => {
        total += Math.max(0, Number(it.count) || 0);
        return { id: `i${n++}`, text: String(it.text ?? ""), count: Math.max(0, Math.floor(Number(it.count) || 0)) };
      }).sort((x, y) => y.count - x.count);
      return { question_id: q.question_id, ord: q.ord, items, selected: null, dropped: Number(q.dropped) || 0 };
    });
    return { model: out, sig: `${fullN}/${total}`, nextId: n };
  }

  // Szkic z bazy pasuje, gdy dotyczy tych samych pytań i tej samej liczby głosów
  // (po wznowieniu i nowych głosach stary szkic nie może ukryć nowych odpowiedzi).
  async function restoreDraft(loaded) {
    try {
      const { data, error } = await sb().rpc("poll_text_tally_draft_get", { p_game_id: gameId });
      if (error) throw error;
      const d = data?.draft;
      if (!d || d.sig !== loaded.sig || !Array.isArray(d.questions)) return false;
      const byQ = new Map(d.questions.map((q) => [q.question_id, q]));
      const next = [];
      for (const q of loaded.model) {
        const dq = byQ.get(q.question_id);
        if (!dq || !Array.isArray(dq.items)) return false;
        const items = dq.items
          .map((it) => ({ id: String(it.id), text: String(it.text ?? ""), count: Math.max(0, Math.floor(Number(it.count) || 0)) }))
          .filter((it) => it.id);
        const selected = Array.isArray(dq.selected) ? dq.selected.map((x) => String(x ?? "")) : null;
        next.push({ ...q, items, selected });
      }
      loaded.model.splice(0, loaded.model.length, ...next);
      let maxId = 0;
      for (const q of next) for (const it of q.items) maxId = Math.max(maxId, Number(String(it.id).replace(/\D/g, "")) || 0);
      loaded.nextId = Math.max(loaded.nextId, maxId + 1);
      return true;
    } catch (e) {
      console.warn("[poll-tally] draft_get failed", e);
      return false;
    }
  }

  async function enterText() {
    glyphs = await loadFont5x7().catch(() => null);
    const loaded = await loadTextModel();
    const restored = await restoreDraft(loaded);

    mode = "text";
    model = loaded.model;
    sig = loaded.sig;

    undo = [];
    redo = [];
    dirty = false;
    states = new Map();
    updateHistory();
    ui.hintEl.textContent = t(TOUCH ? "polls.tally.hintTextTouch" : "polls.tally.hintText");
    ui.barEl.hidden = false;
    ui.toolsEl.hidden = false;
    setSave("");

    const slots = pollResults.slots();
    for (const q of model) {
      const slot = slots.get(q.question_id);
      if (!slot) continue;
      q.items.sort((a, b) => b.count - a.count);
      const qs = { q, slot, rows: new Map(), itemById: new Map(q.items.map((item) => [item.id, item])), meta: null, valid: false };
      states.set(q.question_id, qs);
      slot.list.classList.add("tally", "tallyText");
      qs.meta = ensureMeta(slot, { withCounter: true, withMergeDup: true, qs });

      // Zachowaj widoczne wiersze; nowe dodaj jednym fragmentem DOM.
      const existingRows = new Map(slot.rows);
      slot.rows.clear();
      const taken = new Set();
      const fragment = document.createDocumentFragment();
      for (const it of q.items) {
        const key = it.text;
        const existing = !taken.has(key) ? existingRows.get(key) : null;
        let row = existing;
        if (existing) {
          taken.add(key);
        } else {
          row = makeResultRow(it.text);
          row.val.textContent = t("polls.results.votesUnitCount", { n: it.count });
          fragment.append(row.row);
        }
        decorate(qs, row, it);
        qs.rows.set(it.id, row);
      }
      slot.list.append(fragment);
      for (const [key, row] of existingRows) if (!taken.has(key)) row.row.remove();
      reorder(qs);
    }
    for (const qs of states.values()) updateQuestion(qs);
    validity();
    if (restored) ui.onNotice?.(t("polls.tally.restored"));
  }

  /* ---------- wiersz tekstowy ---------- */

  function decorate(qs, r, item) {
    const { row } = r;
    row.classList.add("tallyRow");
    row.dataset.itemId = item.id;

    const handle = mk("span", "tcHandle", icon("grip"));
    handle.draggable = !TOUCH; // dotyk: tylko przycisk scalania
    handle.title = t("polls.tally.dragHandle");
    handle.setAttribute("aria-label", t("polls.tally.dragHandle"));

    const inp = mk("input", "aTxtInp");
    inp.type = "text";
    inp.value = item.text;
    inp.setAttribute("aria-label", t("polls.tally.hintText"));

    const cnt = mk("span", "tcCnt");
    const mergeBtn = mk("button", "btn sm icon tcMergeBtn", icon("merge"));
    mergeBtn.type = "button";
    mergeBtn.setAttribute("aria-pressed", "false");
    mergeBtn.title = t("polls.tally.mergeWith");
    mergeBtn.setAttribute("aria-label", t("polls.tally.mergeWith"));
    const del = mk("button", "btn sm icon danger tcDel", icon("trash"));
    del.type = "button";
    del.title = t("polls.tally.remove");
    del.setAttribute("aria-label", t("polls.tally.remove"));
    const actions = mk("span", "tcActionGroup");
    actions.append(mergeBtn, del);

    r.txt = row.querySelector(".aTxt");
    r.inp = inp;
    r.cnt = cnt;
    r.handle = handle;
    r.itemId = item.id;
    row.insertBefore(handle, r.bar.nextSibling);
    r.txt.after(inp);
    row.insertBefore(cnt, r.val);
    row.append(actions);

    const findItem = () => qs.itemById.get(item.id);

    // edycja tekstu: punkty na żywo, jeden wpis w historii na całą edycję
    let editSnap = null;
    inp.addEventListener("focus", () => { editSnap = snapshot(); });
    inp.addEventListener("input", () => {
      const it = findItem();
      if (!it) return;
      const clipped = clipChars(inp.value, ANSWER_MAX);
      if (clipped !== inp.value) inp.value = clipped;
      it.text = inp.value;
      queueQuestionUpdate(qs);
      scheduleSave();
    });
    inp.addEventListener("blur", () => {
      flushQuestionUpdate(qs);
      if (editSnap && editSnap !== snapshot()) {
        undo.push(editSnap);
        if (undo.length > UNDO_LIMIT) undo.shift();
        redo = [];
        updateHistory();
      }
      editSnap = null;
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); inp.blur(); }
    });

    del.addEventListener("click", () => mutate(qs, () => {
      qs.q.items = qs.q.items.filter((x) => x.id !== item.id);
    }));

    // przeciąganie (komputer): uchwyt -> inny wiersz tego samego pytania
    handle.addEventListener("dragstart", (e) => {
      drag = { qid: qs.q.question_id, id: item.id };
      row.classList.add("dragging");
      try {
        e.dataTransfer.setData("text/plain", item.id);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setDragImage(row, 18, 19);
      } catch { /* starsze przeglądarki */ }
    });
    handle.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      drag = null;
      qs.slot.list.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
    });
    row.addEventListener("dragover", (e) => {
      if (!drag || drag.qid !== qs.q.question_id || drag.id === item.id) return;
      e.preventDefault();
      row.classList.add("drop-target");
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-target"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("drop-target");
      if (!drag || drag.qid !== qs.q.question_id || drag.id === item.id) return;
      const from = drag.id;
      drag = null;
      mutate(qs, () => mergeInto(qs.q, from, item.id));
    });

    // dotyk: „Połącz z…” — pierwszy dotyk wybiera źródło, drugi cel
    mergeBtn.addEventListener("click", () => {
      const qid = qs.q.question_id;
      if (mergeSrc && mergeSrc.qid === qid && mergeSrc.id === item.id) { clearMergeMode(); return; }
      if (mergeSrc && mergeSrc.qid === qid) {
        const from = mergeSrc.id;
        clearMergeMode();
        mutate(qs, () => mergeInto(qs.q, from, item.id));
        return;
      }
      clearMergeMode();
      mergeSrc = { qid, id: item.id };
      qs.slot.list.querySelectorAll(".aRow").forEach((el) => {
        const isSource = el.dataset.itemId === item.id;
        el.classList.toggle("merge-src", isSource);
        el.classList.toggle("merge-target", el.dataset.itemId !== item.id);
        el.querySelector(".tcMergeBtn")?.setAttribute("aria-pressed", String(isSource));
      });
    });
  }

  function clearMergeMode() {
    mergeSrc = null;
    for (const qs of states.values()) {
      qs.slot.list.querySelectorAll(".aRow").forEach((el) => {
        el.classList.remove("merge-src", "merge-target");
        el.querySelector(".tcMergeBtn")?.setAttribute("aria-pressed", "false");
      });
    }
  }

  /* ---------- operacje na modelu ---------- */

  function mergeInto(q, fromId, toId) {
    const from = q.items.find((x) => x.id === fromId);
    const to = q.items.find((x) => x.id === toId);
    if (!from || !to || from === to) return;
    to.count += from.count;
    q.items = q.items.filter((x) => x !== from);
  }

  function mergeDuplicates(q) {
    const seen = new Map();
    const out = [];
    for (const it of q.items) {
      const key = cleanAnswerText(it.text, glyphs).toUpperCase();
      if (!key) { out.push(it); continue; }
      const first = seen.get(key);
      if (first) first.count += it.count;
      else { seen.set(key, it); out.push(it); }
    }
    q.items = out;
  }

  function snapshot() {
    return JSON.stringify(model.map((q) => ({ question_id: q.question_id, items: q.items, selected: q.selected || null })));
  }

  function restoreSnapshot(json) {
    const arr = JSON.parse(json);
    for (const sq of arr) {
      const qs = states.get(sq.question_id);
      if (qs) { qs.q.items = sq.items; qs.q.selected = sq.selected || null; }
    }
    for (const qs of states.values()) {
      qs.q.items.sort((a, b) => b.count - a.count);
      sync(qs);
    }
    validity();
    scheduleSave();
  }

  function updateHistory() {
    if (ui.undoBtn) ui.undoBtn.disabled = undo.length === 0;
    if (ui.redoBtn) ui.redoBtn.disabled = redo.length === 0;
  }

  function undoAction() {
    if (mode !== "text" || !undo.length) return;
    redo.push(snapshot());
    restoreSnapshot(undo.pop());
    updateHistory();
  }

  function redoAction() {
    if (mode !== "text" || !redo.length) return;
    undo.push(snapshot());
    restoreSnapshot(redo.pop());
    updateHistory();
  }

  // Zmiana modelu: wpis do historii, nowy porządek (najwięcej głosów na górze),
  // płynne przestawienie wierszy, zapis szkicu.
  function mutate(qs, fn) {
    undo.push(snapshot());
    if (undo.length > UNDO_LIMIT) undo.shift();
    redo = [];
    fn();
    qs.q.items.sort((a, b) => b.count - a.count);
    sync(qs);
    updateHistory();
    validity();
    scheduleSave();
  }

  /* ---------- DOM wierszy: synchronizacja, kolejność, wartości ---------- */

  function reorder(qs) {
    const list = qs.slot.list;
    const want = qs.q.items.map((it) => qs.rows.get(it.id)?.row).filter(Boolean);
    const have = [...list.children].filter((el) => el.classList.contains("aRow"));
    if (want.length === have.length && want.every((el, i) => el === have[i])) return;

    const fragment = document.createDocumentFragment();
    for (const el of want) fragment.appendChild(el);
    list.appendChild(fragment);
  }

  function sync(qs) {
    qs.itemById = new Map(qs.q.items.map((item) => [item.id, item]));
    const ids = new Set(qs.q.items.map((it) => it.id));
    for (const [id, r] of [...qs.rows]) {
      if (ids.has(id)) continue;
      qs.rows.delete(id);
      r.row.remove();
    }
    for (const it of qs.q.items) {
      if (qs.rows.has(it.id)) continue;
      const r = makeResultRow(it.text);
      r.val.textContent = t("polls.results.votesUnitCount", { n: it.count });
      decorate(qs, r, it);
      qs.rows.set(it.id, r);
    }
    reorder(qs);
    updateQuestion(qs);
  }

  function queueQuestionUpdate(qs) {
    cancelAnimationFrame(pendingQuestionUpdates.get(qs));
    pendingQuestionUpdates.set(qs, requestAnimationFrame(() => {
      pendingQuestionUpdates.delete(qs);
      if (mode === "text" && states.get(qs.q.question_id) === qs) {
        updateQuestion(qs);
        validity();
      }
    }));
  }

  function flushQuestionUpdate(qs) {
    cancelAnimationFrame(pendingQuestionUpdates.get(qs));
    pendingQuestionUpdates.delete(qs);
    if (mode === "text" && states.get(qs.q.question_id) === qs) {
      updateQuestion(qs);
      validity();
    }
  }

  function updateQuestion(qs) {
    const items = qs.q.items;
    const analysis = textTallyAnalysis(items.map((it) => ({ text: it.text, count: it.count })), {
      total: fullN, glyphs, selected: qs.q.selected,
    });
    qs.analysis = analysis;
    const byKey = new Map(analysis.rows.map((row, rank) => [row.key, { row, rank }]));
    const shown = new Set(); // pierwszy wiersz grupy pokazuje wynik, kolejne łączą się z nim
    let sum = 0;
    const order = [];
    items.forEach((it) => {
      const r = qs.rows.get(it.id);
      if (!r) return;
      const key = cleanAnswerText(it.text, glyphs).toUpperCase();
      const hit = key ? byKey.get(key) : null;
      const first = !!hit && !shown.has(key);
      if (first) shown.add(key);
      const result = first ? hit.row : null;
      const included = !!result?.selected;
      if (included) sum += result.percent;
      r.row.classList.toggle("out", !included);
      r.row.classList.toggle("tallySkipped", !!result && !result.qualifies);
      r.row.classList.toggle("tallyTie", !!result?.inTie);
      r.val.textContent = t("polls.results.pointsUnitCount", { n: included ? result.percent : "—" });
      setPct(r, included ? result.percent : 0);
      r.cnt.textContent = t("polls.tally.votesPercent", { n: it.count, pct: result ? result.percent : 0 });
      r.row.title = !key ? t("polls.tally.emptyAfterClean")
        : !first ? t("polls.tally.duplicateTitle")
        : result && !result.qualifies ? t("polls.tally.skippedTitle", { pct: result.percent }) : "";
      if (r.inp.value !== it.text && document.activeElement !== r.inp) r.inp.value = it.text;
      order.push({ row: r.row, rank: first ? hit.rank : Number.MAX_SAFE_INTEGER, included });
    });
    const n = analysis.selectedKeys.length;
    qs.valid = analysis.valid;
    const counter = qs.meta.querySelector(".tallyCounter");
    counter.textContent = t("polls.tally.counter", { n });
    counter.classList.toggle("invalid", !analysis.valid);
    qs.meta.querySelector(".tallySum").textContent = t("polls.tally.sum", { n: sum });
    const dropped = qs.q.dropped ? " " + t("polls.tally.dropped", { n: qs.q.dropped }) : "";
    qs.meta.querySelector(".tallyVotesTotal").textContent = t("polls.tally.fullSubmissions", { n: fullN }) + dropped;
    qs.meta.querySelector(".tcMergeDup span").textContent = t("polls.tally.mergeDup");

    // remis głosów na granicy szóstki: jawny, cykliczny wybór
    const tieBtn = qs.meta.querySelector(".tcTieBtn");
    const tieInfo = qs.meta.querySelector(".tallyTieInfo");
    tieBtn.hidden = !analysis.tie;
    tieInfo.hidden = !analysis.tie && !qs.q.selected;
    if (analysis.tie) {
      const textOf = (k) => byKey.get(k)?.row.text || k;
      const inKeys = analysis.tie.keys.filter((k) => analysis.selectedKeys.includes(k));
      const outKeys = analysis.tie.keys.filter((k) => !analysis.selectedKeys.includes(k));
      tieBtn.querySelector("span").textContent = t("polls.tally.tieSwitch");
      tieBtn.title = t("polls.tally.tieSwitch");
      tieBtn.onclick = () => mutate(qs, () => { qs.q.selected = nextTieSelection(qs.analysis); });
      tieInfo.textContent = t("polls.tally.tieInfo", { in: inKeys.map(textOf).join(", "), out: outKeys.map(textOf).join(", ") });
    } else if (qs.q.selected) {
      // poprzedni wybór z remisu przestał obowiązywać po scaleniu / zmianie głosów
      tieInfo.textContent = t("polls.tally.tieGone");
    }

    order.sort((x, y) => (x.included === y.included ? 0 : x.included ? -1 : 1) || x.rank - y.rank);
    for (const { row } of order) qs.slot.list.appendChild(row);
  }

  function textValid() {
    return states.size > 0 && [...states.values()].every((qs) => qs.valid);
  }

  function validity() {
    ui.onValidity(mode === "points" ? true : textValid());
  }

  /* ---------- szkic w bazie ---------- */

  function setSave(state) {
    if (!ui.saveEl) return;
    ui.saveEl.dataset.state = state || "";
    ui.saveEl.textContent = state === "saving" ? t("polls.tally.saving")
      : state === "failed" ? t("polls.tally.saveFailed") : "";
  }

  function draftPayload() {
    return {
      v: 1,
      sig,
      questions: model.map((q) => ({
        question_id: q.question_id,
        items: q.items.map((it) => ({ id: it.id, text: it.text, count: it.count })),
        selected: q.selected || null,
      })),
    };
  }

  function scheduleSave() {
    if (mode !== "text") return;
    dirty = true;
    setSave("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void saveDraft(); }, SAVE_DEBOUNCE_MS);
  }

  function saveDraft() {
    clearTimeout(saveTimer);
    if (mode !== "text" || !dirty) return savingChain;
    const payload = draftPayload();
    dirty = false;
    savingChain = savingChain.then(async () => {
      try {
        const { error } = await sb().rpc("poll_text_tally_draft_save", { p_game_id: gameId, p_draft: payload });
        if (error) throw error;
        if (!dirty) {
          setSave("");
          ui.onSaved?.(t("polls.tally.saved"));
        }
      } catch (e) {
        console.warn("[poll-tally] draft_save failed", e);
        dirty = true;
        setSave("failed");
      }
    });
    return savingChain;
  }

  /* ---------- API ---------- */

  function cleanupDom() {
    clearMergeMode();
    clearTimeout(saveTimer);
    for (const frame of pendingQuestionUpdates.values()) cancelAnimationFrame(frame);
    pendingQuestionUpdates.clear();
    ui.barEl.hidden = true;
    mode = "";
    model = [];
    states = new Map();
    undo = [];
    redo = [];
    dirty = false;
    updateHistory();
    setSave("");
  }

  return {
    isActive,
    mode: () => mode,
    enterPoints,
    enterText,
    valid: () => (mode === "points" ? true : textValid()),
    undo: undoAction,
    redo: redoAction,
    flush: () => saveDraft(),
    textPayload: () => ({
      items: model.map((q) => ({
        question_id: q.question_id,
        answers: q.items.map((it) => ({ text: it.text, count: it.count })),
        selected: q.selected || null,
      })),
    }),
    // wyjście z podliczania: punktowa wraca animacją, tekstowa — po zapisie szkicu
    // — widokiem surowym (wywołujący przerysowuje wyniki)
    async leave() {
      if (mode === "points") {
        leavePoints();
      } else if (mode === "text") {
        await saveDraft();
      }
      const wasText = mode === "text";
      cleanupDom();
      if (wasText) pollResults.reset();
    },
    // po udanym zatwierdzeniu: tylko sprzątanie, wyniki przerysuje strona
    finish() {
      if (mode === "points") leavePoints();
      cleanupDom();
      pollResults.reset();
    },
    // zmiana języka w trakcie podliczania
    relabel() {
      if (mode === "points") {
        ui.hintEl.textContent = t("polls.tally.hintPoints");
      } else if (mode === "text") {
        ui.hintEl.textContent = t(TOUCH ? "polls.tally.hintTextTouch" : "polls.tally.hintText");
        for (const qs of states.values()) updateQuestion(qs);
      }
    },
  };
}
