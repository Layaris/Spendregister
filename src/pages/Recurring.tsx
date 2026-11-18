// Spese ricorrenti: proposte dall'app (tu confermi o scarti) e quelle confermate, con la prossima data.
import { useState } from 'react';
import { parseAmount } from '../../shared/money';
import { everyLabel, FREQUENCIES, nextDate } from '../../shared/recurring';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { displayCurrency, eur, formatDayShort, formatMoney, fromDisplay, localDay } from '../util';

type Period = 'week' | 'month' | 'year';
export interface Suggestion { merchant: string; period: Period; every: number; amount_eur: number; last_date: string; next_date: string; count: number; category_id: string | null }
export interface Confirmed { id: string; merchant: string; category_id: string | null; amount_eur: number; period: Period; every: number; last_date: string | null; next_date: string | null; late: boolean; new_amount: number | null; per_month: number; auto_add?: number | boolean; account_id?: string | null }
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
                    <select className="chip" style={{ border: 0, font: 'inherit', fontSize: 13 }} aria-label={`Come la paghi: ${c.merchant}`} value={c.auto_add ? 'auto' : 'card'}
                      onChange={(e) => act(() => api(`/recurring/${c.id}`, { method: 'PUT', json: { auto_add: e.target.value === 'auto' } }))}>
                      <option value="card">dalla notifica della carta</option>
                      <option value="auto">la registra Ledgy</option>
                    </select>
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
  const [f, setF] = useState({ merchant: '', amount: '', freq: 'month:1', next: localDay(), category: null as string | null, auto: false, account: null as string | null });
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const v = parseAmount(f.amount, displayCurrency());
    if (!f.merchant.trim()) { setError('Scrivi il nome (es. Netflix): è anche il negozio delle spese future'); return; }
    if (!v || v.value <= 0) { setError('Scrivi l’importo'); return; }
    const [period, every] = f.freq.split(':');
    try {
      await api('/recurring', { method: 'POST', json: {
        merchant: f.merchant.trim(), period, every: Number(every), amount_eur: fromDisplay(Math.round(v.value * 1000)), amount: Math.round(v.value * 1000), currency: displayCurrency(),
        category_id: f.category, next_date: f.next, status: 'confirmed', auto_add: f.auto, account_id: f.auto ? f.account : null,
      } });
      store.toast(`${f.merchant.trim()}: aggiunta`);
      setF({ merchant: '', amount: '', freq: 'month:1', next: localDay(), category: null, auto: false, account: null });
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
      <PayModeChoice auto={f.auto} onChange={(auto) => setF({ ...f, auto })} account={f.account} onAccount={(account) => setF({ ...f, account })} />
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={() => setOpen(false)}>Annulla</button>
        <button className="btn primary grow" onClick={save}>Aggiungi</button>
      </div>
    </section>
  );
}

