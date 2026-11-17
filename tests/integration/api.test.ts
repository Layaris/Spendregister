// Test d'integrazione: il vero Worker con D1 locale e tassi fissi (IDR 0.00005, SGD 0.7).
// I test sono in ordine e condividono il database. Il database parte con qualche ospite e account
// creati "a gennaio" (vedi server.ts), per la pulizia notturna.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { suggestPattern } from '../../shared/notification';
import { AI_PORT, OLD, V1_CATEGORIES } from './server';

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

async function newGuest(ip: string) {
  const c = new Client(ip);
  expect((await c.post('/api/guest')).status).toBe(201);
  return c;
}
async function newDevice(c: Client) {
  return (await c.post('/api/capture/devices', { name: 'Telefono', platform: 'ios', method: 'shortcut' })).json.url.replace(BASE, '') as string;
}
const count = async (c: Client, q = '') => (await c.get(`/api/transactions?limit=500${q}`)).json.items.length as number;

describe('uso senza account', () => {
  let guest: Client;
  let guestPhone = '';
  it('senza sessione si usa subito l’app come ospite', async () => {
    const c = new Client('10.20.0.1');
    expect((await c.get('/api/bootstrap')).status).toBe(401);
    expect((await c.post('/api/guest')).status).toBe(201);
    expect((await c.get('/api/me')).json).toEqual({ email: null, guest: true });
    const b = (await c.get('/api/bootstrap')).json;
    expect(b.account.email).toBeNull();
    expect(b.categories.length).toBeGreaterThan(50);
    expect(b.accounts.map((a: any) => a.name)).toEqual(['Contanti']);
    // Con la sessione già aperta non crea un altro ospite.
    expect((await c.post('/api/guest')).status).toBe(200);
    guest = c;
  });
  it('l’ospite registra spese e collega un telefono', async () => {
    expect((await guest.post('/api/transactions', { amount: 2, currency: 'EUR', merchant: 'Caffè da ospite' })).status).toBe(201);
    guestPhone = await newDevice(guest);
    expect((await guest.post(guestPhone, { text: 'Hai pagato Rp20.000 a Warung Ospite', posted_at: '2026-11-03T12:00:00+08:00' })).json.transaction_id).toBeTruthy();
    expect(await count(guest)).toBe(2);
  });
  it('l’ospite non ha password da cambiare né codice di recupero', async () => {
    expect((await guest.put('/api/password', { current: '', next: 'nuova-password-123' })).status).toBe(400);
    expect((await guest.post('/api/recovery-code', { password: '' })).status).toBe(400);
  });
  it('creando un account con dati chiede cosa farne', async () => {
    const r = await guest.post('/api/register', { email: 'ospite@example.com', password: 'password-ospite-1' });
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ choice: 'register', local: { transactions: 2, devices: 1 } });
    expect((await guest.get('/api/me')).json.guest).toBe(true);
  });
  it('"porta i dati" li tiene nel nuovo account, telefono compreso', async () => {
    expect((await guest.post('/api/register', { email: 'ospite@example.com', password: 'password-ospite-1', choice: 'keep' })).status).toBe(201);
    expect((await guest.get('/api/me')).json).toEqual({ email: 'ospite@example.com', guest: false });
    expect(await count(guest)).toBe(2);
    await guest.post(guestPhone, { text: 'Hai pagato Rp25.000 a Dopo la registrazione', posted_at: '2026-11-04T12:00:00+08:00' });
    const other = new Client('10.20.0.2');
    expect((await other.post('/api/login', { email: 'ospite@example.com', password: 'password-ospite-1' })).status).toBe(200);
    expect(await count(other)).toBe(3);
  });
  it('"inizia vuoto" crea un account nuovo e cancella i dati dell’ospite', async () => {
    const g = await newGuest('10.20.1.1');
    await g.post('/api/transactions', { amount: 2, currency: 'EUR', merchant: 'Da buttare' });
    const phone = await newDevice(g);
    expect((await g.post('/api/register', { email: 'vuoto@example.com', password: 'password-vuoto-1', choice: 'fresh' })).status).toBe(201);
    expect((await g.get('/api/me')).json.email).toBe('vuoto@example.com');
    expect(await count(g)).toBe(0);
    expect((await g.get('/api/bootstrap')).json.categories.length).toBeGreaterThan(50);
    expect((await g.post(`${phone}/ping`, {})).status).toBe(401);
  });
  it('un ospite senza dati crea l’account senza domande', async () => {
    const g = await newGuest('10.20.1.2');
    expect((await g.post('/api/register', { email: 'senza-dati@example.com', password: 'password-senza-1' })).status).toBe(201);
  });
});

