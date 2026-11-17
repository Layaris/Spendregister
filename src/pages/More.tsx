import { useRef, useState, type FormEvent } from 'react';
import { parseAmount } from '../../shared/money';
import { TIMEZONES } from '../../shared/time';
import { api } from '../api';
import { backupToCsv, downloadFile, exportBackup, importBackup, parseBackup, summarize, type Backup } from '../backup';
import { Icon } from '../icons';
import { applyTheme, useApi, useStore } from '../store';
import { AiSettings } from './AiSettings';
import type { Theme } from '../api';
import { ErrorBox } from '../ui';
import { CURRENCIES, formatMoney, relativeTime } from '../util';

const DISPLAY_CURRENCIES: Array<[string, string]> = [
  ['EUR', 'Euro'], ['USD', 'Dollaro USA'], ['AED', 'Dirham emiratino'], ['PHP', 'Peso filippino'], ['IDR', 'Rupia indonesiana'],
  ['SGD', 'Dollaro di Singapore'], ['CNY', 'Yuan cinese'], ['THB', 'Baht thailandese'],
];

const LINKS: Array<[string, string, string, string]> = [
  ['#/rivedere', 'inbox', 'Da rivedere', 'Movimenti catturati che aspettano una scelta'],
  ['#/budget', 'wallet', 'Budget', 'Tetto del mese e budget per categoria'],
  ['#/viaggi', 'plane', 'Viaggi', 'Quanto spendi in ogni viaggio'],
  ['#/cattura', 'bolt', 'Cattura automatica', 'Telefoni collegati, notifiche ricevute, lettori'],
  ['#/carte', 'card', 'Carte e banche', 'Con quale carta paghi, quanto per carta'],
  ['#/importa-wallet', 'download', 'Importa da Wallet', 'Movimenti, conti, categorie ed etichette da Wallet by BudgetBakers'],
  ['#/regole', 'rules', 'Regole', 'Categoria in base a merchant, importo, ora'],
  ['#/assistente', 'sparkle', 'Assistente AI', 'Domande sulle spese, scontrini, screenshot'],
];

interface Device { name: string; last_seen_at: string | null; last_capture_at: string | null }

/** Stato della cattura (era nella Home): telefoni collegati, segnale, ultima spesa. */
function useCaptureStatus(): { text: string; warn: boolean } | null {
  const devices = useApi<{ items: Device[] }>('/capture/devices');
  const items = devices.data?.items;
  if (!items) return null;
  if (!items.length) return { text: 'Nessun telefono collegato: collegane uno per registrare le spese da sole', warn: true };
  const stale = items.filter((d) => !d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 26 * 3600_000);
  if (stale.length) return { text: `${stale.map((d) => d.name).join(', ')}: nessun segnale da oltre un giorno`, warn: true };
  const last = items.map((d) => d.last_capture_at).filter(Boolean).sort().pop() ?? null;
  return { text: `Attiva su ${items.length} ${items.length === 1 ? 'dispositivo' : 'dispositivi'} · ultima spesa ${relativeTime(last)}`, warn: false };
}

export function More({ onAuthChange }: { onAuthChange: () => void }) {
  const store = useStore();
  const guest = !store.account.email;
  const capture = useCaptureStatus();
  const logout = async () => {
    await api('/logout', { method: 'POST' });
    onAuthChange();
  };
  return (
    <div className="stack" style={{ gap: 14 }}>
      <h1 className="page-title">Altro</h1>
      {guest ? (
        <section className="card">
          <h2 className="h2">Stai usando Ledgy senza account</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>I dati restano legati a questo browser. Crea un account per non perderli e ritrovarli su ogni dispositivo, oppure entra in quello che hai già.</p>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn primary grow" href="#/account/crea">Crea account</a>
            <a className="btn grow" href="#/account">Entra</a>
          </div>
        </section>
      ) : <p className="lead">Account: <b>{store.account.email}</b></p>}
      <div className="list">
        {LINKS.map(([href, icon, title, text]) => (
          <a key={href} href={href} className="lrow">
            <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name={icon} size={18} /></span>
            <span className="grow stack" style={{ gap: 0, minWidth: 0 }}><span style={{ fontWeight: 600 }}>{title}</span>{href === '#/cattura' && capture
                ? <span className="row" style={{ gap: 6, fontSize: 13, alignItems: 'baseline' }}><span className={`dot ${capture.warn ? 'warn' : ''}`} style={{ flexShrink: 0, transform: 'translateY(-1px)' }} /><span className="muted">{capture.text}</span></span>
                : <span className="muted" style={{ fontSize: 13 }}>{text}</span>}</span>
            {href === '#/rivedere' && store.review_count > 0 && <span className="chip warn">{store.review_count}</span>}
            <Icon name="next" size={18} />
          </a>
        ))}
      </div>
      <Accounts />
      <BackupSection />
      <WipeBalance />
      <AiSettings />
      <SettingsSection />
      {!guest && <button className="btn" onClick={logout}>Esci</button>}
      {!guest && <DeleteAccount onDone={onAuthChange} />}
    </div>
  );
}

