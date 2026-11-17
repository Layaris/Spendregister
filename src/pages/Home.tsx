import { useState, type ReactNode } from 'react';
import { api, type Stats, type Tx } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CategoryIcon, Money, TxRow } from '../ui';
import { eur, formatDayShort, formatMoney, monthPeriod, pct, relativeTime } from '../util';

interface Device { id: string; name: string; last_seen_at: string | null; last_capture_at: string | null }

/** Schede della Home: si accendono, si spengono e si riordinano (Personalizza). */
export const HOME_WIDGETS: Array<[string, string]> = [
  ['hero', 'Speso nel mese e saldo'], ['review', 'Da rivedere'], ['capture', 'Stato della cattura'], ['accounts', 'Conti'],
  ['cashflow', 'Entrate e uscite'], ['balance', 'Andamento del saldo'], ['top', 'Spese principali'], ['cards', 'Spesa per carta'], ['recent', 'Ultimi movimenti'],
];
export const DEFAULT_HOME = ['hero', 'review', 'capture', 'accounts', 'cashflow', 'top', 'cards', 'recent'];

export function Home() {
  const store = useStore();
  const [offset, setOffset] = useState(0);
  const [customize, setCustomize] = useState(false);
  const layout = store.settings.home_layout ?? DEFAULT_HOME;
  const on = (k: string) => layout.includes(k);
  const period = monthPeriod(offset);
  const stats = useApi<Stats>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);
  const balance = useApi<{ series: Array<{ day: string; balance: number }> }>(on('balance') ? '/stats/balance?days=30' : null, [store.review_count]);
  const now = useApi<{ series: Array<{ day: string; balance: number }> }>(on('hero') ? '/stats/balance?days=1' : null, [store.review_count]);
  const total = now.data?.series.at(-1)?.balance ?? null;
  const recent = useApi<{ items: Tx[] }>('/transactions?limit=5', [store.review_count]);
  const review = useApi<{ items: Tx[] }>('/transactions?status=review&limit=1', [store.review_count]);
  const devices = useApi<{ items: Device[] }>('/capture/devices');

  const s = stats.data;
  const firstReview = review.data?.items[0];
  const lastCapture = devices.data?.items.map((d) => d.last_capture_at).filter(Boolean).sort().pop() ?? null;
  const stale = devices.data?.items.filter((d) => !d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 26 * 3600_000) ?? [];
  const diff = s && s.previous.spent > 0 ? Math.round(((s.spent - s.previous.spent) / s.previous.spent) * 100) : null;
  const daysLeft = s ? Math.max(s.days.total - s.days.elapsed, 0) : 0;
  const monthName = offset === 0 ? 'questo mese' : 'nel mese';

  const resolve = async (t: Tx, category: string) => {
    await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: category } });
    store.toast(`${t.merchant ?? 'Spesa'}: ${store.catName(category)}`);
    await store.refresh();
  };

  const widgets: Record<string, ReactNode> = {
    hero: (
      <section className="card hero">
        <div className="row between">
          <span className="label">Speso {monthName}</span>
          {diff != null && <span className={`chip ${diff > 0 ? 'warn' : 'ok'}`} title="Rispetto allo stesso periodo del mese prima">{diff > 0 ? '+' : ''}{diff}% sul mese prima</span>}
        </div>
        <span className="hero-amount num money">{s ? eur(s.spent) : '…'}</span>
        <div className="metrics">
          <div className="metric" title="Somma dei conti, in valuta di visualizzazione">
            <span>Saldo totale</span>
            <b className={`num money ${total != null && total < 0 ? 'neg' : ''}`}>{total != null ? eur(total) : '…'}</b>
          </div>
          <div className="metric">
            <span>Al giorno</span>
            <b className="num money">{s ? eur(s.days.elapsed ? Math.round(s.spent / s.days.elapsed) : 0) : '…'}</b>
          </div>
          {offset === 0 && daysLeft > 0 ? (
            <div className="metric">
              <span>Previsione</span>
              <b className="num money">{s ? eur(s.forecast) : '…'}</b>
            </div>
          ) : (
            <div className="metric">
              <span>Entrate</span>
              <b className="num money pos">{s ? eur(s.income) : '…'}</b>
            </div>
          )}
        </div>
      </section>
    ),
    capture: (
      <a href="#/cattura" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}>
        <span className={`dot ${stale.length ? 'warn' : ''}`} />
        <span className="grow" style={{ fontSize: 14 }}>
          {!devices.data?.items.length ? 'Collega un telefono per registrare le spese da sole'
            : stale.length ? `${stale.map((d) => d.name).join(', ')}: nessun segnale da oltre un giorno`
            : `Cattura attiva su ${devices.data.items.length} ${devices.data.items.length === 1 ? 'dispositivo' : 'dispositivi'} · ultima spesa ${relativeTime(lastCapture)}`}
        </span>
        <Icon name="next" size={18} />
      </a>
    ),
    review: store.review_count > 0 && firstReview ? (
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
            {firstReview.review_choices.map((c) => <button key={c} className="btn grow" onClick={() => resolve(firstReview, c)}>{store.catName(c)}</button>)}
          </div>
        )}
        <a href="#/rivedere" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Rivedi {store.review_count === 1 ? 'il movimento' : `tutti e ${store.review_count}`}</a>
      </section>
    ) : null,
    accounts: store.accounts.length > 0 ? (
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
    ) : null,
    cashflow: s ? (
      <a href="#/statistiche/flusso" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="row between">
          <h2 className="h2">Entrate e uscite</h2>
          <span className={`num money ${s.income - s.spent >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 700, fontSize: 18 }}>{eur(s.income - s.spent, true)}</span>
        </div>
        {[['Entrate', s.income, 'var(--pos)'], ['Uscite', s.spent, 'var(--neg)']].map(([label, v, color]) => (
          <div key={label as string} className="stack" style={{ gap: 6 }}>
            <span className="row between" style={{ fontSize: 15 }}><span>{label as string}</span><b className="num money">{eur(v as number)}</b></span>
            <span className="bar" style={{ height: 12, borderRadius: 6 }}><span style={{ display: 'block', height: '100%', borderRadius: 6, width: `${((v as number) / Math.max(s.income, s.spent, 1)) * 100}%`, background: color as string }} /></span>
          </div>
        ))}
      </a>
    ) : null,
    balance: balance.data && balance.data.series.length > 1 ? <BalanceCard series={balance.data.series} /> : null,
    top: s && s.by_category.length > 0 ? (
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
    ) : null,
    cards: s && s.by_card.some((x) => x.card) ? (
      <a href="#/carte" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <div className="row between"><h2 className="h2">Spesa per carta</h2><Icon name="next" size={18} /></div>
        <span className="muted" style={{ fontSize: 13, marginTop: -6 }}>Le stesse spese del totale, divise per carta.</span>
        {s.by_card.slice(0, 5).map((x) => (
          <div key={x.card ?? 'none'} className="stack" style={{ gap: 6 }}>
            <span className="row between" style={{ fontSize: 14 }}>
              <span>{x.card ?? <span className="muted">Senza carta</span>}</span>
              <span className="num money" style={{ fontWeight: 600 }}>{eur(x.total)} <span className="muted" style={{ fontWeight: 400 }}>· {Math.round((x.total / s.spent) * 100)}%</span></span>
            </span>
            <div className="bar"><div style={{ width: `${(x.total / s.spent) * 100}%`, background: x.card ? 'var(--accent)' : '#A9B6C7' }} /></div>
          </div>
        ))}
      </a>
    ) : null,
    recent: (
      <section className="card">
        <div className="row between">
          <h2 className="h2">Ultimi movimenti</h2>
          <a href="#/movimenti" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Tutti</a>
        </div>
        {recent.data?.items.length ? recent.data.items.map((t) => <TxRow key={t.id} t={t} />) : (
          <p className="empty" style={{ padding: 8 }}>Nessun movimento. Aggiungine uno con + oppure collega un telefono.</p>
        )}
      </section>
    ),
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
          <button className="iconbtn" aria-label="Personalizza la Home" onClick={() => setCustomize(true)}><Icon name="rules" /></button>
          <button className="iconbtn" aria-label={store.discreet ? 'Mostra i saldi' : 'Nascondi i saldi'} aria-pressed={store.discreet} onClick={() => store.setDiscreet(!store.discreet)}><Icon name="eye" /></button>
        </div>
      </div>

      {!store.account.email && (
        <a href="#/account/crea" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}>
          <span className="grow" style={{ fontSize: 14 }}>Stai usando Ledgy senza account. <b>Crea un account</b> per non perdere i dati.</span>
          <Icon name="next" size={18} />
        </a>
      )}

      {layout.map((k) => widgets[k] ? <div key={k} className="stack" style={{ gap: 0 }}>{widgets[k]}</div> : null)}

      {customize && <CustomizeHome layout={layout} onClose={() => setCustomize(false)} />}
    </div>
  );
}

/** Pannello "Personalizza": accendi, spegni e sposta le schede della Home. Si salva nell'account. */
function CustomizeHome({ layout, onClose }: { layout: string[]; onClose: () => void }) {
  const store = useStore();
  const [order, setOrder] = useState<string[]>(() => [...layout, ...HOME_WIDGETS.map(([k]) => k).filter((k) => !layout.includes(k))]);
  const [enabled, setEnabled] = useState<Set<string>>(() => new Set(layout));
  const label = Object.fromEntries(HOME_WIDGETS);
  const save = async (nextOrder: string[], nextOn: Set<string>) => {
    setOrder(nextOrder);
    setEnabled(new Set(nextOn));
    await api('/settings', { method: 'PUT', json: { home_layout: nextOrder.filter((k) => nextOn.has(k)) } });
    await store.refresh();
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    save(next, enabled);
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Personalizza la Home" onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h2 className="h2">Personalizza la Home</h2><button className="btn ghost" onClick={onClose}>Fatto</button></div>
        <span className="muted" style={{ fontSize: 14 }}>Accendi le schede che vuoi e mettile nell’ordine che preferisci.</span>
        <div className="list" style={{ overflowY: 'auto' }}>
          {order.map((k, i) => (
            <div key={k} className="lrow" style={{ cursor: 'default', opacity: enabled.has(k) ? 1 : 0.55 }}>
              <button role="switch" aria-checked={enabled.has(k)} aria-label={`${enabled.has(k) ? 'Nascondi' : 'Mostra'} ${label[k]}`}
                onClick={() => { const n = new Set(enabled); if (n.has(k)) n.delete(k); else n.add(k); save(order, n); }}
                style={{ width: 44, height: 27, borderRadius: 14, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: enabled.has(k) ? 'var(--accent)' : 'var(--line)' }}>
                <span style={{ position: 'absolute', top: 2, left: enabled.has(k) ? 19 : 2, width: 23, height: 23, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
              </button>
              <span className="grow" style={{ fontWeight: 600 }}>{label[k]}</span>
              <button className="iconbtn" style={{ width: 36, height: 36 }} aria-label={`Sposta su ${label[k]}`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="income" size={18} /></button>
              <button className="iconbtn" style={{ width: 36, height: 36, transform: 'rotate(180deg)' }} aria-label={`Sposta giù ${label[k]}`} disabled={i === order.length - 1} onClick={() => move(i, 1)}><Icon name="income" size={18} /></button>
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => save(DEFAULT_HOME.concat(HOME_WIDGETS.map(([k]) => k).filter((k) => !DEFAULT_HOME.includes(k))), new Set(DEFAULT_HOME))}>Torna alla disposizione iniziale</button>
      </div>
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
