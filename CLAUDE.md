# Ledgy (nome provvisorio)

App personale per registrare le spese, pensata per sostituire Wallet by BudgetBakers. Gira come web app, Android e iPhone. Il proprietario vive a Bali: spende in IDR e altre valute del Sud-Est asiatico, ragiona in EUR.

Funzioni scelte, decisioni e note tecniche: [docs/funzioni.md](docs/funzioni.md).

## Regole di lavoro

- Rispondi in italiano.
- Lavora con un solo agente. Usa subagenti o più agenti solo quando fanno risparmiare uso del piano; altrimenti procedi da solo, anche se più lentamente.
- Non generare mai APK o IPA senza un permesso esplicito del proprietario. Le build mobili partono solo da un workflow manuale (`workflow_dispatch`), mai in automatico.
- In GitHub Actions ogni `actions/upload-artifact` usa `retention-days: 1`.
- APK e IPA, quando ci saranno, si pubblicano su **DMReleases**, come le altre app del proprietario (chiedere i dettagli prima della prima build).
- Repository pulito: niente build, file generati, screenshot o file temporanei nel repo.

## Comandi

- `npm test`: tutti i test. `npm run test:unit` solo la logica condivisa; `npm run test:integration` avvia il vero Worker (wrangler dev, D1 locale nuovo, tassi fissi) sulla porta 8799 e prova l'API.
- `npm run test:e2e`: prova dell'interfaccia con Playwright su un Worker già avviato (vedi l'intestazione di `tests/e2e/smoke.mjs`).
- `npm run typecheck`: controllo dei tipi di web app e Worker.
- `npm run build`: compila la web app in `dist/`.
- Sviluppo in locale: `npm run db:migrate:local`, poi `npm run build && npx wrangler dev` e si crea un account dalla schermata di accesso.
- `python3 tools/shortcut/build_shortcut.py`: rigenera il comando iPhone non firmato in `tools/shortcut/out/` (ignorata da git). La versione firmata con HubSign, servita dall'app a `/ledgy.shortcut`, è `public/ledgy.shortcut`: se cambia lo script, va rifirmata e sostituita.
- Pubblicazione: [docs/DEPLOY.md](docs/DEPLOY.md).

## Struttura

- `shared/`: logica pura usata da Worker, web app e test (importi, lettura notifiche, regole, doppioni). `keywords.ts`: parole chiave in molte lingue e marche → categoria (vince la parola più lunga).
- `worker/`: API su Hono e D1. `capture.ts` è il percorso notifica → movimento.
- `src/`: web app React. Navigazione con l'hash (`#/movimenti`, `#/m/<id>`).
- `migrations/`: schema D1. Importi interi in millesimi; segno negativo = uscita. `occurred_at` tiene il fuso del telefono, `occurred_utc` serve per ordinare e confrontare.

## Architettura decisa

- Frontend: React + Capacitor, un solo codice per web (PWA), Android e iOS. Parti native piccole in Kotlin (lettore notifiche) e Swift (App Intents, estensione Condividi).
- Backend: Cloudflare, sul piano gratuito del proprietario. Un solo Worker `ledgy` con static assets serve web app e API; D1 come database; R2 per le foto (quando servirà); Cron Trigger per le pulizie notturne. Niente Supabase.
- Limite da rispettare: 10 ms di CPU per richiesta sul piano gratuito. Tutto ciò che scorre molti dati (export, import, regole sullo storico, import da Wallet) lavora a pagine guidate dal browser.
- Account come Multifolio: si usa subito senza account come *ospite* (riga di `users` senza email, creata da `POST /api/guest`); poi si crea un account (email e password, impronta PBKDF2) o si entra in uno esistente scegliendo cosa fare dei dati dell'ospite (`worker/guest.ts`: unisci, usa solo l'account, sostituisci; per la registrazione porta i dati o inizia vuoto), con finestra di conferma. Ogni riga ha `user_id`; categorie, regole e conti iniziali hanno id con suffisso (`cat_food~usr_…`). Recupero con codice di recupero (24 caratteri), niente email né servizi esterni. Il Cron toglie gli ospiti vuoti dopo 7 giorni e quelli senza sessioni.
- Ordine: prima web app + server, con la cattura via automazioni del telefono (Comandi su iPhone, MacroDroid su Android). Poi le app native.
- Niente cifratura end-to-end: il server deve leggere il testo delle notifiche per creare le spese.
- Categoria di un movimento (`classify` in `worker/transactions.ts`): regole dell'utente → ultima spesa confermata dello stesso negozio (le correzioni vincono) → regole predefinite "morbide" (`definition.soft`, set per viaggiatori in `worker/seed.ts`, versione 3 delle categorie) → parole chiave → AI in background (`waitUntil`) → "da rivedere".
- AI (`worker/ai.ts`, come PackSnap): chiavi Gemini e NanoGPT per account in `ai_settings`, mai restituite intere all'app; sono nel backup (riga `ai` delle impostazioni, scelta del proprietario) e passano dall'ospite all'account se l'account non ne ha. Prima Gemini con la ricerca Google; con il limite gratuito raggiunto (429) si salta per un'ora e si usa NanoGPT (modello più economico, `:online` per cercare). Nei test Gemini e NanoGPT sono finti (`AI_ENDPOINTS`, server in `tests/integration/server.ts`).
- Home a schede (`src/pages/Home.tsx`, `HOME_WIDGETS`): accese e ordine in `users.home_layout`, nel backup come le altre impostazioni; le schede sconosciute si scartano. Il periodo (mese, anno, da inizio anno, date) è lo stesso di Statistiche (`src/period.ts`, scelta in `src/PeriodSheet.tsx`). Saldo di tutti i conti = somma di `balance_eur` dei conti (bootstrap, cambio di oggi). Lo stato della cattura sta in Altro, non in Home.
- Pubblicazione automatica: `.github/workflows/pubblica.yml` a ogni push sul branch (test → punto di ripristino → migrazioni → deploy → controllo).
- Categorie predefinite versione 2 (`worker/seed.ts`, `TREE`): gruppi facoltativi (Famiglia, Regali, Animali) creati spenti (`archived = 1`). `upgradeCatalog` porta gli account dalla versione 1 (stile Wallet) alla 2 al primo avvio: le predefinite diventano esattamente quelle nuove, movimenti e regole passano secondo `RETIRED`. Il test con tutte le categorie v1 è in `tests/integration` (`categories-v1.json`).
- Tema: `data-theme` su `<html>` (`light` = mockup, predefinito anche col telefono scuro; `blue`, `dark`, `system`), letto da `public/theme.js` prima del disegno. Valuta di visualizzazione: `eur()` in `src/util.ts` converte i totali in euro al tasso di oggi.
- Svuota il bilancio (`POST /api/account/wipe-transactions`, conferma `SVUOTA`): cancella solo movimenti e notifiche ricevute; conti, categorie, regole, carte, impostazioni e chiavi restano. Serve prima dell'import da Wallet.
- Il backup include tutte le tabelle dell'account, preferiti e impostazioni compresi: una tabella o impostazione nuova va aggiunta a `worker/backup.ts`, `src/backup.ts`, `worker/guest.ts` e alla pulizia in `worker/index.ts`.
