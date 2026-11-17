// Spese ricorrenti: l'app propone, l'utente conferma o scarta. Per evitare errori una proposta nasce solo se:
// stesso negozio (nome pulito), importo simile (entro il 15%), intervallo regolare (settimana, mese o anno,
// con qualche giorno di margine), almeno 3 volte, e l'ultima volta non è troppo lontana (è ancora attiva).

export type Period = 'week' | 'month' | 'year';
export interface Occurrence { merchant: string; day: string; amount_eur: number; category_id: string | null }
export interface Candidate { merchant: string; period: Period; amount_eur: number; last_date: string; next_date: string; count: number; category_id: string | null }

const PERIODS: Array<{ period: Period; min: number; max: number; grace: number }> = [
  { period: 'week', min: 6, max: 8, grace: 4 },
  { period: 'month', min: 26, max: 35, grace: 10 },
  { period: 'year', min: 350, max: 380, grace: 30 },
];

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const between = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86400_000);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Prossima data attesa: stesso giorno del mese dopo (o l'ultimo giorno, se il mese è più corto). */
export function nextDate(last: string, period: Period): string {
  if (period === 'week') return iso(dayMs(last) + 7 * 86400_000);
  const [y, m, d] = last.split('-').map(Number);
  const add = period === 'month' ? 1 : 12;
  const ny = y + Math.floor((m - 1 + add) / 12);
  const nm = ((m - 1 + add) % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

export const graceDays = (period: Period) => PERIODS.find((p) => p.period === period)!.grace;

/** Quanto pesa al mese una spesa ricorrente (negativa = uscita). */
export const perMonth = (amount: number, period: Period) => Math.round(period === 'week' ? (amount * 52) / 12 : period === 'year' ? amount / 12 : amount);

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Una serie regolare per un negozio, guardando le volte più recenti. */
function seriesOf(list: Occurrence[], today: string): Candidate | null {
  // Le spese dello stesso giorno contano una volta (es. due addebiti uguali): si tiene la somma.
  const byDay = new Map<string, Occurrence>();
  for (const o of list) {
    const prev = byDay.get(o.day);
    byDay.set(o.day, prev ? { ...prev, amount_eur: prev.amount_eur + o.amount_eur } : o);
  }
  const occ = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  if (occ.length < 3) return null;
  for (const p of PERIODS) {
    // Dalla più recente all'indietro, finché intervallo e importo restano regolari.
    const run = [occ[occ.length - 1]];
    for (let i = occ.length - 2; i >= 0; i--) {
      const gap = between(occ[i].day, run[0].day);
      if (gap < p.min || gap > p.max) break;
      run.unshift(occ[i]);
    }
    if (run.length < 3) continue;
    const typical = median(run.map((o) => o.amount_eur));
    const similar = run.filter((o) => Math.abs(o.amount_eur - typical) <= Math.abs(typical) * 0.15);
    if (similar.length < run.length || similar.length < 3) continue;
    const last = run[run.length - 1];
    const next = nextDate(last.day, p.period);
    if (between(next, today) > p.grace) continue; // non si ripete più
    return { merchant: last.merchant, period: p.period, amount_eur: typical, last_date: last.day, next_date: next, count: run.length, category_id: last.category_id };
  }
  return null;
}

/** Proposte di spese ricorrenti dallo storico (spese con negozio), dalla più costosa al mese. */
export function detectRecurring(rows: Occurrence[], today: string, skip: Set<string> = new Set()): Candidate[] {
  const byMerchant = new Map<string, Occurrence[]>();
  for (const r of rows) {
    if (!r.merchant || r.amount_eur >= 0) continue;
    const key = r.merchant.trim().toLowerCase();
    if (skip.has(key)) continue;
    (byMerchant.get(key) ?? byMerchant.set(key, []).get(key)!).push(r);
  }
  const out: Candidate[] = [];
  for (const list of byMerchant.values()) {
    const c = seriesOf(list, today);
    if (c) out.push(c);
  }
  return out.sort((a, b) => perMonth(a.amount_eur, a.period) - perMonth(b.amount_eur, b.period));
}
