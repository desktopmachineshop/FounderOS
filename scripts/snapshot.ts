/**
 * Write clean, portable copies of every local SQLite store into a directory,
 * plus a manifest describing what was written.
 *
 *   npx tsx scripts/snapshot.ts <destination-dir> <stamp>
 *
 * Why not a file copy: the stores run in WAL mode, so committed pages can still
 * be sitting in `<name>.db-wal` when you copy `<name>.db`. The copy then looks
 * fine and is silently missing the most recent writes. `VACUUM INTO` asks SQLite
 * for a fully-checkpointed single-file image instead, and is read-only with
 * respect to the source — safe to run while `npm run dev` holds the DB open.
 *
 * The manifest exists so restore.ps1 doesn't have to hard-code this list: add a
 * store here and both directions pick it up.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

type Store = { name: string; envVar: string; target: string };

// Path resolution mirrors each module's own default: lib/data.ts, lib/bank.ts,
// lib/ledger.ts.
const STORES: Store[] = [
  { name: 'founder-os', envVar: 'FOUNDER_OS_DB', target: 'data/founder-os.db' },
  { name: 'bank', envVar: 'BANK_DB', target: 'data/bank.db' },
  { name: 'ledger', envVar: 'LEDGER_DB', target: 'data/ledger.db' },
];

const [destDirArg, stamp] = process.argv.slice(2);
if (!destDirArg || !stamp) {
  console.error('usage: tsx scripts/snapshot.ts <destination-dir> <stamp>');
  process.exit(1);
}

const destDir = path.resolve(destDirArg);
fs.mkdirSync(destDir, { recursive: true });

function sourcePath(store: Store): string {
  return process.env[store.envVar] ?? path.join(process.cwd(), ...store.target.split('/'));
}

const written: Array<Record<string, unknown>> = [];

for (const store of STORES) {
  const source = sourcePath(store);
  if (!fs.existsSync(source)) {
    // A store only exists once the feature behind it has been used. Missing is
    // normal, not an error — but say so, so an absent file is never a surprise
    // on the restoring end.
    console.log(`${store.name}: no database at ${source} — skipped`);
    continue;
  }

  const snapshotName = `${store.name}-${stamp}.db`;
  const dest = path.join(destDir, snapshotName);
  fs.rmSync(dest, { force: true }); // VACUUM INTO refuses to overwrite

  const db = new Database(source);
  try {
    db.prepare('VACUUM INTO ?').run(dest);
  } finally {
    db.close();
  }

  // Prove each snapshot is readable before anything downstream trusts it — a
  // backup you never opened is a backup you don't have.
  const check = new Database(dest, { readonly: true });
  let tables: number;
  try {
    const integrity = check.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`integrity_check on ${snapshotName}: ${integrity}`);
    tables = (check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }).n;
  } finally {
    check.close();
  }

  const latestName = `${store.name}-latest.db`;
  fs.copyFileSync(dest, path.join(destDir, latestName));

  const bytes = fs.statSync(dest).size;
  written.push({ name: store.name, target: store.target, envVar: store.envVar, snapshot: snapshotName, latest: latestName, bytes, tables });
  console.log(`${store.name}: ${(bytes / 1024).toFixed(0)} KB · ${tables} tables · ok -> ${latestName}`);
}

if (written.length === 0) {
  console.error('No databases found to snapshot. Run `npm run seed` or start the app once.');
  process.exit(1);
}

fs.writeFileSync(
  path.join(destDir, 'manifest.json'),
  JSON.stringify({ created: new Date().toISOString(), stamp, stores: written }, null, 2) + '\n',
);
console.log(`manifest.json updated (${written.length} store${written.length === 1 ? '' : 's'})`);
