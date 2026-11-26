// E30: środowisko narzędzi czatu w przeglądarce (ctx dla tools/). Serwer MCP
// ma swój odpowiednik (supabase/functions/mcp/env.ts) — narzędzia są te same.
import { sb } from "../core/supabase.js";
import { getTabId } from "../core/resource-lock.js";
import { v as versioned } from "../core/cache-bust.js";
import { linkTo, PAGES } from "../core/nav-map.js";
import { sendPollInviteMails } from "../core/poll-mail.js";
import { createContactInvite, sendContactInviteMail } from "../core/contact-invite.js";

/** Część ctx zależna od przeglądarki; navigate(href) — przejście po odpowiedzi (panel). */
export async function browserToolEnv({ navigate }) {
  const { data } = await sb().auth.getUser();
  return {
    db: sb(),
    userId: data?.user?.id || null,
    tabId: getTabId(),
    pagePath: location.pathname,
    async loadJson(path) {
      const res = await fetch(await versioned(path));
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
      return res.json();
    },
    async manualMeta(lang) {
      return (await import(`../../../manual/content/meta/${lang}.js`)).default;
    },
    async manualChapter(lang, id) {
      const loaders = (await import("../../../manual/content/chapter-loaders.js")).default;
      const load = loaders[lang]?.[id];
      return load ? (await load()).default : null;
    },
    sendPollMails: (items) => sendPollInviteMails({ mailItems: items }),
    async inviteContact(kind, value) {
      const { data: res, mail } = await createContactInvite(kind, value);
      const mailSent = mail ? await sendContactInviteMail(kind, mail) : false;
      return { already: !!res?.already, mailSent };
    },
    navigateTo(page, id) {
      if (!PAGES[page]) return null;
      const href = linkTo(page, id ? { id } : {});
      navigate(href);
      return href;
    },
    async openContactForm(opts) {
      const { openContactModal } = await import("../core/contact-dialog.js");
      await openContactModal(opts);
    },
  };
}
