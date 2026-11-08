import { holdPageLayout, redirectPage } from "../../shared/js/core/page-layout.js?v=v2026-11-08T15552";
// web/go/js/go.js
import { parseGoLink, goKindMatches, goErrorKey, baseStateKey, matchesGoRecipient } from "../../shared/js/core/go-contract.js?v=v2026-11-08T15552";
import { anonymousPollDestination, validAnonymousPollParams, screenshotSnakeUrl } from "../../shared/js/core/poll-links.js?v=v2026-11-08T15552";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-08T15552";
import { getUser } from "../../shared/js/core/auth.js?v=v2026-11-08T15552";
import { initI18n, t, getUiLang } from "../../shared/translation/translation.js?v=v2026-11-08T15552";
import { icon, sharingActionIcon } from "../../shared/js/core/icons.js?v=v2026-11-08T15552";
import { alertModal } from "../../shared/js/core/modal.js?v=v2026-11-08T15552";

import { logSnake } from "../../shared/js/core/snake-log.js?v=v2026-11-08T15552";
import { linkTo } from "../../shared/js/core/nav-map.js?v=v2026-11-08T15552";
import { initEntryPage } from "../../shared/js/core/page-init.js?v=v2026-11-08T15552";

const i18nReady = initEntryPage("go", { ready: initI18n({ withSwitcher: true }) }).then(() => {
  document.querySelector("main[data-skel-step]")?.classList.add("skel-step-ready");
});

const MSG = {
  declined: () => t("pollGo.declined"),
  taskDeclined: () => t("pollGo.taskDeclined"),
  error: () => t("pollGo.error"),
  declineTaskFailed: () => t("pollGo.declineTaskFailed"),
  declineInviteFailed: () => t("pollGo.declineInviteFailed"),
  subHeading: (owner) => t("pollGo.subHeading", { owner }),
  taskHeading: (name, owner) => t("pollGo.taskHeading", { name, owner }),
  taskName: (name) => t("pollGo.taskName", { name }),
  pollFallback: () => t("pollGo.pollFallback"),
  ownerSuffix: (owner) => t("pollGo.ownerSuffix", { owner }),
  mismatch: (email) => t("pollGo.mismatch", { email }),
  inviteUsed: () => t("pollGo.inviteUsed"),
  acceptFailed: () => t("pollGo.acceptFailed"),
  subscriptionActive: () => t("pollGo.subscriptionActive"),
  inviteAccepted: () => t("pollGo.inviteAccepted"),
  inviteDeclined: () => t("pollGo.inviteDeclined"),
  inviteAcceptFailed: () => t("pollGo.inviteAcceptFailed"),
  emailMissingTitle: () => t("pollGo.emailMissingTitle"),
  emailMissingText: () => t("pollGo.emailMissingText"),
  subscribeFailed: () => t("pollGo.subscribeFailed"),
  subscribeAdded: () => t("pollGo.subscribeAdded"),
  subscriptionInviteActive: () => t("pollGo.subscriptionInviteActive"),
  subscribePrompt: () => t("pollGo.subscribePrompt"),
  acceptInHub: () => t("pollGo.acceptInHub"),
  acceptLabel: () => t("pollGo.acceptLabel"),
  declineLabel: () => t("pollGo.declineLabel"),
  subscribeLabel: () => t("pollGo.subscribeLabel"),
  loginToAccept: () => t("pollGo.loginToAccept"),
  loginLabel: () => t("pollGo.loginLabel"),
  loginToVote: () => t("pollGo.loginToVote"),
  taskInviteActive: () => t("pollGo.taskInviteActive"),
  voteLabel: () => t("pollGo.voteLabel"),
  missingLinkTitle: () => t("pollGo.missingLinkTitle"),
  missingLinkText: () => t("pollGo.missingLinkText"),
  inviteDone: () => t("pollGo.inviteDone"),
  inviteDeclinedShort: () => t("pollGo.inviteDeclinedShort"),
  pollClosed: () => t("pollGo.pollClosed"),
  pollStopped: () => t("pollGo.pollStopped"),
  pollEnded: () => t("pollGo.pollEnded"),
  inviteExpired: () => t("pollGo.inviteExpired"),
  invalidLinkTitle: () => t("pollGo.invalidLinkTitle"),
  invalidLinkText: () => t("pollGo.invalidLinkText"),
  inviteUnknown: () => t("pollGo.inviteUnknown"),
  openInviteFailed: () => t("pollGo.openInviteFailed"),
  invitationRecipient: () => t("pollGo.invitationRecipient"),
  ownerEmailBlocked: (owner) => t("pollGo.ownerEmailBlocked", { owner }),
  unsubOwnerHeading: (owner) => t("pollGo.unsubOwnerHeading", { owner }),
  unsubOwnerText: () => t("pollGo.unsubOwnerText"),
  unsubOwnerBtn: (owner) => t("pollGo.unsubOwnerBtn", { owner }),
  unsubOwnerDone: (owner) => t("pollGo.unsubOwnerDone", { owner }),
  unsubOwnerFailed: () => t("pollGo.unsubOwnerFailed"),
  unsubGlobalHeading: () => t("pollGo.unsubGlobalHeading"),
  unsubGlobalText: () => t("pollGo.unsubGlobalText"),
  unsubGlobalBtn: () => t("pollGo.unsubGlobalBtn"),
  unsubGlobalDone: () => t("pollGo.unsubGlobalDone"),
  unsubGlobalAlready: () => t("pollGo.unsubGlobalAlready"),
  unsubGlobalFailed: () => t("pollGo.unsubGlobalFailed"),
};

