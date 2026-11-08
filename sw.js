const CACHE = "mi-plan-v2";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(
    fetch(r).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); return res; })
      .catch(() => caches.match(r).then(m => m || caches.match("./")))
  );
});

// Avisos que llegan cada mañana
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { data: { body: e.data ? e.data.text() : "" } }; }
  const x = d.data || {}, n = d.notification || {};
  const title = x.title || n.title || "Mi Plan Financiero";
  const body = x.body || n.body || "Tienes avisos en tu plan.";
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: "icon-192.png", badge: "icon-192.png", tag: x.tag || "avisos", data: { url: x.url || "./" }
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return clients.openWindow(url);
  }));
});
