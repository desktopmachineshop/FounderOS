import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { requireWorker } from '@/lib/worker-request';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const FailSchema = z.object({ error: z.string().min(1).max(4000) });

/** The workstation reports a failure; the queue decides retry vs give up. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = requireWorker(request);
  if (denied) return denied;

  const parsed = FailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  const known = await db.mediaJobs.fail(params.id, parsed.data.error);
  if (!known) return NextResponse.json({ error: 'unknown job' }, { status: 404 });
  return NextResponse.json({ job: await db.mediaJobs.byId(params.id) });
}
