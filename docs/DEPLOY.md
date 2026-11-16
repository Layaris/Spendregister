# Pubblicare Ledgy su Cloudflare

Ledgy è un solo Cloudflare Worker che serve la web app e l'API, con un database D1. Tutto rientra nel piano gratuito.

## Cosa serve

- Node.js 22 o più recente e git.
- Un account Cloudflare. Per lavorare senza browser: un API token con i permessi **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read**, più l'Account ID.

## Prima pubblicazione (già fatta il 15 novembre 2026: non ripeterla)

Il database `ledgy` esiste già (id `48dc70af-3f0d-46ab-a832-e9661ccf63b2`, già scritto in `wrangler.jsonc`). Questa sezione serve solo per ricreare tutto su un altro account.

```bash
git clone https://github.com/Layaris/Spendregister.git
cd Spendregister
git checkout claude/friendly-johnson-c89c0f   # finché il lavoro non è unito su main
npm ci

# Accesso a Cloudflare: token (senza browser) oppure "npx wrangler login"
export CLOUDFLARE_API_TOKEN="<token>"
export CLOUDFLARE_ACCOUNT_ID="<account id>"

# 1. Database D1: copia il "database_id" stampato dal comando
npx wrangler d1 create ledgy
# 2. Metti quel valore in wrangler.jsonc (già fatto per il database attuale: 48dc70af-…)
# 3. Crea le tabelle
npx wrangler d1 migrations apply ledgy --remote
# 4. Compila e pubblica (stampa l'indirizzo https://ledgy.<sottodominio>.workers.dev)
npm run deploy
# 5. Imposta la password di accesso (chiesta in modo interattivo, non finisce nella cronologia)
npx wrangler secret put APP_PASSWORD
# 6. Verifica
curl https://ledgy.<sottodominio>.workers.dev/api/health   # deve rispondere {"ok":true}
```

Se è il primo Worker dell'account, Cloudflare chiede di scegliere il sottodominio `workers.dev`: va accettato.

## Aggiornamento e verifica (da usare ogni volta)

Funziona qualunque sia lo stato di partenza: allinea il codice, applica le migrazioni mancanti, pubblica e controlla.

```bash
git fetch origin
git checkout claude/friendly-johnson-c89c0f
git reset --hard origin/claude/friendly-johnson-c89c0f   # scarta modifiche locali: tutto il necessario è già nel repository
npm ci
npx wrangler d1 list                                     # un solo database "ledgy", id 48dc70af-3f0d-46ab-a832-e9661ccf63b2
npx wrangler d1 migrations apply ledgy --remote          # applica solo quelle mancanti
npx wrangler d1 execute ledgy --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npm run deploy
npx wrangler secret list                                 # APP_PASSWORD serve solo finché i dati vecchi non sono collegati a un account
```

