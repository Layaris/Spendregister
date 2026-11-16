// Tema prima del primo disegno (niente lampo di colore sbagliato). Lo aggiorna l'app quando cambia nelle Impostazioni.
try { document.documentElement.dataset.theme = localStorage.getItem('ledgy-theme') || 'light'; } catch (e) { document.documentElement.dataset.theme = 'light'; }
