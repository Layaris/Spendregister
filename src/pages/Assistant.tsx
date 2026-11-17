// Assistente AI: domande sulle spese, spese scritte o dettate, scontrini e screenshot.
// Le risposte usano i dati veri calcolati dal server; i movimenti trovati si confermano prima di salvarli.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Icon } from '../icons';
import { useStore } from '../store';
import { CategorySelect } from '../ui';
import { formatDayShort, formatMoney, localDay } from '../util';

interface Draft { type: 'expense' | 'income'; amount: number; currency: string; merchant: string | null; date: string; time: string | null; note: string | null; category_id: string | null }
interface Msg { role: 'user' | 'assistant'; text?: string; image?: boolean; drafts?: Draft[]; saved?: number; error?: string }

const IDEAS = ['Quanto ho speso questo mese?', 'Dove posso risparmiare?', 'Ristoranti: più o meno del mese scorso?', 'Quali abbonamenti pago?'];

/** Riduce la foto (lato lungo 1600 px, JPEG) prima di mandarla: più veloce e meno costosa. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Recognition = { lang: string; interimResults: boolean; onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void };
const SpeechCtor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

export function Assistant() {
  const store = useStore();
  const [msgs, setMsgs] = useState<Msg[]>(() => { try { return JSON.parse(sessionStorage.getItem('ledgy-chat') ?? '[]') as Msg[]; } catch { return []; } });
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'ask' | 'parse'>('ask');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<Recognition | null>(null);

  useEffect(() => {
    try { sessionStorage.setItem('ledgy-chat', JSON.stringify(msgs.slice(-30))); } catch { /* ignora */ }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [msgs]);

  const send = async (payload: { mode: 'ask' | 'parse' | 'image'; text?: string; image?: string }, shown: Msg) => {
    setMsgs((m) => [...m, shown]);
    setBusy(true);
    try {
      const history = msgs.filter((m) => m.text && !m.error).slice(-6).map((m) => ({ role: m.role, text: m.text! }));
      const r = await api<{ answer?: string; drafts?: Draft[] }>('/assistant', { method: 'POST', json: { ...payload, history, today: localDay() } });
      setMsgs((m) => [...m, r.drafts ? { role: 'assistant', drafts: r.drafts, text: r.drafts.length ? undefined : 'Non ho trovato movimenti. Prova a scriverla in modo diverso.' } : { role: 'assistant', text: r.answer }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', error: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText('');
    send({ mode, text: t }, { role: 'user', text: t });
  };

  const photo = async (file: File | undefined) => {
    if (!file) return;
    const image = await shrink(file);
    send({ mode: 'image', image }, { role: 'user', text: 'Scontrino o screenshot', image: true });
  };

  const dictate = () => {
    const Ctor = SpeechCtor();
    if (!Ctor) { store.toast('Usa il microfono della tastiera per dettare'); return; }
    if (listening) { recRef.current?.stop(); return; }
    const r = new Ctor();
    r.lang = 'it-IT';
    r.interimResults = false;
    r.onresult = (e) => { const said = Array.from(e.results).map((x) => x[0].transcript).join(' '); setText((t) => `${t} ${said}`.trim()); setMode('parse'); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r;
    setListening(true);
    r.start();
  };

  const updateDraft = (mi: number, di: number, patch: Partial<Draft> | null) => setMsgs((all) => all.map((m, i) => (i !== mi ? m : {
    ...m, drafts: patch ? m.drafts!.map((d, j) => (j === di ? { ...d, ...patch } : d)) : m.drafts!.filter((_, j) => j !== di),
  })));

  const save = async (mi: number) => {
    const drafts = msgs[mi].drafts ?? [];
    try {
      for (const d of drafts) {
        await api('/transactions', { method: 'POST', json: { type: d.type, amount: d.amount, currency: d.currency, merchant: d.merchant, note: d.note, category_id: d.category_id, occurred_at: `${d.date} ${d.time ?? '12:00'}:00` } });
      }
      setMsgs((all) => all.map((m, i) => (i === mi ? { ...m, saved: drafts.length } : m)));
      store.toast(drafts.length === 1 ? 'Movimento salvato' : `${drafts.length} movimenti salvati`);
      await store.refresh();
    } catch (e) {
      store.toast((e as Error).message);
    }
  };

  return (
    <div className="stack chat-page" style={{ gap: 12 }}>
      <h1 className="page-title">Assistente</h1>
      {!msgs.length && (
        <section className="card">
          <p style={{ margin: 0 }}>Chiedimi delle tue spese, scrivi o detta una spesa (“taxi 50k ieri”), oppure manda la foto di uno scontrino o lo screenshot della tua banca.</p>
          <div className="row wrap" style={{ gap: 6 }}>
            {IDEAS.map((q) => <button key={q} className="btn small" onClick={() => { setMode('ask'); send({ mode: 'ask', text: q }, { role: 'user', text: q }); }}>{q}</button>)}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Usa le tue chiavi di Gemini o NanoGPT (Altro › Intelligenza artificiale). Le foto non si salvano.</span>
        </section>
      )}
      {msgs.map((m, i) => (
        <div key={i} className={`bubble ${m.role}`}>
          {m.image && <span className="row" style={{ gap: 6 }}><Icon name="camera" size={16} />{m.text}</span>}
          {!m.image && m.text && <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>}
          {m.error && <div style={{ color: 'var(--danger)' }}>{m.error}{/chiav/i.test(m.error) && <> · <a href="#/altro">Imposta le chiavi</a></>}</div>}
          {m.drafts && m.drafts.length > 0 && (
            <div className="stack" style={{ gap: 10 }}>
              {m.drafts.map((d, j) => (
                <div key={j} className="stack draft" style={{ gap: 6 }}>
                  <div className="row between" style={{ gap: 8 }}>
                    <b className="grow" style={{ minWidth: 0 }}>{d.merchant ?? (d.type === 'income' ? 'Entrata' : 'Spesa')}</b>
                    <b className={`num money ${d.type === 'income' ? 'pos' : ''}`}>{d.type === 'income' ? '+' : '−'}{formatMoney(Math.round(d.amount * 1000), d.currency)}</b>
                    {!m.saved && <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label="Togli" onClick={() => updateDraft(i, j, null)}><Icon name="close" size={14} /></button>}
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>{formatDayShort(d.date)}{d.time ? `, ${d.time}` : ''}{d.note ? ` · ${d.note}` : ''}</span>
                  {!m.saved && <CategorySelect value={d.category_id} kind={d.type} onChange={(v) => updateDraft(i, j, { category_id: v })} />}
                </div>
              ))}
              {m.saved ? <span className="chip ok">Salvat{m.saved === 1 ? 'o' : 'i'} ✓</span>
                : <button className="btn primary" onClick={() => save(i)}>Salva {m.drafts.length === 1 ? 'il movimento' : `${m.drafts.length} movimenti`}</button>}
            </div>
          )}
        </div>
      ))}
      {busy && <div className="bubble assistant muted">Sto pensando…</div>}
      <div ref={endRef} />

      <div className="composer">
        <div className="seg" role="group" aria-label="Cosa vuoi fare" style={{ marginBottom: 6 }}>
          <button aria-pressed={mode === 'ask'} onClick={() => setMode('ask')}>Chiedi</button>
          <button aria-pressed={mode === 'parse'} onClick={() => setMode('parse')}>Registra una spesa</button>
        </div>
        <div className="row" style={{ gap: 6, alignItems: 'flex-end' }}>
          <button className="iconbtn" aria-label="Foto di uno scontrino o screenshot" onClick={() => fileRef.current?.click()} disabled={busy}><Icon name="camera" size={20} /></button>
          <button className="iconbtn" aria-label={listening ? 'Ferma la dettatura' : 'Detta'} aria-pressed={listening} onClick={dictate} style={listening ? { background: 'var(--accent)', color: '#fff' } : undefined}><Icon name="mic" size={20} /></button>
          <textarea className="input grow" rows={1} value={text} aria-label={mode === 'ask' ? 'Domanda' : 'Spesa da registrare'}
            placeholder={mode === 'ask' ? 'Chiedi delle tue spese…' : 'Es. taxi 50k ieri'}
            onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
            style={{ resize: 'none', minHeight: 44, maxHeight: 120 }} />
          <button className="btn primary" aria-label="Invia" onClick={submit} disabled={busy || !text.trim()}><Icon name="next" size={18} /></button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { photo(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
    </div>
  );
}
