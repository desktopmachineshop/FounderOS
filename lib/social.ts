import type { FounderDb } from '@/lib/db';
import { zernioAccounts } from '@/lib/connectors/zernio';
import { growthOver, growthAllTime, windowDelta, mergeSeriesSum, type GrowthPoint } from '@/lib/growth';
import {
  SocialDashboardSchema,
  SocialPlatformDetailSchema,
  SocialPlatformSchema,
  type SocialDashboard,
  type SocialDm,
  type SocialDmMessage,
  type SocialGrowth,
  type SocialPlatform,
  type SocialPlatformDetail,
  type SocialSnapshot,
} from '@/lib/schemas';

export const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  instagram: 'Instagram',
  tiktok: 'TikTok',
  twitter: 'Twitter / X',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
};

// Brand-ish line colors for the pop-out charts (distinct, not theme-tied).
export const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  instagram: '#e1306c',
  tiktok: '#25f4ee',
  twitter: '#1d9bf0',
  youtube: '#ff4d4d',
  linkedin: '#0a85c2',
};
export const EMAIL_COLOR = '#8b7cff';
export const ALL_AUDIENCE_COLOR = '#3df08c';
export const DM_COLOR = '#5ec9f8';

// The ranges every metric is sliced by (days, or 'all').
export const GROWTH_RANGES = [7, 30, 60, 'all'] as const;
export type GrowthRange = (typeof GROWTH_RANGES)[number];

export type SeriesPoint = { date: string; value: number };
export type LabelledSeries = { key: string; label: string; color: string; points: SeriesPoint[] };

const toSeriesPoints = (points: GrowthPoint[]): SeriesPoint[] =>
  points.map((p) => ({ date: p.capturedAt, value: p.value }));

/** Follower snapshots → the dated value series the growth math operates on. */
function toPoints(snapshots: SocialSnapshot[]): GrowthPoint[] {
  return snapshots.map((s) => ({ capturedAt: s.capturedAt, value: s.followers }));
}

/**
 * Percentage follower growth over the trailing window, computed from snapshot
 * history. Baseline is the most recent snapshot at or before the window start;
 * null when history doesn't reach back that far — honest, never a fake zero.
 */
export function growthPct(snapshots: SocialSnapshot[], days: number): number | null {
  return growthOver(toPoints(snapshots), days);
}

export function allTimeGrowthPct(snapshots: SocialSnapshot[]): number | null {
  return growthAllTime(toPoints(snapshots));
}

function growthFor(snapshots: SocialSnapshot[]): SocialGrowth {
  return {
    d7: growthPct(snapshots, 7),
    d30: growthPct(snapshots, 30),
    d60: growthPct(snapshots, 60),
    allTime: allTimeGrowthPct(snapshots),
  };
}

/**
 * Record today's follower counts as snapshots. Accounts shaped like the Zernio
 * config (~/.config/social/config.json); untracked platforms and accounts with
 * no follower count are skipped. Same-day re-sync overwrites. Returns the
 * number of snapshots recorded.
 */
export async function syncSocialSnapshots(
  db: FounderDb,
  accounts: Record<string, { handle?: string; followers?: number }>,
  today: string,
): Promise<number> {
  let recorded = 0;
  for (const [platform, account] of Object.entries(accounts)) {
    const parsed = SocialPlatformSchema.safeParse(platform);
    if (!parsed.success || typeof account.followers !== 'number') continue;
    await db.social.insertSnapshot({
      platform: parsed.data,
      capturedAt: today,
      followers: account.followers,
      source: 'zernio-config',
    });
    recorded += 1;
  }
  return recorded;
}

/** Live sync from Dave's Zernio config — called on every dashboard read. */
export async function syncFromZernioConfig(db: FounderDb, today?: string): Promise<number> {
  return syncSocialSnapshots(db, zernioAccounts(), today ?? new Date().toISOString().slice(0, 10));
}

export async function buildSocialDashboard(db: FounderDb): Promise<SocialDashboard> {
  const latest = new Map((await db.social.latest()).map((s) => [s.platform, s]));
  const platforms = await Promise.all(
    (await db.social.accounts()).map(async (account) => {
      const snapshots = await db.social.snapshots(account.platform);
      return {
        platform: account.platform,
        handle: account.handle,
        url: account.url,
        followers: latest.get(account.platform)?.followers ?? null,
        growth: growthFor(snapshots),
        series: snapshots.slice(-90).map((s) => ({ date: s.capturedAt, followers: s.followers })),
      };
    }),
  );
  const all = [...latest.values()];
  return SocialDashboardSchema.parse({
    totalFollowers: all.reduce((sum, s) => sum + s.followers, 0),
    asOf: all.map((s) => s.capturedAt).sort().at(-1) ?? null,
    platforms,
  });
}

/** Per-platform DM counts, ordered to match the account list. */
export async function dmsByPlatform(db: FounderDb): Promise<SocialDm[]> {
  return await db.social.dms();
}