/** Come si paga una ricorrente: scelta del pannello, uguale nel dettaglio e nell'aggiunta a mano. */
export function PayModeChoice({ auto, onChange, account, onAccount }: { auto: boolean; onChange: (auto: boolean) => void; account: string | null; onAccount: (id: string | null) => void }) {
  const store = useStore();
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="label">Come la paghi?</span>
      <button type="button" className="sheet-option" aria-pressed={!auto} onClick={() => onChange(false)} style={{ display: 'grid', gap: 2 }}>
        <span>Con una carta che Ledgy legge</span>
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>Ledgy aspetta la notifica: se l’addebito arriva qualche giorno prima o dopo, resta una spesa sola.</span>
      </button>
      <button type="button" className="sheet-option" aria-pressed={auto} onClick={() => onChange(true)} style={{ display: 'grid', gap: 2 }}>
        <span>In un altro modo (PayPal, bonifico, contanti…)</span>
        <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>Ledgy la registra da sola il giorno previsto. Se arriva anche la notifica entro qualche giorno, tiene quella vera e toglie la sua.</span>
      </button>
      {auto && (
        <label className="field"><span>Conto da cui esce</span>
          <select className="input" value={account ?? ''} onChange={(e) => onAccount(e.target.value || null)}>
            <option value="">Conto principale</option>
            {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

interface RecurringOf { id: string; period: Period; every: number; status: string; auto_add: boolean; account_id: string | null; next_date: string | null }

/** Riga nel dettaglio di un movimento: tocchi e scegli se è ricorrente, ogni quanto, la prossima data e come la paghi. */
export function RecurringRowForTx({ t }: { t: { id: string; merchant: string; amount: number; currency: string; amount_eur: number; category_id: string | null; account_id: string | null; card: string | null; source: string; occurred_at: string } }) {
  const store = useStore();
  const st = useApi<{ item: RecurringOf | null }>(t.merchant ? `/recurring/of/${encodeURIComponent(t.merchant)}?today=${localDay()}` : null);
  const [open, setOpen] = useState(false);
  const item = st.data?.item?.status === 'confirmed' ? st.data.item : null;
  const label = item ? FREQUENCIES.find(([k]) => k === `${item.period}:${item.every ?? 1}`)?.[1] ?? 'Sì' : 'No';
  return (
    <>
      <button type="button" className="lrow" onClick={() => setOpen(true)} aria-label="Spesa ricorrente">
        <span className="lrow-ic"><Icon name="repeat" size={18} /></span>
        <span className="lrow-label grow" style={{ textAlign: 'left' }}>Ricorrente</span>
        <span className="muted" style={{ textAlign: 'right' }}>{label}{item?.auto_add ? ' · da sola' : ''}</span>
        <Icon name="next" size={18} />
      </button>
      {open && (st.data || !t.merchant) && <RecurringSheet t={t} item={item} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); st.reload(); store.refresh(); }} />}
    </>
  );
}

function RecurringSheet({ t, item, onClose, onSaved }: { t: Parameters<typeof RecurringRowForTx>[0]['t']; item: RecurringOf | null; onClose: () => void; onSaved: () => void }) {
  const store = useStore();
  const day = t.occurred_at.slice(0, 10);
  const [freq, setFreq] = useState(item ? `${item.period}:${item.every ?? 1}` : 'month:1');
  const [period0, every0] = freq.split(':');
  const [next, setNext] = useState(item?.next_date ?? nextDate(day, period0 as Period, Number(every0)));
  const [touched, setTouched] = useState(!!item);
  // Pagata con una carta letta da Ledgy (notifica) → aspetta la notifica; altrimenti la propone da sola.
  const [auto, setAuto] = useState(item ? item.auto_add : !(t.source === 'capture' || t.card));
  const [account, setAccount] = useState<string | null>(item?.account_id ?? t.account_id);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(t.merchant);
  const changeFreq = (v: string) => {
    setFreq(v);
    const [p, e] = v.split(':');
    if (!touched) setNext(nextDate(day, p as Period, Number(e)));
  };
  const save = async () => {
    setError(null);
    const [period, every] = freq.split(':');
    const merchant = name.trim();
    if (!merchant) { setError('Scrivi il nome (es. Netflix, Internet): è quello delle spese future'); return; }
    try {
      // Movimento senza negozio: il nome scelto diventa anche il suo.
      if (merchant !== t.merchant) await api(`/transactions/${t.id}`, { method: 'PUT', json: { merchant } });
      await api('/recurring', { method: 'POST', json: {
        merchant, period, every: Number(every), amount_eur: t.amount_eur, amount: t.amount, currency: t.currency, category_id: t.category_id,
        status: 'confirmed', next_date: next, auto_add: auto, account_id: auto ? account : null,
      } });
      store.toast(`${merchant}: ricorrente, ${FREQUENCIES.find(([k]) => k === freq)?.[1].toLowerCase()}${auto ? ', la registra Ledgy' : ''}`);
      onSaved();
    } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (item) await api(`/recurring/${item.id}`, { method: 'DELETE' });
    store.toast(`${t.merchant}: non più ricorrente`);
    onSaved();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Spesa ricorrente" onClick={(e) => e.stopPropagation()} style={{ overflowY: 'auto', gap: 12 }}>
        <div className="row between"><h2 className="h2">Spesa ricorrente</h2><button className="btn ghost" onClick={onClose}>Chiudi</button></div>
        {t.merchant
          ? <span className="muted" style={{ fontSize: 14 }}>{t.merchant} · <span className="num money">{formatMoney(Math.abs(t.amount), t.currency)}</span></span>
          : <label className="field"><span>Nome (come appare nelle spese)</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Netflix, Internet, Affitto" /></label>}
        <label className="field"><span>Ogni quanto</span>
          <select className="input" aria-label="Ogni quanto" value={freq} onChange={(e) => changeFreq(e.target.value)}>{FREQUENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="field"><span>Prossimo addebito</span>
          <input className="input" type="date" aria-label="Prossimo addebito" value={next} onChange={(e) => { setNext(e.target.value); setTouched(true); }} />
        </label>
        <PayModeChoice auto={auto} onChange={setAuto} account={account} onAccount={setAccount} />
        <ErrorBox error={error} />
        <button className="btn primary" onClick={save}>{item ? 'Salva' : 'È ricorrente'}</button>
        {item && <button className="btn ghost" style={{ color: 'var(--danger)' }} onClick={remove}>Non è più ricorrente</button>}
      </div>
    </div>
  );
}
