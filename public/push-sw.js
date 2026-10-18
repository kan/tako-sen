// The daily notice (src/worker/push.ts), imported by the service worker that
// vite-plugin-pwa builds (vite.config.ts), after vegtab's public/push-sw.js.

self.addEventListener("push", (event) => {
  // The wording comes with the message (DAILY_NOTICE in src/worker/push.ts);
  // these fallbacks are for one that cannot be read.
  let notice = {};
  try {
    notice = event.data?.json() ?? {};
  } catch {
    // A message that is not JSON still says that something happened.
  }
  event.waitUntil(
    self.registration.showNotification(notice.title ?? "TAKO-SEN", {
      body: notice.body ?? "",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      // One notice a day: a new one replaces yesterday's if still there.
      tag: "daily",
      data: { url: notice.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin)
    .href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        // A window already open shows the game: bring it forward.
        const open = windows.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        return open ? open.focus() : self.clients.openWindow(url);
      }),
  );
});
