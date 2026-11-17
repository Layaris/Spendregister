// Import da Wallet by BudgetBakers (API REST ufficiale, https://rest.budgetbakers.com/wallet).
// Qui solo la parte pura: categoria di Ledgy suggerita per ogni categoria di Wallet e movimento convertito.
import { categoryFromKeywords } from './keywords';

export interface WalletAmount { value: number; currencyCode: string }
export interface WalletCategory {
  id: string;
  name: string;
  parentId?: string | null;
  parentName?: string | null;
  group?: { id?: string; name?: string } | null;
  customCategory?: boolean;
  archived?: boolean;
}
export interface WalletAccount {
  id: string;
  name: string;
  accountType?: string;
  currencyCode?: string;
  archived?: boolean;
  balance?: { currentBalance?: number; rawCurrentBalance?: number; currencyCode?: string } | null;
}
export interface WalletLabel { id: string; name: string; color?: string | null; archived?: boolean }
export interface WalletRecord {
  id: string;
  accountId?: string | null;
  amount: WalletAmount;
  convertedAmount?: { value?: number; currencyCode?: string; ratio?: number; error?: string } | null;
  recordDate: string;
  recordType?: 'income' | 'expense';
  recordState?: string;
  category?: { id?: string; name?: string } | null;
  counterParty?: string | null;
  note?: string | null;
  labels?: Array<{ id: string; name: string }> | null;
  place?: { name?: string | null; latitude?: number; longitude?: number } | null;
  transfer?: { transferId?: string; type?: string } | null;
}

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Categorie predefinite di Wallet (inglese e italiano) → categorie di Ledgy, in ordine di preferenza:
 * se la prima è spenta (gruppi facoltativi come Regali o Animali) si usa la successiva.
 */
