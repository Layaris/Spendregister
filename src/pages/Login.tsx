import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api';
import { back } from '../router';
import { ErrorBox, TopBar } from '../ui';

type Mode = 'login' | 'register' | 'recover';
type Choice = 'merge' | 'account' | 'replace' | 'keep' | 'fresh';
interface Local { transactions: number; devices: number }
interface Pending { kind: 'login' | 'register'; local: Local }

const OPTIONS: Record<'login' | 'register', Array<{ id: Choice; title: string; text: string; confirm: string; danger?: boolean }>> = {
  login: [
    {
      id: 'merge', title: "Aggiungi all'account",
      text: "I dati di questo dispositivo si aggiungono a quelli dell'account. Categorie, conti ed etichette con lo stesso nome si uniscono.",
      confirm: "I dati di questo dispositivo verranno aggiunti all'account. I telefoni collegati continueranno a funzionare, sull'account.",
    },
    {
      id: 'account', title: "Usa solo i dati dell'account",
      text: 'I dati usati finora su questo dispositivo vengono cancellati.',
      confirm: 'I dati usati senza account su questo dispositivo verranno cancellati per sempre, compresi i telefoni collegati. Non si può annullare.',
      danger: true,
    },
    {
      id: 'replace', title: "Sostituisci i dati dell'account",
      text: "I dati dell'account vengono cancellati e al loro posto vanno quelli di questo dispositivo.",
      confirm: "Tutti i dati salvati nell'account (movimenti, conti, regole, telefoni collegati) verranno cancellati per sempre e sostituiti da quelli di questo dispositivo. Non si può annullare.",
      danger: true,
    },
  ],
  register: [
    {
      id: 'keep', title: 'Porta i dati nel nuovo account',
      text: 'Tutto quello che hai inserito finora, e i telefoni collegati, passa al nuovo account.',
      confirm: 'I dati di questo dispositivo diventeranno il contenuto del nuovo account.',
    },
    {
      id: 'fresh', title: 'Inizia con un account vuoto',
      text: 'I dati usati finora su questo dispositivo vengono cancellati.',
      confirm: 'I dati usati senza account su questo dispositivo verranno cancellati per sempre, compresi i telefoni collegati. Non si può annullare.',
      danger: true,
    },
  ],
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Entra, crea un account o recupera la password. Senza account l'app si usa lo stesso: questa pagina è facoltativa. */
export function Login({ initial = 'login', onDone }: { initial?: Mode; onDone: () => void }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [f, setF] = useState({ email: '', password: '', repeat: '', code: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirming, setConfirming] = useState<Choice | null>(null);

  const switchTo = (m: Mode) => { setMode(m); setError(null); setPending(null); };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const send = async (choice?: Choice) => {
    setError(null);
    setBusy(true);
    try {
      const json = { email: f.email, password: f.password, code: f.code, choice };
      if (mode === 'login') await api('/login', { method: 'POST', json });
      if (mode === 'register') await api('/register', { method: 'POST', json });
      if (mode === 'recover') await api('/password/recover', { method: 'POST', json });
      onDone();
    } catch (err) {
      const data = err instanceof ApiError ? (err.data as { choice?: 'login' | 'register'; local?: Local } | undefined) : undefined;
      if (data?.choice && data.local) setPending({ kind: data.choice, local: data.local });
      else setError((err as Error).message);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode !== 'login' && f.password !== f.repeat) { setError('Le due password non coincidono'); return; }
    send();
  };

  const title = { login: 'Entra nel tuo account', register: 'Crea un account', recover: 'Nuova password' }[mode];
  const action = { login: 'Entra', register: 'Crea account', recover: 'Salva la nuova password ed entra' }[mode];

  if (pending) {
    const option = OPTIONS[pending.kind].find((o) => o.id === confirming);
    return (
      <div className="stack" style={{ gap: 14 }}>
        <TopBar title="I dati di questo dispositivo" backTo="/altro" />
        <p className="lead" style={{ margin: 0 }}>
          Senza account su questo dispositivo hai inserito {plural(pending.local.transactions, 'movimento', 'movimenti')}
          {pending.local.devices > 0 && <> e collegato {plural(pending.local.devices, 'telefono', 'telefoni')}</>}. Cosa vuoi farne?
        </p>
        {OPTIONS[pending.kind].map((o) => (
          <button key={o.id} className="card" onClick={() => setConfirming(o.id)} disabled={busy}
            style={{ textAlign: 'left', border: 0, cursor: 'pointer', color: 'inherit', gap: 4 }}>
            <b style={{ color: o.danger ? 'var(--danger)' : undefined }}>{o.title}</b>
            <span className="muted" style={{ fontSize: 14 }}>{o.text}</span>
          </button>
        ))}
        <ErrorBox error={error} />
        <button className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => setPending(null)}>Annulla</button>
        {option && (
          <div className="modal-backdrop" onClick={() => !busy && setConfirming(null)}>
            <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
              <h2 className="h2" id="confirm-title">{option.title}?</h2>
              <p style={{ margin: 0 }}>{option.confirm}</p>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn grow" onClick={() => setConfirming(null)} disabled={busy}>Annulla</button>
                <button className={`btn grow ${option.danger ? '' : 'primary'}`} disabled={busy} onClick={() => send(option.id)}
                  style={option.danger ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
                  {busy ? 'Un momento…' : 'Conferma'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit} style={{ gap: 14 }}>
      <TopBar title={title} backTo="/altro" />
      {mode !== 'recover' && (
        <div className="seg" role="group" aria-label="Accesso o registrazione">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => switchTo('login')}>Entra</button>
          <button type="button" aria-pressed={mode === 'register'} onClick={() => switchTo('register')}>Crea account</button>
        </div>
      )}
      {mode === 'login' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Ritrovi i tuoi dati su ogni dispositivo.</p>}
      {mode === 'register' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Con un account i dati non si perdono e li ritrovi su ogni dispositivo. Ogni account vede solo i propri dati. Il server legge le notifiche di pagamento per creare le spese, quindi i dati non sono cifrati end-to-end.</p>}
      {mode === 'recover' && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Scrivi la tua email, il codice di recupero che hai salvato (24 caratteri) e una nuova password. Gli altri dispositivi dovranno rientrare.</p>}

      <label className="field">
        <span>Email</span>
        <input className="input" type="email" autoComplete="email" inputMode="email" value={f.email} onChange={set('email')} />
      </label>
      {mode === 'recover' && (
        <label className="field">
          <span>Codice di recupero</span>
          <input className="input mono" style={{ fontSize: 15, letterSpacing: '0.04em' }} autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            placeholder="ABCD-EFGH-JKLM-NPQR-STUV-WXYZ" value={f.code} onChange={set('code')} />
        </label>
      )}
      <label className="field">
        <span>{mode === 'login' ? 'Password' : 'Nuova password (almeno 10 caratteri)'}</span>
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
      {mode === 'login' && <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => switchTo('recover')}>Password dimenticata?</button>}
      {mode === 'recover' && <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => switchTo('login')}>Torna all'accesso</button>}
      <button type="button" className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => back('/')}>Continua senza account</button>
    </form>
  );
}
