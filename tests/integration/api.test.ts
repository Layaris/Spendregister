// Test d'integrazione: il vero Worker con D1 locale e tassi fissi (IDR 0.00005, SGD 0.7).
// I test sono in ordine e condividono il database. Il database parte con i dati della versione a
// utente singolo (account "owner" non collegato, vedi server.ts).
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { LEGACY_PASSWORD, LEGACY_TOKEN } from './server';

const BASE = inject('baseUrl');
const EMAIL = 'anna@example.com';
const PASSWORD = 'password-di-prova-123';
const NEW_PASSWORD = 'nuova-password-sicura-456';

class Client {
  cookie = '';
  constructor(private ip = '127.0.0.1') {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const isJson = body !== undefined && typeof body !== 'string' && !(body instanceof URLSearchParams);
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(this.cookie ? { cookie: this.cookie } : {}),
        ...(isJson ? { 'content-type': 'application/json' } : {}),
        'cf-connecting-ip': this.ip,
        ...headers,
      },
      body: isJson ? JSON.stringify(body) : (body as BodyInit | undefined),
    });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/ledgy_session=([^;]*)/);
      if (m) this.cookie = m[1] ? `ledgy_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, json };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.req('POST', p, b ?? {}, h);
  put = (p: string, b: unknown) => this.req('PUT', p, b);
  del = (p: string) => this.req('DELETE', p);
}

const me = new Client();
let deviceUrl = '';
// Le categorie e i conti iniziali di ogni account hanno il suffisso dell'account (cat_food~usr_…).
const own: Record<string, string> = {};
const C = (base: string) => own[base] ?? `${base}?`;
async function loadOwn(c: Client, into: Record<string, string>) {
  const b = (await c.get('/api/bootstrap')).json;
  for (const x of [...b.categories, ...b.accounts]) into[x.id.split('~')[0]] = x.id;
}
let device2Url = '';
const ids: Record<string, string> = {};

async function capture(url: string, payload: unknown, type: 'json' | 'form' | 'text' = 'json') {
  const path = url.replace(BASE, '');
  if (type === 'form') return me.req('POST', path, new URLSearchParams(payload as Record<string, string>));
  if (type === 'text') return me.req('POST', path, payload as string, { 'content-type': 'text/plain' });
  return me.post(path, payload);
}

async function tx(id: string) {
  return (await me.get(`/api/transactions/${id}`)).json;
}

describe('dati della versione con una sola password', () => {
  const owner = new Client('10.6.6.1');
  it('la schermata di accesso propone di collegarli', async () => {
    expect((await owner.get('/api/auth/status')).json).toEqual({ legacy_available: true });
  });
  it('il vecchio iPhone continua a registrare le spese', async () => {
    const r = await owner.post(`/api/in/${LEGACY_TOKEN}`, { text: 'Hai pagato Rp20.000 a Warung Lama', posted_at: '2026-11-03T12:00:00+08:00' });
    expect(r.json.transaction_id).toBeTruthy();
  });
  it('rifiuta la vecchia password sbagliata', async () => {
    expect((await owner.post('/api/claim', { email: 'io@example.com', password: 'nuova-password-owner-1', old_password: 'non-era-questa' })).status).toBe(401);
    expect((await owner.get('/api/me')).status).toBe(401);
  });
  it('con la vecchia password i dati diventano di un account con email', async () => {
    expect((await owner.post('/api/claim', { email: 'io@example.com', password: 'nuova-password-owner-1', old_password: LEGACY_PASSWORD })).status).toBe(200);
    const b = (await owner.get('/api/bootstrap')).json;
    expect(b.account.email).toBe('io@example.com');
    expect(b.accounts.map((a: any) => a.id)).toEqual(['acc_cash']);
    expect(b.categories.some((c: any) => c.id === 'cat_food_bar')).toBe(true);
    const merchants = (await owner.get('/api/transactions')).json.items.map((t: any) => t.merchant).sort();
    expect(merchants).toEqual(['Caffè vecchio', 'Warung Lama']);
    expect((await owner.get('/api/rules')).json.items.map((r: any) => r.name)).toContain('Grab');
  });
  it('non si possono collegare una seconda volta', async () => {
    expect((await owner.get('/api/auth/status')).json).toEqual({ legacy_available: false });
    expect((await new Client('10.6.6.2').post('/api/claim', { email: 'ladro@example.com', password: 'nuova-password-ladro-1', old_password: LEGACY_PASSWORD })).status).toBe(400);
  });
  it('poi si entra con email e password e il vecchio iPhone scrive nello stesso account', async () => {
    const again = new Client('10.6.6.3');
    expect((await again.post('/api/login', { email: 'io@example.com', password: 'nuova-password-owner-1' })).status).toBe(200);
    await again.post(`/api/in/${LEGACY_TOKEN}`, { text: 'Hai pagato Rp30.000 a Bakso Pak Joko', posted_at: '2026-11-04T12:00:00+08:00' });
    expect((await again.get('/api/transactions?q=Bakso')).json.items.length).toBe(1);
  });
});

describe('accesso', () => {
  it('risponde allo stato di salute', async () => {
    expect((await me.get('/api/health')).json).toEqual({ ok: true });
  });
  it('rifiuta le richieste senza sessione', async () => {
    expect((await me.get('/api/bootstrap')).status).toBe(401);
  });
  it('il sito è aperto: la pagina si carica senza password', async () => {
    const r = await fetch(`${BASE}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('<title>');
  });
  it('crea un account con email e password e i dati iniziali', async () => {
    expect((await new Client('10.1.1.2').post('/api/register', { email: 'non-una-email', password: PASSWORD })).status).toBe(400);
    expect((await new Client('10.1.1.2').post('/api/register', { email: 'x@example.com', password: 'corta' })).status).toBe(400);
    expect((await me.post('/api/register', { email: ' Anna@Example.com ', password: PASSWORD })).status).toBe(201);
    expect((await me.get('/api/me')).status).toBe(200);
    const b = (await me.get('/api/bootstrap')).json;
    expect(b.account.email).toBe(EMAIL);
    expect(b.accounts.map((a: any) => a.name)).toEqual(['Contanti']);
    expect(b.categories.length).toBeGreaterThan(50);
    expect(b.settings.timezone).toBe('Asia/Makassar');
    expect(b.settings.recovery_created_at).toBeNull();
    expect((await me.get('/api/rules')).json.items.map((r: any) => r.name)).toContain('Grab');
    expect((await me.get('/api/transactions')).json.items).toEqual([]);
    await loadOwn(me, own);
    expect(C('cat_food_restaurant')).toMatch(/^cat_food_restaurant~usr_/);
  });
  it('non accetta due account con la stessa email', async () => {
    expect((await new Client('10.1.1.3').post('/api/register', { email: EMAIL, password: 'altra-password-123' })).status).toBe(409);
  });
  it('esce ed entra con email e password', async () => {
    const c = new Client('10.1.1.4');
    expect((await c.post('/api/login', { email: EMAIL, password: 'sbagliata-123' })).status).toBe(401);
    expect((await c.post('/api/login', { email: 'nessuno@example.com', password: PASSWORD })).status).toBe(401);
    expect((await c.post('/api/login', { email: 'ANNA@example.com', password: PASSWORD })).status).toBe(200);
    expect((await c.post('/api/logout')).status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(401);
    expect((await me.get('/api/me')).status).toBe(200);
  });
});

