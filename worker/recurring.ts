// Spese ricorrenti: proposte dallo storico (shared/recurring.ts), confermate o scartate dall'utente.
import { Hono } from 'hono';
import { detectRecurring, graceDays, nextDate, perMonth, type Occurrence, type Period } from '../shared/recurring';
import { bad, body, newId, notFound, nowIso, uid, type AppEnv } from './lib';

export const recurringApi = new Hono<AppEnv>();

const PERIODS: Period[] = ['week', 'month', 'year'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

recurringApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const today = DAY.test(c.req.query('today') ?? '') ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 800 * 86400_000).toISOString().slice(0, 10);
  const [saved, rows, mine] = await Promise.all([
    db.prepare('SELECT id, merchant, category_id, amount_eur, period, status FROM recurring WHERE user_id = ?').bind(u)
      .all<{ id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; status: string }>(),
    // Solo i negozi con almeno 3 spese: il resto non può essere ricorrente.
    db.prepare(`SELECT merchant, substr(occurred_at, 1, 10) AS day, amount_eur, category_id FROM transactions
      WHERE user_id = ?1 AND deleted_at IS NULL AND duplicate_of IS NULL AND type = 'expense' AND merchant IS NOT NULL AND substr(occurred_at, 1, 10) >= ?2
        AND lower(merchant) IN (SELECT lower(merchant) FROM transactions WHERE user_id = ?1 AND deleted_at IS NULL AND type = 'expense' AND merchant IS NOT NULL
          AND substr(occurred_at, 1, 10) >= ?2 GROUP BY lower(merchant) HAVING COUNT(*) >= 2)
      ORDER BY occurred_at`).bind(u, since).all<Occurrence>(),
    // L'ultima spesa di ogni ricorrente confermata (anche se segnata a mano da una spesa sola).
    db.prepare(`SELECT merchant, substr(occurred_at, 1, 10) AS day, amount_eur, category_id FROM transactions
      WHERE user_id = ?1 AND deleted_at IS NULL AND type = 'expense' AND lower(merchant) IN (SELECT lower(merchant) FROM recurring WHERE user_id = ?1 AND status = 'confirmed')
      ORDER BY occurred_at`).bind(u).all<Occurrence>(),
  ]);
  const known = new Set(saved.results.map((r) => r.merchant.trim().toLowerCase()));
  const suggestions = detectRecurring(rows.results, today, known);
  // Le confermate: ultima volta, prossima, in ritardo, prezzo cambiato.
  const last = new Map<string, Occurrence>();
  for (const r of mine.results) last.set(r.merchant.trim().toLowerCase(), r);
  const confirmed = saved.results.filter((r) => r.status === 'confirmed').map((r) => {
    const l = last.get(r.merchant.trim().toLowerCase());
    const next = l ? nextDate(l.day, r.period) : null;
    const late = next != null && Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${next}T00:00:00Z`)) / 86400_000) > graceDays(r.period);
    const changed = l && Math.abs(l.amount_eur - r.amount_eur) > Math.abs(r.amount_eur) * 0.05 ? l.amount_eur : null;
    return { ...r, last_date: l?.day ?? null, next_date: next, late, new_amount: changed, per_month: perMonth(r.amount_eur, r.period) };
  }).sort((a, b) => (a.next_date ?? '9').localeCompare(b.next_date ?? '9'));
  return c.json({ confirmed, suggestions, per_month: confirmed.reduce((s, r) => s + r.per_month, 0), dismissed: saved.results.filter((r) => r.status === 'dismissed').length });
});

/** Conferma (o scarta) una spesa ricorrente per un negozio. Una sola per negozio. */
recurringApi.post('/', async (c) => {
  const b = await body<{ merchant?: string; period?: Period; amount_eur?: number; category_id?: string | null; status?: 'confirmed' | 'dismissed' }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const merchant = String(b.merchant ?? '').trim().slice(0, 200);
  if (!merchant) bad('Negozio mancante');
  if (!b.period || !PERIODS.includes(b.period)) bad('Ogni quanto?');
  const status = b.status === 'dismissed' ? 'dismissed' : 'confirmed';
  const amount = Math.round(Number(b.amount_eur));
  if (!Number.isFinite(amount)) bad('Importo non valido');
  let cat = b.category_id ?? null;
  if (cat && !(await db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').bind(cat, u).first())) cat = null;
  const now = nowIso();
  await db.prepare(`INSERT INTO recurring (id, user_id, merchant, category_id, amount_eur, period, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, merchant) DO UPDATE SET category_id = excluded.category_id, amount_eur = excluded.amount_eur, period = excluded.period, status = excluded.status, updated_at = excluded.updated_at`)
    .bind(newId('rec'), u, merchant, cat, -Math.abs(amount), b.period, status, now, now).run();
  return c.json({ ok: true });
});

/** Aggiorna l'importo (es. prezzo cambiato) o la frequenza. */
recurringApi.put('/:id', async (c) => {
  const b = await body<{ amount_eur?: number; period?: Period }>(c);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.amount_eur != null) { sets.push('amount_eur = ?'); args.push(-Math.abs(Math.round(Number(b.amount_eur)))); }
  if (b.period) { if (!PERIODS.includes(b.period)) bad('Ogni quanto?'); sets.push('period = ?'); args.push(b.period); }
  if (!sets.length) bad('Niente da cambiare');
  const r = await c.env.DB.prepare(`UPDATE recurring SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...args, nowIso(), c.req.param('id'), uid(c)).run();
  if (!r.meta.changes) notFound('Spesa ricorrente non trovata');
  return c.json({ ok: true });
});

recurringApi.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

/** Stato di un negozio (per il dettaglio di un movimento). */
recurringApi.get('/of/:merchant', async (c) => {
  const r = await c.env.DB.prepare('SELECT id, period, status FROM recurring WHERE user_id = ? AND lower(merchant) = lower(?)').bind(uid(c), c.req.param('merchant')).first();
  return c.json({ item: r ?? null });
});
