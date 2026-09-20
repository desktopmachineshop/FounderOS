/**
 * Auth for the workstation worker.
 *
 * The media queue dispatches real work to a real machine, so its endpoints are
 * the one part of the OS a non-browser client talks to. The worker presents a
 * bearer token; browsers keep using the cookie gate in `lib/access-gate.ts`.
 *
 * Two properties matter more than convenience here:
 *
 *  - It fails closed. No `FOUNDER_OS_WORKER_TOKEN` means the dispatch surface
 *    is *off*, not open. An unset secret is the most likely misconfiguration
 *    on a public URL, and the expensive way to get it wrong is to treat it as
 *    "no auth required".
 *  - It refuses a weak secret. A token short enough to guess is treated as not
 *    configured at all, rather than quietly protecting nothing.
 *
 * Pure logic, no framework imports: `middleware.ts` runs on the edge runtime
 * where `node:crypto` is not available, so the comparison is hand-rolled and
 * constant-time.
 */

export const WORKER_ROUTE_PREFIX = '/api/media/';

/** Shorter than this and the token is not worth having. */
export const MIN_TOKEN_LENGTH = 16;

export type WorkerAuthResult = 'ok' | 'denied' | 'unconfigured';

/** Compare without leaking the answer through timing. */
function constantTimeEqual(a: string, b: string): boolean {
  // Length alone is not secret, but the comparison still runs over a fixed
  // span so a near-miss costs the same as a wild guess.
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Pull the credential out of an `Authorization: Bearer …` header. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

export function workerAuth(input: {
  configured: string | undefined;
  presented: string | null;
}): WorkerAuthResult {
  const secret = input.configured?.trim();
  if (!secret || secret.length < MIN_TOKEN_LENGTH) return 'unconfigured';
  if (!input.presented) return 'denied';
  return constantTimeEqual(secret, input.presented) ? 'ok' : 'denied';
}

/** Does this pathname belong to the worker API surface? */
export function isWorkerRoute(pathname: string): boolean {
  return pathname.startsWith(WORKER_ROUTE_PREFIX);
}
