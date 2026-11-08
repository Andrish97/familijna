// Powiadomienia push na tym urządzeniu (E29): zgoda przeglądarki, subskrypcja
// u usługi push (klucz VAPID) i zapis w bazie (RPC push_subscribe). Wysyła
// funkcja Edge push-send; treść i adres składa serwer, pokazuje web/sw.js.
import { sb } from "./supabase.js?v=v2026-11-08T15560";
import { getUiLang } from "../../translation/translation.js?v=v2026-11-08T15560";
import { isStandalone, isIOSSafari } from "./pwa.js?v=v2026-11-08T15560";

// Klucz publiczny VAPID (jawny; para na serwerze — familijna-server
// supabase/push-keys.sh).
export const VAPID_PUBLIC_KEY = "BBnizvr10uBaKoCFaMg6DcqiQ4cj65-MsgtbGpHeRGkQCywgU6au6zods-JRxW72KikqUwW61tpZcFdb9Cnd0nc";
export const PUSH_KINDS = ["friend", "poll", "base", "device", "copy"];
const SYNC_KEY = "push:synced_at";
const OWNER_KEY = "push:enabled_user"; // konto, które włączyło push na tym urządzeniu
const SYNC_EVERY_MS = 24 * 3600 * 1000;

function supported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator
    && typeof window !== "undefined" && "PushManager" in window && "Notification" in window;
}

/** "ok" | "blocked" | "ios-install" | "unsupported" */
export function pushSupport() {
  if (!supported()) return isIOSSafari() && !isStandalone() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return "ok";
}

function keyBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function registration() {
  await navigator.serviceWorker.register("/sw.js?v=v2026-11-08T15560", { scope: "/" }).catch(() => {});
  // ready nie kończy się, gdy rejestracja jest zablokowana — limit czasu.
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("sw_unavailable")), 8000)),
  ]);
}

async function rpc(name, args) {
  const { data, error } = await sb().rpc(name, args);
  if (error) throw error;
  if (data && data.ok === false) throw new Error(data.error || "push_failed");
  return data;
}

async function currentUserId() {
  const { data } = await sb().auth.getSession();
  return data?.session?.user?.id || "";
}

function remember(userId) {
  try { if (userId) localStorage.setItem(OWNER_KEY, userId); else localStorage.removeItem(OWNER_KEY); } catch {}
}

async function save(sub, kinds) {
  const json = sub.toJSON();
  await rpc("push_subscribe", {
    p_endpoint: json.endpoint, p_p256dh: json.keys?.p256dh, p_auth: json.keys?.auth,
    p_lang: getUiLang() || "pl", p_kinds: kinds,
  });
  try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch {}
}

/** { subscribed, kinds } dla tego urządzenia. */
export async function getPushState() {
  if (!supported()) return { subscribed: false, kinds: [] };
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return { subscribed: false, kinds: [] };
  const data = await rpc("push_subscription_get", { p_endpoint: sub.endpoint });
  return { subscribed: Boolean(data?.subscribed), kinds: Array.isArray(data?.kinds) ? data.kinds : [] };
}

/** Wywołać z kliknięcia (przeglądarka pyta o zgodę tylko po geście). */
export async function enablePush(kinds = []) {
  if (!supported()) throw new Error("unsupported");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "blocked" : "dismissed");
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription())
    || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) });
  await save(sub, kinds);
  remember(await currentUserId());
}

export async function disablePush() {
  remember("");
  if (!supported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await rpc("push_unsubscribe", { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
}

export async function savePushKinds(kinds) {
  if (!supported()) return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) await save(sub, kinds);
}

// Ciche odświeżenie (raz na dobę, po zalogowaniu): usługa push mogła wymienić
// subskrypcję, a język mógł się zmienić. Bez pytania o zgodę.
export async function syncPushSubscription() {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const last = Number(localStorage.getItem(SYNC_KEY) || 0);
    if (Date.now() - last < SYNC_EVERY_MS) return;
    try { localStorage.setItem(SYNC_KEY, String(Date.now())); } catch {}
    const sub = await (await registration()).pushManager.getSubscription();
    if (!sub) return;
    const state = await rpc("push_subscription_get", { p_endpoint: sub.endpoint });
    if (state?.subscribed) { await save(sub, Array.isArray(state.kinds) ? state.kinds : []); return; }
    // Nowy adres od usługi push (pushsubscriptionchange) — tylko gdy to konto
    // samo włączyło powiadomienia na tym urządzeniu.
    let owner = "";
    try { owner = localStorage.getItem(OWNER_KEY) || ""; } catch {}
    if (owner && owner === await currentUserId()) await save(sub, []);
  } catch {
    // brak sieci/sesji — spróbuje przy następnym wejściu
  }
}
