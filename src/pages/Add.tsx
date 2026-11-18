import { useEffect, useMemo, useState } from 'react';
import { parseAmount } from '../../shared/money';
import { api, isUnreachable, type Tx } from '../api';
import { enqueue, newClientId } from '../outbox';
import { Icon } from '../icons';
import { back, go } from '../router';
import { useApi, useStore } from '../store';
import { CategoryIcon, CategorySheet, ErrorBox } from '../ui';
import { CURRENCIES, eur, formatMoney, formatWhen, localIso } from '../util';

type Kind = 'expense' | 'income';
interface Favorite { id: string; name: string; type: Kind; amount: number | null; currency: string; merchant: string | null; category_id: string | null; account_id: string | null; note: string | null }

export function Add({ initialKind = 'expense' }: { initialKind?: Kind }) {
  const store = useStore();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [note, setNote] = useState('');
  const [star, setStar] = useState(false);
  const [editFav, setEditFav] = useState(false);
  const [showFavs, setShowFavs] = useState(false);
  const [pad, setPad] = useState(true);
  const favs = useApi<{ items: Favorite[] }>('/favorites');
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
    // Categorie iniziali più comuni: ogni account le ha con il proprio suffisso (cat_food~usr_…).
    const bases = kind === 'expense' ? ['cat_food_restaurant', 'cat_food_groceries', 'cat_transport_taxi', 'cat_food_bar', 'cat_shop'] : ['cat_income_salary', 'cat_income_refund'];
    const fallback = bases.map((b) => store.categories.find((c) => c.id.split('~')[0] === b)?.id).filter((x): x is string => !!x);
    return [...new Set([...ids, ...fallback])].filter((id) => store.cat(id)).slice(0, 6);
  }, [recent.data, kind, store]);

  const amount = parseAmount(digits || '0', currency)?.value ?? 0;
  const preview = rate && amount ? eur(Math.round(amount * rate * 1000)) : null;

  const press = (k: string) => {
    if (k === 'del') setDigits((d) => d.slice(0, -1));
    else if (k === ',') setDigits((d) => (d.includes(',') ? d : `${d || '0'},`));
    else setDigits((d) => {
      if (!d && (k === '0' || k === '000')) return d;
      const [, dec] = d.split(',');
      if (dec !== undefined && dec.length + k.length > 3) return d;
      return d.length > 12 ? d : d + k;
    });
  };
  const [intPart, decPart] = digits.split(',');
  const display = digits ? `${(intPart || '0').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${decPart !== undefined ? `,${decPart}` : ''}` : '0';

  /** Un preferito compila tutto: si cambia solo importo o descrizione, se serve. */
  const useFav = (f: Favorite) => {
    setKind(f.type);
    setCurrency(f.currency);
    setMerchant(f.merchant ?? f.name);
    setCategory(f.category_id);
    if (f.account_id) setAccount(f.account_id);
    setNote(f.note ?? '');
    setDigits(f.amount ? String(f.amount).replace('.', ',') : '');
    setShowFavs(false);
    setPad(true);
  };
  const removeFav = async (f: Favorite) => {
    await api(`/favorites/${f.id}`, { method: 'DELETE' });
    favs.reload();
  };

  const save = async () => {
    if (!amount) return;
    setBusy(true);
    setError(null);
    const offset = localIso().slice(16);
    const json = { type: kind, amount, currency, merchant: merchant.trim() || null, category_id: category, account_id: account || null, note: note.trim() || null };
    const clientId = newClientId();
    try {
      const r = await api<{ id: string }>('/transactions', { method: 'POST', json: { ...json, occurred_at: `${when}:00${offset}`, client_id: clientId } });
      if (star) await api('/favorites', { method: 'POST', json: { ...json, name: merchant.trim() || note.trim() || store.catName(category) } });
      await store.refresh();
      store.toast(`${kind === 'expense' ? 'Spesa salvata' : 'Entrata salvata'}${star ? ' e aggiunta ai preferiti' : ''}`);
      go(`/m/${r.id}`);
    } catch (e) {
      if (isUnreachable(e)) {
        // Server irraggiungibile: la spesa resta sul telefono e parte da sola appena risponde.
        enqueue({ client_id: clientId, json: { ...json, occurred_at: `${when}:00${offset}` }, at: new Date().toISOString() });
        store.toast('Server non raggiungibile: la spesa è salvata sul telefono e parte da sola');
        go('/');
      } else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const acc = store.accounts.find((a) => a.id === account);
  const cat = store.cat(category);
  const hidePad = () => setPad(false);

  return (
    <div className="add-page" style={pad ? undefined : { paddingBottom: 120 }}>
      <div className="row between">
        <button className="iconbtn" aria-label="Chiudi" onClick={() => back('/')}><Icon name="close" /></button>
        <span className="h2">{kind === 'expense' ? 'Nuova spesa' : 'Nuova entrata'}</span>
        <button className="btn" style={{ background: 'var(--card)', minHeight: 44 }} onClick={() => setShowFavs(true)}><Icon name="star" size={18} />Preferiti</button>
      </div>

      <div className="seg" role="group" aria-label="Tipo di movimento">
        <button aria-pressed={kind === 'expense'} onClick={() => { setKind('expense'); setCategory(null); }}>Spesa</button>
        <button aria-pressed={kind === 'income'} onClick={() => { setKind('income'); setCategory(null); }}>Entrata</button>
      </div>

      <div className="amount-card" role="group" aria-label="Importo">
        <label className="cur-chip">
          {currency}<Icon name="down" size={14} stroke={2.4} />
          <select aria-label="Valuta" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button className="grow stack" style={{ gap: 2, alignItems: 'flex-end', background: 'none', border: 0, padding: 0, cursor: 'pointer', minWidth: 0, color: 'inherit' }}
          onClick={() => setPad(true)} aria-label="Scrivi l'importo">
          <span className={`amount hero-amount ${amount ? (kind === 'expense' ? 'neg' : 'pos') : ''}`} aria-live="polite">{amount ? (kind === 'expense' ? '−' : '+') : ''}{display}</span>
          <span className="muted num" style={{ fontSize: 14, minHeight: 20 }}>{currency !== 'EUR' && preview ? `≈ ${preview} al tasso di oggi` : ''}</span>
        </button>
      </div>

      <span className="section-title">Essenziale</span>
      <div className="list">
        <div className="lrow note">
          <span className="lrow-ic"><Icon name="note" size={18} /></span>
          <textarea className="lrow-input" rows={2} placeholder="Descrizione: cosa, con chi, perché…" aria-label="Descrizione" value={note}
            onChange={(e) => setNote(e.target.value)} onFocus={hidePad} />
        </div>
        <button className="lrow" onClick={() => setMore(true)}>
          {cat ? <CategoryIcon id={category} size={32} /> : <span className="lrow-ic"><Icon name="question" size={18} /></span>}
          <span className="lrow-label">Categoria</span>
          <span className={`lrow-value ${cat ? 'set' : 'accent'}`}>{cat ? cat.name : 'Scegli'}</span>
          <Icon name="next" size={18} />
        </button>
        <label className="lrow">
          <span className="lrow-ic"><Icon name="store" size={18} /></span>
          <span className="lrow-label">Dove</span>
          <input className="lrow-input" placeholder="Negozio o persona" value={merchant} onChange={(e) => setMerchant(e.target.value)} onFocus={hidePad} />
        </label>
      </div>
      {quickCats.length > 0 && (
        <div className="pills">
          {quickCats.map((id) => (
            <button key={id} className="pill small" aria-pressed={category === id} onClick={() => setCategory(category === id ? null : id)}>{store.catName(id)}</button>
          ))}
        </div>
      )}
      {more && <CategorySheet value={category} kind={kind} onPick={(v) => { setCategory(v); setMore(false); }} onClose={() => setMore(false)} />}

      <span className="section-title">Dettagli</span>
      <div className="list">
        <label className="lrow">
          <span className="lrow-ic"><Icon name="wallet" size={18} /></span>
          <span className="lrow-label">Conto</span>
          <span className="lrow-value set">{acc ? `${acc.name} · ${acc.currency}` : 'Nessuno'}</span>
          <Icon name="next" size={18} />
          <select className="overlay" aria-label="Conto" value={account} onChange={(e) => setAccount(e.target.value)}>
            {store.accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}
          </select>
        </label>
        <label className="lrow">
          <span className="lrow-ic"><Icon name="calendar" size={18} /></span>
          <span className="lrow-label">Data e ora</span>
          <span className="lrow-value set">{when.slice(0, 10) === localIso().slice(0, 10) ? `oggi, ${when.slice(11, 16)}` : formatWhen(when)}</span>
          <Icon name="next" size={18} />
          <input className="overlay" type="datetime-local" aria-label="Data e ora" value={when} onChange={(e) => e.target.value && setWhen(e.target.value)} />
        </label>
      </div>

      <ErrorBox error={error} />

      {pad ? (
        <div className="padsheet">
          <div className="padsheet-inner">
            <button className="grip" aria-label="Nascondi il tastierino" onClick={() => setPad(false)} />
            <div className="pad">
              {['1', '2', '3'].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}
              <button className="fn" aria-label="Cancella" onClick={() => press('del')}><Icon name="back" size={22} /></button>
              {['4', '5', '6'].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}
              <button onClick={() => press(',')} aria-label="Virgola dei decimali">,</button>
              {['7', '8', '9'].map((k) => <button key={k} onClick={() => press(k)}>{k}</button>)}
              <button className="fn" onClick={() => press('000')}>000</button>
              <button className="fn star" aria-pressed={star} aria-label="Salva anche nei preferiti" onClick={() => setStar(!star)}><Icon name="star" size={22} /></button>
              <button onClick={() => press('0')}>0</button>
              <button className="save" disabled={!amount || busy} onClick={save}>{busy ? '…' : 'Salva'}</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="padsheet">
          <div className="padsheet-inner row" style={{ gap: 8 }}>
            <button className="btn" style={{ minHeight: 50 }} onClick={() => setPad(true)}>Importo</button>
            <button className="btn primary grow" style={{ minHeight: 50, fontSize: 17 }} disabled={!amount || busy} onClick={save}>{busy ? '…' : kind === 'expense' ? 'Salva spesa' : 'Salva entrata'}</button>
          </div>
        </div>
      )}

      {showFavs && (
        <div className="modal-backdrop" onClick={() => setShowFavs(false)}>
          <div className="modal card sheet" role="dialog" aria-modal="true" aria-label="Preferiti" onClick={(e) => e.stopPropagation()}>
            <div className="row between">
              <h2 className="h2">Preferiti</h2>
              <div className="row" style={{ gap: 16 }}>
                {(favs.data?.items.length ?? 0) > 0 && <button className="btn ghost" onClick={() => setEditFav(!editFav)}>{editFav ? 'Fatto' : 'Modifica'}</button>}
                <button className="btn ghost" onClick={() => setShowFavs(false)}>Chiudi</button>
              </div>
            </div>
            {!favs.data?.items.length && <p className="muted" style={{ margin: 0 }}>Nessun preferito. Quando salvi un movimento tocca la stella ☆ e lo ritrovi qui, pronto con un tap.</p>}
            <div className="list" style={{ overflowY: 'auto' }}>
              {favs.data?.items.map((f) => (
                <button key={f.id} className="lrow" onClick={() => (editFav ? removeFav(f) : useFav(f))}>
                  {editFav ? <span className="lrow-ic" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}><Icon name="trash" size={18} /></span> : <CategoryIcon id={f.category_id} size={32} />}
                  <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
                    <span style={{ fontWeight: 600 }}>{f.name}</span>
                    <span className="muted" style={{ fontSize: 13 }}>{store.catName(f.category_id)}{f.note ? ` · ${f.note}` : ''}</span>
                  </span>
                  <span className={`num ${f.type === 'income' ? 'pos' : ''}`} style={{ fontWeight: 600 }}>{f.amount ? formatMoney(Math.round(f.amount * 1000), f.currency) : ''}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
