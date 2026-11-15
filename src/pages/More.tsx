import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useStore } from '../store';
import { ErrorBox } from '../ui';
import { CURRENCIES, eur } from '../util';

const LINKS: Array<[string, string, string, string]> = [
  ['#/rivedere', 'inbox', 'Da rivedere', 'Movimenti catturati che aspettano una scelta'],
  ['#/cattura', 'bolt', 'Cattura automatica', 'Telefoni collegati, notifiche ricevute, lettori'],
  ['#/regole', 'rules', 'Regole', 'Categoria in base a merchant, importo, ora'],
  ['#/assistente', 'sparkle', 'Assistente AI', 'Domande sulle spese, scontrini, screenshot'],
];

export function More({ onLogout }: { onLogout: () => void }) {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [acc, setAcc] = useState({ name: '', currency: 'EUR', initial_balance: '' });
  const [error, setError] = useState<string | null>(null);

  const addAccount = async () => {
    setError(null);
    try {
      await api('/accounts', { method: 'POST', json: { name: acc.name, currency: acc.currency, initial_balance: Number(acc.initial_balance.replace(',', '.')) || 0 } });
      await store.refresh();
      setAdding(false);
      setAcc({ name: '', currency: 'EUR', initial_balance: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const logout = async () => {
    await api('/logout', { method: 'POST' });
    onLogout();
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <h1 className="page-title">Altro</h1>
      <section className="card">
        {LINKS.map(([href, icon, title, text]) => (
          <a key={href} href={href} className="row" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="ic" style={{ background: 'var(--sunken)' }}><Icon name={icon} size={20} /></span>
            <span className="grow stack" style={{ gap: 1 }}><b>{title}</b><span className="muted" style={{ fontSize: 13 }}>{text}</span></span>
            {href === '#/rivedere' && store.review_count > 0 && <span className="chip warn">{store.review_count}</span>}
            <Icon name="next" size={18} />
          </a>
        ))}
      </section>

      <section className="card">
        <div className="row between"><h2 className="h2">Conti</h2>{!adding && <button className="btn small" onClick={() => setAdding(true)}>Nuovo conto</button>}</div>
        {store.accounts.map((a) => (
          <div key={a.id} className="kv"><span>{a.name} <span className="muted">· {a.currency}</span></span><span className="num money">{eur(a.balance)}</span></div>
        ))}
        {adding && (
          <div className="stack" style={{ gap: 8 }}>
            <label className="field"><span>Nome</span><input className="input" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} placeholder="Es. Revolut" /></label>
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow"><span>Valuta</span>
                <select className="input" value={acc.currency} onChange={(e) => setAcc({ ...acc, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="field grow"><span>Saldo iniziale</span><input className="input num" inputMode="decimal" value={acc.initial_balance} onChange={(e) => setAcc({ ...acc, initial_balance: e.target.value })} /></label>
            </div>
            <ErrorBox error={error} />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary grow" disabled={!acc.name.trim()} onClick={addAccount}>Aggiungi conto</button>
              <button className="btn" onClick={() => setAdding(false)}>Annulla</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="h2">I tuoi dati</h2>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>L'import completo da Wallet arriva con il prossimo aggiornamento.</p>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn grow" href="/api/export.csv">Esporta CSV</a>
          <a className="btn grow" href="/api/export.json">Esporta tutto (JSON)</a>
        </div>
      </section>

      <button className="btn" onClick={logout}>Esci</button>
    </div>
  );
}

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="stack" style={{ gap: 14 }}>
      <h1 className="page-title">{title}</h1>
      <section className="card"><p style={{ margin: 0 }}>{text}</p></section>
    </div>
  );
}
