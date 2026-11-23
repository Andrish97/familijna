// Narzędzia czatu AI: znajomi i subskrybenci (lista, zaproszenie).
import { rpc } from "./common.js";
import { createContactInvite, sendContactInviteMail } from "../../core/contact-invite.js";

export default [
  {
    name: "list_contacts",
    description: "List the user's friends (accounts) or subscribers (e-mail addresses that get polls).",
    inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["friends", "subscribers"] } }, required: ["kind"] },
    readOnly: true,
    async run({ kind }) {
      return rpc("contacts_list", { p_kind: kind });
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
        const { data, mail } = await createContactInvite(kind, value);
        let mailSent = false;
        if (mail) mailSent = await sendContactInviteMail(kind, mail);
        ctx.changed({ type: "contacts", id: kind });
        return { ok: true, already: !!data?.already, mail_sent: mailSent };
      } catch (e) {
        return { ok: false, error: e?.result?.err || e?.result?.error || e?.message || String(e) };
      }
    },
  },
];
