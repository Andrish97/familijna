// control/js/shareDevice.js
// Sesyjne udostępnianie urządzeń z tokenem przypisanym do pojedynczego grantu.
// Dwa okna jak w Bazach (decyzja użytkownika 2026-10-23): „Udostępnienia”
// (lista w tej sesji, cofanie) i „Udostępnij” (adres + znajomi, jeden przycisk).

import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-04T18211";
import { t } from "../../shared/translation/translation.js?v=v2026-11-04T18211";
import { toast, hideToast } from "../../shared/js/core/toast.js?v=v2026-11-04T18211";
import { createCooldownTicker, formatCooldownRemaining } from "../../shared/js/core/cooldown.js?v=v2026-11-04T18211";
import { shareRowEl, shareCooldownEl, shareBulkActionsEl, attachListTools } from "../../shared/js/core/share-sections.js?v=v2026-11-04T18211";
import { openDialog, closeDialog } from "../../shared/js/core/modal-sheet.js?v=v2026-11-04T18211";

import { sendNotificationMail } from "../../shared/js/core/notify-mail.js?v=v2026-11-04T18211";

function deviceTypeLabel(type) {
  if (type === "host") return t("control.shareDeviceModal.typeHost");
  if (type === "buzzer") return t("control.shareDeviceModal.typeBuzzer");
  if (type === "display") return t("control.shareDeviceModal.typeDisplay");
  return type;
}

function shareErrorMessage(code) {
  const keys = {
    not_friend: "notFriend", unknown_user: "unknownUser", invalid_email: "invalidEmail",
    recipient_not_found: "unknownUser", recipient_changed: "recipientChanged",
    notifications_disabled: "recipientResigned",
    self_share: "selfShare", session_expired: "sessionExpired", gone: "sessionExpired",
  };
  return t(`control.shareDeviceModal.${keys[code] || "failed"}`);
}

// Mail z udostępnieniem urządzenia: treść i odbiorcę buduje send-mail z bazy
// (przydział powiadomienia z RPC); tu tylko token udostępnienia.
async function sendShareEmail(token) {
  return sendNotificationMail({ action: "device:share", token });
}

