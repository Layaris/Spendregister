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
// Telefono in modalità scura: l'app deve partire comunque con il tema chiaro del mockup.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true, colorScheme: 'dark' });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/\b(401|409)\b/.test(m.text())) errors.push(`console: ${m.text()}`); });

await page.goto(BASE);
await page.waitForSelector('.tabbar');
check(await page.isVisible('text=Stai usando Ledgy senza account'), "si usa subito, senza account, con l'invito a crearlo");
check(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) === 'rgb(241, 244, 242)', 'tema chiaro del mockup anche col telefono in modalità scura');

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
const routes = ['', 'rivedere', 'movimenti', 'aggiungi', 'aggiungi/entrata', 'statistiche', 'statistiche/spese', 'statistiche/flusso', 'statistiche/entrate', 'statistiche/saldo', 'regole', `regole/${grabRule}`, 'cattura', 'altro', 'categorie', 'carte', 'assistente'];
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
await page.click('section.card button:has-text("Ristoranti")');
await page.waitForTimeout(700);
check((await api('/api/bootstrap')).review_count === reviewBefore - 1, 'risolve una spesa da rivedere con un tocco');

// Aggiungi: tastierino, niente zeri iniziali, salvataggio.
await page.goto(`${BASE}/#/aggiungi`);
await page.waitForSelector('.pad');
await page.click('.pad button:text-is("000")');
check((await page.textContent('.amount-card .amount')).trim() === '0', 'il tastierino ignora gli zeri iniziali');
for (const k of ['3', '5', '000']) await page.click(`.pad button:text-is("${k}")`);
check((await page.textContent('.amount-card .amount')).trim() === '−35.000', 'il tastierino scrive −35.000 in rosso');
await page.fill('textarea[aria-label="Descrizione"]', 'Colazione E2E');
await page.fill('input[placeholder="Negozio o persona"]', 'Caffè E2E');
check(!(await page.isVisible('.pad')) && await page.isVisible('.padsheet button:has-text("Salva spesa")'), 'scrivendo il testo il tastierino lascia posto, il salvataggio resta a portata');
await page.click('.padsheet button:has-text("Salva spesa")');
await page.waitForFunction(() => location.hash.startsWith('#/m/'));
check(true, 'salva una spesa e apre il dettaglio');

// Dettaglio: la nota si scrive direttamente e si salva lasciando il campo.
const txId = await page.evaluate(() => location.hash.split('/').pop());
check((await api(`/api/transactions/${txId}`)).note === 'Colazione E2E', 'la descrizione scritta nella schermata + si salva');
await page.fill('textarea[placeholder="Aggiungi una descrizione"]', 'Nota E2E');
await page.click('.section-title:has-text("Dettagli")');
await page.waitForTimeout(700);
check((await api(`/api/transactions/${txId}`)).note === 'Nota E2E', 'la nota si modifica e si salva dal dettaglio');

// Schermata +: sottocategoria nuova con un tap dal pannello, e preferito con la stellina.
await page.goto(`${BASE}/#/aggiungi`);
await page.waitForSelector('.pad');
for (const k of ['2', '5', '000']) await page.click(`.pad button:text-is("${k}")`);
await page.fill('input[placeholder="Negozio o persona"]', 'Gelateria E2E');
await page.click('button.lrow:has-text("Categoria")');
await page.waitForSelector('[aria-label="Scegli la categoria"]');
await page.click('[aria-label="Scegli la categoria"] .pill.add >> nth=0');
await page.fill('input[placeholder="Nome della sottocategoria"]', 'Gelato E2E');
await page.click('[aria-label="Scegli la categoria"] button:has-text("Crea")');
await page.waitForSelector('button.lrow:has-text("Gelato E2E")');
check(true, 'crea una sottocategoria dal pannello e la sceglie');
await page.click('button[aria-label="Scrivi l\'importo"]');
await page.click('.pad button:text-is("5")');
await page.click('.pad button[aria-label="Cancella"]');
await page.click('button[aria-label="Salva anche nei preferiti"]');
await page.click('.pad button.save');
await page.waitForFunction(() => location.hash.startsWith('#/m/'));
check((await api('/api/favorites')).items.some((f) => f.name === 'Gelateria E2E'), 'salva la spesa anche tra i preferiti');
await page.goto(`${BASE}/#/aggiungi`);
await page.click('button:has-text("Preferiti")');
await page.click('[aria-label="Preferiti"] .lrow:has-text("Gelateria E2E")');
check((await page.textContent('.amount-card .amount')).trim() === '−25.000' && await page.inputValue('input[placeholder="Negozio o persona"]') === 'Gelateria E2E', 'un tap su un preferito compila importo e nome');

