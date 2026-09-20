import { NextResponse } from 'next/server';
import { getDb } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = (await getDb());
  return NextResponse.json({ departments: await db.departments.all() });
}
