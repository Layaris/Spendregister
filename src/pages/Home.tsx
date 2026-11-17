import { useState, type ReactNode } from 'react';
import { api, type Stats, type Tx } from '../api';
import { Icon } from '../icons';
import { setPeriod, usePeriodSpec } from '../period';
import { PeriodSheet, periodArrows } from '../PeriodSheet';
import { useApi, useStore } from '../store';
import { CategoryIcon, TxRow } from '../ui';
import { eur, formatDayShort, formatMoney, localDay, monthPeriod, pct, periodOf } from '../util';
import { BudgetBar, budgetTone, type BudgetView } from './Budget';
import { SuggestionCard, useRecurring } from './Recurring';

interface Alert { id: string; kind: 'unusual' | 'duplicate' | 'fees' | 'budget'; tx?: string; amount?: number; avg?: number; merchant?: string | null; category_id?: string; pct?: number; cards?: Array<{ card: string; total: number }> }
interface Forecast { months: number; spent: number | null; expected_spend?: number; income?: number; expected_income?: number }
interface Insights { alerts: Alert[]; forecast: Forecast | null; week: { from: string; to: string; spent: number; count: number; previous: number; top: Array<{ category_id: string | null; total: number }> } | null }

/** Titolo, testo e link di un avviso (importi nella valuta di visualizzazione). */
function alertText(a: Alert, catName: (id: string | null | undefined) => string): { title: string; text: string; href: string } {
  if (a.kind === 'unusual') return { title: `Spesa insolita: ${a.merchant}`, text: `${eur(a.amount ?? 0)}, di solito circa ${eur(a.avg ?? 0)}`, href: `#/m/${a.tx}` };
  if (a.kind === 'duplicate') return { title: `Possibile doppione${a.merchant ? `: ${a.merchant}` : ''}`, text: `Due movimenti da ${eur(a.amount ?? 0)} a meno di un’ora. Se è lo stesso, eliminane uno.`, href: `#/m/${a.tx}` };
  if (a.kind === 'fees') return { title: `Commissioni bancarie: ${eur(a.amount ?? 0)} questo mese`, text: a.cards?.length ? a.cards.map((c) => `${c.card} ${eur(c.total)}`).join(' · ') : 'Guarda quali carte le addebitano', href: '#/statistiche/spese' };
  const name = a.category_id === '*' ? 'Budget del mese' : `Budget ${catName(a.category_id)}`;
  const left = a.amount ?? 0;
  return { title: `${name}: ${(a.pct ?? 0) >= 100 ? 'superato' : `al ${a.pct}%`}`, text: left >= 0 ? `Ti restano ${eur(left)}` : `Sei oltre di ${eur(-left)}`, href: '#/budget' };
}

/** Schede della Home: si accendono, si spengono e si riordinano (Personalizza). */
export const HOME_WIDGETS: Array<[string, string]> = [
  ['hero', 'Speso, saldo e previsione'], ['alerts', 'Avvisi'], ['week', 'La tua settimana'], ['budget', 'Budget del mese'], ['review', 'Da rivedere'], ['recurring', 'Spese ricorrenti in arrivo'], ['forecast', 'Fine mese prevista'], ['accounts', 'Conti'],
  ['cashflow', 'Entrate e uscite'], ['balance', 'Andamento del saldo'], ['top', 'Spese principali'], ['cards', 'Spesa per carta'], ['recent', 'Ultimi movimenti'],
];
export const DEFAULT_HOME = ['hero', 'alerts', 'week', 'budget', 'review', 'recurring', 'forecast', 'accounts', 'cashflow', 'top', 'cards', 'recent'];

const CURRENT_LABEL: Record<string, string> = {
  day: 'Speso oggi', week: 'Speso questa settimana', month: 'Speso questo mese', year: 'Speso quest’anno', ytd: 'Speso da inizio anno', custom: 'Speso nel periodo',
};

