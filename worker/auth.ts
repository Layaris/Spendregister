// Account come in Multifolio: email e password, codice di recupero, niente email inviate.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { sha256Hex } from '../shared/dedupe';
import { HttpError, newId, nowIso, randomToken, type AppContext, type AppEnv } from './lib';
import { seedUser } from './seed';

const COOKIE = 'ledgy_session';
const DAYS = 90;
const ITERATIONS = 10_000; // basso apposta: il piano gratuito concede 10 ms di CPU per richiesta
const WINDOW_MIN = 15;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 10;
const MAX_SIGNUPS_PER_IP_HOUR = 5;
export const MIN_PASSWORD = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface UserRow {
  id: string;
  email: string | null;
  password_hash: string | null;
  recovery_hash: string | null;
  recovery_created_at: string | null;
  timezone: string;
}

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

async function verifyHash(stored: string | null, password: string): Promise<boolean> {
  if (!stored) return false;
  const [algo, iter, salt, hash] = stored.split('$');
  if (algo !== 'pbkdf2') return false;
  const got = b64(await pbkdf2(password, unb64(salt), Number(iter)));
  return timingSafeEqual(got, hash);
}

export function cleanEmail(v: unknown): string | null {
  const e = String(v ?? '').trim().toLowerCase();
  return e.length <= 200 && EMAIL.test(e) ? e : null;
}

function checkNewPassword(p: string) {
  if (p.length < MIN_PASSWORD) throw new HttpError(400, `La password deve avere almeno ${MIN_PASSWORD} caratteri`);
  if (p.length > 200) throw new HttpError(400, 'Password troppo lunga');
}

// ---- Limite ai tentativi (per indirizzo IP e per email; nessun limite globale, che bloccherebbe tutti) ----

function ipKey(c: AppContext): string {
  return `ip:${c.req.header('cf-connecting-ip') ?? 'locale'}`;
}

async function recentAttempts(db: D1Database, key: string, minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const row = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at >= ?').bind(key, since).first<{ n: number }>();
  return row?.n ?? 0;
}

async function guard(c: AppContext, email: string | null) {
  const db = c.env.DB;
  const tooMany = (await recentAttempts(db, ipKey(c), WINDOW_MIN)) >= MAX_PER_IP
    || (email && (await recentAttempts(db, `email:${email}`, WINDOW_MIN)) >= MAX_PER_EMAIL);
  if (tooMany) throw new HttpError(429, `Troppi tentativi sbagliati. Riprova tra ${WINDOW_MIN} minuti.`);
}

async function recordFailure(c: AppContext, email: string | null) {
  const db = c.env.DB;
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(ipKey(c), now),
    ...(email ? [db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(`email:${email}`, now)] : []),
  ]);
}

// ---- Sessioni ----

async function startSession(c: AppContext, userId: string) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + DAYS * 86400_000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, nowIso(), expires).run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: DAYS * 86400 });
}

async function currentSessionId(c: AppContext): Promise<string | null> {
  const token = getCookie(c, COOKIE);
  return token ? sha256Hex(token) : null;
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = await currentSessionId(c);
  if (!id) return c.json({ error: 'Accesso richiesto' }, 401);
  const row = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').bind(id).first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return c.json({ error: 'Sessione scaduta' }, 401);
  c.set('userId', row.user_id);
  await next();
};

async function userById(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

// ---- Registrazione, accesso, uscita ----

export async function register(c: AppContext, emailIn: unknown, password: string): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  if (!email) throw new HttpError(400, 'Email non valida');
  checkNewPassword(password);
  if ((await recentAttempts(db, `signup:${ipKey(c)}`, 60)) >= MAX_SIGNUPS_PER_IP_HOUR) {
    throw new HttpError(429, 'Troppi account creati da questa rete. Riprova tra un’ora.');
  }
  const id = newId('usr');
  const res = await db
    .prepare('INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, email, await hashPassword(password), nowIso())
    .run();
  if (!res.meta.changes) throw new HttpError(409, 'Esiste già un account con questa email');
  await db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(`signup:${ipKey(c)}`, nowIso()).run();
  await seedUser(db, id);
  await startSession(c, id);
}

export async function login(c: AppContext, emailIn: unknown, password: string): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  await guard(c, email);
  const user = email ? await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>() : null;
  if (!user || !(await verifyHash(user.password_hash, password))) {
    await recordFailure(c, email);
    throw new HttpError(401, 'Email o password errate');
  }
  await db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(ipKey(c), `email:${email}`).run();
  await startSession(c, user.id);
}

