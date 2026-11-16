import { Hono } from 'hono';
import { roundMilli, toMilli } from '../shared/money';
import { cleanMerchantName } from '../shared/notification';
import { evaluateRules, type Rule, type RuleDefinition, type RuleInput } from '../shared/rules';
import { getEurRate } from './fx';
import { normalizePostedAt } from '../shared/time';
import { bad, body, getTimeZone, newId, notFound, nowIso, parseJson, runBatch, uid, type AppEnv } from './lib';
import { seedId } from './seed';
import { categoryFromKeywords } from '../shared/keywords';

export interface TxRow {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  account_id: string | null;
  amount: number;
  currency: string;
  amount_eur: number;
  fx_rate: number | null;
  fx_date: string | null;
  occurred_at: string;
  merchant_raw: string | null;
  merchant: string | null;
  note: string | null;
  category_id: string | null;
  nature: string | null;
  card: string | null;
  source: string;
  status: 'confirmed' | 'review';
  review_reason: string | null;
  review_choices: string | null;
  transfer_group: string | null;
  duplicate_of: string | null;
  capture_id: string | null;
  rule_ids: string | null;
  place: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewTx {
  type: TxRow['type'];
  account_id: string | null;
  amount: number;
  currency: string;
  occurred_at: string;
  merchant_raw?: string | null;
  merchant?: string | null;
  note?: string | null;
  category_id?: string | null;
  nature?: string | null;
  card?: string | null;
  source: string;
  status?: TxRow['status'];
  review_reason?: string | null;
  review_choices?: string[] | null;
  duplicate_of?: string | null;
  capture_id?: string | null;
  rule_ids?: string[] | null;
  place?: string | null;
  external_id?: string | null;
  transfer_group?: string | null;
  labels?: string[];
  amount_eur?: number;
  fx_rate?: number | null;
  fx_date?: string | null;
}

export function toUtc(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
}

export async function loadRules(db: D1Database, userId: string): Promise<Rule[]> {
  const { results } = await db.prepare('SELECT id, name, enabled, priority, definition FROM rules WHERE user_id = ? ORDER BY priority').bind(userId).all<{
    id: string; name: string; enabled: number; priority: number; definition: string;
  }>();
  return results.map((r) => ({ id: r.id, name: r.name, enabled: !!r.enabled, priority: r.priority, definition: parseJson<RuleDefinition>(r.definition, { conditions: [], actions: {} }) }));
}

/** Converte in euro con il tasso del giorno; se il cambio manca restituisce null. */
export async function convertToEur(db: D1Database, amountMilli: number, currency: string, occurredAt: string) {
  const rate = await getEurRate(db, currency, occurredAt.slice(0, 10));
  if (!rate) return null;
  return { amount_eur: roundMilli(Math.round(amountMilli * rate.eurPerUnit), 'EUR'), fx_rate: rate.eurPerUnit, fx_date: rate.date };
}

/** Conto usato quando nessuna regola ne indica uno: il primo della lista. */
export async function defaultAccountId(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT id FROM accounts WHERE user_id = ? AND archived = 0 ORDER BY position, created_at LIMIT 1').bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

/** Categoria più usata in passato per lo stesso merchant (solo movimenti confermati). */
/**
 * Categoria dall'ultima spesa confermata dello stesso negozio: se l'utente ha corretto la categoria,
 * dalla spesa successiva vale la correzione (è la più recente).
 */
export async function categoryFromHistory(db: D1Database, userId: string, merchant: string | null): Promise<string | null> {
  if (!merchant) return null;
  const row = await db
    .prepare(`SELECT t.category_id FROM transactions t JOIN categories c ON c.id = t.category_id AND c.archived = 0
              WHERE t.user_id = ? AND t.merchant = ? COLLATE NOCASE AND t.status = 'confirmed' AND t.deleted_at IS NULL
              ORDER BY t.updated_at DESC LIMIT 1`)
    .bind(userId, merchant)
    .first<{ category_id: string }>();
  return row?.category_id ?? null;
}

/** Categoria dalle parole chiave (in molte lingue), tra quelle attive dell'account. */
export async function categoryFromWords(db: D1Database, userId: string, kind: 'expense' | 'income', ...texts: Array<string | null | undefined>): Promise<string | null> {
  const base = categoryFromKeywords(kind, ...texts);
  if (!base) return null;
  const row = await db.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ? AND archived = 0').bind(seedId(base, userId), userId).first<{ id: string }>();
  return row?.id ?? null;
}

/** Una categoria o un conto indicato dal browser deve essere dell'account. */
export async function checkOwned(db: D1Database, table: 'categories' | 'accounts', id: string | null | undefined, userId: string) {
  if (!id) return;
  const row = await db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, userId).first();
  if (!row) bad(table === 'categories' ? 'Categoria non valida' : 'Conto non valido');
}

async function ensureLabels(db: D1Database, userId: string, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const found = await db.prepare('SELECT id FROM labels WHERE user_id = ? AND name = ? COLLATE NOCASE').bind(userId, name).first<{ id: string }>();
    if (found) ids.push(found.id);
    else {
      const id = newId('lab');
      await db.prepare('INSERT INTO labels (id, user_id, name) VALUES (?, ?, ?)').bind(id, userId, name).run();
      ids.push(id);
    }
  }
  return ids;
}

