// Solo per le prove (variabile D1_ROWS): conta le righe lette da D1 in una richiesta e le scrive
// nell'intestazione x-d1-rows, così si misura quanto pesa ogni schermata sul limite giornaliero.
type Counter = { rows: number };

function wrapStmt(s: D1PreparedStatement, n: Counter): D1PreparedStatement {
  const add = <T extends { meta?: { rows_read?: number } }>(r: T) => { n.rows += r.meta?.rows_read ?? 0; return r; };
  const w = {
    __inner: s,
    bind: (...a: unknown[]) => wrapStmt(s.bind(...a), n),
    all: () => s.all().then(add),
    run: () => s.run().then(add),
    raw: (o?: { columnNames?: boolean }) => (s.raw as (o?: unknown) => Promise<unknown>)(o),
    first: (col?: string) => s.all().then(add).then((r) => {
      const row = (r.results[0] ?? null) as Record<string, unknown> | null;
      return col ? (row ? row[col] ?? null : null) : row;
    }),
  };
  return w as unknown as D1PreparedStatement;
}

export function countingDb(db: D1Database, n: Counter): D1Database {
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStmt(target.prepare(sql), n);
      if (prop === 'batch') {
        return (stmts: D1PreparedStatement[]) => target.batch(stmts.map((s) => (s as unknown as { __inner?: D1PreparedStatement }).__inner ?? s))
          .then((rs) => { for (const r of rs) n.rows += r.meta?.rows_read ?? 0; return rs; });
      }
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
