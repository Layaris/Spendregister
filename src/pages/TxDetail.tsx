import { useEffect, useState } from 'react';
import { TripRowForTx } from './Trips';
import { RecurringRowForTx } from './Recurring';
import { api, type TxDetail as Detail } from '../api';
import { back } from '../router';
import { useApi, useStore } from '../store';
import { Icon } from '../icons';
import { CategoryIcon, CategorySelect, CategorySheet, ErrorBox, Loading, TopBar, type CardInfo } from '../ui';
import { parseAmount } from '../../shared/money';
import { eur, fitSize, formatMoney, formatWhen, NATURE_LABEL } from '../util';

export function TxDetail({ id }: { id: string }) {
  const store = useStore();
  const { data: t, error, reload } = useApi<Detail>(`/transactions/${id}`);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ merchant: '', note: '', amount: '', labels: '', when: '', card: '' });
  const [picking, setPicking] = useState(false);
  const [asking, setAsking] = useState(false);
  const cards = useApi<{ items: CardInfo[] }>('/cards');
  const [suggest, setSuggest] = useState<{ merchant: string; others: number; category: string } | null>(null);

  useEffect(() => {
    if (t) setForm({
      merchant: t.merchant ?? '', note: t.note ?? '', labels: t.labels.join(', '), when: t.occurred_at.slice(0, 16), card: t.card ?? '',
      amount: new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(Math.abs(t.amount) / 1000),
    });
  }, [t]);

  if (!t) return <div className="stack"><TopBar /><ErrorBox error={error} />{!error && <Loading />}</div>;

  const save = async (patch: Record<string, unknown>, msg = 'Salvato') => {
    setErr(null);
    try {
      const r = await api<{ others?: number; merchant?: string }>(`/transactions/${t.id}`, { method: 'PUT', json: patch });
      if (t.status === 'review' && patch.category_id) await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: patch.category_id } });
      if (patch.category_id && r.others && r.merchant) setSuggest({ merchant: r.merchant, others: r.others, category: patch.category_id as string });
      reload();
      await store.refresh();
      store.toast(msg);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const applyAll = async () => {
    if (!suggest) return;
    const r = await api<{ changed: number }>('/transactions/recategorize', { method: 'POST', json: { merchant: suggest.merchant, category_id: suggest.category } });
    setSuggest(null);
    await store.refresh();
    store.toast(`${r.changed} ${r.changed === 1 ? 'spesa spostata' : 'spese spostate'} in ${store.catName(suggest.category)}`);
  };
  /** Campo di testo che si salva quando lo lasci, solo se è cambiato. */
  const onBlur = (key: 'merchant' | 'note', current: string | null) => () => {
    const v = form[key].trim();
    if (v !== (current ?? '')) save({ [key]: v || null }, key === 'note' ? 'Nota salvata' : 'Salvato');
  };

  /** Categoria dall'AI (Gemini, poi NanoGPT), che cerca il negozio sul web. */
  const askAi = async () => {
    setAsking(true);
    setErr(null);
    try {
      const r = await api<{ category_id: string; reason: string; provider: string }>(`/transactions/${t.id}/ai`, { method: 'POST' });
      if (r.category_id === t.category_id) store.toast(`L’AI conferma: ${store.catName(r.category_id)} (${r.reason})`);
      else await save({ category_id: r.category_id }, `${store.catName(r.category_id)}: ${r.reason}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAsking(false);
    }
  };

  const remove = async () => {
    await api(`/transactions/${t.id}`, { method: 'DELETE' });
    await store.refresh();
    store.toast('Movimento eliminato');
    back('/movimenti');
  };

  const hasNature = t.type === 'expense';
  const income = t.amount > 0;
  const acc = store.accounts.find((x) => x.id === t.account_id);
  const cat = store.cat(t.category_id);
  const blurSave = (field: 'card', value: string, current: string | null) => {
    if (value.trim() !== (current ?? '')) save({ [field]: value.trim() || null }, 'Salvato');
  };

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 12 }}>
      <TopBar backTo="/movimenti" />

      <section className="card" style={{ alignItems: 'center', textAlign: 'center', gap: 6, padding: '18px 16px' }}>
        <CategoryIcon id={t.category_id} size={52} />
        <span style={{ fontWeight: 600, fontSize: 18 }}>{t.merchant ?? (income ? 'Entrata' : 'Spesa')}</span>
        <span className="hero-amount num money" style={{ fontSize: fitSize(eur(t.amount_eur, true), 40), color: income ? 'var(--pos)' : 'var(--neg)' }}>{eur(t.amount_eur, true)}</span>
        {t.currency !== 'EUR' && t.fx_rate && (
          <span className="muted num" style={{ fontSize: 14 }}>
            {formatMoney(Math.abs(t.amount), t.currency)} · 1 € = {new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(1 / t.fx_rate)} {t.currency}
          </span>
        )}
        <div className="row wrap" style={{ gap: 6, justifyContent: 'center' }}>
          {t.source === 'capture' && <span className="chip ok"><Icon name="bolt" size={12} stroke={2.2} />Automatica{t.card ? ` · ${t.card}` : ''}</span>}
          {t.status === 'review' && <span className="chip warn">{t.review_reason ?? 'Da rivedere'}</span>}
        </div>
      </section>

      <ErrorBox error={err} />

      {suggest && (
        <section className="card" style={{ boxShadow: 'inset 0 0 0 1.5px var(--accent-soft)' }}>
          <span>Metto <b>{store.catName(suggest.category)}</b> anche alle altre {suggest.others} {suggest.others === 1 ? 'spesa' : 'spese'} di <b>{suggest.merchant}</b>?</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" onClick={applyAll}>Sì, a tutte</button>
            <button className="btn grow" onClick={() => setSuggest(null)}>No, solo questa</button>
          </div>
        </section>
      )}

      {t.status === 'review' && t.review_choices.length > 0 && (
        <section className="card" style={{ gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Che cos’era?</span>
          <div className="row" style={{ gap: 8 }}>
            {t.review_choices.map((c) => <button key={c} className="btn grow" onClick={() => save({ category_id: c }, 'Categoria salvata')}>{store.catName(c)}</button>)}
          </div>
        </section>
      )}

      {t.type === 'transfer' && (
        <section className="card" style={{ gap: 4 }}>
          <b>{t.source === 'adjustment' ? 'Correzione del saldo' : 'Trasferimento tra conti'}</b>
          <span className="muted" style={{ fontSize: 14 }}>{t.source === 'adjustment'
            ? 'Cambia solo il saldo del conto: non è una spesa né un’entrata, quindi non conta in statistiche, budget e avvisi.'
            : 'Soldi spostati tra i tuoi conti: non contano come spesa né come entrata.'}</span>
        </section>
      )}

      {t.card && t.amount < 0 && <FxCard t={t} onSaved={reload} />}
      {t.type !== 'transfer' && <SplitCard t={t} onSaved={reload} />}

      <span className="section-title">Essenziale</span>
      <div className="list">
        <div className="lrow note">
          <span className="lrow-ic"><Icon name="note" size={18} /></span>
          <textarea className="lrow-input" rows={2} placeholder="Aggiungi una descrizione" aria-label="Descrizione" value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={onBlur('note', t.note)} />
        </div>
        {t.type !== 'transfer' && <button className="lrow" onClick={() => setPicking(true)}>
          {cat ? <CategoryIcon id={t.category_id} size={32} /> : <span className="lrow-ic"><Icon name="question" size={18} /></span>}
          <span className="lrow-label">Categoria</span>
          <span className={`lrow-value ${cat ? 'set' : 'accent'}`}>{cat ? cat.name : 'Scegli'}</span>
          <Icon name="next" size={18} />
        </button>}
        <label className="lrow">
          <span className="lrow-ic"><Icon name="store" size={18} /></span>
          <span className="lrow-label">Dove</span>
          <input className="lrow-input" placeholder="Negozio o persona" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} onBlur={onBlur('merchant', t.merchant)} />
        </label>
      </div>
      {t.type !== 'transfer' && <button className="btn" style={{ background: 'var(--card)', alignSelf: 'flex-start' }} disabled={asking} onClick={askAi}>
        <Icon name="sparkle" size={18} />{asking ? 'L’AI sta cercando…' : cat ? 'Chiedi all’AI se è giusta' : 'Chiedi la categoria all’AI'}
      </button>}
      {picking && <CategorySheet value={t.category_id} kind={income ? 'income' : 'expense'} onPick={(v) => { setPicking(false); save({ category_id: v }, 'Categoria salvata'); }} onClose={() => setPicking(false)} />}

      <span className="section-title">Dettagli</span>
      <div className="list">
        {t.type !== 'transfer' && <div className="lrow" style={{ cursor: 'default', padding: '10px 12px' }}>
          <div className="seg grow" role="group" aria-label="Spesa o entrata">
            {(['expense', 'income'] as const).map((k) => (
              <button key={k} aria-pressed={(k === 'income') === income}
                onClick={() => {
                  if ((k === 'income') === income) return;
                  // Una categoria di spesa non vale per un'entrata (e viceversa): si toglie e Ledgy la ripropone.
                  const keep = cat && cat.kind === k;
                  save({ type: k, ...(keep ? {} : { category_id: null }) }, k === 'income' ? 'Ora è un’entrata' : 'Ora è una spesa');
                }}>{k === 'income' ? 'Entrata' : 'Spesa'}</button>
            ))}
          </div>
        </div>}
        <label className="lrow">
          <span className="lrow-ic"><Icon name="income" size={18} /></span>
          <span className="lrow-label">Importo</span>
          <input className="lrow-input num" inputMode="decimal" aria-label={`Importo in ${t.currency}`} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
            onBlur={() => {
              const v = parseAmount(form.amount, t.currency)?.value;
              if (v && Math.round(v * 1000) !== Math.abs(t.amount)) save({ amount: v }, 'Importo salvato');
            }} />
          <span className="muted" style={{ fontWeight: 600 }}>{t.currency}</span>
        </label>
        <label className="lrow">
          <span className="lrow-ic"><Icon name="wallet" size={18} /></span>
          <span className="lrow-label">Conto</span>
          <span className="lrow-value set">{acc ? `${acc.name} · ${acc.currency}` : 'Nessuno'}</span>
          <Icon name="next" size={18} />
          <select className="overlay" aria-label="Conto" value={t.account_id ?? ''} onChange={(e) => save({ account_id: e.target.value || null }, 'Conto salvato')}>
            <option value="">Nessuno</option>
            {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </select>
        </label>
        <label className="lrow">
          <span className="lrow-ic"><Icon name="calendar" size={18} /></span>
          <span className="lrow-label">Data e ora</span>
          <span className="lrow-value set">{formatWhen(form.when ? `${form.when}:00` : t.occurred_at)}</span>
          <Icon name="next" size={18} />
          <input className="overlay" type="datetime-local" aria-label="Data e ora" value={form.when}
            onChange={(e) => { if (!e.target.value) return; setForm({ ...form, when: e.target.value }); save({ occurred_at: `${e.target.value}:00${t.occurred_at.slice(19)}` }, 'Data salvata'); }} />
        </label>
        <label className="lrow">
          <span className="lrow-ic"><Icon name="card" size={18} /></span>
          <span className="lrow-label">Carta o banca</span>
          <input className="lrow-input" list="known-cards" placeholder={t.source === 'capture' ? 'Es. Revolut' : 'Facoltativa'} value={form.card}
            onChange={(e) => setForm({ ...form, card: e.target.value })} onBlur={() => blurSave('card', form.card, t.card)} />
        </label>
        {hasNature && (
          <div className="lrow" style={{ cursor: 'default', padding: '10px 12px' }}>
            <div className="seg grow nature" role="group" aria-label="Natura della spesa">
              {(['must', 'need', 'want'] as const).map((n) => (
                <button key={n} aria-pressed={t.nature === n} onClick={() => save({ nature: n })}>{NATURE_LABEL[n]}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      {t.source === 'capture' && <span className="muted" style={{ fontSize: 13, padding: '0 6px' }}>La carta e il conto che scegli qui valgono anche per le prossime notifiche con lo stesso titolo; la carta anche per quelle già arrivate.</span>}

      <datalist id="known-cards">{cards.data?.items.map((c) => <option key={c.name} value={c.name} />)}</datalist>
      <span className="section-title">Altro</span>
      <div className="list">
        <label className="lrow">
          <span className="lrow-ic"><Icon name="tag" size={18} /></span>
          <span className="lrow-label">Etichette</span>
          <input className="lrow-input" placeholder="Es. Viaggio Bangkok" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })}
            onBlur={() => { if (form.labels !== t.labels.join(', ')) save({ labels: form.labels.split(',').map((x) => x.trim()).filter(Boolean) }); }} />
        </label>
        {t.type !== 'transfer' && <TripRowForTx txId={t.id} />}
        {t.type === 'expense' && t.merchant && <RecurringRowForTx merchant={t.merchant} amount={t.amount_eur} categoryId={t.category_id} />}
        <a className="lrow" href={`#/regole/nuova?da=${t.id}`}>
          <span className="lrow-ic"><Icon name="rules" size={18} /></span>
          <span className="lrow-label grow">Crea una regola{t.merchant ? ` per ${t.merchant}` : ''}</span>
          <Icon name="next" size={18} />
        </a>
      </div>

      {t.status === 'review' && t.category_id && (
        <button className="btn primary block" onClick={async () => { await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: {} }); reload(); await store.refresh(); }}>Conferma</button>
      )}

      {(t.capture || t.rules.length > 0) && (
        <section className="card">
          <h2 className="h2">Come è stato registrato</h2>
          {t.capture && <div className="raw">{[t.capture.title, t.capture.text].filter(Boolean).join('\n')}</div>}
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14 }}>
            {t.capture && <li>Notifica {t.card ? `di ${t.card} ` : ''}ricevuta il {new Intl.DateTimeFormat('it-IT', { timeZone: store.settings.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(t.capture.received_at))}</li>}
            {t.capture?.detail && <li>Letta con: {t.capture.detail}</li>}
            {t.merchant_raw && t.merchant_raw !== t.merchant && <li>Nome pulito: “{t.merchant_raw}” → {t.merchant}</li>}
            {t.rules.map((r) => <li key={r.id}>Regola applicata: <a href={`#/regole/${r.id}`}>{r.name}</a></li>)}
          </ul>
        </section>
      )}

      {confirmDelete ? (
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} onClick={remove}>Elimina davvero</button>
          <button className="btn" onClick={() => setConfirmDelete(false)}>Annulla</button>
        </div>
      ) : (
        <button className="btn ghost" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={() => setConfirmDelete(true)}>Elimina movimento</button>
      )}
    </div>
  );
}

