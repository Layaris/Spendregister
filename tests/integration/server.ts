// Avvia il vero Worker (wrangler dev) con un database D1 locale nuovo per ogni esecuzione dei test.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

const PORT = 8799;
// Vecchia password della versione a utente singolo: serve al test che collega i dati esistenti.
export const LEGACY_PASSWORD = 'vecchia-password-123';
export const LEGACY_TOKEN = 'token-del-vecchio-iphone';

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
  // Dati della versione a utente singolo (account "owner" non ancora collegato): un telefono e un movimento.
  const hash = createHash('sha256').update(LEGACY_TOKEN).digest('hex');
  run(['execute', 'ledgy', '--command',
    "INSERT INTO accounts (id, user_id, name, type, currency, initial_balance, position, created_at) VALUES ('acc_cash', 'owner', 'Contanti', 'cash', 'EUR', 0, 0, '2026-11-01T00:00:00Z');"
    + ` INSERT INTO devices (id, user_id, name, platform, method, token_hash, token_hint, created_at) VALUES ('dev_vecchio', 'owner', 'iPhone vecchio', 'ios', 'shortcut', '${hash}', 'hone', '2026-11-01T00:00:00Z');`
    + " INSERT INTO transactions (id, user_id, type, account_id, amount, currency, amount_eur, occurred_at, occurred_utc, merchant, source, status, created_at, updated_at)"
    + " VALUES ('tx_vecchio', 'owner', 'expense', 'acc_cash', -5000, 'EUR', -5000, '2026-11-02T10:00:00+08:00', '2026-11-02T02:00:00.000Z', 'Caffè vecchio', 'manual', 'confirmed', '2026-11-02T02:00:00Z', '2026-11-02T02:00:00Z');"]);
  // File vuoto: evita che wrangler legga il .dev.vars dello sviluppatore.
  writeFileSync(join(dir, 'none.env'), '');
  proc = spawn('npx', [
    'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--env-file', join(dir, 'none.env'),
    '--var', `APP_PASSWORD:${LEGACY_PASSWORD}`, '--var', 'FX_FIXED:IDR:0.00005,SGD:0.7,USD:0.9',
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
