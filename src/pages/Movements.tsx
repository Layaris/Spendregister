import { countryOf } from '../../shared/countries';
import { useEffect, useState } from 'react';
import { parseAmount } from '../../shared/money';
import { api, type Tx } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategorySelect, ErrorBox, Loading, TxRow } from '../ui';
import { displayCurrency, eur, formatDayShort, formatWhen, fromDisplay, localDay, monthPeriod } from '../util';

const PAGE = 60;

/** Filtri dei movimenti: tutti facoltativi. Importi scritti nella valuta di visualizzazione. */
export interface Filters { type?: string; from?: string; to?: string; category?: string; account?: string; card?: string; label?: string; min?: string; max?: string; trip?: string; currency?: string }
interface Summary { count: number; spent: number; income: number }
interface Trip { id: string; name: string; start_date: string; end_date: string }

const TYPES: Array<[string, string]> = [['', 'Tutti'], ['expense', 'Spese'], ['income', 'Entrate'], ['transfer', 'Tra conti']];

function readSaved(): Filters {
  try { return JSON.parse(sessionStorage.getItem('ledgy-filters') ?? '{}') as Filters; } catch { return {}; }
}

export function Movements({ category }: { category?: string }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Filters>(() => (category ? {} : readSaved()));
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Tx[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cards = useApi<{ items: Array<{ name: string }> }>('/cards');
  const trips = useApi<{ items: Trip[] }>('/trips');

  const f = { ...filters, ...(category ? { category } : {}) };
  const toMilliEur = (s?: string) => {
    const v = s ? parseAmount(s, displayCurrency()) : null;
    return v ? String(fromDisplay(Math.round(v.value * 1000))) : null;
  };

  const load = async (offset = 0) => {
    const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset), sum: '1' });
    if (q.trim()) params.set('q', q.trim());
    for (const k of ['type', 'from', 'to', 'category', 'account', 'card', 'label', 'trip', 'currency'] as const) if (f[k]) params.set(k, f[k]!);
    // "Fino al" incluso: il server vuole il giorno dopo.
    if (f.to) params.set('to', localDay(new Date(new Date(`${f.to}T12:00:00`).getTime() + 86400_000)));
    const min = toMilliEur(f.min);
    const max = toMilliEur(f.max);
    if (min) params.set('min', min);
    if (max) params.set('max', max);
    try {
      const r = await api<{ items: Tx[]; summary?: Summary }>(`/transactions?${params}`);
      setItems((prev) => (offset ? [...(prev ?? []), ...r.items] : r.items));
      if (!offset) setSummary(r.summary ?? null);
      setMore(r.items.length === PAGE);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!category) try { sessionStorage.setItem('ledgy-filters', JSON.stringify(filters)); } catch { /* ignora */ }
    const t = setTimeout(() => load(0), q ? 250 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, store.review_count, JSON.stringify(filters)]);

  // Raggruppa per giorno locale.
  const groups: Array<{ day: string; items: Tx[]; total: number }> = [];
  for (const t of items ?? []) {
    const day = t.occurred_at.slice(0, 10);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) groups.push((g = { day, items: [], total: 0 }));
    g.items.push(t);
    if (t.type !== 'transfer') g.total += t.amount_eur;
  }

  // Filtri attivi, come chip che si tolgono con un tocco.
  const chips: Array<[keyof Filters | 'period' | 'amount', string]> = [];
  if (filters.type) chips.push(['type', TYPES.find(([k]) => k === filters.type)?.[1] ?? filters.type]);
  if (filters.from || filters.to) chips.push(['period', `${filters.from ? formatDayShort(filters.from) : '…'} – ${filters.to ? formatDayShort(filters.to) : 'oggi'}`]);
  if (filters.category) chips.push(['category', store.catName(filters.category)]);
  if (filters.account) chips.push(['account', store.accounts.find((a) => a.id === filters.account)?.name ?? 'Conto']);
  if (filters.card) chips.push(['card', filters.card === '-' ? 'Senza carta' : filters.card]);
  if (filters.label) chips.push(['label', store.labels.find((l) => l.id === filters.label)?.name ?? 'Etichetta']);
  if (filters.min || filters.max) chips.push(['amount', `${filters.min || '0'} – ${filters.max || '…'} ${displayCurrency()}`]);
  if (filters.currency) chips.push(['currency', `${countryOf(filters.currency).flag} ${countryOf(filters.currency).name}`]);
  if (filters.trip) chips.push(['trip', trips.data?.items.find((t) => t.id === filters.trip)?.name ?? 'Viaggio']);
  const drop = (k: string) => {
    const next = { ...filters };
    if (k === 'period') { delete next.from; delete next.to; } else if (k === 'amount') { delete next.min; delete next.max; } else delete next[k as keyof Filters];
    setFilters(next);
  };
  const filtering = chips.length > 0 || !!q.trim();

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12 }}>
      <h1 className="page-title">{category ? store.catName(category) : 'Movimenti'}</h1>
      <div className="row" style={{ gap: 8 }}>
        <label className="grow" style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: -9999 }}>Cerca</span>
          <input className="input" type="search" placeholder="Cerca negozio, nota, carta…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <button className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Filtri" style={{ position: 'relative' }}>
          <Icon name="rules" size={18} />Filtri{chips.length ? <span className="chip ok" style={{ padding: '1px 7px', marginLeft: 2 }}>{chips.length}</span> : null}
        </button>
      </div>
      {chips.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          {chips.map(([k, label]) => (
            <button key={k} className="chip" style={{ border: 0, cursor: 'pointer', fontSize: 13, padding: '5px 10px', background: 'var(--card)' }} onClick={() => drop(k)} aria-label={`Togli filtro ${label}`}>
              {label} <Icon name="close" size={12} />
            </button>
          ))}
          <button className="btn ghost" style={{ minHeight: 28, fontSize: 13 }} onClick={() => setFilters({})}>Azzera</button>
        </div>
      )}
      {filtering && summary && (
        <span className="muted" style={{ fontSize: 14, padding: '0 4px' }}>
          {summary.count === 1 ? '1 movimento' : `${summary.count} movimenti`}
          {summary.spent ? <> · spesi <b className="num money" style={{ color: 'var(--ink)' }}>{eur(summary.spent)}</b></> : null}
          {summary.income ? <> · entrate <b className="num money" style={{ color: 'var(--pos)' }}>{eur(summary.income)}</b></> : null}
        </span>
      )}
      {!filtering && store.review_count > 0 && <a className="btn" href="#/rivedere" style={{ alignSelf: 'flex-start' }}>Da rivedere · {store.review_count}</a>}
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
      {open && <FilterSheet value={filters} lockCategory={!!category} cards={cards.data?.items.map((c) => c.name) ?? []} trips={trips.data?.items ?? []}
        onClose={() => setOpen(false)} onApply={(v) => { setFilters(v); setOpen(false); }} />}
    </div>
  );
}

