import { useEffect, useMemo, useState } from 'react';
import { parseAmount } from '../../shared/money';
import { api, type Tx } from '../api';
import { Icon } from '../icons';
import { back, go } from '../router';
import { useApi, useStore } from '../store';
import { CategorySelect, ErrorBox } from '../ui';
import { CURRENCIES, eur, localIso } from '../util';

type Kind = 'expense' | 'income';

export function Add() {
  const store = useStore();
  const [kind, setKind] = useState<Kind>('expense');
  const [digits, setDigits] = useState('');
  const [currency, setCurrency] = useState(() => {
    try { return localStorage.getItem('ledgy-currency') ?? 'IDR'; } catch { return 'IDR'; }
  });
  const [merchant, setMerchant] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [account, setAccount] = useState<string>('');
  const [when, setWhen] = useState(() => localIso().slice(0, 16));
  const [more, setMore] = useState(false);
  const [rate, setRate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recent = useApi<{ items: Tx[] }>('/transactions?limit=80');

  useEffect(() => {
    setRate(null);
    api<{ eurPerUnit: number | null }>(`/fx?currency=${currency}`).then((r) => setRate(r.eurPerUnit)).catch(() => setRate(null));
    try { localStorage.setItem('ledgy-currency', currency); } catch { /* ignora */ }
  }, [currency]);

  useEffect(() => {
    if (!account && store.accounts[0]) setAccount(store.accounts[0].id);
  }, [store.accounts, account]);

  // Categorie usate di recente, in ordine di frequenza.
  const quickCats = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of recent.data?.items ?? []) if (t.category_id && (kind === 'income') === t.amount_eur > 0) count.set(t.category_id, (count.get(t.category_id) ?? 0) + 1);
    const ids = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const fallback = kind === 'expense' ? ['cat_food_restaurant', 'cat_food_groceries', 'cat_transport_taxi', 'cat_food_bar', 'cat_shop'] : ['cat_income_salary', 'cat_income_refund'];
    return [...new Set([...ids, ...fallback])].filter((id) => store.cat(id)).slice(0, 6);
  }, [recent.data, kind, store]);

  const amount = parseAmount(digits || '0', currency)?.value ?? 0;
  const preview = rate && amount ? eur(Math.round(amount * rate * 1000)) : null;

  const press = (k: string) => {
    if (k === 'del') setDigits((d) => d.slice(0, -1));
    else if (k === ',') setDigits((d) => (d.includes(',') || !d ? d : `${d},`));
    else setDigits((d) => {
      if (!d && (k === '0' || k === '000')) return d;
      const [, dec] = d.split(',');
      if (dec !== undefined && dec.length + k.length > 3) return d;
      return d.length > 12 ? d : d + k;
    });
  };
  const [intPart, decPart] = digits.split(',');
  const display = digits ? `${(intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decPart !== undefined ? `,${decPart}` : ''}` : '0';

  const save = async () => {
    if (!amount) return;
    setBusy(true);
    setError(null);
    try {
      const offset = localIso().slice(16);
      const r = await api<{ id: string }>('/transactions', {
        method: 'POST',
        json: { type: kind, amount, currency, merchant: merchant || null, category_id: category, account_id: account || null, occurred_at: `${when}:00${offset}` },
      });
      await store.refresh();
      store.toast('Spesa salvata');
      go(`/m/${r.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 12 }}>
        <button className="iconbtn" aria-label="Chiudi" onClick={() => back('/')}><Icon name="close" /></button>
        <div className="seg grow" role="group" aria-label="Tipo di movimento">
          <button aria-pressed={kind === 'expense'} onClick={() => setKind('expense')}>Spesa</button>
          <button aria-pressed={kind === 'income'} onClick={() => setKind('income')}>Entrata</button>
        </div>
      </div>

      <div className="stack" style={{ alignItems: 'center', gap: 6, padding: '6px 0' }}>
        <div className="row" style={{ gap: 10 }}>
          <span className="hero-amount num" style={{ fontSize: 50 }} aria-live="polite">{display}</span>
          <label>
            <span style={{ position: 'absolute', left: -9999 }}>Valuta</span>
            <select className="btn dark" value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ borderRadius: 999, minHeight: 40 }}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <span className="muted num" style={{ fontSize: 16, minHeight: 22 }}>{currency !== 'EUR' && preview ? `≈ ${preview} al tasso di oggi` : ''}</span>
      </div>

      <label className="field">
        <span>Dove o cosa</span>
        <input className="input" placeholder="Es. Warung Made, caffè, scooter" value={merchant} onChange={(e) => setMerchant(e.target.value)} />
      </label>

      <div className="stack" style={{ gap: 8 }}>
        <span className="label">Categoria</span>
        <div className="pills">
          {quickCats.map((id) => (
            <button key={id} className="pill" aria-pressed={category === id} onClick={() => setCategory(category === id ? null : id)}>{store.catName(id)}</button>
          ))}
          <button className="pill" aria-pressed={more} onClick={() => setMore(!more)}>Altre…</button>
        </div>
        {more && <CategorySelect value={category} onChange={setCategory} kind={kind} />}
        {!category && <span className="muted" style={{ fontSize: 13 }}>Senza categoria la sceglie Ledgy dalle regole o dallo storico.</span>}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow"><span>Conto</span>
          <select className="input" value={account} onChange={(e) => setAccount(e.target.value)}>
            {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="field grow"><span>Quando</span>
          <input className="input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        </label>
      </div>

      <div className="keypad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0'].map((k) => <button key={k} className="key" onClick={() => press(k)} style={k === '000' ? { fontSize: 20 } : undefined}>{k}</button>)}
        <button className="key" aria-label="Cancella" onClick={() => press('del')}><Icon name="back" size={24} /></button>
        <button className="key" style={{ gridColumn: 'span 3', fontSize: 18 }} onClick={() => press(',')}>, decimali</button>
      </div>

      <ErrorBox error={error} />
      <button className="btn primary block" disabled={!amount || busy} onClick={save}>{busy ? 'Salvataggio…' : kind === 'expense' ? 'Salva spesa' : 'Salva entrata'}</button>
    </div>
  );
}
