# Ledgy: funzioni e decisioni

Brainstorm concluso il 15 novembre 2026. Il proprietario ha scelto ogni funzione su una pagina di selezione; qui sotto c'è il risultato, con le decisioni e le note tecniche raccolte nella ricerca.

## Decisioni

- **Nome**: Ledgy, provvisorio. Nome e logo possono cambiare.
- **Valuta base**: EUR. Ogni movimento salva importo originale, valuta e tasso del giorno usato.
- **Conti**: si può usare un conto unico, ma ogni movimento salva la carta o l'app da cui arriva (serve per il costo del cambio per carta).
- **Dati**: server sul Cloudflare del proprietario, senza cifratura end-to-end. La voce `d-e2e` in MVP va letta come "server tuo".
- **Cattura**: niente email e niente SMS. Su iPhone il proprietario ha già un'automazione di Comandi che legge la notifica della banca e la manda a Wallet: il link iCloud arriverà, va usato come punto di partenza. Su Android ha più telefoni di ultima generazione e sceglie lui le app di banca da seguire.
- **Più telefoni Android**: la stessa notifica può arrivare da due telefoni, quindi l'anti-duplicati confronta importo, merchant e orario. Ogni telefono manda il suo segnale giornaliero.
- **Scelta delle app da seguire su Android**: si mostrano le app che hanno mandato notifiche di recente, con in cima quelle che contengono importi. Non si chiede `QUERY_ALL_PACKAGES`.

## App Android e iPhone (decisioni del 19 novembre 2026)

Prese prima di fare APK e IPA, per farle uscire nel modo migliore. Valgono finché il proprietario non le cambia.

### Dati: server + copia completa sul telefono

- Il server (Worker + D1) resta l'archivio vero e continua a lavorare ad app chiusa: cattura dalle notifiche, categoria con l'AI, avvisi, ricorrenti registrate da sole. Niente cifratura end-to-end (vedi Decisioni sopra).
- In più l'app tiene una **copia completa** dei dati dell'account sul telefono: si apre subito e funziona tutta senza rete (liste, ricerca, statistiche, modifiche). Scartato "prima sul telefono, cifrato": costava la riscrittura della parte dati e faceva perdere cattura immediata, AI e avvisi ad app chiusa.
- Come: database nel browser/WebView in IndexedDB (stesso codice per web app e app native). Sincronizzazione a pezzi: `GET /api/sync?since=<ultima volta>` restituisce solo le righe cambiate (`updated_at`, cancellazioni con `deleted_at`), così le righe lette da D1 restano poche. Le modifiche fatte senza rete partono dalla coda che esiste già (`ledgy-outbox`, `client_id`); se la stessa riga cambia su due dispositivi vince l'ultima modifica.
- Si fa prima nella web app (serve anche oggi), poi le app native la usano così com'è.

### Android

- Capacitor con una parte nativa piccola in Kotlin: `NotificationListenerService` legge le notifiche delle app di banca scelte e manda il testo grezzo all'API come fa oggi MacroDroid: un solo lettore delle notifiche, quello del server. Coda sul telefono se manca la rete, segnale giornaliero, scelta delle app tra quelle che hanno mandato notifiche di recente (niente `QUERY_ALL_PACKAGES`). MacroDroid resta come alternativa.
- Distribuzione: **Google Play in test interno** (account sviluppatore da 25 $ una volta sola, lo apre il proprietario) per installare senza blocchi di Play Protect e della verifica sviluppatori in Indonesia; **lo stesso APK anche su DMReleases**, come le altre app.
- Avvisi ad app chiusa: Firebase Cloud Messaging (gratis) per gli avvisi del server; prima di attivarlo chiedere conferma al proprietario (servizio esterno nuovo). Promemoria degli abbonamenti anche come notifiche locali programmate dall'app.
- Da scegliere prima del primo APK, e poi mai più cambiare: `applicationId` (il nome Ledgy è provvisorio) e chiave di firma (la tiene il proprietario; a Claude non serve).

### iPhone

- All'inizio: **IPA non firmata su DMReleases**, installata dal proprietario con un metodo gratuito (Apple ID gratuito: la firma va rinnovata, di solito ogni 7 giorni, e alcune capacità non ci sono, come le notifiche push dal server; widget ed estensione Condividi da verificare). Più avanti forse **TestFlight** (Apple Developer, 99 $ l'anno): da decidere.
- La cattura resta su Comandi (nessuna app iPhone può leggere le notifiche delle altre). L'app aggiunge l'azione nativa "Aggiungi spesa" in Swift (App Intent), usabile da automazioni, Siri, tasto Azione e widget, che salva anche senza aprire l'app.
- Senza push dal server: promemoria e avvisi come notifiche locali programmate dall'app quando si apre.