const qs = new URLSearchParams(location.search);
const parsedLink = parseGoLink(qs);
const taskToken = qs.get("t");
const subToken = qs.get("s");
const friendToken = qs.get("f");
const baseToken = qs.get("b");
const unsubToken = qs.get("u");
const mailCenterToken = qs.get("m");
const copyToken = qs.get("c");

const actionParam = qs.get("action");
const isUnsubOwner = Boolean(subToken && actionParam === "unsub");
const isUnsubGlobal = Boolean(unsubToken && !taskToken && !subToken);

const tokenCount = [taskToken, subToken, friendToken, baseToken, copyToken].filter(Boolean).length;
const goToken = tokenCount === 1 ? (friendToken || baseToken || taskToken || subToken || copyToken) : null;

const $ = (id) => document.getElementById(id);

const title = $("title");
const message = $("message");
const actions = $("actions");
const hint = $("hint");
const emailRow = $("emailRow");
const emailInput = $("emailInput");

let resolvedInviteData = null;

async function handleControlDeviceGateway() {
  await i18nReady;
  clearActions();
  showEmailInput(false);
  const type = qs.get("d");
  const gameId = qs.get("id");
  const token = qs.get("key");
  const paths = { display: "/control/display/", host: "/control/host/", buzzer: "/control/buzzer/" };
  if (!paths[type] || !gameId || !token) {
    setView({ head: MSG.invalidLinkTitle(), text: MSG.invalidLinkText() });
    return;
  }
  setView({ head: t("pollGo.deviceLinkTitle"), text: t("pollGo.deviceLinkChecking") });
  try {
    const { data, error } = await sb().rpc("control_device_share_resolve", { p_token: token });
    if (error) throw error;
    if (data?.state !== "active" || data?.game_id !== gameId || data?.device_type !== type) {
      const expired = data?.state === "expired";
      const revoked = data?.state === "revoked";
      setView({
        head: expired ? MSG.inviteExpired() : revoked ? t("pollGo.deviceLinkTitle") : MSG.invalidLinkTitle(),
        text: expired ? t("pollGo.deviceLinkExpired") :
          revoked ? t("pollGo.deviceLinkRevoked") : MSG.invalidLinkText(),
      });
      return;
    }
    const target = new URL(paths[type], location.origin);
    const params = new URLSearchParams(location.search);
    params.delete("d");
    target.search = params.toString();
    redirectPage(target.toString());
  } catch (error) {
    console.warn("[go device gateway]", error?.message || error);
    showNetworkFailure(handleControlDeviceGateway);
  }
}

async function handleAnonymousPollGateway() {
  await i18nReady;
  clearActions(); showEmailInput(false);
  if (!validAnonymousPollParams(qs)) {
    setView({ head:MSG.invalidLinkTitle(), text:MSG.invalidLinkText() });
    return;
  }
  setView({ head:t("pollGo.anonymousLinkTitle"), text:t("pollGo.anonymousLinkChecking") });
  try {
    const {data,error}=await sb().rpc("poll_state", {p_game_id:qs.get("id"),p_key:qs.get("key")});
    if(error || !data?.ok) throw error || new Error("invalid poll state");
    const target=anonymousPollDestination({...data,gameId:qs.get("id"),key:qs.get("key"),lang:qs.get("lang")},location.origin);
    if(target) { redirectPage(target); return; }
    const states={stopped:"pollGo.pollStopped",ended:"pollGo.pollEnded",draft:"pollGo.pollClosed",expired:"pollGo.anonymousLinkExpired",not_found:"pollGo.anonymousLinkMissing"};
    setView({head:t(states[data.state] || "pollGo.invalidLinkTitle"),text:""});
  } catch(error) {
    console.warn("[go anonymous gateway]",error?.message || error);
    showNetworkFailure(handleAnonymousPollGateway);
  }
}

