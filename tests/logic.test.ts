import { categoryFromKeywords, KEYWORD_COUNT } from '../shared/keywords';
import { describe, expect, it } from 'vitest';
import { amountAppearsInText, formatMoney, parseAmount, roundMilli, toMilli } from '../shared/money';
import { cleanMerchantName, parseFromHint, parseGeneric, parseNotification, parseWithParser, suggestPattern } from '../shared/notification';
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
    expect(formatMoney(-2940, 'EUR')).toBe('−2,94\u00a0€');
    expect(formatMoney(55600000, 'IDR')).toBe('55.600\u00a0Rp');
    expect(formatMoney(4500000, 'USD')).toBe('4.500,00\u00a0$'); // migliaia separate anche sotto 10.000
    expect(formatMoney(687069150, 'USD', { sign: true })).toBe('+687.069,15\u00a0$');
    expect(formatMoney(1000, 'XYZ')).toBe('1,00\u00a0XYZ');
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

import { normalizePostedAt, zonedIso } from '../shared/time';

describe('lettori senza app (iPhone)', () => {
  const parser = { id: 'p', name: 'Jago', app: 'com.jago.digitalBanking', flags: 'i', direction: 'expense' as const, default_currency: 'IDR', pattern: 'Pembayaran (?<amount>[\\d.]+) ke (?<merchant>.+?) berhasil' };
  it('riconosce l’app dal titolo', () => {
    expect(parseNotification({ title: 'Jago', text: 'Pembayaran 25.000 ke KOPI berhasil' }, [parser])?.via).toBe('lettore: Jago');
  });
  it('senza app né titolo prova tutti i lettori', () => {
    expect(parseNotification({ text: 'Pembayaran 25.000 ke KOPI berhasil' }, [parser])?.via).toBe('lettore: Jago');
  });
  it('con un’altra app non usa il lettore', () => {
    expect(parseNotification({ app: 'com.bca', text: 'Pembayaran 25.000 ke KOPI berhasil' }, [parser])?.via).not.toBe('lettore: Jago');
  });
});

describe('fuso orario', () => {
  const now = new Date('2026-11-14T23:30:00Z');
  it('scrive l’ora nel fuso di Bali', () => {
    expect(zonedIso(now, 'Asia/Makassar')).toBe('2026-11-15T07:30:00+08:00');
    expect(zonedIso(now, 'Europe/Rome')).toBe('2026-11-15T00:30:00+01:00');
  });
  it('lascia com’è un’ora con fuso esplicito', () => {
    expect(normalizePostedAt('2026-11-15T14:32:08+08:00', 'Europe/Rome')).toBe('2026-11-15T14:32:08+08:00');
    expect(normalizePostedAt('2026-11-15T14:32:08+0800', 'UTC')).toBe('2026-11-15T14:32:08+08:00');
  });
  it('riscrive UTC ed epoch nel fuso scelto', () => {
    expect(normalizePostedAt('2026-11-14T23:30:00Z', 'Asia/Makassar')).toBe('2026-11-15T07:30:00+08:00');
    expect(normalizePostedAt(String(now.getTime()), 'Asia/Makassar')).toBe('2026-11-15T07:30:00+08:00');
    expect(normalizePostedAt(String(now.getTime() / 1000), 'Asia/Makassar')).toBe('2026-11-15T07:30:00+08:00');
  });
  it('considera locale un’ora senza fuso (MacroDroid)', () => {
    expect(normalizePostedAt('2026-11-15 07:15:00', 'Asia/Makassar')).toBe('2026-11-15T07:15:00+08:00');
    expect(normalizePostedAt('2026-07-15 07:15', 'Europe/Rome')).toBe('2026-07-15T07:15:00+02:00');
  });
  it('senza ora o con testo illeggibile usa adesso', () => {
    expect(normalizePostedAt(null, 'Asia/Makassar', now)).toBe('2026-11-15T07:30:00+08:00');
    expect(normalizePostedAt('ieri sera', 'Asia/Makassar', now)).toBe('2026-11-15T07:30:00+08:00');
  });
});

describe('nome del negozio dalla riga dell’importo', () => {
  it('"50 AED restaurant" (notifica di prova del proprietario) dà il negozio', () => {
    const p = parseNotification({ title: 'ntfy.sh/23-usd-reload', text: 'ntfy.sh/23-usd-reload\n\n50 AED restaurant' }, []);
    expect(p).toMatchObject({ amount: 50, currency: 'AED', merchant: 'restaurant' });
  });
  it('la lettura del telefono senza negozio prende quello del testo', () => {
    const p = parseNotification({ text: 'ntfy.sh/x\n50 AED restaurant', hint: { amount: '50', currency: 'AED', merchant: '' } }, []);
    expect(p?.merchant).toBe('restaurant');
  });
  it('non inventa negozi da frasi lunghe o vuote', () => {
    expect(parseNotification({ text: 'Paid 70,000.00 IDR' }, [])?.merchant).toBeNull();
    expect(parseNotification({ text: 'Charged 12 USD today something happened with your account balance now' }, [])?.merchant).toBeNull();
  });
});

