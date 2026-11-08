// Treść i wygląd powiadomień push (E29, plan: familijna-server/docs/
// powiadomienia-push-plan.md „Treść powiadomień”, „Wygląd — pełny zakres”).
// Bez emotek; formy bezosobowe; tytuł ≤ 40, treść ≤ 90 znaków.
// Panel admina — teksty po polsku (decyzja 2026-10-23: panel bez tłumaczeń).
// Aplikacja — teksty z tłumaczeń strony (kopia generowana do
// push-mail-texts… w P5), przekazywane jako `texts`.

export const TITLE_MAX = 40;
export const BODY_MAX = 90;
const NAME_MAX = 24;

export function clip(s, max) {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

// Polska odmiana: 1 e-mail, 2–4 e-maile, 5+ e-maili (12–14 → e-maili).
export function plPlural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, dd = n % 100;
  return d >= 2 && d <= 4 && !(dd >= 12 && dd <= 14) ? few : many;
}

const VIBRATE = { normal: [120], error: [120, 80, 120], repeat: [120, 80, 120, 80, 120] };

function warsawTime(iso) {
  try {
    return new Intl.DateTimeFormat("pl-PL", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Warsaw" }).format(new Date(iso));
  } catch { return ""; }
}

const ADMIN_ICON = (name) => `/admin/icons/push/${name}.png`;
const ADMIN_BADGE = (name) => `/admin/icons/push/badge-${name}.png`;
const WHAT = { contacts: "kontaktów", questions: "pytań" };
const TAB_FOR = { contacts: "marketing", questions: "generator" };

// Zdarzenie panelu → treść powiadomienia (null = nieznane zdarzenie).
export function adminNotification(row) {
  const v = row.vars || {};
  const what = WHAT[v.what] || "";
  const lang = v.lang ? String(v.lang).toUpperCase() : "";
  const n = Number(v.n) || 1;
  let c;
  switch (row.event) {
    // Poczta i zgłoszenia: bez nadawcy i tematu — to tekst od obcej osoby
    // widoczny na ekranie blokady (E24 R18); treść tylko w panelu.
    case "mail":
      c = { title: n > 1 ? `${n} ${plPlural(n, "nowy e-mail", "nowe e-maile", "nowych e-maili")}` : "Nowy e-mail",
        body: n > 1 ? "Wiadomości czekają w Poczcie Familijnej." : "Wiadomość czeka w Poczcie Familijnej.",
        icon: "envelope-in", url: "/?tab=reports", tag: "mail",
        actions: [{ action: "open", title: "Otwórz", icon: "envelope-in" }, { action: "reply", title: "Odpowiedz", icon: "reply" }] };
      break;
    case "ticket":
      c = { title: n > 1 ? `${n} ${plPlural(n, "nowe zgłoszenie", "nowe zgłoszenia", "nowych zgłoszeń")}` : `Zgłoszenie #${clip(v.ticket, 20)}`,
        body: n > 1 ? "Zgłoszenia z formularza Kontakt czekają na odpowiedź." : "Zgłoszenie z formularza Kontakt czeka na odpowiedź.",
        icon: "megaphone", url: "/?tab=reports", tag: "ticket",
        actions: [{ action: "reply", title: "Odpowiedz", icon: "reply" }] };
      break;
    case "market":
      c = { title: "Gra do zatwierdzenia", body: `„${clip(v.title, 50)}” czeka w Grach Społeczności.`,
        icon: "gamepad", url: "/?tab=marketplace", tag: "market",
        actions: [{ action: "open", title: "Sprawdź", icon: "eye" }] };
      break;
    case "collect_done":
      c = { title: `Zbieranie ${what} zakończone`,
        body: v.what === "contacts"
          ? `Nowe kontakty: ${Number(v.added) || 0} z ${Number(v.target) || 0} · czas ${Number(v.minutes) || 0} min`
          : `Nowe pytania: ${Number(v.added) || 0} z ${Number(v.target) || 0}${lang ? ` · ${lang}` : ""}`,
        icon: "check", url: `/?tab=${TAB_FOR[v.what] || "maintenance"}`, tag: `collect-${v.what || ""}`,
        actions: [{ action: "open", title: "Wyniki", icon: "arrow-right" }] };
      break;
    case "collect_paused":
      c = { title: "Zbieranie wstrzymane",
        body: `Zbieranie ${what}${lang ? ` (${lang})` : ""}: skończył się limit. Wznowi się samo.`,
        icon: "pause", url: `/?tab=${TAB_FOR[v.what] || "maintenance"}`, tag: `collect-${v.what || ""}`,
        actions: [{ action: "open", title: "Zobacz", icon: "arrow-right" }] };
      break;
    case "job_error":
      c = { title: `Błąd: zbieranie ${what}`,
        body: v.reason ? `${v.reason}` : "Przebieg zakończył się błędem. Szczegóły w dzienniku.",
        icon: "warning", url: `/?tab=${TAB_FOR[v.what] || "maintenance"}`, tag: `error-${v.what || ""}`,
        actions: [{ action: "open", title: "Dziennik", icon: "arrow-right" }], level: "error" };
      break;
    case "job_error_repeat":
      c = { title: `Zbieranie ${what} nie działa`,
        body: `${n} ${plPlural(n, "błąd", "błędy", "błędów")} od ${warsawTime(v.since)}. Wymaga sprawdzenia.`,
        icon: "error", url: `/?tab=${TAB_FOR[v.what] || "maintenance"}`, tag: `error-${v.what || ""}`,
        actions: [{ action: "open", title: "Dziennik", icon: "arrow-right" }], level: "repeat" };
      break;
    case "test":
      c = { title: "Test powiadomień", body: "Powiadomienia na tym urządzeniu działają.",
        icon: "bell", url: "/?tab=maintenance", tag: "test", actions: [] };
      break;
    default:
      return null;
  }
  return finish(c, row, ADMIN_ICON, ADMIN_BADGE);
}

const APP_ICON = (name) => `/assets/img/push/${name}.png`;
const APP_BADGE = (name) => `/assets/img/push/badge-${name}.png`;

function finish(c, row, iconPath, badgePath) {
  const level = c.level || "normal";
  return {
    title: clip(c.title, TITLE_MAX),
    body: clip(c.body, BODY_MAX),
    icon: iconPath(c.icon),
    badge: badgePath(c.icon),
    image: c.image || undefined,
    tag: c.tag,
    renotify: true,
    url: c.url,
    actions: (c.actions || []).slice(0, 2).map((a) => ({ action: a.action, title: a.title, icon: iconPath(`action-${a.icon}`) })),
    vibrate: VIBRATE[level] || VIBRATE.normal,
    requireInteraction: level !== "normal",
    timestamp: Date.parse(row.created_at) || Date.now(),
  };
}

// Aplikacja: zdarzenie użytkownika → treść w języku urządzenia (P5).
// texts: { [lang]: { [klucz]: tekst } }; brak tekstu → null (nie wysyłamy).
export function appNotification(row, lang, texts) {
  const dict = texts?.[lang] || texts?.pl;
  const spec = APP_EVENTS[row.event];
  if (!dict || !spec) return null;
  const v = row.vars || {};
  const vars = Object.fromEntries(Object.entries(v).map(([k, val]) => [k, clip(val, NAME_MAX)]));
  // Rodzaj urządzenia (host/buzzer/display) → nazwa w języku urządzenia.
  if (v.type && typeof dict[`push.deviceType.${v.type}`] === "string") vars.type = dict[`push.deviceType.${v.type}`];
  const fill = (key) => {
    const t = dict[key];
    return typeof t === "string" ? t.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "") : null;
  };
  const title = fill(spec.title), body = fill(spec.body);
  if (!title || !body) return null;
  // Adres tylko w obrębie aplikacji: link /go/ sprawy albo stała strona (E24 pkt 4).
  const url = typeof v.url === "string" && /^\/go\/\?[A-Za-z0-9=&%._-]+$/.test(v.url) ? v.url : spec.url;
  return finish({ title, body, icon: spec.icon, url, tag: spec.tag(v),
    actions: spec.action ? [{ action: "open", title: fill(spec.action) || "", icon: spec.actionIcon || "arrow-right" }] : [] },
    row, APP_ICON, APP_BADGE);
}

