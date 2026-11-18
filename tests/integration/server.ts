// Avvia il vero Worker (wrangler dev) con un database D1 locale nuovo per ogni esecuzione dei test.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { walletFake } from './wallet-fake';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

const PORT = 8799;
export const AI_PORT = 8798;
// Ospiti e account creati "a gennaio", per provare la pulizia notturna (tests/integration/api.test.ts).
export const OLD = {
  emptyGuestSession: 'sessione-ospite-vuoto',
  fullGuestSession: 'sessione-ospite-con-dati',
  abandonedGuestPhone: 'telefono-ospite-senza-sessione',
  registeredPhone: 'telefono-account-registrato',
  v1Session: 'sessione-account-categorie-v1',
  v1FullSession: 'sessione-account-tutte-le-categorie-v1',
  v3Session: 'sessione-account-catalogo-v3',
  /** Account con 5.000 movimenti in 7 anni, come l'archivio del proprietario: per misurare le righe lette. */
  perfSession: 'sessione-account-archivio-grande',
};

/** Tutte le categorie predefinite della versione 1, come le aveva chi si è registrato prima dell'aggiornamento. */
export const V1_CATEGORIES: Array<{ id: string; name: string; parent: string | null; kind: string }> =
  JSON.parse(readFileSync(new URL('./categories-v1.json', import.meta.url), 'utf8'));

/** Testo che, in una notifica, fa finta che il database non risponda (prova della coda delle notifiche). */
export const TEST_DB_DOWN = 'SIMULA-DATABASE-GIU';

let proc: ChildProcess | null = null;
let ai: Server | null = null;

/**
 * Gemini e NanoGPT finti. Chiavi: "gemini-ok", "gemini-esaurita" (risponde 429 come a richieste gratuite finite),
 * "nano-ok". Sceglie la riga dell'elenco delle categorie che contiene "Massaggi e spa" (o la prima).
 * GET /stats dice quante richieste ha ricevuto ciascuno e se chiedevano la ricerca sul web.
 */
