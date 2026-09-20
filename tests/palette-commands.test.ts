import { describe, expect, it } from 'vitest';
import { openDb } from '@/lib/db';
import { seedDatabase } from '@/lib/seed';
import { buildPaletteCommands } from '@/lib/palette-commands';

const STATIC = [
  { id: 'nav-home', label: 'Home', keywords: 'console', href: '/', hint: 'view' as const },
];

describe('buildPaletteCommands', () => {
  it('adds every agent and tool to the static commands', async () => {
    const db = await openDb(':memory:');
    await seedDatabase(db);
    const commands = await buildPaletteCommands(STATIC, db);

    expect(commands.slice(0, 1)).toEqual(STATIC);
    expect(commands.some((c) => c.hint === 'agent')).toBe(true);
    expect(commands.some((c) => c.hint === 'tool')).toBe(true);
    await db.close();
  });

  /**
   * This runs in the root layout, so a throw here takes down *every* page —
   * and it also runs at build time, where a private-network database is not
   * reachable at all. The palette is a navigation aid: losing the agent and
   * tool shortcuts is a fair trade for the site staying up.
   */
  it('falls back to the static commands when the database is unreachable', async () => {
    const broken = {
      agents: { all: () => Promise.reject(new Error('getaddrinfo ENOTFOUND postgres.railway.internal')) },
      tools: { all: () => Promise.reject(new Error('getaddrinfo ENOTFOUND postgres.railway.internal')) },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(buildPaletteCommands(STATIC, broken as any)).resolves.toEqual(STATIC);
  });

  it('falls back when opening the database throws outright', async () => {
    await expect(
      buildPaletteCommands(STATIC, () => Promise.reject(new Error('no database'))),
    ).resolves.toEqual(STATIC);
  });
});
