import { useEffect, useState } from 'react';
import type { Band, Condition, ConditionField, ConditionOp, Rule, RuleActions, RuleDefinition } from '../../shared/rules';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { useApi, useStore } from '../store';
import { CategorySelect, ErrorBox, Loading, TopBar } from '../ui';
import { NATURE_LABEL } from '../util';

const FIELDS: Array<[ConditionField, string]> = [
  ['merchant', 'Il merchant'], ['text', 'Il testo della notifica'], ['app', "L'app o carta"], ['currency', 'La valuta'],
  ['amount_eur', "L'importo in euro"], ['hour', "L'ora"], ['weekday', 'Il giorno (1 = lunedì)'], ['source', 'La fonte'],
];
const OPS: Array<[ConditionOp, string]> = [
  ['contains', 'contiene'], ['not_contains', 'non contiene'], ['equals', 'è uguale a'], ['starts', 'inizia con'], ['regex', 'corrisponde a (regex)'],
  ['lt', 'è minore di'], ['gte', 'è almeno'], ['gt', 'è maggiore di'], ['lte', 'è al massimo'],
];

export function RulesList() {
  const store = useStore();
  const { data, error, reload } = useApi<{ items: Rule[] }>('/rules');
  const toggle = async (r: Rule) => {
    await api(`/rules/${r.id}`, { method: 'PUT', json: { enabled: !r.enabled } });
    reload();
  };
  const describe = (r: Rule) => {
    const short = (v: unknown) => {
      const t = String(v).replace(/\\b|\\W\*|\\W\?|\\s\*/g, '').replace(/\|/g, ', ');
      return t.length > 60 ? `${t.slice(0, 57)}…` : t;
    };
    const parts = r.definition.conditions.map((c) => `${FIELDS.find((f) => f[0] === c.field)?.[1].toLowerCase()} ${OPS.find((o) => o[0] === c.op)?.[1]} “${short(c.value)}”`);
    const target = r.definition.actions.category_id ? ` → ${store.catName(r.definition.actions.category_id)}` : r.definition.bands?.length ? ` → ${r.definition.bands.length} fasce di importo` : '';
    return `${parts.join(' e ') || 'sempre'}${target}`;
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/altro" right={<a className="btn primary" href="#/regole/nuova"><Icon name="plus" size={18} />Nuova</a>} />
      <h1 className="page-title">Regole</h1>
      <p className="lead">Si applicano in ordine, dall'alto: la prima che sceglie la categoria vince, le etichette si sommano.</p>
      <ErrorBox error={error} />
      {!data ? <Loading /> : (
        [{ title: 'Le tue regole', note: 'Vincono sempre.', items: data.items.filter((r) => !r.definition.soft) },
          { title: 'Predefinite per chi viaggia', note: 'Valgono finché non correggi tu la categoria di quel negozio.', items: data.items.filter((r) => r.definition.soft) }]
          .filter((g) => g.items.length).map((g) => (
        <section key={g.title} className="card">
          <div className="stack" style={{ gap: 0 }}><span className="h2">{g.title}</span><span className="muted" style={{ fontSize: 13 }}>{g.note}</span></div>
          {g.items.map((r) => (
            <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
              <a href={`#/regole/${r.id}`} className="grow stack" style={{ gap: 2, textDecoration: 'none', color: 'inherit', opacity: r.enabled ? 1 : 0.55 }}>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span className="muted" style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{describe(r)}</span>
              </a>
              <Toggle on={r.enabled} label={`Regola ${r.name} attiva`} onChange={() => toggle(r)} />
            </div>
          ))}
        </section>
          ))
      )}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={onChange}
      style={{ width: 51, height: 31, borderRadius: 16, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--line)' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.2)', transition: 'left .15s' }} />
    </button>
  );
}

const EMPTY: RuleDefinition = { conditions: [{ field: 'merchant', op: 'contains', value: '' }], actions: {} };

