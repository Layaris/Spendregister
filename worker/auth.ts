// Account come in Multifolio: si usa subito l'app come ospite, poi si crea un account (email e password)
// o si entra in uno esistente. Codice di recupero, niente email inviate.
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { sha256Hex } from '../shared/dedupe';
import { HttpError, newId, nowIso, randomToken, type AppContext, type AppEnv } from './lib';
import { adoptGuest, aiCopy, deleteUserStatements, hasData, localData, type LocalData, type LoginChoice, type RegisterChoice } from './guest';
import { runBatch } from './lib';
import { seedUser } from './seed';

const COOKIE = 'ledgy_session';
const DAYS = 365; // le sessioni si rinnovano usandole: per un ospite la sessione è l'unico accesso ai dati
const ITERATIONS = 10_000; // basso apposta: il piano gratuito concede 10 ms di CPU per richiesta
const WINDOW_MIN = 15;
const MAX_PER_IP = 10;
const MAX_PER_EMAIL = 10;
const MAX_SIGNUPS_PER_IP_HOUR = 5;
const MAX_GUESTS_PER_IP_HOUR = 20;
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

async function sessionUser(c: AppContext): Promise<{ user_id: string; expires_at: string; email: string | null } | null> {
  const id = await currentSessionId(c);
  if (!id) return null;
  const row = await c.env.DB.prepare('SELECT s.user_id, s.expires_at, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?')
    .bind(id).first<{ user_id: string; expires_at: string; email: string | null }>();
  return row && row.expires_at >= nowIso() ? row : null;
}

/** L'ospite di questo browser, se c'è (sessione valida su un account senza email). */
async function currentGuest(c: AppContext): Promise<string | null> {
  const s = await sessionUser(c);
  return s && !s.email ? s.user_id : null;
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  const id = await currentSessionId(c);
  if (!id) return c.json({ error: 'Accesso richiesto' }, 401);
  const row = await c.env.DB.prepare('SELECT user_id, expires_at FROM sessions WHERE id = ?').bind(id).first<{ user_id: string; expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return c.json({ error: 'Sessione scaduta' }, 401);
  c.set('userId', row.user_id);
  // Rinnovo al massimo una volta a settimana: chi usa l'app non resta mai fuori.
  if (row.expires_at < new Date(Date.now() + (DAYS - 7) * 86400_000).toISOString()) {
    await c.env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').bind(new Date(Date.now() + DAYS * 86400_000).toISOString(), id).run();
    setCookie(c, COOKIE, getCookie(c, COOKIE)!, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: DAYS * 86400 });
  }
  await next();
};

async function userById(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

/** Serve una scelta sui dati di questo dispositivo prima di continuare (risposta 409 con `choice`). */
export class ChoiceNeeded extends HttpError {
  constructor(public choice: 'login' | 'register', public local: LocalData) {
    super(409, 'Su questo dispositivo ci sono dati: scegli cosa farne');
  }
}

// ---- Ospite ----

/** Crea l'ospite per chi apre l'app senza sessione. Se la sessione c'è già non fa nulla. */
export async function startGuest(c: AppContext): Promise<boolean> {
  if (await sessionUser(c)) return false;
  const db = c.env.DB;
  const key = `guest:${ipKey(c)}`;
  if ((await recentAttempts(db, key, 60)) >= MAX_GUESTS_PER_IP_HOUR) throw new HttpError(429, 'Troppe richieste da questa rete. Riprova tra un’ora.');
  const id = newId('usr');
  await db.batch([
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, NULL, ?)').bind(id, nowIso()),
    db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(key, nowIso()),
  ]);
  await seedUser(db, id);
  await startSession(c, id);
  return true;
}

export async function me(c: AppContext) {
  const u = await userById(c.env.DB, c.get('userId'));
  return { email: u?.email ?? null, guest: !u?.email };
}

// ---- Registrazione, accesso, uscita ----

