import { NextResponse } from 'next/server';
import { loadEnv } from '@dailies/core';
import { getRun, recut } from '@dailies/pipeline';
import { getDb } from '../../../../../server/db';
import { addFeedback } from '../../../../../server/store';
import { hasValidOwnerToken } from '../../../../../server/owner-token';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  loadEnv();
  let body: { text?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.text !== 'string' || body.text.length < 1 || body.text.length > 1000) {
    return NextResponse.json({ error: 'text must be 1 to 1000 characters' }, { status: 400 });
  }

  const { id } = await params;
  const db = getDb();
  let run;
  try {
    run = getRun(db, id);
  } catch {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }
  addFeedback(db, id, body.text);

  const isOwner = hasValidOwnerToken(request);

  // A run still 'running' may be mid-flight in the worker process right
  // now; recutting it concurrently would race its stage/artifact writes.
  let didRecut = false;
  if (isOwner && run.status !== 'running') {
    try {
      recut(db, id, body.text);
      didRecut = true;
    } catch {
      // the run never completed verify; feedback is still stored.
    }
  }

  return NextResponse.json({ recut: didRecut });
}
