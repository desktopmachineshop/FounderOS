import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { demoDataEnabled, getDb, resetDb } from '@/lib/data';

/**
 * Upstream ships this app as a demo: `lib/seed.ts` fills every table on first
 * touch so a fresh clone "boots looking alive". That is the right default for a
 * demo and the wrong one for an operator's own dashboard, where an invented
 * revenue figure is indistinguishable from a real one.
 *
 * So seeding becomes opt-in. The seed is not deleted — it is still the fixture
 * a third of the test suite is built on, and still useful for reference — it
 * just never runs unless someone asks for it.
 */
describe('demoDataEnabled', () => {
  it('is OFF when the variable is absent — the safe default', () => {
    expect(demoDataEnabled({})).toBe(false);
  });

  it('accepts the usual truthy spellings, case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on', ' True ']) {
      expect(demoDataEnabled({ FOUNDER_OS_DEMO: v }), v).toBe(true);
    }
  });

  /**
   * `FOUNDER_OS_DEMO=false` must not enable demo data. A variable that is set
   * to a falsy word is the single most likely way for someone to *think* they
   * turned it off.
   */
  it('treats falsy and unrecognised values as off', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off', '', '  ', 'maybe']) {
      expect(demoDataEnabled({ FOUNDER_OS_DEMO: v }), JSON.stringify(v)).toBe(false);
    }
  });
});

describe('getDb honours the gate', () => {
  const originalDb = process.env.FOUNDER_OS_DB;
  const originalDemo = process.env.FOUNDER_OS_DEMO;

  afterEach(() => {
    resetDb();
    if (originalDb === undefined) delete process.env.FOUNDER_OS_DB;
    else process.env.FOUNDER_OS_DB = originalDb;
    if (originalDemo === undefined) delete process.env.FOUNDER_OS_DEMO;
    else process.env.FOUNDER_OS_DEMO = originalDemo;
  });

  const freshDb = () => {
    resetDb();
    process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'demo-gate-')), 'test.db');
  };

  it('a fresh database stays EMPTY by default — no invented rows anywhere', async () => {
    freshDb();
    delete process.env.FOUNDER_OS_DEMO;
    const db = await getDb();
    expect(await db.departments.all()).toEqual([]);
    expect(await db.workflows.all()).toEqual([]);
    expect(await db.social.accounts()).toEqual([]);
    expect(await db.leadMagnets.all()).toEqual([]);
    await db.close();
  });

  it('the schema still exists — empty is not broken', async () => {
    freshDb();
    delete process.env.FOUNDER_OS_DEMO;
    const db = await getDb();
    // A real write must succeed against an unseeded store.
    await db.funnel.insertContact({
      id: 'real-1',
      name: 'A real contact',
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
    expect((await db.funnel.journeys()).map((j) => j.id)).toEqual(['real-1']);
    await db.close();
  });

  it('opting in still seeds, so the demo and the fixtures are unchanged', async () => {
    freshDb();
    process.env.FOUNDER_OS_DEMO = '1';
    const db = await getDb();
    expect((await db.departments.all()).length).toBeGreaterThan(0);
    expect((await db.social.accounts()).length).toBeGreaterThan(0);
    await db.close();
  });
});
