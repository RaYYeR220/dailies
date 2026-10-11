import { NextResponse } from 'next/server';
import { getDataDir, getDb } from '../../../server/db';
import { heartbeatAgeSec } from '../../../server/heartbeat';

export async function GET(_request: Request): Promise<Response> {
  let dbOk = true;
  try {
    getDb();
  } catch {
    dbOk = false;
  }

  const workerAgeSec = heartbeatAgeSec(getDataDir());
  const ok = dbOk && workerAgeSec !== null && workerAgeSec < 60;

  return NextResponse.json({ ok, db: dbOk, workerAgeSec }, { status: ok ? 200 : 503 });
}
