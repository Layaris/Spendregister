import { describe, expect, it } from 'vitest';
import { amountAppearsInText, formatMoney, parseAmount, roundMilli, toMilli } from '../shared/money';
import { cleanMerchantName, parseFromHint, parseGeneric, parseNotification, parseWithParser } from '../shared/notification';
import { evaluateRules, type Rule, type RuleInput } from '../shared/rules';
import { isLikelyDuplicate } from '../shared/dedupe';

describe('parseAmount', () => {
  it('legge le rupie con il punto delle migliaia', () => {
    expect(parseAmount('55.600', 'IDR')).toEqual({ value: 55600, ambiguous: false });
    expect(parseAmount('1.250.000', 'IDR')).toEqual({ value: 1250000, ambiguous: false });
    expect(parseAmount('55,600', 'IDR')).toEqual({ value: 55600, ambiguous: false });
  });
  it('legge i decimali in formato italiano e inglese', () => {
    expect(parseAmount('1.234,56', 'EUR')?.value).toBe(1234.56);
    expect(parseAmount('1,234.56', 'USD')?.value).toBe(1234.56);
    expect(parseAmount('2,94', 'EUR')?.value).toBe(2.94);
    expect(parseAmount('12 345,50', 'EUR')?.value).toBe(12345.5);
  });
  it('segnala il separatore ambiguo sulle valute con decimali', () => {
    expect(parseAmount('1.234', 'EUR')).toEqual({ value: 1234, ambiguous: true });
    expect(parseAmount('1.234', 'KWD')).toEqual({ value: 1.234, ambiguous: false });
  });
  it('capisce le abbreviazioni', () => {
    expect(parseAmount('45k', 'IDR')?.value).toBe(45000);
    expect(parseAmount('1,2jt', 'IDR')?.value).toBe(1200000);
  });
  it('rifiuta ciò che non è un numero', () => {
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1.23.4')).toBeNull();
  });
});

describe('formato e arrotondamento', () => {
  it('formatta euro e rupie', () => {
    expect(formatMoney(-2940, 'EUR')).toBe('−2,94 €');
    expect(formatMoney(55600000, 'IDR')).toBe('55.600 IDR');
  });
  it('arrotonda ai decimali della valuta', () => {
    expect(roundMilli(2946, 'EUR')).toBe(2950);
    expect(roundMilli(toMilli(55600.4), 'IDR')).toBe(55600000);
  });
  it('verifica che l’importo compaia nel testo', () => {
    expect(amountAppearsInText('Hai pagato Rp55.600 a Grab', 55600, 'IDR')).toBe(true);
    expect(amountAppearsInText('Hai pagato Rp55.600 a Grab', 56600, 'IDR')).toBe(false);
  });
});

describe('lettura notifiche', () => {
  it('legge una notifica italiana con prefisso Rp', () => {
    const r = parseGeneric('Hai pagato Rp55.600 a Grab* A-A359GUFW36UCAV');
    expect(r).toMatchObject({ amount: 55600, currency: 'IDR', merchant: 'Grab* A-A359GUFW36UCAV', direction: 'expense' });
  });
  it('legge una notifica inglese con codice valuta dopo il numero', () => {
    const r = parseGeneric('You spent 112,000 IDR at GOJEK RECURRING NON3DS');
    expect(r).toMatchObject({ amount: 112000, currency: 'IDR', merchant: 'GOJEK RECURRING NON3DS' });
  });
  it('legge una notifica indonesiana', () => {
    const r = parseGeneric('Transaksi berhasil Rp 480.300 di TOKOPEDIA pada 15/11');
    expect(r).toMatchObject({ amount: 480300, currency: 'IDR', merchant: 'TOKOPEDIA' });
  });
  it('riconosce le entrate', () => {
    expect(parseGeneric('Hai ricevuto 250,00 € da Mario')?.direction).toBe('income');
  });
  it('ignora i codici OTP', () => {
    expect(parseGeneric('Il tuo codice di verifica è 123456')).toBeNull();
  });
  it('usa un lettore salvato quando l’app corrisponde', () => {
    const parser = {
      id: 'p1', name: 'Jago', app: 'com.jago.digitalBanking', flags: 'i', direction: 'expense' as const, default_currency: 'IDR',
      pattern: 'Pembayaran (?<amount>[\\d.]+) ke (?<merchant>.+?) berhasil',
    };
    expect(parseWithParser(parser, 'Pembayaran 25.000 ke KOPI KENANGAN berhasil')).toMatchObject({ amount: 25000, currency: 'IDR', merchant: 'KOPI KENANGAN', confidence: 'high' });
    const r = parseNotification({ app: 'com.jago.digitalBanking', text: 'Pembayaran 25.000 ke KOPI KENANGAN berhasil' }, [parser]);
    expect(r?.via).toBe('lettore: Jago');
  });
  it('accetta la lettura del telefono solo se l’importo è nel testo', () => {
    const text = 'Pagamento effettuato: 187.500 presso Pepito Market';
    expect(parseFromHint(text, { amount: '187.500', currency: 'IDR', merchant: 'Pepito Market' })).toMatchObject({ amount: 187500 });
    expect(parseFromHint(text, { amount: '190.000', currency: 'IDR', merchant: 'Pepito Market' })).toBeNull();
  });
  it('pulisce il nome del merchant', () => {
    expect(cleanMerchantName('Grab* A-A359GUFW36UCAV')).toBe('Grab');
    expect(cleanMerchantName('GOJEK RECURRING NON3DS')).toBe('Gojek');
    expect(cleanMerchantName('KIMBERLY SPA BATU BOLONG')).toBe('Kimberly Spa Batu Bolong');
  });
});