const EXPENSE: Array<[string[], string[]]> = [
  [['Food & Drinks', 'Cibo e bevande'], ['cat_food']],
  [['Bar, cafe', 'Bar, café', 'Bar, caffè'], ['cat_food_bar']],
  [['Groceries', 'Spesa alimentare', 'Generi alimentari'], ['cat_food_groceries']],
  [['Restaurant, fast-food', 'Ristorante, fast-food'], ['cat_food_restaurant']],
  [['Shopping', 'Acquisti'], ['cat_shop']],
  [['Clothes & shoes', 'Abbigliamento e scarpe'], ['cat_shop_clothes']],
  [['Drug-store, chemist', 'Farmacia'], ['cat_health_pharmacy']],
  [['Electronics, accessories', 'Elettronica, accessori'], ['cat_shop_electronics']],
  [['Free time', 'Tempo libero'], ['cat_shop_hobby']],
  [['Gifts, joy', 'Regali'], ['cat_gifts_gifts', 'cat_shop_other']],
  [['Health and beauty', 'Salute e bellezza'], ['cat_care_cosmetics']],
  [['Home, garden', 'Casa e giardino'], ['cat_shop_home']],
  [['Jewels, accessories', 'Gioielli, accessori'], ['cat_shop_clothes']],
  [['Kids', 'Bambini'], ['cat_family_kids', 'cat_shop_other']],
  [['Pets, animals', 'Animali'], ['cat_pets_food', 'cat_shop_other']],
  [['Stationery, tools', 'Cancelleria, attrezzi'], ['cat_shop_other']],
  [['Acquisti online', 'Online shopping'], ['cat_shop_other']],
  [['Housing', 'Abitazione'], ['cat_home']],
  [['Energy, utilities', 'Energia, utenze'], ['cat_home_energy']],
  [['Maintenance, repairs', 'Manutenzione, riparazioni'], ['cat_home_maintenance']],
  [['Mortgage', 'Mutuo'], ['cat_home_rent']],
  [['Property insurance', 'Assicurazione casa'], ['cat_fin_insurance']],
  [['Rent', 'Affitto'], ['cat_home_rent']],
  [['Services', 'Servizi'], ['cat_home_maintenance']],
  [['Transportation', 'Trasporti'], ['cat_transport']],
  [['Business trips', 'Viaggi di lavoro'], ['cat_work_other', 'cat_transport']],
  [['Long distance', 'Viaggi lunghi, voli', 'Lunga distanza'], ['cat_transport_flights']],
  [['Public transport', 'Trasporto pubblico'], ['cat_transport_public']],
  [['Taxi'], ['cat_transport_taxi']],
  [['Vehicle', 'Veicoli', 'Veicolo'], ['cat_vehicle']],
  [['Fuel', 'Carburante'], ['cat_vehicle_fuel']],
  [['Leasing'], ['cat_vehicle_rent']],
  [['Parking', 'Parcheggio'], ['cat_vehicle_parking']],
  [['Rentals', 'Noleggio'], ['cat_vehicle_rent']],
  [['Vehicle insurance', 'Assicurazione veicolo'], ['cat_vehicle_insurance']],
  [['Vehicle maintenance', 'Manutenzione veicolo'], ['cat_vehicle_maintenance']],
  [['Life & Entertainment', 'Vita e intrattenimento'], ['cat_fun']],
  [['Active sport, fitness', 'Sport, fitness'], ['cat_care_fitness']],
  [['Alcohol, tobacco', 'Alcol, tabacco'], ['cat_food_drinks']],
  [['Books, audio, subscriptions', 'Libri, audio, abbonamenti'], ['cat_edu_books']],
  [['Charity, gifts', 'Beneficenza, regali'], ['cat_gifts_charity', 'cat_shop_other']],
  [['Culture, sport events', 'Cultura, eventi'], ['cat_fun_events']],
  [['Education, development', 'Formazione'], ['cat_edu_courses']],
  [['Health care, doctor', 'Assistenza sanitaria, medico'], ['cat_health_doctor']],
  [['Hobbies', 'Hobby'], ['cat_shop_hobby']],
  [['Holiday, trips, hotels', 'Vacanze, hotel'], ['cat_travel_hotel']],
  [['Life events', 'Eventi della vita'], ['cat_fun']],
  [['Lottery, gambling', 'Lotteria, giochi d\'azzardo'], ['cat_fun_games']],
  [['TV, Streaming', 'TV, streaming'], ['cat_subs_streaming']],
  [['Wellness, beauty', 'Benessere, bellezza'], ['cat_care_spa']],
  [['Communication, PC', 'Comunicazione, PC'], ['cat_subs']],
  [['Internet'], ['cat_home_internet']],
  [['Phone, cell phone', 'Telefono, cellulare'], ['cat_subs_phone']],
  [['Postal services', 'Servizi postali'], ['cat_shop_other']],
  [['Software, apps, games', 'Software, app, giochi'], ['cat_subs_cloud']],
  [['Financial expenses', 'Spese finanziarie'], ['cat_fin']],
  [['Advisory', 'Consulenza'], ['cat_work_professional']],
  [['Charges, Fees', 'Commissioni'], ['cat_fin_fees']],
  [['Child Support', 'Mantenimento figli'], ['cat_family_kids', 'cat_fin']],
  [['Fines', 'Multe'], ['cat_fin_fines']],
  [['Insurances', 'Insurance', 'Assicurazioni'], ['cat_fin_insurance']],
  [['Loan, interests', 'Prestiti, interessi'], ['cat_fin_loans']],
  [['Taxes', 'Tasse'], ['cat_fin_taxes']],
  [['Investments', 'Investimenti', 'Collections', 'Collezioni', 'Financial investments', 'Investimenti finanziari', 'Realty', 'Immobili',
    'Savings', 'Risparmi', 'Vehicles, chattels', 'Veicoli, beni mobili'], ['cat_invest']],
  [['Others', 'Altro', 'Missing', 'Mancante', 'Unknown', 'Sconosciuta'], ['cat_other']],
];
const INCOME: Array<[string[], string[]]> = [
  [['Income', 'Entrate', 'Checks, coupons', 'Assegni, buoni', 'Dues & grants', 'Contributi e sovvenzioni', 'Lottery, gambling',
    'Child Support', 'Mantenimento figli', 'Others', 'Altro'], ['cat_income_other']],
  [['Gifts', 'Regali ricevuti', 'Regali'], ['cat_income_gifts']],
  [['Interests, dividends', 'Interessi, dividendi'], ['cat_income_interest']],
  [['Lending, renting', 'Prestiti, affitti', 'Rental income', 'Affitti ricevuti'], ['cat_income_rent']],
  [['Refunds (tax, purchase)', 'Rimborsi'], ['cat_income_refund']],
  [['Sale', 'Vendite'], ['cat_income_sales']],
  [['Wage, invoices', 'Stipendio, fatture'], ['cat_income_salary']],
];
const table = (rows: Array<[string[], string[]]>) => new Map(rows.flatMap(([names, ids]) => names.map((n) => [norm(n), ids] as const)));
const EXPENSE_MAP = table(EXPENSE);
const INCOME_MAP = table(INCOME);

