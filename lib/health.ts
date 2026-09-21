/**
 * How long the database may be unreachable before the instance stops calling
 * itself healthy.
 *
 * This endpoint deliberately reports database trouble without failing: a brief
 * Postgres blip should not convince the platform to roll back a deploy that is
 * serving fine. But that reasoning only covered *transient* failures, and a
 * persistent one was invisible — when the production database was wiped on
 * 2026-09-21 the app held a dead pool for a day while the check answered
 * `200 {"ok":true,"database":"down"}` and the platform stayed satisfied.
 *
 * A minute is the compromise: longer than a database restart, short enough
 * that a real outage is noticed the same minute it starts.
 */
export const DB_DOWN_GRACE_MS = 60_000;

/**
 * When the current run of failures began, or null while healthy.
 *
 * The original time is kept for as long as the failures continue — restarting
 * the clock on every probe would mean the grace window never elapses, and a
 * permanent outage would look like an unbroken run of blips.
 */
export function nextDownSince(up: boolean, downSince: number | null, now: number): number | null {
  if (up) return null;
  return downSince ?? now;
}

export type HealthInput = {
  up: boolean;
  downSince: number | null;
  now: number;
};

export type HealthVerdict = {
  ok: boolean;
  status: number;
  database: 'up' | 'down';
  /** How long the database has been unreachable, or null while healthy. */
  downForMs: number | null;
};

export function healthVerdict({ up, downSince, now }: HealthInput): HealthVerdict {
  if (up) return { ok: true, status: 200, database: 'up', downForMs: null };

  // A missing clock is treated as "just now", never as an infinite outage —
  // otherwise a first failed probe with no recorded start would take the
  // instance down. A clock in the future clamps to zero for the same reason.
  const downForMs = downSince === null ? 0 : Math.max(0, now - downSince);
  const sustained = downForMs >= DB_DOWN_GRACE_MS;
  return {
    ok: !sustained,
    status: sustained ? 503 : 200,
    database: 'down',
    downForMs,
  };
}
