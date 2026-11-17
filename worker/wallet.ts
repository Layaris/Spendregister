// Import da Wallet by BudgetBakers con l'API REST ufficiale (serve Wallet Premium).
// La chiave arriva dal browser a ogni richiesta e va solo a Wallet: non si salva e non si scrive nei log.
// Wallet non accetta chiamate dirette dal browser (niente CORS), per questo passa da qui.
// Tutto lavora a pagine guidate dal browser (limite di CPU): prepara → crea conti → pagine di movimenti → allinea saldi.
import { Hono } from 'hono';
import { zonedIso } from '../shared/time';
import {
  skipWalletRecord, walletAmounts, walletCategoryCandidates,
  type WalletAccount, type WalletCategory, type WalletLabel, type WalletRecord,
} from '../shared/wallet';
import { getEurRate } from './fx';
import { bad, body, getTimeZone, HttpError, newId, nowIso, uid, type AppContext, type AppEnv, type Env } from './lib';
import { seedId } from './seed';
import { convertToEur } from './transactions';
import { accountBalance } from './catalog';

export const walletApi = new Hono<AppEnv>();

const DEFAULT_API = 'https://rest.budgetbakers.com/wallet/v1/api';
const PAGE = 100;
/** Inizio della storia: senza un limite Wallet restituisce solo gli ultimi 3 mesi. */
const SINCE = '1990-01-01';

class RetryLater extends Error {
  constructor(public seconds: number) { super('limite'); }
}

function checkToken(t: unknown): string {
  if (typeof t !== 'string' || t.trim().length < 8 || t.length > 4000) bad('Incolla la chiave di Wallet (REST API)');
  return t.trim();
}

async function wallet<T>(env: Env, token: string, path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${env.WALLET_API ?? DEFAULT_API}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.append(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (res.ok) return (await res.json()) as T;
  if (res.status === 429) throw new RetryLater(Math.min(Number(res.headers.get('Retry-After')) || 60, 3600));
  if (res.status === 401 || res.status === 404) throw new HttpError(400, 'La chiave di Wallet non è valida o è scaduta: creane una nuova su web.budgetbakers.com, Impostazioni › REST API.');
  if (res.status === 403) throw new HttpError(400, 'Wallet non dà accesso con questa chiave: l’API è solo per Wallet Premium.');
  if (res.status === 409) throw new HttpError(503, 'Wallet sta ancora preparando i tuoi dati (prima volta con la chiave): riprova tra qualche minuto.');
  throw new HttpError(502, `Wallet non risponde come previsto (codice ${res.status}). Riprova più tardi.`);
}

/** Tutte le pagine di una lista breve (conti, categorie, etichette). */
async function all<T>(env: Env, token: string, path: string, key: string): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (let i = 0; i < 10; i++) {
    const r = await wallet<Record<string, unknown> & { nextOffset?: number }>(env, token, path, { limit: 200, offset });
    out.push(...((r[key] as T[]) ?? []));
    if (r.nextOffset == null) break;
    offset = r.nextOffset;
  }
  return out;
}

const range = (before?: string | null) => (before && /^\d{4}-\d{2}-\d{2}$/.test(before) ? [`gte.${SINCE}`, `lt.${before}`] : [`gte.${SINCE}`]);

async function records(env: Env, token: string, extra: Record<string, string | number>, before?: string | null) {
  const url = new URL(`${env.WALLET_API ?? DEFAULT_API}/records`);
  for (const [k, v] of Object.entries(extra)) url.searchParams.append(k, String(v));
  for (const f of range(before)) url.searchParams.append('recordDate', f);
  return wallet<{ records?: WalletRecord[]; nextOffset?: number; total?: number }>(env, token, `/records${url.search}`);
}

const fail = (c: AppContext, e: unknown) => {
  if (e instanceof RetryLater) return c.json({ retry_after: e.seconds });
  throw e;
};

