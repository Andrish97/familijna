// E30 (decyzja 19): środowisko narzędzi czatu na serwerze MCP — odpowiednik
// web/shared/js/ai/env-browser.js. Maile i zaproszenia tą samą drogą co
// strona (RPC + funkcja Edge send-mail z JWT użytkownika); Wskazówki i czcionka
// z plików strony. Potwierdzenia przed zmianami nieodwracalnymi i wysyłką
// zbiera klient MCP (Claude/ChatGPT pyta użytkownika; narzędzia mają
// destructiveHint), więc confirm tu zawsze przepuszcza.

// Moduł z plikami Wskazówek („export default <JSON>;”) → wartość.
export function parseExportDefault(text) {
  const m = /export default ([\s\S]*?);?\s*$/.exec(String(text || ""));
  if (!m) throw new Error("manual: bad module");
  return JSON.parse(m[1]);
}

function goLinkToken(link, param, site) {
  try { return new URL(String(link || ""), site).searchParams.get(param) || ""; } catch { return ""; }
}

/**
 * ctx narzędzi dla użytkownika. db — klient Supabase z jego JWT; jwt — ten
 * sam token dla send-mail; fetchImpl — do testów.
 */
export function serverToolEnv({ db, jwt, userId, tokenId, lang, site, supabaseUrl, fetchImpl = fetch }) {
  const rpc = async (fn, args) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new Error(error.message);
    if (data?.ok === false) throw Object.assign(new Error(data.err || data.error || "rpc_failed"), { result: data });
    return data;
  };
  const sendMails = async (items) => {
    const res = await fetchImpl(`${supabaseUrl}/functions/v1/send-mail`, {
      method: "POST",
      headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ lang, items }),
    });
    let payload = null;
    try { payload = await res.json(); } catch { payload = null; }
    if (!res.ok || !payload?.ok) throw new Error(payload?.error || `send-mail: HTTP ${res.status}`);
    return payload;
  };
  const getText = async (path) => {
    const res = await fetchImpl(`${site}${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.text();
  };

  return {
    db,
    userId,
    tabId: `mcp:${tokenId}`,
    lang,
    site,
    pageId: null,
    changed() {},
    confirm: async () => true,
    async loadJson(path) {
      const text = await getText(path);
      if (text == null) throw new Error(`${path}: HTTP 404`);
      return JSON.parse(text);
    },
    async manualMeta(l) {
      return parseExportDefault(await getText(`/manual/content/meta/${l}.js`));
    },
    async manualChapter(l, id) {
      if (!/^[0-9]{1,3}$/.test(String(id))) return null;
      const text = await getText(`/manual/content/chapters/${l}/${id}.js`);
      return text == null ? null : parseExportDefault(text);
    },
    async sendNotificationMail(item) {
      const out = await sendMails([item]);
      return out?.results?.[0]?.queued === true;
    },
    // Kopie zasobów przez Workera strony (/_api/resource-send|duplicate), JWT użytkownika.
    async resourceAction(action, body) {
      const res = await fetchImpl(`${site}/_api/resource-${action}`, {
        method: "POST",
        headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      try { return await res.json(); } catch { return { ok: false, error: `http_${res.status}` }; }
    },
    // Jak shared/js/core/poll-mail.js: maile zaproszeń do ankiety i oznaczenie wysłanych.
    async sendPollMails(mailItems) {
      const list = (Array.isArray(mailItems) ? mailItems : [])
        .map((item) => ({ token: String(item?.token || goLinkToken(item?.link, "t", site)).toLowerCase(), taskId: item?.task_id || null }))
        .filter((item) => item.token);
      if (!list.length) return { total: 0, sent: 0, failed: 0, skipped: 0 };
      const taskByToken = new Map(list.map((i) => [i.token, i.taskId]));
      let sent = 0, failed = 0, skipped = 0;
      const sentTasks = [];
      try {
        const out = await sendMails(list.map((i) => ({ action: "poll:share", token: i.token, reminder: false })));
        for (const r of Array.isArray(out?.results) ? out.results : []) {
          if (r?.ok && r?.queued) { sent += 1; const tid = taskByToken.get(String(r.token || "").toLowerCase()); if (tid) sentTasks.push(tid); }
          else if (r?.skipped) skipped += 1;
          else failed += 1;
        }
      } catch { failed = list.length; }
      if (sentTasks.length) { try { await db.rpc("polls_hub_tasks_mark_emailed", { p_task_ids: sentTasks }); } catch { /* nieblokujące */ } }
      return { total: list.length, sent, failed, skipped };
    },
    // Jak shared/js/core/contact-invite.js: zaproszenie w bazie, potem mail (gdy wolno).
    async inviteContact(kind, value) {
      const friends = kind === "friend";
      const data = await rpc(friends ? "friends_invite" : "subscribers_invite", friends ? { p_handle: value } : { p_email: value });
      let mail = null;
      if (friends && data.mail_allowed) mail = { action: "friend:invite", token: data.token };
      if (!friends && !data.already) {
        const resent = await rpc("polls_hub_subscriber_resend", { p_id: data.id });
        if (resent?.mail_allowed) mail = { action: "poll:resend", token: goLinkToken(resent.link, "s", site), reminder: false };
      }
      let mailSent = false;
      if (mail?.token) {
        const out = await sendMails([mail]);
        mailSent = out?.results?.[0]?.queued === true;
      }
      return { already: !!data?.already, mailSent };
    },
  };
}
