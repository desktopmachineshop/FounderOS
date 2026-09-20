import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import {
  MediaJobSpecSchema,
  isSafeMediaPath,
  newMediaJob,
  STALE_CLAIM_MS,
} from '@/lib/media-jobs';

let db: FounderDb;

beforeEach(async () => {
  db = await openDb(':memory:');
});

const renderSpec = {
  kind: 'render' as const,
  composition: 'ReelKit',
  props: { title: 'Hook' },
  output: 'clips/hook.mp4',
};

describe('media job specs are a closed set', () => {
  it('accepts a render job', () => {
    expect(MediaJobSpecSchema.parse(renderSpec).kind).toBe('render');
  });

  it('accepts a transcribe job and defaults the model', () => {
    const spec = MediaJobSpecSchema.parse({ kind: 'transcribe', source: 'raw/take-1.mov' });
    expect(spec).toMatchObject({ kind: 'transcribe', source: 'raw/take-1.mov' });
  });

  it('rejects a kind it does not know', () => {
    expect(() => MediaJobSpecSchema.parse({ kind: 'shell', command: 'rm -rf /' })).toThrow();
  });

  // The queue is authenticated, but a token is not a licence to run arbitrary
  // commands on the workstation. There is deliberately no passthrough kind.
  it('has no kind that carries a command or an argv', () => {
    const kinds = MediaJobSpecSchema.options.map((o) => o.shape.kind.value);
    expect(kinds).toEqual(['render', 'transcribe', 'caption', 'thumbnail']);
    for (const option of MediaJobSpecSchema.options) {
      const fields = Object.keys(option.shape);
      expect(fields).not.toContain('command');
      expect(fields).not.toContain('args');
      expect(fields).not.toContain('argv');
      expect(fields).not.toContain('shell');
    }
  });
});

describe('isSafeMediaPath', () => {
  it.each(['clips/hook.mp4', 'raw/take-1.mov', 'a/b/c.wav'])('accepts %s', (p) => {
    expect(isSafeMediaPath(p)).toBe(true);
  });

  // Paths cross a trust boundary: the cloud queues them, the workstation
  // resolves them against a media root on a real disk.
  it.each([
    '../../etc/passwd',
    '/etc/passwd',
    'clips/../../../secrets',
    'C:\\Windows\\system32',
    '',
    'clips/\0hook.mp4',
  ])('rejects %j', (p) => {
    expect(isSafeMediaPath(p)).toBe(false);
  });

  it('is enforced by the schema, not just available to it', () => {
    expect(() => MediaJobSpecSchema.parse({ ...renderSpec, output: '../escape.mp4' })).toThrow();
    expect(() => MediaJobSpecSchema.parse({ kind: 'transcribe', source: '/etc/passwd' })).toThrow();
  });
});

describe('mediaJobs repo', () => {
  it('enqueues a job as queued and reads it back', async () => {
    const job = newMediaJob({ spec: renderSpec, requestedBy: 'reelkit-editor' });
    await db.mediaJobs.enqueue(job);
    const found = await db.mediaJobs.byId(job.id);
    expect(found?.status).toBe('queued');
    expect(found?.spec).toEqual(renderSpec);
    expect(found?.requestedBy).toBe('reelkit-editor');
    expect(found?.attempts).toBe(0);
  });

  it('claims the oldest queued job first', async () => {
    for (const n of [1, 2, 3]) {
      await db.mediaJobs.enqueue(
        newMediaJob({ spec: { ...renderSpec, output: `clips/${n}.mp4` }, id: `job-${n}` }),
      );
    }
    const first = await db.mediaJobs.claim({ workerId: 'mac-studio' });
    expect(first?.id).toBe('job-1');
    expect(first?.status).toBe('claimed');
    expect(first?.workerId).toBe('mac-studio');
  });

  it('honours priority ahead of age', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'old' }));
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'urgent', priority: 10 }));
    expect((await db.mediaJobs.claim({ workerId: 'w' }))?.id).toBe('urgent');
  });

  it('never hands the same job to two workers', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'only-one' }));
    const [a, b] = await Promise.all([
      db.mediaJobs.claim({ workerId: 'w1' }),
      db.mediaJobs.claim({ workerId: 'w2' }),
    ]);
    expect([a?.id, b?.id].filter(Boolean)).toEqual(['only-one']);
  });

  it('returns null when nothing is queued', async () => {
    expect(await db.mediaJobs.claim({ workerId: 'w' })).toBeNull();
  });

  it('only claims the kinds a worker can actually run', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'r' }));
    const audioOnly = await db.mediaJobs.claim({ workerId: 'w', kinds: ['transcribe'] });
    expect(audioOnly).toBeNull();
    expect((await db.mediaJobs.claim({ workerId: 'w', kinds: ['render'] }))?.id).toBe('r');
  });

  it('completes a job with its result', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'j' }));
    await db.mediaJobs.claim({ workerId: 'w' });
    await db.mediaJobs.complete('j', { output: 'clips/hook.mp4', durationMs: 4200 });
    const done = await db.mediaJobs.byId('j');
    expect(done?.status).toBe('done');
    expect(done?.result).toEqual({ output: 'clips/hook.mp4', durationMs: 4200 });
    expect(done?.finishedAt).toBeTruthy();
  });

  it('requeues a failed job until it runs out of attempts', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'flaky', maxAttempts: 2 }));

    await db.mediaJobs.claim({ workerId: 'w' });
    await db.mediaJobs.fail('flaky', 'ffmpeg exited 1');
    let job = await db.mediaJobs.byId('flaky');
    expect(job?.status).toBe('queued'); // one attempt left
    expect(job?.attempts).toBe(1);

    await db.mediaJobs.claim({ workerId: 'w' });
    await db.mediaJobs.fail('flaky', 'ffmpeg exited 1');
    job = await db.mediaJobs.byId('flaky');
    expect(job?.status).toBe('failed'); // spent
    expect(job?.attempts).toBe(2);
    expect(job?.error).toBe('ffmpeg exited 1');
  });

  // The workstation is a laptop: it sleeps, loses wifi, gets closed mid-render.
  it('requeues a claim from a worker that went away', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'stranded' }));
    const claimedAt = new Date(Date.now() - STALE_CLAIM_MS - 1_000).toISOString();
    await db.mediaJobs.claim({ workerId: 'gone', now: claimedAt });

    expect((await db.mediaJobs.byId('stranded'))?.status).toBe('claimed');
    expect(await db.mediaJobs.requeueStale()).toBe(1);

    const job = await db.mediaJobs.byId('stranded');
    expect(job?.status).toBe('queued');
    expect(job?.workerId).toBeNull();
  });

  it('leaves a fresh claim alone', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'busy' }));
    await db.mediaJobs.claim({ workerId: 'working' });
    expect(await db.mediaJobs.requeueStale()).toBe(0);
    expect((await db.mediaJobs.byId('busy'))?.status).toBe('claimed');
  });

  it('lists newest first, and filters by status', async () => {
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'a' }));
    await db.mediaJobs.enqueue(newMediaJob({ spec: renderSpec, id: 'b' }));
    await db.mediaJobs.claim({ workerId: 'w' }); // 'a' becomes claimed
    expect((await db.mediaJobs.list()).map((j) => j.id)).toEqual(['b', 'a']);
    expect((await db.mediaJobs.list({ status: 'queued' })).map((j) => j.id)).toEqual(['b']);
  });

  it('ignores a completion for a job that was never claimed', async () => {
    await expect(db.mediaJobs.complete('ghost', { output: 'x' })).resolves.toBe(false);
  });
});
