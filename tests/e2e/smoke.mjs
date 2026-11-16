// Prova dell'interfaccia in un browser a misura di iPhone (Playwright deve essere installato).
// Uso: avvia il Worker (vedi CLAUDE.md), poi
//   NODE_PATH=$(npm root -g) E2E_URL=http://127.0.0.1:8787 node tests/e2e/smoke.mjs
// Apre l'app senza account (ospite), controlla che ogni schermata si apra senza errori e senza uscire
// dallo schermo, prova i flussi principali (revisione, inserimento, regola, impostazioni), crea un
// account portando i dati (scelta + conferma), codice di recupero, backup, uscita, rientro unendo i
// dati dell'ospite, e alla fine elimina l'account di prova.
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
page.on('console', (m) => { if (m.type() === 'error' && !/\b(401|409)\b/.test(m.text())) errors.push(`console: ${m.text()}`); });

await page.goto(BASE);
await page.waitForSelector('.tabbar');
check(await page.isVisible('text=Stai usando Ledgy senza account'), "si usa subito, senza account, con l'invito a crearlo");

// Dati di prova inviati come farebbe un telefono.
const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch(p, i); return r.json(); }, [path, init]);
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const dev = await api('/api/capture/devices', json({ name: 'Telefono E2E', platform: 'android' }));
const inPath = new URL(dev.url).pathname;
const stamp = Date.now() % 100000;
await api(inPath, json({ title: 'Revolut', text: `Hai pagato Rp${60 + (stamp % 30)}.000 a Grab* E2E${stamp}` }));
await api(inPath, json({ title: 'BCA', text: `Transaksi berhasil Rp 41.${String(stamp % 1000).padStart(3, '0')} di INDOMARET E2E` }));

const me = () => api('/api/me');
check((await me()).guest === true, "l'ospite ha una sessione sul server");
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

check(!(await page.isVisible('text=Cambia password')), "l'ospite non vede cambio password e codice di recupero");

// Crea l'account: con dati sul dispositivo chiede cosa farne e chiede conferma.
await page.click('a:has-text("Crea account")');
await page.waitForSelector('.seg');
check(await page.isVisible('text=Continua senza account'), 'la pagina account si può lasciare senza registrarsi');
await page.fill('input[type=email]', EMAIL);
await page.fill('input[autocomplete=new-password] >> nth=0', PASSWORD);
await page.fill('input[autocomplete=new-password] >> nth=1', PASSWORD);
await page.click('button.primary:has-text("Crea account")');
await page.waitForSelector('text=Porta i dati nel nuovo account');
await page.click('button:has-text("Inizia con un account vuoto")');
await page.waitForSelector('[role=alertdialog]');
check(await page.isVisible('[role=alertdialog] >> text=Non si può annullare'), 'la scelta che cancella i dati chiede conferma');
await page.click('[role=alertdialog] button:has-text("Annulla")');
check(!(await page.isVisible('[role=alertdialog]')) && (await me()).guest === true, 'annullando la conferma non cambia nulla');
await page.click('button:has-text("Porta i dati nel nuovo account")');
await page.click('[role=alertdialog] button:has-text("Conferma")');
await page.waitForSelector('.tabbar');
check((await me()).email === EMAIL, 'crea l’account portando i dati');
const owned = (await api('/api/transactions?limit=500')).items.length;
check(owned >= 3, `i dati dell'ospite sono nell'account (${owned} movimenti)`);
await page.goto(`${BASE}/#/altro`);
await page.waitForSelector('text=Cambia password');

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

// Esce: l'app torna ospite, vuota. Una spesa da ospite, poi rientra e la aggiunge all'account.
await page.goto(`${BASE}/#/altro`);
await page.click('button:has-text("Esci")');
await page.waitForSelector('text=Stai usando Ledgy senza account');
check((await me()).guest === true && (await api('/api/transactions')).items.length === 0, "dopo l'uscita si riparte da ospite, senza i dati dell'account");
await api('/api/transactions', json({ amount: 5, currency: 'EUR', merchant: 'Spesa da ospite E2E' }));
await page.goto(`${BASE}/#/account`);
await page.click('button:has-text("Password dimenticata?")');
check(await page.isVisible('text=Codice di recupero'), '"Password dimenticata?" chiede il codice di recupero');
await page.click("text=Torna all'accesso");
await page.fill('input[type=email]', EMAIL);
await page.fill('input[type=password]', PASSWORD);
await page.click('button.primary:has-text("Entra")');
await page.waitForSelector("text=Aggiungi all'account");
check(await page.isVisible("text=Sostituisci i dati dell'account") && await page.isVisible("text=Usa solo i dati dell'account"), 'entrando con dati offre le tre scelte');
await page.click("button:has-text(\"Aggiungi all'account\")");
await page.click('[role=alertdialog] button:has-text("Conferma")');
await page.waitForSelector('.tabbar');
check((await me()).email === EMAIL && (await api('/api/transactions?limit=500')).items.length === before + 1, "rientra e aggiunge la spesa fatta da ospite");
await page.goto(`${BASE}/#/altro`);
await page.click('button:has-text("Elimina account")');
await page.fill('input[aria-label="Password per eliminare l\'account"]', PASSWORD);
await page.click('button:has-text("Elimina per sempre")');
await page.waitForSelector('text=Stai usando Ledgy senza account');
const gone = await page.evaluate(async ([e, p]) => (await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: e, password: p }) })).status, [EMAIL, PASSWORD]);
check(gone === 401, "elimina l'account di prova");
check(errors.length === 0, `nessun errore in console${errors.length ? `: ${errors.join(' | ')}` : ''}`);
await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} controlli falliti`);
  process.exit(1);
}
console.log('\nTutti i controlli passati');
