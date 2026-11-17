// Budget mensile: un totale (il tetto) e, se vuoi, budget per categoria ritagliati dal totale.
// Quello che una categoria spende oltre il suo budget si toglie da "tutto il resto".
import { useState } from 'react';
import { parseAmount } from '../../shared/money';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { displayCurrency, eur, fitSize, fromDisplay, localDay, monthPeriod } from '../util';

export interface BudgetView {
  month: string;
  days: { total: number; elapsed: number };
  total: { amount: number; spent: number; left: number; per_day: number } | null;
  categories: Array<{ category_id: string; amount: number; spent: number; left: number; pct: number }>;
  rest: { amount: number; spent: number; left: number } | null;
  spent: number;
}

/** Colore della barra: verde, arancio dall'80%, rosso oltre il 100%. */
export const budgetTone = (pct: number) => (pct > 100 ? 'var(--neg)' : pct >= 80 ? '#c77a12' : 'var(--accent)');

export function useBudget(month?: string) {
  const store = useStore();
  const today = localDay();
  return useApi<BudgetView>(`/budgets?today=${today}${month ? `&month=${month}` : ''}`, [store.review_count, month]);
}

/** Barra con la tacca di "oggi": a sinistra della tacca sei nel ritmo, a destra lo stai superando. */
export function BudgetBar({ spent, amount, dayPct, height = 10 }: { spent: number; amount: number; dayPct?: number; height?: number }) {
  const pct = amount > 0 ? (spent / amount) * 100 : 0;
  return (
    <div style={{ position: 'relative', height, borderRadius: height / 2, background: 'var(--sunken)' }}>
      <div style={{ position: 'absolute', inset: 0, width: `${Math.min(pct, 100)}%`, borderRadius: height / 2, background: budgetTone(pct) }} />
      {dayPct != null && dayPct > 0 && dayPct < 100 && <div aria-hidden="true" style={{ position: 'absolute', left: `${dayPct}%`, top: -3, width: 2, height: height + 6, borderRadius: 1, background: 'var(--ink)', opacity: 0.35 }} />}
    </div>
  );
}

function AmountEditor({ label, initial, onSave, onRemove }: { label: string; initial: number | null; onSave: (milliEur: number) => Promise<void>; onRemove?: () => Promise<void> }) {
  const [text, setText] = useState(initial ? String(Math.round(initial / 1000 * 100) / 100).replace('.', ',') : '');
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    const v = parseAmount(text, displayCurrency());
    if (!v || v.value <= 0) { setError('Scrivi un importo'); return; }
    setError(null);
    await onSave(fromDisplay(Math.round(v.value * 1000)));
  };
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <input className="input num grow" inputMode="decimal" aria-label={label} placeholder={`Es. 1000 ${displayCurrency()}`} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
        <button className="btn primary" onClick={save}>Salva</button>
        {onRemove && <button className="iconbtn" style={{ background: 'var(--sunken)' }} aria-label="Togli il budget" onClick={onRemove}><Icon name="trash" size={18} /></button>}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}

