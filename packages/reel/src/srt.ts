import type { LineTiming, Storyboard } from '@dailies/core';
import { timedLines } from './timeline';

const pad = (n: number, width: number) => String(n).padStart(width, '0');

function stamp(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3_600_000), 2)}:${pad(Math.floor(ms / 60_000) % 60, 2)}:${pad(Math.floor(ms / 1000) % 60, 2)},${pad(ms % 1000, 3)}`;
}

/** One cue per narration line in storyboard order; `audioOffsetSec` is where the narration starts in the video. */
export function toSrt(sb: Storyboard, timings: LineTiming[], audioOffsetSec: number): string {
  return timedLines(sb, timings)
    .map((l, i) => `${i + 1}\n${stamp(l.startSec + audioOffsetSec)} --> ${stamp(l.endSec + audioOffsetSec)}\n${l.text.replace(/\s+/g, ' ').trim()}\n`)
    .join('\n');
}
