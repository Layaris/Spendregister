// Avvia il vero Worker (wrangler dev) con un database D1 locale nuovo per ogni esecuzione dei test.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';

const PORT = 8799;
export const TEST_PASSWORD = 'password-di-prova-123';

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
  execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', 'ledgy', '--local', '--persist-to', dir], { stdio: 'ignore', env: { ...process.env, CI: '1' } });
  // File vuoto: evita che wrangler legga il .dev.vars dello sviluppatore.
  writeFileSync(join(dir, 'none.env'), '');
  proc = spawn('npx', [
    'wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', dir, '--env-file', join(dir, 'none.env'),
    '--var', `APP_PASSWORD:${TEST_PASSWORD}`, '--var', 'FX_FIXED:IDR:0.00005,SGD:0.7,USD:0.9',
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
