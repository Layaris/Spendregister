import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { ErrorBox } from '../ui';

type Mode = 'login' | 'register' | 'recover' | 'claim';

/** Accesso come in Multifolio: entra, crea un account, password dimenticata con il codice di recupero. */
export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [f, setF] = useState({ email: '', password: '', repeat: '', code: '', old: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(false);

  useEffect(() => {
    api<{ legacy_available: boolean }>('/auth/status').then((r) => setLegacy(r.legacy_available)).catch(() => {});
  }, []);

  const go = (m: Mode) => { setMode(m); setError(null); };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode !== 'login' && f.password !== f.repeat) { setError('Le due password non coincidono'); return; }
    setBusy(true);
    try {
      if (mode === 'login') await api('/login', { method: 'POST', json: { email: f.email, password: f.password } });
      if (mode === 'register') await api('/register', { method: 'POST', json: { email: f.email, password: f.password } });
      if (mode === 'recover') await api('/password/recover', { method: 'POST', json: { email: f.email, code: f.code, password: f.password } });
      if (mode === 'claim') await api('/claim', { method: 'POST', json: { email: f.email, password: f.password, old_password: f.old } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const title = { login: 'Ledgy', register: 'Crea il tuo account', recover: 'Nuova password', claim: 'Collega i tuoi dati' }[mode];
  const action = { login: 'Entra', register: 'Crea account', recover: 'Salva la nuova password ed entra', claim: "Collega i dati e crea l'account" }[mode];

  return (
    <main className="app" style={{ justifyContent: 'center', minHeight: '100vh', paddingBottom: 40 }}>
      <form className="card" onSubmit={submit} style={{ gap: 14, padding: 24 }}>
        <div className="stack" style={{ gap: 4 }}>
          <h1 className="page-title" style={{ padding: 0 }}>{title}</h1>
          {mode === 'login' && <p className="muted" style={{ margin: 0 }}>Le tue spese, registrate da sole.</p>}
          {mode === 'register' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ogni account vede solo i propri dati. Il server legge le notifiche di pagamento per creare le spese, quindi i dati non sono cifrati end-to-end.</p>}
          {mode === 'recover' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Scrivi la tua email, il codice di recupero che hai salvato (24 caratteri) e una nuova password. Gli altri dispositivi dovranno rientrare.</p>}
          {mode === 'claim' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ledgy contiene dati della versione con una sola password. Inseriscila e scegli email e password del tuo account: i dati diventano tuoi.</p>}
        </div>

        {(mode === 'login' || mode === 'register') && (
          <div className="seg" role="group" aria-label="Accesso o registrazione">
            <button type="button" aria-pressed={mode === 'login'} onClick={() => go('login')}>Entra</button>
            <button type="button" aria-pressed={mode === 'register'} onClick={() => go('register')}>Crea account</button>
          </div>
        )}

        <label className="field">
          <span>Email</span>
          <input className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} autoFocus />
        </label>
        {mode === 'claim' && (
          <label className="field">
            <span>Vecchia password di Ledgy</span>
            <input className="input" type="password" autoComplete="off" value={f.old} onChange={set('old')} />
          </label>
        )}
        {mode === 'recover' && (
          <label className="field">
            <span>Codice di recupero</span>
            <input className="input mono" style={{ fontSize: 15, letterSpacing: '0.04em' }} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
              placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" value={f.code} onChange={set('code')} />
          </label>
        )}
        <label className="field">
          <span>{mode === 'login' ? 'Password' : mode === 'claim' ? 'Nuova password del tuo account' : 'Nuova password (almeno 10 caratteri)'}</span>
          <input className="input" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={f.password} onChange={set('password')} />
        </label>
        {mode !== 'login' && (
          <label className="field">
            <span>Ripeti la password</span>
            <input className="input" type="password" autoComplete="new-password" value={f.repeat} onChange={set('repeat')} />
          </label>
        )}

        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !f.email || !f.password}>{busy ? 'Un momento…' : action}</button>

        {mode === 'login' && <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => go('recover')}>Password dimenticata?</button>}
        {(mode === 'recover' || mode === 'claim') && <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => go('login')}>Torna all'accesso</button>}
        {legacy && mode === 'login' && (
          <button type="button" className="btn" onClick={() => go('claim')}>Usavi Ledgy con la vecchia password? Collega i tuoi dati</button>
        )}
      </form>
    </main>
  );
}
