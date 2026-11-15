import { Hono } from 'hono';
import { login, logout, requireSession } from './auth';
import { captureAdminApi, inboundApi } from './capture';
import { catalogApi } from './catalog';
import { body, HttpError, type Env } from './lib';
import { seedIfEmpty } from './seed';
import { statsApi } from './stats';
import { transactionsApi } from './transactions';

const app = new Hono<{ Bindings: Env }>();

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

// Ingresso dei telefoni: protetto dal token nell'indirizzo, non dalla sessione.
app.route('/api/in', inboundApi);

const priv = new Hono<{ Bindings: Env }>();
priv.use('*', requireSession);
priv.get('/me', (c) => c.json({ ok: true }));
priv.route('/', catalogApi);
priv.route('/transactions', transactionsApi);
priv.route('/stats', statsApi);
priv.route('/capture', captureAdminApi);
app.route('/api', priv);

app.all('/api/*', (c) => c.json({ error: 'Percorso non trovato' }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env) {
    // Pulizia notturna: sessioni scadute e notifiche scartate più vecchie di 90 giorni.
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 90 * 86400_000).toISOString();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare("DELETE FROM captures WHERE received_at < ? AND status IN ('duplicate', 'ignored', 'unrecognized')").bind(old),
    ]);
  },
} satisfies ExportedHandler<Env>;
