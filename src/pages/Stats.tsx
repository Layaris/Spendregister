// Statistiche come in Wallet: schede riassuntive (Saldo, Spesa, Flusso di cassa, Previsioni, Entrate),
// ognuna con il suo dettaglio, e il periodo scelto in basso uguale per tutte.
import { useState } from 'react';
import type { Stats as StatsData } from '../api';
import { Icon } from '../icons';
import { setPeriod, usePeriodSpec } from '../period';
import { go } from '../router';
import { useApi, useStore } from '../store';
import { ErrorBox, Loading, TopBar } from '../ui';
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
  if (view === 'spese' || view === 'flusso' || view === 'entrate' || view === 'saldo') return <Detail view={view} />;
  return <Overview />;
}

function Overview() {
  const { store, s, error, series } = useStatsData();
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
          <Tile to="entrate" label="Entrate" value={eur(s.income)} tone="pos" extra={<Delta now={s.income} before={s.previous.income} up="good" />} note={s.previous.income ? 'rispetto al periodo precedente' : undefined} />
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
        <section className="card">
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
  const [range, setRange] = useState({ from: spec.from ?? localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: spec.to ?? localDay() });
  const arrows = spec.kind !== 'ytd' && spec.kind !== 'custom';
  const pick = (kind: PeriodKind) => {
    if (kind === 'custom') return;
    setPeriod({ kind, offset: 0 });
    setOpen(false);
  };
  return (
    <>
      <div className="periodbar">
        <button className="iconbtn" aria-label="Periodo precedente" disabled={!arrows} onClick={() => setPeriod({ ...spec, offset: spec.offset - 1 })}><Icon name="back" size={20} /></button>
        <button className="periodbar-label" onClick={() => setOpen(true)} aria-haspopup="dialog">{period.label} <span aria-hidden="true">▾</span></button>
        <button className="iconbtn" aria-label="Periodo successivo" disabled={!arrows || spec.offset >= 0} onClick={() => setPeriod({ ...spec, offset: spec.offset + 1 })}><Icon name="next" size={20} /></button>
      </div>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal card" role="dialog" aria-modal="true" aria-label="Seleziona periodo" onClick={(e) => e.stopPropagation()} style={{ gap: 4 }}>
            <div className="row between"><h2 className="h2">Seleziona periodo</h2><button className="btn ghost" onClick={() => setOpen(false)}>Annulla</button></div>
            {PERIOD_KINDS.filter(([k]) => k !== 'custom').map(([k, label]) => (
              <button key={k} className="sheet-option" aria-pressed={spec.kind === k} onClick={() => pick(k)}>{label}</button>
            ))}
            <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
              <span className="label">Dal … al …</span>
              <div className="row" style={{ gap: 8 }}>
                <input className="input grow" type="date" aria-label="Dal" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
                <input className="input grow" type="date" aria-label="Al" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
              </div>
              <button className="btn primary" disabled={!range.from || !range.to || range.from > range.to}
                onClick={() => { setPeriod({ kind: 'custom', offset: 0, from: range.from, to: range.to }); setOpen(false); }}>Mostra queste date</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
