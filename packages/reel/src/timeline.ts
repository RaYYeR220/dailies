import type { LineTiming, Storyboard } from '@dailies/core';

export interface Timeline { fps: number; totalFrames: number; audioStartFrame: number; scenes: { sceneId: string; startFrame: number; durationInFrames: number }[] }

export const FPS = 30;
const TITLE_SEC = 2.5;
const END_SEC = 3;
const TAIL_SEC = 0.4;   // the last spoken scene holds this long after its last line

export interface TimedLine { id: string; text: string; sceneId: string; startSec: number; endSec: number }

/** Every narration line in storyboard order with its timing. A line without a timing is an error, never a guess. */
export function timedLines(sb: Storyboard, timings: LineTiming[]): TimedLine[] {
  const byLine = new Map(timings.map((t) => [t.lineId, t]));
  return sb.scenes.flatMap((scene) =>
    scene.lines.map((line) => {
      const t = byLine.get(line.id);
      if (!t) throw new Error(`no timing for line ${line.id} in scene ${scene.id}`);
      return { id: line.id, text: line.text, sceneId: scene.id, startSec: t.startSec, endSec: t.endSec };
    }),
  );
}

/** The line being spoken `sec` seconds into the narration, or null in a pause and outside it. */
export function lineAt(sb: Storyboard, timings: LineTiming[], sec: number): TimedLine | null {
  return timedLines(sb, timings).find((l) => sec >= l.startSec && sec < l.endSec) ?? null;
}

export function buildTimeline(sb: Storyboard, timings: LineTiming[], fps: number = FPS): Timeline {
  const title = sb.scenes[0];
  const end = sb.scenes.at(-1);
  if (title?.type !== 'title') throw new Error('storyboard must start with a title scene');
  if (sb.scenes.length < 2 || end?.type !== 'end') throw new Error('storyboard must finish with an end scene');
  const spoken = sb.scenes.slice(1, -1);
  spoken.forEach((scene, i) => {
    if (scene.type === 'title' || scene.type === 'end') throw new Error(`scene ${i + 1} (${scene.type}) cannot sit between spoken scenes`);
    if (scene.lines.length === 0) throw new Error(`scene ${scene.id} has no narration lines`);
  });

  const lines = new Map(timedLines(sb, timings).map((l) => [l.id, l]));
  const frames = (sec: number) => Math.round(sec * fps);
  const audioStartFrame = frames(TITLE_SEC);

  // Cut points between spoken scenes. Each is pushed at least one frame past the previous one,
  // so timings that collide or run backwards still give every scene a positive length.
  const cuts = [audioStartFrame];
  for (const scene of spoken.slice(1)) {
    const firstLine = lines.get(scene.lines[0]!.id)!;
    cuts.push(Math.max(cuts.at(-1)! + 1, audioStartFrame + frames(firstLine.startSec)));
  }
  const lastScene = spoken.at(-1);
  if (lastScene) {
    const lastLine = lines.get(lastScene.lines.at(-1)!.id)!;
    cuts.push(Math.max(cuts.at(-1)! + 1, audioStartFrame + frames(lastLine.endSec + TAIL_SEC)));
  }

  const scenes = [
    { sceneId: title.id, startFrame: 0, durationInFrames: audioStartFrame },
    ...spoken.map((scene, i) => ({ sceneId: scene.id, startFrame: cuts[i]!, durationInFrames: cuts[i + 1]! - cuts[i]! })),
    { sceneId: end.id, startFrame: cuts.at(-1)!, durationInFrames: frames(END_SEC) },
  ];
  return { fps, totalFrames: cuts.at(-1)! + frames(END_SEC), audioStartFrame, scenes };
}
