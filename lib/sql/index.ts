import { openPostgres } from '@/lib/sql/postgres';
import { openSqlite } from '@/lib/sql/sqlite';
import { isPostgresUrl, type SqlDriver } from '@/lib/sql/driver';

export { isPostgresUrl, normalizeParams } from '@/lib/sql/driver';
export type { Row, RunResult, SqlDriver, SqlValue } from '@/lib/sql/driver';
export { parsePrimaryKeys, toPostgresDdl, toPostgresSql, ROWID_TABLES } from '@/lib/sql/dialect';
export type { Dialect } from '@/lib/sql/dialect';

/**
 * Pick a backend from the connection target: a `postgres://` URL gets the
 * pooled Postgres driver, anything else is treated as a SQLite path (including
 * `:memory:`). One call site, so the decision lives in exactly one place.
 */
export function openDriver(target: string, primaryKeys: Map<string, string[]>): SqlDriver {
  return isPostgresUrl(target) ? openPostgres(target, { primaryKeys }) : openSqlite(target);
}
