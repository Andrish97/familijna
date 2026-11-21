// Maile powiadomień (zaproszenia, udostępnienia, kopie, ankiety): przeglądarka
// wskazuje tylko akcję i token powiadomienia z linku /go/; treść, odbiorcę
// i linki buduje funkcja Edge send-mail z danych w bazie (audyt E24).
import { sb, SUPABASE_URL } from "./supabase.js";
import { t, getUiLang } from "../../translation/translation.js";

const MAIL_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-mail`;

// Token powiadomienia z linku /go/?<param>=<uuid> zwróconego przez RPC.
export function goLinkToken(link, param) {
  try {
    return new URL(String(link || ""), location.origin).searchParams.get(param) || "";
  } catch {
    return "";
  }
}

// items: [{ action, token, reminder? }] -> { ok, queued, results: [{ token, ok, queued, skipped? }] }
export async function sendNotificationMails(items) {
  const { data } = await sb().auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error(t("pollsHubSubscriptions.errors.mailSession"));
  const body = JSON.stringify({ lang: getUiLang() || "pl", items });
  const doReq = (accessToken) => fetch(MAIL_FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body,
  });
  let res = await doReq(token);
  if (res.status === 401) {
    const { data: refreshed } = await sb().auth.refreshSession();
    const freshToken = refreshed?.session?.access_token;
    if (freshToken) res = await doReq(freshToken);
  }
  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }
  if (!res.ok || !payload?.ok) throw new Error(payload?.error || t("pollsHubSubscriptions.errors.mailSend"));
  return payload;
}

// Jeden mail: true = w kolejce, false = pominięty (np. odbiorca wyłączył powiadomienia).
export async function sendNotificationMail(item) {
  const payload = await sendNotificationMails([item]);
  return payload.results?.[0]?.queued === true;
}
