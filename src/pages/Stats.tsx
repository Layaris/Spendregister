// Statistiche come in Wallet: schede riassuntive (Saldo, Spesa, Flusso di cassa, Previsioni, Entrate),
// ognuna con il suo dettaglio, e il periodo scelto in basso uguale per tutte.
import { useState } from 'react';
import type { Stats as StatsData, Tx } from '../api';
import { Icon } from '../icons';
import { setPeriod, usePeriodSpec } from '../period';
import { PeriodSheet, periodArrows } from '../PeriodSheet';
import { go } from '../router';
import { useApi, useStore } from '../store';
import { ErrorBox, Loading, TopBar, TxRow } from '../ui';
import { bucketize, eur, localDay, NATURE_LABEL, PERIOD_KINDS, periodOf, type PeriodKind } from '../util';

const NATURE_COLOR: Record<string, string> = { must: '#D9483B', need: '#F09A2E', want: '#2BB673', none: '#A9B6C7' };
const GREY = '#A9B6C7';

type View = 'spese' | 'flusso' | 'entrate' | 'saldo';

function useStatsData() {
  const store = useStore();
  const spec = usePeriodSpec();
  const period = periodOf(spec);
  const stats = useApi<StatsData>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);
  const balance = useApi<{ series: Array<{ day: string; balance: number }> }>(`/stats/balance?from=${period.from}&to=${period.to}`, [store.review_count]);
  return { store, period, s: stats.data, error: stats.error, series: balance.data?.series ?? [] };
}

/** Variazione rispetto al periodo precedente; `up` dice se salire è un bene (entrate) o un male (spese). */
function Delta({ now, before, up }: { now: number; before: number; up: 'good' | 'bad' }) {
  if (!before) return null;
  const pct = Math.round(((now - before) / Math.abs(before)) * 100);
  if (!Number.isFinite(pct)) return null;
  const good = pct === 0 ? null : (pct > 0) === (up === 'good');
  return (
    <span className="chip num" style={{ background: good == null ? 'var(--sunken)' : good ? 'var(--pos-soft)' : 'var(--neg-soft)', color: good == null ? 'var(--muted)' : good ? 'var(--pos)' : 'var(--neg)', fontSize: 13 }}>
      {pct > 0 ? '+' : ''}{pct}%
    </span>
  );
}

export function Stats({ view }: { view?: string }) {
  if (view === 'mesi') return <Months />;
  if (view === 'paesi') return <Countries />;
  if (view === 'spese' || view === 'flusso' || view === 'entrate' || view === 'saldo') return <Detail view={view} />;
  return <Overview />;
}

function Overview() {
  const { store, s, error, series, period } = useStatsData();
  const flow = s ? s.income - s.spent : 0;
  const prevFlow = s ? s.previous.income - s.previous.spent : 0;
  const ongoing = s ? s.days.elapsed > 0 && s.days.elapsed < s.days.total : false;
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12, paddingBottom: 72 }}>
      <h1 className="page-title">Statistiche</h1>
      <ErrorBox error={error} />
      {!s ? <Loading /> : (
        <>
          <Tile to="saldo" label="Saldo" value={eur(series.at(-1)?.balance ?? 0)} chart={<Spark values={series.map((p) => p.balance)} />} />
          <Tile to="spese" label="Spesa" value={eur(s.spent)} chart={<Donut parts={s.by_category.map((c) => ({ value: c.total, color: store.cat(c.category_id)?.color ?? GREY }))} />} />
          <Tile to="flusso" label="Flusso di cassa" value={eur(flow, true)} tone={flow >= 0 ? 'pos' : 'neg'}
            chart={<MiniBars income={s.income} spent={s.spent} />} extra={<Delta now={flow} before={prevFlow} up="good" />} />
          {ongoing && <Tile to="spese" label="Previsione a fine periodo" value={eur(s.forecast)} note={`Spesa finora ${eur(s.spent)} in ${s.days.elapsed} di ${s.days.total} giorni`} />}
          {s.by_card.some((x) => x.card) && (
            <a href="#/statistiche/spese" onClick={() => setTimeout(() => document.getElementById('per-carta')?.scrollIntoView({ behavior: 'smooth' }), 400)} className="card" style={{ textDecoration: 'none', color: 'inherit', padding: '16px 18px', gap: 8 }}>
              <span className="label">Per carta</span>
              {s.by_card.slice(0, 3).map((x) => (
                <span key={x.card ?? 'none'} className="row between" style={{ fontSize: 15 }}>
                  <span>{x.card ?? <span className="muted">Senza carta</span>}</span>
                  <b className="num money">{eur(x.total)} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{Math.round((x.total / s.spent) * 100)}%</span></b>
                </span>
              ))}
            </a>
          )}
          <Tile to="entrate" label="Entrate" value={eur(s.income)} tone="pos" extra={<Delta now={s.income} before={s.previous.income} up="good" />} note={s.previous.income ? 'rispetto al periodo precedente' : undefined} />
          <a href="#/statistiche/mesi" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit', padding: '16px 18px' }}>
            <span className="grow stack" style={{ gap: 4 }}>
              <span className="label">Mese per mese</span>
              <span style={{ fontSize: 15 }}>Ogni categoria negli ultimi 6 mesi: dove la spesa cresce</span>
            </span>
            <Icon name="next" size={18} />
          </a>
          <CountriesTile from={period.from} to={period.to} />
          <FeesCard from={period.from} to={period.to} />
        </>
      )}
      <PeriodBar />
    </div>
  );
}

