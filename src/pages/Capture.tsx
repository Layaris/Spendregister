import { useEffect, useRef, useState } from 'react';
import { suggestPattern } from '../../shared/notification';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { CardSheet, ErrorBox, Loading, TopBar } from '../ui';
import { relativeTime } from '../util';

interface Device { id: string; name: string; platform: string; method: string; token_hint: string; last_seen_at: string | null; last_capture_at: string | null; client_version: string | null }

/** Versione del comando iPhone servito a /ledgy.shortcut (uguale a VERSION in tools/shortcut/build_shortcut.py). */
const SHORTCUT_VERSION = 3;
interface Capture { id: string; received_at: string; app: string | null; title: string | null; text: string; status: string; detail: string | null; transaction_id: string | null; card?: string | null }
interface Parser { id: string; name: string; app: string; pattern: string; default_currency: string | null; sample: string | null; enabled: number }

const STATUS: Record<string, string> = { created: 'Salvata', review: 'Da rivedere', duplicate: 'Doppione', ignored: 'Ignorata', unrecognized: 'Non riconosciuta' };

export function Capture() {
  const store = useStore();
  const devices = useApi<{ items: Device[] }>('/capture/devices');
  const captures = useApi<{ items: Capture[] }>('/capture/captures?limit=30');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [cardFor, setCardFor] = useState<Capture | null>(null);
  const parsers = useApi<{ items: Parser[] }>('/capture/parsers');
  const [connect, setConnect] = useState<{ platform: 'ios' | 'android'; url?: string } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasShortcut, setHasShortcut] = useState(false);
  const [renew, setRenew] = useState<string | null>(null);

  useEffect(() => {
    fetch('/ledgy.shortcut', { method: 'HEAD' }).then((r) => setHasShortcut(r.ok && !r.headers.get('content-type')?.includes('html'))).catch(() => {});
  }, []);

  const create = async () => {
    if (!connect) return;
    setError(null);
    try {
      const r = await api<{ url: string }>('/capture/devices', { method: 'POST', json: { name: name || (connect.platform === 'ios' ? 'iPhone' : 'Android'), platform: connect.platform, method: connect.platform === 'ios' ? 'shortcut' : 'macrodroid' } });
      setConnect({ ...connect, url: r.url });
      devices.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); store.toast('Indirizzo copiato'); } catch { store.toast('Copia non riuscita: selezionalo a mano'); }
  };

  /** Nuovo indirizzo per un telefono già collegato (es. comando perso): il vecchio smette di funzionare. */
  const newAddress = async (d: Device) => {
    if (renew !== d.id) { setRenew(d.id); return; }
    setRenew(null);
    try {
      const r = await api<{ url: string }>(`/capture/devices/${d.id}/token`, { method: 'POST' });
      setConnect({ platform: d.platform === 'android' ? 'android' : 'ios', url: r.url });
      devices.reload();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const revoke = async (d: Device) => {
    await api(`/capture/devices/${d.id}`, { method: 'DELETE' });
    store.toast(`${d.name} scollegato`);
    devices.reload();
  };

  const retry = async (c: Capture) => {
    try {
      const r = await api<{ status: string }>(`/capture/captures/${c.id}/retry`, { method: 'POST' });
      store.toast(STATUS[r.status] ?? r.status);
      captures.reload();
      await store.refresh();
    } catch (e) {
      store.toast((e as Error).message);
    }
  };

  const dayAgo = new Date(Date.now() - 86400_000).toISOString();
  const todayCaptures = captures.data?.items.filter((c) => c.received_at >= dayAgo) ?? [];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <TopBar backTo="/altro" />
      <div className="stack" style={{ gap: 4 }}>
        <h1 className="page-title">Cattura automatica</h1>
        <p className="lead">Ultime 24 ore: {todayCaptures.length} notifiche, {todayCaptures.filter((c) => c.status === 'created').length} salvate da sole, {todayCaptures.filter((c) => c.status === 'review').length} da rivedere.</p>
      </div>
      <ErrorBox error={error ?? devices.error} />

      <section className="card">
        <h2 className="h2">Collega un telefono</h2>
        {!connect ? (
          <div className="stack" style={{ gap: 10 }}>
            <SetupButton icon="phone" dark title="iPhone: comando e automazione" text="Il comando legge la notifica della banca e la manda a Ledgy, come fa oggi con Wallet." onClick={() => setConnect({ platform: 'ios' })} />
            <SetupButton icon="download" title="Android: MacroDroid" text="MacroDroid inoltra a Ledgy le notifiche delle app di banca che scegli." onClick={() => setConnect({ platform: 'android' })} />
          </div>
        ) : !connect.url ? (
          <div className="stack" style={{ gap: 10 }}>
            <label className="field"><span>Nome del telefono</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={connect.platform === 'ios' ? 'Es. iPhone 16 Pro' : 'Es. Galaxy S25'} /></label>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary grow" onClick={create}>Crea l'indirizzo privato</button>
              <button className="btn" onClick={() => setConnect(null)}>Annulla</button>
            </div>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            <span className="muted" style={{ fontSize: 13 }}>Indirizzo privato di questo telefono. Chi lo conosce può aggiungere spese: non condividerlo.</span>
            <div className="raw">{connect.url}</div>
            <button className="btn" onClick={() => copy(connect.url!)}><Icon name="copy" size={18} />Copia l'indirizzo</button>
            {connect.platform === 'ios' ? <IosSteps url={connect.url} hasShortcut={hasShortcut} /> : <AndroidSteps url={connect.url} />}
            <button className="btn" onClick={() => { setConnect(null); setName(''); }}>Fatto</button>
          </div>
        )}
      </section>

      {hasShortcut && (
        <section className="card">
          <div className="row between"><h2 className="h2">Comando iPhone</h2><span className="chip">versione {SHORTCUT_VERSION}</span></div>
          <span className="muted" style={{ fontSize: 14 }}>Manda subito la spesa a Ledgy; chiede la categoria ad Apple Intelligence solo se Ledgy non la trova. Nessuna notifica.</span>
          <a className="btn primary" href="/ledgy.shortcut" download="Ledgy.shortcut"><Icon name="download" size={18} />Scarica il comando</a>
          <details>
            <summary className="muted" style={{ fontSize: 14, cursor: 'pointer' }}>Come aggiornarlo o reinstallarlo</summary>
            <ol style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 6, fontSize: 14 }}>
              <li>Ti serve l’indirizzo privato del telefono. Se hai ancora il comando vecchio: Comandi → tieni premuto Ledgy → Modifica → copia il testo del primo riquadro (inizia con https://). Se l’hai perso: tocca <b>Nuovo indirizzo</b> accanto al telefono qui sotto.</li>
              <li>Scarica il comando, aprilo dai download di Safari, scegli <b>Sostituisci</b> e incolla l’indirizzo quando lo chiede.</li>
              <li>Le automazioni restano: usano il comando con lo stesso nome. Controlla solo che “Notifica all’esecuzione” sia spenta.</li>
            </ol>
          </details>
        </section>
      )}

      <section className="card">
        <h2 className="h2">Dispositivi</h2>
        {!devices.data ? <Loading /> : !devices.data.items.length ? <p className="muted" style={{ margin: 0 }}>Nessun telefono collegato.</p> : devices.data.items.map((d) => {
          const stale = !d.last_seen_at || Date.now() - Date.parse(d.last_seen_at) > 26 * 3600_000;
          return (
            <div key={d.id} className="row" style={stale ? { background: 'var(--warn-soft)', borderRadius: 14, padding: 10, margin: '0 -4px' } : undefined}>
              <span className={`dot ${stale ? 'warn' : ''}`} />
              <div className="grow stack" style={{ gap: 2, fontSize: 14 }}>
                <b>{d.name}</b>
                <span className="muted">{d.method === 'shortcut' ? `Comandi${d.client_version ? ` v${d.client_version}` : ''}` : 'MacroDroid'} · segnale {relativeTime(d.last_seen_at)} · ultima spesa {relativeTime(d.last_capture_at)}</span>
                {stale && <span style={{ color: 'var(--warn)' }}>Nessun segnale da oltre un giorno: controlla il risparmio batteria.</span>}
                {d.method === 'shortcut' && d.client_version && Number(d.client_version) < SHORTCUT_VERSION && hasShortcut && (
                  <span style={{ color: 'var(--warn)' }}>C’è la versione {SHORTCUT_VERSION} del comando: <a href="/ledgy.shortcut" download="Ledgy.shortcut">riscaricalo</a>.</span>
                )}
                {renew === d.id && <span style={{ color: 'var(--warn)' }}>Il vecchio indirizzo smetterà di funzionare: tocca di nuovo per confermare.</span>}
              </div>
              <div className="stack" style={{ gap: 6 }}>
                <button className="btn small" onClick={() => newAddress(d)}>{renew === d.id ? 'Conferma' : 'Nuovo indirizzo'}</button>
                <button className="btn small" onClick={() => revoke(d)}>Scollega</button>
              </div>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2 className="h2">Ultime notifiche ricevute</h2>
        {!captures.data ? <Loading /> : !captures.data.items.length ? <p className="muted" style={{ margin: 0 }}>Ancora nessuna notifica.</p> : captures.data.items.slice(0, 12).map((c) => (
          <div key={c.id} className="stack" style={{ gap: 4, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
            <div className="row between" style={{ fontSize: 13 }}>
              <span className={`chip ${c.status === 'created' ? 'ok' : c.status === 'unrecognized' || c.status === 'review' ? 'warn' : ''}`}>{STATUS[c.status] ?? c.status}</span>
              <span className="muted">{c.app ?? 'app sconosciuta'} · {relativeTime(c.received_at)}</span>
            </div>
            <div className="raw" style={{ fontSize: 11 }}>{[c.title, c.text].filter(Boolean).join(' · ')}</div>
            <div className="row" style={{ gap: 8 }}>
              {c.detail && <span className="muted grow" style={{ fontSize: 12 }}>{c.detail}</span>}
              <button className="btn small" aria-label={`Carta della notifica: ${c.card ?? 'nessuna'}`} onClick={() => setCardFor(c)} style={{ color: c.card ? 'var(--accent)' : undefined }}>
                <Icon name="card" size={16} />{c.card ? c.card : 'Scegli la carta'}
              </button>
              {c.transaction_id ? <a className="btn small" href={`#/m/${c.transaction_id}`}>Apri</a> : c.status === 'unrecognized' && <button className="btn small" onClick={() => retry(c)}>Riprova</button>}
            </div>
          </div>
        ))}
      </section>

      {cardFor && (
        <CardSheet value={cardFor.card ?? null} onClose={() => setCardFor(null)}
          onPick={async (card) => {
            const r = await api<{ applied: number }>(`/capture/captures/${cardFor.id}/card`, { method: 'POST', json: { card } });
            setCardFor(null);
            captures.reload();
            await store.refresh();
            store.toast(card ? `${card}: ${r.applied} ${r.applied === 1 ? 'spesa' : 'spese'}, e d'ora in poi le prossime` : 'Carta tolta');
          }}
          extra={<button className="btn ghost" style={{ alignSelf: 'center' }} onClick={() => {
            const c = cardFor;
            setCardFor(null);
            setDraft({ app: (c.title ?? c.app ?? '').replace(/^[^\p{L}\d]+/u, '').trim(), sample: c.text, pattern: suggestPattern(c.text) ?? '', key: Date.now() });
          }}>Formato strano? Crea un lettore per questa notifica</button>} />
      )}

      <Parsers list={parsers.data?.items ?? null} reload={() => { parsers.reload(); captures.reload(); }} draft={draft} />
    </div>
  );
}

function SetupButton({ icon, title, text, onClick, dark }: { icon: string; title: string; text: string; onClick: () => void; dark?: boolean }) {
  return (
    <button onClick={onClick} className="row" style={{ background: 'var(--sunken)', borderRadius: 16, padding: 12, border: 0, textAlign: 'left', cursor: 'pointer', width: '100%' }}>
      <span className="ic" style={{ background: dark ? 'var(--ink)' : 'var(--accent)', color: dark ? 'var(--bg)' : 'var(--accent-ink)' }}><Icon name={icon} size={20} /></span>
      <span className="grow stack" style={{ gap: 2 }}><b>{title}</b><span className="muted" style={{ fontSize: 13 }}>{text}</span></span>
    </button>
  );
}

function IosSteps({ url, hasShortcut }: { url: string; hasShortcut: boolean }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, fontSize: 14 }}>
      <li>{hasShortcut ? <><a href="/ledgy.shortcut" download="Ledgy.shortcut">Scarica il comando Ledgy</a>, poi aprilo dai download di Safari: si apre Comandi. Quando chiede l'indirizzo, incolla quello copiato.</> : <>Il comando Ledgy firmato non è ancora caricato sul server. Nel frattempo puoi usare il tuo comando attuale sostituendo l'ultima azione (quella di Wallet) con “Ottieni contenuto URL”: metodo POST, corpo JSON con il campo <code>text</code> (il testo della notifica), indirizzo <code>{url.slice(0, 40)}…</code></>}</li>
      <li>Apri Comandi → Automazione → + → <b>Notifica</b>. Scegli l'app della banca (Revolut, Wise, Jago…), scegli <b>Esegui subito</b>, spegni <b>Notifica all'esecuzione</b> e come azione <b>Esegui comando: Ledgy</b>. Ripeti per ogni app.</li>
      <li>Per il segnale giornaliero: Automazione → + → <b>Ora del giorno</b> 09:00 → Esegui subito, senza notifica all'esecuzione → <b>Esegui comando: Ledgy</b>. Senza notifica il comando manda solo il segnale.</li>
    </ol>
  );
}

function AndroidSteps({ url }: { url: string }) {
  return (
    <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 8, fontSize: 14 }}>
      <li>Installa <b>MacroDroid</b> dal Play Store e concedigli l'accesso alle notifiche.</li>
      <li>Nuova macro “Ledgy spese”. Trigger: <b>Notifica → Notifica ricevuta</b>, seleziona le app di banca, contenuto qualsiasi.</li>
      <li>Azione: <b>Web → Richiesta HTTP</b>. Metodo POST, URL: l'indirizzo copiato. Corpo come <b>parametri di modulo</b> (form): <code>app</code> = nome pacchetto app, <code>title</code> = titolo notifica, <code>text</code> = testo notifica (inseriscili con il pulsante “…” del testo magico). Attiva “Blocca azioni successive fino al completamento”.</li>
      <li>Seconda macro “Ledgy segnale”: trigger <b>Giorno/ora</b> ogni giorno alle 09:00, azione Richiesta HTTP POST a <code>{url.slice(0, 30)}…/ping</code>.</li>
      <li>Batteria: togli MacroDroid dall'ottimizzazione batteria. Xiaomi: Avvio automatico attivo e “Nessuna restrizione”. Samsung: aggiungilo alle “App mai in sospensione”. Bloccalo nelle app recenti.</li>
    </ol>
  );
}

