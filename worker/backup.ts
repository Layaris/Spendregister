// Backup locali dell'account: export a pagine e import a blocchi.
// Il piano gratuito di Cloudflare concede 10 ms di CPU per richiesta: il file si compone e si
// legge nel browser, il server lavora su pochi righi alla volta.
// Sicurezza tra account: l'import non sovrascrive mai righe esistenti. Se un id del file appartiene
// già a un altro account, la riga riceve un id nuovo (id~account) e i riferimenti seguono lo stesso cambio.
import { Hono } from 'hono';
import { isValidTimeZone } from '../shared/time';
import { bad, body, nowIso, uid, type AppEnv } from './lib';
import { toUtc } from './transactions';

export const BACKUP_FORMAT = 'ledgy-backup';
export const BACKUP_VERSION = 1;

/** Tabelle in ordine di dipendenza, con le sole colonne che si esportano e reimportano (mai user_id). */
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
  favorites: ['id', 'name', 'type', 'amount', 'currency', 'merchant', 'category_id', 'account_id', 'note', 'position', 'created_at'],
  capture_sources: ['key', 'card', 'account_id', 'updated_at'],
};
export const TABLE_ORDER = Object.keys(TABLES);
const OWNED = ['accounts', 'categories', 'labels', 'rules', 'parsers', 'devices', 'transactions', 'captures', 'favorites'] as const;
type Owned = (typeof OWNED)[number];

type Row = Record<string, unknown>;
type Maps = { categories?: Record<string, string>; accounts?: Record<string, string>; labels?: Record<string, string> };

export const backupApi = new Hono<AppEnv>();

/** Una pagina di una tabella dell'account, in ordine di inserimento. */
backupApi.get('/export', async (c) => {
  const table = c.req.query('table') ?? '';
  const cols = TABLES[table];
  if (!cols) bad('Tabella sconosciuta');
  const u = uid(c);
  if (table === 'settings') {
    const s = await c.env.DB.prepare('SELECT timezone, display_currency, theme, home_layout FROM users WHERE id = ?').bind(u).first<{ timezone: string; display_currency: string; theme: string; home_layout: string | null }>();
    // Chiavi e scelte dell'AI: nel backup, così passano a un altro account o a un'installazione nuova (scelta del proprietario).
    const ai = await c.env.DB.prepare('SELECT enabled, gemini_key, nanogpt_key, gemini_model, nanogpt_model FROM ai_settings WHERE user_id = ?').bind(u).first();
    return c.json({ rows: [
      ...(ai ? [{ key: 'ai', value: JSON.stringify(ai) }] : []),
      { key: 'timezone', value: s?.timezone ?? 'Asia/Makassar' }, { key: 'display_currency', value: s?.display_currency ?? 'EUR' }, { key: 'theme', value: s?.theme ?? 'light' }, { key: 'home_layout', value: s?.home_layout ?? null },
    ], next: null });
  }
  const after = Number(c.req.query('after')) || 0;
  const limit = Math.min(Number(c.req.query('limit')) || 500, 1000);
  const owner = table === 'transaction_labels' ? 'transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)' : 'user_id = ?';
  const { results } = await c.env.DB
    .prepare(`SELECT rowid AS _rowid, ${cols.join(', ')} FROM ${table} WHERE ${owner} AND rowid > ? ORDER BY rowid LIMIT ?`)
    .bind(u, after, limit)
    .all<Row & { _rowid: number }>();
  const next = results.length === limit ? results[results.length - 1]._rowid : null;
  return c.json({ rows: results.map(({ _rowid, ...r }) => { void _rowid; return r; }), next });
});