export function RuleEditor({ id }: { id: string }) {
  const store = useStore();
  const isNew = id === 'nuova';
  const existing = useApi<{ items: Rule[] }>(isNew ? null : '/rules');
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(100);
  const [def, setDef] = useState<RuleDefinition>(EMPTY);
  const [useBands, setUseBands] = useState(false);
  const [preview, setPreview] = useState<{ matched: number; changed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyHistory, setApplyHistory] = useState(false);

  useEffect(() => {
    const r = existing.data?.items.find((x) => x.id === id);
    if (r) { setName(r.name); setPriority(r.priority); setDef(r.definition); setUseBands(!!r.definition.bands?.length); }
  }, [existing.data, id]);

  const setCond = (i: number, patch: Partial<Condition>) => setDef({ ...def, conditions: def.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const setActions = (patch: Partial<RuleActions>) => setDef({ ...def, actions: { ...def.actions, ...patch } });
  const bands = def.bands ?? [];
  const setBand = (i: number, patch: Partial<Band>) => setDef({ ...def, bands: bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  const clean = (): RuleDefinition => ({
    conditions: def.conditions.filter((c) => String(c.value).trim() !== '').map((c) => (['lt', 'lte', 'gt', 'gte'].includes(c.op) ? { ...c, value: Number(c.value) } : c)),
    actions: Object.fromEntries(Object.entries(def.actions).filter(([, v]) => v !== '' && v != null && !(Array.isArray(v) && !v.length))) as RuleActions,
    bands: useBands ? bands : undefined,
    ...(def.soft ? { soft: true } : {}),
  });

  // Il server lavora a pagine (limite di CPU di Cloudflare): si richiama finché next non è null.
  const runPreview = async () => {
    setError(null);
    setPreview(null);
    try {
      let after = 0;
      let matched = 0;
      let changed = 0;
      for (;;) {
        const r = await api<{ matched: number; changed: number; next: number | null }>('/rules/preview', { method: 'POST', json: { definition: clean(), after } });
        matched += r.matched;
        changed += r.changed;
        if (r.next == null) break;
        after = r.next;
      }
      setPreview({ matched, changed });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setError(null);
    try {
      const payload = { name, priority, definition: clean() };
      const ruleId = isNew ? (await api<{ id: string }>('/rules', { method: 'POST', json: payload })).id : (await api(`/rules/${id}`, { method: 'PUT', json: payload }), id);
      if (applyHistory) {
        let after = 0;
        let changed = 0;
        for (;;) {
          const r = await api<{ changed: number; next: number | null }>(`/rules/${ruleId}/apply`, { method: 'POST', json: { after } });
          changed += r.changed;
          if (r.next == null) break;
          after = r.next;
        }
        store.toast(`Regola salvata, ${changed} movimenti aggiornati`);
      } else store.toast('Regola salvata');
      go('/regole');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async () => {
    await api(`/rules/${id}`, { method: 'DELETE' });
    store.toast('Regola eliminata');
    go('/regole');
  };

  if (!isNew && !existing.data) return <Loading />;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/regole" />
      <label className="field"><span>Nome della regola</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Es. Grab" /></label>

      <section className="card">
        <h2 className="h2">Quando</h2>
        {def.conditions.map((c, i) => (
          <div key={i} className="stack" style={{ gap: 6, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="row" style={{ gap: 6 }}>
              <select className="input" value={c.field} onChange={(e) => setCond(i, { field: e.target.value as ConditionField })}>{FIELDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <select className="input" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as ConditionOp })}>{OPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </div>
            <div className="row" style={{ gap: 6 }}>
              <input className="input" aria-label="Valore" value={String(c.value)} onChange={(e) => setCond(i, { value: e.target.value })} />
              <button className="iconbtn" style={{ background: 'var(--sunken)' }} aria-label="Togli condizione" onClick={() => setDef({ ...def, conditions: def.conditions.filter((_, j) => j !== i) })}><Icon name="close" size={18} /></button>
            </div>
          </div>
        ))}
        <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setDef({ ...def, conditions: [...def.conditions, { field: 'merchant', op: 'contains', value: '' }] })}>+ Aggiungi condizione</button>
      </section>

      <section className="card">
        <div className="row between"><h2 className="h2">Fasce di importo</h2><Toggle on={useBands} label="Usa fasce di importo" onChange={() => { setUseBands(!useBands); if (!bands.length) setDef({ ...def, bands: [{ max: 2, actions: {} }, { min: 2, actions: {} }] }); }} /></div>
        {useBands ? (
          <>
            {bands.map((b, i) => (
              <div key={i} className="stack" style={{ gap: 6, padding: 10, background: 'var(--sunken)', borderRadius: 12 }}>
                <div className="row" style={{ gap: 6, fontSize: 14 }}>
                  <span>Da</span>
                  <input className="input num" style={{ width: 80 }} inputMode="decimal" aria-label="Da euro" value={b.min ?? ''} onChange={(e) => setBand(i, { min: e.target.value === '' ? undefined : Number(e.target.value.replace(',', '.')) })} />
                  <span>a</span>
                  <input className="input num" style={{ width: 80 }} inputMode="decimal" aria-label="A euro" placeholder="oltre" value={b.max ?? ''} onChange={(e) => setBand(i, { max: e.target.value === '' ? undefined : Number(e.target.value.replace(',', '.')) })} />
                  <span>€</span>
                  <button className="iconbtn" aria-label="Togli fascia" onClick={() => setDef({ ...def, bands: bands.filter((_, j) => j !== i) })}><Icon name="close" size={18} /></button>
                </div>
                <div className="seg" role="group" aria-label="Cosa fare in questa fascia">
                  <button aria-pressed={!b.actions.ask} onClick={() => setBand(i, { actions: { category_id: b.actions.category_id } })}>Categoria</button>
                  <button aria-pressed={!!b.actions.ask} onClick={() => setBand(i, { actions: { ask: b.actions.ask ?? [] } })}>Chiedimi</button>
                </div>
                {b.actions.ask ? (
                  <>
                    <span className="muted" style={{ fontSize: 13 }}>Ti chiedo tra:</span>
                    {[0, 1].map((k) => (
                      <CategorySelect key={k} value={b.actions.ask?.[k] ?? null} onChange={(v) => { const ask = [...(b.actions.ask ?? [])]; ask[k] = v ?? ''; setBand(i, { actions: { ask: ask.filter(Boolean) } }); }} />
                    ))}
                  </>
                ) : (
                  <CategorySelect value={b.actions.category_id ?? null} onChange={(v) => setBand(i, { actions: { category_id: v ?? undefined } })} />
                )}
              </div>
            ))}
            <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setDef({ ...def, bands: [...bands, { min: bands[bands.length - 1]?.max, actions: {} }] })}>+ Aggiungi fascia</button>
          </>
        ) : (
          <label className="field"><span>Categoria</span><CategorySelect value={def.actions.category_id ?? null} onChange={(v) => setActions({ category_id: v ?? undefined })} kind="all" /></label>
        )}
      </section>

      <section className="card">
        <h2 className="h2">Imposta anche</h2>
        <label className="field"><span>Nome pulito</span><input className="input" value={def.actions.merchant ?? ''} onChange={(e) => setActions({ merchant: e.target.value || undefined })} placeholder="Es. Grab" /></label>
        <div className="field"><span>Natura</span>
          <div className="seg" role="group" aria-label="Natura">
            {(['must', 'need', 'want'] as const).map((n) => <button key={n} aria-pressed={def.actions.nature === n} onClick={() => setActions({ nature: def.actions.nature === n ? undefined : n })}>{NATURE_LABEL[n]}</button>)}
          </div>
        </div>
        <label className="field"><span>Etichette, separate da virgola</span><input className="input" value={(def.actions.labels ?? []).join(', ')} onChange={(e) => setActions({ labels: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
        <label className="field"><span>Priorità (più bassa = prima)</span><input className="input num" type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} /></label>
      </section>

      <section className="card">
        <h2 className="h2">Prova sullo storico</h2>
        {preview ? <p style={{ margin: 0, fontSize: 14 }}>Corrisponde a <b>{preview.matched}</b> movimenti; <b>{preview.changed}</b> cambierebbero categoria. La fascia “chiedimi” non tocca il passato.</p>
          : <p className="muted" style={{ margin: 0, fontSize: 14 }}>Controlla quanti movimenti passati cambierebbero.</p>}
        <div className="row between">
          <button className="btn" onClick={runPreview}>Prova</button>
          <label className="row" style={{ gap: 8, fontSize: 14 }}>Applica al passato <Toggle on={applyHistory} label="Applica ai movimenti passati" onChange={() => setApplyHistory(!applyHistory)} /></label>
        </div>
      </section>

      <ErrorBox error={error} />
      <button className="btn primary block" disabled={!name.trim()} onClick={save}>Salva regola</button>
      {!isNew && <button className="btn ghost" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={remove}>Elimina regola</button>}
    </div>
  );
}
