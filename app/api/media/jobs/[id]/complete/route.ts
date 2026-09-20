import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';
import { requireWorker } from '@/lib/worker-request';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const CompleteSchema = z.object({ result: z.record(z.unknown()).default({}) });

/** The workstation reports a finished job. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const denied = requireWorker(request);
  if (denied) return denied;

  const parsed = CompleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = await getDb();
  const ok = await db.mediaJobs.complete(params.id, parsed.data.result);
  if (!ok) {
    // Not claimed (or gone): say so rather than pretending the write landed.
    return NextResponse.json({ error: 'job is not claimed' }, { status: 409 });
  }
  return NextResponse.json({ job: await db.mediaJobs.byId(params.id) });
}
