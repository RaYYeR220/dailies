import { describe, it, expect } from 'vitest';
import type { Storyboard } from '@dailies/core';
import { buildTimeline } from '../src/timeline';
import { HEIGHT, WIDTH } from '../src/remotion/config';
import { endStrip, framing, glassRoom, glassShare, lensPath, linesRoom, shotOf, travel } from '../src/remotion/lens';
import { frameBox, framesWithin, stripOf } from '../src/remotion/strip';
import { theme } from '../src/theme';
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

describe('shotOf', () => {
  const { loupe } = theme;
  const lensEdge = (shot: ReturnType<typeof shotOf>, side: 1 | -1) => shot.lens.x + side * loupe.skirt.outer * shot.lens.scale;

  it('rests the lens of a terminal scene far enough along its frame to leave the step before it readable', () => {
    const shot = shotOf(sb.scenes[2]!);
    const strip = stripOf(shot.unit, shot.half);
    const before = frameBox(strip, shot.at, -1);
    expect(shot.lens.x + before.left).toBeGreaterThan(0);
    expect(lensEdge(shot, -1) - (shot.lens.x + before.left)).toBeGreaterThan(400);
  });

  it('centres a larger lens on a terminal scene with a single step', () => {
    const scene = sb.scenes[2]!;
    if (scene.type !== 'terminal') throw new Error('fixture changed');
    const alone = shotOf({ ...scene, steps: [scene.steps[0]!] });
    expect(alone.lens.x).toBe(WIDTH / 2);
    expect(alone.lens.scale).toBeGreaterThan(shotOf(scene).lens.scale);
  });

  it('starts the values of a stats scene where the skirt of the lens ends, and keeps all of them in the frame', () => {
    const stats = sb.scenes[4]!;
    if (stats.type !== 'stats') throw new Error('fixture changed');
    for (let n = 2; n <= 6; n++) {
      const shot = shotOf({ ...stats, items: stats.items.slice(0, n) });
      const strip = stripOf(shot.unit, shot.half);
      expect(shot.half).toBe(true);
      const first = frameBox(strip, shot.at, 1);
      const last = frameBox(strip, shot.at, n - 1);
      expect(shot.lens.x + first.left, `${n} values`).toBeGreaterThanOrEqual(lensEdge(shot, 1));
      expect(shot.lens.x + last.left + last.width, `${n} values`).toBeLessThanOrEqual(WIDTH);
      expect(first.width, `${n} values`).toBeGreaterThan(200);
    }
  });

  it('gives a long record a larger glass and leaves the quote where it was', () => {
    const flag = sb.scenes[5]!;
    if (flag.type !== 'flag') throw new Error('fixture changed');
    const short = shotOf(flag);
    const long = shotOf({ ...flag, reality: 'x'.repeat(200) });
    expect(long.lens.scale).toBeGreaterThan(short.lens.scale);
    const quote = (shot: typeof short) => shot.lens.x + frameBox(stripOf(shot.unit, shot.half), shot.at, 0).left;
    expect(quote(long)).toBeCloseTo(quote(short), 6);
    expect(lensEdge(long, -1)).toBeCloseTo(lensEdge(short, -1), 6);
    expect(lensEdge(long, 1) - long.lens.x).toBeLessThan(WIDTH - long.lens.x + loupe.skirt.outer * long.lens.scale * 0.2);
  });

  it('ends the marks of the end card where the lens begins, however many there are', () => {
    const end = sb.scenes.at(-1)!;
    if (end.type !== 'end') throw new Error('fixture changed');
    for (const verified of [1, 6, 8, 9, 16, 500]) {
      const shot = shotOf({ ...end, verified, flagged: 0, unverified: 0 });
      const strip = stripOf(shot.unit, shot.half);
      const marks = Math.min(16, verified);
      const firstLeft = shot.lens.x + frameBox(strip, shot.at, 0).left;
      const lastRight = shot.lens.x + frameBox(strip, shot.at, marks - 1).left + strip.frame.width;
      expect(firstLeft, `${verified} claims`).toBeGreaterThan(0);
      expect(lastRight, `${verified} claims`).toBeLessThan(lensEdge(shot, -1) + theme.shot.end.overlap + 1);
    }
  });
});

