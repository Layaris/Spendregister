// Dati iniziali: categorie in stile Wallet, un conto e le regole pronte per l'Indonesia.
import type { RuleDefinition } from '../shared/rules';
import { nowIso, runBatch } from './lib';

type Nat = 'must' | 'need' | 'want' | null;

interface Group { id: string; name: string; color: string; icon: string; kind: 'expense' | 'income'; nature: Nat; optional?: boolean; children: Array<[string, string, Nat]> }

/** Categorie predefinite (versione 2): generiche, valide in tutto il mondo. `optional`: spente all'inizio. */
export const TREE: Group[] = [
  { id: 'cat_food', name: 'Cibo e bevande', color: '#E2603A', icon: 'food', kind: 'expense', nature: 'need', children: [
    ['cat_food_groceries', 'Spesa e supermercato', 'need'], ['cat_food_restaurant', 'Ristoranti', 'want'], ['cat_food_fastfood', 'Fast food', 'want'],
    ['cat_food_delivery', 'Delivery', 'want'], ['cat_food_bar', 'Bar e caffè', 'want'], ['cat_food_drinks', 'Locali e alcol', 'want'],
  ] },
  { id: 'cat_home', name: 'Casa', color: '#C98512', icon: 'home', kind: 'expense', nature: 'must', children: [
    ['cat_home_rent', 'Affitto o mutuo', 'must'], ['cat_home_energy', 'Elettricità', 'must'], ['cat_home_water', 'Acqua', 'must'], ['cat_home_gas', 'Gas', 'must'],
    ['cat_home_internet', 'Internet di casa', 'need'], ['cat_home_maintenance', 'Manutenzione e riparazioni', 'need'], ['cat_home_cleaning', 'Pulizie e lavanderia', 'need'],
    ['cat_home_condo', 'Spese condominiali', 'must'],
  ] },
  { id: 'cat_transport', name: 'Trasporti', color: '#2F6FD6', icon: 'car', kind: 'expense', nature: 'need', children: [
    ['cat_transport_taxi', 'Taxi e auto con autista', 'need'], ['cat_transport_public', 'Mezzi pubblici', 'need'], ['cat_transport_flights', 'Voli', 'want'],
    ['cat_transport_train', 'Treni e pullman', 'need'], ['cat_transport_ferry', 'Traghetti', 'need'],
  ] },
  { id: 'cat_vehicle', name: 'Veicoli', color: '#5B6B7C', icon: 'scooter', kind: 'expense', nature: 'need', children: [
    ['cat_vehicle_fuel', 'Carburante', 'need'], ['cat_vehicle_charging', 'Ricarica elettrica', 'need'], ['cat_vehicle_rent', 'Noleggio', 'need'],
    ['cat_vehicle_maintenance', 'Manutenzione', 'need'], ['cat_vehicle_parking', 'Parcheggi e pedaggi', 'need'], ['cat_vehicle_insurance', 'Assicurazione veicolo', 'must'],
  ] },
  { id: 'cat_shop', name: 'Acquisti', color: '#7A57D1', icon: 'bag', kind: 'expense', nature: 'want', children: [
    ['cat_shop_clothes', 'Abbigliamento e scarpe', 'want'], ['cat_shop_electronics', 'Elettronica', 'want'], ['cat_shop_home', 'Casa e arredamento', 'need'],
    ['cat_shop_hobby', 'Hobby', 'want'], ['cat_shop_other', 'Altri acquisti', 'want'],
  ] },
  { id: 'cat_subs', name: 'Abbonamenti', color: '#D1477A', icon: 'repeat', kind: 'expense', nature: 'want', children: [
    ['cat_subs_streaming', 'Streaming video e musica', 'want'], ['cat_subs_dating', 'App di incontri', 'want'], ['cat_subs_games', 'Giochi online', 'want'],
    ['cat_subs_cloud', 'Cloud e app', 'want'], ['cat_subs_shopping', 'Abbonamenti shopping', 'want'], ['cat_subs_phone', 'Telefono e SIM', 'need'],
  ] },
  { id: 'cat_health', name: 'Salute', color: '#1E9E6A', icon: 'health', kind: 'expense', nature: 'must', children: [
    ['cat_health_doctor', 'Medico e visite', 'must'], ['cat_health_pharmacy', 'Farmacia', 'need'], ['cat_health_dentist', 'Dentista', 'must'],
    ['cat_health_optician', 'Ottico', 'need'], ['cat_health_surgery', 'Operazioni e interventi', 'must'], ['cat_health_insurance', 'Assicurazione sanitaria', 'must'],
  ] },
  { id: 'cat_care', name: 'Cura personale', color: '#C2569E', icon: 'heart', kind: 'expense', nature: 'want', children: [
    ['cat_care_hair', 'Parrucchiere e barbiere', 'need'], ['cat_care_cosmetics', 'Cosmetici e igiene', 'need'], ['cat_care_spa', 'Massaggi e spa', 'want'],
    ['cat_care_fitness', 'Palestra e sport', 'want'],
  ] },
  { id: 'cat_fun', name: 'Svago', color: '#E0A21B', icon: 'ticket', kind: 'expense', nature: 'want', children: [
    ['cat_fun_going_out', 'Uscite', 'want'], ['cat_fun_events', 'Cinema, concerti ed eventi', 'want'], ['cat_fun_activities', 'Attività ed escursioni', 'want'],
    ['cat_fun_games', 'Giochi', 'want'],
  ] },
  { id: 'cat_travel', name: 'Viaggi', color: '#1C9BB8', icon: 'plane', kind: 'expense', nature: 'want', children: [
    ['cat_travel_hotel', 'Alloggi e hotel', 'want'], ['cat_travel_activities', 'Attività in viaggio', 'want'], ['cat_travel_visa', 'Visti e documenti', 'must'],
  ] },
  { id: 'cat_edu', name: 'Istruzione', color: '#4F5BD5', icon: 'book', kind: 'expense', nature: 'need', children: [
    ['cat_edu_courses', 'Corsi', 'need'], ['cat_edu_books', 'Libri e materiali', 'need'], ['cat_edu_school', 'Scuola e università', 'need'],
  ] },
  { id: 'cat_work', name: 'Lavoro', color: '#3D7F8F', icon: 'briefcase', kind: 'expense', nature: 'need', children: [
    ['cat_work_cowork', 'Coworking', 'need'], ['cat_work_ai', 'AI e strumenti', 'need'], ['cat_work_software', 'Software e servizi', 'need'],
    ['cat_work_hosting', 'Hosting e domini', 'need'], ['cat_work_equipment', 'Attrezzatura', 'need'], ['cat_work_professional', 'Spese professionali', 'need'],
    ['cat_work_other', 'Altro lavoro', 'need'],
  ] },
  { id: 'cat_fin', name: 'Finanza', color: '#4E6E58', icon: 'bank', kind: 'expense', nature: 'must', children: [
    ['cat_fin_fees', 'Commissioni bancarie', 'must'], ['cat_fin_atm', 'Prelievi e cambio valuta', 'must'], ['cat_fin_taxes', 'Tasse', 'must'],
    ['cat_fin_loans', 'Interessi e prestiti', 'must'], ['cat_fin_insurance', 'Assicurazioni', 'must'], ['cat_fin_fines', 'Multe', 'must'],
  ] },
  { id: 'cat_invest', name: 'Risparmi e investimenti', color: '#8A6D3B', icon: 'chart', kind: 'expense', nature: null, children: [] },
  { id: 'cat_family', name: 'Famiglia e figli', color: '#E07B5A', icon: 'family', kind: 'expense', nature: 'need', optional: true, children: [
    ['cat_family_school', 'Scuola e asilo', 'must'], ['cat_family_babysitter', 'Babysitter', 'need'], ['cat_family_kids', 'Spese per i figli', 'need'],
  ] },
  { id: 'cat_gifts', name: 'Regali e donazioni', color: '#B5527A', icon: 'gift', kind: 'expense', nature: 'want', optional: true, children: [
    ['cat_gifts_gifts', 'Regali', 'want'], ['cat_gifts_charity', 'Beneficenza', 'want'], ['cat_gifts_religious', 'Offerte religiose', 'want'],
  ] },
  { id: 'cat_pets', name: 'Animali', color: '#9C7A4A', icon: 'paw', kind: 'expense', nature: 'need', optional: true, children: [
    ['cat_pets_food', 'Cibo per animali', 'need'], ['cat_pets_vet', 'Veterinario', 'must'], ['cat_pets_accessories', 'Accessori e toelettatura', 'want'],
  ] },
  { id: 'cat_income', name: 'Entrate', color: '#0B8A5E', icon: 'income', kind: 'income', nature: null, children: [
    ['cat_income_salary', 'Stipendio', null], ['cat_income_freelance', 'Freelance e fatture', null], ['cat_income_refund', 'Rimborsi', null],
    ['cat_income_gifts', 'Regali ricevuti', null], ['cat_income_interest', 'Interessi e dividendi', null], ['cat_income_bank', 'Rendite bancarie', null],
    ['cat_income_crypto', 'Rendite crypto', null], ['cat_income_sales', 'Vendite', null], ['cat_income_rent', 'Affitti ricevuti', null],
    ['cat_income_other', 'Altre entrate', null],
  ] },
  { id: 'cat_other', name: 'Altro', color: '#7D8790', icon: 'dots', kind: 'expense', nature: null, children: [] },
];

