import { useState } from 'react';
import type { Stats as StatsData } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { ErrorBox, Loading } from '../ui';
import { eur, monthPeriod, NATURE_LABEL, pct } from '../util';

const NATURE_COLOR: Record<string, string> = { must: '#B4441C', need: '#E3A23B', want: '#2F8FA8' };

export function Stats() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const period = monthPeriod(offset);
  const { data: s, error } = useApi<StatsData>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);

  const natureTotal = s?.by_nature.reduce((a, n) => a + (n.nature ? n.total : 0), 0) ?? 0;
  const firstDow = (new Date(`${period.from}T00:00:00`).getDay() + 6) % 7;
  const daily = new Map(s?.daily.map((d) => [d.day, d.spent]) ?? []);
  const maxDay = Math.max(1, ...(s?.daily.map((d) => d.spent) ?? [1]));
  const days = s?.days.total ?? 30;

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <h1 className="page-title">Statistiche</h1>
      <div className="row between">
        <button className="iconbtn" aria-label="Mese precedente" onClick={() => setOffset(offset - 1)}><Icon name="back" size={20} /></button>
        <span style={{ fontWeight: 600, fontSize: 16 }}>{period.label}</span>
        <button className="iconbtn" aria-label="Mese successivo" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><Icon name="next" size={20} /></button>
      </div>
      <ErrorBox error={error} />
      {!s ? <Loading /> : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <Tile label="Spesa" value={eur(s.spent)} note={s.previous.spent ? `${eur(s.previous.spent)} il mese prima` : undefined} />
            <Tile label="Entrate" value={eur(s.income)} />
            <Tile label="Flusso di cassa" value={eur(s.income - s.spent, true)} tone={s.income - s.spent >= 0 ? 'good' : undefined} />
            <Tile label="Previsione fine mese" value={eur(s.forecast)} note={`dopo ${s.days.elapsed} di ${s.days.total} giorni`} />
          </div>

          {s.by_category.length > 0 && (
            <section className="card">
              <h2 className="h2">Per categoria</h2>
              {s.by_category.map((c) => (
                <a key={c.category_id ?? 'none'} href={c.category_id ? `#/movimenti/${c.category_id}` : '#/movimenti'} className="stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
                  <div className="row between" style={{ fontSize: 14 }}>
                    <span>{store.catName(c.category_id)} <span className="muted">· {c.count}</span></span>
                    <span className="num money" style={{ fontWeight: 600 }}>{eur(c.total)}</span>
                  </div>
                  <div className="bar"><div style={{ width: `${pct(c.total, s.by_category[0].total)}%`, background: store.cat(c.category_id)?.color ?? '#7D8790' }} /></div>
                </a>
              ))}
            </section>
          )}

          {natureTotal > 0 && (
            <section className="card">
              <h2 className="h2">Natura delle spese</h2>
              <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 }}>
                {(['must', 'need', 'want'] as const).map((n) => {
                  const v = s.by_nature.find((x) => x.nature === n)?.total ?? 0;
                  return v ? <div key={n} style={{ flex: v, background: NATURE_COLOR[n] }} /> : null;
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 13 }}>
                {(['must', 'need', 'want'] as const).map((n) => (
                  <div key={n} className="stack" style={{ gap: 2 }}>
                    <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: NATURE_COLOR[n] }} />{NATURE_LABEL[n]}</span>
                    <b className="num money">{eur(s.by_nature.find((x) => x.nature === n)?.total ?? 0)}</b>
                  </div>
                ))}
              </div>
            </section>
          )}

          {s.by_merchant.length > 0 && (
            <section className="card">
              <h2 className="h2">Merchant del mese</h2>
              {s.by_merchant.slice(0, 6).map((m) => (
                <div key={m.merchant} className="row between" style={{ fontSize: 14 }}>
                  <span>{m.merchant} <span className="muted">· {m.count} {m.count === 1 ? 'movimento' : 'movimenti'}</span></span>
                  <b className="num money">{eur(m.total)}</b>
                </div>
              ))}
            </section>
          )}

          <section className="card">
            <div className="row between"><h2 className="h2">Calendario della spesa</h2><span className="muted" style={{ fontSize: 12 }}>più scuro = più speso</span></div>
            <div className="heat muted" style={{ fontSize: 11, textAlign: 'center' }}>{['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <span key={i}>{d}</span>)}</div>
            <div className="heat">
              {Array.from({ length: firstDow }, (_, i) => <div key={`e${i}`} />)}
              {Array.from({ length: days }, (_, i) => {
                const day = `${period.from.slice(0, 8)}${String(i + 1).padStart(2, '0')}`;
                const v = daily.get(day) ?? 0;
                const level = v ? Math.min(4, Math.ceil((v / maxDay) * 4)) : 0;
                const bg = ['var(--sunken)', '#D3EDE3', '#8CCBB4', '#3E9C7D', '#0B7A5B'][level];
                return <div key={day} title={v ? eur(v) : undefined} style={{ background: bg, color: level >= 3 ? '#fff' : 'var(--ink)' }}>{i + 1}</div>;
              })}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'good' }) {
  return (
    <div className="card" style={{ gap: 6 }}>
      <span className="label" style={{ fontSize: 11 }}>{label}</span>
      <span className="big money" style={{ color: tone === 'good' ? 'var(--accent)' : undefined }}>{value}</span>
      {note && <span className="muted" style={{ fontSize: 12 }}>{note}</span>}
    </div>
  );
}
