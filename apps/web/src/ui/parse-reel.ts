import { Claim, LineTiming, Storyboard } from '@dailies/core';
import { isRecord, mediaPath, parseGate, parseRun } from './parse';
import type { ReelData } from './types';

/**
 * Reads the body of `GET /api/reels/[id]`. Server side only: it checks the artifacts against the
 * schemas in @dailies/core. An artifact that does not parse becomes null or is left out, never guessed at.
 */
export function parseReel(body: unknown): ReelData | null {
  if (!isRecord(body)) return null;
  const run = parseRun(body.run);
  if (!run) return null;

  const reel = isRecord(body.reel) ? body.reel : {};
  // The script stage writes `{ storyboard, discarded }`; a bare storyboard is read too.
  const scripted = isRecord(body.storyboard) && isRecord(body.storyboard.storyboard) ? body.storyboard.storyboard : body.storyboard;
  const storyboard = Storyboard.safeParse(scripted);
  // The verify stage writes `{ claims, counts }`; a bare list is read too.
  const claimList = Array.isArray(body.claims) ? body.claims : isRecord(body.claims) && Array.isArray(body.claims.claims) ? body.claims.claims : [];
  const timings = LineTiming.array().safeParse(body.timings);
  const media = isRecord(body.media) ? body.media : {};

  return {
    run,
    reel: {
      runId: run.id,
      status: reel.status === 'approved' ? 'approved' : 'draft',
      approvedAt: typeof reel.approvedAt === 'string' ? reel.approvedAt : null,
    },
    storyboard: storyboard.success ? storyboard.data : null,
    claims: claimList.flatMap((c) => {
      const claim = Claim.safeParse(c);
      return claim.success ? [claim.data] : [];
    }),
    timings: timings.success ? timings.data : null,
    voiceMode: body.voiceMode === 'voiced' || body.voiceMode === 'captions' ? body.voiceMode : null,
    gate: parseGate(body.gate),
    media: { video: mediaPath(media.video), subtitles: mediaPath(media.subtitles), poster: mediaPath(media.poster) },
    cues: null,
  };
}