/** 1. Legge conti, categorie, etichette e quanti movimenti ci sono; propone dove mettere ognuno. */
walletApi.post('/prepare', async (c) => {
  const b = await body<{ token?: string }>(c);
  const token = checkToken(b.token);
  const db = c.env.DB;
  const u = uid(c);
  try {
    const [accounts, categories, labels, count, oldest] = await Promise.all([
      all<WalletAccount>(c.env, token, '/accounts', 'accounts'),
      all<WalletCategory>(c.env, token, '/categories', 'categories'),
      all<WalletLabel>(c.env, token, '/labels', 'labels'),
      records(c.env, token, { limit: 1, withTotal: 'true' }),
      records(c.env, token, { limit: 1, sortBy: '+recordDate' }),
    ]);
    const [ours, cats, ledgy] = await Promise.all([
      db.prepare('SELECT id, name, currency, external_id FROM accounts WHERE user_id = ? AND archived = 0').bind(u).all<{ id: string; name: string; currency: string; external_id: string | null }>(),
      db.prepare('SELECT id, name, kind, archived, external_id FROM categories WHERE user_id = ?').bind(u).all<{ id: string; name: string; kind: string; archived: number; external_id: string | null }>(),
      db.prepare('SELECT COUNT(*) AS n, MIN(substr(occurred_at, 1, 10)) AS first FROM transactions WHERE user_id = ? AND deleted_at IS NULL').bind(u).first<{ n: number; first: string | null }>(),
    ]);
    const lower = (s: string) => s.trim().toLowerCase();
    const active = new Set(cats.results.filter((x) => !x.archived).map((x) => x.id));
    return c.json({
      total: count.total ?? count.records?.length ?? 0,
      first: oldest.records?.[0]?.recordDate?.slice(0, 10) ?? null,
      ledgy: { count: ledgy?.n ?? 0, first: ledgy?.first ?? null },
      accounts: accounts.map((a) => ({
        id: a.id, name: a.name, currency: (a.currencyCode ?? a.balance?.currencyCode ?? 'EUR').toUpperCase(), type: a.accountType ?? 'General',
        archived: !!a.archived, balance: a.balance?.currentBalance ?? null,
        // Un conto con lo stesso nome si propone solo se ha anche la stessa valuta.
        suggest: ours.results.find((o) => o.external_id === `wallet:${a.id}`)?.id
          ?? ours.results.find((o) => lower(o.name) === lower(a.name) && o.currency === (a.currencyCode ?? a.balance?.currencyCode ?? 'EUR').toUpperCase())?.id ?? 'new',
      })),
      categories: categories.map((w) => ({
        id: w.id, name: w.name, parent: w.parentName ?? null, group: w.group?.name ?? null,
        suggest: cats.results.find((x) => x.external_id === `wallet:${w.id}` && !x.archived)?.id
          ?? (w.customCategory ? cats.results.find((x) => !x.archived && lower(x.name) === lower(w.name))?.id : undefined)
          ?? walletCategoryCandidates(w).map((base) => seedId(base, u)).find((id) => active.has(id)) ?? null,
      })),
      labels: labels.filter((l) => !l.archived).map((l) => l.name),
    });
  } catch (e) {
    return fail(c, e);
  }
});

const TYPES: Record<string, string> = { Cash: 'cash', CreditCard: 'card', CurrentAccount: 'bank', SavingAccount: 'savings', Investment: 'investment', Loan: 'loan', Mortgage: 'loan' };

