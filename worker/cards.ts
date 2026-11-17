// Carte e banche: da quale carta arriva una spesa. Si impara dalla fonte della notifica (titolo su iPhone,
// app su Android) e si gestisce in Impostazioni › Carte e banche. La carta non è una categoria: divide lo
// stesso totale delle spese, non si somma ad esso.
import { Hono } from 'hono';
import { appLabel } from '../shared/apps';
import { body, nowIso, uid, type AppEnv } from './lib';

const clean = (v: string | null | undefined) => (v == null ? null : v.trim().slice(0, 60) || null);

/**
 * Ricorda carta (e conto) per una fonte di notifiche e li applica ai movimenti già arrivati da lì.
 * `card`/`account` non indicati restano come erano (la carta, se la fonte è nuova, è `fallbackCard`).
 */
export async function learnSource(db: D1Database, userId: string, key: string, card: string | null | undefined, account: string | null | undefined, fallbackCard: string | null = null) {
  const old = await db.prepare('SELECT card, account_id FROM capture_sources WHERE user_id = ? AND key = ?').bind(userId, key).first<{ card: string | null; account_id: string | null }>();
  const nextCard = card !== undefined ? clean(card) : old?.card ?? fallbackCard;
  const nextAccount = account !== undefined ? account : old?.account_id ?? null;
  const same = `capture_id IN (SELECT id FROM captures WHERE user_id = ? AND lower(COALESCE(NULLIF(app, ''), title)) = ?)`;
  const res = await db.batch([
    db.prepare(`INSERT INTO capture_sources (user_id, key, card, account_id, updated_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, key) DO UPDATE SET card = excluded.card, account_id = excluded.account_id, updated_at = excluded.updated_at`)
      .bind(userId, key, nextCard, nextAccount, nowIso()),
    db.prepare(`UPDATE transactions SET card = ? WHERE user_id = ? AND ${same}`).bind(nextCard, userId, userId, key),
  ]);
  return { card: nextCard, applied: res[1].meta.changes ?? 0 };
}

export const cardsApi = new Hono<AppEnv>();

/** Tutte le carte conosciute: dai movimenti, dalle fonti imparate e dai lettori per banca. */
cardsApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const month = new Date().toISOString().slice(0, 7);
  const [txs, sources, parsers] = await Promise.all([
    db.prepare(`SELECT card AS name, COUNT(*) AS count,
                  COALESCE(SUM(CASE WHEN amount_eur < 0 AND substr(occurred_at, 1, 7) = ? THEN -amount_eur ELSE 0 END), 0) AS month_spent
                FROM transactions WHERE user_id = ? AND deleted_at IS NULL AND duplicate_of IS NULL AND card IS NOT NULL GROUP BY card`)
      .bind(month, u).all<{ name: string; count: number; month_spent: number }>(),
    db.prepare('SELECT key, card FROM capture_sources WHERE user_id = ? AND card IS NOT NULL').bind(u).all<{ key: string; card: string }>(),
    db.prepare('SELECT name, app FROM parsers WHERE user_id = ?').bind(u).all<{ name: string; app: string }>(),
  ]);
  const map = new Map<string, { name: string; count: number; month_spent: number; sources: string[] }>();
  const get = (name: string) => {
    if (!map.has(name)) map.set(name, { name, count: 0, month_spent: 0, sources: [] });
    return map.get(name)!;
  };
  for (const t of txs.results) Object.assign(get(t.name), { count: t.count, month_spent: t.month_spent });
  // Fonti con un nome leggibile: "com.revolut.revolut" diventa "Revolut".
  const add = (name: string, key: string) => { const x = get(name); const label = appLabel(key) ?? key; if (!x.sources.includes(label)) x.sources.push(label); };
  for (const s of sources.results) add(s.card, s.key);
  for (const p of parsers.results) add(p.name, p.app.toLowerCase());
  return c.json({ items: [...map.values()].sort((a, b) => b.month_spent - a.month_spent || b.count - a.count || a.name.localeCompare(b.name)) });
});

/** Rinomina una carta ovunque (movimenti, fonti, lettori). Con `to` vuoto la carta si toglie. */
cardsApi.post('/rename', async (c) => {
  const b = await body<{ from?: string; to?: string | null }>(c);
  const from = clean(b.from);
  if (!from) return c.json({ error: 'Carta mancante' }, 400);
  const to = clean(b.to);
  const db = c.env.DB;
  const u = uid(c);
  const res = await db.batch([
    db.prepare('UPDATE transactions SET card = ? WHERE user_id = ? AND card = ?').bind(to, u, from),
    db.prepare('UPDATE capture_sources SET card = ?, updated_at = ? WHERE user_id = ? AND card = ?').bind(to, nowIso(), u, from),
    ...(to ? [db.prepare('UPDATE parsers SET name = ? WHERE user_id = ? AND name = ?').bind(to, u, from)] : []),
  ]);
  return c.json({ ok: true, changed: res[0].meta.changes ?? 0 });
});
