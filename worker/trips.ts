// Viaggi: luogo e date. Le spese restano nelle loro categorie; il viaggio è una vista sulle spese di quei giorni,
// più quelle aggiunte a mano (es. il volo comprato prima) e meno quelle tolte (es. l'affitto di casa).
import { Hono } from 'hono';
import { bad, body, newId, notFound, nowIso, uid, type AppEnv } from './lib';

export const tripsApi = new Hono<AppEnv>();

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Condizione SQL "il movimento t fa parte del viaggio ?" (4 parametri: id del viaggio ripetuto). */
export const IN_TRIP = `((substr(t.occurred_at, 1, 10) BETWEEN (SELECT start_date FROM trips WHERE id = ?1 AND user_id = t.user_id) AND (SELECT end_date FROM trips WHERE id = ?1 AND user_id = t.user_id)
  AND t.id NOT IN (SELECT transaction_id FROM trip_items WHERE trip_id = ?1 AND mode = 'out'))
  OR t.id IN (SELECT transaction_id FROM trip_items WHERE trip_id = ?1 AND mode = 'in' AND user_id = t.user_id))`;
const BASE = "t.user_id = ?2 AND t.deleted_at IS NULL AND t.duplicate_of IS NULL";

function check(b: { name?: string; place?: string | null; start_date?: string; end_date?: string }) {
  const name = String(b.name ?? b.place ?? '').trim().slice(0, 80);
  if (!name) bad('Dai un nome al viaggio (es. Bangkok)');
  if (!b.start_date || !DAY.test(b.start_date) || !b.end_date || !DAY.test(b.end_date)) bad('Scegli le date del viaggio');
  if (b.end_date < b.start_date) bad('La fine del viaggio è prima dell’inizio');
  return { name, place: b.place ? String(b.place).trim().slice(0, 120) || null : null, start: b.start_date, end: b.end_date };
}

tripsApi.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT tr.id, tr.name, tr.place, tr.start_date, tr.end_date,
      (SELECT COALESCE(-SUM(t.amount_eur), 0) FROM transactions t WHERE ${BASE.replace(/\?2/g, 'tr.user_id')} AND t.type = 'expense' AND ${IN_TRIP.replace(/\?1/g, 'tr.id')}) AS spent
    FROM trips tr WHERE tr.user_id = ? ORDER BY tr.start_date DESC`).bind(uid(c)).all();
  return c.json({ items: results });
});

tripsApi.post('/', async (c) => {
  const v = check(await body(c));
  const id = newId('trip');
  await c.env.DB.prepare('INSERT INTO trips (id, user_id, name, place, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid(c), v.name, v.place, v.start, v.end, nowIso()).run();
  return c.json({ id });
});

tripsApi.put('/:id', async (c) => {
  const v = check(await body(c));
  const r = await c.env.DB.prepare('UPDATE trips SET name = ?, place = ?, start_date = ?, end_date = ? WHERE id = ? AND user_id = ?')
    .bind(v.name, v.place, v.start, v.end, c.req.param('id'), uid(c)).run();
  if (!r.meta.changes) notFound('Viaggio non trovato');
  return c.json({ ok: true });
});

tripsApi.delete('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const u = uid(c);
  await db.batch([
    db.prepare('DELETE FROM trip_items WHERE trip_id = ? AND user_id = ?').bind(id, u),
    db.prepare('DELETE FROM trips WHERE id = ? AND user_id = ?').bind(id, u),
  ]);
  return c.json({ ok: true });
});

/** Riepilogo: totale, al giorno, confronto con un periodo normale, per categoria e per valuta. */
tripsApi.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const u = uid(c);
  const trip = await db.prepare('SELECT id, name, place, start_date, end_date FROM trips WHERE id = ? AND user_id = ?').bind(id, u)
    .first<{ id: string; name: string; place: string | null; start_date: string; end_date: string }>();
  if (!trip) notFound('Viaggio non trovato');
  const where = `${BASE} AND ${IN_TRIP}`;
  const days = Math.round((Date.parse(`${trip.end_date}T00:00:00Z`) - Date.parse(`${trip.start_date}T00:00:00Z`)) / 86400_000) + 1;
  // "Normale": la spesa media al giorno nei 90 giorni prima del viaggio, senza i movimenti di questo viaggio.
  const before = new Date(Date.parse(`${trip.start_date}T00:00:00Z`) - 90 * 86400_000).toISOString().slice(0, 10);
  const [tot, byCat, byCur, normal] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS count, COALESCE(-SUM(CASE WHEN t.type = 'expense' THEN t.amount_eur END), 0) AS spent,
        COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount_eur END), 0) AS income FROM transactions t WHERE ${where}`).bind(id, u).first<{ count: number; spent: number; income: number }>(),
    db.prepare(`SELECT t.category_id, -SUM(t.amount_eur) AS total, COUNT(*) AS count FROM transactions t WHERE ${where} AND t.type = 'expense'
        GROUP BY t.category_id ORDER BY total DESC`).bind(id, u).all<{ category_id: string | null; total: number; count: number }>(),
    db.prepare(`SELECT t.currency, -SUM(t.amount) AS amount, -SUM(t.amount_eur) AS eur FROM transactions t WHERE ${where} AND t.type = 'expense'
        GROUP BY t.currency ORDER BY eur DESC`).bind(id, u).all<{ currency: string; amount: number; eur: number }>(),
    db.prepare(`SELECT COALESCE(-SUM(t.amount_eur), 0) AS spent FROM transactions t WHERE ${BASE} AND t.type = 'expense'
        AND substr(t.occurred_at, 1, 10) >= ?3 AND substr(t.occurred_at, 1, 10) < ?4 AND NOT ${IN_TRIP}`).bind(id, u, before, trip.start_date).first<{ spent: number }>(),
  ]);
  const spent = tot?.spent ?? 0;
  return c.json({
    ...trip, days, count: tot?.count ?? 0, spent, income: tot?.income ?? 0, per_day: Math.round(spent / days),
    normal_per_day: normal?.spent ? Math.round(normal.spent / 90) : null,
    by_category: byCat.results, by_currency: byCur.results,
  });
});

