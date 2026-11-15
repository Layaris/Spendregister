import { Hono } from 'hono';
import { roundMilli, toMilli } from '../shared/money';
import { evaluateRules, type RuleDefinition } from '../shared/rules';
import { isValidTimeZone } from '../shared/time';
import { getEurRate } from './fx';
import { bad, body, getSetting, getTimeZone, newId, notFound, nowIso, runBatch, setSetting, type Env } from './lib';
import { loadRules, ruleInputFromTx, type TxRow } from './transactions';

export const catalogApi = new Hono<{ Bindings: Env }>();

/** Tutto ciò che serve all'app all'avvio. */
catalogApi.get('/bootstrap', async (c) => {
  const db = c.env.DB;
  const [accounts, categories, labels, review, balances] = await Promise.all([
    db.prepare('SELECT * FROM accounts WHERE archived = 0 ORDER BY position, name').all(),
    db.prepare('SELECT * FROM categories WHERE archived = 0 ORDER BY position, name').all(),
    db.prepare('SELECT * FROM labels ORDER BY name').all(),
    db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE status = 'review' AND deleted_at IS NULL").first<{ n: number }>(),
    db.prepare(`SELECT a.id, a.currency, a.initial_balance,
                  COALESCE(SUM(CASE WHEN t.currency = a.currency THEN t.amount ELSE NULL END), 0) AS same_cur,
                  COALESCE(SUM(CASE WHEN t.currency <> a.currency THEN t.amount_eur ELSE NULL END), 0) AS other_eur
                FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL AND t.duplicate_of IS NULL
                GROUP BY a.id`).all<{ id: string; currency: string; initial_balance: number; same_cur: number; other_eur: number }>(),
  ]);
  const bal = new Map(balances.results.map((b) => [b.id, b]));
  return c.json({
    accounts: accounts.results.map((a) => {
      const b = bal.get(a.id as string);
      // Movimenti in un'altra valuta: per i conti in euro si usa il controvalore in euro.
      const extra = b && b.currency === 'EUR' ? b.other_eur : 0;
      return { ...a, balance: (b?.initial_balance ?? 0) + (b?.same_cur ?? 0) + extra };
    }),
    categories: categories.results,
    labels: labels.results,
    review_count: review?.n ?? 0,
    settings: await publicSettings(db),
  });
});

catalogApi.post('/accounts', async (c) => {
  const b = await body<{ name?: string; type?: string; currency?: string; initial_balance?: number; color?: string }>(c);
  if (!b.name?.trim()) bad('Nome del conto mancante');
  const currency = (b.currency ?? 'EUR').toUpperCase();
  const id = newId('acc');
  await c.env.DB
    .prepare('INSERT INTO accounts (id, name, type, currency, initial_balance, color, position, created_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM accounts), ?)')
    .bind(id, b.name.trim(), b.type ?? 'general', currency, roundMilli(toMilli(b.initial_balance ?? 0), currency), b.color ?? null, nowIso())
    .run();
  return c.json({ id }, 201);
});

