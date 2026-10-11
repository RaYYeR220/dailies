import { parseRun, parseStages, isRecord } from './parse';
import { parseReel } from './parse-reel';
import { srtCues } from './reel-model';
import type { ApprovedReel, ReelData, RunInfo, StageInfo } from './types';

/*
  How a server component reads data: over HTTP from this app's own API, never from the database or the
  data directory. The origin is the server's own port, not the Host header of the request, so a forged
  header cannot point these fetches anywhere else.
*/
function apiOrigin(): string {
  return process.env.DAILIES_API_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`;
}

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${apiOrigin()}${path}`, { cache: 'no-store' });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const RUN_ID = /^run_[0-9a-f]+$/;

/** A run and its nine stages, or null when there is no such run. */
export async function fetchRun(id: string): Promise<{ run: RunInfo; stages: StageInfo[] } | null> {
  if (!RUN_ID.test(id)) return null;
  const { status, body } = await getJson(`/api/runs/${id}`);
  if (status === 404) return null;
  const run = isRecord(body) ? parseRun(body.run) : null;
  if (!run) throw new Error(`GET /api/runs/${id} answered ${status} with a body this page cannot read`);
  return { run, stages: parseStages(isRecord(body) ? body.stages : null) };
}

/** A reel with its evidence, or null when the run does not exist or has not been grounded yet. */
export async function fetchReel(id: string): Promise<ReelData | null> {
  if (!RUN_ID.test(id)) return null;
  const { status, body } = await getJson(`/api/reels/${id}`);
  if (status === 404) return null;
  const reel = parseReel(body);
  if (!reel) throw new Error(`GET /api/reels/${id} answered ${status} with a body this page cannot read`);
  // The subtitle file carries each line as it was finally spoken; see narrationLines for why that matters.
  if (reel.media.subtitles) {
    const srt = await fetch(`${apiOrigin()}${reel.media.subtitles}`, { cache: 'no-store' }).catch(() => null);
    if (srt?.ok) reel.cues = srtCues(await srt.text());
  }
  return reel;
}

export async function fetchApproved(): Promise<ApprovedReel[]> {
  const { status, body } = await getJson('/api/reels');
  if (status !== 200 || !Array.isArray(body)) throw new Error(`GET /api/reels answered ${status}`);
  return body.flatMap((row) =>
    isRecord(row) && typeof row.runId === 'string' && RUN_ID.test(row.runId) && typeof row.repoUrl === 'string' && typeof row.approvedAt === 'string'
      ? [{ runId: row.runId, repoUrl: row.repoUrl, approvedAt: row.approvedAt }]
      : [],
  );
}
