import { NextResponse } from 'next/server';
import { getDb } from '../../../server/db';
import { listApproved } from '../../../server/store';

export async function GET(_request: Request): Promise<Response> {
  const db = getDb();
  return NextResponse.json(listApproved(db, 50));
}
