import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb, PRIMARY_KEYS, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { openPostgres } from '@/lib/sql/postgres';
import { isPostgresUrl } from '@/lib/sql/driver';

/**
 * The claim this whole split rests on: the workstation's SQLite file and the
 * cloud's managed Postgres are the *same* store behind the same repository
 * layer. That is only true if the real schema, the real seed, and every real
 * repository method behave identically on both.
 *
 * Runs whenever TEST_DATABASE_URL points at a Postgres server; skipped (loudly,
 * via a skipped suite rather than a silent pass) otherwise.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const enabled = Boolean(PG_URL && isPostgresUrl(PG_URL));

describe.skipIf(!enabled)('SQLite ↔ Postgres parity on the real schema', () => {
  let sqlite: FounderDb;
  let postgres: FounderDb;

  beforeAll(async () => {
    // Postgres keeps state between runs; start from an empty schema.
    const raw = openPostgres(PG_URL!, { primaryKeys: PRIMARY_KEYS });
    const tables = [...PRIMARY_KEYS.keys()];
    await raw.exec(`DROP TABLE IF EXISTS ${tables.join(', ')} CASCADE;`);
    await raw.close();

    sqlite = await openDb(':memory:');
    postgres = await openDb(PG_URL!);
    await seedDatabase(sqlite);
    await seedDatabase(postgres);
  }, 120_000);

  afterAll(async () => {
    await sqlite?.close();
    await postgres?.close();
  });

  it('reports the backend it is actually talking to', () => {
    expect(sqlite.dialect).toBe('sqlite');
    expect(postgres.dialect).toBe('postgres');
  });

  // agent_crons and contact_tags are operator-created, so the seed leaves them
  // empty; everything else should come back populated on both backends.
  const EMPTY_IN_SEED = new Set(['agentCrons', 'contactTags']);

  // Every read method that takes no argument: the broad sweep.
  const readers: [string, (db: FounderDb) => Promise<unknown>][] = [
    ['departments', (db) => db.departments.all()],
    ['agents', (db) => db.agents.all()],
    ['tools', (db) => db.tools.all()],
    ['roadmap', (db) => db.roadmap.all()],
    ['metrics', (db) => db.metrics.all()],
    ['domains', (db) => db.domains.all()],
    ['personas', (db) => db.personas.all()],
    ['phases', (db) => db.phases.all()],
    ['people', (db) => db.people.all()],
    ['leadMagnets', (db) => db.leadMagnets.all()],
    ['sopTasks', (db) => db.sopTasks.all()],
    ['workflows', (db) => db.workflows.all()],
    ['skills', (db) => db.skills.all()],
    ['agentTasks', (db) => db.agentTasks.all()],
    ['agentCrons', (db) => db.agentCrons.all()],
    ['contactTags', (db) => db.contactTags.all()],
    ['socialAccounts', (db) => db.social.accounts()],
    ['socialLatest', (db) => db.social.latest()],
    ['socialDms', (db) => db.social.dms()],
    ['dmSnapshots', (db) => db.social.dmSnapshots()],
    ['dmMessages', (db) => db.social.dmMessages()],
    ['emailSnapshots', (db) => db.emailList.snapshots()],
    ['emailLatest', (db) => db.emailList.latest()],
    ['socialPosts', (db) => db.socialPosts.all()],
    ['funnelJourneys', (db) => db.funnel.journeys()],
  ];

  it.each(readers)('%s reads identically on both backends', async (name, read) => {
    const [a, b] = await Promise.all([read(sqlite), read(postgres)]);
    expect(b).toEqual(a);
    // Parity on two empty tables proves nothing, so assert the seed filled them.
    if (Array.isArray(a) && !EMPTY_IN_SEED.has(name)) expect(a.length).toBeGreaterThan(0);
  });

  it('upserts by primary key rather than duplicating', async () => {
    const before = (await postgres.departments.all()).length;
    const one = (await postgres.departments.all())[0];
    await postgres.departments.insert({ ...one, tagline: 'rewritten' });
    const after = await postgres.departments.all();
    expect(after.length).toBe(before);
    expect(after.find((d) => d.id === one.id)?.tagline).toBe('rewritten');
    await postgres.departments.insert(one); // restore
  });

  it('orders by insertion sequence when timestamps tie, like rowid does', async () => {
    const at = '2026-09-19T00:00:00.000Z';
    for (const db of [sqlite, postgres]) {
      for (const id of ['pr-1', 'pr-2', 'pr-3']) {
        await db.agentRuns.insert({
          id,
          agentId: 'parity-agent',
          startedAt: at,
          finishedAt: at,
          ok: true,
          summary: id,
        });
      }
    }
    const [a, b] = await Promise.all([sqlite.agentRuns.recent(3), postgres.agentRuns.recent(3)]);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(b.map((r) => r.id)).toEqual(['pr-3', 'pr-2', 'pr-1']);
  });

  it('round-trips a boolean stored as an integer', async () => {
    await postgres.agentCrons.insert({
      id: 'parity-cron',
      agentId: 'parity-agent',
      schedule: '0 9 * * 1',
      description: 'parity',
      enabled: false,
      createdAt: '2026-09-19T00:00:00.000Z',
    });
    const row = (await postgres.agentCrons.byAgent('parity-agent'))[0];
    expect(row.enabled).toBe(false);
  });

  it('keeps a nullable column null rather than coercing it', async () => {
    await postgres.funnel.insertContact({
      id: 'parity-contact',
      name: 'Parity',
      venture: 'vantage',
      status: 'first_touch',
      product: null,
      amountUsd: null,
      relationship: 'warm',
      likelihood: 50,
      url: null,
      email: null,
      phone: null,
      person: null,
      company: null,
      role: null,
      linkedin: null,
      createdAt: '2026-09-19T00:00:00.000Z',
    });
    const found = (await postgres.funnel.journeys()).find((j) => j.id === 'parity-contact');
    expect(found?.amountUsd).toBeNull();
    expect(found?.product).toBeNull();
  });

  it('reports rows actually deleted, so the API can 404 honestly', async () => {
    expect(await postgres.leadMagnets.remove('definitely-not-there')).toBe(false);
    const one = (await postgres.leadMagnets.all())[0];
    expect(await postgres.leadMagnets.remove(one.id)).toBe(true);
    await postgres.leadMagnets.insert(one); // restore
  });

  it('is idempotent: re-seeding does not duplicate rows', async () => {
    const before = await Promise.all([
      postgres.departments.all(),
      postgres.agents.all(),
      postgres.skills.all(),
    ]);
    await seedDatabase(postgres);
    const after = await Promise.all([
      postgres.departments.all(),
      postgres.agents.all(),
      postgres.skills.all(),
    ]);
    expect(after.map((r) => r.length)).toEqual(before.map((r) => r.length));
  }, 60_000);
});