const baseInput: RuleInput = {
  merchant: 'Grab', merchant_raw: 'Grab* A-A359GUFW36UCAV', text: null, app: 'com.revolut.revolut',
  currency: 'IDR', account_id: null, amount_eur: -2.94, occurred_at: '2026-11-15T14:32:00+08:00', source: 'capture',
};
const grabRule: Rule = {
  id: 'r1', name: 'Grab', enabled: true, priority: 10,
  definition: {
    conditions: [{ field: 'merchant', op: 'contains', value: 'grab' }],
    actions: { nature: 'need', labels: ['Grab'] },
    bands: [
      { max: 2, actions: { category_id: 'taxi' } },
      { min: 2, max: 6, actions: { ask: ['ristorante', 'taxi'] } },
      { min: 6, actions: { category_id: 'ristorante' } },
    ],
  },
};

describe('regole', () => {
  it('applica le fasce di importo della regola Grab', () => {
    expect(evaluateRules([grabRule], { ...baseInput, amount_eur: -1.5 }).category_id).toBe('taxi');
    expect(evaluateRules([grabRule], { ...baseInput, amount_eur: -2.94 }).ask).toEqual(['ristorante', 'taxi']);
    expect(evaluateRules([grabRule], { ...baseInput, amount_eur: -8 }).category_id).toBe('ristorante');
  });
  it('somma le etichette e lascia vincere la prima categoria', () => {
    const other: Rule = { id: 'r2', name: 'Tutto', enabled: true, priority: 50, definition: { conditions: [], actions: { category_id: 'altro', labels: ['Bali'] } } };
    const r = evaluateRules([other, grabRule], { ...baseInput, amount_eur: -8 });
    expect(r.category_id).toBe('ristorante');
    expect(r.labels).toEqual(['Grab', 'Bali']);
    expect(r.nature).toBe('need');
  });
  it('legge l’ora nel fuso del telefono', () => {
    const night: Rule = { id: 'r3', name: 'Notte', enabled: true, priority: 1, definition: { conditions: [{ field: 'hour', op: 'gte', value: 14 }], actions: { labels: ['Pomeriggio'] } } };
    expect(evaluateRules([night], baseInput).labels).toEqual(['Pomeriggio']);
  });
});

describe('doppioni', () => {
  it('riconosce la stessa spesa arrivata da due telefoni', () => {
    const a = { amount: -112000000, currency: 'IDR', merchant_raw: 'GOJEK RECURRING NON3DS', occurred_at: '2026-11-15T11:05:00+08:00' };
    const b = { ...a, occurred_at: '2026-11-15T11:05:04+08:00' };
    expect(isLikelyDuplicate(a, b)).toBe(true);
    expect(isLikelyDuplicate(a, { ...b, amount: -113000000 })).toBe(false);
    expect(isLikelyDuplicate(a, { ...b, occurred_at: '2026-11-15T11:25:00+08:00' })).toBe(false);
  });
});
