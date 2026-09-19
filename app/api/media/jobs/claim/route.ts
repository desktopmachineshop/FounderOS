import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { MediaJobKindSchema } from '@/lib/media-jobs';
import { requireWorker } from '@/lib/worker-request';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const ClaimSchema = z.object({
  workerId: z.string().min(1).max(100),
  kinds: z.array(MediaJobKindSchema).nonempty().optional(),
});

/** The workstation asks for its next piece of work. */
export async function POST(request: Request) {
  const denied = requireWorker(request);
  if (denied) return denied;

  const parsed = ClaimSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  // Reclaim anything stranded before handing out new work.
  await db.mediaJobs.requeueStale();
  const job = await db.mediaJobs.claim(parsed.data);
  return NextResponse.json({ job });
}
