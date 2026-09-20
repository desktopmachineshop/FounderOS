import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

/**
 * Liveness for the platform's deploy health check, and the one route the
 * access gate lets through unauthenticated.
 *
 * It answers 200 whenever the process is serving, which is exactly the
 * question a deploy check asks. Database reachability is *reported* but does
 * not fail the check: a brief Postgres blip should not convince the platform
 * that a healthy deploy is broken and roll it back.
 *
 * It carries no business data — liveness, the backend in use, and the time.
 */
export async function GET() {
  let database: 'up' | 'down' = 'down';
  let dialect: string | null = null;
  try {
    const db = await getDb();
    dialect = db.dialect;
    await db.departments.all();
    database = 'up';
  } catch {
    // Reported, not thrown — see above.
  }
  return NextResponse.json({ ok: true, database, dialect, time: new Date().toISOString() });
}
