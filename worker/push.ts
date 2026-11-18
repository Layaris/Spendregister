// Notifiche dell'app installata (Web Push, gratis: niente servizi esterni oltre al push del browser).
// Il server manda una spinta SENZA contenuto, firmata con le sue chiavi VAPID; il service worker chiede a
// /api/push/pending cosa mostrare. Così niente cifratura del contenuto da fare qui e niente testo nei server di Apple/Google.
// Cosa avvisa: budget all'80% e superato (subito, alla spesa), cattura ferma, movimenti da rivedere e, se acceso,
// promemoria degli abbonamenti il giorno prima (dal cron del mattino). Ogni avviso ha una chiave: mai due volte.
import { Hono } from 'hono';
import { formatMoney } from '../shared/money';
import { nextDue, type Period } from '../shared/recurring';
import { zonedIso } from '../shared/time';
import { budgetView } from './budgets';
import { getEurRate } from './fx';
import { bad, body, getTimeZone, newId, nowIso, uid, type AppEnv, type Env } from './lib';
import { FEATURE_DEFAULTS } from './auth';

const enc = new TextEncoder();
const b64u = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

interface Vapid { pub: string; jwk: JsonWebKey }

/** Chiavi VAPID del server: create alla prima richiesta e tenute nella tabella settings (mai mandate all'app, tranne la pubblica). */
async function vapid(db: D1Database): Promise<{ pub: string; key: CryptoKey }> {
  let row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first<{ value: string }>();
  if (!row) {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = b64u(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer);
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    // Se due richieste le creano insieme, resta la prima.
    await db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('vapid', ?)").bind(JSON.stringify({ pub, jwk } satisfies Vapid)).run();
    row = await db.prepare("SELECT value FROM settings WHERE key = 'vapid'").first<{ value: string }>();
  }
  const v = JSON.parse(row!.value) as Vapid;
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { pub: v.pub, key };
}