/** Elimina l'account e tutti i suoi dati, con la password come conferma. */
function DeleteAccount({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api('/account/delete', { method: 'POST', json: { password } });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  if (!open) return <button className="btn ghost" style={{ color: 'var(--danger)', alignSelf: 'center' }} onClick={() => setOpen(true)}>Elimina account</button>;
  return (
    <form className="card" onSubmit={remove}>
      <h2 className="h2">Elimina account</h2>
      <p className="error" style={{ margin: 0 }}>Cancella per sempre l'account e tutti i suoi dati: movimenti, conti, regole, telefoni collegati. Se vuoi conservarli, prima esporta un backup.</p>
      <input className="input" type="password" autoComplete="current-password" placeholder="Password" aria-label="Password per eliminare l'account" value={password} onChange={(e) => setPassword(e.target.value)} />
      <ErrorBox error={error} />
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} disabled={!password}>Elimina per sempre</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Annulla</button>
      </div>
    </form>
  );
}

function Accounts() {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [acc, setAcc] = useState({ name: '', currency: 'EUR', initial_balance: '' });
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', currency: 'EUR', target: '' });
  const [confirmCur, setConfirmCur] = useState(false);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setError(null);
    try {
      await fn();
      await store.refresh();
      store.toast(msg);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const toggle = (id: string) => {
    const a = store.accounts.find((x) => x.id === id)!;
    setOpen(open === id ? null : id);
    setEdit({ name: a.name, currency: a.currency, target: '' });
    setConfirmCur(false);
    setError(null);
  };
  /** Saldo vero → movimento di correzione per la differenza, nella valuta del conto. */
  const correct = (id: string, currency: string, balance: number) => {
    const v = parseAmount(edit.target, currency);
    if (!v) { setError('Importo non valido'); return; }
    const diff = Math.round(v.value * 1000) - balance;
    if (!diff) { setEdit({ ...edit, target: '' }); return; }
    run(() => api('/transactions', { method: 'POST', json: { type: diff > 0 ? 'income' : 'expense', amount: Math.abs(diff) / 1000, currency, account_id: id, merchant: 'Correzione saldo' } }), 'Saldo corretto')
      .then((ok) => ok && setEdit({ ...edit, target: '' }));
  };
  const add = async () => {
    const ok = await run(() => api('/accounts', { method: 'POST', json: { name: acc.name, currency: acc.currency, initial_balance: Number(acc.initial_balance.replace(',', '.')) || 0 } }), 'Conto aggiunto');
    if (ok) { setAdding(false); setAcc({ name: '', currency: 'EUR', initial_balance: '' }); }
  };

  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="row between" style={{ padding: '0 6px' }}>
        <span className="section-title" style={{ margin: 0, padding: 0 }}>Conti</span>
        {!adding && <button className="btn ghost" style={{ minHeight: 30 }} onClick={() => setAdding(true)}>+ Nuovo conto</button>}
      </div>
      <div className="list">
        {store.accounts.map((a) => (
          <div key={a.id}>
            <button className="lrow" onClick={() => toggle(a.id)} aria-expanded={open === a.id}>
              <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="wallet" size={18} /></span>
              <span className="lrow-label">{a.name} <span className="muted" style={{ fontSize: 14 }}>· {a.currency}</span></span>
              <span className="lrow-value set num money" style={{ fontWeight: 600 }}>{formatMoney(a.balance, a.currency)}</span>
              <Icon name={open === a.id ? 'down' : 'next'} size={18} />
            </button>
            {open === a.id && (
              <div className="stack" style={{ gap: 10, padding: '4px 16px 16px 60px' }}>
                <div className="row" style={{ gap: 6 }}>
                  <input className="input grow" aria-label="Nome del conto" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                  {edit.name.trim() && edit.name.trim() !== a.name && <button className="btn primary" onClick={() => run(() => api(`/accounts/${a.id}`, { method: 'PUT', json: { name: edit.name } }), 'Nome salvato')}>Salva</button>}
                </div>
                <label className="field"><span>Valuta del conto</span>
                  <select className="input" value={edit.currency} onChange={(e) => { setEdit({ ...edit, currency: e.target.value }); setConfirmCur(e.target.value !== a.currency); }}>
                    {[...new Set([a.currency, ...CURRENCIES])].map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                {confirmCur && (
                  <div className="card" style={{ background: 'var(--sunken)', gap: 8 }}>
                    <span style={{ fontSize: 15 }}>Il conto passa da {a.currency} a <b>{edit.currency}</b>. Il saldo iniziale si converte al cambio di oggi; i movimenti restano nella loro valuta.</span>
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn grow" onClick={() => { setEdit({ ...edit, currency: a.currency }); setConfirmCur(false); }}>Annulla</button>
                      <button className="btn primary grow" onClick={() => run(() => api(`/accounts/${a.id}`, { method: 'PUT', json: { currency: edit.currency } }), `Conto in ${edit.currency}`).then((ok) => ok && setConfirmCur(false))}>Cambia valuta</button>
                    </div>
                  </div>
                )}
                <label className="field"><span>Saldo vero oggi (Ledgy aggiunge la differenza)</span>
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input grow num" inputMode="decimal" placeholder={formatMoney(a.balance, a.currency)} value={edit.target} onChange={(e) => setEdit({ ...edit, target: e.target.value })} />
                    <button className="btn primary" disabled={!edit.target.trim()} onClick={() => correct(a.id, a.currency, a.balance)}>Correggi</button>
                  </div>
                </label>
                <ErrorBox error={error} />
              </div>
            )}
          </div>
        ))}
      </div>
      {adding && (
        <div className="card">
          <label className="field"><span>Nome</span><input className="input" value={acc.name} onChange={(e) => setAcc({ ...acc, name: e.target.value })} placeholder="Es. Revolut" /></label>
          <div className="row" style={{ gap: 8 }}>
            <label className="field grow"><span>Valuta</span>
              <select className="input" value={acc.currency} onChange={(e) => setAcc({ ...acc, currency: e.target.value })}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
            </label>
            <label className="field grow"><span>Saldo iniziale</span><input className="input num" inputMode="decimal" value={acc.initial_balance} onChange={(e) => setAcc({ ...acc, initial_balance: e.target.value })} /></label>
          </div>
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" disabled={!acc.name.trim()} onClick={add}>Aggiungi conto</button>
            <button className="btn" onClick={() => setAdding(false)}>Annulla</button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Svuota il bilancio: via spese, entrate e notifiche ricevute; restano tutte le impostazioni. Con conferma. */
function WipeBalance() {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = useApi<{ items: unknown[] }>(open ? '/transactions?limit=500' : null);
  const backupFirst = async () => {
    setBusy(true);
    try {
      const b = await exportBackup(() => {});
      downloadFile(`ledgy-backup-prima-di-svuotare-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(b), 'application/json');
      setSaved(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const wipe = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ deleted: number }>('/account/wipe-transactions', { method: 'POST', json: { confirm: 'SVUOTA' } });
      setOpen(false);
      await store.refresh();
      store.toast(`Bilancio svuotato: ${r.deleted} movimenti cancellati. Impostazioni intatte.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const n = count.data?.items.length;
  return (
    <>
      <button className="btn" style={{ color: 'var(--danger)' }} onClick={() => { setOpen(true); setSaved(false); setError(null); }}>
        <Icon name="trash" size={18} />Svuota il bilancio
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => !busy && setOpen(false)}>
          <div className="modal card" role="alertdialog" aria-modal="true" aria-labelledby="wipe-title" onClick={(e) => e.stopPropagation()}>
            <h2 className="h2" id="wipe-title">Sei sicuro di voler svuotare il bilancio?</h2>
            <p style={{ margin: 0 }}>
              Cancello per sempre <b>{n == null ? 'tutte le' : n >= 500 ? 'oltre 500' : n} spese ed entrate</b> e l’elenco delle notifiche ricevute.
            </p>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Restano: conti e saldi iniziali, categorie, regole, carte e banche, lettori, telefoni collegati, preferiti, impostazioni e chiavi dell’AI.
              Serve per ripartire pulito, per esempio prima di importare i dati di Wallet.
            </p>
            <button className="btn" disabled={busy} onClick={backupFirst}><Icon name="download" size={18} />{saved ? 'Backup scaricato ✓' : 'Esporta prima un backup'}</button>
            <ErrorBox error={error} />
            <div className="row" style={{ gap: 8 }}>
              <button className="btn grow" disabled={busy} onClick={() => setOpen(false)}>Annulla</button>
              <button className="btn grow" disabled={busy} style={{ background: 'var(--danger)', color: '#fff' }} onClick={wipe}>{busy ? 'Un momento…' : 'Sì, svuota'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BackupSection() {
  const store = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Backup | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const day = new Date().toISOString().slice(0, 10);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); setProgress(''); }
  };

  const doExport = (kind: 'json' | 'csv') => run(async () => {
    const b = await exportBackup(setProgress);
    if (kind === 'json') downloadFile(`ledgy-backup-${day}.json`, JSON.stringify(b), 'application/json');
    else downloadFile(`ledgy-movimenti-${day}.csv`, `﻿${backupToCsv(b)}`, 'text/csv;charset=utf-8');
    store.toast(kind === 'json' ? 'Backup scaricato' : 'CSV scaricato');
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setConfirmReplace(false);
    try { setPending(parseBackup(await file.text())); } catch (e) { setError((e as Error).message); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const doImport = (mode: 'merge' | 'replace') => run(async () => {
    if (!pending) return;
    const r = await importBackup(pending, mode, setProgress);
    setPending(null);
    setConfirmReplace(false);
    await store.refresh();
    store.toast(mode === 'merge' ? `Aggiunti ${r.inserted} elementi, ${r.skipped} già presenti` : 'Backup ripristinato');
  });

  return (
    <section className="card">
      <h2 className="h2">Backup</h2>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Il backup contiene i dati del tuo account: movimenti, conti, categorie, etichette, regole, lettori, telefoni collegati, notifiche ricevute, impostazioni e chiavi dell’AI. Non contiene la password né il codice di recupero.</p>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" disabled={busy} onClick={() => doExport('json')}><Icon name="download" size={18} />Esporta backup</button>
        <button className="btn grow" disabled={busy} onClick={() => doExport('csv')}>Esporta CSV</button>
      </div>
      <label className="btn" style={{ cursor: busy ? 'default' : 'pointer' }}>
        Importa un backup…
        <input ref={fileRef} type="file" accept=".json,application/json" disabled={busy} style={{ display: 'none' }} onChange={(e) => pick(e.target.files?.[0])} />
      </label>
      {pending && (
        <div className="stack" style={{ gap: 10, background: 'var(--sunken)', borderRadius: 14, padding: 12 }}>
          <span style={{ fontSize: 14 }}>Backup del {new Date(pending.exported_at).toLocaleDateString('it-IT')}: {summarize(pending)}.</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Come vuoi importarlo?</span>
          <button className="btn primary" disabled={busy} onClick={() => doImport('merge')}>Aggiungi ai dati attuali</button>
          <span className="muted" style={{ fontSize: 13 }}>Tiene tutto quello che hai e aggiunge solo ciò che manca. Categorie, conti ed etichette con lo stesso nome vengono riconosciuti, non duplicati.</span>
          {!confirmReplace ? (
            <button className="btn" disabled={busy} onClick={() => setConfirmReplace(true)}>Sostituisci i dati attuali…</button>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <span className="error">Cancella tutti i dati attuali del tuo account e mette quelli del backup. I telefoni collegati dopo la data del backup andranno ricollegati. Se qualcosa va storto, i dati di prima vengono rimessi.</span>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn grow" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }} disabled={busy} onClick={() => doImport('replace')}>Sì, sostituisci tutto</button>
                <button className="btn" disabled={busy} onClick={() => setConfirmReplace(false)}>Annulla</button>
              </div>
            </div>
          )}
          {!busy && <button className="btn ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setPending(null)}>Lascia stare</button>}
        </div>
      )}
      {busy && progress && <span className="muted" style={{ fontSize: 13 }} role="status">{progress}</span>}
      <ErrorBox error={error} />
    </section>
  );
}

function SettingsSection() {
  const store = useStore();
  const [tz, setTz] = useState(store.settings.timezone);
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const saveTz = async (value: string) => {
    setTz(value);
    await api('/settings', { method: 'PUT', json: { timezone: value } });
    await store.refresh();
    store.toast('Fuso orario salvato');
  };

  const changePw = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.next !== pw.repeat) { setError('Le due nuove password non coincidono'); return; }
    setBusy(true);
    try {
      await api('/password', { method: 'PUT', json: { current: pw.current, next: pw.next } });
      setPw({ current: '', next: '', repeat: '' });
      store.toast('Password cambiata. Gli altri dispositivi dovranno rientrare.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const zones = TIMEZONES.some(([z]) => z === tz) ? TIMEZONES : [[tz, tz] as [string, string], ...TIMEZONES];
  const saveSetting = async (patch: Record<string, string>, msg: string) => {
    await api('/settings', { method: 'PUT', json: patch });
    await store.refresh();
    store.toast(msg);
  };
  return (
    <section className="card">
      <h2 className="h2">Impostazioni</h2>
      <div className="field">
        <span>Tema</span>
        <div className="seg" role="group" aria-label="Tema">
          {([['light', 'Chiaro'], ['blue', 'Azzurro'], ['dark', 'Scuro'], ['system', 'Auto']] as Array<[Theme, string]>).map(([t, label]) => (
            <button key={t} aria-pressed={store.settings.theme === t} onClick={() => { applyTheme(t); saveSetting({ theme: t }, 'Tema salvato'); }}>{label}</button>
          ))}
        </div>
      </div>
      <label className="field"><span>Valuta in cui vedere totali e saldi</span>
        <select className="input" value={store.settings.display_currency} onChange={(e) => saveSetting({ display_currency: e.target.value }, `Ora vedi tutto in ${e.target.value}`)}>
          {DISPLAY_CURRENCIES.map(([c, label]) => <option key={c} value={c}>{c} · {label}</option>)}
        </select>
      </label>
      <a className="row" href="#/categorie" style={{ textDecoration: 'none', color: 'inherit', minHeight: 44 }}>
        <span className="grow"><b>Categorie</b><br /><span className="muted" style={{ fontSize: 14 }}>Crea, rinomina, sposta, elimina; accendi o spegni i gruppi</span></span>
        <Icon name="next" size={18} />
      </a>
      <label className="field"><span>Fuso orario delle spese catturate</span>
        <select className="input" value={tz} onChange={(e) => saveTz(e.target.value)}>
          {zones.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
        </select>
      </label>
      {store.account.email && <form className="stack" style={{ gap: 8 }} onSubmit={changePw}>
        <span className="label">Cambia password</span>
        <input className="input" type="password" autoComplete="current-password" placeholder="Password attuale" aria-label="Password attuale" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Nuova password (almeno 10 caratteri)" aria-label="Nuova password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Ripeti la nuova password" aria-label="Ripeti la nuova password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
        <ErrorBox error={error} />
        <button className="btn" disabled={busy || !pw.current || !pw.next}>Cambia password</button>
      </form>}
      {store.account.email && <RecoveryCode />}
    </section>
  );
}

/** Codice di recupero, come in Multifolio: serve se dimentichi la password. Si vede una volta sola. */
function RecoveryCode() {
  const store = useStore();
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const exists = !!store.settings.recovery_created_at;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<{ code: string }>('/recovery-code', { method: 'POST', json: { password } });
      setCode(r.code);
      setPassword('');
      setAsking(false);
      await store.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(code ?? ''); store.toast('Codice copiato'); } catch { store.toast('Copia non riuscita: selezionalo a mano'); }
  };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <span className="label">Codice di recupero</span>
      {code ? (
        <div className="stack" style={{ gap: 8, background: 'var(--warn-soft)', borderRadius: 14, padding: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Salvalo adesso nel portachiavi o scrivilo su carta: non lo vedrai più.</span>
          <div className="raw" style={{ fontSize: 17, textAlign: 'center', letterSpacing: '0.06em', background: 'var(--card)' }}>{code}</div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn grow" onClick={copy}>Copia</button>
            <button className="btn primary grow" onClick={() => setCode(null)}>L'ho salvato</button>
          </div>
        </div>
      ) : (
        <span className="muted" style={{ fontSize: 13 }}>
          {exists
            ? `Attivo dal ${new Date(store.settings.recovery_created_at!).toLocaleDateString('it-IT')}. Se dimentichi la password, nella schermata di accesso premi "Password dimenticata?" e inserisci il codice.`
            : 'Non ancora creato. Crealo subito: senza codice, se dimentichi la password non potrai più entrare nel tuo account.'}
        </span>
      )}
      {!code && (asking ? (
        <form className="stack" style={{ gap: 8 }} onSubmit={create}>
          <input className="input" type="password" autoComplete="current-password" placeholder="Password attuale" aria-label="Password attuale per creare il codice" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          {exists && <span className="muted" style={{ fontSize: 13 }}>Il codice vecchio smetterà di valere.</span>}
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary grow" disabled={!password}>Crea il codice</button>
            <button type="button" className="btn" onClick={() => { setAsking(false); setError(null); }}>Annulla</button>
          </div>
        </form>
      ) : (
        <button className="btn" onClick={() => setAsking(true)}>{exists ? 'Crea un nuovo codice di recupero' : 'Crea il codice di recupero'}</button>
      ))}
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
