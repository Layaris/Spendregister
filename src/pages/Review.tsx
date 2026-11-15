import { useState } from 'react';
import { api, type Tx } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, Money, TopBar } from '../ui';
import { formatMoney, formatWhen } from '../util';

export function Review() {
  const store = useStore();
  const list = useApi<{ items: Tx[] }>('/transactions?status=review&limit=200', [store.review_count]);
  const [error, setError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      store.toast(msg);
      await store.refresh();
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const ready = list.data?.items.filter((t) => t.category_id && !t.duplicate_of && !t.review_choices.length).length ?? 0;

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 16 }}>
      <TopBar backTo="/" right={ready > 0 ? (
        <button className="btn" onClick={() => act(() => api('/transactions/confirm-ready', { method: 'POST' }), `Confermati ${ready}`)}>Conferma i {ready} pronti</button>
      ) : undefined} />
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="page-title">Da rivedere</h1>
        <p className="lead">{list.data ? (list.data.items.length ? `${list.data.items.length} movimenti aspettano una tua scelta.` : 'Niente da rivedere.') : ''}</p>
      </div>
      <ErrorBox error={error ?? list.error} />
      {!list.data ? <Loading /> : list.data.items.map((t) => (
        <ReviewCard key={t.id} t={t}
          onConfirm={(category) => act(() => api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: category } }), `${t.merchant ?? 'Spesa'}: ${store.catName(category)}`)}
          onMerge={() => act(() => api(`/transactions/${t.id}/merge`, { method: 'POST' }), 'Doppione unito')}
          onDelete={() => act(() => api(`/transactions/${t.id}`, { method: 'DELETE' }), 'Movimento scartato')} />
      ))}
    </div>
  );
}

function ReviewCard({ t, onConfirm, onMerge, onDelete }: { t: Tx; onConfirm: (c: string | null) => void; onMerge: () => void; onDelete: () => void }) {
  const { catName } = useStore();
  const [category, setCategory] = useState<string | null>(t.category_id);
  const [picking, setPicking] = useState(false);
  return (
    <section className={`card ${t.duplicate_of ? 'warn' : ''}`}>
      <div className="row muted" style={{ fontSize: 12, fontWeight: 600, gap: 6 }}>
        <Icon name={t.duplicate_of ? 'copy' : 'bolt'} size={14} stroke={2} />
        {t.duplicate_of ? 'Possibile doppione' : `${t.source === 'capture' ? `Notifica${t.card ? ` ${t.card}` : ''}` : 'Inserito'} · ${formatWhen(t.occurred_at)}`}
      </div>
      <a href={`#/m/${t.id}`} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
        <CategoryIcon id={t.category_id} />
        <div className="grow stack" style={{ gap: 2 }}>
          <span style={{ fontWeight: 600, fontSize: 17 }}>{t.merchant ?? 'Spesa'}</span>
          <span className="muted" style={{ fontSize: 13 }}>{t.review_reason}</span>
        </div>
        <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
          <Money milli={t.amount_eur} className="" />
          {t.currency !== 'EUR' && <span className="muted num money" style={{ fontSize: 12 }}>{formatMoney(Math.abs(t.amount), t.currency)}</span>}
        </div>
      </a>
      {t.merchant_raw && t.merchant_raw !== t.merchant && <div className="raw">{t.merchant_raw}</div>}

      {t.duplicate_of ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn dark grow" onClick={onMerge}>Unisci in uno</button>
          <button className="btn" onClick={() => onConfirm(t.category_id)}>Sono due spese</button>
        </div>
      ) : t.review_choices.length > 0 && !picking ? (
        <div className="row" style={{ gap: 8 }}>
          {t.review_choices.map((c) => <button key={c} className="btn grow" onClick={() => onConfirm(c)}>{catName(c)}</button>)}
          <button className="btn" onClick={() => setPicking(true)}>Altro</button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <CategorySelect value={category} onChange={setCategory} kind={t.amount_eur > 0 ? 'all' : 'expense'} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" disabled={!category} onClick={() => onConfirm(category)}>Conferma {category ? catName(category) : ''}</button>
            <button className="btn" onClick={onDelete} aria-label="Scarta il movimento"><Icon name="trash" size={18} /></button>
          </div>
        </div>
      )}
    </section>
  );
}
