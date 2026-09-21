import { describe, expect, it } from 'vitest';
import { DB_DOWN_GRACE_MS, healthVerdict, nextDownSince } from '@/lib/health';

/**
 * The health check has to answer two different questions with one response.
 *
 * The platform asks "should I roll this deploy back?" — and a two-second
 * Postgres blip must not be enough to say yes. So brief failures keep
 * returning 200, which is why this endpoint was written to report database
 * trouble without failing.
 *
 * But that made a *persistent* failure invisible. When the production database
 * was wiped on 2026-09-21, the app held a dead connection pool for a day while
 * `/api/health` answered `200 {"ok":true,"database":"down"}` the whole time.
 * Railway was perfectly happy. Nothing in the logs said otherwise. "Down for
 * two seconds" and "down for a day" were indistinguishable from outside.
 *
 * So the verdict is now a function of *how long* it has been down.
 */
describe('nextDownSince', () => {
  it('a healthy read clears the clock', () => {
    expect(nextDownSince(true, 1000, 5000)).toBeNull();
    expect(nextDownSince(true, null, 5000)).toBeNull();
  });

  it('the first failure starts the clock', () => {
    expect(nextDownSince(false, null, 5000)).toBe(5000);
  });

  /**
   * The clock must not restart on every probe, or the grace window never
   * elapses and a permanent outage looks like an unbroken run of blips —
   * exactly the failure this is here to catch.
   */
  it('a continuing failure keeps the original time', () => {
    expect(nextDownSince(false, 1000, 999_999)).toBe(1000);
  });
});

describe('healthVerdict', () => {
  it('a working database is healthy', () => {
    const v = healthVerdict({ up: true, downSince: null, now: 10_000 });
    expect(v).toMatchObject({ ok: true, status: 200, database: 'up', downForMs: null });
  });

  it('a brief outage still passes, so a blip cannot trigger a rollback', () => {
    const v = healthVerdict({ up: false, downSince: 10_000, now: 12_000 });
    expect(v.ok).toBe(true);
    expect(v.status).toBe(200);
    expect(v.database).toBe('down');
    expect(v.downForMs).toBe(2000);
  });

  it('a sustained outage fails the check, so the platform finally notices', () => {
    const v = healthVerdict({ up: false, downSince: 0, now: DB_DOWN_GRACE_MS + 1 });
    expect(v.ok).toBe(false);
    expect(v.status).toBe(503);
    expect(v.downForMs).toBe(DB_DOWN_GRACE_MS + 1);
  });

  it('the boundary is inclusive — at the grace mark it is already too long', () => {
    expect(healthVerdict({ up: false, downSince: 0, now: DB_DOWN_GRACE_MS }).ok).toBe(false);
    expect(healthVerdict({ up: false, downSince: 0, now: DB_DOWN_GRACE_MS - 1 }).ok).toBe(true);
  });

  /**
   * A grace window long enough to hide a real outage defeats the purpose; one
   * shorter than a database restart causes the rollbacks this was avoiding.
   */
  it('the grace window is a minute — long enough for a restart, short enough to matter', () => {
    expect(DB_DOWN_GRACE_MS).toBe(60_000);
  });

  it('down with no recorded start is treated as just-now, never as forever', () => {
    // Defensive: a missing clock must not read as an infinite outage and take
    // the instance down on its first failed probe.
    const v = healthVerdict({ up: false, downSince: null, now: 50_000 });
    expect(v.ok).toBe(true);
    expect(v.downForMs).toBe(0);
  });

  it('a clock in the future cannot produce a negative duration', () => {
    expect(healthVerdict({ up: false, downSince: 9_000, now: 5_000 }).downForMs).toBe(0);
  });
});
