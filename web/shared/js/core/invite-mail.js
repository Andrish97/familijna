// Maile zaproszeń (znajomi, subskrybenci) i kopii zasobów (E19): treść buduje
// funkcja Edge send-mail z szablonów serwera; tutaj tylko akcja i token.
import { sendNotificationMail } from "./notify-mail.js";

// kind: "friend" | "subscriber"; token: z linku /go/?f=… albo /go/?s=…
export async function sendInviteMail({ token, kind = "subscriber", actionKey, reminder = false }) {
  const friend = kind === "friend";
  const action = actionKey || (friend ? "friend:invite" : "poll:resend");
  return sendNotificationMail(friend ? { action, token } : { action, token, reminder: !!reminder });
}

export async function sendResourceCopyMail({ token }) {
  return sendNotificationMail({ action: "copy:send", token });
}