export async function insertTransaction(db: D1Database, userId: string, t: NewTx): Promise<string> {
  const id = newId('tx');
  const now = nowIso();
  let fx = t.amount_eur != null ? { amount_eur: t.amount_eur, fx_rate: t.fx_rate ?? null, fx_date: t.fx_date ?? null } : null;
  if (!fx) fx = await convertToEur(db, t.amount, t.currency, t.occurred_at);
  const status = t.status ?? (fx ? 'confirmed' : 'review');
  const reason = t.review_reason ?? (fx ? null : 'Cambio non disponibile');
  await db
    .prepare(`INSERT INTO transactions (id, user_id, type, account_id, amount, currency, amount_eur, fx_rate, fx_date, occurred_at, occurred_utc, merchant_raw, merchant,
              note, category_id, nature, card, source, status, review_reason, review_choices, transfer_group, duplicate_of, capture_id, rule_ids,
              place, external_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      id, userId, t.type, t.account_id, t.amount, t.currency, fx?.amount_eur ?? 0, fx?.fx_rate ?? null, fx?.fx_date ?? null, t.occurred_at, toUtc(t.occurred_at),
      t.merchant_raw ?? null, t.merchant ?? null, t.note ?? null, t.category_id ?? null, t.nature ?? null, t.card ?? null, t.source,
      status, reason, t.review_choices?.length ? JSON.stringify(t.review_choices) : null, t.transfer_group ?? null, t.duplicate_of ?? null,
      t.capture_id ?? null, t.rule_ids?.length ? JSON.stringify(t.rule_ids) : null, t.place ?? null, t.external_id ?? null, now, now,
    )
    .run();
  if (t.labels?.length) {
    const ids = await ensureLabels(db, userId, t.labels);
    await runBatch(db, ids.map((l) => db.prepare('INSERT OR IGNORE INTO transaction_labels (transaction_id, label_id) VALUES (?, ?)').bind(id, l)));
  }
  return id;
}

async function defaultNature(db: D1Database, categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId) return null;
  const c = await db.prepare('SELECT nature, parent_id FROM categories WHERE id = ?').bind(categoryId).first<{ nature: string | null; parent_id: string | null }>();
  if (!c) return null;
  if (c.nature) return c.nature;
  return c.parent_id ? defaultNature(db, c.parent_id) : null;
}

async function withLabels(db: D1Database, rows: TxRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await db
    .prepare(`SELECT tl.transaction_id, l.name FROM transaction_labels tl JOIN labels l ON l.id = tl.label_id WHERE tl.transaction_id IN (${placeholders})`)
    .bind(...ids)
    .all<{ transaction_id: string; name: string }>();
  const map = new Map<string, string[]>();
  for (const r of results) map.set(r.transaction_id, [...(map.get(r.transaction_id) ?? []), r.name]);
  return rows.map((r) => ({
    ...r,
    labels: map.get(r.id) ?? [],
    review_choices: parseJson<string[]>(r.review_choices, []),
    rule_ids: parseJson<string[]>(r.rule_ids, []),
  }));
}

export function ruleInputFromTx(t: TxRow, text: string | null = null, app: string | null = null): RuleInput {
  return {
    merchant: t.merchant, merchant_raw: t.merchant_raw, text, app: app ?? t.card, currency: t.currency,
    account_id: t.account_id, amount_eur: t.amount_eur / 1000, occurred_at: t.occurred_at, source: t.source,
  };
}

export const transactionsApi = new Hono<AppEnv>();

transactionsApi.get('/', async (c) => {
  const q = c.req.query();
  const where = ['t.user_id = ?', 't.deleted_at IS NULL'];
  const args: unknown[] = [uid(c)];
  // from/to sono date locali (YYYY-MM-DD), to escluso.
  if (q.from) { where.push('substr(t.occurred_at, 1, 10) >= ?'); args.push(q.from); }
  if (q.to) { where.push('substr(t.occurred_at, 1, 10) < ?'); args.push(q.to); }
  if (q.status) { where.push('t.status = ?'); args.push(q.status); }
  if (q.account) { where.push('t.account_id = ?'); args.push(q.account); }
  if (q.category) { where.push('(t.category_id = ? OR t.category_id IN (SELECT id FROM categories WHERE parent_id = ? AND user_id = ?))'); args.push(q.category, q.category, uid(c)); }
  if (q.merchant) { where.push('t.merchant = ?'); args.push(q.merchant); }
  if (q.q) { where.push('(t.merchant LIKE ? OR t.merchant_raw LIKE ? OR t.note LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  const limit = Math.min(Number(q.limit) || 100, 500);
  const offset = Number(q.offset) || 0;
  const { results } = await c.env.DB
    .prepare(`SELECT t.* FROM transactions t WHERE ${where.join(' AND ')} ORDER BY t.occurred_utc DESC, t.created_at DESC LIMIT ? OFFSET ?`)
    .bind(...args, limit, offset)
    .all<TxRow>();
  return c.json({ items: await withLabels(c.env.DB, results), limit, offset });
});

transactionsApi.get('/:id', async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(c.req.param('id'), uid(c)).first<TxRow>();
  if (!row) notFound();
  const [tx] = await withLabels(c.env.DB, [row]);
  const capture = row.capture_id
    ? await c.env.DB.prepare('SELECT id, app, title, text, received_at, posted_at, detail, device_id FROM captures WHERE id = ? AND user_id = ?').bind(row.capture_id, uid(c)).first()
    : null;
  const ruleNames = tx.rule_ids.length
    ? (await c.env.DB.prepare(`SELECT id, name FROM rules WHERE user_id = ? AND id IN (${tx.rule_ids.map(() => '?').join(',')})`).bind(uid(c), ...tx.rule_ids).all()).results
    : [];
  return c.json({ ...tx, capture, rules: ruleNames });
});

interface TxInput {
  type?: TxRow['type'];
  account_id?: string | null;
  amount?: number;
  currency?: string;
  occurred_at?: string;
  merchant?: string | null;
  note?: string | null;
  category_id?: string | null;
  nature?: string | null;
  labels?: string[];
  place?: string | null;
}

transactionsApi.post('/', async (c) => {
  const b = await body<TxInput>(c);
  if (!b.amount || !(b.amount > 0)) bad('Importo mancante');
  const type = b.type ?? 'expense';
  if (type === 'transfer') bad('I trasferimenti non si creano da qui');
  const currency = (b.currency ?? 'EUR').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) bad('Valuta non valida');
  const userId = uid(c);
  await checkOwned(c.env.DB, 'categories', b.category_id, userId);
  await checkOwned(c.env.DB, 'accounts', b.account_id, userId);
  const occurred = normalizePostedAt(b.occurred_at, await getTimeZone(c.env.DB, userId));
  const milli = roundMilli(toMilli(b.amount), currency) * (type === 'income' ? 1 : -1);
  const merchantRaw = b.merchant?.trim() || null;
  const merchant = cleanMerchantName(merchantRaw);
  let category = b.category_id ?? null;
  let nature = b.nature ?? null;
  let labels = b.labels ?? [];
  const ruleIds: string[] = [];
  if (!category && merchant) {
    const rules = await loadRules(c.env.DB, userId);
    const conv = await convertToEur(c.env.DB, milli, currency, occurred);
    const r = evaluateRules(rules, { merchant, merchant_raw: merchantRaw, text: null, app: null, currency, account_id: b.account_id ?? null, amount_eur: (conv?.amount_eur ?? 0) / 1000, occurred_at: occurred, source: 'manual' });
    category = r.category_id ?? (await categoryFromHistory(c.env.DB, userId, merchant))
      ?? (r.ask ? null : await categoryFromWords(c.env.DB, userId, type === 'income' ? 'income' : 'expense', merchant, merchantRaw));
    nature = nature ?? r.nature ?? null;
    labels = [...labels, ...r.labels];
    ruleIds.push(...r.matched);
  }
  nature = nature ?? (await defaultNature(c.env.DB, category));
  const id = await insertTransaction(c.env.DB, userId, {
    type, account_id: b.account_id ?? (await defaultAccountId(c.env.DB, userId)), amount: milli, currency, occurred_at: occurred, merchant_raw: merchantRaw,
    merchant: merchant ?? merchantRaw, note: b.note ?? null, category_id: category, nature, source: 'manual', labels, rule_ids: ruleIds, place: b.place ?? null,
  });
  return c.json({ id }, 201);
});

transactionsApi.put('/:id', async (c) => {
  const id = c.req.param('id');
  const userId = uid(c);
  const row = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ? AND deleted_at IS NULL').bind(id, userId).first<TxRow>();
  if (!row) notFound();
  const b = await body<TxInput>(c);
  await checkOwned(c.env.DB, 'categories', b.category_id, userId);
  await checkOwned(c.env.DB, 'accounts', b.account_id, userId);
  const type = b.type ?? row.type;
  const currency = (b.currency ?? row.currency).toUpperCase();
  const occurred = b.occurred_at ? normalizePostedAt(b.occurred_at, await getTimeZone(c.env.DB, userId)) : row.occurred_at;
  if (!/^[A-Z]{3}$/.test(currency)) bad('Valuta non valida');
  let amount = row.amount;
  if (b.amount != null) amount = roundMilli(toMilli(Math.abs(b.amount)), currency) * (type === 'income' ? 1 : -1);
  else if (b.type && b.type !== row.type) amount = Math.abs(row.amount) * (type === 'income' ? 1 : -1);
  let fx = { amount_eur: row.amount_eur, fx_rate: row.fx_rate, fx_date: row.fx_date };
  if (amount !== row.amount || currency !== row.currency || occurred.slice(0, 10) !== row.occurred_at.slice(0, 10)) {
    const conv = await convertToEur(c.env.DB, amount, currency, occurred);
    if (conv) fx = conv;
  }
  const merchant = b.merchant !== undefined ? b.merchant : row.merchant;
  const category = b.category_id !== undefined ? b.category_id : row.category_id;
  const nature = b.nature !== undefined ? b.nature : category !== row.category_id ? await defaultNature(c.env.DB, category) : row.nature;
  await c.env.DB
    .prepare(`UPDATE transactions SET type = ?, account_id = ?, amount = ?, currency = ?, amount_eur = ?, fx_rate = ?, fx_date = ?, occurred_at = ?,
              occurred_utc = ?, merchant = ?, note = ?, category_id = ?, nature = ?, place = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
    .bind(type, b.account_id !== undefined ? b.account_id : row.account_id, amount, currency, fx.amount_eur, fx.fx_rate, fx.fx_date, occurred, toUtc(occurred),
      merchant, b.note !== undefined ? b.note : row.note, category, nature, b.place !== undefined ? b.place : row.place, nowIso(), id, userId)
    .run();
  if (b.labels) {
    await c.env.DB.prepare('DELETE FROM transaction_labels WHERE transaction_id = ?').bind(id).run();
    const ids = await ensureLabels(c.env.DB, userId, b.labels);
    await runBatch(c.env.DB, ids.map((l) => c.env.DB.prepare('INSERT OR IGNORE INTO transaction_labels (transaction_id, label_id) VALUES (?, ?)').bind(id, l)));
  }
  // Categoria cambiata: quante altre spese dello stesso negozio hanno una categoria diversa (l'app propone di cambiarle).
  let others = 0;
  if (category && category !== row.category_id && merchant) {
    const r = await c.env.DB
      .prepare('SELECT COUNT(*) AS n FROM transactions WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND id <> ? AND deleted_at IS NULL AND (category_id IS NULL OR category_id <> ?)')
      .bind(userId, merchant, id, category).first<{ n: number }>();
    others = r?.n ?? 0;
  }
  return c.json({ ok: true, others, merchant });
});

