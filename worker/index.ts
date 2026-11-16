import { Hono } from 'hono';
import {
  changePassword, claimLegacy, createRecoveryCode, deleteAccount, legacyAvailable, login, logout, recoverWithCode, register, requireSession,
} from './auth';
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
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: 'Errore interno del server' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---- Account (pubblico) ----
interface AuthBody { email?: string; password?: string; old_password?: string; code?: string }

/** Per la schermata di accesso: ci sono dati della vecchia versione da collegare a un account? */
app.get('/api/auth/status', async (c) => c.json({ legacy_available: await legacyAvailable(c.env.DB) }));

app.post('/api/register', async (c) => {
  const b = await body<AuthBody>(c);
  await register(c, b.email, b.password ?? '');
  return c.json({ ok: true }, 201);
});
app.post('/api/login', async (c) => {
  const b = await body<AuthBody>(c);
  await login(c, b.email, b.password ?? '');
  return c.json({ ok: true });
});
app.post('/api/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
app.post('/api/claim', async (c) => {
  const b = await body<AuthBody>(c);
  await claimLegacy(c, b.email, b.password ?? '', b.old_password ?? '');
  return c.json({ ok: true });
});
// Password dimenticata: email + codice di recupero + nuova password (entra subito).
app.post('/api/password/recover', async (c) => {
  const b = await body<AuthBody>(c);
  await recoverWithCode(c, b.email, b.code ?? '', b.password ?? '');
  return c.json({ ok: true });
});

// Ingresso dei telefoni: protetto dal token nell'indirizzo, non dalla sessione.
app.route('/api/in', inboundApi);

// ---- Tutto il resto: solo con un account e solo sui suoi dati ----
const priv = new Hono<AppEnv>();
priv.use('*', requireSession);
priv.get('/me', (c) => c.json({ ok: true }));
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
    const old = new Date(Date.now() - 90 * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(day),
      env.DB.prepare("DELETE FROM captures WHERE received_at < ? AND status IN ('duplicate', 'ignored', 'unrecognized')").bind(old),
    ]);
  },
} satisfies ExportedHandler<Env>;
