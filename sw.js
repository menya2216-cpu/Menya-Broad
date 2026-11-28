/* Broad service worker: installable app, fast repeat opens, safe for live streams */
const VERSION = "broad-v2";
const SHELL = [
  "/", "/manifest.json", "/icon-96.png", "/icon-192.png", "/icon-512.png",
  "/apple-touch-icon.png", "/favicon-32.png", "/logo-mark-preview.png"
];
const NAV_TIMEOUT = 4000; /* slow network: show the saved page instead of waiting */

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Broad</title><body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0;text-align:center">' +
  '<div><h2>You are offline</h2><p>Connect to the internet to listen and watch.</p>' +
  '<button onclick="location.reload()" style="font:inherit;padding:10px 20px;border-radius:10px;border:0;background:#111;color:#fff">Try again</button></div>';
const offline = () => new Response(OFFLINE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== "broad-meta").map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET") return;
  const u = new URL(r.url);
  /* never touch streams, Firebase, radio/TV lists or any other website */
  if (u.origin !== location.origin) return;
  if (r.headers.has("range")) return;

  /* pages: network first so updates show up; if the network is slow or down, use the saved page */
  if (r.mode === "navigate") {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const net = fetch(r).then(res => {
        if (res && res.ok) cache.put("/", res.clone());
        return res;
      });
      e.waitUntil(net.catch(() => {}));
      try {
        return await Promise.race([
          net,
          new Promise((_, no) => setTimeout(() => no(new Error("slow")), NAV_TIMEOUT))
        ]);
      } catch (err) {
        const hit = await cache.match("/");
        if (hit) return hit;
        try { return await net } catch (e2) { return offline() }
      }
    })());
    return;
  }

  /* icons, images and manifest: show the saved copy instantly, refresh it in the background */
  if (/\.(png|ico|svg|webp|jpg|jpeg|json)$/i.test(u.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(r, { ignoreSearch: true });
      const net = fetch(r).then(res => {
        if (res && res.ok) cache.put(r, res.clone());
        return res;
      }).catch(() => hit);
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      return net.then(res => res || new Response("", { status: 504 }));
    })());
  }
});

/* daily reminders: morning, afternoon, evening (no server; browser decides exact timing) */
self.addEventListener("periodicsync", e => {
  if (e.tag !== "broad-remind") return;
  e.waitUntil((async () => {
    const d = new Date(), h = d.getHours();
    const slot = h >= 6 && h < 11 ? "morning" : h >= 12 && h < 16 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "";
    if (!slot) return;
    const c = await caches.open("broad-meta"), key = d.toDateString() + slot;
    const last = await c.match("last");
    if (last && (await last.text()) === key) return;
    await c.put("last", new Response(key));
    let f = {};
    try { f = await (await c.match("fav")).json(); } catch (x) {}
    const hi = { morning: "Good morning", afternoon: "Good afternoon", evening: "Good evening" }[slot];
    await self.registration.showNotification("Broad", {
      body: f.name ? hi + "! Your favorite " + f.name + " is waiting. Tap to listen." : hi + "! Tap to listen to live radio and TV.",
      icon: "/icon-512.png", badge: "/favicon-32.png", tag: "broad-" + slot, data: { url: f.url || "/" }
    });
  })());
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(clients.openWindow((e.notification.data && e.notification.data.url) || "/"));
});
