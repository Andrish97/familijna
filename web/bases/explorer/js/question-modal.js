// base-explorer/js/question-modal.js
// Modal pytania w bazie pytań. open(input, { save }) zwraca Promise z
// wynikiem { ok, id, payload }.
//
// Limity, pole punktów, pasek sumy i walidacja są wspólne z edytorem gry
// (js/core/question-form.js). Różnice wynikają z miejsca: tu jest jeden
// "Zapisz" (więc błędy blokują zapis, zamiast zapisywać domyślne teksty jak
// autozapis edytora), liczba odpowiedzi 0–6 i punkty opcjonalne (pytanie w
// bazie nie ma jeszcze typu gry).

import { t } from "../../../shared/translation/translation.js?v=v2026-11-06T02112";
import { openDialog, closeDialog } from "../../../shared/js/core/modal-sheet.js?v=v2026-11-06T02112";
import { setMessage } from "../../../shared/js/core/toast.js?v=v2026-11-06T02112";
import { confirmModal } from "../../../shared/js/core/modal.js?v=v2026-11-06T02112";

import {
  LIMITS, normQuestionText, normAnswerText, wireTextLimit, wirePointsInput,
  sumPoints, renderSumPill, questionProblems, questionMessage,
  buildAnswerRow, buildAddAnswerTile, wireAnswerInput, buildAnswerHints, loadAnswerGlyphs,
} from "../../../shared/js/core/question-form.js?v=v2026-11-06T02112";

const $ = (id) => document.getElementById(id);

function setErr(msg) {
  setMessage($("qErr"), msg, "error");
}

// Kształt zapisywany w qb_questions.payload: numery odpowiedzi zawsze po
// kolei (wcześniej usunięcie ze środka i dodanie nowej dawało dwa razy ten
// sam numer), teksty bez spacji na brzegach, punkty tylko gdy wpisane.
function cleanPayload(draft) {
  return {
    text: normQuestionText(draft.text),
    answers: draft.answers.map((a, idx) => ({
      ord: idx + 1,
      text: normAnswerText(a.text),
      ...(a.fixed_points === undefined ? {} : { fixed_points: a.fixed_points }),
    })),
  };
}

export function initQuestionModal() {
  const overlay = $("questionOverlay");
  if (!overlay) return null;

  const qClose = $("qClose");
  const qSave = $("qSave");
  const qText = $("qText");
  const qAnswers = $("qAnswers");

  let current = null;      // { id, draft: { text, answers:[{text, fixed_points?}] }, initial, save }
  let resolveClose = null; // fn(result)
  let saving = false;

  const snapshot = () => JSON.stringify(cleanPayload(current.draft));

  function updateSumUI() {
    renderSumPill($("qSumPill"), sumPoints(current?.draft?.answers));
  }

  function addAnswer() {
    if (!current) return;
    const ans = current.draft.answers;
    if (ans.length >= LIMITS.AN_MAX) return;
    ans.push({ text: "" });
    renderAnswers();
    setErr("");
    qAnswers?.querySelector(".qf-row:last-child .qf-text")?.focus();
  }

  // Ten sam wiersz i kafelek co w edytorze gry (question-form.js)
  function answerRow(a, i) {
    const { row, iText: inpText, iPts: inpPts, bDel: btnDel } = buildAnswerRow({
      text: a.text || "",
      points: a.fixed_points,
      placeholder: t("baseExplorer.question.answerPlaceholder"),
      pointsPlaceholder: t("baseExplorer.question.pointsPlaceholder"),
    });

    // limit 17 i znaki Wyświetlacza -- jak w edytorze gry
    wireAnswerInput(inpText, (v) => { a.text = v; });
    // puste pole = brak punktów (w bazie pytań są opcjonalne)
    wirePointsInput(inpPts, (val) => {
      if (val === null) delete a.fixed_points;
      else a.fixed_points = val;
      updateSumUI();
    });

    btnDel.addEventListener("click", () => {
      current.draft.answers.splice(i, 1);
      renderAnswers();
    });
    return row;
  }

  function renderAnswers() {
    if (!qAnswers) return;
    qAnswers.innerHTML = "";
    const answers = current?.draft?.answers || [];
    const add = buildAddAnswerTile(answers.length);
    add.id = "qAdd";
    add.addEventListener("click", addAnswer);
    qAnswers.appendChild(buildAnswerHints()); // jak w edytorze gry: nad kafelkiem dodawania
    qAnswers.appendChild(add);
    answers.forEach((a, i) => qAnswers.appendChild(answerRow(a, i)));
    updateSumUI();
  }

  function open(input, { save = null } = {}) {
    setErr("");

    // bridge przekaże: { id, payload:{text,answers} }
    // ale wspieramy też: { id, text, answers }
    const src = (input?.payload && typeof input.payload === "object") ? input.payload : (input || {});
    const answers = Array.isArray(src.answers) ? src.answers : [];

    current = {
      id: input?.id ?? null,
      save,
      draft: {
        text: String(src.text || ""),
        answers: answers.map((a) => {
          const pts = Number(a?.fixed_points);
          return {
            text: String(a?.text || ""),
            ...(a?.fixed_points === undefined || a?.fixed_points === null || !Number.isFinite(pts) ? {} : { fixed_points: pts }),
          };
        }),
      },
    };
    current.initial = snapshot();

    if (qText) qText.value = current.draft.text;
    renderAnswers();
    openDialog(overlay, { onClose: () => requestClose() });
    setTimeout(() => qText?.focus(), 0);

    return new Promise((resolve) => {
      resolveClose = resolve;
    });
  }

  function close(result = { ok: false }) {
    closeDialog(overlay);
    setErr("");

    const r = resolveClose;
    resolveClose = null;
    current = null;
    saving = false;
    if (qSave) qSave.disabled = false;

    if (typeof r === "function") r(result);
  }

  // Zamknięcie bez zapisu: przy zmianach pytamy -- wcześniej klik obok
  // modalu po cichu wyrzucał wszystko, co wpisano.
  async function requestClose() {
    if (!current || saving) return;
    if (snapshot() !== current.initial) {
      const discard = await confirmModal({
        text: t("questionForm.confirmDiscard"),
        okText: t("questionForm.discard"),
        cancelText: t("questionForm.keepEditing"),
      });
      if (!discard) return;
    }
    close({ ok: false });
  }

  qClose?.addEventListener("click", requestClose);

  // maxlength w HTML nie działa przy programowym ustawieniu .value (np. wklejenie
  // przez skrypt) -- wireTextLimit pilnuje limitu w każdej ścieżce.
  wireTextLimit(qText, LIMITS.Q_TEXT, (v) => {
    if (current) current.draft.text = v;
  });

  qSave?.addEventListener("click", async () => {
    if (!current || saving) return;
    setErr("");

    const payload = cleanPayload(current.draft);
    await loadAnswerGlyphs(); // walidacja znaków odpowiedzi potrzebuje czcionki
    const problems = questionProblems(payload, "base");
    if (problems.length) return setErr(questionMessage(problems[0]));

    // Zapis przed zamknięciem: przy błędzie modal zostaje otwarty z
    // wpisaną treścią (wcześniej zamykał się od razu, a nieudany zapis
    // kasował całą edycję).
    if (current.save) {
      saving = true;
      qSave.disabled = true;
      try {
        await current.save(payload);
      } catch (e) {
        console.error(e);
        saving = false;
        qSave.disabled = false;
        return setErr(e?.userMessage || t("questionForm.saveFailed"));
      }
    }
    close({ ok: true, id: current.id, payload });
  });

  return { open, close };
}
