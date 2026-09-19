import { Pool, type PoolConfig } from 'pg';
import { toPostgresDdl, toPostgresSql } from '@/lib/sql/dialect';
import {
  normalizeParams,
  type Row,
  type RunResult,
  type SqlDriver,
  type SqlValue,
} from '@/lib/sql/driver';

/**
 * The cloud backend: managed Postgres, reached through a pool.
 *
 * Every statement arrives in SQLite dialect and is translated on the way out
 * (see `lib/sql/dialect.ts`). The repository layer never knows which backend
 * it is talking to, which is the whole point — the workstation and the
 * always-on instance run identical code against one system of record.
 */
export type PostgresOptions = {
  /** Primary keys per table, for translating `INSERT OR REPLACE`. */
  primaryKeys: Map<string, string[]>;
  /** Pool tuning; the defaults are fine for a single-operator instance. */
  pool?: Omit<PoolConfig, 'connectionString'>;
};

/**
 * Managed providers (Railway included) terminate TLS with a certificate that
 * is not in the public trust store, so a `sslmode=require` URL has to be taken
 * at its word. Connections over Railway's private network carry no sslmode and
 * stay plaintext inside the project, which is the recommended setup.
 */
function sslFor(url: string): PoolConfig['ssl'] {
  return /sslmode=(require|prefer)/i.test(url) ? { rejectUnauthorized: false } : undefined;
}

export function openPostgres(url: string, options: PostgresOptions): SqlDriver {
  const pool = new Pool({
    connectionString: url,
    ssl: sslFor(url),
    max: 10,
    idleTimeoutMillis: 30_000,
    ...options.pool,
  });

  const translate = (sql: string) => toPostgresSql(sql, options.primaryKeys);

  return {
    dialect: 'postgres',

    async all<T = Row>(sql: string, params: SqlValue[] = []): Promise<T[]> {
      const result = await pool.query(translate(sql), normalizeParams(params));
      return result.rows as T[];
    },

    async get<T = Row>(sql: string, params: SqlValue[] = []): Promise<T | null> {
      const result = await pool.query(translate(sql), normalizeParams(params));
      return (result.rows[0] as T | undefined) ?? null;
    },

    async run(sql: string, params: SqlValue[] = []): Promise<RunResult> {
      const result = await pool.query(translate(sql), normalizeParams(params));
      return { changes: result.rowCount ?? 0 };
    },

    async exec(script: string): Promise<void> {
      // Multi-statement scripts go through the simple query protocol, which
      // only works when nothing is parameterized — true of the schema and of
      // every migration here.
      await pool.query(toPostgresDdl(script));
    },

    async columns(table: string): Promise<Set<string>> {
      const result = await pool.query<{ column_name: string }>(
        'SELECT column_name FROM information_schema.columns WHERE table_name = $1',
        [table],
      );
      return new Set(result.rows.map((r) => r.column_name));
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
