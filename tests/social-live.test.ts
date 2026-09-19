import { afterEach, describe, expect, it } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { syncFromZernioLive } from '@/lib/social-live';

let db: FounderDb;
afterEach(() => db?.close());

const LIVE = {
  instagram: { handle: '@founderos.ai', followers: 41200 },
  tiktok: { handle: '@founderos.ai', followers: 8600 },
  youtube: { handle: '@founderosai', followers: 920 },
  facebook: { handle: 'Alex Rivera', followers: 42 }, // untracked -> skipped
};

describe('syncFromZernioLive', () => {
  it('snapshots live follower counts for tracked platforms', async () => {
    db = await openDb(':memory:');
    const recorded = await syncFromZernioLive(db, { today: '2026-06-19', source: async () => LIVE });
    expect(recorded).toBe(3); // facebook is not a tracked platform
    expect(await db.social.snapshots('instagram')).toEqual([
      { platform: 'instagram', capturedAt: '2026-06-19', followers: 41200, source: 'zernio-config' },
    ]);
    expect((await db.social.snapshots('youtube'))[0].followers).toBe(920);
  });

  it('falls back to the static config when the live API yields nothing', async () => {
    db = await openDb(':memory:');
    const recorded = await syncFromZernioLive(db, {
      today: '2026-06-19',
      source: async () => ({}),
      fallback: () => ({ twitter: { followers: 3350 } }),
    });
    expect(recorded).toBe(1);
    expect((await db.social.snapshots('twitter'))[0].followers).toBe(3350);
  });

  it('falls back when the live API throws', async () => {
    db = await openDb(':memory:');
    const recorded = await syncFromZernioLive(db, {
      today: '2026-06-19',
      source: async () => {
        throw new Error('network down');
      },
      fallback: () => ({ linkedin: { followers: 1510 } }),
    });
    expect(recorded).toBe(1);
    expect((await db.social.snapshots('linkedin'))[0].followers).toBe(1510);
  });
});