function showNetworkFailure(retry = init) {
  clearActions(); showEmailInput(false);
  setView({ head: MSG.error(), text: t("pollGo.linkCheckFailed") });
  addAction(t("pollAnonymous.retry"), "gold", retry, "remind");
}

function showResolveError(data) {
  clearActions(); showEmailInput(false);
  const key = goErrorKey(data?.error);
  setView({ head: t(`pollGo.${key}`), text: key === "invalidLinkTitle" ? MSG.invalidLinkText() : "" });
}

function setView({ head, text, hintText }) {
  if (title) { title.removeAttribute("data-i18n"); title.textContent = head; }
  if (message) { message.removeAttribute("data-i18n"); message.textContent = text; }
  if (hint) { hint.removeAttribute("data-i18n"); hint.textContent = hintText || ""; }
}

function clearActions() {
  if (actions) actions.innerHTML = "";
}

function showEmailInput(show) {
  if (emailRow) emailRow.hidden = !show;
}

function addAction(label, kind, handler, action = "") {
  const btn = document.createElement("button");
  btn.className = `btn sm ${kind || ""}`.trim();
  const actionIcon = sharingActionIcon(action);
  if (actionIcon) {
    const image = document.createElement("span"); image.innerHTML = icon(actionIcon);
    const caption = document.createElement("span"); caption.textContent = label;
    btn.append(image, caption);
  } else btn.textContent = label;
  btn.addEventListener("click", handler);
  actions?.appendChild(btn);
  return btn;
}

function redirectToLogin() {
  const url = new URL("/login/", location.href);
  url.searchParams.set("from", "poll-go");
  url.searchParams.set("next", copyToken ? "copy" : friendToken || resolvedInviteData?.kind === "friend" ? "friends" : baseToken || resolvedInviteData?.kind === "base" ? "bases" : "tasks");
  if (friendToken || resolvedInviteData?.kind === "friend") url.searchParams.set("f", friendToken || subToken);
  if (baseToken) url.searchParams.set("b", baseToken);
  if (copyToken) url.searchParams.set("c", copyToken);
  if (taskToken) url.searchParams.set("t", taskToken);
  if (subToken && resolvedInviteData?.kind !== "friend") url.searchParams.set("s", subToken);
  if (friendToken || resolvedInviteData?.kind === "friend") url.searchParams.set("f", friendToken || subToken);
  location.href = url.toString();
}

// Strona, do której prowadzi przycisk „Przejdź do …” (ta sama co w redirectToHub).
function hubTarget() {
  if (copyToken) return resolvedInviteData?.resource_kind === "logo" ? "logos" : "games";
  if (baseToken || resolvedInviteData?.kind === "base") return "bases";
  return taskToken ? "tasks" : "friends";
}

function redirectToHub() {
  const url = new URL(`/${hubTarget()}/`, location.href);
  if (copyToken) url.searchParams.set("c", copyToken);
  if (baseToken) url.searchParams.set("b", baseToken);
  if (taskToken) {
    url.searchParams.set("t", taskToken);
  }
  if (subToken && resolvedInviteData?.kind !== "friend") url.searchParams.set("s", subToken);
  if (friendToken || resolvedInviteData?.kind === "friend") url.searchParams.set("f", friendToken || subToken);
  location.href = url.toString();
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

async function resolveToken() {
  if(copyToken){const {data,error}=await sb().rpc("resource_copy_go_resolve",{p_token:copyToken});if(error)throw error;return data;}
  const req = sb().rpc("poll_go_resolve", { p_token: goToken });
  const timeoutMs = 15000;
  let timer = null;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error("Timeout resolving invitation")), timeoutMs);
  });

  try {
    const { data, error } = await Promise.race([req, timeout]);
    if (error) throw error;
    return data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveProfileByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const { data, error } = await sb()
      .from("profiles")
      .select("id,username,email")
      .eq("email", normalized)
      .maybeSingle();
    if (error || !data?.id) return null;
    return data;
  } catch (e) {
    console.warn("[poll-go] profile email lookup failed:", e);
    return null;
  }
}

