import { useRef, useState, type FormEvent } from 'react';
import { TIMEZONES } from '../../shared/time';
import { api } from '../api';
import { backupToCsv, downloadFile, exportBackup, importBackup, parseBackup, summarize, type Backup } from '../backup';
import { Icon } from '../icons';
import { useStore } from '../store';
import { ErrorBox } from '../ui';
import { CURRENCIES, formatMoney } from '../util';

const LINKS: Array<[string, string, string, string]> = [
  ['#/rivedere', 'inbox', 'Da rivedere', 'Movimenti catturati che aspettano una scelta'],
  ['#/cattura', 'bolt', 'Cattura automatica', 'Telefoni collegati, notifiche ricevute, lettori'],
  ['#/regole', 'rules', 'Regole', 'Categoria in base a merchant, importo, ora'],
  ['#/assistente', 'sparkle', 'Assistente AI', 'Domande sulle spese, scontrini, screenshot'],
];

export function More({ onLogout }: { onLogout: () => void }) {
  const store = useStore();
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
      <Accounts />
      <BackupSection />
      <SettingsSection />
      <button className="btn" onClick={logout}>Esci</button>
    </div>
  );
}

function Accounts() {
  const store = useStore();
  const [adding, setAdding] = useState(false);
  const [acc, setAcc] = useState({ name: '', currency: 'EUR', initial_balance: '' });
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
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
  return (
    <section className="card">
      <div className="row between"><h2 className="h2">Conti</h2>{!adding && <button className="btn small" onClick={() => setAdding(true)}>Nuovo conto</button>}</div>
      {store.accounts.map((a) => (
        <div key={a.id} className="kv"><span>{a.name} <span className="muted">· {a.currency}</span></span><span className="num money">{formatMoney(a.balance, a.currency)}</span></div>
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
            <button className="btn primary grow" disabled={!acc.name.trim()} onClick={add}>Aggiungi conto</button>
            <button className="btn" onClick={() => setAdding(false)}>Annulla</button>
          </div>
        </div>
      )}
    </section>
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
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>Il backup contiene movimenti, conti, categorie, etichette, regole, lettori, telefoni collegati e notifiche ricevute. Non contiene la password.</p>
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
              <span className="error">Cancella tutti i dati attuali dell'account e mette quelli del backup. I telefoni collegati dopo la data del backup andranno ricollegati. Se qualcosa va storto, i dati di prima vengono rimessi.</span>
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
  return (
    <section className="card">
      <h2 className="h2">Impostazioni</h2>
      <label className="field"><span>Fuso orario delle spese catturate</span>
        <select className="input" value={tz} onChange={(e) => saveTz(e.target.value)}>
          {zones.map(([z, label]) => <option key={z} value={z}>{label}</option>)}
        </select>
      </label>
      <form className="stack" style={{ gap: 8 }} onSubmit={changePw}>
        <span className="label">Cambia password</span>
        <input className="input" type="password" autoComplete="current-password" placeholder="Password attuale" aria-label="Password attuale" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Nuova password (almeno 10 caratteri)" aria-label="Nuova password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
        <input className="input" type="password" autoComplete="new-password" placeholder="Ripeti la nuova password" aria-label="Ripeti la nuova password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} />
        <ErrorBox error={error} />
        <button className="btn" disabled={busy || !pw.current || !pw.next}>Cambia password</button>
      </form>
      <RecoveryCode />
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
            : 'Non ancora creato. Senza codice, se dimentichi la password serve il tuo agente su Cloudflare per reimpostarla.'}
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