Controlli finali (sostituisci l'indirizzo):

```bash
curl -s https://ledgy.<sottodominio>.workers.dev/api/health                       # {"ok":true}
curl -sI https://ledgy.<sottodominio>.workers.dev/ledgy.shortcut                  # 200, Content-Disposition: attachment
curl -s https://ledgy.<sottodominio>.workers.dev/api/auth/status                  # {"legacy_available":true} finché i dati vecchi non sono collegati, poi false
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ledgy.<sottodominio>.workers.dev/api/login \
  -H 'content-type: application/json' -d '{"email":"nessuno@example.com","password":"prova-sbagliata"}'   # 401; 500 = migrazione mancante
```

Tabelle attese: accounts, captures, categories, devices, fx_rates, labels, login_attempts, parsers, rules, sessions, settings, transaction_labels, transactions, users (più le tabelle interne `d1_migrations` e `_cf_KV`).

## Problemi tipici

| Sintomo | Causa | Rimedio |
|---|---|---|
| Accesso o registrazione: "Errore interno del server" | Codice nuovo senza le migrazioni (fino a `0004_accounts`) | `npx wrangler d1 migrations apply ledgy --remote` |
| "Collega i tuoi dati": "La vecchia password non è corretta" | Password diversa da quella usata finora (o da `APP_PASSWORD` se non era mai stata cambiata) | Usare l'ultima password con cui si entrava; vedi "Emergenza" |
| Il tasto "Collega i tuoi dati" non compare | I dati vecchi sono già collegati a un'email | Entrare con quell'email |
| `git pull` si ferma per modifiche locali | `wrangler.jsonc` modificato a mano | `git reset --hard origin/claude/friendly-johnson-c89c0f` |
| Due database "ledgy" o id diverso in `wrangler.jsonc` | `d1 create` rifatto per errore | Tenere quello con id `48dc70af-…`; l'altro si cancella solo se vuoto |
| L'app mostra la versione vecchia | `npm run deploy` non eseguito dopo l'aggiornamento | `npm run deploy` |

## Dove si trova su Cloudflare

- **App e API**: dashboard Cloudflare → Workers & Pages → **ledgy**. È un Worker (non un progetto Pages) che serve sia la web app sia l'API. L'indirizzo pubblico è `https://ledgy.<sottodominio>.workers.dev`, visibile nella pagina del Worker.
- **Database**: Storage & Databases → D1 → **ledgy**.
- **Password e chiavi**: Workers & Pages → ledgy → Settings → Variables and Secrets.

## Account, password e recupero

- **Il sito è aperto a tutti, come Multifolio**: chi lo apre vede "Entra / Crea account" e si registra con email e password (almeno 10 caratteri). Ogni account vede solo i propri dati, con le sue categorie, regole, conti e telefoni collegati. Nessuna email viene inviata: l'email serve solo come nome dell'account.
- **Dati della versione con una sola password** (migrazione `0004_accounts`): restano in un account senza email. Nella schermata di accesso compare "Usavi Ledgy con la vecchia password? Collega i tuoi dati": si scrivono email, nuova password e la vecchia password (quella con cui si entrava, oppure `APP_PASSWORD` se non era mai stata cambiata). Si fa una volta sola; dopo, il tasto sparisce. I telefoni già collegati continuano a funzionare senza cambiare nulla.
- Dopo il collegamento il secret `APP_PASSWORD` non serve più: si può tenere per l'emergenza qui sotto, oppure cancellare (`npx wrangler secret delete APP_PASSWORD`).
- **Recupero, come in Multifolio, senza email**: in Altro → Impostazioni si crea un *codice di recupero* (24 caratteri, mostrato una volta sola). Se si dimentica la password: schermata di accesso → "Password dimenticata?" → email + codice + nuova password.
- Limiti contro i tentativi a raffica: 10 errori in 15 minuti dallo stesso indirizzo IP o sulla stessa email bloccano per 15 minuti; al massimo 5 account nuovi all'ora dalla stessa rete.
- Altro → "Elimina account" cancella l'account e tutti i suoi dati (serve la password).
- **Emergenza** (solo per l'account con i dati della vecchia versione, persi password e codice): l'agente stacca l'email da quell'account e reimposta `APP_PASSWORD`; poi si rifà "Collega i tuoi dati" con quel secret.

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler d1 execute ledgy --remote --command "UPDATE users SET email = NULL, password_hash = NULL WHERE id = 'owner'; DELETE FROM sessions WHERE user_id = 'owner'"
```

## Pulizia di Cloudflare

Su Cloudflare per Ledgy servono solo il Worker **ledgy** e il database D1 **ledgy** (id `48dc70af-3f0d-46ab-a832-e9661ccf63b2`), più il secret **APP_PASSWORD** finché i dati vecchi non sono collegati a un account. Tutto il resto creato per Ledgy si può togliere. Non toccare risorse di altri progetti (per esempio Multifolio).

```bash
npx wrangler secret list                     # tenere solo APP_PASSWORD
npx wrangler secret delete RESEND_API_KEY    # e così per RECOVERY_EMAIL, MAIL_FROM, MAIL_DRY_RUN, FX_FIXED se presenti
npx wrangler d1 list                         # altri database con "ledgy" o "spendregister" nel nome: npx wrangler d1 delete <nome>
npx wrangler pages project list              # progetti Pages "ledgy"/"spendregister": npx wrangler pages project delete <nome>
npx wrangler kv namespace list               # namespace con quei nomi: npx wrangler kv namespace delete --namespace-id <id>
npx wrangler r2 bucket list                  # bucket con quei nomi: npx wrangler r2 bucket delete <nome>
```

La tabella `password_resets` del vecchio recupero via email la cancella da sola la migrazione `0003_recovery_code`.

## Dominio personalizzato (facoltativo)

Dashboard Cloudflare → Workers & Pages → ledgy → Settings → Domains & Routes → Add → Custom domain, per esempio `ledgy.tuodominio.com`. Il dominio deve essere già gestito da Cloudflare. Dopo il cambio di dominio gli indirizzi privati dei telefoni vanno ricreati dalla schermata Cattura automatica, perché contengono il dominio.

## Note

- Gli indirizzi `/api/in/<token>` sono pubblici per scelta: è da lì che i telefoni mandano le notifiche. Ogni token vale per un solo telefono e si revoca da "Cattura automatica".
- Registrazione, accesso e recupero sono pubblici; tutto il resto dell'API richiede un account e lavora solo sui suoi dati.
- Il database si esporta in qualsiasi momento da Altro → Backup (file JSON reimportabile, oppure CSV), oppure con `npx wrangler d1 export ledgy --remote --output backup.sql`.
- Il piano gratuito concede 10 ms di CPU per richiesta: per questo export, import e applicazione delle regole allo storico lavorano a pagine, e il file di backup si compone nel browser.
- D1 tiene in automatico la cronologia (7 giorni sul piano gratuito, 30 su quello a pagamento): per tornare indietro `npx wrangler d1 time-travel restore ledgy --timestamp <data ISO>`.
