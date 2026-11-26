// Narzędzia czatu AI: znajomi i subskrybenci (lista, zaproszenie, odpowiedź,
// usunięcie) — te same RPC co strony Znajomi i Subskrybenci.
import { rpc } from "./common.js";

export default [
  {
    name: "list_contacts",
    description: "List the user's friends (accounts) or subscribers (e-mail addresses that get polls). Each row has id; friends also user_id, status (pending/accepted/declined) and direction (incoming = an invitation waiting for the user's answer, outgoing = sent by the user).",
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
    description: "Act on a contact row (id from list_contacts). Friends: accept or reject an incoming invitation, cancel an outgoing one, remove a friend. Subscribers: remove.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["friends", "subscribers"] },
        id: { type: "string", description: "Row id from list_contacts." },
        action: { type: "string", enum: ["accept", "reject", "cancel", "remove"] },
      },
      required: ["kind", "id", "action"],
    },
    confirm: ({ action }) => (action === "accept" ? null : "irreversible"),
    async run({ kind, id, action }, ctx) {
      const friends = kind === "friends";
      if (!friends && action !== "remove") return { ok: false, error: "subscribers_support_only_remove" };
      if (!["accept", "reject", "cancel", "remove"].includes(action)) return { ok: false, error: "invalid_action" };
      const res = await rpc(ctx, friends ? `friends_${action}` : "polls_hub_subscriber_remove", { p_id: id });
      if (res?.ok !== false) ctx.changed({ type: "contacts", id: kind });
      return res ?? { ok: true };
    },
  },
];