async function vapidHeader(db: D1Database, endpoint: string, subject: string): Promise<string> {
  const { pub, key } = await vapid(db);
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${pub}`;
}

/** Manda la spinta a tutti i telefoni dell'utente; toglie le iscrizioni che il servizio dice scadute. */
async function pushUser(env: Env, userId: string): Promise<number> {
  const db = env.DB;
  const { results } = await db.prepare('SELECT id, endpoint FROM push_subscriptions WHERE user_id = ?').bind(userId).all<{ id: string; endpoint: string }>();
  if (!results.length) return 0;
  const subject = (await db.prepare("SELECT value FROM settings WHERE key = 'app_origin'").first<{ value: string }>())?.value ?? 'https://ledgy.app';
  let sent = 0;
  for (const s of results) {
    try {
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { TTL: '86400', Urgency: 'normal', Authorization: await vapidHeader(db, s.endpoint, subject) },
      });
      if (res.status === 404 || res.status === 410) await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
      else if (res.ok) sent++;
    } catch { /* rete: si riprova al prossimo avviso */ }
  }
  return sent;
}

export interface Note { kind: string; dedupe: string; title: string; body: string; url?: string }

/** Mette in coda un avviso (una volta sola per chiave) e sveglia i telefoni. */
export async function notify(env: Env, userId: string, n: Note): Promise<boolean> {
  const r = await env.DB.prepare(`INSERT OR IGNORE INTO notify_queue (id, user_id, kind, dedupe, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(newId('ntf'), userId, n.kind, n.dedupe, n.title.slice(0, 120), n.body.slice(0, 300), n.url ?? '/', nowIso()).run();
  if (!(r.meta.changes ?? 0)) return false;
  await pushUser(env, userId);
  return true;
}

interface PushUser { id: string; features: string | null; display_currency: string | null; timezone: string | null }

const featuresOf = (u: PushUser): Record<string, boolean> => {
  let f: Record<string, boolean> = {};
  try { f = u.features ? (JSON.parse(u.features) as Record<string, boolean>) : {}; } catch { f = {}; }
  return { ...FEATURE_DEFAULTS, ...f };
};

/** Importo in euro (millesimi) scritto nella valuta di visualizzazione. */
async function money(db: D1Database, eurMilli: number, currency: string | null, day: string): Promise<string> {
  const cur = currency ?? 'EUR';
  const rate = cur === 'EUR' ? null : await getEurRate(db, cur, day);
  return formatMoney(rate ? Math.round(eurMilli / rate.eurPerUnit) : eurMilli, rate ? cur : 'EUR');
}

async function pushUserRow(db: D1Database, userId: string): Promise<PushUser | null> {
  const has = await db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? LIMIT 1').bind(userId).first();
  if (!has) return null;
  return db.prepare('SELECT id, features, display_currency, timezone FROM users WHERE id = ?').bind(userId).first<PushUser>();
}

/** Dopo una spesa: budget del mese all'80% o superato. Non legge niente se l'utente non ha le notifiche. */
export async function budgetPush(env: Env, userId: string): Promise<void> {
  const db = env.DB;
  const u = await pushUserRow(db, userId);
  if (!u || !featuresOf(u).push_budget) return;
  const today = zonedIso(new Date(), u.timezone ?? (await getTimeZone(db, userId))).slice(0, 10);
  const month = today.slice(0, 7);
  const v = await budgetView(db, userId, month, today);
  if (v.total && v.total.amount > 0) {
    const pct = v.total.spent / v.total.amount;
    if (pct >= 1) {
      await notify(env, userId, { kind: 'budget', dedupe: `budget:${month}:100`, title: 'Budget del mese superato',
        body: `Hai speso ${await money(db, v.total.spent, u.display_currency, today)} su ${await money(db, v.total.amount, u.display_currency, today)}.`, url: '/#/budget' });
    } else if (pct >= 0.8) {
      await notify(env, userId, { kind: 'budget', dedupe: `budget:${month}:80`, title: "Budget del mese all'80%",
        body: `Restano ${await money(db, v.total.left, u.display_currency, today)} per ${v.days.total - v.days.elapsed + 1} giorni.`, url: '/#/budget' });
    }
  }
  for (const c of v.categories) {
    if (c.amount > 0 && c.spent >= c.amount) {
      const name = (await db.prepare('SELECT name FROM categories WHERE id = ? AND user_id = ?').bind(c.category_id, userId).first<{ name: string }>())?.name ?? 'Categoria';
      await notify(env, userId, { kind: 'budget', dedupe: `budget:${month}:${c.category_id}`, title: `Budget di ${name} superato`,
        body: `${await money(db, c.spent, u.display_currency, today)} su ${await money(db, c.amount, u.display_currency, today)} questo mese.`, url: '/#/budget' });
    }
  }
}

/** Cron del mattino: cattura ferma, movimenti da rivedere, abbonamenti di domani. Solo per chi ha le notifiche. */
export async function dailyPush(env: Env): Promise<void> {
  const db = env.DB;
  const { results: users } = await db.prepare(`SELECT id, features, display_currency, timezone FROM users WHERE id IN (SELECT DISTINCT user_id FROM push_subscriptions)`).all<PushUser>();
  for (const u of users) {
    try {
      const f = featuresOf(u);
      const today = zonedIso(new Date(), u.timezone ?? 'Asia/Makassar').slice(0, 10);
      if (f.push_capture) {
        const { results: devs } = await db.prepare('SELECT name, last_capture_at FROM devices WHERE user_id = ? AND revoked_at IS NULL AND last_capture_at IS NOT NULL').bind(u.id).all<{ name: string; last_capture_at: string }>();
        const last = devs.reduce<{ name: string; last_capture_at: string } | null>((m, d) => (!m || d.last_capture_at > m.last_capture_at ? d : m), null);
        if (last && Date.now() - Date.parse(last.last_capture_at) >= 2 * 86400_000) {
          await notify(env, u.id, { kind: 'capture_silent', dedupe: `silent:${last.last_capture_at.slice(0, 10)}`, title: 'La cattura delle spese è ferma',
            body: `${last.name} non manda spese da ${Math.floor((Date.now() - Date.parse(last.last_capture_at)) / 86400_000)} giorni: controlla il comando o i permessi.`, url: '/#/cattura' });
        }
      }
      if (f.push_review) {
        const n = (await db.prepare("SELECT COUNT(*) AS n FROM transactions INDEXED BY tx_review WHERE user_id = ? AND status = 'review' AND deleted_at IS NULL").bind(u.id).first<{ n: number }>())?.n ?? 0;
        if (n > 0) {
          await notify(env, u.id, { kind: 'review', dedupe: `review:${today}`, title: n === 1 ? 'Un movimento da rivedere' : `${n} movimenti da rivedere`,
            body: 'Scegli la categoria con un tocco.', url: '/#/rivedere' });
        }
      }
      if (f.sub_reminders) {
        const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10);
        const { results: subs } = await db.prepare("SELECT id, merchant, amount_eur, period, every, last_date FROM recurring WHERE user_id = ? AND status = 'confirmed'")
          .bind(u.id).all<{ id: string; merchant: string; amount_eur: number; period: Period; every: number; last_date: string | null }>();
        for (const s of subs) {
          const last = await db.prepare(`SELECT MAX(substr(occurred_at, 1, 10)) AS day FROM transactions INDEXED BY tx_user_merchant
              WHERE user_id = ? AND merchant = ? COLLATE NOCASE AND type = 'expense' AND deleted_at IS NULL`).bind(u.id, s.merchant).first<{ day: string | null }>();
          if (nextDue(s.period, s.every || 1, last?.day ?? null, s.last_date, today).next !== tomorrow) continue;
          await notify(env, u.id, { kind: 'subscription', dedupe: `sub:${s.id}:${tomorrow}`, title: `Domani: ${s.merchant}`,
            body: `Circa ${await money(db, Math.abs(s.amount_eur), u.display_currency, today)}. Se non ti serve più, è il momento di disdire.`, url: '/#/ricorrenti' });
        }
      }
    } catch { /* un utente con un problema non ferma gli altri */ }
  }
  await db.prepare('DELETE FROM notify_queue WHERE created_at < ?').bind(new Date(Date.now() - 30 * 86400_000).toISOString()).run();
}

