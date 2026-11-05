// js/pages/poll-points.js
import { sb } from "../../../../shared/js/core/supabase.js?v=v2026-11-05T23235";
import { getUser } from "../../../../shared/js/core/auth.js?v=v2026-11-05T23235";
import { initI18n, t, withLangParam } from "../../../../shared/translation/translation.js?v=v2026-11-05T23235";
import { createPollVoteView, createPollVoteSession } from "../../../../shared/js/core/poll-vote-session.js?v=v2026-11-05T23235";
import { showPollSubmitRetry } from "../../../../shared/js/core/poll-submit-retry.js?v=v2026-11-05T23235";
import { initEntryPage } from "../../../../shared/js/core/page-init.js?v=v2026-11-05T23235";

// Podręcznik w nowej karcie (wpisane odpowiedzi zostają), bez ?ret= — adres niesie klucz ankiety.
const i18nReady = initEntryPage("pollVotePoints", { ready: initI18n({ withSwitcher: true }) }).then(() => {
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
});

const MSG = {
  thanks: () => t("pollPoints.thanks"),
  loadTimeout: () => t("pollPoints.loadTimeout"),
  taskInvalid: () => t("pollPoints.taskInvalid"),
  loginToVote: () => t("pollPoints.loginToVote"),
  emailRequired: () => t("pollPoints.emailRequired"),
  openTaskFail: () => t("pollPoints.openTaskFail"),
  pollFallback: () => t("pollPoints.pollFallback"),
  pollClosed: () => t("pollPoints.pollClosed"),
  pollStopped: () => t("pollPoints.pollStopped"),
  pollEnded: () => t("pollPoints.pollEnded"),
  sending: () => t("pollPoints.sending"),
  error: (err) => t("pollPoints.error", { error: err }),
  questionProgress: (current, total) => t("pollPoints.questionProgress", { current, total }),
  beforeUnloadWarn: () => t("pollPoints.beforeUnloadWarn"),
  missingParams: () => t("pollPoints.missingParams"),
  alreadyVoted: () => t("pollPoints.alreadyVoted"),
  linkExpired: () => t("pollPoints.linkExpired"),
  pollNotFound: () => t("pollPoints.pollNotFound"),
  inviteDone: () => t("pollPoints.inviteDone"),
  inviteDeclined: () => t("pollPoints.inviteDeclined"),
  inviteExpired: () => t("pollPoints.inviteExpired"),
  loading: () => t("pollPoints.loading"),
  wrongType: () => t("pollPoints.wrongType"),
  openPollFail: (err) => t("pollPoints.openPollFail", { error: err }),
  answerFallback: (ord) => t("pollPoints.answerFallback", { ord }),
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
const alist = $("alist");
const prog = $("prog");
const closed = $("closed");

let submitting = false;

// lokalny bufor głosów (wysyłka dopiero na końcu)
let outbox = [];

let taskResolved = !taskToken;
const voteView = createPollVoteView({ qbox, closed, subEl, messages: MSG, getUser, withLangParam });
const { setSub, setClosedMsg, showClosed, showStatus, showFinished } = voteView;
const { describeLinkState, loadPayload, submitBatch, resolveTaskToken, markTaskDone, maybeReturnToHub } = createPollVoteSession({
  type: "points", getClient: sb, messages: MSG, view: voteView, getUser,
  readContext: () => ({ gameId, key, taskToken }),
  resolveContext: data => { gameId = data.game_id; key = data.key; taskResolved = true; },
});

let retryAt = 0;
let stopRetry = null;

function setupBeforeUnloadWarn() {
  window.addEventListener("beforeunload", (e) => {
    if (voteView.finished) return;
    if (!outbox.length) return;
    e.preventDefault();
    e.returnValue = MSG.beforeUnloadWarn();
    return e.returnValue;
  });
}

let payload = null;
let idx = 0;

function render() {
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  const game = payload?.game || {};
  const questions = payload?.questions || [];
  const q = questions[idx];

  if (titleEl) titleEl.textContent = game.name || MSG.pollFallback();

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
    setSub(MSG.sending());

    // zablokuj UI listy
    if (alist) [...alist.querySelectorAll("button")].forEach(x => (x.disabled = true));

    submitBatch(outbox)
      .then(async () => {
        await markTaskDone();
        showFinished();
        await maybeReturnToHub();
      })
      .catch(async (e) => {
        console.error("[poll-points] submit_batch error:", e);
        submitting = false;
        // ankieta mogła zostać zatrzymana / zakończona w trakcie odpowiadania
        const linkState = await describeLinkState();
        if (linkState) {
          showStatus(linkState);
          return;
        }
        retryAt = Date.now() + (e?.retryAfter || 0) * 1000;
        stopRetry = showPollSubmitRetry({ button: null, container: alist, seconds: e?.retryAfter || 0, setMessage: setSub, onRetry: render });
      });

    return;
  }

  if (qtext) qtext.textContent = q.text || t("common.dash");
  if (prog) prog.textContent = MSG.questionProgress(q.ord, questions.length);
  qbox?.classList.add("skel-step-ready");
  setSub("");

  if (alist) {
    alist.innerHTML = "";
    const answers = q.answers || [];

    for (const a of answers) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn full";
      b.textContent = a.text || MSG.answerFallback(a.ord);

      b.addEventListener("click", (e) => {
        if (voteView.finished || submitting) return;
        // Drugie kliknięcie dwukliku trafia w przycisk następnego pytania, którego
        // głosujący jeszcze nie widział — nie może za niego odpowiedzieć.
        if (e.detail > 1) return;

        // zapamiętaj wybór (bez wysyłki)
        const packed = { question_id: q.id, answer_id: a.id };
        const i = outbox.findIndex(x => x.question_id === packed.question_id);
        if (i >= 0) outbox[i] = packed;
        else outbox.push(packed);

        // przejście do następnego pytania
        idx++;
        render();
        requestAnimationFrame(() => qbox?.scrollIntoView({ behavior: "smooth", block: "start" }));
      });

      alist.appendChild(b);
    }
  }
}

// po zmianie języka applyTranslations nadpisuje qtext/prog/sub (bo mają data-i18n w HTML)
// więc wymuszamy ponowne odmalowanie stanu ekranu
window.addEventListener("i18n:lang", () => {
  if (payload) {
    render(); // przywraca pytanie + progres po podmianie języka
  } else if (!voteView.finished) {
    setSub(MSG.loading()); // zanim payload się załaduje, niech "Loading…" będzie w dobrym języku
  }
});

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

    if ((payload?.game?.type || "") !== "poll_points") {
      showStatus(MSG.wrongType());
      return;
    }

    idx = 0;
    outbox = [];
    render();
  } catch (e) {
    console.error("[poll-points] init error:", e);
    showStatus(MSG.openPollFail(e?.message || e));
  }
});
