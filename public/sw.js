// Copia dei file dell'app sul telefono, così si apre anche senza rete (i dati arrivano dalla copia locale di api.ts).
// Pagine: prima la rete, la copia solo se manca. File con l'impronta nel nome (/assets/…): dalla copia, non cambiano mai.
// L'API non passa mai di qui.
const CACHE = 'ledgy-app-v1';

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
