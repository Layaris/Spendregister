import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Vecchia password della versione a utente singolo: serve solo a collegare i dati esistenti a un account. */
  /** Solo per i test: tassi fissi, es. "IDR:0.00005,SGD:0.7". */
  FX_FIXED?: string;
  /** Solo per i test: indirizzi finti delle API dell'AI, JSON {"gemini": "…", "nanogpt": "…"}. */
  AI_ENDPOINTS?: string;
  /** Solo per i test: indirizzo finto dell'API di Wallet (es. http://127.0.0.1:8798/wallet/v1/api). */
  WALLET_API?: string;
  /** Solo per le prove: conta le righe lette da D1 (intestazione x-d1-rows). */
  D1_ROWS?: string;
  /** Solo per i test: una notifica con questo testo fa finta che il database non risponda. */
  TEST_DB_DOWN?: string;
  /** Solo per i test: accetta iscrizioni alle notifiche su http (servizio di push finto). */
  PUSH_HTTP?: string;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

/** Fuso orario dell'account. */
export async function getTimeZone(db: D1Database, userId: string): Promise<string> {
  const row = await db.prepare('SELECT timezone FROM users WHERE id = ?').bind(userId).first<{ timezone: string }>();
  return row?.timezone ?? 'Asia/Makassar';
}

export type AppEnv = { Bindings: Env; Variables: { userId: string } };
export type AppContext = Context<AppEnv>;

/** L'account della richiesta (impostato dal controllo della sessione). */
export const uid = (c: AppContext): string => c.get('userId');

export const nowIso = (): string => new Date().toISOString();

export function newId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const s = [...bytes].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
  return prefix ? `${prefix}_${s}` : s;
}

export function randomToken(bytes = 24): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function bad(message: string): never {
  throw new HttpError(400, message);
}

export function notFound(message = 'Non trovato'): never {
  throw new HttpError(404, message);
}

export async function body<T>(c: AppContext): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    bad('Il corpo della richiesta deve essere JSON');
  }
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Esegue più istruzioni in blocchi, nel limite di D1 per batch. */
export async function runBatch(db: D1Database, stmts: D1PreparedStatement[], size = 50): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}