export async function register(c: AppContext, emailIn: unknown, password: string, choice?: RegisterChoice): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  if (!email) throw new HttpError(400, 'Email non valida');
  checkNewPassword(password);
  if ((await recentAttempts(db, `signup:${ipKey(c)}`, 60)) >= MAX_SIGNUPS_PER_IP_HOUR) {
    throw new HttpError(429, 'Troppi account creati da questa rete. Riprova tra un’ora.');
  }
  if (await db.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()) throw new HttpError(409, 'Esiste già un account con questa email');
  const guest = await currentGuest(c);
  const local = guest ? await localData(db, guest) : null;
  if (guest && local && hasData(local) && !choice) throw new ChoiceNeeded('register', local);
  const hash = await hashPassword(password);
  const signup = db.prepare('INSERT INTO login_attempts (key, at) VALUES (?, ?)').bind(`signup:${ipKey(c)}`, nowIso());

  if (guest && choice !== 'fresh') {
    // L'account nuovo è l'ospite stesso: i dati e i telefoni collegati restano dove sono.
    const res = await db.prepare('UPDATE OR IGNORE users SET email = ?, password_hash = ? WHERE id = ? AND email IS NULL').bind(email, hash, guest).run();
    if (!res.meta.changes) throw new HttpError(409, 'Esiste già un account con questa email');
    await signup.run();
    return;
  }
  const id = newId('usr');
  const res = await db.prepare('INSERT OR IGNORE INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)').bind(id, email, hash, nowIso()).run();
  if (!res.meta.changes) throw new HttpError(409, 'Esiste già un account con questa email');
  await signup.run();
  await seedUser(db, id);
  if (guest) await runBatch(db, [aiCopy(db, guest, id), ...deleteUserStatements(db, guest)]);
  await startSession(c, id);
}

/** Prima di entrare in un account: se l'ospite ha dati serve una scelta, poi si applica. */
async function settleGuest(c: AppContext, accountId: string, choice: LoginChoice | undefined, apply: boolean): Promise<void> {
  const guest = await currentGuest(c);
  if (!guest || guest === accountId) return;
  const local = await localData(c.env.DB, guest);
  if (!hasData(local)) {
    if (apply) await runBatch(c.env.DB, [aiCopy(c.env.DB, guest, accountId), ...deleteUserStatements(c.env.DB, guest)]);
    return;
  }
  if (!choice) throw new ChoiceNeeded('login', local);
  if (apply) await adoptGuest(c.env.DB, guest, accountId, choice);
}

export async function login(c: AppContext, emailIn: unknown, password: string, choice?: LoginChoice): Promise<void> {
  const db = c.env.DB;
  const email = cleanEmail(emailIn);
  await guard(c, email);
  const user = email ? await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>() : null;
  if (!user || !(await verifyHash(user.password_hash, password))) {
    await recordFailure(c, email);
    throw new HttpError(401, 'Email o password errate');
  }
  await db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(ipKey(c), `email:${email}`).run();
  await settleGuest(c, user.id, choice, true);
  await startSession(c, user.id);
}

export async function logout(c: AppContext): Promise<void> {
  const id = await currentSessionId(c);
  if (id) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
  deleteCookie(c, COOKIE, { path: '/' });
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
export async function recoverWithCode(c: AppContext, emailIn: unknown, code: string, password: string, choice?: LoginChoice): Promise<void> {
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
  await settleGuest(c, user.id, choice, false); // chiede la scelta prima di cambiare la password
  await settleGuest(c, user.id, choice, true);
  await db.batch([
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(await hashPassword(password), user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id),
    db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(ipKey(c), `email:${email}`),
  ]);
  await startSession(c, user.id);
}

/** Funzioni facoltative (Impostazioni › Funzioni) e se sono accese all'inizio. */
export const FEATURE_DEFAULTS: Record<string, boolean> = { alerts: true, forecast: true, weekly_summary: false, atm_transfer: true };

export async function accountInfo(db: D1Database, userId: string) {
  const u = await userById(db, userId);
  const x = u as (typeof u & { display_currency?: string; theme?: string; home_layout?: string | null; features?: string | null; hero_style?: string | null }) | null;
  let home: string[] | null = null;
  try { home = x?.home_layout ? (JSON.parse(x.home_layout) as string[]) : null; } catch { home = null; }
  let features: Record<string, boolean> = {};
  try { features = x?.features ? (JSON.parse(x.features) as Record<string, boolean>) : {}; } catch { features = {}; }
  return {
    email: u?.email ?? null, timezone: u?.timezone ?? 'Asia/Makassar', recovery_created_at: u?.recovery_created_at ?? null,
    display_currency: x?.display_currency ?? 'EUR', theme: x?.theme ?? 'light', home_layout: home,
    hero_style: x?.hero_style === 'ring' ? 'ring' : 'compact',
    features: { ...FEATURE_DEFAULTS, ...Object.fromEntries(Object.entries(features).filter(([k]) => k in FEATURE_DEFAULTS)) },
  };
}

/** Elimina l'account e tutti i suoi dati. Serve la password. */
export async function deleteAccount(c: AppContext, password: string): Promise<void> {
  const db = c.env.DB;
  const id = c.get('userId');
  const user = await userById(db, id);
  if (!user || !(await verifyHash(user.password_hash, password))) throw new HttpError(400, 'La password non è corretta');
  await runBatch(db, deleteUserStatements(db, id));
  deleteCookie(c, COOKIE, { path: '/' });
}
