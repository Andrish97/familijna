// Maile z zaproszeniem do ankiety / przypomnieniem. Baza rezerwuje cooldown
// "poll:share" i przydział maila przed wysyłką; treść buduje funkcja Edge
// send-mail z szablonów serwera. Tu: wysyłka po tokenach i oznaczenie
// zaproszeń jako wysłanych.
import { sb } from "./supabase.js?v=v2026-11-08T22484";
import { sendNotificationMails, goLinkToken } from "./notify-mail.js?v=v2026-11-08T22484";

/**
 * Wysyła maile dla elementów `mail` zwróconych przez poll_share_send /
 * poll_share_remind i oznacza zaproszenia jako wysłane.
 * Zwraca { total, sent, failed, skipped }. Błąd wysyłki nie rzuca — liczy się w `failed`.
 */
export async function sendPollInviteMails({ mailItems, reminder = false }) {
  const list = (Array.isArray(mailItems) ? mailItems : [])
    .map((item) => ({ token: String(item?.token || goLinkToken(item?.link, "t")).toLowerCase(), taskId: item?.task_id || null }))
    .filter((item) => item.token);
  if (!list.length) return { total: 0, sent: 0, failed: 0, skipped: 0 };

  const taskByToken = new Map(list.map((item) => [item.token, item.taskId]));
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const sentTaskIds = [];
  try {
    const out = await sendNotificationMails(list.map((item) => ({ action: "poll:share", token: item.token, reminder: !!reminder })));
    for (const r of Array.isArray(out?.results) ? out.results : []) {
      if (r?.ok && r?.queued) {
        sent += 1;
        const tid = taskByToken.get(String(r.token || "").toLowerCase());
        if (tid) sentTaskIds.push(tid);
      } else if (r?.skipped) {
        skipped += 1;
      } else {
        failed += 1;
      }
    }
  } catch {
    failed = list.length;
  }

  if (sentTaskIds.length) {
    try { await sb().rpc("polls_hub_tasks_mark_emailed", { p_task_ids: sentTaskIds }); } catch { /* nieblokujące */ }
  }
  return { total: list.length, sent, failed, skipped };
}