export function Home() {
  const store = useStore();
  const spec = usePeriodSpec();
  const [picker, setPicker] = useState(false);
  const [customize, setCustomize] = useState(false);
  const known = new Set(HOME_WIDGETS.map(([k]) => k));
  const layout = (store.settings.home_layout ?? DEFAULT_HOME).filter((k) => known.has(k));
  const on = (k: string) => layout.includes(k);
  const period = periodOf(spec);
  const stats = useApi<Stats>(`/stats?from=${period.from}&to=${period.to}`, [store.review_count]);
  const balance = useApi<{ series: Array<{ day: string; balance: number }> }>(on('balance') ? '/stats/balance?days=30' : null, [store.review_count]);
  // Saldo di tutti i conti: la somma dei saldi mostrati in "Conti", ciascuno al cambio di oggi.
  const total = store.accounts.reduce((sum, a) => sum + (a.balance_eur ?? 0), 0);
  const budget = useApi<BudgetView>(on('budget') || on('hero') ? `/budgets?today=${localDay()}` : null, [store.review_count]);
  const recurring = useRecurring(on('recurring'));
  const insights = useApi<Insights>(on('alerts') || on('forecast') || on('week') ? `/insights?today=${localDay()}` : null, [store.review_count]);
  const [dismissed, setDismissed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('ledgy-dismissed') ?? '[]') as string[]; } catch { return []; } });
  const dismiss = (id: string) => {
    const next = [...dismissed, id].slice(-200);
    setDismissed(next);
    try { localStorage.setItem('ledgy-dismissed', JSON.stringify(next)); } catch { /* ignora */ }
  };
  const recent = useApi<{ items: Tx[] }>('/transactions?limit=5', [store.review_count]);
  const review = useApi<{ items: Tx[] }>('/transactions?status=review&limit=1', [store.review_count]);

  const s = stats.data;
  const firstReview = review.data?.items[0];
  const diff = s && s.previous.spent > 0 ? Math.round(((s.spent - s.previous.spent) / s.previous.spent) * 100) : null;
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
      const daysLeftToday = s ? s.days.total - s.days.elapsed + 1 : 0;
      const pace = bud && dayPct != null ? (bud.spent / bud.amount) * 100 - dayPct : 0;
      const paceText = !bud || dayPct == null ? '' : bud.left < 0 ? 'Hai già superato il budget del mese.' : pace > 5 ? 'Stai spendendo un po’ più del ritmo.' : pace < -5 ? 'Sei sotto il ritmo: bene.' : 'Sei in linea con il budget.';
      const setBudget = monthNow && budget.data && !bud ? <a href="#/budget" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Imposta un budget mensile</a> : null;
      if (store.settings.hero_style === 'ring') {
        const pct = bud ? Math.round((bud.spent / Math.max(bud.amount, 1)) * 100) : null;
        const ringPct = pct != null ? Math.min(pct, 100) : dayPct ?? 100;
        const C = 2 * Math.PI * 50;
        return (
          <section className="card hero-ring">
            <svg width="112" height="112" viewBox="0 0 120 120" aria-hidden="true" style={{ flexShrink: 0 }}>
              <circle cx="60" cy="60" r="50" fill="none" stroke="var(--sunken)" strokeWidth="12" />
              <circle cx="60" cy="60" r="50" fill="none" stroke={pct != null ? budgetTone(pct) : 'var(--accent)'} strokeWidth="12" strokeLinecap="round"
                strokeDasharray={C} strokeDashoffset={C * (1 - ringPct / 100)} transform="rotate(-90 60 60)" />
              <text x="60" y="58" textAnchor="middle" fontFamily="Space Grotesk, Inter, sans-serif" fontWeight="700" fontSize="24" fill="var(--ink)">{pct != null ? `${pct}%` : s ? `${s.days.elapsed}/${s.days.total}` : '…'}</text>
              <text x="60" y="77" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="11" fill="var(--muted)">{pct != null ? 'del budget' : 'giorni'}</text>
            </svg>
            <div className="stack" style={{ gap: 4, minWidth: 0 }}>
              {bud ? (
                <>
                  <span className="label">{bud.left >= 0 ? 'Ti restano' : 'Oltre il budget di'}</span>
                  <span className="num money hero-mid" style={{ color: bud.left < 0 ? 'var(--neg)' : undefined }}>{eur(Math.abs(bud.left))}</span>
                  {bud.left > 0 && <span className="muted" style={{ fontSize: 13 }}>cioè <b style={{ color: 'var(--ink)' }}>{eur(bud.per_day)} al giorno</b> per {daysLeftToday} {daysLeftToday === 1 ? 'giorno' : 'giorni'}</span>}
                  <span className="muted" style={{ fontSize: 13 }}>Speso {eur(bud.spent)} di {eur(bud.amount)}</span>
                </>
              ) : (
                <>
                  <span className="label">{spentLabel}</span>
                  <span className="num money hero-mid">{s ? eur(spent) : '…'}</span>
                  {s && <span className="muted" style={{ fontSize: 13 }}>In media {eur(perDay)} al giorno{diff != null ? ` · ${diff > 0 ? '+' : ''}${diff}% ${prevShort}` : ''}</span>}
                  {setBudget}
                </>
              )}
            </div>
          </section>
        );
      }
      return (
        <section className="card hero">
          <div className="row between">
            <span className="label">{monthNow ? title.split(' ')[0] : spentLabel}</span>
            {bud ? <span className="muted" style={{ fontSize: 13 }}>Budget {eur(bud.amount)}</span>
              : diff != null && <span className={`chip ${diff > 0 ? 'warn' : 'ok'}`} title={`Rispetto ${prevWord}`}>{diff > 0 ? '+' : ''}{diff}% {prevShort}</span>}
          </div>
          <div className="row between" style={{ alignItems: 'flex-end', gap: 10 }}>
            <div className="stack" style={{ gap: 2, minWidth: 0 }}>
              <span className="hero-amount num money">{s ? eur(spent) : '…'}</span>
              <span className="muted" style={{ fontSize: 13 }}>{ongoing ? 'spesi finora' : 'spesi'}</span>
            </div>
            {bud && (
              <div className="stack" style={{ gap: 2, alignItems: 'flex-end', textAlign: 'right' }}>
                <span className="num money hero-left" style={{ color: bud.left < 0 ? 'var(--neg)' : 'var(--accent)' }}>{eur(Math.abs(bud.left))}</span>
                <span className="muted" style={{ fontSize: 13 }}>{bud.left < 0 ? 'oltre il budget' : 'ancora disponibili'}</span>
              </div>
            )}
          </div>
          {bud && <BudgetBar spent={bud.spent} amount={bud.amount} dayPct={dayPct} />}
          {bud ? (
            <span className="muted" style={{ fontSize: 13.5 }}>
              {dayPct != null && s ? `Oggi è il giorno ${s.days.elapsed} di ${s.days.total} (la tacca). ` : ''}{paceText}
              {bud.left > 0 && dayPct != null ? <> Puoi spendere <b style={{ color: 'var(--ink)' }}>{eur(bud.per_day)} al giorno</b>.</> : null}
            </span>
          ) : s ? (
            <span className="muted" style={{ fontSize: 13.5 }}>
              In media <b style={{ color: 'var(--ink)' }}>{eur(perDay)}</b> al giorno{ongoing ? <> · previsti <b style={{ color: 'var(--ink)' }}>{eur(s.forecast)}</b> a fine {endWord}</> : ''}
            </span>
          ) : null}
          {setBudget}
        </section>
      );
    })(),
    budget: !budget.data ? null : on('hero') ? (budget.data.total && budget.data.categories.length ? (
      <a href="#/budget" className="card" style={{ textDecoration: 'none', color: 'inherit', gap: 10 }}>
        <div className="row between"><h2 className="h2">Budget per categoria</h2><Icon name="next" size={18} /></div>
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
          <h2 className="h2">Budget del mese</h2>
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
          <h2 className="h2">Avvisi</h2>
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
      const d = w.previous > 0 ? Math.round(((w.spent - w.previous) / w.previous) * 100) : null;
      return (
        <section className="card">
          <div className="row between"><h2 className="h2">La tua settimana</h2><span className="muted" style={{ fontSize: 13 }}>{formatDayShort(w.from)} – {formatDayShort(w.to)}</span></div>
          <div className="row between" style={{ alignItems: 'flex-end' }}>
            <span className="num money" style={{ font: '700 26px var(--f-display)' }}>{eur(w.spent)}</span>
            {d != null && <span className={`chip ${d > 0 ? 'warn' : 'ok'}`}>{d > 0 ? '+' : ''}{d}% sulla settimana prima</span>}
          </div>
          {w.top.map((c) => <div key={c.category_id ?? 'none'} className="row between" style={{ fontSize: 14 }}><span>{store.catName(c.category_id)}</span><b className="num money">{eur(c.total)}</b></div>)}
        </section>
      );
    })() : null,
    forecast: insights.data?.forecast && insights.data.forecast.spent != null ? (() => {
      const f = insights.data.forecast as { months: number; spent: number; expected_spend: number; income: number; expected_income: number };
      const end = total + (f.expected_income - f.income) - (f.expected_spend - f.spent);
      return (
        <section className="card">
          <div className="row between"><h2 className="h2">Fine mese prevista</h2><span className="muted" style={{ fontSize: 12 }}>media di {f.months} mesi</span></div>
          <div className="metrics" style={{ marginTop: 0, borderTop: 0 }}>
            <div className="metric"><span>Spese previste</span><b className="num money">{eur(f.expected_spend)}</b></div>
            <div className="metric"><span>Entrate previste</span><b className="num money pos">{eur(f.expected_income)}</b></div>
            <div className="metric"><span>Saldo dei conti a fine mese</span><b className={`num money ${end < 0 ? 'neg' : ''}`}>{eur(end)}</b></div>
          </div>
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
          <div className="row between"><h2 className="h2">Spese ricorrenti</h2><a href="#/ricorrenti" style={{ fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>Tutte</a></div>
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
        <div className="row between">
          <h2 className="h2">Da rivedere</h2>
          <span className="chip warn">{store.review_count}</span>
        </div>
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
      <section className="stack" style={{ gap: 10 }}>
        <div className="row between" style={{ padding: '0 4px' }}>
          <h2 className="h2">Conti</h2>
          <span className="muted" style={{ fontSize: 14 }}>Totale <b className={`num money ${total < 0 ? 'neg' : ''}`} style={{ color: total < 0 ? undefined : 'var(--ink)' }}>{eur(total)}</b></span>
        </div>
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
        <div className="periodpill">
          <button className="iconbtn" aria-label="Periodo precedente" disabled={!periodArrows(spec.kind)} onClick={() => setPeriod({ ...spec, offset: spec.offset - 1 })}><Icon name="back" size={18} /></button>
          <button className="periodpill-label" onClick={() => setPicker(true)} aria-haspopup="dialog" aria-label={`Periodo: ${title}. Tocca per scegliere mese, anno o date`}>
            <span className="periodpill-title">{title} <span aria-hidden="true" className="muted">▾</span></span>
            {sub && <span className="periodpill-sub">{sub}</span>}
          </button>
          <button className="iconbtn" aria-label="Periodo successivo" onClick={() => setPeriod({ ...spec, offset: spec.offset + 1 })} disabled={!periodArrows(spec.kind) || spec.offset >= 0}><Icon name="next" size={18} /></button>
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

      {picker && <PeriodSheet onClose={() => setPicker(false)} />}
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
        <span className="label">Riquadro in alto</span>
        <div className="seg" role="group" aria-label="Stile del riquadro in alto">
          {([['compact', 'Budget compatto'], ['ring', 'Anello']] as const).map(([k, l]) => (
            <button key={k} aria-pressed={(store.settings.hero_style ?? 'compact') === k}
              onClick={async () => { await api('/settings', { method: 'PUT', json: { hero_style: k } }); await store.refresh(); }}>{l}</button>
          ))}
        </div>
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
