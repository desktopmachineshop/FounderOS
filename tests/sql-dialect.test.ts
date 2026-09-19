import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ROWID_TABLES,
  parsePrimaryKeys,
  toPositional,
  toPostgresDdl,
  toPostgresSql,
} from '@/lib/sql/dialect';

const dbSource = fs.readFileSync(path.join(process.cwd(), 'lib', 'db.ts'), 'utf8');

describe('parsePrimaryKeys', () => {
  it('reads an inline single-column primary key', () => {
    const pks = parsePrimaryKeys(`CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );`);
    expect(pks.get('departments')).toEqual(['id']);
  });

  it('reads a table-level composite primary key', () => {
    const pks = parsePrimaryKeys(`CREATE TABLE IF NOT EXISTS social_snapshots (
      platform TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      followers INTEGER NOT NULL,
      PRIMARY KEY (platform, captured_at)
    );`);
    expect(pks.get('social_snapshots')).toEqual(['platform', 'captured_at']);
  });

  it('ignores REFERENCES clauses when finding the key', () => {
    const pks = parsePrimaryKeys(`CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      department_id TEXT NOT NULL REFERENCES departments(id)
    );`);
    expect(pks.get('agents')).toEqual(['id']);
  });
});

describe('toPositional', () => {
  it('numbers placeholders left to right', () => {
    expect(toPositional('SELECT * FROM t WHERE a = ? AND b = ?')).toBe(
      'SELECT * FROM t WHERE a = $1 AND b = $2',
    );
  });

  it('leaves a question mark inside a string literal alone', () => {
    expect(toPositional("SELECT * FROM t WHERE label = 'why?' AND id = ?")).toBe(
      "SELECT * FROM t WHERE label = 'why?' AND id = $1",
    );
  });
});

describe('toPostgresSql', () => {
  const pks = new Map([
    ['departments', ['id']],
    ['social_snapshots', ['platform', 'captured_at']],
    ['agent_runs', ['id']],
  ]);

  it('rewrites INSERT OR REPLACE as an upsert on the primary key', () => {
    const out = toPostgresSql(
      'INSERT OR REPLACE INTO departments (id, name, color) VALUES (?, ?, ?)',
      pks,
    );
    expect(out).toBe(
      'INSERT INTO departments (id, name, color) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color',
    );
  });

  it('targets every column of a composite key and never updates a key column', () => {
    const out = toPostgresSql(
      'INSERT OR REPLACE INTO social_snapshots (platform, captured_at, followers, source) VALUES (?, ?, ?, ?)',
      pks,
    );
    expect(out).toContain('ON CONFLICT (platform, captured_at) DO UPDATE SET');
    expect(out).toContain('followers = EXCLUDED.followers');
    expect(out).toContain('source = EXCLUDED.source');
    expect(out).not.toContain('platform = EXCLUDED.platform');
  });

  it('preserves a quoted column name through the upsert rewrite', () => {
    const out = toPostgresSql(
      'INSERT OR REPLACE INTO departments (id, name, "order") VALUES (?, ?, ?)',
      new Map([['departments', ['id']]]),
    );
    expect(out).toContain('"order" = EXCLUDED."order"');
  });

  it('does nothing on conflict when every column is part of the key', () => {
    const out = toPostgresSql(
      'INSERT OR REPLACE INTO social_snapshots (platform, captured_at) VALUES (?, ?)',
      pks,
    );
    expect(out).toContain('ON CONFLICT (platform, captured_at) DO NOTHING');
  });

  it('swaps SQLite rowid for the explicit seq column', () => {
    expect(
      toPostgresSql('SELECT * FROM agent_runs ORDER BY started_at DESC, rowid DESC LIMIT ?', pks),
    ).toBe('SELECT * FROM agent_runs ORDER BY started_at DESC, seq DESC LIMIT $1');
  });

  it('leaves an existing explicit ON CONFLICT clause untouched', () => {
    const sql =
      'INSERT INTO contact_tags (person, channel, tag, tier) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(person, channel) DO UPDATE SET tag = excluded.tag, tier = excluded.tier';
    expect(toPostgresSql(sql, pks)).toBe(
      'INSERT INTO contact_tags (person, channel, tag, tier) VALUES ($1, $2, $3, $4) ' +
        'ON CONFLICT(person, channel) DO UPDATE SET tag = excluded.tag, tier = excluded.tier',
    );
  });

  it('throws on an upsert into a table it has no key for, rather than guessing', () => {
    expect(() => toPostgresSql('INSERT OR REPLACE INTO mystery (a) VALUES (?)', pks)).toThrow(
      /mystery/,
    );
  });
});

describe('toPostgresDdl', () => {
  it('widens REAL to double precision so money keeps its digits', () => {
    const out = toPostgresDdl('CREATE TABLE IF NOT EXISTS metrics (value REAL NOT NULL);');
    expect(out).toContain('value DOUBLE PRECISION NOT NULL');
    expect(out).not.toMatch(/\bREAL\b/);
  });

  it('gives every rowid-ordered table an explicit seq column', () => {
    const out = toPostgresDdl(`CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL
);`);
    expect(out).toMatch(/CREATE TABLE IF NOT EXISTS agent_runs \(\s*seq BIGSERIAL/);
  });

  it('leaves a table nobody orders by rowid without a seq column', () => {
    const out = toPostgresDdl('CREATE TABLE IF NOT EXISTS tools (id TEXT PRIMARY KEY);');
    expect(out).not.toContain('BIGSERIAL');
  });

  it('keeps a quoted identifier quoted', () => {
    const out = toPostgresDdl('CREATE TABLE IF NOT EXISTS departments ("order" INTEGER NOT NULL);');
    expect(out).toContain('"order" INTEGER NOT NULL');
  });
});

// The rowid list is a hand-maintained constant; this keeps it honest against
// the queries that actually depend on it.
describe('ROWID_TABLES matches the repository layer', () => {
  it('covers every table lib/db.ts orders by rowid', () => {
    const ordered = new Set<string>();
    for (const m of dbSource.matchAll(/FROM\s+(\w+)(?:\s+\w+)?[\s\S]{0,200}?\browid\b/g)) {
      ordered.add(m[1]);
    }
    expect(ordered.size).toBeGreaterThan(0);
    for (const table of ordered) expect(ROWID_TABLES).toContain(table);
  });

  it('lists no table that has stopped using rowid', () => {
    for (const table of ROWID_TABLES) {
      expect(dbSource).toMatch(new RegExp(`FROM\\s+${table}\\b`));
    }
  });
});

describe('the real schema survives translation', () => {
  it('finds a primary key for every table the DDL declares', () => {
    const ddl = dbSource.slice(dbSource.indexOf('const DDL = `'), dbSource.indexOf('`;\n'));
    const pks = parsePrimaryKeys(ddl);
    const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(20);
    for (const table of tables) expect(pks.get(table)?.length ?? 0).toBeGreaterThan(0);
  });
});
