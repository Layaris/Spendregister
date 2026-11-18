// Avvisi (spesa insolita, possibili doppioni, commissioni, budget quasi finito), previsione di fine mese
// basata solo sullo storico e riepilogo della settimana. Tutto calcolato al volo con poche query aggregate.
import { Hono } from 'hono';
import { accountInfo } from './auth';
import { budgetView } from './budgets';
import { uid, type AppEnv } from './lib';
import { seedId } from './seed';

export const insightsApi = new Hono<AppEnv>();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const monthStart = (day: string, add = 0) => {
  const [y, m] = day.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + add, 1));
  return d.toISOString().slice(0, 10);
};
const LIVE = "t.user_id = ?1 AND t.deleted_at IS NULL AND t.duplicate_of IS NULL";

/** Il testo lo compone l'app (valuta di visualizzazione): qui solo i dati. */
export interface Alert { id: string; kind: 'unusual' | 'duplicate' | 'fees' | 'budget' | 'capture_silent'; days?: number; device?: string; tx?: string; amount?: number; avg?: number; merchant?: string | null; category_id?: string; pct?: number; cards?: Array<{ card: string; total: number }> }

interface DupRow { id: string; merchant: string | null; amount: number; currency: string; type: string; amount_eur: number; occurred_utc: string }

/** Coppie con stesso importo, valuta, tipo e negozio a meno di un'ora; avvisa sul più recente (al massimo 5). */
export function findDuplicates(rows: DupRow[], from: string): Alert[] {
  const out: Alert[] = [];
  const sorted = [...rows].sort((a, b) => a.occurred_utc.localeCompare(b.occurred_utc) || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length && out.length < 5; i++) {
    const b = sorted[i];
    const tb = Date.parse(b.occurred_utc);
    for (let j = i - 1; j >= 0; j--) {
      const a = sorted[j];
      if (tb - Date.parse(a.occurred_utc) >= 3600_000) break;
      if (a.amount !== b.amount || a.currency !== b.currency || a.type !== b.type) continue;
      if ((a.merchant ?? '').toLowerCase() !== (b.merchant ?? '').toLowerCase()) continue;
      if (a.occurred_utc.slice(0, 10) < from && b.occurred_utc.slice(0, 10) < from) continue;
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      out.push({ id: `dup:${x}:${y}`, kind: 'duplicate', tx: b.id, amount: -b.amount_eur, merchant: b.merchant });
      break;
    }
  }
  return out;
}

insightsApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const today = DAY.test(c.req.query('today') ?? '') ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
  const features = (await accountInfo(db, u)).features;
  const out: { alerts: Alert[]; forecast: unknown; week: unknown } = { alerts: [], forecast: null, week: null };

  if (features.alerts) {
    const [unusual, dups, fees, budget] = await Promise.all([
      // Spesa insolita: almeno il doppio della media dello stesso negozio (con almeno 3 spese prima) e almeno 10 € in più.
      db.prepare(`WITH recent AS (SELECT t.id, t.merchant, -t.amount_eur AS amount, t.occurred_at FROM transactions t INDEXED BY tx_user_occurred
          WHERE ${LIVE} AND t.type = 'expense' AND t.merchant IS NOT NULL AND t.occurred_at >= ?2 ORDER BY t.occurred_at DESC LIMIT 40)
        SELECT r.id, r.merchant, r.amount, AVG(-x.amount_eur) AS avg, COUNT(x.id) AS n FROM recent r
        LEFT JOIN transactions x INDEXED BY tx_user_merchant ON x.user_id = ?1 AND x.merchant = r.merchant COLLATE NOCASE AND x.type = 'expense'
          AND x.deleted_at IS NULL AND x.duplicate_of IS NULL AND x.id <> r.id AND x.occurred_at < r.occurred_at AND x.occurred_at >= ?3
        GROUP BY r.id`).bind(u, shift(today, -7), shift(today, -365)).all<{ id: string; merchant: string; amount: number; avg: number | null; n: number }>(),
      // Possibili doppioni: stesso importo e negozio a meno di un'ora di distanza, negli ultimi 14 giorni.
      // Si leggono solo i movimenti di quei giorni e si confrontano qui (un join sulla tabella intera leggeva tutto lo storico).
      db.prepare(`SELECT t.id, t.merchant, t.amount, t.currency, t.type, t.amount_eur, t.occurred_utc FROM transactions t INDEXED BY tx_user_occurred
          WHERE ${LIVE} AND t.type <> 'transfer' AND t.occurred_at >= ?2 LIMIT 2000`).bind(u, shift(today, -15))
        .all<{ id: string; merchant: string | null; amount: number; currency: string; type: string; amount_eur: number; occurred_utc: string }>(),
      // Commissioni bancarie del mese, per carta.
      db.prepare(`SELECT COALESCE(t.card, '') AS card, -SUM(t.amount_eur) AS total FROM transactions t INDEXED BY tx_user_occurred
        WHERE ${LIVE} AND t.type = 'expense' AND t.occurred_at >= ?2 AND (t.category_id = ?3 OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ?3 AND user_id = ?1))
        GROUP BY t.card ORDER BY total DESC`).bind(u, monthStart(today), seedId('cat_fin_fees', u)).all<{ card: string; total: number }>(),
      budgetView(db, u, today.slice(0, 7), today),
    ]);
    // Cattura ferma: un telefono che mandava spese non ne manda da più di 2 giorni (batteria, comando rotto, permessi).
    const { results: devs } = await db.prepare('SELECT name, last_capture_at FROM devices WHERE user_id = ? AND revoked_at IS NULL AND last_capture_at IS NOT NULL')
      .bind(u).all<{ name: string; last_capture_at: string }>();
    const last = devs.reduce<{ name: string; last_capture_at: string } | null>((m, d) => (!m || d.last_capture_at > m.last_capture_at ? d : m), null);
    if (last) {
      const days = Math.floor((Date.parse(`${today}T23:59:59Z`) - Date.parse(last.last_capture_at)) / 86400_000);
      if (days >= 2) out.alerts.push({ id: `silent:${last.last_capture_at.slice(0, 10)}`, kind: 'capture_silent', days, device: last.name });
    }
    for (const r of unusual.results) {
      if (r.n >= 3 && r.avg && r.amount >= r.avg * 2 && r.amount - r.avg >= 10_000) {
        out.alerts.push({ id: `unusual:${r.id}`, kind: 'unusual', tx: r.id, amount: r.amount, avg: Math.round(r.avg), merchant: r.merchant });
      }
    }
    for (const d of findDuplicates(dups.results, shift(today, -14))) out.alerts.push(d);
    const feeTotal = fees.results.reduce((s, f) => s + f.total, 0);
    if (feeTotal >= 1000) {
      out.alerts.push({ id: `fees:${today.slice(0, 7)}`, kind: 'fees', amount: feeTotal, cards: fees.results.filter((f) => f.card) });
    }
    for (const b of budget.categories) {
      if (b.pct >= 80) out.alerts.push({ id: `budget:${b.category_id}:${today.slice(0, 7)}:${b.pct >= 100 ? 100 : 80}`, kind: 'budget', amount: b.left, category_id: b.category_id, pct: b.pct });
    }
    if (budget.total && budget.total.amount > 0) {
      const p = Math.round((budget.total.spent / budget.total.amount) * 100);
      if (p >= 80) out.alerts.push({ id: `budget:*:${today.slice(0, 7)}:${p >= 100 ? 100 : 80}`, kind: 'budget', amount: budget.total.left, category_id: '*', pct: p });
    }
  }

  if (features.forecast) {
    // Ultimi 3 mesi interi: media per categoria; servono almeno 2 mesi con movimenti.
    const from = monthStart(today, -3);
    const cur = monthStart(today);
    const [past, now] = await Promise.all([
      db.prepare(`SELECT substr(t.occurred_at, 1, 7) AS m, t.type, t.category_id, SUM(t.amount_eur) AS total FROM transactions t INDEXED BY tx_user_occurred
        WHERE ${LIVE} AND t.type <> 'transfer' AND t.occurred_at >= ?2 AND t.occurred_at < ?3
        GROUP BY m, t.type, t.category_id`).bind(u, from, cur).all<{ m: string; type: string; category_id: string | null; total: number }>(),
      db.prepare(`SELECT t.type, t.category_id, SUM(t.amount_eur) AS total FROM transactions t INDEXED BY tx_user_occurred
        WHERE ${LIVE} AND t.type <> 'transfer' AND t.occurred_at >= ?2 AND t.occurred_at < date(?3, '+1 day')
        GROUP BY t.type, t.category_id`).bind(u, cur, today).all<{ type: string; category_id: string | null; total: number }>(),
    ]);
    const months = new Set(past.results.map((r) => r.m)).size;
    if (months >= 2) {
      const avg = new Map<string, number>();
      let avgIncome = 0;
      for (const r of past.results) {
        if (r.type === 'income') avgIncome += r.total / months;
        else avg.set(r.category_id ?? '', (avg.get(r.category_id ?? '') ?? 0) - r.total / months);
      }
      const spentNow = new Map<string, number>();
      let incomeNow = 0;
      for (const r of now.results) {
        if (r.type === 'income') incomeNow += r.total;
        else spentNow.set(r.category_id ?? '', (spentNow.get(r.category_id ?? '') ?? 0) - r.total);
      }
      let expected = 0;
      let spent = 0;
      for (const k of new Set([...avg.keys(), ...spentNow.keys()])) {
        expected += Math.max(avg.get(k) ?? 0, spentNow.get(k) ?? 0);
        spent += spentNow.get(k) ?? 0;
      }
      out.forecast = { months, spent: Math.round(spent), expected_spend: Math.round(expected), income: Math.round(incomeNow), expected_income: Math.round(Math.max(avgIncome, incomeNow)) };
    } else out.forecast = { months, spent: null };
  }

  if (features.weekly_summary) {
    const [w, prev, top] = await Promise.all([
      db.prepare(`SELECT COALESCE(-SUM(t.amount_eur), 0) AS spent, COUNT(*) AS n FROM transactions t INDEXED BY tx_user_occurred WHERE ${LIVE} AND t.type = 'expense'
        AND t.occurred_at >= date(?2, '+1 day') AND t.occurred_at < date(?3, '+1 day')`).bind(u, shift(today, -7), today).first<{ spent: number; n: number }>(),
      db.prepare(`SELECT COALESCE(-SUM(t.amount_eur), 0) AS spent FROM transactions t INDEXED BY tx_user_occurred WHERE ${LIVE} AND t.type = 'expense'
        AND t.occurred_at >= date(?2, '+1 day') AND t.occurred_at < date(?3, '+1 day')`).bind(u, shift(today, -14), shift(today, -7)).first<{ spent: number }>(),
      db.prepare(`SELECT t.category_id, -SUM(t.amount_eur) AS total FROM transactions t INDEXED BY tx_user_occurred WHERE ${LIVE} AND t.type = 'expense'
        AND t.occurred_at >= date(?2, '+1 day') AND t.occurred_at < date(?3, '+1 day') GROUP BY t.category_id ORDER BY total DESC LIMIT 3`).bind(u, shift(today, -7), today).all<{ category_id: string | null; total: number }>(),
    ]);
    out.week = { from: shift(today, -6), to: today, spent: w?.spent ?? 0, count: w?.n ?? 0, previous: prev?.spent ?? 0, top: top.results };
  }
  return c.json(out);
});
