import { existsSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { getRun } from '@dailies/pipeline/runtime';
import { getDataDir, getDb } from '../../../../server/db';
import { getReel } from '../../../../server/store';
import { isStageDoneWeb } from '../../../../server/stages';
import { readStageArtifact, mediaFilePath } from '../../../../server/artifacts';

const MEDIA_NAMES = { video: 'reel.mp4', subtitles: 'reel.srt', poster: 'poster.png' } as const;

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
  if (!isStageDoneWeb(db, id, 'ground')) {
    return NextResponse.json({ error: 'ground has not completed' }, { status: 404 });
  }

  const dataDir = getDataDir();
  const reel = getReel(db, id) ?? { runId: id, status: 'draft' as const, approvedAt: null };
  // The grounded storyboard is the one that was voiced and rendered; the script artifact is the draft before the gate.
  const storyboard = readStageArtifact<{ storyboard: unknown }>(dataDir, id, 'ground')?.storyboard ?? null;
  const claims = readStageArtifact(dataDir, id, 'verify');
  const voice = readStageArtifact<{ timings: unknown; mode: unknown }>(dataDir, id, 'voice');
  const gate = readStageArtifact(dataDir, id, 'gate');

  const media = Object.fromEntries(
    Object.entries(MEDIA_NAMES).map(([key, file]) => [
      key,
      existsSync(mediaFilePath(dataDir, id, file)) ? `/media/${id}/${file}?k=${id}` : null,
    ]),
  ) as Record<keyof typeof MEDIA_NAMES, string | null>;

  return NextResponse.json({
    run,
    reel,
    storyboard,
    claims,
    timings: voice?.timings ?? null,
    voiceMode: voice?.mode ?? null,
    gate,
    media,
  });
}
