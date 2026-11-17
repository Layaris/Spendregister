// Altro › Importa da Wallet: chiave dell'API di Wallet (solo in memoria, mai salvata), controllo di conti e
// categorie, poi l'import a pagine con la barra di avanzamento.
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { go } from '../router';
import { useStore } from '../store';
import { CategorySelect, ErrorBox, TopBar } from '../ui';
import { formatDayShort, formatMoney } from '../util';

interface WAccount { id: string; name: string; currency: string; type: string; archived: boolean; balance: number | null; suggest: string }
interface WCategory { id: string; name: string; parent: string | null; group: string | null; suggest: string | null }
interface Prep { total: number; first: string | null; ledgy: { count: number; first: string | null }; accounts: WAccount[]; categories: WCategory[]; labels: string[] }

const wait = (s: number) => new Promise((ok) => setTimeout(ok, s * 1000));

export function WalletImport() {
  const store = useStore();
  const [token, setToken] = useState('');
  const [prep, setPrep] = useState<Prep | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<Record<string, string | null>>({});
  const [onlyBefore, setOnlyBefore] = useState(true);
  const [align, setAlign] = useState(true);
  const [showCats, setShowCats] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; imported: number; already: number; note: string } | null>(null);
  const [result, setResult] = useState<{ imported: number; already: number; aligned: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = async () => {
    setError(null);
    setBusy(true);
    try {
      const p = await api<Prep & { retry_after?: number }>('/import/wallet/prepare', { method: 'POST', json: { token } });
      if (p.retry_after) throw new Error(`Wallet chiede una pausa: riprova tra ${Math.ceil(p.retry_after / 60)} minuti.`);
      setPrep(p);
      setAccounts(Object.fromEntries(p.accounts.map((a) => [a.id, a.archived && a.suggest === 'new' ? 'skip' : a.suggest])));
      setCategories(Object.fromEntries(p.categories.map((c) => [c.id, c.suggest])));
      setOnlyBefore(p.ledgy.count > 0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!prep) return;
    setError(null);
    setBusy(true);
    try {
      const start = await api<{ accounts: Record<string, string> }>('/import/wallet/start', {
        method: 'POST', json: { accounts: prep.accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency, type: a.type, target: accounts[a.id] ?? 'new' })), labels: prep.labels },
      });
      const before = onlyBefore && prep.ledgy.first ? prep.ledgy.first : null;
      let offset: number | null = 0;
      let done = 0, imported = 0, already = 0;
      setProgress({ done, imported, already, note: '' });
      while (offset != null) {
        const r: { imported: number; already: number; skipped: number; next: number | null; retry_after?: number } = await api('/import/wallet/page', {
          method: 'POST', json: { token, offset, before, accounts: { ...start.accounts, ...Object.fromEntries(Object.entries(accounts).filter(([, v]) => v === 'skip')) }, categories },
        });
        if (r.retry_after) {
          setProgress({ done, imported, already, note: `Wallet chiede una pausa: riprendo tra ${r.retry_after} secondi…` });
          await wait(r.retry_after);
          continue;
        }
        done += r.imported + r.already + r.skipped;
        imported += r.imported;
        already += r.already;
        setProgress({ done, imported, already, note: '' });
        offset = r.next;
      }
      let aligned = 0;
      if (align) {
        const f = await api<{ aligned: number }>('/import/wallet/finish', { method: 'POST', json: { token, align: start.accounts } });
        aligned = f.aligned;
      }
      setToken('');
      setResult({ imported, already, aligned });
      await store.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const fallback = prep?.categories.filter((c) => !categories[c.id]).length ?? 0;
  const pct = prep && progress ? Math.min(100, Math.round((progress.done / Math.max(prep.total, 1)) * 100)) : 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/altro" />
      <h1 className="page-title">Importa da Wallet</h1>

      {result ? (
        <section className="card">
          <h2 className="h2">Fatto</h2>
          <p style={{ margin: 0 }}>Importati <b>{result.imported}</b> movimenti{result.already ? `, ${result.already} c’erano già` : ''}.{result.aligned ? ` Saldi allineati a Wallet su ${result.aligned} conti.` : ''}</p>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>La chiave non è stata salvata. Se vuoi, cancellala anche da Wallet (Impostazioni › REST API).</p>
          <button className="btn primary block" onClick={() => go('/movimenti')}>Vedi i movimenti</button>
        </section>
      ) : !prep ? (
        <>
          <section className="card">
            <h2 className="h2">Come si fa</h2>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontSize: 15 }}>
              <li>Apri <b>web.budgetbakers.com</b> dal computer o dal telefono ed entra.</li>
              <li>Vai in <b>Impostazioni › REST API</b> e crea una chiave (serve Wallet Premium).</li>
              <li>Copiala e incollala qui sotto.</li>
            </ol>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>La chiave resta solo in questa pagina: serve a leggere i dati da Wallet e non viene salvata da nessuna parte.</p>
          </section>
          <label className="field"><span>Chiave di Wallet</span>
            <input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Incolla la chiave" aria-label="Chiave di Wallet" />
          </label>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || token.trim().length < 8} onClick={read}>{busy ? 'Leggo da Wallet…' : 'Leggi da Wallet'}</button>
        </>
      ) : (
        <>
          <section className="card">
            <h2 className="h2">{prep.total} movimenti in Wallet</h2>
            <span className="muted" style={{ fontSize: 14, marginTop: -6 }}>{prep.first ? `Dal ${formatDayShort(prep.first)} ${prep.first.slice(0, 4)} a oggi` : 'Nessun movimento'} · {prep.accounts.length} conti · {prep.categories.length} categorie</span>
            {prep.ledgy.count > 0 && prep.ledgy.first && (
              <div className="stack" style={{ gap: 6 }}>
                <span style={{ fontSize: 14 }}>In Ledgy hai già {prep.ledgy.count === 1 ? '1 movimento' : `${prep.ledgy.count} movimenti`}, dal {formatDayShort(prep.ledgy.first)}.</span>
                <div className="seg" role="group" aria-label="Quali movimenti importare">
                  <button aria-pressed={onlyBefore} onClick={() => setOnlyBefore(true)}>Fino al {formatDayShort(prep.ledgy.first)}</button>
                  <button aria-pressed={!onlyBefore} onClick={() => setOnlyBefore(false)}>Tutti</button>
                </div>
                <span className="muted" style={{ fontSize: 13 }}>{onlyBefore ? 'Così non si sovrappone a quello che Ledgy ha già registrato.' : 'Attenzione: le spese registrate in tutte e due le app compariranno due volte. Per ripartire pulito usa Altro › Svuota il bilancio.'}</span>
              </div>
            )}
          </section>

          <span className="section-title">Conti</span>
          <div className="list">
            {prep.accounts.map((a) => (
              <label key={a.id} className="lrow">
                <span className="lrow-ic"><Icon name="wallet" size={18} /></span>
                <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{a.name}</span>
                  <span className="muted" style={{ fontSize: 13 }}>{a.balance != null ? formatMoney(Math.round(a.balance * 1000), a.currency) : a.currency}{a.archived ? ' · archiviato' : ''}</span>
                </span>
                <select className="input" style={{ width: 150 }} aria-label={`Dove mettere ${a.name}`} value={accounts[a.id] ?? 'new'} onChange={(e) => setAccounts({ ...accounts, [a.id]: e.target.value })}>
                  <option value="new">Conto nuovo</option>
                  {store.accounts.map((o) => <option key={o.id} value={o.id}>In {o.name}</option>)}
                  <option value="skip">Non importare</option>
                </select>
              </label>
            ))}
          </div>
          <label className="row between" style={{ padding: '0 6px', fontSize: 14 }}>
            <span>Saldi uguali a quelli di Wallet</span>
            <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} style={{ width: 22, height: 22 }} />
          </label>

          <button className="card" style={{ border: 0, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }} onClick={() => setShowCats(!showCats)} aria-expanded={showCats}>
            <span className="stack" style={{ gap: 2 }}>
              <span className="h2">Categorie</span>
              <span className="muted" style={{ fontSize: 13 }}>Già abbinate alle categorie di Ledgy{fallback ? `; ${fallback} senza abbinamento` : ''}. Tocca per controllarle.</span>
            </span>
            <Icon name="next" size={18} />
          </button>
          {showCats && (
            <div className="list">
              {prep.categories.map((c) => (
                <div key={c.id} className="lrow" style={{ cursor: 'default', flexWrap: 'wrap', gap: 6 }}>
                  <span className="grow" style={{ fontWeight: 600, minWidth: 120 }}>{c.parent ? <span className="muted">{c.parent} › </span> : null}{c.name}</span>
                  <div style={{ width: '100%' }}><CategorySelect value={categories[c.id] ?? null} kind="all" onChange={(v) => setCategories({ ...categories, [c.id]: v })} /></div>
                </div>
              ))}
            </div>
          )}

          {progress && (
            <section className="card" aria-live="polite">
              <div className="row between"><span style={{ fontWeight: 600 }}>Importo…</span><span className="num">{progress.done} di {prep.total}</span></div>
              <div className="bar" style={{ height: 10 }}><div style={{ width: `${pct}%`, background: 'var(--accent)' }} /></div>
              {progress.note && <span className="muted" style={{ fontSize: 13 }}>{progress.note}</span>}
              <span className="muted" style={{ fontSize: 13 }}>Lascia aperta questa pagina finché non finisce.</span>
            </section>
          )}
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy} onClick={run}>{busy ? 'Importo…' : `Importa ${prep.total} movimenti`}</button>
          <button className="btn ghost" style={{ alignSelf: 'center' }} disabled={busy} onClick={() => { setPrep(null); setProgress(null); }}>Indietro</button>
        </>
      )}
    </div>
  );
}
