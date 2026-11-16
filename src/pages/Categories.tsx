// Impostazioni › Categorie: accendi o spegni i gruppi, rinomina, sposta, elimina (spostando i movimenti), crea.
import { useState } from 'react';
import { api, type Category } from '../api';
import { useApi, useStore } from '../store';
import { CategorySelect, ErrorBox, Loading, TopBar } from '../ui';

type Item = Category & { archived: number; count: number };

export function Categories() {
  const store = useStore();
  const { data, error, reload } = useApi<{ items: Item[] }>('/categories');
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Item | null>(null);
  const [adding, setAdding] = useState<{ parent: string | null; kind: 'expense' | 'income' } | null>(null);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setErr(null);
    try {
      await fn();
      reload();
      await store.refresh();
      store.toast(msg);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!data) return <div className="stack"><TopBar title="Categorie" backTo="/altro" /><ErrorBox error={error} />{!error && <Loading />}</div>;
  const items = data.items;
  const groups = (kind: 'expense' | 'income') => items.filter((c) => !c.parent_id && c.kind === kind);
  const kids = (id: string) => items.filter((c) => c.parent_id === id);

  const section = (kind: 'expense' | 'income', title: string) => (
    <section className="stack" style={{ gap: 8 }}>
      <span className="label" style={{ padding: '0 4px' }}>{title}</span>
      {groups(kind).map((g) => {
        const on = !g.archived;
        const total = g.count + kids(g.id).reduce((a, c) => a + c.count, 0);
        return (
          <div key={g.id} className="card" style={{ gap: 10, opacity: on ? 1 : 0.7 }}>
            <div className="row">
              <button className="grow row" style={{ background: 'none', border: 0, padding: 0, gap: 10, color: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                onClick={() => setOpen(open === g.id ? null : g.id)} aria-expanded={open === g.id}>
                <span className="dot" style={{ background: g.color ?? 'var(--line)', width: 12, height: 12 }} />
                <span className="grow"><b>{g.name}</b><br /><span className="muted" style={{ fontSize: 13 }}>{kids(g.id).length} sottocategorie · {total} movimenti{on ? '' : ' · spenta'}</span></span>
                <span className="muted" aria-hidden="true">{open === g.id ? '▴' : '▾'}</span>
              </button>
              <Switch on={on} label={`${on ? 'Spegni' : 'Accendi'} ${g.name}`} onChange={(v) => run(() => api(`/categories/${g.id}/enabled`, { method: 'POST', json: { enabled: v } }), v ? `${g.name} accesa` : `${g.name} spenta`)} />
            </div>
            {open === g.id && (
              <div className="stack" style={{ gap: 8 }}>
                <Editable item={g} items={items} onRun={run} onRemove={() => setRemoving(g)} isGroup />
                {kids(g.id).map((c) => <Editable key={c.id} item={c} items={items} onRun={run} onRemove={() => setRemoving(c)} />)}
                {adding?.parent === g.id
                  ? <NewForm onCancel={() => setAdding(null)} onCreate={(name) => run(async () => { await api('/categories', { method: 'POST', json: { name, parent_id: g.id, kind: g.kind } }); setAdding(null); }, `${name} creata`)} />
                  : <button className="pill small add" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding({ parent: g.id, kind: g.kind })}>+ Sottocategoria</button>}
              </div>
            )}
          </div>
        );
      })}
      {adding && adding.parent == null && adding.kind === kind
        ? <div className="card"><NewForm onCancel={() => setAdding(null)} onCreate={(name) => run(async () => { await api('/categories', { method: 'POST', json: { name, kind } }); setAdding(null); }, `${name} creata`)} /></div>
        : <button className="btn" onClick={() => setAdding({ parent: null, kind })}>+ Nuova categoria {kind === 'income' ? 'di entrata' : 'di spesa'}</button>}
    </section>
  );

  return (
    <div className="stack" style={{ gap: 16 }}>
      <TopBar title="Categorie" backTo="/altro" />
      <p className="lead">Le categorie spente spariscono dai menu ma non perdono nulla: riaccendendole ritrovi tutto.</p>
      <ErrorBox error={err} />
      {section('expense', 'Spese')}
      {section('income', 'Entrate')}
      {removing && <RemoveDialog item={removing} items={items} onClose={() => setRemoving(null)}
        onConfirm={(into) => run(async () => { await api(`/categories/${removing.id}${into ? `?into=${encodeURIComponent(into)}` : ''}`, { method: 'DELETE' }); setRemoving(null); }, `${removing.name} eliminata`)} />}
    </div>
  );
}

function Editable({ item, items, onRun, onRemove, isGroup }: { item: Item; items: Item[]; onRun: (fn: () => Promise<unknown>, msg: string) => void; onRemove: () => void; isGroup?: boolean }) {
  const [name, setName] = useState(item.name);
  const parents = items.filter((c) => !c.parent_id && c.kind === item.kind && c.id !== item.id);
  return (
    <div className="stack" style={{ gap: 6, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" aria-label={`Nome di ${item.name}`} value={name} onChange={(e) => setName(e.target.value)} />
        {name.trim() && name.trim() !== item.name && <button className="btn primary small" onClick={() => onRun(() => api(`/categories/${item.id}`, { method: 'PUT', json: { name: name.trim() } }), 'Nome salvato')}>Salva</button>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <span className="muted grow" style={{ fontSize: 13 }}>{isGroup ? 'Gruppo' : 'Sottocategoria'} · {item.count} movimenti</span>
        {!isGroup && (
          <select className="input" style={{ width: 'auto', minHeight: 36, padding: '4px 8px', fontSize: 14 }} aria-label={`Sposta ${item.name} sotto`} value={item.parent_id ?? ''}
            onChange={(e) => onRun(() => api(`/categories/${item.id}`, { method: 'PUT', json: { parent_id: e.target.value || null } }), 'Categoria spostata')}>
            <option value="">Gruppo a sé</option>
            {parents.map((p) => <option key={p.id} value={p.id}>Sotto {p.name}</option>)}
          </select>
        )}
        <button className="btn small" style={{ color: 'var(--danger)' }} onClick={onRemove}>Elimina</button>
      </div>
    </div>
  );
}

function NewForm({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input grow" autoFocus placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) onCreate(name.trim()); }} />
      <button className="btn primary" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>Crea</button>
      <button className="btn" onClick={onCancel}>Annulla</button>
    </div>
  );
}

function RemoveDialog({ item, items, onClose, onConfirm }: { item: Item; items: Item[]; onClose: () => void; onConfirm: (into: string | null) => void }) {
  const [into, setInto] = useState<string | null>(null);
  const kids = items.filter((c) => c.parent_id === item.id);
  const total = item.count + kids.reduce((a, c) => a + c.count, 0);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="h2" id="del-title">Eliminare “{item.name}”?</h2>
        <p style={{ margin: 0 }}>
          {kids.length > 0 && <>Spariscono anche le sue {kids.length} sottocategorie. </>}
          {total > 0 ? <>I suoi {total} movimenti non si cancellano: scegli dove spostarli.</> : 'Non ha movimenti.'}
        </p>
        {total > 0 && <CategorySelect value={into} onChange={setInto} kind={item.kind} />}
        {into && (into === item.id || kids.some((k) => k.id === into)) && <p className="error" style={{ margin: 0 }}>Scegli una categoria diversa da quella che elimini.</p>}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn grow" onClick={onClose}>Annulla</button>
          <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}
            disabled={!!into && (into === item.id || kids.some((k) => k.id === into))} onClick={() => onConfirm(into)}>
            {total > 0 && !into ? 'Elimina, movimenti senza categoria' : 'Elimina'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      style={{ width: 51, height: 31, borderRadius: 16, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: on ? 'var(--accent)' : 'var(--line)' }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)', transition: 'left 0.15s' }} />
    </button>
  );
}
