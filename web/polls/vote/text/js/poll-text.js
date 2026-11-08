// js/pages/poll-text.js
import { sb } from "../../../../shared/js/core/supabase.js?v=v2026-11-08T09471";
import { getUser } from "../../../../shared/js/core/auth.js?v=v2026-11-08T09471";
import { initI18n, t, withLangParam } from "../../../../shared/translation/translation.js?v=v2026-11-08T09471";
import { createPollVoteView, createPollVoteSession } from "../../../../shared/js/core/poll-vote-session.js?v=v2026-11-08T09471";
import { showPollSubmitRetry } from "../../../../shared/js/core/poll-submit-retry.js?v=v2026-11-08T09471";
import { ANSWER_MAX, clipChars, charLength, nfc } from "../../../../shared/js/core/answer-text.js?v=v2026-11-08T09471";
import { initEntryPage } from "../../../../shared/js/core/page-init.js?v=v2026-11-08T09471";

// Podręcznik w nowej karcie (wpisane odpowiedzi zostają), bez ?ret= — adres niesie klucz ankiety.
const i18nReady = initEntryPage("pollVoteText", { ready: initI18n({ withSwitcher: true }) }).then(() => {
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
});

const MSG = {
  thanks: () => t("pollText.thanks"),
  loadTimeout: () => t("pollText.loadTimeout"),
  enterAnswer: () => t("pollText.enterAnswer"),
  taskInvalid: () => t("pollText.taskInvalid"),
  loginToVote: () => t("pollText.loginToVote"),
  emailRequired: () => t("pollText.emailRequired"),
  openTaskFail: () => t("pollText.openTaskFail"),
  pollFallback: () => t("pollText.pollFallback"),
  pollClosed: () => t("pollText.pollClosed"),
  pollStopped: () => t("pollText.pollStopped"),
  pollEnded: () => t("pollText.pollEnded"),
  sending: () => t("pollText.sending"),
  error: (err) => t("pollText.error", { error: err }),
  questionProgress: (current, total) => t("pollText.questionProgress", { current, total }),
  beforeUnloadWarn: () => t("pollText.beforeUnloadWarn"),
  missingParams: () => t("pollText.missingParams"),
  alreadyVoted: () => t("pollText.alreadyVoted"),
  linkExpired: () => t("pollText.linkExpired"),
  pollNotFound: () => t("pollText.pollNotFound"),
  inviteDone: () => t("pollText.inviteDone"),
  inviteDeclined: () => t("pollText.inviteDeclined"),
  inviteExpired: () => t("pollText.inviteExpired"),
  loading: () => t("pollText.loading"),
  wrongType: () => t("pollText.wrongType"),
  openPollFail: (err) => t("pollText.openPollFail", { error: err }),
};

const qs = new URLSearchParams(location.search);
let gameId = qs.get("id");
let key = qs.get("key");
const taskToken = qs.get("t"); // <- opcjonalnie (tylko dla zadań z poll_go)

const $ = (id) => document.getElementById(id);

const titleEl = $("title");
const subEl = $("sub");

const qbox = $("qbox");
const qtext = $("qtext");
const prog = $("prog");
const closed = $("closed");

const answerInput = $("answerInput");
const btnSend = $("btnSend");
const countEl = $("count");

let submitting = false;

// lokalny bufor odpowiedzi (wysyłka dopiero na końcu)
let outbox = [];

let taskResolved = !taskToken;
const voteView = createPollVoteView({ qbox, closed, subEl, messages: MSG, getUser, withLangParam });
const { setSub, setClosedMsg, showClosed, showStatus, showFinished } = voteView;
const { describeLinkState, loadPayload, submitBatch, resolveTaskToken, markTaskDone, maybeReturnToHub } = createPollVoteSession({
  type: "text", getClient: sb, messages: MSG, view: voteView, getUser,
  readContext: () => ({ gameId, key, taskToken }),
  resolveContext: data => { gameId = data.game_id; key = data.key; taskResolved = true; },
});

// normalizacja do porównań
function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function validateAndPack(questionId, rawText) {
  // 17 pełnych znaków jak w bazie; znaki spoza czcionki Wyświetlacza przyjmujemy
  // (usuwa je podliczanie -- podpowiedź uprzedza głosującego)
  const raw = clipChars(nfc(rawText).trim(), ANSWER_MAX).trim();
  const normalized = norm(raw);

  if (!raw || !normalized) throw new Error(MSG.enterAnswer());

  return {
    question_id: questionId,
    answer_raw: raw,
    answer_norm: normalized,
  };
}

let retryAt = 0;
let stopRetry = null;

let payload = null;
let idx = 0;

