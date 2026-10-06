/*
 * Service worker: shows push notifications and opens the right page when one
 * is tapped. Kept tiny on purpose; it does no caching, so the site never
 * serves stale prices from it.
 */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "PSX Tracker";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/badge-72.png",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      // Only paths on this site may be opened from a notification.
      data: { url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : "/alerts" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/alerts", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const win of windows) {
        if (win.url.startsWith(self.location.origin) && "focus" in win) {
          win.navigate(target);
          return win.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
