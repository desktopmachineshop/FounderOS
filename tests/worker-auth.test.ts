import { describe, expect, it } from 'vitest';
import {
  isWorkerRoute,
  workerAuth,
  bearerToken,
  WORKER_ROUTE_PREFIX,
} from '@/lib/worker-auth';

describe('bearerToken', () => {
  it('reads the token out of an Authorization header', () => {
    expect(bearerToken('Bearer abc123')).toBe('abc123');
    expect(bearerToken('bearer abc123')).toBe('abc123');
  });

  it('is null for anything that is not a bearer header', () => {
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken('')).toBeNull();
    expect(bearerToken('Basic abc123')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
  });
});

const SECRET = 'worker-token-abcdef0123456789';

describe('workerAuth', () => {
  // Fails closed. An unset token must not mean "anyone may dispatch work to
  // the workstation" — it means the dispatch surface is switched off.
  it('is unconfigured when no token is set, whatever the caller presents', () => {
    expect(workerAuth({ configured: undefined, presented: 'anything' })).toBe('unconfigured');
    expect(workerAuth({ configured: '', presented: 'anything' })).toBe('unconfigured');
    expect(workerAuth({ configured: '   ', presented: 'anything' })).toBe('unconfigured');
  });

  it('accepts the exact token', () => {
    expect(workerAuth({ configured: SECRET, presented: SECRET })).toBe('ok');
  });

  it('denies a wrong, absent, or near-miss token', () => {
    expect(workerAuth({ configured: SECRET, presented: 'wrong' })).toBe('denied');
    expect(workerAuth({ configured: SECRET, presented: null })).toBe('denied');
    expect(workerAuth({ configured: SECRET, presented: '' })).toBe('denied');
    expect(workerAuth({ configured: SECRET, presented: SECRET.slice(0, -1) })).toBe('denied');
    expect(workerAuth({ configured: SECRET, presented: `${SECRET}x` })).toBe('denied');
    expect(workerAuth({ configured: SECRET, presented: SECRET.toUpperCase() })).toBe('denied');
  });

  it('rejects a short token, so a weak secret cannot be configured by accident', () => {
    expect(workerAuth({ configured: 'short', presented: 'short' })).toBe('unconfigured');
  });
});

describe('isWorkerRoute', () => {
  it('matches the worker API surface only', () => {
    expect(isWorkerRoute(`${WORKER_ROUTE_PREFIX}claim`)).toBe(true);
    expect(isWorkerRoute(`${WORKER_ROUTE_PREFIX}abc/complete`)).toBe(true);
    expect(isWorkerRoute('/api/agents')).toBe(false);
    expect(isWorkerRoute('/')).toBe(false);
  });

  // The gate is the app's front door; a path that merely looks like the worker
  // surface must not slip past it.
  it('is not fooled by a lookalike path', () => {
    expect(isWorkerRoute('/evil/api/media/jobs/claim')).toBe(false);
    expect(isWorkerRoute('/api/mediaX/jobs')).toBe(false);
    expect(isWorkerRoute('/api/media')).toBe(false);
  });
});
