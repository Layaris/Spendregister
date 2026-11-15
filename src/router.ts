import { useEffect, useState } from 'react';

/** Navigazione con l'hash (#/movimenti, #/m/<id>): funziona ovunque, anche nella PWA. */
export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => { setParts(read()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}

export function go(path: string) {
  location.hash = path.startsWith('#') ? path : `#${path}`;
}

export function back(fallback = '/') {
  if (history.length > 1) history.back();
  else go(fallback);
}