export function Budget() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const period = monthPeriod(offset);
  const month = period.from.slice(0, 7);
  const b = useBudget(month);
  const [editing, setEditing] = useState<string | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const put = async (category_id: string, amount: number | null) => {
    setError(null);
    try {
      await api('/budgets', { method: 'PUT', json: { category_id, amount } });
      setEditing(null);
      setNewCat(null);
      b.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!b.data) return <Loading />;
  const v = b.data;
  const dayPct = v.days.total ? (v.days.elapsed / v.days.total) * 100 : undefined;
  const current = offset === 0;
  const daysLeft = v.days.total - v.days.elapsed + 1;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/altro" />
      <div className="row between">
        <h1 className="page-title" style={{ margin: 0 }}>Budget</h1>
        <div className="row" style={{ gap: 2 }}>
          <button className="iconbtn" aria-label="Mese precedente" onClick={() => setOffset(offset - 1)}><Icon name="back" size={18} /></button>
          <span style={{ fontWeight: 600, fontSize: 14, minWidth: 110, textAlign: 'center' }}>{period.label}</span>
          <button className="iconbtn" aria-label="Mese successivo" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><Icon name="next" size={18} /></button>
        </div>
      </div>
      <p className="lead">Il budget totale è il tetto del mese. Puoi ritagliarne una parte per alcune categorie: se una categoria sfora, quello che spende in più si toglie da tutto il resto.</p>
      <ErrorBox error={error} />

      <section className="card">
        {!v.total || editing === '*' ? (
          <>
            <h2 className="h2">Budget totale del mese</h2>
            <AmountEditor label="Budget totale del mese" initial={v.total?.amount ?? null} onSave={(a) => put('*', a)} onRemove={v.total ? () => put('*', null) : undefined} />
          </>
        ) : (
          <>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="stack" style={{ gap: 4 }}>
                <span className="label">{v.total.left >= 0 ? 'Ti restano' : 'Hai superato il budget di'}</span>
                <span className="num money" style={{ font: `700 ${fitSize(eur(Math.abs(v.total.left)), 30)}px var(--f-display)`, color: v.total.left < 0 ? 'var(--neg)' : undefined }}>{eur(Math.abs(v.total.left))}</span>
              </div>
              <button className="btn small" onClick={() => setEditing('*')}>Modifica</button>
            </div>
            <BudgetBar spent={v.total.spent} amount={v.total.amount} dayPct={current ? dayPct : undefined} />
            <span className="muted" style={{ fontSize: 14 }}>
              Spesi <b className="num money" style={{ color: 'var(--ink)' }}>{eur(v.total.spent)}</b> di {eur(v.total.amount)}
              {current && v.total.left > 0 && <> · <b className="num money" style={{ color: 'var(--ink)' }}>{eur(v.total.per_day)}</b> al giorno per {daysLeft} {daysLeft === 1 ? 'giorno' : 'giorni'}</>}
            </span>
          </>
        )}
      </section>

      {v.total && (
        <>
          <span className="section-title">Per categoria</span>
          <div className="list">
            {v.categories.map((c) => (
              <div key={c.category_id} className="lrow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <button className="row" style={{ gap: 10, border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => setEditing(editing === c.category_id ? null : c.category_id)} aria-expanded={editing === c.category_id}>
                  <CategoryIcon id={c.category_id} size={32} />
                  <span className="grow" style={{ fontWeight: 600 }}>{store.catName(c.category_id)}</span>
                  <span className="num money" style={{ fontSize: 14 }}><b style={{ color: c.left < 0 ? 'var(--neg)' : undefined }}>{eur(c.spent)}</b> <span className="muted">di {eur(c.amount)}</span></span>
                </button>
                <BudgetBar spent={c.spent} amount={c.amount} dayPct={current ? dayPct : undefined} height={8} />
                {c.left < 0 && <span style={{ fontSize: 13, color: 'var(--neg)' }}>{eur(-c.left)} oltre il budget: tolti da tutto il resto</span>}
                {editing === c.category_id && <AmountEditor label={`Budget per ${store.catName(c.category_id)}`} initial={c.amount} onSave={(a) => put(c.category_id, a)} onRemove={() => put(c.category_id, null)} />}
              </div>
            ))}
            {v.rest && v.categories.length > 0 && (
              <div className="lrow" style={{ cursor: 'default', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className="lrow-ic"><Icon name="dots" size={18} /></span>
                  <span className="grow" style={{ fontWeight: 600 }}>Tutto il resto</span>
                  <span className="num money" style={{ fontSize: 14 }}><b style={{ color: v.rest.left < 0 ? 'var(--neg)' : 'var(--accent)' }}>{eur(v.rest.left)}</b> <span className="muted">liberi di {eur(v.rest.amount)}</span></span>
                </div>
                <BudgetBar spent={v.rest.amount - v.rest.left} amount={v.rest.amount} dayPct={current ? dayPct : undefined} height={8} />
              </div>
            )}
          </div>
          <section className="card">
            <h2 className="h2">Aggiungi un budget per categoria</h2>
            <CategorySelect value={newCat} kind="expense" onChange={setNewCat} />
            {newCat && <AmountEditor key={newCat} label="Budget della categoria" initial={null} onSave={(a) => put(newCat, a)} />}
          </section>
        </>
      )}
    </div>
  );
}
