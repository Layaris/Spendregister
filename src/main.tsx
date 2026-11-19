import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { startLocal } from './localcopy';

// La copia dei dati sul telefono (IndexedDB) si apre prima del primo disegno: le schermate partono già da lì.
// Se il telefono è lento ad aprirla si parte comunque dopo poco, e le schermate si aggiornano quando è pronta.
void Promise.race([startLocal().catch(() => {}), new Promise((r) => setTimeout(r, 400))]).then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});

// Copia dei file dell'app sul telefono (public/sw.js): così si apre anche senza rete.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
