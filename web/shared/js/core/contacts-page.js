// Znajomi i subskrybenci: wspólne listy, akcje, zaproszenia i odświeżanie.
import { sb } from "./supabase.js?v=v2026-11-08T15040";
import { initPage } from "./page-init.js?v=v2026-11-08T15040";
import { linkTo, PAGES } from "./nav-map.js?v=v2026-11-08T15040";
import { tabFromUrl, setTab } from "./tabs.js?v=v2026-11-08T15040";
import { initSplitTabs } from "./split-tabs.js?v=v2026-11-08T15040";
import { toast } from "./toast.js?v=v2026-11-08T15040";
import { iconText } from "./icons.js?v=v2026-11-08T15040";
import { confirmModal, alertModal } from "./modal.js?v=v2026-11-08T15040";
import { shareSectionEl } from "./share-sections.js?v=v2026-11-08T15040";
import { createCooldownTicker } from "./cooldown.js?v=v2026-11-08T15040";
import { sendInviteMail } from "./invite-mail.js?v=v2026-11-08T15040";
import { goLinkToken } from "./notify-mail.js?v=v2026-11-08T15040";
import { initI18n, t } from "../../translation/translation.js?v=v2026-11-08T15040";
import "./contact-modal.js?v=v2026-11-08T15040";