function Tile({ to, label, value, chart, extra, note, tone }: { to: View; label: string; value: string; chart?: React.ReactNode; extra?: React.ReactNode; note?: string; tone?: 'pos' | 'neg' }) {
  return (
    <a href={`#/statistiche/${to}`} className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit', padding: '16px 18px' }}>
      <span className="grow stack" style={{ gap: 4 }}>
        <span className="label">{label}</span>
        <span className={`big money ${tone ?? ''}`} style={{ fontSize: 26 }}>{value}</span>
        {note && <span className="muted" style={{ fontSize: 13 }}>{note}</span>}
      </span>
      {extra}
      {chart && <span style={{ width: 96, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>{chart}</span>}
    </a>
  );
}

function Detail({ view }: { view: View }) {
  const { store, period, s, error, series } = useStatsData();
  const title = { spese: 'Spese', flusso: 'Flusso di cassa', entrate: 'Entrate', saldo: 'Saldo' }[view];
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12, paddingBottom: 72 }}>
      <TopBar title={title} backTo="/statistiche" />
      <ErrorBox error={error} />
      {!s ? <Loading /> : view === 'spese' ? <Spending s={s} /> : view === 'flusso' ? <Cashflow s={s} /> : view === 'entrate' ? <Income s={s} /> : <Balance series={series} label={period.label} />}
      <PeriodBar />
    </div>
  );
}

// ---- Dettagli ----

