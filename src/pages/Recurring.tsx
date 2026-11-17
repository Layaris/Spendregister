// Spese ricorrenti: proposte dall'app (tu confermi o scarti) e quelle confermate, con la prossima data.
import { useState } from 'react';
import { parseAmount } from '../../shared/money';
import { everyLabel, FREQUENCIES } from '../../shared/recurring';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { displayCurrency, eur, formatDayShort, fromDisplay, localDay } from '../util';

type Period = 'week' | 'month' | 'year';
export interface Suggestion { merchant: string; period: Period; every: number; amount_eur: number; last_date: string; next_date: string; count: number; category_id: string | null }
export interface Confirmed { id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; every: number; last_date: string | null; next_date: string | null; late: boolean; new_amount: number | null; per_month: number }
export interface RecurringData { confirmed: Confirmed[]; suggestions: Suggestion[]; per_month: number; dismissed: number }


export function useRecurring(enabled = true) {
  const store = useStore();
  return useApi<RecurringData>(enabled ? `/recurring?today=${localDay()}` : null, [store.review_count]);
}

/** Riquadro "Sembra un abbonamento": Sì / No. */
export function SuggestionCard({ s, onDone }: { s: Suggestion; onDone: () => void }) {
  const store = useStore();
  const answer = async (status: 'confirmed' | 'dismissed') => {
    await api('/recurring', { method: 'POST', json: { ...s, status } });
    store.toast(status === 'confirmed' ? `${s.merchant}: spesa ricorrente` : `${s.merchant}: non te la propongo più`);
    onDone();
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 10 }}>
        <CategoryIcon id={s.category_id} size={36} />
        <div className="grow stack" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{s.merchant} · <span className="num money">{eur(-s.amount_eur)}</span> {everyLabel(s.period, s.every)}?</span>
          <span className="muted" style={{ fontSize: 13 }}>{s.count} volte, l’ultima il {formatDayShort(s.last_date)} · {s.next_date < localDay() ? 'era attesa il' : 'prossima verso il'} {formatDayShort(s.next_date)}</span>
        </div>
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => answer('dismissed')}>No</button>
        <button className="btn primary grow" onClick={() => answer('confirmed')}>Sì, è ricorrente</button>
      </div>
    </div>
  );
}

export function Recurring() {
  const store = useStore();
  const r = useRecurring();
  const [error, setError] = useState<string | null>(null);
  if (r.error) return <div className="stack"><TopBar backTo="/altro" /><ErrorBox error={r.error} /></div>;
  if (!r.data) return <Loading />;
  const d = r.data;
  const act = async (fn: () => Promise<unknown>) => { setError(null); try { await fn(); r.reload(); } catch (e) { setError((e as Error).message); } };
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <TopBar backTo="/altro" />
      <h1 className="page-title">Spese ricorrenti</h1>
      <p className="lead">Abbonamenti, affitto, palestra… L’app ne propone una solo se lo stesso negozio torna almeno 3 volte con importo simile e a intervalli regolari: decidi tu se lo è.</p>
      <ErrorBox error={error} />
      {d.suggestions.length > 0 && (
        <section className="card warn">
          <h2 className="h2">Sembrano ricorrenti</h2>
          {d.suggestions.map((s) => <SuggestionCard key={s.merchant} s={s} onDone={r.reload} />)}
        </section>
      )}
      {d.confirmed.length > 0 ? (
        <>
          <div className="row between" style={{ padding: '0 4px' }}>
            <span className="section-title" style={{ padding: 0 }}>Confermate</span>
            <span className="muted" style={{ fontSize: 14 }}>≈ <b className="num money" style={{ color: 'var(--ink)' }}>{eur(-d.per_month)}</b> al mese</span>
          </div>
          <div className="list">
            {d.confirmed.map((c) => (
              <div key={c.id} className="lrow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                <CategoryIcon id={c.category_id} size={32} />
                <div className="grow stack" style={{ gap: 3, minWidth: 0 }}>
                  <span className="row between" style={{ gap: 8 }}><b>{c.merchant}</b><b className="num money">{eur(-c.amount_eur)}</b></span>
                  <span className="row wrap" style={{ gap: 6, fontSize: 13 }}>
                    <select className="chip" style={{ border: 0, font: 'inherit', fontSize: 13 }} aria-label={`Ogni quanto: ${c.merchant}`} value={`${c.period}:${c.every}`}
                      onChange={(e) => { const [period, every] = e.target.value.split(':'); act(() => api(`/recurring/${c.id}`, { method: 'PUT', json: { period, every: Number(every) } })); }}>
                      {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    {c.next_date && <span className="muted">prossima {formatDayShort(c.next_date)}</span>}
                  </span>
                  {c.late && <span className="chip warn">Non è arrivata: è finita o è cambiata?</span>}
                  {c.new_amount != null && (
                    <span className="row wrap" style={{ gap: 6, fontSize: 13 }}>
                      <span style={{ color: 'var(--warn)' }}>L’ultima volta {eur(-c.new_amount)}: è cambiato il prezzo?</span>
                      <button className="btn small" onClick={() => act(() => api(`/recurring/${c.id}`, { method: 'PUT', json: { amount_eur: c.new_amount } }))}>Aggiorna</button>
                    </span>
                  )}
                </div>
                <button className="iconbtn" aria-label={`Non è più ricorrente: ${c.merchant}`} onClick={() => act(() => api(`/recurring/${c.id}`, { method: 'DELETE' }))}><Icon name="close" size={16} /></button>
              </div>
            ))}
          </div>
        </>
      ) : !d.suggestions.length && <p className="empty">Nessuna spesa ricorrente per ora. Aggiungine una qui sotto o dal dettaglio di un movimento.</p>}
      <AddRecurring onDone={r.reload} />
    </div>
  );
}

