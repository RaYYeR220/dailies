import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadEnv } from '@dailies/core';
import { recut } from '@dailies/pipeline';
import { getDb } from '../../../../../server/db';
import { addFeedback } from '../../../../../server/store';

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
  addFeedback(db, id, body.text);

  const token = process.env.DAILIES_OWNER_TOKEN;
  const provided = request.headers.get('x-owner-token');
  const isOwner = !!token && !!provided && constantTimeEqual(provided, token);

  let didRecut = false;
  if (isOwner) {
    try {
      recut(db, id, body.text);
      didRecut = true;
    } catch {
      // the run never completed verify; feedback is still stored.
    }
  }

  return NextResponse.json({ recut: didRecut });
}
