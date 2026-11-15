import { Hono } from 'hono';
import { appLabel } from '../shared/apps';
import { isLikelyDuplicate, sha256Hex } from '../shared/dedupe';
import { formatMoney, roundMilli, toMilli } from '../shared/money';
import { cleanMerchantName, parseNotification, parseWithParser, type AiHint, type ParserDef } from '../shared/notification';
import { evaluateRules } from '../shared/rules';
import { bad, body, HttpError, newId, notFound, nowIso, randomToken, type Env } from './lib';
import { categoryFromHistory, convertToEur, defaultAccountId, insertTransaction, loadRules } from './transactions';

interface CapturePayload {
  text?: string;
  title?: string | null;
  app?: string | null;
  posted_at?: string | null;
  hint?: AiHint | null;
  amount?: string | number | null;
  currency?: string | null;
  merchant?: string | null;
  category?: string | null;
}

export async function loadParsers(db: D1Database): Promise<ParserDef[]> {
  const { results } = await db
    .prepare('SELECT id, name, app, pattern, flags, direction, default_currency FROM parsers WHERE enabled = 1 ORDER BY created_at')
    .all<ParserDef>();
  return results;
}

async function deviceForToken(db: D1Database, token: string) {
  const dev = await db
    .prepare('SELECT id, name, platform FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(await sha256Hex(token))
    .first<{ id: string; name: string; platform: string }>();
  if (!dev) throw new HttpError(401, 'Indirizzo non valido o revocato');
  return dev;
}

/** Normalizza l'ora inviata dal telefono, conservando il fuso. */
function normalizeTime(s: string | null | undefined): string {
  if (!s) return nowIso();
  const t = s.trim();
  if (/^\d{10,13}$/.test(t)) return new Date(Number(t.length === 10 ? Number(t) * 1000 : t)).toISOString();
  return Number.isNaN(Date.parse(t)) ? nowIso() : t;
}

export interface CaptureResult {
  status: 'created' | 'review' | 'duplicate' | 'ignored' | 'unrecognized';
  capture_id: string;
  transaction_id?: string;
  summary?: string;
}

/** Dalla notifica al movimento: lettura, cambio, regole, doppioni. */
export async function processCapture(db: D1Database, deviceId: string | null, p: CapturePayload, existingCaptureId?: string): Promise<CaptureResult> {
  const text = (p.text ?? '').toString().trim();
  if (!text) bad('Testo della notifica mancante');
  const hint: AiHint | null = p.hint ?? (p.amount != null ? { amount: p.amount, currency: p.currency, merchant: p.merchant, category: p.category } : null);
  const hash = await sha256Hex(`${p.app ?? ''}|${p.title ?? ''}|${text}`);
  const captureId = existingCaptureId ?? newId('cap');
  const received = nowIso();

  const save = async (status: string, detail: string | null, txId: string | null = null) => {
    if (existingCaptureId) {
      await db.prepare('UPDATE captures SET status = ?, detail = ?, transaction_id = ? WHERE id = ?').bind(status, detail, txId, captureId).run();
    } else {
      await db
        .prepare('INSERT INTO captures (id, device_id, received_at, posted_at, app, title, text, hint, hash, status, detail, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(captureId, deviceId, received, p.posted_at ?? null, p.app ?? null, p.title ?? null, text, hint ? JSON.stringify(hint) : null, hash, status, detail, txId)
        .run();
    }
  };

  if (!existingCaptureId) {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const dup = await db
      .prepare("SELECT transaction_id FROM captures WHERE hash = ? AND received_at >= ? AND status IN ('created', 'review') LIMIT 1")
      .bind(hash, since)
      .first<{ transaction_id: string | null }>();
    if (dup) {
      await save('duplicate', 'Stessa notifica già ricevuta', dup.transaction_id);
      return { status: 'duplicate', capture_id: captureId, transaction_id: dup.transaction_id ?? undefined };
    }
  }

  const parsed = parseNotification({ app: p.app, title: p.title, text, hint }, await loadParsers(db));
  if (!parsed) {
    await save('unrecognized', 'Nessun importo riconosciuto');
    return { status: 'unrecognized', capture_id: captureId };
  }

  const occurred = normalizeTime(p.posted_at);
  const sign = parsed.direction === 'income' ? 1 : -1;
  const amount = roundMilli(toMilli(parsed.amount), parsed.currency) * sign;
  const conv = await convertToEur(db, amount, parsed.currency, occurred);
  const merchantRaw = parsed.merchant;
  const merchant = cleanMerchantName(merchantRaw);
  const card = appLabel(p.app);

  const rules = evaluateRules(await loadRules(db), {
    merchant, merchant_raw: merchantRaw, text, app: p.app ?? null, currency: parsed.currency, account_id: null,
    amount_eur: (conv?.amount_eur ?? 0) / 1000, occurred_at: occurred, source: 'capture',
  });
  if (rules.ignore) {
    await save('ignored', `Ignorata dalla regola ${rules.matched.join(', ')}`);
    return { status: 'ignored', capture_id: captureId };
  }

  const finalMerchant = rules.merchant ?? merchant;
  let category = rules.category_id ?? null;
  let categoryVia = category ? 'regola' : null;
  if (!category && !rules.ask) {
    category = await categoryFromHistory(db, finalMerchant);
    if (category) categoryVia = 'storico';
  }

  // Doppioni: stessa spesa arrivata da un altro telefono pochi secondi prima.
  const windowStart = new Date(Date.parse(occurred) - 3 * 60_000).toISOString();
  const windowEnd = new Date(Date.parse(occurred) + 3 * 60_000).toISOString();
  const { results: near } = await db
    .prepare("SELECT id, amount, currency, merchant_raw, occurred_at FROM transactions WHERE source = 'capture' AND deleted_at IS NULL AND amount = ? AND currency = ? AND occurred_utc BETWEEN ? AND ?")
    .bind(amount, parsed.currency, windowStart, windowEnd)
    .all<{ id: string; amount: number; currency: string; merchant_raw: string | null; occurred_at: string }>();
  const twin = near.find((n) => isLikelyDuplicate(n, { amount, currency: parsed.currency, merchant_raw: merchantRaw, occurred_at: occurred }));

  const reasons: string[] = [];
  if (twin) reasons.push('Possibile doppione');
  if (rules.ask) reasons.push('Scegli la categoria');
  if (parsed.ambiguous) reasons.push('Separatore ambiguo');
  if (!conv) reasons.push('Cambio non disponibile');
  if (!category && !rules.ask) reasons.push('Categoria da scegliere');
  if (parsed.confidence === 'low') reasons.push('Lettura incerta');
  if (rules.review) reasons.push('Da controllare per regola');
  const status = reasons.length ? 'review' : 'confirmed';

  const txId = await insertTransaction(db, {
    type: parsed.direction === 'income' ? 'income' : 'expense',
    account_id: rules.account_id ?? (await defaultAccountId(db)),
    amount, currency: parsed.currency, occurred_at: occurred,
    merchant_raw: merchantRaw, merchant: finalMerchant, category_id: category,
    nature: rules.nature ?? null, card, source: 'capture', status,
    review_reason: reasons.join(' · ') || null, review_choices: rules.ask ?? null,
    duplicate_of: twin?.id ?? null, capture_id: captureId, rule_ids: rules.matched, labels: rules.labels,
    ...(conv ?? {}),
  });
  if (!rules.nature && category) {
    await db.prepare('UPDATE transactions SET nature = (SELECT COALESCE(c.nature, p.nature) FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = ?) WHERE id = ?')
      .bind(category, txId).run();
  }
  const detail = [parsed.via, categoryVia ? `categoria da ${categoryVia}` : null].filter(Boolean).join(' · ');
  await save(status === 'review' ? 'review' : 'created', detail, txId);
  if (deviceId) await db.prepare('UPDATE devices SET last_capture_at = ? WHERE id = ?').bind(nowIso(), deviceId).run();
  return {
    status: status === 'review' ? 'review' : 'created',
    capture_id: captureId,
    transaction_id: txId,
    summary: `${finalMerchant ?? 'Spesa'} ${formatMoney(conv?.amount_eur ?? amount, conv ? 'EUR' : parsed.currency)}`,
  };
}

/** Ingresso pubblico per i telefoni: /api/in/<token>. Accetta JSON o testo semplice. */
export const inboundApi = new Hono<{ Bindings: Env }>();

inboundApi.post('/:token', async (c) => {
  const dev = await deviceForToken(c.env.DB, c.req.param('token'));
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(nowIso(), dev.id).run();
  const type = c.req.header('content-type') ?? '';
  let payload: CapturePayload;
  if (type.includes('application/json')) payload = await body<CapturePayload>(c);
  else if (type.includes('form')) payload = Object.fromEntries((await c.req.formData()).entries()) as unknown as CapturePayload;
  else payload = { text: await c.req.text() };
  if (typeof payload.hint === 'string') {
    try { payload.hint = JSON.parse(payload.hint); } catch { payload.hint = null; }
  }
  const result = await processCapture(c.env.DB, dev.id, payload);
  return c.json(result);
});

inboundApi.post('/:token/ping', async (c) => {
  const dev = await deviceForToken(c.env.DB, c.req.param('token'));
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(nowIso(), dev.id).run();
  return c.json({ ok: true, device: dev.name });
});

/** Gestione di telefoni, notifiche ricevute e lettori (richiede accesso). */
export const captureAdminApi = new Hono<{ Bindings: Env }>();

captureAdminApi.get('/devices', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, name, platform, method, token_hint, created_at, last_seen_at, last_capture_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at')
    .all();
  return c.json({ items: results });
});

async function issueToken(db: D1Database, deviceId: string, origin: string) {
  const token = randomToken(24);
  await db.prepare('UPDATE devices SET token_hash = ?, token_hint = ? WHERE id = ?').bind(await sha256Hex(token), token.slice(-4), deviceId).run();
  return { token, url: `${origin}/api/in/${token}` };
}

captureAdminApi.post('/devices', async (c) => {
  const b = await body<{ name?: string; platform?: string; method?: string }>(c);
  if (!b.name?.trim()) bad('Dai un nome al telefono');
  const id = newId('dev');
  await c.env.DB
    .prepare('INSERT INTO devices (id, name, platform, method, token_hash, token_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.name.trim(), b.platform ?? 'ios', b.method ?? 'shortcut', `pending-${id}`, '', nowIso())
    .run();
  const issued = await issueToken(c.env.DB, id, new URL(c.req.url).origin);
  return c.json({ id, ...issued }, 201);
});

captureAdminApi.post('/devices/:id/token', async (c) => {
  const id = c.req.param('id');
  const dev = await c.env.DB.prepare('SELECT id FROM devices WHERE id = ? AND revoked_at IS NULL').bind(id).first();
  if (!dev) notFound();
  return c.json(await issueToken(c.env.DB, id, new URL(c.req.url).origin));
});

captureAdminApi.delete('/devices/:id', async (c) => {
  await c.env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE id = ?').bind(nowIso(), c.req.param('id')).run();
  return c.json({ ok: true });
});

captureAdminApi.get('/captures', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const stmt = status
    ? c.env.DB.prepare('SELECT * FROM captures WHERE status = ? ORDER BY received_at DESC LIMIT ?').bind(status, limit)
    : c.env.DB.prepare('SELECT * FROM captures ORDER BY received_at DESC LIMIT ?').bind(limit);
  const { results } = await stmt.all();
  return c.json({ items: results });
});

/** Rielabora una notifica (per esempio dopo aver aggiunto un lettore). */
captureAdminApi.post('/captures/:id/retry', async (c) => {
  const cap = await c.env.DB.prepare('SELECT * FROM captures WHERE id = ?').bind(c.req.param('id')).first<{
    id: string; device_id: string | null; app: string | null; title: string | null; text: string; hint: string | null; posted_at: string | null; transaction_id: string | null;
  }>();
  if (!cap) notFound();
  if (cap.transaction_id) bad('Questa notifica ha già creato un movimento');
  const result = await processCapture(c.env.DB, cap.device_id, {
    text: cap.text, title: cap.title, app: cap.app, posted_at: cap.posted_at, hint: cap.hint ? JSON.parse(cap.hint) : null,
  }, cap.id);
  return c.json(result);
});

/** Prova a mano: incolli una notifica e vedi cosa succederebbe, senza salvare nulla. */
captureAdminApi.post('/test', async (c) => {
  const b = await body<{ text?: string; app?: string }>(c);
  if (!b.text) bad('Incolla il testo di una notifica');
  const parsed = parseNotification({ app: b.app, text: b.text }, await loadParsers(c.env.DB));
  return c.json({ parsed, merchant: cleanMerchantName(parsed?.merchant) });
});

captureAdminApi.get('/parsers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM parsers ORDER BY created_at').all();
  return c.json({ items: results });
});

