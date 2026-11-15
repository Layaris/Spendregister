import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from '../ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/login', { method: 'POST', json: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    setInfo(null);
    try {
      await api('/password/forgot', { method: 'POST', json: {} });
      setInfo("Ti ho mandato un link per scegliere una nuova password all'indirizzo email di recupero. Vale 30 minuti.");
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <main className="app" style={{ justifyContent: 'center', minHeight: '100vh', paddingBottom: 40 }}>
      <form className="card" onSubmit={submit} style={{ gap: 16, padding: 24 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="page-title" style={{ padding: 0 }}>Ledgy</h1>
          <p className="muted" style={{ margin: 0 }}>Le tue spese, registrate da sole.</p>
        </div>
        <label className="field">
          <span>Password</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </label>
        <ErrorBox error={error} />
        {info && <div className="chip ok" style={{ whiteSpace: 'normal', fontSize: 14, padding: '10px 12px', borderRadius: 12, width: 'auto' }} role="status">{info}</div>}
        <button className="btn primary block" disabled={busy || !password}>{busy ? 'Accesso…' : 'Entra'}</button>
        <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={forgot}>Password dimenticata?</button>
      </form>
    </main>
  );
}

export function ResetPassword({ token, onDone }: { token: string; onDone: () => void }) {
  const [pw, setPw] = useState({ next: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.next !== pw.repeat) { setError('Le due password non coincidono'); return; }
    setBusy(true);
    try {
      await api('/password/reset', { method: 'POST', json: { token, password: pw.next } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app" style={{ justifyContent: 'center', minHeight: '100vh', paddingBottom: 40 }}>
      <form className="card" onSubmit={submit} style={{ gap: 16, padding: 24 }}>
        <h1 className="page-title" style={{ padding: 0 }}>Nuova password</h1>
        {done ? (
          <>
            <p style={{ margin: 0 }}>Password cambiata. Per sicurezza tutti i dispositivi sono stati disconnessi: entra con la nuova password.</p>
            <button type="button" className="btn primary block" onClick={() => { location.hash = '#/'; onDone(); }}>Vai all'accesso</button>
          </>
        ) : (
          <>
            <input className="input" type="password" autoComplete="new-password" placeholder="Nuova password (almeno 10 caratteri)" aria-label="Nuova password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoFocus />
            <input className="input" type="password" autoComplete="new-password" placeholder="Ripeti la nuova password" aria-label="Ripeti la nuova password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
            <ErrorBox error={error} />
            <button className="btn primary block" disabled={busy || !pw.next}>Salva la nuova password</button>
          </>
        )}
      </form>
    </main>
  );
}