async function hydrateInviteIdentity(data) {
  if (!data) return data;

  // Email-only: możemy dociągnąć label do UI, ale NIE ustawiamy *_user_id
  if (data.kind === "sub" && !data.registered_user_id && data.subscriber_email) {
    const match = await resolveProfileByEmail(data.subscriber_email);
    if (match?.id) {
      return {
        ...data,
        subscriber_label: data.subscriber_label || match.username || match.email || data.subscriber_email,
      };
    }
    // Jeśli nie znaleźliśmy profilu, ale mamy email, użyj email jako label
    if (!data.subscriber_label) {
      return {
        ...data,
        subscriber_label: data.subscriber_email,
      };
    }
  }

  if (data.kind === "task" && !data.recipient_user_id && data.recipient_email) {
    const match = await resolveProfileByEmail(data.recipient_email);
    if (match?.id) {
      return {
        ...data,
        recipient_label: data.recipient_label || match.username || match.email || data.recipient_email,
      };
    }
    // Jeśli nie znaleźliśmy profilu, ale mamy email, użyj email jako label
    if (!data.recipient_label) {
      return {
        ...data,
        recipient_label: data.recipient_email,
      };
    }
  }

  return data;
}

function openVote(type) {
  if (!goToken) {
    console.error("[poll-go] goToken missing in openVote");
    return;
  }
  const page = type === "poll_points" ? "/polls/vote/points/" : "/polls/vote/text/";
  location.href = `${page}?t=${encodeURIComponent(goToken)}`;
}

async function declineTask() {
  try {
    const { data, error } = await sb().rpc("poll_task_decline", { p_token: goToken });
    if (error) throw error;
    if (data !== "ok") {
      const byState = { poll_stopped: MSG.pollStopped(), poll_closed: MSG.pollEnded(), expired: MSG.inviteExpired(), not_found: MSG.inviteExpired() };
      clearActions();
      setView({ head: byState[data] || MSG.error(), text: byState[data] ? "" : MSG.declineTaskFailed() });
      return;
    }
    setView({ head: MSG.declined(), text: MSG.taskDeclined() });
    clearActions();
  } catch (e) {
    console.error(e);
    setView({ head: MSG.error(), text: MSG.declineTaskFailed() });
  }
}

function buildSubHeading(data) {
  const owner = data?.owner_label ? MSG.ownerSuffix(data.owner_label) : "";
  return MSG.subHeading(owner);
}

function buildTaskHeading(data) {
  const name = data?.game_name ? MSG.taskName(data.game_name) : MSG.pollFallback();
  const owner = data?.owner_label ? MSG.ownerSuffix(data.owner_label) : "";
  return MSG.taskHeading(name, owner);
}

function showMismatch(head) {
  setView({ head, text: t("pollGo.accountMismatch") });
  clearActions(); showEmailInput(false);
}

// status zadania (tylko zaproszenia do ankiety): done / declined mają własne komunikaty
function showExpired(head, taskStatus) {
  if (taskStatus === "done") {
    setView({ head: MSG.inviteDone(), text: "" });
  } else if (taskStatus === "declined") {
    setView({ head: MSG.inviteDeclinedShort(), text: "" });
  } else if (taskStatus) {
    setView({ head: MSG.inviteExpired(), text: "" });
  } else {
    setView({ head, text: MSG.inviteUsed() });
  }
  clearActions();
  showEmailInput(false);
}

function matchesInviteTarget({ user, expectedUserId, expectedEmail }) {
  return matchesGoRecipient(user, expectedUserId, expectedEmail);
}

async function acceptSubDirect(email) {
  try {
    const { data, error } = await sb().rpc("poll_sub_accept_email", { p_token: goToken, p_email: email });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || MSG.acceptFailed());
    setView({ head: MSG.subscriptionActive(), text: MSG.inviteAccepted() });
    clearActions();
    showEmailInput(false);
  } catch (e) {
    console.error(e);
    setView({ head: MSG.error(), text: MSG.inviteAcceptFailed() });
  }
}

async function subscribeByEmail() {
  const email = emailInput?.value.trim();
  if (!email) {
    setView({ head: MSG.emailMissingTitle(), text: MSG.emailMissingText() });
    return;
  }
  try {
    if (resolvedInviteData?.owner_id) {
      // Porównanie z adresem właściciela w bazie, tylko po tokenie zaproszenia (E24 R10).
      const { data: ownerName } = await sb().rpc("poll_go_owner_email_blocked", { p_token: goToken, p_email: email });
      if (ownerName) {
        await alertModal({ text: MSG.ownerEmailBlocked(ownerName) });
        return;
      }
    }

    const { data, error } = await sb().rpc("poll_go_subscribe_email", { p_token: goToken, p_email: email });
    if (error) throw error;
    if (!data) throw new Error(MSG.subscribeFailed());
    setView({ head: MSG.subscriptionActive(), text: MSG.subscribeAdded() });
    clearActions();
    showEmailInput(false);
  } catch (e) {
    console.error(e);
    setView({ head: MSG.error(), text: MSG.subscribeFailed() });
  }
}

