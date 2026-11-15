import { Hono } from 'hono';
import { changePassword, login, logout, requestReset, requireSession, resetPassword } from './auth';
import { backupApi } from './backup';
import { captureAdminApi, inboundApi } from './capture';
import { catalogApi } from './catalog';
import { configureFixedRates } from './fx';
import { body, HttpError, type Env } from './lib';
import { seedIfEmpty } from './seed';
import { statsApi } from './stats';
import { transactionsApi } from './transactions';

const app = new Hono<{ Bindings: Env }>();

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

app.post('/api/login', async (c) => {
  const b = await body<{ password?: string }>(c);
  await login(c, b.password ?? '');
  await seedIfEmpty(c.env.DB);
  return c.json({ ok: true });
});
app.post('/api/logout', async (c) => {
  await logout(c);
  return c.json({ ok: true });
});
app.post('/api/password/forgot', async (c) => c.json({ ok: true, ...(await requestReset(c)) }));
app.post('/api/password/reset', async (c) => {
  const b = await body<{ token?: string; password?: string }>(c);
  await resetPassword(c, b.token ?? '', b.password ?? '');
  return c.json({ ok: true });
});

// Ingresso dei telefoni: protetto dal token nell'indirizzo, non dalla sessione.
app.route('/api/in', inboundApi);

const priv = new Hono<{ Bindings: Env }>();
priv.use('*', requireSession);
priv.get('/me', (c) => c.json({ ok: true }));
priv.put('/password', async (c) => {
  const b = await body<{ current?: string; next?: string }>(c);
  await changePassword(c, b.current ?? '', b.next ?? '');
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
    // Pulizia notturna: sessioni e link scaduti, tentativi vecchi, notifiche scartate da oltre 90 giorni.
    const now = new Date().toISOString();
    const day = new Date(Date.now() - 86400_000).toISOString();
    const old = new Date(Date.now() - 90 * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM password_resets WHERE expires_at < ?').bind(day),
      env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(day),
      env.DB.prepare("DELETE FROM captures WHERE received_at < ? AND status IN ('duplicate', 'ignored', 'unrecognized')").bind(old),
    ]);
  },
} satisfies ExportedHandler<Env>;
