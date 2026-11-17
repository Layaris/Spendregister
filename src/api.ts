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

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 401 && !AUTH_PATHS.includes(path)) onUnauthorized();
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Errore ${res.status}`, data);
  return data as T;
}

export interface Account { id: string; name: string; type: string; currency: string; initial_balance: number; balance: number; balance_eur: number | null; color: string | null }
export interface Category { id: string; name: string; parent_id: string | null; kind: 'expense' | 'income'; nature: string | null; color: string | null; icon: string | null }
export interface Label { id: string; name: string }
export type Theme = 'light' | 'blue' | 'dark' | 'system';
export interface Settings { timezone: string; recovery_created_at: string | null; display_currency: string; theme: Theme; home_layout: string[] | null; features?: Record<string, boolean> }
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

export interface TxDetail extends Tx {
  capture: { id: string; app: string | null; title: string | null; text: string; received_at: string; detail: string | null } | null;
  rules: Array<{ id: string; name: string }>;
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