async function declineSub() {
  try {
    const { data, error } = await sb().rpc("poll_sub_decline", { p_token: goToken });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || MSG.declineInviteFailed());
    setView({ head: MSG.declined(), text: MSG.inviteDeclined() });
    clearActions();
  } catch (e) {
    console.error(e);
    setView({ head: MSG.error(), text: MSG.declineInviteFailed() });
  }
}

// Helper: sub invite ze zalogowanym userem i account invite (user_id)
function showSubInviteAccountMatch(head, expectedEmail) {
  setView({
    head,
    text: MSG.acceptInHub(),
    hintText: expectedEmail ? `${MSG.invitationRecipient()}: ${expectedEmail}` : "",
  });
  clearActions();
  addAction(t(`pollGo.hubTo.${hubTarget()}`), "gold", redirectToHub);
  showEmailInput(false);
}

// Helper: sub invite ze zalogowanym userem bez account invite
function showSubInviteLoggedIn(head, userEmail, expectedEmail) {
  setView({ head, text: MSG.subscriptionInviteActive() });
  clearActions();
  showEmailInput(false);
  addAction(MSG.acceptLabel(), "gold", async () => acceptSubDirect(userEmail || expectedEmail));
  addAction(MSG.declineLabel(), "danger", async () => declineSub(), "decline");
}

// Helper: sub invite niezalogowany bez account invite
function showSubInviteAnonEmail(head, subscriberEmail) {
  setView({ head, text: MSG.subscriptionInviteActive() });
  clearActions();
  showEmailInput(false);
  addAction(MSG.acceptLabel(), "gold", async () => acceptSubDirect(subscriberEmail));
  addAction(MSG.declineLabel(), "danger", async () => declineSub(), "decline");
}

async function handleSubInvite(data, user) {
  const head = buildSubHeading(data);
  const expectedEmail = normalizeEmail(data.subscriber_email);
  const expectedUserId = data.registered_user_id;
  const hasAccountInvite = Boolean(expectedUserId);
  const userEmail = normalizeEmail(user?.email);

  if (data.cancelled_at || data.status === "cancelled" || data.status === "expired") {
    clearActions(); showEmailInput(false);
    setView({ head: MSG.inviteExpired(), text: "" }); return;
  }
  // Konto korzysta ze Znajomych; token nie aktywuje subskrypcji konta.
  // Odmowa pozostaje odmową także po rejestracji.
  if ((data.friend_conversion_required || hasAccountInvite) && ["pending", "active"].includes(data.status)) {
    if (user && !matchesInviteTarget({ user, expectedUserId, expectedEmail })) {
      showMismatch(head, expectedEmail);
      return;
    }
    setView({ head, text: t("contacts.goAccountBody") });
    clearActions();
    showEmailInput(false);
    addAction(user ? t("contacts.goFriends") : MSG.loginLabel(), "gold", () => {
      const url = new URL(user ? linkTo("friends", { tab: "received" }) : linkTo("login"), location.href);
      if (!user) { url.searchParams.set("from", "poll-go"); url.searchParams.set("next", "friends"); url.searchParams.set("tab", "received"); }
      location.href = url.toString();
    });
    return;
  }

  // Nieaktywne zaproszenie pokazuje rzeczywisty stan, także po odświeżeniu.
  // Link konkretnej osoby nie staje się formularzem nowej subskrypcji.
  if (data.status !== "pending") {
    if (user && hasAccountInvite && !matchesInviteTarget({
      user, expectedUserId, expectedEmail,
    })) {
      showMismatch(head, expectedEmail);
      return;
    }
    if (data.status === "active") {
      setView({ head: MSG.subscriptionActive(), text: MSG.inviteAccepted() });
    } else if (data.status === "declined") {
      setView({ head: MSG.declined(), text: MSG.inviteDeclined() });
    } else {
      setView({ head: MSG.inviteExpired(), text: "" });
    }
    clearActions();
    showEmailInput(false);
    return;
  }

  // Case 1: Zalogowany user + account invite
  if (user && hasAccountInvite) {
    const okTarget = matchesInviteTarget({
      user,
      expectedUserId,
      expectedEmail: data.subscriber_email,
    });
    if (!okTarget) {
      showMismatch(head, data.subscriber_email);
      return;
    }
    showSubInviteAccountMatch(head, expectedEmail);
    return;
  }

  // Case 2: Zalogowany user + email invite (bez account)
  if (user && !hasAccountInvite) {
    showSubInviteLoggedIn(head, userEmail, expectedEmail);
    return;
  }

  // Case 3: Niezalogowany + account invite (wymagaj logowania)
  if (!user && hasAccountInvite) {
    setView({ head, text: MSG.loginToAccept() });
    clearActions();
    addAction(MSG.loginLabel(), "gold", redirectToLogin);
    showEmailInput(false);
    return;
  }

  // Case 4: Niezalogowany + email invite (bez account)
  showSubInviteAnonEmail(head, data.subscriber_email);
}