describe('categoria dalle parole chiave, in più lingue', () => {
  const cases: Array<[string, string]> = [
    ['restaurant', 'cat_food_restaurant'], ['Ristorante Da Mario', 'cat_food_restaurant'], ['Warung Made', 'cat_food_restaurant'],
    ['Restaurante El Sol', 'cat_food_restaurant'], ['ร้านอาหาร', 'cat_food_restaurant'], ['Starbucks', 'cat_food_bar'], ['Kopi Kenangan', 'cat_food_bar'],
    ['Café de Flore', 'cat_food_bar'], ['Uber Eats', 'cat_food_delivery'], ['Grab Food', 'cat_food_delivery'], ['Uber', 'cat_transport_taxi'],
    ['Carrefour', 'cat_food_groceries'], ['Indomaret', 'cat_food_groceries'], ['Netflix', 'cat_subs_streaming'], ['YouTube Premium', 'cat_subs_streaming'],
    ['Tinder', 'cat_subs_dating'], ['Bumble', 'cat_subs_dating'], ['Amazon Prime', 'cat_subs_shopping'], ['Amazon', 'cat_shop_other'],
    ['Claude.ai', 'cat_work_ai'], ['OpenAI ChatGPT', 'cat_work_ai'], ['Steam', 'cat_subs_games'], ['Ryanair', 'cat_transport_flights'],
    ['Farmacia Centrale', 'cat_health_pharmacy'], ['Apotek K-24', 'cat_health_pharmacy'], ['Pertamina', 'cat_vehicle_fuel'], ['Booking.com', 'cat_travel_hotel'],
    ['Barbershop', 'cat_care_hair'], ['Anytime Fitness', 'cat_care_fitness'], ['Telkomsel', 'cat_subs_phone'], ['Cloudflare', 'cat_work_hosting'],
  ];
  for (const [text, id] of cases) it(`${text} → ${id}`, () => expect(categoryFromKeywords('expense', text)).toBe(id));
  // Elenco grande (negozi e marche di Bali, Sud-Est asiatico, Italia, Europa…): resta veloce.
  const more: Array<[string, string]> = [
    ['MIE GACOAN DENPASAR', 'cat_food_fastfood'], ['Pepito Express Canggu', 'cat_food_groceries'], ['Frestive Seminyak', 'cat_food_groceries'],
    ['Finns Beach Club', 'cat_fun_going_out'], ['Potato Head Beach Club', 'cat_fun_going_out'], ['Waterbom Bali', 'cat_fun_activities'],
    ['Highlands Coffee', 'cat_food_bar'], ['Phuc Long', 'cat_food_bar'], ['Jollibee Makati', 'cat_food_fastfood'], ['Lulu Hypermarket', 'cat_food_groceries'],
    ['Salik Dubai', 'cat_vehicle_parking'], ['DEWA', 'cat_home_energy'], ['Esselunga', 'cat_food_groceries'], ['Trenitalia', 'cat_transport_train'],
    ['Frecciarossa 9541', 'cat_transport_train'], ['Autostrade per l\'Italia', 'cat_vehicle_parking'], ['Gili Getaway', 'cat_transport_ferry'],
    ['Mercury Drug', 'cat_health_pharmacy'], ['Bumrungrad International', 'cat_health_doctor'], ['Owndays', 'cat_health_optician'],
    ['Johnny Andrean', 'cat_care_hair'], ['Jari Menari', 'cat_care_spa'], ['The Yoga Barn', 'cat_care_fitness'], ['Olive Young', 'cat_care_cosmetics'],
    ['Cinema XXI', 'cat_fun_events'], ['Bet365', 'cat_fun_games'], ['Marriott Bonvoy', 'cat_travel_hotel'], ['VFS Global', 'cat_travel_visa'],
    ['Cambly', 'cat_edu_courses'], ['Periplus', 'cat_edu_books'], ['Cursor', 'cat_work_ai'], ['Lovable', 'cat_work_ai'], ['Figma', 'cat_work_software'],
    ['Hetzner Online', 'cat_work_hosting'], ['Outpost Canggu', 'cat_work_cowork'], ['Google Ads', 'cat_work_professional'], ['Commercialista Rossi', 'cat_work_professional'],
    ['Imposta di bollo', 'cat_fin_fees'], ['Central Kuta Money Exchange', 'cat_fin_atm'], ['Modello F24', 'cat_fin_taxes'], ['Atome', 'cat_fin_loans'],
    ['Bitpanda', 'cat_invest'], ['Interflora', 'cat_gifts_gifts'], ['Dana Punia', 'cat_gifts_religious'], ['Petco', 'cat_pets_food'],
    ['Lazada', 'cat_shop_other'], ['Uniqlo', 'cat_shop_clothes'], ['IKEA', 'cat_shop_home'], ['Thomann', 'cat_shop_hobby'], ['Sharaf DG', 'cat_shop_electronics'],
    ['Max.com', 'cat_subs_streaming'], ['Telkomsel', 'cat_subs_phone'], ['Airalo', 'cat_subs_phone'], ['NordVPN', 'cat_subs_cloud'],
    ['Pertamina SPBU 54.801.12', 'cat_vehicle_fuel'], ['Bali Bike Rental', 'cat_vehicle_rent'], ['Genki Sushi', 'cat_food_restaurant'], ['Genki', 'cat_health_insurance'],
    ['Pullman Bali Legian Beach', 'cat_travel_hotel'], ['Amazon Kindle', 'cat_edu_books'], ['Buy Me a Coffee', 'cat_gifts_charity'], ['火锅店', 'cat_food_restaurant'],
  ];
  for (const [text, id] of more) it(`${text} → ${id}`, () => expect(categoryFromKeywords('expense', text)).toBe(id));
  it('molte voci, nessun rallentamento', () => {
    expect(KEYWORD_COUNT).toBeGreaterThan(4000);
    const text = 'You paid 52,900.00 IDR to SOME UNKNOWN MERCHANT NAME PT ABC at Jl. Raya Canggu No. 12 with card ****1234 via Apple Pay. Cashback +$0.12';
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) categoryFromKeywords('expense', 'Unknown merchant', null, text);
    expect((performance.now() - t0) / 1000).toBeLessThan(0.5); // meno di mezzo millisecondo a notifica
  });
  it('le parole comuni nel testo della notifica non decidono', () => {
    for (const t of ['Payment with your Gold card', 'Top up 100 EUR', 'Paid with Apple Pay on iPhone', 'Total 50 premium', 'Transaksi aman', 'Carta di debito Mastercard'])
      expect(categoryFromKeywords('expense', t), t).toBeNull();
  });
  it('non scatta su parole comuni o sulle carte Visa', () => {
    expect(categoryFromKeywords('expense', 'Visa ****1234 total 50 fine')).toBeNull();
    expect(categoryFromKeywords('expense', 'Air')).toBeNull();
    expect(categoryFromKeywords('expense', 'Air minum')).toBe('cat_home_water');
  });
  it('le entrate usano solo le categorie di entrata', () => {
    expect(categoryFromKeywords('income', 'Salary November')).toBe('cat_income_salary');
    expect(categoryFromKeywords('income', 'Staking reward')).toBe('cat_income_crypto');
    expect(categoryFromKeywords('income', 'Netflix')).toBeNull();
  });
});

