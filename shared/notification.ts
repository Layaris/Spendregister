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
  /** Nome del lettore che ha letto la notifica: è la carta o la banca con cui si è pagato. */
  bank?: string;
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
  /\b(ricevut[oi]|accredit|rimbors|refund|received|incoming|masuk|diterima|dana masuk|top.?up received|stipendio|salary)/i;
// "Cashback" da solo è un'entrata; dentro una notifica di pagamento è solo un dettaglio ("Card payment | Cashback: +$0.04").
const CASHBACK = /\bcashback\b/i;
const PAYMENT_WORDS =
  /\b(card payment|payment|paid|purchase|spent|charged|debit(?:ed)?|pagamento|pagato|acquisto|addebit|speso|pembayaran|bayar|transaksi|compra|pago|paiement|zahlung)\b/i;

/** Entrata o spesa dal testo della notifica. */
export function directionOf(text: string): Direction {
  if (INCOME_WORDS.test(text)) return 'income';
  if (CASHBACK.test(text) && !PAYMENT_WORDS.test(text)) return 'income';
  return 'expense';
}
const SKIP_WORDS = /\b(otp|codice di verifica|verification code|kode verifikasi|password|declined|rifiutat|ditolak|gagal|failed)\b/i;
const MERCHANT_RE =
  /(?:\b(?:a|at|to|presso|da|di|ke|pada|from|merchant:?)\s+)([A-Za-z0-9*][^\n,;]*?)(?=\s+(?:con|with|using|via|on|il|per|dengan|sebesar|tanggal|pada|alle|at\s+\d)\b|[.,;\n]|$)/i;

// Parole di servizio da togliere quando il nome del negozio si ricava da ciò che resta sulla riga dell'importo.
const FILLER = new Set(('you paid spent payment purchase card debit credit transaction successful success completed approved charged ' +
  'hai pagato speso pagamento acquisto carta addebito transazione completato riuscito eseguito ' +
  'anda membayar pembayaran transaksi berhasil sukses kartu bayar ' +
  'has pagado pago compra tarjeta vous avez payé paiement achat carte sie haben bezahlt zahlung kauf karte ' +
  'a at to for per di da ke ke: with con on via il la lo le the of de en sur bei an mit oleh untuk ok in at: from your tua il tuo ' +
  'amount importo jumlah total totale sebesar rp cashback').split(/\s+/));

/** Ciò che resta sulla riga dell'importo, se sembra un nome: "50 AED restaurant" → "restaurant". */
function merchantFromLine(text: string, start: number, end: number): string | null {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nl = text.indexOf('\n', end);
  const line = `${text.slice(lineStart, start)} ${text.slice(end, nl < 0 ? text.length : nl)}`;
  const words = line
    .replace(/\b\S+\.\S+\/\S*/g, ' ') // indirizzi tipo ntfy.sh/argomento
    .split(/[\s|;:,()[\]{}"“”‘’]+/)
    .map((w) => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')) // punteggiatura ai bordi, non dentro ("A-A3BL" resta intero)
    .filter((w) => w && !FILLER.has(w.toLowerCase()) && /\p{L}/u.test(w));
  if (!words.length || words.length > 4) return null;
  return cleanMerchant(words.join(' '));
}

function cleanMerchant(m: string | null | undefined): string | null {
  if (!m) return null;
  const s = m.replace(/\s+/g, ' ').trim().replace(/[.!]+$/, '');
  return s.length >= 2 ? s.slice(0, 120) : null;
}

/** Lettura generica: trova la prima coppia valuta + importo e un possibile esercente. */
export function parseGeneric(text: string, defaultCurrency?: string | null): ParsedPayment | null {
  if (SKIP_WORDS.test(text)) return null;
  const candidates: Array<{ index: number; end: number; cur: string; num: string }> = [];
  for (const m of text.matchAll(PREFIX_RE)) {
    const cur = currencyFromToken(m[1]);
    if (cur) candidates.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, cur, num: m[2] });
  }
  for (const m of text.matchAll(SUFFIX_RE)) {
    const cur = currencyFromToken(m[2]);
    if (cur) candidates.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, cur, num: m[1] });
  }
  candidates.sort((a, b) => a.index - b.index);
  let best: { cur: string; parsed: { value: number; ambiguous: boolean }; index: number; end: number } | null = null;
  for (const c of candidates) {
    const parsed = parseAmount(c.num.trim(), c.cur);
    if (parsed && parsed.value > 0) {
      best = { cur: c.cur, parsed, index: c.index, end: c.end };
      break;
    }
  }
  if (!best && defaultCurrency) {
    const m = text.match(new RegExp(NUMBER));
    const parsed = m ? parseAmount(m[0], defaultCurrency) : null;
    if (parsed && parsed.value > 0) best = { cur: defaultCurrency, parsed, index: m!.index ?? 0, end: (m!.index ?? 0) + m![0].length };
  }
  if (!best) return null;
  const merchant = cleanMerchant(text.match(MERCHANT_RE)?.[1]) ?? merchantFromLine(text, best.index, best.end);
  return {
    amount: best.parsed.value,
    currency: best.cur,
    merchant,
    direction: directionOf(text),
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
    bank: p.name.trim() || undefined,
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
    direction: directionOf(text),
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
  if (generic && generic.merchant && generic.confidence !== 'low') return generic;
  const fromHint = input.hint ? parseFromHint(full, input.hint) : null;
  // La lettura del telefono senza negozio prende quello trovato nel testo.
  if (fromHint) return { ...fromHint, merchant: fromHint.merchant ?? generic?.merchant ?? null };
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