function Spending({ s }: { s: StatsData }) {
  const store = useStore();
  const [open, setOpen] = useState<string | null>(null);
  const { buckets } = bucketize(s.from, s.to, s.daily, ['must', 'need', 'want', 'spent']);
  const max = Math.max(1, ...buckets.map((b) => b.spent));
  return (
    <>
      <section className="card">
        <div className="row between">
          <span className="stack" style={{ gap: 2 }}><span className="label">Spesa</span><span className="big money neg" style={{ fontSize: 28 }}>{eur(s.spent)}</span></span>
          <Delta now={s.spent} before={s.previous.spent} up="bad" />
        </div>
        <StackedBars buckets={buckets.map((b) => ({ label: b.label, parts: [
          { value: b.must, color: NATURE_COLOR.must }, { value: b.need, color: NATURE_COLOR.need }, { value: b.want, color: NATURE_COLOR.want },
          { value: Math.max(0, b.spent - b.must - b.need - b.want), color: NATURE_COLOR.none },
        ] }))} max={max} />
        <div className="row wrap" style={{ gap: 14, fontSize: 13 }}>
          {(['must', 'need', 'want'] as const).map((n) => <Legend key={n} color={NATURE_COLOR[n]} label={`${NATURE_LABEL[n]} ${eur(s.by_nature.find((x) => x.nature === n)?.total ?? 0)}`} />)}
        </div>
      </section>
      <section className="card">
        <span className="label">Per categoria</span>
        {s.by_category.length === 0 && <p className="empty" style={{ padding: 8 }}>Nessuna spesa in questo periodo.</p>}
        {s.by_category.map((c) => {
          const id = c.category_id ?? 'none';
          const subs = s.by_subcategory.filter((x) => (x.parent_id ?? 'none') === id && x.category_id !== c.category_id);
          return (
            <div key={id} className="stack" style={{ gap: 8 }}>
              <button onClick={() => (subs.length ? setOpen(open === id ? null : id) : go(c.category_id ? `/movimenti/${c.category_id}` : '/movimenti'))}
                className="stack" style={{ gap: 6, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', color: 'inherit' }}>
                <span className="row between" style={{ fontSize: 16, fontWeight: 600 }}>
                  <span>{store.catName(c.category_id)}{subs.length > 0 && <span className="muted" style={{ fontWeight: 400 }}> {open === id ? '▴' : '▾'}</span>}</span>
                  <span className="num money">{eur(c.total)}</span>
                </span>
                <span className="bar" style={{ height: 12, borderRadius: 6 }}><span style={{ display: 'block', height: '100%', borderRadius: 6, width: `${(c.total / s.by_category[0].total) * 100}%`, background: store.cat(c.category_id)?.color ?? GREY }} /></span>
              </button>
              {open === id && subs.map((x) => (
                <a key={x.category_id ?? 'n'} href={x.category_id ? `#/movimenti/${x.category_id}` : '#/movimenti'} className="row between" style={{ fontSize: 15, paddingLeft: 12, textDecoration: 'none', color: 'inherit' }}>
                  <span>{store.catName(x.category_id)} <span className="muted">· {x.count}</span></span>
                  <span className="num money">{eur(x.total)}</span>
                </a>
              ))}
            </div>
          );
        })}
      </section>
      {s.by_card.some((x) => x.card) && (
        <section className="card" id="per-carta">
          <div className="row between"><span className="label">Per carta</span><a href="#/carte" style={{ fontSize: 14, textDecoration: 'none' }}>Carte</a></div>
          <span className="muted" style={{ fontSize: 13, marginTop: -6 }}>Le stesse spese del totale, divise per carta: non si sommano.</span>
          {s.by_card.map((x) => (
            <div key={x.card ?? 'none'} className="stack" style={{ gap: 6 }}>
              <span className="row between" style={{ fontSize: 16, fontWeight: 600 }}>
                <span>{x.card ?? <span className="muted" style={{ fontWeight: 400 }}>Senza carta</span>}</span>
                <span className="num money">{eur(x.total)} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· {Math.round((x.total / s.spent) * 100)}%</span></span>
              </span>
              <span className="bar" style={{ height: 10, borderRadius: 5 }}><span style={{ display: 'block', height: '100%', borderRadius: 5, width: `${(x.total / s.spent) * 100}%`, background: x.card ? 'var(--accent)' : GREY }} /></span>
            </div>
          ))}
        </section>
      )}
      {s.by_merchant.length > 0 && (
        <section className="card">
          <span className="label">Dove spendi di più</span>
          {s.by_merchant.slice(0, 8).map((m) => (
            <div key={m.merchant} className="row between" style={{ fontSize: 15 }}>
              <span>{m.merchant} <span className="muted">· {m.count}</span></span>
              <b className="num money">{eur(m.total)}</b>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Cashflow({ s }: { s: StatsData }) {
  const flow = s.income - s.spent;
  const top = Math.max(s.income, s.spent, 1);
  const { buckets } = bucketize(s.from, s.to, s.daily, ['income', 'spent']);
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.income, b.spent)));
  return (
    <>
      <section className="card">
        <div className="stack" style={{ gap: 2 }}>
          <span className="h2">Flusso di cassa</span>
          <span className="muted">Sto spendendo meno di quanto guadagno?</span>
        </div>
        <div className="row between">
          <span className={`hero-amount money ${flow >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: 34 }}>{eur(flow, true)}</span>
          <Delta now={flow} before={s.previous.income - s.previous.spent} up="good" />
        </div>
        <FlowRow label="Entrate" value={s.income} max={top} color="var(--pos)" />
        <FlowRow label="Spese" value={s.spent} max={top} color="var(--neg)" />
        {s.income > 0 && <span className="muted" style={{ fontSize: 14 }}>Hai messo da parte il {Math.max(0, Math.round((flow / s.income) * 100))}% di quanto è entrato.</span>}
      </section>
      <section className="card">
        <span className="label">Andamento</span>
        <PairBars buckets={buckets.map((b) => ({ label: b.label, a: b.income, b: b.spent }))} max={max} />
        <div className="row" style={{ gap: 14, fontSize: 13 }}><Legend color="var(--pos)" label="Entrate" /><Legend color="var(--neg)" label="Spese" /></div>
      </section>
      <FlowDetail s={s} />
    </>
  );
}

/** Dettaglio di entrate e spese nella stessa pagina del flusso: per categoria e movimento per movimento. */
function FlowDetail({ s }: { s: StatsData }) {
  const store = useStore();
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const rows = kind === 'income' ? s.income_by_category : s.by_category;
  const total = kind === 'income' ? s.income : s.spent;
  const top = Math.max(1, ...rows.map((c) => c.total));
  const txs = useApi<{ items: Tx[] }>(`/transactions?from=${s.from}&to=${s.to}&type=${kind}&limit=200`, [store.review_count, kind]);
  const color = kind === 'income' ? 'var(--pos)' : 'var(--neg)';
  return (
    <>
      <div className="seg" role="group" aria-label="Dettaglio">
        <button aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>Spese {eur(s.spent)}</button>
        <button aria-pressed={kind === 'income'} onClick={() => setKind('income')}>Entrate {eur(s.income)}</button>
      </div>
      <section className="card">
        <span className="label">{kind === 'income' ? 'Entrate' : 'Spese'} per categoria</span>
        {!rows.length && <p className="empty" style={{ padding: 8 }}>{kind === 'income' ? 'Nessuna entrata' : 'Nessuna spesa'} in questo periodo.</p>}
        {rows.map((c) => (
          <a key={c.category_id ?? 'none'} href={c.category_id ? `#/movimenti/${c.category_id}` : '#/movimenti'} className="stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
            <span className="row between" style={{ fontSize: 15 }}>
              <span>{store.catName(c.category_id)} <span className="muted" style={{ fontSize: 13 }}>· {c.count}</span></span>
              <span className="num money" style={{ fontWeight: 600 }}>{eur(c.total)} <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{total ? Math.round((c.total / total) * 100) : 0}%</span></span>
            </span>
            <div className="bar"><div style={{ width: `${(c.total / top) * 100}%`, background: store.cat(c.category_id)?.color ?? color }} /></div>
          </a>
        ))}
      </section>
      <section className="card">
        <span className="label">Tutti i movimenti</span>
        {!txs.data ? <Loading /> : !txs.data.items.length ? <p className="empty" style={{ padding: 8 }}>Niente in questo periodo.</p>
          : txs.data.items.map((t) => <TxRow key={t.id} t={t} />)}
        {txs.data && txs.data.items.length >= 200 && <span className="muted" style={{ fontSize: 13 }}>Sono i 200 più recenti: gli altri in Movimenti.</span>}
      </section>
    </>
  );
}

function Income({ s }: { s: StatsData }) {
  const store = useStore();
  const top = Math.max(1, ...s.income_by_category.map((c) => c.total));
  return (
    <>
      <section className="card">
        <div className="row between">
          <span className="stack" style={{ gap: 2 }}><span className="label">Entrate</span><span className="big money pos" style={{ fontSize: 28 }}>{eur(s.income)}</span></span>
          <Delta now={s.income} before={s.previous.income} up="good" />
        </div>
      </section>
      <section className="card">
        <span className="label">Per categoria</span>
        {s.income_by_category.length === 0 && <p className="empty" style={{ padding: 8 }}>Nessuna entrata in questo periodo.</p>}
        {s.income_by_category.map((c) => (
          <a key={c.category_id ?? 'none'} href={c.category_id ? `#/movimenti/${c.category_id}` : '#/movimenti'} className="stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
            <span className="row between" style={{ fontSize: 16, fontWeight: 600 }}><span>{store.catName(c.category_id)}</span><span className="num money">{eur(c.total)}</span></span>
            <span className="bar" style={{ height: 12, borderRadius: 6 }}><span style={{ display: 'block', height: '100%', borderRadius: 6, width: `${(c.total / top) * 100}%`, background: 'var(--pos)' }} /></span>
          </a>
        ))}
      </section>
    </>
  );
}

function Balance({ series, label }: { series: Array<{ day: string; balance: number }>; label: string }) {
  const values = series.map((p) => p.balance);
  return (
    <section className="card">
      <span className="label">{label}</span>
      <span className="big money" style={{ fontSize: 28 }}>{eur(values.at(-1) ?? 0)}</span>
      {values.length > 1 ? <Line values={values} first={series[0].day} last={series[series.length - 1].day} /> : <p className="empty">Nessun dato in questo periodo.</p>}
    </section>
  );
}

// ---- Grafici ----

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="row money" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color }} />{label}</span>;
}

function FlowRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="row between" style={{ fontSize: 16, fontWeight: 600 }}><span>{label}</span><span className="num money">{eur(value)}</span></span>
      <span className="bar" style={{ height: 14, borderRadius: 7 }}><span style={{ display: 'block', height: '100%', borderRadius: 7, width: `${(value / max) * 100}%`, background: color }} /></span>
    </div>
  );
}

