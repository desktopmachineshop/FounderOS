import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getNewsletters } from '@/lib/newsletters';
import { fallbackExpenses } from '@/lib/finances';
import { fallbackMemoryGraph } from '@/lib/memory-core';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * Gating `lib/seed.ts` behind `FOUNDER_OS_DEMO` did not make the app honest.
 * Four fabricated fallbacks lived OUTSIDE that gate and still fired with demo
 * off, in the code path a real operator actually hits:
 *
 *   - `SAMPLE_EXPENSES`   — invented subscriptions, feeding the headline
 *                           "net /mo" figure on /finances
 *   - `demoMemoryGraph()` — ~120 invented notes filling the /brain constellation
 *   - `SEED_NEWSLETTERS`  — invented open/click rates on /social/beehiiv
 *   - `RECENT_POSTS`      — invented post performance on /social
 *
 * Of these, the finances one is the worst: a made-up expense total silently
 * became a net-profit number. This file is the line that keeps them gated.
 */
describe('no fabricated data survives the demo gate', () => {
  const original = process.env.FOUNDER_OS_DEMO;
  afterEach(() => {
    if (original === undefined) delete process.env.FOUNDER_OS_DEMO;
    else process.env.FOUNDER_OS_DEMO = original;
  });

  it('expenses: nothing invented when demo is off', () => {
    delete process.env.FOUNDER_OS_DEMO;
    expect(fallbackExpenses()).toEqual([]);
  });

  it('expenses: the sample is still there for the demo', () => {
    process.env.FOUNDER_OS_DEMO = '1';
    expect(fallbackExpenses().length).toBeGreaterThan(0);
  });

  it('memory graph: no invented constellation when demo is off', () => {
    delete process.env.FOUNDER_OS_DEMO;
    expect(fallbackMemoryGraph().nodes).toEqual([]);
  });

  it('memory graph: the stand-in still renders for the demo', () => {
    process.env.FOUNDER_OS_DEMO = '1';
    expect(fallbackMemoryGraph().nodes.length).toBeGreaterThan(0);
  });

  it('newsletters: no invented sends when demo is off and no key is set', async () => {
    delete process.env.FOUNDER_OS_DEMO;
    expect(await getNewsletters({})).toEqual([]);
  });

  it('newsletters: the seeded set still backs the demo', async () => {
    process.env.FOUNDER_OS_DEMO = '1';
    expect((await getNewsletters({})).length).toBeGreaterThan(0);
  });
});

/**
 * `/social` keeps its sample posts in the page file itself, so there is no
 * function to call — the guard is that the literal is reached only through the
 * gate. Asserted on source, which is how this repo tests components.
 */
describe('the /social sample posts are gated too', () => {
  it('RECENT_POSTS is only used behind demoDataEnabled', () => {
    const src = read('app/social/page.tsx');
    expect(src).toContain('demoDataEnabled');
    // Every use of the literal must sit behind the gate, never as a bare
    // `: RECENT_POSTS` fallback the way it did before.
    expect(src).not.toMatch(/:\s*RECENT_POSTS\b/);
  });
});

/**
 * /doctor printed two figures as if they were readouts — `1240 pages / 15k
 * chunks` and a hardcoded CLI version — when both were string literals in JSX.
 * A fake number wearing the costume of a measurement is the exact thing this
 * whole effort is about.
 */
describe('/doctor states no invented measurements', () => {
  const src = read('app/doctor/page.tsx');

  it('does not hardcode a page/chunk count', () => {
    expect(src).not.toMatch(/1240\s*pages/);
    expect(src).not.toMatch(/15k\s*chunks/);
  });

  it('does not hardcode a gbrain version', () => {
    expect(src).not.toMatch(/v0\.41/);
  });
});

/**
 * /analytics synthesized its chart shapes from a hash of the metric name:
 *
 *   const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
 *
 * — a sparkline per tile and, worse, "deterministic rising bars per channel"
 * for every platform card. Those bars trend upward by construction, whatever
 * the underlying number does. A chart that always rises is not a chart.
 */
describe('/analytics draws no invented trends', () => {
  const src = read('app/analytics/page.tsx');

  it('has no hash-derived series generators', () => {
    expect(src).not.toContain('charCodeAt');
    expect(src).not.toMatch(/function sparkFor|function barsFor/);
  });

  it('does not describe its own output as deterministic filler', () => {
    expect(src).not.toMatch(/deterministic (rising )?(spark|bars)/i);
  });
});

/**
 * The seed's Knowledge rows described a G-Brain install that does not exist —
 * `tool-gbrain` marked `connected` with "v0.41 … Live", `tool-zeroentropy`
 * naming a config path that is not there, and `tool-supabase` quoting
 * "1240 pages / 15k chunks": the SAME invented figure this file already bans
 * on /doctor, which had simply survived one file over.
 *
 * They were inherited from upstream and described its author's machine. Demo
 * rows may be illustrative; they may not assert a specific live personal setup,
 * because that is what a reader — human or agent — acts on.
 */
describe('the seed does not claim a G-Brain that is not installed', () => {
  const seed = read('lib/seed.ts');

  it('no invented page or chunk counts', () => {
    expect(seed).not.toMatch(/1240\s*pages/);
    expect(seed).not.toMatch(/15k\s*chunks/);
  });

  it('no credential paths are asserted as present', () => {
    expect(seed).not.toContain('~/.config/knowledge/config.json');
  });

  it('the brain stack is offered, not claimed as live', () => {
    for (const id of ['tool-gbrain', 'tool-zeroentropy', 'tool-brain-store']) {
      const row = seed.split('\n').find((l) => l.includes(`id: '${id}'`));
      expect(row, `${id} row missing`).toBeTruthy();
      expect(row, `${id} must not claim connected`).not.toContain("status: 'connected'");
    }
  });
});
