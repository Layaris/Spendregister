import { useState, type ReactNode } from 'react';
import { api, type Tx } from './api';
import { Icon } from './icons';
import { back } from './router';
import { useApi, useStore } from './store';
import { eur, formatMoney } from './util';

export function CategoryIcon({ id, size = 40 }: { id: string | null | undefined; size?: number }) {
  const { cat, parentOf } = useStore();
  const c = cat(id);
  const p = parentOf(id);
  const color = c?.color ?? p?.color ?? '#7D8790';
  const icon = c?.icon ?? p?.icon ?? (id ? 'dots' : 'question');
  return (
    <div className="ic" style={{ width: size, height: size, background: `${color}22`, color }}>
      <Icon name={icon} size={Math.round(size * 0.55)} />
    </div>
  );
}

export function Money({ milli, currency = 'EUR', sign, className }: { milli: number; currency?: string; sign?: boolean; className?: string }) {
  return <span className={`num money ${className ?? ''}`}>{formatMoney(milli, currency, { sign })}</span>;
}

export function TxRow({ t }: { t: Tx }) {
  const { catName } = useStore();
  const foreign = t.currency !== 'EUR';
  return (
    <a href={`#/m/${t.id}`} className="txrow">
      <CategoryIcon id={t.category_id} />
      <div className="grow stack" style={{ gap: 3 }}>
        <span style={{ fontWeight: 600 }}>{t.merchant ?? t.note ?? catName(t.category_id)}</span>
        <span className="muted" style={{ fontSize: 13 }}>{catName(t.category_id)}</span>
        {t.status === 'review' ? (
          <span className="chip warn">Da rivedere</span>
        ) : t.source === 'capture' ? (
          <span className="chip ok"><Icon name="bolt" size={12} stroke={2.2} />Auto{t.card ? ` · ${t.card}` : ''}</span>
        ) : null}
      </div>
      <div className="amt">
        <span className="num money" style={{ fontWeight: 600, color: t.amount_eur > 0 ? 'var(--pos)' : undefined }}>{eur(t.amount_eur, t.amount_eur > 0)}</span>
        {foreign && <span className="muted num money" style={{ fontSize: 12 }}>{formatMoney(Math.abs(t.amount), t.currency)}</span>}
      </div>
    </a>
  );
}

