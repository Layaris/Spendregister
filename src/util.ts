import { formatMoney } from '../shared/money';

export { formatMoney };

export const eur = (milli: number, sign = false) => formatMoney(milli, 'EUR', { sign });

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
