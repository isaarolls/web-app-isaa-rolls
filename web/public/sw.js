// Service worker minimale: rende l'app installabile. Non mette in cache i dati (sempre aggiornati dal server).
const SHELL = "isa-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  if (url.pathname.includes("/assets/") || url.pathname.endsWith(".png")) {
    e.respondWith(caches.open(SHELL).then(async (c) => {
      try { const r = await fetch(e.request); if (r.ok) c.put(e.request, r.clone()); return r; }
      catch { return (await c.match(e.request)) || Response.error(); }
    }));
  }
});