### Regole per le build (già nelle regole di lavoro)

- APK e IPA solo con il permesso esplicito del proprietario, da un workflow manuale (`workflow_dispatch`); `actions/upload-artifact` con `retention-days: 1`.
- Pubblicazione su DMReleases con la stessa struttura di Multifolio e PackSnap (release per build, `latest.json`, voce nel CHANGELOG): chiedere i dettagli al proprietario prima della prima build.
- Ordine: 1) copia completa nella web app; 2) app Android (cattura nativa, Play test interno + DMReleases); 3) app iPhone (IPA su DMReleases, App Intent); widget e aggiornamenti in background dopo.

## Note tecniche dalla ricerca

### Import da Wallet

- API REST ufficiale: `https://rest.budgetbakers.com/wallet`, endpoint sotto `/v1/api/`, header `Authorization: Bearer <token>`. Il token si crea in web.budgetbakers.com → Impostazioni → REST API. Serve Wallet Premium. Specifica OpenAPI su `/wallet/openapi`.
- Limite: 300 richieste l'ora, con burst; oltre il limite risponde 429 con `Retry-After`. Paginazione `limit` (max 200) e `offset`, con `nextOffset` nella risposta.
- Il primo token avvia una sincronizzazione iniziale: finché non finisce le richieste rispondono 409.
- Lettura e scrittura: records, accounts, categories, labels, budgets. Sola lettura: goals, standing-orders, record-rules.
- I record arrivano di default solo per gli ultimi 3 mesi: passare `recordDate=gte.2000-01-01` (da verificare sulla specifica).
- I trasferimenti sono collegati (`transfer.transferId`, `mirrorRecord`). Le categorie hanno `cardinality` (must / need / want). Le foto hanno `photos[].temporaryUrl`, link che scadono: vanno scaricate subito.
- Mancano nell'API: tipo di pagamento, garanzia, modelli, debiti. Il CSV della web app (separatore `;`) ha `payment_type` e `warranty_in_month` e serve come controllo incrociato.
- Fonti: https://budgetbakers.com/en/products/wallet/integrations/rest-api/ · https://rest.budgetbakers.com/wallet/reference

### Cattura su iPhone

- Nessuna app può leggere le notifiche di altre app: si passa da Comandi.
- iOS 27 ha l'automazione "Notifica": si sceglie un'app, si filtra su titolo, sottotitolo o messaggio, e il comando riceve la variabile "Notifica" con il testo. Fonte: https://www.macstories.net/stories/ios-and-ipados-27-review/13/
- Automazione "Transazione" (Apple Pay contactless): passa carta, merchant e importo.
- Senza app nativa: azione "Ottieni contenuto URL" con POST JSON verso il webhook.
- Con app nativa: App Intent "Aggiungi spesa" in Swift che salva o invia da solo, senza dipendere dal JavaScript (plugin di riferimento: `@capgo/capacitor-app-intents`).

#### Il comando attuale del proprietario ("Wallet Multivaluta EUR v5", 72 azioni)

- Parte dall'automazione "Notifica" e riceve il testo completo della notifica.
- Usa "Usa modello" con Apple Intelligence per estrarre `amount`, `currency`, `merchant` e `category` come dizionario. È gratuito e resta sul telefono.
- Controlli da riportare nel server: formato dell'importo (regex per migliaia e decimali), codice valuta di 3 lettere, importo effettivamente presente nel testo della notifica (contro le invenzioni del modello), valute con 3 decimali (BHD, IQD, JOD, KWD, LYD, OMR, TND), separatore ambiguo tipo `1.234` o `1,234`, importo maggiore di zero, arrotondamento al centesimo.
- Cambio: `GET https://api.frankfurter.dev/v2/rate/{VALUTA}/EUR`, campo `rate`.
- Alla fine chiama l'App Intent di Wallet `com.budgetbakers.BudgetBakers.AddTransactionIntent` con conto "Contanti", `merchantName` e `rawAmount` in EUR. La categoria letta da Apple Intelligence non viene usata.

#### Comando Ledgy e installazione con un tocco