function fakeAi(): Server {
  const stats = { gemini: 0, nanogpt: 0, geminiSearch: 0, nanoOnline: 0 };
  const pick = (prompt: string, image = false) => {
    if (prompt.includes('{"ok": true}')) return '{"ok": true}';
    // Assistente: risponde citando il totale del mese che trova nei DATI (così il test vede che i dati arrivano).
    if (prompt.startsWith('ASSISTENTE_LEDGY')) {
      const data = JSON.parse(prompt.split('\nDATI: ')[1].split('\n')[0]);
      const month = data.mesi.find((m: { mese: string }) => m.mese === data.oggi.slice(0, 7));
      return `Questo mese hai speso ${month?.spese ?? 0} ${data.valuta}. Domanda: ${prompt.split('DOMANDA: ')[1]}`;
    }
    if (prompt.startsWith('ESTRAI_MOVIMENTI')) {
      const cat = (name: string) => prompt.split('\n').find((l) => /^cat_/.test(l) && l.endsWith(name))?.split(':')[0] ?? null;
      if (image) return '```json\n{"transactions": [{"type": "expense", "amount": "185.000", "currency": "idr", "merchant": "Pepito Canggu", "date": "2026-11-16", "time": "18:42", "category_id": "' + cat('Spesa e supermercato') + '"}, {"type": "expense", "amount": 0, "merchant": "vuoto"}, {"type": "income", "amount": 20, "currency": "EUR", "merchant": "Rimborso", "date": "2099-01-01", "category_id": "inventata"}]}\n```';
      return '{"transactions": [{"type": "expense", "amount": 50000, "currency": null, "merchant": "Taxi", "date": "2026-11-16", "time": null, "note": null, "category_id": "' + cat('Taxi e auto con autista') + '"}]}';
    }
    const lines = prompt.split('\n').filter((l) => /^cat_[^:]+: /.test(l));
    const line = lines.find((l) => l.includes('Massaggi e spa')) ?? lines[0] ?? '';
    return `Ecco: {"category_id": "${line.split(':')[0]}", "reason": "centro benessere con sauna e bagni di ghiaccio"}`;
  };
  return createServer((req, res) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => {
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/stats') return send(200, stats);
      if (req.url?.startsWith('/wallet/')) return walletFake(req, res);
      const b = data ? JSON.parse(data) : {};
      if (req.url?.startsWith('/gemini/')) {
        stats.gemini++;
        if (b.tools?.[0]?.google_search) stats.geminiSearch++;
        const key = req.headers['x-goog-api-key'];
        if (key === 'gemini-esaurita') return send(429, { error: { status: 'RESOURCE_EXHAUSTED' } });
        // Come la chiave gratuita vera: la ricerca Google è al limite, senza ricerca risponde.
        if (key === 'gemini-senzaricerca' && b.tools?.[0]?.google_search) return send(429, { error: { status: 'RESOURCE_EXHAUSTED', details: [{ retryDelay: '40s' }] } });
        if (key !== 'gemini-ok' && key !== 'gemini-senzaricerca') return send(403, { error: 'chiave' });
        return send(200, { candidates: [{ content: { parts: [{ text: pick(b.contents[0].parts[0].text, b.contents[0].parts.length > 1) }] } }] });
      }
      if (req.url === '/nanogpt') {
        stats.nanogpt++;
        if (String(b.model).endsWith(':online')) stats.nanoOnline++;
        if (req.headers.authorization === 'Bearer nano-offline' && String(b.model).endsWith(':online')) return send(404, { error: 'model not found' });
        if (req.headers.authorization !== 'Bearer nano-ok' && req.headers.authorization !== 'Bearer nano-offline') return send(401, { error: 'chiave' });
        const m = b.messages[0].content;
        return send(200, { choices: [{ message: { content: pick(typeof m === 'string' ? m : m[0].text, Array.isArray(m)) } }] });
      }
      send(404, {});
    });
  }).listen(AI_PORT, '127.0.0.1');
}
let dir = '';

