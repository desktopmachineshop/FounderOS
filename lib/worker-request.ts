import { NextResponse } from 'next/server';
import { bearerToken, workerAuth } from '@/lib/worker-auth';

/**
 * Guard for the worker endpoints. Returns a response to send when the caller
 * is not the workstation, or null to continue.
 *
 * Split from `lib/worker-auth.ts` so the decision stays pure and testable and
 * this file holds only the HTTP shape.
 */
export function requireWorker(request: Request): NextResponse | null {
  const result = workerAuth({
    configured: process.env.FOUNDER_OS_WORKER_TOKEN,
    presented: bearerToken(request.headers.get('authorization')),
  });

  if (result === 'ok') return null;
  if (result === 'unconfigured') {
    // Honest, and closed: the dispatch surface is off until a token is set.
    return NextResponse.json(
      { error: 'media worker dispatch is not configured (set FOUNDER_OS_WORKER_TOKEN)' },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
