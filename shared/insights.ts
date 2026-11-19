// Avvisi calcolati sia dal server sia dall'app (copia locale dei dati).

/** Il testo lo compone l'app (valuta di visualizzazione): qui solo i dati. */
export interface Alert { id: string; kind: 'unusual' | 'duplicate' | 'fees' | 'budget' | 'capture_silent'; days?: number; device?: string; tx?: string; amount?: number; avg?: number; merchant?: string | null; category_id?: string; pct?: number; cards?: Array<{ card: string; total: number }> }

interface DupRow { id: string; merchant: string | null; amount: number; currency: string; type: string; amount_eur: number; occurred_utc: string }

/** Coppie con stesso importo, valuta, tipo e negozio a meno di un'ora; avvisa sul più recente (al massimo 5). */
export function findDuplicates(rows: DupRow[], from: string): Alert[] {
  const out: Alert[] = [];
  const sorted = [...rows].sort((a, b) => a.occurred_utc.localeCompare(b.occurred_utc) || a.id.localeCompare(b.id));
  for (let i = 0; i < sorted.length && out.length < 5; i++) {
    const b = sorted[i];
    const tb = Date.parse(b.occurred_utc);
    for (let j = i - 1; j >= 0; j--) {
      const a = sorted[j];
      if (tb - Date.parse(a.occurred_utc) >= 3600_000) break;
      if (a.amount !== b.amount || a.currency !== b.currency || a.type !== b.type) continue;
      if ((a.merchant ?? '').toLowerCase() !== (b.merchant ?? '').toLowerCase()) continue;
      if (a.occurred_utc.slice(0, 10) < from && b.occurred_utc.slice(0, 10) < from) continue;
      const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      out.push({ id: `dup:${x}:${y}`, kind: 'duplicate', tx: b.id, amount: -b.amount_eur, merchant: b.merchant });
      break;
    }
  }
  return out;
}
