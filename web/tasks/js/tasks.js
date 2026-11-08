// Zadania: wyłącznie ankiety. Do zrobienia / Zrobione (5 dni).
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T10534";
import { toast } from "../../shared/js/core/toast.js?v=v2026-11-08T10534";
import { confirmModal } from "../../shared/js/core/modal.js?v=v2026-11-08T10534";
import { getUiLang, initI18n, t } from "../../shared/translation/translation.js?v=v2026-11-08T10534";
import { initPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T10534";
import "../../shared/js/core/contact-modal.js?v=v2026-11-08T10534";
import { renderRowSections } from "../../shared/js/core/share-sections.js?v=v2026-11-08T10534";


const i18nReady = initI18n({ withSwitcher: true }).catch((err) => {
  console.error("[tasks] i18n nieaktywny:", err);
}).finally(() => {
  document.documentElement.classList.remove("page-loading");
});

const $ = (id) => document.getElementById(id);
const host = $("tasksHost");
const loadRetryWrap = $("tasksLoadRetryWrap");
const loadRetry = $("tasksLoadRetry");

const qs = new URLSearchParams(location.search);
const focusPollToken = qs.get("t");
let focusHandled = false;

let tasks = [];
let tasksLoaded = false;
let loadFailureNotified = false;

function fmtDate(value) {
  if (!value) return "";
  try { return new Date(value).toLocaleDateString(getUiLang() || "pl"); } catch { return ""; }
}

const ownerOf = (task) => String(task.owner_label || "").trim() || "—";

function pollVoteHref(task) {
  const page = task.poll_type === "poll_points" ? "/polls/vote/points/" : "/polls/vote/text/";
  return `${page}?t=${encodeURIComponent(task.token)}&lang=${encodeURIComponent(getUiLang() || "pl")}`;
}

async function declinePoll(task) {
  const ok = await confirmModal({
    title: t("tasks.declinePoll.title"),
    text: t("tasks.declinePoll.text"),
    okText: t("tasks.declinePoll.ok"),
    cancelText: t("tasks.declinePoll.cancel"),
  });
  if (!ok) return;
  const { data, error } = await sb().rpc("polls_hub_task_decline", { p_task_id: task.id });
  if (error || !data) { toast(t("tasks.errors.decline"), { kind: "error" }); return; }
  await refresh();
}

function rowOf(task) {
  const owner = t("tasks.from", { owner: ownerOf(task) });
  const done = task.state === "done";
  return {
    id: task.id, avatarIcon: "polls",
    data: { kind: "poll", token: task.token },
    title: task.title,
    noteMobile: owner,
    note: [owner, done ? t("tasks.doneAt", { date: fmtDate(task.done_at) }) : t("tasks.received", { date: fmtDate(task.created_at) })].join(" · "),
    actions: done ? [] : [
      { key: "vote", text: t("tasks.actions.vote"), icon: "polls", gold: true, onClick: () => { location.href = pollVoteHref(task); } },
      { key: "decline", text: t("tasks.actions.decline"), icon: "cancel", onClick: () => declinePoll(task) },
    ],
  };
}

function render() {
  const todo = tasks.filter((x) => x.state === "todo");
  const done = tasks.filter((x) => x.kind === "poll" && x.state === "done");
  renderRowSections(host, [
    { key: "todo", title: t("tasks.sections.todo"), rows: todo.map(rowOf) },
    { key: "done", title: t("tasks.sections.done"), rows: done.map(rowOf), collapsed: true },
  ], { emptyText: t("tasks.empty") });
}

function focusFromUrl() {
  if (focusHandled) return;
  focusHandled = true;
  const token = focusPollToken;
  if (!token) return;
  const kind = "poll";
  const row = host.querySelector(`.rowsRow[data-kind="${kind}"][data-token="${CSS.escape(token)}"]`);
  if (row) {
    const list = row.closest(".rowsList");
    if (list?.hidden) list.parentElement.querySelector(".rowsSectionHead")?.click();
    row.classList.add("rowsFocus");
    row.scrollIntoView({ block: "center" });
  }
  const url = new URL(location.href);
  url.searchParams.delete("t");
  history.replaceState(history.state, "", url.pathname + url.search + url.hash);
}

let inFlight = null;
async function refresh() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const { data, error } = await sb().rpc("tasks_list", { p_kind: null });
      if (error) throw error;
      tasks = Array.isArray(data) ? data.filter(task => task.kind === "poll") : [];
      // Najpierw renderuj wiersze z działającymi akcjami, potem ujawnij listę.
      render();
      tasksLoaded = true;
      loadFailureNotified = false;
      if (loadRetryWrap) loadRetryWrap.hidden = true;
      document.querySelector(".tasks-scroll")?.classList.add("skel-step-ready");
      focusFromUrl();
    } catch (e) {
      console.error("[tasks] tasks_list:", e);
      if (!tasksLoaded) {
        loadRetryWrap.hidden = false;
        document.querySelector(".tasks-scroll")?.classList.add("skel-step-ready");
        if (!loadFailureNotified) toast(t("tasks.load.failed"), { kind: "error" });
        loadFailureNotified = true;
      } else toast(t("tasks.errors.load"), { kind: "error" });
    }
  })();
  try { await inFlight; } finally { inFlight = null; }
}

document.addEventListener("DOMContentLoaded", async () => {
  const user = await initPage("tasks", { ready: i18nReady, back: $("btnBack") });
  if (!user) return;

  loadRetry?.addEventListener("click", () => { loadFailureNotified = false; void refresh(); });
  window.addEventListener("i18n:lang", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, 20000);

  await refresh();
});
