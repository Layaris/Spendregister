// Spese ricorrenti: l'app propone, l'utente conferma o scarta. Per evitare errori una proposta nasce solo se:
// stesso negozio (nome pulito), importo simile (entro il 15%), intervallo regolare (settimana, mese o anno,
// con qualche giorno di margine), almeno 3 volte, e l'ultima volta non è troppo lontana (è ancora attiva).

export type Period = 'week' | 'month' | 'year';
export interface Occurrence { merchant: string; day: string; amount_eur: number; category_id: string | null }
export interface Candidate { merchant: string; period: Period; every: number; amount_eur: number; last_date: string; next_date: string; count: number; category_id: string | null }

/** Intervalli riconosciuti, con qualche giorno di margine. */
const PERIODS: Array<{ period: Period; every: number; min: number; max: number; grace: number }> = [
  { period: 'week', every: 1, min: 6, max: 8, grace: 4 },
  { period: 'week', every: 2, min: 13, max: 16, grace: 6 },
  { period: 'month', every: 1, min: 26, max: 35, grace: 10 },
  { period: 'month', every: 2, min: 55, max: 66, grace: 14 },
  { period: 'month', every: 3, min: 84, max: 99, grace: 20 },
  { period: 'month', every: 6, min: 172, max: 192, grace: 25 },
  { period: 'year', every: 1, min: 350, max: 380, grace: 30 },
];

const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const between = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86400_000);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Prossima data attesa: N settimane dopo, oppure stesso giorno N mesi/anni dopo (l'ultimo giorno se il mese è più corto). */
export function nextDate(last: string, period: Period, every = 1): string {
  if (period === 'week') return iso(dayMs(last) + 7 * every * 86400_000);
  const [y, m, d] = last.split('-').map(Number);
  const add = period === 'month' ? every : 12 * every;
  const ny = y + Math.floor((m - 1 + add) / 12);
  const nm = ((m - 1 + add) % 12) + 1;
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`;
}

/** Giorni di tolleranza prima di dire "non è arrivata". */
export const graceDays = (period: Period, every = 1) => (period === 'week' ? 3 + every : period === 'month' ? 8 + 3 * every : 30 * every);

/** Quanto pesa al mese una spesa ricorrente (negativa = uscita). */
export const perMonth = (amount: number, period: Period, every = 1) =>
  Math.round(period === 'week' ? (amount * 52) / 12 / every : period === 'year' ? amount / 12 / every : amount / every);

/** "ogni mese", "ogni 3 mesi", "ogni 2 settimane", "ogni anno". */
export function everyLabel(period: Period, every = 1): string {
  if (every <= 1) return period === 'week' ? 'ogni settimana' : period === 'month' ? 'ogni mese' : 'ogni anno';
  return `ogni ${every} ${period === 'week' ? 'settimane' : period === 'month' ? 'mesi' : 'anni'}`;
}

/** Scelte di frequenza per i menu (valore "periodo:N"). */
export const FREQUENCIES: Array<[string, string]> = [
  ['week:1', 'Ogni settimana'], ['week:2', 'Ogni 2 settimane'], ['month:1', 'Ogni mese'], ['month:2', 'Ogni 2 mesi'],
  ['month:3', 'Ogni 3 mesi'], ['month:4', 'Ogni 4 mesi'], ['month:6', 'Ogni 6 mesi'], ['year:1', 'Ogni anno'],
];

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
    const next = nextDate(last.day, p.period, p.every);
    if (between(next, today) > p.grace) continue; // non si ripete più
    return { merchant: last.merchant, period: p.period, every: p.every, amount_eur: typical, last_date: last.day, next_date: next, count: run.length, category_id: last.category_id };
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
  return out.sort((a, b) => perMonth(a.amount_eur, a.period, a.every) - perMonth(b.amount_eur, b.period, b.every));
}

/**
 * Prossimo addebito di una spesa ricorrente confermata: la data scelta a mano (`anchor`) se è dopo l'ultima spesa del
 * negozio (`lastDay`), altrimenti dall'ultima spesa; senza spese, dalla data scelta a mano, la prima da oggi in poi.
 */
export function nextDue(period: Period, every: number, lastDay: string | null, anchor: string | null, today: string): { next: string | null; fromTx: boolean } {
  const fromTx = lastDay ? nextDate(lastDay, period, every) : null;
  if (anchor && lastDay && anchor > lastDay) return { next: anchor, fromTx: false };
  if (fromTx) return { next: fromTx, fromTx: true };
  if (!anchor) return { next: null, fromTx: false };
  let next = anchor;
  for (let i = 0; i < 600 && next < today; i++) next = nextDate(next, period, every);
  return { next, fromTx: false };
}

/** Giorni di tolleranza tra la data prevista di una ricorrente e quella vera (le banche addebitano anche 2-3 giorni dopo). */
export const matchWindowDays = (period: Period, every = 1) => (period === 'week' && every === 1 ? 2 : 5);
