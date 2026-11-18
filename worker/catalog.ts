import { Hono } from 'hono';
import { drainInbound, pendingHints } from './capture';
import { roundMilli, toMilli } from '../shared/money';
import { evaluateRules, type RuleActions, type RuleDefinition } from '../shared/rules';
import { isValidTimeZone } from '../shared/time';
import { accountInfo, FEATURE_DEFAULTS } from './auth';
import { getEurRate } from './fx';
import { upgradeCatalog } from './seed';
import { bad, body, getTimeZone, newId, notFound, nowIso, runBatch, uid, type AppEnv } from './lib';
import { checkOwned, convertToEur, insertTransaction, loadRules, ruleInputFromTx, type TxRow } from './transactions';
import { zonedIso } from '../shared/time';

export const catalogApi = new Hono<AppEnv>();

/** Tutto ciò che serve all'app all'avvio, solo per l'account della sessione. */
catalogApi.get('/bootstrap', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  // Notifiche rimaste in coda mentre il database non rispondeva: si registrano ora, dopo la risposta.
  c.executionCtx.waitUntil(drainInbound(c.env, c.executionCtx).catch(() => 0));
  c.executionCtx.waitUntil(pendingHints(c.env, c.executionCtx, u).catch(() => {}));
  await upgradeCatalog(db, u); // una volta sola, per gli account con le categorie della versione 1
  const [accounts, categories, labels, review, balances, account] = await Promise.all([
    db.prepare('SELECT * FROM accounts WHERE user_id = ? AND archived = 0 ORDER BY position, name').bind(u).all(),
    db.prepare('SELECT * FROM categories WHERE user_id = ? AND archived = 0 ORDER BY position, name').bind(u).all(),
    db.prepare('SELECT * FROM labels WHERE user_id = ? ORDER BY name').bind(u).all(),
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND status = 'review' AND deleted_at IS NULL").bind(u).first<{ n: number }>(),
    db.prepare(`SELECT a.id, a.currency, a.initial_balance,
                  COALESCE(SUM(CASE WHEN t.currency = a.currency THEN t.amount ELSE NULL END), 0) AS same_cur,
                  COALESCE(SUM(CASE WHEN t.currency <> a.currency THEN t.amount_eur ELSE NULL END), 0) AS other_eur
                FROM accounts a LEFT JOIN account_totals t ON t.user_id = a.user_id AND t.account_id = a.id
                WHERE a.user_id = ?
                GROUP BY a.id`).bind(u).all<{ id: string; currency: string; initial_balance: number; same_cur: number; other_eur: number }>(),
    accountInfo(db, u),
  ]);
  const bal = new Map(balances.results.map((b) => [b.id, b]));
  // Movimenti in un'altra valuta: il loro controvalore in euro, riportato nella valuta del conto al cambio di oggi.
  const today = new Date().toISOString().slice(0, 10);
  const rates = new Map<string, number | null>();
  for (const cur of new Set(balances.results.filter((b) => b.currency !== 'EUR').map((b) => b.currency))) {
    rates.set(cur, (await getEurRate(db, cur, today))?.eurPerUnit ?? null);
  }
  return c.json({
    accounts: accounts.results.map((a) => {
      const b = bal.get(a.id as string);
      const rate = b && b.currency !== 'EUR' ? rates.get(b.currency) : 1;
      const extra = b?.other_eur && rate ? Math.round(b.other_eur / rate) : 0;
      const balance = (b?.initial_balance ?? 0) + (b?.same_cur ?? 0) + extra;
      // Controvalore in euro al cambio di oggi: la Home somma questi per il saldo totale.
      return { ...a, balance, balance_eur: rate ? Math.round(balance * rate) : null };
    }),
    categories: categories.results,
    labels: labels.results,
    review_count: review?.n ?? 0,
    settings: { timezone: account.timezone, recovery_created_at: account.recovery_created_at, display_currency: account.display_currency, theme: account.theme, home_layout: account.home_layout, features: account.features, hero_style: account.hero_style },
    account: { email: account.email },
  });
});

catalogApi.post('/accounts', async (c) => {
  const b = await body<{ name?: string; type?: string; currency?: string; initial_balance?: number; color?: string }>(c);
  if (!b.name?.trim()) bad('Nome del conto mancante');
  const currency = (b.currency ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) bad('Valuta non valida');
  const id = newId('acc');
  await c.env.DB
    .prepare('INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM accounts WHERE user_id = ?), ?)')
    .bind(id, uid(c), b.name.trim().slice(0, 80), b.type ?? 'general', currency, roundMilli(toMilli(b.initial_balance ?? 0), currency), b.color ?? null, uid(c), nowIso())
    .run();
  return c.json({ id }, 201);
});

