// Avvia il vero Worker (wrangler dev) con un database D1 locale nuovo per ogni esecuzione dei test.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

const PORT = 8799;
// Ospiti e account creati "a gennaio", per provare la pulizia notturna (tests/integration/api.test.ts).
export const OLD = {
  emptyGuestSession: 'sessione-ospite-vuoto',
  fullGuestSession: 'sessione-ospite-con-dati',
  abandonedGuestPhone: 'telefono-ospite-senza-sessione',
  registeredPhone: 'telefono-account-registrato',
};

let proc: ChildProcess | null = null;
let dir = '';

export default async function setup(project: TestProject) {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/health`);
    throw new Error(`La porta ${PORT} è già occupata: chiudi il wrangler dev rimasto aperto`);
  } catch (e) {
    if ((e as Error).message.includes('occupata')) throw e;
  }
  dir = mkdtempSync(join(tmpdir(), 'ledgy-test-'));
  if (!existsSync('dist/index.html')) {
    mkdirSync('dist', { recursive: true });
    writeFileSync('dist/index.html', '<!doctype html><title>Ledgy</title>');
  }
  const run = (args: string[]) => execFileSync('npx', ['wrangler', 'd1', ...args, '--local', '--persist-to', dir], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
  run(['migrations', 'apply', 'ledgy']);
  // Utenti vecchi: ospite vuoto con sessione, ospite con dati e sessione, ospite senza sessione, account registrato.
  const h = (t: string) => createHash('sha256').update(t).digest('hex');
  const jan = '2026-01-01T00:00:00.000Z';
  const user = (id: string, email: string | null) => `INSERT INTO users (id, email, password_hash, created_at) VALUES ('${id}', ${email ? `'${email}'` : 'NULL'}, NULL, '${jan}');`;
  const session = (token: string, userId: string) => `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('${h(token)}', '${userId}', '${jan}', '2099-01-01T00:00:00.000Z');`;
  const device = (id: string, token: string, userId: string) => `INSERT INTO devices (id, user_id, name, platform, method, token_hash, token_hint, created_at) VALUES ('${id}', '${userId}', 'Telefono', 'ios', 'shortcut', '${h(token)}', 'xxxx', '${jan}');`;
  const tx = (id: string, userId: string) => `INSERT INTO transactions (id, user_id, type, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, source, status, created_at, updated_at) VALUES ('${id}', '${userId}', 'expense', -5000, 'EUR', -5000, '2026-01-02T10:00:00+08:00', '2026-01-02T02:00:00.000Z', 'Vecchia spesa', 'manual', 'confirmed', '${jan}', '${jan}');`;
  run(['execute', 'ledgy', '--command', [
    user('usr_vuoto', null), session(OLD.emptyGuestSession, 'usr_vuoto'),
    user('usr_con_dati', null), session(OLD.fullGuestSession, 'usr_con_dati'), tx('tx_ospite_vecchio', 'usr_con_dati'),
    user('usr_abbandonato', null), device('dev_abbandonato', OLD.abandonedGuestPhone, 'usr_abbandonato'), tx('tx_abbandonato', 'usr_abbandonato'),
    user('usr_registrato', 'vecchio@example.com'), device('dev_registrato', OLD.registeredPhone, 'usr_registrato'),
  ].join(' ')]);
  // File vuoto: evita che wrangler legga il .dev.vars dello sviluppatore.
  writeFileSync(join(dir, 'none.env'), '');
  proc = spawn('npx', [
    'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--env-file', join(dir, 'none.env'),
    '--test-scheduled', '--var', 'FX_FIXED:IDR:0.00005,SGD:0.7,USD:0.9',
  ], { stdio: 'ignore', env: { ...process.env, CI: '1' }, detached: true });
  const base = `http://127.0.0.1:${PORT}`;
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    try {
      ready = (await fetch(`${base}/api/health`)).ok;
      if (ready) break;
    } catch {
      /* non ancora pronto */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error('Il Worker di test non è partito');
  project.provide('baseUrl', base);
  return () => {
    // wrangler avvia altri processi (workerd): si ferma l'intero gruppo.
    if (proc?.pid) {
      try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* già fermo */ }
    }
    rmSync(dir, { recursive: true, force: true });
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    baseUrl: string;
  }
}
