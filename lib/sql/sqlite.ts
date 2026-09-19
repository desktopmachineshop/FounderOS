import Database from 'better-sqlite3';
import {
  normalizeParams,
  type Row,
  type RunResult,
  type SqlDriver,
  type SqlValue,
} from '@/lib/sql/driver';

/**
 * The workstation backend: better-sqlite3, wrapped to satisfy the async driver
 * contract. Every call is synchronous underneath and resolves immediately —
 * the Promises exist so one repository layer can serve both backends, not
 * because anything here awaits I/O.
 */
export function openSqlite(path: string): SqlDriver {
  const db = new Database(path);
  if (path !== ':memory:') db.pragma('journal_mode = WAL');

  // Statements are reused across calls; preparing is the expensive part and
  // the repository layer sends the same few dozen strings over and over.
  const cache = new Map<string, Database.Statement>();
  const prepare = (sql: string): Database.Statement => {
    let stmt = cache.get(sql);
    if (!stmt) {
      stmt = db.prepare(sql);
      cache.set(sql, stmt);
    }
    return stmt;
  };

  return {
    dialect: 'sqlite',

    async all<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      return prepare(sql).all(...normalizeParams(params)) as T[];
    },

    async get<T = Row>(sql: string, params: SqlValue[] = []): Promise<T | null> {
      return (prepare(sql).get(...normalizeParams(params)) as T | undefined) ?? null;
    },

    async run(sql: string, params: SqlValue[] = []): Promise<RunResult> {
      const info = prepare(sql).run(...normalizeParams(params));
      return { changes: info.changes };
    },

    async exec(script: string): Promise<void> {
      db.exec(script);
      // DDL can invalidate cached statements (an ALTER changes the columns a
      // `SELECT *` returns), so drop the cache rather than serve a stale plan.
      cache.clear();
    },

    async columns(table: string): Promise<Set<string>> {
      const rows = db.pragma(`table_info(${table})`) as { name: string }[];
      return new Set(rows.map((c) => c.name));
    },

    async close(): Promise<void> {
      cache.clear();
      db.close();
    },
  };
}