/** Saldo di un conto nella sua valuta: iniziale + movimenti nella stessa valuta + gli altri (in euro) al cambio di oggi. */
export async function accountBalance(db: D1Database, accountId: string, userId: string): Promise<{ currency: string; balance: number; initial: number } | null> {
  const a = await db.prepare(`SELECT a.currency, a.initial_balance,
      COALESCE((SELECT SUM(amount) FROM account_totals WHERE user_id = a.user_id AND account_id = a.id AND currency = a.currency), 0) AS same_cur,
      COALESCE((SELECT SUM(amount_eur) FROM account_totals WHERE user_id = a.user_id AND account_id = a.id AND currency <> a.currency), 0) AS other_eur
    FROM accounts a WHERE a.id = ? AND a.user_id = ?`).bind(accountId, userId).first<{ currency: string; initial_balance: number; same_cur: number; other_eur: number }>();
  if (!a) return null;
  let other = 0;
  if (a.other_eur) {
    const rate = a.currency === 'EUR' ? 1 : (await getEurRate(db, a.currency, new Date().toISOString().slice(0, 10)))?.eurPerUnit;
    other = rate ? Math.round(a.other_eur / rate) : 0;
  }
  return { currency: a.currency, initial: a.initial_balance, balance: a.initial_balance + a.same_cur + other };
}

/**
 * Correggi il saldo: "oggi ho davvero X". La differenza diventa un aggiustamento (non è una spesa né un'entrata:
 * non entra in statistiche, budget, avvisi), visibile tra i movimenti del conto.
 */
catalogApi.post('/accounts/:id/adjust', async (c) => {
  const b = await body<{ balance?: number }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const now = await accountBalance(db, c.req.param('id'), u);
  if (!now) notFound('Conto non trovato');
  const target = Number(b.balance);
  if (!Number.isFinite(target) || Math.abs(target) > 1e13) bad('Saldo non valido');
  const diff = roundMilli(toMilli(target), now.currency) - now.balance;
  if (!diff) return c.json({ diff: 0 });
  const today = new Date().toISOString();
  const fx = await convertToEur(db, diff, now.currency, today);
  await insertTransaction(db, u, {
    type: 'transfer', account_id: c.req.param('id'), amount: diff, currency: now.currency, occurred_at: zonedIso(new Date(), await getTimeZone(db, u)),
    merchant: 'Correzione saldo', merchant_raw: 'Correzione saldo', source: 'adjustment', status: 'confirmed',
    ...(fx ? { amount_eur: fx.amount_eur, fx_rate: fx.fx_rate, fx_date: fx.fx_date } : { amount_eur: 0 }),
  });
  return c.json({ diff });
});

catalogApi.put('/accounts/:id', async (c) => {
  const b = await body<{ name?: string; type?: string; initial_balance?: number; color?: string; archived?: boolean; currency?: string }>(c);
  const a = await c.env.DB.prepare('SELECT * FROM accounts WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<Record<string, unknown>>();
  if (!a) notFound();
  if (b.name !== undefined && !b.name.trim()) bad('Nome del conto mancante');
  // Valuta cambiata senza chiudere il conto: il saldo iniziale si converte al cambio di oggi.
  // I movimenti restano nella loro valuta originale.
  let currency = a.currency as string;
  let initial = b.initial_balance != null ? toMilli(b.initial_balance) : (a.initial_balance as number);
  if (b.currency && b.currency.toUpperCase() !== currency) {
    const next = b.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(next)) bad('Valuta non valida');
    if (initial && b.initial_balance == null) {
      const today = new Date().toISOString().slice(0, 10);
      const [from, to] = await Promise.all([getEurRate(c.env.DB, currency, today), getEurRate(c.env.DB, next, today)]);
      if (!from || !to) bad('Cambio non disponibile per questa valuta: riprova più tardi');
      initial = roundMilli(Math.round((initial * from.eurPerUnit) / to.eurPerUnit), next);
    }
    currency = next;
  }
  await c.env.DB
    .prepare('UPDATE accounts SET name = ?, type = ?, currency = ?, initial_balance = ?, color = ?, archived = ? WHERE id = ? AND user_id = ?')
    .bind(b.name?.trim().slice(0, 80) ?? a.name, b.type ?? a.type, currency, initial, b.color ?? a.color,
      b.archived == null ? a.archived : b.archived ? 1 : 0, c.req.param('id'), uid(c))
    .run();
  return c.json({ ok: true, currency, initial_balance: initial });
});