export const CATALOG_VERSION = 4;

/** Categorie della versione 1 (stile Wallet) che non esistono più: dove vanno i loro movimenti. */
export const RETIRED: Record<string, string> = {
  cat_shop_pharmacy: 'cat_health_pharmacy', cat_shop_beauty: 'cat_care_cosmetics', cat_shop_gifts: 'cat_shop_other', cat_shop_online: 'cat_shop_other',
  cat_home_services: 'cat_home_maintenance', cat_transport_long: 'cat_transport_flights',
  cat_life: 'cat_fun', cat_life_health: 'cat_health_doctor', cat_life_wellness: 'cat_care_spa', cat_life_fitness: 'cat_care_fitness',
  cat_life_events: 'cat_fun_events', cat_life_holiday: 'cat_travel_hotel', cat_life_streaming: 'cat_subs_streaming', cat_life_education: 'cat_edu_courses',
  cat_comm: 'cat_subs', cat_comm_internet: 'cat_home_internet', cat_comm_phone: 'cat_subs_phone', cat_comm_software: 'cat_subs_cloud',
  cat_invest_savings: 'cat_invest', cat_invest_financial: 'cat_invest',
};


/** Regole predefinite "morbide" della versione 3: [id, nome, regex sul negozio, categoria, nome pulito, natura]. */
function travel(list: Array<[string, string, string, string, string | null, Nat]>, base = 100, since = 3) {
  return list.map(([id, name, regex, cat, rename, nature], i) => ({
    id, name, priority: base + i, since,
    definition: { soft: true, conditions: [{ field: 'merchant' as const, op: 'regex' as const, value: regex }],
      actions: { category_id: cat, ...(rename ? { merchant: rename } : {}), ...(nature ? { nature } : {}) } },
  }));
}
/** Solo nome pulito: [id, regex, nome]. */
function renames(list: Array<[string, string, string]>, base = 90, since = 3) {
  return list.map(([id, regex, name], i) => ({
    id, name: `Nome pulito: ${name}`, priority: base + i, since,
    definition: { soft: true, conditions: [{ field: 'merchant' as const, op: 'regex' as const, value: regex }], actions: { merchant: name } },
  }));
}

