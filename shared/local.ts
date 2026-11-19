// Copia completa dei dati sul telefono: le stesse risposte delle API del server (GET), calcolate dalla copia locale.
// Ogni funzione rifà la query del server che ha lo stesso percorso (worker/*.ts); i test d'integrazione confrontano
// le due risposte sullo stesso archivio (tests/integration, "copia completa"). Se cambi una query del server,
// cambia anche qui.
import { appLabel } from './apps';
import { fxFeeEstimate, type CardFx } from './cardfx';
import { countryOf, staysOf, type DayRow } from './countries';
import { findDuplicates, type Alert } from './insights';
import { detectRecurring, graceDays, nextDue, perMonth, type Occurrence, type Period } from './recurring';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

export interface SyncExtras {
  user_id: string;
  today: string;
  rates: Record<string, number | null>;
  devices: Array<{ name: string; last_capture_at: string | null }>;
  card_sources?: Array<{ key: string; card: string }>;
  parsers?: Array<{ name: string; app: string }>;
  settings: Row & { features?: Record<string, boolean> };
  account: { email: string | null };
}

export interface SyncResponse extends SyncExtras {
  cursor: number;
  reset?: boolean;
  changes?: Record<string, Row[]>;
  removed?: Record<string, string[]>;
}

export const LOCAL_TABLES = ['accounts', 'categories', 'labels', 'transactions', 'budgets', 'recurring', 'trips', 'trip_items', 'card_settings', 'merchant_aliases'] as const;
export type LocalTable = (typeof LOCAL_TABLES)[number];

export function keyOf(table: string, r: Row): string {
  switch (table) {
    case 'budgets': return r.category_id;
    case 'trip_items': return `${r.trip_id}|${r.transaction_id}`;
    case 'card_settings': return r.card;
    case 'merchant_aliases': return r.alias;
    default: return r.id;
  }
}

/** Stato salvato sul telefono. */
export interface LocalSnapshot { cursor: number; extras: SyncExtras; tables: Record<string, Row[]> }

// ---- piccoli aiuti uguali a SQLite ----
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** COLLATE NOCASE di SQLite: solo le lettere A-Z diventano minuscole. */
const fold = (s: string) => s.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
const nocaseEq = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && fold(a) === fold(b);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const plusDay = (day: string) => shift(day, 1);
const monthStart = (day: string, add = 0) => {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + add, 1)).toISOString().slice(0, 10);
};
const parseJson = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};
const live = (t: Row) => t.deleted_at == null && t.duplicate_of == null;
const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);

export class LocalDb {
  cursor: number;
  extras: SyncExtras;
  tables: Record<string, Map<string, Row>>;
  /** Movimenti ordinati per occurred_at (per i periodi): ricostruiti dopo ogni modifica. */
  private byTime: Row[] | null = null;

  constructor(s: LocalSnapshot) {
    this.cursor = s.cursor;
    this.extras = s.extras;
    this.tables = {};
    for (const t of LOCAL_TABLES) this.tables[t] = new Map((s.tables[t] ?? []).map((r) => [keyOf(t, r), r]));
  }

  snapshot(): LocalSnapshot {
    const tables: Record<string, Row[]> = {};
    for (const t of LOCAL_TABLES) tables[t] = [...this.tables[t].values()];
    return { cursor: this.cursor, extras: this.extras, tables };
  }

  /** Applica la risposta di GET /api/sync (non `reset`). */
  apply(r: SyncResponse): boolean {
    let changed = false;
    for (const [t, rows] of Object.entries(r.changes ?? {})) {
      const m = this.tables[t];
      if (!m) continue;
      for (const row of rows) { m.set(keyOf(t, row), row); changed = true; }
    }
    for (const [t, keys] of Object.entries(r.removed ?? {})) {
      const m = this.tables[t];
      if (!m) continue;
      for (const k of keys) if (m.delete(k)) changed = true;
    }
    const { cursor, reset, changes, removed, ...extras } = r;
    void reset; void changes; void removed;
    if (JSON.stringify(extras) !== JSON.stringify(this.extras)) changed = true;
    this.extras = extras;
    this.cursor = cursor;
    if (changed) this.byTime = null;
    return changed;
  }

