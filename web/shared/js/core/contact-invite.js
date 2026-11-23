// Zaproszenie znajomego (nazwa użytkownika albo e-mail) lub subskrybenta
// (e-mail) — wspólne dla stron Znajomi/Subskrybenci i czatu AI (E30).
// Dwa kroki jak dotąd: RPC zapisuje zaproszenie, potem (gdy wolno) mail.
import { sb } from "./supabase.js";
import { goLinkToken } from "./notify-mail.js";
import { sendInviteMail } from "./invite-mail.js";

async function call(name, args) {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  if (data?.ok === false) throw Object.assign(new Error(data.err || data.error), { result: data });
  return data;
}

/**
 * Krok 1: zaproszenie w bazie. Zwraca { data, mail } — mail (albo null)
 * do wysłania przez sendContactInviteMail. Odmowa: wyjątek z polem result.
 * @param {"friend"|"subscriber"} kind
 */
export async function createContactInvite(kind, value) {
  const friends = kind === "friend";
  const data = await call(friends ? "friends_invite" : "subscribers_invite", friends ? { p_handle: value } : { p_email: value });
  let mail = null;
  if (friends && data.mail_allowed) mail = { token: data.token, actionKey: "friend:invite" };
  if (!friends && !data.already) {
    const resent = await call("polls_hub_subscriber_resend", { p_id: data.id });
    if (resent?.mail_allowed) mail = { token: goLinkToken(resent.link, "s") };
  }
  return { data, mail };
}

/** Krok 2: mail zaproszenia. true = wysłany, false = pominięty (powiadomienia wyłączone). */
export async function sendContactInviteMail(kind, mail) {
  if (!mail?.token) return false;
  return sendInviteMail({ ...mail, kind: kind === "friend" ? "friend" : "subscriber" });
}
