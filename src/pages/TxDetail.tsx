import { useEffect, useState } from 'react';
import { api, type TxDetail as Detail } from '../api';
import { back } from '../router';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { parseAmount } from '../../shared/money';
import { eur, formatMoney, formatWhen, NATURE_LABEL } from '../util';

export function TxDetail({ id }: { id: string }) {
  const store = useStore();
  const { data: t, error, reload } = useApi<Detail>(`/transactions/${id}`);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ merchant: '', note: '', amount: '', labels: '', when: '' });
  const [suggest, setSuggest] = useState<{ merchant: string; others: number; category: string } | null>(null);

  useEffect(() => {
    if (t) setForm({
      merchant: t.merchant ?? '', note: t.note ?? '', labels: t.labels.join(', '), when: t.occurred_at.slice(0, 16),
      amount: String(Math.abs(t.amount) / 1000).replace('.', ','),
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

  const remove = async () => {
    await api(`/transactions/${t.id}`, { method: 'DELETE' });
    await store.refresh();
    store.toast('Movimento eliminato');
    back('/movimenti');
  };

  const hasNature = t.type === 'expense';
  const income = t.amount > 0;

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <TopBar backTo="/movimenti" />

      <section className="card" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '20px 16px' }}>
        <CategoryIcon id={t.category_id} size={56} />
        <span style={{ fontWeight: 600, fontSize: 18 }}>{t.merchant ?? 'Movimento'}</span>
        <span className="hero-amount num money" style={{ fontSize: 40, color: income ? 'var(--pos)' : undefined }}>{eur(t.amount_eur, income)}</span>
        {t.currency !== 'EUR' && t.fx_rate && (
          <span className="muted num" style={{ fontSize: 14 }}>
            {formatMoney(Math.abs(t.amount), t.currency)} · 1 € = {new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(1 / t.fx_rate)} {t.currency}, tasso del {t.fx_date ? formatWhen(t.fx_date, false) : 'giorno'}
          </span>
        )}
        {t.status === 'review' && <span className="chip warn">{t.review_reason ?? 'Da rivedere'}</span>}
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

      <section className="card">
        <label className="field"><span>Categoria</span>
          <CategorySelect value={t.category_id} onChange={(v) => save({ category_id: v }, 'Categoria salvata')} kind={income ? 'income' : 'expense'} />
        </label>
        {t.status === 'review' && t.review_choices.length > 0 && (
          <div className="row wrap" style={{ gap: 8 }}>
            {t.review_choices.map((c) => <button key={c} className="pill small" onClick={() => save({ category_id: c }, 'Categoria salvata')}>{store.catName(c)}</button>)}
          </div>
        )}
        {hasNature && (
          <div className="field">
            <span>Natura della spesa</span>
            <div className="seg" role="group" aria-label="Natura della spesa">
              {(['must', 'need', 'want'] as const).map((n) => (
                <button key={n} aria-pressed={t.nature === n} onClick={() => save({ nature: n })}>{NATURE_LABEL[n]}</button>
              ))}
            </div>
          </div>
        )}
        <label className="field"><span>Nota</span>
          <textarea className="input" rows={2} placeholder="Aggiungi una nota" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} onBlur={onBlur('note', t.note)} />
        </label>
        <label className="field"><span>Nome</span>
          <input className="input" value={form.merchant} placeholder="Dove o cosa" onChange={(e) => setForm({ ...form, merchant: e.target.value })} onBlur={onBlur('merchant', t.merchant)} />
        </label>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label className="field grow"><span>Importo ({t.currency})</span>
            <input className="input num" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })}
              onBlur={() => {
                const v = parseAmount(form.amount, t.currency)?.value;
                if (v && Math.round(v * 1000) !== Math.abs(t.amount)) save({ amount: v }, 'Importo salvato');
              }} />
          </label>
          <label className="field grow"><span>Conto</span>
            <select className="input" value={t.account_id ?? ''} onChange={(e) => save({ account_id: e.target.value || null }, 'Conto salvato')}>
              <option value="">Nessuno</option>
              {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        <label className="field"><span>Data e ora</span>
          <input className="input" type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })}
            onBlur={() => { if (form.when && form.when !== t.occurred_at.slice(0, 16)) save({ occurred_at: `${form.when}:00${t.occurred_at.slice(19)}` }, 'Data salvata'); }} />
        </label>
        <label className="field"><span>Etichette, separate da virgola</span>
          <input className="input" value={form.labels} placeholder="Es. Viaggio Bangkok" onChange={(e) => setForm({ ...form, labels: e.target.value })}
            onBlur={() => { if (form.labels !== t.labels.join(', ')) save({ labels: form.labels.split(',').map((x) => x.trim()).filter(Boolean) }); }} />
        </label>
        {t.card && <div className="kv"><span>Carta o app</span><span>{t.card}</span></div>}
        {t.status === 'review' && t.category_id && (
          <button className="btn primary" onClick={async () => { await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: {} }); reload(); await store.refresh(); }}>Conferma</button>
        )}
      </section>

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
