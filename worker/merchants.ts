// Negozi con nomi diversi uniti in uno. Unire riscrive il nome nei movimenti vecchi e lascia un "alias"
// (nome in minuscolo → nome scelto) che la cattura e l'inserimento a mano applicano ai movimenti nuovi.
import { Hono } from 'hono';
import { suggestMerges } from '../shared/merchants';
import { bad, body, nowIso, uid, type AppEnv } from './lib';

/** Nome scelto per un negozio, se l'utente l'ha unito a un altro; altrimenti il nome com'è. */
export async function canonicalMerchant(db: D1Database, userId: string, name: string | null): Promise<string | null> {
  if (!name) return name;
  const row = await db.prepare('SELECT merchant FROM merchant_aliases WHERE user_id = ? AND alias = ?').bind(userId, name.trim().toLowerCase()).first<{ merchant: string }>();
  return row?.merchant ?? name;
}

export const merchantsApi = new Hono<AppEnv>();

/** Negozi usati (con quante volte), proposte da unire e nomi già uniti. Legge tutti i movimenti: solo all'apertura della pagina. */
merchantsApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const [list, aliases] = await Promise.all([
    db.prepare(`SELECT merchant, COUNT(*) AS n, COALESCE(SUM(CASE WHEN amount_eur < 0 THEN -amount_eur ELSE 0 END), 0) AS spent
                FROM transactions INDEXED BY tx_user_merchant
                WHERE user_id = ? AND deleted_at IS NULL AND merchant IS NOT NULL AND merchant <> '' AND type <> 'transfer'
                GROUP BY merchant COLLATE NOCASE ORDER BY n DESC`).bind(u).all<{ merchant: string; n: number; spent: number }>(),
    db.prepare('SELECT alias, merchant, created_at FROM merchant_aliases WHERE user_id = ? ORDER BY merchant COLLATE NOCASE, alias').bind(u).all<{ alias: string; merchant: string; created_at: string }>(),
  ]);
  return c.json({ items: list.results, suggestions: suggestMerges(list.results), aliases: aliases.results });
});

/** Unisce più nomi in uno: rinomina i movimenti (anche quelli ricorrenti) e ricorda gli alias per il futuro. */
merchantsApi.post('/merge', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const b = await body<{ into?: string; names?: string[] }>(c);
  const into = (b.into ?? '').trim().slice(0, 80);
  if (!into) bad('Scegli il nome da tenere');
  const names = [...new Set((b.names ?? []).map((n) => String(n ?? '').trim()).filter(Boolean))].slice(0, 50);
  const others = names.filter((n) => n.toLowerCase() !== into.toLowerCase());
  if (!others.length) bad('Scegli almeno un altro nome da unire');
  const now = nowIso();
  const txStmts: D1PreparedStatement[] = [];
  const stmts: D1PreparedStatement[] = [];
  // Anche lo stesso nome scritto con maiuscole diverse prende la forma scelta.
  for (const n of [...others, into]) {
    txStmts.push(
      db.prepare(`UPDATE transactions INDEXED BY tx_user_merchant SET merchant = ?, updated_at = ? WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND merchant <> ? COLLATE BINARY`)
        .bind(into, now, u, n, into),
    );
    stmts.push(db.prepare('UPDATE recurring SET merchant = ?, updated_at = ? WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND merchant <> ? COLLATE BINARY').bind(into, now, u, n, into));
  }
  for (const n of others) {
    stmts.push(
      db.prepare(`INSERT INTO merchant_aliases (user_id, alias, merchant, created_at) VALUES (?, ?, ?, ?)
                  ON CONFLICT (user_id, alias) DO UPDATE SET merchant = excluded.merchant`).bind(u, n.toLowerCase(), into, now),
      // Chi puntava al nome tolto ora punta a quello scelto.
      db.prepare('UPDATE merchant_aliases SET merchant = ? WHERE user_id = ? AND merchant = ? COLLATE NOCASE').bind(into, u, n),
    );
  }
  // Il nome scelto non può essere a sua volta un alias.
  stmts.push(db.prepare('DELETE FROM merchant_aliases WHERE user_id = ? AND alias = ?').bind(u, into.toLowerCase()));
  let changed = 0;
  for (const r of await db.batch(txStmts)) changed += r.meta.changes ?? 0;
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
  return c.json({ into, changed });
});

/** Toglie un nome unito: i movimenti vecchi restano col nome scelto, quelli nuovi tengono il proprio. */
merchantsApi.delete('/alias/:alias', async (c) => {
  const alias = decodeURIComponent(c.req.param('alias')).toLowerCase();
  const r = await c.env.DB.prepare('DELETE FROM merchant_aliases WHERE user_id = ? AND alias = ?').bind(uid(c), alias).run();
  return c.json({ deleted: r.meta.changes ?? 0 });
});
