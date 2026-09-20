import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const TOKEN = 'worker-token-abcdef0123456789';

// Routes read the DB path at first access, so point them at a fresh temp DB
// before the route modules are imported.
beforeEach(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'media-jobs-')), 'test.db');
  process.env.FOUNDER_OS_WORKER_TOKEN = TOKEN;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.FOUNDER_OS_WORKER_TOKEN;
});

const post = (url: string, body: unknown, token?: string) =>
  new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

const renderSpec = {
  kind: 'render',
  composition: 'ReelKit',
  props: { title: 'Hook' },
  output: 'clips/hook.mp4',
};

describe('media job routes', () => {
  it('queues a job, hands it to the worker, and takes the result back', async () => {
    const { POST: enqueue, GET: list } = await import('@/app/api/media/jobs/route');
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const { POST: complete } = await import('@/app/api/media/jobs/[id]/complete/route');

    const created = await enqueue(
      post('http://x/api/media/jobs', { spec: renderSpec, requestedBy: 'reelkit-editor' }),
    );
    expect(created.status).toBe(201);
    const { job } = await created.json();
    expect(job.status).toBe('queued');

    const claimed = await claim(
      post('http://x/api/media/jobs/claim', { workerId: 'mac-studio' }, TOKEN),
    );
    expect(claimed.status).toBe(200);
    expect((await claimed.json()).job.id).toBe(job.id);

    const done = await complete(
      post(`http://x/api/media/jobs/${job.id}/complete`, { result: { output: 'clips/hook.mp4' } }, TOKEN),
      { params: { id: job.id } },
    );
    expect(done.status).toBe(200);
    expect((await done.json()).job.status).toBe('done');

    const board = await list(new Request('http://x/api/media/jobs?status=done'));
    expect((await board.json()).jobs.map((j: { id: string }) => j.id)).toEqual([job.id]);
  });

  it('refuses a claim with no token', async () => {
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const res = await claim(post('http://x/api/media/jobs/claim', { workerId: 'w' }));
    expect(res.status).toBe(401);
  });

  it('refuses a claim with the wrong token', async () => {
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const res = await claim(post('http://x/api/media/jobs/claim', { workerId: 'w' }, 'nope'));
    expect(res.status).toBe(401);
  });

  // Fails closed: with no token configured the dispatch surface is off, and
  // says so, rather than accepting anonymous work.
  it('is unavailable — not open — when no worker token is configured', async () => {
    delete process.env.FOUNDER_OS_WORKER_TOKEN;
    vi.resetModules();
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const res = await claim(post('http://x/api/media/jobs/claim', { workerId: 'w' }, 'anything'));
    expect(res.status).toBe(503);
  });

  it('rejects a spec it does not recognise', async () => {
    const { POST: enqueue } = await import('@/app/api/media/jobs/route');
    const res = await enqueue(
      post('http://x/api/media/jobs', { spec: { kind: 'shell', command: 'rm -rf /' } }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects a path that tries to escape the media root', async () => {
    const { POST: enqueue } = await import('@/app/api/media/jobs/route');
    const res = await enqueue(
      post('http://x/api/media/jobs', { spec: { ...renderSpec, output: '../../etc/cron.d/x' } }),
    );
    expect(res.status).toBe(400);
  });

  it('409s a completion for a job nobody claimed', async () => {
    const { POST: enqueue } = await import('@/app/api/media/jobs/route');
    const { POST: complete } = await import('@/app/api/media/jobs/[id]/complete/route');
    const { job } = await (await enqueue(post('http://x/api/media/jobs', { spec: renderSpec }))).json();

    const res = await complete(
      post(`http://x/api/media/jobs/${job.id}/complete`, { result: {} }, TOKEN),
      { params: { id: job.id } },
    );
    expect(res.status).toBe(409);
  });

  it('requeues a failure that still has attempts left', async () => {
    const { POST: enqueue } = await import('@/app/api/media/jobs/route');
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const { POST: fail } = await import('@/app/api/media/jobs/[id]/fail/route');

    const { job } = await (
      await enqueue(post('http://x/api/media/jobs', { spec: renderSpec, maxAttempts: 2 }))
    ).json();
    await claim(post('http://x/api/media/jobs/claim', { workerId: 'w' }, TOKEN));

    const res = await fail(
      post(`http://x/api/media/jobs/${job.id}/fail`, { error: 'remotion exited 1' }, TOKEN),
      { params: { id: job.id } },
    );
    const body = await res.json();
    expect(body.job.status).toBe('queued');
    expect(body.job.attempts).toBe(1);
  });

  it('returns a null job when the queue is empty', async () => {
    const { POST: claim } = await import('@/app/api/media/jobs/claim/route');
    const res = await claim(post('http://x/api/media/jobs/claim', { workerId: 'w' }, TOKEN));
    expect(res.status).toBe(200);
    expect((await res.json()).job).toBeNull();
  });
});