describe('entrare in un account con i dati di questo dispositivo', () => {
  const maria = new Client('10.21.0.1');
  const mOwn: Record<string, string> = {};
  let mariaPhone = '';
  let mariaTx = '';
  beforeAll(async () => {
    await maria.post('/api/register', { email: 'maria@example.com', password: 'password-maria-1' });
    await loadOwn(maria, mOwn);
    mariaTx = (await maria.post('/api/transactions', { amount: 4, currency: 'EUR', merchant: 'Bar di Maria', category_id: mOwn.cat_food_bar, labels: ['Bali'] })).json.id;
    await maria.post('/api/categories', { name: 'Palestra', kind: 'expense' });
    mariaPhone = await newDevice(maria);
  });
  const login = (c: Client, choice?: string) => c.post('/api/login', { email: 'maria@example.com', password: 'password-maria-1', choice });

  it('un ospite senza dati entra subito', async () => {
    const g = await newGuest('10.21.1.1');
    expect((await login(g)).status).toBe(200);
    expect(await count(g)).toBe(1);
  });
  it('un ospite con dati deve scegliere, e senza scelta non entra', async () => {
    const g = await newGuest('10.21.1.2');
    await g.post('/api/transactions', { amount: 1, currency: 'EUR', merchant: 'x' });
    const r = await login(g);
    expect(r.status).toBe(409);
    expect(r.json).toMatchObject({ choice: 'login', local: { transactions: 1, devices: 0 } });
    expect((await g.get('/api/me')).json.guest).toBe(true);
    expect((await login(g, 'boh')).status).toBe(409);
  });
  it('"aggiungi" unisce i dati: categorie, etichette e regole uguali non si doppiano', async () => {
    const g = await newGuest('10.21.1.3');
    const gOwn: Record<string, string> = {};
    await loadOwn(g, gOwn);
    const yoga = (await g.post('/api/categories', { name: 'Yoga', kind: 'expense', parent_id: gOwn.cat_food })).json.id;
    await g.post('/api/categories', { name: 'Palestra', kind: 'expense' });
    const t1 = (await g.post('/api/transactions', { amount: 3, currency: 'EUR', merchant: 'Bar ospite', category_id: gOwn.cat_food_bar, labels: ['Bali', 'Nuova'] })).json.id;
    const t2 = (await g.post('/api/transactions', { amount: 9, currency: 'EUR', merchant: 'Lezione', category_id: yoga })).json.id;
    const ask = await (async () => { const p = await newDevice(g); return { p, r: await g.post(p, { text: 'Hai pagato Rp55.600 a Grab* A-X', posted_at: '2026-11-05T12:00:00+08:00' }) }; })();
    expect(ask.r.json.status).toBe('review');
    expect((await login(g, 'merge')).status).toBe(200);
    expect((await g.get('/api/me')).json.email).toBe('maria@example.com');
    expect(await count(g)).toBe(4);
    expect((await g.get(`/api/transactions/${t1}`)).json).toMatchObject({ category_id: mOwn.cat_food_bar, account_id: mOwn.acc_cash });
    expect((await g.get(`/api/transactions/${t1}`)).json.labels.sort()).toEqual(['Bali', 'Nuova']);
    expect((await g.get(`/api/transactions/${t2}`)).json.category_id).toBe(yoga);
    const grab = (await g.get(`/api/transactions/${ask.r.json.transaction_id}`)).json;
    expect(grab.review_choices).toEqual([mOwn.cat_food_restaurant, mOwn.cat_transport_taxi]);
    expect(grab.rules.map((r: any) => r.name)).toEqual(['Grab']);
    const b = (await g.get('/api/bootstrap')).json;
    expect(b.categories.filter((c: any) => c.name === 'Palestra').length).toBe(1);
    expect(b.categories.find((c: any) => c.id === yoga).parent_id).toBe(mOwn.cat_food);
    expect(b.categories.every((c: any) => !c.id.includes(gOwn.cat_food.split('~')[1]) || c.id === yoga)).toBe(true);
    expect(b.accounts.map((a: any) => a.name)).toEqual(['Contanti']);
    expect(b.labels.map((l: any) => l.name).sort()).toEqual(['Bali', 'Nuova']);
    expect((await g.get('/api/rules')).json.items.filter((r: any) => r.name === 'Grab').length).toBe(1);
    // Il telefono collegato dall'ospite ora scrive nell'account; anche quello di Maria funziona ancora.
    const r = await g.post(ask.p, { text: 'Hai pagato Rp30.000 a Dopo l’unione', posted_at: '2026-11-06T12:00:00+08:00' });
    expect((await maria.get(`/api/transactions/${r.json.transaction_id}`)).status).toBe(200);
    expect((await maria.post(`${mariaPhone}/ping`, {})).status).toBe(200);
    expect((await maria.get(`/api/transactions/${mariaTx}`)).status).toBe(200);
  });
  it('"usa solo i dati dell’account" cancella quelli dell’ospite', async () => {
    const before = await count(maria);
    const g = await newGuest('10.21.1.4');
    const phone = await newDevice(g);
    await g.post('/api/transactions', { amount: 1, currency: 'EUR', merchant: 'Da dimenticare' });
    expect((await login(g, 'account')).status).toBe(200);
    expect(await count(g)).toBe(before);
    expect(await count(g, '&q=dimenticare')).toBe(0);
    expect((await g.post(`${phone}/ping`, {})).status).toBe(401);
  });
  it('il recupero password con dati chiede la stessa scelta', async () => {
    const code = (await maria.post('/api/recovery-code', { password: 'password-maria-1' })).json.code;
    const g = await newGuest('10.21.1.5');
    await g.post('/api/transactions', { amount: 1, currency: 'EUR', merchant: 'y' });
    const body = { email: 'maria@example.com', code, password: 'password-maria-1' };
    expect((await g.post('/api/password/recover', body)).json.choice).toBe('login');
    expect((await g.post('/api/password/recover', { ...body, choice: 'account' })).status).toBe(200);
    expect((await g.get('/api/me')).json.email).toBe('maria@example.com');
    await maria.post('/api/login', { email: 'maria@example.com', password: 'password-maria-1' });
  });
  it('"sostituisci" cancella i dati dell’account e mette quelli dell’ospite', async () => {
    const g = await newGuest('10.21.1.6');
    await g.post('/api/transactions', { amount: 7, currency: 'EUR', merchant: 'Solo questa' });
    expect((await login(g, 'replace')).status).toBe(200);
    const items = (await g.get('/api/transactions?limit=500')).json.items;
    expect(items.map((t: any) => t.merchant)).toEqual(['Solo questa']);
    expect((await g.post(`${mariaPhone}/ping`, {})).status).toBe(401);
    expect((await g.get('/api/bootstrap')).json.categories.length).toBeGreaterThan(50);
    expect((await g.get('/api/rules')).json.items.map((r: any) => r.name)).toContain('Grab');
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
    expect(r.json.notify).toBe('Da rivedere: Grab −2,78 €');
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
    expect(r.json.notify).toBeUndefined();
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
    const definition = { conditions: [{ field: 'merchant', op: 'contains', value: 'kopi' }], actions: { category_id: C('cat_fun_going_out'), labels: ['Caffè'] } };
    const preview = (await me.post('/api/rules/preview', { definition })).json;
    expect(preview.matched).toBe(1);
    expect(preview.changed).toBe(1);
    expect(preview.next).toBeNull();
    const r = await me.post('/api/rules', { name: 'Kopi', priority: 5, definition });
    const applied = (await me.post(`/api/rules/${r.json.id}/apply`, { after: 0 })).json;
    expect(applied.changed).toBe(1);
    const kopi = (await me.get('/api/transactions?q=kopi')).json.items[0];
    expect(kopi.category_id).toBe(C('cat_fun_going_out'));
    ids.rule = r.json.id;
  });
  it('la regola nuova vale per le notifiche successive', async () => {
    const r = await capture(deviceUrl, { text: 'Hai pagato Rp28.000 a KOPI KENANGAN', posted_at: '2026-11-14T08:00:00+08:00' });
    const t = await tx(r.json.transaction_id);
    expect(t.category_id).toBe(C('cat_fun_going_out'));
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
      categories: [{ id: 'cat_altro_bar', name: 'Bar e caffè', parent_id: 'cat_altro_food', kind: 'expense' }, { id: 'cat_altro_food', name: 'Cibo e bevande', parent_id: null, kind: 'expense' }],
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
    expect(cats.filter((c: any) => c.name === 'Bar e caffè').length).toBe(1);
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
    expect((await bob.get('/api/transactions/tx_ospite_vecchio')).status).toBe(404);
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

describe('categorie versione 2', () => {
  it('un account con le categorie vecchie si aggiorna da solo senza perdere nulla', async () => {
    const c = new Client('10.40.0.1');
    c.cookie = `ledgy_session=${OLD.v1Session}`;
    const b = (await c.get('/api/bootstrap')).json;
    const byId = new Map(b.categories.map((x: any) => [x.id, x]));
    expect(byId.has('cat_life~usr_v1')).toBe(false);
    expect(byId.has('cat_life_streaming~usr_v1')).toBe(false);
    expect((byId.get('cat_subs_streaming~usr_v1') as any).name).toBe('Streaming video e musica');
    expect((byId.get('cat_food_restaurant~usr_v1') as any).name).toBe('Ristoranti');
    expect((byId.get('cat_food_bar~usr_v1') as any).name).toBe('Bar e caffè'); // aggiornamento 1 → 2: i nomi predefiniti si sovrascrivono
    expect((byId.get('cat_mia_v1') as any).name).toBe('Concerti'); // quelle create dall'utente restano
    expect((byId.get('cat_mia_v1') as any).parent_id).toBe('cat_fun~usr_v1');
    expect(byId.has('cat_family~usr_v1')).toBe(false); // gruppo facoltativo: spento
    const t = (await c.get('/api/transactions/tx_v1')).json;
    expect(t.category_id).toBe('cat_subs_streaming~usr_v1');
    const rule = (await c.get('/api/rules')).json.items.find((r: any) => r.id === 'rule_v1');
    expect(rule.definition.actions.category_id).toBe('cat_subs_streaming~usr_v1');
    // Una seconda volta non cambia nulla.
    expect((await c.get('/api/bootstrap')).json.categories.length).toBe(b.categories.length);
  });
  it('un account con TUTTE le categorie vecchie diventa uguale a uno nuovo, senza perdere una spesa', async () => {
    const c = new Client('10.40.0.3');
    c.cookie = `ledgy_session=${OLD.v1FullSession}`;
    const fresh = new Client('10.40.0.4');
    await fresh.post('/api/guest');
    const base = (id: string) => id.split('~')[0];
    const shape = async (x: Client) => (await x.get('/api/categories')).json.items
      .map((k: any) => `${base(k.id)}|${k.parent_id ? base(k.parent_id) : ''}|${k.name}|${k.archived}`).sort();
    expect((await c.get('/api/bootstrap')).status).toBe(200);
    // Stesse categorie, stessi nomi e stessi gruppi spenti di un account appena creato.
    const [got, want] = [await shape(c), await shape(fresh)];
    expect(got).toEqual(want);
    // Le categorie tolte non ci sono più.
    const ids = new Set((await c.get('/api/categories')).json.items.map((k: any) => base(k.id)));
    for (const old of ['cat_life', 'cat_comm', 'cat_shop_online', 'cat_shop_pharmacy', 'cat_invest_savings']) expect(ids.has(old)).toBe(false);
    // Ogni spesa c'è ancora e punta a una categoria esistente e accesa.
    const items = (await c.get('/api/transactions?limit=500')).json.items;
    expect(items.length).toBe(V1_CATEGORIES.length);
    const on = new Set((await c.get('/api/bootstrap')).json.categories.map((k: any) => k.id));
    expect(items.filter((t: any) => !on.has(t.category_id))).toEqual([]);
    // Esempi di spostamento.
    const byMerchant = new Map(items.map((t: any) => [t.merchant, base(t.category_id)]));
    const at = (oldId: string) => byMerchant.get(`Spesa ${V1_CATEGORIES.findIndex((k) => k.id === oldId)}`);
    expect(at('cat_life_streaming')).toBe('cat_subs_streaming');
    expect(at('cat_comm_phone')).toBe('cat_subs_phone');
    expect(at('cat_shop_pharmacy')).toBe('cat_health_pharmacy');
    expect(at('cat_food_restaurant')).toBe('cat_food_restaurant');
    expect(at('cat_income_salary')).toBe('cat_income_salary');
    // La regola di allora punta alla categoria nuova, e le statistiche funzionano.
    const rule = (await c.get('/api/rules')).json.items.find((r: any) => r.name === 'Telefono');
    expect(base(rule.definition.actions.category_id)).toBe('cat_subs_phone');
    expect((await c.get('/api/stats?from=2026-11-01&to=2026-12-01')).json.count).toBe(V1_CATEGORIES.length);
    // La cattura usa le categorie nuove.
    const phone = await newDevice(c);
    const r = await c.post(phone, { text: 'Paid 15.99 USD to Netflix' });
    expect(base((await c.get(`/api/transactions/${r.json.transaction_id}`)).json.category_id)).toBe('cat_subs_streaming');
  });
  it('un account nuovo ha già le categorie nuove, con i gruppi facoltativi spenti', async () => {
    const own: Record<string, string> = {};
    const g = await newGuest('10.40.0.2');
    await loadOwn(g, own);
    expect(own.cat_subs_dating && own.cat_work_ai && own.cat_income_crypto && own.cat_health_surgery).toBeTruthy();
    expect(own.cat_family).toBeUndefined();
    expect(own.cat_life).toBeUndefined();
  });
});

describe('cattura che impara', () => {
  const c = new Client('10.41.0.1');
  const own: Record<string, string> = {};
  let phone = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    await loadOwn(c, own);
    phone = await newDevice(c);
  });
  it('"50 AED restaurant" ha negozio e categoria, senza passare da "da rivedere"', async () => {
    const r = await c.post(phone, { title: 'ntfy.sh/23-usd-reload', text: 'ntfy.sh/23-usd-reload\n\n50 AED restaurant', amount: '50', currency: 'AED', merchant: '' });
    const t = (await c.get(`/api/transactions/${r.json.transaction_id}`)).json;
    expect(r.json.status).toBe('created');
    expect(t).toMatchObject({ merchant: 'restaurant', category_id: own.cat_food_restaurant, status: 'confirmed' });
  });
  it('le parole chiave funzionano in altre lingue e con le marche', async () => {
    for (const [text, cat] of [['Paid 15.99 USD to Netflix', 'cat_subs_streaming'], ['Pagaste 12 EUR en Restaurante Casa Pepe', 'cat_food_restaurant'], ['Payment 20 USD Claude.ai subscription', 'cat_work_ai']]) {
      const r = await c.post(phone, { text });
      expect((await c.get(`/api/transactions/${r.json.transaction_id}`)).json.category_id).toBe(own[cat]);
    }
  });
  it('dopo una correzione la spesa successiva dello stesso negozio va nella categoria corretta', async () => {
    const first = (await c.get('/api/transactions?merchant=restaurant')).json.items[0];
    const put = await c.put(`/api/transactions/${first.id}`, { category_id: own.cat_food_fastfood });
    expect(put.json).toMatchObject({ ok: true, others: 0, merchant: 'restaurant' });
    const r = await c.post(phone, { text: '30 AED restaurant' });
    expect((await c.get(`/api/transactions/${r.json.transaction_id}`)).json.category_id).toBe(own.cat_food_fastfood);
  });
  it('si può applicare la correzione a tutte le spese dello stesso negozio', async () => {
    const items = (await c.get('/api/transactions?merchant=restaurant')).json.items;
    const put = await c.put(`/api/transactions/${items[0].id}`, { category_id: own.cat_food_restaurant });
    expect(put.json.others).toBe(1);
    expect((await c.post('/api/transactions/recategorize', { merchant: 'Restaurant', category_id: own.cat_food_restaurant })).json.changed).toBe(1);
    const after = (await c.get('/api/transactions?merchant=restaurant')).json.items;
    expect(after.every((t: any) => t.category_id === own.cat_food_restaurant)).toBe(true);
  });
});

describe('gestione categorie, preferiti, impostazioni', () => {
  const c = new Client('10.42.0.1');
  const own: Record<string, string> = {};
  beforeAll(async () => {
    await c.post('/api/guest');
    await loadOwn(c, own);
  });
  it('elenca anche le categorie spente e si accende un gruppo con tutte le sottocategorie', async () => {
    const all = (await c.get('/api/categories')).json.items;
    const family = all.find((x: any) => x.id === `cat_family~${own.cat_food.split('~')[1]}`);
    expect(family.archived).toBe(1);
    expect((await c.post(`/api/categories/${family.id}/enabled`, { enabled: true })).status).toBe(200);
    const boot = (await c.get('/api/bootstrap')).json.categories;
    expect(boot.filter((x: any) => x.id === family.id || x.parent_id === family.id).length).toBe(4);
    await c.post(`/api/categories/${family.id}/enabled`, { enabled: false });
    expect((await c.get('/api/bootstrap')).json.categories.some((x: any) => x.parent_id === family.id)).toBe(false);
  });
  it('elimina un gruppo spostando movimenti e regole nella categoria scelta', async () => {
    const t = (await c.post('/api/transactions', { amount: 9, currency: 'EUR', merchant: 'Spotify', category_id: own.cat_subs_streaming })).json.id;
    const rule = (await c.post('/api/rules', { name: 'Musica', definition: { conditions: [{ field: 'merchant', op: 'contains', value: 'spotify' }], actions: { category_id: own.cat_subs_streaming }, bands: [{ min: 1, actions: { ask: [own.cat_subs_streaming, own.cat_subs_games, own.cat_fun_events] } }] } })).json.id;
    expect((await c.del(`/api/categories/${own.cat_subs}?into=${own.cat_subs_streaming}`)).status).toBe(400);
    expect((await c.del(`/api/categories/${own.cat_subs}?into=${own.cat_fun_events}`)).status).toBe(200);
    expect((await c.get(`/api/transactions/${t}`)).json.category_id).toBe(own.cat_fun_events);
    const def = (await c.get('/api/rules')).json.items.find((r: any) => r.id === rule).definition;
    expect(def.actions.category_id).toBe(own.cat_fun_events);
    expect(def.bands[0].actions.ask).toBeUndefined(); // restava una sola scelta: niente più "chiedimi"
    const boot = (await c.get('/api/bootstrap')).json.categories;
    expect(boot.some((x: any) => x.id === own.cat_subs || x.parent_id === own.cat_subs)).toBe(false);
  });
  it('elimina una sottocategoria lasciando i movimenti senza categoria se non se ne sceglie una', async () => {
    const t = (await c.post('/api/transactions', { amount: 3, currency: 'EUR', merchant: 'Edicola', category_id: own.cat_shop_hobby })).json.id;
    expect((await c.del(`/api/categories/${own.cat_shop_hobby}`)).status).toBe(200);
    expect((await c.get(`/api/transactions/${t}`)).json.category_id).toBeNull();
    expect((await c.del(`/api/categories/${own.cat_shop_hobby}`)).status).toBe(400);
  });
  it('salva, elenca e toglie i preferiti', async () => {
    expect((await c.post('/api/favorites', { type: 'income', amount: 0, currency: 'EUR' })).status).toBe(400);
    const id = (await c.post('/api/favorites', { name: 'Stipendio', type: 'income', amount: 2500, currency: 'EUR', category_id: own.cat_income_salary, note: 'mensile' })).json.id;
    await c.post('/api/favorites', { merchant: 'Caffè', amount: 35000, currency: 'IDR', category_id: own.cat_food_bar });
    const items = (await c.get('/api/favorites')).json.items;
    expect(items.map((f: any) => f.name)).toEqual(['Stipendio', 'Caffè']);
    expect(items[0]).toMatchObject({ type: 'income', amount: 2500, note: 'mensile' });
    await c.del(`/api/favorites/${id}`);
    expect((await c.get('/api/favorites')).json.items.length).toBe(1);
  });
  it('i preferiti di un account non si vedono da un altro', async () => {
    const other = new Client('10.42.0.3');
    await other.post('/api/guest');
    expect((await other.get('/api/favorites')).json.items).toEqual([]);
  });
  it('valuta di visualizzazione e tema si salvano e finiscono nel backup', async () => {
    expect((await c.put('/api/settings', { display_currency: 'XYZ' })).status).toBe(400);
    expect((await c.put('/api/settings', { theme: 'rosa' })).status).toBe(400);
    expect((await c.put('/api/settings', { display_currency: 'AED', theme: 'blue' })).status).toBe(200);
    expect((await c.get('/api/bootstrap')).json.settings).toMatchObject({ display_currency: 'AED', theme: 'blue' });
    const settings = (await c.get('/api/backup/export?table=settings')).json.rows;
    expect(settings).toEqual(expect.arrayContaining([{ key: 'display_currency', value: 'AED' }, { key: 'theme', value: 'blue' }]));
    expect((await c.get('/api/backup/export?table=favorites')).json.rows.length).toBe(1);
  });
  it('il backup con i preferiti si reimporta in un altro account', async () => {
    const b = await exportAll(c);
    b.tables.favorites = (await c.get('/api/backup/export?table=favorites')).json.rows;
    const d = new Client('10.42.0.4');
    await d.post('/api/guest');
    expect((await importAll(d, b, 'replace')).status).toBe(200);
    const fav = (await d.get('/api/favorites')).json.items;
    expect(fav.map((f: any) => f.name)).toEqual(['Caffè']);
    const dOwn: Record<string, string> = {};
    await loadOwn(d, dOwn);
    expect((await d.get('/api/bootstrap')).json.settings.display_currency).toBe('AED');
    expect((await c.get('/api/favorites')).json.items.length).toBe(1); // l'originale resta dov'è
  });
});

describe('carta o banca e conti in altre valute', () => {
  const c = new Client('10.43.0.1');
  const own: Record<string, string> = {};
  let phone = '';
  let wise = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    await loadOwn(c, own);
    phone = await newDevice(c);
    wise = (await c.post('/api/accounts', { name: 'Carta cripto', currency: 'USD' })).json.id;
  });
  it('"Card payment | Cashback" è una spesa, non un’entrata (notifica reale)', async () => {
    const r = await c.post(phone, { title: 'Card payment', text: '16,200.00 IDR | Grab* A-A3BLGUWWWGKVAV | Card payment | Cashback: +$0.04' });
    const t = (await c.get(`/api/transactions/${r.json.transaction_id}`)).json;
    expect(t).toMatchObject({ type: 'expense', amount: -16200000, currency: 'IDR', merchant: 'Grab', category_id: own.cat_transport_taxi });
  });
  it('scrivendo la carta una volta, Ledgy la ricorda per le notifiche con lo stesso titolo (e il conto)', async () => {
    const first = (await c.get('/api/transactions?merchant=Grab')).json.items[0];
    const put = await c.put(`/api/transactions/${first.id}`, { card: 'Carta cripto', account_id: wise });
    expect(put.json.source).toMatchObject({ card: 'Carta cripto', applied: 1 });
    const r = await c.post(phone, { title: 'Card payment', text: '45,000.00 IDR | KOPI KENANGAN | Card payment | Cashback: +$0.10' });
    const t = (await c.get(`/api/transactions/${r.json.transaction_id}`)).json;
    expect(t).toMatchObject({ card: 'Carta cripto', account_id: wise, type: 'expense' });
    // Un'altra fonte non prende la carta.
    const other = await c.post(phone, { title: 'Revolut', text: 'Hai pagato Rp20.000 a Warung' });
    expect((await c.get(`/api/transactions/${other.json.transaction_id}`)).json.card).toBe('Revolut');
  });
  it('il saldo di un conto in dollari conta anche le spese in rupie', async () => {
    const acc = (await c.get('/api/bootstrap')).json.accounts.find((a: any) => a.id === wise);
    // Grab 16.200 + Kopi 45.000 = 61.200 IDR = 3,06 € = 3,40 USD (tassi fissi dei test: IDR 0.00005, USD 0.9)
    expect(acc.balance).toBe(-3400);
  });
  it('cambia la valuta di un conto senza chiuderlo, convertendo il saldo iniziale', async () => {
    await c.put(`/api/accounts/${own.acc_cash}`, { initial_balance: 90 });
    const r = await c.put(`/api/accounts/${own.acc_cash}`, { currency: 'USD' });
    expect(r.json).toMatchObject({ currency: 'USD', initial_balance: 100000 });
    const acc = (await c.get('/api/bootstrap')).json.accounts.find((a: any) => a.id === own.acc_cash);
    expect(acc.currency).toBe('USD');
    expect((await c.put(`/api/accounts/${own.acc_cash}`, { currency: 'EURO' })).status).toBe(400);
    expect((await c.put(`/api/accounts/${own.acc_cash}`, { name: '  ' })).status).toBe(400);
  });
  it('un’entrata registrata per errore diventa una spesa, con il segno giusto e senza la categoria di entrata', async () => {
    const t = (await c.post('/api/transactions', { type: 'income', amount: 52900, currency: 'IDR', merchant: 'Grab', category_id: own.cat_income_refund })).json.id;
    expect((await c.put(`/api/transactions/${t}`, { type: 'expense', category_id: null })).status).toBe(200);
    const after = (await c.get(`/api/transactions/${t}`)).json;
    expect(after).toMatchObject({ type: 'expense', amount: -52900000, category_id: null });
    expect(after.amount_eur).toBeLessThan(0);
  });
  it('una notifica letta da un lettore per banca prende il nome del lettore come carta', async () => {
    const pattern = '(?<amount>[\\d.,]+) (?<currency>[A-Z]{3})\\W+(?<merchant>.+?)\\W+Card payment';
    expect((await c.post('/api/capture/parsers', { name: 'Xplace', app: 'Pagamento Xplace', pattern })).status).toBe(201);
    const r = await c.post(phone, { title: 'Pagamento Xplace', text: '52.50 EUR | GENKI* GT-652379 | Card payment | Cashback: +$2.35' });
    const t = (await c.get(`/api/transactions/${r.json.transaction_id}`)).json;
    expect(t).toMatchObject({ card: 'Xplace', type: 'expense', merchant: 'Genki', category_id: own.cat_health_insurance });
    expect(t.capture.detail).toContain('lettore: Xplace');
  });
  it('le carte riconosciute finiscono nel backup', async () => {
    const rows = (await c.get('/api/backup/export?table=capture_sources')).json.rows;
    expect(rows).toEqual([expect.objectContaining({ key: 'card payment', card: 'Carta cripto', account_id: wise })]);
  });
});