- Il comando Ledgy riparte da quello attuale: tiene la lettura con Apple Intelligence, ma invece di Wallet invia al webhook il testo grezzo, l'app di provenienza, l'ora e la lettura di Apple Intelligence. Il server applica i suoi lettori per banca, i controlli, le regole, il cambio e l'anti-duplicati. Così su iPhone non si consuma la quota Gemini.
- Se l'invio fallisce, il comando salva la spesa in un file sul telefono e la rimanda alla volta successiva.
- Il file firmato è generico, senza token. Dopo l'installazione la web app passa il token al comando (pulsante "Attiva" che lo esegue con il token come input) e il comando lo salva sul telefono. Il token non passa da servizi di terzi.
- Da iOS 27 un file di comando può contenere anche la sua automazione (`WFWorkflowTriggers`, per esempio `WFNotificationTrigger` con `SelectedApps`): un utente ha verificato a settembre 2026 che reimportando il file l'automazione funziona. Fonte: https://github.com/electrikmilk/cherri/issues/214
- Firma: HubSign di RoutineHub (richiede l'abbonamento Developer di RoutineHub) firma via API o modulo web, ma a novembre 2026 toglie `WFWorkflowTriggers`: con HubSign l'automazione va creata a mano, con una guida. Firmando su un Mac con macOS 27 l'automazione resta nel file.
- Android: la web app genera il file della macro MacroDroid già configurato con indirizzo e token; un tocco lo apre in MacroDroid. Formato del file `.macro` e flusso di importazione da verificare su un'esportazione reale.

### Cattura su Android

- `NotificationListenerService` nell'app nativa.
- Indonesia: dal 30 settembre 2026 Android installa solo app di sviluppatori verificati (https://developer.android.com/developer-verification/guides). Play Protect blocca gli APK scaricati da browser, chat o file manager che chiedono l'accesso alle notifiche (https://developers.google.com/android/play-protect/warning-dev-guidance). Distribuzione consigliata: Google Play in test interno.
- Android 15+: le notifiche con codici OTP arrivano oscurate ai listener normali.
- Senza app nativa: MacroDroid (Play Store, gratis fino a 5 macro) con trigger "Notifica ricevuta" e azione "Richiesta HTTP". Alternativa: NotifyHook (coda offline integrata, ancora pochi utenti).
- Il nemico principale è il risparmio batteria (Xiaomi, Samsung, Oppo): servono guide per marca (https://dontkillmyapp.com) e il segnale giornaliero.
- Il server riceve il testo grezzo e lo interpreta lui; deve deduplicare i reinvii.
- Nomi pacchetto verificati sul Play Store: Jago `com.jago.digitalBanking`, SeaBank `id.co.bankbkemobile.digitalbank`, BCA `com.bca`, Revolut `com.revolut.revolut`, Wise `com.transferwise.android`, Grab `com.grabtaxi.passenger`, Gojek `com.gojek.app`.

### Cambi

- Principale: Frankfurter (tassi di banche centrali, include IDR, THB, MYR, PHP, SGD e VND, senza chiave). Riserva: fawazahmed0/exchange-api. I tassi giornalieri vanno salvati in D1.

### AI

- Gemini, piano gratuito: modelli Flash e Flash-Lite, input immagini, output JSON con schema. Fuori da UE e Regno Unito i dati inviati con la chiave gratuita possono essere usati da Google e letti da revisori: la modalità privacy deve dirlo.
- NanoGPT: API compatibile OpenAI su `https://api.nano-gpt.com/api/v1`, pagamento a consumo, immagini, `json_schema` e tool calls.
- La chat usa strumenti di sola lettura definiti dal server, non SQL generato dal modello. Il testo delle notifiche e i nomi dei merchant vanno trattati come dati non fidati (prompt injection).

### Cloudflare, piano gratuito

- Workers: 100.000 richieste al giorno, 10 ms di CPU per richiesta, 5 Cron Triggers per account.
- D1: 5 milioni di righe lette e 100.000 scritte al giorno, 5 GB in totale. Un import molto grande da Wallet può dover essere diviso su più giorni.
- R2: 10 GB al mese di spazio, uscita gratuita.

## MVP (prima versione) — 73

### Cattura automatica

- `c-android` **Android: lettura delle notifiche delle app banca** — Scegli le app (Revolut, Wise, Jago, BCA, Grab…); l'app legge importo, valuta e merchant e crea il movimento in background.
- `c-ios-notif` **iPhone: automazione “Notifica” di iOS 27** — Un comando per ogni app banca passa il testo della notifica all'app o al server. Da provare sul tuo iPhone: non è chiaro se parte senza conferma.
- `c-ios-tx` **iPhone: automazione “Transazione” di Apple Pay** — Quando paghi con Apple Pay arrivano merchant, importo e carta. Vale solo per i pagamenti contactless.
- `c-ios-intent` **iPhone: azione “Aggiungi spesa” in Comandi** — Azione nativa usabile da automazioni, Siri, tasto Azione e widget. Salva anche senza aprire l'app.
- `c-webhook` **Indirizzo privato per le automazioni** — Un URL con token: Comandi, Message487 o MacroDroid ci inviano il testo e il server crea la spesa. Funziona anche solo con la web app.
- `c-inbox` **Lista “Da rivedere”** — I movimenti letti con sicurezza si salvano da soli; gli altri aspettano una conferma con uno swipe.
- `c-parser` **Riconoscimento automatico del formato di ogni banca** — Incolli una notifica vera, l'AI capisce dove sono importo e negozio e salva la regola. Da lì l'app legge quella banca da sola, senza AI.
- `c-dedupe` **Anti-duplicati** — Se la stessa spesa arriva da notifica, Apple Pay e import, diventa un solo movimento.
- `c-transfer` **Ricariche e prelievi riconosciuti** — Wise → Revolut o un prelievo al bancomat diventano un trasferimento, non una spesa contata due volte.
- `c-quickconfirm` **Notifica di conferma con scelta rapida** — “Grab 2,94 € → Cibo” con pulsanti per cambiare categoria senza aprire l'app.
- `c-heartbeat` **Avviso se la cattura si ferma** — Il telefono manda un segnale ogni giorno. Se smette (risparmio batteria, permesso perso), ricevi un avviso invece di perdere spese senza accorgertene.
- `c-merchant` **Indizi dalle app Grab e Gojek** — Su Android legge anche le notifiche di Grab e Gojek (“ordine in consegna” o “autista in arrivo”) per capire se era cibo o una corsa.

### Regole

- `r-engine` **Regole con più condizioni** — Merchant (contiene o regex), importo (<, >, tra), valuta, conto, giorno, ora e fonte. Azioni: categoria, etichette, natura, beneficiario, nota, conto.
- `r-threshold` **Soglie per merchant** — Il tuo caso Grab e Gojek: sotto 2 € Trasporti, sopra Cibo, con una soglia diversa per ogni merchant.
- `r-ask` **Azione “chiedimi”** — Per una fascia dubbia (es. Grab tra 2 e 6 €) l'app chiede con un tap invece di indovinare.
- `r-order` **Priorità tra regole** — Prima si pulisce il nome del merchant, poi si categorizza; la regola più specifica vince.
- `r-rename` **Nomi merchant puliti** — “Grab* A-A359GUFW36UCAV” diventa “Grab”, conservando il testo originale.
- `r-preview` **Anteprima e applicazione allo storico** — “Questa regola cambierebbe 134 movimenti”: la provi e la applichi anche agli anni importati da Wallet.
- `r-learn` **Regole imparate dalle correzioni** — Se correggi la stessa cosa più volte, l'app ti propone la regola già scritta.
- `r-presets` **Regole pronte per l'Indonesia** — Grab, Gojek, Indomaret, Alfamart, Circle K, PLN e Telkomsel già impostati e modificabili.

### Assistente AI

- `a-providers` **Scelta del provider AI** — Gemini con chiave gratuita, NanoGPT o un'API compatibile OpenAI, con un modello diverso per ogni compito.
- `a-chat` **Chat con i tuoi dati** — “Quanto ho speso in Grab a ottobre?” L'AI usa strumenti di sola lettura e può rispondere con grafici.
- `a-receipt` **Foto dello scontrino → movimento** — Legge importo, valuta, data, negozio e categoria. Le righe dei singoli articoli sono facoltative.
- `a-screenshot` **Screenshot → movimenti** — La ricevuta Grab, un bonifico o la lista movimenti della banca diventano movimenti da confermare.
- `a-nl` **Inserimento scritto o a voce** — “ieri 45k nasi goreng gojek” diventa 45.000 IDR, Cibo, ieri.
- `a-cat` **Categoria suggerita** — Quando nessuna regola corrisponde, l'AI propone la categoria imparando dalle tue scelte.
- `a-approve` **Modifiche solo con il tuo ok** — L'AI può proporre regole, budget o correzioni in blocco, ma le applica solo dopo la tua approvazione.
- `a-privacy` **Modalità privacy** — Nasconde nomi e numeri di conto prima dell'invio, registra cosa è stato inviato e permette di spegnere l'AI.
- `a-recap` **Riepilogo settimanale e anomalie** — Spese insolite, abbonamenti rincarati e addebiti doppi segnalati in un riepilogo.
- `a-import` **Import con AI da CSV e PDF** — L'AI riconosce le colonne di qualsiasi CSV o legge l'estratto conto in PDF.

### Le basi di Wallet

- `b-accounts` **Conti con valuta propria** — Contanti, conto corrente, carta di credito, risparmio, prestito; saldo iniziale e archiviazione.
- `b-records` **Movimenti completi** — Spesa, entrata e trasferimento, con beneficiario, nota, tipo di pagamento e stato (in sospeso o contabilizzato).
- `b-cats` **Categorie e sottocategorie** — Le tue categorie di Wallet importate così come sono, con icone e colori; si possono unire e spostare.
- `b-dashboard` **Dashboard a widget** — Conti, andamento del saldo, spese principali, ultimi movimenti, budget e prossimi pagamenti, riordinabili.
- `b-labels` **Etichette** — Più etichette per movimento, usabili in filtri, budget e regole.
- `b-nature` **Natura della spesa** — Devo / Ho bisogno / Voglio come nel tuo screenshot: predefinita per categoria e modificabile sul singolo movimento.
- `b-attach` **Allegati** — Foto dello scontrino o PDF sul movimento, comprese quelle importate da Wallet.
- `b-period` **Selettore del periodo ovunque** — Settimana, mese, anno o date libere, con frecce e confronto con il periodo precedente.
- `b-search` **Ricerca e filtri salvati** — Filtri su ogni campo, riutilizzabili in statistiche, budget e regole.
- `b-templates` **Modelli fissati** — Un tap per ripetere le spese abituali: caffè, scooter, lavanderia.
- `b-location` **Luogo e mappa** — Posizione di ogni movimento e mappa delle spese, utile in viaggio.

### Pianificazione

- `p-planned` **Pagamenti pianificati** — Ricorrenze flessibili (ogni N mesi, il giorno X), promemoria e collegamento automatico all'addebito vero quando arriva.
- `p-budget` **Budget** — Settimanali, mensili, annuali o una tantum, per categorie, conti ed etichette, con avviso di sforamento previsto e di budget superato.
- `p-subs` **Abbonamenti trovati da soli** — Trova Telegram, iCloud e YouTube nello storico, li propone come pagamenti pianificati e avvisa se il prezzo sale.
- `p-calendar` **Calendario e saldo previsto** — Vista mensile con uscite passate e future e saldo previsto a fine mese. È tra le mancanze di Wallet più citate.
- `p-safe` **Disponibile oggi** — Quanto puoi spendere al giorno fino a fine mese, tolti pagamenti pianificati e obiettivi.
- `p-rollover` **Avanzi riportati** — Quello che avanza o sfora in un budget passa al periodo successivo.
- `p-goals` **Obiettivi di risparmio** — Importo, scadenza e versamenti, con la possibilità di spendere direttamente da un obiettivo.

### Statistiche e report

- `s-wallet` **Le statistiche di Wallet** — Saldo, spesa per categoria, flusso di cassa (tendenza e cumulativo), previsioni, credito e rapporti con il periodo precedente.
- `s-nature` **Grafico della natura delle spese** — Barre giornaliere Devo / Ho bisogno / Voglio, come nel tuo screenshot.
- `s-merchant` **Classifica dei merchant** — Quanto hai speso da Grab quest'anno e come è cambiato mese per mese.
- `s-yoy` **Confronti su tutto lo storico** — Anno su anno e mese su mese, per categoria, su tutti gli anni importati.
- `s-selection` **Somma della selezione e modifica in blocco** — Selezioni dei movimenti, vedi subito il totale e cambi la categoria a tutti insieme.
- `s-heatmap` **Calendario della spesa** — Mappa di calore dei giorni in cui spendi di più.
- `s-review` **Anno in rassegna** — Riepilogo di fine anno in stile “Wrapped”.

### Viaggi e valute

- `x-multi` **Multi-valuta con tasso del giorno** — Valuta base EUR e qualsiasi valuta per conto o movimento; importo originale salvato, tasso storico dalle banche centrali.
- `x-format` **Importi nel formato locale** — Capisce “45k”, “45.000” e “45,000” e mostra le rupie senza decimali.
- `x-fee` **Quanto ti costa il cambio di ogni carta** — Confronta il tasso applicato dalla banca con quello di mercato: Revolut, Wise e la carta locale a confronto. Nessuna app concorrente lo fa.
- `x-trip` **Modalità viaggio** — Un viaggio con date, valuta e budget: tutti i movimenti di quei giorni si etichettano da soli.
- `x-calc` **Convertitore rapido** — Scrivi un prezzo in rupie e vedi subito gli euro, anche da widget.

### Velocità ed esperienza

- `u-offline` **Funziona offline** — Registri anche senza rete e i dati si sincronizzano dopo.
- `u-quick` **Spesa inserita in meno di 5 secondi** — Tastierino con calcolatrice, categoria suggerita, duplica movimento.
- `u-design` **Grafica nello stile di iOS 26, più leggibile** — Stessa struttura di Wallet (dashboard, pianificazione, statistiche), con tema chiaro e scuro.
- `u-lock` **Face ID e modalità discreta** — Un tocco nasconde i saldi, così non devi coprirli negli screenshot.
- `u-share` **Invia all'app dal menu Condividi** — Mandi foto o screenshot all'app dal menu Condividi e l'AI li legge.
- `u-lang` **Italiano e inglese** — Interfaccia e categorie in entrambe le lingue.
- `u-widgets` **Widget per home e schermata di blocco** — Spesa di oggi, budget rimasto, pulsante per aggiungere.
- `u-deeplink` **Link per aggiungere una spesa** — Un link che apre l'inserimento già compilato, utile per widget e automazioni.

### Dati, import ed export

- `d-wallet` **Import completo da Wallet** — Tramite l'API ufficiale: movimenti, conti, categorie, etichette, budget, pagamenti pianificati, regole e foto, poi controllo dei saldi conto per conto.
- `d-sync` **Sincronizzazione tra web, Android e iPhone** — Gli stessi dati su tutti i dispositivi, in tempo reale.
- `d-export` **Export completo e backup automatico** — CSV e JSON con gli allegati, da qualsiasi dispositivo. Wallet su iPhone non esporta.
- `d-e2e` **Dati cifrati o server tuo** — I dati vengono cifrati prima di lasciare il telefono, oppure il server lo gestisci tu.

### Patrimonio ed extra

- `e-gamify` **Sfide e serie** — Per esempio “una settimana senza delivery”, con il contatore dei giorni.

## Dopo — 8

### Cattura automatica

- `c-refund` **Rimborsi, storni e pre-autorizzazioni** — Riconosce rimborsi e blocchi temporanei (hotel, Grab) e li collega alla spesa originale.

### Assistente AI

- `a-telegram` **Bot Telegram** — Scrivi la spesa o mandi la foto dello scontrino al bot; puoi anche fargli domande.
- `a-mcp` **Server MCP personale** — Interroghi le tue spese anche da Claude o ChatGPT, come permettono già Wallet e Copilot.

### Pianificazione

- `p-debts` **Debiti e crediti** — Soldi prestati o ricevuti, con rimborsi parziali.

### Statistiche e report

- `s-sankey` **Flusso entrate → spese** — Diagramma Sankey dalle entrate alle categorie e sottocategorie.

### Dati, import ed export

- `d-api` **API personale e webhook in uscita** — Per collegare Google Sheets, Home Assistant o altri strumenti.

### Condivisione

- `sh-shared` **Conti condivisi** — Partner o famiglia vedono e aggiungono spese sui conti che scegli.

### Patrimonio ed extra

- `e-networth` **Patrimonio netto** — Conti più beni inseriti a mano (scooter, deposito dell'affitto, crypto) meno i debiti, nel tempo.

## Escluse — 16

### Cattura automatica

- `c-sender` Conto in base alla fonte
- `c-sms` SMS della banca
- `c-banksync` Collegamento diretto alle banche (Open Banking)

### Pianificazione

- `p-payday` Mese che parte dallo stipendio
- `p-zero` Budget a buste (metodo YNAB)

### Statistiche e report

- `s-dashboards` Più dashboard

### Viaggi e valute

- `x-override` Tasso effettivo del money changer

### Velocità ed esperienza

- `u-split` Un movimento su più categorie
- `u-watch` Apple Watch e tasto Azione

### Dati, import ed export

- `d-csv` Import CSV da altre app e banche
- `d-sheets` Collegamento a Google Sheets

### Condivisione

- `sh-split` Spese divise con gli amici

### Patrimonio ed extra

- `e-invest` Investimenti con prezzi automatici
- `e-warranty` Garanzie
- `e-shopping` Liste della spesa
- `e-loyalty` Carte fedeltà
