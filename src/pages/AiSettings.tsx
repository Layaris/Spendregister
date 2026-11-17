// Altro › Intelligenza artificiale: chiavi Gemini (gratis) e NanoGPT (a pagamento, di riserva), modelli e prova.
// Le chiavi vanno solo al server di Ledgy: l'app non le rilegge mai (mostra le ultime 4 lettere).
import { useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useApi, useStore } from '../store';
import { ErrorBox } from '../ui';
import { relativeTime } from '../util';

interface Ai {
  enabled: boolean; gemini: string | null; nanogpt: string | null; gemini_model: string; nanogpt_model: string;
  gemini_models: string[]; nanogpt_models: string[]; gemini_paused_until: string | null;
  last_provider: string | null; last_error: string | null; last_used_at: string | null;
}

export function AiSettings() {
  const store = useStore();
  const { data: s, reload } = useApi<Ai>('/ai');
  const [keys, setKeys] = useState({ gemini: '', nanogpt: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const put = async (patch: Record<string, unknown>, msg: string) => {
    setError(null);
    try {
      await api('/ai', { method: 'PUT', json: patch });
      reload();
      store.toast(msg);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ provider: string }>('/ai/test', { method: 'POST' });
      store.toast(`Funziona: ha risposto ${r.provider === 'gemini' ? 'Gemini' : 'NanoGPT'}`);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (!s) return null;
  const keyRow = (which: 'gemini' | 'nanogpt', label: string, link: string, note: string) => (
    <div className="stack" style={{ gap: 6, padding: '12px 16px' }}>
      <div className="row between">
        <b>{label}</b>
        {s[which] ? <span className="chip ok">Chiave {s[which]}</span> : <span className="chip">Nessuna chiave</span>}
      </div>
      <span className="muted" style={{ fontSize: 13 }}>{note} <a href={link} target="_blank" rel="noreferrer">Prendi la chiave</a></span>
      <div className="row" style={{ gap: 6 }}>
        <input className="input grow" type="password" autoComplete="off" placeholder={s[which] ? 'Nuova chiave (per cambiarla)' : 'Incolla la chiave'} value={keys[which]}
          onChange={(e) => setKeys({ ...keys, [which]: e.target.value })} />
        <button className="btn primary" disabled={!keys[which].trim()} onClick={async () => { await put({ [`${which}_key`]: keys[which] }, 'Chiave salvata'); setKeys({ ...keys, [which]: '' }); }}>Salva</button>
        {s[which] && <button className="btn" onClick={() => put({ [`${which}_key`]: '' }, 'Chiave tolta')}>Togli</button>}
      </div>
      <label className="row" style={{ gap: 8, fontSize: 14 }}>
        <span className="muted">Modello</span>
        <select className="input grow" style={{ minHeight: 38, padding: '4px 8px', fontSize: 14 }} value={which === 'gemini' ? s.gemini_model : s.nanogpt_model}
          onChange={(e) => put({ [`${which}_model`]: e.target.value }, 'Modello salvato')}>
          {(which === 'gemini' ? s.gemini_models : s.nanogpt_models).map((m) => <option key={m}>{m}</option>)}
        </select>
      </label>
    </div>
  );
  return (
    <section className="stack" style={{ gap: 8 }}>
      <span className="section-title">Intelligenza artificiale</span>
      <div className="list">
        <div className="lrow" style={{ cursor: 'default' }}>
          <span className="lrow-ic" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}><Icon name="sparkle" size={18} /></span>
          <span className="grow stack" style={{ gap: 0 }}>
            <span style={{ fontWeight: 600 }}>Categoria con l’AI</span>
            <span className="muted" style={{ fontSize: 13 }}>Quando Ledgy non riconosce un negozio, l’AI lo cerca sul web e sceglie la categoria.</span>
          </span>
          <button role="switch" aria-checked={s.enabled} aria-label="Categoria con l'AI" onClick={() => put({ enabled: !s.enabled }, s.enabled ? 'AI spenta' : 'AI accesa')}
            style={{ width: 51, height: 31, borderRadius: 16, border: 0, position: 'relative', flexShrink: 0, cursor: 'pointer', background: s.enabled ? 'var(--accent)' : 'var(--line)' }}>
            <span style={{ position: 'absolute', top: 2, left: s.enabled ? 22 : 2, width: 27, height: 27, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
          </button>
        </div>
        {keyRow('gemini', '1. Gemini (gratis)', 'https://aistudio.google.com/apikey', 'Si usa per primo, finché bastano le richieste gratuite del giorno.')}
        {keyRow('nanogpt', '2. NanoGPT (di riserva, a pagamento)', 'https://nano-gpt.com/api', 'Si usa quando Gemini ha finito le richieste gratuite o non risponde. Pochi centesimi al mese.')}
        <div className="stack" style={{ gap: 6, padding: '12px 16px' }}>
          <span className="muted" style={{ fontSize: 13 }}>
            {s.gemini_paused_until ? `Gemini ha finito le richieste gratuite: riprova da solo ${new Date(s.gemini_paused_until).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}. Nel frattempo usa NanoGPT. ` : ''}
            {s.last_used_at ? `Ultimo uso ${relativeTime(s.last_used_at)} con ${s.last_provider === 'gemini' ? 'Gemini' : 'NanoGPT'}.` : 'Non ancora usata.'}
            {s.last_error ? ` Ultimo errore: ${s.last_error}.` : ''}
          </span>
          <ErrorBox error={error} />
          <button className="btn" disabled={busy || (!s.gemini && !s.nanogpt)} onClick={test}>{busy ? 'Prova in corso…' : 'Prova le chiavi'}</button>
        </div>
      </div>
      <span className="muted" style={{ fontSize: 13, padding: '0 6px' }}>Le chiavi restano nel tuo account sul server di Ledgy: valgono su tutti i dispositivi in cui entri e sono nel backup, così passano anche a un account nuovo. L’app non le mostra mai per intero: tieni il file di backup al sicuro.</span>
    </section>
  );
}
