// Wyniki ankiety (RPC get_poll_preview) — wspólne dla strony ankiety
// i podglądu na liście gier.
//
// Lista budowana raz; potem tylko liczby i szerokości pasków (przejście CSS).
// Gotowe odpowiedzi punktowane są pokazywane malejąco według punktów;
// otwarte wyniki zachowują kolejność źródłową albo pojawiania się wpisów.
import { t } from "../../translation/translation.js?v=v2026-11-14T12020";
import { sortAnswersByPoints } from "./answer-order.js?v=v2026-11-14T12020";
import { setProgress } from "./ui-metrics.js?v=v2026-11-14T12020";


// poll_stopped: te same surowe wiersze co na żywo (głosy już się nie zmieniają)
function resultsMode(status, type) {
  if (status === "draft") return "draft";
  if (status === "ready") return "final";
  return type === "poll_points" ? "points" : "text";
}

export function makeResultRow(text) {
  const row = document.createElement("div");
  row.className = "aRow";
  row.innerHTML = `<div class="aBar"></div><div class="aTxt"></div><div class="aVal">0</div>`;
  row.querySelector(".aTxt").textContent = text;
  return { row, bar: row.querySelector(".aBar"), val: row.querySelector(".aVal") };
}

export function setRowValue(r, value, pct, unitKey = "polls.results.votesUnitCount") {
  const next = t(unitKey, { n: value });
  if (r.val.textContent !== next) r.val.textContent = next;
  setProgress(r.bar, pct, 1);
}

// Zwraca { render(data) -> tekst meta, reset(), slots() }.
// slots() = Map(id pytania -> { list, rows }) bieżącego widoku: na tych samych
// wierszach strona ankiety robi płynne przejście do podliczania (poll-tally.js).
export function createPollResults(listEl) {
  // resDom = { mode, sig, byQ: Map(qid -> { list, rows: Map(key -> { row, bar, val }) }) }
  let resDom = null;
  const textOrder = new Map(); // qid -> [klucze w kolejności pojawienia się]

  function reset() {
    resDom = null;
    textOrder.clear();
    if (listEl) listEl.innerHTML = "";
  }

  function buildDom(mode, questions) {
    listEl.innerHTML = "";
    const byQ = new Map();
    for (const q of questions) {
      const box = document.createElement("div");
      box.className = "resultQ";
      const title = document.createElement("div");
      title.className = "qTitle";
      title.textContent = `P${q.ord}: ${q.text}`;
      box.appendChild(title);

      const list = document.createElement("div");
      list.className = "aList";
      box.appendChild(list);
      listEl.appendChild(box);

      const rows = new Map();
      if (mode === "points" || mode === "final") {
        const answers = mode === "final" ? sortAnswersByPoints(q.answers) : (q.answers || []);
        for (const a of answers) {
          const r = makeResultRow(a.text);
          list.appendChild(r.row);
          rows.set(a.id, r);
        }
      }
      byQ.set(q.id, { list, rows });
    }
    return byQ;
  }

  function renderTextRows(q, slot) {
    const rows = q.text_rows || [];
    const incoming = new Map(rows.map((r) => [String(r.text), Number(r.val) || 0]));
    const total = rows.reduce((s, r) => s + (Number(r.val) || 0), 0);

    let order = textOrder.get(q.id);
    if (!order) { order = []; textOrder.set(q.id, order); }

    // nowe — na koniec, w kolejności od najczęstszych
    for (const r of rows) {
      const key = String(r.text);
      if (!order.includes(key)) {
        order.push(key);
        const row = makeResultRow(key);
        slot.list.appendChild(row.row);
        slot.rows.set(key, row);
      }
    }

    // zniknęły z listy (poza TOP 12) — usuń, reszta zostaje na miejscu
    for (let i = order.length - 1; i >= 0; i--) {
      const key = order[i];
      if (!incoming.has(key)) {
        slot.rows.get(key)?.row.remove();
        slot.rows.delete(key);
        order.splice(i, 1);
      }
    }

    for (const key of order) {
      const r = slot.rows.get(key);
      const v = incoming.get(key) || 0;
      if (r) setRowValue(r, v, total ? (100 * v) / total : 0, "polls.results.votesUnitCount");
    }
  }

  // data = odpowiedź get_poll_preview; zwraca tekst do linii meta
  function render(data) {
    if (!listEl) return "";
    const { status, type } = data;
    const questions = data.questions || [];
    const mode = resultsMode(status, type);

    const sig = [
      mode,
      ...questions.map((q) =>
        mode === "points" || mode === "final"
          ? `${q.id}:${(q.answers || []).map((a) => a.id).join("|")}`
          : String(q.id)
      ),
    ].join(";");

    if (!resDom || resDom.sig !== sig) {
      resDom = { mode, sig, byQ: buildDom(mode, questions) };
    }

    if (mode === "draft") return questions.length ? "" : t("polls.results.noQuestions");

    for (const q of questions) {
      const slot = resDom.byQ.get(q.id);
      if (!slot) continue;

      if (mode === "final") {
        for (const a of q.answers || []) {
          const r = slot.rows.get(a.id);
          if (r) {
            const points = Number(a.fixed_points) || 0;
            setRowValue(r, points, points, "polls.results.pointsUnitCount");
            r.row.classList.toggle("tallySkipped", points === 0);
          }
        }
      } else if (mode === "points") {
        const answers = q.answers || [];
        const total = answers.reduce((s, a) => s + (Number(a.votes) || 0), 0);
        for (const a of answers) {
          const r = slot.rows.get(a.id);
          const v = Number(a.votes) || 0;
          if (r) setRowValue(r, v, total ? (100 * v) / total : 0, "polls.results.votesUnitCount");
        }
      } else {
        renderTextRows(q, slot);
      }
    }

    return mode === "final" ? t("polls.results.final") : "";
  }

  return { render, reset, slots: () => (resDom ? resDom.byQ : new Map()), mode: () => (resDom ? resDom.mode : "") };
}
