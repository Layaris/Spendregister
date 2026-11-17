// Assistente AI (Gemini o NanoGPT con le chiavi dell'account):
// - "ask": domande sulle spese. I numeri li calcola il server dai dati veri; l'AI li spiega (niente numeri inventati).
// - "parse": una spesa scritta o dettata ("taxi 50k ieri") → movimento da confermare.
// - "image": scontrino o screenshot di un'app bancaria → uno o più movimenti da confermare. La foto non si salva.
import { Hono } from 'hono';
import { parseAmount } from '../shared/money';
import { everyLabel } from '../shared/recurring';
import { aiMessage, askAi, jsonFrom } from './ai';
import { accountInfo } from './auth';
import { budgetView } from './budgets';
import { getEurRate } from './fx';
import { bad, body, HttpError, uid, type AppEnv } from './lib';

export const assistantApi = new Hono<AppEnv>();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIVE = 't.user_id = ?1 AND t.deleted_at IS NULL AND t.duplicate_of IS NULL';
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const WEEKDAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

/** I dati dell'account, già sommati, con gli importi nella valuta di visualizzazione. */
async function contextFor(db: D1Database, u: string, today: string, cur: string) {
  const rate = cur === 'EUR' ? 1 : (await getEurRate(db, cur, today))?.eurPerUnit ?? null;
  const conv = (milliEur: number) => Math.round((milliEur / 1000) / (rate ?? 1) * 100) / 100;
  const month = today.slice(0, 7);
  const prevMonth = shift(`${month}-01`, -1).slice(0, 7);
  const [months, cats, merchants, recent, accounts, recurring, trips, budget] = await Promise.all([
    db.prepare(`SELECT substr(t.occurred_at, 1, 7) AS m, SUM(CASE WHEN t.type = 'expense' THEN -t.amount_eur ELSE 0 END) AS spent,
        SUM(CASE WHEN t.type = 'income' THEN t.amount_eur ELSE 0 END) AS income FROM transactions t
      WHERE ${LIVE} AND t.type <> 'transfer' AND t.occurred_at >= ?2 GROUP BY m ORDER BY m`).bind(u, shift(today, -365)).all<{ m: string; spent: number; income: number }>(),
    db.prepare(`SELECT substr(t.occurred_at, 1, 7) AS m, COALESCE(p.name || ' › ', '') || COALESCE(c.name, 'Senza categoria') AS cat, -SUM(t.amount_eur) AS total, COUNT(*) AS n
      FROM transactions t LEFT JOIN categories c ON c.id = t.category_id LEFT JOIN categories p ON p.id = c.parent_id
      WHERE ${LIVE} AND t.type = 'expense' AND t.occurred_at >= ?3 || '-01' AND t.occurred_at < date(?2 || '-01', '+1 month') GROUP BY m, cat ORDER BY m DESC, total DESC`).bind(u, month, prevMonth).all<{ m: string; cat: string; total: number; n: number }>(),
    db.prepare(`SELECT t.merchant, -SUM(t.amount_eur) AS total, COUNT(*) AS n FROM transactions t
      WHERE ${LIVE} AND t.type = 'expense' AND t.merchant IS NOT NULL AND t.occurred_at >= ?2 GROUP BY lower(t.merchant) ORDER BY total DESC LIMIT 15`).bind(u, shift(today, -90)).all<{ merchant: string; total: number; n: number }>(),
    db.prepare(`SELECT substr(t.occurred_at, 1, 10) AS day, t.type, t.merchant, t.amount, t.currency, t.amount_eur, c.name AS cat, t.card FROM transactions t
      LEFT JOIN categories c ON c.id = t.category_id WHERE ${LIVE} ORDER BY t.occurred_utc DESC LIMIT 30`).bind(u).all<{ day: string; type: string; merchant: string | null; amount: number; currency: string; amount_eur: number; cat: string | null; card: string | null }>(),
    db.prepare(`SELECT a.name, a.currency, a.initial_balance + COALESCE((SELECT t.amount FROM account_totals t WHERE t.user_id = a.user_id AND t.account_id = a.id AND t.currency = a.currency), 0) AS balance
      FROM accounts a WHERE a.user_id = ?1 AND a.archived = 0`).bind(u).all<{ name: string; currency: string; balance: number }>(),
    db.prepare("SELECT merchant, amount_eur, period, every FROM recurring WHERE user_id = ? AND status = 'confirmed'").bind(u).all<{ merchant: string; amount_eur: number; period: 'week' | 'month' | 'year'; every: number }>(),
    db.prepare('SELECT name, place, start_date, end_date FROM trips WHERE user_id = ? ORDER BY start_date DESC LIMIT 10').bind(u).all(),
    budgetView(db, u, month, today),
  ]);
  const names = new Map<string, string>();
  for (const b of budget.categories) {
    const r = await db.prepare('SELECT name FROM categories WHERE id = ?').bind(b.category_id).first<{ name: string }>();
    names.set(b.category_id, r?.name ?? '?');
  }
  return {
    valuta: cur,
    oggi: today,
    mesi: months.results.map((m) => ({ mese: m.m, spese: conv(m.spent), entrate: conv(m.income) })),
    categorie_mese_corrente: cats.results.filter((c) => c.m === month).map((c) => ({ categoria: c.cat, spese: conv(c.total), volte: c.n })),
    categorie_mese_scorso: cats.results.filter((c) => c.m === prevMonth).map((c) => ({ categoria: c.cat, spese: conv(c.total), volte: c.n })),
    negozi_ultimi_90_giorni: merchants.results.map((m) => ({ negozio: m.merchant, spese: conv(m.total), volte: m.n })),
    ultimi_movimenti: recent.results.map((r) => ({ giorno: r.day, tipo: r.type, negozio: r.merchant, categoria: r.cat, importo: conv(r.amount_eur), originale: r.currency !== cur ? `${r.amount / 1000} ${r.currency}` : undefined, carta: r.card ?? undefined })),
    conti: accounts.results.map((a) => ({ conto: a.name, saldo: `${Math.round(a.balance) / 1000} ${a.currency}` })),
    spese_ricorrenti: recurring.results.map((r) => ({ negozio: r.merchant, importo: conv(-r.amount_eur), frequenza: everyLabel(r.period, r.every) })),
    viaggi: trips.results,
    budget: budget.total ? { totale: conv(budget.total.amount), speso: conv(budget.total.spent), restano: conv(budget.total.left),
      categorie: budget.categories.map((b) => ({ categoria: names.get(b.category_id), budget: conv(b.amount), speso: conv(b.spent) })) } : null,
  };
}