// Helper: task invite ze zalogowanym userem i account invite
function showTaskInviteAccountMatch(head, expectedEmail) {
  setView({
    head,
    text: t("pollGo.taskInTasks"),
    hintText: expectedEmail ? `${MSG.invitationRecipient()}: ${expectedEmail}` : "",
  });
  clearActions();
  addAction(t("pollGo.taskTasksAction"), "gold", redirectToHub);
  showEmailInput(false);
}

// Helper: task invite ze zalogowanym userem bez account invite
function showTaskInviteLoggedIn(head, pollType) {
  setView({ head, text: MSG.taskInviteActive() });
  clearActions();
  showEmailInput(false);
  addAction(MSG.voteLabel(), "gold", () => openVote(pollType));
  addAction(MSG.declineLabel(), "danger", async () => declineTask(), "decline");
}

// Helper: task invite niezalogowany bez account invite
function showTaskInviteAnon(head, pollType) {
  setView({ head, text: MSG.taskInviteActive() });
  clearActions();
  showEmailInput(false);
  addAction(MSG.voteLabel(), "gold", () => openVote(pollType));
  addAction(MSG.declineLabel(), "danger", async () => declineTask(), "decline");
}

async function handleTaskInvite(data, user) {
  const expectedEmail = normalizeEmail(data.recipient_email);
  const head = buildTaskHeading(data);
  const isActive = ["pending", "opened"].includes(data.status);
  const hasAccountInvite = Boolean(data.recipient_user_id);

  // Case 1: Zalogowany user + account invite
  if (user && hasAccountInvite) {
    const okTarget = matchesInviteTarget({
      user,
      expectedUserId: data.recipient_user_id,
      expectedEmail: data.recipient_email,
    });
    if (!okTarget) {
      showMismatch(head, data.recipient_email);
      return;
    }
    if (!isActive) {
      showExpired(head, data.status);
      return;
    }
    showTaskInviteAccountMatch(head, expectedEmail);
    return;
  }

  // Case 2: Zalogowany user + email invite (bez account)
  if (user && !hasAccountInvite) {
    if (!isActive) {
      showExpired(head, data.status);
      return;
    }
    showTaskInviteLoggedIn(head, data.poll_type);
    return;
  }

  // Case 3: Niezalogowany — najpierw sprawdzić czy active
  if (!isActive) {
    showExpired(head, data.status);
    return;
  }

  // Case 4: Niezalogowany + account invite (wymagaj logowania)
  if (hasAccountInvite) {
    setView({ head, text: MSG.loginToVote() });
    clearActions();
    addAction(MSG.loginLabel(), "gold", redirectToLogin);
    showEmailInput(false);
    return;
  }

  // Case 5: Niezalogowany + email invite
  showTaskInviteAnon(head, data.poll_type);
}

async function handleUnsubOwner() {
  try {
    const { data, error } = await sb().rpc("poll_go_resolve", { p_token: subToken });
    if (error) throw error;
    if (!data?.ok) { showResolveError(data); return; }
    if (!goKindMatches("s", data.kind)) { showResolveError(null); return; }
    resolvedInviteData = data;
    const user = await getUser({ fresh: true });
    if (data.kind === "friend") { handleFriendInvite(data, user); return; }
    if (data.friend_conversion_required || data.registered_user_id || data.cancelled_at) {
      await handleSubInvite(data, user); return;
    }
    if (!["pending", "active"].includes(data.status)) {
      setView({ head: data.status === "declined" ? MSG.declined() : MSG.inviteExpired(),
        text: data.status === "declined" ? MSG.inviteDeclined() : "" });
      clearActions();
      showEmailInput(false);
      return;
    }
    const ownerLabel = data.owner_label || "";
    setView({ head: MSG.unsubOwnerHeading(ownerLabel), text: MSG.unsubOwnerText() });
    clearActions();
    showEmailInput(false);
    addAction(MSG.unsubOwnerBtn(ownerLabel), "danger", async () => {
      try {
        const { data: res, error: err } = await sb().rpc("poll_sub_unsubscribe", { p_token: subToken });
        if (err || !res?.ok) throw new Error(err?.message || res?.error || "fail");
        setView({ head: MSG.declined(), text: MSG.unsubOwnerDone(res.owner_label || ownerLabel) });
        clearActions();
      } catch (e) {
        console.error("[poll-go] unsubscribe owner failed:", e);
        setView({ head: MSG.error(), text: MSG.unsubOwnerFailed() });
      }
    }, "withdraw");
  } catch (e) {
    console.error("[poll-go] unsub owner init failed:", e);
    showNetworkFailure();
  }
}

