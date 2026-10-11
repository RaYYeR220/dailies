import { NextResponse } from 'next/server';
import { getRun } from '@dailies/pipeline/runtime';
import { getDb } from '../../../../server/db';
import { listStages } from '../../../../server/stages';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const db = getDb();

  let run;
  try {
    run = getRun(db, id);
  } catch {
    return NextResponse.json({ error: 'run not found' }, { status: 404 });
  }

  const stages = listStages(db, id);
  return NextResponse.json({ run, stages }, { status: 200 });
}