async function categoryLines(db: D1Database, u: string) {
  const { results } = await db.prepare(`SELECT c.id, c.kind, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
    WHERE c.user_id = ? AND c.archived = 0 ORDER BY c.kind, c.position`).bind(u).all<{ id: string; kind: string; name: string; parent: string | null }>();
  return results;
}

/** Valuta più usata negli ultimi 30 giorni (per "50k" senza valuta). */
async function usualCurrency(db: D1Database, u: string, today: string, fallback: string) {
  const r = await db.prepare(`SELECT t.currency FROM transactions t WHERE ${LIVE} AND t.occurred_at >= ?2 GROUP BY t.currency ORDER BY COUNT(*) DESC LIMIT 1`)
    .bind(u, shift(today, -30)).first<{ currency: string }>();
  return r?.currency ?? fallback;
}

export interface Draft { type: 'expense' | 'income'; amount: number; currency: string; merchant: string | null; date: string; time: string | null; note: string | null; category_id: string | null }

function cleanDrafts(raw: unknown, today: string, cats: Set<string>, fallbackCur: string): Draft[] {
  const list = Array.isArray((raw as { transactions?: unknown[] })?.transactions) ? (raw as { transactions: unknown[] }).transactions : [];
  const out: Draft[] = [];
  for (const x of list.slice(0, 20) as Array<Record<string, unknown>>) {
    const cur = typeof x.currency === 'string' && /^[A-Za-z]{3}$/.test(x.currency) ? x.currency.toUpperCase() : fallbackCur;
    // Numero o testo con i separatori locali ("185.000" in rupie = 185000).
    const amount = Math.abs(typeof x.amount === 'number' ? x.amount : parseAmount(String(x.amount ?? ''), cur)?.value ?? NaN);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) continue;
    let date = typeof x.date === 'string' && DAY.test(x.date) ? x.date : today;
    if (date > shift(today, 1)) date = today;
    const time = typeof x.time === 'string' && /^\d{1,2}:\d{2}$/.test(x.time) ? x.time.padStart(5, '0') : null;
    const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, n) : null);
    out.push({
      type: x.type === 'income' ? 'income' : 'expense', amount: Math.round(amount * 1000) / 1000, currency: cur, merchant: str(x.merchant, 120), date, time,
      note: str(x.note, 300), category_id: typeof x.category_id === 'string' && cats.has(x.category_id) ? x.category_id : null,
    });
  }
  return out;
}

