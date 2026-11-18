// Impostazioni › Carte e banche: le carte con cui paghi, da quali notifiche arrivano, quanto hai speso con
// ciascuna questo mese; rinomina o togli una carta ovunque. La carta divide il totale delle spese, non si somma.
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { ErrorBox, Loading, TopBar, type CardInfo } from '../ui';
import { eur } from '../util';

export function Cards() {
  const store = useStore();
  const { data, error, reload } = useApi<{ items: CardInfo[] }>('/cards');
  const [open, setOpen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const rename = async (from: string, to: string | null) => {
    setErr(null);
    try {
      const r = await api<{ changed: number }>('/cards/rename', { method: 'POST', json: { from, to } });
      store.toast(to ? `${from} ora si chiama ${to} (${r.changed} spese)` : `Carta ${from} tolta da ${r.changed} spese`);
      setOpen(null);
      setConfirm(null);
      reload();
      await store.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const total = data?.items.reduce((a, c) => a + c.month_spent, 0) ?? 0;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <TopBar title="Carte e banche" backTo="/altro" />
      <p className="lead">Ogni spesa può dire con quale carta l’hai pagata. Le carte dividono il totale delle spese, non si sommano: 1 € di caffè pagato con Revolut è 1 € in tutto, di cui 1 € da Revolut.</p>
      <ErrorBox error={error ?? err} />
      {!data ? <Loading /> : !data.items.length ? (
        <div className="card">
          <b>Nessuna carta ancora</b>
          <span className="muted">In <a href="#/cattura">Cattura automatica</a> tocca “Scegli la carta” su una notifica arrivata: da lì tutte quelle con lo stesso titolo prendono la carta.</span>
        </div>
      ) : (
        <>
          <span className="section-title">Questo mese · {eur(total)}</span>
          <div className="list">
            {data.items.map((c) => (
              <div key={c.name}>
                <button className="lrow" onClick={() => { setOpen(open === c.name ? null : c.name); setName(c.name); setConfirm(null); }} aria-expanded={open === c.name}>
                  <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="card" size={18} /></span>
                  <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{c.count} {c.count === 1 ? 'spesa' : 'spese'}{c.sources.length ? ` · da “${c.sources.join('”, “')}”` : ''}</span>
                  </span>
                  <span className="num money" style={{ fontWeight: 600 }}>{eur(c.month_spent)}</span>
                  <Icon name={open === c.name ? 'down' : 'next'} size={18} />
                </button>
                {open === c.name && (
                  <div className="stack" style={{ gap: 8, padding: '4px 16px 16px 60px' }}>
                    <span className="muted" style={{ fontSize: 13 }}>
                      {c.fx?.markup_bp != null
                        ? <>Ricarico sul cambio: <b style={{ color: 'var(--ink)' }}>{(c.fx.markup_bp / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })}%</b> (carta in {c.fx.currency}). {c.fx.sample_tx_id && <a href={`#/m/${c.fx.sample_tx_id}`}>Spesa usata per il calcolo</a>}</>
                        : <>Costo del cambio: apri una spesa in un'altra valuta pagata con {c.name} e scrivi quanto ha addebitato la carta.</>}
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      <input className="input grow" aria-label={`Nuovo nome per ${c.name}`} value={name} onChange={(e) => setName(e.target.value)} />
                      <button className="btn primary" disabled={!name.trim() || name.trim() === c.name} onClick={() => rename(c.name, name.trim())}>Rinomina</button>
                    </div>
                    {confirm === c.name ? (
                      <div className="row" style={{ gap: 8 }}>
                        <button className="btn grow" onClick={() => setConfirm(null)}>Annulla</button>
                        <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} onClick={() => rename(c.name, null)}>Togli da {c.count} spese</button>
                      </div>
                    ) : (
                      <button className="btn ghost" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={() => setConfirm(c.name)}>Togli questa carta</button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 13, padding: '0 6px' }}>Per assegnare una carta a nuove notifiche: <a href="#/cattura">Cattura automatica</a> → “Scegli la carta”. La spesa per carta di ogni periodo è in Statistiche → Spese.</span>
        </>
      )}
    </div>
  );
}