/** Il viaggio di un movimento (se c'è) e i viaggi in cui le sue date cadono. */
tripsApi.get('/of/:txId', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const tx = await db.prepare('SELECT id, occurred_at FROM transactions WHERE id = ? AND user_id = ?').bind(c.req.param('txId'), u).first<{ id: string; occurred_at: string }>();
  if (!tx) notFound('Movimento non trovato');
  const { results } = await db.prepare(`SELECT tr.id, tr.name,
      (SELECT mode FROM trip_items WHERE trip_id = tr.id AND transaction_id = ?) AS mode,
      (substr(?, 1, 10) BETWEEN tr.start_date AND tr.end_date) AS in_dates
    FROM trips tr WHERE tr.user_id = ?`).bind(tx.id, tx.occurred_at, u).all<{ id: string; name: string; mode: string | null; in_dates: number }>();
  const current = results.find((r) => r.mode === 'in') ?? results.find((r) => r.in_dates && r.mode !== 'out') ?? null;
  return c.json({ trip: current ? { id: current.id, name: current.name } : null });
});

/** Mette un movimento in un viaggio (trip_id) o lo toglie da tutti (null). */
tripsApi.put('/of/:txId', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const b = await body<{ trip_id?: string | null }>(c);
  const tx = await db.prepare('SELECT id, occurred_at FROM transactions WHERE id = ? AND user_id = ?').bind(c.req.param('txId'), u).first<{ id: string; occurred_at: string }>();
  if (!tx) notFound('Movimento non trovato');
  const day = tx.occurred_at.slice(0, 10);
  const { results: trips } = await db.prepare('SELECT id, start_date, end_date FROM trips WHERE user_id = ?').bind(u).all<{ id: string; start_date: string; end_date: string }>();
  if (b.trip_id && !trips.some((t) => t.id === b.trip_id)) notFound('Viaggio non trovato');
  const stmts: D1PreparedStatement[] = [db.prepare('DELETE FROM trip_items WHERE transaction_id = ? AND user_id = ?').bind(tx.id, u)];
  for (const t of trips) {
    const inDates = day >= t.start_date && day <= t.end_date;
    const want = t.id === b.trip_id;
    if (want && !inDates) stmts.push(db.prepare("INSERT INTO trip_items (user_id, trip_id, transaction_id, mode) VALUES (?, ?, ?, 'in')").bind(u, t.id, tx.id));
    if (!want && inDates) stmts.push(db.prepare("INSERT INTO trip_items (user_id, trip_id, transaction_id, mode) VALUES (?, ?, ?, 'out')").bind(u, t.id, tx.id));
  }
  await db.batch(stmts);
  return c.json({ ok: true });
});
