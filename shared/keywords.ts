import { BRANDS } from './brands';

// Categoria dalle parole del negozio o della notifica, in molte lingue e con le marche più diffuse nel mondo.
// Serve quando nessuna regola e nessuna spesa passata dello stesso negozio indicano la categoria.
// Le chiavi sono gli id di base delle categorie predefinite (worker/seed.ts): ogni account li ha con il suo suffisso.

const K: Record<string, string[]> = {
  cat_food_delivery: [
    'delivery', 'gofood', 'grabfood', 'grab food', 'uber eats', 'ubereats', 'deliveroo', 'just eat', 'justeat', 'glovo', 'doordash', 'foodpanda',
    'talabat', 'zomato', 'swiggy', 'wolt', 'lieferando', 'rappi', 'ifood', 'menulog', 'shopeefood', 'lineman', 'meituan', 'ele.me', 'baemin',
    'consegna a domicilio', 'domicilio', 'livraison', 'lieferung', 'pesan antar', 'pedidosya',
  ],
  cat_food_fastfood: [
    'mcdonald', "mcdonald's", 'burger king', 'kfc', 'subway', 'domino', "domino's", 'pizza hut', 'wendy', 'taco bell', 'five guys', 'jollibee',
    'shake shack', 'popeyes', 'chick-fil-a', 'carl\'s jr', 'hesburger', 'fast food', 'fastfood', 'kebab', 'döner', 'doner', 'shawarma',
  ],
  cat_food_bar: [
    'cafe', 'café', 'caffe', 'caffè', 'coffee', 'kopi', 'kafe', 'starbucks', 'costa coffee', 'tim hortons', 'dunkin', 'janji jiwa', 'kopi kenangan',
    'fore coffee', 'luckin', 'espresso', 'cappuccino', 'bakery', 'panetteria', 'pasticceria', 'boulangerie', 'bäckerei', 'panaderia', 'panadería',
    'patisserie', 'gelato', 'gelateria', 'ice cream', 'tea house', 'boba', 'chatime', 'koi thé', '咖啡', 'カフェ', 'กาแฟ', 'قهوة',
  ],
  cat_food_drinks: [
    'pub', 'beer', 'birra', 'cocktail', 'wine bar', 'enoteca', 'brewery', 'nightclub', 'discoteca', 'lounge', 'tavern', 'taverna',
    'bir', 'bintang', 'liquor', 'bottle shop', 'cervecería', 'cerveceria', 'brasserie', 'kneipe',
  ],
  cat_food_restaurant: [
    'restaurant', 'ristorante', 'restaurante', 'restoran', 'trattoria', 'osteria', 'pizzeria', 'pizza', 'sushi', 'ramen', 'bistro', 'bistrot',
    'diner', 'grill', 'steakhouse', 'brasserie', 'warung', 'rumah makan', 'makan', 'nasi', 'sate', 'bakso', 'babi guling', 'padang', 'kitchen',
    'eatery', 'food court', 'noodle', 'dim sum', 'izakaya', 'taqueria', 'cantina', 'gastro', 'trattoria', 'comida', 'kainan', 'carinderia',
    '餐厅', '饭店', 'レストラン', 'ร้านอาหาร', 'مطعم', '식당',
  ],
  cat_food_groceries: [
    'supermarket', 'supermercato', 'supermercado', 'supermarché', 'supermarkt', 'grocery', 'groceries', 'alimentari', 'minimarket', 'mini market',
    'indomaret', 'alfamart', 'alfamidi', 'circle k', 'lawson', 'family mart', 'familymart', '7-eleven', '7 eleven', 'seven eleven', 'pepito', 'coco mart',
    'carrefour', 'lidl', 'aldi', 'tesco', 'sainsbury', 'waitrose', 'walmart', 'costco', 'whole foods', 'trader joe', 'kroger', 'esselunga',
    'conad', 'coop', 'eurospin', 'pam ', 'auchan', 'leclerc', 'intermarché', 'rewe', 'edeka', 'mercadona', 'spar', 'hypermart', 'superindo',
    'ranch market', 'grand lucky', 'lotte mart', 'big c', 'makro', 'fairprice', 'cold storage', 'giant', 'sm supermarket', 'puregold',
    'robinsons', 'woolworths', 'coles', 'lulu', 'spinneys', 'waitrose', 'mercato', 'market', 'pasar', 'mercado', 'marché', '超市', 'スーパー', 'ซูเปอร์',
  ],
  cat_transport_taxi: [
    'taxi', 'cab', 'uber', 'lyft', 'bolt', 'grab', 'gojek', 'goride', 'gocar', 'careem', 'didi', 'cabify', 'freenow', 'free now', 'blablacar', 'indrive',
    'yandex go', 'rapido', 'bluebird', 'blue bird', 'maxim', 'xanh sm', 'angkas', 'chauffeur', 'autista', 'ncc', '出租车', 'タクシー', 'แท็กซี่', 'تاكسي',
  ],
  cat_transport_flights: [
    'airline', 'airlines', 'airways', 'flight', 'volo', 'vuelo', 'vol ', 'flug', 'penerbangan', 'ryanair', 'easyjet', 'wizz', 'lufthansa',
    'emirates', 'qatar', 'etihad', 'singapore airlines', 'scoot', 'airasia', 'air asia', 'lion air', 'batik air', 'garuda', 'citilink', 'cebu pacific',
    'thai airways', 'vietjet', 'jetstar', 'qantas', 'ita airways', 'klm', 'air france', 'british airways', 'turkish', 'pegasus', 'flydubai',
    'skyscanner', 'kiwi.com', 'traveloka flight', 'tiket.com', 'expedia', 'airport', 'aeroporto', 'bandara', '航空', 'สายการบิน',
  ],
  cat_transport_public: [
    'metro', 'subway', 'mrt', 'lrt', 'bts', 'bus', 'autobus', 'tram', 'transjakarta', 'krl', 'oyster', 'tfl', 'atm milano', 'atac', 'transit',
    'octopus', 'ez-link', 'suica', 'pasmo', 'nol card', 'rta', 'metropolitana', 'u-bahn', 's-bahn', 'trasporto pubblico',
  ],
  cat_transport_train: [
    'train', 'treno', 'trenitalia', 'italo', 'sncf', 'deutsche bahn', 'db bahn', 'renfe', 'eurostar', 'amtrak', 'kai', 'kereta', 'whoosh',
    'flixbus', 'greyhound', 'pullman', 'coach', 'national express', 'rail', 'bahn', 'tren',
  ],
  cat_transport_ferry: ['ferry', 'traghetto', 'fast boat', 'fastboat', 'speedboat', 'boat', 'pelni', 'asdp', 'moby', 'tirrenia', 'grimaldi', 'ferries', 'feribot'],
  cat_vehicle_fuel: [
    'fuel', 'gas station', 'petrol', 'benzina', 'carburante', 'gasolio', 'diesel', 'bensin', 'pertamina', 'shell', 'esso', 'eni', 'q8', 'tamoil',
    'bp ', 'chevron', 'exxon', 'caltex', 'petron', 'ptt', 'adnoc', 'enoc', 'spbu', 'gasolinera', 'tankstelle', 'station-service',
  ],
  cat_vehicle_charging: ['ev charging', 'charging', 'tesla supercharger', 'supercharger', 'ionity', 'chargepoint', 'ricarica', 'enel x', 'be charge'],
  cat_vehicle_parking: ['parking', 'parcheggio', 'parkir', 'parkplatz', 'estacionamiento', 'telepass', 'toll', 'pedaggio', 'autostrada', 'tol ', 'e-toll', 'salik', 'peaje', 'maut'],
  cat_vehicle_rent: ['rental', 'rent car', 'car rental', 'noleggio', 'sewa motor', 'sewa mobil', 'scooter rental', 'hertz', 'avis', 'europcar', 'sixt', 'budget rent', 'enterprise rent', 'zipcar'],
  cat_vehicle_maintenance: ['bengkel', 'officina', 'mechanic', 'garage', 'tyre', 'tire', 'gomme', 'car wash', 'lavaggio', 'cuci motor', 'autolavaggio'],
  cat_home_rent: ['rent', 'affitto', 'alquiler', 'loyer', 'miete', 'sewa rumah', 'sewa villa', 'kos ', 'kost', 'mutuo', 'mortgage', 'airbnb monthly'],
  cat_home_energy: ['pln', 'token listrik', 'listrik', 'electricity', 'elettricità', 'enel', 'edison', 'a2a', 'hera', 'iren', 'octopus energy', 'edf', 'iberdrola', 'meralco', 'dewa', 'tnb', 'power bill'],
  cat_home_water: ['pdam', 'water bill', 'acquedotto', 'bolletta acqua', 'galon', 'aqua galon', 'air minum'],
  cat_home_gas: ['gas bill', 'bolletta gas', 'lpg', 'elpiji', 'gas lpg'],
  cat_home_internet: ['indihome', 'biznet', 'first media', 'myrepublic', 'fibra', 'fiber', 'broadband', 'wifi', 'wi-fi', 'tim fibra', 'fastweb', 'iliad box', 'starlink', 'pldt', 'globe at home', 'converge', 'true online', '3bb', 'ais fibre', 'du home', 'etisalat home'],
  cat_home_cleaning: ['laundry', 'lavanderia', 'laundromat', 'pressing', 'dry clean', 'cleaning', 'pulizie', 'housekeeping', 'cleaner'],
  cat_home_maintenance: ['plumber', 'idraulico', 'electrician', 'elettricista', 'repair', 'riparazione', 'ferramenta', 'hardware store', 'ace hardware', 'mitra10', 'bauhaus', 'leroy merlin', 'obi '],
  cat_shop_clothes: ['zara', 'h&m', 'uniqlo', 'nike', 'adidas', 'puma', 'levi', 'decathlon', 'primark', 'pull&bear', 'bershka', 'stradivarius', 'massimo dutti', 'cotton on', 'shoes', 'scarpe', 'abbigliamento', 'clothing', 'fashion', 'boutique', 'baju', 'pakaian', 'sepatu', 'ropa', 'vêtements'],
  cat_shop_electronics: ['apple store', 'samsung', 'xiaomi', 'mediaworld', 'media markt', 'mediamarkt', 'unieuro', 'euronics', 'best buy', 'currys', 'fnac', 'erafone', 'ibox', 'electronic', 'elettronica', 'electronics'],
  cat_shop_home: ['ikea', 'jysk', 'informa', 'home depot', 'maisons du monde', 'zara home', 'h&m home', 'kave home', 'furniture', 'arredamento', 'mebel'],
  cat_shop_hobby: ['hobby', 'craft', 'lego', 'games workshop', 'music store', 'strumenti musicali', 'art supplies', 'gamestop', 'toys', 'giocattoli'],
  cat_shop_other: ['amazon', 'shopee', 'tokopedia', 'lazada', 'aliexpress', 'temu', 'shein', 'ebay', 'etsy', 'zalando', 'blibli', 'bukalapak', 'noon', 'taobao', 'jd.com', 'mercado libre', 'mercadolibre'],
  cat_subs_streaming: ['netflix', 'spotify', 'youtube', 'youtube premium', 'disney+', 'disney plus', 'prime video', 'hbo', 'apple music', 'apple tv', 'deezer', 'tidal', 'dazn', 'now tv', 'paramount', 'crunchyroll', 'vidio', 'viu', 'iqiyi', 'hulu', 'twitch', 'patreon', 'onlyfans', 'audible'],
  cat_subs_dating: ['tinder', 'bumble', 'hinge', 'grindr', 'badoo', 'okcupid', 'happn', 'feeld', 'raya', 'meetic', 'match.com', 'tantan'],
  cat_subs_games: ['steam', 'playstation', 'psn', 'xbox', 'nintendo', 'epic games', 'riot', 'blizzard', 'roblox', 'ea play', 'ubisoft', 'supercell', 'garena', 'mobile legends', 'pubg', 'genshin', 'codashop', 'unipin'],
  cat_subs_cloud: ['icloud', 'google one', 'google storage', 'dropbox', 'onedrive', 'microsoft 365', 'office 365', 'evernote', 'notion', '1password', 'nordvpn', 'expressvpn', 'proton', 'app store', 'apple.com/bill', 'google play', 'play store'],
  cat_subs_shopping: ['amazon prime', 'prime membership', 'costco membership', 'walmart+', 'shopee vip', 'grab unlimited', 'uber one', 'gopay plus'],
  cat_subs_phone: ['telkomsel', 'xl axiata', 'indosat', 'smartfren', 'by.u', 'tri indonesia', 'im3', 'axis', 'vodafone', 'tim ', 'wind tre', 'iliad', 'ho. mobile', 'kena mobile', 'movistar', 'verizon', 't-mobile', 'at&t', 'globe', 'smart communications', 'dtac', 'truemove', 'singtel', 'starhub', 'etisalat', 'airalo', 'holafly', 'esim', 'pulsa', 'paket data', 'ricarica telefonica', 'top up pulsa', 'prepaid'],
  cat_health_pharmacy: ['pharmacy', 'farmacia', 'apotek', 'apotik', 'kimia farma', 'guardian', 'watsons', 'boots', 'walgreens', 'cvs', 'pharmacie', 'apotheke', 'drugstore', 'mercury drug', '药店', '薬局', 'ร้านขายยา', 'صيدلية'],
  cat_health_doctor: ['clinic', 'clinica', 'klinik', 'hospital', 'ospedale', 'rumah sakit', 'doctor', 'dottore', 'medico', 'dokter', 'siloam', 'bimc', 'kasih ibu', 'laboratorio', 'lab test', 'prodia', 'ambulatorio', 'médecin', 'arzt', 'hôpital', 'krankenhaus'],
  cat_health_dentist: ['dentist', 'dentista', 'dental', 'dokter gigi', 'odontoiatra', 'odontoiatria', 'dentiste', 'zahnarzt', 'orthodontist', 'orthodontics', 'ortodonzia', 'ortodontista'],
  cat_health_optician: ['optician', 'ottico', 'optik', 'optical', 'occhiali', 'glasses', 'lenses', 'lenti a contatto', 'specsavers', 'salmoiraghi', 'grandvision'],
  cat_health_insurance: ['health insurance', 'assicurazione sanitaria', 'allianz care', 'cigna', 'bupa', 'safetywing', 'genki', 'axa health', 'bpjs'],
  cat_care_hair: ['barber', 'barbiere', 'barbershop', 'parrucchiere', 'hair salon', 'salon', 'hairdresser', 'potong rambut', 'coiffeur', 'friseur', 'peluquería', 'peluqueria'],
  cat_care_spa: ['spa', 'massage', 'massaggio', 'pijat', 'reflexology', 'nail', 'manicure', 'pedicure', 'beauty salon', 'centro estetico', 'estetista', 'facial'],
  cat_care_fitness: ['gym', 'palestra', 'fitness', 'crossfit', 'yoga', 'pilates', 'muay thai', 'boxing', 'surf', 'diving', 'padel', 'tennis', 'climbing', 'anytime fitness', 'virgin active', 'basic-fit', 'mcfit', 'classpass', 'strava', 'gimnasio', 'salle de sport'],
  cat_care_cosmetics: ['sephora', 'douglas', 'kiko', 'lush', 'the body shop', 'cosmetics', 'cosmetici', 'kosmetik', 'skincare', 'profumeria', 'sociolla', 'beauty'],
  cat_fun_events: ['cinema', 'cinéma', 'kino', 'cine', 'cgv', 'xxi', 'cinepolis', 'imax', 'ticketmaster', 'ticketone', 'eventbrite', 'dice.fm', 'concert', 'concerto', 'festival', 'theatre', 'teatro', 'museum', 'museo', 'stadium'],
  cat_fun_activities: ['tour', 'excursion', 'escursione', 'klook', 'getyourguide', 'viator', 'tiqets', 'waterpark', 'theme park', 'snorkeling', 'rafting', 'zoo', 'aquarium', 'bowling'],
  cat_fun_going_out: ['beach club', 'night out', 'karaoke', 'billiard', 'biliardo'],
  cat_fun_games: ['casino', 'lottery', 'lotteria', 'scommesse', 'scommessa', 'arcade', 'timezone'],
  cat_travel_hotel: ['hotel', 'hostel', 'ostello', 'resort', 'villa', 'airbnb', 'booking.com', 'agoda', 'traveloka', 'expedia hotel', 'hotels.com', 'trip.com', 'guesthouse', 'homestay', 'motel', 'b&b', 'bed and breakfast', 'albergo', 'penginapan', 'ホテル', '酒店', 'โรงแรม', 'فندق'],
  cat_travel_visa: ['kitas', 'kitap', 'imigrasi', 'immigration', 'evisa', 'e-visa', 'esta', 'passport', 'passaporto', 'paspor', 'embassy', 'ambasciata', 'consulate', 'vfs'],
  cat_edu_courses: ['udemy', 'coursera', 'skillshare', 'masterclass', 'duolingo', 'babbel', 'italki', 'preply', 'course', 'corso', 'kursus', 'curso', 'workshop', 'academy', 'bootcamp'],
  cat_edu_books: ['book', 'libro', 'libreria', 'bookstore', 'kindle', 'gramedia', 'feltrinelli', 'mondadori', 'waterstones', 'barnes', 'kinokuniya', 'buku'],
  cat_edu_school: ['school', 'scuola', 'university', 'università', 'universitas', 'tuition', 'retta', 'college', 'sekolah'],
  cat_work_ai: ['claude', 'anthropic', 'chatgpt', 'openai', 'cursor', 'github copilot', 'copilot', 'midjourney', 'perplexity', 'gemini', 'nanogpt', 'nano-gpt', 'elevenlabs', 'runway', 'replicate', 'mistral', 'groq', 'together.ai', 'openrouter', 'higgsfield', 'suno', 'heygen'],
  cat_work_software: ['github', 'gitlab', 'figma', 'canva', 'adobe', 'slack', 'zoom', 'atlassian', 'jira', 'linear', 'webflow', 'framer', 'zapier', 'make.com', 'airtable', 'google workspace', 'gsuite', 'microsoft', 'apple developer', 'jetbrains', 'setapp', 'loom', 'calendly', 'docusign', 'grammarly'],
  cat_work_hosting: ['cloudflare', 'vercel', 'netlify', 'aws', 'amazon web services', 'google cloud', 'gcp', 'azure', 'digitalocean', 'hetzner', 'ovh', 'linode', 'heroku', 'render.com', 'fly.io', 'supabase', 'firebase', 'namecheap', 'godaddy', 'porkbun', 'aruba', 'hostinger', 'siteground', 'domain', 'dominio'],
  cat_work_cowork: ['coworking', 'co-working', 'wework', 'regus', 'outpost', 'dojo', 'tropical nomad', 'hubud', 'spaces '],
  cat_work_equipment: ['monitor', 'laptop', 'macbook', 'keyboard', 'tastiera', 'office supplies', 'cancelleria', 'printer', 'stampante'],
  cat_fin_fees: ['fees', 'commissione', 'commissioni', 'biaya admin', 'admin fee', 'bank charge', 'service charge', 'canone', 'monthly fee', 'frais', 'gebühr', 'comisión'],
  cat_fin_atm: ['atm', 'cash withdrawal', 'withdrawal', 'prelievo', 'tarik tunai', 'retiro', 'retrait', 'bancomat', 'money changer', 'cambio valuta', 'currency exchange', 'western union', 'moneygram'],
  cat_fin_taxes: ['tasse', 'imposte', 'agenzia delle entrate', 'f24', 'pajak', 'djp', 'hmrc', 'irs', 'impuesto', 'impôt', 'steuer'],
  cat_fin_insurance: ['insurance', 'assicurazione', 'asuransi', 'seguro', 'assurance', 'versicherung', 'generali', 'allianz', 'axa', 'unipol', 'prudential', 'manulife'],
  cat_fin_fines: ['multa', 'tilang', 'penalty', 'sanzione', 'contravvenzione', 'amende', 'bußgeld'],
  cat_fin_loans: ['loan', 'prestito', 'interessi passivi', 'pinjaman', 'cicilan', 'installment', 'rata', 'klarna', 'afterpay', 'paylater', 'kredivo', 'akulaku'],
  cat_invest: ['investment', 'investimento', 'savings', 'risparmi', 'deposito', 'binance', 'coinbase', 'kraken', 'bybit', 'okx', 'indodax', 'pintu', 'bibit', 'ajaib', 'degiro', 'trade republic', 'interactive brokers', 'etoro', 'scalable', 'directa', 'fineco trading'],
  cat_gifts_charity: ['donation', 'donazione', 'charity', 'beneficenza', 'donasi', 'unicef', 'red cross', 'croce rossa', 'gofundme', 'kitabisa', 'save the children', 'amnesty', 'emergency', 'msf'],
  cat_gifts_religious: ['church', 'chiesa', 'temple', 'tempio', 'pura', 'canang', 'mosque', 'masjid', 'moschea', 'offering', 'offerta', 'zakat', 'sedekah', 'infaq'],
  cat_pets_vet: ['vet', 'veterinario', 'veterinary', 'dokter hewan', 'vétérinaire', 'tierarzt'],
  cat_pets_food: ['pet shop', 'petshop', 'pet food', 'cibo per cani', 'cibo per gatti', 'royal canin', 'whiskas', 'pedigree', 'zooplus', 'arcaplanet', 'maxi zoo'],
  cat_income_salary: ['salary', 'stipendio', 'gaji', 'payroll', 'wage', 'salario', 'sueldo', 'salaire', 'gehalt', 'busta paga'],
  cat_income_freelance: ['invoice', 'fattura', 'faktur', 'upwork', 'fiverr', 'toptal', 'freelance', 'factura', 'facture', 'rechnung', 'stripe payout', 'payout'],
  cat_income_refund: ['refund', 'rimborso', 'reembolso', 'remboursement', 'erstattung', 'pengembalian', 'cashback', 'chargeback', 'storno'],
  cat_income_interest: ['dividend', 'dividendo', 'dividen', 'cedola'],
  cat_income_bank: ['interest earned', 'interessi attivi', 'bunga', 'savings interest', 'vault interest', 'interest payment'],
  cat_income_crypto: ['staking', 'staking reward', 'yield', 'airdrop', 'mining', 'liquidity', 'lp reward', 'crypto reward'],
  cat_income_rent: ['rent received', 'affitto ricevuto', 'canone di locazione', 'rental income', 'airbnb payout', 'booking payout'],
  cat_income_sales: ['vinted', 'subito.it', 'depop', 'marketplace sale', 'ebay sale', 'venduto', 'penjualan'],
};