describe('lettore creato da una notifica arrivata', () => {
  const c = new Client('10.44.0.1');
  let phone = '';
  let txId = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    phone = await newDevice(c);
  });
  it('dalla notifica arriva il modello proposto, il lettore dà la carta anche alle spese già arrivate', async () => {
    const text = '52,900.00 IDR | Grab* A-A3D4M24GXEQSAV | Card payment | Cashback: +$0.12';
    txId = (await c.post(phone, { title: '💳 Card payment', text })).json.transaction_id;
    expect((await c.get(`/api/transactions/${txId}`)).json.card).toBeNull();
    const pattern = suggestPattern(text)!;
    expect((await c.post('/api/capture/parsers/test', { pattern, text })).json.parsed).toMatchObject({ amount: 52900, currency: 'IDR', merchant: 'Grab* A-A3D4M24GXEQSAV' });
    const r = await c.post('/api/capture/parsers', { name: ' Xplace ', app: 'Card payment', pattern, sample: text });
    expect(r.json.applied).toBe(1);
    expect((await c.get(`/api/transactions/${txId}`)).json.card).toBe('Xplace');
    const next = await c.post(phone, { title: '💳 Card payment', text: '52.50 EUR | GENKI* GT-652379 | Card payment | Cashback: +$2.35' });
    expect((await c.get(`/api/transactions/${next.json.transaction_id}`)).json).toMatchObject({ card: 'Xplace', merchant: 'Genki', type: 'expense' });
  });
  it('rinominare il lettore rinomina la carta sulle spese', async () => {
    const id = (await c.get('/api/capture/parsers')).json.items[0].id;
    await c.put(`/api/capture/parsers/${id}`, { name: 'Xplace Visa' });
    expect((await c.get(`/api/transactions/${txId}`)).json.card).toBe('Xplace Visa');
  });
});

