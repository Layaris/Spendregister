// Cambi verso l'euro: Frankfurter (banche centrali), riserva fawazahmed0, cache in D1.

export interface FxRate {
  eurPerUnit: number;
  date: string;
  source: string;
}

async function fetchFrankfurter(currency: string, date: string): Promise<FxRate | null> {
  const res = await fetch(`https://api.frankfurter.dev/v2/rate/${currency}/EUR?date=${date}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as { rate?: number; date?: string };
  if (!j.rate || !(j.rate > 0)) return null;
  return { eurPerUnit: j.rate, date: j.date ?? date, source: 'frankfurter' };
}

async function fetchFawaz(currency: string, date: string): Promise<FxRate | null> {
  const c = currency.toLowerCase();
  for (const url of [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/${c}.json`,
    `https://${date}.currency-api.pages.dev/v1/currencies/${c}.json`,
  ]) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const j = (await res.json()) as Record<string, Record<string, number>>;
      const rate = j[c]?.eur;
      if (rate && rate > 0) return { eurPerUnit: rate, date, source: 'fawazahmed0' };
    } catch {
      /* prova la prossima fonte */
    }
  }
  return null;
}

/** Euro per una unità di `currency` alla data indicata (YYYY-MM-DD). */
export async function getEurRate(db: D1Database, currency: string, date: string): Promise<FxRate | null> {
  const cur = currency.toUpperCase();
  if (cur === 'EUR') return { eurPerUnit: 1, date, source: 'base' };
  const today = new Date().toISOString().slice(0, 10);
  const day = date > today ? today : date;
  const cached = await db
    .prepare('SELECT eur_per_unit, source FROM fx_rates WHERE date = ? AND currency = ?')
    .bind(day, cur)
    .first<{ eur_per_unit: number; source: string }>();
  if (cached) return { eurPerUnit: cached.eur_per_unit, date: day, source: cached.source };

  let rate: FxRate | null = null;
  try {
    rate = await fetchFrankfurter(cur, day);
  } catch {
    rate = null;
  }
  if (!rate) rate = await fetchFawaz(cur, day);
  if (!rate) {
    // Ultima risorsa: il tasso più recente già salvato.
    const last = await db
      .prepare('SELECT eur_per_unit, date, source FROM fx_rates WHERE currency = ? ORDER BY date DESC LIMIT 1')
      .bind(cur)
      .first<{ eur_per_unit: number; date: string; source: string }>();
    return last ? { eurPerUnit: last.eur_per_unit, date: last.date, source: `${last.source} (ultimo disponibile)` } : null;
  }
  await db
    .prepare('INSERT OR REPLACE INTO fx_rates (date, currency, eur_per_unit, source) VALUES (?, ?, ?, ?)')
    .bind(day, cur, rate.eurPerUnit, rate.source)
    .run();
  return { ...rate, date: day };
}