interface ParserInput {
  name?: string;
  app?: string;
  pattern?: string;
  flags?: string;
  direction?: 'expense' | 'income';
  default_currency?: string | null;
  sample?: string | null;
  enabled?: boolean;
}

function validatePattern(pattern: string) {
  try {
    new RegExp(pattern);
  } catch (e) {
    bad(`Espressione non valida: ${(e as Error).message}`);
  }
  if (!pattern.includes('(?<amount>')) bad('Il lettore deve avere il gruppo (?<amount>…)');
}

captureAdminApi.post('/parsers', async (c) => {
  const b = await body<ParserInput>(c);
  if (!b.name || !b.app || !b.pattern) bad('Servono nome, app e modello');
  validatePattern(b.pattern);
  const id = newId('prs');
  await c.env.DB
    .prepare('INSERT INTO parsers (id, name, app, pattern, flags, direction, default_currency, sample, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.name, b.app, b.pattern, b.flags ?? 'i', b.direction ?? 'expense', b.default_currency ?? null, b.sample ?? null, b.enabled === false ? 0 : 1, nowIso())
    .run();
  return c.json({ id }, 201);
});

captureAdminApi.put('/parsers/:id', async (c) => {
  const b = await body<ParserInput>(c);
  if (b.pattern) validatePattern(b.pattern);
  const cur = await c.env.DB.prepare('SELECT * FROM parsers WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!cur) notFound();
  await c.env.DB
    .prepare('UPDATE parsers SET name = ?, app = ?, pattern = ?, flags = ?, direction = ?, default_currency = ?, sample = ?, enabled = ? WHERE id = ?')
    .bind(b.name ?? cur.name, b.app ?? cur.app, b.pattern ?? cur.pattern, b.flags ?? cur.flags, b.direction ?? cur.direction,
      b.default_currency !== undefined ? b.default_currency : cur.default_currency, b.sample !== undefined ? b.sample : cur.sample,
      b.enabled === undefined ? cur.enabled : b.enabled ? 1 : 0, c.req.param('id'))
    .run();
  return c.json({ ok: true });
});

captureAdminApi.delete('/parsers/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM parsers WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

captureAdminApi.post('/parsers/test', async (c) => {
  const b = await body<ParserInput & { text?: string }>(c);
  if (!b.pattern || !b.text) bad('Servono modello e testo');
  validatePattern(b.pattern);
  const r = parseWithParser({ id: 'test', name: b.name ?? 'prova', app: b.app ?? '', pattern: b.pattern, flags: b.flags ?? 'i', direction: b.direction ?? 'expense', default_currency: b.default_currency ?? null }, b.text);
  return c.json({ parsed: r });
});
