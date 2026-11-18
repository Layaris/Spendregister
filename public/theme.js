// Tema prima del primo disegno (niente lampo di colore sbagliato). Lo aggiorna l'app quando cambia nelle Impostazioni.
// Anche il colore della fascia della barra di stato (theme-color) segue il tema: su iPhone la parte alta non resta grigia.
(function () {
  var t = 'light';
  try { t = localStorage.getItem('ledgy-theme') || 'light'; } catch (e) { /* niente */ }
  // Scuro e Auto sono tolti finché il tema scuro non viene rifatto: chi li aveva vede Salvia.
  if (t === 'dark' || t === 'system') t = 'light';
  document.documentElement.dataset.theme = t;
  var top = { light: '#e7eee3', aqua1: '#ebf2f7', blue: '#dceef7', navy: '#182b4d', minimal: '#eceef2', sakura: '#fff1f6', dark: '#111816' };
  var dark = t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var c = top[t === 'system' ? (dark ? 'dark' : 'light') : t] || top.light;
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', c);
  // App installata su iPhone: con i temi scuri la pagina disegna anche sotto l'orologio (testo dell'orologio bianco),
  // così il blu arriva fino in cima invece di lasciare la fascia bianca sfocata. Con i temi chiari resta quella normale.
  var s = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (s) s.setAttribute('content', t === 'navy' || t === 'dark' || dark ? 'black-translucent' : 'default');
})();
