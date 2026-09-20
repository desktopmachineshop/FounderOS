import { describe, expect, test } from 'vitest';
import { openDb } from '@/lib/db';

async function db() {
  return await openDb(':memory:');
}

describe('contactTags repo', () => {
  test('upsert + all round-trips a tagged person with tier', async () => {
    const d = db();
    await (await d).contactTags.upsert({ person: 'Jane Doe', channel: 'whatsapp', tag: 'client', tier: 1 });
    await (await d).contactTags.upsert({ person: 'Max Friend', channel: 'imessage', tag: 'friend', tier: 3 });
    const all = await (await d).contactTags.all();
    expect(all).toHaveLength(2);
    expect(all.find((t) => t.person === 'Jane Doe')).toMatchObject({ tag: 'client', tier: 1, channel: 'whatsapp' });
  });

  test('upsert replaces the tag for the same person+channel instead of duplicating', async () => {
    const d = db();
    await (await d).contactTags.upsert({ person: 'Jane Doe', channel: 'whatsapp', tag: 'lead', tier: 2 });
    await (await d).contactTags.upsert({ person: 'Jane Doe', channel: 'whatsapp', tag: 'client', tier: 1 });
    const all = await (await d).contactTags.all();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ tag: 'client', tier: 1 });
  });

  test('tier is capped at 3 — the red/yellow/green ladder', async () => {
    const d = db();
    await expect((await d).contactTags.upsert({ person: 'X', channel: 'email', tag: 'x', tier: 4 })).rejects.toThrow();
    await expect((await d).contactTags.upsert({ person: 'X', channel: 'email', tag: 'x', tier: 0 })).rejects.toThrow();
  });

  test('remove deletes a tag by person+channel', async () => {
    const d = db();
    await (await d).contactTags.upsert({ person: 'Jane Doe', channel: 'whatsapp', tag: 'client', tier: 1 });
    await (await d).contactTags.remove('Jane Doe', 'whatsapp');
    expect(await (await d).contactTags.all()).toHaveLength(0);
  });

  test('byTier filters and orders by tier ascending then person', async () => {
    const d = db();
    await (await d).contactTags.upsert({ person: 'B Client', channel: 'email', tag: 'client', tier: 1 });
    await (await d).contactTags.upsert({ person: 'A Student', channel: 'whatsapp', tag: 'student', tier: 1 });
    await (await d).contactTags.upsert({ person: 'C Friend', channel: 'whatsapp', tag: 'friend', tier: 3 });
    expect((await (await d).contactTags.byTier(1)).map((t) => t.person)).toEqual(['A Student', 'B Client']);
    expect((await (await d).contactTags.all()).map((t) => t.tier)).toEqual([1, 1, 3]);
  });
});
