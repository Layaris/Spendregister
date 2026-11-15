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
npx wrangler secret list                                 # deve esserci APP_PASSWORD
```

Controlli finali (sostituisci l'indirizzo):

```bash
curl -s https://ledgy.<sottodominio>.workers.dev/api/health                       # {"ok":true}
curl -sI https://ledgy.<sottodominio>.workers.dev/ledgy.shortcut                  # 200, Content-Disposition: attachment
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://ledgy.<sottodominio>.workers.dev/api/login \
  -H 'content-type: application/json' -d '{"password":"prova-sbagliata"}'          # 401; 500 = migrazione mancante, 503 = APP_PASSWORD mancante
```

Tabelle attese: accounts, captures, categories, devices, fx_rates, labels, login_attempts, parsers, password_resets, rules, sessions, settings, transaction_labels, transactions (più le tabelle interne `d1_migrations` e `_cf_KV`).

## Problemi tipici

| Sintomo | Causa | Rimedio |
|---|---|---|
| Accesso: "Errore interno del server" | Codice nuovo senza la migrazione `0002_auth_backup` | `npx wrangler d1 migrations apply ledgy --remote` |
| Accesso: "Password non configurata sul server" | Manca il secret `APP_PASSWORD` | `npx wrangler secret put APP_PASSWORD` |
| `git pull` si ferma per modifiche locali | `wrangler.jsonc` modificato a mano | `git reset --hard origin/claude/friendly-johnson-c89c0f` |
| Due database "ledgy" o id diverso in `wrangler.jsonc` | `d1 create` rifatto per errore | Tenere quello con id `48dc70af-…`; l'altro si cancella solo se vuoto |
| L'app mostra la versione vecchia | `npm run deploy` non eseguito dopo l'aggiornamento | `npm run deploy` |

## Dove si trova su Cloudflare

- **App e API**: dashboard Cloudflare → Workers & Pages → **ledgy**. È un Worker (non un progetto Pages) che serve sia la web app sia l'API. L'indirizzo pubblico è `https://ledgy.<sottodominio>.workers.dev`, visibile nella pagina del Worker.
- **Database**: Storage & Databases → D1 → **ledgy**.
- **Password e chiavi**: Workers & Pages → ledgy → Settings → Variables and Secrets.

## Recupero password via email (facoltativo ma consigliato)

Il link per una nuova password parte con [Resend](https://resend.com) (piano gratuito) e arriva sempre e solo all'indirizzo `RECOVERY_EMAIL`.

1. Registrati su resend.com con l'indirizzo email su cui vuoi ricevere il link.
2. API Keys → Create API Key (permesso "Sending access") e copiala.
3. Imposta i due segreti:

```bash
npx wrangler secret put RESEND_API_KEY     # la chiave appena creata
npx wrangler secret put RECOVERY_EMAIL     # lo stesso indirizzo dell'account Resend
```

Senza un dominio verificato su Resend il mittente è `onboarding@resend.dev`, che può scrivere solo all'indirizzo dell'account Resend: per questo `RECOVERY_EMAIL` deve essere quello. Con un dominio verificato si può impostare anche `MAIL_FROM` (per esempio `Ledgy <ledgy@tuodominio.com>`).

## Password

- `APP_PASSWORD` è la password iniziale. Dopo un cambio da Altro → Impostazioni, o un recupero via email, vale quella nuova, salvata nel database come impronta (PBKDF2): il secret resta solo come riserva finché non si cambia la password la prima volta.
- Dopo 10 tentativi sbagliati dallo stesso indirizzo IP l'accesso si blocca per 15 minuti.

## Dominio personalizzato (facoltativo)

Dashboard Cloudflare → Workers & Pages → ledgy → Settings → Domains & Routes → Add → Custom domain, per esempio `ledgy.tuodominio.com`. Il dominio deve essere già gestito da Cloudflare. Dopo il cambio di dominio gli indirizzi privati dei telefoni vanno ricreati dalla schermata Cattura automatica, perché contengono il dominio.

## Note

- Gli indirizzi `/api/in/<token>` sono pubblici per scelta: è da lì che i telefoni mandano le notifiche. Ogni token vale per un solo telefono e si revoca da "Cattura automatica".
- Tutto il resto dell'API richiede la password.
- Il database si esporta in qualsiasi momento da Altro → Backup (file JSON reimportabile, oppure CSV), oppure con `npx wrangler d1 export ledgy --remote --output backup.sql`.
- Il piano gratuito concede 10 ms di CPU per richiesta: per questo export, import e applicazione delle regole allo storico lavorano a pagine, e il file di backup si compone nel browser.
- D1 tiene in automatico la cronologia (7 giorni sul piano gratuito, 30 su quello a pagamento): per tornare indietro `npx wrangler d1 time-travel restore ledgy --timestamp <data ISO>`.
