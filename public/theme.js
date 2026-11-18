// Tema prima del primo disegno (niente lampo di colore sbagliato). Lo aggiorna l'app quando cambia nelle Impostazioni.
// Anche il colore della fascia della barra di stato (theme-color) segue il tema: su iPhone la parte alta non resta grigia.
(function () {
  var t = 'light';
  try { t = localStorage.getItem('ledgy-theme') || 'light'; } catch (e) { /* niente */ }
  document.documentElement.dataset.theme = t;
  var top = { light: '#edf1e8', aqua1: '#ebf2f7', blue: '#e3eef5', navy: '#172d52', dark: '#111816' };
  var dark = t === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var c = top[t === 'system' ? (dark ? 'dark' : 'light') : t] || top.light;
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', c);
})();
