// Periodo scelto nelle Statistiche: lo stesso per tutte le schede, ricordato durante la sessione.
import { useSyncExternalStore } from 'react';
import type { PeriodSpec } from './util';

let spec: PeriodSpec = (() => {
  try { return JSON.parse(sessionStorage.getItem('ledgy-period') ?? '') as PeriodSpec; } catch { return { kind: 'month', offset: 0 }; }
})();
const listeners = new Set<() => void>();

export function setPeriod(next: PeriodSpec) {
  spec = next;
  try { sessionStorage.setItem('ledgy-period', JSON.stringify(next)); } catch { /* ignora */ }
  listeners.forEach((l) => l());
}

export function usePeriodSpec(): PeriodSpec {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => spec);
}
