import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parsePrimaryKeys } from '@/lib/sql/dialect';
import { openSqlite } from '@/lib/sql/sqlite';
import { openPostgres } from '@/lib/sql/postgres';
import { isPostgresUrl, normalizeParams, type SqlDriver } from '@/lib/sql/driver';

describe('normalizeParams', () => {
  it('folds undefined to null, since neither driver binds undefined', () => {
    expect(normalizeParams(['a', undefined, null])).toEqual(['a', null, null]);
  });

  it('folds booleans to the 0/1 integers the schema stores', () => {
    expect(normalizeParams([true, false])).toEqual([1, 0]);
  });

  it('leaves numbers and strings alone', () => {
    expect(normalizeParams([1, 'x', 2.5])).toEqual([1, 'x', 2.5]);
  });
});

describe('isPostgresUrl', () => {
  it.each([
    ['postgres://u:p@host/db', true],
    ['postgresql://u:p@host/db', true],
    ['/data/founder-os.db', false],
    [':memory:', false],
    ['data/postgres-backup.db', false],
  ])('%s → %s', (target, expected) => {
    expect(isPostgresUrl(target)).toBe(expected);
  });
});

/**
 * One suite, run against every backend that is reachable. SQLite always runs;
 * Postgres runs when TEST_DATABASE_URL points at a server. Both must behave
 * identically or the "same code, two hosts" promise is not real.
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS drv_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ok INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS drv_pairs (
  left_side TEXT NOT NULL,
  right_side TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (left_side, right_side)
);
`;

const PRIMARY_KEYS = parsePrimaryKeys(SCHEMA);
const PG_URL = process.env.TEST_DATABASE_URL;

/**
 * This suite needs its own `agent_runs` — a cut-down one, to prove the
 * rowid-to-seq rewrite — which would collide with the real table that the
 * parity suite seeds in the same database. Test files run in parallel, so it
 * gets its own database rather than a shared one.
 */
const DRIVER_DB = 'founderos_driver_test';
const driverUrl = (url: string) => new URL(url).href.replace(/\/[^/?]*(\?|$)/, `/${DRIVER_DB}$1`);

async function ensureDriverDatabase(url: string): Promise<void> {
  const admin = openPostgres(url, { primaryKeys: PRIMARY_KEYS });
  try {
    await admin.exec(`CREATE DATABASE ${DRIVER_DB}`);
  } catch {
    // already there
  } finally {
    await admin.close();
  }
}

const backends: { name: string; open: () => SqlDriver }[] = [
  { name: 'sqlite', open: () => openSqlite(':memory:') },
];
if (PG_URL && isPostgresUrl(PG_URL)) {
  backends.push({
    name: 'postgres',
    open: () => openPostgres(driverUrl(PG_URL), { primaryKeys: PRIMARY_KEYS }),
  });
}

describe.each(backends)('SqlDriver conformance — $name', ({ open }) => {
  let db: SqlDriver;

  beforeAll(async () => {
    if (PG_URL && isPostgresUrl(PG_URL)) await ensureDriverDatabase(PG_URL);
    db = open();
    // Postgres keeps state between runs; start from a known-empty schema.
    for (const table of ['drv_items', 'agent_runs', 'drv_pairs']) {
      await db.exec(`DROP TABLE IF EXISTS ${table};`);
    }
    await db.exec(SCHEMA);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('round-trips an insert through all()', async () => {
    await db.run('INSERT OR REPLACE INTO drv_items (id, label, amount, done) VALUES (?, ?, ?, ?)', [
      'a',
      'first',
      12.5,
      false,
    ]);
    const rows = await db.all<{ id: string; label: string; amount: number; done: number }>(
      'SELECT id, label, amount, done FROM drv_items WHERE id = ?',
      ['a'],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('first');
    expect(rows[0].amount).toBe(12.5);
    expect(Boolean(rows[0].done)).toBe(false);
  });

  it('replaces rather than duplicates on a repeated upsert', async () => {
    const write = (label: string) =>
      db.run('INSERT OR REPLACE INTO drv_items (id, label, amount, done) VALUES (?, ?, ?, ?)', [
        'dup',
        label,
        1,
        true,
      ]);
    await write('before');
    await write('after');
    const rows = await db.all('SELECT * FROM drv_items WHERE id = ?', ['dup']);
    expect(rows).toHaveLength(1);
    expect((rows[0] as { label: string }).label).toBe('after');
  });

  it('upserts on a composite primary key', async () => {
    const write = (note: string) =>
      db.run('INSERT OR REPLACE INTO drv_pairs (left_side, right_side, note) VALUES (?, ?, ?)', [
        'l',
        'r',
        note,
      ]);
    await write('one');
    await write('two');
    const rows = await db.all<{ note: string }>('SELECT note FROM drv_pairs');
    expect(rows).toHaveLength(1);
    expect(rows[0].note).toBe('two');
  });

  it('returns null from get() when nothing matches', async () => {
    expect(await db.get('SELECT * FROM drv_items WHERE id = ?', ['nope'])).toBeNull();
  });

  it('reports changed rows from run()', async () => {
    await db.run('INSERT OR REPLACE INTO drv_items (id, label) VALUES (?, ?)', ['gone', 'x']);
    expect((await db.run('DELETE FROM drv_items WHERE id = ?', ['gone'])).changes).toBe(1);
    expect((await db.run('DELETE FROM drv_items WHERE id = ?', ['gone'])).changes).toBe(0);
  });

  it('binds undefined as null on a nullable column instead of throwing', async () => {
    await db.run('INSERT OR REPLACE INTO drv_items (id, label, note) VALUES (?, ?, ?)', [
      'u',
      'undef',
      undefined,
    ]);
    const row = await db.get<{ note: string | null }>('SELECT note FROM drv_items WHERE id = ?', [
      'u',
    ]);
    expect(row?.note).toBeNull();
  });

  it('orders by insertion sequence when timestamps tie', async () => {
    const at = '2026-09-19T12:00:00.000Z';
    for (const id of ['r1', 'r2', 'r3']) {
      await db.run(
        'INSERT OR REPLACE INTO agent_runs (id, agent_id, started_at, ok) VALUES (?, ?, ?, ?)',
        [id, 'agent', at, true],
      );
    }
    const rows = await db.all<{ id: string }>(
      'SELECT * FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT ?',
      [2],
    );
    expect(rows.map((r) => r.id)).toEqual(['r3', 'r2']);
  });

  it('lists the columns of a table, and nothing for one that is absent', async () => {
    expect(await db.columns('drv_items')).toEqual(
      new Set(['id', 'label', 'amount', 'done', 'note']),
    );
    expect((await db.columns('not_a_table')).size).toBe(0);
  });

  it('adds a column through exec() and reads it straight back', async () => {
    await db.exec('ALTER TABLE drv_items ADD COLUMN extra TEXT');
    expect(await db.columns('drv_items')).toContain('extra');
    const rows = await db.all('SELECT extra FROM drv_items LIMIT 1');
    expect(rows.length).toBeGreaterThanOrEqual(0);
  });

  it('keeps a quoted camelCase alias in the case it was written', async () => {
    const row = await db.get<{ myLabel: string }>(
      'SELECT label AS "myLabel" FROM drv_items WHERE id = ?',
      ['a'],
    );
    expect(row?.myLabel).toBe('first');
  });
});