catalogApi.post('/categories', async (c) => {
  const b = await body<{ name?: string; parent_id?: string | null; kind?: string; nature?: string | null; color?: string; icon?: string }>(c);
  if (!b.name?.trim()) bad('Nome della categoria mancante');
  await checkOwned(c.env.DB, 'categories', b.parent_id, uid(c));
  const id = newId('cat');
  await c.env.DB
    .prepare('INSERT INTO categories (id, user_id, name, parent_id, kind, nature, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories WHERE user_id = ?))')
    .bind(id, uid(c), b.name.trim().slice(0, 80), b.parent_id ?? null, b.kind === 'income' ? 'income' : 'expense', b.nature ?? null, b.color ?? null, b.icon ?? null, uid(c))
    .run();
  return c.json({ id }, 201);
});

catalogApi.put('/categories/:id', async (c) => {
  const b = await body<{ name?: string; parent_id?: string | null; nature?: string | null; color?: string; icon?: string; archived?: boolean }>(c);
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<Record<string, unknown>>();
  if (!cat) notFound();
  if (b.parent_id) await checkOwned(c.env.DB, 'categories', b.parent_id, uid(c));
  await c.env.DB
    .prepare('UPDATE categories SET name = ?, parent_id = ?, nature = ?, color = ?, icon = ?, archived = ? WHERE id = ? AND user_id = ?')
    .bind(b.name ?? cat.name, b.parent_id !== undefined ? b.parent_id : cat.parent_id, b.nature !== undefined ? b.nature : cat.nature,
      b.color ?? cat.color, b.icon ?? cat.icon, b.archived == null ? cat.archived : b.archived ? 1 : 0, c.req.param('id'), uid(c))
    .run();
  return c.json({ ok: true });
});

/** Tutte le categorie, anche quelle spente (pagina Categorie), con quanti movimenti hanno. */
catalogApi.get('/categories', async (c) => {
  const { results } = await c.env.DB
    .prepare(`SELECT c.*, (SELECT COUNT(*) FROM transactions t WHERE t.category_id = c.id AND t.deleted_at IS NULL) AS count
              FROM categories c WHERE c.user_id = ? ORDER BY c.position, c.name`)
    .bind(uid(c)).all();
  return c.json({ items: results });
});

/** Accende o spegne una categoria; per un gruppo vale anche per tutte le sue sottocategorie. */
catalogApi.post('/categories/:id/enabled', async (c) => {
  const b = await body<{ enabled?: boolean }>(c);
  const id = c.req.param('id');
  await checkOwned(c.env.DB, 'categories', id, uid(c));
  const off = b.enabled ? 0 : 1;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE categories SET archived = ? WHERE id = ? AND user_id = ?').bind(off, id, uid(c)),
    c.env.DB.prepare('UPDATE categories SET archived = ? WHERE parent_id = ? AND user_id = ?').bind(off, id, uid(c)),
  ]);
  return c.json({ ok: true });
});

/**
 * Elimina una categoria (e le sue sottocategorie). I movimenti e le regole passano a `into`,
 * oppure restano senza categoria. Una sottocategoria non può finire dentro sé stessa.
 */
