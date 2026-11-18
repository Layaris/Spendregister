import { Hono } from 'hono';
import { appLabel, guessAppFromTitle, sourceKey } from '../shared/apps';
import { isLikelyDuplicate, sha256Hex } from '../shared/dedupe';
import { formatMoney, roundMilli, toMilli } from '../shared/money';
import { cleanMerchantName, parseNotification, parseWithParser, type AiHint, type ParserDef } from '../shared/notification';
import { normalizePostedAt } from '../shared/time';
import { bad, body, getTimeZone, HttpError, newId, notFound, nowIso, randomToken, uid, type AppEnv, type Env } from './lib';
import { aiCategorizeLater, applyCategory, WAIT_HINT } from './ai';
import { learnSource } from './cards';
import { accountInfo } from './auth';
import { seedId } from './seed';
import { categoryFromWords, classify, convertToEur, defaultAccountId, insertTransaction } from './transactions';

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
  /** Il comando del telefono sa chiedere la categoria ad Apple Intelligence se il server non la trova (comando v3). */
  can_hint?: string | boolean | null;
}

export async function loadParsers(db: D1Database, userId: string): Promise<ParserDef[]> {
  const { results } = await db
    .prepare('SELECT id, name, app, pattern, flags, direction, default_currency FROM parsers WHERE user_id = ? AND enabled = 1 ORDER BY created_at')
    .bind(userId)
    .all<ParserDef>();
  return results;
}

async function deviceForToken(db: D1Database, token: string) {
  return deviceByHash(db, await sha256Hex(token));
}

