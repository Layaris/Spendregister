import { Hono } from 'hono';
import { bad, type Env } from './lib';

export const statsApi = new Hono<{ Bindings: Env }>();

function shiftPeriod(from: string, to: string): [string, string] {
  const f = Date.parse(`${from}T00:00:00Z`);
  const t = Date.parse(`${to}T00:00:00Z`);
  const len = t - f;
  return [new Date(f - len).toISOString().slice(0, 10), from];
}

/** Riepilogo di un periodo: date locali YYYY-MM-DD, `to` escluso. I trasferimenti non contano. */
statsApi.get('/', async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) bad('Servono from e to');
  const db = c.env.DB;
  const base = "deleted_at IS NULL AND type <> 'transfer' AND substr(occurred_at, 1, 10) >= ? AND substr(occurred_at, 1, 10) < ?";
  const tBase = "t.deleted_at IS NULL AND t.type <> 'transfer' AND substr(t.occurred_at, 1, 10) >= ? AND substr(t.occurred_at, 1, 10) < ?";
  const [prevFrom, prevTo] = shiftPeriod(from, to);

  const [totals, prev, byCategory, byNature, byMerchant, daily] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END), 0) AS spent,
                       COALESCE(SUM(CASE WHEN amount_eur > 0 THEN amount_eur ELSE 0 END), 0) AS income,
                       COUNT(*) AS count FROM transactions WHERE ${base}`).bind(from, to).first<{ spent: number; income: number; count: number }>(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END), 0) AS spent,
                       COALESCE(SUM(CASE WHEN amount_eur > 0 THEN amount_eur ELSE 0 END), 0) AS income FROM transactions WHERE ${base}`)
      .bind(prevFrom, prevTo).first<{ spent: number; income: number }>(),
    db.prepare(`SELECT COALESCE(c.parent_id, c.id) AS category_id, SUM(-t.amount_eur) AS total, COUNT(*) AS count
                FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
                WHERE t.amount_eur < 0 AND ${tBase}
                GROUP BY 1 ORDER BY total DESC`).bind(from, to).all<{ category_id: string | null; total: number; count: number }>(),
    db.prepare(`SELECT nature, SUM(-amount_eur) AS total FROM transactions WHERE amount_eur < 0 AND ${base} GROUP BY nature`).bind(from, to)
      .all<{ nature: string | null; total: number }>(),
    db.prepare(`SELECT merchant, SUM(-amount_eur) AS total, COUNT(*) AS count FROM transactions
                WHERE amount_eur < 0 AND merchant IS NOT NULL AND ${base} GROUP BY merchant ORDER BY total DESC LIMIT 10`).bind(from, to)
      .all<{ merchant: string; total: number; count: number }>(),
    db.prepare(`SELECT substr(occurred_at, 1, 10) AS day, SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END) AS spent,
                       SUM(CASE WHEN amount_eur > 0 THEN amount_eur ELSE 0 END) AS income
                FROM transactions WHERE ${base} GROUP BY day ORDER BY day`).bind(from, to)
      .all<{ day: string; spent: number; income: number }>(),
  ]);

  // Previsione a fine periodo: media giornaliera finora, proiettata sui giorni rimanenti.
  const today = new Date().toISOString().slice(0, 10);
  const totalDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
  const elapsed = today < from ? 0 : today >= to ? totalDays : Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000) + 1;
  const spent = totals?.spent ?? 0;
  const forecast = elapsed > 0 ? Math.round((spent / elapsed) * totalDays) : spent;

  return c.json({
    from, to, spent, income: totals?.income ?? 0, count: totals?.count ?? 0,
    previous: { from: prevFrom, to: prevTo, spent: prev?.spent ?? 0, income: prev?.income ?? 0 },
    forecast, days: { total: totalDays, elapsed },
    by_category: byCategory.results, by_nature: byNature.results, by_merchant: byMerchant.results, daily: daily.results,
  });
});

/** Saldo totale in euro giorno per giorno (ultimi N giorni). */
statsApi.get('/balance', async (c) => {
  const days = Math.min(Number(c.req.query('days')) || 30, 366);
  const db = c.env.DB;
  const start = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const initial = await db.prepare("SELECT COALESCE(SUM(initial_balance), 0) AS v FROM accounts WHERE currency = 'EUR'").first<{ v: number }>();
  const before = await db.prepare('SELECT COALESCE(SUM(amount_eur), 0) AS v FROM transactions WHERE deleted_at IS NULL AND substr(occurred_at, 1, 10) < ?')
    .bind(start).first<{ v: number }>();
  const { results } = await db
    .prepare('SELECT substr(occurred_at, 1, 10) AS day, SUM(amount_eur) AS delta FROM transactions WHERE deleted_at IS NULL AND substr(occurred_at, 1, 10) >= ? GROUP BY day ORDER BY day')
    .bind(start).all<{ day: string; delta: number }>();
  const deltas = new Map(results.map((r) => [r.day, r.delta]));
  let running = (initial?.v ?? 0) + (before?.v ?? 0);
  const series: Array<{ day: string; balance: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    running += deltas.get(day) ?? 0;
    series.push({ day, balance: running });
  }
  return c.json({ series });
});
