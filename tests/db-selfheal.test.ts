import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb, invalidateDb, resetDb } from '@/lib/data';

/**
 * `getDb()` memoizes its handle, and used to discard it only if the *initial*
 * open threw. A connection that died later was cached forever.
 *
 * That is not hypothetical. The production database was wiped on 2026-09-21
 * while the app was running; it had opened successfully the previous evening,
 * so every request for the next day used a pool pointing at something that no
 * longer existed. Only a manual restart cleared it.
 *
 * `invalidateDb()` is the escape hatch: drop the handle so the next caller
 * opens a fresh one. The health route calls it whenever its read fails, so the
 * platform's own probe is what heals the instance — no human required.
 */
describe('invalidateDb', () => {
  const originalDb = process.env.FOUNDER_OS_DB;

  afterEach(() => {
    resetDb();
    if (originalDb === undefined) delete process.env.FOUNDER_OS_DB;
    else process.env.FOUNDER_OS_DB = originalDb;
  });

  const freshStore = () => {
    resetDb();
    process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'selfheal-')), 'test.db');
  };

  it('the handle is shared until something invalidates it', async () => {
    freshStore();
    const a = await getDb();
    const b = await getDb();
    expect(a).toBe(b);
    await a.close();
  });

  it('after invalidation the next caller gets a new handle', async () => {
    freshStore();
    const before = await getDb();
    await invalidateDb();
    const after = await getDb();
    expect(after).not.toBe(before);
    await after.close();
  });

  /**
   * The point of the whole change: a store that breaks and is then invalidated
   * must come back by itself, without a restart.
   */
  it('the fresh handle works — recovery is real, not just a new object', async () => {
    freshStore();
    const before = await getDb();
    await before.close(); // simulate the connection dying underneath us
    await invalidateDb();

    const after = await getDb();
    expect(await after.departments.all()).toEqual([]); // a real read, not a throw
    await after.close();
  });

  it('invalidating when nothing is open is harmless', async () => {
    resetDb();
    await expect(invalidateDb()).resolves.toBeUndefined();
  });

  /**
   * Invalidation must not depend on the old handle closing cleanly — a broken
   * pool may well throw on close, and swallowing that is the entire point.
   */
  it('a handle that throws on close still gets dropped', async () => {
    freshStore();
    const before = await getDb();
    await before.close();
    await before.close().catch(() => {}); // already closed; may reject
    await expect(invalidateDb()).resolves.toBeUndefined();
    const after = await getDb();
    expect(after).not.toBe(before);
    await after.close();
  });
});