describe('carte e banche', () => {
  const c = new Client('10.45.0.1');
  let phone = '';
  let rev = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    phone = await newDevice(c);
  });
  it('si sceglie la carta direttamente dalla notifica e vale per tutte quelle con lo stesso titolo', async () => {
    const first = await c.post(phone, { title: '💳 Card payment', text: '52,900.00 IDR | Grab* A-A3D4M24GXEQSAV | Card payment | Cashback: +$0.12' });
    await c.post(phone, { title: '💳 Card payment', text: '52.50 EUR | GENKI* GT-652379 | Card payment | Cashback: +$2.35' });
    rev = (await c.post(phone, { title: 'Revolut', text: 'Hai pagato 3,00 € a Caffè Bali' })).json.transaction_id;
    expect((await c.post(`/api/capture/captures/${first.json.capture_id}/card`, { card: 'Xplace' })).json).toMatchObject({ card: 'Xplace', applied: 2 });
    const list = (await c.get('/api/capture/captures')).json.items;
    expect(list.filter((x: any) => x.card === 'Xplace').length).toBe(2);
    const next = await c.post(phone, { title: '💳 Card payment', text: '16,200.00 IDR | Grab* A-B | Card payment | Cashback: +$0.04' });
    expect((await c.get(`/api/transactions/${next.json.transaction_id}`)).json.card).toBe('Xplace');
    expect((await c.get(`/api/transactions/${rev}`)).json.card).toBe('Revolut');
  });
  it('cambiare solo il conto di una spesa catturata non toglie la carta', async () => {
    const acc = (await c.post('/api/accounts', { name: 'Revolut EUR', currency: 'EUR' })).json.id;
    await c.put(`/api/transactions/${rev}`, { account_id: acc });
    expect((await c.get(`/api/transactions/${rev}`)).json).toMatchObject({ card: 'Revolut', account_id: acc });
  });
  it('la pagina Carte elenca le carte con le spese del mese e le fonti', async () => {
    const items = (await c.get('/api/cards')).json.items;
    const x = items.find((i: any) => i.name === 'Xplace');
    expect(x).toMatchObject({ count: 3 });
    expect(x.sources).toEqual(['💳 card payment']);
    expect(items.map((i: any) => i.name)).toContain('Revolut');
  });
  it('la spesa per carta divide lo stesso totale, non si somma', async () => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
    const to = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString().slice(0, 10);
    await c.post('/api/transactions', { amount: 4, currency: 'EUR', merchant: 'Mercato' });
    const s = (await c.get(`/api/stats?from=${from}&to=${to}`)).json;
    const sum = s.by_card.reduce((a: number, x: any) => a + x.total, 0);
    expect(sum).toBe(s.spent);
    expect(s.by_card.find((x: any) => x.card === null).total).toBe(4000);
    expect(s.by_card.find((x: any) => x.card === 'Revolut').total).toBe(3000);
  });
  it('rinomina e toglie una carta ovunque', async () => {
    expect((await c.post('/api/cards/rename', { from: 'Xplace', to: 'Xplace Visa' })).json.changed).toBe(3);
    const r = await c.post(phone, { title: '💳 Card payment', text: '10,000.00 IDR | Warung | Card payment | Cashback: +$0.01' });
    expect((await c.get(`/api/transactions/${r.json.transaction_id}`)).json.card).toBe('Xplace Visa');
    expect((await c.post('/api/cards/rename', { from: 'Revolut', to: '' })).json.changed).toBe(1);
    expect((await c.get(`/api/transactions/${rev}`)).json.card).toBeNull();
  });
});

