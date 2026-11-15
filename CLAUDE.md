# Ledgy (nome provvisorio)

App personale per registrare le spese, pensata per sostituire Wallet by BudgetBakers. Gira come web app, Android e iPhone. Il proprietario vive a Bali: spende in IDR e altre valute del Sud-Est asiatico, ragiona in EUR.

Funzioni scelte, decisioni e note tecniche: [docs/funzioni.md](docs/funzioni.md).

## Regole di lavoro

- Rispondi in italiano.
- Lavora con un solo agente. Usa subagenti o più agenti solo quando fanno risparmiare uso del piano; altrimenti procedi da solo, anche se più lentamente.
- Non generare mai APK o IPA senza un permesso esplicito del proprietario. Le build mobili partono solo da un workflow manuale (`workflow_dispatch`), mai in automatico.
- In GitHub Actions ogni `actions/upload-artifact` usa `retention-days: 1`.
- Repository pulito: niente build, file generati, screenshot o file temporanei nel repo.

## Comandi

- `npm test`: test della logica condivisa (importi, lettura notifiche, regole, doppioni).
- `npm run typecheck`: controllo dei tipi di web app e Worker.
- `npm run build`: compila la web app in `dist/`.
- Sviluppo in locale: `npm run db:migrate:local`, un file `.dev.vars` con `APP_PASSWORD=...`, poi `npm run build && npx wrangler dev`.
- `python3 tools/shortcut/build_shortcut.py`: rigenera il comando iPhone non firmato in `tools/shortcut/out/` (ignorata da git). La versione firmata con HubSign, servita dall'app a `/ledgy.shortcut`, è `public/ledgy.shortcut`: se cambia lo script, va rifirmata e sostituita.
- Pubblicazione: [docs/DEPLOY.md](docs/DEPLOY.md).

## Struttura

- `shared/`: logica pura usata da Worker, web app e test (importi, lettura notifiche, regole, doppioni).
- `worker/`: API su Hono e D1. `capture.ts` è il percorso notifica → movimento.
- `src/`: web app React. Navigazione con l'hash (`#/movimenti`, `#/m/<id>`).
- `migrations/`: schema D1. Importi interi in millesimi; segno negativo = uscita. `occurred_at` tiene il fuso del telefono, `occurred_utc` serve per ordinare e confrontare.

## Architettura decisa

- Frontend: React + Capacitor, un solo codice per web (PWA), Android e iOS. Parti native piccole in Kotlin (lettore notifiche) e Swift (App Intents, estensione Condividi).
- Backend: Cloudflare, sul piano gratuito del proprietario. Pages per la web app, Workers per API e webhook, D1 come database, R2 per le foto, Cron Triggers per cambi, riepiloghi e controllo della cattura. Niente Supabase.
- Ordine: prima web app + server, con la cattura via automazioni del telefono (Comandi su iPhone, MacroDroid su Android). Poi le app native.
- Niente cifratura end-to-end: il server deve leggere il testo delle notifiche per creare le spese.
