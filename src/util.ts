import { formatMoney } from '../shared/money';

export { formatMoney };

// Valuta di visualizzazione (Impostazioni): i totali sono in euro sul server e si convertono qui, al tasso di oggi.
let display = { currency: 'EUR', perEur: 1 };
export function setDisplayCurrency(currency: string, perEur: number) {
  display = { currency, perEur };
}
export const displayCurrency = () => display.currency;
/** Un importo in millesimi di euro, mostrato nella valuta scelta nelle Impostazioni. */
export const eur = (milli: number, sign = false) => formatMoney(Math.round(milli * display.perEur), display.currency, { sign });
/** Da un importo nella valuta di visualizzazione ai millesimi di euro. */
export const fromDisplay = (milli: number) => Math.round(milli / display.perEur);
/** Carattere più piccolo per gli importi lunghi, così stanno su una riga: base fino a 9 caratteri, poi scende. */
export const fitSize = (text: string, base: number, min = Math.round(base * 0.6)) => Math.max(min, Math.min(base, Math.round(base * (10 / Math.max(text.length, 10)))));

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];

export const pad = (n: number) => String(n).padStart(2, '0');

/** Data locale YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Ora locale con fuso, come la manda il telefono: 2026-11-15T14:32:00+08:00. */
export function localIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export interface Period { from: string; to: string; label: string }

export function monthPeriod(offset = 0, base = new Date()): Period {
  const d = new Date(base.getFullYear(), base.getMonth() + offset, 1);
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const label = `${MONTHS[d.getMonth()][0].toUpperCase()}${MONTHS[d.getMonth()].slice(1)} ${d.getFullYear()}`;
  return { from: localDay(d), to: localDay(next), label };
}

/** "dom 15 nov, 14:32" dalla stringa con fuso, senza convertirla nel fuso del browser. */
export function formatWhen(iso: string, withTime = true): string {
  const [date, time = ''] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const wd = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const base = `${wd} ${d} ${MONTHS_SHORT[m - 1]}`;
  return withTime && time ? `${base}, ${time.slice(0, 5)}` : base;
}

export function formatDayShort(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

export function relativeTime(iso: string | null): string {
  if (!iso) return 'mai';
  const diff = Date.now() - Date.parse(iso);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'adesso';
  if (min < 60) return `${min} min fa`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} ore fa`;
  return `${Math.round(h / 24)} giorni fa`;
}

export const NATURE_LABEL: Record<string, string> = { must: 'Devo', need: 'Ho bisogno', want: 'Voglio' };

export const CURRENCIES = ['EUR', 'IDR', 'USD', 'SGD', 'MYR', 'THB', 'VND', 'PHP', 'AUD', 'GBP', 'JPY', 'CHF'];

export function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ---- Periodi (Statistiche) ----

export type PeriodKind = 'day' | 'week' | 'month' | 'year' | 'ytd' | 'custom';
export interface PeriodSpec { kind: PeriodKind; offset: number; from?: string; to?: string }

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const addDays = (day: string, n: number) => localDay(new Date(new Date(`${day}T12:00:00`).getTime() + n * 86400_000));

/** Da una scelta (mese, anno, date libere…) alle date `from` incluso e `to` escluso, con un nome leggibile. */
export function periodOf(spec: PeriodSpec, base = new Date()): Period {
  const today = localDay(base);
  const o = spec.offset;
  if (spec.kind === 'day') {
    const d = addDays(today, o);
    return { from: d, to: addDays(d, 1), label: o === 0 ? 'Oggi' : o === -1 ? 'Ieri' : cap(formatWhen(d, false)) };
  }
  if (spec.kind === 'week') {
    const dow = (new Date(`${today}T12:00:00`).getDay() + 6) % 7;
    const from = addDays(today, -dow + o * 7);
    const to = addDays(from, 7);
    return { from, to, label: o === 0 ? 'Questa settimana' : `${formatDayShort(from)} – ${formatDayShort(addDays(to, -1))}` };
  }
  if (spec.kind === 'month') {
    const p = monthPeriod(o, base);
    return o === 0 ? { ...p, label: 'Questo mese' } : p;
  }
  if (spec.kind === 'year') {
    const y = base.getFullYear() + o;
    return { from: `${y}-01-01`, to: `${y + 1}-01-01`, label: o === 0 ? 'Quest’anno' : String(y) };
  }
  if (spec.kind === 'ytd') return { from: `${base.getFullYear()}-01-01`, to: addDays(today, 1), label: 'Da inizio anno' };
  const from = spec.from ?? today;
  const last = spec.to ?? today;
  return { from, to: addDays(last, 1), label: `${formatDayShort(from)} – ${formatDayShort(last)} ${last.slice(0, 4)}` };
}

export const PERIOD_KINDS: Array<[PeriodKind, string]> = [
  ['day', 'Oggi'], ['week', 'Questa settimana'], ['month', 'Questo mese'], ['year', 'Quest’anno'], ['ytd', 'Da inizio anno'], ['custom', 'Scegli le date'],
];

/** Giorni → gruppi per il grafico: giorni fino a un mese, settimane fino a tre mesi, poi mesi. */
export function bucketize<T extends { day: string }, K extends keyof T & string>(from: string, to: string, rows: T[], keys: K[]) {
  const days = Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86400_000);
  const unit: 'day' | 'week' | 'month' = days <= 31 ? 'day' : days <= 92 ? 'week' : 'month';
  const keyOf = (day: string) => {
    if (unit === 'day') return day;
    if (unit === 'month') return day.slice(0, 7);
    const dow = (new Date(`${day}T12:00:00`).getDay() + 6) % 7;
    return addDays(day, -dow);
  };
  const labelOf = (k: string) => (unit === 'month' ? MONTHS_SHORT[Number(k.slice(5, 7)) - 1] : formatDayShort(k));
  const out = new Map<string, Record<string, number>>();
  for (let d = from; d < to && out.size < 400; d = addDays(d, 1)) if (!out.has(keyOf(d))) out.set(keyOf(d), Object.fromEntries(keys.map((k) => [k, 0])));
  for (const r of rows) {
    const b = out.get(keyOf(r.day));
    if (b) for (const k of keys) b[k] += Number(r[k]) || 0;
  }
  return { unit, buckets: [...out.entries()].map(([k, v]) => ({ key: k, label: labelOf(k), ...(v as Record<K, number>) })) };
}
