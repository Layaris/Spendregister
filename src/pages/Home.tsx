import { useEffect, useState, type ReactNode } from 'react';
import { api, type Stats, type Theme, type Tx } from '../api';
import { Icon } from '../icons';
import { setPeriod, usePeriodSpec } from '../period';
import { PeriodSheet, periodArrows } from '../PeriodSheet';
import { applyTheme, THEMES, useApi, useStore } from '../store';
import { CategoryIcon, TxRow } from '../ui';
import { eur, fitSize, formatDayShort, formatMoney, localDay, monthPeriod, pct, periodOf } from '../util';
import { BudgetBar, budgetTone, type BudgetView } from './Budget';
import { SuggestionCard, useRecurring } from './Recurring';

interface Alert { id: string; kind: 'unusual' | 'duplicate' | 'fees' | 'budget' | 'capture_silent'; days?: number; device?: string; tx?: string; amount?: number; avg?: number; merchant?: string | null; category_id?: string; pct?: number; cards?: Array<{ card: string; total: number }> }
interface Forecast { months: number; spent: number | null; expected_spend?: number; income?: number; expected_income?: number }
interface Insights { alerts: Alert[]; forecast: Forecast | null; week: { from: string; to: string; spent: number; count: number; previous: number; top: Array<{ category_id: string | null; total: number }> } | null }

/** Titolo, testo e link di un avviso (importi nella valuta di visualizzazione). */
function alertText(a: Alert, catName: (id: string | null | undefined) => string): { title: string; text: string; href: string } {
  if (a.kind === 'unusual') return { title: `Spesa insolita: ${a.merchant}`, text: `${eur(a.amount ?? 0)}, di solito circa ${eur(a.avg ?? 0)}`, href: `#/m/${a.tx}` };
  if (a.kind === 'duplicate') return { title: `Possibile doppione${a.merchant ? `: ${a.merchant}` : ''}`, text: `Due movimenti da ${eur(a.amount ?? 0)} a meno di un’ora. Se è lo stesso, eliminane uno.`, href: `#/m/${a.tx}` };
  if (a.kind === 'capture_silent') return { title: `Nessuna spesa dal telefono da ${a.days} giorni`, text: `${a.device ?? 'Il telefono'} non manda notifiche: controlla la batteria, i permessi o il comando. Se non hai speso con la carta, ignora.`, href: '#/cattura' };
  if (a.kind === 'fees') return { title: `Commissioni bancarie: ${eur(a.amount ?? 0)} questo mese`, text: a.cards?.length ? a.cards.map((c) => `${c.card} ${eur(c.total)}`).join(' · ') : 'Guarda quali carte le addebitano', href: '#/statistiche/spese' };
  const name = a.category_id === '*' ? 'Budget del mese' : `Budget ${catName(a.category_id)}`;
  const left = a.amount ?? 0;
  return { title: `${name}: ${(a.pct ?? 0) >= 100 ? 'superato' : `al ${a.pct}%`}`, text: left >= 0 ? `Ti restano ${eur(left)}` : `Sei oltre di ${eur(-left)}`, href: '#/budget' };
}

/** Schede della Home: si accendono, si spengono e si riordinano (Personalizza). */
export const HOME_WIDGETS: Array<[string, string]> = [
  ['balance', 'Saldo totale dei conti'], ['hero', 'Budget mensile (o spesa del mese senza budget)'], ['alerts', 'Avvisi'], ['week', 'La tua settimana'], ['budget', 'Budget del mese'], ['review', 'Da rivedere'], ['recurring', 'Spese ricorrenti in arrivo'], ['forecast', 'Come finirà il mese (previsione)'], ['accounts', 'Conti'],
  ['cashflow', 'Entrate e uscite'], ['top', 'Spese principali'], ['cards', 'Spesa per carta'], ['recent', 'Ultimi movimenti'],
];
export const DEFAULT_HOME = ['balance', 'hero', 'accounts', 'cashflow', 'forecast', 'alerts', 'review', 'week', 'budget', 'recurring', 'top', 'cards', 'recent'];
/** Le prime schede del mockup: chi aveva una disposizione salvata le riceve una volta in cima (layoutV3). */
const MOCKUP_TOP = ['balance', 'hero', 'accounts', 'cashflow', 'forecast'];

