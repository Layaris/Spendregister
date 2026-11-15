// Dati iniziali: categorie in stile Wallet, un conto e le regole pronte per l'Indonesia.
import type { RuleDefinition } from '../shared/rules';
import { nowIso, runBatch } from './lib';

type Nat = 'must' | 'need' | 'want' | null;

const TREE: Array<{ id: string; name: string; color: string; icon: string; kind: 'expense' | 'income'; nature: Nat; children: Array<[string, string, Nat]> }> = [
  { id: 'cat_food', name: 'Cibo e bevande', color: '#D9663F', icon: 'food', kind: 'expense', nature: 'need', children: [
    ['cat_food_restaurant', 'Ristorante, fast-food', 'want'], ['cat_food_bar', 'Bar, caffè', 'want'], ['cat_food_groceries', 'Spesa alimentare', 'need'],
  ] },
  { id: 'cat_shop', name: 'Acquisti', color: '#7C5BC9', icon: 'bag', kind: 'expense', nature: 'want', children: [
    ['cat_shop_clothes', 'Abbigliamento e scarpe', 'want'], ['cat_shop_electronics', 'Elettronica, accessori', 'want'], ['cat_shop_home', 'Casa e giardino', 'need'],
    ['cat_shop_pharmacy', 'Farmacia', 'need'], ['cat_shop_beauty', 'Salute e bellezza', 'want'], ['cat_shop_gifts', 'Regali', 'want'], ['cat_shop_online', 'Acquisti online', 'want'],
  ] },
  { id: 'cat_home', name: 'Abitazione', color: '#C77A12', icon: 'home', kind: 'expense', nature: 'must', children: [
    ['cat_home_rent', 'Affitto', 'must'], ['cat_home_energy', 'Energia, utenze', 'must'], ['cat_home_maintenance', 'Manutenzione, riparazioni', 'need'], ['cat_home_services', 'Servizi', 'need'],
  ] },
  { id: 'cat_transport', name: 'Trasporti', color: '#3E6FBF', icon: 'car', kind: 'expense', nature: 'need', children: [
    ['cat_transport_taxi', 'Taxi', 'need'], ['cat_transport_public', 'Trasporto pubblico', 'need'], ['cat_transport_long', 'Viaggi lunghi, voli', 'want'],
  ] },
  { id: 'cat_vehicle', name: 'Veicoli', color: '#5D6B7A', icon: 'scooter', kind: 'expense', nature: 'need', children: [
    ['cat_vehicle_fuel', 'Carburante', 'need'], ['cat_vehicle_rent', 'Noleggio', 'need'], ['cat_vehicle_maintenance', 'Manutenzione veicolo', 'need'], ['cat_vehicle_parking', 'Parcheggio', 'need'],
  ] },
  { id: 'cat_life', name: 'Vita e intrattenimento', color: '#C2477F', icon: 'heart', kind: 'expense', nature: 'want', children: [
    ['cat_life_health', 'Assistenza sanitaria, medico', 'must'], ['cat_life_wellness', 'Benessere, bellezza', 'want'], ['cat_life_fitness', 'Sport, fitness', 'want'],
    ['cat_life_events', 'Cultura, eventi', 'want'], ['cat_life_holiday', 'Vacanze, hotel', 'want'], ['cat_life_streaming', 'TV, streaming', 'want'], ['cat_life_education', 'Formazione', 'need'],
  ] },
  { id: 'cat_comm', name: 'Comunicazione, PC', color: '#2F8FA8', icon: 'phone', kind: 'expense', nature: 'need', children: [
    ['cat_comm_internet', 'Internet', 'need'], ['cat_comm_phone', 'Telefono, cellulare', 'need'], ['cat_comm_software', 'Software, app, giochi', 'want'],
  ] },
  { id: 'cat_fin', name: 'Spese finanziarie', color: '#4E6E58', icon: 'bank', kind: 'expense', nature: 'must', children: [
    ['cat_fin_fees', 'Commissioni', 'must'], ['cat_fin_taxes', 'Tasse', 'must'], ['cat_fin_insurance', 'Assicurazioni', 'must'], ['cat_fin_loans', 'Prestiti, interessi', 'must'],
  ] },
  { id: 'cat_invest', name: 'Investimenti', color: '#8A6D3B', icon: 'chart', kind: 'expense', nature: null, children: [
    ['cat_invest_savings', 'Risparmi', null], ['cat_invest_financial', 'Investimenti finanziari', null],
  ] },
  { id: 'cat_income', name: 'Entrate', color: '#0B7A5B', icon: 'income', kind: 'income', nature: null, children: [
    ['cat_income_salary', 'Stipendio, fatture', null], ['cat_income_refund', 'Rimborsi', null], ['cat_income_gifts', 'Regali ricevuti', null],
    ['cat_income_interest', 'Interessi, dividendi', null], ['cat_income_sales', 'Vendite', null],
  ] },
  { id: 'cat_other', name: 'Altro', color: '#7D8790', icon: 'dots', kind: 'expense', nature: null, children: [] },
];

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
    actions: { category_id: 'cat_comm_phone', nature: 'need' },
  } },
];

export async function seedIfEmpty(db: D1Database): Promise<void> {
  const cats = await db.prepare('SELECT COUNT(*) AS n FROM categories').first<{ n: number }>();
  const stmts: D1PreparedStatement[] = [];
  if (!cats?.n) {
    let pos = 0;
    for (const p of TREE) {
      stmts.push(db.prepare('INSERT INTO categories (id, name, parent_id, kind, nature, color, icon, position) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)')
        .bind(p.id, p.name, p.kind, p.nature, p.color, p.icon, pos++));
      for (const [id, name, nature] of p.children) {
        stmts.push(db.prepare('INSERT INTO categories (id, name, parent_id, kind, nature, color, icon, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(id, name, p.id, p.kind, nature, p.color, p.icon, pos++));
      }
    }
    const now = nowIso();
    for (const r of PRESETS) {
      stmts.push(db.prepare('INSERT INTO rules (id, name, enabled, priority, definition, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?, ?)')
        .bind(r.id, r.name, r.priority, JSON.stringify(r.definition), now, now));
    }
  }
  const accounts = await db.prepare('SELECT COUNT(*) AS n FROM accounts').first<{ n: number }>();
  if (!accounts?.n) {
    stmts.push(db.prepare("INSERT INTO accounts (id, name, type, currency, initial_balance, position, created_at) VALUES ('acc_cash', 'Contanti', 'cash', 'EUR', 0, 0, ?)")
      .bind(nowIso()));
  }
  if (stmts.length) await runBatch(db, stmts);
}