describe('endStrip', () => {
  it('keeps the frames at their full pitch while they fit and narrows them after', () => {
    expect(endStrip(8, false).pitch).toBe(theme.shot.end.pitch);
    expect(endStrip(16, false).pitch).toBeLessThan(theme.shot.end.pitch);
    expect(endStrip(16, false).pitch).toBeGreaterThanOrEqual(theme.shot.end.minPitch);
  });
  it('leaves room for the count of marks left out', () => {
    expect(endStrip(16, true).marksEnd).toBeLessThan(endStrip(16, false).marksEnd);
    expect(endStrip(16, true).pitch).toBeLessThan(endStrip(16, false).pitch);
  });
});

describe('strip', () => {
  const full = stripOf(600, false);
  const half = stripOf(600, true);

  it('fits eight perforations to a full frame and four to a half-frame', () => {
    expect(full.pitch).toBe(600);
    expect(half.pitch).toBe(300);
    expect(full.perf).toBe(half.perf);
    expect(half.frame.height).toBe(full.frame.height);
    expect(half.frame.width).toBeLessThan(half.frame.height);
    expect(full.frame.width).toBeGreaterThan(full.frame.height);
  });
  it('centres frame 0 on a lens resting at the middle of it', () => {
    const box = frameBox(full, 4, 0);
    expect(box.left + box.width / 2).toBeCloseTo(0);
    expect(Math.abs(box.top + box.height / 2)).toBeLessThan(1);   // 35 mm frames sit a hair off the middle of the stock
    expect(frameBox(full, 4, 1).left - box.left).toBe(600);
  });
  it('lists the frames that reach into a stretch of film', () => {
    expect(framesWithin(full, 4, -330, 330)).toEqual([-1, 0, 1]);
    expect(framesWithin(full, 4, -100, 100)).toEqual([0]);
    expect(framesWithin(half, 2, -180, 180)).toEqual([-1, 0, 1]);
  });
});

describe('framing', () => {
  const path = lensPath(tl, sb);
  const shots = sb.scenes.map((scene) => shotOf(scene));
  const focus = (i: number) => shots[i]!.at;

  it('shows one scene at rest, all of it, focused where its shot says', () => {
    const view = framing(path, shots, tl.scenes[3]!.startFrame + 60, focus);
    expect(view.unit).toBe(shots[3]!.unit);
    expect(view.takes).toEqual([{ index: 3, shot: shots[3], focus: shots[3]!.at, presence: 1, frames: 1 }]);
  });

  it('has both scenes on the strip during a glide, one leaving and one arriving', () => {
    const t = path.transitions[2]!;
    const view = framing(path, shots, t.cut, focus);
    expect(view.takes.map((take) => take.index)).toEqual([2, 3]);
    expect(view.takes[0]!.focus).toBeGreaterThan(shots[2]!.at);
    expect(view.takes[1]!.focus).toBeLessThan(shots[3]!.at);
    expect(Math.min(shots[2]!.unit, shots[3]!.unit)).toBeLessThan(view.unit);
    expect(view.unit).toBeLessThan(Math.max(shots[2]!.unit, shots[3]!.unit));
  });

  it('keeps the perforations of the two scenes in step, so the strip is one strip', () => {
    path.transitions.forEach((t, i) => {
      for (const frame of [t.start + 1, t.cut, t.end - 1]) {
        const [a, b] = framing(path, shots, frame, focus).takes;
        const apart = a!.focus - b!.focus;
        expect(Math.abs(apart - Math.round(apart)), `glide ${i} at ${frame}`).toBeLessThan(1e-6);
      }
    });
  });

  it('moves the film the same way all through the reel: forwards, but for the spring settling at the end', () => {
    path.transitions.forEach((t, i) => {
      const settle = travel(shots[i]!, shots[i]!.at, shots[i + 1]!) * 0.03;
      let furthest = -Infinity;
      for (let f = t.start + 1; f < t.end; f++) {
        const leaving = framing(path, shots, f, focus).takes[0]!;
        expect(leaving.focus).toBeGreaterThanOrEqual(furthest - settle);
        furthest = Math.max(furthest, leaving.focus);
      }
    });
  });

  it('never shows the scene being left and the scene being entered at full strength together', () => {
    path.transitions.forEach((t) => {
      for (let f = t.start; f <= t.end; f++) {
        const takes = framing(path, shots, f, focus).takes;
        expect(takes.reduce((sum, take) => sum + take.presence, 0)).toBeLessThanOrEqual(1 + 1e-9);
      }
    });
  });

  it('opens the reel with the film arriving under a lens that is already there', () => {
    const first = framing(path, shots, 0, focus);
    expect(first.lens).toMatchObject(path.rests[0]!);
    expect(first.takes[0]!.focus).toBeLessThan(shots[0]!.at);
    expect(first.takes[0]!.presence).toBe(0);
    const landed = framing(path, shots, path.transitions[0]!.end - path.transitions[0]!.cut, focus);
    expect(landed.takes[0]).toMatchObject({ focus: shots[0]!.at, presence: 1 });
  });

  it('covers about the same stretch of film in every glide', () => {
    for (let i = 0; i + 1 < shots.length; i++) {
      const perforations = travel(shots[i]!, shots[i]!.at, shots[i + 1]!);
      const px = perforations * Math.sqrt(stripOf(shots[i]!.unit, false).perf * stripOf(shots[i + 1]!.unit, false).perf);
      expect(px).toBeGreaterThan(theme.motion.travel * 0.9);
      expect(px).toBeLessThan(theme.motion.travel * 1.1);
    }
  });
});