describe('entrate e spese', () => {
  it('"Card payment | Cashback" è una spesa (notifica reale del proprietario)', () => {
    const p = parseNotification({ title: 'Card payment', text: '16,200.00 IDR | Grab* A-A3BLGUWWWGKVAV | Card payment | Cashback: +$0.04' }, []);
    expect(p).toMatchObject({ amount: 16200, currency: 'IDR', direction: 'expense' });
    expect(p?.merchant).toContain('Grab');
  });
  it('anche la seconda notifica reale (52,900 IDR, cashback 0.12) è una spesa e non un rimborso', () => {
    const p = parseNotification({ title: 'Card payment', text: '52,900.00 IDR | Grab* A-A3D4M24GXEQSAV | Card payment | Cashback: +$0.12' }, []);
    expect(p).toMatchObject({ amount: 52900, currency: 'IDR', direction: 'expense' });
    expect(categoryFromKeywords('expense', p?.merchant, '52,900.00 IDR | Grab* A-A3D4M24GXEQSAV | Card payment | Cashback: +$0.12')).toBe('cat_transport_taxi');
  });
  it('un cashback da solo è un’entrata, un rimborso anche dentro un pagamento', () => {
    expect(parseNotification({ text: 'Cashback 2.50 USD credited' }, [])?.direction).toBe('income');
    expect(parseNotification({ text: 'Refund of card payment 12 EUR from Zara' }, [])?.direction).toBe('income');
  });
});

