import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import {
  audienceGrowth,
  audienceTotal,
  buildSocialDashboard,
  dmGrowth,
  monthlyAudienceGrowthPct,
  syncFromZernioConfig,
  totalDms,
} from '@/lib/social';
import { buildEmailList } from '@/lib/email-list';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = (await getDb());
  // Every read captures today's follower counts from the Zernio config, so
  // growth history accrues for real just by using the dashboard.
  await syncFromZernioConfig(db);
  return NextResponse.json({
    ...(await buildSocialDashboard(db)),
    emailList: await buildEmailList(db),
    totalDms: await totalDms(db),
    audienceTotal: await audienceTotal(db),
    audienceGrowth: await audienceGrowth(db), // { d7, d30, d60, allTime }
    dmGrowth: await dmGrowth(db), // { d7, d30, d60, allTime }
    monthlyGrowthPct: await monthlyAudienceGrowthPct(db), // back-compat
  });
}
