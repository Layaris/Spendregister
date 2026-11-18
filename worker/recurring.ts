// Spese ricorrenti: proposte dallo storico (shared/recurring.ts), confermate o scartate dall'utente.
import { Hono } from 'hono';
import { detectRecurring, graceDays, matchWindowDays, nextDate, nextDue, perMonth, type Occurrence, type Period } from '../shared/recurring';
import { sameMerchant } from '../shared/merchants';
import { normalizePostedAt, zonedIso } from '../shared/time';
import { bad, body, newId, notFound, nowIso, uid, type AppEnv, type Env } from './lib';
import { defaultAccountId, insertTransaction } from './transactions';

export const recurringApi = new Hono<AppEnv>();

const PERIODS: Period[] = ['week', 'month', 'year'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

recurringApi.get('/', async (c) => {
  const db = c.env.DB;
  const u = uid(c);
  const today = DAY.test(c.req.query('today') ?? '') ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 800 * 86400_000).toISOString().slice(0, 10);
  const [saved, rows, mine] = await Promise.all([
    db.prepare('SELECT id, merchant, category_id, amount_eur, period, every, status, last_date, auto_add, account_id, amount, currency FROM recurring WHERE user_id = ?').bind(u)
      .all<{ id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; every: number; status: string; last_date: string | null; auto_add: number; account_id: string | null; amount: number | null; currency: string | null }>(),
    // Un solo passaggio sul periodo; i negozi con una spesa sola si scartano qui sotto.
    db.prepare(`SELECT merchant, substr(occurred_at, 1, 10) AS day, amount_eur, category_id FROM transactions
      WHERE user_id = ?1 AND deleted_at IS NULL AND duplicate_of IS NULL AND type = 'expense' AND merchant IS NOT NULL AND occurred_at >= ?2
      ORDER BY occurred_at`).bind(u, since).all<Occurrence>(),
    // L'ultima spesa di ogni ricorrente confermata (anche se segnata a mano da una spesa sola).
    db.prepare(`SELECT merchant, substr(occurred_at, 1, 10) AS day, amount_eur, category_id FROM transactions INDEXED BY tx_user_merchant
      WHERE user_id = ?1 AND deleted_at IS NULL AND type = 'expense' AND merchant COLLATE NOCASE IN (SELECT merchant FROM recurring WHERE user_id = ?1 AND status = 'confirmed')
      ORDER BY occurred_at`).bind(u).all<Occurrence>(),
  ]);
  const known = new Set(saved.results.map((r) => r.merchant.trim().toLowerCase()));
  const seen = new Map<string, number>();
  for (const r of rows.results) seen.set(r.merchant.toLowerCase(), (seen.get(r.merchant.toLowerCase()) ?? 0) + 1);
  const suggestions = detectRecurring(rows.results.filter((r) => (seen.get(r.merchant.toLowerCase()) ?? 0) >= 2), today, known);
  // Le confermate: ultima volta, prossima, in ritardo, prezzo cambiato.
  const last = new Map<string, Occurrence>();
  for (const r of mine.results) last.set(r.merchant.trim().toLowerCase(), r);
  const confirmed = saved.results.filter((r) => r.status === 'confirmed').map((r) => {
    const every = r.every || 1;
    const l = last.get(r.merchant.trim().toLowerCase());
    const due = nextDue(r.period, every, l?.day ?? null, r.last_date, today);
    const next = due.next;
    // In ritardo: c'è già stata una spesa del negozio e la successiva non è arrivata entro qualche giorno
    // (non per quelle che registra Ledgy da sola).
    const late = !!l && !!next && !r.auto_add && Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${next}T00:00:00Z`)) / 86400_000) > graceDays(r.period, every);
    const changed = l && Math.abs(l.amount_eur - r.amount_eur) > Math.abs(r.amount_eur) * 0.05 ? l.amount_eur : null;
    return { ...r, every, last_date: l?.day ?? null, next_date: next, late, new_amount: changed, per_month: perMonth(r.amount_eur, r.period, every) };
  }).sort((a, b) => (a.next_date ?? '9').localeCompare(b.next_date ?? '9'));
  return c.json({ confirmed, suggestions, per_month: confirmed.reduce((s, r) => s + r.per_month, 0), dismissed: saved.results.filter((r) => r.status === 'dismissed').length });
});

const everyOf = (v: unknown) => { const n = Math.round(Number(v ?? 1)); return n >= 1 && n <= 24 ? n : null; };

/**
 * Conferma (o scarta) una spesa ricorrente per un negozio, oppure la aggiunge a mano (next_date: prossimo addebito).
 * Una sola per negozio.
 */
recurringApi.post('/', async (c) => {
  const b = await body<{ merchant?: string; period?: Period; every?: number; amount_eur?: number; category_id?: string | null; status?: 'confirmed' | 'dismissed'; next_date?: string;
    auto_add?: boolean; account_id?: string | null; amount?: number | null; currency?: string | null }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const merchant = String(b.merchant ?? '').trim().slice(0, 200);
  if (!merchant) bad('Negozio mancante');
  if (!b.period || !PERIODS.includes(b.period)) bad('Ogni quanto?');
  const every = everyOf(b.every);
  if (!every) bad('Ogni quanto?');
  const anchor = typeof b.next_date === 'string' && DAY.test(b.next_date) ? b.next_date : null;
  const status = b.status === 'dismissed' ? 'dismissed' : 'confirmed';
  const amount = Math.round(Number(b.amount_eur));
  if (!Number.isFinite(amount)) bad('Importo non valido');
  let cat = b.category_id ?? null;
  if (cat && !(await db.prepare('SELECT 1 FROM categories WHERE id = ? AND user_id = ?').bind(cat, u).first())) cat = null;
  // Come si paga: con una carta che Ledgy legge (aspetta la notifica) o altrove (PayPal, bonifico…: la registra Ledgy).
  const auto = b.auto_add ? 1 : 0;
  const account = b.account_id && (await db.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').bind(b.account_id, u).first()) ? b.account_id : null;
  const currency = typeof b.currency === 'string' && /^[A-Z]{3}$/.test(b.currency) ? b.currency : null;
  const original = currency && Number.isFinite(Number(b.amount)) && Number(b.amount) !== 0 ? -Math.abs(Math.round(Number(b.amount))) : null;
  const now = nowIso();
  await db.prepare(`INSERT INTO recurring (id, user_id, merchant, category_id, amount_eur, period, every, status, last_date, auto_add, account_id, amount, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id, merchant) DO UPDATE SET category_id = excluded.category_id, amount_eur = excluded.amount_eur, period = excluded.period, every = excluded.every,
        status = excluded.status, last_date = COALESCE(excluded.last_date, recurring.last_date), auto_add = excluded.auto_add,
        account_id = COALESCE(excluded.account_id, recurring.account_id), amount = COALESCE(excluded.amount, recurring.amount),
        currency = COALESCE(excluded.currency, recurring.currency), updated_at = excluded.updated_at`)
    .bind(newId('rec'), u, merchant, cat, -Math.abs(amount), b.period, every, status, anchor, auto, account, original, original ? currency : null, now, now).run();
  return c.json({ ok: true });
});

/** Aggiorna l'importo (es. prezzo cambiato) o la frequenza. */
recurringApi.put('/:id', async (c) => {
  const b = await body<{ amount_eur?: number; period?: Period; every?: number; auto_add?: boolean; account_id?: string | null; next_date?: string }>(c);
  const sets: string[] = [];
  const args: unknown[] = [];
  if (b.auto_add != null) { sets.push('auto_add = ?'); args.push(b.auto_add ? 1 : 0); }
  if (b.account_id !== undefined) {
    if (b.account_id && !(await c.env.DB.prepare('SELECT 1 FROM accounts WHERE id = ? AND user_id = ?').bind(b.account_id, uid(c)).first())) bad('Conto non valido');
    sets.push('account_id = ?'); args.push(b.account_id || null);
  }
  if (b.next_date != null) { if (!DAY.test(b.next_date)) bad('Data non valida'); sets.push('last_date = ?'); args.push(b.next_date); }
  // Prezzo cambiato: l'importo originale (se c'è) si riallinea alla prossima registrazione automatica.
  if (b.amount_eur != null) { sets.push('amount_eur = ?', 'amount = NULL', 'currency = NULL'); args.push(-Math.abs(Math.round(Number(b.amount_eur)))); }
  if (b.period) { if (!PERIODS.includes(b.period)) bad('Ogni quanto?'); sets.push('period = ?'); args.push(b.period); }
  if (b.every != null) { const e = everyOf(b.every); if (!e) bad('Ogni quanto?'); sets.push('every = ?'); args.push(e); }
  if (!sets.length) bad('Niente da cambiare');
  const r = await c.env.DB.prepare(`UPDATE recurring SET ${sets.join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?`).bind(...args, nowIso(), c.req.param('id'), uid(c)).run();
  if (!r.meta.changes) notFound('Spesa ricorrente non trovata');
  return c.json({ ok: true });
});

recurringApi.delete('/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM recurring WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

/** Stato di un negozio (per il dettaglio di un movimento). */
recurringApi.get('/of/:merchant', async (c) => {
  const r = await c.env.DB.prepare('SELECT id, period, every, status, auto_add, account_id, last_date FROM recurring WHERE user_id = ? AND lower(merchant) = lower(?)')
    .bind(uid(c), c.req.param('merchant')).first<{ id: string; period: Period; every: number; status: string; auto_add: number; account_id: string | null; last_date: string | null }>();
  if (!r) return c.json({ item: null });
  const today = DAY.test(c.req.query('today') ?? '') ? c.req.query('today')! : new Date().toISOString().slice(0, 10);
  const last = await c.env.DB.prepare(`SELECT MAX(substr(occurred_at, 1, 10)) AS day FROM transactions INDEXED BY tx_user_merchant
      WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND type = 'expense' AND deleted_at IS NULL`).bind(uid(c), c.req.param('merchant')).first<{ day: string | null }>();
  return c.json({ item: { ...r, auto_add: !!r.auto_add, next_date: nextDue(r.period, r.every || 1, last?.day ?? null, r.last_date, today).next } });
});

interface AutoRec { id: string; user_id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; every: number; last_date: string | null; account_id: string | null; amount: number | null; currency: string | null; timezone: string | null }

/**
 * Cron del mattino: registra le spese ricorrenti pagate fuori dalle carte lette da Ledgy, alla loro data.
 * Niente doppioni: se nei giorni vicini (2 per le settimanali, 5 per le altre) c'è già una spesa dello stesso negozio,
 * anche scritto diverso, quella vale come addebito di questo giro. `external_id = rec:<id>:<data>` evita di ripeterla.
 */
export async function runRecurring(env: Env): Promise<number> {
  const db = env.DB;
  const { results } = await db.prepare(`SELECT r.id, r.user_id, r.merchant, r.category_id, r.amount_eur, r.period, r.every, r.last_date, r.account_id, r.amount, r.currency, u.timezone
      FROM recurring r JOIN users u ON u.id = r.user_id WHERE r.auto_add = 1 AND r.status = 'confirmed'`).all<AutoRec>();
  let created = 0;
  for (const r of results) {
    try {
      const tz = r.timezone ?? 'Asia/Makassar';
      const today = zonedIso(new Date(), tz).slice(0, 10);
      const every = r.every || 1;
      const w = matchWindowDays(r.period, every);
      const last = await db.prepare(`SELECT MAX(substr(occurred_at, 1, 10)) AS day FROM transactions INDEXED BY tx_user_merchant
          WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND type = 'expense' AND deleted_at IS NULL`).bind(r.user_id, r.merchant).first<{ day: string | null }>();
      let due = nextDue(r.period, every, last?.day ?? null, r.last_date, today).next;
      // Al massimo 3 giri arretrati (es. server fermo): non si riempie lo storico di colpo.
      for (let i = 0; i < 3 && due && due <= today; i++) {
        const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
        const { results: near } = await db.prepare(`SELECT merchant FROM transactions INDEXED BY tx_user_occurred
            WHERE user_id = ? AND type = 'expense' AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ? LIMIT 500`)
          .bind(r.user_id, shift(due, -w), shift(due, w + 1)).all<{ merchant: string | null }>();
        const following = nextDate(due, r.period, every);
        if (near.some((t) => sameMerchant(t.merchant, r.merchant))) {
          // Già pagata (con un nome un po' diverso): questo giro è fatto, la prossima si conta da qui.
          await db.prepare('UPDATE recurring SET last_date = ?, updated_at = ? WHERE id = ?').bind(following, nowIso(), r.id).run();
        } else {
          const original = r.amount != null && r.currency;
          try {
            await insertTransaction(db, r.user_id, {
              type: 'expense', account_id: r.account_id ?? (await defaultAccountId(db, r.user_id)), amount: original ? r.amount! : r.amount_eur, currency: original ? r.currency! : 'EUR',
              occurred_at: normalizePostedAt(`${due} 09:00`, tz), merchant: r.merchant, merchant_raw: r.merchant, category_id: r.category_id,
              note: 'Registrata da sola (spesa ricorrente)', source: 'recurring', external_id: `rec:${r.id}:${due}`, status: 'confirmed',
            });
            created++;
          } catch { /* già registrata (stesso external_id) */ }
        }
        due = following;
      }
    } catch { /* una ricorrente con un problema non ferma le altre */ }
  }
  return created;
}

/**
 * Arriva una spesa vera (notifica o a mano) di un negozio che Ledgy aveva già registrato da solo pochi giorni prima
 * o dopo: vale quella vera. La copia automatica si toglie; se la vera non ha categoria, prende quella della ricorrente.
 */
export async function replaceAutoTwin(db: D1Database, userId: string, txId: string): Promise<{ replaced: boolean; category_id: string | null }> {
  const none = { replaced: false, category_id: null };
  const has = await db.prepare('SELECT 1 FROM recurring WHERE user_id = ? AND auto_add = 1 LIMIT 1').bind(userId).first();
  if (!has) return none;
  const t = await db.prepare("SELECT id, merchant, occurred_at, category_id, source FROM transactions WHERE id = ? AND user_id = ? AND type = 'expense' AND deleted_at IS NULL")
    .bind(txId, userId).first<{ id: string; merchant: string | null; occurred_at: string; category_id: string | null; source: string }>();
  if (!t || t.source === 'recurring' || !t.merchant) return none;
  const day = t.occurred_at.slice(0, 10);
  const shift = (n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
  const { results } = await db.prepare(`SELECT id, merchant, category_id FROM transactions INDEXED BY tx_user_occurred
      WHERE user_id = ? AND source = 'recurring' AND deleted_at IS NULL AND occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at`)
    .bind(userId, shift(-5), shift(6)).all<{ id: string; merchant: string | null; category_id: string | null }>();
  const twin = results.find((x) => x.id !== t.id && sameMerchant(x.merchant, t.merchant));
  if (!twin) return none;
  const now = nowIso();
  await db.batch([
    db.prepare("UPDATE transactions SET deleted_at = ?, updated_at = ?, note = 'Sostituita dalla spesa vera' WHERE id = ? AND user_id = ?").bind(now, now, twin.id, userId),
    ...(!t.category_id && twin.category_id
      ? [db.prepare("UPDATE transactions SET category_id = ?, status = CASE WHEN duplicate_of IS NULL THEN 'confirmed' ELSE status END, review_reason = NULL, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(twin.category_id, now, t.id, userId)]
      : []),
  ]);
  return { replaced: true, category_id: t.category_id ?? twin.category_id };
}