const PRESETS: Array<{ id: string; name: string; priority: number; definition: RuleDefinition; since?: number }> = [
  { id: 'rule_grab', name: 'Grab', priority: 10, definition: {
    conditions: [{ field: 'merchant', op: 'contains', value: 'grab' }],
    actions: { merchant: 'Grab' },
    bands: [
      { max: 2, actions: { category_id: 'cat_transport_taxi', nature: 'need' } },
      { min: 2, max: 6, actions: { ask: ['cat_food_restaurant', 'cat_transport_taxi'] } },
      { min: 6, actions: { category_id: 'cat_food_restaurant' } },
    ],
  } },
  { id: 'rule_gojek', name: 'Gojek', priority: 11, definition: {
    conditions: [{ field: 'merchant', op: 'regex', value: 'go-?jek|gopay|gofood|goride|gocar' }],
    actions: { merchant: 'Gojek' },
    bands: [
      { max: 2, actions: { category_id: 'cat_transport_taxi', nature: 'need' } },
      { min: 2, max: 6, actions: { ask: ['cat_food_restaurant', 'cat_transport_taxi'] } },
      { min: 6, actions: { category_id: 'cat_food_restaurant' } },
    ],
  } },
  { id: 'rule_minimarket', name: 'Minimarket', priority: 20, definition: {
    conditions: [{ field: 'merchant', op: 'regex', value: 'indomaret|alfamart|alfamidi|circle ?k|lawson|family ?mart|7-?eleven|pepito|coco mart|bintang' }],
    actions: { category_id: 'cat_food_groceries', nature: 'need' },
  } },
  { id: 'rule_pln', name: 'Elettricità PLN', priority: 21, definition: {
    conditions: [{ field: 'merchant', op: 'regex', value: '\\bpln\\b|token listrik' }],
    actions: { category_id: 'cat_home_energy', nature: 'must' },
  } },
  { id: 'rule_telco', name: 'Telefono', priority: 22, definition: {
    conditions: [{ field: 'merchant', op: 'regex', value: 'telkomsel|xl ?axiata|indosat|smartfren|by\\.u|tri indonesia' }],
    actions: { category_id: 'cat_subs_phone', nature: 'need' },
  } },
  // ---- Versione 3: regole predefinite per chi viaggia. "Morbide": la tua correzione su un negozio vince sempre. ----
  ...travel([
    ['rule_t_uber_eats', 'Uber Eats', 'uber\\W*eats', 'cat_food_delivery', 'Uber Eats', 'want'],
    ['rule_t_uber', 'Uber', '\\buber\\b', 'cat_transport_taxi', 'Uber', 'need'],
    ['rule_t_bolt_food', 'Bolt Food', 'bolt\\W*food', 'cat_food_delivery', 'Bolt Food', 'want'],
    ['rule_t_bolt', 'Bolt', '\\bbolt\\b', 'cat_transport_taxi', 'Bolt', 'need'],
    ['rule_t_ride', 'Taxi e app di trasporto', 'careem|lyft|\\bdidi\\b|indrive|cabify|free ?now|blue ?bird|\\bmaxim\\b|xanh ?sm|\\btaxi\\b', 'cat_transport_taxi', null, 'need'],
    ['rule_t_delivery', 'App di consegna cibo', 'deliveroo|foodpanda|talabat|glovo|\\bwolt\\b|just ?eat|doordash|zomato|swiggy|grab\\W*food|go\\W?food|shopee\\W*food|lineman|rappi|ifood|baemin', 'cat_food_delivery', null, 'want'],
    ['rule_t_atm', 'Prelievo al bancomat', '\\batm\\b|cash withdrawal|withdrawal|tarik tunai|prelievo|bancomat|retiro|retrait', 'cat_fin_atm', null, 'must'],
    ['rule_t_fx', 'Cambio valuta', 'money ?changer|currency exchange|western union|moneygram|travelex|cambio valuta', 'cat_fin_atm', null, 'must'],
    ['rule_t_esim', 'eSIM e SIM da viaggio', 'airalo|holafly|nomad ?esim|ubigi|saily|yesim|\\besim\\b|getmobile', 'cat_subs_phone', null, 'need'],
    ['rule_t_insurance', 'Assicurazione di viaggio', 'safetywing|genki|world ?nomads|heymondo|allianz travel|axa travel|ekta|insured nomads|battleface', 'cat_health_insurance', null, 'must'],
    ['rule_t_lodging', 'Alloggi (Airbnb, Booking…)', 'airbnb|booking\\.com|agoda|hostelworld|hotels\\.com|expedia|trip\\.com|traveloka|\\bvrbo\\b|hostel|guesthouse|homestay', 'cat_travel_hotel', null, 'want'],
    ['rule_t_flights', 'Compagnie aeree', 'ryanair|easyjet|wizz ?air|airasia|\\bscoot\\b|jetstar|vietjet|cebu pacific|lion ?air|batik ?air|citilink|garuda|emirates|qatar airways|turkish airlines|lufthansa|singapore airlines|ita airways|skyscanner|kiwi\\.com', 'cat_transport_flights', null, 'want'],
    ['rule_t_visa', 'Visti e immigrazione', 'imigrasi|immigration|e-?visa|kitas|kitap|visa on arrival|\\bvoa\\b|\\besta\\b|\\bvfs\\b|embassy|consulate', 'cat_travel_visa', null, 'must'],
    ['rule_t_ferry', 'Traghetti e fast boat', 'ferry|fast ?boat|speed ?boat|pelni|\\basdp\\b|12go', 'cat_transport_ferry', null, 'need'],
    ['rule_t_activities', 'Tour ed escursioni', 'klook|getyourguide|viator|tiqets|headout', 'cat_travel_activities', null, 'want'],
    ['rule_t_cowork', 'Coworking', 'coworking|co-working|wework|regus|outpost|dojo bali|tropical nomad|hubud|\\bb work\\b', 'cat_work_cowork', null, 'need'],
    ['rule_t_laundry', 'Lavanderia', 'laundry|lavanderia|laundromat|dry clean', 'cat_home_cleaning', null, 'need'],
    ['rule_t_gym', 'Palestra, yoga, sport', 'anytime fitness|gold.?s gym|crossfit|\\byoga\\b|muay thai|\\bf45\\b|pilates|\\bsurf\\b|diving|padel', 'cat_care_fitness', null, 'want'],
    ['rule_t_spa', 'Massaggi e spa', 'massage|\\bspa\\b|reflexology|pijat|onsen|hammam|sauna', 'cat_care_spa', null, 'want'],
    ['rule_t_streaming', 'Streaming', 'netflix|spotify|youtube premium|disney ?\\+|apple music|prime video|\\bhbo\\b|deezer|crunchyroll', 'cat_subs_streaming', null, 'want'],
    ['rule_t_ai', 'AI e strumenti', 'chatgpt|openai|claude\\.ai|anthropic|cursor|midjourney|perplexity|nano-?gpt|openrouter|elevenlabs', 'cat_work_ai', null, 'need'],
    ['rule_t_cloud', 'Cloud e app', 'icloud|google one|google storage|dropbox|onedrive|1password|nordvpn|expressvpn|proton', 'cat_subs_cloud', null, 'want'],
    ['rule_t_dating', 'App di incontri', 'tinder|bumble|hinge|grindr|badoo|okcupid|happn|feeld', 'cat_subs_dating', null, 'want'],
    ['rule_t_market', 'Negozi online', 'amazon|amzn|shopee|tokopedia|lazada|aliexpress|\\btemu\\b|shein|ebay|zalando', 'cat_shop_other', null, 'want'],
    ['rule_t_pharmacy', 'Farmacia', 'pharmacy|farmacia|apotek|guardian|watsons|boots|kimia farma', 'cat_health_pharmacy', null, 'need'],
    ['rule_t_minimarket', 'Minimarket e convenience', '7-?eleven|family ?mart|lawson|circle ?k|ministop|\\bspar\\b', 'cat_food_groceries', null, 'need'],
  ]),
  // Nomi puliti per gli addebiti con sigle strane (solo il nome, la categoria la decidono le altre regole).
  ...renames([
    ['rule_n_amazon', 'amzn|amazon\\s*(mktp|marketplace|\\.com|eu|digital|prime)', 'Amazon'],
    ['rule_n_youtube', 'google\\s*\\*\\s*youtube|youtubepremium', 'YouTube'],
    ['rule_n_apple', 'apple\\.com/bill|apple\\.com\\s*bill|itunes', 'Apple'],
    ['rule_n_google', 'google\\s*\\*\\s*(?!youtube)', 'Google'],
    ['rule_n_netflix', 'netflix\\.com', 'Netflix'],
    ['rule_n_paypal', '^paypal\\s*\\*', 'PayPal'],
  ]),
  // ---- Versione 4: più regole. Prima quelle che correggono casi dove le parole chiave sbaglierebbero
  // (vengono prima delle regole di viaggio), poi i nomi puliti delle catene (STARBUCKS 1234 CANGGU → Starbucks),
  // così "Dove spendi di più" e lo storico raggruppano bene. Le parole chiave (shared/brands.ts) fanno il resto. ----
  ...travel([
    ['rule_v4_prime', 'Amazon Prime (abbonamento)', 'amazon\\s*prime|amzn\\s*prime|prime\\s*member', 'cat_subs_shopping', 'Amazon Prime', 'want'],
    ['rule_v4_prime_video', 'Prime Video', 'prime\\s*video|primevideo', 'cat_subs_streaming', 'Prime Video', 'want'],
    ['rule_v4_kindle', 'Kindle e libri digitali', 'kindle|amazon\\s*digital|audible', 'cat_edu_books', null, 'want'],
    ['rule_v4_aws', 'Amazon Web Services', '\\baws\\b|amazon\\s*web\\s*services', 'cat_work_hosting', 'AWS', 'need'],
    ['rule_v4_uber_one', 'Uber One (abbonamento)', 'uber\\s*one', 'cat_subs_shopping', 'Uber One', 'want'],
    ['rule_v4_grab_unlimited', 'GrabUnlimited (abbonamento)', 'grab\\s*unlimited', 'cat_subs_shopping', 'GrabUnlimited', 'want'],
    ['rule_v4_google_workspace', 'Google Workspace', 'google\\s*\\*?\\s*(gsuite|workspace)|g\\s*suite', 'cat_work_software', 'Google Workspace', 'need'],
    ['rule_v4_google_cloud', 'Google Cloud', 'google\\s*\\*?\\s*cloud|\\bgcp\\b', 'cat_work_hosting', 'Google Cloud', 'need'],
    ['rule_v4_google_one', 'Google One', 'google\\s*\\*?\\s*(one|storage)', 'cat_subs_cloud', 'Google One', 'want'],
    ['rule_v4_apple_icloud', 'iCloud', 'icloud', 'cat_subs_cloud', 'iCloud', 'want'],
    ['rule_v4_microsoft', 'Microsoft 365', 'microsoft\\s*365|office\\s*365|msft\\s*\\*', 'cat_subs_cloud', 'Microsoft 365', 'want'],
    ['rule_v4_adobe', 'Adobe', 'adobe', 'cat_work_software', 'Adobe', 'need'],
    ['rule_v4_spotify', 'Spotify', 'spotify', 'cat_subs_streaming', 'Spotify', 'want'],
    ['rule_v4_disney', 'Disney+', 'disney\\s*(\\+|plus)|disneyplus', 'cat_subs_streaming', 'Disney+', 'want'],
    ['rule_v4_github', 'GitHub', 'github', 'cat_work_software', 'GitHub', 'need'],
    ['rule_v4_cloudflare', 'Cloudflare', 'cloudflare', 'cat_work_hosting', 'Cloudflare', 'need'],
    ['rule_v4_genki_sushi', 'Genki Sushi (ristorante)', 'genki\\s*sushi', 'cat_food_restaurant', 'Genki Sushi', 'want'],
    ['rule_v4_pullman', 'Hotel Pullman', 'pullman\\s*(hotel|bali|jakarta|bangkok|legian|nusa)', 'cat_travel_hotel', null, 'want'],
    ['rule_v4_tourist_levy', 'Tassa turistica di Bali', 'love\\s*bali|tourism\\s*levy|pungutan\\s*wisata', 'cat_travel_visa', 'Tassa turistica di Bali', 'must'],
    ['rule_v4_pln', 'Elettricità (token PLN)', 'token\\s*pln|pln\\s*(prabayar|pascabayar|mobile)', 'cat_home_energy', 'PLN', 'must'],
    ['rule_v4_pulsa', 'Credito telefonico', 'pulsa|paket\\s*data|kuota', 'cat_subs_phone', null, 'need'],
    ['rule_v4_galon', 'Acqua in boccioni', 'galon|isi\\s*ulang\\s*air|water\\s*refill', 'cat_home_water', null, 'need'],
    ['rule_v4_banjar', 'Banjar e sicurezza', 'iuran|banjar|keamanan', 'cat_home_condo', null, 'must'],
    ['rule_v4_beach_club', 'Beach club di Bali', 'finns|potato\\s*head|atlas\\s*beach|la\\s*brisa|savaya|single\\s*fin|ku\\s*de\\s*ta|mrs\\s*sippy|cafe\\s*del\\s*mar|sundays\\s*beach|tropicola|el\\s*kabron|beach\\s*club', 'cat_fun_going_out', null, 'want'],
    ['rule_v4_scooter', 'Noleggio scooter', 'sewa\\s*motor|scooter\\s*(rental|hire)|bike\\s*rental|rental\\s*motor', 'cat_vehicle_rent', null, 'need'],
    ['rule_v4_fuel', 'Benzina (Pertamina, Shell…)', 'pertamina|spbu|pertalite|pertamax|\\bshell\\b|\\bbp\\b|vivo\\s*energy', 'cat_vehicle_fuel', null, 'need'],
    ['rule_v4_hospital', 'Ospedali e cliniche di Bali', 'bimc|siloam|kasih\\s*ibu|prima\\s*medika|bali\\s*royal|bros\\s*hospital|unicare|bali\\s*911|ari\\s*canti', 'cat_health_doctor', null, 'need'],
    ['rule_v4_visa_agent', 'Agenti per il visto', 'visa\\s*(agent|service|extension)|agen\\s*visa|perpanjang(an)?\\s*visa|imigrasi', 'cat_travel_visa', null, 'must'],
    ['rule_v4_tax_it', 'Tasse italiane', '\\bf24\\b|pagopa|agenzia\\s*(delle\\s*)?entrate|\\binps\\b|imposta\\s*di\\s*bollo', 'cat_fin_taxes', null, 'must'],
    ['rule_v4_bank_fee', 'Commissioni bancarie', 'foreign\\s*transaction\\s*fee|fx\\s*fee|transfer\\s*fee|biaya\\s*(admin|transfer|kartu)|annual\\s*fee|card\\s*fee', 'cat_fin_fees', null, 'must'],
  ], 60, 4),
  ...renames([
    ['rule_n4_starbucks', '\\bstarbucks\\b', 'Starbucks'],
    ['rule_n4_mcdonalds', 'mc\\s*donald|\\bmcd\\b', "McDonald's"],
    ['rule_n4_kfc', '\\bkfc\\b|kentucky\\s*fried', 'KFC'],
    ['rule_n4_burger_king', 'burger\\s*king', 'Burger King'],
    ['rule_n4_pizza_hut', 'pizza\\s*hut', 'Pizza Hut'],
    ['rule_n4_dominos', "domino'?s", "Domino's"],
    ['rule_n4_subway', 'subway\\s*(sandwich|restaurant|\\d)', 'Subway'],
    ['rule_n4_circle_k', 'circle\\s*k', 'Circle K'],
    ['rule_n4_7eleven', '7\\s*-?\\s*eleven|seven\\s*eleven', '7-Eleven'],
    ['rule_n4_indomaret', 'indomaret', 'Indomaret'],
    ['rule_n4_alfamart', 'alfamart', 'Alfamart'],
    ['rule_n4_alfamidi', 'alfamidi', 'Alfamidi'],
    ['rule_n4_familymart', 'family\\s*mart', 'FamilyMart'],
    ['rule_n4_lawson', 'lawson', 'Lawson'],
    ['rule_n4_pepito', 'pepito', 'Pepito'],
    ['rule_n4_coco_mart', 'coco\\s*mart', 'Coco Mart'],
    ['rule_n4_frestive', 'frestive', 'Frestive'],
    ['rule_n4_grand_lucky', 'grand\\s*lucky', 'Grand Lucky'],
    ['rule_n4_carrefour', 'carrefour', 'Carrefour'],
    ['rule_n4_lidl', '\\blidl\\b', 'Lidl'],
    ['rule_n4_esselunga', 'esselunga', 'Esselunga'],
    ['rule_n4_conad', '\\bconad\\b', 'Conad'],
    ['rule_n4_guardian', '(?<!the\\s)\\bguardian\\b(?!\\s*(news|media|angel))', 'Guardian'],
    ['rule_n4_watsons', 'watsons', 'Watsons'],
    ['rule_n4_kimia_farma', 'kimia\\s*farma', 'Kimia Farma'],
    ['rule_n4_k24', 'apotek\\s*k-?24|\\bk-?24\\b', 'Apotek K-24'],
    ['rule_n4_uniqlo', 'uniqlo', 'Uniqlo'],
    ['rule_n4_zara', '\\bzara\\b(?!\\s*home)', 'Zara'],
    ['rule_n4_hm', '\\bh\\s*&\\s*m\\b|hennes', 'H&M'],
    ['rule_n4_ikea', '\\bikea\\b', 'IKEA'],
    ['rule_n4_decathlon', 'decathlon', 'Decathlon'],
    ['rule_n4_miniso', 'miniso', 'Miniso'],
    ['rule_n4_ace', 'ace\\s*hardware', 'ACE Hardware'],
    ['rule_n4_mixue', 'mixue', 'Mixue'],
    ['rule_n4_janji_jiwa', 'janji\\s*jiwa', 'Kopi Janji Jiwa'],
    ['rule_n4_kopi_kenangan', 'kopi\\s*kenangan', 'Kopi Kenangan'],
    ['rule_n4_fore', 'fore\\s*coffee', 'Fore Coffee'],
    ['rule_n4_jco', '\\bj\\.?\\s*co\\b', 'J.CO'],
    ['rule_n4_gacoan', 'gacoan', 'Mie Gacoan'],
    ['rule_n4_revolver', 'revolver\\s*(espresso|coffee)?', 'Revolver'],
    ['rule_n4_milk_madu', 'milk\\s*(&|and)\\s*madu', 'Milk & Madu'],
    ['rule_n4_bluebird', 'blue\\s*bird', 'Blue Bird'],
    ['rule_n4_traveloka', 'traveloka', 'Traveloka'],
    ['rule_n4_tiket', 'tiket\\.?com', 'tiket.com'],
    ['rule_n4_agoda', 'agoda', 'Agoda'],
    ['rule_n4_booking', 'booking\\.com', 'Booking.com'],
    ['rule_n4_airbnb', 'airbnb', 'Airbnb'],
    ['rule_n4_klook', 'klook', 'Klook'],
    ['rule_n4_steam', 'steam\\s*(games|powered|purchase|store)|steampowered|^steam$', 'Steam'],
    ['rule_n4_playstation', 'playstation|sony\\s*interactive|\\bpsn\\b', 'PlayStation'],
    ['rule_n4_openai', 'openai|chatgpt', 'ChatGPT'],
    ['rule_n4_claude', 'claude\\.ai|anthropic', 'Claude'],
    ['rule_n4_facebook_ads', 'facebk|meta\\s*ads|facebook\\s*ads', 'Meta Ads'],
    ['rule_n4_shopee', 'shopee(?!\\s*food)', 'Shopee'],
    ['rule_n4_tokopedia', 'tokopedia', 'Tokopedia'],
    ['rule_n4_lazada', 'lazada', 'Lazada'],
  ], 70, 4),
];