/** Total DMs across every platform (seeded dummy until a real source lands). */
export async function totalDms(db: FounderDb): Promise<number> {
  return (await dmsByPlatform(db)).reduce((sum, d) => sum + d.count, 0);
}

// ── Audience (followers + email) ──────────────────────────────────────────

/** Each audience channel as a GrowthPoint series: one per platform + email. */
async function audienceChannelPoints(db: FounderDb): Promise<GrowthPoint[][]> {
  return [
    ...(await Promise.all(
      (await db.social.accounts()).map(async (a) => toPoints(await db.social.snapshots(a.platform))),
    )),
    (await db.emailList.snapshots()).map((s) => ({ capturedAt: s.capturedAt, value: s.subscribers })),
  ];
}

const allTimeDelta = (series: GrowthPoint[]): { current: number; baseline: number } | null =>
  series.length < 2 || series[0].value === 0
    ? null
    : { current: series[series.length - 1].value, baseline: series[0].value };

/**
 * Aggregate growth across the whole audience for a range. Each channel
 * contributes only if its history reaches back the full window; channels
 * without a baseline are excluded from both sides so they never distort the
 * figure. Null when no channel qualifies yet.
 */
export async function audienceGrowthPct(db: FounderDb, range: GrowthRange): Promise<number | null> {
  let current = 0;
  let baseline = 0;
  let qualified = 0;
  for (const series of (await audienceChannelPoints(db))) {
    const delta = range === 'all' ? allTimeDelta(series) : windowDelta(series, range);
    if (!delta) continue;
    current += delta.current;
    baseline += delta.baseline;
    qualified += 1;
  }
  if (qualified === 0 || baseline === 0) return null;
  return ((current - baseline) / baseline) * 100;
}

export async function audienceGrowth(db: FounderDb): Promise<SocialGrowth> {
  const [d7, d30, d60, allTime] = await Promise.all([
    audienceGrowthPct(db, 7),
    audienceGrowthPct(db, 30),
    audienceGrowthPct(db, 60),
    audienceGrowthPct(db, 'all'),
  ]);
  return { d7, d30, d60, allTime };
}

/** Back-compat alias — the old name for the 30-day audience figure. */
export async function monthlyAudienceGrowthPct(db: FounderDb): Promise<number | null> {
  return audienceGrowthPct(db, 30);
}

/** Current total audience = sum of each channel's latest value. */
export async function audienceTotal(db: FounderDb): Promise<number> {
  return (await audienceChannelPoints(db)).reduce((sum, s) => sum + (s.at(-1)?.value ?? 0), 0);
}

/** Per-channel + "All audience" series for the pop-out chart (carry-forward). */
export async function audienceSeries(db: FounderDb): Promise<{ channels: LabelledSeries[]; all: LabelledSeries }> {
  const channels: LabelledSeries[] = [
    ...(await Promise.all(
      (await db.social.accounts()).map(async (a) => ({
        key: a.platform,
        label: PLATFORM_LABELS[a.platform],
        color: PLATFORM_COLORS[a.platform],
        points: toSeriesPoints(toPoints(await db.social.snapshots(a.platform))),
      })),
    )),
    {
      key: 'email',
      label: 'Email List',
      color: EMAIL_COLOR,
      points: (await db.emailList.snapshots()).map((s) => ({ date: s.capturedAt, value: s.subscribers })),
    },
  ].filter(async (c) => (await c).points.length > 0);

  const all: LabelledSeries = {
    key: 'all',
    label: 'All audience',
    color: ALL_AUDIENCE_COLOR,
    points: toSeriesPoints(mergeSeriesSum((await audienceChannelPoints(db)))),
  };
  return { channels, all };
}

// ── DMs ───────────────────────────────────────────────────────────────────

/** Total DMs per day across platforms (carry-forward sum of DM snapshots). */
export async function dmSeries(db: FounderDb): Promise<SeriesPoint[]> {
  const byPlatform = new Map<string, GrowthPoint[]>();
  for (const s of await db.social.dmSnapshots()) {
    const list = byPlatform.get(s.platform) ?? [];
    list.push({ capturedAt: s.capturedAt, value: s.count });
    byPlatform.set(s.platform, list);
  }
  return toSeriesPoints(mergeSeriesSum([...byPlatform.values()]));
}

export async function dmGrowthPct(db: FounderDb, range: GrowthRange): Promise<number | null> {
  const series = (await dmSeries(db)).map((p) => ({ capturedAt: p.date, value: p.value }));
  return range === 'all' ? growthAllTime(series) : growthOver(series, range);
}

// ── Posting cadence ───────────────────────────────────────────────────────