/** Gruppi principali di Wallet (slug dell'API) → gruppo di Ledgy, quando il nome non dice nulla. */
const GROUPS: Record<string, string> = {
  food_and_drinks: 'cat_food', shopping: 'cat_shop', housing: 'cat_home', transportation: 'cat_transport', vehicle: 'cat_vehicle',
  life_and_entertainment: 'cat_fun', life_entertainment: 'cat_fun', communication_pc: 'cat_subs', financial_expenses: 'cat_fin',
  investments: 'cat_invest', income: 'cat_income_other', others: 'cat_other',
};

/**
 * Categorie di Ledgy (id di base) da provare per una categoria di Wallet, in ordine.
 * Nome noto → gruppo della categoria personale → parole chiave → gruppo di Wallet → Altro.
 */
export function walletCategoryCandidates(c: Pick<WalletCategory, 'name' | 'parentName' | 'group'>): string[] {
  const income = c.group?.id === 'income' || norm(c.group?.name ?? '') === 'income' || norm(c.group?.name ?? '') === 'entrate';
  const map = income ? INCOME_MAP : EXPENSE_MAP;
  const out: string[] = [];
  const add = (ids: readonly string[] | undefined | null) => { for (const id of ids ?? []) if (!out.includes(id)) out.push(id); };
  add(map.get(norm(c.name)) ?? (income ? EXPENSE_MAP.get(norm(c.name)) : INCOME_MAP.get(norm(c.name))));
  const words = categoryFromKeywords(income ? 'income' : 'expense', c.name);
  if (words) add([words]);
  if (c.parentName) add(map.get(norm(c.parentName)));
  const g = c.group?.id ? GROUPS[c.group.id] : undefined;
  if (g) add([g]);
  add([income ? 'cat_income_other' : 'cat_other']);
  return out;
}

export const toMilli = (value: number) => Math.round(value * 1000);

/** Tipo, importo con segno e controvalore in euro (se Wallet lo dà) di un movimento di Wallet. */
export function walletAmounts(r: WalletRecord): { type: 'expense' | 'income' | 'transfer'; amount: number; currency: string; amount_eur: number | null } {
  const raw = toMilli(r.amount.value);
  const kind: 'expense' | 'income' = r.recordType ?? (raw < 0 ? 'expense' : 'income');
  const amount = r.transfer ? raw : kind === 'expense' ? -Math.abs(raw) : Math.abs(raw);
  const currency = (r.amount.currencyCode || 'EUR').toUpperCase();
  let eur: number | null = null;
  if (currency === 'EUR') eur = amount;
  else if (r.convertedAmount && !r.convertedAmount.error && r.convertedAmount.currencyCode === 'EUR' && typeof r.convertedAmount.value === 'number') {
    eur = Math.sign(amount) * Math.abs(toMilli(r.convertedAmount.value));
  }
  return { type: r.transfer ? 'transfer' : kind, amount, currency, amount_eur: eur };
}

/** Movimenti da non portare: annullati o in attesa di assegnazione. */
export const skipWalletRecord = (r: WalletRecord) => r.recordState === 'void' || r.recordState === 'waitForAssign';