async function deviceByHash(db: D1Database, tokenHash: string) {
  const dev = await db
    .prepare('SELECT id, user_id, name, platform FROM devices WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(tokenHash)
    .first<{ id: string; user_id: string; name: string; platform: string }>();
  if (!dev) throw new HttpError(401, 'Indirizzo non valido o revocato');
  return dev;
}

export interface CaptureResult {
  status: 'created' | 'review' | 'duplicate' | 'ignored' | 'unrecognized';
  capture_id: string;
  transaction_id?: string;
  summary?: string;
  /** Solo per le spese da rivedere: il testo della notifica che il comando iPhone mostra. */
  notify?: string;
  /** Uso interno: categoria mancante, da chiedere all'AI in background (non va al telefono). */
  needs_ai?: boolean;
  /** Uso interno: spesa o entrata (per l'elenco di categorie da proporre ad Apple Intelligence). */
  direction?: 'income' | 'expense';
  /** Comando v3: categorie tra cui Apple Intelligence deve scegliere (c'è solo se la categoria manca). */
  hint?: string;
}

/** Dalla notifica al movimento: lettura, cambio, regole, doppioni. */
export async function processCapture(db: D1Database, userId: string, deviceId: string | null, payload: CapturePayload, existingCaptureId?: string): Promise<CaptureResult> {
  const p = { ...payload, title: payload.title ? String(payload.title).slice(0, 300) : null, app: payload.app ? String(payload.app).slice(0, 200) : guessAppFromTitle(payload.title) };
  const text = (p.text ?? '').toString().trim().slice(0, 4000);
  if (!text) bad('Testo della notifica mancante');
  const hint: AiHint | null = p.hint ?? (p.amount != null ? { amount: p.amount, currency: p.currency, merchant: p.merchant, category: p.category } : null);
  const hash = await sha256Hex(`${p.app ?? ''}|${p.title ?? ''}|${text}`);
  const captureId = existingCaptureId ?? newId('cap');
  const received = nowIso();

  const save = async (status: string, detail: string | null, txId: string | null = null) => {
    if (existingCaptureId) {
      await db.prepare('UPDATE captures SET status = ?, detail = ?, transaction_id = ? WHERE id = ? AND user_id = ?').bind(status, detail, txId, captureId, userId).run();
    } else {
      await db
        .prepare('INSERT INTO captures (id, user_id, device_id, received_at, posted_at, app, title, text, hint, hash, status, detail, transaction_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(captureId, userId, deviceId, received, p.posted_at ?? null, p.app ?? null, p.title ?? null, text, hint ? JSON.stringify(hint) : null, hash, status, detail, txId)
        .run();
    }
  };

  if (!existingCaptureId) {
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    const dup = await db
      .prepare("SELECT transaction_id FROM captures WHERE user_id = ? AND hash = ? AND received_at >= ? AND status IN ('created', 'review') LIMIT 1")
      .bind(userId, hash, since)
      .first<{ transaction_id: string | null }>();
    if (dup) {
      await save('duplicate', 'Stessa notifica già ricevuta', dup.transaction_id);
      return { status: 'duplicate', capture_id: captureId, transaction_id: dup.transaction_id ?? undefined };
    }
  }

  const parsed = parseNotification({ app: p.app, title: p.title, text, hint }, await loadParsers(db, userId));
  if (!parsed) {
    await save('unrecognized', 'Nessun importo riconosciuto');
    return { status: 'unrecognized', capture_id: captureId };
  }

  const occurred = normalizePostedAt(p.posted_at, await getTimeZone(db, userId));
  const sign = parsed.direction === 'income' ? 1 : -1;
  const amount = roundMilli(toMilli(parsed.amount), parsed.currency) * sign;
  const conv = await convertToEur(db, amount, parsed.currency, occurred);
  const merchantRaw = parsed.merchant;
  const merchant = cleanMerchantName(merchantRaw);
  // Carta e conto imparati per questa fonte (titolo o app), altrimenti il nome dell'app se si conosce.
  const key = sourceKey(p.app, p.title);
  const source = key
    ? await db.prepare('SELECT card, account_id FROM capture_sources WHERE user_id = ? AND key = ?').bind(userId, key).first<{ card: string | null; account_id: string | null }>()
    : null;
  // Ordine: carta scritta dall'utente per questa fonte, poi il nome del lettore per banca, poi il nome dell'app.
  const card = source?.card ?? parsed.bank ?? appLabel(p.app);

  const rules = await classify(db, userId, {
    merchant, merchant_raw: merchantRaw, text, app: p.app ?? null, currency: parsed.currency, account_id: null,
    amount_eur: (conv?.amount_eur ?? 0) / 1000, occurred_at: occurred, source: 'capture',
  }, parsed.direction, [hint?.category, text]);
  if (rules.ignore) {
    await save('ignored', `Ignorata dalla regola ${rules.matched.join(', ')}`);
    return { status: 'ignored', capture_id: captureId };
  }

  const finalMerchant = rules.merchant ?? merchant;
  const category = rules.category_id;
  const categoryVia = rules.via;

  // Doppioni: stessa spesa arrivata da un altro telefono pochi secondi prima.
  const windowStart = new Date(Date.parse(occurred) - 3 * 60_000).toISOString();
  const windowEnd = new Date(Date.parse(occurred) + 3 * 60_000).toISOString();
  const { results: near } = await db
    .prepare("SELECT id, amount, currency, merchant_raw, occurred_at FROM transactions WHERE user_id = ? AND source = 'capture' AND deleted_at IS NULL AND amount = ? AND currency = ? AND occurred_utc BETWEEN ? AND ?")
    .bind(userId, amount, parsed.currency, windowStart, windowEnd)
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

  // Prelievo al bancomat (o cambio valuta): i soldi passano dal conto principale ai contanti della valuta prelevata.
  // Non è una spesa: la spesa vera arriva quando si pagano i contanti. Si spegne in Funzioni (atm_transfer).
  if (parsed.direction !== 'income' && category === seedId('cat_fin_atm', userId) && !twin && (await accountInfo(db, userId)).features.atm_transfer) {
    const from = rules.account_id ?? source?.account_id ?? (await defaultAccountId(db, userId));
    const cash = await cashAccountFor(db, userId, parsed.currency);
    const group = newId('trf');
    const abs = Math.abs(amount);
    const absEur = conv ? Math.abs(conv.amount_eur) : 0;
    const leg = (account: string | null, sign: number) => insertTransaction(db, userId, {
      type: 'transfer', account_id: account, amount: abs * sign, currency: parsed.currency, occurred_at: occurred,
      merchant_raw: merchantRaw, merchant: sign > 0 ? `Prelievo ${finalMerchant ?? ''}`.trim() : finalMerchant ?? 'Prelievo', category_id: null, nature: null, card,
      source: 'capture', status: 'confirmed', transfer_group: group, capture_id: captureId, rule_ids: rules.matched, labels: [],
      ...(conv ? { amount_eur: absEur * sign, fx_rate: conv.fx_rate, fx_date: conv.fx_date } : { amount_eur: 0 }),
    });
    const inId = await leg(cash, 1);
    await leg(from, -1);
    await save('created', [parsed.via, `prelievo verso ${parsed.currency === 'EUR' ? 'Contanti' : `Contanti ${parsed.currency}`}`].filter(Boolean).join(' · '), inId);
    if (deviceId) await db.prepare('UPDATE devices SET last_capture_at = ? WHERE id = ?').bind(nowIso(), deviceId).run();
    return { status: 'created', capture_id: captureId, transaction_id: inId, summary: `Prelievo ${formatMoney(abs, parsed.currency)}` };
  }

  const txId = await insertTransaction(db, userId, {
    type: parsed.direction === 'income' ? 'income' : 'expense',
    account_id: rules.account_id ?? source?.account_id ?? (await defaultAccountId(db, userId)),
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
  const summary = `${finalMerchant ?? 'Spesa'} ${formatMoney(conv?.amount_eur ?? amount, conv ? 'EUR' : parsed.currency)}`;
  return {
    status: status === 'review' ? 'review' : 'created',
    capture_id: captureId,
    transaction_id: txId,
    summary,
    ...(status === 'review' ? { notify: `Da rivedere: ${summary}` } : {}),
    ...(!category && !rules.ask ? { needs_ai: true, direction: parsed.direction === 'income' ? 'income' as const : 'expense' as const } : {}),
  };
}

/** Il conto contanti di una valuta (tipo "cash"); se manca si crea "Contanti IDR", "Contanti USD"… */
async function cashAccountFor(db: D1Database, userId: string, currency: string): Promise<string> {
  const row = await db.prepare("SELECT id FROM accounts WHERE user_id = ? AND type = 'cash' AND currency = ? AND archived = 0 ORDER BY position, created_at LIMIT 1")
    .bind(userId, currency).first<{ id: string }>();
  if (row) return row.id;
  const id = newId('acc');
  await db.prepare("INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, created_at) VALUES (?, ?, ?, 'cash', ?, 0, (SELECT COALESCE(MAX(position), 0) + 1 FROM accounts WHERE user_id = ?), ?)")
    .bind(id, userId, `Contanti ${currency}`, currency, userId, nowIso()).run();
  return id;
}

/** Ingresso pubblico per i telefoni: /api/in/<token>. Accetta JSON o testo semplice. */
export const inboundApi = new Hono<AppEnv>();

/** Legge la notifica dal corpo grezzo (JSON, modulo o testo semplice). */
async function readPayload(type: string, raw: string): Promise<CapturePayload> {
  let payload: CapturePayload;
  if (type.includes('application/json')) {
    try { payload = JSON.parse(raw) as CapturePayload; } catch { throw new HttpError(400, 'JSON non valido'); }
  } else if (type.includes('form')) {
    payload = Object.fromEntries((await new Request('https://x/', { method: 'POST', headers: { 'content-type': type }, body: raw }).formData()).entries()) as unknown as CapturePayload;
  } else payload = { text: raw };
  if (typeof payload.hint === 'string') {
    try { payload.hint = JSON.parse(payload.hint); } catch { payload.hint = null; }
  }
  return payload;
}

async function receive(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, tokenHash: string, type: string, raw: string, receivedAt?: string) {
  if (env.TEST_DB_DOWN && !receivedAt && raw.includes(env.TEST_DB_DOWN)) throw new Error('D1_ERROR: database finto giù');
  const dev = await deviceByHash(env.DB, tokenHash);
  await env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(nowIso(), dev.id).run();
  const payload = await readPayload(type, raw);
  // Dalla coda: l'ora della spesa è quella in cui la notifica era arrivata, non quella in cui si registra.
  if (receivedAt && !payload.posted_at) payload.posted_at = receivedAt;
  const { needs_ai, direction, ...result } = await processCapture(env.DB, dev.user_id, dev.id, payload);
  if (needs_ai && result.transaction_id) {
    // Categoria mancante. Il comando v3 la chiede ad Apple Intelligence (gratis, sul telefono) scegliendo tra queste
    // categorie e la rimanda a /hint; se non arriva, l'AI del server la cerca più tardi (pendingHints).
    if (payload.can_hint && !receivedAt && result.capture_id) {
      const kind = direction === 'income' ? 'income' : 'expense';
      const { results } = await env.DB.prepare('SELECT name FROM categories WHERE user_id = ? AND kind = ? AND archived = 0 AND parent_id IS NOT NULL ORDER BY name')
        .bind(dev.user_id, kind).all<{ name: string }>();
      await env.DB.prepare("UPDATE captures SET detail = COALESCE(detail, '') || ? WHERE id = ?").bind(WAIT_HINT, result.capture_id).run();
      return { ...result, hint: results.map((r) => r.name).join(', ') };
    }
    // Altrimenti la chiede all'AI dopo aver risposto, così il comando del telefono non aspetta.
    ctx.waitUntil(aiCategorizeLater(env, dev.user_id, result.transaction_id));
  }
  return result;
}

inboundApi.post('/:token', async (c) => {
  const type = c.req.header('content-type') ?? '';
  const raw = (await c.req.text()).slice(0, 20_000);
  const tokenHash = await sha256Hex(c.req.param('token'));
  try {
    const result = await receive(c.env, c.executionCtx, tokenHash, type, raw);
    c.executionCtx.waitUntil(drainInbound(c.env, c.executionCtx).catch(() => {}));
    return c.json(result);
  } catch (e) {
    if (e instanceof HttpError) throw e;
    // Database non disponibile: la notifica non si perde, si mette in coda e si registra appena torna.
    try {
      await c.env.DB.prepare('INSERT INTO inbound_queue (token_hash, content_type, body, received_at) VALUES (?, ?, ?, ?)').bind(tokenHash, type, raw, nowIso()).run();
    } catch {
      console.error('Notifica persa: database non disponibile', e);
      throw e;
    }
    return c.json({ status: 'queued', summary: 'Ricevuta: la registro appena il server risponde' }, 202);
  }
});

/**
 * Secondo invio del comando v3: negozio e categoria letti da Apple Intelligence per una spesa senza categoria.
 * Prima il nome esatto di una categoria dell'account, poi lo storico e le parole chiave; se non basta, l'AI del server.
 */
inboundApi.post('/:token/hint', async (c) => {
  const env = c.env;
  const dev = await deviceByHash(env.DB, await sha256Hex(c.req.param('token')));
  const b = await body<{ capture_id?: string; merchant?: string | null; category?: string | null }>(c);
  const t = await env.DB.prepare(`SELECT t.id, t.type, t.merchant, t.merchant_raw, t.category_id, t.review_reason, t.review_choices, t.duplicate_of, t.capture_id
      FROM captures c JOIN transactions t ON t.id = c.transaction_id WHERE c.id = ? AND c.user_id = ? AND t.deleted_at IS NULL`)
    .bind(String(b.capture_id ?? ''), dev.user_id)
    .first<{ id: string; type: string; merchant: string | null; merchant_raw: string | null; category_id: string | null; review_reason: string | null; review_choices: string | null; duplicate_of: string | null; capture_id: string | null }>();
  if (!t) notFound('Spesa non trovata');
  if (t.category_id || t.review_choices) return c.json({ status: 'ok' });
  const kind = t.type === 'income' ? 'income' : 'expense';
  const clean = (v: unknown) => String(v ?? '').replace(/^["'«\s]+|["'»\s.]+$/g, '').slice(0, 80);
  const name = clean(b.category);
  const merchant = clean(b.merchant) || null;
  let found = name
    ? (await env.DB.prepare('SELECT id FROM categories WHERE user_id = ? AND kind = ? AND archived = 0 AND name = ? COLLATE NOCASE ORDER BY parent_id IS NULL LIMIT 1')
      .bind(dev.user_id, kind, name).first<{ id: string }>())?.id ?? null
    : null;
  let via = 'Apple Intelligence';
  if (!found && merchant && merchant.toLowerCase() !== (t.merchant ?? '').toLowerCase()) {
    // Apple Intelligence ha riconosciuto il negozio con un nome più chiaro: si riprovano storico e regole con quello.
    const r = await classify(env.DB, dev.user_id, { merchant, merchant_raw: t.merchant_raw, text: null, app: null, currency: 'EUR', account_id: null, amount_eur: 0, occurred_at: nowIso(), source: 'capture' }, kind, [name]);
    found = r.category_id;
    if (found) via = `Apple Intelligence e ${r.via}`;
  }
  if (!found && name) {
    found = await categoryFromWords(env.DB, dev.user_id, kind, name);
    if (found) via = 'Apple Intelligence e parole chiave';
  }
  if (found) {
    await applyCategory(env.DB, dev.user_id, t, found, `categoria da ${via}: ${name || merchant}`);
    return c.json({ status: 'ok' });
  }
  await env.DB.prepare('UPDATE captures SET detail = REPLACE(COALESCE(detail, \'\'), ?, \'\') WHERE id = ?').bind(WAIT_HINT, t.capture_id).run();
  c.executionCtx.waitUntil(aiCategorizeLater(env, dev.user_id, t.id));
  return c.json({ status: 'ai' });
});

/** Spese che aspettavano Apple Intelligence da più di 3 minuti (il comando si è fermato prima): ci pensa l'AI del server. */
export async function pendingHints(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>, userId?: string): Promise<void> {
  const from = new Date(Date.now() - 2 * 86400_000).toISOString();
  const to = new Date(Date.now() - 3 * 60_000).toISOString();
  const { results } = await env.DB.prepare(`SELECT id, user_id, transaction_id FROM captures WHERE ${userId ? 'user_id = ? AND ' : ''}received_at >= ? AND received_at < ?
      AND detail LIKE '%' || ? || '%' AND transaction_id IS NOT NULL LIMIT 10`)
    .bind(...(userId ? [userId] : []), from, to, WAIT_HINT).all<{ id: string; user_id: string; transaction_id: string }>();
  for (const r of results) {
    await env.DB.prepare('UPDATE captures SET detail = REPLACE(detail, ?, \'\') WHERE id = ?').bind(WAIT_HINT, r.id).run();
    ctx.waitUntil(aiCategorizeLater(env, r.user_id, r.transaction_id).catch(() => {}));
  }
}

/** Registra le notifiche rimaste in coda (al massimo 20 per volta, le più vecchie prima). */
export async function drainInbound(env: Env, ctx: Pick<ExecutionContext, 'waitUntil'>): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, token_hash, content_type, body, received_at FROM inbound_queue ORDER BY id LIMIT 20')
    .all<{ id: number; token_hash: string; content_type: string | null; body: string; received_at: string }>();
  let done = 0;
  for (const q of results) {
    try {
      await receive(env, ctx, q.token_hash, q.content_type ?? '', q.body, q.received_at);
    } catch (e) {
      // Errori veri (token revocato, testo vuoto) si scartano; se il database è ancora giù si riprova dopo.
      if (!(e instanceof HttpError)) break;
    }
    await env.DB.prepare('DELETE FROM inbound_queue WHERE id = ?').bind(q.id).run();
    done++;
  }
  return done;
}

inboundApi.post('/:token/ping', async (c) => {
  const dev = await deviceForToken(c.env.DB, c.req.param('token'));
  await c.env.DB.prepare('UPDATE devices SET last_seen_at = ? WHERE id = ?').bind(nowIso(), dev.id).run();
  return c.json({ ok: true, device: dev.name });
});

/** Gestione di telefoni, notifiche ricevute e lettori (richiede accesso). */
export const captureAdminApi = new Hono<AppEnv>();

captureAdminApi.get('/devices', async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT id, name, platform, method, token_hint, created_at, last_seen_at, last_capture_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at')
    .bind(uid(c))
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
    .prepare('INSERT INTO devices (id, user_id, name, platform, method, token_hash, token_hint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid(c), b.name.trim().slice(0, 80), b.platform ?? 'ios', b.method ?? 'shortcut', `pending-${id}`, '', nowIso())
    .run();
  const issued = await issueToken(c.env.DB, id, new URL(c.req.url).origin);
  return c.json({ id, ...issued }, 201);
});

captureAdminApi.post('/devices/:id/token', async (c) => {
  const id = c.req.param('id');
  const dev = await c.env.DB.prepare('SELECT id FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(id, uid(c)).first();
  if (!dev) notFound();
  return c.json(await issueToken(c.env.DB, id, new URL(c.req.url).origin));
});

captureAdminApi.delete('/devices/:id', async (c) => {
  await c.env.DB.prepare('UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?').bind(nowIso(), c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

captureAdminApi.get('/captures', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const stmt = status
    ? c.env.DB.prepare('SELECT * FROM captures WHERE user_id = ? AND status = ? ORDER BY received_at DESC LIMIT ?').bind(uid(c), status, limit)
    : c.env.DB.prepare('SELECT c.*, t.card AS card FROM captures c LEFT JOIN transactions t ON t.id = c.transaction_id WHERE c.user_id = ? ORDER BY c.received_at DESC LIMIT ?').bind(uid(c), limit);
  const { results } = await stmt.all();
  return c.json({ items: results });
});

/** Carta di una notifica, con un tocco: vale per tutte quelle con lo stesso titolo (o app), passate e future. */
captureAdminApi.post('/captures/:id/card', async (c) => {
  const b = await body<{ card?: string | null }>(c);
  const cap = await c.env.DB.prepare('SELECT app, title FROM captures WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<{ app: string | null; title: string | null }>();
  if (!cap) notFound();
  const key = sourceKey(cap.app, cap.title);
  if (!key) bad('Questa notifica non ha né titolo né app: scegli la carta dal movimento');
  return c.json(await learnSource(c.env.DB, uid(c), key, b.card ?? null, undefined));
});

/** Rielabora una notifica (per esempio dopo aver aggiunto un lettore). */
captureAdminApi.post('/captures/:id/retry', async (c) => {
  const cap = await c.env.DB.prepare('SELECT * FROM captures WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<{
    id: string; device_id: string | null; app: string | null; title: string | null; text: string; hint: string | null; posted_at: string | null; transaction_id: string | null;
  }>();
  if (!cap) notFound();
  if (cap.transaction_id) bad('Questa notifica ha già creato un movimento');
  const result = await processCapture(c.env.DB, uid(c), cap.device_id, {
    text: cap.text, title: cap.title, app: cap.app, posted_at: cap.posted_at, hint: cap.hint ? JSON.parse(cap.hint) : null,
  }, cap.id);
  return c.json(result);
});

/** Prova a mano: incolli una notifica e vedi cosa succederebbe, senza salvare nulla. */
captureAdminApi.post('/test', async (c) => {
  const b = await body<{ text?: string; app?: string }>(c);
  if (!b.text) bad('Incolla il testo di una notifica');
  const parsed = parseNotification({ app: b.app, text: b.text }, await loadParsers(c.env.DB, uid(c)));
  return c.json({ parsed, merchant: cleanMerchantName(parsed?.merchant) });
});

captureAdminApi.get('/parsers', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM parsers WHERE user_id = ? ORDER BY created_at').bind(uid(c)).all();
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
    .prepare('INSERT INTO parsers (id, user_id, name, app, pattern, flags, direction, default_currency, sample, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid(c), b.name.trim(), b.app.trim(), b.pattern, b.flags ?? 'i', b.direction ?? 'expense', b.default_currency ?? null, b.sample ?? null, b.enabled === false ? 0 : 1, nowIso())
    .run();
  // Le spese già arrivate da quella fonte e senza carta prendono il nome del lettore.
  const applied = await c.env.DB
    .prepare(`UPDATE transactions SET card = ? WHERE user_id = ? AND card IS NULL AND capture_id IN (
                SELECT id FROM captures WHERE user_id = ? AND instr(lower(COALESCE(title, '') || ' ' || COALESCE(app, '')), lower(?)) > 0)`)
    .bind(b.name.trim(), uid(c), uid(c), b.app.trim())
    .run();
  return c.json({ id, applied: applied.meta.changes ?? 0 }, 201);
});

captureAdminApi.put('/parsers/:id', async (c) => {
  const b = await body<ParserInput>(c);
  if (b.pattern) validatePattern(b.pattern);
  const cur = await c.env.DB.prepare('SELECT * FROM parsers WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).first<Record<string, unknown>>();
  if (!cur) notFound();
  await c.env.DB
    .prepare('UPDATE parsers SET name = ?, app = ?, pattern = ?, flags = ?, direction = ?, default_currency = ?, sample = ?, enabled = ? WHERE id = ? AND user_id = ?')
    .bind(b.name ?? cur.name, b.app ?? cur.app, b.pattern ?? cur.pattern, b.flags ?? cur.flags, b.direction ?? cur.direction,
      b.default_currency !== undefined ? b.default_currency : cur.default_currency, b.sample !== undefined ? b.sample : cur.sample,
      b.enabled === undefined ? cur.enabled : b.enabled ? 1 : 0, c.req.param('id'), uid(c))
    .run();
  // Lettore rinominato: anche la carta delle spese che portavano il vecchio nome.
  if (b.name && b.name.trim() !== cur.name) {
    await c.env.DB.prepare('UPDATE transactions SET card = ? WHERE user_id = ? AND card = ?').bind(b.name.trim(), uid(c), cur.name).run();
  }
  return c.json({ ok: true });
});

captureAdminApi.delete('/parsers/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM parsers WHERE id = ? AND user_id = ?').bind(c.req.param('id'), uid(c)).run();
  return c.json({ ok: true });
});

captureAdminApi.post('/parsers/test', async (c) => {
  const b = await body<ParserInput & { text?: string }>(c);
  if (!b.pattern || !b.text) bad('Servono modello e testo');
  validatePattern(b.pattern);
  const r = parseWithParser({ id: 'test', name: b.name ?? 'prova', app: b.app ?? '', pattern: b.pattern, flags: b.flags ?? 'i', direction: b.direction ?? 'expense', default_currency: b.default_currency ?? null }, b.text);
  return c.json({ parsed: r });
});
