import path from 'node:path';
import fs from 'node:fs';
import { openDb, type FounderDb } from '@/lib/db';
import { isPostgresUrl } from '@/lib/sql';
import { seedDatabase } from '@/lib/seed';

/**
 * App-level singleton. Every page and API route reads through this repository
 * layer, so swapping the backend underneath is a repo-level change, not a UI
 * rewrite.
 *
 * Which backend depends on where this instance runs:
 *
 *   - Workstation: a SQLite file (`FOUNDER_OS_DB`, default `data/founder-os.db`).
 *   - Cloud: managed Postgres (`DATABASE_URL`), shared with the workstation so
 *     both halves of the split read and write one system of record.
 *
 * `DATABASE_URL` wins when both are set, because that is the shared store.
 */
/**
 * Is demo data switched on?
 *
 * Upstream seeds every table on first touch so a fresh clone "boots looking
 * alive". For an operator's own dashboard that is a hazard, not a feature: a
 * seeded revenue figure is indistinguishable from a real one at a glance. So
 * seeding is opt-in and **off by default**.
 *
 * Only explicit truthy spellings count. `FOUNDER_OS_DEMO=false` must not enable
 * demo data — a variable set to a falsy word is the likeliest way for someone
 * to believe they turned it off.
 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function demoDataEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return TRUTHY.has((env.FOUNDER_OS_DEMO ?? '').trim().toLowerCase());
}

export function databaseTarget(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL?.trim();
  if (url && isPostgresUrl(url)) return url;
  return env.FOUNDER_OS_DB ?? path.join(process.cwd(), 'data', 'founder-os.db');
}

/**
 * Memoized as a *promise*, not as a resolved handle. Two requests arriving
 * together both get the same in-flight open-and-seed instead of racing to seed
 * the same tables twice — which the old synchronous singleton could not do
 * once seeding stopped being instantaneous.
 */
let instance: Promise<FounderDb> | null = null;

export function getDb(): Promise<FounderDb> {
  if (!instance) {
    instance = open().catch((err) => {
      // A failed open must not be cached, or every later request inherits it.
      instance = null;
      throw err;
    });
  }
  return instance;
}

async function open(): Promise<FounderDb> {
  const target = databaseTarget();
  if (!isPostgresUrl(target) && target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = await openDb(target);

  // Demo data only when asked for. Unset, the store stays empty and every view
  // renders its `NotWired` state instead of a figure nobody earned. `npm run
  // seed` still seeds on demand — it calls seedDatabase directly.
  if (demoDataEnabled()) {
    // Each clause back-fills databases created before that table existed;
    // seedDatabase is idempotent (INSERT OR REPLACE), so re-running only adds
    // what is missing.
    const counts = await Promise.all([
      db.departments.all(),
      db.workflows.all(),
      db.skills.all(),
      db.social.accounts(),
      db.emailList.snapshots(),
      db.social.dmSnapshots(),
      db.social.dmMessages(),
      db.leadMagnets.all(),
    ]);
    if (counts.some((rows) => rows.length === 0)) {
      await seedDatabase(db);
    }
  }
  return db;
}

/** Drop the memoized handle. Tests use this; nothing in the app should. */
export function resetDb(): void {
  instance = null;
}
