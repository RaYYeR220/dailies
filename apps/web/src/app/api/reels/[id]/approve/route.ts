import { NextResponse } from 'next/server';
import { loadEnv } from '@dailies/core';
import { getRun } from '@dailies/pipeline/runtime';
import { getDb } from '../../../../../server/db';
import { approveReel, getReel } from '../../../../../server/store';
import { hasValidOwnerToken } from '../../../../../server/owner-token';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  loadEnv();
  if (!process.env.DAILIES_OWNER_TOKEN) {
    return NextResponse.json({ error: 'owner token not configured' }, { status: 503 });
  }
  if (!hasValidOwnerToken(request)) {
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