describe('intelligenza artificiale', () => {
  const c = new Client('10.46.0.1');
  const own: Record<string, string> = {};
  let phone = '';
  const aiStats = async () => (await fetch(`http://127.0.0.1:${AI_PORT}/stats`)).json() as Promise<{ gemini: number; nanogpt: number; geminiSearch: number; nanoOnline: number }>;
  const waitFor = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 40; i++) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 150)); } return false; };
  beforeAll(async () => {
    await c.post('/api/guest');
    await loadOwn(c, own);
    phone = await newDevice(c);
  });
  it('senza chiavi non chiama nessuno e la spesa resta da rivedere', async () => {
    const before = await aiStats();
    const r = await c.post(phone, { title: '💳 Card payment', text: '137,709.00 IDR | Reload Sanctuary Canggu | Card payment | Cashback: +$0.30' });
    expect(r.json.status).toBe('review');
    await new Promise((x) => setTimeout(x, 500));
    expect((await c.get(`/api/transactions/${r.json.transaction_id}`)).json.category_id).toBeNull();
    expect((await aiStats()).gemini).toBe(before.gemini);
    expect((await c.post(`/api/transactions/${r.json.transaction_id}/ai`)).json.error).toContain('Manca una chiave');
  });
  it('le chiavi si salvano ma non tornano mai all’app', async () => {
    expect((await c.put('/api/ai', { gemini_key: 'gemini-ok', gemini_model: 'modello-inventato' })).status).toBe(400);
    expect((await c.put('/api/ai', { gemini_key: 'gemini-ok' })).status).toBe(200);
    const s = (await c.get('/api/ai')).json;
    expect(s).toMatchObject({ enabled: true, gemini: '…i-ok', nanogpt: null });
    expect(JSON.stringify(s)).not.toContain('gemini-ok');
    expect((await c.post('/api/ai/test')).json).toMatchObject({ ok: true, provider: 'gemini' });
    // Le chiavi sono nel backup (scelta del proprietario): passano a un'altra installazione o account.
    const rows = (await c.get('/api/backup/export?table=settings')).json.rows;
    expect(JSON.stringify(rows)).toContain('gemini-ok');
    const d = new Client('10.46.0.9');
    await d.post('/api/guest');
    await d.put('/api/ai', { nanogpt_key: 'nano-mia' });
    await d.post('/api/backup/import/chunk', { mode: 'merge', table: 'settings', rows, maps: {} });
    expect((await d.get('/api/ai')).json).toMatchObject({ gemini: '…i-ok', nanogpt: '…-mia' }); // "aggiungi": riempie solo ciò che manca
    await d.post('/api/backup/import/chunk', { mode: 'replace', table: 'settings', rows, maps: {} });
    expect((await d.get('/api/ai')).json).toMatchObject({ gemini: '…i-ok', nanogpt: '…-mia' });
  });
  it('una spesa senza categoria la riceve dall’AI in background, cercando il negozio sul web', async () => {
    const before = await aiStats();
    const r = await c.post(phone, { title: '💳 Card payment', text: '150,000.00 IDR | Reload Sanctuary Canggu | Card payment | Cashback: +$0.30' });
    expect(r.json.needs_ai).toBeUndefined();
    const ok = await waitFor(async () => (await c.get(`/api/transactions/${r.json.transaction_id}`)).json.category_id === own.cat_care_spa);
    expect(ok).toBe(true);
    const t = (await c.get(`/api/transactions/${r.json.transaction_id}`)).json;
    expect(t.status).toBe('confirmed');
    expect(t.capture.detail).toContain("categoria dall'AI (gemini)");
    const after = await aiStats();
    expect(after.geminiSearch).toBeGreaterThan(before.geminiSearch);
    // La volta dopo basta lo storico: niente AI.
    const again = await c.post(phone, { title: '💳 Card payment', text: '90,000.00 IDR | Reload Sanctuary Canggu | Card payment | Cashback: +$0.10' });
    expect((await c.get(`/api/transactions/${again.json.transaction_id}`)).json.category_id).toBe(own.cat_care_spa);
    expect((await aiStats()).gemini).toBe(after.gemini);
  });
  it('quando Gemini finisce le richieste gratuite passa a NanoGPT (con ricerca) e lo salta per un’ora', async () => {
    await c.put('/api/ai', { gemini_key: 'gemini-esaurita', nanogpt_key: 'nano-ok' });
    const first = (await c.get('/api/transactions?status=review')).json.items.find((x: any) => !x.category_id);
    const before = await aiStats();
    const r = await c.post(`/api/transactions/${first.id}/ai`);
    expect(r.json).toMatchObject({ category_id: own.cat_care_spa, provider: 'nanogpt' });
    const mid = await aiStats();
    expect(mid.gemini - before.gemini).toBe(1);
    expect(mid.nanoOnline - before.nanoOnline).toBe(1);
    expect((await c.get('/api/ai')).json.gemini_paused_until).toBeTruthy();
    await c.post(`/api/transactions/${first.id}/ai`);
    expect((await aiStats()).gemini).toBe(mid.gemini); // Gemini in pausa: non lo richiama
    // Una chiave Gemini nuova toglie la pausa.
    await c.put('/api/ai', { gemini_key: 'gemini-ok' });
    expect((await c.get('/api/ai')).json.gemini_paused_until).toBeNull();
  });
  it('si spegne e una chiave vuota si toglie; eliminando l’ospite spariscono le chiavi', async () => {
    await c.put('/api/ai', { enabled: false });
    expect((await c.post('/api/ai/test')).status).toBe(400);
    await c.put('/api/ai', { enabled: true, nanogpt_key: '' });
    expect((await c.get('/api/ai')).json.nanogpt).toBeNull();
  });
});

