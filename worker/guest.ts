// Uso senza account: chi apre l'app riceve un account "ospite" (senza email) e può usarla subito,
// anche con la cattura dal telefono. Quando entra in un account esistente sceglie cosa fare dei dati.
import { runBatch } from './lib';

export type LoginChoice = 'account' | 'merge' | 'replace';
export type RegisterChoice = 'keep' | 'fresh';

export interface LocalData { transactions: number; devices: number }

/** Quanti dati ha l'ospite: se non ha nulla non serve chiedere niente. */
export async function localData(db: D1Database, userId: string): Promise<LocalData> {
  const r = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM transactions WHERE user_id = ?1 AND deleted_at IS NULL) AS transactions,
            (SELECT COUNT(*) FROM devices WHERE user_id = ?1 AND revoked_at IS NULL) AS devices`,
  ).bind(userId).first<LocalData>();
  return { transactions: r?.transactions ?? 0, devices: r?.devices ?? 0 };
}

export const hasData = (d: LocalData) => d.transactions + d.devices > 0;

const DATA_TABLES = ['card_settings', 'merchant_aliases', 'trip_items', 'trips', 'recurring', 'budgets', 'capture_sources', 'favorites', 'captures', 'transactions', 'rules', 'parsers', 'devices', 'labels', 'categories', 'accounts'];

/** Cancella tutti i dati di un account; con `andUser` anche sessioni e account. */
export function deleteUserStatements(db: D1Database, id: string, andUser = true): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM transaction_labels WHERE transaction_id IN (SELECT id FROM transactions WHERE user_id = ?)').bind(id),
    ...DATA_TABLES.map((t) => db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id)),
    ...(andUser ? [db.prepare('DELETE FROM ai_settings WHERE user_id = ?').bind(id), db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(id), db.prepare('DELETE FROM notify_queue WHERE user_id = ?').bind(id), db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id), db.prepare('DELETE FROM users WHERE id = ?').bind(id)] : []),
  ];
}

/** Copia le impostazioni dell'AI dall'ospite all'account, se l'account non le ha (sono configurazione, non dati: passano sempre). */
export function aiCopy(db: D1Database, from: string, to: string) {
  return db.prepare(`INSERT OR IGNORE INTO ai_settings (user_id, enabled, gemini_key, nanogpt_key, gemini_model, nanogpt_model, updated_at)
                     SELECT ?, enabled, gemini_key, nanogpt_key, gemini_model, nanogpt_model, updated_at FROM ai_settings WHERE user_id = ?`).bind(to, from);
}

/** I dati iniziali hanno l'id con il suffisso dell'account: cat_food~usr_a ↔ cat_food~usr_b. */
function swap(id: string, from: string, to: string): string {
  return id.endsWith(`~${from}`) ? `${id.slice(0, -from.length - 1)}~${to}` : id;
}

interface Cat { id: string; name: string; parent_id: string | null; kind: string }
interface Named { id: string; name: string }
interface RuleRow { id: string; definition: string }

/**
 * Porta i dati dell'ospite `g` nell'account `a`:
 * - account: tiene solo i dati dell'account, quelli dell'ospite si cancellano;
 * - replace: i dati dell'account si cancellano e al loro posto vanno quelli dell'ospite;
 * - merge: si sommano; categorie, conti, etichette e regole uguali (stesso id iniziale o stesso nome) si uniscono.
 * I telefoni collegati dall'ospite passano all'account e continuano a funzionare.
 */
export async function adoptGuest(db: D1Database, g: string, a: string, mode: LoginChoice): Promise<void> {
  // Le notifiche attivate su questo telefono restano attive anche dopo l'accesso, in ogni caso.
  const pushMove = db.prepare('UPDATE push_subscriptions SET user_id = ? WHERE user_id = ?').bind(a, g);
  if (mode === 'account') return runBatch(db, [aiCopy(db, g, a), pushMove, ...deleteUserStatements(db, g)]);
  const move = (t: string) => db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).bind(a, g);
  if (mode === 'replace') {
    return runBatch(db, [
      ...deleteUserStatements(db, a, false),
      ...DATA_TABLES.slice().reverse().map(move), // prima conti e categorie, poi chi li usa
      aiCopy(db, g, a),
      pushMove,
      ...deleteUserStatements(db, g),
    ]);
  }

  const all = <T>(sql: string, id: string) => db.prepare(sql).bind(id).all<T>().then((r) => r.results);
  const [gCats, aCats, gAcc, aAcc, gLab, aLab, gRules, aRules] = await Promise.all([
    all<Cat>('SELECT id, name, parent_id, kind FROM categories WHERE user_id = ? ORDER BY parent_id IS NOT NULL', g),
    all<Cat>('SELECT id, name, parent_id, kind FROM categories WHERE user_id = ?', a),
    all<Named>('SELECT id, name FROM accounts WHERE user_id = ?', g),
    all<Named>('SELECT id, name FROM accounts WHERE user_id = ?', a),
    all<Named>('SELECT id, name FROM labels WHERE user_id = ?', g),
    all<Named>('SELECT id, name FROM labels WHERE user_id = ?', a),
    all<RuleRow>('SELECT id, definition FROM rules WHERE user_id = ?', g),
    all<RuleRow>('SELECT id, definition FROM rules WHERE user_id = ?', a),
  ]);
  const norm = (s: string) => s.trim().toLowerCase();
  const stmts: D1PreparedStatement[] = [];

  // Categorie: stesso id iniziale, oppure stesso nome, tipo e categoria madre.
  const aCatIds = new Set(aCats.map((c) => c.id));
  const aCatName = new Map(aCats.map((c) => [c.id, c.name]));
  const catKey = (kind: string, parentName: string, name: string) => `${kind}|${norm(parentName)}|${norm(name)}`;
  const aCatByKey = new Map(aCats.map((c) => [catKey(c.kind, c.parent_id ? aCatName.get(c.parent_id) ?? '' : '', c.name), c.id]));
  const gCatName = new Map(gCats.map((c) => [c.id, c.name]));
  const catMap = new Map<string, string>();
  for (const c of gCats) {
    const same = swap(c.id, g, a);
    const target = (same !== c.id && aCatIds.has(same) ? same : null)
      ?? aCatByKey.get(catKey(c.kind, c.parent_id ? gCatName.get(c.parent_id) ?? '' : '', c.name));
    if (target) catMap.set(c.id, target);
    else stmts.push(db.prepare('UPDATE categories SET user_id = ?, parent_id = ? WHERE id = ?')
      .bind(a, c.parent_id ? catMap.get(c.parent_id) ?? c.parent_id : null, c.id));
  }

  // Conti ed etichette: stesso id iniziale o stesso nome.
  const byName = (gRows: Named[], aRows: Named[], table: string) => {
    const ids = new Set(aRows.map((r) => r.id));
    const names = new Map(aRows.map((r) => [norm(r.name), r.id]));
    const map = new Map<string, string>();
    for (const r of gRows) {
      const same = swap(r.id, g, a);
      const target = (same !== r.id && ids.has(same) ? same : null) ?? names.get(norm(r.name));
      if (target) map.set(r.id, target);
      else stmts.push(db.prepare(`UPDATE ${table} SET user_id = ? WHERE id = ?`).bind(a, r.id));
    }
    return map;
  };
  const accMap = byName(gAcc, aAcc, 'accounts');
  const labMap = byName(gLab, aLab, 'labels');

  // Regole: quelle iniziali che l'account ha già si uniscono; le altre passano, con categorie e conti tradotti.
  const ids = new Map([...catMap, ...accMap]);
  const translate = (json: string) => json.replace(/"([^"\\]+)"/g, (m, s: string) => (ids.has(s) ? `"${ids.get(s)}"` : m));
  const aRuleIds = new Set(aRules.map((r) => r.id));
  const ruleMap = new Map<string, string>();
  for (const r of gRules) {
    const same = swap(r.id, g, a);
    if (same !== r.id && aRuleIds.has(same)) ruleMap.set(r.id, same);
    else stmts.push(db.prepare('UPDATE rules SET user_id = ?, definition = ? WHERE id = ?').bind(a, translate(r.definition), r.id));
  }

  // Movimenti: categorie, scelte "chiedimi", conti, regole ed etichette tradotti, poi passano all'account.
  for (const [from, to] of catMap) {
    stmts.push(db.prepare('UPDATE transactions SET category_id = ? WHERE user_id = ? AND category_id = ?').bind(to, g, from));
    stmts.push(db.prepare("UPDATE transactions SET review_choices = replace(review_choices, ?, ?) WHERE user_id = ? AND instr(review_choices, ?) > 0")
      .bind(`"${from}"`, `"${to}"`, g, `"${from}"`));
  }
  for (const [from, to] of accMap) stmts.push(db.prepare('UPDATE transactions SET account_id = ? WHERE user_id = ? AND account_id = ?').bind(to, g, from));
  for (const [from, to] of ruleMap) {
    stmts.push(db.prepare('UPDATE transactions SET rule_ids = replace(rule_ids, ?, ?) WHERE user_id = ? AND instr(rule_ids, ?) > 0').bind(`"${from}"`, `"${to}"`, g, `"${from}"`));
  }
  for (const [from, to] of labMap) {
    stmts.push(db.prepare('UPDATE OR IGNORE transaction_labels SET label_id = ? WHERE label_id = ?').bind(to, from));
  }
  // Un movimento con lo stesso id esterno (es. importato due volte da Wallet) resta all'ospite e si cancella.
  stmts.push(db.prepare('UPDATE OR IGNORE transactions SET user_id = ? WHERE user_id = ?').bind(a, g));
  for (const t of ['devices', 'parsers', 'captures']) stmts.push(move(t));
  // Chiavi dell'AI: passano all'account solo se l'account non ne ha già.
  stmts.push(aiCopy(db, g, a));
  // Preferiti: con categorie e conti tradotti come i movimenti.
  for (const [from, to] of catMap) stmts.push(db.prepare('UPDATE favorites SET category_id = ? WHERE user_id = ? AND category_id = ?').bind(to, g, from));
  for (const [from, to] of accMap) stmts.push(db.prepare('UPDATE favorites SET account_id = ? WHERE user_id = ? AND account_id = ?').bind(to, g, from));
  stmts.push(move('favorites'));
  // Carte riconosciute: se l'account ne ha già una per la stessa fonte vince quella dell'account.
  for (const [from, to] of accMap) {
    stmts.push(db.prepare('UPDATE capture_sources SET account_id = ? WHERE user_id = ? AND account_id = ?').bind(to, g, from));
    stmts.push(db.prepare('UPDATE recurring SET account_id = ? WHERE user_id = ? AND account_id = ?').bind(to, g, from));
  }
  stmts.push(db.prepare('UPDATE OR IGNORE capture_sources SET user_id = ? WHERE user_id = ?').bind(a, g));
  // Budget e spese ricorrenti: categorie tradotte; se l'account ne ha già uno uguale vince quello dell'account. Viaggi: passano.
  for (const [from, to] of catMap) {
    stmts.push(db.prepare('UPDATE OR IGNORE budgets SET category_id = ? WHERE user_id = ? AND category_id = ?').bind(to, g, from));
    stmts.push(db.prepare('UPDATE recurring SET category_id = ? WHERE user_id = ? AND category_id = ?').bind(to, g, from));
  }
  for (const t of ['budgets', 'recurring']) stmts.push(db.prepare(`UPDATE OR IGNORE ${t} SET user_id = ? WHERE user_id = ?`).bind(a, g));
  for (const t of ['trips', 'trip_items']) stmts.push(move(t));
  // Ricarichi delle carte e nomi uniti dei negozi: se l'account ne ha già uno uguale vince quello dell'account.
  for (const t of ['card_settings', 'merchant_aliases']) stmts.push(db.prepare(`UPDATE OR IGNORE ${t} SET user_id = ? WHERE user_id = ?`).bind(a, g));
  stmts.push(pushMove);
  stmts.push(...deleteUserStatements(db, g));
  await runBatch(db, stmts);
}
