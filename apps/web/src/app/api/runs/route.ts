import { NextResponse } from 'next/server';
import { loadEnv, DEFAULT_BUDGET } from '@dailies/core';
import { createRun } from '@dailies/pipeline';
import { getDb } from '../../../server/db';
import { allowRun } from '../../../server/store';
import { clientIp } from '../../../server/client-ip';
import { parseRepoUrl, parseSince } from '../../../server/validate';

export async function POST(request: Request): Promise<Response> {
  loadEnv();
  let body: { repoUrl?: unknown; since?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (typeof body.repoUrl !== 'string') {
    return NextResponse.json({ error: 'repoUrl is required' }, { status: 400 });
  }
  const repoUrl = parseRepoUrl(body.repoUrl);
  if (!repoUrl) {
    return NextResponse.json({ error: 'repoUrl must be https://github.com/<owner>/<repo>' }, { status: 400 });
  }

  const now = new Date();
  const sinceInput = typeof body.since === 'string' ? body.since : '7d';
  const since = parseSince(sinceInput, now);
  if (!since) {
    return NextResponse.json({ error: 'since must be <n>h, <n>d or an ISO date' }, { status: 400 });
  }

  const db = getDb();
  const ip = clientIp(request);
  const limits = {
    perIpPerDay: Number(process.env.DAILIES_RUNS_PER_IP ?? 3),
    globalPerDay: Number(process.env.DAILIES_RUNS_PER_DAY ?? 40),
  };
  const allowed = allowRun(db, ip, now, limits);
  if (!allowed.ok) {
    return NextResponse.json({ error: 'rate limited', reason: allowed.reason }, { status: 429 });
  }

  const runId = createRun(db, { repoUrl, since, until: now.toISOString(), budget: DEFAULT_BUDGET });
  return NextResponse.json({ runId }, { status: 201 });
}
