import type { Dialect } from '@/lib/sql/dialect';

/** A value that can cross the parameter boundary in either dialect. */
export type SqlValue = string | number | boolean | null | undefined;

export type Row = Record<string, unknown>;

export type RunResult = { changes: number };

/**
 * The whole surface the repository layer is allowed to use. Async because
 * Postgres is; the SQLite driver resolves immediately.
 *
 * Note there is no `transaction()`: nothing in the repository layer needs one
 * today (every write is a single idempotent upsert), and adding one that only
 * works on one backend would be worse than not having it.
 */
export interface SqlDriver {
  readonly dialect: Dialect;
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | null>;
  run(sql: string, params?: SqlValue[]): Promise<RunResult>;
  /** Run a multi-statement script (the schema, or a migration). */
  exec(script: string): Promise<void>;
  /** Column names of an existing table; empty when the table is absent. */
  columns(table: string): Promise<Set<string>>;
  close(): Promise<void>;
}

/**
 * Both backends store booleans as 0/1 integers (the schema says INTEGER, and
 * the repository layer reads them back through `Boolean(...)`), and neither
 * driver accepts `undefined` as a bound parameter.
 */
export function normalizeParams(params: SqlValue[] = []): (string | number | null)[] {
  return params.map((p) => {
    if (p === undefined) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    return p;
  });
}

/** True when a connection target names a Postgres server rather than a file. */
export function isPostgresUrl(target: string): boolean {
  return /^postgres(ql)?:\/\//i.test(target);
}
