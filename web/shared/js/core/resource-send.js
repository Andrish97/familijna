import { sb } from "./supabase.js?v=v2026-11-05T19143";
import { getUiLang, t } from "../../translation/translation.js?v=v2026-11-05T19143";
import { toast } from "./toast.js?v=v2026-11-05T19143";
import { sendResourceCopyMail } from "./invite-mail.js?v=v2026-11-05T19143";
import { icon, iconText } from "./icons.js?v=v2026-11-05T19143";
import { openDialog, closeDialog, setOverlayOpen } from "./modal-sheet.js?v=v2026-11-05T19143";
import { attachListTools } from "./share-sections.js?v=v2026-11-05T19143";
import { emptyState } from "./empty-state.js?v=v2026-11-05T19143";


const attempts = new Map();

function getDialog() {
  let overlay = document.getElementById("resourceSendOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "resourceSendOverlay";
  overlay.className = "overlay modal--sheet resource-send-overlay";
  setOverlayOpen(overlay, false);
  overlay.innerHTML = `
    <div class="modal modal--medium shareModal resource-send-modal" role="dialog" aria-modal="true" aria-labelledby="resourceSendTitle">
      <div class="mHead">
        <h2 class="mTitle" id="resourceSendTitle"></h2>
        <button class="btn sm" type="button" data-close aria-label=""></button>
      </div>
      <p class="mSub resource-send-name"></p>
      <section class="shareSection resource-send-friends-section">
        <div class="shareSectionHeading"><div class="section-title" data-friends-title></div></div>
        <div class="shareList resource-send-friends" role="group"></div>
      </section>
      <details class="shareSection resource-send-history">
        <summary class="section-title" data-history-title></summary>
        <div class="shareList resource-send-history-list"></div>
      </details>
      <p class="resource-send-error" role="status" aria-live="polite"></p>
      <div class="modal-actions resource-send-actions">
        <button class="btn sm" type="button" data-cancel></button>
        <button class="btn sm gold" type="button" data-send></button>
      </div>
    </div>`;

  const close = () => closeDialog(overlay);
  overlay.querySelector("[data-close]").addEventListener("click", close);
  overlay.querySelector("[data-cancel]").addEventListener("click", close);
  (document.querySelector("main.wrap") || document.body).append(overlay);
  attachListTools(overlay.querySelector(".resource-send-friends-section .shareSectionHeading"), overlay.querySelector(".resource-send-friends"), "resource-send-friends");
  return overlay;
}

function setDialogLabels(overlay) {
  overlay.querySelector("#resourceSendTitle").textContent = t("resourceSend.title");
  overlay.querySelector("[data-close]").setAttribute("aria-label", t("common.modal.closeLabel"));
  overlay.querySelector("[data-close]").innerHTML = icon("close");
  overlay.querySelector("[data-friends-title]").textContent = t("resourceSend.selectFriends");
  overlay.querySelector(".resource-send-friends").setAttribute("aria-label", t("resourceSend.selectFriends"));
  overlay.querySelector("[data-history-title]").textContent = t("resourceSend.history");
  overlay.querySelector("[data-cancel]").innerHTML = iconText("close", t("common.cancel"));
  overlay.querySelector("[data-send]").innerHTML = iconText("envelope-out", t("resourceSend.action"));
}

function addFriendRow(list, friend) {
  const label = document.createElement("label");
  label.className = "shareRow resource-send-friend";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = friend.user_id;
  const name = document.createElement("span");
  name.className = "resource-send-friend-name";
  name.textContent = friend.label || friend.email || "";
  label.append(input, name);
  list.append(label);
}

export function bindResourceSend({ button, kind, getSource, onDone, onState }) {
  if (!button) return;

  button.addEventListener("click", async () => {
    const source = getSource();
    if (button.disabled || button.dataset.sendBusy || !source?.id) return;
    button.dataset.sendBusy = "1";
    button.disabled = true;

    try {
      const { data, error } = await sb().rpc("friends_list");
      if (error) throw error;
      const friends = (data || []).filter(row => row.direction === "friend" && row.status === "active" && row.user_id);
      const overlay = getDialog();
      const list = overlay.querySelector(".resource-send-friends");
      const errorNode = overlay.querySelector(".resource-send-error");
      const history = overlay.querySelector(".resource-send-history");
      const historyList = overlay.querySelector(".resource-send-history-list");
      const submit = overlay.querySelector("[data-send]");

      setDialogLabels(overlay);
      overlay.querySelector(".resource-send-name").textContent = source.name || "";
      errorNode.textContent = "";
      list.replaceChildren();
      historyList.replaceChildren();

      const historyResult = await sb().rpc("resource_copy_history", { p_kind: kind, p_source: source.id });
      const historyItems = historyResult.error ? [] : historyResult.data?.items || [];
      history.hidden = !historyItems.length;
      for (const item of historyItems) {
        const entry = document.createElement("div");
        entry.className = "shareRow resource-send-history-row";
        entry.textContent = `${item.recipient_label} · ${new Date(item.sent_at).toLocaleString()}`;
        historyList.append(entry);
      }

      if (!friends.length) {
        list.append(emptyState(t("resourceSend.noFriends"), { hook: "resource-send-empty" }));
      }
      for (const friend of friends) addFriendRow(list, friend);
      submit.disabled = !friends.length;

      submit.onclick = async () => {
        const ids = [...list.querySelectorAll("input:checked")].map(input => input.value);
        if (!ids.length) return;
        submit.disabled = true;
        errorNode.textContent = "";

        try {
          const { data: sessionData, error: sessionError } = await sb().auth.getSession();
          if (sessionError || !sessionData.session) throw new Error("auth_required");

          for (const recipient_id of ids) {
            const key = `${sessionData.session.user.id}:${kind}:${source.id}:${recipient_id}`;
            if (!attempts.has(key)) attempts.set(key, crypto.randomUUID());
            const response = await fetch("/_api/resource-send", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${sessionData.session.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ kind, source_id: source.id, recipient_id, request_id: attempts.get(key), language: getUiLang() }),
            });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "copy_failed");
            attempts.delete(key);

            if (result.mail_allowed && result.go_token) {
              try {
                const sent = await sendResourceCopyMail({ token: result.go_token });
                if (!sent) throw new Error("mail_not_sent");
              } catch (mailError) {
                console.warn("[resource-copy-mail] email delivery failed:", mailError);
                toast(t("resourceSend.mailFailed"), { kind: "error" });
              }
            }
          }

          closeDialog(overlay);
          toast(t("resourceSend.sent", { count: ids.length }));
          await onDone?.();
        } catch (sendError) {
          // t() zwraca sam klucz, gdy nie ma tekstu dla kodu (np. copy_failed) -- wtedy ogólny komunikat.
          const errorKey = `resourceSend.errors.${sendError.message}`;
          const errorText = t(errorKey);
          errorNode.textContent = errorText && errorText !== errorKey ? errorText : t("resourceSend.errors.failed");
        } finally {
          submit.disabled = false;
          onState?.();
        }
      };

      openDialog(overlay, { historyKey: null });
    } catch (openError) {
      toast(t("resourceSend.errors.failed"), { kind: "error" });
      console.warn("[resource-send]", openError);
    } finally {
      delete button.dataset.sendBusy;
      button.disabled = false;
      onState?.();
    }
  });
}
