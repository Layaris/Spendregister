import { Hono } from 'hono';
import {
  ChoiceNeeded, changePassword, createRecoveryCode, deleteAccount, login, logout, me, recoverWithCode, register, requireSession, startGuest,
} from './auth';
import type { LoginChoice, RegisterChoice } from './guest';
import { backupApi } from './backup';
import { captureAdminApi, inboundApi } from './capture';
import { catalogApi } from './catalog';
import { configureFixedRates } from './fx';
import { body, HttpError, type AppEnv, type Env } from './lib';
import { statsApi } from './stats';
import { transactionsApi } from './transactions';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
  configureFixedRates(c.env.FX_FIXED);
  await next();
});

app.onError((err, c) => {
  if (err instanceof ChoiceNeeded) return c.json({ error: err.message, choice: err.choice, local: err.local }, 409);
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Errore interno del server' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---- Account (pubblico) ----
// `choice`: cosa fare dei dati usati senza account su questo dispositivo (vedi worker/guest.ts).
interface AuthBody { email?: string; password?: string; code?: string; choice?: string }
const loginChoice = (v: unknown): LoginChoice | undefined => (v === 'account' || v === 'merge' || v === 'replace' ? v : undefined);
const registerChoice = (v: unknown): RegisterChoice | undefined => (v === 'keep' || v === 'fresh' ? v : undefined);

/** Chi apre l'app senza sessione la usa subito, come ospite. */
app.post('/api/guest', async (c) => c.json({ ok: true }, (await startGuest(c)) ? 201 : 200));

app.post('/api/register', async (c) => {
  const b = await body<AuthBody>(c);
  await register(c, b.email, b.password ?? '', registerChoice(b.choice));
  return c.json({ ok: true }, 201);
});
app.post('/api/login', async (c) => {
  const b = await body<AuthBody>(c);
  await login(c, b.email, b.password ?? '', loginChoice(b.choice));
  return c.json({ ok: true });
});
app.post('/api/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
// Password dimenticata: email + codice di recupero + nuova password (entra subito).
app.post('/api/password/recover', async (c) => {
  const b = await body<AuthBody>(c);
  await recoverWithCode(c, b.email, b.code ?? '', b.password ?? '', loginChoice(b.choice));
  return c.json({ ok: true });
});

// Ingresso dei telefoni: protetto dal token nell'indirizzo, non dalla sessione.
app.route('/api/in', inboundApi);

// ---- Tutto il resto: solo con un account e solo sui suoi dati ----
const priv = new Hono<AppEnv>();
priv.use('*', requireSession);
priv.get('/me', async (c) => c.json(await me(c)));
priv.post('/recovery-code', async (c) => {
  const b = await body<{ password?: string }>(c);
  return c.json({ code: await createRecoveryCode(c, b.password ?? '') });
});
priv.put('/password', async (c) => {
  const b = await body<{ current?: string; next?: string }>(c);
  await changePassword(c, b.current ?? '', b.next ?? '');
  return c.json({ ok: true });
});
priv.post('/account/delete', async (c) => {
  const b = await body<{ password?: string }>(c);
  await deleteAccount(c, b.password ?? '');
  return c.json({ ok: true });
});
priv.route('/', catalogApi);
priv.route('/transactions', transactionsApi);
priv.route('/stats', statsApi);
priv.route('/capture', captureAdminApi);
priv.route('/backup', backupApi);
app.route('/api', priv);

app.all('/api/*', (c) => c.json({ error: 'Percorso non trovato' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    // Pulizia notturna: sessioni scadute, tentativi vecchi, notifiche scartate da oltre 90 giorni.
    const now = new Date().toISOString();
    const day = new Date(Date.now() - 86400_000).toISOString();
    const week = new Date(Date.now() - 7 * 86400_000).toISOString();
    const old = new Date(Date.now() - 90 * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(day),
      env.DB.prepare("DELETE FROM captures WHERE received_at < ? AND status IN ('duplicate', 'ignored', 'unrecognized')").bind(old),
    ]);
    // Ospiti da togliere: senza più nessuna sessione (nessuno può più vedere i dati), oppure vuoti da una settimana.
    const doomed = `SELECT u.id FROM users u WHERE u.email IS NULL AND (
      (u.created_at < ?1 AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id))
      OR (u.created_at < ?2 AND NOT EXISTS (SELECT 1 FROM transactions t WHERE t.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM devices d WHERE d.user_id = u.id AND d.revoked_at IS NULL)))`;
    const tables = ['favorites', 'captures', 'transactions', 'rules', 'parsers', 'devices', 'labels', 'categories', 'accounts', 'sessions'];
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM transaction_labels WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id IN (${doomed}))`).bind(day, week),
      ...tables.map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id IN (${doomed})`).bind(day, week)),
      env.DB.prepare(`DELETE FROM users WHERE id IN (${doomed})`).bind(day, week),
    ]);
  },
} satisfies ExportedHandler<Env>;
