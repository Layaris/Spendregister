import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from '../ui';

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
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
        <button className="btn primary block" disabled={busy || !password}>{busy ? 'Accesso…' : 'Entra'}</button>
      </form>
    </main>
  );
}
