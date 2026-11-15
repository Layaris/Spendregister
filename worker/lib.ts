import type { Context } from 'hono';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSWORD?: string;
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
