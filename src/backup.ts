// Backup locali: il file si compone e si legge qui nel browser, il server lavora a pagine.
import { api } from './api';

export const TABLE_ORDER = ['settings', 'accounts', 'categories', 'labels', 'rules', 'parsers', 'devices', 'transactions', 'transaction_labels', 'captures', 'favorites', 'capture_sources', 'budgets', 'trips', 'trip_items', 'recurring', 'card_settings', 'merchant_aliases'] as const;
type Row = Record<string, unknown>;

export interface Backup {
  format: 'ledgy-backup';
  version: number;
  exported_at: string;
  tables: Record<string, Row[]>;
}

export type Progress = (label: string) => void;

const TABLE_LABEL: Record<string, string> = {
  settings: 'impostazioni', accounts: 'conti', categories: 'categorie', labels: 'etichette', rules: 'regole', parsers: 'lettori',
  devices: 'telefoni', transactions: 'movimenti', transaction_labels: 'etichette dei movimenti', captures: 'notifiche ricevute', favorites: 'preferiti', capture_sources: 'carte riconosciute', budgets: 'budget', trips: 'viaggi', trip_items: 'movimenti dei viaggi', recurring: 'spese ricorrenti', card_settings: 'ricarichi delle carte', merchant_aliases: 'nomi dei negozi uniti',
};

export async function exportBackup(onProgress: Progress = () => {}): Promise<Backup> {
  const tables: Record<string, Row[]> = {};
  for (const t of TABLE_ORDER) {
    const rows: Row[] = [];
    let after = 0;
    for (;;) {
      const r = await api<{ rows: Row[]; next: number | null }>(`/backup/export?table=${t}&after=${after}&limit=1000`);
      rows.push(...r.rows);
      onProgress(`Lettura ${TABLE_LABEL[t]}: ${rows.length}`);
      if (r.next == null) break;
      after = r.next;
    }
    tables[t] = rows;
  }
  return { format: 'ledgy-backup', version: 1, exported_at: new Date().toISOString(), tables };
}

export function downloadFile(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** CSV con separatore ";" come quello di Wallet, importi in unità (non millesimi). */
export function backupToCsv(b: Backup): string {
  const cats = new Map(b.tables.categories.map((c) => [c.id as string, c]));
  const accs = new Map(b.tables.accounts.map((a) => [a.id as string, a.name as string]));
  const labelName = new Map(b.tables.labels.map((l) => [l.id as string, l.name as string]));
  const labelsOf = new Map<string, string[]>();
  for (const tl of b.tables.transaction_labels) {
    const k = tl.transaction_id as string;
    labelsOf.set(k, [...(labelsOf.get(k) ?? []), labelName.get(tl.label_id as string) ?? '']);
  }
  const cols = ['data', 'tipo', 'conto', 'importo', 'valuta', 'importo_eur', 'tasso', 'merchant', 'testo_originale', 'categoria', 'categoria_madre', 'natura', 'nota', 'carta', 'fonte', 'stato', 'etichette'];
  const esc = (v: unknown) => {
    if (v == null) return '';
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(';')];
  const txs = b.tables.transactions.filter((t) => !t.deleted_at).sort((x, y) => String(x.occurred_utc).localeCompare(String(y.occurred_utc)));
  for (const t of txs) {
    const cat = cats.get(t.category_id as string);
    const parent = cat?.parent_id ? cats.get(cat.parent_id as string) : null;
    lines.push([
      t.occurred_at, t.type, accs.get(t.account_id as string) ?? '', (Number(t.amount) / 1000).toString(), t.currency,
      (Number(t.amount_eur) / 1000).toFixed(2), t.fx_rate ?? '', t.merchant, t.merchant_raw, cat?.name ?? '', parent?.name ?? '',
      t.nature, t.note, t.card, t.source, t.status, (labelsOf.get(t.id as string) ?? []).join('|'),
    ].map(esc).join(';'));
  }
  return lines.join('\n');
}

export function parseBackup(text: string): Backup {
  let data: Backup;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Il file non è un JSON valido');
  }
  if (data?.format !== 'ledgy-backup' || typeof data.tables !== 'object') throw new Error('Questo file non è un backup di Ledgy');
  for (const t of TABLE_ORDER) if (!Array.isArray(data.tables[t])) data.tables[t] = [];
  return data;
}

export function summarize(b: Backup): string {
  const t = b.tables;
  return `${t.transactions.length} movimenti, ${t.accounts.length} conti, ${t.categories.length} categorie, ${t.rules.length} regole`;
}

export interface ImportResult { inserted: number; skipped: number }

async function sendAll(b: Backup, mode: 'merge' | 'replace', onProgress: Progress): Promise<ImportResult> {
  await api('/backup/import/begin', { method: 'POST', json: { mode, format: b.format, version: b.version } });
  const maps: Record<string, Record<string, string>> = {};
  const total: ImportResult = { inserted: 0, skipped: 0 };
  for (const table of TABLE_ORDER) {
    let rows = b.tables[table] ?? [];
    if (table === 'categories') rows = [...rows].sort((x, y) => (x.parent_id ? 1 : 0) - (y.parent_id ? 1 : 0));
    for (let i = 0; i < rows.length; i += 200) {
      const r = await api<ImportResult & { map?: Record<string, string> }>('/backup/import/chunk', {
        method: 'POST', json: { mode, table, rows: rows.slice(i, i + 200), maps },
      });
      if (r.map) maps[table] = { ...(maps[table] ?? {}), ...r.map };
      total.inserted += r.inserted;
      total.skipped += r.skipped;
      onProgress(`Scrittura ${TABLE_LABEL[table]}: ${Math.min(i + 200, rows.length)} di ${rows.length}`);
    }
  }
  return total;
}

/**
 * Importa un backup. "merge" aggiunge ai dati attuali senza toccare ciò che esiste già;
 * "replace" cancella i dati attuali e mette quelli del backup. In "replace", se qualcosa
 * va storto a metà, rimette i dati di prima (copiati in memoria all'inizio).
 */
export async function importBackup(b: Backup, mode: 'merge' | 'replace', onProgress: Progress = () => {}): Promise<ImportResult> {
  if (mode === 'merge') return sendAll(b, 'merge', onProgress);
  onProgress('Copia di sicurezza dei dati attuali…');
  const before = await exportBackup(onProgress);
  try {
    return await sendAll(b, 'replace', onProgress);
  } catch (err) {
    onProgress('Errore: ripristino dei dati di prima…');
    try {
      await sendAll(before, 'replace', onProgress);
    } catch {
      downloadFile(`ledgy-copia-di-sicurezza-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(before), 'application/json');
      throw new Error(`Import non riuscito e ripristino non riuscito: ho scaricato la copia di sicurezza dei dati di prima. Dettaglio: ${(err as Error).message}`);
    }
    throw new Error(`Import non riuscito, i dati di prima sono stati ripristinati. Dettaglio: ${(err as Error).message}`);
  }
}