export function createShareDevice({ currentUser, game, onBadgesChanged }) {
  const isGuest = !currentUser || currentUser?.is_guest === true ||
    currentUser?.user_metadata?.is_guest === true || currentUser?.app_metadata?.is_guest === true;

  // Okno „Udostępnienia”
  const overlay = document.getElementById("shareDeviceOverlay");
  const titleEl = document.getElementById("shareDeviceTitle");
  const btnClose = document.getElementById("btnShareDeviceClose");
  const btnDone = document.getElementById("btnShareDeviceDone");
  const currentWrap = document.getElementById("shareDeviceCurrentWrap");
  const currentCont = document.getElementById("shareDeviceCurrentContent");
  // Okno „Udostępnij”
  const sendOverlay = document.getElementById("shareDeviceSendOverlay");
  const sendTitleEl = document.getElementById("shareDeviceSendTitle");
  const emailInp = document.getElementById("shareDeviceEmail");
  const subsList = document.getElementById("shareDeviceSubsList");
  const bulkHost = document.getElementById("shareDeviceBulkActions");
  const btnAdd = document.getElementById("btnShareDeviceAdd");
  const btnAddLabel = document.getElementById("btnShareDeviceAddLabel");
  const btnSendClose = document.getElementById("btnShareDeviceSendClose");
  const btnSendCancel = document.getElementById("btnShareDeviceSendCancel");

  if (!overlay || !sendOverlay || isGuest) {
    return { open: () => {}, openSend: () => {}, isGuest, refreshBadges: async () => ({}) };
  }
  attachListTools(bulkHost?.parentElement, subsList, "device-share-friends");
  attachListTools(currentCont?.previousElementSibling, currentCont, "device-share-shared");

  let _deviceType = null;
  let renderVersion = 0;
  let preflightVersion = 0;
  let bulkActions = null;
  // Wpisany adres odrzucony przez preflight (już udostępniono / bez powiadomień):
  // przycisk „Udostępnij” czeka, aż pole zostanie poprawione lub wyczyszczone.
  let lookupBlocked = false;
  let shareInFlight = false;
  const cooldownTicker = createCooldownTicker();
  cooldownTicker.start();

  function clearMessage() {
    hideToast();
  }

  function showMessage(message, { state = "info" } = {}) {
    if (message) toast(message, { kind: state });
  }

  function closeModal() {
    closeDialog(overlay);
    renderVersion++;
    clearMessage();
  }
  function closeSendModal() {
    closeDialog(sendOverlay);
    renderVersion++;
    preflightVersion++;
    clearMessage();
  }
  btnClose?.addEventListener("click", closeModal);
  btnDone?.addEventListener("click", closeModal);
  btnSendClose?.addEventListener("click", closeSendModal);
  btnSendCancel?.addEventListener("click", closeSendModal);

  async function loadShares(version) {
    const { data: shares, error } = await sb().rpc("control_device_shares_list", {
      p_game_id: game.id, p_device_type: _deviceType,
    });
    if (version !== renderVersion) return null;
    if (error) { showMessage(t("control.shareDeviceModal.failed"), { state: "error" }); return null; }
    return shares || [];
  }

  // Okno „Udostępnienia”: lista w tej sesji z cofaniem.
  async function renderModal() {
    const version = ++renderVersion;
    clearMessage();
    cooldownTicker.resetBindings();
    const current = await loadShares(version);
    if (!current || !currentWrap || !currentCont) return;
    currentWrap.hidden = false;
    currentCont.replaceChildren();
    if (!current.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = t("control.shareDeviceModal.noneCurrent");
      currentCont.appendChild(empty);
    }
    for (const share of current) {
      const revoke = async () => {
        const { data, error } = await sb().rpc("control_device_share_revoke", { p_share_id: share.share_id });
        if (error || !data?.ok) { showMessage(error?.message || data?.error || t("common.genericError"), { state: "error" }); return; }
        await renderModal();
        await refreshBadges();
      };
      const recipientKind = share.recipient_kind === "friend" ? "friend" : share.recipient_kind === "account" ? "account" : "mail";
      const kind = t(`control.shareDeviceModal.recipientKind.${recipientKind}`);
      const row = shareRowEl({
        label: share.recipient_username || share.recipient_email || "—",
        tags: [{ text: kind, cls: "tag--muted" }],
        actions: [{ key: "revoke", icon: "trash", title: t("bases.share.remove"), onClick: revoke }],
      });
      row.classList.add("shareDeviceRecipientRow", "shareRow--compact");
      const { element: cooldown, labelEl: countdown } = shareCooldownEl();
      row.querySelector(".shareRowActions")?.prepend(cooldown);
      if (share.cooldown_until && Date.parse(share.cooldown_until) > Date.now()) {
        cooldownTicker.bind({ key: `shared:${share.share_id}`, labelEl: countdown, disableEls: [], onTick: (_, active) => { cooldown.hidden = !active; } });
        cooldownTicker.setEndMs(`shared:${share.share_id}`, Date.parse(share.cooldown_until));
      }
      currentCont.appendChild(row);
    }
  }

  // Okno „Udostępnij”: znajomi do zaznaczenia (bez tych, którzy już mają dostęp).
  async function renderSendModal() {
    const version = ++renderVersion;
    preflightVersion++;
    const deviceType = _deviceType;
    clearMessage();
    cooldownTicker.resetBindings();
    const current = await loadShares(version);
    if (!current || !subsList) return;
    const { data: friends, error: friendsError } = await sb().rpc("friends_list");
    if (version !== renderVersion) return;
    if (friendsError) {
      subsList.replaceChildren();
      updateSelection();
      showMessage(t("control.shareDeviceModal.failed"), { state: "error" });
      return;
    }
    const already = new Set(current.filter((s) => s.recipient_id).map((s) => s.recipient_id));
    const activeFriends = (friends || []).filter((f) => f.status === "active" && f.direction === "friend" && !already.has(f.user_id));
    subsList.replaceChildren();
    bulkHost?.replaceChildren();
    bulkActions = shareBulkActionsEl({
      onSelectAll: () => {
        subsList.querySelectorAll('input[type="checkbox"]:not(:disabled)').forEach((input) => { input.checked = true; });
        updateSelection();
      },
      onDeselectAll: () => {
        subsList.querySelectorAll('input[type="checkbox"]').forEach((input) => { input.checked = false; });
        updateSelection();
      },
    });
    bulkHost?.replaceChildren(bulkActions.element);
    if (!activeFriends.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = t("control.shareDeviceModal.noFriends");
      subsList.appendChild(empty);
    }
    for (const friend of activeFriends) {
      const row = document.createElement("label");
      row.className = "shareRow shareRow--compact shareDeviceFriendRow";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = friend.user_id;
      checkbox.dataset.email = friend.email || "";
      checkbox.addEventListener("change", updateSelection);
      const name = document.createElement("span");
      name.className = "shareEmail";
      name.textContent = friend.label || friend.email || "—";
      const { element: cooldown, labelEl: countdown } = shareCooldownEl();
      const main = document.createElement("div");
      main.className = "shareMain";
      main.append(name);
      row.append(checkbox, main, cooldown);
      subsList.appendChild(row);
      const { data: preflight } = await sb().rpc("control_device_share_preflight", {
        p_game_id: game.id, p_device_type: deviceType, p_recipient_user_id: friend.user_id,
      });
      const nextAllowedAtMs = preflight?.mail_disabled ? 0 : Date.parse(preflight?.cooldown_until) || 0;
      const ok = preflight?.mail_allowed !== false || preflight?.mail_disabled;
      if (version !== renderVersion) return;
      if (!ok && nextAllowedAtMs) {
        cooldownTicker.bind({ key: `device:${friend.user_id}`, labelEl: countdown, disableEls: [], onTick: (_, active) => {
          cooldown.hidden = !active;
          row.classList.toggle("is-cooling-down", active);
        } });
        cooldownTicker.setEndMs(`device:${friend.user_id}`, nextAllowedAtMs);
      }
    }
    updateSelection();
  }

  // Jeden przycisk „Udostępnij” dla wpisanego adresu i zaznaczonych znajomych:
  // licznik w etykiecie to liczba odbiorców, przycisk aktywny, gdy jest komu.
  function updateSelection() {
    const inputs = subsList?.querySelectorAll('input[type="checkbox"]') || [];
    const selected = subsList?.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)').length || 0;
    const raw = String(emailInp?.value || "").trim();
    const recipients = selected + (raw ? 1 : 0);
    if (btnAdd) btnAdd.disabled = shareInFlight || lookupBlocked || !recipients;
    if (btnAddLabel) btnAddLabel.textContent = recipients > 1 ? t("baseSharePanel.shareN", { n: recipients }) : t("control.shareDevice");
    bulkActions?.update(inputs);
  }

  // Dostęp powstaje niezależnie od e-maila; stan zwrotny rozróżnia wysłanie,
  // cooldown, wyłączone powiadomienia i istniejący już grant.
  async function doShare({ friendId, lookup }) {
    const { data, error } = await sb().rpc(friendId ? "control_device_share_to_friend" : "control_device_share_create_by_lookup", {
      ...(friendId ? { p_friend_id: friendId } : { p_lookup: lookup }),
      p_device_type: _deviceType,
      p_game_id: game.id,
    });
    const res = data;
    if (error || !res?.ok) throw new Error(shareErrorMessage(res?.error));

    // Grant jest unikalny dla odbiorcy, urządzenia i sesji Control.
    if (!res?.created) return "already";
    if (!res?.mail_allowed) {
      if (res?.cooldown_until) cooldownTicker.setEndMs(`device:${friendId || lookup}`, Date.parse(res.cooldown_until) || 0);
      return res?.mail_disabled ? "disabled" : false;
    }

    const queued = await sendShareEmail(res.token);
    return queued ? true : "disabled";
  }

  // Udostępnia naraz wpisanemu adresowi (jeśli jest) i zaznaczonym znajomym;
  // po udanej wysyłce okno się zamyka (jak „Wyślij” w Grach), błąd zostawia je otwarte.
  btnAdd?.addEventListener("click", async () => {
    if (shareInFlight) return;
    clearMessage();
    const raw = String(emailInp?.value || "").trim();
    const selected = [...(subsList?.querySelectorAll('input[type="checkbox"]:checked:not(:disabled)') || [])].map((item) => item.value);
    if (!raw && !selected.length) return;
    shareInFlight = true; updateSelection();
    try {
      let cooldown = false, disabled = false, already = false;
      if (raw) {
        const result = await doShare({ lookup: raw });
        if (emailInp) emailInp.value = "";
        cooldown ||= result === false; disabled ||= result === "disabled"; already ||= result === "already";
      }
      for (const friendId of selected) {
        const result = await doShare({ friendId });
        cooldown ||= result === false; disabled ||= result === "disabled";
      }
      shareInFlight = false;
      closeSendModal();
      await refreshBadges();
      if (cooldown) showMessage(t("control.shareDeviceModal.friendMailCooldown"));
      else if (disabled) showMessage(t("contacts.friendMailDisabled"));
      else if (already) showMessage(t("control.shareDeviceModal.alreadyShared"));
      else toast(t("control.shareDeviceModal.mailSent"));
    } catch (e) {
      shareInFlight = false;
      await renderSendModal();
      showMessage(e?.message || t("common.genericError"), { state: "error" });
    } finally {
      shareInFlight = false;
      updateSelection();
    }
  });
  emailInp?.addEventListener("input", () => {
    const version = ++preflightVersion;
    const raw = String(emailInp.value || "").trim();
    clearMessage();
    lookupBlocked = false;
    updateSelection();
    if (!raw) return;
    setTimeout(async () => {
      if (version !== preflightVersion || raw !== String(emailInp.value || "").trim()) return;
      const { data, error } = await sb().rpc("control_device_share_preflight_by_lookup", {
        p_game_id: game.id, p_device_type: _deviceType, p_lookup: raw,
      });
      if (version !== preflightVersion || error) return;
      if (!data?.ok) {
        if (data?.error === "notifications_disabled") {
          showMessage(shareErrorMessage(data.error), { state: "error" });
          lookupBlocked = true; updateSelection();
        }
        return;
      }
      if (data.already_shared) {
        showMessage(t("control.shareDeviceModal.alreadyShared"));
        lookupBlocked = true; updateSelection();
      } else if (data.mail_disabled) {
        showMessage(t("control.shareDeviceModal.recipientDisabled"));
      } else if (data.mail_allowed === false && data.cooldown_until) {
        const until = Date.parse(data.cooldown_until) || 0;
        const remaining = Math.max(0, until - Date.now());
        const time = formatCooldownRemaining(remaining);
        showMessage(t("control.shareDeviceModal.mailCooldownRemaining", { time }) || `E-mail będzie można wysłać za ${time}.`);
      }
    }, 300);
  });
  emailInp?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); btnAdd?.click(); } });

  const deviceKinds = ["display", "host", "buzzer"];

  async function open(kind) {
    if (!deviceKinds.includes(kind)) return;
    _deviceType = kind;
    if (titleEl) titleEl.textContent = `${t("control.shareDeviceShares")} — ${deviceTypeLabel(kind)}`;
    openDialog(overlay, { onClose: closeModal });
    await renderModal();
  }

  async function openSend(kind) {
    if (!deviceKinds.includes(kind)) return;
    _deviceType = kind;
    if (sendTitleEl) sendTitleEl.textContent = `${t("control.shareDeviceModal.title")} — ${deviceTypeLabel(kind)}`;
    if (emailInp) emailInp.value = "";
    lookupBlocked = false;
    updateSelection();
    openDialog(sendOverlay, { onClose: closeSendModal });
    await renderSendModal();
  }

  async function refreshBadges() {
    try {
      const badges = {};
      for (const kind of deviceKinds) {
        const { data } = await sb().rpc("control_device_shares_list", { p_game_id: game.id, p_device_type: kind });
        badges[kind] = (data || []).length;
      }
      onBadgesChanged?.(badges);
      return badges;
    } catch {
      return {};
    }
  }

  return { open, openSend, isGuest, refreshBadges };
}