function render() {
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  const game = payload?.game || {};
  const questions = payload?.questions || [];
  const q = questions[idx];

  if (titleEl) titleEl.textContent = game.name || MSG.pollFallback();

  // status
  if (game.status !== "poll_open") {
    showClosed(true);
    setSub("");
    setClosedMsg(game.status === "poll_stopped" ? MSG.pollStopped() : game.status === "ready" ? MSG.pollEnded() : MSG.pollClosed());
    return;
  }

  showClosed(false);

  if (!q) {
    // koniec pytań: wysyłka jednorazowa
    if (submitting || voteView.finished || Date.now() < retryAt) return;
    stopRetry?.(); stopRetry = null;

    submitting = true;
    if (btnSend) btnSend.disabled = true;
    if (answerInput) answerInput.disabled = true;

    setSub(MSG.sending());

    submitBatch(outbox)
      .then(async () => {
        await markTaskDone();
        showFinished();
        await maybeReturnToHub();
      })
      .catch(async (e) => {
        console.error("[poll-text] submit_batch error:", e);
        submitting = false;
        // ankieta mogła zostać zatrzymana / zakończona w trakcie odpowiadania
        const linkState = await describeLinkState();
        if (linkState) {
          showStatus(linkState);
          return;
        }
        retryAt = Date.now() + (e?.retryAfter || 0) * 1000;
        stopRetry = showPollSubmitRetry({ button: btnSend, container: document.getElementById("qbox"), seconds: e?.retryAfter || 0, setMessage: setSub, onRetry: render });
      });

    return;
  }

  if (qtext) qtext.textContent = q.text || t("common.dash");
  if (prog) prog.textContent = MSG.questionProgress(q.ord, questions.length);
  qbox?.classList.add("skel-step-ready");
  setSub(""); // zdejmujemy “Ładuję…”

  if (answerInput) {
    answerInput.disabled = false;
    answerInput.value = "";
    answerInput.focus();
  }
  if (btnSend) btnSend.disabled = false;
  if (countEl) countEl.textContent = "0/17";
}

window.addEventListener("i18n:lang", () => {
  if (payload) {
    render();
  } else if (!voteView.finished) {
    setSub(MSG.loading());
  }
});

function updateCount() {
  if (!answerInput || !countEl) return;
  countEl.textContent = `${charLength(answerInput.value)}/${ANSWER_MAX}`;
}

function setupBeforeUnloadWarn() {
  window.addEventListener("beforeunload", (e) => {
    if (voteView.finished) return;
    if (!outbox.length) return;
    // przeglądarki iOS/Chrome ignorują czasem własny tekst, ale sam alert działa
    e.preventDefault();
    e.returnValue = MSG.beforeUnloadWarn();
    return e.returnValue;
  });
}

window.addEventListener("pagehide", () => stopRetry?.(), { once: true });

document.addEventListener("DOMContentLoaded", async () => {
  try {
    // initI18n() robi dynamic import części słownika — bez tego czekania
    // t()/MSG.X() poniżej mogą wykonać się zanim translations się załaduje,
    // co dla elementów bez data-i18n (np. #closed) zwraca surowy klucz
    // (np. "pollText.alreadyVoted") zamiast tłumaczenia (patrz t() w
    // translation.js: value==null -> return key), a dla elementów z
    // data-i18n applyTranslations() później i tak nadpisze wcześniej
    // ustawiony programowo tekst błędu z powrotem na "Ładuję…".
    await i18nReady;
    if (taskToken) {
      await resolveTaskToken();
    }
    if (!taskResolved) return;
    if (!gameId || !key) {
      showStatus(MSG.missingParams());
      return;
    }
    // stan ankiety względem klucza z linku: zatrzymana / zakończona / link wygasł
    const linkState = await describeLinkState();
    if (linkState) {
      showStatus(linkState);
      return;
    }

    setupBeforeUnloadWarn();

    setSub(MSG.loading());
    showClosed(false);

    try {
      payload = await loadPayload();
    } catch (e) {
      const state = await describeLinkState();
      if (state) {
        showStatus(state);
        return;
      }
      throw e;
    }

    if ((payload?.game?.type || "") !== "poll_text") {
      showStatus(MSG.wrongType());
      return;
    }

    idx = 0;
    outbox = [];
    render();

    answerInput?.addEventListener("input", () => {
      // twardy limit 17 pełnych znaków (także przy wklejaniu)
      const clipped = clipChars(nfc(answerInput.value), ANSWER_MAX);
      if (clipped !== answerInput.value) answerInput.value = clipped;
      updateCount();
    });

    answerInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnSend?.click();
      }
    });

    btnSend?.addEventListener("click", async () => {
      if (voteView.finished || submitting) return;

      const q = (payload?.questions || [])[idx];
      if (!q) { render(); return; }

      try {
        setSub(MSG.sending());
        // pakujemy odpowiedź do outbox (bez wysyłki)
        const packed = validateAndPack(q.id, answerInput?.value || "");

        // nadpisz jeśli ktoś cofnąłby się kiedyś (na razie nie ma cofania, ale bezpiecznie)
        const i = outbox.findIndex(x => x.question_id === packed.question_id);
        if (i >= 0) outbox[i] = packed;
        else outbox.push(packed);

        idx++;
        render();
        requestAnimationFrame(() => qbox?.scrollIntoView({ behavior: "smooth", block: "start" }));
      } catch (e) {
        console.error("[poll-text] pack error:", e);
        setSub(MSG.error(e?.message || e));
      }
    });
  } catch (e) {
    console.error("[poll-text] init error:", e);
    showStatus(MSG.openPollFail(e?.message || e));
  }
});