describe('regole predefinite per chi viaggia', () => {
  const c = new Client('10.47.0.1');
  const own: Record<string, string> = {};
  let phone = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    await loadOwn(c, own);
    phone = await newDevice(c);
  });
  const cap = async (text: string) => (await c.get(`/api/transactions/${(await c.post(phone, { text })).json.transaction_id}`)).json;
  it('un account nuovo le ha, segnate come morbide', async () => {
    const rules = (await c.get('/api/rules')).json.items;
    const uber = rules.find((r: any) => r.name === 'Uber');
    expect(uber.definition.soft).toBe(true);
    expect(rules.filter((r: any) => r.definition.soft).length).toBeGreaterThan(25);
  });
  it('puliscono i nomi strani e danno la categoria', async () => {
    expect(await cap('You paid 12.50 USD to UBER *TRIP HELP.UBER.COM')).toMatchObject({ merchant: 'Uber', category_id: own.cat_transport_taxi });
    expect(await cap('You paid 8.00 USD to UBER *EATS PENDING')).toMatchObject({ merchant: 'Uber Eats', category_id: own.cat_food_delivery });
    expect(await cap('You paid 9.00 USD to Airalo eSIM')).toMatchObject({ category_id: own.cat_subs_phone });
    expect(await cap('You paid 45.00 USD to SafetyWing')).toMatchObject({ category_id: own.cat_health_insurance });
    expect(await cap('Cash withdrawal 1,000,000 IDR at ATM BCA')).toMatchObject({ category_id: own.cat_fin_atm });
    expect(await cap('You paid 20.00 EUR to AMZN Mktp DE')).toMatchObject({ merchant: 'Amazon', category_id: own.cat_shop_other });
  });
  it('la tua correzione su un negozio vince sulla regola predefinita', async () => {
    const first = await cap('You paid 30.00 USD to UBER *TRIP');
    await c.put(`/api/transactions/${first.id}`, { category_id: own.cat_travel_activities });
    expect((await cap('You paid 25.00 USD to UBER *TRIP')).category_id).toBe(own.cat_travel_activities);
  });
  it('un account esistente riceve le regole nuove una volta sola', async () => {
    const v1 = new Client('10.47.0.2');
    v1.cookie = `ledgy_session=${OLD.v1FullSession}`;
    const names = (await v1.get('/api/rules')).json.items.map((r: any) => r.name);
    expect(names).toContain('Uber');
    expect(names).toContain('Telefono');
    expect(names.filter((n: string) => n === 'Uber').length).toBe(1);
    expect(names).toContain('Nome pulito: Starbucks'); // anche quelle della versione 4
  });
  it('dalla versione 3 alla 4 arrivano solo le regole nuove (quelle tolte non tornano)', async () => {
    const v3 = new Client('10.47.0.3');
    v3.cookie = `ledgy_session=${OLD.v3Session}`;
    await v3.get('/api/bootstrap');
    const names = (await v3.get('/api/rules')).json.items.map((r: any) => r.name);
    expect(names).toContain('Nome pulito: Starbucks');
    expect(names).toContain('Beach club di Bali');
    expect(names).not.toContain('Uber');
    await v3.get('/api/bootstrap');
    expect((await v3.get('/api/rules')).json.items.length).toBe(names.length);
  });
  it('versione 4: nomi puliti delle catene e categorie giuste per le spese tipiche', async () => {
    expect(await cap('You paid 85,000.00 IDR to STARBUCKS 1234 CANGGU')).toMatchObject({ merchant: 'Starbucks', category_id: own.cat_food_bar });
    expect(await cap('You paid 9.99 EUR to AMAZON PRIME*AB12CD')).toMatchObject({ merchant: 'Amazon Prime', category_id: own.cat_subs_shopping });
    expect(await cap('You paid 1,250,000.00 IDR to FINNS BEACH CLUB')).toMatchObject({ category_id: own.cat_fun_going_out });
    expect(await cap('You paid 48,000.00 IDR to MIE GACOAN DENPASAR')).toMatchObject({ merchant: 'Mie Gacoan', category_id: own.cat_food_fastfood });
    expect(await cap('You paid 150,000.00 IDR to SPBU PERTAMINA 54.801')).toMatchObject({ category_id: own.cat_vehicle_fuel });
    expect(await cap('You paid 230,000.00 IDR to Waterbom Bali')).toMatchObject({ category_id: own.cat_fun_activities });
    expect(await cap('You paid 6.50 EUR to Esselunga Milano')).toMatchObject({ merchant: 'Esselunga', category_id: own.cat_food_groceries });
  });
});

