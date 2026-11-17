// Scelta del periodo (mese, anno, da inizio anno, date a scelta…): la stessa per Home e Statistiche.
import { useState } from 'react';
import { setPeriod, usePeriodSpec } from './period';
import { localDay, PERIOD_KINDS, type PeriodKind } from './util';

export function PeriodSheet({ onClose }: { onClose: () => void }) {
  const spec = usePeriodSpec();
  const [range, setRange] = useState({ from: spec.from ?? localDay(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), to: spec.to ?? localDay() });
  const pick = (kind: PeriodKind) => {
    setPeriod({ kind, offset: 0 });
    onClose();
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Seleziona periodo" onClick={(e) => e.stopPropagation()} style={{ gap: 4 }}>
        <div className="row between"><h2 className="h2">Seleziona periodo</h2><button className="btn ghost" onClick={onClose}>Annulla</button></div>
        {PERIOD_KINDS.filter(([k]) => k !== 'custom').map(([k, label]) => (
          <button key={k} className="sheet-option" aria-pressed={spec.kind === k} onClick={() => pick(k)}>{label}</button>
        ))}
        <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
          <span className="label">Dal … al …</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input grow" type="date" aria-label="Dal" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <input className="input grow" type="date" aria-label="Al" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </div>
          <button className="btn primary" disabled={!range.from || !range.to || range.from > range.to}
            onClick={() => { setPeriod({ kind: 'custom', offset: 0, from: range.from, to: range.to }); onClose(); }}>Mostra queste date</button>
        </div>
      </div>
    </div>
  );
}

/** Le frecce scorrono il periodo; non per "da inizio anno" e date a scelta. */
export const periodArrows = (kind: PeriodKind) => kind !== 'ytd' && kind !== 'custom';
