// Liczniki skrótów do Znajomych i Subskrybentów.
// Znajomi: oczekujące zaproszenia przychodzące (badges_get).
// Subskrybenci: aktywne adresy na liście właściciela (contacts_list).
import { sb } from "./supabase.js?v=v2026-11-07T22232";

// badges_get wołają topbar (Znajomi), Gry (Zadania) i Bazy — równoczesne
// wywołania dzielą jedno zapytanie, wynik ważny BADGES_TTL_MS (wcześniej
// dwa identyczne zapytania przy każdym wejściu na Gry).
const BADGES_TTL_MS = 2000;
let badgesCache = null; // { at, promise }
export function fetchBadges() {
  const now = Date.now();
  if (badgesCache && now - badgesCache.at < BADGES_TTL_MS) return badgesCache.promise;
  const promise = Promise.resolve(sb().rpc("badges_get")).then(({ data, error }) => {
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) || {};
  });
  const entry = { at: now, promise };
  badgesCache = entry;
  promise.catch(() => { if (badgesCache === entry) badgesCache = null; });
  return promise;
}

const writeCount = (target, value) => {
  const count = Math.max(0, Number(value) || 0);
  const text = count > 99 ? "99+" : count > 0 ? String(count) : "";
  document.querySelectorAll(`[data-nav-contact-count="${target}"]`).forEach((badge) => {
    badge.textContent = text;
  });
};

export function initNavContactBadges(targets) {
  const activeTargets = new Set(targets || []);
  if (!activeTargets.size) return;
  let inFlight = null;

  async function refresh() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const client = sb();
      const jobs = [];
      if (activeTargets.has("friends")) {
        jobs.push(fetchBadges().then((row) => {
          writeCount("friends", row?.friends_pending);
        }).catch(() => writeCount("friends", 0)));
      }
      if (activeTargets.has("subscribers")) {
        jobs.push(client.rpc("contacts_list", { p_kind: "subscribers" }).then(({ data, error }) => {
          if (error) throw error;
          const rows = Array.isArray(data) ? data : [];
          writeCount("subscribers", rows.filter((row) => row?.status === "active").length);
        }).catch(() => writeCount("subscribers", 0)));
      }
      await Promise.all(jobs);
    })();
    try { await inFlight; } finally { inFlight = null; }
  }

  void refresh();
  const timer = window.setInterval(() => {
    if (document.visibilityState === "visible") void refresh();
  }, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  window.addEventListener("pagehide", () => window.clearInterval(timer), { once: true });
}