/**
 * Costo del cambio di questa spesa. Se la carta ha già un ricarico calcolato si mostra la stima; altrimenti (o per
 * ricalcolarlo) si scrive quanto ha addebitato la carta nella sua valuta e Ledgy ricava il ricarico dal cambio ufficiale.
 */
function FxCard({ t, onSaved }: { t: Detail; onSaved: () => void }) {
  const store = useStore();
  const fx = t.card_fx;
  const [open, setOpen] = useState(false);
  const [charged, setCharged] = useState('');
  const [currency, setCurrency] = useState(fx?.currency ?? (t.currency === 'USD' ? 'EUR' : 'USD'));
  const [err, setErr] = useState<string | null>(null);
  const known = fx && fx.markup_bp != null;
  const same = known && fx!.currency === t.currency;
  const isSample = known && fx!.sample_tx_id === t.id;
  const pct = known ? (fx!.markup_bp! / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 }) : '';
  const send = async () => {
    setErr(null);
    const v = parseAmount(charged, currency)?.value;
    if (!v) { setErr("Scrivi l'importo addebitato"); return; }
    try {
      const r = await api<{ markup_bp: number }>('/cards/calibrate', { method: 'POST', json: { tx_id: t.id, charged: v, currency } });
      store.toast(`${t.card}: ricarico sul cambio ${(r.markup_bp / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%`);
      setOpen(false);
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  };
  if (same && !open) return null; // spesa nella valuta della carta: niente cambio
  if (!known && !open) {
    return (
      <div className="list">
        <button className="lrow" onClick={() => setOpen(true)}>
          <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="card" size={18} /></span>
          <span className="grow stack" style={{ gap: 0, textAlign: 'left', minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>Costo del cambio di {t.card}</span>
            <span className="muted" style={{ fontSize: 13 }}>Scrivi quanto ha addebitato la carta nella sua valuta</span>
          </span>
          <Icon name="next" size={18} />
        </button>
      </div>
    );
  }
  return (
    <section className="card" style={{ gap: 8 }}>
      <div className="row between">
        <b>Costo del cambio</b>
        {known && !same && t.fx_fee != null && <b className="num money" style={{ color: 'var(--neg)' }}>{eur(t.fx_fee)}</b>}
      </div>
      {known && !same ? (
        <span className="muted" style={{ fontSize: 14 }}>
          {isSample
            ? <>Qui {t.card} ha addebitato <b style={{ color: 'var(--ink)' }}>{formatMoney(fx!.sample_charged ?? 0, fx!.currency!)}</b>: il suo ricarico sul cambio è {pct}%.</>
            : <>Stima: {t.card} ricarica circa il {pct}% sul cambio ufficiale (in {fx!.currency}). Calcolato da una tua spesa.</>}
        </span>
      ) : (
        <span className="muted" style={{ fontSize: 14 }}>Quanto ti ha addebitato {t.card} nella sua valuta? Scrivilo una volta: Ledgy calcola il ricarico della carta e lo stima su tutte le spese successive.</span>
      )}
      {open ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow num" inputMode="decimal" placeholder="Es. 12,47" aria-label="Importo addebitato dalla carta" value={charged} onChange={(e) => setCharged(e.target.value)} />
            <select className="input" style={{ width: 96 }} aria-label="Valuta della carta" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {['USD', 'EUR', 'IDR', 'SGD', 'AUD', 'GBP', 'THB', 'MYR', 'AED', 'CHF', 'JPY'].filter((c) => c !== t.currency).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <ErrorBox error={err} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" onClick={send}>Calcola il ricarico</button>
            <button className="btn" onClick={() => setOpen(false)}>Annulla</button>
          </div>
        </div>
      ) : (
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}>{known ? 'Ricalcola con questa spesa' : `Scrivi quanto ha addebitato ${t.card}`}</button>
      )}
    </section>
  );
}

/** Spesa divisa in più categorie: elenco delle parti, oppure l'editor per dividerla. */
function SplitCard({ t, onSaved }: { t: Detail; onSaved: () => void }) {
  const store = useStore();
  const kind = t.amount < 0 ? 'expense' : 'income';
  const fmt = (milli: number) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(Math.abs(milli) / 1000);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Array<{ amount: string; category_id: string | null }>>([]);
  const [err, setErr] = useState<string | null>(null);
  const parts = t.split ?? [];
  const start = () => {
    setRows([{ amount: fmt(t.amount), category_id: t.category_id }, { amount: '', category_id: null }]);
    setErr(null);
    setOpen(true);
  };
  const values = rows.map((r) => parseAmount(r.amount, t.currency)?.value ?? 0);
  const total = Math.abs(t.amount) / 1000;
  const used = values.reduce((a, v) => a + v, 0);
  const rest = Math.round((total - used) * 1000) / 1000;
  const setRow = (i: number, patch: Partial<{ amount: string; category_id: string | null }>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  // Scrivendo una parte nuova, la prima si riduce da sola finché la somma torna.
  const setAmount = (i: number, v: string) => {
    const next = rows.map((r, j) => (j === i ? { ...r, amount: v } : r));
    if (i > 0) {
      const others = next.slice(1).reduce((a, r) => a + (parseAmount(r.amount, t.currency)?.value ?? 0), 0);
      const first = Math.round((total - others) * 1000) / 1000;
      if (first > 0) next[0] = { ...next[0], amount: new Intl.NumberFormat('it-IT', { maximumFractionDigits: 3 }).format(first) };
    }
    setRows(next);
  };
  const save = async () => {
    setErr(null);
    const filled = rows.map((r, i) => ({ amount: values[i], category_id: r.category_id })).filter((r) => r.amount > 0);
    if (filled.length < 2) { setErr('Servono almeno due parti con un importo'); return; }
    if (Math.abs(rest) > 0.0005) { setErr(`Le parti devono fare ${formatMoney(Math.abs(t.amount), t.currency)}`); return; }
    try {
      await api(`/transactions/${t.id}/split`, { method: 'POST', json: { parts: filled } });
      store.toast(`Spesa divisa in ${filled.length} parti`);
      setOpen(false);
      onSaved();
      await store.refresh();
    } catch (e) { setErr((e as Error).message); }
  };
  const unsplit = async () => {
    try {
      const r = await api<{ id: string }>(`/transactions/${t.id}/unsplit`, { method: 'POST' });
      store.toast('Parti riunite in una spesa');
      if (r.id !== t.id) location.hash = `#/m/${r.id}`;
      else onSaved();
      await store.refresh();
    } catch (e) { setErr((e as Error).message); }
  };

  if (parts.length > 1) {
    const sum = parts.reduce((a, p) => a + Math.abs(p.amount), 0);
    return (
      <section className="card" style={{ gap: 8 }}>
        <div className="row between">
          <b>Spesa divisa in {parts.length} parti</b>
          <span className="num money muted">{formatMoney(sum, t.currency)}</span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {parts.map((p) => (
            <a key={p.id} href={`#/m/${p.id}`} className="row" style={{ gap: 10, textDecoration: 'none', color: 'inherit', fontWeight: p.id === t.id ? 700 : 400 }}>
              <CategoryIcon id={p.category_id} size={28} />
              <span className="grow">{store.catName(p.category_id)}</span>
              <span className="num money">{formatMoney(Math.abs(p.amount), t.currency)}</span>
            </a>
          ))}
        </div>
        <ErrorBox error={err} />
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={unsplit}>Riunisci in una spesa</button>
      </section>
    );
  }
  if (!open) {
    return (
      <div className="list">
        <button className="lrow" onClick={start}>
          <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="inout" size={18} /></span>
          <span className="grow stack" style={{ gap: 0, textAlign: 'left', minWidth: 0 }}>
            <span style={{ fontWeight: 600 }}>Dividi in più categorie</span>
            <span className="muted" style={{ fontSize: 13 }}>Es. supermercato: una parte cibo, una parte casa</span>
          </span>
          <Icon name="next" size={18} />
        </button>
      </div>
    );
  }
  return (
    <section className="card" style={{ gap: 10 }}>
      <b>Dividi {formatMoney(Math.abs(t.amount), t.currency)}</b>
      {rows.map((r, i) => (
        <div key={i} className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input num" style={{ width: 130 }} inputMode="decimal" aria-label={`Importo della parte ${i + 1}`} placeholder="0" value={r.amount} onChange={(e) => setAmount(i, e.target.value)} />
            <div className="grow"><CategorySelect value={r.category_id} onChange={(v) => setRow(i, { category_id: v })} kind={kind} id={`split-cat-${i}`} /></div>
            {i > 1 && <button className="btn ghost" aria-label={`Togli la parte ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>}
          </div>
        </div>
      ))}
      <div className="row between">
        <button className="btn ghost" disabled={rows.length >= 10} onClick={() => setRows([...rows, { amount: '', category_id: null }])}>+ Aggiungi una parte</button>
        <span className="muted" style={{ fontSize: 13, color: Math.abs(rest) > 0.0005 ? 'var(--neg)' : undefined }}>
          {Math.abs(rest) > 0.0005 ? `${rest > 0 ? 'Mancano' : 'Troppo di'} ${formatMoney(Math.round(Math.abs(rest) * 1000), t.currency)}` : 'Somma giusta'}
        </span>
      </div>
      <ErrorBox error={err} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn primary grow" onClick={save}>Dividi</button>
        <button className="btn" onClick={() => setOpen(false)}>Annulla</button>
      </div>
    </section>
  );
}