function MiniBars({ income, spent }: { income: number; spent: number }) {
  const max = Math.max(income, spent, 1);
  return (
    <span className="stack" style={{ gap: 6, width: 96 }}>
      <span className="bar" style={{ height: 10 }}><span style={{ display: 'block', height: '100%', width: `${(income / max) * 100}%`, background: 'var(--pos)', borderRadius: 4 }} /></span>
      <span className="bar" style={{ height: 10 }}><span style={{ display: 'block', height: '100%', width: `${(spent / max) * 100}%`, background: 'var(--neg)', borderRadius: 4 }} /></span>
    </span>
  );
}

function Donut({ parts }: { parts: Array<{ value: number; color: string }> }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const r = 26;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--sunken)" strokeWidth={9} />
      {total > 0 && parts.map((p, i) => {
        const len = (p.value / total) * c;
        const el = <circle key={i} cx={32} cy={32} r={r} fill="none" stroke={p.color} strokeWidth={9} strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`} strokeDashoffset={-acc} transform="rotate(-90 32 32)" />;
        acc += len;
        return el;
      })}
    </svg>
  );
}

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 96;
  const h = 40;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts.join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Line({ values, first, last }: { values: number[]; first: string; last: string }) {
  const w = 340;
  const h = 170;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 12 - ((v - min) / span) * (h - 24)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="row between muted num" style={{ fontSize: 12 }}><span className="money">max {eur(max)}</span><span className="money">min {eur(min)}</span></div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="Andamento del saldo">
        <path d={`${line} L${pts.at(-1)![0]} ${h} L4 ${h} Z`} fill="var(--accent-soft)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="row between muted" style={{ fontSize: 12 }}><span>{first.split('-').reverse().slice(0, 2).join('/')}</span><span>{last === localDay() ? 'oggi' : last.split('-').reverse().slice(0, 2).join('/')}</span></div>
    </div>
  );
}

/** Barre impilate per gruppo (giorno, settimana o mese), con poche etichette per non affollare. */
function StackedBars({ buckets, max }: { buckets: Array<{ label: string; parts: Array<{ value: number; color: string }> }>; max: number }) {
  const step = Math.ceil(buckets.length / 6);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: buckets.length > 20 ? 2 : 4, height: 120 }} aria-hidden="true">
        {buckets.map((b, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column-reverse', height: '100%', minWidth: 0 }}>
            {b.parts.map((p, j) => p.value > 0 && <div key={j} style={{ height: `${(p.value / max) * 100}%`, background: p.color, borderRadius: 2 }} />)}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: buckets.length > 20 ? 2 : 4 }} className="muted">
        {buckets.map((b, i) => <span key={i} style={{ flex: 1, minWidth: 0, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'visible' }}>{i % step === 0 ? b.label : ''}</span>)}
      </div>
    </div>
  );
}

function PairBars({ buckets, max }: { buckets: Array<{ label: string; a: number; b: number }>; max: number }) {
  const step = Math.ceil(buckets.length / 6);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: buckets.length > 20 ? 2 : 6, height: 120 }} aria-hidden="true">
        {buckets.map((x, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, height: '100%', minWidth: 0 }}>
            <div style={{ flex: 1, height: `${(x.a / max) * 100}%`, background: 'var(--pos)', borderRadius: 2 }} />
            <div style={{ flex: 1, height: `${(x.b / max) * 100}%`, background: 'var(--neg)', borderRadius: 2 }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: buckets.length > 20 ? 2 : 6 }} className="muted">
        {buckets.map((x, i) => <span key={i} style={{ flex: 1, minWidth: 0, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' }}>{i % step === 0 ? x.label : ''}</span>)}
      </div>
    </div>
  );
}

// ---- Periodo ----

/** Barra del periodo in basso, come in Wallet: frecce per scorrere, tocco sul nome per scegliere. */
export function PeriodBar() {
  const spec = usePeriodSpec();
  const period = periodOf(spec);
  const [open, setOpen] = useState(false);
  const arrows = periodArrows(spec.kind);
  return (
    <>
      <div className="periodbar">
        <button className="iconbtn" aria-label="Periodo precedente" disabled={!arrows} onClick={() => setPeriod({ ...spec, offset: spec.offset - 1 })}><Icon name="back" size={20} /></button>
        <button className="periodbar-label" onClick={() => setOpen(true)} aria-haspopup="dialog">{period.label} <span aria-hidden="true">▾</span></button>
        <button className="iconbtn" aria-label="Periodo successivo" disabled={!arrows || spec.offset >= 0} onClick={() => setPeriod({ ...spec, offset: spec.offset + 1 })}><Icon name="next" size={20} /></button>
      </div>
      {open && <PeriodSheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** Commissioni e prelievi del periodo, per carta. Nascosta se non ce ne sono. */
function FeesCard({ from, to }: { from: string; to: string }) {
  const store = useStore();
  const r = useApi<{ cards: Array<{ card: string; fees: number; fees_n: number; cash: number; cash_n: number; fx: number; fx_pct: number | null }>; fees: number; cash: number; fx: number }>(`/stats/fees?from=${from}&to=${to}`, [store.review_count]);
  if (!r.data || !r.data.cards.length) return null;
  return (
    <section className="card" style={{ padding: '16px 18px', gap: 10 }}>
      <div className="row between">
        <span className="label">Costi bancari</span>
        <b className="num money">{eur(r.data.fees + r.data.fx)}</b>
      </div>
      <span className="muted" style={{ fontSize: 13, marginTop: -4 }}>Commissioni, costo del cambio stimato e contanti prelevati, per carta. Il costo del cambio si stima dalle carte di cui hai scritto un addebito.</span>
      {r.data.cards.map((c) => (
        <div key={c.card} className="row between" style={{ fontSize: 15, alignItems: 'flex-start' }}>
          <span>{c.card || <span className="muted">Senza carta</span>}</span>
          <span className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
            {c.fees > 0 && <span className="num money">{eur(c.fees)} <span className="muted" style={{ fontSize: 13 }}>{c.fees_n === 1 ? 'commissione' : `${c.fees_n} commissioni`}</span></span>}
            {c.fx > 0 && <span className="num money">{eur(c.fx)} <span className="muted" style={{ fontSize: 13 }}>cambio ({(c.fx_pct ?? 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%)</span></span>}
            {c.cash > 0 && <span className="num money muted" style={{ fontSize: 13 }}>{c.cash_n === 1 ? '1 prelievo' : `${c.cash_n} prelievi`} · {eur(c.cash)}</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

/** Mese per mese: le categorie principali negli ultimi mesi, con la variazione dell'ultimo mese intero sulla media. */
function Months() {
  const store = useStore();
  const [n, setN] = useState(6);
  const r = useApi<{ months: string[]; categories: Array<{ category_id: string | null; values: number[]; total: number }>; totals: number[] }>(`/stats/months?months=${n}&today=${localDay()}`, [store.review_count]);
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('it-IT', { month: 'short', timeZone: 'UTC' }).replace('.', '');
  const short = (v: number) => (v ? eur(v).replace(/,\d+(?=\D*$)/, '') : '–');
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12, paddingBottom: 24 }}>
      <TopBar title="Mese per mese" backTo="/statistiche" />
      <div className="seg" role="group" aria-label="Quanti mesi">
        {[3, 6, 12].map((k) => <button key={k} aria-pressed={n === k} onClick={() => setN(k)}>{k} mesi</button>)}
      </div>
      <ErrorBox error={r.error} />
      {!r.data ? <Loading /> : !r.data.categories.length ? <p className="empty">Nessuna spesa in questi mesi.</p> : (
        <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table className="mtable">
              <thead>
                <tr><th>Categoria</th>{r.data.months.map((m, i) => <th key={m} className="num">{label(m)}{i === r.data!.months.length - 1 ? '*' : ''}</th>)}<th className="num">Ultimo</th></tr>
              </thead>
              <tbody>
                {r.data.categories.slice(0, 12).map((c) => {
                  // Ultimo mese intero contro la media dei mesi interi prima: il mese in corso non è finito e non conta.
                  const full = c.values.slice(0, -1);
                  const lastFull = full.at(-1) ?? 0;
                  const before = full.slice(0, -1);
                  const avg = before.length ? before.reduce((a, b) => a + b, 0) / before.length : 0;
                  const pct = avg > 0 ? Math.round(((lastFull - avg) / avg) * 100) : null;
                  const max = Math.max(...c.values, 1);
                  return (
                    <tr key={c.category_id ?? 'none'} onClick={() => c.category_id && go(`/movimenti/${c.category_id}`)}>
                      <td><span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: store.cat(c.category_id)?.color ?? GREY }} />{store.catName(c.category_id)}</span></td>
                      {c.values.map((v, i) => <td key={i} className="num money" style={{ background: v ? `color-mix(in srgb, ${store.cat(c.category_id)?.color ?? GREY} ${Math.round((v / max) * 22)}%, transparent)` : undefined }}>{short(v)}</td>)}
                      <td className="num">{pct == null ? '' : <span style={{ color: pct > 10 ? 'var(--neg)' : pct < -10 ? 'var(--pos)' : 'var(--muted)', fontWeight: 600 }}>{pct > 0 ? '+' : ''}{pct}%</span>}</td>
                    </tr>
                  );
                })}
                <tr className="total"><td>Totale</td>{r.data.totals.map((v, i) => <td key={i} className="num money">{short(v)}</td>)}<td /></tr>
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ fontSize: 12.5, margin: 0, padding: '0 14px 12px' }}>* mese in corso. “Ultimo” confronta l’ultimo mese intero con la media dei mesi prima.</p>
        </section>
      )}
    </div>
  );
}

interface CountriesData {
  home: string | null;
  countries: Array<{ currency: string; name: string; flag: string; home: boolean; spent: number; count: number; days: number; per_day: number; stays: Array<{ from: string; to: string; days: number; spent: number; count: number }> }>;
}

const dayShort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');

/** Riquadro in Statistiche: i paesi del periodo, se ce n'è più di uno. */
function CountriesTile({ from, to }: { from: string; to: string }) {
  const store = useStore();
  const r = useApi<CountriesData>(`/stats/countries?from=${from}&to=${to}`, [store.review_count]);
  const list = r.data?.countries ?? [];
  if (list.length < 2) return null;
  return (
    <a href="#/statistiche/paesi" className="card" style={{ textDecoration: 'none', color: 'inherit', padding: '16px 18px', gap: 8 }}>
      <span className="row between"><span className="label">Per paese</span><Icon name="next" size={18} /></span>
      {list.slice(0, 3).map((c) => (
        <span key={c.currency} className="row between" style={{ fontSize: 15 }}>
          <span>{c.flag} {c.name}{c.home ? <span className="muted"> · casa</span> : ''}</span>
          <b className="num money">{eur(c.spent)}</b>
        </span>
      ))}
    </a>
  );
}

/** Statistiche › Paesi: spese per paese (dalla valuta) e soggiorni all'estero trovati da soli. */
function Countries() {
  const store = useStore();
  const spec = usePeriodSpec();
  const period = periodOf(spec);
  const r = useApi<CountriesData>(`/stats/countries?from=${period.from}&to=${period.to}`, [store.review_count]);
  const [open, setOpen] = useState<string | null>(null);
  const showMovements = (currency: string, from?: string, to?: string) => {
    try { sessionStorage.setItem('ledgy-filters', JSON.stringify({ currency, type: 'expense', ...(from ? { from, to } : { from: period.from, to: localDay(new Date(Date.parse(`${period.to}T12:00:00Z`) - 86400_000)) }) })); } catch { /* ignora */ }
    go('/movimenti');
  };
  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12, paddingBottom: 72 }}>
      <TopBar title="Per paese" backTo="/statistiche" />
      <p className="lead">Il paese viene dalla valuta della spesa, anche per quelle arrivate dalle notifiche. I giorni all'estero vicini diventano un soggiorno.</p>
      <ErrorBox error={r.error} />
      {!r.data ? <Loading /> : !r.data.countries.length ? <p className="empty">Nessuna spesa in questo periodo.</p> : r.data.countries.map((c) => (
        <section key={c.currency} className="card" style={{ gap: 8 }}>
          <button className="row between" style={{ background: 'none', border: 0, padding: 0, color: 'inherit', textAlign: 'left' }} onClick={() => setOpen(open === c.currency ? null : c.currency)} aria-expanded={open === c.currency}>
            <span className="stack" style={{ gap: 2 }}>
              <b style={{ fontSize: 17 }}>{c.flag} {c.name}{c.home && <span className="muted" style={{ fontWeight: 400 }}> · casa</span>}</b>
              <span className="muted" style={{ fontSize: 13 }}>{c.days} {c.days === 1 ? 'giorno' : 'giorni'} con spese · {eur(c.per_day)} al giorno · {c.count} spese</span>
            </span>
            <b className="num money" style={{ fontSize: 18 }}>{eur(c.spent)}</b>
          </button>
          {c.stays.length > 0 && (
            <div className="stack" style={{ gap: 4 }}>
              {c.stays.map((st) => (
                <button key={st.from} className="row between chip-row" style={{ background: 'var(--sunken)', border: 0, borderRadius: 10, padding: '8px 10px', color: 'inherit' }} onClick={() => showMovements(c.currency, st.from, st.to)}>
                  <span style={{ fontSize: 14 }}>{dayShort(st.from)} – {dayShort(st.to)} · {st.days} giorni</span>
                  <span className="num money" style={{ fontSize: 14 }}>{eur(st.spent)}</span>
                </button>
              ))}
            </div>
          )}
          {open === c.currency && <CountryDetail currency={c.currency} from={period.from} to={period.to} />}
          <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => showMovements(c.currency)}>Vedi le spese</button>
        </section>
      ))}
      <PeriodBar />
    </div>
  );
}

function CountryDetail({ currency, from, to }: { currency: string; from: string; to: string }) {
  const store = useStore();
  const r = useApi<StatsData>(`/stats?from=${from}&to=${to}&currency=${currency}`, [store.review_count]);
  if (!r.data) return <Loading />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {r.data.by_category.filter((x) => x.total > 0).slice(0, 8).map((x) => (
        <span key={x.category_id ?? 'none'} className="row between" style={{ fontSize: 14 }}>
          <span>{store.catName(x.category_id)}</span>
          <span className="num money">{eur(x.total)} <span className="muted">{Math.round((x.total / Math.max(1, r.data!.spent)) * 100)}%</span></span>
        </span>
      ))}
    </div>
  );
}
