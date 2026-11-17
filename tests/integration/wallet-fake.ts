// Wallet by BudgetBakers finto, con la forma dell'API ufficiale (rest.budgetbakers.com/wallet, OpenAPI v2).
// Chiavi: "wallet-ok"; "wallet-sync" (prima sincronizzazione: 409); "wallet-lento" (la prima pagina risponde 429); altre: 401.
import type { IncomingMessage, ServerResponse } from 'node:http';

export const WALLET = {
  accounts: [
    { id: 'wa-revolut', name: 'Revolut EUR', accountType: 'CurrentAccount', currencyCode: 'EUR', archived: false, balance: { currentBalance: 1234.5, currencyCode: 'EUR' } },
    { id: 'wa-cash', name: 'Contanti IDR', accountType: 'Cash', currencyCode: 'IDR', archived: false, balance: { currentBalance: 500000, currencyCode: 'IDR' } },
  ],
  categories: [
    { id: 'wc-groc', name: 'Groceries', group: { id: 'food_and_drinks', name: 'Food & Drinks' } },
    { id: 'wc-rest', name: 'Restaurant, fast-food', group: { id: 'food_and_drinks', name: 'Food & Drinks' } },
    { id: 'wc-gift', name: 'Gifts, joy', group: { id: 'shopping', name: 'Shopping' } },
    { id: 'wc-wage', name: 'Wage, invoices', group: { id: 'income', name: 'Income' } },
    { id: 'wc-warung', name: 'Warung', parentName: 'Restaurant, fast-food', customCategory: true, group: { id: 'food_and_drinks', name: 'Food & Drinks' } },
    { id: 'wc-strana', name: 'Zzz senza nome', customCategory: true, group: { id: 'transportation', name: 'Transportation' } },
  ],
  labels: [{ id: 'wl-bkk', name: 'Viaggio Bangkok' }, { id: 'wl-old', name: 'Vecchia', archived: true }],
  records: [] as Array<Record<string, unknown>>,
};

const cat = (id: string) => {
  const c = WALLET.categories.find((x) => x.id === id)!;
  return { id: c.id, name: c.name, group: c.group };
};
// 240 spese nel supermercato dal 2024 a oggi, più casi particolari: 252 movimenti, 250 da importare.
for (let i = 0; i < 240; i++) {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 3 * 86400_000);
  WALLET.records.push({ id: `wr-${i}`, accountId: 'wa-revolut', amount: { value: -(10 + (i % 7)), currencyCode: 'EUR' }, recordDate: d.toISOString(),
    recordType: 'expense', recordState: 'cleared', category: cat('wc-groc'), counterParty: i % 2 ? 'Pepito Canggu' : 'Carrefour', note: null, labels: [] });
}
WALLET.records.push(
  { id: 'wr-idr', accountId: 'wa-cash', amount: { value: -150000, currencyCode: 'IDR' }, convertedAmount: { value: -8.7, currencyCode: 'EUR', ratio: 0.000058 },
    recordDate: '2026-10-05T04:30:00Z', recordType: 'expense', category: cat('wc-warung'), counterParty: 'Warung Made', note: 'pranzo', labels: [] },
  { id: 'wr-wage', accountId: 'wa-revolut', amount: { value: 2500, currencyCode: 'EUR' }, recordDate: '2026-10-01T09:00:00Z', recordType: 'income', category: cat('wc-wage'), counterParty: 'Cliente SRL', labels: [] },
  { id: 'wr-gift', accountId: 'wa-revolut', amount: { value: -40, currencyCode: 'EUR' }, recordDate: '2026-10-02T09:00:00Z', recordType: 'expense', category: cat('wc-gift'), counterParty: 'Fiorista', labels: [] },
  { id: 'wr-bkk', accountId: 'wa-revolut', amount: { value: -25, currencyCode: 'EUR' }, recordDate: '2026-10-03T12:00:00Z', recordType: 'expense', category: cat('wc-rest'),
    counterParty: 'Som Tam Nua', labels: [{ id: 'wl-bkk', name: 'Viaggio Bangkok' }], place: { name: 'Siam Square', latitude: 13.74, longitude: 100.53 } },
  { id: 'wr-strana', accountId: 'wa-revolut', amount: { value: -3, currencyCode: 'EUR' }, recordDate: '2026-10-04T12:00:00Z', recordType: 'expense', category: cat('wc-strana'), counterParty: 'Boh' },
  { id: 'wr-tr-out', accountId: 'wa-revolut', amount: { value: -100, currencyCode: 'EUR' }, recordDate: '2026-10-06T08:00:00Z', recordType: 'expense',
    transfer: { transferId: 'wt-1', type: 'paired' }, counterParty: null },
  { id: 'wr-tr-in', accountId: 'wa-cash', amount: { value: 1720000, currencyCode: 'IDR' }, convertedAmount: { value: 100, currencyCode: 'EUR' }, recordDate: '2026-10-06T08:00:00Z',
    recordType: 'income', transfer: { transferId: 'wt-1', type: 'paired' }, counterParty: null },
  { id: 'wr-void', accountId: 'wa-revolut', amount: { value: -999, currencyCode: 'EUR' }, recordDate: '2026-10-07T08:00:00Z', recordType: 'expense', recordState: 'void', category: cat('wc-rest') },
  { id: 'wr-recent', accountId: 'wa-revolut', amount: { value: -12, currencyCode: 'EUR' }, recordDate: new Date(Date.now() - 2 * 86400_000).toISOString(), recordType: 'expense',
    category: cat('wc-rest'), counterParty: 'Recente' },
);
WALLET.records.sort((a, b) => String(a.recordDate).localeCompare(String(b.recordDate)));

