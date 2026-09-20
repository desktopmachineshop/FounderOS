import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { openSqlite } from '@/lib/sql/sqlite';
import { RETIRED_VENTURE_IDS, VENTURES } from '@/lib/ventures';
import { FunnelVentureSchema } from '@/lib/schemas';

/**
 * Renaming the ventures changed a Zod enum that the database column is
 * validated against, so any row still carrying a retired id would throw on
 * read rather than render — and the stores that hold those rows are already
 * deployed. `openDb` rewrites them on open so the rename needs no wipe.
 */
describe('retired venture ids', () => {
  it('every retired id maps to a venture that exists', () => {
    for (const [from, to] of Object.entries(RETIRED_VENTURE_IDS)) {
      expect(VENTURES.some((v) => v.id === to), `${from} → ${to}`).toBe(true);
    }
  });

  it('no retired id is still a live venture', () => {
    for (const from of Object.keys(RETIRED_VENTURE_IDS)) {
      expect(VENTURES.some((v) => v.id === from)).toBe(false);
      expect(FunnelVentureSchema.safeParse(from).success).toBe(false);
    }
  });

});

/**
 * The real check: seed a database, force rows onto retired ids behind the
 * repository's back, reopen, and confirm the reads come back clean.
 */
describe('openDb migrates retired ventures in place', () => {
  it('leaves no unreadable row behind', async () => {
    const path = `${process.env.TMPDIR ?? '/tmp'}/venture-migration-${Date.now()}.db`;
    const db = await openDb(path);
    await db.funnel.insertContact({
      id: 'legacy-1',
      name: 'Legacy Contact',
      venture: 'openv',
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
      createdAt: '2026-09-20T00:00:00.000Z',
    });
    await db.close();

    // Rewrite it to a retired id, simulating a store from before the rename.
    const raw = openSqlite(path);
    await raw.run("UPDATE funnel_contacts SET venture = 'launchpad-cohort' WHERE id = ?", [
      'legacy-1',
    ]);
    expect(
      (await raw.get<{ venture: string }>('SELECT venture FROM funnel_contacts WHERE id = ?', [
        'legacy-1',
      ]))?.venture,
    ).toBe('launchpad-cohort');
    await raw.close();

    // Reopening must repair it — otherwise journeys() throws on the Zod parse.
    const reopened = await openDb(path);
    const journeys = await reopened.funnel.journeys();
    const found = journeys.find((j) => j.id === 'legacy-1');
    expect(found?.venture).toBe(RETIRED_VENTURE_IDS['launchpad-cohort']);
    await reopened.close();
  });
});
