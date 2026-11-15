# Pubblicare Ledgy su Cloudflare

Ledgy è un solo Cloudflare Worker che serve la web app e l'API, con un database D1. Tutto rientra nel piano gratuito.

## Cosa serve

- Node.js 22 o più recente e git.
- Un account Cloudflare. Per lavorare senza browser: un API token con i permessi **Workers Scripts: Edit**, **D1: Edit**, **Account Settings: Read**, più l'Account ID.

## Prima pubblicazione

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
# 2. Metti quel valore in wrangler.jsonc, al posto di 00000000-0000-0000-0000-000000000000
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

## Aggiornamenti successivi

```bash
git pull
npm ci
npx wrangler d1 migrations apply ledgy --remote
npm run deploy
```

## Dominio personalizzato (facoltativo)

Dashboard Cloudflare → Workers & Pages → ledgy → Settings → Domains & Routes → Add → Custom domain, per esempio `ledgy.tuodominio.com`. Il dominio deve essere già gestito da Cloudflare. Dopo il cambio di dominio gli indirizzi privati dei telefoni vanno ricreati dalla schermata Cattura automatica, perché contengono il dominio.

## Note

- Gli indirizzi `/api/in/<token>` sono pubblici per scelta: è da lì che i telefoni mandano le notifiche. Ogni token vale per un solo telefono e si revoca da "Cattura automatica".
- Tutto il resto dell'API richiede la password.
- Il database si esporta in qualsiasi momento da Altro → I tuoi dati, oppure con `npx wrangler d1 export ledgy --remote --output backup.sql`.
- D1 tiene in automatico la cronologia degli ultimi 30 giorni: per tornare indietro `npx wrangler d1 time-travel restore ledgy --timestamp <data ISO>`.