describe('Home personalizzabile', () => {
  const c = new Client('10.48.0.1');
  beforeAll(async () => { await c.post('/api/guest'); });
  it('parte con la disposizione predefinita, si cambia e finisce nel backup', async () => {
    expect((await c.get('/api/bootstrap')).json.settings.home_layout).toBeNull();
    expect((await c.put('/api/settings', { home_layout: ['hero', 3] })).status).toBe(400);
    // Schede che non esistono più (lo stato della cattura è passato in Altro) si scartano senza errore.
    expect((await c.put('/api/settings', { home_layout: ['hero', 'capture', 'widget-inventato'] })).status).toBe(200);
    expect((await c.get('/api/bootstrap')).json.settings.home_layout).toEqual(['hero']);
    expect((await c.put('/api/settings', { home_layout: ['hero', 'cashflow', 'recent', 'cashflow'] })).status).toBe(200);
    expect((await c.get('/api/bootstrap')).json.settings.home_layout).toEqual(['hero', 'cashflow', 'recent']);
    const rows = (await c.get('/api/backup/export?table=settings')).json.rows;
    expect(rows).toEqual(expect.arrayContaining([{ key: 'home_layout', value: '["hero","cashflow","recent"]' }]));
    const d = new Client('10.48.0.2');
    await d.post('/api/guest');
    await d.post('/api/backup/import/begin', { mode: 'replace', format: 'ledgy-backup', version: 1 });
    await d.post('/api/backup/import/chunk', { mode: 'replace', table: 'settings', rows, maps: {} });
    expect((await d.get('/api/bootstrap')).json.settings.home_layout).toEqual(['hero', 'cashflow', 'recent']);
    await c.put('/api/settings', { home_layout: null });
    expect((await c.get('/api/bootstrap')).json.settings.home_layout).toBeNull();
  });
});

