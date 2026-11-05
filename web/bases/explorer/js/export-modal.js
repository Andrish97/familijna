// /base-explorerjs/export-modal.js
// Modal eksportu: open() zwraca Promise z wynikiem {ok, payload}

import { t } from "../../../shared/translation/translation.js?v=v2026-11-05T18153";
import { TYPES as GAME_TYPES, evaluateReadiness, readinessText } from "../../../shared/js/core/game-validate.js?v=v2026-11-05T18153";
import { openDialog, closeDialog } from "../../../shared/js/core/modal-sheet.js?v=v2026-11-05T18153";
import { setMessage } from "../../../shared/js/core/toast.js?v=v2026-11-05T18153";
import { iconText } from "../../../shared/js/core/icons.js?v=v2026-11-05T18153";
import { setProgress as setBar, ratioPct } from "../../../shared/js/core/ui-metrics.js?v=v2026-11-05T18153";

// Kolejność = pozycje suwaka typu w UI (0/1/2, patrz typeIndex). GAME_TYPES
// to obiekt nazwa->wartość, nie tablica, więc kolejność zostaje jawna tutaj
// -- ale WARTOŚCI biorą z kanonicznego źródła (game-validate.js), nie z
// osobno wpisanych literałów, które mogłyby z czasem rozjechać się od
// reguł używanych gdzie indziej (gotowość: evaluateReadiness z game-rules.js).
const TYPES = [GAME_TYPES.POLL_TEXT, GAME_TYPES.POLL_POINTS, GAME_TYPES.PREPARED];

const $ = (id) => document.getElementById(id);

function setErr(msg) {
  setMessage($("xErr"), msg, "error");
}

