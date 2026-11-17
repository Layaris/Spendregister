// Intelligenza artificiale: prima Gemini (gratis, con la ricerca Google), poi NanoGPT (a pagamento, il modello
// più economico) quando Gemini ha finito le richieste gratuite o non risponde. Stesso schema di PackSnap.
// Le chiavi stanno nella tabella ai_settings dell'account: non tornano mai all'app e non vanno nei backup.
import { Hono } from 'hono';
import { bad, body, HttpError, nowIso, uid, type AppEnv, type Env } from './lib';

export const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];
export const NANOGPT_MODELS = ['gemini-2.5-flash-lite', 'google/gemini-3.1-flash-lite', 'google/gemini-3.5-flash-lite'];
const GEMINI_URL = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const NANOGPT_URL = 'https://api.nano-gpt.com/api/v1/chat/completions';
const PAUSE_MS = 60 * 60_000; // Gemini con il limite gratuito raggiunto: si riprova dopo un'ora

export interface AiSettingsRow {
  user_id: string; enabled: number; gemini_key: string | null; nanogpt_key: string | null;
  gemini_model: string | null; nanogpt_model: string | null; gemini_paused_until: string | null;
  last_provider: string | null; last_error: string | null; last_used_at: string | null;
}
type Provider = 'gemini' | 'nanogpt';

export class AiError extends Error {
  /** status: codice HTTP del servizio (se c'è), per capire cosa è andato storto. */
  constructor(public code: 'no_key' | 'quota' | 'invalid_key' | 'no_credit' | 'bad_response' | 'network', public provider?: Provider, public status?: number) {
    super(code);
  }
}

/** Secondi di attesa suggeriti da Gemini in un 429 ("retryDelay": "37s"), se ci sono. */
async function retryDelay(res: Response): Promise<number | null> {
  try {
    const m = (await res.text()).match(/"retryDelay"\s*:\s*"(\d+)(?:\.\d+)?s"/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Indirizzi delle API, sostituibili nei test con un server finto (AI_ENDPOINTS = JSON). */
function endpoints(env: Env) {
  const o = env.AI_ENDPOINTS ? (JSON.parse(env.AI_ENDPOINTS) as { gemini?: string; nanogpt?: string }) : {};
  return { gemini: (m: string) => (o.gemini ? `${o.gemini}/${m}` : GEMINI_URL(m)), nanogpt: o.nanogpt ?? NANOGPT_URL };
}

export async function aiSettings(db: D1Database, userId: string) {
  return db.prepare('SELECT * FROM ai_settings WHERE user_id = ?').bind(userId).first<AiSettingsRow>();
}

/** Primo testo JSON nella risposta (a volte arriva tra ``` o con una frase intorno). */
export function jsonFrom(text: string): Record<string, unknown> {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) throw new AiError('bad_response');
  try { return JSON.parse(text.slice(s, e + 1)) as Record<string, unknown>; } catch { throw new AiError('bad_response'); }
}

/** Opzioni di una richiesta: ricerca sul web, lunghezza massima della risposta, un'immagine (scontrino o screenshot). */
export interface AskOpts { search?: boolean; maxTokens?: number; image?: { mime: string; data: string } }

async function callGemini(env: Env, key: string, model: string, prompt: string, search: boolean, o: AskOpts = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(endpoints(env).gemini(model), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, ...(o.image ? [{ inline_data: { mime_type: o.image.mime, data: o.image.data } }] : [])] }],
        ...(search ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { temperature: 0.1, maxOutputTokens: o.maxTokens ?? 400 },
      }),
    });
  } catch {
    throw new AiError('network', 'gemini');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('invalid_key', 'gemini', res.status);
  // La ricerca Google ha limiti gratuiti più bassi (e alcuni modelli non la offrono): senza ricerca si risponde lo stesso.
  if (search && !res.ok) return callGemini(env, key, model, prompt, false, o);
  if (res.status === 429) {
    const e = new AiError('quota', 'gemini', 429);
    (e as AiError & { wait?: number | null }).wait = await retryDelay(res);
    throw e;
  }
  if (!res.ok) throw new AiError('network', 'gemini', res.status);
  const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  if (!text) throw new AiError('bad_response', 'gemini');
  return text;
}

