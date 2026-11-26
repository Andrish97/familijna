// Wygenerowane przez scripts/sync-ai-tools.mjs z web/shared/js/ai/tools — nie edytować.
// Narzędzia czatu AI: ustawienia konta, które AI może zmienić na polecenie
// (spis czat-ai-czynnosci.md, rozdział 5). Hasła, e-mail, usunięcie konta,
// klucze AI i ocena — nigdy przez AI (tylko wskazanie: show_on_page account).
import { rpc } from "./common.js";

export default [
  {
    name: "set_email_notifications",
    description: "Turn the user's e-mail notifications on or off (invitations, tasks, shared bases, copies). Items still appear in the service when off.",
    inputSchema: { type: "object", properties: { enabled: { type: "boolean" } }, required: ["enabled"] },
    async run({ enabled }, ctx) {
      if (!ctx.userId) return { ok: false, error: "not_authenticated" };
      await rpc(ctx, "set_my_email_notifications", { p_user_id: ctx.userId, p_enabled: !!enabled });
      return { ok: true, enabled: !!enabled };
    },
  },
  {
    name: "restore_demo",
    description: "Restore the demo games, question bases and logos in the user's language. Replaces existing demo items, also ones the user changed (duplicate them first to keep changes).",
    inputSchema: { type: "object", properties: {} },
    confirm: () => "irreversible",
    async run(_args, ctx) {
      await rpc(ctx, "restore_my_demo", { p_lang: ctx.lang });
      ctx.changed({ type: "game", id: "demo" });
      return { ok: true };
    },
  },
];