export function TopBar({ title, right, backTo = '/' }: { title?: string; right?: ReactNode; backTo?: string }) {
  return (
    <div className="row between">
      <button className="iconbtn" aria-label="Indietro" onClick={() => back(backTo)}><Icon name="back" /></button>
      {title && <span style={{ fontFamily: 'var(--f-display)', fontWeight: 600, fontSize: 17 }}>{title}</span>}
      <div style={{ minWidth: 44, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  );
}

/** Scelta della categoria: un pannello dal basso con ricerca, gruppi, sottocategorie e "+ nuova" con un tap. */
export function CategorySelect({ value, onChange, kind = 'expense', id }: { value: string | null; onChange: (v: string | null) => void; kind?: 'expense' | 'income' | 'all'; id?: string }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const c = store.cat(value);
  const parent = c?.parent_id ? store.cat(c.parent_id) : null;
  return (
    <>
      <button type="button" id={id} className="input catbtn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="dot" style={{ background: c?.color ?? parent?.color ?? 'var(--line)' }} />
        <span className="grow" style={{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c ? (parent ? <><span className="muted">{parent.name} › </span>{c.name}</> : c.name) : <span className="muted">Senza categoria</span>}
        </span>
        <span aria-hidden="true" className="muted">▾</span>
      </button>
      {open && <CategorySheet value={value} kind={kind} onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
    </>
  );
}

export function CategorySheet({ value, kind, onPick, onClose }: { value: string | null; kind: 'expense' | 'income' | 'all'; onPick: (v: string | null) => void; onClose: () => void }) {
  const store = useStore();
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState<string | null>(null); // id del gruppo, oppure 'root' per un gruppo nuovo
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const match = (s: string) => !q || norm(s).includes(norm(q));
  const groups = store.categories.filter((c) => !c.parent_id && (kind === 'all' || c.kind === kind));
  const create = async () => {
    if (!name.trim()) return;
    setError(null);
    try {
      const parent = adding === 'root' ? null : adding;
      const groupKind = parent ? store.cat(parent)?.kind : kind === 'income' ? 'income' : 'expense';
      const r = await api<{ id: string }>('/categories', { method: 'POST', json: { name: name.trim(), parent_id: parent, kind: groupKind } });
      await store.refresh();
      store.toast(`Categoria “${name.trim()}” creata`);
      onPick(r.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addForm = (
    <div className="row" style={{ gap: 6 }}>
      <input className="input grow" autoFocus placeholder={adding === 'root' ? 'Nome della nuova categoria' : 'Nome della sottocategoria'} value={name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create(); }} />
      <button className="btn primary" disabled={!name.trim()} onClick={create}>Crea</button>
    </div>
  );
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Scegli la categoria" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 className="h2">Categoria</h2><button className="btn ghost" onClick={onClose}>Chiudi</button></div>
        <input className="input" type="search" placeholder="Cerca" value={q} onChange={(e) => setQ(e.target.value)} />
        <ErrorBox error={error} />
        <div className="stack" style={{ gap: 14, overflowY: 'auto', paddingBottom: 4 }}>
          <button className="pill" aria-pressed={value == null} style={{ alignSelf: 'flex-start' }} onClick={() => onPick(null)}>Senza categoria</button>
          {groups.map((g) => {
            const kids = store.categories.filter((c) => c.parent_id === g.id);
            const shown = kids.filter((c) => match(c.name) || match(g.name));
            if (q && !shown.length && !match(g.name)) return null;
            return (
              <div key={g.id} className="stack" style={{ gap: 8 }}>
                <button className="row catgroup" aria-pressed={value === g.id} onClick={() => onPick(g.id)}>
                  <span className="dot" style={{ background: g.color ?? 'var(--line)', width: 10, height: 10 }} />{g.name}
                </button>
                <div className="row wrap" style={{ gap: 6 }}>
                  {shown.map((c) => <button key={c.id} className="pill small" aria-pressed={value === c.id} onClick={() => onPick(c.id)}>{c.name}</button>)}
                  {adding !== g.id && <button className="pill small add" onClick={() => { setAdding(g.id); setName(q); }}>+ Sottocategoria</button>}
                </div>
                {adding === g.id && addForm}
              </div>
            );
          })}
          {adding === 'root' ? addForm : <button className="btn" onClick={() => { setAdding('root'); setName(q); }}>+ Nuova categoria</button>}
          <a href="#/categorie" className="muted" style={{ fontSize: 14, alignSelf: 'center' }} onClick={onClose}>Gestisci le categorie</a>
        </div>
      </div>
    </div>
  );
}

export interface CardInfo { name: string; count: number; month_spent: number; sources: string[] }

/** Scelta della carta o banca: quelle già conosciute con un tocco, oppure una nuova. */
export function CardSheet({ value, onPick, onClose, extra }: { value: string | null; onPick: (card: string | null) => void; onClose: () => void; extra?: ReactNode }) {
  const { data } = useApi<{ items: CardInfo[] }>('/cards');
  const [name, setName] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Carta o banca" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 className="h2">Con quale carta?</h2><button className="btn ghost" onClick={onClose}>Chiudi</button></div>
        <span className="muted" style={{ fontSize: 14 }}>Vale per questa notifica e per tutte quelle con lo stesso titolo, già arrivate e future.</span>
        <div className="list" style={{ overflowY: 'auto', flexShrink: 1 }}>
          {data?.items.map((c) => (
            <button key={c.name} className="lrow" onClick={() => onPick(c.name)}>
              <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="card" size={18} /></span>
              <span className="grow" style={{ fontWeight: 600 }}>{c.name}</span>
              {value === c.name ? <Icon name="check" size={20} /> : <span className="muted" style={{ fontSize: 13 }}>{c.count} spese</span>}
            </button>
          ))}
          {value && (
            <button className="lrow" onClick={() => onPick(null)}>
              <span className="lrow-ic"><Icon name="close" size={18} /></span>
              <span className="grow muted">Nessuna carta</span>
            </button>
          )}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input className="input grow" placeholder="Nuova carta, es. Xplace" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onPick(name.trim()); }} />
          <button className="btn primary" disabled={!name.trim()} onClick={() => onPick(name.trim())}>Usa</button>
        </div>
        {extra}
      </div>
    </div>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

export function Loading() {
  return <div className="empty">Caricamento…</div>;
}