// Klucze tłumaczeń (sekcja `push` w części `server`, P5).
export const APP_EVENTS = {
  "friend:invite": { title: "push.friendInvite.title", body: "push.friendInvite.body", action: "push.action.see", icon: "people", url: "/friends/", tag: () => "friend" },
  "friend:resend": { title: "push.friendResend.title", body: "push.friendResend.body", action: "push.action.see", icon: "people", url: "/friends/", tag: () => "friend" },
  "poll:share": { title: "push.pollShare.title", body: "push.pollShare.body", action: "push.action.vote", actionIcon: "check", icon: "polls", url: "/tasks/", tag: (v) => `poll-${v.id || ""}` },
  "poll:remind": { title: "push.pollRemind.title", body: "push.pollRemind.body", action: "push.action.vote", actionIcon: "check", icon: "polls", url: "/tasks/", tag: (v) => `poll-${v.id || ""}` },
  "subscription:invite": { title: "push.subscription.title", body: "push.subscription.body", action: "push.action.see", icon: "bell", url: "/subscribers/", tag: () => "subscription" },
  "base:share": { title: "push.baseShare.title", body: "push.baseShare.body", action: "push.action.open", actionIcon: "folder-open", icon: "folder", url: "/bases/", tag: (v) => `base-${v.id || ""}` },
  "base:remind": { title: "push.baseRemind.title", body: "push.baseRemind.body", action: "push.action.open", actionIcon: "folder-open", icon: "folder", url: "/bases/", tag: (v) => `base-${v.id || ""}` },
  "device:share": { title: "push.deviceShare.title", body: "push.deviceShare.body", action: "push.action.open", icon: "display", url: "/control/", tag: () => "device" },
  "copy:game": { title: "push.copyGame.title", body: "push.copyGame.body", action: "push.action.see", icon: "gamepad", url: "/games/", tag: (v) => `copy-${v.id || ""}` },
  "copy:logo": { title: "push.copyLogo.title", body: "push.copyLogo.body", action: "push.action.see", icon: "image", url: "/logos/", tag: (v) => `copy-${v.id || ""}` },
};