/** Id delle voci iniziali: con il suffisso dell'account (cat_food~usr_…), unici in tutto il database. */
export function seedId(base: string, userId: string): string {
  return `${base}~${userId}`;
}

function remap(def: RuleDefinition, userId: string): RuleDefinition {
  const id = (x: string | undefined) => (x ? seedId(x, userId) : x);
  const fix = (a: RuleDefinition['actions']) => ({ ...a, category_id: id(a.category_id), ask: a.ask?.map((x) => seedId(x, userId)) });
  return { ...def, actions: fix(def.actions), bands: def.bands?.map((b) => ({ ...b, actions: fix(b.actions) })) };
}

/** Categorie in stile Wallet, regole pronte per l'Indonesia e il conto Contanti, se l'account non ne ha. */
export async function seedUser(db: D1Database, userId: string): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  const cats = await db.prepare('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?').bind(userId).first<{ n: number }>();
  // Un account con le categorie vecchie si aggiorna invece di riceverne di nuove.
  if (cats?.n) await upgradeCatalog(db, userId);
  if (!cats?.n) {
    let pos = 0;
    const insert = 'INSERT INTO categories (id, user_id, name, parent_id, kind, nature, color, icon, position, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
    for (const p of TREE) {
      const off = p.optional ? 1 : 0;
      stmts.push(db.prepare(insert).bind(seedId(p.id, userId), userId, p.name, null, p.kind, p.nature, p.color, p.icon, pos++, off));
      for (const [id, name, nature] of p.children) {
        stmts.push(db.prepare(insert).bind(seedId(id, userId), userId, name, seedId(p.id, userId), p.kind, nature, p.color, p.icon, pos++, off));
      }
    }
    const now = nowIso();
    for (const r of PRESETS) {
      stmts.push(db.prepare('INSERT INTO rules (id, user_id, name, enabled, priority, definition, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
        .bind(seedId(r.id, userId), userId, r.name, r.priority, JSON.stringify(remap(r.definition, userId)), now, now));
    }
  }
  const accounts = await db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?').bind(userId).first<{ n: number }>();
  if (!accounts?.n) {
    stmts.push(db.prepare("INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, created_at) VALUES (?, ?, 'Contanti', 'cash', 'EUR', 0, 0, ?)")
      .bind(seedId('acc_cash', userId), userId, nowIso()));
  }
  stmts.push(db.prepare('UPDATE users SET catalog_version = ? WHERE id = ?').bind(CATALOG_VERSION, userId));
  await runBatch(db, stmts);
}

