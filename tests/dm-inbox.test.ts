import { afterEach, describe, expect, test } from 'vitest';
import { openDb, type FounderDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { dmThreads } from '@/lib/social';
import type { SocialDmMessage } from '@/lib/schemas';

let db: FounderDb;
afterEach(() => db?.close());

function msg(over: Partial<SocialDmMessage> = {}): SocialDmMessage {
  return {
    id: 'm1',
    platform: 'instagram',
    subscriberId: 's1',
    name: 'Alex Rivera',
    handle: 'alex.rivera',
    text: 'hey',
    direction: 'in',
    tag: null,
    ts: '2026-07-18T10:00:00.000Z',
    source: 'seed',
    ...over,
  };
}

describe('social.dmMessages', () => {
  test('round-trips a DM message and orders newest first', async () => {
    db = await openDb(':memory:');
    await db.social.upsertDmMessage(msg({ id: 'm1', ts: '2026-07-18T10:00:00.000Z' }));
    await db.social.upsertDmMessage(msg({ id: 'm2', text: 'you there?', ts: '2026-07-18T11:00:00.000Z' }));
    expect((await db.social.dmMessages()).map((m) => m.id)).toEqual(['m2', 'm1']);
  });

  test('upsert replaces by id', async () => {
    db = await openDb(':memory:');
    await db.social.upsertDmMessage(msg({ id: 'm1', text: 'first' }));
    await db.social.upsertDmMessage(msg({ id: 'm1', text: 'edited' }));
    const all = await db.social.dmMessages();
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('edited');
  });

  test('filters by platform', async () => {
    db = await openDb(':memory:');
    await db.social.upsertDmMessage(msg({ id: 'ig', platform: 'instagram' }));
    await db.social.upsertDmMessage(msg({ id: 'tt', platform: 'tiktok' }));
    expect((await db.social.dmMessages('instagram')).map((m) => m.id)).toEqual(['ig']);
  });

  test('seed ships a realistic multi-conversation Instagram DM inbox', async () => {
    db = await openDb(':memory:');
    await seedDatabase(db);
    const msgs = await db.social.dmMessages('instagram');
    expect(msgs.length).toBeGreaterThan(3);
    expect(msgs.every((m) => m.platform === 'instagram')).toBe(true);
    // more than one conversation, and both inbound + outbound present
    expect(new Set(msgs.map((m) => m.subscriberId)).size).toBeGreaterThan(1);
    expect(msgs.some((m) => m.direction === 'in')).toBe(true);
    expect(msgs.some((m) => m.direction === 'out')).toBe(true);
  });
});

describe('dmThreads', () => {
  test('groups messages into conversations, newest thread first, chronological within', async () => {
    db = await openDb(':memory:');
    await db.social.upsertDmMessage(msg({ id: 'a1', subscriberId: 'A', text: 'hi', ts: '2026-07-18T09:00:00.000Z' }));
    await db.social.upsertDmMessage(msg({ id: 'a2', subscriberId: 'A', text: 'still there?', ts: '2026-07-18T09:05:00.000Z' }));
    await db.social.upsertDmMessage(msg({ id: 'b1', subscriberId: 'B', name: 'Bo', text: 'yo', ts: '2026-07-18T10:00:00.000Z' }));

    const threads = dmThreads(db);
    expect((await threads).map((t) => t.subscriberId)).toEqual(['B', 'A']); // B is more recent
    expect((await threads)[1].messages.map((m) => m.id)).toEqual(['a1', 'a2']); // chronological
    expect((await threads)[1].last.id).toBe('a2');
  });

  test('marks a thread unreplied when the last message is inbound', async () => {
    db = await openDb(':memory:');
    await db.social.upsertDmMessage(msg({ id: 'x1', subscriberId: 'X', direction: 'in', ts: '2026-07-18T09:00:00.000Z' }));
    await db.social.upsertDmMessage(msg({ id: 'y1', subscriberId: 'Y', direction: 'in', ts: '2026-07-18T09:10:00.000Z' }));
    await db.social.upsertDmMessage(msg({ id: 'y2', subscriberId: 'Y', direction: 'out', ts: '2026-07-18T09:20:00.000Z' }));

    const byId = Object.fromEntries((await dmThreads(db)).map((t) => [t.subscriberId, t]));
    expect(byId['X'].unreplied).toBe(true);
    expect(byId['Y'].unreplied).toBe(false);
  });
});