async function handleUnsubGlobal() {
  try {
    const { data, error } = await sb().rpc("poll_go_resolve", { p_token: unsubToken });
    if (error) throw error;
    if (!data?.ok) { showResolveError(data); return; }
    if (data.kind !== "unsub") { showResolveError(null); return; }
    if (data.already_suppressed) {
      setView({ head: MSG.unsubGlobalHeading(), text: MSG.unsubGlobalAlready() });
      clearActions();
      return;
    }
    setView({ head: MSG.unsubGlobalHeading(), text: MSG.unsubGlobalText() });
    clearActions();
    showEmailInput(false);
    addAction(MSG.unsubGlobalBtn(), "danger", async () => {
      try {
        const { data: res, error: err } = await sb().rpc("poll_go_global_unsubscribe", { p_token: unsubToken });
        if (err || !res?.ok) throw new Error(err?.message || res?.error || "fail");
        setView({ head: MSG.unsubGlobalHeading(), text: MSG.unsubGlobalDone() });
        clearActions();
      } catch (e) {
        console.error("[poll-go] unsub global failed:", e);
        setView({ head: MSG.error(), text: MSG.unsubGlobalFailed() });
      }
    }, "withdraw");
  } catch (e) {
    console.error("[poll-go] unsub global init failed:", e);
    showNetworkFailure();
  }
}

function handleBaseInvite(data, user) {
  clearActions();
  showEmailInput(false);
  if (["cancelled", "expired"].includes(data.status)) {
    setView({ head: t(`pollGo.${baseStateKey(data.status)}`), text: "" }); return;
  }
  if (!user) {
    setView({ head: t("pollGo.baseInviteTitle"), text: t("pollGo.baseInviteLogin") });
    addAction(MSG.loginLabel(), "gold", redirectToLogin);
    return;
  }
  if (!data.recipient_matches_me) {
    showMismatch(t("pollGo.baseInviteTitle"), data.recipient_email);
    return;
  }
  if (!['pending', 'opened'].includes(data.status)) {
    setView({ head: t(`pollGo.${baseStateKey(data.status)}`), text: "" });
    if (["done", "declined"].includes(data.status)) addAction(t("pollGo.baseInviteBasesAction"), "gold", redirectToHub);
    return;
  }
  setView({ head: t("pollGo.baseInviteTitle"), text: t("pollGo.baseInviteBases", { owner: data.owner_label || "" }) });
  addAction(t("pollGo.baseInviteBasesAction"), "gold", redirectToHub);
}

function handleFriendInvite(data, user) {
  clearActions(); showEmailInput(false);
  if (user && !data.recipient_matches_me) { showMismatch(t("contacts.goTitle")); return; }
  const head = data.status === "active" ? t("pollGo.friendActive") : data.status === "declined" ? MSG.inviteDeclinedShort() : t("contacts.goTitle");
  setView({ head, text: data.status === "pending" ? t("contacts.goBody", { owner: data.owner_label }) : "" });
  if (!user) addAction(MSG.loginLabel(), "gold", redirectToLogin);
  else addAction(t("contacts.open"), "gold", redirectToHub);
}

function handleCopyInvite(data,user){
  clearActions();showEmailInput(false);
  if(data.status==='expired'){setView({head:MSG.inviteExpired(),text:''});return;}
  if(user&&!data.recipient_matches_me){showMismatch(t('resourceSend.goTitle'),data.recipient_email);return;}
  if(!user){setView({head:t('resourceSend.goTitle'),text:t('resourceSend.goBody',{sender:data.sender_label,name:data.name})});addAction(MSG.loginLabel(),'gold',redirectToLogin);return;}
  if(data.status==='accepted'){setView({head:t('resourceSend.goAccepted'),text:''});addAction(t('resourceSend.openResource'),'gold',redirectToHub);return;}
  if(data.status!=='pending'){setView({head:MSG.inviteExpired(),text:''});return;}
  setView({head:t('resourceSend.goTitle'),text:t('resourceSend.goBody',{sender:data.sender_label,name:data.name})});
  let acceptButton;
  acceptButton=addAction(MSG.acceptLabel(),'gold',async()=>{
    if(acceptButton?.disabled)return;acceptButton.disabled=true;
    try{
      const {data:result,error}=await sb().rpc('resource_copy_decide',{p_offer:data.id,p_decision:'accept'});
      if(error||!result?.ok){setView({head:MSG.acceptFailed(),text:''});acceptButton.disabled=false;return;}
      resolvedInviteData={...data,status:'accepted'};setView({head:t('resourceSend.goAccepted'),text:''});clearActions();addAction(t('resourceSend.openResource'),'gold',redirectToHub);
    }catch{setView({head:MSG.acceptFailed(),text:''});acceptButton.disabled=false;}
  });
  addAction(MSG.declineLabel(),'withdraw',async()=>{
    const {data:result,error}=await sb().rpc('resource_copy_decide',{p_offer:data.id,p_decision:'decline'});
    if(error||!result?.ok){setView({head:MSG.declineInviteFailed(),text:''});return;}
    setView({head:t('resourceSend.goDeclined'),text:''});clearActions();
  });
}

