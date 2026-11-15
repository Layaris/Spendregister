import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { sha256Hex } from '../shared/dedupe';
import { getSetting, HttpError, nowIso, randomToken, setSetting, type AppContext, type Env } from './lib';

const COOKIE = 'ledgy_session';
const DAYS = 90;
const ITERATIONS = 10_000; // basso apposta: il piano gratuito concede 10 ms di CPU per richiesta
const WINDOW_MIN = 15;
const MAX_PER_IP = 10;
const MAX_TOTAL = 40;
export const MIN_PASSWORD = 10;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

async function verifyHash(stored: string, password: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const got = b64(await pbkdf2(password, unb64(salt), Number(iter)));
  return timingSafeEqual(got, hash);
}

/** La password salvata dall'app vince su quella iniziale (secret APP_PASSWORD). */
async function checkPassword(env: Env, password: string): Promise<boolean> {
  const stored = await getSetting(env.DB, 'password_hash');
  if (stored) return verifyHash(stored, password);
  if (!env.APP_PASSWORD) throw new HttpError(503, 'Password non configurata sul server (secret APP_PASSWORD).');
  return timingSafeEqual(await sha256Hex(password), await sha256Hex(env.APP_PASSWORD));
}

function clientKey(c: AppContext): string {
  return `ip:${c.req.header('cf-connecting-ip') ?? 'locale'}`;
}

async function recentAttempts(db: D1Database, key: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at >= ?').bind(key, since).first<{ n: number }>();
  return row?.n ?? 0;
}

async function recordAttempt(db: D1Database, key: string) {
  await db.batch([
    db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(key, nowIso()),
    db.prepare("INSERT INTO login_attempts (key, at) VALUES ('tutti', ?)").bind(nowIso()),
  ]);
}

async function startSession(c: AppContext) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + DAYS * 86400_000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)').bind(await sha256Hex(token), nowIso(), expires).run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: DAYS * 86400 });
  return sha256Hex(token);
}

export async function login(c: AppContext, password: string): Promise<void> {
  const db = c.env.DB;
  const key = clientKey(c);
  if ((await recentAttempts(db, key, WINDOW_MIN)) >= MAX_PER_IP || (await recentAttempts(db, 'tutti', WINDOW_MIN)) >= MAX_TOTAL) {
    throw new HttpError(429, `Troppi tentativi sbagliati. Riprova tra ${WINDOW_MIN} minuti.`);
  }
  if (!(await checkPassword(c.env, password))) {
    await recordAttempt(db, key);
    throw new HttpError(401, 'Password errata');
  }
  await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run();
  await startSession(c);
}

export async function logout(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function currentSessionId(c: AppContext): Promise<string | null> {
  const token = getCookie(c, COOKIE);
  return token ? sha256Hex(token) : null;
}

export const requireSession: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const id = await currentSessionId(c);
  if (!id) return c.json({ error: 'Accesso richiesto' }, 401);
  const row = await c.env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ?').bind(id).first<{ expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return c.json({ error: 'Sessione scaduta' }, 401);
  await next();
};

/** Cambio password dall'app: chiude tutte le altre sessioni. */
export async function changePassword(c: AppContext, current: string, next: string): Promise<void> {
  if (!(await checkPassword(c.env, current))) throw new HttpError(400, 'La password attuale non è corretta');
  if (next.length < MIN_PASSWORD) throw new HttpError(400, `La nuova password deve avere almeno ${MIN_PASSWORD} caratteri`);
  await setSetting(c.env.DB, 'password_hash', await hashPassword(next));
  const keep = await currentSessionId(c);
  await c.env.DB.prepare('DELETE FROM sessions WHERE id <> ?').bind(keep ?? '').run();
}

// ---- Codice di recupero (come in Multifolio): niente email, niente servizi esterni ----

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // senza 0/O e 1/I, che si confondono

/** 24 caratteri (circa 120 bit) in gruppi da 4: ABCD-EFGH-… */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
  return chars.match(/.{4}/g)!.join('-');
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Crea un nuovo codice (il vecchio smette di valere). Serve la password attuale. Il codice si vede solo ora. */
export async function createRecoveryCode(c: AppContext, password: string): Promise<string> {
  if (!(await checkPassword(c.env, password))) throw new HttpError(400, 'La password attuale non è corretta');
  const code = newRecoveryCode();
  await setSetting(c.env.DB, 'recovery_hash', await hashPassword(normalizeCode(code)));
  await setSetting(c.env.DB, 'recovery_created_at', nowIso());
  return code;
}

/** Password dimenticata: codice di recupero + nuova password. Chiude tutte le sessioni e apre questa. */
export async function recoverWithCode(c: AppContext, code: string, password: string): Promise<void> {
  const db = c.env.DB;
  const key = clientKey(c);
  if ((await recentAttempts(db, key, WINDOW_MIN)) >= MAX_PER_IP || (await recentAttempts(db, 'tutti', WINDOW_MIN)) >= MAX_TOTAL) {
    throw new HttpError(429, `Troppi tentativi sbagliati. Riprova tra ${WINDOW_MIN} minuti.`);
  }
  const stored = await getSetting(db, 'recovery_hash');
  if (!stored) throw new HttpError(400, 'Non hai ancora creato un codice di recupero. Il tuo agente può reimpostare la password da Cloudflare (vedi docs/DEPLOY.md).');
  if (normalizeCode(code).length !== 24 || !(await verifyHash(stored, normalizeCode(code)))) {
    await recordAttempt(db, key);
    throw new HttpError(401, 'Codice di recupero errato');
  }
  if (password.length < MIN_PASSWORD) throw new HttpError(400, `La nuova password deve avere almeno ${MIN_PASSWORD} caratteri`);
  await setSetting(db, 'password_hash', await hashPassword(password));
  await db.batch([db.prepare('DELETE FROM sessions'), db.prepare('DELETE FROM login_attempts')]);
  await startSession(c);
}