  private rows(t: LocalTable): Row[] { return [...this.tables[t].values()]; }
  private get uid() { return this.extras.user_id; }
  private seed(base: string) { return `${base}~${this.uid}`; }
  private txs(): Row[] {
    if (!this.byTime) this.byTime = this.rows('transactions').sort((a, b) => cmp(a.occurred_at, b.occurred_at));
    return this.byTime;
  }
  /** Movimenti con occurred_at in [from, to) (stringhe come in SQLite). */
  private period(from: string, to: string | null): Row[] {
    const all = this.txs();
    let lo = 0;
    let hi = all.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (all[mid].occurred_at < from) lo = mid + 1; else hi = mid; }
    const out: Row[] = [];
    for (let i = lo; i < all.length && (to == null || all[i].occurred_at < to); i++) out.push(all[i]);
    return out;
  }
  private parentOf(): Map<string, string> {
    return new Map(this.rows('categories').map((c) => [c.id, c.parent_id ?? c.id]));
  }
  private withChildren(cat: string): Set<string> {
    const s = new Set([cat]);
    for (const c of this.rows('categories')) if (c.parent_id === cat) s.add(c.id);
    return s;
  }
  private features(): Record<string, boolean> { return this.extras.settings.features ?? {}; }

  /** Risposta locale per un GET dell'API, o `undefined` se questo percorso lo sa solo il server. */
  get(path: string, now = new Date()): unknown | undefined {
    const [p, qs = ''] = path.split('?');
    const q: Record<string, string> = Object.fromEntries(new URLSearchParams(qs));
    const utcToday = now.toISOString().slice(0, 10);
    switch (p) {
      case '/bootstrap': return this.bootstrap();
      case '/transactions': return this.transactions(q);
      case '/stats': return q.from && q.to ? this.stats(q.from, q.to, q.currency, utcToday) : undefined;
      case '/stats/balance': return this.balance(q, now);
      case '/stats/fees': return q.from && q.to ? this.fees(q.from, q.to) : undefined;
      case '/stats/countries': return q.from && q.to ? this.countries(q.from, q.to) : undefined;
      case '/stats/months': return this.months(q, utcToday);
      case '/budgets': {
        const today = DAY.test(q.today ?? '') ? q.today : utcToday;
        const month = /^\d{4}-\d{2}$/.test(q.month ?? '') ? q.month : today.slice(0, 7);
        return this.budgetView(month, today);
      }
      case '/insights': return this.insights(DAY.test(q.today ?? '') ? q.today : utcToday);
      case '/recurring': return this.recurring(DAY.test(q.today ?? '') ? q.today : utcToday);
      case '/cards': return this.cards(now);
      case '/trips': return this.trips();
      case '/fx': {
        const cur = (q.currency ?? 'EUR').toUpperCase();
        if (q.date || (cur !== 'EUR' && !(cur in this.extras.rates))) return undefined;
        return { currency: cur, eurPerUnit: cur === 'EUR' ? 1 : this.extras.rates[cur] };
      }
      default: {
        const m = p.match(/^\/transactions\/([^/]+)$/);
        if (m && !['recategorize', 'confirm-ready'].includes(m[1])) return this.detail(decodeURIComponent(m[1]));
        return undefined;
      }
    }
  }

  // ---- /bootstrap (worker/catalog.ts) ----
  bootstrap() {
    const rates = this.extras.rates;
    const accounts = this.rows('accounts').filter((a) => !a.archived).sort((a, b) => a.position - b.position || cmp(a.name, b.name));
    const sums = new Map<string, { same: number; other: number }>();
    const accCur = new Map(this.rows('accounts').map((a) => [a.id, a.currency]));
    for (const t of this.txs()) {
      if (!live(t) || !t.account_id) continue;
      const s = sums.get(t.account_id) ?? { same: 0, other: 0 };
      if (t.currency === accCur.get(t.account_id)) s.same += t.amount;
      else s.other += t.amount_eur;
      sums.set(t.account_id, s);
    }
    return {
      accounts: accounts.map((a) => {
        const s = sums.get(a.id) ?? { same: 0, other: 0 };
        const rate = a.currency !== 'EUR' ? rates[a.currency] ?? null : 1;
        const extra = s.other && rate ? Math.round(s.other / rate) : 0;
        const balance = (a.initial_balance ?? 0) + s.same + extra;
        return { ...a, balance, balance_eur: rate ? Math.round(balance * rate) : null };
      }),
      categories: this.rows('categories').filter((c) => !c.archived).sort((a, b) => a.position - b.position || cmp(a.name, b.name)),
      labels: this.rows('labels').sort((a, b) => cmp(a.name, b.name)),
      review_count: this.rows('transactions').filter((t) => t.status === 'review' && t.deleted_at == null).length,
      settings: this.extras.settings,
      account: this.extras.account,
    };
  }

  // ---- /transactions (worker/transactions.ts) ----
  private shape(t: Row) {
    const names = new Map(this.rows('labels').map((l) => [l.id, l.name]));
    const { label_ids, ...rest } = t;
    const labels = String(label_ids ?? '').split(',').filter(Boolean).map((id) => names.get(id)).filter((x): x is string => !!x);
    return { ...rest, labels, review_choices: parseJson<string[]>(t.review_choices, []), rule_ids: parseJson<string[]>(t.rule_ids, []) };
  }

  private inTrip(tripId: string): (t: Row) => boolean {
    const trip = this.tables.trips.get(tripId);
    const items = this.rows('trip_items').filter((i) => i.trip_id === tripId);
    const out = new Set(items.filter((i) => i.mode === 'out').map((i) => i.transaction_id));
    const inn = new Set(items.filter((i) => i.mode === 'in').map((i) => i.transaction_id));
    const end = trip ? plusDay(trip.end_date) : null;
    return (t) => (!!trip && t.occurred_at >= trip.start_date && t.occurred_at < end! && !out.has(t.id)) || inn.has(t.id);
  }

  transactions(q: Record<string, string>) {
    const like = q.q ? fold(q.q) : null;
    const cats = q.category ? this.withChildren(q.category) : null;
    const trip = q.trip ? this.inTrip(q.trip) : null;
    const min = q.min && Number.isFinite(Number(q.min)) ? Number(q.min) : null;
    const max = q.max && Number.isFinite(Number(q.max)) ? Number(q.max) : null;
    const rows = (q.from ? this.period(q.from, q.to || null) : this.rows('transactions')).filter((t) => {
      if (t.deleted_at != null) return false;
      if (q.to && !(t.occurred_at < q.to)) return false;
      if (q.status && t.status !== q.status) return false;
      if (q.account && t.account_id !== q.account) return false;
      if (cats && !cats.has(t.category_id)) return false;
      if (q.merchant && t.merchant !== q.merchant) return false;
      if (q.currency && /^[A-Z]{3}$/.test(q.currency) && t.currency !== q.currency) return false;
      if (like && ![t.merchant, t.merchant_raw, t.note, t.card, t.place].some((v) => v != null && fold(String(v)).includes(like))) return false;
      if (q.type && ['expense', 'income', 'transfer'].includes(q.type) && t.type !== q.type) return false;
      if (q.card) { if (q.card === '-' ? t.card != null : t.card !== q.card) return false; }
      if (q.label && !String(t.label_ids ?? '').split(',').includes(q.label)) return false;
      if (min != null && !(Math.abs(t.amount_eur) >= min)) return false;
      if (max != null && !(Math.abs(t.amount_eur) <= max)) return false;
      if (trip && !trip(t)) return false;
      return true;
    });
    rows.sort((a, b) => cmp(b.occurred_utc, a.occurred_utc) || cmp(b.created_at, a.created_at) || cmp(b.id, a.id));
    const limit = Math.min(Number(q.limit) || 100, 500);
    const offset = Number(q.offset) || 0;
    const items = rows.slice(offset, offset + limit).map((t) => this.shape(t));
    const out: Row = { items, limit, offset };
    if (q.sum && !offset) {
      out.summary = {
        count: rows.length,
        spent: -sumBy(rows.filter((t) => t.type === 'expense' && t.duplicate_of == null), (t) => t.amount_eur) || 0,
        income: sumBy(rows.filter((t) => t.type === 'income' && t.duplicate_of == null), (t) => t.amount_eur),
      };
    }
    return out;
  }

  /** Dettaglio senza rete: i dati del movimento (testo della notifica e nomi delle regole solo dal server). */
  detail(id: string) {
    const t = this.tables.transactions.get(id);
    if (!t || t.deleted_at != null) return undefined;
    const fx = (t.card ? this.tables.card_settings.get(t.card) : null) as CardFx | null ?? null;
    const split = t.split_group
      ? this.rows('transactions').filter((x) => x.split_group === t.split_group && x.deleted_at == null)
        .sort((a, b) => cmp(a.created_at, b.created_at) || cmp(a.id, b.id))
        .map((x) => ({ id: x.id, amount: x.amount, currency: x.currency, amount_eur: x.amount_eur, category_id: x.category_id }))
      : null;
    return { ...this.shape(t), capture: null, rules: [], card_fx: fx ? { ...fx } : null, fx_fee: fxFeeEstimate(fx, t.currency, t.amount_eur), split };
  }

  // ---- /stats (worker/stats.ts) ----
  stats(from: string, to: string, currency: string | undefined, today: string) {
    const cur = /^[A-Z]{3}$/.test(currency ?? '') ? currency! : null;
    const inBase = (t: Row) => live(t) && t.type !== 'transfer' && (!cur || t.currency === cur);
    const f = Date.parse(`${from}T00:00:00Z`);
    const len = Date.parse(`${to}T00:00:00Z`) - f;
    const prevFrom = new Date(f - len).toISOString().slice(0, 10);
    const prevTo = from;
    const rows = this.period(from, to).filter(inBase);
    const parentOf = this.parentOf();
    type Sum = { total: number; count: number };
    const add = <K>(m: Map<K, Sum>, k: K, total: number, count: number) => {
      const s = m.get(k) ?? { total: 0, count: 0 };
      s.total += total; s.count += count; m.set(k, s);
    };
    // Gruppi come nel server (categoria, tipo, carta, segno), poi le somme.
    const groups = new Map<string, { category_id: string | null; nature: string | null; card: string | null; sign: number; total: number; count: number }>();
    for (const t of rows) {
      const sign = t.amount_eur < 0 ? -1 : t.amount_eur > 0 ? 1 : 0;
      const k = JSON.stringify([t.category_id, t.nature, t.card, sign]);
      const g = groups.get(k) ?? { category_id: t.category_id, nature: t.nature, card: t.card, sign, total: 0, count: 0 };
      g.total += t.amount_eur; g.count += 1; groups.set(k, g);
    }
    const gl = [...groups.values()].sort((a, b) => cmpNull(a.category_id, b.category_id) || cmpNull(a.nature, b.nature) || cmpNull(a.card, b.card) || a.sign - b.sign);
    const totals = { spent: 0, income: 0, count: 0 };
    const catSum = new Map<string | null, Sum>();
    const subSum = new Map<string | null, Sum>();
    const incomeSum = new Map<string | null, Sum>();
    const natureSum = new Map<string | null, Sum>();
    const cardSum = new Map<string | null, Sum>();
    for (const g of gl) {
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
    const byDesc = (x: { total: number }, y: { total: number }) => y.total - x.total;
    const daily = new Map<string, { day: string; spent: number; income: number; must: number; need: number; want: number }>();
    for (const t of rows) {
      const day = t.occurred_at.slice(0, 10);
      const d = daily.get(day) ?? { day, spent: 0, income: 0, must: 0, need: 0, want: 0 };
      if (t.amount_eur < 0) {
        d.spent += -t.amount_eur;
        if (t.nature === 'must') d.must += -t.amount_eur;
        if (t.nature === 'need') d.need += -t.amount_eur;
        if (t.nature === 'want') d.want += -t.amount_eur;
      } else if (t.amount_eur > 0) d.income += t.amount_eur;
      daily.set(day, d);
    }
    const merch = new Map<string, Sum>();
    for (const t of rows) if (t.amount_eur < 0 && t.merchant != null) add(merch, t.merchant as string, -t.amount_eur, 1);
    const prev = this.period(prevFrom, prevTo).filter(inBase);
    const totalDays = Math.round(len / 86400_000);
    const elapsed = today < from ? 0 : today >= to ? totalDays : Math.round((Date.parse(`${today}T00:00:00Z`) - f) / 86400_000) + 1;
    const forecast = elapsed > 0 ? Math.round((totals.spent / elapsed) * totalDays) : totals.spent;
    return {
      from, to, spent: totals.spent, income: totals.income, count: totals.count,
      previous: { from: prevFrom, to: prevTo, spent: sumBy(prev.filter((t) => t.amount_eur < 0), (t) => -t.amount_eur), income: sumBy(prev.filter((t) => t.amount_eur > 0), (t) => t.amount_eur) },
      forecast, days: { total: totalDays, elapsed },
      by_category: [...catSum].map(([category_id, v]) => ({ category_id, ...v })).sort(byDesc),
      by_subcategory: [...subSum].map(([category_id, v]) => ({ category_id, parent_id: category_id ? parentOf.get(category_id) ?? null : null, ...v })).sort(byDesc),
      income_by_category: [...incomeSum].map(([category_id, v]) => ({ category_id, ...v })).sort(byDesc),
      by_nature: [...natureSum].map(([nature, v]) => ({ nature, total: v.total })),
      by_merchant: [...merch].map(([merchant, v]) => ({ merchant, ...v })).sort((a, b) => b.total - a.total || cmp(a.merchant, b.merchant)).slice(0, 10),
      by_card: [...cardSum].map(([card, v]) => ({ card, ...v })).sort(byDesc),
      daily: [...daily.values()].sort((a, b) => cmp(a.day, b.day)),
    };
  }

  /** Saldo totale giorno per giorno (worker/stats.ts, /stats/balance). */
  balance(q: Record<string, string>, now: Date) {
    const today = now.toISOString().slice(0, 10);
    let days = Math.min(Number(q.days) || 30, 366);
    let start = new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10);
    if (q.from && q.to && DAY.test(q.from) && DAY.test(q.to)) {
      const end = q.to > today ? plusDay(today) : q.to;
      start = q.from;
      days = Math.max(1, Math.min(1100, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86400_000)));
    }
    let initial = 0;
    for (const a of this.rows('accounts')) {
      if (a.archived || !a.initial_balance) continue;
      const rate = a.currency === 'EUR' ? 1 : this.extras.rates[a.currency] ?? null;
      initial += rate ? Math.round(a.initial_balance * rate) : 0;
    }
    const all = sumBy(this.rows('transactions').filter(live), (t) => t.amount_eur);
    const deltas = new Map<string, number>();
    let after = 0;
    for (const t of this.period(start, null)) {
      if (!live(t)) continue;
      const d = t.occurred_at.slice(0, 10);
      deltas.set(d, (deltas.get(d) ?? 0) + t.amount_eur);
      after += t.amount_eur;
    }
    let running = initial + all - after;
    const series: Array<{ day: string; balance: number }> = [];
    for (let i = 0; i < days; i++) {
      const day = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400_000).toISOString().slice(0, 10);
      running += deltas.get(day) ?? 0;
      series.push({ day, balance: running });
    }
    return { series };
  }

  /** Costi bancari per carta (worker/stats.ts, /stats/fees). */
  fees(from: string, to: string) {
    const fees = this.withChildren(this.seed('cat_fin_fees'));
    const atm = this.seed('cat_fin_atm');
    const cash = (t: Row) => (t.type === 'expense' && t.category_id === atm) || (t.type === 'transfer' && t.transfer_group != null && t.source === 'capture' && t.amount < 0);
    const groups = new Map<string, { card: string; currency: string; fees: number; fees_n: number; cash: number; cash_n: number; paid: number }>();
    for (const t of this.period(from, to)) {
      if (!live(t)) continue;
      const card = t.card ?? '';
      const k = `${card}\u0000${t.currency}`;
      const g = groups.get(k) ?? { card, currency: t.currency, fees: 0, fees_n: 0, cash: 0, cash_n: 0, paid: 0 };
      if (t.type === 'expense' && fees.has(t.category_id)) { g.fees += -t.amount_eur; g.fees_n += 1; }
      if (cash(t)) { g.cash += Math.abs(t.amount_eur); g.cash_n += 1; }
      if (t.type === 'expense' || (t.type === 'transfer' && t.transfer_group != null && t.source === 'capture' && t.amount < 0)) g.paid += Math.abs(t.amount_eur);
      groups.set(k, g);
    }
    const fxBy = new Map(this.rows('card_settings').map((f) => [f.card, f as CardFx]));
    const by = new Map<string, { card: string; fees: number; fees_n: number; cash: number; cash_n: number; fx: number; fx_pct: number | null }>();
    for (const r of [...groups.values()].sort((a, b) => cmp(a.card, b.card) || cmp(a.currency, b.currency))) {
      const x = by.get(r.card) ?? { card: r.card, fees: 0, fees_n: 0, cash: 0, cash_n: 0, fx: 0, fx_pct: null };
      x.fees += r.fees; x.fees_n += r.fees_n; x.cash += r.cash; x.cash_n += r.cash_n;
      const f = fxBy.get(r.card);
      const est = fxFeeEstimate(f, r.currency, r.paid);
      if (est != null) { x.fx += est; x.fx_pct = (f!.markup_bp ?? 0) / 100; }
      by.set(r.card, x);
    }
    const results = [...by.values()].filter((x) => x.fees > 0 || x.cash > 0 || x.fx > 0).sort((p, q) => q.fees + q.fx - (p.fees + p.fx));
    return { cards: results, fees: sumBy(results, (r) => r.fees), cash: sumBy(results, (r) => r.cash), fx: sumBy(results, (r) => r.fx) };
  }

  /** Spese per paese (worker/stats.ts, /stats/countries). */
  countries(from: string, to: string) {
    const homeFrom = shift(to, -183);
    const start = homeFrom < from ? homeFrom : from;
    const grouped = new Map<string, DayRow>();
    for (const t of this.period(start, to)) {
      if (!live(t) || t.type !== 'expense') continue;
      const day = t.occurred_at.slice(0, 10);
      const k = `${t.currency}\u0000${day}`;
      const g = grouped.get(k) ?? { currency: t.currency, day, spent: 0, count: 0 };
      g.spent += -t.amount_eur; g.count += 1; grouped.set(k, g);
    }
    const rows = [...grouped.values()].sort((a, b) => cmp(a.currency, b.currency) || cmp(a.day, b.day));
    const homeDays = new Map<string, number>();
    for (const r of rows) if (r.day >= homeFrom) homeDays.set(r.currency, (homeDays.get(r.currency) ?? 0) + 1);
    const home = [...homeDays.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const byCur = new Map<string, DayRow[]>();
    for (const r of rows) if (r.day >= from) byCur.set(r.currency, [...(byCur.get(r.currency) ?? []), r]);
    const countries = [...byCur.entries()].map(([currency, days]) => {
      const spent = sumBy(days, (d) => d.spent);
      return {
        currency, ...countryOf(currency), home: currency === home, spent, count: sumBy(days, (d) => d.count), days: days.length,
        per_day: Math.round(spent / Math.max(1, days.length)), stays: currency === home ? [] : staysOf(days),
      };
    }).sort((a, b) => b.spent - a.spent);
    return { home, countries };
  }

  /** Mese per mese (worker/stats.ts, /stats/months). */
  months(q: Record<string, string>, utcToday: string) {
    const today = DAY.test(q.today ?? '') ? q.today : utcToday;
    const n = Math.min(Math.max(Number(q.months) || 6, 2), 12);
    const [y, m] = today.split('-').map(Number);
    const months = Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
    const parentOf = this.parentOf();
    const grouped = new Map<string, { m: string; category_id: string | null; total: number }>();
    for (const t of this.period(`${months[0]}-01`, plusDay(today))) {
      if (!live(t) || t.type !== 'expense') continue;
      const k = JSON.stringify([t.occurred_at.slice(0, 7), t.category_id]);
      const g = grouped.get(k) ?? { m: t.occurred_at.slice(0, 7), category_id: t.category_id, total: 0 };
      g.total += -t.amount_eur; grouped.set(k, g);
    }
    const by = new Map<string, number[]>();
    for (const r of [...grouped.values()].sort((a, b) => cmp(a.m, b.m) || cmpNull(a.category_id, b.category_id))) {
      const k = (r.category_id ? parentOf.get(r.category_id) : null) ?? '';
      const i = months.indexOf(r.m);
      if (i < 0) continue;
      const arr = by.get(k) ?? new Array(n).fill(0);
      arr[i] += r.total;
      by.set(k, arr);
    }
    const categories = [...by].map(([category_id, values]) => ({ category_id: category_id || null, values, total: values.reduce((a, b) => a + b, 0) }))
      .sort((a, b) => b.total - a.total);
    return { months, categories, totals: months.map((_, i) => sumBy(categories, (x) => x.values[i])), current_partial: true };
  }

  // ---- /budgets (worker/budgets.ts) ----
  budgetView(month: string, today: string) {
    const [yy, mm] = month.split('-').map(Number);
    const from = `${month}-01`;
    const to = `${mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, '0')}`}-01`;
    const totalDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
    const elapsed = today < from ? 0 : today >= to ? totalDays : Number(today.slice(8, 10));
    const exp = this.period(from, to).filter((t) => live(t) && t.type === 'expense');
    const budgets = this.rows('budgets').sort((a, b) => cmp(a.category_id, b.category_id));
    const spent = Math.max(0, -sumBy(exp, (t) => t.amount_eur));
    const totalRow = budgets.find((r) => r.category_id === '*');
    const cats = budgets.filter((r) => r.category_id !== '*').map((r) => {
      const set = this.withChildren(r.category_id);
      const s = Math.max(0, -sumBy(exp.filter((t) => set.has(t.category_id)), (t) => t.amount_eur));
      return { category_id: r.category_id as string, amount: r.amount as number, spent: s, left: r.amount - s, pct: r.amount > 0 ? Math.round((s / r.amount) * 100) : 0 };
    }).sort((a, b) => b.pct - a.pct);
    const daysLeft = today < from ? totalDays : today >= to ? 1 : totalDays - elapsed + 1;
    let total: { amount: number; spent: number; left: number; per_day: number } | null = null;
    let rest: { amount: number; spent: number; left: number } | null = null;
    if (totalRow) {
      const left = totalRow.amount - spent;
      total = { amount: totalRow.amount, spent, left, per_day: Math.max(0, Math.floor(left / daysLeft)) };
      const carved = sumBy(cats, (c) => c.amount);
      const inCats = sumBy(cats, (c) => c.spent);
      const over = sumBy(cats, (c) => Math.max(0, c.spent - c.amount));
      const restAmount = totalRow.amount - carved;
      const restSpent = spent - inCats;
      rest = { amount: restAmount, spent: restSpent, left: restAmount - restSpent - over };
    }
    return { month, days: { total: totalDays, elapsed }, total, categories: cats, rest, spent };
  }

  // ---- /insights (worker/insights.ts) ----
  insights(today: string) {
    const features = this.features();
    const out: { alerts: Alert[]; forecast: unknown; week: unknown } = { alerts: [], forecast: null, week: null };
    const L = (t: Row) => live(t);
    if (features.alerts) {
      const last = this.extras.devices.filter((d) => d.last_capture_at)
        .reduce<{ name: string; last_capture_at: string } | null>((m, d) => (!m || d.last_capture_at! > m.last_capture_at ? (d as { name: string; last_capture_at: string }) : m), null);
      if (last) {
        const days = Math.floor((Date.parse(`${today}T23:59:59Z`) - Date.parse(last.last_capture_at)) / 86400_000);
        if (days >= 2) out.alerts.push({ id: `silent:${last.last_capture_at.slice(0, 10)}`, kind: 'capture_silent', days, device: last.name });
      }
      // Spesa insolita: almeno il doppio della media dello stesso negozio (almeno 3 spese prima) e 10 € in più.
      const recent = this.period(shift(today, -7), null).filter((t) => L(t) && t.type === 'expense' && t.merchant != null)
        .sort((a, b) => cmp(b.occurred_at, a.occurred_at)).slice(0, 40).sort((a, b) => cmp(a.id, b.id));
      if (recent.length) {
        const yearAgo = shift(today, -365);
        const pool = this.period(yearAgo, null).filter((x) => L(x) && x.type === 'expense' && x.merchant != null);
        for (const r of recent) {
          const xs = pool.filter((x) => x.id !== r.id && x.occurred_at < r.occurred_at && nocaseEq(x.merchant, r.merchant));
          const n = xs.length;
          const avg = n ? sumBy(xs, (x) => -x.amount_eur) / n : null;
          const amount = -r.amount_eur;
          if (n >= 3 && avg && amount >= avg * 2 && amount - avg >= 10_000) {
            out.alerts.push({ id: `unusual:${r.id}`, kind: 'unusual', tx: r.id, amount, avg: Math.round(avg), merchant: r.merchant });
          }
        }
      }
      const dups = this.period(shift(today, -15), null).filter((t) => L(t) && t.type !== 'transfer').slice(0, 2000)
        .map((t) => ({ id: t.id, merchant: t.merchant, amount: t.amount, currency: t.currency, type: t.type, amount_eur: t.amount_eur, occurred_utc: t.occurred_utc }));
      for (const d of findDuplicates(dups, shift(today, -14))) out.alerts.push(d);
      const feeCats = this.withChildren(this.seed('cat_fin_fees'));
      const feeBy = new Map<string, number>();
      for (const t of this.period(monthStart(today), null)) {
        if (!L(t) || t.type !== 'expense' || !feeCats.has(t.category_id)) continue;
        const k = t.card ?? '';
        feeBy.set(k, (feeBy.get(k) ?? 0) - t.amount_eur);
      }
      const fees = [...feeBy].map(([card, total]) => ({ card, total })).sort((a, b) => b.total - a.total);
      const feeTotal = sumBy(fees, (f) => f.total);
      if (feeTotal >= 1000) out.alerts.push({ id: `fees:${today.slice(0, 7)}`, kind: 'fees', amount: feeTotal, cards: fees.filter((f) => f.card) });
      const budget = this.budgetView(today.slice(0, 7), today);
      for (const b of budget.categories) {
        if (b.pct >= 80) out.alerts.push({ id: `budget:${b.category_id}:${today.slice(0, 7)}:${b.pct >= 100 ? 100 : 80}`, kind: 'budget', amount: b.left, category_id: b.category_id, pct: b.pct });
      }
      if (budget.total && budget.total.amount > 0) {
        const p = Math.round((budget.total.spent / budget.total.amount) * 100);
        if (p >= 80) out.alerts.push({ id: `budget:*:${today.slice(0, 7)}:${p >= 100 ? 100 : 80}`, kind: 'budget', amount: budget.total.left, category_id: '*', pct: p });
      }
    }
    if (features.forecast) {
      const from = monthStart(today, -3);
      const cur = monthStart(today);
      const pastG = new Map<string, { m: string; type: string; category_id: string | null; total: number }>();
      for (const t of this.period(from, cur)) {
        if (!L(t) || t.type === 'transfer') continue;
        const k = JSON.stringify([t.occurred_at.slice(0, 7), t.type, t.category_id]);
        const g = pastG.get(k) ?? { m: t.occurred_at.slice(0, 7), type: t.type, category_id: t.category_id, total: 0 };
        g.total += t.amount_eur; pastG.set(k, g);
      }
      const nowG = new Map<string, { type: string; category_id: string | null; total: number }>();
      for (const t of this.period(cur, plusDay(today))) {
        if (!L(t) || t.type === 'transfer') continue;
        const k = JSON.stringify([t.type, t.category_id]);
        const g = nowG.get(k) ?? { type: t.type, category_id: t.category_id, total: 0 };
        g.total += t.amount_eur; nowG.set(k, g);
      }
      const past = [...pastG.values()].sort((a, b) => cmp(a.m, b.m) || cmp(a.type, b.type) || cmpNull(a.category_id, b.category_id));
      const nowRows = [...nowG.values()].sort((a, b) => cmp(a.type, b.type) || cmpNull(a.category_id, b.category_id));
      const months = new Set(past.map((r) => r.m)).size;
      if (months >= 2) {
        const avg = new Map<string, number>();
        let avgIncome = 0;
        for (const r of past) {
          if (r.type === 'income') avgIncome += r.total / months;
          else avg.set(r.category_id ?? '', (avg.get(r.category_id ?? '') ?? 0) - r.total / months);
        }
        const spentNow = new Map<string, number>();
        let incomeNow = 0;
        for (const r of nowRows) {
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
      const week = this.period(shift(today, -6), plusDay(today)).filter((t) => L(t) && t.type === 'expense');
      const prev = this.period(shift(today, -13), shift(today, -6)).filter((t) => L(t) && t.type === 'expense');
      const byCat = new Map<string | null, number>();
      for (const t of week) byCat.set(t.category_id, (byCat.get(t.category_id) ?? 0) - t.amount_eur);
      const top = [...byCat].map(([category_id, total]) => ({ category_id, total })).sort((a, b) => b.total - a.total).slice(0, 3);
      out.week = { from: shift(today, -6), to: today, spent: -sumBy(week, (t) => t.amount_eur) || 0, count: week.length, previous: -sumBy(prev, (t) => t.amount_eur) || 0, top };
    }
    return out;
  }

  // ---- /recurring (worker/recurring.ts) ----
  recurring(today: string) {
    const since = shift(today, -800);
    const saved = this.rows('recurring').map((r) => ({
      id: r.id, merchant: r.merchant, category_id: r.category_id, amount_eur: r.amount_eur, period: r.period as Period, every: r.every, status: r.status,
      last_date: r.last_date, auto_add: r.auto_add, account_id: r.account_id, amount: r.amount, currency: r.currency,
    }));
    const occ = (t: Row): Occurrence => ({ merchant: t.merchant, day: t.occurred_at.slice(0, 10), amount_eur: t.amount_eur, category_id: t.category_id });
    const rows = this.period(since, null).filter((t) => live(t) && t.type === 'expense' && t.merchant != null).map(occ);
    const confirmedNames = saved.filter((r) => r.status === 'confirmed').map((r) => r.merchant);
    const mine = this.txs().filter((t) => t.deleted_at == null && t.type === 'expense' && t.merchant != null && confirmedNames.some((n) => nocaseEq(n, t.merchant))).map(occ);
    const known = new Set(saved.map((r) => r.merchant.trim().toLowerCase()));
    const seen = new Map<string, number>();
    for (const r of rows) seen.set(r.merchant.toLowerCase(), (seen.get(r.merchant.toLowerCase()) ?? 0) + 1);
    const suggestions = detectRecurring(rows.filter((r) => (seen.get(r.merchant.toLowerCase()) ?? 0) >= 2), today, known);
    const last = new Map<string, Occurrence>();
    for (const r of mine) last.set(r.merchant.trim().toLowerCase(), r);
    const confirmed = saved.filter((r) => r.status === 'confirmed').map((r) => {
      const every = r.every || 1;
      const l = last.get(r.merchant.trim().toLowerCase());
      const next = nextDue(r.period, every, l?.day ?? null, r.last_date, today).next;
      const late = !!l && !!next && !r.auto_add && Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${next}T00:00:00Z`)) / 86400_000) > graceDays(r.period, every);
      const changed = l && Math.abs(l.amount_eur - r.amount_eur) > Math.abs(r.amount_eur) * 0.05 ? l.amount_eur : null;
      return { ...r, every, last_date: l?.day ?? null, next_date: next, late, new_amount: changed, per_month: perMonth(r.amount_eur, r.period, every) };
    }).sort((a, b) => (a.next_date ?? '9').localeCompare(b.next_date ?? '9'));
    return { confirmed, suggestions, per_month: sumBy(confirmed, (r) => r.per_month), dismissed: saved.filter((r) => r.status === 'dismissed').length };
  }

  // ---- /cards (worker/cards.ts) ----
  cards(now: Date) {
    const month = now.toISOString().slice(0, 7);
    const map = new Map<string, { name: string; count: number; month_spent: number; sources: string[] }>();
    const get = (name: string) => {
      if (!map.has(name)) map.set(name, { name, count: 0, month_spent: 0, sources: [] });
      return map.get(name)!;
    };
    for (const t of this.txs()) {
      if (!live(t) || t.card == null) continue;
      const x = get(t.card);
      x.count += 1;
      if (t.amount_eur < 0 && t.occurred_at.slice(0, 7) === month) x.month_spent += -t.amount_eur;
    }
    const add = (name: string, key: string) => { const x = get(name); const label = appLabel(key) ?? key; if (!x.sources.includes(label)) x.sources.push(label); };
    for (const s of this.extras.card_sources ?? []) add(s.card, s.key);
    for (const p of this.extras.parsers ?? []) add(p.name, p.app.toLowerCase());
    const fx = new Map(this.rows('card_settings').map((f) => [f.card, f]));
    return { items: [...map.values()].map((x) => ({ ...x, fx: fx.get(x.name) ?? null })).sort((a, b) => b.month_spent - a.month_spent || b.count - a.count || a.name.localeCompare(b.name)) };
  }

  // ---- /trips (worker/trips.ts) ----
  trips() {
    return {
      items: this.rows('trips').sort((a, b) => cmp(b.start_date, a.start_date)).map((tr) => {
        const inTrip = this.inTrip(tr.id);
        const spent = -sumBy(this.rows('transactions').filter((t) => live(t) && t.type === 'expense' && inTrip(t)), (t) => t.amount_eur) || 0;
        return { id: tr.id, name: tr.name, place: tr.place, start_date: tr.start_date, end_date: tr.end_date, spent };
      }),
    };
  }
}

/** Ordine di SQLite: NULL prima di tutto. */
function cmpNull(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return cmp(a, b);
}