catalogApi.put('/accounts/:id', async (c) => {
  const b = await body<{ name?: string; type?: string; initial_balance?: number; color?: string; archived?: boolean }>(c);
  const a = await c.env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!a) notFound();
  await c.env.DB
    .prepare('UPDATE accounts SET name = ?, type = ?, initial_balance = ?, color = ?, archived = ? WHERE id = ?')
    .bind(b.name ?? a.name, b.type ?? a.type, b.initial_balance != null ? toMilli(b.initial_balance) : a.initial_balance, b.color ?? a.color,
      b.archived == null ? a.archived : b.archived ? 1 : 0, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

catalogApi.post('/categories', async (c) => {
  const b = await body<{ name?: string; parent_id?: string | null; kind?: string; nature?: string | null; color?: string; icon?: string }>(c);
  if (!b.name?.trim()) bad('Nome della categoria mancante');
  const id = newId('cat');
  await c.env.DB
    .prepare('INSERT INTO categories (id, name, parent_id, kind, nature, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM categories))')
    .bind(id, b.name.trim(), b.parent_id ?? null, b.kind ?? 'expense', b.nature ?? null, b.color ?? null, b.icon ?? null)
    .run();
  return c.json({ id }, 201);
});

catalogApi.put('/categories/:id', async (c) => {
  const b = await body<{ name?: string; parent_id?: string | null; nature?: string | null; color?: string; icon?: string; archived?: boolean }>(c);
  const cat = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!cat) notFound();
  await c.env.DB
    .prepare('UPDATE categories SET name = ?, parent_id = ?, nature = ?, color = ?, icon = ?, archived = ? WHERE id = ?')
    .bind(b.name ?? cat.name, b.parent_id !== undefined ? b.parent_id : cat.parent_id, b.nature !== undefined ? b.nature : cat.nature,
      b.color ?? cat.color, b.icon ?? cat.icon, b.archived == null ? cat.archived : b.archived ? 1 : 0, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

/** Unisce una categoria in un'altra spostando tutti i movimenti. */
catalogApi.post('/categories/:id/merge', async (c) => {
  const b = await body<{ into?: string }>(c);
  if (!b.into) bad('Categoria di destinazione mancante');
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE transactions SET category_id = ? WHERE category_id = ?').bind(b.into, id),
    c.env.DB.prepare('UPDATE categories SET parent_id = ? WHERE parent_id = ?').bind(b.into, id),
    c.env.DB.prepare('UPDATE categories SET archived = 1 WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

/** Tasso per la conversione dal vivo nella schermata Aggiungi. */
catalogApi.get('/fx', async (c) => {
  const currency = (c.req.query('currency') ?? 'EUR').toUpperCase();
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const rate = await getEurRate(c.env.DB, currency, date);
  return c.json(rate ? { currency, ...rate } : { currency, eurPerUnit: null });
});

// ---- Regole ----

catalogApi.get('/rules', async (c) => c.json({ items: await loadRules(c.env.DB) }));

function validateDefinition(d: RuleDefinition | undefined): RuleDefinition {
  if (!d || !Array.isArray(d.conditions) || typeof d.actions !== 'object') bad('Regola non valida');
  for (const cond of d.conditions) {
    if (cond.op === 'regex') {
      try { new RegExp(String(cond.value)); } catch { bad(`Espressione non valida: ${cond.value}`); }
    }
  }
  return d;
}

catalogApi.post('/rules', async (c) => {
  const b = await body<{ name?: string; priority?: number; enabled?: boolean; definition?: RuleDefinition }>(c);
  if (!b.name?.trim()) bad('Dai un nome alla regola');
  const def = validateDefinition(b.definition);
  const id = newId('rule');
  await c.env.DB
    .prepare('INSERT INTO rules (id, name, enabled, priority, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.name.trim(), b.enabled === false ? 0 : 1, b.priority ?? 100, JSON.stringify(def), nowIso(), nowIso())
    .run();
  return c.json({ id }, 201);
});

catalogApi.put('/rules/:id', async (c) => {
  const b = await body<{ name?: string; priority?: number; enabled?: boolean; definition?: RuleDefinition }>(c);
  const r = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!r) notFound();
  await c.env.DB
    .prepare('UPDATE rules SET name = ?, priority = ?, enabled = ?, definition = ?, updated_at = ? WHERE id = ?')
    .bind(b.name ?? r.name, b.priority ?? r.priority, b.enabled == null ? r.enabled : b.enabled ? 1 : 0,
      b.definition ? JSON.stringify(validateDefinition(b.definition)) : r.definition, nowIso(), c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

catalogApi.delete('/rules/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM rules WHERE id = ?').bind(c.req.param('id')).run();
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

async function historyPage(db: D1Database, def: RuleDefinition, ruleId: string, after: number) {
  const pre = sqlPrefilter(def);
  const { results } = await db
    .prepare(`SELECT rowid AS _rowid, id, type, merchant, merchant_raw, card, currency, account_id, amount_eur, occurred_at, source, category_id
              FROM transactions WHERE rowid > ? AND deleted_at IS NULL AND type <> 'transfer' ${pre.where.map((w) => `AND ${w}`).join(' ')}
              ORDER BY rowid LIMIT ?`)
    .bind(after, ...pre.args, PAGE)
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
  const { matched, changes, next } = await historyPage(c.env.DB, validateDefinition(b.definition), 'preview', Number(b.after) || 0);
  return c.json({ matched, changed: changes.length, sample: changes.slice(0, 20), next });
});

catalogApi.post('/rules/:id/apply', async (c) => {
  const b = await body<{ after?: number }>(c).catch(() => ({} as { after?: number }));
  const r = await c.env.DB.prepare('SELECT * FROM rules WHERE id = ?').bind(c.req.param('id')).first<{ id: string; definition: string }>();
  if (!r) notFound();
  const { changes, next } = await historyPage(c.env.DB, JSON.parse(r.definition), r.id, Number(b.after) || 0);
  const now = nowIso();
  await runBatch(c.env.DB, changes.map((ch) =>
    c.env.DB.prepare('UPDATE transactions SET category_id = ?, nature = COALESCE(?, nature), updated_at = ? WHERE id = ?').bind(ch.to, ch.nature ?? null, now, ch.id)));
  return c.json({ changed: changes.length, next });
});

// ---- Impostazioni ----

async function publicSettings(db: D1Database) {
  return { timezone: await getTimeZone(db), recovery_created_at: await getSetting(db, 'recovery_created_at') };
}

catalogApi.get('/settings', async (c) => c.json(await publicSettings(c.env.DB)));

catalogApi.put('/settings', async (c) => {
  const b = await body<{ timezone?: string }>(c);
  if (b.timezone !== undefined) {
    if (!isValidTimeZone(b.timezone)) bad('Fuso orario non valido');
    await setSetting(c.env.DB, 'timezone', b.timezone);
  }
  return c.json({ ok: true });
});
