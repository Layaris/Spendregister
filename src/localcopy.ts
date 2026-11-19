// Copia completa dei dati sul telefono (IndexedDB). Le schermate leggono da qui (shared/local.ts calcola le stesse
// risposte del server), così si aprono subito e funzionano anche senza rete; il server resta l'archivio vero.
// Aggiornamento: GET /api/sync?since=<cursore> porta solo le righe cambiate (all'apertura, quando l'app torna in primo
// piano, ogni minuto e dopo ogni modifica). La prima volta, o se la copia è troppo vecchia, si riscarica tutto a pagine.
import { LOCAL_TABLES, LocalDb, type LocalSnapshot, type Row, type SyncResponse } from '../shared/local';
import { toMilli, roundMilli } from '../shared/money';
import { pending } from './outbox';

const IDB = 'ledgy-copy';
const STORE = 'copy';
const KEY = 'v1';

let db: LocalDb | null = null;
let running: Promise<void> | null = null;
let again = false;
let lastSync = 0;
let lastOk: string | null = null;
let gen = 0;
let started = false;
const listeners = new Set<() => void>();
const statusListeners = new Set<(ok: boolean, since: string | null) => void>();

/** Avvisa le schermate che i dati sono cambiati (le letture si rifanno dalla copia). */
export function onLocalChange(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** Rete: `ok` false se l'ultima sincronizzazione non ha raggiunto il server (`since` = ora dei dati mostrati). */
export function onSyncStatus(fn: (ok: boolean, since: string | null) => void) { statusListeners.add(fn); return () => { statusListeners.delete(fn); }; }
const emit = () => { for (const l of listeners) l(); };
const status = (ok: boolean) => { for (const l of statusListeners) l(ok, ok ? null : lastOk); };

// ---- IndexedDB (in una finestra privata può mancare: allora la copia vive solo in memoria) ----
function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open(IDB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
async function idbGet(): Promise<(LocalSnapshot & { at?: string }) | null> {
  const d = await open();
  if (!d) return null;
  return new Promise((resolve) => {
    try {
      const r = d.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve((r.result as LocalSnapshot) ?? null);
      r.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!db) return;
    const d = await open();
    if (!d) return;
    try { d.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...db.snapshot(), at: lastOk }, KEY); } catch { /* spazio pieno: resta in memoria */ }
  }, 300);
}

/** All'uscita o al cambio di account: la copia si cancella. */
export async function clearLocal() {
  gen++;
  db = null;
  lastSync = 0;
  const d = await open();
  try { d?.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY); } catch { /* niente */ }
}

export const localReady = () => !!db;

// ---- Spese aggiunte senza rete: compaiono subito nella copia, finché il server non le registra ----
function provisional(): Row[] {
  if (!db) return [];
  const rates = db.extras.rates;
  return pending().map((p) => {
    const j = p.json as Record<string, unknown>;
    const currency = String(j.currency ?? 'EUR').toUpperCase();
    const sign = j.type === 'income' ? 1 : -1;
    const amount = roundMilli(toMilli(Number(j.amount) || 0), currency) * sign;
    const rate = currency === 'EUR' ? 1 : rates[currency] ?? null;
    const at = String(j.occurred_at ?? p.at);
    return {
      id: `attesa-${p.client_id}`, type: j.type ?? 'expense', account_id: j.account_id ?? null, amount, currency, amount_eur: rate ? Math.round(amount * rate) : 0,
      occurred_at: at, occurred_utc: new Date(Date.parse(at) || Date.now()).toISOString(), merchant: j.merchant ?? null, merchant_raw: j.merchant ?? null,
      note: j.note ?? null, category_id: j.category_id ?? null, nature: null, card: null, source: 'manual', status: 'confirmed', created_at: p.at, updated_at: p.at,
      deleted_at: null, duplicate_of: null, label_ids: null, review_choices: null, rule_ids: null, split_group: null, pending: true,
    };
  });
}
function withPending(): LocalDb | null {
  if (!db) return null;
  const extra = provisional();
  if (!extra.length) return db;
  const snap = db.snapshot();
  snap.tables.transactions = [...snap.tables.transactions, ...extra];
  return new LocalDb(snap);
}

/** Risposta dalla copia per un GET dell'API, o `undefined` (allora si chiede al server). */
export function localGet(path: string): unknown | undefined {
  const d = withPending();
  if (!d) return undefined;
  let r: unknown;
  try { r = d.get(path); } catch { return undefined; }
  // Cambiando schermata la copia chiede i cambi al server, al massimo ogni 10 secondi.
  if (r !== undefined && Date.now() - lastSync > 10_000) void sync();
  return r;
}

// ---- Sincronizzazione ----
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

async function downloadAll(first: SyncResponse): Promise<LocalDb> {
  const tables: Record<string, Row[]> = {};
  for (const t of LOCAL_TABLES) {
    tables[t] = [];
    let after = 0;
    for (;;) {
      const r = await getJson<{ rows: Row[]; next: number | null }>(`/sync/full?table=${t}&after=${after}&limit=1000`);
      tables[t].push(...r.rows);
      if (r.next == null) break;
      after = r.next;
    }
  }
  const { cursor, reset, changes, removed, ...extras } = first;
  void reset; void changes; void removed;
  return new LocalDb({ cursor, extras, tables });
}

async function runSync(): Promise<void> {
  lastSync = Date.now();
  const mine = gen;
  try {
    const r = await getJson<SyncResponse>(`/sync?since=${db?.cursor ?? 0}`);
    if (mine !== gen) return; // nel frattempo si è usciti o cambiato account
    let changed: boolean;
    if (r.reset || !db || r.user_id !== db.extras.user_id) {
      const fresh = await downloadAll(r);
      if (mine !== gen) return;
      db = fresh;
      changed = true;
    } else changed = db.apply(r);
    lastOk = new Date().toISOString();
    status(true);
    if (changed) { save(); emit(); }
  } catch (e) {
    // 401: sessione finita, ci pensa api() (l'app riparte). Rete o server giù: si resta sulla copia.
    if ((e as { status?: number }).status !== 401) status(false);
  }
}

/** Chiede i cambi al server. Se è già in corso, ne fa un'altra subito dopo (per le modifiche appena fatte). */
export function sync(): Promise<void> {
  if (running) { again = true; return running; }
  running = runSync().finally(async () => {
    running = null;
    if (again) { again = false; await sync(); }
  });
  return running;
}

/** All'avvio: copia salvata subito disponibile, poi i cambi dal server. */
export async function startLocal(): Promise<void> {
  if (started) return;
  started = true;
  const mine = gen;
  const snap = await idbGet();
  if (mine !== gen) return;
  if (snap && snap.tables && snap.extras) {
    db = new LocalDb(snap);
    lastOk = snap.at ?? null;
    emit();
  }
  void sync();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void sync(); });
    setInterval(() => { if (document.visibilityState === 'visible') void sync(); }, 60_000);
  }
}
