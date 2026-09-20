import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PAGES, coversEveryPage } from './page-registry';

/**
 * **The acceptance test for turning a demo into a real instance.**
 *
 * Upstream seeded every table on first touch, so every page was written on the
 * assumption that rows exist. Demo data is now gated behind `FOUNDER_OS_DEMO`
 * (off by default), which means an operator's fresh instance starts EMPTY —
 * and a page that assumes rows either crashes, 404s, or renders a confident
 * zero it did not earn.
 *
 * Its twin, `smoke.test.ts`, renders the same pages WITH demo data. Both draw
 * from `page-registry.ts`, so a new page cannot be covered by one and missed by
 * the other.
 *
 * Deliberately NOT asserted here: that a page renders a particular empty state.
 * This is a does-it-survive net. What each view should *say* when it has
 * nothing is a per-view decision, tested where that decision lives.
 */
beforeAll(() => {
  process.env.FOUNDER_OS_DB = path.join(mkdtempSync(path.join(tmpdir(), 'founder-os-empty-')), 'test.db');
  // The whole point: no demo data. Deleted rather than set to a falsy string,
  // so this cannot pass by accident if the gate's parsing ever loosens.
  delete process.env.FOUNDER_OS_DEMO;
  process.env.FUNNEL_PROVIDER = 'seed';
  process.env.GBRAIN_BIN = path.join(tmpdir(), 'founder-os-no-gbrain-cli');
});

describe('empty-store smoke — every page renders with nothing in the database', () => {
  test.each(PAGES)('$file renders on an empty store', async ({ load, props }) => {
    const mod = await load();
    const Page = mod.default;
    await expect(Promise.resolve(Page(props))).resolves.toBeTruthy();
  }, 20_000);

  test('the empty-store net covers every app/**/page.tsx (no page escapes)', () => {
    const { covered, discovered } = coversEveryPage();
    expect(covered).toEqual(discovered);
  });
});
