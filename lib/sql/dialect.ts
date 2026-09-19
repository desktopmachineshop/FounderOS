/**
 * SQLite → Postgres translation.
 *
 * The schema is written once, in SQLite dialect, in `lib/db.ts`. Everything
 * the repository layer sends is valid SQLite; this module is the only place
 * that knows how to say the same thing to Postgres. Keeping the translation
 * here (rather than forking the SQL, or the DDL, per backend) is what lets the
 * workstation run on a local file and the cloud instance run on managed
 * Postgres from one set of queries.
 *
 * Four things actually differ:
 *
 *  - Placeholders. SQLite takes `?`; Postgres wants `$1`, `$2`, …
 *  - Upserts. `INSERT OR REPLACE` has no Postgres equivalent, so it becomes
 *    `ON CONFLICT (<primary key>) DO UPDATE SET …`, with the key columns read
 *    off the DDL rather than hand-listed (a hand-listed map goes stale).
 *  - `rowid`. SQLite gives every table an implicit insertion-order rowid, used
 *    here only as an ORDER BY tiebreaker for rows sharing a timestamp.
 *    Postgres has nothing equivalent, so those tables carry an explicit
 *    `seq BIGSERIAL` and `rowid` is rewritten to `seq`.
 *  - `REAL`. Postgres REAL is 4-byte; these columns hold money and metrics, so
 *    they widen to DOUBLE PRECISION.
 */

export type Dialect = 'sqlite' | 'postgres';

/**
 * Tables whose queries lean on SQLite's implicit rowid for insertion order.
 * Only these get a `seq` column in the Postgres schema. `tests/sql-dialect.test.ts`
 * checks this list against the queries in `lib/db.ts` in both directions, so it
 * cannot silently drift.
 */
export const ROWID_TABLES = [
  'agent_runs',
  'agent_messages',
  'broadcasts',
  'agent_tasks',
  'agent_crons',
  'media_jobs',
] as const;

const unquote = (name: string) => name.trim().replace(/^"(.*)"$/, '$1');

/** Split a CREATE TABLE body on top-level commas, ignoring ones inside parens. */
function splitDefinitions(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * Map every table in a DDL script to its primary-key columns, handling both
 * the inline form (`id TEXT PRIMARY KEY`) and the table-level composite form
 * (`PRIMARY KEY (platform, captured_at)`).
 */
export function parsePrimaryKeys(ddl: string): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const match of ddl.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? (\w+)\s*\(([\s\S]*?)\);/g)) {
    const [, table, body] = match;
    for (const def of splitDefinitions(body)) {
      const composite = def.match(/^PRIMARY\s+KEY\s*\(([^)]*)\)/i);
      if (composite) {
        keys.set(
          table,
          composite[1].split(',').map(unquote),
        );
        break;
      }
      if (/\bPRIMARY\s+KEY\b/i.test(def)) {
        keys.set(table, [unquote(def.split(/\s+/)[0])]);
        break;
      }
    }
  }
  return keys;
}

/**
 * Renumber `?` placeholders as `$1`, `$2`, … A `?` inside a string literal is
 * data, not a placeholder, so quoted runs are skipped.
 */
export function toPositional(sql: string): string {
  let out = '';
  let n = 0;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") {
      inString = !inString;
      out += ch;
    } else if (ch === '?' && !inString) {
      n += 1;
      out += `$${n}`;
    } else {
      out += ch;
    }
  }
  return out;
}

const UPSERT_RE =
  /^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+(\w+)\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)\s*$/i;

/** `INSERT OR REPLACE` → `INSERT … ON CONFLICT (pk) DO UPDATE SET …`. */
function rewriteUpsert(sql: string, primaryKeys: Map<string, string[]>): string {
  const match = sql.match(UPSERT_RE);
  if (!match) return sql;

  const [, table, columnList, valueList] = match;
  const key = primaryKeys.get(table);
  if (!key) {
    throw new Error(
      `no primary key known for table "${table}" — cannot translate INSERT OR REPLACE to Postgres`,
    );
  }

  const columns = columnList.split(',').map((c) => c.trim());
  const values = valueList.split(',').map((v) => v.trim());
  const updatable = columns.filter((c) => !key.includes(unquote(c)));

  const conflict = `ON CONFLICT (${key.join(', ')})`;
  const action = updatable.length
    ? `DO UPDATE SET ${updatable.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`
    : 'DO NOTHING';

  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')}) ${conflict} ${action}`;
}

/** Translate one SQLite statement for Postgres. */
export function toPostgresSql(sql: string, primaryKeys: Map<string, string[]>): string {
  const upserted = rewriteUpsert(sql, primaryKeys);
  const sequenced = upserted.replace(/\browid\b/g, 'seq');
  return toPositional(sequenced);
}

/** Translate the whole schema script for Postgres. */
export function toPostgresDdl(ddl: string): string {
  let out = ddl.replace(/\bREAL\b/g, 'DOUBLE PRECISION');
  for (const table of ROWID_TABLES) {
    out = out.replace(
      new RegExp(`(CREATE TABLE(?: IF NOT EXISTS)? ${table}\\s*\\()`, 'g'),
      '$1\n  seq BIGSERIAL,',
    );
  }
  return out;
}
