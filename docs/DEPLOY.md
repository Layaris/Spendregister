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

## Aggiornamenti successivi

```bash
git pull
npm ci
npx wrangler d1 migrations apply ledgy --remote
npm run deploy
```

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
