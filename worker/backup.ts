// Backup locali: export a pagine e import a blocchi.
// Il piano gratuito di Cloudflare concede 10 ms di CPU per richiesta: il file si compone e si
// legge nel browser, il server lavora su pochi righi alla volta.
import { Hono } from 'hono';
import { bad, body, nowIso, runBatch, setSetting, type Env } from './lib';
import { toUtc } from './transactions';
import { isValidTimeZone } from '../shared/time';

export const BACKUP_FORMAT = 'ledgy-backup';
export const BACKUP_VERSION = 1;

/** Tabelle in ordine di dipendenza, con le sole colonne che si esportano e reimportano. */
export const TABLES: Record<string, string[]> = {
  settings: ['key', 'value'],
  accounts: ['id', 'name', 'type', 'currency', 'initial_balance', 'color', 'archived', 'position', 'external_id', 'created_at'],
  categories: ['id', 'name', 'parent_id', 'kind', 'nature', 'color', 'icon', 'position', 'archived', 'external_id'],
  labels: ['id', 'name', 'color', 'external_id'],
  rules: ['id', 'name', 'enabled', 'priority', 'definition', 'created_at', 'updated_at'],
  parsers: ['id', 'name', 'app', 'pattern', 'flags', 'direction', 'default_currency', 'sample', 'enabled', 'created_at'],
  devices: ['id', 'name', 'platform', 'method', 'token_hash', 'token_hint', 'created_at', 'last_seen_at', 'last_capture_at', 'revoked_at'],
  transactions: ['id', 'type', 'account_id', 'amount', 'currency', 'amount_eur', 'fx_rate', 'fx_date', 'occurred_at', 'occurred_utc', 'merchant_raw',
    'merchant', 'note', 'category_id', 'nature', 'card', 'source', 'status', 'review_reason', 'review_choices', 'transfer_group', 'duplicate_of',
    'capture_id', 'rule_ids', 'place', 'lat', 'lng', 'external_id', 'created_at', 'updated_at', 'deleted_at'],
  transaction_labels: ['transaction_id', 'label_id'],
  captures: ['id', 'device_id', 'received_at', 'posted_at', 'app', 'title', 'text', 'hint', 'hash', 'status', 'detail', 'transaction_id'],
};
export const TABLE_ORDER = Object.keys(TABLES);
const SETTINGS_ALLOWED = new Set(['timezone']);

type Row = Record<string, unknown>;
type Maps = { categories?: Record<string, string>; accounts?: Record<string, string>; labels?: Record<string, string> };

export const backupApi = new Hono<{ Bindings: Env }>();

/** Una pagina di una tabella, in ordine di inserimento. */
backupApi.get('/export', async (c) => {
  const table = c.req.query('table') ?? '';
  const cols = TABLES[table];
  if (!cols) bad('Tabella sconosciuta');
  const after = Number(c.req.query('after')) || 0;
  const limit = Math.min(Number(c.req.query('limit')) || 500, 1000);
  const where = table === 'settings' ? `AND key IN (${[...SETTINGS_ALLOWED].map((k) => `'${k}'`).join(',')})` : '';
  const { results } = await c.env.DB
    .prepare(`SELECT rowid AS _rowid, ${cols.join(', ')} FROM ${table} WHERE rowid > ? ${where} ORDER BY rowid LIMIT ?`)
    .bind(after, limit)
    .all<Row & { _rowid: number }>();
  const next = results.length === limit ? results[results.length - 1]._rowid : null;
  return c.json({ rows: results.map(({ _rowid, ...r }) => { void _rowid; return r; }), next });
});

/** Inizio import: in modalità "sostituisci" cancella i dati attuali (non password né sessioni). */
backupApi.post('/import/begin', async (c) => {
  const b = await body<{ mode?: string; format?: string; version?: number }>(c);
  if (b.format !== BACKUP_FORMAT) bad('Questo file non è un backup di Ledgy');
  if ((b.version ?? 0) > BACKUP_VERSION) bad("Il backup viene da una versione più recente di Ledgy: aggiorna l'app");
  if (b.mode !== 'merge' && b.mode !== 'replace') bad('Modalità non valida');
  if (b.mode === 'replace') {
    const db = c.env.DB;
    await db.batch(['transaction_labels', 'captures', 'transactions', 'rules', 'parsers', 'devices', 'labels', 'categories', 'accounts']
      .map((t) => db.prepare(`DELETE FROM ${t}`)));
  }
  return c.json({ ok: true });
});

function pick(row: Row, cols: string[]): unknown[] {
  return cols.map((k) => {
    const v = row[k];
    if (v === undefined) return null;
    if (v !== null && typeof v === 'object') return JSON.stringify(v);
    return v;
  });
}

