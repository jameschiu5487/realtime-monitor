function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * The browser fires this when it retires a push subscription — key rotation, or
 * iOS reclaiming storage for a PWA that has not been opened in a while. Without
 * a handler the subscription is simply gone: the settings toggle reads
 * pushManager.getSubscription() and shows "Not enabled" even though the user
 * never revoked anything, which is exactly the "it disabled itself" symptom.
 *
 * Re-subscribe and register the replacement so recovery does not need the user
 * to notice and tap again.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      // The retired subscription usually carries the key we signed up with;
      // fall back to asking the server when the browser omits it.
      let applicationServerKey = event.oldSubscription?.options?.applicationServerKey;
      if (!applicationServerKey) {
        const res = await fetch("/api/notifications/vapid-key");
        if (!res.ok) return;
        const { key } = await res.json();
        if (!key) return;
        applicationServerKey = urlBase64ToUint8Array(key);
      }

      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Same-origin, so the auth cookies ride along and the route can attribute
      // the subscription to the right user.
      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          subscription: sub.toJSON(),
          deviceName: "auto-renewed (pushsubscriptionchange)",
        }),
      });
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  const data = event.data.json();
  const { title, body, icon, tag, url } = data;

  event.waitUntil(
    self.registration.showNotification(title || "Trading Alert", {
      body: body || "",
      icon: icon || "/icon-192.png",
      badge: "/icon-192.png",
      tag: tag || "default",
      data: { url: url || "/" },
      vibrate: [200, 100, 200],
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