/** Titolo di un riquadro: icona, nome e (a destra) un dato o un link. */
function CardTitle({ icon, title, right }: { icon: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
      <div className="ctitle"><Icon name={icon} size={23} /><h2 className="h2">{title}</h2></div>
      {right}
    </div>
  );
}

const CURRENT_LABEL: Record<string, string> = {
  day: 'Speso oggi', week: 'Speso questa settimana', month: 'Speso questo mese', year: 'Speso quest’anno', ytd: 'Speso da inizio anno', custom: 'Speso nel periodo',
};

export function Home() {
  const store = useStore();
  const spec = usePeriodSpec();
  const [picker, setPicker] = useState(false);
  const [customize, setCustomize] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);
  const known = new Set(HOME_WIDGETS.map(([k]) => k));
  const layout = (store.settings.home_layout ?? DEFAULT_HOME).filter((k) => known.has(k));
  const on = (k: string) => layout.includes(k);
  const period = periodOf(spec);
  const stats = useApi<Stats>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);
  const balance = useApi<{ series: Array<{ day: string; balance: number }> }>(on('balance') ? '/stats/balance?days=30' : null, [store.review_count]);
  // Una volta sola: chi aveva già una disposizione salvata riceve in cima le schede del mockup (saldo, budget, conti…).
  useEffect(() => {
    let done = false;
    try { done = localStorage.getItem('ledgy-home-v3') === '1'; } catch { /* niente */ }
    const saved = store.settings.home_layout;
    if (done || !store.loaded || !saved) return;
    try { localStorage.setItem('ledgy-home-v3', '1'); } catch { /* niente */ }
    if (MOCKUP_TOP.every((k, i) => saved[i] === k)) return;
    api('/settings', { method: 'PUT', json: { home_layout: [...MOCKUP_TOP, ...saved.filter((k) => !MOCKUP_TOP.includes(k))] } }).then(() => store.refresh()).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.loaded]);
  // Saldo di tutti i conti: la somma dei saldi mostrati in "Conti", ciascuno al cambio di oggi.
  const total = store.accounts.reduce((sum, a) => sum + (a.balance_eur ?? 0), 0);
  const budget = useApi<BudgetView>(on('budget') || on('hero') ? `/budgets?today=${localDay()}` : null, [store.review_count]);
  const recurring = useRecurring(on('recurring'));
  const insights = useApi<Insights>(`/insights?today=${localDay()}`, [store.review_count]);
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ledgy-dismissed') ?? '[]') as string[]; } catch { return []; } });
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try { localStorage.setItem('ledgy-dismissed', JSON.stringify(next)); } catch { /* ignora */ }
  };
  const alertList = insights.data?.alerts.filter((a) => !dismissed.includes(a.id)) ?? [];
  const alertCount = alertList.length;
  const recent = useApi<{ items: Tx[] }>('/transactions?limit=5', [store.review_count]);
  const review = useApi<{ items: Tx[] }>('/transactions?status=review&limit=1', [store.review_count]);

  const s = stats.data;
  const firstReview = review.data?.items[0];
  // Percentuale solo se il periodo prima non era quasi vuoto e la differenza non è assurda (+56279% non dice niente).
  const rawDiff = s && s.previous.spent >= 10_000 ? Math.round(((s.spent - s.previous.spent) / s.previous.spent) * 100) : null;
  const diff = rawDiff != null && Math.abs(rawDiff) <= 300 ? rawDiff : null;
  const daysLeft = s ? Math.max(s.days.total - s.days.elapsed, 0) : 0;
  const ongoing = daysLeft > 0 && s != null && s.days.elapsed > 0;
  const current = spec.offset === 0 && spec.kind !== 'custom';
  const spentLabel = current ? CURRENT_LABEL[spec.kind] : 'Speso nel periodo';
  const endWord = spec.kind === 'month' ? 'mese' : spec.kind === 'year' || spec.kind === 'ytd' ? 'anno' : spec.kind === 'week' ? 'settimana' : 'periodo';
  const [prevShort, prevWord] = spec.kind === 'month' ? ['sul mese prima', 'allo stesso periodo del mese prima']
    : spec.kind === 'year' ? ['sull’anno prima', 'all’anno prima'] : ['sul periodo prima', 'al periodo precedente della stessa durata'];
  const sub = !s ? '' : ongoing ? (daysLeft === 1 ? 'Ultimo giorno' : `Mancano ${daysLeft} giorni`) : spec.kind === 'day' ? '' : `${s.days.total} giorni · concluso`;
  // Nome concreto del periodo (la scheda sotto dice già "questo mese").
  const year = Number(period.from.slice(0, 4));
  const title = spec.kind === 'month' ? monthPeriod(spec.offset).label : spec.kind === 'year' ? String(year) : spec.kind === 'ytd' ? `Da inizio ${year}` : period.label;

  const resolve = async (t: Tx, category: string) => {
    await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: category } });
    store.toast(`${t.merchant ?? 'Spesa'}: ${store.catName(category)}`);
    await store.refresh();
  };

  const widgets: Record<string, ReactNode> = {
    hero: (() => {
      const monthNow = spec.kind === 'month' && spec.offset === 0;
      const bud = monthNow ? budget.data?.total ?? null : null;
      const spent = s?.spent ?? 0;
      const perDay = s && s.days.elapsed ? Math.round(spent / s.days.elapsed) : 0;
      const dayPct = s && ongoing ? (s.days.elapsed / s.days.total) * 100 : undefined;
      const C = 2 * Math.PI * 42;
      const ring = (pct: number, color: string, big: string, small: string) => (
        <svg className="budget-ring" width="100" height="100" viewBox="0 0 100 100" aria-hidden="true" style={{ flexShrink: 0 }}>
          <circle cx="50" cy="50" r="42" fill="none" stroke="var(--ring-track)" strokeWidth="9" />
          <circle cx="50" cy="50" r="42" fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - Math.max(0, Math.min(pct, 100)) / 100)} transform="rotate(-90 50 50)" />
          <text x="50" y="52" textAnchor="middle" style={{ fontFamily: 'var(--f-display)' }} fontWeight="700" fontSize="22" fill="var(--ink)">{big}</text>
          <text x="50" y="68" textAnchor="middle" style={{ fontFamily: 'var(--f-body)' }} fontSize="10.5" fill="var(--muted)">{small}</text>
        </svg>
      );
      const stat = (label: string, value: string, color?: string) => (
        <div><span>{label}</span><b className="money" style={{ color, fontSize: fitSize(value, 17) }}>{value}</b></div>
      );
      if (bud) {
        const pct = Math.round((bud.spent / Math.max(bud.amount, 1)) * 100);
        return (
          <a href="#/budget" className="card hero-card" style={{ textDecoration: 'none', color: 'inherit', gap: 12 }}>
            <div className="bud-top" style={{ flexWrap: 'wrap' }}>
              <div className="ctitle"><Icon name="wallet" size={23} /><h2 className="h2">Budget mensile</h2></div>
              {bud.left > 0 && dayPct != null && (
                <div className="daypill"><Icon name="days" size={18} /><span>Puoi ancora spendere<br /><b className="num money">{eur(bud.per_day)}</b> al giorno<small>fino a fine mese</small></span></div>
              )}
            </div>
            <div className="bud-body">
              {ring(pct, budgetTone(pct), `${pct}%`, 'del budget')}
              <div className="grow stack" style={{ gap: 10, minWidth: 0 }}>
                <div className="bstats">
                  {stat('Speso', eur(bud.spent))}
                  {stat(bud.left < 0 ? 'Oltre il budget' : 'Disponibili', eur(Math.abs(bud.left)), bud.left < 0 ? 'var(--neg)' : 'var(--pos)')}
                </div>
                <BudgetBar spent={bud.spent} amount={bud.amount} dayPct={dayPct} />
                <span className="budget-caption">
                  <Icon name="calendar" size={15} /><span>Budget: <b className="num money" style={{ color: 'var(--ink)' }}>{eur(bud.amount)}</b></span>{s && dayPct != null ? <span>Giorno {s.days.elapsed} di {s.days.total}</span> : null}
                </span>
              </div>
            </div>
          </a>
        );
      }
      // Senza budget (o per un periodo diverso dal mese in corso): la spesa del periodo, con gli stessi elementi.
      return (
        <section className="card hero-card" style={{ gap: 12 }}>
          <CardTitle icon="wallet" title={monthNow ? 'Spesa del mese' : spentLabel}
            right={diff != null ? <span className={`chip ${diff > 0 ? 'warn' : 'ok'}`} title={`Rispetto ${prevWord}`}>{diff > 0 ? '+' : ''}{diff}% {prevShort}</span> : undefined} />
          <div className="bud-body">
            {ring(dayPct ?? 100, 'var(--accent)', s ? `${s.days.elapsed}/${s.days.total}` : '…', 'giorni')}
            <div className="grow stack" style={{ gap: 10, minWidth: 0 }}>
              <div className="bstats">
                {stat(ongoing ? 'Speso finora' : 'Speso', s ? eur(spent) : '…')}
                {stat('Al giorno', s ? eur(perDay) : '…')}
              </div>
              {s && ongoing && <span className="muted" style={{ fontSize: 13 }}>Previsti <b className="num money" style={{ color: 'var(--ink)' }}>{eur(s.forecast)}</b> a fine {endWord}</span>}
              {monthNow && budget.data && <a href="#/budget" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Imposta un budget mensile ›</a>}
            </div>
          </div>
        </section>
      );
    })(),
    budget: !budget.data ? null : on('hero') ? (budget.data.total && budget.data.categories.length ? (
      <a href="#/budget" className="card" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
        <CardTitle icon="piggy" title="Budget per categoria" right={<Icon name="next" size={18} />} />
        {budget.data.categories.slice(0, 4).map((c) => (
          <div key={c.category_id} className="stack" style={{ gap: 5 }}>
            <span className="row between" style={{ fontSize: 14 }}><span>{store.catName(c.category_id)}</span><span className="num money"><b style={{ color: c.left < 0 ? 'var(--neg)' : undefined }}>{eur(c.spent)}</b> <span className="muted">di {eur(c.amount)}</span></span></span>
            <BudgetBar spent={c.spent} amount={c.amount} height={6} />
          </div>
        ))}
      </a>
    ) : null) : !budget.data.total ? (
      <a href="#/budget" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: '14px 16px', textDecoration: 'none', color: 'inherit' }}>
        <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="wallet" size={18} /></span>
        <span className="grow stack" style={{ gap: 2 }}><b>Imposta un budget mensile</b><span className="muted" style={{ fontSize: 13 }}>Un tetto per il mese e, se vuoi, per alcune categorie</span></span>
        <Icon name="next" size={18} />
      </a>
    ) : (
      <a href="#/budget" className="card" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
        <div className="row between">
          <div className="ctitle"><Icon name="piggy" size={23} /><h2 className="h2">Budget del mese</h2></div>
          <span className="num money" style={{ fontWeight: 700, color: budget.data.total.left < 0 ? 'var(--neg)' : 'var(--accent)' }}>
            {budget.data.total.left < 0 ? `${eur(-budget.data.total.left)} oltre` : `${eur(budget.data.total.left)} liberi`}
          </span>
        </div>
        <BudgetBar spent={budget.data.total.spent} amount={budget.data.total.amount} dayPct={(budget.data.days.elapsed / budget.data.days.total) * 100} />
        <span className="muted" style={{ fontSize: 13 }}>
          {eur(budget.data.total.spent)} di {eur(budget.data.total.amount)}{budget.data.total.left > 0 ? ` · ${eur(budget.data.total.per_day)} al giorno` : ''}
        </span>
        {budget.data.categories.slice(0, 3).map((c) => (
          <div key={c.category_id} className="stack" style={{ gap: 5 }}>
            <span className="row between" style={{ fontSize: 14 }}><span>{store.catName(c.category_id)}</span><span className="num money"><b style={{ color: c.left < 0 ? 'var(--neg)' : undefined }}>{eur(c.spent)}</b> <span className="muted">di {eur(c.amount)}</span></span></span>
            <BudgetBar spent={c.spent} amount={c.amount} height={6} />
          </div>
        ))}
      </a>
    ),
    alerts: (() => {
      const list = insights.data?.alerts.filter((a) => !dismissed.includes(a.id)) ?? [];
      if (!list.length) return null;
      return (
        <section className="card warn" style={{ gap: 10 }}>
          <CardTitle icon="bell" title="Avvisi" />
          {list.slice(0, 4).map((a) => {
            const t = alertText(a, store.catName);
            return (
              <div key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span className="lrow-ic" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', flexShrink: 0 }}><Icon name="warn" size={18} /></span>
                <a href={t.href} className="grow stack" style={{ gap: 2, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                  <b style={{ fontSize: 15 }}>{t.title}</b><span className="muted" style={{ fontSize: 13 }}>{t.text}</span>
                </a>
                <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label={`Nascondi: ${t.title}`} onClick={() => dismiss(a.id)}><Icon name="close" size={14} /></button>
              </div>
            );
          })}
        </section>
      );
    })(),
    week: insights.data?.week ? (() => {
      const w = insights.data.week;
      // Confronto solo se ha senso: settimana prima non quasi vuota e differenza non assurda.
      const raw = w.previous >= 10_000 ? Math.round(((w.spent - w.previous) / w.previous) * 100) : null;
      const d = raw != null && Math.abs(raw) <= 300 ? raw : null;
      return (
        <section className="card">
          <CardTitle icon="calendar" title="La tua settimana" right={<span className="muted" style={{ fontSize: 13 }}>{formatDayShort(w.from)} – {formatDayShort(w.to)}</span>} />
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <span className="num money" style={{ font: `700 ${fitSize(eur(w.spent), 26)}px var(--f-display)` }}>{eur(w.spent)}</span>
            {d != null && <span className={`chip ${d > 0 ? 'warn' : 'ok'}`}>{d > 0 ? '+' : ''}{d}% sulla settimana prima</span>}
          </div>
          {w.top.map((c) => <div key={c.category_id ?? 'none'} className="row between" style={{ fontSize: 14 }}><span>{store.catName(c.category_id)}</span><b className="num money">{eur(c.total)}</b></div>)}
        </section>
      );
    })() : null,
    forecast: insights.data?.forecast && insights.data.forecast.spent != null ? (() => {
      const f = insights.data.forecast as { months: number; spent: number; expected_spend: number; income: number; expected_income: number };
      const end = total + (f.expected_income - f.income) - (f.expected_spend - f.spent);
      const month = monthPeriod(0).label.split(' ')[0].toLowerCase();
      return (
        <section className="card" style={{ gap: 6 }}>
          <CardTitle icon="days" title={`Come finirà ${month}`} />
          <div>
            <div className="frow"><Icon name="moneybag" size={21} /><span>Spese previste</span><b className="num money" style={{ fontSize: fitSize(eur(f.expected_spend), 16) }}>{eur(f.expected_spend)}</b></div>
            <div className="frow"><Icon name="income" size={21} /><span>Entrate previste</span><b className="num money pos" style={{ fontSize: fitSize(eur(f.expected_income), 16) }}>{eur(f.expected_income)}</b></div>
            <div className="frow"><Icon name="growth" size={21} /><b style={{ fontSize: 15 }}>Saldo a fine mese</b><b className={`num money ${end < 0 ? 'neg' : ''}`} style={{ fontSize: fitSize(eur(end), 16) }}>{eur(end)}</b></div>
          </div>
          <span className="muted" style={{ fontSize: 12.5 }}>Dalla media degli ultimi {f.months} mesi · finora <span className="money">{eur(f.spent)}</span> di spese e <span className="money">{eur(f.income)}</span> di entrate</span>
        </section>
      );
    })() : null,
    recurring: (() => {
      const r = recurring.data;
      if (!r) return null;
      const week = localDay(new Date(Date.now() + 7 * 86400_000));
      const soon = r.confirmed.filter((c) => c.next_date && c.next_date <= week);
      const s = r.suggestions[0];
      if (!s && !soon.length) return null;
      return (
        <section className="card">
          <CardTitle icon="repeat" title="Spese ricorrenti" right={<a href="#/ricorrenti" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Tutte</a>} />
          {soon.map((c) => (
            <div key={c.id} className="row between" style={{ fontSize: 14 }}>
              <span>{c.merchant} <span className="muted">· {c.next_date! < localDay() ? 'in ritardo' : formatDayShort(c.next_date!)}</span></span>
              <b className="num money">{eur(-c.amount_eur)}</b>
            </div>
          ))}
          {s && <SuggestionCard s={s} onDone={recurring.reload} />}
        </section>
      );
    })(),
    review: store.review_count > 0 && firstReview ? (
      <section className="card warn">
        <CardTitle icon="inbox" title="Da rivedere" right={<span className="chip warn">{store.review_count}</span>} />
        <div className="row">
          <CategoryIcon id={firstReview.category_id} />
          <div className="grow stack" style={{ gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{firstReview.merchant ?? 'Spesa'} · <span className="num money">{eur(firstReview.amount_eur)}</span></span>
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
      <section className="card">
        <CardTitle icon="bank" title="Conti" right={
          <a href="#/altro" className="row" style={{ gap: 4, textDecoration: 'none', color: 'var(--muted)', fontSize: 14 }}>
            Totale <b className={`num money ${total < 0 ? 'neg' : ''}`} style={{ color: total < 0 ? undefined : 'var(--ink)', fontSize: fitSize(eur(total), 16) }}>{eur(total)}</b><Icon name="next" size={16} />
          </a>} />
        <div className="tiles">
          {store.accounts.map((a) => (
            <div key={a.id} className="tile">
              <Icon name={a.type === 'cash' ? 'cash' : a.type === 'card' ? 'card' : a.type === 'bank' ? 'bank' : 'wallet'} size={22} />
              <span>{a.name}</span>
              <b className="money" style={{ fontSize: fitSize(formatMoney(a.balance, a.currency), 16) }}>{formatMoney(a.balance, a.currency)}</b>
            </div>
          ))}
        </div>
      </section>
    ) : null,
    cashflow: s ? (
      <a href="#/statistiche/flusso" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <CardTitle icon="inout" title="Entrate e uscite"
          right={<span className={`chip ${s.income - s.spent >= 0 ? 'pos' : 'neg'}`}>Netto <span className="num money">{eur(s.income - s.spent, true)}</span></span>} />
        {([['Entrate', s.income, 'var(--income-bar)'], ['Uscite', s.spent, 'var(--out)']] as Array<[string, number, string]>).map(([label, v, color]) => (
          <div key={label} className="iorow">
            <span>{label}</span>
            <div className="bar"><div style={{ width: `${Math.max(2, (v / Math.max(s.income, s.spent, 1)) * 100)}%`, background: color }} /></div>
            <b className="num money" style={{ fontSize: fitSize(eur(v), 15) }}>{eur(v)}</b>
          </div>
        ))}
      </a>
    ) : null,
    balance: store.accounts.length > 0 ? <BalanceCard series={balance.data?.series ?? []} total={total} /> : null,
    top: s && s.by_category.length > 0 ? (
      <section className="card">
        <a href="#/statistiche/spese" className="row between" style={{ textDecoration: 'none', color: 'inherit' }} aria-label="Apri tutte le spese per categoria">
          <div className="ctitle"><Icon name="stats" size={23} /><h2 className="h2">Spese principali</h2></div>
          <span className="row" style={{ gap: 2, color: 'var(--accent)', fontSize: 14, fontWeight: 600 }}>Tutte <Icon name="next" size={16} /></span>
        </a>
        {s.by_category.slice(0, 4).map((c) => (
          <a key={c.category_id ?? 'none'} href={c.category_id ? `#/movimenti/${c.category_id}` : '#/movimenti'} className="stack" style={{ gap: 6, textDecoration: 'none', color: 'inherit' }}>
            <div className="row between" style={{ fontSize: 14 }}>
              <span>{store.catName(c.category_id)}</span>
              <span className="num money" style={{ fontWeight: 600 }}>{eur(c.total)}</span>
            </div>
            <div className="bar"><div style={{ width: `${pct(c.total, s.by_category[0].total)}%`, background: store.cat(c.category_id)?.color ?? 'var(--muted)' }} /></div>
          </a>
        ))}
      </section>
    ) : null,
    cards: s && s.by_card.some((x) => x.card) ? (
      <a href="#/carte" className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
        <CardTitle icon="card" title="Spesa per carta" right={<Icon name="next" size={18} />} />
        <span className="muted" style={{ fontSize: 13, marginTop: -6 }}>Le stesse spese del totale, divise per carta.</span>
        {s.by_card.slice(0, 5).map((x) => (
          <div key={x.card ?? 'none'} className="stack" style={{ gap: 6 }}>
            <span className="row between" style={{ fontSize: 14 }}>
              <span>{x.card ?? <span className="muted">Senza carta</span>}</span>
              <span className="num money" style={{ fontWeight: 600 }}>{eur(x.total)} <span className="muted" style={{ fontWeight: 400 }}>· {Math.round((x.total / s.spent) * 100)}%</span></span>
            </span>
            <div className="bar"><div style={{ width: `${(x.total / s.spent) * 100}%`, background: x.card ? 'var(--accent)' : 'var(--line)' }} /></div>
          </div>
        ))}
      </a>
    ) : null,
    recent: (
      <section className="card">
        <CardTitle icon="list" title="Ultimi movimenti" right={<a href="#/movimenti" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Tutti</a>} />
        {recent.data?.items.length ? recent.data.items.map((t) => <TxRow key={t.id} t={t} />) : (
          <p className="empty" style={{ padding: 8 }}>Nessun movimento. Aggiungine uno con + oppure collega un telefono.</p>
        )}
      </section>
    ),
  };

  return (
    <div className={`home stack ${store.discreet ? 'discreet' : ''}`}>
      <div className="home-head">
        <span className="logo" aria-hidden="true"><Icon name="leaf" size={22} stroke={2.2} /></span>
        <span className="vdiv" aria-hidden="true" />
        <div className="periodpill">
          <button className="iconbtn" aria-label="Periodo precedente" disabled={!periodArrows(spec.kind)} onClick={() => setPeriod({ ...spec, offset: spec.offset - 1 })}><Icon name="back" size={18} /></button>
          <button className="periodpill-label" onClick={() => setPicker(true)} aria-haspopup="dialog" aria-label={`Periodo: ${title}. Tocca per scegliere mese, anno o date`}>
            <span className="periodpill-title">{title} <span aria-hidden="true">▾</span></span>
            {sub && <span className="periodpill-sub">{sub}</span>}
          </button>
          <button className="iconbtn" aria-label="Periodo successivo" onClick={() => setPeriod({ ...spec, offset: spec.offset + 1 })} disabled={!periodArrows(spec.kind) || spec.offset >= 0}><Icon name="next" size={18} /></button>
        </div>
        <button className="head-btn" aria-label={alertCount ? `Avvisi: ${alertCount}` : 'Avvisi'} onClick={() => setShowAlerts(true)}><Icon name="bell" size={20} />{alertCount > 0 && <span className="ping" />}</button>
        <a className="head-btn opt" href="#/altro" aria-label="Account e impostazioni"><Icon name="user" size={20} /></a>
        <button className="head-btn" aria-label="Personalizza la Home" onClick={() => setCustomize(true)}><Icon name="rules" size={20} /></button>
      </div>

      {!store.account.email && (
        <a href="#/account/crea" className="card" style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: '12px 14px', textDecoration: 'none', color: 'inherit' }}>
          <span className="grow" style={{ fontSize: 14 }}>Stai usando Ledgy senza account. <b>Crea un account</b> per non perdere i dati.</span>
          <Icon name="next" size={18} />
        </a>
      )}

      {layout.map((k) => widgets[k] ? <div key={k} className="widget stack" data-widget={k}>{widgets[k]}</div> : null)}

      {picker && <PeriodSheet onClose={() => setPicker(false)} />}
      {customize && <CustomizeHome layout={layout} onClose={() => setCustomize(false)} />}
      {showAlerts && (
        <div className="modal-backdrop" onClick={() => setShowAlerts(false)}>
          <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Avvisi" onClick={(e) => e.stopPropagation()}>
            <div className="row between"><h2 className="h2">Avvisi</h2><button className="btn ghost" onClick={() => setShowAlerts(false)}>Chiudi</button></div>
            {!alertList.length ? <p className="muted" style={{ margin: 0 }}>Nessun avviso. Spese insolite, doppioni, commissioni e budget quasi finito compaiono qui.</p> : alertList.map((a) => {
              const t = alertText(a, store.catName);
              return (
                <div key={a.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                  <span className="lrow-ic" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', flexShrink: 0 }}><Icon name="warn" size={18} /></span>
                  <a href={t.href} onClick={() => setShowAlerts(false)} className="grow stack" style={{ gap: 2, textDecoration: 'none', color: 'inherit', minWidth: 0 }}>
                    <b style={{ fontSize: 15 }}>{t.title}</b><span className="muted" style={{ fontSize: 13 }}>{t.text}</span>
                  </a>
                  <button className="iconbtn" style={{ width: 32, height: 32 }} aria-label={`Nascondi: ${t.title}`} onClick={() => dismiss(a.id)}><Icon name="close" size={14} /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}
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
    // Chi sceglie a mano la disposizione non riceve più lo spostamento automatico delle schede del mockup.
    try { localStorage.setItem('ledgy-home-v3', '1'); } catch { /* niente */ }
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
        <span className="label">Tema</span>
        <div className="seg" role="group" aria-label="Tema" style={{ gridAutoFlow: 'row', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {THEMES.map(([t, l]) => (
            <button key={t} aria-pressed={store.settings.theme === t}
              onClick={async () => { applyTheme(t); await api('/settings', { method: 'PUT', json: { theme: t } }); await store.refresh(); }}>{l}</button>
          ))}
        </div>
        <div className="lrow" style={{ cursor: 'default', padding: '4px 0' }}>
          <span className="grow" style={{ fontWeight: 600 }}>Nascondi gli importi</span>
          <button role="switch" aria-checked={store.discreet} aria-label="Nascondi gli importi" onClick={() => store.setDiscreet(!store.discreet)}
            style={{ width: 44, height: 27, borderRadius: 14, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: store.discreet ? 'var(--accent)' : 'var(--line)' }}>
            <span style={{ position: 'absolute', top: 2, left: store.discreet ? 19 : 2, width: 23, height: 23, borderRadius: '50%', background: 'var(--switch-thumb)', boxShadow: 'var(--shadow-card)' }} />
          </button>
        </div>
        <span className="muted" style={{ fontSize: 14 }}>Accendi le schede che vuoi e mettile nell’ordine che preferisci.</span>
        <div className="list" style={{ overflowY: 'auto' }}>
          {order.map((k, i) => (
            <div key={k} className="lrow" style={{ cursor: 'default', opacity: enabled.has(k) ? 1 : 0.55 }}>
              <button role="switch" aria-checked={enabled.has(k)} aria-label={`${enabled.has(k) ? 'Nascondi' : 'Mostra'} ${label[k]}`}
                onClick={() => { const n = new Set(enabled); if (n.has(k)) n.delete(k); else n.add(k); save(order, n); }}
                style={{ width: 44, height: 27, borderRadius: 14, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: enabled.has(k) ? 'var(--accent)' : 'var(--line)' }}>
                <span style={{ position: 'absolute', top: 2, left: enabled.has(k) ? 19 : 2, width: 23, height: 23, borderRadius: '50%', background: 'var(--switch-thumb)', boxShadow: 'var(--shadow-card)' }} />
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

/** "Saldo totale dei conti": il totale di oggi, la variazione sui 30 giorni e l'andamento. */
function BalanceCard({ series, total }: { series: Array<{ day: string; balance: number }>; total: number }) {
  const w = 320;
  const h = 44;
  const values = series.map((p) => p.balance);
  const first = values[0];
  const last = values[values.length - 1];
  // Variazione solo se il saldo di partenza non è quasi zero e il numero ha senso.
  const raw = values.length > 1 && Math.abs(first) >= 10_000 ? Math.round(((last - first) / Math.abs(first)) * 100) : null;
  const pct = raw != null && Math.abs(raw) <= 300 ? raw : null;
  let chart: ReactNode = null;
  if (values.length > 1) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const pts = series.map((p, i) => [(i / (series.length - 1)) * (w - 10) + 4, h - 6 - ((p.balance - min) / span) * (h - 16)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    const end = pts[pts.length - 1];
    chart = (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Andamento del saldo negli ultimi 30 giorni" preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="saldo-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--hero-line)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--hero-line)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L${end[0]} ${h} L4 ${h} Z`} fill="url(#saldo-fill)" />
        <path d={line} fill="none" stroke="var(--hero-line)" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <circle cx={end[0]} cy={end[1]} r={4} fill="var(--hero-line)" />
      </svg>
    );
  }
  return (
    <a href="#/statistiche/saldo" className="card saldo" style={{ textDecoration: 'none' }}>
      <h2 className="saldo-title">Saldo totale dei conti</h2>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <span className="saldo-amount money" style={{ fontSize: eur(total).length <= 13 ? 26 : fitSize(eur(total), 26) }}>{eur(total)}</span>
        {pct != null && <span className={`chip ${pct >= 0 ? 'pos' : 'neg'}`}>{pct > 0 ? '+' : ''}{pct}%</span>}
      </div>
      {chart}
      {values.length > 1 && <div className="row between saldo-sub"><span>30 giorni fa</span><span>Oggi</span></div>}
    </a>
  );
}
