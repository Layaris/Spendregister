import { useEffect, useState } from 'react';
import { api, type Tx } from '../api';
import { useStore } from '../store';
import { ErrorBox, Loading, TxRow } from '../ui';
import { eur, formatWhen } from '../util';

const PAGE = 60;

export function Movements({ category }: { category?: string }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Tx[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (offset = 0) => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
    if (q.trim()) params.set('q', q.trim());
    if (category) params.set('category', category);
    try {
      const r = await api<{ items: Tx[] }>(`/transactions?${params}`);
      setItems((prev) => (offset ? [...(prev ?? []), ...r.items] : r.items));
      setMore(r.items.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => load(0), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, store.review_count]);

  // Raggruppa per giorno locale.
  const groups: Array<{ day: string; items: Tx[]; total: number }> = [];
  for (const t of items ?? []) {
    const day = t.occurred_at.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, items: [], total: 0 }));
    g.items.push(t);
    if (t.type !== 'transfer') g.total += t.amount_eur;
  }

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <h1 className="page-title">{category ? store.catName(category) : 'Movimenti'}</h1>
      <div className="row" style={{ gap: 8 }}>
        <label className="grow" style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: -9999 }}>Cerca</span>
          <input className="input" type="search" placeholder="Cerca merchant o nota" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {store.review_count > 0 && <a className="btn" href="#/rivedere">Da rivedere · {store.review_count}</a>}
      </div>
      <ErrorBox error={error} />
      {!items ? <Loading /> : !items.length ? <p className="empty">Nessun movimento trovato.</p> : groups.map((g) => (
        <section key={g.day} className="card">
          <div className="row between">
            <span className="label">{formatWhen(g.day, false)}</span>
            <span className="muted num money" style={{ fontSize: 13 }}>{eur(g.total)}</span>
          </div>
          {g.items.map((t) => <TxRow key={t.id} t={t} />)}
        </section>
      ))}
      {more && <button className="btn" onClick={() => load(items?.length ?? 0)}>Carica altri</button>}
    </div>
  );
}
