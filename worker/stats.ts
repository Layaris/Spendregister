import { Hono } from 'hono';
import { getEurRate } from './fx';
import { bad, uid, type AppEnv } from './lib';

export const statsApi = new Hono<AppEnv>();

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
  const u = uid(c);
  const base = "user_id = ? AND deleted_at IS NULL AND duplicate_of IS NULL AND type <> 'transfer' AND occurred_at >= ? AND occurred_at < ?";
  const [prevFrom, prevTo] = shiftPeriod(from, to);

  // Quattro passaggi sul periodo (prima erano nove): gruppi per categoria/tipo/carta, giorni, negozi, periodo prima.
  // Le somme per categoria madre, tipo e carta si fanno qui dai gruppi, che sono poche centinaia di righe anche per anni.
  const [groups, daily, byMerchant, prev, cats] = await Promise.all([
    db.prepare(`SELECT category_id, nature, card, CASE WHEN amount_eur < 0 THEN -1 WHEN amount_eur > 0 THEN 1 ELSE 0 END AS sign,
                       SUM(amount_eur) AS total, COUNT(*) AS count FROM transactions WHERE ${base}
                GROUP BY category_id, nature, card, sign`).bind(u, from, to)
      .all<{ category_id: string | null; nature: string | null; card: string | null; sign: number; total: number; count: number }>(),
    db.prepare(`SELECT substr(occurred_at, 1, 10) AS day, SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END) AS spent,
                       SUM(CASE WHEN amount_eur > 0 THEN amount_eur ELSE 0 END) AS income,
                       SUM(CASE WHEN amount_eur < 0 AND nature = 'must' THEN -amount_eur ELSE 0 END) AS must,
                       SUM(CASE WHEN amount_eur < 0 AND nature = 'need' THEN -amount_eur ELSE 0 END) AS need,
                       SUM(CASE WHEN amount_eur < 0 AND nature = 'want' THEN -amount_eur ELSE 0 END) AS want
                FROM transactions WHERE ${base} GROUP BY day ORDER BY day`).bind(u, from, to)
      .all<{ day: string; spent: number; income: number; must: number; need: number; want: number }>(),
    db.prepare(`SELECT merchant, SUM(-amount_eur) AS total, COUNT(*) AS count FROM transactions
                WHERE amount_eur < 0 AND merchant IS NOT NULL AND ${base} GROUP BY merchant ORDER BY total DESC LIMIT 10`).bind(u, from, to)
      .all<{ merchant: string; total: number; count: number }>(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END), 0) AS spent,
                       COALESCE(SUM(CASE WHEN amount_eur > 0 THEN amount_eur ELSE 0 END), 0) AS income FROM transactions WHERE ${base}`)
      .bind(u, prevFrom, prevTo).first<{ spent: number; income: number }>(),
    db.prepare('SELECT id, parent_id FROM categories WHERE user_id = ?').bind(u).all<{ id: string; parent_id: string | null }>(),
  ]);
  const parentOf = new Map(cats.results.map((c) => [c.id, c.parent_id ?? c.id]));
  type Sum = { total: number; count: number };
  const add = <K>(m: Map<K, Sum>, k: K, total: number, count: number) => {
    const cur = m.get(k) ?? { total: 0, count: 0 };
    cur.total += total;
    cur.count += count;
    m.set(k, cur);
  };
  const byDesc = (x: { total: number }, y: { total: number }) => y.total - x.total;
  const totals = { spent: 0, income: 0, count: 0 };
  const catSum = new Map<string | null, Sum>();
  const subSum = new Map<string | null, Sum>();
  const incomeSum = new Map<string | null, Sum>();
  const natureSum = new Map<string | null, Sum>();
  const cardSum = new Map<string | null, Sum>();
  for (const g of groups.results) {
    totals.count += g.count;
    if (g.sign < 0) {
      const spent = -g.total;
      totals.spent += spent;
      add(catSum, g.category_id ? parentOf.get(g.category_id) ?? null : null, spent, g.count);
      add(subSum, g.category_id, spent, g.count);
      add(natureSum, g.nature, spent, g.count);
      add(cardSum, g.card, spent, g.count);
    } else if (g.sign > 0) {
      totals.income += g.total;
      add(incomeSum, g.category_id, g.total, g.count);
    }
  }
  const byCategory = { results: [...catSum].map(([category_id, v]) => ({ category_id, ...v })).sort(byDesc) };
  const bySub = { results: [...subSum].map(([category_id, v]) => ({ category_id, parent_id: category_id ? parentOf.get(category_id) ?? null : null, ...v })).sort(byDesc) };
  const incomeByCategory = { results: [...incomeSum].map(([category_id, v]) => ({ category_id, ...v })).sort(byDesc) };
  const byNature = { results: [...natureSum].map(([nature, v]) => ({ nature, total: v.total })) };
  const byCard = { results: [...cardSum].map(([card, v]) => ({ card, ...v })).sort(byDesc) };

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
    by_category: byCategory.results, by_subcategory: bySub.results, income_by_category: incomeByCategory.results,
    by_nature: byNature.results, by_merchant: byMerchant.results, by_card: byCard.results, daily: daily.results,
  });
});

/** Saldo totale in euro giorno per giorno: ultimi N giorni, oppure da `from` a `to` (escluso, al massimo 3 anni). */
statsApi.get('/balance', async (c) => {
  const qf = c.req.query('from');
  const qt = c.req.query('to');
  const today = new Date().toISOString().slice(0, 10);
  let days = Math.min(Number(c.req.query('days')) || 30, 366);
  let start = new Date(Date.now() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  if (qf && qt && /^\d{4}-\d{2}-\d{2}$/.test(qf) && /^\d{4}-\d{2}-\d{2}$/.test(qt)) {
    const end = qt > today ? new Date(Date.parse(`${today}T00:00:00Z`) + 86400_000).toISOString().slice(0, 10) : qt;
    start = qf;
    days = Math.max(1, Math.min(1100, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${qf}T00:00:00Z`)) / 86400_000)));
  }
  const db = c.env.DB;
  const u = uid(c);
  const { results: accounts } = await db.prepare('SELECT currency, initial_balance FROM accounts WHERE user_id = ? AND archived = 0').bind(u).all<{ currency: string; initial_balance: number }>();
  let initial = 0;
  for (const a of accounts) {
    if (!a.initial_balance) continue;
    const rate = await getEurRate(db, a.currency, new Date().toISOString().slice(0, 10));
    initial += rate ? Math.round(a.initial_balance * rate.eurPerUnit) : 0;
  }
  // Saldo prima dell'inizio = totale di sempre (tabella dei totali) − movimenti da `start` in poi: niente somma di tutto lo storico.
  const all = await db.prepare('SELECT COALESCE(SUM(amount_eur), 0) AS v FROM account_totals WHERE user_id = ?').bind(u).first<{ v: number }>();
  const { results } = await db
    .prepare('SELECT substr(occurred_at, 1, 10) AS day, SUM(amount_eur) AS delta FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND duplicate_of IS NULL AND occurred_at >= ? GROUP BY day ORDER BY day')
    .bind(u, start).all<{ day: string; delta: number }>();
  const deltas = new Map(results.map((r) => [r.day, r.delta]));
  const after = results.reduce((s, r) => s + r.delta, 0);
  let running = initial + (all?.v ?? 0) - after;
  const series: Array<{ day: string; balance: number }> = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
    running += deltas.get(day) ?? 0;
    series.push({ day, balance: running });
  }
  return c.json({ series });
});
