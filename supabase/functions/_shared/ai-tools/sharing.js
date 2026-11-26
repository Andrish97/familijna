// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: udostępnianie baz pytań (okno „Udostępnij” na stronie
// Bazy) i propozycje udostępnienia od innych. Te same RPC co strona; mail
// z udostępnieniem przez send-mail (base:share, token z linku /go/?b=…).
import { uuid, uuidList, rpc } from "./common.js";

const ROLES = ["editor", "viewer"];
const one = (data) => (Array.isArray(data) ? data[0] : data);
const linkToken = (link, param) => {
  try { return new URL(String(link || ""), "https://x.invalid").searchParams.get(param) || ""; } catch { return ""; }
};

export default [
  {
    name: "get_base_sharing",
    description: "Who has access to the user's own question base: people with access (user_id, role), pending or declined invitations (task_id, role, status), and friends that can be invited (user_id).",
    inputSchema: { type: "object", properties: { base_id: uuid }, required: ["base_id"] },
    readOnly: true,
    async run({ base_id }, ctx) {
      const res = await rpc(ctx, "base_share_panel", { p_base_id: base_id });
      if (!res?.ok) return { ok: false, error: res?.err || "failed" };
      const person = (x) => ({ user_id: x.user_id ?? x.recipient_user_id, name: x.label, role: x.role, status: x.status, task_id: x.task_id, expires_at: x.expires_at });
      return {
        with_access: (res.active || []).map(person),
        invitations: (res.outgoing || []).map(person),
        friends: (res.friends || []).map((f) => ({ user_id: f.user_id, name: f.label })),
      };
    },
  },
  {
    name: "share_base",
    description: "Share the user's own question base: invite friends (user_id from get_base_sharing) and/or one account by user name or e-mail. Role: editor (can change questions) or viewer (read and copy only). Each person gets a proposal to accept (and an e-mail when allowed).",
    inputSchema: {
      type: "object",
      properties: {
        base_id: uuid,
        friend_user_ids: uuidList,
        user_lookup: { type: "string", description: "User name or e-mail of an account (optional)." },
        role: { type: "string", enum: ROLES },
      },
      required: ["base_id", "role"],
    },
    confirm: () => "send",
    async run({ base_id, friend_user_ids = [], user_lookup = "", role }, ctx) {
      if (!ROLES.includes(role)) return { ok: false, error: "invalid_role" };
      const targets = [...(String(user_lookup).trim() ? [{ lookup: String(user_lookup).trim() }] : []), ...[...new Set(friend_user_ids)].map((id) => ({ id }))];
      if (!targets.length) return { ok: false, error: "no_recipients" };
      const results = [];
      for (const target of targets) {
        const row = one(await rpc(ctx, target.id ? "base_share_to_friend" : "base_share_by_user", target.id
          ? { p_base_id: base_id, p_recipient_user_id: target.id, p_role: role }
          : { p_base_id: base_id, p_user_lookup: target.lookup, p_role: role }));
        const who = target.id ? { friend_user_id: target.id } : { user: target.lookup };
        if (!row?.ok) { results.push({ ...who, ok: false, error: row?.err || row?.error || "failed" }); continue; }
        let mailSent = false;
        const token = linkToken(row.mail_link, "b");
        if (token) { try { mailSent = await ctx.sendNotificationMail({ action: "base:share", token }); } catch { mailSent = false; } }
        results.push({ ...who, ok: true, mail_sent: mailSent });
      }
      ctx.changed({ type: "base", id: base_id });
      return { results };
    },
  },
  {
    name: "change_base_share_role",
    description: "Change the role (editor/viewer) of a person with access (user_id) or of a pending invitation (task_id) in the user's own base.",
    inputSchema: {
      type: "object",
      properties: { base_id: uuid, user_id: uuid, task_id: uuid, role: { type: "string", enum: ROLES } },
      required: ["base_id", "role"],
    },
    async run({ base_id, user_id, task_id, role }, ctx) {
      if (!user_id && !task_id) return { ok: false, error: "user_id_or_task_id_required" };
      const res = one(await rpc(ctx, user_id ? "update_base_share_role" : "base_share_update_invite_role", user_id
        ? { p_base_id: base_id, p_user_id: user_id, p_role: role }
        : { p_task_id: task_id, p_role: role }));
      if (res?.ok) ctx.changed({ type: "base", id: base_id });
      return res?.ok ? { ok: true } : { ok: false, error: res?.err || res?.error || "failed" };
    },
  },
  {
    name: "unshare_base",
    description: "Take away a person's access to the user's own base (user_id) or cancel a pending invitation (task_id). Can be shared again later.",
    inputSchema: { type: "object", properties: { base_id: uuid, user_id: uuid, task_id: uuid }, required: ["base_id"] },
    async run({ base_id, user_id, task_id }, ctx) {
      if (!user_id && !task_id) return { ok: false, error: "user_id_or_task_id_required" };
      const ok = await rpc(ctx, user_id ? "revoke_base_share" : "base_share_cancel_task", user_id
        ? { p_base_id: base_id, p_user_id: user_id } : { p_task_id: task_id });
      if (ok === true || ok?.ok) ctx.changed({ type: "base", id: base_id });
      return { ok: ok === true || !!ok?.ok };
    },
  },
  {
    name: "answer_base_share",
    description: "Accept or decline a question base someone proposed to share with the user (task_id from list_bases, proposed = true).",
    inputSchema: {
      type: "object",
      properties: { task_id: uuid, decision: { type: "string", enum: ["accept", "decline"] } },
      required: ["task_id", "decision"],
    },
    async run({ task_id, decision }, ctx) {
      const ok = await rpc(ctx, decision === "accept" ? "base_share_accept" : "base_share_decline", { p_task_id: task_id });
      if (ok === true) ctx.changed({ type: "base", id: task_id });
      return { ok: ok === true };
    },
  },
  {
    name: "leave_shared_base",
    description: "Leave a question base shared with the user by someone else (the user loses access; the owner can share it again).",
    inputSchema: { type: "object", properties: { base_id: uuid }, required: ["base_id"] },
    confirm: () => "irreversible",
    async run({ base_id }, ctx) {
      const ok = await rpc(ctx, "leave_shared_base", { p_base_id: base_id });
      if (ok === true) ctx.changed({ type: "base", id: base_id });
      return { ok: ok === true };
    },
  },
  {
    name: "remind_base_share",
    description: "Remind a person about a pending invitation to the user's base (task_id from get_base_sharing invitations); there is a waiting time between reminders.",
    inputSchema: { type: "object", properties: { task_id: uuid }, required: ["task_id"] },
    confirm: () => "send",
    async run({ task_id }, ctx) {
      const res = one(await rpc(ctx, "base_share_resend", { p_task_id: task_id }));
      if (!res?.ok) return { ok: false, error: res?.err || res?.error || "failed", cooldown_until: res?.cooldown_until };
      let mailSent = false;
      const token = linkToken(res.mail_link, "b");
      if (res.mail_allowed && token) { try { mailSent = await ctx.sendNotificationMail({ action: "base:share", token, reminder: true }); } catch { mailSent = false; } }
      return { ok: true, mail_sent: mailSent };
    },
  },
  {
    name: "undo_base_decline",
    description: "Bring back a base invitation the user declined (within 30 days); then it can be accepted with answer_base_share.",
    inputSchema: { type: "object", properties: { task_id: uuid }, required: ["task_id"] },
    async run({ task_id }, ctx) {
      const res = one(await rpc(ctx, "base_share_undo_decline", { p_task_id: task_id }));
      ctx.changed({ type: "base", id: task_id });
      return res?.ok === false ? { ok: false, error: res.err || res.error } : { ok: true };
    },
  },
];