interface Draft { app: string; sample: string; pattern: string; key: number }

function Parsers({ list, reload, draft }: { list: Parser[] | null; reload: () => void; draft: Draft | null }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', app: '', pattern: '', default_currency: '', sample: '' });
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // "Crea lettore" da una notifica: modulo già compilato, si scrive solo il nome della carta.
  useEffect(() => {
    if (!draft) return;
    setForm({ name: '', app: draft.app, pattern: draft.pattern, default_currency: '', sample: draft.sample });
    setResult(draft.pattern ? null : 'Ledgy non riesce a proporre un modello per questa notifica: scrivilo a mano.');
    setError(null);
    setOpen(true);
    setTimeout(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); nameRef.current?.focus(); }, 50);
  }, [draft]);
  const rename = async (p: Parser) => {
    const name = names[p.id]?.trim();
    if (!name || name === p.name) return;
    await api(`/capture/parsers/${p.id}`, { method: 'PUT', json: { name } });
    store.toast(`Ora la carta si chiama ${name}`);
    reload();
    await store.refresh();
  };

  const test = async () => {
    setError(null);
    try {
      const r = await api<{ parsed: { amount: number; currency: string; merchant: string | null } | null }>('/capture/parsers/test', { method: 'POST', json: { ...form, text: form.sample } });
      setResult(r.parsed ? `Importo ${r.parsed.amount} ${r.parsed.currency} · negozio “${r.parsed.merchant ?? '—'}”${form.name ? ` · carta ${form.name}` : ''}` : 'Il modello non trova nulla in questo testo.');
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const save = async () => {
    setError(null);
    try {
      const r = await api<{ applied: number }>('/capture/parsers', { method: 'POST', json: { ...form, default_currency: form.default_currency || null } });
      store.toast(r.applied ? `Lettore salvato: ${r.applied} ${r.applied === 1 ? 'spesa già arrivata ora porta' : 'spese già arrivate ora portano'} ${form.name}` : 'Lettore salvato');
      await store.refresh();
      setOpen(false);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const remove = async (p: Parser) => {
    await api(`/capture/parsers/${p.id}`, { method: 'DELETE' });
    reload();
  };

  return (
    <section className="card">
      <div className="row between"><h2 className="h2">Lettori per banca</h2>{!open && <button className="btn small" onClick={() => setOpen(true)}>Nuovo</button>}</div>
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Senza lettore Ledgy usa una lettura generica, che riconosce la maggior parte delle notifiche. Un lettore serve per le banche con un formato insolito, e il suo nome compare come carta su ogni spesa che legge.</p>
      {list?.map((p) => (
        <div key={p.id} className="row" style={{ gap: 6 }}>
          <input className="input grow" aria-label={`Nome della carta per ${p.app}`} value={names[p.id] ?? p.name} onChange={(e) => setNames({ ...names, [p.id]: e.target.value })} />
          {names[p.id] !== undefined && names[p.id].trim() && names[p.id].trim() !== p.name
            ? <button className="btn small primary" onClick={() => rename(p)}>Rinomina</button>
            : <span className="muted" style={{ fontSize: 13, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.app}</span>}
          <button className="btn small" onClick={() => remove(p)}>Elimina</button>
        </div>
      ))}
      {open && (
        <div className="stack" style={{ gap: 8 }} ref={formRef}>
          <label className="field"><span>Nome della carta o banca</span><input ref={nameRef} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Es. Xplace, Jago" /></label>
          <label className="field"><span>Titolo della notifica (iPhone) o app (Android)</span><input className="input" value={form.app} onChange={(e) => setForm({ ...form, app: e.target.value })} placeholder="com.jago.digitalBanking" /></label>
          <label className="field"><span>Notifica di esempio</span><textarea className="input" value={form.sample} onChange={(e) => setForm({ ...form, sample: e.target.value })} /></label>
          <label className="field"><span>Modello (regex con i gruppi amount, currency, merchant)</span><input className="input mono" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} placeholder="Pembayaran (?<amount>[\d.]+) ke (?<merchant>.+?) berhasil" /></label>
          <label className="field"><span>Valuta se non indicata (facoltativa)</span><input className="input" value={form.default_currency} placeholder="Es. IDR" onChange={(e) => setForm({ ...form, default_currency: e.target.value.toUpperCase() })} /></label>
          {result && <div className="raw">{result}</div>}
          <ErrorBox error={error} />
          <div className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={test} disabled={!form.pattern || !form.sample}>Prova</button>
            <button className="btn primary grow" onClick={save} disabled={!form.name || !form.app || !form.pattern}>Salva lettore</button>
            <button className="btn" onClick={() => setOpen(false)}>Annulla</button>
          </div>
        </div>
      )}
    </section>
  );
}