export async function logout(c: AppContext): Promise<void> {
  const id = await currentSessionId(c);
  if (id) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

// ---- Dati della versione a utente singolo ----

/** C'è un insieme di dati vecchi non ancora collegato a un account? */
export async function legacyAvailable(db: D1Database): Promise<boolean> {
  const owner = await db.prepare("SELECT email FROM users WHERE id = 'owner'").first<{ email: string | null }>();
  if (!owner || owner.email) return false;
  const used = await db.prepare(
    "SELECT (SELECT COUNT(*) FROM transactions WHERE user_id = 'owner') + (SELECT COUNT(*) FROM devices WHERE user_id = 'owner' AND revoked_at IS NULL) AS n",
  ).first<{ n: number }>();
  return (used?.n ?? 0) > 0;
}

/** Collega i dati vecchi a un account nuovo, verificando la vecchia password. */
export async function claimLegacy(c: AppContext, emailIn: unknown, password: string, oldPassword: string): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  if (!email) throw new HttpError(400, 'Email non valida');
  checkNewPassword(password);
  await guard(c, null);
  const owner = await userById(db, 'owner');
  if (!owner || owner.email) throw new HttpError(400, 'Non ci sono dati da collegare');
  const ok = owner.password_hash
    ? await verifyHash(owner.password_hash, oldPassword)
    : !!c.env.APP_PASSWORD && timingSafeEqual(await sha256Hex(oldPassword), await sha256Hex(c.env.APP_PASSWORD));
  if (!ok) {
    await recordFailure(c, null);
    throw new HttpError(401, 'La vecchia password non è corretta');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'Esiste già un account con questa email');
  await db.prepare("UPDATE users SET email = ?, password_hash = ? WHERE id = 'owner'").bind(email, await hashPassword(password)).run();
  await db.prepare("DELETE FROM sessions WHERE user_id = 'owner'").run();
  await seedUser(db, 'owner'); // non fa nulla se categorie e conti ci sono già
  await startSession(c, 'owner');
}

// ---- Password e codice di recupero (come in Multifolio) ----

export async function changePassword(c: AppContext, current: string, next: string): Promise<void> {
  const user = await userById(c.env.DB, c.get('userId'));
  if (!user || !(await verifyHash(user.password_hash, current))) throw new HttpError(400, 'La password attuale non è corretta');
  checkNewPassword(next);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(next), user.id).run();
  const keep = await currentSessionId(c);
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').bind(user.id, keep ?? '').run();
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // senza 0/O e 1/I, che si confondono

/** 24 caratteri (circa 120 bit) in gruppi da 4: ABCD-EFGH-… */
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('').match(/.{4}/g)!.join('-');
}

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Nuovo codice (il vecchio smette di valere). Serve la password attuale. Il codice si vede solo ora. */
export async function createRecoveryCode(c: AppContext, password: string): Promise<string> {
  const user = await userById(c.env.DB, c.get('userId'));
  if (!user || !(await verifyHash(user.password_hash, password))) throw new HttpError(400, 'La password attuale non è corretta');
  const code = newRecoveryCode();
  await c.env.DB.prepare('UPDATE users SET recovery_hash = ?, recovery_created_at = ? WHERE id = ?')
    .bind(await hashPassword(normalizeCode(code)), nowIso(), user.id).run();
  return code;
}

/** Password dimenticata: email + codice di recupero + nuova password. Chiude le altre sessioni ed entra. */
export async function recoverWithCode(c: AppContext, emailIn: unknown, code: string, password: string): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  await guard(c, email);
  const user = email ? await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>() : null;
  const okCode = !!user?.recovery_hash && normalizeCode(code).length === 24 && (await verifyHash(user.recovery_hash, normalizeCode(code)));
  if (!user || !okCode) {
    await recordFailure(c, email);
    throw new HttpError(401, 'Email o codice di recupero errati');
  }
  checkNewPassword(password);
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(ipKey(c), `email:${email}`),
  ]);
  await startSession(c, user.id);
}

export async function accountInfo(db: D1Database, userId: string) {
  const u = await userById(db, userId);
  return { email: u?.email ?? null, timezone: u?.timezone ?? 'Asia/Makassar', recovery_created_at: u?.recovery_created_at ?? null };
}

/** Elimina l'account e tutti i suoi dati. Serve la password. */
export async function deleteAccount(c: AppContext, password: string): Promise<void> {
  const db = c.env.DB;
  const id = c.get('userId');
  const user = await userById(db, id);
  if (!user || !(await verifyHash(user.password_hash, password))) throw new HttpError(400, 'La password non è corretta');
  await db.batch([
    db.prepare('DELETE FROM transaction_labels WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)').bind(id),
    ...['captures', 'transactions', 'rules', 'parsers', 'devices', 'labels', 'categories', 'accounts', 'sessions'].map((t) =>
      db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  deleteCookie(c, COOKIE, { path: '/' });
}
