// Motore delle regole: condizioni su merchant, importo, app, ora; fasce di importo con azioni diverse.

export type Nature = 'must' | 'need' | 'want';

export type ConditionField = 'merchant' | 'text' | 'app' | 'currency' | 'account' | 'amount_eur' | 'weekday' | 'hour' | 'source';
export type ConditionOp = 'contains' | 'not_contains' | 'equals' | 'starts' | 'regex' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'in';

export interface Condition {
  field: ConditionField;
  op: ConditionOp;
  value: string | number | Array<string | number>;
  value2?: number;
}

export interface RuleActions {
  category_id?: string;
  labels?: string[];
  nature?: Nature;
  merchant?: string;
  account_id?: string;
  ask?: string[];
  ignore?: boolean;
  review?: boolean;
}

/** Fascia di importo in euro: min incluso, max escluso. */
export interface Band {
  min?: number;
  max?: number;
  actions: RuleActions;
}

export interface RuleDefinition {
  conditions: Condition[];
  actions: RuleActions;
  bands?: Band[];
  /** Regola predefinita "morbida": vale solo se l'utente non ha già scelto una categoria per quel negozio. */
  soft?: boolean;
}

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  definition: RuleDefinition;
}

export interface RuleInput {
  merchant: string | null;
  merchant_raw: string | null;
  text: string | null;
  app: string | null;
  currency: string;
  account_id: string | null;
  amount_eur: number;
  occurred_at: string;
  source: string;
}

export interface RuleResult {
  category_id?: string;
  labels: string[];
  nature?: Nature;
  merchant?: string;
  account_id?: string;
  ask?: string[];
  ignore: boolean;
  review: boolean;
  matched: string[];
}

function fieldValue(input: RuleInput, field: ConditionField): string | number | null {
  // occurred_at conserva il fuso del telefono: giorno e ora si leggono dalla stringa.
  const d = new Date(`${input.occurred_at.slice(0, 10)}T00:00:00Z`);
  switch (field) {
    case 'merchant':
      return [input.merchant, input.merchant_raw].filter(Boolean).join(' | ');
    case 'text':
      return input.text;
    case 'app':
      return input.app;
    case 'currency':
      return input.currency;
    case 'account':
      return input.account_id;
    case 'amount_eur':
      return Math.abs(input.amount_eur);
    case 'weekday':
      return ((d.getUTCDay() + 6) % 7) + 1;
    case 'hour':
      return Number(input.occurred_at.slice(11, 13));
    case 'source':
      return input.source;
  }
}

export function matchCondition(c: Condition, input: RuleInput): boolean {
  const v = fieldValue(input, c.field);
  if (v == null) return c.op === 'not_contains';
  if (['lt', 'lte', 'gt', 'gte', 'between'].includes(c.op)) {
    const n = Number(v);
    const a = Number(c.value);
    if (c.op === 'lt') return n < a;
    if (c.op === 'lte') return n <= a;
    if (c.op === 'gt') return n > a;
    if (c.op === 'gte') return n >= a;
    return n >= a && n < Number(c.value2);
  }
  const s = String(v).toLowerCase();
  if (c.op === 'in') return (Array.isArray(c.value) ? c.value : [c.value]).some((x) => String(x).toLowerCase() === s);
  const target = String(c.value).toLowerCase();
  if (c.op === 'contains') return s.includes(target);
  if (c.op === 'not_contains') return !s.includes(target);
  if (c.op === 'equals') return s === target;
  if (c.op === 'starts') return s.startsWith(target);
  if (c.op === 'regex') {
    try {
      return new RegExp(String(c.value), 'i').test(String(v));
    } catch {
      return false;
    }
  }
  return false;
}

export function ruleMatches(rule: Rule, input: RuleInput): boolean {
  return rule.enabled && rule.definition.conditions.every((c) => matchCondition(c, input));
}

export function bandFor(bands: Band[] | undefined, amountEur: number): Band | null {
  if (!bands?.length) return null;
  const a = Math.abs(amountEur);
  return bands.find((b) => (b.min == null || a >= b.min) && (b.max == null || a < b.max)) ?? null;
}

/**
 * Applica le regole in ordine di priorità. Il primo valore impostato vince per categoria,
 * natura, nome e conto; le etichette si sommano. Una regola che rinomina il merchant
 * è vista dalle regole successive.
 */
export function evaluateRules(rules: Rule[], original: RuleInput): RuleResult {
  const input = { ...original };
  const out: RuleResult = { labels: [], ignore: false, review: false, matched: [] };
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (!ruleMatches(rule, input)) continue;
    out.matched.push(rule.id);
    const band = bandFor(rule.definition.bands, input.amount_eur);
    const actions: RuleActions = { ...rule.definition.actions, ...(band?.actions ?? {}) };
    if (actions.merchant && !out.merchant) {
      out.merchant = actions.merchant;
      input.merchant = actions.merchant;
    }
    if (actions.ask?.length && !out.category_id && !out.ask) out.ask = actions.ask;
    if (actions.category_id && !out.category_id && !out.ask) out.category_id = actions.category_id;
    if (actions.nature && !out.nature) out.nature = actions.nature;
    if (actions.account_id && !out.account_id) out.account_id = actions.account_id;
    if (actions.labels) for (const l of actions.labels) if (!out.labels.includes(l)) out.labels.push(l);
    if (actions.ignore) out.ignore = true;
    if (actions.review) out.review = true;
  }
  return out;
}
