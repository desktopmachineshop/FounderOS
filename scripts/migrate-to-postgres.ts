/**
 * Move an existing workstation SQLite store into the shared Postgres.
 *
 *   FOUNDER_OS_DB=data/founder-os.db \
 *   DATABASE_URL=postgres://… \
 *   npm run migrate:postgres
 *
 * Reads through the repository layer, so every row is Zod-validated out of
 * SQLite and again into Postgres: a migration carrying bad data fails loudly
 * instead of landing it in the new system of record. Writes are upserts by
 * primary key, so re-running is safe and a half-finished run just gets
 * repeated.
 *
 * It does not delete anything. The SQLite file is left exactly as it was, so
 * the old store stays a usable fallback until the new one has proven itself.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { openDb } from '@/lib/db';
import { migrateStore } from '@/lib/migrate';
import { isPostgresUrl } from '@/lib/sql';

async function main(): Promise<void> {
  const source = process.env.FOUNDER_OS_DB ?? path.join(process.cwd(), 'data', 'founder-os.db');
  const target = process.env.DATABASE_URL?.trim();

  if (!target || !isPostgresUrl(target)) {
    console.error('migrate: set DATABASE_URL to the postgres:// target');
    process.exitCode = 1;
    return;
  }
  if (source !== ':memory:' && !existsSync(source)) {
    console.error(`migrate: no SQLite store at ${source} (set FOUNDER_OS_DB)`);
    process.exitCode = 1;
    return;
  }

  // Never print the password back at the operator.
  const redacted = target.replace(/\/\/[^@]*@/, '//***@');
  console.log(`migrate: ${source}  →  ${redacted}`);

  const from = await openDb(source);
  const to = await openDb(target);
  try {
    const counts = await migrateStore(from, to, (table, rows) => {
      console.log(`  ${table.padEnd(18)} ${rows}`);
    });
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    console.log(`\nmigrate: ${total} rows across ${Object.keys(counts).length} tables`);
    console.log('The SQLite file was not modified — keep it until the new store has proven itself.');
  } finally {
    await from.close();
    await to.close();
  }
}

void main();