/** 2. Crea i conti nuovi (e le etichette) e restituisce la corrispondenza Wallet → Ledgy dei conti. */
walletApi.post('/start', async (c) => {
  const b = await body<{ accounts?: Array<{ id: string; name: string; currency: string; type?: string; target: string }>; labels?: string[] }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const map: Record<string, string> = {};
  const stmts: D1PreparedStatement[] = [];
  const pos = (await db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM accounts WHERE user_id = ?').bind(u).first<{ p: number }>())?.p ?? 0;
  let i = 0;
  for (const a of (b.accounts ?? []).slice(0, 200)) {
    if (!a?.id || a.target === 'skip') continue;
    if (a.target === 'new') {
      const existing = await db.prepare('SELECT id FROM accounts WHERE user_id = ? AND external_id = ?').bind(u, `wallet:${a.id}`).first<{ id: string }>();
      if (existing) { map[a.id] = existing.id; continue; }
      const id = newId('acc');
      const cur = /^[A-Z]{3}$/.test(a.currency ?? '') ? a.currency : 'EUR';
      stmts.push(db.prepare('INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, external_id, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)')
        .bind(id, u, String(a.name || 'Conto Wallet').slice(0, 80), TYPES[a.type ?? ''] ?? 'general', cur, pos + ++i, `wallet:${a.id}`, nowIso()));
      map[a.id] = id;
    } else {
      const own = await db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').bind(a.target, u).first<{ id: string }>();
      if (!own) bad('Conto non trovato');
      map[a.id] = own.id;
    }
  }
  const have = new Set((await db.prepare('SELECT lower(name) AS n FROM labels WHERE user_id = ?').bind(u).all<{ n: string }>()).results.map((r) => r.n));
  for (const name of [...new Set((b.labels ?? []).map((l) => String(l).trim().slice(0, 60)).filter(Boolean))].slice(0, 500)) {
    if (have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    stmts.push(db.prepare('INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)').bind(newId('lab'), u, name));
  }
  if (stmts.length) await db.batch(stmts);
  return c.json({ accounts: map });
});

/** 3. Una pagina di movimenti (100): già importati (stesso id di Wallet) si saltano. */
walletApi.post('/page', async (c) => {
  const b = await body<{ token?: string; offset?: number; accounts?: Record<string, string>; categories?: Record<string, string>; before?: string | null }>(c);
  const token = checkToken(b.token);
  const db = c.env.DB;
  const u = uid(c);
  const offset = Math.max(0, Math.floor(Number(b.offset) || 0));
  let page: { records?: WalletRecord[]; nextOffset?: number };
  try {
    page = await records(c.env, token, { limit: PAGE, offset, sortBy: '+recordDate', convertTo: 'EUR' }, b.before);
  } catch (e) {
    return fail(c, e);
  }
  const tz = await getTimeZone(db, u);
  const accounts = b.accounts ?? {};
  const categories = b.categories ?? {};
  // Solo id che appartengono all'account.
  const [ownAcc, ownCat, labs] = await Promise.all([
    db.prepare('SELECT id FROM accounts WHERE user_id = ?').bind(u).all<{ id: string }>(),
    db.prepare('SELECT id FROM categories WHERE user_id = ?').bind(u).all<{ id: string }>(),
    db.prepare('SELECT id, lower(name) AS name FROM labels WHERE user_id = ?').bind(u).all<{ id: string; name: string }>(),
  ]);
  const accOk = new Set(ownAcc.results.map((r) => r.id));
  const catOk = new Set(ownCat.results.map((r) => r.id));
  const labelId = new Map(labs.results.map((l) => [l.name, l.id]));
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const isTx: boolean[] = [];
  let skipped = 0;
  for (const r of page.records ?? []) {
    const acc = r.accountId ? accounts[r.accountId] : undefined;
    if (skipWalletRecord(r) || acc === 'skip' || !r.amount || !r.recordDate) { skipped++; continue; }
    const amt = walletAmounts(r);
    const occurred = zonedIso(new Date(r.recordDate), tz);
    const fx = amt.amount_eur != null ? { amount_eur: amt.amount_eur, fx_rate: null as number | null, fx_date: null as string | null } : await convertToEur(db, amt.amount, amt.currency, occurred);
    const cat = amt.type !== 'transfer' && r.category?.id ? categories[r.category.id] : undefined;
    const id = newId('tx');
    const merchant = r.counterParty?.trim().slice(0, 200) || null;
    stmts.push(db.prepare(`INSERT OR IGNORE INTO transactions (id, user_id, type, account_id, amount, currency, amount_eur, fx_rate, fx_date, occurred_at, occurred_utc,
        merchant_raw, merchant, note, category_id, source, status, review_reason, transfer_group, place, lat, lng, external_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'wallet', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, u, amt.type, acc && accOk.has(acc) ? acc : null, amt.amount, amt.currency, fx?.amount_eur ?? 0, fx?.fx_rate ?? null, fx?.fx_date ?? null,
        occurred, new Date(r.recordDate).toISOString(), merchant, merchant, r.note?.trim().slice(0, 2000) || null, cat && catOk.has(cat) ? cat : null,
        fx ? 'confirmed' : 'review', fx ? null : 'Cambio non disponibile', r.transfer?.transferId ?? null, r.place?.name ?? null,
        r.place?.latitude ?? null, r.place?.longitude ?? null, `wallet:${r.id}`, now, now));
    isTx.push(true);
    for (const l of r.labels ?? []) {
      const lid = labelId.get(String(l.name).trim().toLowerCase());
      if (!lid) continue;
      stmts.push(db.prepare('INSERT OR IGNORE INTO transaction_labels (transaction_id, label_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ?)').bind(id, lid, id));
      isTx.push(false);
    }
  }
  const results = stmts.length ? await db.batch(stmts) : [];
  let imported = 0;
  let already = 0;
  results.forEach((res, i) => { if (isTx[i]) { if (res.meta.changes) imported++; else already++; } });
  return c.json({ imported, already, skipped, next: page.nextOffset ?? null });
});

/** 4. Saldi come in Wallet: il saldo iniziale dei conti scelti si corregge perché il totale torni uguale. */
walletApi.post('/finish', async (c) => {
  const b = await body<{ token?: string; align?: Record<string, string> }>(c);
  const token = checkToken(b.token);
  const db = c.env.DB;
  const u = uid(c);
  let accounts: WalletAccount[];
  try {
    accounts = await all<WalletAccount>(c.env, token, '/accounts', 'accounts');
  } catch (e) {
    return fail(c, e);
  }
  const today = new Date().toISOString().slice(0, 10);
  // Più conti di Wallet nello stesso conto di Ledgy: si sommano. Valute diverse: si converte al cambio di oggi
  // (un conto Wallet in rupie dentro un conto Ledgy in dollari non deve diventare 693.454 $).
  const targets = new Map<string, number>();
  for (const [wid, ourId] of Object.entries(b.align ?? {}).slice(0, 200)) {
    const w = accounts.find((a) => a.id === wid);
    const value = w?.balance?.currentBalance;
    if (typeof value !== 'number' || !ourId) continue;
    const ours = await accountBalance(db, ourId, u);
    if (!ours) continue;
    const from = (w?.currencyCode ?? w?.balance?.currencyCode ?? ours.currency).toUpperCase();
    let milli = Math.round(value * 1000);
    if (from !== ours.currency) {
      const [a, z] = await Promise.all([from === 'EUR' ? 1 : getEurRate(db, from, today).then((r) => r?.eurPerUnit), ours.currency === 'EUR' ? 1 : getEurRate(db, ours.currency, today).then((r) => r?.eurPerUnit)]);
      if (!a || !z) continue; // senza cambio non si tocca il saldo
      milli = Math.round((milli * a) / z);
    }
    targets.set(ourId, (targets.get(ourId) ?? 0) + milli);
  }
  let aligned = 0;
  for (const [ourId, target] of targets) {
    const ours = await accountBalance(db, ourId, u);
    if (!ours) continue;
    await db.prepare('UPDATE accounts SET initial_balance = ? WHERE id = ? AND user_id = ?').bind(ours.initial + target - ours.balance, ourId, u).run();
    aligned++;
  }
  return c.json({ aligned });
});
