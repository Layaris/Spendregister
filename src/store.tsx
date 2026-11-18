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

/** Temi tra cui scegliere (Personalizza e Altro › Impostazioni): Acqua 1 è la prima versione, Acqua 2 quella della tavola. */
export const THEMES: Array<[Theme, string]> = [['light', 'Salvia'], ['aqua1', 'Acqua 1'], ['blue', 'Acqua 2'], ['navy', 'Navy'], ['dark', 'Scuro'], ['system', 'Auto']];

/** Colore della fascia della barra di stato (iPhone, Android): uguale alla parte alta della pagina di ogni tema. */
const TOP_COLOR: Record<string, string> = { light: '#edf1e8', aqua1: '#ebf2f7', blue: '#e3eef5', navy: '#172d52', dark: '#111816' };
export function setThemeColor(theme: Theme) {
  const dark = theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const color = TOP_COLOR[theme === 'system' ? (dark ? 'dark' : 'light') : theme] ?? TOP_COLOR.light;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
  document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.setAttribute('content', theme === 'navy' || theme === 'dark' || dark ? 'black-translucent' : 'default');
}

/** Applica il tema e lo ricorda per il prossimo avvio (public/theme.js lo legge prima del primo disegno). */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  setThemeColor(theme);
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