describe('telefoni collegati', () => {
  it('crea un indirizzo privato e accetta il segnale', async () => {
    const r = await me.post('/api/capture/devices', { name: 'iPhone test', platform: 'ios', method: 'shortcut' });
    expect(r.status).toBe(201);
    deviceUrl = r.json.url;
    expect(deviceUrl).toContain('/api/in/');
    expect((await capture(`${deviceUrl}/ping`, {})).json.ok).toBe(true);
    device2Url = (await me.post('/api/capture/devices', { name: 'Android test', platform: 'android', method: 'macrodroid' })).json.url;
    const list = (await me.get('/api/capture/devices')).json.items;
    expect(list.find((d: any) => d.name === 'iPhone test').last_seen_at).toBeTruthy();
  });
  it('rifiuta un indirizzo inventato', async () => {
    expect((await me.post('/api/in/inventato', { text: 'x' })).status).toBe(401);
  });
});

describe('cattura delle notifiche', () => {
  it('Grab tra 2 e 6 € va in "da rivedere" con la scelta', async () => {
    const r = await capture(deviceUrl, { title: 'Revolut', text: 'Hai pagato Rp55.600 a Grab* A-A359GUFW36UCAV', posted_at: '2026-11-10T14:32:08+08:00' });
    expect(r.json.status).toBe('review');
    const t = await tx(r.json.transaction_id);
    expect(t.amount).toBe(-55600000);
    expect(t.amount_eur).toBe(-2780);
    expect(t.merchant).toBe('Grab');
    expect(t.card).toBe('Revolut');
    expect(t.review_choices).toEqual([C('cat_food_restaurant'), C('cat_transport_taxi')]);
    expect(t.capture.text).toContain('Rp55.600');
    ids.grabAsk = t.id;
  });
  it('la stessa notifica reinviata è un doppione', async () => {
    const r = await capture(deviceUrl, { title: 'Revolut', text: 'Hai pagato Rp55.600 a Grab* A-A359GUFW36UCAV', posted_at: '2026-11-10T14:32:08+08:00' });
    expect(r.json).toMatchObject({ status: 'duplicate', transaction_id: ids.grabAsk });
  });
  it('Grab sotto 2 € diventa Taxi da sola', async () => {
    const r = await capture(deviceUrl, { text: 'Hai pagato Rp25.000 a Grab* A-B1', posted_at: '2026-11-10T16:00:00+08:00' });
    expect(r.json.status).toBe('created');
    const t = await tx(r.json.transaction_id);
    expect(t.category_id).toBe(C('cat_transport_taxi'));
    expect(t.nature).toBe('need');
    ids.grabTaxi = t.id;
  });
  it('la stessa spesa dal secondo telefono è un possibile doppione', async () => {
    const r = await capture(device2Url, { app: 'com.revolut.revolut', text: 'You paid IDR 25,000 at Grab* A-B1', posted_at: '2026-11-10T16:00:04+08:00' });
    expect(r.json.status).toBe('review');
    const t = await tx(r.json.transaction_id);
    expect(t.duplicate_of).toBe(ids.grabTaxi);
    ids.dup = t.id;
  });
  it('accetta il formato modulo di MacroDroid e usa il fuso scelto', async () => {
    const r = await capture(device2Url, { app: 'com.bca', title: 'BCA', text: 'Transaksi berhasil Rp 48.500 di INDOMARET SEMINYAK', posted_at: '2026-11-11 07:15:00' }, 'form');
    expect(r.json.status).toBe('created');
    const t = await tx(r.json.transaction_id);
    expect(t.occurred_at).toBe('2026-11-11T07:15:00+08:00');
    expect(t.category_id).toBe(C('cat_food_groceries'));
    expect(t.card).toBe('BCA');
  });
  it('accetta il testo semplice e senza ora usa adesso nel fuso scelto', async () => {
    const r = await capture(device2Url, 'Pembayaran Rp 32.000 ke KOPI KENANGAN berhasil', 'text');
    const t = await tx(r.json.transaction_id);
    expect(t.occurred_at).toMatch(/\+08:00$/);
  });
  it('scarta la lettura del telefono se l’importo non è nel testo', async () => {
    const r = await capture(deviceUrl, { title: 'Wise', text: 'You spent 12.50 SGD at Ya Kun Kaya Toast', amount: '99.00', currency: 'SGD', merchant: 'Ya Kun', posted_at: '2026-11-11T19:30:00+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.amount).toBe(-12500);
    expect(t.amount_eur).toBe(-8750);
    expect(t.card).toBe('Wise');
  });
  it('usa la lettura del telefono quando il testo non basta', async () => {
    const r = await capture(deviceUrl, { title: 'Bank', text: 'Pembayaran QRIS 150.000 berhasil', amount: '150.000', currency: 'IDR', merchant: 'Warung Babi Guling', posted_at: '2026-11-12T13:00:00+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.amount).toBe(-150000000);
    expect(t.merchant).toBe('Warung Babi Guling');
  });
  it('ignora i codici di verifica', async () => {
    expect((await capture(deviceUrl, { text: 'Il tuo codice di verifica è 482913' })).json.status).toBe('unrecognized');
  });
  it('riconosce le entrate', async () => {
    const r = await capture(deviceUrl, { title: 'Revolut', text: 'Hai ricevuto 250,00 € da Mario Rossi', posted_at: '2026-11-12T09:00:00+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.type).toBe('income');
    expect(t.amount_eur).toBe(250000);
  });
  it('rifiuta una notifica vuota', async () => {
    expect((await capture(deviceUrl, { text: '   ' })).status).toBe(400);
  });
});

describe('lettori per banca', () => {
  it('rifiuta un modello non valido', async () => {
    expect((await me.post('/api/capture/parsers', { name: 'x', app: 'x', pattern: '(?<amount>[' })).status).toBe(400);
    expect((await me.post('/api/capture/parsers', { name: 'x', app: 'x', pattern: '(\\d+)' })).status).toBe(400);
  });
  it('prova, salva e usa un lettore, poi rielabora una notifica non riconosciuta', async () => {
    const pattern = 'Debit (?<amount>[\\d.]+) for (?<merchant>.+?) ok';
    const test = await me.post('/api/capture/parsers/test', { pattern, default_currency: 'IDR', text: 'Debit 70.000 for SATE MADURA ok' });
    expect(test.json.parsed).toMatchObject({ amount: 70000, merchant: 'SATE MADURA' });
    const before = await capture(deviceUrl, { title: 'MyBank', text: 'Debit 70.000 for SATE MADURA ok' });
    expect(before.json.status).toBe('unrecognized');
    expect((await me.post('/api/capture/parsers', { name: 'MyBank', app: 'MyBank', pattern, default_currency: 'IDR' })).status).toBe(201);
    const retry = await me.post(`/api/capture/captures/${before.json.capture_id}/retry`);
    expect(['created', 'review']).toContain(retry.json.status);
    const t = await tx(retry.json.transaction_id);
    expect(t.amount).toBe(-70000000);
  });
});

describe('da rivedere', () => {
  it('conferma la scelta della fascia "chiedimi"', async () => {
    expect((await me.post(`/api/transactions/${ids.grabAsk}/confirm`, { category_id: C('cat_food_restaurant') })).status).toBe(200);
    const t = await tx(ids.grabAsk);
    expect(t.status).toBe('confirmed');
    expect(t.review_choices).toEqual([]);
    expect(t.nature).toBe('want');
  });
  it('il possibile doppione non conta nelle statistiche finché non si decide', async () => {
    const s = (await me.get('/api/stats?from=2026-11-10&to=2026-11-11')).json;
    // Grab 2,78 + Grab 1,25 (il doppione da 1,25 è escluso)
    expect(s.spent).toBe(4030);
  });
  it('"sono due spese" tiene il doppione come spesa a sé', async () => {
    const r = await me.post(`/api/transactions/${ids.dup}/not-duplicate`);
    expect(r.json.status).toBe('confirmed');
    const s = (await me.get('/api/stats?from=2026-11-10&to=2026-11-11')).json;
    expect(s.spent).toBe(5280);
  });
  it('unire un doppione cancella il secondo', async () => {
    const r = await capture(device2Url, { app: 'com.revolut.revolut', text: 'Hai pagato Rp55.600 a Grab* A-A359GUFW36UCAV', posted_at: '2026-11-10T14:32:10+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.duplicate_of).toBe(ids.grabAsk);
    expect((await me.post(`/api/transactions/${t.id}/merge`)).json.kept).toBe(ids.grabAsk);
    expect((await me.get(`/api/transactions/${t.id}`)).status).toBe(404);
  });
});

describe('movimenti', () => {
  it('crea una spesa a mano in rupie e la converte', async () => {
    const r = await me.post('/api/transactions', { amount: 45000, currency: 'IDR', merchant: 'Warung Nasi Goreng', category_id: C('cat_food_restaurant'), occurred_at: '2026-11-12T20:10:00+08:00', labels: ['Bali', 'Cena'] });
    expect(r.status).toBe(201);
    const t = await tx(r.json.id);
    expect(t.amount_eur).toBe(-2250);
    expect(t.account_id).toBe(C('acc_cash'));
    expect(t.labels.sort()).toEqual(['Bali', 'Cena']);
    ids.manual = t.id;
  });
  it('senza categoria usa quella dello storico per lo stesso merchant', async () => {
    const r = await me.post('/api/transactions', { amount: 30000, currency: 'IDR', merchant: 'Warung Nasi Goreng', occurred_at: '2026-11-13T20:10:00+08:00' });
    expect((await tx(r.json.id)).category_id).toBe(C('cat_food_restaurant'));
  });
  it('modifica importo, valuta, categoria ed etichette', async () => {
    await me.put(`/api/transactions/${ids.manual}`, { amount: 3.5, currency: 'EUR', category_id: C('cat_food_bar'), labels: ['Bali'] });
    const t = await tx(ids.manual);
    expect(t.amount).toBe(-3500);
    expect(t.amount_eur).toBe(-3500);
    expect(t.category_id).toBe(C('cat_food_bar'));
    expect(t.labels).toEqual(['Bali']);
  });
  it('filtra per testo, categoria e stato', async () => {
    expect((await me.get('/api/transactions?q=nasi')).json.items.length).toBe(2);
    const food = (await me.get(`/api/transactions?category=${C('cat_food')}`)).json.items;
    expect(food.every((t: any) => t.category_id?.startsWith('cat_food'))).toBe(true);
    expect((await me.get('/api/transactions?status=review')).json.items.every((t: any) => t.status === 'review')).toBe(true);
  });
  it('rifiuta valute non valide e trasferimenti', async () => {
    expect((await me.post('/api/transactions', { amount: 1, currency: 'EURO' })).status).toBe(400);
    expect((await me.post('/api/transactions', { amount: 1, type: 'transfer' })).status).toBe(400);
    expect((await me.post('/api/transactions', { amount: 0 })).status).toBe(400);
  });
  it('elimina un movimento', async () => {
    const r = await me.post('/api/transactions', { amount: 1, currency: 'EUR', merchant: 'Da cancellare' });
    await me.del(`/api/transactions/${r.json.id}`);
    expect((await me.get('/api/transactions?q=Da cancellare')).json.items.length).toBe(0);
  });
  it('conferma in blocco i movimenti pronti', async () => {
    const r = await me.post('/api/transactions/confirm-ready');
    expect(r.status).toBe(200);
  });
});

describe('statistiche', () => {
  it('riassume il periodo', async () => {
    const s = (await me.get('/api/stats?from=2026-11-01&to=2026-12-01')).json;
    expect(s.spent).toBeGreaterThan(0);
    expect(s.income).toBe(250000);
    expect(s.by_category.length).toBeGreaterThan(0);
    expect(s.by_merchant[0].merchant).toBeTruthy();
    expect(s.daily.length).toBeGreaterThan(0);
    expect(s.days.total).toBe(30);
  });
  it('dà l’andamento del saldo', async () => {
    const r = (await me.get('/api/stats/balance?days=10')).json;
    expect(r.series.length).toBe(10);
  });
  it('chiede le date', async () => {
    expect((await me.get('/api/stats')).status).toBe(400);
  });
});

describe('regole', () => {
  it('rifiuta una regex non valida', async () => {
    expect((await me.post('/api/rules', { name: 'x', definition: { conditions: [{ field: 'merchant', op: 'regex', value: '(' }], actions: {} } })).status).toBe(400);
  });
  it('crea una regola, la prova sullo storico e la applica', async () => {
    const definition = { conditions: [{ field: 'merchant', op: 'contains', value: 'kopi' }], actions: { category_id: C('cat_food_bar'), labels: ['Caffè'] } };
    const preview = (await me.post('/api/rules/preview', { definition })).json;
    expect(preview.matched).toBe(1);
    expect(preview.changed).toBe(1);
    expect(preview.next).toBeNull();
    const r = await me.post('/api/rules', { name: 'Kopi', priority: 5, definition });
    const applied = (await me.post(`/api/rules/${r.json.id}/apply`, { after: 0 })).json;
    expect(applied.changed).toBe(1);
    const kopi = (await me.get('/api/transactions?q=kopi')).json.items[0];
    expect(kopi.category_id).toBe(C('cat_food_bar'));
    ids.rule = r.json.id;
  });
  it('la regola nuova vale per le notifiche successive', async () => {
    const r = await capture(deviceUrl, { text: 'Hai pagato Rp28.000 a KOPI KENANGAN', posted_at: '2026-11-14T08:00:00+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.category_id).toBe(C('cat_food_bar'));
    expect(t.labels).toEqual(['Caffè']);
  });
  it('disattiva ed elimina una regola', async () => {
    await me.put(`/api/rules/${ids.rule}`, { enabled: false });
    expect((await me.get('/api/rules')).json.items.find((r: any) => r.id === ids.rule).enabled).toBe(false);
    await me.del(`/api/rules/${ids.rule}`);
    expect((await me.get('/api/rules')).json.items.find((r: any) => r.id === ids.rule)).toBeUndefined();
  });
});

describe('conti', () => {
  it('un conto in rupie mostra il saldo in rupie e conta nel saldo totale in euro', async () => {
    const before = (await me.get('/api/stats/balance?days=2')).json.series.at(-1).balance;
    const r = await me.post('/api/accounts', { name: 'Contanti IDR', currency: 'IDR', initial_balance: 1000000 });
    expect(r.status).toBe(201);
    const acc = (await me.get('/api/bootstrap')).json.accounts.find((a: any) => a.id === r.json.id);
    expect(acc.balance).toBe(1000000000);
    const after = (await me.get('/api/stats/balance?days=2')).json.series.at(-1).balance;
    expect(after - before).toBe(50000);
    await me.put(`/api/accounts/${r.json.id}`, { archived: true });
    expect((await me.get('/api/bootstrap')).json.accounts.find((a: any) => a.id === r.json.id)).toBeUndefined();
  });
  it('rifiuta un conto senza nome', async () => {
    expect((await me.post('/api/accounts', { name: '  ' })).status).toBe(400);
  });
});

describe('impostazioni', () => {
  it('cambia il fuso orario e rifiuta quelli inventati', async () => {
    expect((await me.put('/api/settings', { timezone: 'Europe/Rome' })).status).toBe(200);
    expect((await me.get('/api/settings')).json.timezone).toBe('Europe/Rome');
    expect((await me.put('/api/settings', { timezone: 'Marte/Base' })).status).toBe(400);
    await me.put('/api/settings', { timezone: 'Asia/Makassar' });
  });
  it('dà il tasso per la conversione dal vivo', async () => {
    expect((await me.get('/api/fx?currency=IDR')).json.eurPerUnit).toBe(0.00005);
  });
});

async function exportAll(c: Client) {
  const tables: Record<string, any[]> = {};
  for (const t of ['settings', 'accounts', 'categories', 'labels', 'rules', 'parsers', 'devices', 'transactions', 'transaction_labels', 'captures']) {
    tables[t] = [];
    let after = 0;
    for (;;) {
      const r = (await c.get(`/api/backup/export?table=${t}&after=${after}&limit=7`)).json;
      tables[t].push(...r.rows);
      if (r.next == null) break;
      after = r.next;
    }
  }
  return { format: 'ledgy-backup', version: 1, exported_at: new Date().toISOString(), tables };
}

async function importAll(c: Client, b: any, mode: 'merge' | 'replace') {
  const begin = await c.post('/api/backup/import/begin', { mode, format: b.format, version: b.version });
  if (begin.status !== 200) return begin;
  const maps: Record<string, Record<string, string>> = {};
  let inserted = 0;
  for (const table of Object.keys(b.tables)) {
    const rows = b.tables[table];
    for (let i = 0; i < rows.length; i += 5) {
      const r = await c.post('/api/backup/import/chunk', { mode, table, rows: rows.slice(i, i + 5), maps });
      if (r.status !== 200) return r;
      if (r.json.map) maps[table] = { ...(maps[table] ?? {}), ...r.json.map };
      inserted += r.json.inserted;
    }
  }
  return { status: 200, json: { inserted } };
}

describe('backup', () => {
  let backup: any;
  it('esporta tutte le tabelle a pagine, senza la password', async () => {
    backup = await exportAll(me);
    expect(backup.tables.transactions.length).toBeGreaterThan(10);
    expect(backup.tables.categories.length).toBeGreaterThan(50);
    expect(backup.tables.devices.length).toBe(2);
    expect(JSON.stringify(backup.tables.settings)).not.toContain('password');
  });
  it('rifiuta file che non sono backup di Ledgy', async () => {
    expect((await me.post('/api/backup/import/begin', { mode: 'merge', format: 'altro', version: 1 })).status).toBe(400);
    expect((await me.post('/api/backup/import/begin', { mode: 'boh', format: 'ledgy-backup', version: 1 })).status).toBe(400);
  });
  it('"aggiungi" con lo stesso backup non duplica nulla', async () => {
    const before = (await me.get('/api/transactions?limit=500')).json.items.length;
    const r = await importAll(me, backup, 'merge');
    expect(r.status).toBe(200);
    expect(r.json.inserted).toBe(0);
    expect((await me.get('/api/transactions?limit=500')).json.items.length).toBe(before);
  });
  it('"aggiungi" riconosce le categorie per nome e collega i movimenti nuovi', async () => {
    const other = JSON.parse(JSON.stringify(backup));
    other.tables = {
      categories: [{ id: 'cat_altro_bar', name: 'Bar, caffè', parent_id: 'cat_altro_food', kind: 'expense' }, { id: 'cat_altro_food', name: 'Cibo e bevande', parent_id: null, kind: 'expense' }],
      accounts: [{ id: 'acc_altro', name: 'Contanti', currency: 'EUR', type: 'cash', initial_balance: 0, created_at: '2026-01-01T00:00:00Z' }],
      labels: [{ id: 'lab_altro', name: 'Bali' }],
      transactions: [{ id: 'tx_da_altro_backup', type: 'expense', account_id: 'acc_altro', amount: -4000, currency: 'EUR', amount_eur: -4000, occurred_at: '2026-11-09T10:00:00+08:00', merchant: 'Revolver Espresso', category_id: 'cat_altro_bar', source: 'import', status: 'confirmed' }],
      transaction_labels: [{ transaction_id: 'tx_da_altro_backup', label_id: 'lab_altro' }],
    };
    const r = await importAll(me, other, 'merge');
    expect(r.status).toBe(200);
    const t = await tx('tx_da_altro_backup');
    expect(t.category_id).toBe(C('cat_food_bar'));
    expect(t.account_id).toBe(C('acc_cash'));
    expect(t.labels).toEqual(['Bali']);
    const cats = (await me.get('/api/bootstrap')).json.categories;
    expect(cats.filter((c: any) => c.name === 'Bar, caffè').length).toBe(1);
  });
  it('"sostituisci" rimette esattamente i dati del backup', async () => {
    const r = await importAll(me, backup, 'replace');
    expect(r.status).toBe(200);
    const again = await exportAll(me);
    expect(again.tables.transactions.length).toBe(backup.tables.transactions.length);
    expect(again.tables.categories.length).toBe(backup.tables.categories.length);
    expect(again.tables.devices.length).toBe(2);
    expect((await me.get('/api/transactions/tx_da_altro_backup')).status).toBe(404);
    // I telefoni del backup funzionano ancora.
    expect((await capture(`${deviceUrl}/ping`, {})).json.ok).toBe(true);
  });
});

describe('password', () => {
  const other = new Client();
  beforeAll(async () => {
    await other.post('/api/login', { email: EMAIL, password: PASSWORD });
  });
  it('rifiuta il cambio con la password attuale sbagliata o troppo corta', async () => {
    expect((await me.put('/api/password', { current: 'sbagliata', next: NEW_PASSWORD })).status).toBe(400);
    expect((await me.put('/api/password', { current: PASSWORD, next: 'corta' })).status).toBe(400);
  });
  it('cambia la password e chiude le altre sessioni', async () => {
    expect((await other.get('/api/me')).status).toBe(200);
    expect((await me.put('/api/password', { current: PASSWORD, next: NEW_PASSWORD })).status).toBe(200);
    expect((await me.get('/api/me')).status).toBe(200);
    expect((await other.get('/api/me')).status).toBe(401);
    expect((await new Client('10.2.2.2').post('/api/login', { email: EMAIL, password: PASSWORD })).status).toBe(401);
    expect((await new Client('10.2.2.3').post('/api/login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(200);
  });
  it('senza codice di recupero il recupero non è possibile', async () => {
    expect((await new Client('10.5.5.1').post('/api/password/recover', { email: EMAIL, code: 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF', password: 'qualunque-cosa-1' })).status).toBe(401);
  });
  let code = '';
  it('crea il codice di recupero solo con la password giusta e lo mostra una volta', async () => {
    expect((await me.post('/api/recovery-code', { password: 'sbagliata' })).status).toBe(400);
    const r = await me.post('/api/recovery-code', { password: NEW_PASSWORD });
    expect(r.status).toBe(200);
    code = r.json.code;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){5}$/);
    expect((await me.get('/api/bootstrap')).json.settings.recovery_created_at).toBeTruthy();
    expect(JSON.stringify((await me.get('/api/backup/export?table=settings')).json)).not.toContain('recovery');
  });
  it('un codice nuovo annulla il vecchio', async () => {
    const old = code;
    code = (await me.post('/api/recovery-code', { password: NEW_PASSWORD })).json.code;
    expect(code).not.toBe(old);
    expect((await new Client('10.5.5.2').post('/api/password/recover', { email: EMAIL, code: old, password: 'con-il-vecchio-codice-1' })).status).toBe(401);
  });
  it('recupera la password con il codice: entra subito e chiude le altre sessioni', async () => {
    const c = new Client('10.5.5.3');
    expect((await c.post('/api/password/recover', { email: EMAIL, code, password: 'corta' })).status).toBe(400);
    // Minuscole e spazi vanno bene: il codice si normalizza.
    const loose = code.toLowerCase().replace(/-/g, ' ');
    expect((await c.post('/api/password/recover', { email: EMAIL, code: loose, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    expect((await me.get('/api/me')).status).toBe(401);
    expect((await new Client('10.3.3.3').post('/api/login', { email: EMAIL, password: NEW_PASSWORD })).status).toBe(401);
    expect((await new Client('10.3.3.4').post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
    // Il codice resta valido per una prossima volta.
    expect((await new Client('10.5.5.4').post('/api/password/recover', { email: EMAIL, code, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
  });
  it('blocca chi prova codici a raffica', async () => {
    const attacker = new Client('10.8.8.8');
    for (let i = 0; i < 10; i++) expect((await attacker.post('/api/password/recover', { email: `x${i}@example.com`, code: `ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZ${i}`, password: 'tentativo-lungo-1' })).status).toBe(401);
    expect((await attacker.post('/api/password/recover', { email: EMAIL, code, password: 'tentativo-lungo-1' })).status).toBe(429);
  });
  it('blocca chi sbaglia la password troppe volte', async () => {
    const attacker = new Client('10.9.9.9');
    for (let i = 0; i < 10; i++) expect((await attacker.post('/api/login', { email: `y${i}@example.com`, password: `tentativo-${i}` })).status).toBe(401);
    expect((await attacker.post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' })).status).toBe(429);
    expect((await new Client('10.4.4.4').post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
  });
  it('blocca chi prova tante password sulla stessa email, anche da indirizzi diversi', async () => {
    const victim = 'carla@example.com';
    expect((await new Client('10.12.0.1').post('/api/register', { email: victim, password: 'password-di-carla-1' })).status).toBe(201);
    for (let i = 0; i < 10; i++) expect((await new Client(`10.12.1.${i}`).post('/api/login', { email: victim, password: `tentativo-${i}` })).status).toBe(401);
    expect((await new Client('10.12.2.1').post('/api/login', { email: victim, password: 'password-di-carla-1' })).status).toBe(429);
    // Le altre email non sono toccate.
    expect((await new Client('10.12.2.2').post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
  });
});

describe('account separati', () => {
  const anna = new Client('10.10.0.1');
  const bob = new Client('10.10.0.2');
  const bobOwn: Record<string, string> = {};
  let annaBackup: any;
  let annaCount = 0;
  beforeAll(async () => {
    await anna.post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' });
    annaCount = (await anna.get('/api/transactions?limit=500')).json.items.length;
    annaBackup = await exportAll(anna);
  });
  it('un account nuovo parte vuoto, con categorie sue', async () => {
    expect((await bob.post('/api/register', { email: 'bob@example.com', password: 'password-di-bob-1' })).status).toBe(201);
    await loadOwn(bob, bobOwn);
    expect(bobOwn.cat_food_bar).toBeTruthy();
    expect(bobOwn.cat_food_bar).not.toBe(C('cat_food_bar'));
    expect((await bob.get('/api/transactions')).json.items).toEqual([]);
    expect((await bob.get('/api/capture/devices')).json.items).toEqual([]);
    expect((await bob.get('/api/stats?from=2026-11-01&to=2026-12-01')).json.spent).toBe(0);
    expect((await bob.get('/api/transactions/tx_vecchio')).status).toBe(404);
  });
  it('non può leggere, cambiare o cancellare i movimenti di un altro', async () => {
    const id = ids.grabAsk;
    expect((await bob.get(`/api/transactions/${id}`)).status).toBe(404);
    expect((await bob.put(`/api/transactions/${id}`, { amount: 1 })).status).toBe(404);
    expect((await bob.post(`/api/transactions/${id}/confirm`, { category_id: bobOwn.cat_food_bar })).status).toBe(404);
    await bob.del(`/api/transactions/${id}`);
    expect((await anna.get(`/api/transactions/${id}`)).json.merchant).toBe('Grab');
  });
  it('non può usare categorie e conti di un altro', async () => {
    expect((await bob.post('/api/transactions', { amount: 1, currency: 'EUR', category_id: C('cat_food_bar') })).status).toBe(400);
    expect((await bob.post('/api/transactions', { amount: 1, currency: 'EUR', account_id: C('acc_cash') })).status).toBe(400);
    const definition = { conditions: [{ field: 'merchant', op: 'contains', value: 'x' }], actions: { category_id: C('cat_food_bar') } };
    expect((await bob.post('/api/rules', { name: 'x', definition })).status).toBe(400);
    expect((await bob.put(`/api/categories/${C('cat_food_bar')}`, { name: 'Rubata' })).status).toBe(404);
  });
  it('i telefoni di ciascuno scrivono solo nel proprio account', async () => {
    const dev = (await bob.post('/api/capture/devices', { name: 'Telefono di Bob', platform: 'android', method: 'macrodroid' })).json.url.replace(BASE, '');
    const r = await bob.post(dev, { text: 'Hai pagato Rp40.000 a Warung di Bob', posted_at: '2026-11-15T12:00:00+08:00' });
    expect((await bob.get(`/api/transactions/${r.json.transaction_id}`)).json.merchant).toBe('Warung di Bob');
    expect((await anna.get(`/api/transactions/${r.json.transaction_id}`)).status).toBe(404);
    expect((await anna.get('/api/transactions?q=Bob')).json.items.length).toBe(0);
  });
  it('importare il backup di un altro non tocca i suoi dati', async () => {
    expect((await importAll(bob, annaBackup, 'merge')).status).toBe(200);
    expect((await importAll(bob, annaBackup, 'replace')).status).toBe(200);
    const bobTx = (await bob.get('/api/transactions?limit=500')).json.items;
    expect(bobTx.length).toBe(annaCount);
    expect(bobTx.every((t: any) => !t.category_id || t.category_id.endsWith(bobOwn.cat_food_bar.split('~')[1]))).toBe(true);
    // Anna ha ancora tutto, con le sue categorie.
    expect((await anna.get('/api/transactions?limit=500')).json.items.length).toBe(annaCount);
    expect((await anna.get(`/api/transactions/${ids.grabAsk}`)).json.category_id).toBe(C('cat_food_restaurant'));
    // I telefoni di Anna mandano ancora le spese ad Anna.
    const r = await anna.post(deviceUrl.replace(BASE, ''), { text: 'Hai pagato Rp21.000 a Dopo il backup di Bob', posted_at: '2026-11-15T13:00:00+08:00' });
    expect((await anna.get(`/api/transactions/${r.json.transaction_id}`)).status).toBe(200);
    expect((await bob.get(`/api/transactions/${r.json.transaction_id}`)).status).toBe(404);
  });
  it('elimina l’account con tutti i dati solo con la password giusta', async () => {
    expect((await bob.post('/api/account/delete', { password: 'sbagliata-123' })).status).toBe(400);
    expect((await bob.post('/api/account/delete', { password: 'password-di-bob-1' })).status).toBe(200);
    expect((await bob.get('/api/me')).status).toBe(401);
    expect((await new Client('10.10.0.3').post('/api/login', { email: 'bob@example.com', password: 'password-di-bob-1' })).status).toBe(401);
    expect((await anna.get('/api/transactions?limit=500')).json.items.length).toBe(annaCount + 1);
    // L'email torna libera.
    expect((await new Client('10.10.0.4').post('/api/register', { email: 'bob@example.com', password: 'password-di-bob-2' })).status).toBe(201);
  });
  it('limita gli account creati dalla stessa rete', async () => {
    const net = new Client('10.11.0.1');
    for (let i = 0; i < 5; i++) expect((await net.post('/api/register', { email: `utente${i}@example.com`, password: 'password-lunga-1' })).status).toBe(201);
    expect((await net.post('/api/register', { email: 'utente9@example.com', password: 'password-lunga-1' })).status).toBe(429);
  });
});
