// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: znajomi i subskrybenci (lista, zaproszenie, odpowiedź,
// usunięcie) — te same RPC co strony Znajomi i Subskrybenci.
import { rpc } from "./common.js";

export default [
  {
    name: "list_contacts",
    description: "List the user's friends (accounts) or subscribers (e-mail addresses that get polls). Each row has id and label; friends also user_id, status and direction: status active + direction friend = a friend; status pending + direction incoming = an invitation waiting for the user's answer; pending + outgoing = sent by the user; declined = refused (can be undone for 30 days).",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["friends", "subscribers"] } }, required: ["kind"] },
    readOnly: true,
    async run({ kind }, ctx) {
      return rpc(ctx, "contacts_list", { p_kind: kind });
    },
  },
  {
    name: "invite_contact",
    description: "Invite a friend (by user name or e-mail) or add a subscriber (by e-mail). The person gets an invitation (and an e-mail when allowed).",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["friend", "subscriber"] }, value: { type: "string", description: "User name or e-mail (subscriber: e-mail)." } },
      required: ["kind", "value"],
    },
    confirm: () => "send",
    async run({ kind, value }, ctx) {
      try {
        const res = await ctx.inviteContact(kind, value);
        ctx.changed({ type: "contacts", id: kind });
        return { ok: true, already: !!res?.already, mail_sent: !!res?.mailSent };
      } catch (e) {
        return { ok: false, error: e?.result?.err || e?.result?.error || e?.message || String(e) };
      }
    },
  },
  {
    name: "manage_contact",
    description: "Act on a contact row (id from list_contacts). Friends: accept or reject an incoming invitation, cancel an outgoing one, remove a friend, resend an outgoing invitation, undo_reject (bring back a declined invitation or removed friend within 30 days, then accept it). Subscribers: remove, resend the invitation. Resending has a waiting time (resend_available_at).",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["friends", "subscribers"] },
        id: { type: "string", description: "Row id from list_contacts." },
        action: { type: "string", enum: ["accept", "reject", "cancel", "remove", "resend", "undo_reject"] },
      },
      required: ["kind", "id", "action"],
    },
    confirm: ({ action }) => (["accept", "undo_reject"].includes(action) ? null : action === "resend" ? "send" : "irreversible"),
    async run({ kind, id, action }, ctx) {
      const friends = kind === "friends";
      if (!friends && !["remove", "resend"].includes(action)) return { ok: false, error: "subscribers_support_only_remove_and_resend" };
      if (!["accept", "reject", "cancel", "remove", "resend", "undo_reject"].includes(action)) return { ok: false, error: "invalid_action" };
      const fn = friends ? `friends_${action}` : action === "resend" ? "polls_hub_subscriber_resend" : "polls_hub_subscriber_remove";
      const res = await rpc(ctx, fn, { p_id: id });
      if (action === "resend" && res?.ok !== false) {
        // mail z linkiem /go/?f=… (znajomy) albo /go/?s=… (subskrybent), jak contacts-page.js
        let token = "";
        try { token = new URL(String(res?.link || ""), "https://x.invalid").searchParams.get(friends ? "f" : "s") || ""; } catch { token = ""; }
        let mailSent = false;
        if (token) {
          try { mailSent = await ctx.sendNotificationMail(friends ? { action: "friend:resend", token } : { action: "poll:resend", token, reminder: true }); } catch { mailSent = false; }
        }
        return { ok: true, mail_sent: mailSent };
      }
      if (res?.ok !== false) ctx.changed({ type: "contacts", id: kind });
      return res ?? { ok: true };
    },
  },
];