async function handleQrGateway() {
  clearActions(); showEmailInput(false);
  try {
    const { data, error } = await sb().rpc("poll_state", { p_game_id: qs.get("id"), p_key: qs.get("key") });
    if (error || !data?.ok) throw error || new Error("invalid poll state");
    if (!["open", "stopped"].includes(data.state) || !["poll_text", "poll_points"].includes(data.type)) {
      const keys = { ended: "pollEnded", draft: "pollClosed", expired: "anonymousLinkExpired", not_found: "anonymousLinkMissing" };
      setView({ head: t(`pollGo.${keys[data.state] || "invalidLinkTitle"}`), text: "" }); return;
    }
    const params = new URLSearchParams(qs); params.delete("d");
    redirectPage("/polls/vote/qr/?" + params);
  } catch (error) { showNetworkFailure(handleQrGateway); }
}

async function init() {
  await i18nReady;
  clearActions(); showEmailInput(false);
  // Kod QR z kadru (ankieta, urządzenie, QR na Wyświetlaczu) -- niespodzianka.
  const snake = screenshotSnakeUrl(qs, location.origin, getUiLang());
  if (snake) {
    const lang = new URL(snake).searchParams.get("lang");
    await Promise.race([logSnake("scan", { lang }), new Promise((resolve) => setTimeout(resolve, 1500))]);
    redirectPage(snake);
    return;
  }
  if (["invalid", "missing"].includes(parsedLink.kind)) {
    setView({ head: parsedLink.kind === "missing" ? MSG.missingLinkTitle() : MSG.invalidLinkTitle(), text: parsedLink.kind === "missing" ? MSG.missingLinkText() : MSG.invalidLinkText() }); return;
  }
  if (parsedLink.kind === "m") {
    const center = new URL(linkTo("mailCenter"), location.origin);
    center.searchParams.set("m", mailCenterToken);
    if (qs.has("lang")) center.searchParams.set("lang", qs.get("lang"));
    redirectPage(center.href); return;
  }
  if (qs.has("p")) { await handleAnonymousPollGateway(); return; }
  if (qs.has("d")) {
    if (qs.get("d") === "qr") {
      await handleQrGateway();
      return;
    }
    await handleControlDeviceGateway();
    return;
  }
  // initI18n() robi dynamic import części słownika — bez tego czekania
  // t()/MSG.X() poniżej mogą wykonać się zanim translations się załaduje,
  // zwracając surowy klucz zamiast tłumaczenia (patrz t() w translation.js).
  await i18nReady;
  if (isUnsubOwner) {
    await handleUnsubOwner();
    return;
  }

  if (isUnsubGlobal) {
    await handleUnsubGlobal();
    return;
  }

  if (!goToken) {
    setView({ head: MSG.missingLinkTitle(), text: MSG.missingLinkText() });
    return;
  }

  try {
    const user = await getUser({ fresh: true });
    const raw = await resolveToken();
    const data = await hydrateInviteIdentity(raw);
    resolvedInviteData = data || null;
    if (!data?.ok) {
      showResolveError(data); return;
    }
    if (!goKindMatches(parsedLink.kind, data.kind)) { showResolveError(null); return; }
    if (data.kind === "copy") { handleCopyInvite(data,user); return; }
    if (data.kind === "friend") { handleFriendInvite(data, user); return; }

    if (data.kind === "sub") {
      await handleSubInvite(data, user);
      return;
    }

    if (data.kind === "task") {
      await handleTaskInvite(data, user);
      return;
    }
    if (data.kind === "base") {
      handleBaseInvite(data, user);
      return;
    }

    setView({ head: MSG.error(), text: MSG.inviteUnknown() });
  } catch (e) {
    console.error(e);
    showNetworkFailure();
  }
}

emailInput?.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (!goToken) return;
  await subscribeByEmail();
});

holdPageLayout(init().catch(() => showNetworkFailure()));