describe('svuota bilancio', () => {
  const c = new Client('10.49.0.1');
  const other = new Client('10.49.0.2');
  const own: Record<string, string> = {};
  let phone = '';
  beforeAll(async () => {
    await c.post('/api/guest');
    await other.post('/api/guest');
    await loadOwn(c, own);
    phone = await newDevice(c);
    // Un po' di tutto: movimenti, etichette, carta imparata, lettore, preferito, regola, categoria, conto, chiave AI, impostazioni.
    const cap = await c.post(phone, { title: '💳 Card payment', text: '52,900.00 IDR | Grab* A-1 | Card payment | Cashback: +$0.12' });
    await c.post(`/api/capture/captures/${cap.json.capture_id}/card`, { card: 'Xplace' });
    await c.post('/api/transactions', { amount: 5, currency: 'EUR', merchant: 'Caffè', labels: ['Viaggio'] });
    await c.post('/api/transactions', { type: 'income', amount: 900, currency: 'EUR', merchant: 'Stipendio' });
    await c.post('/api/capture/parsers', { name: 'Xplace', app: 'Card payment', pattern: '(?<amount>[\\d.,]+) (?<currency>[A-Z]{3})' });
    await c.post('/api/favorites', { name: 'Caffè', amount: 3, currency: 'EUR' });
    await c.post('/api/rules', { name: 'Mia', definition: { conditions: [{ field: 'merchant', op: 'contains', value: 'xyz' }], actions: { category_id: own.cat_food_bar } } });
    await c.post('/api/categories', { name: 'Mia categoria', kind: 'expense' });
    await c.post('/api/accounts', { name: 'Revolut', currency: 'EUR', initial_balance: 100 });
    await c.put('/api/ai', { gemini_key: 'gemini-ok' });
    await c.put('/api/settings', { display_currency: 'USD', home_layout: ['hero', 'cashflow'] });
    await other.post('/api/transactions', { amount: 7, currency: 'EUR', merchant: 'Di un altro' });
  });
  it('senza conferma non fa nulla', async () => {
    expect((await c.post('/api/account/wipe-transactions', {})).status).toBe(400);
    expect((await c.get('/api/transactions')).json.items.length).toBe(3);
  });
  it('cancella solo i movimenti e le notifiche, tiene tutte le impostazioni', async () => {
    const r = await c.post('/api/account/wipe-transactions', { confirm: 'SVUOTA' });
    expect(r.json).toMatchObject({ ok: true, deleted: 3 });
    expect((await c.get('/api/transactions')).json.items).toEqual([]);
    expect((await c.get('/api/capture/captures')).json.items).toEqual([]);
    const b = (await c.get('/api/bootstrap')).json;
    expect(b.review_count).toBe(0);
    expect(b.categories.some((x: any) => x.name === 'Mia categoria')).toBe(true);
    expect(b.accounts.map((a: any) => a.name).sort()).toEqual(['Contanti', 'Revolut']);
    expect(b.accounts.find((a: any) => a.name === 'Revolut').balance).toBe(100000);
    expect(b.labels.map((l: any) => l.name)).toContain('Viaggio');
    expect(b.settings).toMatchObject({ display_currency: 'USD', home_layout: ['hero', 'cashflow'] });
    expect((await c.get('/api/rules')).json.items.some((x: any) => x.name === 'Mia')).toBe(true);
    expect((await c.get('/api/capture/parsers')).json.items.length).toBe(1);
    expect((await c.get('/api/favorites')).json.items.length).toBe(1);
    expect((await c.get('/api/ai')).json.gemini).toBe('…i-ok');
    expect((await c.get('/api/capture/devices')).json.items.length).toBe(1);
    // Le spese di un altro account non si toccano.
    expect((await other.get('/api/transactions')).json.items.length).toBe(1);
  });
  it('dopo lo svuotamento il telefono e la carta imparata funzionano ancora', async () => {
    const r = await c.post(phone, { title: '💳 Card payment', text: '16,200.00 IDR | Grab* A-2 | Card payment | Cashback: +$0.04' });
    expect((await c.get(`/api/transactions/${r.json.transaction_id}`)).json).toMatchObject({ card: 'Xplace', type: 'expense' });
  });
});

describe('chiavi AI tra ospite e account', () => {
  it('entrando in un account senza chiavi, quelle messe da ospite passano all’account', async () => {
    const acc = new Client('10.50.0.1');
    await acc.post('/api/register', { email: 'ai@example.com', password: 'password-ai-123' });
    const g = new Client('10.50.0.2');
    await g.post('/api/guest');
    await g.put('/api/ai', { gemini_key: 'gemini-ok' });
    expect((await g.post('/api/login', { email: 'ai@example.com', password: 'password-ai-123' })).status).toBe(200);
    expect((await g.get('/api/ai')).json.gemini).toBe('…i-ok');
  });
});

describe('saldo di tutti i conti', () => {
  it('ogni conto ha il controvalore in euro al cambio di oggi, e la somma è il saldo della Home', async () => {
    const c = new Client('10.51.0.1');
    await c.post('/api/guest');
    const usd = (await c.post('/api/accounts', { name: 'Wise USD', currency: 'USD', initial_balance: 100 })).json.id;
    await c.post('/api/transactions', { amount: 30, currency: 'USD', merchant: 'Grab', account_id: usd });
    const accs = (await c.get('/api/bootstrap')).json.accounts as Array<{ id: string; balance: number; balance_eur: number | null; currency: string }>;
    const a = accs.find((x) => x.id === usd)!;
    expect(a.balance).toBe(70_000);
    expect(a.balance_eur).toBe(63_000); // 70 USD × 0,9
    for (const x of accs.filter((x) => x.currency === 'EUR')) expect(x.balance_eur).toBe(x.balance);
  });
});

describe('pulizia notturna', () => {
  const withSession = (token: string) => { const c = new Client('10.30.0.1'); c.cookie = `ledgy_session=${token}`; return c; };
  const ping = (token: string) => new Client('10.30.0.2').post(`/api/in/${token}/ping`, {});
  it('toglie gli ospiti vuoti da una settimana e quelli che nessuno può più aprire, non gli altri', async () => {
    const empty = withSession(OLD.emptyGuestSession);
    const full = withSession(OLD.fullGuestSession);
    expect((await empty.get('/api/me')).status).toBe(200);
    expect((await full.get('/api/me')).status).toBe(200);
    expect((await ping(OLD.abandonedGuestPhone)).status).toBe(200);
    expect((await ping(OLD.registeredPhone)).status).toBe(200);
    const fresh = await newGuest('10.30.0.3');
    expect((await fetch(`${BASE}/__scheduled?cron=0+1+*+*+*`)).status).toBe(200);
    expect((await empty.get('/api/me')).status).toBe(401);
    expect((await full.get('/api/me')).status).toBe(200);
    expect(await count(full)).toBe(1);
    expect((await ping(OLD.abandonedGuestPhone)).status).toBe(401);
    expect((await ping(OLD.registeredPhone)).status).toBe(200);
    expect((await fresh.get('/api/me')).status).toBe(200);
    expect((await new Client('10.30.0.4').post('/api/login', { email: EMAIL, password: 'recuperata-con-il-codice-789' })).status).toBe(200);
  });
});