describe('lettore proposto da una notifica vera', () => {
  const check = (text: string, want: { amount: number; currency: string; merchant?: string }) => {
    const pattern = suggestPattern(text);
    expect(pattern).toBeTruthy();
    const r = parseWithParser({ id: 'x', name: 'x', app: 'x', pattern: pattern!, flags: 'i', direction: 'expense', default_currency: null }, `Titolo\n${text}`);
    expect(r).toMatchObject(want);
    return pattern!;
  };
  it('notifica Xplace "importo | negozio | Card payment | Cashback"', () => {
    const p = check('52,900.00 IDR | Grab* A-A3D4M24GXEQSAV | Card payment | Cashback: +$0.12', { amount: 52900, currency: 'IDR', merchant: 'Grab* A-A3D4M24GXEQSAV' });
    // Lo stesso modello legge le altre notifiche della stessa carta.
    const r = parseWithParser({ id: 'x', name: 'x', app: 'x', pattern: p, flags: 'i', direction: 'expense', default_currency: null }, '52.50 EUR | GENKI* GT-652379 | Card payment | Cashback: +$2.35');
    expect(r).toMatchObject({ amount: 52.5, currency: 'EUR', merchant: 'GENKI* GT-652379' });
  });
  it('notifiche con "a / at" e simbolo della valuta', () => {
    check('Hai pagato Rp55.600 a Grab* A-A359GUFW36UCAV', { amount: 55600, currency: 'IDR', merchant: 'Grab* A-A359GUFW36UCAV' });
    check('You spent 12.50 SGD at Ya Kun Kaya Toast', { amount: 12.5, currency: 'SGD', merchant: 'Ya Kun Kaya Toast' });
    check('Transaksi berhasil Rp 48.500 di INDOMARET SEMINYAK', { amount: 48500, currency: 'IDR', merchant: 'INDOMARET SEMINYAK' });
  });
  it('senza importo non propone nulla', () => {
    expect(suggestPattern('Il tuo codice di verifica è 482913')).toBeNull();
  });
});

import { detectRecurring, nextDate } from '../shared/recurring';

describe('spese ricorrenti proposte', () => {
  const o = (merchant: string, day: string, eur: number) => ({ merchant, day, amount_eur: -eur * 1000, category_id: null });
  const today = '2026-11-17';
  it('riconosce un abbonamento mensile con qualche giorno di differenza', () => {
    const rows = [o('Netflix', '2026-08-03', 9.99), o('Netflix', '2026-09-03', 9.99), o('Netflix', '2026-10-02', 9.99), o('Netflix', '2026-11-03', 9.99)];
    expect(detectRecurring(rows, today)).toEqual([{ merchant: 'Netflix', period: 'month', every: 1, amount_eur: -9990, last_date: '2026-11-03', next_date: '2026-12-03', count: 4, category_id: null }]);
  });
  it('settimanale e annuale', () => {
    const week = ['2026-10-20', '2026-10-27', '2026-11-03', '2026-11-10', '2026-11-17'].map((d) => o('Yoga Barn', d, 25));
    const year = ['2023-12-01', '2024-12-02', '2025-12-01'].map((d) => o('Dominio', d, 15));
    const r = detectRecurring([...week, ...year], today);
    expect(r.map((c) => [c.merchant, c.period])).toEqual([['Yoga Barn', 'week'], ['Dominio', 'year']]);
  });
  it('non propone: due volte sole, importi molto diversi, date irregolari, cose finite o già scelte', () => {
    expect(detectRecurring([o('A', '2026-09-01', 10), o('A', '2026-10-01', 10)], today)).toEqual([]);
    expect(detectRecurring(['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'].map((d, i) => o('Pepito', d, [12, 80, 35, 140][i])), today)).toEqual([]);
    expect(detectRecurring(['2026-09-01', '2026-09-12', '2026-10-25', '2026-11-02'].map((d) => o('Bar', d, 5)), today)).toEqual([]);
    expect(detectRecurring(['2026-01-05', '2026-02-05', '2026-03-05', '2026-04-05'].map((d) => o('Palestra vecchia', d, 40)), today)).toEqual([]);
    const netflix = ['2026-09-03', '2026-10-03', '2026-11-03'].map((d) => o('Netflix', d, 10));
    expect(detectRecurring(netflix, today, new Set(['netflix']))).toEqual([]);
  });
  it('prossima data a fine mese', () => {
    expect(nextDate('2026-01-31', 'month')).toBe('2026-02-28');
    expect(nextDate('2026-12-15', 'month')).toBe('2027-01-15');
    expect(nextDate('2024-02-29', 'year')).toBe('2025-02-28');
  });
});
