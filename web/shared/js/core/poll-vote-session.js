import { createAnonymousSubmitter } from "./poll-anonymous.js?v=v2026-11-05T18070";

// Wspólny cykl ankiety; strony zachowują renderowanie i walidację swoich odpowiedzi.
export function createPollVoteView({ qbox, closed, subEl, messages, getUser, withLangParam,
  document = globalThis.document, location = globalThis.location, schedule = setTimeout }) {
  let finished = false;
  function setSub(text) { if (subEl) subEl.textContent = text || ""; }
  function setClosedMsg(text) { if (closed) closed.textContent = text || ""; }
  function showClosed(on) {
    if (closed) closed.hidden = !on;
    if (qbox) qbox.hidden = on;
    if (subEl) subEl.hidden = !!on;
    if (on) closed?.classList.add("skel-step-ready");
  }
  function showStatus(message) {
    showClosed(true);
    setSub("");
    setClosedMsg(message);
    document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
  }
  function showFinished() {
    if (finished) return;
    finished = true;
    if (qbox) qbox.hidden = true;
    if (closed) closed.hidden = true;
    setSub(messages.thanks());
    schedule(() => {
      void getUser().then(user => location.replace(withLangParam(user ? "/games/" : "/")));
    }, 5000);
  }
  return { get finished() { return finished; }, setSub, setClosedMsg, showClosed, showStatus, showFinished };
}

async function withTimeout(promiseLike, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message || "Timeout")), ms); });
  try { return await Promise.race([Promise.resolve(promiseLike), timeout]); }
  finally { clearTimeout(timer); }
}

export function createPollVoteSession({ type, getClient, readContext, resolveContext, messages, view, getUser,
  location = globalThis.location, storage = () => globalThis.localStorage,
  idFactory = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), schedule = setTimeout }) {
  const rpc = { points: "poll_points_vote_batch", text: "poll_text_submit_batch" }[type];
  if (!rpc) throw new Error(`Unknown poll type: ${type}`);
  let taskVoterToken = null;
  let anonymousSubmit = null;
  function stateMessage(state) {
    if (state === "stopped") return messages.pollStopped();
    if (state === "ended") return messages.pollEnded();
    if (state === "expired" || state === "draft") return messages.linkExpired();
    if (state === "not_found") return messages.pollNotFound();
    return null;
  }
  async function describeLinkState() {
    const { gameId, key } = readContext();
    try {
      const { data, error } = await getClient().rpc("poll_state", { p_game_id: gameId, p_key: key });
      if (error) return String(error.message || "").includes("invalid input syntax") ? messages.pollNotFound() : null;
      return stateMessage(data?.state);
    } catch { return null; }
  }
  function getVoterToken() {
    const { gameId, key, taskToken } = readContext();
    if (taskToken && taskVoterToken) return taskVoterToken;
    const name = `fam_voter_${gameId}_${key}`;
    const store = storage();
    let token = store.getItem(name);
    if (!token) { token = idFactory(); store.setItem(name, token); }
    return token;
  }
  async function loadPayload() {
    const { gameId, key } = readContext();
    const { data, error } = await withTimeout(getClient().rpc("poll_get_payload", { p_game_id: gameId, p_key: key }), 15000, messages.loadTimeout());
    if (error) throw error;
    return data;
  }
  async function submitBatch(items) {
    const { gameId, key, taskToken } = readContext();
    if (!taskToken) {
      anonymousSubmit ||= createAnonymousSubmitter({ gameId, key, client: getClient() });
      return anonymousSubmit(items);
    }
    const voter = getVoterToken();
    const total = Array.isArray(items) ? items.length : 0;
    for (let i = 0; i < total; i += 25) {
      const chunk = items.slice(i, i + 25);
      view.setSub(`${messages.sending()} (${Math.min(i + 25, total)}/${total})`);
      for (let attempt = 1; ; attempt++) {
        try {
          const { error } = await withTimeout(getClient().rpc(rpc, { p_game_id: gameId, p_key: key, p_voter_token: voter, p_items: chunk }), 30000, messages.loadTimeout());
          if (error) throw error;
          break;
        } catch (error) {
          if (attempt >= 3) throw error;
          await sleep(650 * attempt);
        }
      }
    }
  }
  async function markTask(action) {
    const { taskToken } = readContext();
    if (!taskToken) return;
    try { await getClient().rpc(action, { p_token: taskToken }); }
    catch (error) { console.warn(`[poll-${type}] ${action} failed:`, error); }
  }
  async function resolveTaskToken() {
    const { taskToken } = readContext();
    if (!taskToken) return;
    try {
      const { data, error } = await getClient().rpc("poll_task_resolve", { p_token: taskToken });
      if (error) throw error;
      if (data && data.ok === false) {
        const status = { poll_closed: messages.pollEnded(), poll_stopped: messages.pollStopped(), already_done: messages.inviteDone() };
        view.showStatus(status[data.error] || messages.inviteExpired());
        return;
      }
      if (!data?.ok || data.kind !== "task") throw new Error(messages.taskInvalid());
      if (data.requires_auth) { view.showStatus(messages.loginToVote()); return; }
      if (data.needs_email) { view.showStatus(messages.emailRequired()); return; }
      taskVoterToken = data.voter_token;
      resolveContext(data);
      await markTask("poll_task_opened");
    } catch (error) {
      console.error(`[poll-${type}] task resolve error:`, error);
      view.showStatus(messages.openTaskFail());
    }
  }
  async function maybeReturnToHub() {
    if (!readContext().taskToken) return;
    try { if (await getUser()) schedule(() => { location.href = "/tasks/"; }, 650); }
    catch { /* Błąd opcjonalnego powrotu nie zmienia wyniku głosowania. */ }
  }
  return { describeLinkState, loadPayload, submitBatch, resolveTaskToken,
    markTaskDone: () => markTask("poll_task_done"), maybeReturnToHub };
}