// Più nomi senza pesare: invece di una espressione regolare per categoria, una tabella frase → categoria.
// Il testo si divide in parole e si cercano le frasi di 1–6 parole che iniziano e finiscono su una parola:
// il costo dipende dalla lunghezza del testo, non da quante voci ci sono (migliaia vanno bene).
for (const [id, words] of Object.entries(BRANDS)) K[id] = [...(K[id] ?? []), ...words];

/** Prima le categorie più specifiche: a parità di lunghezza vince quella che viene prima. */
const ORDER = Object.keys(K);

const strip = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');
const OTHER_SCRIPT = /[^\p{Script=Latin}\P{L}]/u; // una lettera non latina (cinese, thai, arabo…)
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const TOKEN = /[\p{L}\p{N}]+/gu;

interface Table { phrases: Map<string, string>; other: Array<[string, string]>; maxWords: number }
const build = (income: boolean): Table => {
  const t: Table = { phrases: new Map(), other: [], maxWords: 1 };
  for (const id of ORDER) {
    if (id.startsWith('cat_income') !== income) continue;
    for (const raw of K[id]) {
      const w = strip(raw).trim().replace(EDGE, '');
      if (!w) continue;
      if (OTHER_SCRIPT.test(w)) { if (!t.other.some(([x]) => x === w)) t.other.push([w, id]); continue; }
      if (t.phrases.has(w)) continue; // la stessa voce in due categorie: vale la prima
      t.phrases.set(w, id);
      t.maxWords = Math.max(t.maxWords, w.match(TOKEN)?.length ?? 1);
    }
  }
  return t;
};
const TABLES = { expense: build(false), income: build(true) };

