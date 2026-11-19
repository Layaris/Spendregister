// Copia completa dei dati sul telefono. Il registro `sync_log` (migrazione 0017, scritto dai trigger) dice quali righe
// sono cambiate dopo un certo numero: l'app chiede solo quelle, così le righe lette su D1 restano poche.
// La prima volta (o se l'app è rimasta indietro più del registro tenuto) scarica tutto a pagine da /sync/full.
import { Hono } from 'hono';
import { accountInfo } from './auth';
import { drainInbound, pendingHints } from './capture';
import { getEurRate } from './fx';
import { bad, getSetting, uid, type AppEnv, type Env } from './lib';
import { upgradeCatalog } from './seed';

/** Tabelle copiate sul telefono: come si legge una riga dalla sua chiave del registro. */
const LABELS = "(SELECT group_concat(label_id, ',') FROM transaction_labels WHERE transaction_id = t.id) AS label_ids";
export const SYNC_TABLES: Record<string, { select: string; key: string; from: string }> = {
  accounts: { select: 'id, name, type, currency, initial_balance, color, archived, position, external_id, created_at', key: 'id', from: 'accounts' },
  categories: { select: 'id, name, parent_id, kind, nature, color, icon, position, archived, external_id', key: 'id', from: 'categories' },
  labels: { select: 'id, name, color, external_id', key: 'id', from: 'labels' },
  transactions: {
    select: `t.id, t.type, t.account_id, t.amount, t.currency, t.amount_eur, t.fx_rate, t.fx_date, t.occurred_at, t.occurred_utc, t.merchant_raw, t.merchant,
      t.note, t.category_id, t.nature, t.card, t.source, t.status, t.review_reason, t.review_choices, t.transfer_group, t.duplicate_of, t.capture_id,
      t.rule_ids, t.place, t.lat, t.lng, t.external_id, t.created_at, t.updated_at, t.deleted_at, t.ai_tries, t.split_group, ${LABELS}`,
    key: 't.id', from: 'transactions t',
  },
  budgets: { select: 'category_id, amount, updated_at', key: 'category_id', from: 'budgets' },
  recurring: { select: 'id, merchant, category_id, amount_eur, period, every, status, last_date, auto_add, account_id, amount, currency, created_at, updated_at', key: 'id', from: 'recurring' },
  trips: { select: 'id, name, place, start_date, end_date, created_at', key: 'id', from: 'trips' },
  trip_items: { select: "trip_id, transaction_id, mode, trip_id || '|' || transaction_id AS k", key: "trip_id || '|' || transaction_id", from: 'trip_items' },
  card_settings: { select: 'card, currency, markup_bp, sample_tx_id, sample_charged, updated_at', key: 'card', from: 'card_settings' },
  merchant_aliases: { select: 'alias, merchant, created_at', key: 'alias', from: 'merchant_aliases' },
};

/** Oltre questo numero di cambi conviene riscaricare tutto (es. dopo "svuota il bilancio" o un import grande). */
const MAX_CHANGES = 3000;

