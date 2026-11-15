import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { HttpError, nowIso, randomToken, type AppContext, type Env } from './lib';
import { sha256Hex } from '../shared/dedupe';

const COOKIE = 'ledgy_session';
const DAYS = 90;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function login(c: AppContext, password: string): Promise<void> {
  const expected = c.env.APP_PASSWORD;
  if (!expected) throw new HttpError(503, 'Password non configurata sul server (secret APP_PASSWORD).');
  const ok = timingSafeEqual(await sha256Hex(password), await sha256Hex(expected));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 600));
    throw new HttpError(401, 'Password errata');
  }
  const token = randomToken(32);
  const expires = new Date(Date.now() + DAYS * 86400_000).toISOString();
  await c.env.DB.prepare('INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256Hex(token), nowIso(), expires)
    .run();
  setCookie(c, COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: DAYS * 86400 });
}

export async function logout(c: AppContext): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export const requireSession: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: 'Accesso richiesto' }, 401);
  const row = await c.env.DB.prepare('SELECT expires_at FROM sessions WHERE id = ?')
    .bind(await sha256Hex(token))
    .first<{ expires_at: string }>();
  if (!row || row.expires_at < nowIso()) return c.json({ error: 'Sessione scaduta' }, 401);
  await next();
};
