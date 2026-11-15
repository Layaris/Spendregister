import { useEffect, useState } from 'react';
import { api, type TxDetail as Detail } from '../api';
import { back } from '../router';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { eur, formatMoney, formatWhen, NATURE_LABEL } from '../util';

export function TxDetail({ id }: { id: string }) {
  const store = useStore();
  const { data: t, error, reload } = useApi<Detail>(`/transactions/${id}`);
  const [edit, setEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState({ merchant: '', note: '', category_id: null as string | null, account_id: '' as string, labels: '' });

  useEffect(() => {
    if (t) setForm({ merchant: t.merchant ?? '', note: t.note ?? '', category_id: t.category_id, account_id: t.account_id ?? '', labels: t.labels.join(', ') });
  }, [t]);

  if (!t) return <div className="stack"><TopBar /><ErrorBox error={error} />{!error && <Loading />}</div>;

  const save = async (patch: Record<string, unknown>) => {
    setErr(null);
    try {
      await api(`/transactions/${t.id}`, { method: 'PUT', json: patch });
      if (t.status === 'review' && patch.category_id) await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: { category_id: patch.category_id } });
      reload();
      await store.refresh();
      store.toast('Salvato');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const remove = async () => {
    await api(`/transactions/${t.id}`, { method: 'DELETE' });
    await store.refresh();
    store.toast('Movimento eliminato');
    back('/movimenti');
  };

  const account = store.accounts.find((a) => a.id === t.account_id);
  const hasNature = t.type === 'expense';

  return (
    <div className={`stack ${store.discreet ? 'discreet' : ''}`} style={{ gap: 14 }}>
      <TopBar backTo="/movimenti" right={<button className="btn" style={{ background: 'var(--card)' }} onClick={() => setEdit(!edit)}>{edit ? 'Chiudi' : 'Modifica'}</button>} />

      <section className="card" style={{ alignItems: 'center', textAlign: 'center', gap: 8, padding: '20px 16px' }}>
        <CategoryIcon id={t.category_id} size={56} />
        <span style={{ fontWeight: 600, fontSize: 18 }}>{t.merchant ?? 'Movimento'}</span>
        <span className="muted" style={{ fontSize: 14 }}>{store.catName(t.category_id)}</span>
        <span className="hero-amount num money" style={{ fontSize: 40, color: t.amount_eur > 0 ? 'var(--accent)' : undefined }}>{eur(t.amount_eur, t.amount_eur > 0)}</span>
        {t.currency !== 'EUR' && t.fx_rate && (
          <span className="muted num" style={{ fontSize: 14 }}>
            {formatMoney(Math.abs(t.amount), t.currency)} · 1 € = {new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(1 / t.fx_rate)} {t.currency}, tasso del {t.fx_date ? formatWhen(t.fx_date, false) : 'giorno'}
          </span>
        )}
        {t.status === 'review' && <span className="chip warn">{t.review_reason ?? 'Da rivedere'}</span>}
      </section>

      <ErrorBox error={err} />

      {edit ? (
        <section className="card">
          <label className="field"><span>Nome</span><input className="input" value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} /></label>
          <label className="field"><span>Categoria</span><CategorySelect value={form.category_id} onChange={(v) => setForm({ ...form, category_id: v })} kind="all" /></label>
          <label className="field"><span>Conto</span>
            <select className="input" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
              <option value="">Nessuno</option>
              {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Etichette, separate da virgola</span><input className="input" value={form.labels} onChange={(e) => setForm({ ...form, labels: e.target.value })} /></label>
          <label className="field"><span>Nota</span><textarea className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
          <button className="btn primary block" onClick={async () => {
            await save({ merchant: form.merchant || null, note: form.note || null, category_id: form.category_id, account_id: form.account_id || null, labels: form.labels.split(',').map((s) => s.trim()).filter(Boolean) });
            setEdit(false);
          }}>Salva</button>
        </section>
      ) : (
        <section className="card">
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
          <div className="kv"><span>Conto</span><span>{account?.name ?? '—'}</span></div>
          {t.card && <div className="kv"><span>Carta o app</span><span>{t.card}</span></div>}
          {t.labels.length > 0 && (
            <div className="kv"><span>Etichette</span><span className="row wrap" style={{ gap: 6, justifyContent: 'flex-end' }}>{t.labels.map((l) => <span key={l} className="chip">{l}</span>)}</span></div>
          )}
          <div className="kv"><span>Data</span><span className="num">{formatWhen(t.occurred_at)}</span></div>
          {t.note && <div className="kv"><span>Nota</span><span>{t.note}</span></div>}
          {t.status === 'review' && t.category_id && (
            <button className="btn primary" onClick={async () => { await api(`/transactions/${t.id}/confirm`, { method: 'POST', json: {} }); reload(); await store.refresh(); }}>Conferma</button>
          )}
        </section>
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