describe('glassRoom', () => {
  const { loupe } = theme;
  const rest = { x: 960, y: 540, scale: 1, turn: 0 };

  it('is widest across the middle of the glass and keeps the rim clear', () => {
    const room = glassRoom(rest);
    const r = loupe.glass - loupe.rim;
    expect(room.cx).toBeCloseTo(0);
    expect(room.cy).toBeCloseTo(0);
    expect(room.width(-1, 1)).toBeCloseTo(2 * r, 0);
    expect(room.width(-150, -100)).toBeLessThan(room.width(-50, 0));
    expect(room.width(-150, -100)).toBeCloseTo(2 * Math.sqrt(r * r - 150 * 150), 6);
    expect(room.height).toBeCloseTo(2 * r);
  });

  it('stops at the edge of the frame and above the caption inset', () => {
    const big = { x: 960, y: 540, scale: 2.75, turn: 0 };
    const voiced = glassRoom(big);
    expect(voiced.height).toBeLessThan(HEIGHT);
    expect(voiced.width(-1, 1)).toBeLessThan(WIDTH);
    const captions = glassRoom({ ...big, y: 540 - theme.layout.captionInset / 2 }, HEIGHT - theme.layout.captionInset);
    expect(captions.height).toBeLessThan(HEIGHT - theme.layout.captionInset);
    expect(captions.height).toBeLessThan(voiced.height);
  });

  it('moves the block towards the part of the glass that is in the frame', () => {
    const left = glassRoom({ x: 200, y: 540, scale: 1, turn: 0 });
    expect(left.cx).toBeGreaterThan(0);
    const [toLeft, toRight] = left.reach(0);
    expect(toLeft).toBeCloseTo(toRight, 6);
  });

  it('gives lines the chords of the glass, and no room at all to a block that is too tall', () => {
    const room = glassRoom(rest);
    const widths = linesRoom(room)(3, 60)!;
    expect(widths).toHaveLength(3);
    expect(widths[1]).toBeGreaterThan(widths[0]!);
    expect(widths[0]).toBeCloseTo(widths[2]!, 6);
    expect(linesRoom(room)(20, 60)).toBeNull();
    expect(linesRoom(room, 100, 100)(3, 60)![1]).toBeLessThanOrEqual(widths[1]!);
    expect(Math.max(...linesRoom(room, 0, 0, 200)(3, 60)!)).toBe(200);
  });
});
