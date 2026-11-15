# Ledgy (nome provvisorio)

App personale per registrare le spese, pensata per sostituire Wallet by BudgetBakers. Gira come web app, Android e iPhone. Il proprietario vive a Bali: spende in IDR e altre valute del Sud-Est asiatico, ragiona in EUR.

Funzioni scelte, decisioni e note tecniche: [docs/funzioni.md](docs/funzioni.md).

## Regole di lavoro

- Rispondi in italiano.
- Lavora con un solo agente. Usa subagenti o più agenti solo quando fanno risparmiare uso del piano; altrimenti procedi da solo, anche se più lentamente.
- Non generare mai APK o IPA senza un permesso esplicito del proprietario. Le build mobili partono solo da un workflow manuale (`workflow_dispatch`), mai in automatico.
- In GitHub Actions ogni `actions/upload-artifact` usa `retention-days: 1`.
- Repository pulito: niente build, file generati, screenshot o file temporanei nel repo.

## Architettura decisa

- Frontend: React + Capacitor, un solo codice per web (PWA), Android e iOS. Parti native piccole in Kotlin (lettore notifiche) e Swift (App Intents, estensione Condividi).
- Backend: Cloudflare, sul piano gratuito del proprietario. Pages per la web app, Workers per API e webhook, D1 come database, R2 per le foto, Cron Triggers per cambi, riepiloghi e controllo della cattura. Niente Supabase.
- Ordine: prima web app + server, con la cattura via automazioni del telefono (Comandi su iPhone, MacroDroid su Android). Poi le app native.
- Niente cifratura end-to-end: il server deve leggere il testo delle notifiche per creare le spese.
