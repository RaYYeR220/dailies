import { describe, it, expect } from 'vitest';
import type { Scene } from '@dailies/core';
import { buildTimeline } from '../src/timeline';
import { MAX_STEPS, cueFrame, itemSpans, lineSpans, linesOfItems, stepAt, stepPosition, stepSpans } from '../src/remotion/cues';
import { theme } from '../src/theme';
import { fixtureStoryboard, fixtureTimings, stressStoryboard } from './fixture';

const sb = fixtureStoryboard();
const timings = fixtureTimings();
const tl = buildTimeline(sb, timings);
const terminal = sb.scenes[2]! as Extract<Scene, { type: 'terminal' }>;
const slot = tl.scenes[2]!;
const fps = 30;

describe('lineSpans', () => {
  it('gives each line of a scene its frames, counted from the scene\'s cut', () => {
    // The terminal scene starts with l2 at 3.6 s; l3 follows at 7 s and ends at 10.2 s.
    expect(lineSpans(terminal, timings, slot, tl.audioStartFrame, fps)).toEqual([{ start: 0, end: 102 }, { start: 102, end: 198 }]);
  });
  it('keeps every span inside the scene', () => {
    const late = timings.map((t) => (t.lineId === 'l3' ? { ...t, endSec: 99 } : t));
    expect(lineSpans(terminal, late, slot, tl.audioStartFrame, fps)[1]).toEqual({ start: 102, end: slot.durationInFrames });
  });
  it('gives a line with no timing the whole scene instead of throwing in the middle of a render', () => {
    expect(lineSpans(terminal, [], slot, tl.audioStartFrame, fps)).toEqual([{ start: 0, end: 198 }, { start: 0, end: 198 }]);
  });
  it('gives a silent scene no spans', () => {
    expect(lineSpans(sb.scenes[0]!, timings, tl.scenes[0]!, tl.audioStartFrame, fps)).toEqual([]);
  });
});

describe('linesOfItems', () => {
  it('finds the line that cites each step', () => {
    expect(linesOfItems(terminal.steps.map((s) => s.entryId), terminal.lines)).toEqual([0, 1]);
  });
  it('spreads steps no line cites across the lines, in order', () => {
    const lines = terminal.lines;
    expect(linesOfItems(['x:1', 'x:2', 'x:3', 'x:4'], lines)).toEqual([0, 0, 1, 1]);
    expect(linesOfItems(['x:1', 'x:2', 'x:3'], [lines[0]!])).toEqual([0, 0, 0]);
  });
  it('never runs backwards, whatever order the lines cite the steps in', () => {
    const swapped = [terminal.lines[1]!, terminal.lines[0]!];
    expect(linesOfItems(terminal.steps.map((s) => s.entryId), swapped)).toEqual([1, 1]);
  });
});

describe('itemSpans', () => {
  const lines = [{ start: 0, end: 100 }, { start: 100, end: 160 }];
  const whole = { start: 0, end: 160 };

  it('gives an item the span of its line', () => {
    expect(itemSpans([0, 1], lines, whole)).toEqual(lines);
  });
  it('shares a line between the items it tells, in equal parts and in order', () => {
    expect(itemSpans([0, 0, 0, 0], lines, whole)).toEqual([{ start: 0, end: 25 }, { start: 25, end: 50 }, { start: 50, end: 75 }, { start: 75, end: 100 }]);
    expect(itemSpans([0, 1, 1], lines, whole)).toEqual([{ start: 0, end: 100 }, { start: 100, end: 130 }, { start: 130, end: 160 }]);
  });
  it('falls back to the whole scene when there is no such line', () => {
    expect(itemSpans([0, 0], [], whole)).toEqual([{ start: 0, end: 80 }, { start: 80, end: 160 }]);
  });
});

describe('cueFrame', () => {
  it('starts a mark a little way into the span that tells it', () => {
    expect(cueFrame({ start: 100, end: 200 }, fps)).toBe(100 + 100 * theme.motion.cueShare);
  });
  it('never starts it at once, nor so late that a long line is half over', () => {
    expect(cueFrame({ start: 100, end: 104 }, fps)).toBeCloseTo(100 + theme.motion.cueMinSec * fps);
    expect(cueFrame({ start: 100, end: 1000 }, fps)).toBeCloseTo(100 + theme.motion.cueMaxSec * fps);
  });
  it('waits for the lens when the span starts before it has landed', () => {
    expect(cueFrame({ start: 0, end: 20 }, fps, 30)).toBe(30);
  });
});

describe('stepPosition', () => {
  const spans = [{ start: 0, end: 100 }, { start: 100, end: 200 }, { start: 200, end: 300 }];
  const advance = theme.motion.stepSec * fps;

  it('rests on the first step until the second starts to be told', () => {
    expect(stepPosition(spans, 0, fps)).toBe(0);
    expect(stepPosition(spans, 100, fps)).toBe(0);
  });
  it('moves on one step at a time and comes to rest on each', () => {
    expect(stepPosition(spans, 100 + advance, fps)).toBe(1);
    expect(stepPosition(spans, 199, fps)).toBe(1);
    expect(stepPosition(spans, 200 + advance, fps)).toBe(2);
    expect(stepPosition(spans, 10_000, fps)).toBe(2);
  });
  it('is on its way in between, and never goes back', () => {
    let last = 0;
    for (let f = 0; f <= 300; f++) {
      const p = stepPosition(spans, f, fps);
      expect(p).toBeGreaterThanOrEqual(last);
      last = p;
    }
    const half = stepPosition(spans, 100 + advance / 2, fps);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(1);
  });
});

describe('stepAt', () => {
  const spans = lineSpans(terminal, timings, slot, tl.audioStartFrame, fps);

  it('follows the narration through the steps of a terminal scene', () => {
    expect(stepAt(terminal, spans, 50, slot.durationInFrames, fps, false)).toBe(0);
    expect(stepAt(terminal, spans, 197, slot.durationInFrames, fps, false)).toBe(1);
  });
  it('is on the last step in a still, whatever the frame', () => {
    expect(stepAt(terminal, spans, 0, slot.durationInFrames, fps, true)).toBe(1);
  });
  it('shows no more steps than a terminal scene may have', () => {
    const stress = stressStoryboard().scenes[2]! as Extract<Scene, { type: 'terminal' }>;
    const many = { ...stress, steps: [...stress.steps, ...stress.steps] };
    expect(stepAt(many, [{ start: 0, end: 100 }], 0, 100, fps, true)).toBe(MAX_STEPS - 1);
  });
  it('stays put in every other kind of scene', () => {
    expect(stepAt(sb.scenes[1]!, [], 40, 108, fps, true)).toBe(0);
  });
});

describe('stepSpans', () => {
  it('tells every step inside the scene, in order', () => {
    const spans = stepSpans(['a:1', 'a:2', 'a:3', 'a:4'], terminal.lines, [{ start: 0, end: 102 }, { start: 102, end: 198 }], 198);
    expect(spans).toHaveLength(4);
    for (let i = 1; i < spans.length; i++) expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.start);
    expect(spans.at(-1)!.end).toBe(198);
  });
});