catalogApi.delete('/categories/:id', async (c) => {
  const id = c.req.param('id');
  const into = c.req.query('into') || null;
  const db = c.env.DB;
  const u = uid(c);
  await checkOwned(db, 'categories', id, u);
  const children = (await db.prepare('SELECT id FROM categories WHERE parent_id = ? AND user_id = ?').bind(id, u).all<{ id: string }>()).results.map((r) => r.id);
  const gone = [id, ...children];
  if (into) {
    if (gone.includes(into)) bad('Scegli una categoria diversa da quella che elimini');
    await checkOwned(db, 'categories', into, u);
  }
  const marks = gone.map(() => '?').join(', ');
  const rules = (await db.prepare('SELECT id, definition FROM rules WHERE user_id = ?').bind(u).all<{ id: string; definition: string }>()).results;
  const stmts: D1PreparedStatement[] = [
    db.prepare(`UPDATE transactions SET category_id = ?, updated_at = ? WHERE user_id = ? AND category_id IN (${marks})`).bind(into, nowIso(), u, ...gone),
  ];
  const goneSet = new Set(gone);
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (!v || typeof v !== 'object') return v;
    const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
    if (typeof o.category_id === 'string' && goneSet.has(o.category_id)) {
      if (into) o.category_id = into;
      else delete o.category_id;
    }
    if (Array.isArray(o.ask)) {
      const ask = [...new Set((o.ask as string[]).map((x) => (goneSet.has(x) ? into : x)).filter((x): x is string => !!x))];
      if (ask.length > 1) o.ask = ask;
      else delete o.ask;
    }
    for (const k of ['actions', 'bands']) if (o[k]) o[k] = fix(o[k]);
    return o;
  };
  for (const r of rules) {
    if (!gone.some((g) => r.definition.includes(`"${g}"`))) continue;
    stmts.push(db.prepare('UPDATE rules SET definition = ? WHERE id = ?').bind(JSON.stringify(fix(JSON.parse(r.definition))), r.id));
  }
  stmts.push(db.prepare(`DELETE FROM categories WHERE user_id = ? AND parent_id = ?`).bind(u, id));
  stmts.push(db.prepare('DELETE FROM categories WHERE user_id = ? AND id = ?').bind(u, id));
  await runBatch(db, stmts);
  return c.json({ ok: true, moved_to: into });
});

/** Unisce una categoria in un'altra spostando tutti i movimenti. */
catalogApi.post('/categories/:id/merge', async (c) => {
  const b = await body<{ into?: string }>(c);
  if (!b.into) bad('Categoria di destinazione mancante');
  const id = c.req.param('id');
  await checkOwned(c.env.DB, 'categories', id, uid(c));
  await checkOwned(c.env.DB, 'categories', b.into, uid(c));
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ? AND user_id = ?').bind(b.into, id, uid(c)),
    c.env.DB.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ? AND user_id = ?').bind(b.into, id, uid(c)),
    c.env.DB.prepare('UPDATE categories SET archived = 1 WHERE id = ? AND user_id = ?').bind(id, uid(c)),
  ]);
  return c.json({ ok: true });
});

// ---- Preferiti: movimenti che si ripetono, da riusare con un tap ----

catalogApi.get('/favorites', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM favorites WHERE user_id = ? ORDER BY position, created_at').bind(uid(c)).all();
  return c.json({ items: results });
});

catalogApi.post('/favorites', async (c) => {
  const b = await body<{ name?: string; type?: string; amount?: number | null; currency?: string; merchant?: string | null; category_id?: string | null; account_id?: string | null; note?: string | null }>(c);
  const currency = (b.currency ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) bad('Valuta non valida');
  const name = (b.name ?? b.merchant ?? '').trim();
  if (!name) bad('Dai un nome al preferito');
  await checkOwned(c.env.DB, 'categories', b.category_id, uid(c));
  await checkOwned(c.env.DB, 'accounts', b.account_id, uid(c));
  const id = newId('fav');
  await c.env.DB
    .prepare(`INSERT INTO favorites (id, user_id, name, type, amount, currency, merchant, category_id, account_id, note, position, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM favorites WHERE user_id = ?), ?)`)
    .bind(id, uid(c), name.slice(0, 60), b.type === 'income' ? 'income' : 'expense', b.amount != null && b.amount > 0 ? b.amount : null, currency,
      b.merchant?.trim() || null, b.category_id ?? null, b.account_id ?? null, b.note?.trim() || null, uid(c), nowIso())
    .run();
  return c.json({ id }, 201);
});