/** Aggiunta a mano: un abbonamento o una spesa fissa anche senza movimenti registrati. */
function AddRecurring({ onDone }: { onDone: () => void }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ merchant: '', amount: '', freq: 'month:1', next: localDay(), category: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const v = parseAmount(f.amount, displayCurrency());
    if (!f.merchant.trim()) { setError('Scrivi il nome (es. Netflix): è anche il negozio delle spese future'); return; }
    if (!v || v.value <= 0) { setError('Scrivi l’importo'); return; }
    const [period, every] = f.freq.split(':');
    try {
      await api('/recurring', { method: 'POST', json: { merchant: f.merchant.trim(), period, every: Number(every), amount_eur: fromDisplay(Math.round(v.value * 1000)), category_id: f.category, next_date: f.next, status: 'confirmed' } });
      store.toast(`${f.merchant.trim()}: aggiunta`);
      setF({ merchant: '', amount: '', freq: 'month:1', next: localDay(), category: null });
      setOpen(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!open) return <button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={18} />Aggiungi una spesa ricorrente</button>;
  return (
    <section className="card">
      <h2 className="h2">Nuova spesa ricorrente</h2>
      <label className="field"><span>Nome (come appare nelle spese)</span><input className="input" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Es. Netflix, Affitto villa, Assicurazione" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Importo ({displayCurrency()})</span><input className="input num" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
        <label className="field grow"><span>Ogni quanto</span>
          <select className="input" value={f.freq} onChange={(e) => setF({ ...f, freq: e.target.value })}>{FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
      </div>
      <label className="field"><span>Prossimo addebito</span><input className="input" type="date" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></label>
      <span className="label">Categoria</span>
      <CategorySelect value={f.category} kind="expense" onChange={(v) => setF({ ...f, category: v })} />
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => setOpen(false)}>Annulla</button>
        <button className="btn primary grow" onClick={save}>Aggiungi</button>
      </div>
    </section>
  );
}

/** Riga nel dettaglio di un movimento: segna il negozio come spesa ricorrente. */
export function RecurringRowForTx({ merchant, amount, categoryId }: { merchant: string; amount: number; categoryId: string | null }) {
  const store = useStore();
  const st = useApi<{ item: { id: string; period: Period; every: number; status: string } | null }>(`/recurring/of/${encodeURIComponent(merchant)}`);
  if (!st.data) return null;
  const value = st.data.item?.status === 'confirmed' ? `${st.data.item.period}:${st.data.item.every ?? 1}` : '';
  const change = async (v: string) => {
    if (!v && st.data?.item) await api(`/recurring/${st.data.item.id}`, { method: 'DELETE' });
    else if (v) {
      const [period, every] = v.split(':');
      await api('/recurring', { method: 'POST', json: { merchant, period, every: Number(every), amount_eur: amount, category_id: categoryId, status: 'confirmed' } });
    }
    store.toast(v ? `${merchant}: spesa ricorrente, ${FREQUENCIES.find(([k]) => k === v)?.[1].toLowerCase()}` : `${merchant}: non più ricorrente`);
    st.reload();
  };
  return (
    <label className="lrow">
      <span className="lrow-ic"><Icon name="repeat" size={18} /></span>
      <span className="lrow-label">Ricorrente</span>
      <select className="lrow-input" style={{ textAlign: 'right', border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }} aria-label="Spesa ricorrente"
        value={value} onChange={(e) => change(e.target.value)}>
        <option value="">No</option>
        {FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