assistantApi.post('/', async (c) => {
  const b = await body<{ mode?: 'ask' | 'parse' | 'image'; text?: string; image?: string; history?: Array<{ role: string; text: string }>; today?: string }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const today = typeof b.today === 'string' && DAY.test(b.today) ? b.today : new Date().toISOString().slice(0, 10);
  const info = await accountInfo(db, u);
  try {
    if (b.mode === 'ask') {
      const q = String(b.text ?? '').trim().slice(0, 1000);
      if (!q) bad('Scrivi una domanda');
      const ctx = await contextFor(db, u, today, info.display_currency);
      const history = (b.history ?? []).slice(-6).map((h) => `${h.role === 'user' ? 'Utente' : 'Assistente'}: ${String(h.text).slice(0, 600)}`).join('\n');
      const prompt = [
        'ASSISTENTE_LEDGY. Sei l’assistente di Ledgy, l’app con cui questa persona registra le sue spese. Vive a Bali e viaggia.',
        `Oggi è ${WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]} ${today}. Rispondi in italiano, breve e chiaro (al massimo 8 righe), importi in ${info.display_currency}.`,
        'Usa SOLO i dati qui sotto, già calcolati: non inventare numeri. Se la domanda chiede dati che non ci sono, dillo e suggerisci dove guardare in Ledgy',
        '(Statistiche, Movimenti con i filtri, Budget, Viaggi, Spese ricorrenti). I consigli di risparmio devono essere concreti e basati sui dati.',
        `DATI: ${JSON.stringify(ctx)}`,
        history ? `CONVERSAZIONE FINORA:\n${history}` : '',
        `DOMANDA: ${q}`,
      ].filter(Boolean).join('\n');
      const r = await askAi(c.env, u, prompt, { maxTokens: 900 });
      return c.json({ answer: r.text.trim(), provider: r.provider });
    }
    if (b.mode === 'parse' || b.mode === 'image') {
      let image: { mime: string; data: string } | undefined;
      if (b.mode === 'image') {
        const m = typeof b.image === 'string' ? b.image.match(/^data:(image\/(?:jpeg|png|webp|heic));base64,([A-Za-z0-9+/=]+)$/) : null;
        if (!m) bad('Immagine non valida');
        if (m[2].length > 6_000_000) bad('Immagine troppo grande');
        image = { mime: m[1], data: m[2] };
      } else if (!String(b.text ?? '').trim()) bad('Scrivi o detta la spesa');
      const cats = await categoryLines(db, u);
      const cur = await usualCurrency(db, u, today, info.display_currency);
      const prompt = [
        `ESTRAI_MOVIMENTI. ${b.mode === 'image' ? 'Nell’immagine (scontrino, ricevuta o screenshot di un’app bancaria o di pagamento)' : `Nel testo dettato: "${String(b.text).slice(0, 600)}"`} trova i movimenti di denaro.`,
        `Oggi è ${WEEKDAYS[new Date(`${today}T12:00:00Z`).getUTCDay()]} ${today}: "ieri", "stamattina", "sabato" sono relativi a oggi.`,
        `Se manca la valuta usa ${cur}. Abbreviazioni: 50k = 50000, 1,5jt o 1.5 juta = 1500000, 20rb = 20000.`,
        'Uno scontrino è un solo movimento (il totale pagato, non le righe). Uno screenshot con più movimenti: uno per riga, al massimo 20.',
        'Rispondi SOLO con JSON: {"transactions": [{"type": "expense" o "income", "amount": numero positivo, "currency": "codice ISO", "merchant": "negozio o persona o null",',
        '"date": "YYYY-MM-DD", "time": "HH:MM o null", "note": "breve descrizione o null", "category_id": "uno degli id qui sotto o null"}]}',
        'Categorie (id: gruppo › nome):',
        ...cats.map((x) => `${x.id}: ${x.kind === 'income' ? 'Entrate › ' : ''}${x.parent ? `${x.parent} › ` : ''}${x.name}`),
      ].join('\n');
      const r = await askAi(c.env, u, prompt, { maxTokens: 1500, image });
      const drafts = cleanDrafts(jsonFrom(r.text), today, new Set(cats.map((x) => x.id)), cur);
      return c.json({ drafts, provider: r.provider });
    }
    bad('Modalità sconosciuta');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, aiMessage(e));
  }
});