catalogApi.delete('/favorites/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM favorites WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

/** Tasso per la conversione dal vivo nella schermata Aggiungi (i cambi sono pubblici e condivisi). */
catalogApi.get('/fx', async (c) => {
  const currency = (c.req.query('currency') ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) bad('Valuta non valida');
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const rate = await getEurRate(c.env.DB, currency, date);
  return c.json(rate ? { currency, ...rate } : { currency, eurPerUnit: null });
});

// ---- Regole ----

catalogApi.get('/rules', async (c) => c.json({ items: await loadRules(c.env.DB, uid(c)) }));

/** Controlla la regola e che categorie e conti indicati siano dell'account. */
async function validateDefinition(db: D1Database, userId: string, d: RuleDefinition | undefined): Promise<RuleDefinition> {
  if (!d || !Array.isArray(d.conditions) || typeof d.actions !== 'object') bad('Regola non valida');
  for (const cond of d.conditions) {
    if (cond.op === 'regex') {
      try { new RegExp(String(cond.value)); } catch { bad(`Espressione non valida: ${cond.value}`); }
    }
  }
  const all: RuleActions[] = [d.actions, ...(d.bands ?? []).map((b) => b.actions ?? {})];
  for (const a of all) {
    await checkOwned(db, 'categories', a.category_id, userId);
    await checkOwned(db, 'accounts', a.account_id, userId);
    for (const id of a.ask ?? []) await checkOwned(db, 'categories', id, userId);
  }
  return d;
}

catalogApi.post('/rules', async (c) => {
  const b = await body<{ name?: string; priority?: number; enabled?: boolean; definition?: RuleDefinition }>(c);
  if (!b.name?.trim()) bad('Dai un nome alla regola');
  const def = await validateDefinition(c.env.DB, uid(c), b.definition);
  const id = newId('rule');
  await c.env.DB
    .prepare('INSERT INTO rules (id, user_id, name, enabled, priority, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid(c), b.name.trim().slice(0, 80), b.enabled === false ? 0 : 1, b.priority ?? 100, JSON.stringify(def), nowIso(), nowIso())
    .run();
  return c.json({ id }, 201);
});

catalogApi.put('/rules/:id', async (c) => {
  const b = await body<{ name?: string; priority?: number; enabled?: boolean; definition?: RuleDefinition }>(c);
  const r = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<Record<string, unknown>>();
  if (!r) notFound();
  await c.env.DB
    .prepare('UPDATE rules SET name = ?, priority = ?, enabled = ?, definition = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(b.name ?? r.name, b.priority ?? r.priority, b.enabled == null ? r.enabled : b.enabled ? 1 : 0,
      b.definition ? JSON.stringify(await validateDefinition(c.env.DB, uid(c), b.definition)) : r.definition, nowIso(), c.req.param('id'), uid(c))
    .run();
  return c.json({ ok: true });
});

catalogApi.delete('/rules/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

// Anteprima e applicazione allo storico lavorano a pagine (vedi il limite di CPU in backup.ts):
// il browser richiama finché `next` non è null. La fascia "chiedimi" non tocca il passato.
const PAGE = 800;

/** Traduce in SQL le condizioni che si possono filtrare nel database, per leggere meno righe. */
function sqlPrefilter(def: RuleDefinition): { where: string[]; args: unknown[] } {
  const where: string[] = [];
  const args: unknown[] = [];
  for (const c of def.conditions) {
    const v = String(c.value).toLowerCase();
    if (c.field === 'merchant' && ['contains', 'equals', 'starts'].includes(c.op)) {
      const pattern = c.op === 'contains' ? `%${v}%` : c.op === 'starts' ? `${v}%` : v;
      where.push('(LOWER(COALESCE(merchant, \'\')) LIKE ? OR LOWER(COALESCE(merchant_raw, \'\')) LIKE ?)');
      args.push(pattern, pattern);
    } else if (c.field === 'currency' && c.op === 'equals') {
      where.push('currency = ?');
      args.push(String(c.value).toUpperCase());
    }
  }
  return { where, args };
}

async function historyPage(db: D1Database, userId: string, def: RuleDefinition, ruleId: string, after: number) {
  const pre = sqlPrefilter(def);
  const { results } = await db
    .prepare(`SELECT rowid AS _rowid, id, type, merchant, merchant_raw, card, currency, account_id, amount_eur, occurred_at, source, category_id
              FROM transactions WHERE user_id = ? AND rowid > ? AND deleted_at IS NULL AND type <> 'transfer' ${pre.where.map((w) => `AND ${w}`).join(' ')}
              ORDER BY rowid LIMIT ?`)
    .bind(userId, after, ...pre.args, PAGE)
    .all<TxRow & { _rowid: number }>();
  const rule = { id: ruleId, name: 'anteprima', enabled: true, priority: 0, definition: def };
  const changes: Array<{ id: string; from: string | null; to: string; nature?: string }> = [];
  let matched = 0;
  for (const t of results) {
    const r = evaluateRules([rule], ruleInputFromTx(t));
    if (!r.matched.length) continue;
    matched++;
    if (r.category_id && r.category_id !== t.category_id) changes.push({ id: t.id, from: t.category_id, to: r.category_id, nature: r.nature });
  }
  const next = results.length === PAGE ? results[results.length - 1]._rowid : null;
  return { matched, changes, next };
}

catalogApi.post('/rules/preview', async (c) => {
  const b = await body<{ definition?: RuleDefinition; after?: number }>(c);
  const def = await validateDefinition(c.env.DB, uid(c), b.definition);
  const { matched, changes, next } = await historyPage(c.env.DB, uid(c), def, 'preview', Number(b.after) || 0);
  return c.json({ matched, changed: changes.length, sample: changes.slice(0, 20), next });
});

catalogApi.post('/rules/:id/apply', async (c) => {
  const b = await body<{ after?: number }>(c).catch(() => ({} as { after?: number }));
  const r = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<{ id: string; definition: string }>();
  if (!r) notFound();
  const { changes, next } = await historyPage(c.env.DB, uid(c), JSON.parse(r.definition), r.id, Number(b.after) || 0);
  const now = nowIso();
  await runBatch(c.env.DB, changes.map((ch) =>
    c.env.DB.prepare('UPDATE transactions SET category_id = ?, nature = COALESCE(?, nature), updated_at = ? WHERE id = ? AND user_id = ?').bind(ch.to, ch.nature ?? null, now, ch.id, uid(c))));
  return c.json({ changed: changes.length, next });
});

// ---- Impostazioni dell'account ----

catalogApi.get('/settings', async (c) => {
  const a = await accountInfo(c.env.DB, uid(c));
  return c.json({ timezone: a.timezone, recovery_created_at: a.recovery_created_at, display_currency: a.display_currency, theme: a.theme, home_layout: a.home_layout, features: a.features, hero_style: a.hero_style });
});

/** Valute in cui si possono vedere totali e saldi (Impostazioni). */
export const DISPLAY_CURRENCIES = ['EUR', 'USD', 'AED', 'PHP', 'IDR', 'SGD', 'CNY', 'THB'];
/** Schede possibili della Home (src/pages/Home.tsx). */
export const HOME_WIDGETS = ['hero', 'alerts', 'week', 'budget', 'review', 'recurring', 'forecast', 'accounts', 'cashflow', 'balance', 'top', 'cards', 'recent'];

catalogApi.put('/settings', async (c) => {
  const b = await body<{ timezone?: string; display_currency?: string; theme?: string; home_layout?: string[] | null; features?: Record<string, boolean>; hero_style?: string }>(c);
  const db = c.env.DB;
  if (b.timezone !== undefined) {
    if (!isValidTimeZone(b.timezone)) bad('Fuso orario non valido');
    await db.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(b.timezone, uid(c)).run();
  }
  if (b.display_currency !== undefined) {
    if (!DISPLAY_CURRENCIES.includes(b.display_currency)) bad('Valuta non disponibile');
    await db.prepare('UPDATE users SET display_currency = ? WHERE id = ?').bind(b.display_currency, uid(c)).run();
  }
  if (b.theme !== undefined) {
    if (!['light', 'blue', 'navy', 'dark', 'system'].includes(b.theme)) bad('Tema non valido');
    await db.prepare('UPDATE users SET theme = ? WHERE id = ?').bind(b.theme, uid(c)).run();
  }
  if (b.home_layout !== undefined) {
    const ok = b.home_layout === null || (Array.isArray(b.home_layout) && b.home_layout.length <= 20 && b.home_layout.every((k) => typeof k === 'string'));
    if (!ok) bad('Disposizione della Home non valida');
    // Schede tolte nel frattempo (es. "capture", passata nelle impostazioni) si scartano senza errore.
    const keep = b.home_layout ? [...new Set(b.home_layout)].filter((k) => HOME_WIDGETS.includes(k)) : null;
    await db.prepare('UPDATE users SET home_layout = ? WHERE id = ?').bind(keep ? JSON.stringify(keep) : null, uid(c)).run();
  }
  if (b.hero_style !== undefined) {
    if (!['compact', 'ring'].includes(b.hero_style)) bad('Stile non valido');
    await db.prepare('UPDATE users SET hero_style = ? WHERE id = ?').bind(b.hero_style, uid(c)).run();
  }
  if (b.features !== undefined) {
    if (!b.features || typeof b.features !== 'object') bad('Funzioni non valide');
    const now = (await accountInfo(db, uid(c))).features;
    for (const [k, v] of Object.entries(b.features)) if (k in FEATURE_DEFAULTS && typeof v === 'boolean') now[k] = v;
    await db.prepare('UPDATE users SET features = ? WHERE id = ?').bind(JSON.stringify(now), uid(c)).run();
  }
  return c.json({ ok: true });
});