async function callNanoGpt(env: Env, key: string, model: string, prompt: string, search: boolean, o: AskOpts = {}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(endpoints(env).nanogpt, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // ":online" chiede a NanoGPT una ricerca sul web prima di rispondere.
      body: JSON.stringify({
        model: search ? `${model}:online` : model,
        messages: [{ role: 'user', content: o.image ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${o.image.mime};base64,${o.image.data}` } }] : prompt }],
        temperature: 0.1, max_tokens: o.maxTokens ?? 400, stream: false,
      }),
    });
  } catch {
    throw new AiError('network', 'nanogpt');
  }
  if (res.status === 401 || res.status === 403) throw new AiError('invalid_key', 'nanogpt', res.status);
  if (res.status === 402) throw new AiError('no_credit', 'nanogpt', 402);
  // ":online" (ricerca sul web) non è disponibile per ogni modello o può fallire: si riprova senza.
  if (search && !res.ok) return callNanoGpt(env, key, model, prompt, false, o);
  if (res.status === 429) throw new AiError('quota', 'nanogpt', 429);
  if (!res.ok) throw new AiError('network', 'nanogpt', res.status);
  const j = (await res.json()) as { choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }> };
  const c = j.choices?.[0]?.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '';
  if (!text) throw new AiError('bad_response', 'nanogpt');
  return text;
}

/**
 * Chiede all'AI dell'account: Gemini se c'è la chiave e non è in pausa, altrimenti (o se fallisce) NanoGPT.
 * Restituisce il testo e il servizio usato; annota l'esito in ai_settings.
 */
export async function askAi(env: Env, userId: string, prompt: string, opts: AskOpts = {}): Promise<{ text: string; provider: Provider }> {
  const db = env.DB;
  const s = await aiSettings(db, userId);
  if (!s || !s.enabled || (!s.gemini_key && !s.nanogpt_key)) throw new AiError('no_key');
  const chain: Provider[] = [];
  const paused = s.gemini_paused_until && s.gemini_paused_until > nowIso();
  if (s.gemini_key && !paused) chain.push('gemini');
  if (s.nanogpt_key) chain.push('nanogpt');
  if (!chain.length) throw new AiError('quota', 'gemini');
  let last: AiError = new AiError('no_key');
  for (const p of chain) {
    try {
      const text = p === 'gemini'
        ? await callGemini(env, s.gemini_key!, s.gemini_model || GEMINI_MODELS[0], prompt, opts.search ?? false, opts)
        : await callNanoGpt(env, s.nanogpt_key!, s.nanogpt_model || NANOGPT_MODELS[0], prompt, opts.search ?? false, opts);
      await db.prepare('UPDATE ai_settings SET last_provider = ?, last_error = NULL, last_used_at = ? WHERE user_id = ?').bind(p, nowIso(), userId).run();
      return { text, provider: p };
    } catch (e) {
      last = e instanceof AiError ? e : new AiError('network', p);
      if (p === 'gemini' && last.code === 'quota') {
        // Limite al minuto: pausa breve (quella suggerita da Gemini); limite del giorno o sconosciuto: un'ora.
        const wait = (last as AiError & { wait?: number | null }).wait;
        const ms = wait != null && wait <= 300 ? (wait + 5) * 1000 : PAUSE_MS;
        await db.prepare('UPDATE ai_settings SET gemini_paused_until = ? WHERE user_id = ?').bind(new Date(Date.now() + ms).toISOString(), userId).run();
      }
    }
  }
  await db.prepare('UPDATE ai_settings SET last_error = ? WHERE user_id = ?').bind(`${last.provider ?? ''} ${last.code}${last.status ? ` (HTTP ${last.status})` : ''}`.trim(), userId).run();
  throw last;
}

/** Categorie attive dell'account per il tipo di movimento, come elenco "id: Gruppo › Nome". */
async function categoryList(db: D1Database, userId: string, kind: 'expense' | 'income') {
  const { results } = await db
    .prepare(`SELECT c.id, c.name, p.name AS parent FROM categories c LEFT JOIN categories p ON p.id = c.parent_id
              WHERE c.user_id = ? AND c.archived = 0 AND c.kind = ? ORDER BY c.position`)
    .bind(userId, kind).all<{ id: string; name: string; parent: string | null }>();
  return results;
}

export interface AiCategory { category_id: string; reason: string; provider: Provider }

/**
 * Categoria di un movimento secondo l'AI, cercando sul web che cosa è il negozio
 * (es. "Reload Sanctuary Canggu" → centro benessere). Solo categorie esistenti dell'account.
 */
export async function aiCategory(env: Env, userId: string, tx: { merchant: string | null; text?: string | null; amount_eur: number; currency: string; kind: 'expense' | 'income'; place?: string | null }): Promise<AiCategory | null> {
  const cats = await categoryList(env.DB, userId, tx.kind);
  if (!cats.length || (!tx.merchant && !tx.text)) return null;
  const list = cats.map((c) => `${c.id}: ${c.parent ? `${c.parent} › ` : ''}${c.name}`).join('\n');
  const prompt = [
    `Sei l'assistente di un'app di spese personali. Devi scegliere la categoria di ${tx.kind === 'income' ? "un'entrata" : 'una spesa'}.`,
    `Negozio o descrizione: ${tx.merchant ?? '(sconosciuto)'}`,
    tx.text ? `Testo della notifica di pagamento: ${tx.text.slice(0, 500)}` : '',
    `Importo: circa ${(Math.abs(tx.amount_eur) / 1000).toFixed(2)} EUR (pagato in ${tx.currency}).`,
    "Se non sai che cos'è il negozio, cercalo sul web (nome e città) per capire che attività è.",
    "Rispondi solo con un oggetto JSON: {\"category_id\": \"<uno degli id qui sotto>\", \"reason\": \"<che cos'è, al massimo 12 parole, in italiano>\"}.",
    'Usa esattamente uno di questi id, preferendo la sottocategoria più precisa:',
    list,
  ].filter(Boolean).join('\n');
  const { text, provider } = await askAi(env, userId, prompt, { search: true });
  const j = jsonFrom(text);
  const id = String(j.category_id ?? '');
  if (!cats.some((c) => c.id === id)) return null;
  return { category_id: id, reason: String(j.reason ?? '').slice(0, 120), provider };
}

/**
 * Dopo la cattura (in background): se il movimento è ancora senza categoria, la chiede all'AI.
 * Se l'unico motivo per rivederlo era la categoria, lo conferma.
 */
export async function aiCategorizeLater(env: Env, userId: string, txId: string): Promise<void> {
  const db = env.DB;
  const t = await db.prepare('SELECT id, merchant, merchant_raw, amount_eur, currency, category_id, review_reason, review_choices, duplicate_of, capture_id, ai_tries FROM transactions WHERE id = ? AND user_id = ?')
    .bind(txId, userId).first<{ id: string; merchant: string | null; merchant_raw: string | null; amount_eur: number; currency: string; category_id: string | null; review_reason: string | null; review_choices: string | null; duplicate_of: string | null; capture_id: string | null; ai_tries: number }>();
  if (!t || t.category_id || t.review_choices || t.ai_tries > 0) return;
  // Un solo tentativo per movimento (scelta del proprietario): se l'AI non risponde, resta "da rivedere".
  await db.prepare('UPDATE transactions SET ai_tries = ai_tries + 1 WHERE id = ? AND user_id = ?').bind(txId, userId).run();
  const cap = t.capture_id ? await db.prepare('SELECT title, text FROM captures WHERE id = ?').bind(t.capture_id).first<{ title: string | null; text: string }>() : null;
  let r: AiCategory | null = null;
  try {
    r = await aiCategory(env, userId, { merchant: t.merchant ?? t.merchant_raw, text: cap ? `${cap.title ?? ''} ${cap.text}` : null, amount_eur: t.amount_eur, currency: t.currency, kind: t.amount_eur > 0 ? 'income' : 'expense' });
  } catch {
    return; // nessuna chiave, limite, errore: resta "da rivedere"
  }
  if (!r) return;
  const reasons = (t.review_reason ?? '').split(' · ').filter((x) => x && x !== 'Categoria da scegliere');
  const done = !reasons.length && !t.duplicate_of;
  await db.batch([
    db.prepare(`UPDATE transactions SET category_id = ?, nature = COALESCE(nature, (SELECT COALESCE(c.nature, p.nature) FROM categories c LEFT JOIN categories p ON p.id = c.parent_id WHERE c.id = ?)),
                  status = ?, review_reason = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .bind(r.category_id, r.category_id, done ? 'confirmed' : 'review', reasons.join(' · ') || null, nowIso(), txId, userId),
    ...(t.capture_id ? [db.prepare("UPDATE captures SET detail = COALESCE(detail, '') || ? WHERE id = ?").bind(` · categoria dall'AI (${r.provider}): ${r.reason}`, t.capture_id)] : []),
  ]);
}

// ---- API: impostazioni e prova ----

export const aiApi = new Hono<AppEnv>();

const mask = (k: string | null) => (k ? `…${k.slice(-4)}` : null);

aiApi.get('/', async (c) => {
  const s = await aiSettings(c.env.DB, uid(c));
  return c.json({
    enabled: s ? !!s.enabled : true,
    gemini: mask(s?.gemini_key ?? null), nanogpt: mask(s?.nanogpt_key ?? null),
    gemini_model: s?.gemini_model || GEMINI_MODELS[0], nanogpt_model: s?.nanogpt_model || NANOGPT_MODELS[0],
    gemini_models: GEMINI_MODELS, nanogpt_models: NANOGPT_MODELS,
    gemini_paused_until: s?.gemini_paused_until && s.gemini_paused_until > nowIso() ? s.gemini_paused_until : null,
    last_provider: s?.last_provider ?? null, last_error: s?.last_error ?? null, last_used_at: s?.last_used_at ?? null,
  });
});

/** Salva chiavi e scelte. Una chiave vuota ("") la toglie; non indicata resta com'è. */
aiApi.put('/', async (c) => {
  const b = await body<{ enabled?: boolean; gemini_key?: string | null; nanogpt_key?: string | null; gemini_model?: string; nanogpt_model?: string }>(c);
  const db = c.env.DB;
  const u = uid(c);
  const cur = await aiSettings(db, u);
  const key = (v: string | null | undefined, old: string | null | undefined) => (v === undefined ? old ?? null : v?.trim() ? v.trim().slice(0, 300) : null);
  if (b.gemini_model && !GEMINI_MODELS.includes(b.gemini_model)) bad('Modello Gemini non disponibile');
  if (b.nanogpt_model && !NANOGPT_MODELS.includes(b.nanogpt_model)) bad('Modello NanoGPT non disponibile');
  const geminiKey = key(b.gemini_key, cur?.gemini_key);
  await db.prepare(`INSERT INTO ai_settings (user_id, enabled, gemini_key, nanogpt_key, gemini_model, nanogpt_model, gemini_paused_until, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT (user_id) DO UPDATE SET enabled = excluded.enabled, gemini_key = excluded.gemini_key, nanogpt_key = excluded.nanogpt_key,
                      gemini_model = excluded.gemini_model, nanogpt_model = excluded.nanogpt_model, gemini_paused_until = excluded.gemini_paused_until, updated_at = excluded.updated_at`)
    .bind(u, b.enabled === undefined ? (cur ? cur.enabled : 1) : b.enabled ? 1 : 0, geminiKey, key(b.nanogpt_key, cur?.nanogpt_key),
      b.gemini_model ?? cur?.gemini_model ?? null, b.nanogpt_model ?? cur?.nanogpt_model ?? null,
      // Una chiave Gemini nuova riparte senza pausa.
      geminiKey !== (cur?.gemini_key ?? null) ? null : cur?.gemini_paused_until ?? null, nowIso())
    .run();
  return c.json({ ok: true });
});

const MESSAGES: Record<string, string> = {
  no_key: 'Manca una chiave: aggiungi quella di Gemini o di NanoGPT.',
  quota: 'Gemini ha finito le richieste gratuite e NanoGPT non è configurato.',
  invalid_key: 'La chiave non è valida.',
  no_credit: 'NanoGPT non ha più credito.',
  bad_response: "L'AI ha risposto in modo illeggibile: riprova.",
  network: "Il servizio dell'AI non risponde: riprova tra poco.",
};
export const aiMessage = (e: unknown) => (e instanceof AiError ? `${e.provider ? `${e.provider === 'gemini' ? 'Gemini' : 'NanoGPT'}: ` : ''}${MESSAGES[e.code]}` : MESSAGES.network);

/** Prova le chiavi con una domanda piccola. */
aiApi.post('/test', async (c) => {
  try {
    const r = await askAi(c.env, uid(c), 'Rispondi solo con il JSON {"ok": true}.');
    jsonFrom(r.text);
    return c.json({ ok: true, provider: r.provider });
  } catch (e) {
    throw new HttpError(400, aiMessage(e));
  }
});