export async function initContactsPage(pageId) {
  const friends = pageId === "friends";
  const ready = initI18n({ withSwitcher: true }).finally(() => document.documentElement.classList.remove("page-loading"));
  const user = await initPage(pageId, { ready, back: document.getElementById("btnBack") });
  if (!user) return;
  const host = document.getElementById("contactsHost");
  const loadRetryWrap = document.getElementById("contactsLoadRetryWrap");
  const loadRetry = document.getElementById("contactsLoadRetry");
  const cooldowns = createCooldownTicker();
  let rows = [];
  let inFlight = null;
  let contactsLoaded = false;
  let loadFailureNotified = false;
  let declinedCollapsed = true;
  const allowedTabs = PAGES[pageId].tabs;
  const split = initSplitTabs(document.querySelector(".tabs-card--split"), {
    active: tabFromUrl(allowedTabs, allowedTabs[0]),
    onChange: name => setTab(name, allowedTabs[0]),
  });
  const selectTab = name => { split.select(name); setTab(name, allowedTabs[0]); };

  async function call(name, args) {
    const { data, error } = await sb().rpc(name, args);
    if (error) throw error;
    if (data?.ok === false) throw Object.assign(new Error(data.err || data.error), { result: data });
    return data;
  }
  async function report(error) {
    const result = error.result;
    const other = result?.err === "has_account" ? "friends" : result?.has_email_only ? "subscribers" : null;
    if (other) {
      const link = document.createElement("a");
      link.className = "btn sm gold";
      link.href = linkTo(other);
      link.innerHTML = iconText("arrow-right", t("contacts.go"));
      await alertModal({ text: t(`contacts.errors.${other === "friends" ? "hasAccount" : "emailOnly"}`), body: link });
    } else {
      if (friends && result?.err === "already") {
        await refresh();
        const key = result.status === "active" ? "alreadyFriend"
          : result.status === "declined" ? (result.direction === "incoming" ? "ownDeclined" : "declined")
          : result.direction === "incoming" ? "incomingPending" : "outgoingPending";
        toast(t(`contacts.errors.${key}`));
        if (result.direction === "incoming" && result.status === "declined") { declinedCollapsed = false; render(); }
        focusRow(result.id);
        return;
      }
      // Odmowy z serwera, które użytkownik może poprawić sam (siebie, zła nazwa,
      // zły adres, adres wypisany ze wszystkich wiadomości).
      const known = { self: "self", unknown_user: "unknownUser", invalid_email: "invalidEmail", notifications_disabled: "notificationsDisabled" };
      toast(result?.err === "cooldown" ? t("contacts.errors.cooldown", { date: new Date(result.cooldown_until).toLocaleString() })
        : result?.err === "already" ? t("contacts.errors.already")
        : Object.hasOwn(known, result?.err || "") ? t(`contacts.errors.${known[result.err]}`)
        : t("contacts.errors.action"), { kind: "error" });
      console.warn("[contacts] action:", error);
    }
  }
  async function action(row, kind, button) {
    button.dataset.locked = "1";
    button.disabled = true;
    try {
      if (["remove", "cancel", "reject"].includes(kind)) {
        if (!await confirmModal({ text: t(`contacts.confirm.${!friends && kind === "remove" ? "removeSubscriber" : kind}`) })) return;
      }
      const data = await call(friends ? `friends_${kind}` : kind === "resend" ? "polls_hub_subscriber_resend" : "polls_hub_subscriber_remove", { p_id: row.id });
      const resendToken = kind === "resend" ? goLinkToken(data.link, friends ? "f" : "s") : "";
      if (resendToken) {
        const queued = await sendInviteMail({ token: resendToken, kind: friends ? "friend" : "subscriber", reminder: true, actionKey: friends ? "friend:resend" : "poll:resend" });
        toast(t(queued ? "contacts.sent" : "contacts.friendMailDisabled"));
      }
      await refresh();
    } catch (error) { await report(error); }
    finally { delete button.dataset.locked; button.disabled = false; cooldowns.tick(); }
  }
  function rowOf(row, statusIsRedundant = false) {
    const actions = [];
    const add = (kind, icon, gold = false, iconOnly = false) => actions.push({ key: kind, icon, gold, iconOnly,
      title: t(`contacts.actions.${kind}`), onClick: (_, button) => action(row, kind, button),
      countdown: kind === "resend",
      onMount: kind === "resend" ? ({ rowEl, button, labelEl }) => {
        const key = `contact:${row.id}`;
        cooldowns.bind({ key, labelEl, disableEls: [button],
          onTick: (_, active) => { rowEl.classList.toggle("blocked", active); rowEl.classList.toggle("is-cooling-down", active); } });
        cooldowns.setEndMs(key, Date.parse(row.resend_available_at) || 0);
      } : undefined });
    if (friends && row.direction === "incoming") {
      if (row.status === "declined") add("undo_reject", "undo", false, true);
      else { add("accept", "check", true); add("reject", "cancel"); }
    }
    else if (["pending", "declined"].includes(row.status)) {
      if (row.status === "pending" && row.email_enabled !== false) add("resend", "refresh");
      add(friends ? "cancel" : "remove", "trash", false, true);
    }
    else add("remove", "trash", false, true);
    const state = friends && row.direction === "friend" ? "active" : row.status;
    return { id: row.id, label: friends ? row.label : row.email, compact: true,
      state: { key: state, label: t(`contacts.status.${state}`) },
      tags: state === "active" || statusIsRedundant ? [] : [{ text: t(`contacts.status.${state}`) }],
      note: friends ? row.email : row.friend_user_id ? t("contacts.accountCreated") : "",
      actions };
  }
  function render() {
    cooldowns.resetBindings();
    const make = (key) => {
      const selected = rows.filter(row => key === "declined" && friends
        ? row.direction === "incoming" && row.status === "declined"
        : (!friends && key === "pending" ? ["pending", "declined"].includes(row.status) : (friends ? row.direction : row.status) === key) && !(friends && key === "incoming" && row.status === "declined"));
      const section = shareSectionEl({ key, title: t(`contacts.sections.${key}`),
        rows: selected.map(row => rowOf(row, friends && (key === "incoming" || key === "declined"))),
        ...(key === "declined" && friends ? { collapsed: declinedCollapsed, onToggle: value => { declinedCollapsed = value; } } : {}),
        emptyText: t(`contacts.empty.${key}`) });
      // Zachowane znaczniki dla wskazania zaproszenia i testów przepływu.
      section.classList.add("rowsSection--" + key);
      if (key === "declined" && !selected.length) section.hidden = true;
      return section;
    };
    document.getElementById("contactsOutgoing").replaceChildren(make(friends ? "outgoing" : "pending"));
    document.getElementById("contactsReceived").replaceChildren(...(friends ? ["friend", "incoming", "declined"] : ["active"]).map(make));
    const counts = {
      invite: rows.filter(row => friends ? row.direction === "outgoing" && row.status === "pending" : row.status === "pending").length,
      received: rows.filter(row => friends ? row.direction === "incoming" && row.status === "pending" : row.status === "active").length,
    };
    for (const badge of document.querySelectorAll("[data-contact-count]")) {
      badge.textContent = counts[badge.dataset.contactCount] || "";
    }
  }
  function focusRow(id) {
    const row = host.querySelector(`.shareRow[data-id="${CSS.escape(String(id))}"]`);
    if (row) selectTab(row.closest("[data-split-panel]").dataset.splitPanel);
    row?.classList.add("rowsFocus");
    row?.scrollIntoView({ block: "nearest" });
  }
  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        await call("friend_invites_from_subscriptions");
        const data = await call("contacts_list", { p_kind: friends ? "friends" : "subscribers" });
        rows = Array.isArray(data) ? data : [];
        // Najpierw zbuduj wiersze i podepnij ich akcje; dopiero gotowy widok
        // ujawni listę kontaktów.
        render();
        contactsLoaded = true;
        loadFailureNotified = false;
        if (loadRetryWrap) loadRetryWrap.hidden = true;
        host?.classList.add("skel-step-ready");
      } catch (error) {
        if (!contactsLoaded) {
          host?.classList.add("skel-step-ready");
          if (loadRetryWrap) loadRetryWrap.hidden = false;
          if (!loadFailureNotified) toast(t("contacts.load.failed"), { kind: "error" });
          loadFailureNotified = true;
        } else await report(error);
      }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }
  loadRetry?.addEventListener("click", () => {
    loadFailureNotified = false;
    if (loadRetryWrap) loadRetryWrap.hidden = true;
    void refresh();
  });
  document.getElementById("inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (document.getElementById("btnInvite").disabled) return;
    const input = document.getElementById("inviteInput");
    if (!input.value.trim()) return;
    const button = document.getElementById("btnInvite");
    button.disabled = true;
    try {
      const data = await call(friends ? "friends_invite" : "subscribers_invite", friends ? { p_handle: input.value } : { p_email: input.value });
      let mail = null;
      if (friends && data.mail_allowed) mail = { token: data.token, actionKey: "friend:invite" };
      if (!friends && !data.already) {
        const resent = await call("polls_hub_subscriber_resend", { p_id: data.id });
        if (resent?.mail_allowed) mail = { token: goLinkToken(resent.link, "s") };
      }
      await refresh();
      let mailSkipped = false;
      if (mail?.token) {
        try { mailSkipped = !await sendInviteMail({ ...mail, kind: friends ? "friend" : "subscriber" }); }
        catch (error) { console.warn("[contacts] mail:", error); toast(t("contacts.mailFailed"), { kind: "error" }); return; }
      }
      input.value = "";
      toast(t(data.already ? "contacts.errors.already" : mailSkipped ? "contacts.friendMailDisabled" : "contacts.sent"));
    } catch (error) { await report(error); }
    finally { button.disabled = false; }
  });
  window.addEventListener("i18n:lang", render);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cooldowns.stop();
    else { cooldowns.start(); void refresh(); }
  });
  const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 20000);
  window.addEventListener("pagehide", () => { clearInterval(timer); cooldowns.stop(); }, { once: true });
  await refresh();
  cooldowns.start();
  const token = new URLSearchParams(location.search).get("f");
  if (friends && token) {
    try {
      const resolved = await call("poll_go_resolve", { p_token: token });
      if (rows.some(row => row.id === resolved.id && row.direction === "incoming" && row.status === "declined")) {
        declinedCollapsed = false; render();
      }
      focusRow(resolved.id);
    } catch (error) { await report(error); }
  }
}
