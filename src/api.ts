// Accesso all'API del Worker. In caso di 401 (sessione persa) l'app riparte, come ospite se serve.

export class ApiError extends Error {
  constructor(public status: number, message: string, public data?: unknown) {
    super(message);
  }
}

const AUTH_PATHS = ['/me', '/guest', '/login', '/register', '/password/recover'];

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

// ---- Copia locale delle letture: se il server non risponde, l'app si apre con gli ultimi dati visti ----
const CACHE = 'ledgy-c:';
/** La data di oggi cambia la chiave ogni giorno: per la copia locale non conta. */
const cacheKey = (path: string) => CACHE + path.replace(/([?&])today=[^&]*&?/, '$1').replace(/[?&]$/, '');

function cacheWrite(path: string, data: unknown) {
  try {
    const text = JSON.stringify({ at: new Date().toISOString(), data });
    if (text.length > 400_000) return;
    try { localStorage.setItem(cacheKey(path), text); } catch {
      clearCache(); // spazio pieno: si ricomincia da capo
      localStorage.setItem(cacheKey(path), text);
    }
  } catch { /* senza copia locale si va avanti lo stesso */ }
}

function cacheRead<T>(path: string): { at: string; data: T } | null {
  try {
    const t = localStorage.getItem(cacheKey(path));
    return t ? JSON.parse(t) : null;
  } catch { return null; }
}

/** Da chiamare all'uscita e al cambio di account: i dati di un account non restano sul telefono. */
export function clearCache() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE)) localStorage.removeItem(k);
  } catch { /* niente */ }
}

/** Stato della connessione col server: `since` è l'ora dei dati mostrati quando il server non risponde. */
type Offline = { offline: boolean; since: string | null };
let offline: Offline = { offline: false, since: null };
const listeners = new Set<(o: Offline) => void>();
function setOffline(next: Offline) {
  if (next.offline === offline.offline && next.since === offline.since) return;
  offline = next;
  for (const l of listeners) l(offline);
}
export function getOffline() { return offline; }
export function onOffline(fn: (o: Offline) => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }

/** Il server non ha risposto (rete assente o errore suo): la richiesta si può riprovare più tardi. */
export const isUnreachable = (e: unknown) => e instanceof ApiError && e.status >= 500;

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const isGet = !rest.method || rest.method === 'GET';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      ...rest,
      headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    res = new Response(JSON.stringify({ error: 'Server non raggiungibile' }), { status: 599, headers: { 'content-type': 'application/json' } });
  }
  if (res.status === 401 && !AUTH_PATHS.includes(path)) { clearCache(); onUnauthorized(); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => ({})) : await res.text();
  if (!res.ok) {
    if (isGet && res.status >= 500) {
      const cached = cacheRead<T>(path);
      if (cached) {
        setOffline({ offline: true, since: offline.since && offline.since < cached.at ? offline.since : cached.at });
        return cached.data;
      }
    }
    if (res.status >= 500) setOffline({ offline: true, since: offline.since });
    throw new ApiError(res.status, (data as { error?: string })?.error ?? `Errore ${res.status}`, data);
  }
  if (isGet) cacheWrite(path, data);
  if (offline.offline) setOffline({ offline: false, since: null });
  return data as T;
}

export interface Account { id: string; name: string; type: string; currency: string; initial_balance: number; balance: number; balance_eur: number | null; color: string | null }
export interface Category { id: string; name: string; parent_id: string | null; kind: 'expense' | 'income'; nature: string | null; color: string | null; icon: string | null }
export interface Label { id: string; name: string }
export type Theme = 'light' | 'aqua1' | 'blue' | 'navy' | 'minimal' | 'dark' | 'system';
export interface Settings { timezone: string; recovery_created_at: string | null; display_currency: string; theme: Theme; home_layout: string[] | null; features?: Record<string, boolean>; hero_style?: 'compact' | 'ring' }
export interface Bootstrap { accounts: Account[]; categories: Category[]; labels: Label[]; review_count: number; settings: Settings; account: { email: string | null } }

export interface Tx {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  account_id: string | null;
  amount: number;
  currency: string;
  amount_eur: number;
  fx_rate: number | null;
  fx_date: string | null;
  occurred_at: string;
  merchant_raw: string | null;
  merchant: string | null;
  note: string | null;
  category_id: string | null;
  nature: 'must' | 'need' | 'want' | null;
  card: string | null;
  source: string;
  status: 'confirmed' | 'review';
  review_reason: string | null;
  review_choices: string[];
  duplicate_of: string | null;
  labels: string[];
  rule_ids: string[];
  place: string | null;
}

export interface CardFx { card: string; currency: string | null; markup_bp: number | null; sample_tx_id: string | null; sample_charged: number | null; updated_at: string }
export interface TxDetail extends Tx {
  capture: { id: string; app: string | null; title: string | null; text: string; received_at: string; detail: string | null } | null;
  rules: Array<{ id: string; name: string }>;
  /** Ricarico sul cambio della carta di questa spesa, se calcolato. */
  card_fx: CardFx | null;
  /** Costo del cambio stimato, millesimi di euro. */
  fx_fee: number | null;
  split_group: string | null;
  /** Le parti, se la spesa è divisa in più categorie. */
  split: Array<{ id: string; amount: number; currency: string; amount_eur: number; category_id: string | null }> | null;
}

export interface Stats {
  from: string;
  to: string;
  spent: number;
  income: number;
  count: number;
  previous: { from: string; to: string; spent: number; income: number };
  forecast: number;
  days: { total: number; elapsed: number };
  by_category: Array<{ category_id: string | null; total: number; count: number }>;
  by_subcategory: Array<{ category_id: string | null; parent_id: string | null; total: number; count: number }>;
  income_by_category: Array<{ category_id: string | null; total: number; count: number }>;
  by_card: Array<{ card: string | null; total: number; count: number }>;
  by_nature: Array<{ nature: string | null; total: number }>;
  by_merchant: Array<{ merchant: string; total: number; count: number }>;
  daily: Array<{ day: string; spent: number; income: number; must: number; need: number; want: number }>;
}
