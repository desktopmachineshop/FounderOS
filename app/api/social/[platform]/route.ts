import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { platformDetail, syncFromZernioConfig } from '@/lib/social';
import { SocialPlatformSchema } from '@/lib/schemas';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { platform: string } }) {
  const db = (await getDb());
  await syncFromZernioConfig(db);
  // An unknown slug is a 404. A real platform with no account row is not —
  // it is a platform with no data yet, and saying "unknown platform" there
  // would be false. Same split as the page.
  const parsed = SocialPlatformSchema.safeParse(params.platform);
  if (!parsed.success) {
    return NextResponse.json({ error: `unknown platform: ${params.platform}` }, { status: 404 });
  }
  const detail = await platformDetail(db, parsed.data);
  if (!detail) {
    return NextResponse.json({ platform: parsed.data, account: null, snapshots: [] });
  }
  return NextResponse.json(detail);
}