let slowHits = 0;
export const walletCalls = { records: 0, total: 0 };

export function walletFake(req: IncomingMessage, res: ServerResponse) {
  const send = (status: number, obj: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(obj)); };
  walletCalls.total++;
  const auth = String(req.headers.authorization ?? '');
  if (auth === 'Bearer wallet-sync') return send(409, { error: 'initial sync in progress' });
  if (auth !== 'Bearer wallet-ok' && auth !== 'Bearer wallet-lento') return send(401, { error: 'unauthorized' });
  const url = new URL(req.url ?? '/', 'http://x');
  const path = url.pathname.replace(/^\/wallet\/v1\/api/, '');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 30), 200);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const pageOf = <T>(items: T[], key: string) => {
    const slice = items.slice(offset, offset + limit);
    return send(200, { [key]: slice, limit, offset, ...(offset + limit < items.length ? { nextOffset: offset + limit } : {}),
      ...(url.searchParams.get('withTotal') === 'true' ? { total: items.length } : {}) });
  };
  if (path === '/accounts') return pageOf(WALLET.accounts, 'accounts');
  if (path === '/categories') return pageOf(WALLET.categories, 'categories');
  if (path === '/labels') return pageOf(WALLET.labels, 'labels');
  if (path === '/records') {
    walletCalls.records++;
    if (auth === 'Bearer wallet-lento' && offset > 0 && slowHits++ === 0) return send(429, { error: 'rate limit' }, { 'Retry-After': '1' });
    const filters = url.searchParams.getAll('recordDate');
    // Come l'API vera: senza filtro sulla data solo gli ultimi 3 mesi.
    const conds = filters.length ? filters : [`gte.${new Date(Date.now() - 92 * 86400_000).toISOString()}`];
    let items = WALLET.records.filter((r) => conds.every((f) => {
      const [op, v] = [f.slice(0, f.indexOf('.')), f.slice(f.indexOf('.') + 1)];
      const d = String(r.recordDate);
      return op === 'gte' ? d >= v : op === 'lt' ? d < v : op === 'lte' ? d <= v : op === 'gt' ? d > v : true;
    }));
    if ((url.searchParams.get('sortBy') ?? '-recordDate') === '-recordDate') items = [...items].reverse();
    return pageOf(items, 'records');
  }
  return send(404, { error: 'not found' });
}