// Deterministic 0..1 hash of a string (FNV-1a + fmix32 avalanche → unit float).
// The avalanche step decorrelates sequential inputs (consecutive dates) so the
// cadence doesn't cluster. No Math.random — stable across renders and runs.
function unitHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Per-platform posting personalities — how often each channel ships and how
// many posts on a busy day. Seeded dummy until a real published-posts pull
// lands (the publish queue is the real, wired path).
const POSTING_PROFILE: Record<SocialPlatform, { freq: number; max: number; weekdayBias: number }> = {
  instagram: { freq: 0.72, max: 2, weekdayBias: 0.08 },
  tiktok: { freq: 0.8, max: 3, weekdayBias: 0.04 },
  twitter: { freq: 0.88, max: 3, weekdayBias: 0.06 },
  youtube: { freq: 0.16, max: 1, weekdayBias: 0.05 },
  linkedin: { freq: 0.4, max: 1, weekdayBias: 0.3 },
};

export type PostingByPlatformPoint = { date: string; counts: Record<SocialPlatform, number> };

/**
 * Deterministic dummy posting frequency split BY PLATFORM — posts per day per
 * channel over the trailing `days` ending on `endDate`. Each platform follows
 * its own rhythm (see POSTING_PROFILE); weekdays run busier for business-y
 * channels. Powers the home posting-consistency breakdown.
 */
export function postingCadenceByPlatform(endDate: string, days = 90): PostingByPlatformPoint[] {
  const end = new Date(`${endDate}T00:00:00Z`);
  const platforms = Object.keys(POSTING_PROFILE) as SocialPlatform[];
  const out: PostingByPlatformPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(end.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    const dow = d.getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const counts = {} as Record<SocialPlatform, number>;
    for (const p of platforms) {
      const prof = POSTING_PROFILE[p];
      const prob = Math.max(0, prof.freq + (weekend ? -prof.weekdayBias : prof.weekdayBias));
      const fires = unitHash(`${p}|${date}`) < prob;
      counts[p] = fires ? 1 + Math.floor(unitHash(`${p}|${date}|n`) * prof.max) : 0;
    }
    out.push({ date, counts });
  }
  return out;
}

export type PostingSeries = {
  key: SocialPlatform;
  label: string;
  color: string;
  points: { date: string; count: number }[];
  total: number;
};

/** Per-platform posting cadence as labelled+coloured series for the charts. */
export function postingSeries(endDate: string, days = 90): PostingSeries[] {
  const cadence = postingCadenceByPlatform(endDate, days);
  const platforms = Object.keys(POSTING_PROFILE) as SocialPlatform[];
  return platforms.map((key) => {
    const points = cadence.map((d) => ({ date: d.date, count: d.counts[key] }));
    return {
      key,
      label: PLATFORM_LABELS[key],
      color: PLATFORM_COLORS[key],
      points,
      total: points.reduce((sum, p) => sum + p.count, 0),
    };
  });
}

export async function dmGrowth(db: FounderDb): Promise<SocialGrowth> {
  const [d7, d30, d60, allTime] = await Promise.all([
    dmGrowthPct(db, 7),
    dmGrowthPct(db, 30),
    dmGrowthPct(db, 60),
    dmGrowthPct(db, 'all'),
  ]);
  return { d7, d30, d60, allTime };
}

export async function platformDetail(db: FounderDb, platform: SocialPlatform): Promise<SocialPlatformDetail | null> {
  if (!SocialPlatformSchema.safeParse(platform).success) return null;
  const account = (await db.social.accounts()).find((a) => a.platform === platform);
  if (!account) return null;
  const snapshots = await db.social.snapshots(platform);
  return SocialPlatformDetailSchema.parse({
    account,
    followers: snapshots.at(-1)?.followers ?? null,
    growth: growthFor(snapshots),
    snapshots,
  });
}

// ── DM inbox (threads) ──────────────────────────────────────────────────────

/** A conversation with one subscriber: messages chronological (oldest first),
    plus the most recent message and whether it still needs a reply. */
export type DmThread = {
  subscriberId: string;
  name: string;
  handle: string | null;
  messages: SocialDmMessage[];
  last: SocialDmMessage;
  unreplied: boolean;
};

/** Group the DM messages for a platform into conversations, newest thread
    first. `unreplied` is true when the last message is inbound (needs a reply).
    Seeded until the ManyChat webhook feeds `social_dm_messages` live. */
export async function dmThreads(db: FounderDb, platform: SocialPlatform = 'instagram'): Promise<DmThread[]> {
  const groups = new Map<string, SocialDmMessage[]>();
  for (const m of await db.social.dmMessages(platform)) {
    // dmMessages is newest-first; collect per subscriber.
    const arr = groups.get(m.subscriberId) ?? [];
    arr.push(m);
    groups.set(m.subscriberId, arr);
  }
  const threads: DmThread[] = [];
  for (const [subscriberId, newestFirst] of groups) {
    const last = newestFirst[0];
    threads.push({
      subscriberId,
      name: last.name,
      handle: last.handle,
      messages: [...newestFirst].reverse(), // chronological
      last,
      unreplied: last.direction === 'in',
    });
  }
  threads.sort((a, b) => (a.last.ts < b.last.ts ? 1 : a.last.ts > b.last.ts ? -1 : 0));
  return threads;
}