/** Inizio import: in modalità "sostituisci" cancella i dati dell'account (non password né sessioni). */
backupApi.post('/import/begin', async (c) => {
  const b = await body<{ mode?: string; format?: string; version?: number }>(c);
  if (b.format !== BACKUP_FORMAT) bad('Questo file non è un backup di Ledgy');
  if ((b.version ?? 0) > BACKUP_VERSION) bad("Il backup viene da una versione più recente di Ledgy: aggiorna l'app");
  if (b.mode !== 'merge' && b.mode !== 'replace') bad('Modalità non valida');
  if (b.mode === 'replace') {
    const db = c.env.DB;
    const u = uid(c);
    await db.batch([
      db.prepare('DELETE FROM transaction_labels WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)').bind(u),
      ...['capture_sources', 'favorites', 'captures', 'transactions', 'rules', 'parsers', 'devices', 'labels', 'categories', 'accounts'].map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(u)),
    ]);
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

/** Id del file già usati da un altro account, per la tabella indicata. */
async function foreignIds(db: D1Database, table: Owned, ids: unknown[], userId: string): Promise<Set<string>> {
  const list = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  const out = new Set<string>();
  for (let i = 0; i < list.length; i += 90) {
    const part = list.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id FROM ${table} WHERE user_id <> ? AND id IN (${part.map(() => '?').join(',')})`)
      .bind(userId, ...part)
      .all<{ id: string }>();
    for (const r of results) out.add(r.id);
  }
  return out;
}

/** Traduttore di id per una tabella: abbinamenti per nome (solo "aggiungi"), poi id di altri account. */
async function translator(db: D1Database, table: Owned, ids: unknown[], userId: string, map?: Record<string, string>) {
  const foreign = await foreignIds(db, table, ids.map((x) => (typeof x === 'string' ? map?.[x] ?? x : x)), userId);
  return (x: unknown): string | null => {
    if (typeof x !== 'string' || !x) return null;
    const v = map?.[x] ?? x;
    return foreign.has(v) ? `${v}~${userId}` : v;
  };
}

/** Cambia gli id di categorie e conti dentro la definizione di una regola. */
function remapDefinition(json: unknown, cat: (x: unknown) => string | null, acc: (x: unknown) => string | null): string {
  const def = typeof json === 'string' ? JSON.parse(json) : json;
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

function ruleRefs(json: unknown): { cats: string[]; accs: string[] } {
  const def = typeof json === 'string' ? JSON.parse(json) : json;
  const cats: string[] = [];
  const accs: string[] = [];
  for (const a of [def?.actions, ...(def?.bands ?? []).map((b: { actions?: unknown }) => b.actions)]) {
    if (!a) continue;
    if (a.category_id) cats.push(a.category_id);
    if (a.account_id) accs.push(a.account_id);
    for (const x of a.ask ?? []) cats.push(x);
  }
  return { cats, accs };
}

async function insertAll(db: D1Database, table: string, cols: string[], rows: Row[], userId: string) {
  const sql = `INSERT OR IGNORE INTO ${table} (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`;
  const stmts = rows.map((r) => db.prepare(sql).bind(userId, ...pick(r, cols)));
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 50) for (const res of await db.batch(stmts.slice(i, i + 50))) inserted += res.meta.changes ?? 0;
  return inserted;
}

/** Un blocco di righe di una tabella. In "aggiungi" restituisce come sono stati abbinati gli id per nome. */
backupApi.post('/import/chunk', async (c) => {
  const b = await body<{ mode?: 'merge' | 'replace'; table?: string; rows?: Row[]; maps?: Maps }>(c);
  const table = b.table ?? '';
  const cols = TABLES[table];
  if (!cols) bad('Tabella sconosciuta');
  if (!Array.isArray(b.rows)) bad('Righe mancanti');
  if (b.rows.length > 500) bad('Massimo 500 righe per blocco');
  const db = c.env.DB;
  const u = uid(c);
  const merge = b.mode === 'merge';
  const maps: Maps = b.maps ?? {};
  // Le categorie madri prima delle figlie, per rispettare i riferimenti.
  const rows = table === 'categories' ? [...b.rows].sort((x, y) => (x.parent_id ? 1 : 0) - (y.parent_id ? 1 : 0)) : b.rows;

  if (table === 'settings') {
    // AI: in "sostituisci" vince il backup; in "aggiungi" riempie solo ciò che manca.
    const aiRow = rows.find((r) => r.key === 'ai')?.value;
    if (typeof aiRow === 'string') {
      try {
        const a = JSON.parse(aiRow) as { enabled?: number; gemini_key?: string | null; nanogpt_key?: string | null; gemini_model?: string | null; nanogpt_model?: string | null };
        const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null);
        await db.prepare(`INSERT INTO ai_settings (user_id, enabled, gemini_key, nanogpt_key, gemini_model, nanogpt_model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                          ON CONFLICT (user_id) DO UPDATE SET
                            enabled = CASE WHEN ? THEN excluded.enabled ELSE ai_settings.enabled END,
                            gemini_key = CASE WHEN ? THEN COALESCE(excluded.gemini_key, ai_settings.gemini_key) ELSE COALESCE(ai_settings.gemini_key, excluded.gemini_key) END,
                            nanogpt_key = CASE WHEN ? THEN COALESCE(excluded.nanogpt_key, ai_settings.nanogpt_key) ELSE COALESCE(ai_settings.nanogpt_key, excluded.nanogpt_key) END,
                            gemini_model = COALESCE(CASE WHEN ? THEN excluded.gemini_model ELSE ai_settings.gemini_model END, ai_settings.gemini_model, excluded.gemini_model),
                            nanogpt_model = COALESCE(CASE WHEN ? THEN excluded.nanogpt_model ELSE ai_settings.nanogpt_model END, ai_settings.nanogpt_model, excluded.nanogpt_model),
                            gemini_paused_until = NULL, updated_at = excluded.updated_at`)
          .bind(u, a.enabled === 0 ? 0 : 1, str(a.gemini_key), str(a.nanogpt_key), str(a.gemini_model), str(a.nanogpt_model), nowIso(), !merge, !merge, !merge, !merge, !merge)
          .run();
      } catch { /* riga illeggibile: si ignora */ }
    }
    if (!merge) {
      const get = (k: string) => rows.find((r) => r.key === k)?.value;
      const tz = get('timezone');
      if (typeof tz === 'string' && isValidTimeZone(tz)) await db.prepare('UPDATE users SET timezone = ? WHERE id = ?').bind(tz, u).run();
      const cur = get('display_currency');
      if (typeof cur === 'string' && /^[A-Z]{3}$/.test(cur)) await db.prepare('UPDATE users SET display_currency = ? WHERE id = ?').bind(cur, u).run();
      const theme = get('theme');
      if (typeof theme === 'string' && ['light', 'blue', 'dark', 'system'].includes(theme)) await db.prepare('UPDATE users SET theme = ? WHERE id = ?').bind(theme, u).run();
      const home = get('home_layout');
      if (typeof home === 'string') {
        try { if (Array.isArray(JSON.parse(home))) await db.prepare('UPDATE users SET home_layout = ? WHERE id = ?').bind(home, u).run(); } catch { /* ignora */ }
      }
    }
    return c.json({ inserted: merge ? 0 : rows.length, skipped: merge ? rows.length : 0 });
  }

  if (table === 'categories' || table === 'accounts' || table === 'labels') {
    const map: Record<string, string> = {};
    let skipped = 0;
    const toInsert: Row[] = [];
    const tr = await translator(db, table, rows.map((r) => r.id), u);
    const parentTr = table === 'categories' ? await translator(db, 'categories', rows.map((r) => r.parent_id), u, maps.categories) : null;
    // Abbinamento con ciò che l'account ha già: per id e, in "aggiungi", per nome (e categoria madre).
    const existing = (await db.prepare(table === 'categories' ? 'SELECT id, name, parent_id FROM categories WHERE user_id = ?' : `SELECT id, name FROM ${table} WHERE user_id = ?`)
      .bind(u).all<{ id: string; name: string; parent_id?: string | null }>()).results;
    const byId = new Set(existing.map((e) => e.id));
    const key = (name: unknown, parent: unknown) => `${String(name).trim().toLowerCase()}|${parent ?? ''}`;
    const byName = new Map(existing.map((e) => [key(e.name, e.parent_id ?? null), e.id]));
    for (const r of rows) {
      const original = String(r.id);
      const id = tr(original)!;
      const parent = parentTr && r.parent_id ? (map[String(r.parent_id)] ?? parentTr(r.parent_id)) : null;
      const found = byId.has(id) ? id : merge ? byName.get(key(r.name, parent)) : undefined;
      if (found) { map[original] = found; skipped++; continue; }
      toInsert.push({ ...r, id, ...(table === 'categories' ? { parent_id: parent } : {}) });
      map[original] = id;
      byId.add(id);
      byName.set(key(r.name, parent), id);
    }
    const inserted = await insertAll(db, table, cols, toInsert, u);
    return c.json({ inserted, skipped: skipped + toInsert.length - inserted, map });
  }

  const catTr = async (ids: unknown[]) => translator(db, 'categories', ids, u, maps.categories);
  const accTr = async (ids: unknown[]) => translator(db, 'accounts', ids, u, maps.accounts);
  let out: Row[] = rows;

  if (table === 'rules') {
    const refs = rows.map((r) => ruleRefs(r.definition));
    const cat = await catTr(refs.flatMap((x) => x.cats));
    const acc = await accTr(refs.flatMap((x) => x.accs));
    const id = await translator(db, 'rules', rows.map((r) => r.id), u);
    out = rows.map((r) => ({ ...r, id: id(r.id), definition: remapDefinition(r.definition, cat, acc) }));
  } else if (table === 'parsers' || table === 'devices') {
    const id = await translator(db, table, rows.map((r) => r.id), u);
    out = rows.map((r) => ({ ...r, id: id(r.id) }));
  } else if (table === 'transactions') {
    const id = await translator(db, 'transactions', rows.flatMap((r) => [r.id, r.duplicate_of]), u);
    const cap = await translator(db, 'captures', rows.map((r) => r.capture_id), u);
    const cat = await catTr(rows.map((r) => r.category_id));
    const acc = await accTr(rows.map((r) => r.account_id));
    out = rows.map((r) => ({
      ...r,
      id: id(r.id),
      duplicate_of: id(r.duplicate_of),
      capture_id: cap(r.capture_id),
      account_id: acc(r.account_id),
      category_id: cat(r.category_id),
      occurred_utc: r.occurred_utc ?? toUtc(String(r.occurred_at)),
      updated_at: r.updated_at ?? nowIso(),
      created_at: r.created_at ?? nowIso(),
    }));
  } else if (table === 'favorites') {
    const id = await translator(db, 'favorites', rows.map((r) => r.id), u);
    const cat = await catTr(rows.map((r) => r.category_id));
    const acc = await accTr(rows.map((r) => r.account_id));
    out = rows.map((r) => ({ ...r, id: id(r.id), category_id: cat(r.category_id), account_id: acc(r.account_id), created_at: r.created_at ?? nowIso() }));
  } else if (table === 'capture_sources') {
    const acc = await accTr(rows.map((r) => r.account_id));
    out = rows.map((r) => ({ ...r, account_id: acc(r.account_id), updated_at: r.updated_at ?? nowIso() }));
  } else if (table === 'captures') {
    const id = await translator(db, 'captures', rows.map((r) => r.id), u);
    const txId = await translator(db, 'transactions', rows.map((r) => r.transaction_id), u);
    const dev = await translator(db, 'devices', rows.map((r) => r.device_id), u);
    const own = new Set((await db.prepare('SELECT id FROM devices WHERE user_id = ?').bind(u).all<{ id: string }>()).results.map((d) => d.id));
    out = rows.map((r) => {
      const d = dev(r.device_id);
      return { ...r, id: id(r.id), transaction_id: txId(r.transaction_id), device_id: d && own.has(d) ? d : null };
    });
  } else if (table === 'transaction_labels') {
    // Collega solo se movimento ed etichetta esistono e sono dell'account.
    const txId = await translator(db, 'transactions', rows.map((r) => r.transaction_id), u);
    const lab = await translator(db, 'labels', rows.map((r) => r.label_id), u, maps.labels);
    const stmts = rows.map((r) => {
      const t = txId(r.transaction_id);
      const l = lab(r.label_id);
      return db.prepare(
        'INSERT OR IGNORE INTO transaction_labels (transaction_id, label_id) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM transactions WHERE id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM labels WHERE id = ? AND user_id = ?)',
      ).bind(t, l, t, u, l, u);
    });
    let inserted = 0;
    for (let i = 0; i < stmts.length; i += 50) for (const res of await db.batch(stmts.slice(i, i + 50))) inserted += res.meta.changes ?? 0;
    return c.json({ inserted, skipped: rows.length - inserted });
  }

  // Le righe che puntano a categorie o conti mancanti perdono il riferimento invece di far fallire il blocco.
  if (table === 'transactions' || table === 'favorites' || table === 'capture_sources') {
    const cats = new Set((await db.prepare('SELECT id FROM categories WHERE user_id = ?').bind(u).all<{ id: string }>()).results.map((x) => x.id));
    const accs = new Set((await db.prepare('SELECT id FROM accounts WHERE user_id = ?').bind(u).all<{ id: string }>()).results.map((x) => x.id));
    out = out.map((r) => ({ ...r, category_id: r.category_id && cats.has(String(r.category_id)) ? r.category_id : null, account_id: r.account_id && accs.has(String(r.account_id)) ? r.account_id : null }));
  }
  const inserted = await insertAll(db, table, cols, out, u);
  return c.json({ inserted, skipped: out.length - inserted });
});
