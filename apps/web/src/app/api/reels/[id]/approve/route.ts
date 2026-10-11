import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadEnv } from '@dailies/core';
import { getRun } from '@dailies/pipeline';
import { getDb } from '../../../../../server/db';
import { approveReel, getReel } from '../../../../../server/store';

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  loadEnv();
  const token = process.env.DAILIES_OWNER_TOKEN;
  if (!token) return NextResponse.json({ error: 'owner token not configured' }, { status: 503 });

  const provided = request.headers.get('x-owner-token');
  if (!provided || !constantTimeEqual(provided, token)) {
    return NextResponse.json({ error: 'invalid owner token' }, { status: 401 });
  }

  const { id } = await params;
  const db = getDb();
  let run;
  try {
    run = getRun(db, id);
  } catch {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  if (run.status !== 'needs_approval') {
    return NextResponse.json({ error: 'run is not needs_approval' }, { status: 409 });
  }

  approveReel(db, id);
  return NextResponse.json(getReel(db, id));
}
