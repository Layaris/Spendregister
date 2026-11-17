import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Bootstrap, type Category, type Theme } from './api';
import { setDisplayCurrency } from './util';

interface Store extends Bootstrap {
  loaded: boolean;
  refresh: () => Promise<void>;
  cat: (id: string | null | undefined) => Category | undefined;
  parentOf: (id: string | null | undefined) => Category | undefined;
  catName: (id: string | null | undefined) => string;
  discreet: boolean;
  setDiscreet: (v: boolean) => void;
  toast: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap>({ accounts: [], categories: [], labels: [], review_count: 0, settings: { timezone: 'Asia/Makassar', recovery_created_at: null, display_currency: 'EUR', theme: 'light', home_layout: null }, account: { email: null } });
  const [loaded, setLoaded] = useState(false);
  const [discreet, setDiscreetState] = useState(() => {
    try { return localStorage.getItem('ledgy-discreet') === '1'; } catch { return false; }
  });
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const b = await api<Bootstrap>('/bootstrap');
    applyTheme(b.settings.theme);
    const cur = b.settings.display_currency || 'EUR';
    if (cur === 'EUR') setDisplayCurrency('EUR', 1);
    else {
      const r = await api<{ eurPerUnit: number | null }>(`/fx?currency=${cur}`).catch(() => ({ eurPerUnit: null }));
      // Senza tasso si resta in euro piuttosto che mostrare numeri sbagliati.
      if (r.eurPerUnit) setDisplayCurrency(cur, 1 / r.eurPerUnit);
      else setDisplayCurrency('EUR', 1);
    }
    setData(b);
    setLoaded(true);
  }, []);

  useEffect(() => { refresh().catch(() => setLoaded(true)); }, [refresh]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 2600);
    return () => clearTimeout(t);
  }, [message]);

  const value = useMemo<Store>(() => {
    const byId = new Map(data.categories.map((c) => [c.id, c]));
    const cat = (id: string | null | undefined) => (id ? byId.get(id) : undefined);
    return {
      ...data,
      loaded,
      refresh,
      cat,
      parentOf: (id) => { const c = cat(id); return c?.parent_id ? cat(c.parent_id) : c; },
      catName: (id) => cat(id)?.name ?? 'Senza categoria',
      discreet,
      setDiscreet: (v) => { setDiscreetState(v); try { localStorage.setItem('ledgy-discreet', v ? '1' : '0'); } catch { /* ignora */ } },
      toast: setMessage,
    };
  }, [data, loaded, refresh, discreet]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {message && <div className="toast" role="status">{message}</div>}
    </Ctx.Provider>
  );
}

/** Applica il tema e lo ricorda per il prossimo avvio (public/theme.js lo legge prima del primo disegno). */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('ledgy-theme', theme); } catch { /* ignora */ }
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider mancante');
  return s;
}

/** Carica dati dall'API e permette di ricaricarli. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setError(null);
    api<T>(path).then((d) => alive && setData(d)).catch((e: Error) => alive && setError(e.message));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}
