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

export const CATALOG_VERSION = 2;

/** Categorie della versione 1 (stile Wallet) che non esistono più: dove vanno i loro movimenti. */
export const RETIRED: Record<string, string> = {
  cat_shop_pharmacy: 'cat_health_pharmacy', cat_shop_beauty: 'cat_care_cosmetics', cat_shop_gifts: 'cat_shop_other', cat_shop_online: 'cat_shop_other',
  cat_home_services: 'cat_home_maintenance', cat_transport_long: 'cat_transport_flights',
  cat_life: 'cat_fun', cat_life_health: 'cat_health_doctor', cat_life_wellness: 'cat_care_spa', cat_life_fitness: 'cat_care_fitness',
  cat_life_events: 'cat_fun_events', cat_life_holiday: 'cat_travel_hotel', cat_life_streaming: 'cat_subs_streaming', cat_life_education: 'cat_edu_courses',
  cat_comm: 'cat_subs', cat_comm_internet: 'cat_home_internet', cat_comm_phone: 'cat_subs_phone', cat_comm_software: 'cat_subs_cloud',
  cat_invest_savings: 'cat_invest', cat_invest_financial: 'cat_invest',
};
/** Nomi della versione 1 delle categorie rimaste: si aggiornano solo se l'utente non li ha cambiati. */
const OLD_NAMES: Record<string, string> = {
  cat_food_restaurant: 'Ristorante, fast-food', cat_food_bar: 'Bar, caffè', cat_food_groceries: 'Spesa alimentare', cat_shop_electronics: 'Elettronica, accessori',
  cat_shop_home: 'Casa e giardino', cat_home: 'Abitazione', cat_home_energy: 'Energia, utenze', cat_home_maintenance: 'Manutenzione, riparazioni',
  cat_transport_taxi: 'Taxi', cat_transport_public: 'Trasporto pubblico', cat_vehicle_fuel: 'Carburante', cat_vehicle_maintenance: 'Manutenzione veicolo',
  cat_vehicle_parking: 'Parcheggio', cat_fin: 'Spese finanziarie', cat_fin_fees: 'Commissioni', cat_fin_loans: 'Prestiti, interessi', cat_invest: 'Investimenti',
  cat_income_salary: 'Stipendio, fatture', cat_income_interest: 'Interessi, dividendi',
};

const PRESETS: Array<{ id: string; name: string; priority: number; definition: RuleDefinition }> = [
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
 * Porta un account con le categorie della versione 1 alla versione 2: aggiunge le nuove, sposta movimenti,
 * regole e sottocategorie personali da quelle ritirate e le cancella. Le categorie create dall'utente restano.
 */
export async function upgradeCatalog(db: D1Database, userId: string): Promise<void> {
  const row = await db.prepare('SELECT catalog_version AS v FROM users WHERE id = ?').bind(userId).first<{ v: number }>();
  if (!row || row.v >= CATALOG_VERSION) return;
  const existing = new Map((await db.prepare('SELECT id, name FROM categories WHERE user_id = ?').bind(userId).all<{ id: string; name: string }>()).results
    .map((r) => [r.id, r.name]));
  const sid = (base: string) => seedId(base, userId);
  const stmts: D1PreparedStatement[] = [];
  let pos = 0;
  for (const p of TREE) {
    const off = p.optional ? 1 : 0;
    for (const [id, name, nature, parent] of [[p.id, p.name, p.nature, null] as const, ...p.children.map(([i, n, nat]) => [i, n, nat, p.id] as const)]) {
      if (existing.has(sid(id))) {
        const rename = OLD_NAMES[id] && existing.get(sid(id)) === OLD_NAMES[id];
        stmts.push(db.prepare('UPDATE categories SET name = ?, parent_id = ?, color = ?, icon = ?, position = ? WHERE id = ?')
          .bind(rename ? name : existing.get(sid(id)), parent ? sid(parent) : null, p.color, p.icon, pos++, sid(id)));
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
  stmts.push(db.prepare('UPDATE users SET catalog_version = ? WHERE id = ?').bind(CATALOG_VERSION, userId));
  await runBatch(db, stmts);
}
