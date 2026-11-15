import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Password iniziale; dopo un cambio dall'app vale quella salvata nel database. */
  APP_PASSWORD?: string;
  /** Recupero password via email (Resend). */
  RESEND_API_KEY?: string;
  RECOVERY_EMAIL?: string;
  MAIL_FROM?: string;
  /** Solo per i test: non invia email e restituisce il link di recupero. */
  MAIL_DRY_RUN?: string;
  /** Solo per i test: tassi fissi, es. "IDR:0.00005,SGD:0.7". */
  FX_FIXED?: string;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

export async function getTimeZone(db: D1Database): Promise<string> {
  return (await getSetting(db, 'timezone')) ?? 'Asia/Makassar';
}

export type AppContext = Context<{ Bindings: Env }>;

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
