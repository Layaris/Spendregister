// Altro › Negozi: lo stesso negozio arrivato con nomi diversi ("STARBUCKS SEMINYAK", "Starbucks Coffee") si unisce
// in un nome solo. Le proposte vengono dal server; si può anche cercare e unire a mano.
import { useMemo, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { ErrorBox, Loading, TopBar } from '../ui';

interface Data {
  items: { merchant: string; n: number; spent: number }[];
  suggestions: { into: string; names: string[]; n: number }[];
  aliases: { alias: string; merchant: string }[];
}

const HIDDEN_KEY = 'ledgy-merge-hidden';
function hiddenSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[]); } catch { return new Set(); }
}

export function Merchants() {
  const store = useStore();
  const { data, error, reload } = useApi<Data>('/merchants');
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState(hiddenSet);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [into, setInto] = useState('');
  const [busy, setBusy] = useState(false);

  const merge = async (target: string, names: string[]) => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ changed: number }>('/merchants/merge', { method: 'POST', json: { into: target, names } });
      store.toast(`Uniti in “${target}” (${r.changed} movimenti)`);
      setPicked([]);
      setInto('');
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const hide = (key: string) => {
    const next = new Set(hidden).add(key);
    setHidden(next);
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])); } catch { /* solo su questo dispositivo */ }
  };
  const unalias = async (alias: string) => {
    await api(`/merchants/alias/${encodeURIComponent(alias)}`, { method: 'DELETE' });
    reload();
  };

  const suggestions = (data?.suggestions ?? []).filter((s) => !hidden.has(s.names.slice().sort().join('|')));
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!data || s.length < 2) return [];
    return data.items.filter((i) => i.merchant.toLowerCase().includes(s)).slice(0, 40);
  }, [data, q]);
  const toggle = (name: string) => {
    setPicked((p) => (p.includes(name) ? p.filter((x) => x !== name) : [...p, name]));
    if (!into) setInto(name);
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <TopBar title="Negozi" backTo="/altro" />
      <p className="lead">Lo stesso negozio può arrivare con nomi diversi. Uniscili: i movimenti passati prendono il nome scelto e quelli nuovi lo ricevono da soli, con la sua categoria.</p>
      <ErrorBox error={error ?? err} />
      {!data ? <Loading /> : (
        <>
          <span className="section-title">Da unire?</span>
          {!suggestions.length ? (
            <div className="card muted">Nessun nome simile da proporre. Puoi cercare e unire a mano qui sotto.</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              {suggestions.map((s) => (
                <SuggestionCard key={s.names.join('|')} s={s} busy={busy} onMerge={merge} onHide={() => hide(s.names.slice().sort().join('|'))} />
              ))}
            </div>
          )}

          <span className="section-title">Unisci a mano</span>
          <div className="card stack" style={{ gap: 8 }}>
            <input className="input" placeholder="Cerca un negozio" aria-label="Cerca un negozio" value={q} onChange={(e) => setQ(e.target.value)} />
            {found.map((i) => (
              <label key={i.merchant} className="row" style={{ gap: 10 }}>
                <input type="checkbox" checked={picked.includes(i.merchant)} onChange={() => toggle(i.merchant)} />
                <span className="grow">{i.merchant}</span>
                <span className="muted" style={{ fontSize: 13 }}>{i.n}×</span>
              </label>
            ))}
            {picked.length >= 2 && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="muted" style={{ fontSize: 13 }}>Nome da tenere</span>
                <select className="input" value={into} onChange={(e) => setInto(e.target.value)} aria-label="Nome da tenere">
                  {picked.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn primary" disabled={busy} onClick={() => merge(into || picked[0], picked)}>Unisci {picked.length} nomi</button>
              </div>
            )}
          </div>

          {data.aliases.length > 0 && (
            <>
              <span className="section-title">Nomi già uniti</span>
              <div className="list">
                {data.aliases.map((a) => (
                  <div key={a.alias} className="lrow">
                    <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{a.merchant}</span>
                      <span className="muted" style={{ fontSize: 13 }}>anche “{a.alias}”</span>
                    </span>
                    <button className="btn ghost" aria-label={`Separa ${a.alias}`} onClick={() => unalias(a.alias)}>Separa</button>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 13 }}>Separare vale per i movimenti nuovi: quelli passati restano col nome scelto.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SuggestionCard({ s, busy, onMerge, onHide }: { s: Data['suggestions'][number]; busy: boolean; onMerge: (into: string, names: string[]) => void; onHide: () => void }) {
  const [into, setInto] = useState(s.into);
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="store" size={18} /></span>
        <span className="grow stack" style={{ gap: 2 }}>
          {s.names.map((n) => <span key={n} style={{ fontWeight: n === into ? 700 : 400 }}>{n}</span>)}
          <span className="muted" style={{ fontSize: 13 }}>{s.n} movimenti</span>
        </span>
      </div>
      <select className="input" value={into} onChange={(e) => setInto(e.target.value)} aria-label="Nome da tenere">
        {s.names.map((n) => <option key={n} value={n}>Tieni “{n}”</option>)}
      </select>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onHide}>Sono diversi</button>
        <button className="btn primary grow" disabled={busy} onClick={() => onMerge(into, s.names)}>Unisci</button>
      </div>
    </div>
  );
}