export default async function setup(project: TestProject) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/health`);
    throw new Error(`La porta ${PORT} è già occupata: chiudi il wrangler dev rimasto aperto`);
  } catch (e) {
    if ((e as Error).message.includes('occupata')) throw e;
  }
  dir = mkdtempSync(join(tmpdir(), 'ledgy-test-'));
  if (!existsSync('dist/index.html')) {
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/index.html', '<!doctype html><title>Ledgy</title>');
  }
  const run = (args: string[]) => execFileSync('npx', ['wrangler', 'd1', ...args, '--local', '--persist-to', dir], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
  run(['migrations', 'apply', 'ledgy']);
  // Utenti vecchi: ospite vuoto con sessione, ospite con dati e sessione, ospite senza sessione, account registrato.
  const h = (t: string) => createHash('sha256').update(t).digest('hex');
  const jan = '2026-01-01T00:00:00.000Z';
  const user = (id: string, email: string | null) => `INSERT INTO users (id, email, password_hash, created_at) VALUES ('${id}', ${email ? `'${email}'` : 'NULL'}, NULL, '${jan}');`;
  const session = (token: string, userId: string) => `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${h(token)}', '${userId}', '${jan}', '2099-01-01T00:00:00.000Z');`;
  const device = (id: string, token: string, userId: string) => `INSERT INTO devices (id, user_id, name, platform, method, token_hash, token_hint, created_at) VALUES ('${id}', '${userId}', 'Telefono', 'ios', 'shortcut', '${h(token)}', 'xxxx', '${jan}');`;
  const tx = (id: string, userId: string) => `INSERT INTO transactions (id, user_id, type, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, source, status, created_at, updated_at) VALUES ('${id}', '${userId}', 'expense', -5000, 'EUR', -5000, '2026-01-02T10:00:00+08:00', '2026-01-02T02:00:00.000Z', 'Vecchia spesa', 'manual', 'confirmed', '${jan}', '${jan}');`;
  run(['execute', 'ledgy', '--command', [
    user('usr_vuoto', null), session(OLD.emptyGuestSession, 'usr_vuoto'),
    user('usr_con_dati', null), session(OLD.fullGuestSession, 'usr_con_dati'), tx('tx_ospite_vecchio', 'usr_con_dati'),
    user('usr_abbandonato', null), device('dev_abbandonato', OLD.abandonedGuestPhone, 'usr_abbandonato'), tx('tx_abbandonato', 'usr_abbandonato'),
    user('usr_registrato', 'vecchio@example.com'), device('dev_registrato', OLD.registeredPhone, 'usr_registrato'),
    // Account alla versione 3 delle categorie che aveva tolto la regola predefinita "Uber": non deve tornare.
    user('usr_v3', 'v3@example.com'), session(OLD.v3Session, 'usr_v3'), "UPDATE users SET catalog_version = 3 WHERE id = 'usr_v3';",
    // Account con le categorie della versione 1 (stile Wallet), una personale sotto un gruppo ritirato e una regola.
    user('usr_v1', 'v1@example.com'), session(OLD.v1Session, 'usr_v1'),
    "INSERT INTO categories (id, user_id, name, parent_id, kind, position) VALUES ('cat_life~usr_v1', 'usr_v1', 'Vita e intrattenimento', NULL, 'expense', 0),"
      + " ('cat_life_streaming~usr_v1', 'usr_v1', 'TV, streaming', 'cat_life~usr_v1', 'expense', 1),"
      + " ('cat_food~usr_v1', 'usr_v1', 'Cibo e bevande', NULL, 'expense', 2),"
      + " ('cat_food_restaurant~usr_v1', 'usr_v1', 'Ristorante, fast-food', 'cat_food~usr_v1', 'expense', 3),"
      + " ('cat_food_bar~usr_v1', 'usr_v1', 'Il mio bar', 'cat_food~usr_v1', 'expense', 4),"
      + " ('cat_mia_v1', 'usr_v1', 'Concerti', 'cat_life~usr_v1', 'expense', 5);",
    "INSERT INTO transactions (id, user_id, type, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, category_id, review_choices, source, status, created_at, updated_at)"
      + ` VALUES ('tx_v1', 'usr_v1', 'expense', -9000, 'EUR', -9000, '2026-11-01T10:00:00+08:00', '2026-11-01T02:00:00.000Z', 'Netflix', 'cat_life_streaming~usr_v1', '["cat_life_streaming~usr_v1"]', 'manual', 'confirmed', '${jan}', '${jan}');`,
    "INSERT INTO rules (id, user_id, name, enabled, priority, definition, created_at, updated_at) VALUES ('rule_v1', 'usr_v1', 'Streaming', 1, 1,"
      + ` '{"conditions":[{"field":"merchant","op":"contains","value":"netflix"}],"actions":{"category_id":"cat_life_streaming~usr_v1"}}', '${jan}', '${jan}');`,
  ].join(' ')]);
  // Account con TUTTE le categorie della versione 1, una spesa in ognuna e la regola "Telefono" di allora.
  const f = 'usr_v1full';
  run(['execute', 'ledgy', '--command', [
    user(f, 'v1full@example.com'), session(OLD.v1FullSession, f),
    `INSERT INTO categories (id, user_id, name, parent_id, kind, position) VALUES ${V1_CATEGORIES.map((c, i) =>
      `('${c.id}~${f}', '${f}', '${c.name.replace(/'/g, "''")}', ${c.parent ? `'${c.parent}~${f}'` : 'NULL'}, '${c.kind}', ${i})`).join(', ')};`,
    `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, created_at) VALUES ('acc_cash~${f}', '${f}', 'Contanti', 'cash', 'EUR', 0, 0, '${jan}');`,
    `INSERT INTO transactions (id, user_id, type, account_id, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, category_id, source, status, created_at, updated_at) VALUES ${V1_CATEGORIES.map((c, i) =>
      `('tx_v1f_${i}', '${f}', '${c.kind}', 'acc_cash~${f}', ${c.kind === 'income' ? 1000 : -1000}, 'EUR', ${c.kind === 'income' ? 1000 : -1000}, '2026-11-01T10:00:00+08:00', '2026-11-01T02:00:00.000Z', 'Spesa ${i}', '${c.id}~${f}', 'manual', 'confirmed', '${jan}', '${jan}')`).join(', ')};`,
    `INSERT INTO rules (id, user_id, name, enabled, priority, definition, created_at, updated_at) VALUES ('rule_telco~${f}', '${f}', 'Telefono', 1, 22, '{"conditions":[{"field":"merchant","op":"regex","value":"telkomsel"}],"actions":{"category_id":"cat_comm_phone~${f}","nature":"need"}}', '${jan}', '${jan}');`,
  ].join(' ')]);
  // Archivio grande: 5.000 movimenti dal 2019 a oggi, 300 negozi, spese e qualche entrata, su un conto.
  {
    const p = 'usr_perf';
    const now = Date.now();
    const start = now - 7 * 365 * 86400_000;
    const rows: string[] = [];
    for (let i = 0; i < 5000; i++) {
      const t = new Date(start + Math.floor(((now - start) * i) / 5000)).toISOString();
      const inc = i % 40 === 0;
      const amt = inc ? 2_000_000 : -(5000 + ((i * 7919) % 200_000));
      rows.push(`('tx_p${i}', '${p}', '${inc ? 'income' : 'expense'}', 'acc_cash~${p}', ${amt}, 'EUR', ${amt}, '${t.slice(0, 19)}+08:00', '${t}', 'Negozio ${i % 300}', '${i % 3 ? 'Visa' : 'Jenius'}', 'wallet', 'confirmed', '${t}', '${t}')`);
    }
    const file = join(dir, 'perf.sql');
    writeFileSync(file, [
      user(p, 'archivio@example.com'), session(OLD.perfSession, p),
      `INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, created_at) VALUES ('acc_cash~${p}', '${p}', 'Contanti', 'cash', 'EUR', 0, 0, '${jan}');`,
      ...Array.from({ length: 50 }, (_, k) => `INSERT INTO transactions (id, user_id, type, account_id, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, card, source, status, created_at, updated_at) VALUES ${rows.slice(k * 100, k * 100 + 100).join(', ')};`),
    ].join('\n'));
    run(['execute', 'ledgy', '--file', file]);
  }
  ai = fakeAi();
  // File vuoto: evita che wrangler legga il .dev.vars dello sviluppatore.
  writeFileSync(join(dir, 'none.env'), '');
  proc = spawn('npx', [
    'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--env-file', join(dir, 'none.env'),
    '--test-scheduled', '--var', `AI_ENDPOINTS:${JSON.stringify({ gemini: `http://127.0.0.1:${AI_PORT}/gemini`, nanogpt: `http://127.0.0.1:${AI_PORT}/nanogpt` })}`, '--var', 'FX_FIXED:IDR:0.00005,SGD:0.7,USD:0.9,AED:0.25', '--var', `WALLET_API:http://127.0.0.1:${AI_PORT}/wallet/v1/api`,
    '--var', 'D1_ROWS:1', '--var', `TEST_DB_DOWN:${TEST_DB_DOWN}`,
  ], { stdio: 'ignore', env: { ...process.env, CI: '1' }, detached: true });
  const base = `http://127.0.0.1:${PORT}`;
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try {
      ready = (await fetch(`${base}/api/health`)).ok;
      if (ready) break;
    } catch {
      /* non ancora pronto */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Il Worker di test non è partito');
  project.provide('baseUrl', base);
  return () => {
    // wrangler avvia altri processi (workerd): si ferma l'intero gruppo.
    if (proc?.pid) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* già fermo */ }
    }
    ai?.close();
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}
