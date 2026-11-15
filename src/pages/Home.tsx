import { useState } from 'react';
import { api, type Stats, type Tx } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, Money, TxRow } from '../ui';
import { eur, formatDayShort, formatMoney, monthPeriod, pct, relativeTime } from '../util';

interface Device { id: string; name: string; last_seen_at: string | null; last_capture_at: string | null }

export function Home() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const period = monthPeriod(offset);
  const stats = useApi<Stats>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);
  const balance = useApi<{ series: Array<{ day: string; balance: number }> }>('/stats/balance?days=30', [store.review_count]);
  const recent = useApi<{ items: Tx[] }>('/transactions?limit=5', [store.review_count]);
  const review = useApi<{ items: Tx[] }>('/transactions?status=review&limit=1', [store.review_count]);
  const devices = useApi<{ items: Device[] }>('/capture/devices');

  const s = stats.data;
  const firstReview = review.data?.items[0];
  const lastCapture = devices.data?.items.map((d) => d.last_capture_at).filter(Boolean).sort().pop() ?? null;
  const stale = devices.data?.items.filter((d) => !d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 26 * 3600_000) ?? [];
  const diff = s && s.previous.spent > 0 ? Math.round(((s.spent - s.previous.spent) / s.previous.spent) * 100) : null;
  const daysLeft = s ? Math.max(s.days.total - s.days.elapsed, 0) : 0;

  const resolve = async (t: Tx, category: string) => {
    await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: category } });
    store.toast(`${t.merchant ?? 'Spesa'}: ${store.catName(category)}`);
    await store.refresh();
  };

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 16 }}>
      <div className="row between">
        <div className="row" style={{ gap: 4, background: 'var(--card)', borderRadius: 12, padding: '0 4px' }}>
          <button className="iconbtn" style={{ width: 36 }} aria-label="Mese precedente" onClick={() => setOffset(offset - 1)}><Icon name="back" size={18} /></button>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{period.label}</span>
          <button className="iconbtn" style={{ width: 36 }} aria-label="Mese successivo" onClick={() => setOffset(offset + 1)} disabled={offset >= 0}><Icon name="next" size={18} /></button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="iconbtn" aria-label={store.discreet ? 'Mostra i saldi' : 'Nascondi i saldi'} aria-pressed={store.discreet} onClick={() => store.setDiscreet(!store.discreet)}><Icon name="eye" /></button>
          <a className="iconbtn dark" href="#/assistente" aria-label="Chiedi a Ledgy"><Icon name="sparkle" /></a>
        </div>
      </div>

      <div className="stack" style={{ gap: 8, padding: '0 4px' }}>
        <span className="label">Speso {offset === 0 ? 'questo mese' : 'nel mese'}</span>
        <span className="hero-amount num money">{s ? eur(s.spent) : '…'}</span>
        {s && (
          <div className="row wrap" style={{ gap: 8 }}>
            {offset === 0 && daysLeft > 0 && <span className="chip ok" style={{ fontSize: 13, padding: '5px 10px' }}>Previsione fine mese {eur(s.forecast)}</span>}
            {diff != null && <span className="chip" style={{ fontSize: 13, padding: '5px 10px', background: 'var(--card)' }}>{diff > 0 ? '+' : ''}{diff}% rispetto al mese prima</span>}
          </div>
        )}
      </div>

      <a href="#/cattura" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}>
        <span className={`dot ${stale.length ? 'warn' : ''}`} />
        <span className="grow" style={{ fontSize: 14 }}>
          {!devices.data?.items.length ? 'Collega un telefono per registrare le spese da sole'
            : stale.length ? `${stale.map((d) => d.name).join(', ')}: nessun segnale da oltre un giorno`
            : `Cattura attiva su ${devices.data.items.length} ${devices.data.items.length === 1 ? 'dispositivo' : 'dispositivi'} · ultima spesa ${relativeTime(lastCapture)}`}
        </span>
        <Icon name="next" size={18} />
      </a>

      {store.review_count > 0 && firstReview && (
        <section className="card warn">
          <div className="row between">
            <h2 className="h2">Da rivedere</h2>
            <span className="chip warn">{store.review_count}</span>
          </div>
          <div className="row">
            <CategoryIcon id={firstReview.category_id} />
            <div className="grow stack" style={{ gap: 2 }}>
              <span style={{ fontWeight: 600 }}>{firstReview.merchant ?? 'Spesa'} · <Money milli={firstReview.amount_eur} /></span>
              <span className="muted" style={{ fontSize: 13 }}>{firstReview.review_reason}</span>
            </div>
          </div>
          {firstReview.review_choices.length > 0 && (
            <div className="row" style={{ gap: 8 }}>
              {firstReview.review_choices.map((c) => (
                <button key={c} className="btn grow" onClick={() => resolve(firstReview, c)}>{store.catName(c)}</button>
              ))}
            </div>
          )}
          <a href="#/rivedere" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Rivedi {store.review_count === 1 ? 'il movimento' : `tutti e ${store.review_count}`}</a>
        </section>
      )}

      {store.accounts.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2 className="h2" style={{ padding: '0 4px' }}>Conti</h2>
          <div className="pills" style={{ gap: 10 }}>
            {store.accounts.map((a) => (
              <div key={a.id} className="card" style={{ minWidth: 150, gap: 4 }}>
                <span className="muted" style={{ fontSize: 13 }}>{a.name}</span>
                <span className="big money" style={{ fontSize: 20 }}>{formatMoney(a.balance, a.currency)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {balance.data && balance.data.series.length > 1 && <BalanceCard series={balance.data.series} />}

      {s && s.by_category.length > 0 && (
        <section className="card">
          <h2 className="h2">Spese principali</h2>
          {s.by_category.slice(0, 4).map((c) => (
            <a key={c.category_id ?? 'none'} href={c.category_id ? `#/movimenti/${c.category_id}` : '#/movimenti'} className="stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
              <div className="row between" style={{ fontSize: 14 }}>
                <span>{store.catName(c.category_id)}</span>
                <span className="num money" style={{ fontWeight: 600 }}>{eur(c.total)}</span>
              </div>
              <div className="bar"><div style={{ width: `${pct(c.total, s.by_category[0].total)}%`, background: store.cat(c.category_id)?.color ?? '#7D8790' }} /></div>
            </a>
          ))}
        </section>
      )}

      <section className="card">
        <div className="row between">
          <h2 className="h2">Ultimi movimenti</h2>
          <a href="#/movimenti" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Tutti</a>
        </div>
        {recent.data?.items.length ? recent.data.items.map((t) => <TxRow key={t.id} t={t} />) : (
          <p className="empty" style={{ padding: 8 }}>Nessun movimento. Aggiungine uno con + oppure collega un telefono.</p>
        )}
      </section>
    </div>
  );
}

function BalanceCard({ series }: { series: Array<{ day: string; balance: number }> }) {
  const w = 320;
  const h = 96;
  const values = series.map((p) => p.balance);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = series.map((p, i) => [(i / (series.length - 1)) * (w - 8) + 4, h - 8 - ((p.balance - min) / span) * (h - 16)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <section className="card">
      <div className="row between">
        <h2 className="h2">Andamento saldo</h2>
        <span className="num money" style={{ fontWeight: 600 }}>{eur(values[values.length - 1])}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Andamento del saldo negli ultimi 30 giorni" preserveAspectRatio="none">
        <path d={`${line} L${last[0]} ${h} L4 ${h} Z`} fill="var(--accent-soft)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={last[0]} cy={last[1]} r={4} fill="var(--accent)" />
      </svg>
      <div className="row between muted" style={{ fontSize: 12 }}><span>{formatDayShort(series[0].day)}</span><span>oggi</span></div>
    </section>
  );
}