/** Dati piccoli che l'app rilegge a ogni sincronizzazione: impostazioni, cambi di oggi, telefoni collegati. */
async function extras(db: D1Database, u: string) {
  const info = await accountInfo(db, u);
  const [{ results: devices }, { results: curs }, { results: sources }, { results: parsers }] = await Promise.all([
    db.prepare('SELECT name, last_capture_at FROM devices WHERE user_id = ? AND revoked_at IS NULL').bind(u).all<{ name: string; last_capture_at: string | null }>(),
    db.prepare('SELECT DISTINCT currency FROM accounts WHERE user_id = ?').bind(u).all<{ currency: string }>(),
    // Per la pagina Carte e banche: da quali notifiche arriva ogni carta (stesse query di GET /api/cards).
    db.prepare('SELECT key, card FROM capture_sources WHERE user_id = ? AND card IS NOT NULL').bind(u).all<{ key: string; card: string }>(),
    db.prepare('SELECT name, app FROM parsers WHERE user_id = ?').bind(u).all<{ name: string; app: string }>(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const rates: Record<string, number | null> = {};
  for (const cur of new Set([...curs.map((x) => x.currency), info.display_currency])) {
    if (cur && cur !== 'EUR') rates[cur] = (await getEurRate(db, cur, today))?.eurPerUnit ?? null;
  }
  return {
    user_id: u, today, rates, devices, card_sources: sources, parsers,
    settings: { timezone: info.timezone, recovery_created_at: info.recovery_created_at, display_currency: info.display_currency, theme: info.theme, home_layout: info.home_layout, features: info.features, hero_style: info.hero_style },
    account: { email: info.email },
  };
}

/** Come all'apertura dell'app (bootstrap): catalogo aggiornato, notifiche rimaste in coda, categorie in attesa. */
function startup(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, u: string) {
  ctx.waitUntil(drainInbound(env, ctx).catch(() => 0));
  ctx.waitUntil(pendingHints(env, ctx, u).catch(() => {}));
}

export const syncApi = new Hono<AppEnv>();

/**
 * Cosa è cambiato dopo `since`. Risposta: `cursor` (da mandare la volta dopo), `changes` (righe nuove o cambiate per
 * tabella), `removed` (chiavi da togliere), più impostazioni, cambi e telefoni. `reset: true` = riscaricare tutto.
 */
syncApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  await upgradeCatalog(db, u);
  startup(c.env, c.executionCtx, u);
  // Il numero più alto PRIMA di leggere i cambi: quello che arriva nel frattempo si rilegge la volta dopo.
  const cursor = (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM sync_log').first<{ s: number }>())?.s ?? 0;
  const since = Number(c.req.query('since')) || 0;
  const floor = Number(await getSetting(db, 'sync_floor')) || 0;
  const more = await extras(db, u);
  if (!since || since < floor || since > cursor) return c.json({ reset: true, cursor, ...more });
  const { results: log } = await db.prepare('SELECT DISTINCT tbl, row_key FROM sync_log WHERE user_id = ? AND seq > ? LIMIT ?')
    .bind(u, since, MAX_CHANGES + 1).all<{ tbl: string; row_key: string }>();
  if (log.length > MAX_CHANGES) return c.json({ reset: true, cursor, ...more });
  const keys = new Map<string, Set<string>>();
  for (const l of log) {
    const tbl = l.tbl === 'transaction_labels' ? 'transactions' : l.tbl;
    if (!SYNC_TABLES[tbl]) continue; // "users": le impostazioni arrivano sempre in `settings`
    keys.set(tbl, (keys.get(tbl) ?? new Set()).add(l.row_key));
  }
  const changes: Record<string, unknown[]> = {};
  const removed: Record<string, string[]> = {};
  for (const [tbl, set] of keys) {
    const t = SYNC_TABLES[tbl];
    const all = [...set];
    const found: Array<Record<string, unknown> & { _k: string }> = [];
    // D1 accetta al massimo 100 parametri per query: a gruppi di 90.
    for (let i = 0; i < all.length; i += 90) {
      const part = all.slice(i, i + 90);
      const { results } = await db.prepare(`SELECT ${t.select}, ${t.key} AS _k FROM ${t.from} WHERE ${t.from.endsWith(' t') ? 't.' : ''}user_id = ? AND ${t.key} IN (${part.map(() => '?').join(',')})`)
        .bind(u, ...part).all<Record<string, unknown> & { _k: string }>();
      found.push(...results);
    }
    const seen = new Set(found.map((r) => r._k));
    changes[tbl] = found.map(({ _k, ...r }) => { void _k; return r; });
    const gone = all.filter((k) => !seen.has(k));
    if (gone.length) removed[tbl] = gone;
  }
  return c.json({ cursor, changes, removed, ...more });
});

/** Scaricamento completo a pagine (per tabella, in ordine di rowid). */
syncApi.get('/full', async (c) => {
  const table = c.req.query('table') ?? '';
  const t = SYNC_TABLES[table];
  if (!t) bad('Tabella sconosciuta');
  const after = Number(c.req.query('after')) || 0;
  const limit = Math.min(Math.max(Number(c.req.query('limit')) || 1000, 1), 2000);
  const alias = t.from.endsWith(' t') ? 't.' : '';
  const { results } = await c.env.DB.prepare(`SELECT ${alias}rowid AS _rowid, ${t.select} FROM ${t.from} WHERE ${alias}user_id = ? AND ${alias}rowid > ? ORDER BY ${alias}rowid LIMIT ?`)
    .bind(uid(c), after, limit).all<Record<string, unknown> & { _rowid: number }>();
  const next = results.length === limit ? results[results.length - 1]._rowid : null;
  return c.json({ rows: results.map(({ _rowid, ...r }) => { void _rowid; return r; }), next });
});

/**
 * Cron: il registro tiene circa 45 giorni. Ogni notte si annota il numero più alto; quello di 45 giorni fa diventa
 * il "pavimento": chi chiede cambi da prima riscarica tutto.
 */
export async function pruneSyncLog(db: D1Database): Promise<void> {
  const top = (await db.prepare('SELECT COALESCE(MAX(seq), 0) AS s FROM sync_log').first<{ s: number }>())?.s ?? 0;
  const today = new Date().toISOString().slice(0, 10);
  let marks: Array<[string, number]> = [];
  try { marks = JSON.parse((await getSetting(db, 'sync_marks')) ?? '[]') as Array<[string, number]>; } catch { marks = []; }
  if (!marks.length || marks[marks.length - 1][0] !== today) marks.push([today, top]);
  const cut = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
  const old = marks.filter(([d]) => d < cut);
  marks = marks.filter(([d]) => d >= cut);
  const floor = old.length ? old[old.length - 1][1] : 0;
  const stmts = [db.prepare("INSERT INTO settings (key, value) VALUES ('sync_marks', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(marks))];
  if (floor) {
    stmts.push(
      db.prepare('DELETE FROM sync_log WHERE seq <= ?').bind(floor),
      db.prepare("INSERT INTO settings (key, value) VALUES ('sync_floor', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(floor)),
    );
  }
  await db.batch(stmts);
}
