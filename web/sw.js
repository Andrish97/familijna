// Version: v2026-11-08T15455
// sw.js – Service Worker aplikacji: instalacja PWA i powiadomienia push (E29),
// bez offline cache. Treść powiadomienia (tytuł, ikony, przyciski, adres)
// składa funkcja Edge push-send; zapis urządzenia: web/shared/js/core/push.js.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "Familijna", {
    body: data.body || "",
    icon: data.icon,
    badge: data.badge,
    image: data.image,
    tag: data.tag,
    renotify: Boolean(data.tag && data.renotify),
    actions: Array.isArray(data.actions) ? data.actions : [],
    vibrate: data.vibrate,
    requireInteraction: Boolean(data.requireInteraction),
    timestamp: data.timestamp,
    data: { url: data.url || "/games/" },
  }));
});

// Otwiera sprawę (link /go/… jak w mailu) w oknie aplikacji albo w nowym.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/games/", self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
    if (win) {
      await win.focus();
      if ("navigate" in win) return win.navigate(target.href).catch(() => self.clients.openWindow(target.href));
      return undefined;
    }
    return self.clients.openWindow(target.href);
  })());
});