function insertSql(table: string, cols: string[], verb: 'INSERT OR IGNORE' | 'INSERT OR REPLACE') {
  return `${verb} INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
}

/** Cambia gli id di categorie e conti dentro la definizione di una regola. */
function remapDefinition(json: unknown, maps: Maps): string {
  const def = typeof json === 'string' ? JSON.parse(json) : json;
  const cat = (id: unknown) => (typeof id === 'string' ? maps.categories?.[id] ?? id : id);
  const acc = (id: unknown) => (typeof id === 'string' ? maps.accounts?.[id] ?? id : id);
  const fix = (a: Record<string, unknown> | undefined) => {
    if (!a) return;
    if (a.category_id) a.category_id = cat(a.category_id);
    if (a.account_id) a.account_id = acc(a.account_id);
    if (Array.isArray(a.ask)) a.ask = a.ask.map(cat);
  };
  fix(def?.actions);
  for (const band of def?.bands ?? []) fix(band.actions);
  return JSON.stringify(def);
}

/** Un blocco di righe di una tabella. In "aggiungi" restituisce come sono stati abbinati gli id. */
backupApi.post('/import/chunk', async (c) => {
  const b = await body<{ mode?: 'merge' | 'replace'; table?: string; rows?: Row[]; maps?: Maps }>(c);
  const table = b.table ?? '';
  const cols = TABLES[table];
  if (!cols) bad('Tabella sconosciuta');
  if (!Array.isArray(b.rows)) bad('Righe mancanti');
  if (b.rows.length > 500) bad('Massimo 500 righe per blocco');
  const db = c.env.DB;
  const merge = b.mode === 'merge';
  const maps: Maps = b.maps ?? {};
  const map: Record<string, string> = {};
  // Le categorie madri prima delle figlie, per rispettare i riferimenti.
  let rows = table === 'categories' ? [...b.rows].sort((x, y) => (x.parent_id ? 1 : 0) - (y.parent_id ? 1 : 0)) : b.rows;
  let skipped = 0;

  if (table === 'settings') {
    if (!merge) {
      for (const r of rows) {
        const key = String(r.key);
        if (SETTINGS_ALLOWED.has(key) && (key !== 'timezone' || isValidTimeZone(String(r.value)))) await setSetting(db, key, String(r.value));
      }
    }
    return c.json({ inserted: merge ? 0 : rows.length, skipped: merge ? rows.length : 0 });
  }

  if (merge && (table === 'categories' || table === 'accounts' || table === 'labels')) {
    // Abbina per id, poi per nome (e categoria madre): niente doppioni tra i due insiemi.
    const existing = (await db.prepare(table === 'categories' ? 'SELECT id, name, parent_id FROM categories' : `SELECT id, name FROM ${table}`).all<{ id: string; name: string; parent_id?: string | null }>()).results;
    const byId = new Set(existing.map((e) => e.id));
    const key = (name: unknown, parent: unknown) => `${String(name).trim().toLowerCase()}|${parent ?? ''}`;
    const byName = new Map(existing.map((e) => [key(e.name, e.parent_id ?? null), e.id]));
    const toInsert: Row[] = [];
    for (const r of rows) {
      const id = String(r.id);
      const parent = table === 'categories' && r.parent_id ? (maps.categories?.[String(r.parent_id)] ?? map[String(r.parent_id)] ?? r.parent_id) : null;
      const found = byId.has(id) ? id : byName.get(key(r.name, parent));
      if (found) { map[id] = found; skipped++; continue; }
      const row = table === 'categories' ? { ...r, parent_id: parent } : r;
      toInsert.push(row);
      map[id] = id;
      byId.add(id);
      byName.set(key(r.name, parent), id);
    }
    await runBatch(db, toInsert.map((r) => db.prepare(insertSql(table, cols, 'INSERT OR IGNORE')).bind(...pick(r, cols))));
    return c.json({ inserted: toInsert.length, skipped, map });
  }

  if (table === 'rules') rows = rows.map((r) => ({ ...r, definition: remapDefinition(r.definition, maps) }));
  if (table === 'transactions') {
    rows = rows.map((r) => ({
      ...r,
      account_id: r.account_id ? maps.accounts?.[String(r.account_id)] ?? r.account_id : null,
      category_id: r.category_id ? maps.categories?.[String(r.category_id)] ?? r.category_id : null,
      occurred_utc: r.occurred_utc ?? toUtc(String(r.occurred_at)),
      updated_at: r.updated_at ?? nowIso(),
      created_at: r.created_at ?? nowIso(),
    }));
  }
  if (table === 'transaction_labels') {
    // Collega solo se movimento ed etichetta esistono (un movimento saltato non ha etichette da collegare).
    const links = rows.map((r) => [String(r.transaction_id), String(maps.labels?.[String(r.label_id)] ?? r.label_id)]);
    const stmts = links.map(([t, l]) => db.prepare(
      'INSERT OR IGNORE INTO transaction_labels (transaction_id, label_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ?) AND EXISTS (SELECT 1 FROM labels WHERE id = ?)',
    ).bind(t, l, t, l));
    let inserted = 0;
    for (let i = 0; i < stmts.length; i += 50) for (const r of await db.batch(stmts.slice(i, i + 50))) inserted += r.meta.changes ?? 0;
    return c.json({ inserted, skipped: rows.length - inserted });
  }
  if (table === 'captures' && merge) {
    const devs = new Set((await db.prepare('SELECT id FROM devices').all<{ id: string }>()).results.map((d) => d.id));
    rows = rows.map((r) => ({ ...r, device_id: r.device_id && devs.has(String(r.device_id)) ? r.device_id : null }));
  }

  // "Aggiungi" non tocca ciò che esiste già (stesso id); "sostituisci" scrive tutto.
  const stmts = rows.map((r) => db.prepare(insertSql(table, cols, merge ? 'INSERT OR IGNORE' : 'INSERT OR REPLACE')).bind(...pick(r, cols)));
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await db.batch(stmts.slice(i, i + 50));
    for (const r of res) inserted += r.meta.changes ?? 0;
  }
  return c.json({ inserted, skipped: rows.length - inserted });
});