function n(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function sumPoints(answers) {
  let s = 0;
  for (const a of answers || []) s += n(a.fixed_points);
  return s;
}

function qText(q) {
  return String(q?.text ?? q?.payload?.text ?? "").trim();
}

function qAnswers(q) {
  const a = (q && typeof q === "object") ? (q.answers ?? q.payload?.answers) : null;
  return Array.isArray(a) ? a : [];
}

function buildExportPayload({ name, type, questions }) {
  const normQText = (q) => String(q?.text ?? q?.payload?.text ?? "").trim();
  const normAns = (q) => {
    const a = q?.answers ?? q?.payload?.answers;
    return Array.isArray(a) ? a : [];
  };

  // Pakiet v2 wspólnego kontraktu transferu (game-transfer-format.js): szkic
  // wybranego typu; limity i normalizację stosuje baza przy zapisie.
  return {
    format_version: 2,
    game: { name: name || t("baseExplorer.export.defaultGameName"), type, state: "draft" },
    questions: (questions || []).map((q) => {
      const text = normQText(q);

      // 1) poll_text: obcinamy do gołych pytań
      if (type === "poll_text") {
        return { text, answers: [] };
      }

      // 2) poll_points: zostawiamy odpowiedzi, ale punkty zawsze 0
      if (type === "poll_points") {
        const answers = normAns(q).map((a) => ({
          text: String(a?.text ?? "").trim(),
          fixed_points: 0,
        }));
        return { text, answers };
      }

      // 3) prepared: zostawiamy wszystko (tekst + punkty)
      //    (z zachowaniem Twojego formatu: text + answers[])
      const answers = normAns(q).map((a) => {
        const out = { text: String(a?.text ?? "").trim() };
        if (a && Object.prototype.hasOwnProperty.call(a, "fixed_points")) {
          // zachowujemy wartości z bazy (mogą być liczbą lub 0)
          out.fixed_points = n(a.fixed_points);
        }
        return out;
      });

      return { text, answers };
    }),
  };
}

export function initExportModal() {
  const overlay = $("exportOverlay");
  if (!overlay) return null;

  const xClose = $("xClose");
  const xCreate = $("xCreate");
  const xName = $("xName");
  const xList = $("xList");
  const xTypeRange = $("xTypeRange");
  const xTypeHint = $("xTypeHint");
  const xCountVal = $("xCountVal");
  const xSummary = $("xSummary");

  const xProg = $("xProg");
  const xProgStep = $("xProgStep");
  const xProgCount = $("xProgCount");
  const xProgBarFill = $("xProgBarFill");
  const xProgMsg = $("xProgMsg");

  let running = false;
  let lastOpts = null; // zapamiętujemy opts z open()

  const lbl0 = $("lbl0");
  const lbl1 = $("lbl1");
  const lbl2 = $("lbl2");

  let selectedIds = new Set();
  let typeIndex = 2;
  let allQuestions = [];

  let resolveClose = null;

  function updateTypeUI() {
    const type = TYPES[typeIndex] || GAME_TYPES.PREPARED;
    if (xTypeHint) {
      if (type === "poll_text") xTypeHint.textContent = t("baseExplorer.export.typeHintPollText");
      if (type === "poll_points") xTypeHint.textContent = t("baseExplorer.export.typeHintPollPoints");
      if (type === "prepared") xTypeHint.textContent = t("baseExplorer.export.typeHintPrepared");
    }
    for (const el of [lbl0, lbl1, lbl2]) el?.classList.remove("active");
    (typeIndex === 0 ? lbl0 : typeIndex === 1 ? lbl1 : lbl2)?.classList.add("active");
    renderList();
  }

  // E21 (plan §2): zaznaczenie to dokładny zestaw pytań nowej gry. Typ nie
  // filtruje ani nie blokuje -- braki (ten sam silnik co gra: game-rules.js)
  // są informacją, czego zabraknie do gotowości. „Utwórz” jest wyłączone
  // tylko w trakcie zapisu.
  const picked = () => allQuestions.filter((q) => selectedIds.has(q.id));
  const asGameQuestion = (q) => ({ answers: qAnswers(q) });

  function questionIssue(q, type) {
    const issue = evaluateReadiness(type, [asGameQuestion(q)]).issues.find((i) => i.code !== "minQuestions");
    return issue || null;
  }

  function renderSummary(type) {
    if (!xSummary) return;
    const res = evaluateReadiness(type, picked().map(asGameQuestion));
    const issues = res.issues.slice(0, 4).map(readinessText);
    if (res.issues.length > 4) issues.push(t("baseExplorer.export.summaryMore", { count: res.issues.length - 4 }));
    xSummary.textContent = res.ok ? t("baseExplorer.export.summaryReady") : t("baseExplorer.export.summaryMissing", { list: issues.join(" ") });
    xSummary.classList.toggle("is-ready", res.ok);
  }

  function updateCountUI() {
    const c = selectedIds.size;
    if (xCountVal) xCountVal.textContent = String(c);
    if (xCreate) xCreate.disabled = running;
    renderSummary(TYPES[typeIndex] || GAME_TYPES.PREPARED);
  }

  function metaText(q, type) {
    const answers = qAnswers(q);
    const an = answers.length;

    if (type === "poll_text") {
      return an
        ? t("baseExplorer.export.answersCount", { count: an })
        : t("baseExplorer.export.noAnswers");
    }
    if (type === "poll_points") return t("baseExplorer.export.answersCount", { count: an });

    const s = sumPoints(answers);
    return t("baseExplorer.export.preparedSummary", { count: an, sum: s });
  }

  // Lista porcjami: pierwsze pozycje od razu, reszta w kolejnych klatkach
  // (baza ma czasem dziesiątki tysięcy pytań); nowe rysowanie (zmiana typu)
  // przerywa poprzednie. Kliknięcia przez jedną obsługę na liście.
  const FIRST_CHUNK = 300;
  const NEXT_CHUNK = 1000;
  let renderToken = 0;

  function rowHtml(q, type) {
    const issue = questionIssue(q, type);
    const label = qText(q) || t("baseExplorer.common.dash");
    // powód braku bez numeru pytania (numer zależy od zaznaczenia)
    const why = issue ? t(`baseExplorer.export.issue.${issue.code}`, issue.params) : "";
    return `<label class="xPickItem ${issue ? "bad" : "ok"}" data-qid="${escapeHtml(q.id)}"${why ? ` title="${escapeHtml(why)}"` : ""}>
      <input type="checkbox" ${selectedIds.has(q.id) ? "checked" : ""}/>
      <div class="xNm">${escapeHtml(label)}</div>
      <div class="xMeta">${metaText(q, type)}${why ? ` • ${escapeHtml(why)}` : ""}</div>
    </label>`;
  }

  function renderList() {
    if (!xList) return;
    const token = ++renderToken;
    const type = TYPES[typeIndex] || GAME_TYPES.PREPARED;
    const chunk = (from, to) => allQuestions.slice(from, to).map((q) => rowHtml(q, type)).join("");
    xList.innerHTML = chunk(0, FIRST_CHUNK);
    let next = FIRST_CHUNK;
    const more = () => {
      if (token !== renderToken || next >= allQuestions.length) return;
      xList.insertAdjacentHTML("beforeend", chunk(next, next + NEXT_CHUNK));
      next += NEXT_CHUNK;
      requestAnimationFrame(more);
    };
    requestAnimationFrame(more);
    updateCountUI();
  }

  xList?.addEventListener("click", (e) => {
    const row = e.target.closest(".xPickItem[data-qid]");
    if (!row || running) return;
    const qid = row.dataset.qid;
    const cb = row.querySelector("input");
    // stan z selectedIds (źródło prawdy), nie z pola: label + checkbox
    // dawałyby podwójne przełączenie
    const will = !selectedIds.has(qid);
    if (will) selectedIds.add(qid);
    else selectedIds.delete(qid);
    if (cb) cb.checked = will;
    // label nie wysyła drugiego, syntetycznego kliknięcia do pola
    if (e.target !== cb) e.preventDefault();
    updateCountUI();
  });

  function showProgress(on) {
    if (xProg) xProg.hidden = !on;
  }

  function setProgress({ step, i, n, msg, isError, done } = {}) {
    if (xProgStep && step != null) {
      if (isError || done) xProgStep.innerHTML = iconText(isError ? "error" : "check", String(step));
      else xProgStep.textContent = String(step);
    }
    if (xProgCount) xProgCount.textContent = `${Number(i || 0)}/${Number(n || 0)}`;

    setBar(xProgBarFill, ratioPct(i, n));

    if (xProgMsg) {
      xProgMsg.textContent = msg || "";
      xProgMsg.dataset.kind = isError ? "error" : "";
    }
  }

  function lockUi(on) {
    running = !!on;
    overlay?.querySelector?.(".export-modal")?.classList.toggle("is-running", running);

    if (xClose) xClose.disabled = running;
    if (xCreate) xCreate.disabled = running;
  }

  function close(result = { ok: false }) {
    renderToken += 1; // przerwij dorysowywanie listy
    closeDialog(overlay);
    setErr("");

    const r = resolveClose;
    resolveClose = null;

    if (typeof r === "function") r(result);
  }

  function open(opts = {}) {
    setErr("");

    lastOpts = opts || null;

    showProgress(false);
    setProgress({ step: t("baseExplorer.common.dash"), i: 0, n: 0, msg: "" });
    lockUi(false);

    // Lista okna = dokładnie to, co użytkownik zaznaczył (pytania/foldery
    // rozwinięte do pytań), wszystko wybrane; w oknie można tylko odznaczać.
    // Bez dobierania i bez progu 10.
    allQuestions = Array.isArray(opts.questions) ? opts.questions.slice() : [];
    selectedIds = new Set(allQuestions.map((q) => q.id));

    // typ startowy z suwaka (0 = ankieta tekstowa to poprawna wartość), opts.type nadpisuje
    const rangeIdx = Number.parseInt(xTypeRange?.value ?? "2", 10);
    typeIndex = TYPES[rangeIdx] ? rangeIdx : 2;
    if (opts.type) {
      const idx = TYPES.indexOf(opts.type);
      if (idx >= 0) {
        typeIndex = idx;
        if (xTypeRange) xTypeRange.value = String(idx);
      }
    }

    // Domyślna nazwa gry: nazwa folderu, gdy caller ją poda (tworzenie
    // gry "z folderu" -- patrz commands.js), w
    // pozostałych przypadkach zwykły domyślny placeholder.
    if (xName) xName.value = opts.defaultName || t("baseExplorer.export.defaultGameName");

    renderList();
    updateTypeUI();

    openDialog(overlay, { onClose: () => close({ ok: false }) });
    setTimeout(() => xName?.focus(), 0);

    return new Promise((resolve) => {
      resolveClose = resolve;
    });
  }

  xClose?.addEventListener("click", () => {
    if (running) return;
    close({ ok: false });
  });

  xTypeRange?.addEventListener("input", () => {
    const idx = Number.parseInt(xTypeRange.value, 10);
    typeIndex = TYPES[idx] ? idx : 2;
    updateTypeUI();
  });

  lbl0?.addEventListener("click", () => { typeIndex = 0; if (xTypeRange) xTypeRange.value = "0"; updateTypeUI(); });
  lbl1?.addEventListener("click", () => { typeIndex = 1; if (xTypeRange) xTypeRange.value = "1"; updateTypeUI(); });
  lbl2?.addEventListener("click", () => { typeIndex = 2; if (xTypeRange) xTypeRange.value = "2"; updateTypeUI(); });

  xCreate?.addEventListener("click", async () => {
    setErr("");

    const payload = buildExportPayload({
      name: String(xName?.value || t("baseExplorer.export.defaultGameName")),
      type: TYPES[typeIndex] || GAME_TYPES.PREPARED,
      questions: picked(),
    });

    // Tryb B: jeśli caller dał runnera, robimy progres w tym samym modalu
    const run = lastOpts?.run;
    if (typeof run === "function") {
      try {
        lockUi(true);
        showProgress(true);

        // “sensowne liczenie”: w eksportowaniu zwykle liczymy pytania
        const n = payload?.questions?.length || 0;
        setProgress({ step: t("baseExplorer.export.progress.exporting"), i: 0, n: n || 1, msg: "" });

        const res = await run(payload, (p) => setProgress(p));

        setProgress({
          step: t("baseExplorer.export.progress.done"),
          done: true,
          i: n || 1,
          n: n || 1,
          msg: t("baseExplorer.export.progress.created"),
        });

        // zamykamy modal dopiero na końcu
        close({ ok: true, payload, result: res });
      } catch (e) {
        console.error(e);
        setProgress({
          step: t("baseExplorer.export.progress.error"),
          i: 0,
          n: payload?.questions?.length || 1,
          msg: t("baseExplorer.export.progress.errorDetail", { error: e?.message || String(e) }),
          isError: true,
        });
        setErr(t("baseExplorer.export.errors.createFailed"));
        lockUi(false); // zostaw modal otwarty
      }
      return;
    }

    // fallback (stare zachowanie): zamknij i zwróć payload
    close({ ok: true, payload });
  });

  return { open, close };
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