function FilterSheet({ value, onApply, onClose, lockCategory, cards, trips }: { value: Filters; onApply: (f: Filters) => void; onClose: () => void; lockCategory: boolean; cards: string[]; trips: Trip[] }) {
  const store = useStore();
  const [f, setF] = useState<Filters>(value);
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch });
  const month = (offset: number) => { const p = monthPeriod(offset); return { from: p.from, to: localDay(new Date(new Date(`${p.to}T12:00:00`).getTime() - 86400_000)) }; };
  const year = new Date().getFullYear();
  const quick: Array<[string, Filters]> = [
    ['Questo mese', month(0)], ['Mese scorso', month(-1)], ['Ultimi 3 mesi', { from: month(-2).from, to: localDay() }], ['Quest’anno', { from: `${year}-01-01`, to: localDay() }],
  ];
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Filtri" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '86vh', overflowY: 'auto' }}>
        <div className="row between"><h2 className="h2">Filtri</h2><button className="btn ghost" onClick={onClose}>Annulla</button></div>
        <div className="seg" role="group" aria-label="Tipo">
          {TYPES.map(([k, l]) => <button key={k} aria-pressed={(f.type ?? '') === k} onClick={() => set({ type: k || undefined })}>{l}</button>)}
        </div>
        <span className="label">Periodo</span>
        <div className="row wrap" style={{ gap: 6 }}>
          {quick.map(([l, p]) => <button key={l} className="btn small" aria-pressed={f.from === p.from && f.to === p.to} onClick={() => set(p)}>{l}</button>)}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" type="date" aria-label="Dal" value={f.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} />
          <input className="input grow" type="date" aria-label="Al" value={f.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} />
        </div>
        {!lockCategory && (<><span className="label">Categoria</span><CategorySelect value={f.category ?? null} kind="all" onChange={(v) => set({ category: v ?? undefined })} /></>)}
        <div className="row" style={{ gap: 8 }}>
          <label className="field grow"><span>Conto</span>
            <select className="input" value={f.account ?? ''} onChange={(e) => set({ account: e.target.value || undefined })}>
              <option value="">Tutti</option>{store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field grow"><span>Carta o banca</span>
            <select className="input" value={f.card ?? ''} onChange={(e) => set({ card: e.target.value || undefined })}>
              <option value="">Tutte</option>{cards.map((c) => <option key={c} value={c}>{c}</option>)}<option value="-">Senza carta</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {store.labels.length > 0 && (
            <label className="field grow"><span>Etichetta</span>
              <select className="input" value={f.label ?? ''} onChange={(e) => set({ label: e.target.value || undefined })}>
                <option value="">Tutte</option>{store.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
          )}
          {trips.length > 0 && (
            <label className="field grow"><span>Viaggio</span>
              <select className="input" value={f.trip ?? ''} onChange={(e) => set({ trip: e.target.value || undefined })}>
                <option value="">Nessuno</option>{trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
        </div>
        <span className="label">Importo ({displayCurrency()})</span>
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow num" inputMode="decimal" placeholder="Da" aria-label="Importo da" value={f.min ?? ''} onChange={(e) => set({ min: e.target.value || undefined })} />
          <input className="input grow num" inputMode="decimal" placeholder="A" aria-label="Importo a" value={f.max ?? ''} onChange={(e) => set({ max: e.target.value || undefined })} />
        </div>
        <div className="row" style={{ gap: 8, paddingTop: 4 }}>
          <button className="btn grow" onClick={() => setF({})}>Azzera</button>
          <button className="btn primary grow" onClick={() => onApply(Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Filters)}>Mostra</button>
        </div>
      </div>
    </div>
  );
}