export const pushApi = new Hono<AppEnv>();

pushApi.get('/key', async (c) => c.json({ key: (await vapid(c.env.DB)).pub }));

pushApi.get('/status', async (c) => {
  const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind(uid(c)).first<{ n: number }>();
  return c.json({ devices: r?.n ?? 0 });
});

const validEndpoint = (e: string | undefined, allowHttp: boolean): string => {
  try {
    const u = new URL(e ?? '');
    if ((u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) || e!.length > 1000) throw new Error();
    return u.toString();
  } catch {
    bad('Iscrizione alle notifiche non valida');
  }
};

pushApi.post('/subscribe', async (c) => {
  const b = await body<{ endpoint?: string }>(c);
  const endpoint = validEndpoint(b.endpoint, !!c.env.PUSH_HTTP);
  const db = c.env.DB;
  const now = nowIso();
  // L'indirizzo dell'app serve come contatto nella firma VAPID (lo chiede Apple).
  await db.batch([
    db.prepare(`INSERT INTO push_subscriptions (id, user_id, endpoint, created_at, last_ok_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, last_ok_at = excluded.last_ok_at`).bind(newId('psh'), uid(c), endpoint, now, now),
    db.prepare("INSERT INTO settings (key, value) VALUES ('app_origin', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(new URL(c.req.url).origin),
  ]);
  return c.json({ ok: true });
});

pushApi.post('/unsubscribe', async (c) => {
  const b = await body<{ endpoint?: string }>(c);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(uid(c), b.endpoint ?? '').run();
  return c.json({ ok: true });
});

pushApi.post('/test', async (c) => {
  const ok = await notify(c.env, uid(c), { kind: 'test', dedupe: `test:${Date.now()}`, title: 'Notifiche attive', body: 'Da ora Ledgy ti avvisa qui.', url: '/#/altro' });
  return c.json({ ok });
});

/**
 * Chiamata dal service worker quando arriva una spinta: l'indirizzo dell'iscrizione fa da chiave (lo conoscono solo
 * il telefono e il servizio di push). Ogni telefono riceve gli avvisi arrivati dopo la sua ultima richiesta.
 */
export const pushPublicApi = new Hono<AppEnv>();
pushPublicApi.post('/pending', async (c) => {
  const b = await body<{ endpoint?: string }>(c);
  const db = c.env.DB;
  const sub = await db.prepare('SELECT id, user_id, last_ok_at FROM push_subscriptions WHERE endpoint = ?').bind(b.endpoint ?? '').first<{ id: string; user_id: string; last_ok_at: string | null }>();
  if (!sub) return c.json({ items: [] });
  const since = sub.last_ok_at ?? new Date(Date.now() - 86400_000).toISOString();
  const { results } = await db.prepare('SELECT id, title, body, url, created_at FROM notify_queue WHERE user_id = ? AND created_at > ? ORDER BY created_at LIMIT 5')
    .bind(sub.user_id, since).all<{ id: string; title: string; body: string; url: string; created_at: string }>();
  const last = results.at(-1)?.created_at ?? null;
  if (last) await db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE id = ?').bind(last, sub.id).run();
  return c.json({ items: results.map(({ id, title, body: text, url }) => ({ id, title, body: text, url })) });
});
