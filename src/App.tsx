import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, setUnauthorizedHandler } from './api';
import { Icon } from './icons';
import { Add } from './pages/Add';
import { Capture } from './pages/Capture';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { ComingSoon, More } from './pages/More';
import { Movements } from './pages/Movements';
import { Review } from './pages/Review';
import { RuleEditor, RulesList } from './pages/Rules';
import { Stats } from './pages/Stats';
import { TxDetail } from './pages/TxDetail';
import { go, useRoute } from './router';
import { StoreProvider, useStore } from './store';

/** Niente schermata di accesso: senza sessione l'app crea un ospite e si usa subito. */
export function App() {
  const [state, setState] = useState<'checking' | 'ready' | 'error'>('checking');
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const entering = useRef(false);

  const enter = useCallback(async () => {
    if (entering.current) return;
    entering.current = true;
    setState('checking');
    try {
      await api('/me').catch(async (e) => {
        if (e instanceof ApiError && e.status === 401) await api('/guest', { method: 'POST' });
        else throw e;
      });
      setGeneration((g) => g + 1);
      setState('ready');
    } catch (e) {
      setError((e as Error).message);
      setState('error');
    } finally {
      entering.current = false;
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { enter(); });
    enter();
  }, [enter]);

  if (state === 'checking') return <main className="app"><div className="empty">Caricamento…</div></main>;
  if (state === 'error') {
    return (
      <main className="app" style={{ justifyContent: 'center', minHeight: '100vh' }}>
        <div className="card"><p className="error" style={{ margin: 0 }}>{error}</p><button className="btn" onClick={enter}>Riprova</button></div>
      </main>
    );
  }
  // Dopo accesso, registrazione o uscita si ricarica tutto da capo.
  const changed = () => { go('/'); enter(); };
  return (
    <StoreProvider key={generation}>
      <Shell onAuthChange={changed} />
    </StoreProvider>
  );
}

function Shell({ onAuthChange }: { onAuthChange: () => void }) {
  const [page, a] = useRoute();
  const { review_count } = useStore();

  let content;
  switch (page ?? '') {
    case '': content = <Home />; break;
    case 'movimenti': content = <Movements category={a} />; break;
    case 'rivedere': content = <Review />; break;
    case 'm': content = a ? <TxDetail id={a} /> : <Movements />; break;
    case 'aggiungi': content = <Add />; break;
    case 'statistiche': content = <Stats />; break;
    case 'regole': content = a ? <RuleEditor id={a} /> : <RulesList />; break;
    case 'cattura': content = <Capture />; break;
    case 'assistente': content = <ComingSoon title="Assistente AI" text="La chat sulle tue spese, la lettura di scontrini e screenshot e l'inserimento a voce arrivano con il prossimo aggiornamento, con Gemini o NanoGPT." />; break;
    case 'altro': content = <More onAuthChange={onAuthChange} />; break;
    case 'account': content = <Login key={a ?? ''} initial={a === 'crea' ? 'register' : 'login'} onDone={onAuthChange} />; break;
    default: content = <Home />;
  }
  const hideTabs = page === 'aggiungi' || page === 'account';
  const current = (p: string) => (page ?? '') === p || (p === 'movimenti' && (page === 'm' || page === 'rivedere')) || (p === 'altro' && ['regole', 'cattura', 'assistente'].includes(page ?? ''));

  return (
    <>
      <main className="app">{content}</main>
      {!hideTabs && (
        <nav className="tabbar" aria-label="Sezioni">
          <a href="#/" className="tab" aria-current={current('') ? 'page' : undefined}><Icon name="home" size={24} />Home</a>
          <a href="#/movimenti" className="tab" aria-current={current('movimenti') ? 'page' : undefined}>
            <Icon name="list" size={24} />Movimenti{review_count > 0 && <span className="badge">{review_count}</span>}
          </a>
          <a href="#/aggiungi" className="fab" aria-label="Aggiungi spesa"><Icon name="plus" size={26} stroke={2.2} /></a>
          <a href="#/statistiche" className="tab" aria-current={current('statistiche') ? 'page' : undefined}><Icon name="chart" size={24} />Statistiche</a>
          <a href="#/altro" className="tab" aria-current={current('altro') ? 'page' : undefined}><Icon name="more" size={24} stroke={3} />Altro</a>
        </nav>
      )}
    </>
  );
}
