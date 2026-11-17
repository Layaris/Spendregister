// Budget mensili. Il totale è il tetto; i budget di categoria sono ritagli del totale.
// Quello che una categoria spende oltre il suo budget si toglie da "tutto il resto" (scelta del proprietario):
// così "ti restano" = totale − speso, sempre.
import { Hono } from 'hono';
import { bad, body, nowIso, uid, type AppEnv } from './lib';

export const budgetsApi = new Hono<AppEnv>();

export interface BudgetView {
  month: string;
  days: { total: number; elapsed: number };
  total: { amount: number; spent: number; left: number; per_day: number } | null;
  categories: Array<{ category_id: string; amount: number; spent: number; left: number; pct: number }>;
  rest: { amount: number; spent: number; left: number } | null;
  spent: number;
}

const monthOf = (q: string | undefined) => (q && /^\d{4}-\d{2}$/.test(q) ? q : null);
const nextMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
};

/** Situazione dei budget in un mese (YYYY-MM), con oggi nel fuso del browser (`today`). */
export async function budgetView(db: D1Database, u: string, month: string, today: string): Promise<BudgetView> {
  const from = `${month}-01`;
  const to = `${nextMonth(month)}-01`;
  const totalDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
  const elapsed = today < from ? 0 : today >= to ? totalDays : Number(today.slice(8, 10));
  const [rows, spentRow] = await Promise.all([
    db.prepare(`SELECT b.category_id, b.amount,
        CASE WHEN b.category_id = '*' THEN 0 ELSE COALESCE((SELECT -SUM(t.amount_eur) FROM transactions t
          WHERE t.user_id = b.user_id AND t.deleted_at IS NULL AND t.duplicate_of IS NULL AND t.type = 'expense'
            AND t.occurred_at >= ? AND t.occurred_at < ?
            AND (t.category_id = b.category_id OR t.category_id IN (SELECT id FROM categories WHERE parent_id = b.category_id AND user_id = b.user_id))), 0) END AS spent
      FROM budgets b WHERE b.user_id = ?`).bind(from, to, u).all<{ category_id: string; amount: number; spent: number }>(),
    db.prepare(`SELECT COALESCE(-SUM(amount_eur), 0) AS spent FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND duplicate_of IS NULL
      AND type = 'expense' AND occurred_at >= ? AND occurred_at < ?`).bind(u, from, to).first<{ spent: number }>(),
  ]);
  const spent = Math.max(0, spentRow?.spent ?? 0);
  const totalRow = rows.results.find((r) => r.category_id === '*');
  const cats = rows.results.filter((r) => r.category_id !== '*').map((r) => {
    const s = Math.max(0, r.spent);
    return { category_id: r.category_id, amount: r.amount, spent: s, left: r.amount - s, pct: r.amount > 0 ? Math.round((s / r.amount) * 100) : 0 };
  }).sort((a, b) => b.pct - a.pct);
  // Giorni rimasti contando oggi: il 17 di un mese di 30 ne restano 14.
  const daysLeft = today < from ? totalDays : today >= to ? 1 : totalDays - elapsed + 1;
  let total: BudgetView['total'] = null;
  let rest: BudgetView['rest'] = null;
  if (totalRow) {
    const left = totalRow.amount - spent;
    total = { amount: totalRow.amount, spent, left, per_day: Math.max(0, Math.floor(left / daysLeft)) };
    const carved = cats.reduce((s, c) => s + c.amount, 0);
    const inCats = cats.reduce((s, c) => s + c.spent, 0);
    const over = cats.reduce((s, c) => s + Math.max(0, c.spent - c.amount), 0);
    const restAmount = totalRow.amount - carved;
    const restSpent = spent - inCats;
    rest = { amount: restAmount, spent: restSpent, left: restAmount - restSpent - over };
  }
  return { month, days: { total: totalDays, elapsed }, total, categories: cats, rest, spent };
}

budgetsApi.get('/', async (c) => {
  const today = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query('today') ?? '') ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
  const month = monthOf(c.req.query('month')) ?? today.slice(0, 7);
  return c.json(await budgetView(c.env.DB, uid(c), month, today));
});

/** Imposta (amount in millesimi di euro) o toglie (amount null o 0) un budget. category_id '*' = totale. */
budgetsApi.put('/', async (c) => {
  const b = await body<{ category_id?: string; amount?: number | null }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const cat = b.category_id;
  if (!cat) bad('Categoria mancante');
  if (cat !== '*') {
    const row = await db.prepare('SELECT kind FROM categories WHERE id = ? AND user_id = ?').bind(cat, u).first<{ kind: string }>();
    if (!row) bad('Categoria non trovata');
    if (row.kind !== 'expense') bad('Il budget si mette sulle categorie di spesa');
  }
  if (b.amount == null || b.amount === 0) {
    await db.prepare('DELETE FROM budgets WHERE user_id = ? AND category_id = ?').bind(u, cat).run();
    return c.json({ ok: true });
  }
  const amount = Math.round(Number(b.amount));
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e15) bad('Importo non valido');
  await db.prepare('INSERT INTO budgets (user_id, category_id, amount, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, category_id) DO UPDATE SET amount = excluded.amount, updated_at = excluded.updated_at')
    .bind(u, cat, amount, nowIso()).run();
  return c.json({ ok: true });
});
