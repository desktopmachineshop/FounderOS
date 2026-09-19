import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, PRIMARY_KEYS, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { migrateStore } from '@/lib/migrate';
import { newMediaJob } from '@/lib/media-jobs';
import { openPostgres } from '@/lib/sql/postgres';
import { isPostgresUrl } from '@/lib/sql/driver';

/**
 * The migration is the one-way door in this whole plan: it moves the
 * operator's real history out of the workstation's SQLite file and into the
 * shared Postgres. So it is tested against a real Postgres, not a second
 * SQLite pretending to be one.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const enabled = Boolean(PG_URL && isPostgresUrl(PG_URL));
const MIGRATE_DB = 'founderos_migrate_test';
const migrateUrl = (url: string) => new URL(url).href.replace(/\/[^/?]*(\?|$)/, `/${MIGRATE_DB}$1`);

describe.skipIf(!enabled)('migrateStore: SQLite → Postgres', () => {
  let sqlite: FounderDb;
  let postgres: FounderDb;

  beforeAll(async () => {
    const admin = openPostgres(PG_URL!, { primaryKeys: PRIMARY_KEYS });
    try {
      await admin.exec(`CREATE DATABASE ${MIGRATE_DB}`);
    } catch {
      /* already there */
    } finally {
      await admin.close();
    }

    const target = openPostgres(migrateUrl(PG_URL!), { primaryKeys: PRIMARY_KEYS });
    await target.exec(`DROP TABLE IF EXISTS ${[...PRIMARY_KEYS.keys()].join(', ')} CASCADE;`);
    await target.close();

    sqlite = await openDb(':memory:');
    await seedDatabase(sqlite);

    // Operator history on top of the seed — the rows a migration exists to save.
    await sqlite.agentRuns.insert({
      id: 'run-1',
      agentId: 'gmail-worker',
      startedAt: '2026-09-01T09:00:00.000Z',
      finishedAt: '2026-09-01T09:00:02.000Z',
      ok: true,
      summary: 'real history',
    });
    await sqlite.agentTasks.insert({
      id: 'task-1',
      agentId: 'gmail-worker',
      title: 'keep me',
      status: 'open',
      createdAt: '2026-09-01T09:00:00.000Z',
      updatedAt: '2026-09-01T09:00:00.000Z',
    });
    await sqlite.broadcasts.insert({
      id: 'bc-1',
      message: 'status please',
      createdAt: '2026-09-01T10:00:00.000Z',
    });
    await sqlite.broadcasts.insertReply({
      id: 'br-1',
      broadcastId: 'bc-1',
      agentId: 'gmail-worker',
      ok: true,
      reply: 'all clear',
      finishedAt: '2026-09-01T10:00:01.000Z',
    });
    await sqlite.contactTags.upsert({ person: 'Jane', channel: 'email', tag: 'client', tier: 1 });
    await sqlite.mediaJobs.enqueue(
      newMediaJob({ spec: { kind: 'render', composition: 'ReelKit', output: 'clips/a.mp4' }, id: 'mj-1' }),
    );

    postgres = await openDb(migrateUrl(PG_URL!));
  }, 120_000);

  afterAll(async () => {
    await sqlite?.close();
    await postgres?.close();
  });

  it('copies every table, and the counts line up with the source', async () => {
    const counts = await migrateStore(sqlite, postgres);
    expect(counts.departments).toBeGreaterThan(0);
    expect(counts.agents).toBeGreaterThan(0);
    expect(counts.agentRuns).toBe(1);
    expect(counts.broadcasts).toBe(1);
    expect(counts.mediaJobs).toBe(1);
    expect(counts.funnel).toBeGreaterThan(0);
  }, 120_000);

  it('lands the operator history, not just the seed', async () => {
    expect((await postgres.agentRuns.byAgent('gmail-worker'))[0]?.summary).toBe('real history');
    expect((await postgres.agentTasks.all()).map((t) => t.id)).toContain('task-1');
    expect((await postgres.contactTags.all())[0]?.person).toBe('Jane');
    expect((await postgres.mediaJobs.byId('mj-1'))?.spec.kind).toBe('render');
  });

  it('carries a broadcast together with its replies', async () => {
    const [broadcast] = await postgres.broadcasts.recent(5);
    expect(broadcast.id).toBe('bc-1');
    expect(broadcast.replies.map((r) => r.reply)).toEqual(['all clear']);
  });

  it('reproduces the source exactly, table for table', async () => {
    const readers: [string, (db: FounderDb) => Promise<unknown>][] = [
      ['departments', (db) => db.departments.all()],
      ['agents', (db) => db.agents.all()],
      ['people', (db) => db.people.all()],
      ['sopTasks', (db) => db.sopTasks.all()],
      ['skills', (db) => db.skills.all()],
      ['workflows', (db) => db.workflows.all()],
      ['funnelJourneys', (db) => db.funnel.journeys()],
      ['socialAccounts', (db) => db.social.accounts()],
      ['dmMessages', (db) => db.social.dmMessages()],
      ['emailSnapshots', (db) => db.emailList.snapshots()],
      ['leadMagnets', (db) => db.leadMagnets.all()],
    ];
    for (const [, read] of readers) {
      expect(await read(postgres)).toEqual(await read(sqlite));
    }
  }, 60_000);

  // A migration you cannot re-run is a migration you cannot recover from.
  it('is safe to run twice', async () => {
    const before = (await postgres.agents.all()).length;
    await migrateStore(sqlite, postgres);
    expect((await postgres.agents.all()).length).toBe(before);
    expect((await postgres.agentRuns.byAgent('gmail-worker')).length).toBe(1);
  }, 120_000);
});
