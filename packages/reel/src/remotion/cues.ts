// When things happen inside a scene: pure. Narration lines become frame spans, and marks and strip advances are
// cued from the line that tells them.
import { Easing, interpolate } from 'remotion';
import type { LineTiming, Scene } from '@dailies/core';
import { theme } from '../theme';

const { motion } = theme;

/** The most steps a terminal scene shows; the schema allows no more. */
export const MAX_STEPS = 4;

/** A stretch of a scene, in frames counted from the scene's cut. */
export interface Span { start: number; end: number }

/** The span of each narration line of `scene`. A line without a timing takes the whole scene. */
export function lineSpans(scene: Scene, timings: LineTiming[], slot: { startFrame: number; durationInFrames: number }, audioStartFrame: number, fps: number): Span[] {
  const byLine = new Map(timings.map((t) => [t.lineId, t]));
  const clamp = (f: number) => Math.max(0, Math.min(slot.durationInFrames, f));
  return scene.lines.map((line) => {
    const t = byLine.get(line.id);
    if (!t) return { start: 0, end: slot.durationInFrames };
    const start = clamp(audioStartFrame + Math.round(t.startSec * fps) - slot.startFrame);
    return { start, end: Math.max(start, clamp(audioStartFrame + Math.round(t.endSec * fps) - slot.startFrame)) };
  });
}

/**
 * The line that tells each of a scene's items: the first line citing the item's entry, otherwise the line at
 * the same place in the scene. The result never runs backwards, so items are told in the order they are shown.
 */
export function linesOfItems(entryIds: string[], lines: Scene['lines']): number[] {
  let last = 0;
  return entryIds.map((entryId, i) => {
    const cited = lines.findIndex((line) => line.evidence.some((e) => e.type === 'entry' && e.entryId === entryId));
    const line = cited >= 0 ? cited : Math.min(lines.length - 1, Math.floor((i * lines.length) / entryIds.length));
    last = Math.max(last, line, 0);
    return last;
  });
}

/** The span in which each item is told. Items that share a line share its span in equal parts, in order. */
export function itemSpans(lineOf: number[], lines: Span[], whole: Span): Span[] {
  return lineOf.map((line, i) => {
    const span = lines[line] ?? whole;
    const sharing = lineOf.filter((l) => l === line).length;
    const place = lineOf.slice(0, i).filter((l) => l === line).length;
    const part = (span.end - span.start) / sharing;
    return { start: span.start + part * place, end: span.start + part * (place + 1) };
  });
}

/** The frame at which the mark of an item starts to draw: a little way into the span that tells it, never before `earliest`. */
export function cueFrame(span: Span, fps: number, earliest = 0): number {
  const into = Math.min(motion.cueMaxSec * fps, Math.max(motion.cueMinSec * fps, (span.end - span.start) * motion.cueShare));
  return Math.max(earliest, span.start + into);
}

const STEP_EASE = Easing.bezier(0.5, 0, 0.15, 1);

/**
 * Which item is under the lens at `frame`, as a fraction while the strip advances from one to the next.
 * The strip moves on when the next item starts to be told.
 */
export function stepPosition(spans: Span[], frame: number, fps: number): number {
  const stepFrames = Math.max(1, motion.stepSec * fps);
  return spans.slice(1).reduce((pos, span) => pos + interpolate(frame, [span.start, span.start + stepFrames], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: STEP_EASE }), 0);
}

/** The span in which each step of a scene is told, from the entries its lines cite. */
export function stepSpans(entryIds: string[], lines: Scene['lines'], spans: Span[], duration: number): Span[] {
  return itemSpans(linesOfItems(entryIds, lines), spans, { start: 0, end: duration });
}

/** Which step of a scene is under the lens at `frame`: always 0 for a scene whose strip does not advance. */
export function stepAt(scene: Scene, spans: Span[], frame: number, duration: number, fps: number, settled: boolean): number {
  if (scene.type !== 'terminal') return 0;
  const steps = scene.steps.slice(0, MAX_STEPS);
  if (settled) return steps.length - 1;
  return stepPosition(stepSpans(steps.map((s) => s.entryId), scene.lines, spans, duration), frame, fps);
}
