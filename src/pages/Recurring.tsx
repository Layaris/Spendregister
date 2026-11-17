// Spese ricorrenti: proposte dall'app (tu confermi o scarti) e quelle confermate, con la prossima data.
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, ErrorBox, Loading, TopBar } from '../ui';
import { eur, formatDayShort, localDay } from '../util';

type Period = 'week' | 'month' | 'year';
export interface Suggestion { merchant: string; period: Period; amount_eur: number; last_date: string; next_date: string; count: number; category_id: string | null }
export interface Confirmed { id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; last_date: string | null; next_date: string | null; late: boolean; new_amount: number | null; per_month: number }
export interface RecurringData { confirmed: Confirmed[]; suggestions: Suggestion[]; per_month: number; dismissed: number }

export const EVERY: Record<Period, string> = { week: 'ogni settimana', month: 'ogni mese', year: 'ogni anno' };

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
          <span style={{ fontWeight: 600 }}>{s.merchant} · <span className="num money">{eur(-s.amount_eur)}</span> {EVERY[s.period]}?</span>
          <span className="muted" style={{ fontSize: 13 }}>{s.count} volte, l’ultima il {formatDayShort(s.last_date)} · prossima verso il {formatDayShort(s.next_date)}</span>
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
                  <span className="muted" style={{ fontSize: 13 }}>{EVERY[c.period]}{c.next_date ? ` · prossima ${formatDayShort(c.next_date)}` : ''}</span>
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
      ) : !d.suggestions.length && <p className="empty">Nessuna spesa ricorrente per ora. Puoi segnarne una dal dettaglio di un movimento.</p>}
    </div>
  );
}

/** Riga nel dettaglio di un movimento: segna il negozio come spesa ricorrente. */
export function RecurringRowForTx({ merchant, amount, categoryId }: { merchant: string; amount: number; categoryId: string | null }) {
  const store = useStore();
  const st = useApi<{ item: { id: string; period: Period; status: string } | null }>(`/recurring/of/${encodeURIComponent(merchant)}`);
  if (!st.data) return null;
  const value = st.data.item?.status === 'confirmed' ? st.data.item.period : '';
  const change = async (v: string) => {
    if (!v && st.data?.item) await api(`/recurring/${st.data.item.id}`, { method: 'DELETE' });
    else if (v) await api('/recurring', { method: 'POST', json: { merchant, period: v, amount_eur: amount, category_id: categoryId, status: 'confirmed' } });
    store.toast(v ? `${merchant}: spesa ricorrente ${EVERY[v as Period]}` : `${merchant}: non più ricorrente`);
    st.reload();
  };
  return (
    <label className="lrow">
      <span className="lrow-ic"><Icon name="repeat" size={18} /></span>
      <span className="lrow-label">Ricorrente</span>
      <select className="lrow-input" style={{ textAlign: 'right', border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }} aria-label="Spesa ricorrente"
        value={value} onChange={(e) => change(e.target.value)}>
        <option value="">No</option><option value="week">Ogni settimana</option><option value="month">Ogni mese</option><option value="year">Ogni anno</option>
      </select>
    </label>
  );
}
