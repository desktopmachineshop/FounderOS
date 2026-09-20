/**
 * Is demo data switched on?
 *
 * Upstream seeds every table on first touch so a fresh clone "boots looking
 * alive". For an operator's own dashboard that is a hazard, not a feature: a
 * seeded revenue figure is indistinguishable from a real one at a glance. So
 * seeding, and every other fabricated fallback, is opt-in and **off by
 * default**.
 *
 * Only explicit truthy spellings count. `FOUNDER_OS_DEMO=false` must not enable
 * demo data — a variable set to a falsy word is the likeliest way for someone
 * to believe they turned it off.
 *
 * This lives in its own module, with NO imports, because the fallbacks it gates
 * sit in files that client components load (`lib/memory-core.ts` feeds
 * `components/BrainGraphView.tsx`). Reaching it through `lib/data.ts` would
 * pull better-sqlite3 into the browser bundle and fail the build.
 */
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function demoDataEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return TRUTHY.has((env.FOUNDER_OS_DEMO ?? '').trim().toLowerCase());
}
