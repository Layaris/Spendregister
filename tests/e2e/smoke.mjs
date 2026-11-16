// Prova dell'interfaccia in un browser a misura di iPhone (Playwright deve essere installato).
// Uso: avvia il Worker (vedi CLAUDE.md), poi
//   NODE_PATH=$(npm root -g) E2E_URL=http://127.0.0.1:8787 node tests/e2e/smoke.mjs
// Crea un account di prova nuovo, controlla che ogni schermata si apra senza errori e senza uscire
// dallo schermo, prova i flussi principali (registrazione, recupero, revisione, inserimento, regola,
// impostazioni, codice di recupero, backup, uscita e accesso) e alla fine elimina l'account.
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Playwright può essere installato globalmente: lo si cerca anche in NODE_PATH.
const { chromium } = createRequire(import.meta.url)('playwright');

const BASE = process.env.E2E_URL ?? 'http://127.0.0.1:8787';
const EMAIL = `e2e-${Date.now()}@example.com`;
const PASSWORD = 'password-e2e-123';
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'ERRORE'} ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(`console: ${m.text()}`); });

await page.goto(BASE);
check(await page.isVisible('text=Password dimenticata?'), 'la schermata di accesso offre il recupero');
await page.click('text=Password dimenticata?');
check(await page.isVisible('text=Codice di recupero'), '"Password dimenticata?" chiede il codice di recupero');
await page.click("text=Torna all'accesso");
await page.click('.seg button:has-text("Crea account")');
await page.fill('input[type=email]', EMAIL);
await page.fill('input[autocomplete=new-password] >> nth=0', PASSWORD);
await page.fill('input[autocomplete=new-password] >> nth=1', PASSWORD);
await page.click('button.primary:has-text("Crea account")');
await page.waitForSelector('.tabbar');
check(true, 'crea un account ed entra');

// Dati di prova inviati come farebbe un telefono.
const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return r.json(); }, [path, init]);
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const dev = await api('/api/capture/devices', json({ name: 'Telefono E2E', platform: 'android' }));
const inPath = new URL(dev.url).pathname;
const stamp = Date.now() % 100000;
await api(inPath, json({ title: 'Revolut', text: `Hai pagato Rp${60 + (stamp % 30)}.000 a Grab* E2E${stamp}` }));
await api(inPath, json({ title: 'BCA', text: `Transaksi berhasil Rp 41.${String(stamp % 1000).padStart(3, '0')} di INDOMARET E2E` }));

const grabRule = (await api('/api/rules')).items.find((r) => r.name === 'Grab').id;
const routes = ['', 'rivedere', 'movimenti', 'aggiungi', 'statistiche', 'regole', `regole/${grabRule}`, 'cattura', 'altro', 'assistente'];
for (const r of routes) {
  await page.goto(`${BASE}/#/${r}`);
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, `#/${r || ''} senza scorrimento orizzontale`);
}

// Rivedere: risolve la Grab nella fascia "chiedimi".
await page.goto(`${BASE}/#/rivedere`);
await page.waitForSelector(`text=Grab`);
const reviewBefore = (await api('/api/bootstrap')).review_count;
await page.click('section.card button:has-text("Ristorante, fast-food")');
await page.waitForTimeout(700);
check((await api('/api/bootstrap')).review_count === reviewBefore - 1, 'risolve una spesa da rivedere con un tocco');

// Aggiungi: tastierino, niente zeri iniziali, salvataggio.
await page.goto(`${BASE}/#/aggiungi`);
await page.waitForSelector('.keypad');
await page.click('.keypad button:text-is("000")');
check((await page.textContent('.hero-amount')).trim() === '0', 'il tastierino ignora gli zeri iniziali');
for (const k of ['3', '5', '000']) await page.click(`.keypad button:text-is("${k}")`);
check((await page.textContent('.hero-amount')).trim() === '35.000', 'il tastierino scrive 35.000');
await page.fill('input[placeholder^="Es. Warung"]', 'Caffè E2E');
await page.click('button:has-text("Salva spesa")');
await page.waitForFunction(() => location.hash.startsWith('#/m/'));
check(true, 'salva una spesa e apre il dettaglio');

// Regola: anteprima sullo storico.
await page.goto(`${BASE}/#/regole/${grabRule}`);
await page.click('button:has-text("Prova")');
await page.waitForSelector('p:has-text("Corrisponde a")');
check(true, "l'anteprima della regola risponde");

// Impostazioni: fuso orario.
await page.goto(`${BASE}/#/altro`);
await page.selectOption('select:near(:text("Fuso orario"))', 'Asia/Jakarta');
await page.waitForTimeout(600);
check((await api('/api/settings')).timezone === 'Asia/Jakarta', 'salva il fuso orario');
await page.selectOption('select:near(:text("Fuso orario"))', 'Asia/Makassar');
await page.waitForTimeout(400);

// Codice di recupero: si crea con la password e si vede una volta sola.
await page.click('button:has-text("Crea il codice di recupero")');
await page.fill('input[aria-label="Password attuale per creare il codice"]', PASSWORD);
await page.click('button:has-text("Crea il codice")');
await page.waitForSelector('text=non lo vedrai più');
const shown = (await page.textContent('.raw')).trim();
check(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/.test(shown), 'mostra il codice di recupero nel formato giusto');
await page.click("button:has-text(\"L'ho salvato\")");
check(await page.isVisible('text=Attivo dal'), 'dopo il salvataggio il codice risulta attivo e non è più visibile');

// Backup: esporta e reimporta in "aggiungi" (non deve duplicare nulla).
const before = (await api('/api/transactions?limit=500')).items.length;
const [download] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Esporta backup")')]);
const file = join(mkdtempSync(join(tmpdir(), 'ledgy-e2e-')), 'backup.json');
await download.saveAs(file);
const backup = JSON.parse(readFileSync(file, 'utf8'));
check(backup.format === 'ledgy-backup' && backup.tables.transactions.length === before, `esporta il backup (${before} movimenti)`);
const [csv] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Esporta CSV")')]);
check(csv.suggestedFilename().endsWith('.csv'), 'esporta il CSV');
await page.setInputFiles('input[type=file]', file);
await page.waitForSelector('text=Come vuoi importarlo?');
await page.click('button:has-text("Aggiungi ai dati attuali")');
await page.waitForSelector('text=già presenti', { timeout: 20000 });
check((await api('/api/transactions?limit=500')).items.length === before, '"aggiungi" con lo stesso backup non duplica');

// Esce, rientra con email e password, poi elimina l'account di prova.
await page.goto(`${BASE}/#/altro`);
await page.click('button:has-text("Esci")');
await page.waitForSelector('text=Password dimenticata?');
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button.primary:has-text("Entra")');
await page.waitForSelector('.tabbar');
check((await api('/api/transactions?limit=500')).items.length === before, 'rientra con email e password e ritrova i dati');
await page.goto(`${BASE}/#/altro`);
await page.click('button:has-text("Elimina account")');
await page.fill('input[aria-label="Password per eliminare l\'account"]', PASSWORD);
await page.click('button:has-text("Elimina per sempre")');
await page.waitForSelector('text=Password dimenticata?');
const gone = await page.evaluate(async ([e, p]) => (await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).status, [EMAIL, PASSWORD]);
check(gone === 401, "elimina l'account di prova");
check(errors.length === 0, `nessun errore in console${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} controlli falliti`);
  process.exit(1);
}
console.log('\nTutti i controlli passati');
