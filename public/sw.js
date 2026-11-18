// Copia dei file dell'app sul telefono, così si apre anche senza rete (i dati arrivano dalla copia locale di api.ts).
// Pagine: prima la rete, la copia solo se manca. File con l'impronta nel nome (/assets/…): dalla copia, non cambiano mai.
// L'API non passa mai di qui.
const CACHE = 'ledgy-app-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/theme.js', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (req.mode === 'navigate' || url.pathname === '/theme.js')) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then((hit) => hit || Response.error())));
});

// Notifiche: il server manda una spinta vuota; qui si chiede cosa mostrare (l'iscrizione fa da chiave).
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      const res = await fetch('/api/push-public/pending', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub ? sub.endpoint : '' }) });
      if (res.ok) items = (await res.json()).items || [];
    } catch { /* senza rete si mostra l'avviso generico */ }
    // iPhone chiede di mostrare sempre qualcosa per ogni spinta.
    if (!items.length) items = [{ id: 'ledgy', title: 'Ledgy', body: 'Ci sono novità sulle tue spese.', url: '/' }];
    await Promise.all(items.map((n) => self.registration.showNotification(n.title, {
      body: n.body, tag: n.id, data: { url: n.url || '/' }, icon: '/brand/app-icon-acqua-192.png',
    })));
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin === self.location.origin) { await w.focus(); return w.navigate(url); }
    }
    return self.clients.openWindow(url);
  })());
});
