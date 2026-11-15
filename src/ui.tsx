import type { ReactNode } from 'react';
import type { Tx } from './api';
import { Icon } from './icons';
import { back } from './router';
import { useStore } from './store';
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
        <span className="num money" style={{ fontWeight: 600, color: t.amount_eur > 0 ? 'var(--accent)' : undefined }}>{eur(t.amount_eur, t.amount_eur > 0)}</span>
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

export function CategorySelect({ value, onChange, kind = 'expense', id }: { value: string | null; onChange: (v: string | null) => void; kind?: 'expense' | 'income' | 'all'; id?: string }) {
  const { categories } = useStore();
  const parents = categories.filter((c) => !c.parent_id && (kind === 'all' || c.kind === kind));
  return (
    <select id={id} className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">Senza categoria</option>
      {parents.map((p) => (
        <optgroup key={p.id} label={p.name}>
          <option value={p.id}>{p.name}</option>
          {categories.filter((c) => c.parent_id === p.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <div className="error" role="alert">{error}</div> : null;
}

export function Loading() {
  return <div className="empty">Caricamento…</div>;
}
