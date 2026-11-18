import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, clearCache, getOffline, onOffline, setUnauthorizedHandler } from './api';
import { flushOutbox, onOutbox, pending } from './outbox';
import { Icon } from './icons';
import { Add } from './pages/Add';
import { Capture } from './pages/Capture';
import { Cards } from './pages/Cards';
import { Categories } from './pages/Categories';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { ComingSoon, More } from './pages/More';
import { Movements } from './pages/Movements';
import { Review } from './pages/Review';
import { RuleEditor, RulesList } from './pages/Rules';
import { Stats } from './pages/Stats';
import { TxDetail } from './pages/TxDetail';
import { WalletImport } from './pages/WalletImport';
import { Budget } from './pages/Budget';
import { Assistant } from './pages/Assistant';
import { Recurring } from './pages/Recurring';
import { TripDetail, Trips } from './pages/Trips';
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
  const changed = () => { clearCache(); go('/'); enter(); };
  return (
    <StoreProvider key={generation}>
      <Shell onAuthChange={changed} />
    </StoreProvider>
  );
}

/** Avviso in alto quando il server non risponde o ci sono spese in attesa di invio; invia la coda appena può. */
function ConnectionBanner() {
  const store = useStore();
  const [conn, setConn] = useState(getOffline());
  const [waiting, setWaiting] = useState(pending().length);
  useEffect(() => onOffline(setConn), []);
  useEffect(() => onOutbox(setWaiting), []);
  useEffect(() => {
    const send = async () => {
      if (!pending().length) return;
      const sent = await flushOutbox((msg) => store.toast(msg));
      if (sent) { store.toast(sent === 1 ? 'Inviata la spesa in attesa' : `Inviate ${sent} spese in attesa`); await store.refresh().catch(() => {}); }
    };
    send();
    const t = setInterval(send, 30_000);
    window.addEventListener('online', send);
    return () => { clearInterval(t); window.removeEventListener('online', send); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!conn.offline && !waiting) return null;
  const time = conn.since ? new Date(conn.since).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="conn" role="status">
      <Icon name="offline" size={18} />
      <span>
        {conn.offline ? <>Server non raggiungibile{time ? <>: dati del {time}</> : null}.</> : null}
        {waiting ? <> {waiting === 1 ? '1 spesa in attesa' : `${waiting} spese in attesa`}: parte da sola appena il server risponde.</> : conn.offline ? ' Le spese che aggiungi restano sul telefono e partono da sole.' : null}
      </span>
    </div>
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
    case 'aggiungi': content = <Add key={a ?? ''} initialKind={a === 'entrata' ? 'income' : 'expense'} />; break;
    case 'statistiche': content = <Stats view={a} />; break;
    case 'regole': content = a ? <RuleEditor id={a} /> : <RulesList />; break;
    case 'cattura': content = <Capture />; break;
    case 'categorie': content = <Categories />; break;
    case 'carte': content = <Cards />; break;
    case 'importa-wallet': content = <WalletImport />; break;
    case 'budget': content = <Budget />; break;
    case 'ricorrenti': content = <Recurring />; break;
    case 'viaggi': content = a ? <TripDetail id={a} /> : <Trips />; break;
    case 'assistente': content = <Assistant />; break;
    case 'altro': content = <More onAuthChange={onAuthChange} />; break;
    case 'account': content = <Login key={a ?? ''} initial={a === 'crea' ? 'register' : 'login'} onDone={onAuthChange} />; break;
    default: content = <Home />;
  }
  const hideTabs = page === 'aggiungi' || page === 'account';
  const current = (p: string) => (page ?? '') === p || (p === 'movimenti' && (page === 'm' || page === 'rivedere')) || (p === 'altro' && ['regole', 'cattura', 'assistente', 'categorie', 'carte'].includes(page ?? ''));

  return (
    <>
      <main className="app"><ConnectionBanner />{content}</main>
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
