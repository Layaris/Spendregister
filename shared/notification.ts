// Lettura delle notifiche di pagamento: lettori salvati per app, poi lettura generica.
import { amountAppearsInText, currencyFromToken, parseAmount } from './money';

export type Direction = 'expense' | 'income';

export interface ParserDef {
  id: string;
  name: string;
  app: string;
  pattern: string;
  flags: string;
  direction: Direction;
  default_currency: string | null;
}

export interface ParsedPayment {
  amount: number;
  currency: string;
  merchant: string | null;
  direction: Direction;
  confidence: 'high' | 'medium' | 'low';
  ambiguous: boolean;
  via: string;
}

export interface AiHint {
  amount?: string | number | null;
  currency?: string | null;
  merchant?: string | null;
  category?: string | null;
}

const CURRENCY_ALT =
  'US\\$|S\\$|A\\$|HK\\$|NZ\\$|Rp\\.?|RM|€|£|฿|₫|₱|¥|₩|₹|\\$|[A-Z]{3}';
const NUMBER = '\\d[\\d.,\\u00A0\\u202F\'’ ]*\\d|\\d';
const PREFIX_RE = new RegExp(`(?:^|[^A-Za-z])(${CURRENCY_ALT})\\s?(${NUMBER})`, 'g');
const SUFFIX_RE = new RegExp(`(${NUMBER})\\s?(${CURRENCY_ALT})(?![A-Za-z])`, 'g');

const INCOME_WORDS =
  /\b(ricevut[oi]|accredit|rimbors|refund|received|incoming|masuk|diterima|dana masuk|cashback|top.?up received|stipendio|salary)/i;
const SKIP_WORDS = /\b(otp|codice di verifica|verification code|kode verifikasi|password|declined|rifiutat|ditolak|gagal|failed)\b/i;
const MERCHANT_RE =
  /(?:\b(?:a|at|to|presso|da|di|ke|pada|from|merchant:?)\s+)([A-Za-z0-9*][^\n,;]*?)(?=\s+(?:con|with|using|via|on|il|per|dengan|sebesar|tanggal|pada|alle|at\s+\d)\b|[.,;\n]|$)/i;

function cleanMerchant(m: string | null | undefined): string | null {
  if (!m) return null;
  const s = m.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  return s.length >= 2 ? s.slice(0, 120) : null;
}

/** Lettura generica: trova la prima coppia valuta + importo e un possibile esercente. */
export function parseGeneric(text: string, defaultCurrency?: string | null): ParsedPayment | null {
  if (SKIP_WORDS.test(text)) return null;
  const candidates: Array<{ index: number; cur: string; num: string }> = [];
  for (const m of text.matchAll(PREFIX_RE)) {
    const cur = currencyFromToken(m[1]);
    if (cur) candidates.push({ index: m.index ?? 0, cur, num: m[2] });
  }
  for (const m of text.matchAll(SUFFIX_RE)) {
    const cur = currencyFromToken(m[2]);
    if (cur) candidates.push({ index: m.index ?? 0, cur, num: m[1] });
  }
  candidates.sort((a, b) => a.index - b.index);
  let best: { cur: string; parsed: { value: number; ambiguous: boolean } } | null = null;
  for (const c of candidates) {
    const parsed = parseAmount(c.num.trim(), c.cur);
    if (parsed && parsed.value > 0) {
      best = { cur: c.cur, parsed };
      break;
    }
  }
  if (!best && defaultCurrency) {
    const m = text.match(new RegExp(NUMBER));
    const parsed = m ? parseAmount(m[0], defaultCurrency) : null;
    if (parsed && parsed.value > 0) best = { cur: defaultCurrency, parsed };
  }
  if (!best) return null;
  const merchant = cleanMerchant(text.match(MERCHANT_RE)?.[1]);
  return {
    amount: best.parsed.value,
    currency: best.cur,
    merchant,
    direction: INCOME_WORDS.test(text) ? 'income' : 'expense',
    confidence: merchant ? 'medium' : 'low',
    ambiguous: best.parsed.ambiguous,
    via: 'generica',
  };
}

/** Applica un lettore salvato: la regex usa gruppi con nome amount, currency, merchant. */
export function parseWithParser(p: ParserDef, text: string): ParsedPayment | null {
  let re: RegExp;
  try {
    re = new RegExp(p.pattern, p.flags.includes('i') ? 'i' : '');
  } catch {
    return null;
  }
  const m = text.match(re);
  if (!m?.groups?.amount) return null;
  const currency = (m.groups.currency && currencyFromToken(m.groups.currency)) || p.default_currency;
  if (!currency) return null;
  const parsed = parseAmount(m.groups.amount, currency);
  if (!parsed || parsed.value <= 0) return null;
  return {
    amount: parsed.value,
    currency,
    merchant: cleanMerchant(m.groups.merchant),
    direction: p.direction,
    confidence: 'high',
    ambiguous: parsed.ambiguous,
    via: `lettore: ${p.name}`,
  };
}

/** Usa la lettura fatta sul telefono (Apple Intelligence) solo se supera i controlli. */
export function parseFromHint(text: string, hint: AiHint): ParsedPayment | null {
  const currency = hint.currency ? currencyFromToken(String(hint.currency)) : null;
  if (!currency || hint.amount == null) return null;
  const parsed = parseAmount(String(hint.amount), currency);
  if (!parsed || parsed.value <= 0) return null;
  if (!amountAppearsInText(text, parsed.value, currency)) return null;
  return {
    amount: parsed.value,
    currency,
    merchant: cleanMerchant(hint.merchant),
    direction: INCOME_WORDS.test(text) ? 'income' : 'expense',
    confidence: 'medium',
    ambiguous: parsed.ambiguous,
    via: 'lettura sul telefono',
  };
}

export function appMatches(parserApp: string, app: string | null | undefined): boolean {
  if (!app) return false;
  const a = parserApp.toLowerCase();
  const b = app.toLowerCase();
  return a === b || b.includes(a) || a.includes(b);
}

export function parseNotification(
  input: { app?: string | null; title?: string | null; text: string; hint?: AiHint | null },
  parsers: ParserDef[],
): ParsedPayment | null {
  const full = [input.title, input.text].filter(Boolean).join('\n');
  // Su iPhone l'app non arriva: la si riconosce dal titolo. Se resta sconosciuta si provano tutti i lettori.
  const matching = parsers.filter((p) => appMatches(p.app, input.app) || appMatches(p.app, input.title));
  const candidates = matching.length || input.app ? matching : parsers;
  for (const p of candidates) {
    const r = parseWithParser(p, full);
    if (r) return r;
  }
  const generic = parseGeneric(full);
  if (generic && generic.merchant) return generic;
  const fromHint = input.hint ? parseFromHint(full, input.hint) : null;
  if (fromHint) return fromHint;
  return generic;
}

/** Nome pulito: "Grab* A-A359GUFW36UCAV" diventa "Grab", "GOJEK RECURRING NON3DS" diventa "Gojek". */
export function cleanMerchantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.replace(/\*.*$/, '').replace(/\b(recurring|non3ds|3ds|pos|purchase|payment|pembayaran)\b/gi, '');
  s = s.replace(/\b[A-Z0-9]*\d[A-Z0-9-]{4,}\b/g, '').replace(/[-_]+$/, '').replace(/\s+/g, ' ').trim();
  if (!s) return raw.trim();
  if (s === s.toUpperCase() && s.length > 3) s = s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return s;
}
