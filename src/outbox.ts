// Spese inserite quando il server non risponde: restano sul telefono e partono da sole appena torna.
// Ogni spesa ha un client_id: se la risposta si perde ma il server l'aveva salvata, al nuovo invio non si duplica.
import { api, ApiError, isUnreachable } from './api';

const KEY = 'ledgy-outbox';
export interface Pending { client_id: string; json: Record<string, unknown>; at: string }

const listeners = new Set<(n: number) => void>();

export function pending(): Pending[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Pending[]; } catch { return []; }
}

function save(list: Pending[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* spazio pieno: resta in memoria fino al prossimo invio */ }
  for (const l of listeners) l(list.length);
}

export function onOutbox(fn: (n: number) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

export function newClientId(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`; }
}

export function enqueue(item: Pending) {
  save([...pending().filter((p) => p.client_id !== item.client_id), item]);
}

let flushing = false;
/** Invia le spese in attesa, le più vecchie prima. Si ferma al primo segno che il server non risponde ancora. */
export async function flushOutbox(onRejected?: (msg: string) => void): Promise<number> {
  if (flushing) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of pending()) {
      try {
        await api('/transactions', { method: 'POST', json: { ...item.json, client_id: item.client_id } });
        sent++;
      } catch (e) {
        if (isUnreachable(e)) break;
        // Il server ha risposto ma non la accetta (es. categoria cancellata nel frattempo): si toglie e si avvisa.
        if (e instanceof ApiError) onRejected?.(`Una spesa in attesa non è stata accettata: ${e.message}`);
        else break;
      }
      save(pending().filter((p) => p.client_id !== item.client_id));
    }
  } finally {
    flushing = false;
  }
  return sent;
}
