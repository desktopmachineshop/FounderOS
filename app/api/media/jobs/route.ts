import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { MediaJobSpecSchema, MediaJobStatusSchema, newMediaJob } from '@/lib/media-jobs';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

/** The board: what is queued, running, done or given up on. */
export async function GET(request: Request) {
  const db = await getDb();
  const raw = new URL(request.url).searchParams.get('status');
  const status = raw ? MediaJobStatusSchema.safeParse(raw) : null;
  if (raw && !status?.success) {
    return NextResponse.json({ error: `unknown status: ${raw}` }, { status: 400 });
  }
  // Sweep abandoned claims on read, so the board never shows a job as
  // "claimed" by a laptop that closed an hour ago.
  await db.mediaJobs.requeueStale();
  return NextResponse.json({ jobs: await db.mediaJobs.list({ status: status?.data }) });
}

const EnqueueSchema = z.object({
  spec: MediaJobSpecSchema,
  priority: z.number().int().min(-100).max(100).optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  requestedBy: z.string().min(1).max(100).optional(),
});

/** Queue work for the workstation. Operator-side, behind the app's gate. */
export async function POST(request: Request) {
  const parsed = EnqueueSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const db = await getDb();
  const job = newMediaJob(parsed.data);
  await db.mediaJobs.enqueue(job);
  return NextResponse.json({ job }, { status: 201 });
}
