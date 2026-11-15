import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from '../ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'login' | 'recover'>('login');
  const [password, setPassword] = useState('');
  const [rec, setRec] = useState({ code: '', next: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const login = (e: FormEvent) => {
    e.preventDefault();
    run(() => api('/login', { method: 'POST', json: { password } }));
  };

  const recover = (e: FormEvent) => {
    e.preventDefault();
    if (rec.next !== rec.repeat) { setError('Le due password non coincidono'); return; }
    run(() => api('/password/recover', { method: 'POST', json: { code: rec.code, password: rec.next } }));
  };

  const switchTo = (m: 'login' | 'recover') => { setMode(m); setError(null); };

  return (
    <main className="app" style={{ justifyContent: 'center', minHeight: '100vh', paddingBottom: 40 }}>
      {mode === 'login' ? (
        <form className="card" onSubmit={login} style={{ gap: 16, padding: 24 }}>
          <div className="stack" style={{ gap: 4 }}>
            <h1 className="page-title" style={{ padding: 0 }}>Ledgy</h1>
            <p className="muted" style={{ margin: 0 }}>Le tue spese, registrate da sole.</p>
          </div>
          <label className="field">
            <span>Password</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </label>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || !password}>{busy ? 'Accesso…' : 'Entra'}</button>
          <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => switchTo('recover')}>Password dimenticata?</button>
        </form>
      ) : (
        <form className="card" onSubmit={recover} style={{ gap: 14, padding: 24 }}>
          <h1 className="page-title" style={{ padding: 0 }}>Nuova password</h1>
          <p className="muted" style={{ margin: 0 }}>Scrivi il codice di recupero che hai salvato (24 caratteri) e scegli una nuova password. Gli altri dispositivi dovranno rientrare.</p>
          <label className="field">
            <span>Codice di recupero</span>
            <input className="input mono" style={{ fontSize: 15, letterSpacing: '0.04em' }} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" value={rec.code} onChange={(e) => setRec({ ...rec, code: e.target.value })} autoFocus />
          </label>
          <input className="input" type="password" autoComplete="new-password" placeholder="Nuova password (almeno 10 caratteri)" aria-label="Nuova password" value={rec.next} onChange={(e) => setRec({ ...rec, next: e.target.value })} />
          <input className="input" type="password" autoComplete="new-password" placeholder="Ripeti la nuova password" aria-label="Ripeti la nuova password" value={rec.repeat} onChange={(e) => setRec({ ...rec, repeat: e.target.value })} />
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy || !rec.code || !rec.next}>{busy ? 'Verifica…' : 'Salva la nuova password ed entra'}</button>
          <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => switchTo('login')}>Torna all'accesso</button>
        </form>
      )}
    </main>
  );
}