/**
 * Porta un account con le categorie della versione 1 alla versione 2: le predefinite diventano esattamente quelle
 * nuove (quelle tolte spariscono), movimenti, regole e sottocategorie personali passano alle nuove.
 * Le categorie create dall'utente restano.
 */
export async function upgradeCatalog(db: D1Database, userId: string): Promise<void> {
  const row = await db.prepare('SELECT catalog_version AS v FROM users WHERE id = ?').bind(userId).first<{ v: number }>();
  if (!row || row.v >= CATALOG_VERSION) return;
  const stmts: D1PreparedStatement[] = [];
  if (row.v < 2) await upgradeTo2(db, userId, stmts);
  // Dalla versione 3: le regole predefinite nuove (solo quelle della versione che manca: le vecchie tolte dall'utente non tornano).
  const now = nowIso();
  for (const r of PRESETS.filter((p) => (p.since ?? 1) >= 3 && (p.since ?? 1) > row.v)) {
    stmts.push(db.prepare('INSERT OR IGNORE INTO rules (id, user_id, name, enabled, priority, definition, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?)')
      .bind(seedId(r.id, userId), userId, r.name, r.priority, JSON.stringify(remap(r.definition, userId)), now, now));
  }
  stmts.push(db.prepare('UPDATE users SET catalog_version = ? WHERE id = ?').bind(CATALOG_VERSION, userId));
  await runBatch(db, stmts);
}

