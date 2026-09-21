import { NextResponse } from 'next/server';
import { getDb, invalidateDb } from '@/lib/data';
import { healthVerdict, nextDownSince } from '@/lib/health';

export const dynamic = 'force-dynamic';

/**
 * Liveness for the platform's deploy health check, and the one route the
 * access gate lets through unauthenticated.
 *
 * It answers 200 through a *brief* database failure, because a Postgres blip
 * should not convince the platform that a healthy deploy is broken. It stops
 * doing so once the database has been unreachable for DB_DOWN_GRACE_MS: on
 * 2026-09-21 the production database was wiped while the app was running, and
 * this endpoint reported `200 {"ok":true,"database":"down"}` for a day while
 * the platform stayed satisfied and the logs said nothing.
 *
 * A failed read also invalidates the memoized handle, so the next probe opens
 * a fresh connection. That makes the platform's own health check the thing
 * that recovers the instance — the outage above needed a manual restart.
 *
 * It carries no business data — liveness, the backend in use, and the time.
 */
let downSince: number | null = null;

export async function GET() {
  const now = Date.now();
  let up = false;
  let dialect: string | null = null;

  try {
    const db = await getDb();
    dialect = db.dialect;
    await db.departments.all();
    up = true;
  } catch {
    // Reported, not thrown. Drop the handle so the next request reconnects
    // instead of reusing a pool that is already dead.
    await invalidateDb();
  }

  downSince = nextDownSince(up, downSince, now);
  const verdict = healthVerdict({ up, downSince, now });

  return NextResponse.json(
    {
      ok: verdict.ok,
      database: verdict.database,
      dialect,
      ...(verdict.downForMs === null ? {} : { downForMs: verdict.downForMs }),
      time: new Date(now).toISOString(),
    },
    { status: verdict.status },
  );
}