// Statistiche: periodo dal pannello in basso.
await page.goto(`${BASE}/#/statistiche`);
await page.click('.periodbar-label');
await page.click('.sheet-option:has-text("Quest’anno")');
check((await page.textContent('.periodbar-label')).includes('Quest’anno'), 'cambia il periodo delle statistiche');
await page.click('a[href="#/statistiche/flusso"]');
await page.waitForSelector('text=Sto spendendo meno di quanto guadagno?');
check(true, 'apre il dettaglio del flusso di cassa');

// Cattura: lettore creato da una notifica arrivata, già compilato; si scrive solo il nome della carta.
await page.goto(`${BASE}/#/cattura`);
// Carta scelta direttamente dalla notifica: vale per tutte quelle con lo stesso titolo.
await page.click('button[aria-label^="Carta della notifica"] >> nth=0');
await page.fill('input[placeholder="Nuova carta, es. Xplace"]', 'Banca E2E');
await page.click('[aria-label="Carta o banca"] button:has-text("Usa")');
await page.waitForSelector('button[aria-label="Carta della notifica: Banca E2E"]');
check((await api('/api/cards')).items.some((c) => c.name === 'Banca E2E' && c.count >= 1), 'sceglie la carta dalla notifica con un tocco');
await page.goto(`${BASE}/#/carte`);
await page.waitForSelector('text=Banca E2E');
check(true, 'la pagina Carte e banche mostra la carta');
await page.goto(`${BASE}/#/statistiche/spese`);
await page.waitForSelector('text=Per categoria');
check(await page.isVisible('text=Per carta') || (await api('/api/transactions?limit=500')).items.every((t) => !t.card || t.occurred_at.slice(0, 7) !== new Date().toISOString().slice(0, 7)), 'statistiche: spesa per carta');
await page.goto(`${BASE}/#/cattura`);
await page.click('button[aria-label="Carta della notifica: Banca E2E"] >> nth=0');
await page.click('button:has-text("Formato strano? Crea un lettore")');
await page.waitForSelector('input[placeholder="Es. Xplace, Jago"]');
check((await page.inputValue('input.mono')).includes('(?<amount>') && (await page.inputValue('textarea.input')).length > 10, 'il lettore da una notifica arriva già compilato');
await page.fill('input[placeholder="Es. Xplace, Jago"]', 'Carta E2E');
await page.click('button:text-is("Prova")');
await page.waitForSelector('.raw:has-text("Importo")');
check((await page.textContent('.raw:has-text("Importo")')).includes('carta Carta E2E'), 'la prova mostra importo, negozio e carta');
await page.screenshot({ path: process.env.E2E_SHOT ?? '/dev/null' }).catch(() => {});
await page.click('button:has-text("Salva lettore")');
await page.waitForTimeout(800);
check((await api('/api/capture/parsers')).items.some((p) => p.name === 'Carta E2E'), 'salva il lettore');

// Home: si spegne l'andamento e si accende "Entrate e uscite", nell'ordine scelto.
await page.goto(`${BASE}/#/`);
await page.click('button[aria-label="Personalizza la Home"]');
await page.click('[aria-label="Personalizza la Home"] button[aria-label="Mostra Andamento del saldo"]');
await page.waitForTimeout(500);
await page.click('[aria-label="Personalizza la Home"] button[aria-label="Nascondi Andamento del saldo"]');
await page.click('[aria-label="Personalizza la Home"] button[aria-label="Sposta su Entrate e uscite"]');
await page.waitForTimeout(500);
await page.click('[aria-label="Personalizza la Home"] button:has-text("Fatto")');
const home = (await api('/api/bootstrap')).settings.home_layout;
check(home.includes('cashflow') && !home.includes('balance') && home.indexOf('cashflow') < home.indexOf('accounts'), 'la Home si personalizza e si salva');
check(await page.isVisible('h2:has-text("Entrate e uscite")'), 'la scheda Entrate e uscite è in Home');

// Categorie: un gruppo facoltativo si accende e si spegne.
await page.goto(`${BASE}/#/categorie`);
await page.click('button[aria-label="Accendi Animali"]');
await page.waitForSelector('button[aria-label="Spegni Animali"]');
check((await api('/api/bootstrap')).categories.some((c) => c.name === 'Veterinario'), 'accende un gruppo di categorie');
await page.click('button[aria-label="Spegni Animali"]');
await page.waitForSelector('button[aria-label="Accendi Animali"]');

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
await page.waitForFunction(() => location.hash === '#/account/crea');
await page.waitForSelector('input[type=email]');
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