/** Aggiornamento 1 → 2 delle categorie (vedi upgradeCatalog). */
async function upgradeTo2(db: D1Database, userId: string, stmts: D1PreparedStatement[]): Promise<void> {
  const existing = new Map((await db.prepare('SELECT id, name FROM categories WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>()).results
    .map((r) => [r.id, r.name]));
  const sid = (base: string) => seedId(base, userId);
  let pos = 0;
  for (const p of TREE) {
    const off = p.optional ? 1 : 0;
    for (const [id, name, nature, parent] of [[p.id, p.name, p.nature, null] as const, ...p.children.map(([i, n, nat]) => [i, n, nat, p.id] as const)]) {
      if (existing.has(sid(id))) {
        // Aggiornamento 1 → 2 autorizzato dal proprietario: le categorie predefinite prendono nome, gruppo,
        // colore e stato (acceso o spento) della versione nuova. Quelle create dall'utente non si toccano.
        stmts.push(db.prepare('UPDATE categories SET name = ?, parent_id = ?, kind = ?, nature = ?, color = ?, icon = ?, position = ?, archived = ? WHERE id = ?')
          .bind(name, parent ? sid(parent) : null, p.kind, nature, p.color, p.icon, pos++, off, sid(id)));
      } else {
        stmts.push(db.prepare('INSERT INTO categories (id, user_id, name, parent_id, kind, nature, color, icon, position, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(sid(id), userId, name, parent ? sid(parent) : null, p.kind, nature, p.color, p.icon, pos++, off));
      }
    }
  }
  const moves = Object.entries(RETIRED).filter(([from]) => existing.has(sid(from)) && from !== RETIRED[from]);
  for (const [from, to] of moves) {
    const [f, t] = [sid(from), sid(to)];
    stmts.push(db.prepare('UPDATE transactions SET category_id = ? WHERE user_id = ? AND category_id = ?').bind(t, userId, f));
    stmts.push(db.prepare('UPDATE transactions SET review_choices = replace(review_choices, ?, ?) WHERE user_id = ? AND instr(review_choices, ?) > 0')
      .bind(`"${f}"`, `"${t}"`, userId, `"${f}"`));
    stmts.push(db.prepare('UPDATE categories SET parent_id = ? WHERE user_id = ? AND parent_id = ?').bind(t, userId, f));
  }
  // Regole: le categorie ritirate dentro le definizioni diventano le nuove.
  const rules = (await db.prepare('SELECT id, definition FROM rules WHERE user_id = ?').bind(userId).all<{ id: string; definition: string }>()).results;
  const map = new Map(moves.map(([f, t]) => [sid(f), sid(t)]));
  for (const r of rules) {
    const def = r.definition.replace(/"([^"\\]+)"/g, (m, x: string) => (map.has(x) ? `"${map.get(x)}"` : m));
    if (def !== r.definition) stmts.push(db.prepare('UPDATE rules SET definition = ? WHERE id = ?').bind(def, r.id));
  }
  // Prima le sottocategorie, poi i gruppi.
  for (const [from] of moves.filter(([f]) => f.split('_').length > 2)) stmts.push(db.prepare('DELETE FROM categories WHERE id = ?').bind(sid(from)));
  for (const [from] of moves.filter(([f]) => f.split('_').length <= 2)) stmts.push(db.prepare('DELETE FROM categories WHERE id = ?').bind(sid(from)));
}
