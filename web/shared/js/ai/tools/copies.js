// Narzędzia czatu AI: kopie gier, logo i baz — „Wyślij” znajomym, „Duplikuj”,
// otrzymane kopie (przyjmij/odrzuć). Wysyłka i duplikowanie przez Workera
// (ctx.resourceAction — te same /_api/resource-send|duplicate co przyciski),
// mail z kopią przez send-mail (copy:send), decyzja przez resource_copy_decide.
import { uuid, uuidList, rpc } from "./common.js";

const newRequestId = () => globalThis.crypto.randomUUID();

export default [
  {
    name: "send_copy",
    description: "Send a copy of the user's game or logo to friends (button “Send”). Each friend gets the copy to accept within 5 days (and an e-mail when allowed); the original stays unchanged. Friends' user_id: list_contacts kind=friends (status active). Some items cannot be sent (e.g. demo files) — the error says why.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["game", "logo"] },
        source_id: { ...uuid, description: "Game id (list_games) or logo id (list_logos)." },
        friend_user_ids: { ...uuidList, description: "user_id of friends (status active)." },
      },
      required: ["kind", "source_id", "friend_user_ids"],
    },
    confirm: () => "send",
    async run({ kind, source_id, friend_user_ids }, ctx) {
      const results = [];
      for (const recipient_id of [...new Set(friend_user_ids || [])]) {
        const res = await ctx.resourceAction("send", { kind, source_id, recipient_id, request_id: newRequestId(), language: ctx.lang });
        let mailSent = false;
        if (res?.ok && res.mail_allowed && res.go_token) {
          try { mailSent = await ctx.sendNotificationMail({ action: "copy:send", token: res.go_token }); } catch { mailSent = false; }
        }
        results.push(res?.ok ? { friend_user_id: recipient_id, ok: true, mail_sent: mailSent } : { friend_user_id: recipient_id, ok: false, error: res?.error || "copy_failed" });
      }
      return { results };
    },
  },
  {
    name: "duplicate",
    description: "Make a copy of the user's own game, question base or logo in their account (button “Duplicate”); the copy gets a free name like “Name (2)”.",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["game", "base", "logo"] }, source_id: uuid },
      required: ["kind", "source_id"],
    },
    async run({ kind, source_id }, ctx) {
      const res = await ctx.resourceAction("duplicate", { kind, source_id, request_id: newRequestId(), language: ctx.lang });
      if (res?.ok) ctx.changed({ type: kind, id: source_id });
      return res;
    },
  },
  {
    name: "list_received_copies",
    description: "Copies of games and logos that friends sent to the user and that wait for a decision (offer id, kind, name, sender, expiry after 5 days).",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["game", "logo"], description: "Omit for both." } } },
    readOnly: true,
    async run({ kind }, ctx) {
      const res = await rpc(ctx, "resource_copy_inbox", { p_kind: kind || null });
      if (!res?.ok) return res;
      return { copies: (res.items || []).map((i) => ({ offer_id: i.id, kind: i.resource_kind, name: i.name, sender: i.sender_label, expires_at: i.expires_at, game_id: i.game_id, logo_id: i.logo_id })) };
    },
  },
  {
    name: "answer_received_copy",
    description: "Accept a received copy (it becomes the user's own game or logo) or decline it (the copy is deleted). offer_id from list_received_copies.",
    inputSchema: {
      type: "object",
      properties: { offer_id: uuid, decision: { type: "string", enum: ["accept", "decline"] } },
      required: ["offer_id", "decision"],
    },
    confirm: ({ decision }) => (decision === "decline" ? "irreversible" : null),
    async run({ offer_id, decision }, ctx) {
      const res = await rpc(ctx, "resource_copy_decide", { p_offer: offer_id, p_decision: decision });
      if (res?.ok) ctx.changed({ type: "copy", id: offer_id });
      return res;
    },
  },
];
