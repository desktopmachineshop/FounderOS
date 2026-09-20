import { describe, expect, test } from 'vitest';
import { openDb } from '@/lib/db';
import { describeCron } from '@/lib/cron';

async function db() {
  return await openDb(':memory:');
}

describe('agentTasks repo', () => {
  test('insert + byAgent round-trips, newest first', async () => {
    const d = db();
    await (await d).agentTasks.insert({ id: 't1', agentId: 'social-agent', title: 'Draft 3 reels', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    await (await d).agentTasks.insert({ id: 't2', agentId: 'social-agent', title: 'Schedule posts', status: 'open', createdAt: '2026-06-12T02:00:00Z', updatedAt: '2026-06-12T02:00:00Z' });
    await (await d).agentTasks.insert({ id: 't3', agentId: 'crm-pulse', title: 'Other agent', status: 'open', createdAt: '2026-06-12T03:00:00Z', updatedAt: '2026-06-12T03:00:00Z' });
    const tasks = await (await d).agentTasks.byAgent('social-agent');
    expect(tasks.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  test('setStatus moves a task through open → doing → done and bumps updatedAt', async () => {
    const d = db();
    await (await d).agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    await (await d).agentTasks.setStatus('t1', 'doing', '2026-06-12T02:00:00Z');
    expect((await (await d).agentTasks.byAgent('a'))[0]).toMatchObject({ status: 'doing', updatedAt: '2026-06-12T02:00:00Z' });
    await (await d).agentTasks.setStatus('t1', 'done', '2026-06-12T03:00:00Z');
    expect((await (await d).agentTasks.byAgent('a'))[0].status).toBe('done');
  });

  test('remove deletes; invalid status rejected', async () => {
    const d = db();
    await (await d).agentTasks.insert({ id: 't1', agentId: 'a', title: 'x', status: 'open', createdAt: '2026-06-12T01:00:00Z', updatedAt: '2026-06-12T01:00:00Z' });
    await expect((await d).agentTasks.setStatus('t1', 'bogus' as never, '2026-06-12T02:00:00Z')).rejects.toThrow();
    await (await d).agentTasks.remove('t1');
    expect(await (await d).agentTasks.byAgent('a')).toHaveLength(0);
  });
});

describe('agentCrons repo', () => {
  test('insert + byAgent + toggle round-trips', async () => {
    const d = db();
    await (await d).agentCrons.insert({ id: 'c1', agentId: 'social-agent', schedule: '0 9 * * 1-5', description: 'Morning content pass', enabled: true, createdAt: '2026-06-12T01:00:00Z' });
    const crons = await (await d).agentCrons.byAgent('social-agent');
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatchObject({ schedule: '0 9 * * 1-5', enabled: true });
    await (await d).agentCrons.setEnabled('c1', false);
    expect((await (await d).agentCrons.byAgent('social-agent'))[0].enabled).toBe(false);
  });

  test('rejects malformed cron schedules at the boundary', async () => {
    const d = db();
    await expect((await d).agentCrons.insert({ id: 'c1', agentId: 'a', schedule: 'not a cron', description: 'x', enabled: true, createdAt: '2026-06-12T01:00:00Z' })).rejects.toThrow();
  });

  test('all() lists across agents; remove deletes', async () => {
    const d = db();
    await (await d).agentCrons.insert({ id: 'c1', agentId: 'a', schedule: '*/15 * * * *', description: 'x', enabled: true, createdAt: '2026-06-12T01:00:00Z' });
    await (await d).agentCrons.insert({ id: 'c2', agentId: 'b', schedule: '0 0 * * 0', description: 'y', enabled: true, createdAt: '2026-06-12T02:00:00Z' });
    expect(await (await d).agentCrons.all()).toHaveLength(2);
    await (await d).agentCrons.remove('c1');
    expect(await (await d).agentCrons.all()).toHaveLength(1);
  });
});

describe('describeCron', () => {
  test('humanizes common schedules', () => {
    expect(describeCron('0 9 * * 1-5')).toBe('at 09:00, Mon–Fri');
    expect(describeCron('*/15 * * * *')).toBe('every 15 min');
    expect(describeCron('0 * * * *')).toBe('hourly at :00');
    expect(describeCron('0 0 * * 0')).toBe('at 00:00, Sun');
    expect(describeCron('30 8 * * *')).toBe('at 08:30, daily');
  });

  test('validates field count', () => {
    expect(describeCron('0 9 * *')).toBeNull();
    expect(describeCron('banana')).toBeNull();
  });
});
