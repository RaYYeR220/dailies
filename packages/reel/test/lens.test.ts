import { describe, it, expect } from 'vitest';
import type { Storyboard } from '@dailies/core';
import { buildTimeline } from '../src/timeline';
import { HEIGHT, WIDTH } from '../src/remotion/config';
import { glassShare, lensPath } from '../src/remotion/lens';
import { fixtureStoryboard, fixtureTimings, stressStoryboard, stressTimings } from './fixture';

const sb = fixtureStoryboard();
const timings = fixtureTimings();
const tl = buildTimeline(sb, timings);

describe('lensPath', () => {
  const path = lensPath(tl, sb);

  it('returns one resting place per scene, inside the frame', () => {
    expect(path.rests).toHaveLength(sb.scenes.length);
    for (const rest of path.rests) {
      expect(rest.x).toBeGreaterThan(0);
      expect(rest.x).toBeLessThan(WIDTH);
      expect(rest.y).toBeGreaterThan(0);
      expect(rest.y).toBeLessThan(HEIGHT);
      expect(rest.scale).toBeGreaterThan(0);
    }
  });

  it('holds the lens still on its resting place while a scene plays', () => {
    tl.scenes.forEach((slot, i) => {
      const mid = slot.startFrame + Math.floor(slot.durationInFrames / 2);
      expect(path.at(mid)).toEqual({ ...path.rests[i]!, from: i, to: i, progress: 0 });
    });
  });

  it('starts each glide before the cut and lands it after', () => {
    expect(path.transitions).toHaveLength(sb.scenes.length - 1);
    path.transitions.forEach((t, i) => {
      const out = tl.scenes[i]!;
      const into = tl.scenes[i + 1]!;
      expect(t.cut).toBe(into.startFrame);
      expect(t.start).toBeLessThan(t.cut);
      expect(t.end).toBeGreaterThan(t.cut);
      expect(t.start).toBeGreaterThanOrEqual(out.startFrame + out.durationInFrames / 2);
      expect(t.end).toBeLessThanOrEqual(into.startFrame + into.durationInFrames / 2);
    });
  });

  it('interpolates between two consecutive resting places at the midpoint of the transition', () => {
    path.transitions.forEach((t, i) => {
      const a = path.rests[i]!;
      const b = path.rests[i + 1]!;
      const mid = path.at((t.start + t.end) / 2);
      expect(mid).toMatchObject({ from: i, to: i + 1 });
      expect(mid.progress).toBeGreaterThan(0);
      expect(mid.progress).toBeLessThan(1);
      expect(mid.x).toBeCloseTo(a.x + (b.x - a.x) * mid.progress, 6);
      expect(mid.y).toBeCloseTo(a.y + (b.y - a.y) * mid.progress, 6);
      expect(mid.scale).toBeCloseTo(a.scale + (b.scale - a.scale) * mid.progress, 6);
    });
  });

  it('is half way at the cut', () => {
    for (const t of path.transitions) expect(path.at(t.cut).progress).toBeCloseTo(0.5, 6);
  });

  it('leaves exactly from one resting place and lands exactly on the next', () => {
    path.transitions.forEach((t, i) => {
      expect(path.at(t.start)).toMatchObject({ ...path.rests[i]!, progress: 0 });
      expect(path.at(t.end)).toEqual({ ...path.rests[i + 1]!, from: i + 1, to: i + 1, progress: 0 });
    });
  });

  it('moves the lens without a jump from frame to frame', () => {
    const reach = Math.hypot(WIDTH, HEIGHT);
    for (let f = 1; f < tl.totalFrames; f++) {
      const a = path.at(f - 1);
      const b = path.at(f);
      expect(Math.hypot(b.x - a.x, b.y - a.y), `frame ${f}`).toBeLessThan(reach * 0.12);
    }
  });

  it('rests on the first and the last scene outside the reel', () => {
    expect(path.at(-10)).toMatchObject(path.rests[0]!);
    expect(path.at(tl.totalFrames + 10)).toMatchObject(path.rests.at(-1)!);
  });

  it('moves narrated scenes up in a captions cut and leaves the silent ones alone', () => {
    const captions = lensPath(tl, sb, { captions: true });
    sb.scenes.forEach((scene, i) => {
      const voiced = path.rests[i]!;
      const cut = captions.rests[i]!;
      if (scene.lines.length === 0) expect(cut).toEqual(voiced);
      else expect(cut.y).toBeLessThan(voiced.y);
    });
  });

  it('keeps the lit glass over a good part of every frame, at rest and on the way', () => {
    for (const [board, lines] of [[sb, timings], [stressStoryboard(), stressTimings()]] as const) {
      const timeline = buildTimeline(board, lines);
      for (const captions of [false, true]) {
        const p = lensPath(timeline, board, { captions });
        for (let f = 0; f < timeline.totalFrames; f += 3) expect(glassShare(p.at(f)), `frame ${f}`).toBeGreaterThan(0.06);
      }
    }
  });

  it('survives scenes too short to hold a glide', () => {
    const collided = timings.map((t) => (t.lineId === 'l4' ? { ...t, startSec: 3.6 } : t));   // the terminal scene lasts one frame
    const timeline = buildTimeline(sb, collided);
    const p = lensPath(timeline, sb);
    for (const t of p.transitions) {
      expect(t.start).toBeLessThanOrEqual(t.cut);
      expect(t.end).toBeGreaterThanOrEqual(t.cut);
    }
    for (let f = 0; f < timeline.totalFrames; f++) {
      const s = p.at(f);
      expect(Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.scale), `frame ${f}`).toBe(true);
    }
  });

  it('handles a storyboard with no spoken scenes', () => {
    const bare: Storyboard = { ...sb, scenes: [sb.scenes[0]!, sb.scenes.at(-1)!] };
    const p = lensPath(buildTimeline(bare, []), bare);
    expect(p.rests).toHaveLength(2);
    expect(p.transitions).toHaveLength(1);
  });
});
