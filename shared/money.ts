// Importi e valute. Tutti gli importi salvati sono interi in millesimi (x1000).

export const BASE_CURRENCY = 'EUR';

const ZERO_DECIMALS = new Set(['IDR', 'VND', 'JPY', 'KRW', 'CLP', 'ISK', 'PYG', 'UGX', 'XAF', 'XOF', 'LAK', 'MMK', 'KHR']);
const THREE_DECIMALS = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyDecimals(currency: string): number {
  const c = currency.toUpperCase();
  if (ZERO_DECIMALS.has(c)) return 0;
  if (THREE_DECIMALS.has(c)) return 3;
  return 2;
}

// Simboli e prefissi riconosciuti nelle notifiche. I più lunghi prima.
export const CURRENCY_TOKENS: Array<[string, string]> = [
  ['US$', 'USD'], ['S$', 'SGD'], ['A$', 'AUD'], ['HK$', 'HKD'], ['NZ$', 'NZD'],
  ['Rp.', 'IDR'], ['Rp', 'IDR'], ['RM', 'MYR'], ['€', 'EUR'], ['£', 'GBP'], ['฿', 'THB'],
  ['₫', 'VND'], ['₱', 'PHP'], ['¥', 'JPY'], ['₩', 'KRW'], ['₹', 'INR'], ['$', 'USD'],
];

const ISO_CODES = [
  'EUR', 'USD', 'GBP', 'CHF', 'IDR', 'SGD', 'MYR', 'THB', 'VND', 'PHP', 'JPY', 'KRW', 'AUD', 'NZD',
  'HKD', 'CNY', 'INR', 'TWD', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'AED', 'TRY', 'BRL', 'MXN',
  'LAK', 'KHR', 'MMK', 'LKR', 'NPR', 'BHD', 'KWD', 'OMR', 'JOD',
];
export const KNOWN_CURRENCIES = new Set(ISO_CODES);

export function currencyFromToken(token: string): string | null {
  const t = token.trim();
  const upper = t.toUpperCase();
  if (/^[A-Z]{3}$/.test(upper) && KNOWN_CURRENCIES.has(upper)) return upper;
  for (const [sym, code] of CURRENCY_TOKENS) if (t === sym || upper === sym.toUpperCase()) return code;
  return null;
}

export interface ParsedAmount {
  value: number;
  ambiguous: boolean;
}

const SPACES = /[\s  '’]/g;

/**
 * Legge un importo scritto in qualsiasi formato: "55.600", "55,600", "1.234,56",
 * "1,234.56", "12 345,50", "45k", "1,2jt". Restituisce null se non è un numero.
 * `ambiguous` è vero per casi come "1.234" su valute con decimali: potrebbe essere
 * milleduecento o uno virgola due.
 */
export function parseAmount(input: string, currency?: string): ParsedAmount | null {
  let s = input.trim().replace(/^[+-]/, '');
  let multiplier = 1;
  const suffix = s.match(/^(.*?)\s*(k|rb|ribu|jt|juta|m)$/i);
  if (suffix && /\d/.test(suffix[1])) {
    s = suffix[1];
    const u = suffix[2].toLowerCase();
    multiplier = u === 'k' || u === 'rb' || u === 'ribu' ? 1_000 : 1_000_000;
  }
  s = s.replace(SPACES, '');
  if (!/^\d[\d.,]*$/.test(s) && !/^\d$/.test(s)) return null;

  const decimals = currency ? currencyDecimals(currency) : 2;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let ambiguous = false;
  let normalized: string;

  if (lastDot >= 0 && lastComma >= 0) {
    // Entrambi i separatori: l'ultimo è il decimale.
    const decSep = lastDot > lastComma ? '.' : ',';
    const groupSep = decSep === '.' ? ',' : '.';
    normalized = s.split(groupSep).join('').replace(decSep, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    if (parts.length > 2) {
      // "1.234.567": più occorrenze, quindi separatore delle migliaia.
      if (!parts.slice(1).every((p) => p.length === 3)) return null;
      normalized = parts.join('');
    } else if (tail.length === 3) {
      if (decimals === 3) normalized = parts.join('.');
      else {
        normalized = parts.join('');
        if (decimals > 0 && multiplier === 1) ambiguous = true;
      }
    } else if (tail.length === 1 || tail.length === 2) {
      normalized = parts.join('.');
    } else {
      return null;
    }
  } else {
    normalized = s;
  }

  const value = Number(normalized) * multiplier;
  if (!Number.isFinite(value)) return null;
  return { value, ambiguous };
}

export const toMilli = (value: number): number => Math.round(value * 1000);
export const fromMilli = (milli: number): number => milli / 1000;

/** Arrotonda un importo in millesimi ai decimali della valuta. */
export function roundMilli(milli: number, currency: string): number {
  const step = 10 ** (3 - currencyDecimals(currency));
  return Math.round(milli / step) * step;
}

/** Controllo ripreso dal comando iPhone: l'importo letto deve comparire davvero nel testo. */
export function amountAppearsInText(text: string, value: number, currency?: string): boolean {
  const re = /\d[\d.,\s  '’]*\d|\d/g;
  for (const m of text.matchAll(re)) {
    const parsed = parseAmount(m[0], currency);
    if (parsed && Math.abs(parsed.value - value) < 0.0005) return true;
    const loose = parseAmount(m[0].replace(SPACES, ''), currency);
    if (loose && Math.abs(loose.value - value) < 0.0005) return true;
  }
  return false;
}

export function formatMoney(milli: number, currency: string, opts: { sign?: boolean } = {}): string {
  const decimals = currencyDecimals(currency);
  const value = Math.abs(milli) / 1000;
  const body = new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  const sign = milli < 0 ? '−' : opts.sign && milli > 0 ? '+' : '';
  return currency === 'EUR' ? `${sign}${body} €` : `${sign}${body} ${currency}`;
}