/** Mette la stessa categoria a tutte le spese di un negozio (dopo una correzione). */
transactionsApi.post('/recategorize', async (c) => {
  const b = await body<{ merchant?: string; category_id?: string }>(c);
  if (!b.merchant?.trim() || !b.category_id) bad('Negozio e categoria sono obbligatori');
  const userId = uid(c);
  await checkOwned(c.env.DB, 'categories', b.category_id, userId);
  const nature = await defaultNature(c.env.DB, b.category_id);
  const r = await c.env.DB
    .prepare(`UPDATE transactions SET category_id = ?, nature = COALESCE(?, nature), updated_at = ?,
                status = CASE WHEN status = 'review' AND duplicate_of IS NULL THEN 'confirmed' ELSE status END,
                review_reason = CASE WHEN status = 'review' AND duplicate_of IS NULL THEN NULL ELSE review_reason END,
                review_choices = CASE WHEN status = 'review' AND duplicate_of IS NULL THEN NULL ELSE review_choices END
              WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND deleted_at IS NULL AND (category_id IS NULL OR category_id <> ?)`)
    .bind(b.category_id, nature, nowIso(), userId, b.merchant.trim(), b.category_id)
    .run();
  return c.json({ changed: r.meta.changes ?? 0 });
});

transactionsApi.delete('/:id', async (c) => {
  await c.env.DB.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(nowIso(), nowIso(), c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

/** Conferma un movimento da rivedere, con la categoria scelta. */
transactionsApi.post('/:id/confirm', async (c) => {
  const id = c.req.param('id');
  const b = await body<{ category_id?: string | null }>(c).catch(() => ({} as { category_id?: string | null }));
  const row = await c.env.DB.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').bind(id, uid(c)).first<TxRow>();
  if (!row) notFound();
  await checkOwned(c.env.DB, 'categories', b.category_id, uid(c));
  const category = b.category_id ?? row.category_id;
  const nature = row.nature ?? (await defaultNature(c.env.DB, category));
  await c.env.DB
    .prepare("UPDATE transactions SET status = 'confirmed', category_id = ?, nature = ?, review_reason = NULL, review_choices = NULL, duplicate_of = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(category, nature, nowIso(), id, uid(c))
    .run();
  return c.json({ ok: true });
});

/** Doppione: elimina questo movimento e tiene l'originale. */
transactionsApi.post('/:id/merge', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT duplicate_of FROM transactions WHERE id = ? AND user_id = ?').bind(id, uid(c)).first<{ duplicate_of: string | null }>();
  if (!row?.duplicate_of) bad('Questo movimento non è segnato come doppione');
  await c.env.DB.prepare('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ?').bind(nowIso(), nowIso(), id, uid(c)).run();
  return c.json({ ok: true, kept: row.duplicate_of });
});

/** Non è un doppione: resta come spesa a sé, da rivedere solo se manca la categoria. */
transactionsApi.post('/:id/not-duplicate', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT category_id, review_choices FROM transactions WHERE id = ? AND user_id = ?').bind(id, uid(c)).first<{ category_id: string | null; review_choices: string | null }>();
  if (!row) notFound();
  const ready = !!row.category_id && !row.review_choices;
  await c.env.DB
    .prepare('UPDATE transactions SET duplicate_of = NULL, status = ?, review_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .bind(ready ? 'confirmed' : 'review', ready ? null : row.review_choices ? 'Scegli la categoria' : 'Categoria da scegliere', nowIso(), id, uid(c))
    .run();
  return c.json({ ok: true, status: ready ? 'confirmed' : 'review' });
});

/** Conferma in blocco i movimenti da rivedere che hanno già una categoria. */
transactionsApi.post('/confirm-ready', async (c) => {
  const r = await c.env.DB
    .prepare("UPDATE transactions SET status = 'confirmed', review_reason = NULL, updated_at = ? WHERE user_id = ? AND status = 'review' AND category_id IS NOT NULL AND duplicate_of IS NULL AND review_choices IS NULL AND deleted_at IS NULL")
    .bind(nowIso(), uid(c))
    .run();
  return c.json({ confirmed: r.meta.changes ?? 0 });
});