function bestIn(t: Table, text: string): string | null {
  const s = strip(text);
  const tokens = [...s.matchAll(TOKEN)].map((m) => [m.index!, m.index! + m[0].length] as const);
  let best: string | null = null;
  let len = 0;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i; j < Math.min(tokens.length, i + t.maxWords); j++) {
      const phrase = s.slice(tokens[i][0], tokens[j][1]);
      if (phrase.length <= len) continue;
      const id = t.phrases.get(phrase);
      if (id) { best = id; len = phrase.length; }
    }
  }
  for (const [w, id] of t.other) if (w.length > len && s.includes(w)) { best = id; len = w.length; }
  return best;
}

/**
 * Categoria (id di base) dalle parole: prima nel nome del negozio, poi nella categoria letta dal telefono,
 * infine nel testo della notifica. Vince la frase più lunga ("amazon prime" batte "amazon").
 * `kind` limita alle categorie di spesa o di entrata. `null` se nessuna parola è riconosciuta.
 */
export function categoryFromKeywords(kind: 'expense' | 'income', ...texts: Array<string | null | undefined>): string | null {
  for (const t of texts) {
    if (!t) continue;
    const best = bestIn(TABLES[kind], t);
    if (best) return best;
  }
  return null;
}

export const KEYWORD_CATEGORIES = ORDER;
/** Quante voci conosce (per i test e per curiosità). */
export const KEYWORD_COUNT = TABLES.expense.phrases.size + TABLES.expense.other.length + TABLES.income.phrases.size + TABLES.income.other.length;
