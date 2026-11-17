// Viaggi: luogo e date. Le spese restano nelle loro categorie; qui si vede quanto è costato il viaggio.
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { useApi, useStore } from '../store';
import { CategoryIcon, ErrorBox, Loading, TopBar } from '../ui';
import { eur, fitSize, formatDayShort, formatMoney, localDay, pct } from '../util';

interface TripRow { id: string; name: string; place: string | null; start_date: string; end_date: string; spent: number }
interface TripView extends TripRow {
  days: number; count: number; income: number; per_day: number; normal_per_day: number | null;
  by_category: Array<{ category_id: string | null; total: number; count: number }>;
  by_currency: Array<{ currency: string; amount: number; eur: number }>;
}

const range = (a: string, b: string) => (a.slice(0, 4) === b.slice(0, 4) ? `${formatDayShort(a)} – ${formatDayShort(b)} ${b.slice(0, 4)}` : `${formatDayShort(a)} ${a.slice(0, 4)} – ${formatDayShort(b)} ${b.slice(0, 4)}`);

function TripForm({ initial, onSaved, onCancel }: { initial?: TripRow; onSaved: (id: string) => void; onCancel?: () => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [place, setPlace] = useState(initial?.place ?? '');
  const [start, setStart] = useState(initial?.start_date ?? localDay());
  const [end, setEnd] = useState(initial?.end_date ?? localDay());
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    try {
      const json = { name, place, start_date: start, end_date: end };
      if (initial) { await api(`/trips/${initial.id}`, { method: 'PUT', json }); onSaved(initial.id); }
      else onSaved((await api<{ id: string }>('/trips', { method: 'POST', json })).id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="card">
      <h2 className="h2">{initial ? 'Modifica il viaggio' : 'Nuovo viaggio'}</h2>
      <label className="field"><span>Nome</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Bangkok" /></label>
      <label className="field"><span>Luogo (facoltativo)</span><input className="input" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Es. Thailandia" /></label>
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Dal</span><input className="input" type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="field grow"><span>Al</span><input className="input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        {onCancel && <button className="btn grow" onClick={onCancel}>Annulla</button>}
        <button className="btn primary grow" disabled={!name.trim()} onClick={save}>Salva</button>
      </div>
    </section>
  );
}

export function Trips() {
  const list = useApi<{ items: TripRow[] }>('/trips');
  const [adding, setAdding] = useState(false);
  const today = localDay();
  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/altro" right={!adding ? <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={18} />Nuovo</button> : undefined} />
      <h1 className="page-title">Viaggi</h1>
      <p className="lead">Scegli luogo e date: Ledgy ti dice quanto hai speso in viaggio. Le spese restano nelle loro categorie (il ristorante resta Ristoranti).</p>
      {adding && <TripForm onSaved={(id) => go(`/viaggi/${id}`)} onCancel={() => setAdding(false)} />}
      {!list.data ? <Loading /> : !list.data.items.length && !adding ? <p className="empty">Nessun viaggio. Creane uno con Nuovo.</p> : (
        <div className="list">
          {list.data.items.map((t) => (
            <a key={t.id} href={`#/viaggi/${t.id}`} className="lrow">
              <span className="lrow-ic" style={{ background: 'var(--blue-soft)', color: 'var(--blue-ink)' }}><Icon name="plane" size={18} /></span>
              <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{t.name}{t.start_date <= today && today <= t.end_date ? <span className="chip ok" style={{ marginLeft: 6 }}>In corso</span> : null}</span>
                <span className="muted" style={{ fontSize: 13 }}>{range(t.start_date, t.end_date)}{t.place ? ` · ${t.place}` : ''}</span>
              </span>
              <b className="num money">{eur(t.spent)}</b>
              <Icon name="next" size={18} />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function TripDetail({ id }: { id: string }) {
  const store = useStore();
  const v = useApi<TripView>(`/trips/${id}`, [store.review_count]);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  if (v.error) return <div className="stack"><TopBar backTo="/viaggi" /><ErrorBox error={v.error} /></div>;
  if (!v.data) return <Loading />;
  const t = v.data;
  const diff = t.normal_per_day ? Math.round(((t.per_day - t.normal_per_day) / t.normal_per_day) * 100) : null;
  const showMovements = () => {
    try { sessionStorage.setItem('ledgy-filters', JSON.stringify({ trip: t.id })); } catch { /* ignora */ }
    go('/movimenti');
  };
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <TopBar backTo="/viaggi" right={<button className="btn small" onClick={() => setEditing(!editing)}>Modifica</button>} />
      <div className="stack" style={{ gap: 2 }}>
        <h1 className="page-title" style={{ margin: 0 }}>{t.name}</h1>
        <span className="muted">{range(t.start_date, t.end_date)} · {t.days} {t.days === 1 ? 'giorno' : 'giorni'}{t.place ? ` · ${t.place}` : ''}</span>
      </div>
      {editing && <TripForm initial={t} onSaved={() => { setEditing(false); v.reload(); }} onCancel={() => setEditing(false)} />}
      <section className="card">
        <span className="label">Speso in viaggio</span>
        <span className="num money" style={{ font: `700 ${fitSize(eur(t.spent), 32)}px var(--f-display)` }}>{eur(t.spent)}</span>
        <span className="muted" style={{ fontSize: 14 }}>
          <b className="num money" style={{ color: 'var(--ink)' }}>{eur(t.per_day)}</b> al giorno
          {diff != null && <> · {diff >= 0 ? `+${diff}%` : `${diff}%`} rispetto ai giorni normali ({eur(t.normal_per_day!)} al giorno)</>}
        </span>
        <button className="btn" onClick={showMovements}>Vedi i {t.count} movimenti</button>
      </section>
      {t.by_category.length > 0 && (
        <section className="card">
          <h2 className="h2">Per categoria</h2>
          {t.by_category.slice(0, 8).map((c) => (
            <div key={c.category_id ?? 'none'} className="row" style={{ gap: 10 }}>
              <CategoryIcon id={c.category_id} size={32} />
              <div className="grow stack" style={{ gap: 5 }}>
                <span className="row between" style={{ fontSize: 14 }}><span>{store.catName(c.category_id)}</span><b className="num money">{eur(c.total)}</b></span>
                <div className="bar"><div style={{ width: `${pct(c.total, t.by_category[0].total)}%`, background: store.cat(c.category_id)?.color ?? 'var(--accent)' }} /></div>
              </div>
            </div>
          ))}
        </section>
      )}
      {t.by_currency.length > 1 && (
        <section className="card">
          <h2 className="h2">Per valuta</h2>
          {t.by_currency.map((c) => (
            <div key={c.currency} className="row between" style={{ fontSize: 14 }}>
              <span className="num money">{formatMoney(c.amount, c.currency)}</span><b className="num money">{eur(c.eur)}</b>
            </div>
          ))}
        </section>
      )}
      <p className="muted" style={{ fontSize: 13, margin: 0, padding: '0 6px' }}>Per aggiungere una spesa fuori dalle date (es. il volo comprato prima) o togliere quella che non c’entra, apri il movimento e scegli il viaggio.</p>
      {confirm ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} onClick={async () => { await api(`/trips/${t.id}`, { method: 'DELETE' }); go('/viaggi'); }}>Elimina il viaggio</button>
          <button className="btn" onClick={() => setConfirm(false)}>Annulla</button>
        </div>
      ) : <button className="btn ghost" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={() => setConfirm(true)}>Elimina il viaggio (i movimenti restano)</button>}
    </div>
  );
}

/** Riga del dettaglio di un movimento: in quale viaggio è, e per cambiarlo. */
export function TripRowForTx({ txId }: { txId: string }) {
  const trips = useApi<{ items: TripRow[] }>('/trips');
  const of = useApi<{ trip: { id: string; name: string } | null }>(`/trips/of/${txId}`);
  if (!trips.data?.items.length || !of.data) return null;
  return (
    <label className="lrow">
      <span className="lrow-ic"><Icon name="plane" size={18} /></span>
      <span className="lrow-label">Viaggio</span>
      <select className="lrow-input" style={{ textAlign: 'right', border: 0, background: 'transparent', font: 'inherit', color: 'inherit' }} aria-label="Viaggio"
        value={of.data.trip?.id ?? ''} onChange={async (e) => { await api(`/trips/of/${txId}`, { method: 'PUT', json: { trip_id: e.target.value || null } }); of.reload(); }}>
        <option value="">Nessuno</option>
        {trips.data.items.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </label>
  );
}
