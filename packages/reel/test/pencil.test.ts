import { describe, it, expect } from 'vitest';
import { Scene } from '@dailies/core';
import { PENCIL_REGION, dashesDrawn, endMarks, markExtent, markPaths, markShown, ringAround, type MarkKind } from '../src/remotion/pencil';

describe('end scene', () => {
  const end = { id: 'sc_end', type: 'end', repo: 'acme/retry-queue', verified: 4, flagged: 1 };

  it('accepts a count of unverified claims and defaults it to zero', () => {
    expect(Scene.parse(end)).toMatchObject({ unverified: 0 });
    expect(Scene.parse({ ...end, unverified: 3 })).toMatchObject({ unverified: 3 });
  });
  it('rejects a count that is not a whole number', () => {
    expect(Scene.safeParse({ ...end, unverified: 1.5 }).success).toBe(false);
    expect(Scene.safeParse({ ...end, unverified: '2' }).success).toBe(false);
  });
});

describe('endMarks', () => {
  it('returns one mark per claim: rings, then crosses, then question marks', () => {
    expect(endMarks({ verified: 4, flagged: 1, unverified: 2 })).toEqual({
      marks: ['ring', 'ring', 'ring', 'ring', 'cross', 'question', 'question'],
      overflow: 0,
    });
  });
  it('returns nothing when no claim was checked', () => {
    expect(endMarks({ verified: 0, flagged: 0, unverified: 0 })).toEqual({ marks: [], overflow: 0 });
  });
  it('shows exactly sixteen marks without an overflow', () => {
    const { marks, overflow } = endMarks({ verified: 10, flagged: 4, unverified: 2 });
    expect(marks).toHaveLength(16);
    expect(overflow).toBe(0);
  });
  it('caps at sixteen marks and counts the rest', () => {
    expect(endMarks({ verified: 128, flagged: 0, unverified: 0 })).toEqual({ marks: Array(16).fill('ring'), overflow: 112 });
  });
  it('keeps every kind that occurred, in order, when it has to leave marks out', () => {
    const { marks, overflow } = endMarks({ verified: 60, flagged: 3, unverified: 1 });
    expect(marks).toHaveLength(16);
    expect(overflow).toBe(48);
    expect(marks.filter((m) => m === 'cross').length).toBeGreaterThanOrEqual(1);
    expect(marks.filter((m) => m === 'question')).toHaveLength(1);
    expect([...marks].sort((a, b) => ['ring', 'cross', 'question'].indexOf(a) - ['ring', 'cross', 'question'].indexOf(b))).toEqual(marks);
  });
  it('keeps the proportions of the three kinds when it has to leave marks out', () => {
    const count = (kind: string, marks: string[]) => marks.filter((m) => m === kind).length;
    const { marks } = endMarks({ verified: 20, flagged: 20, unverified: 0 });
    expect(count('ring', marks)).toBe(8);
    expect(count('cross', marks)).toBe(8);
  });
  it('treats a count that is not a positive whole number as zero or rounds it down', () => {
    // Render props arrive unparsed.
    expect(endMarks({ verified: -3, flagged: Number.NaN, unverified: 2.9 })).toEqual({ marks: ['question', 'question'], overflow: 0 });
  });
});

describe('markPaths', () => {
  it('draws a ring and a dashed ring in one stroke, a cross and a question mark in two', () => {
    expect(markPaths('ring', 200, 100, 1)).toHaveLength(1);
    expect(markPaths('dashed', 200, 100, 1)).toHaveLength(1);
    expect(markPaths('cross', 200, 100, 1)).toHaveLength(2);
    expect(markPaths('question', 60, 100, 1)).toHaveLength(2);
  });
  it('draws the same mark for the same seed, and another hand for another seed', () => {
    expect(markPaths('ring', 200, 100, 7)).toEqual(markPaths('ring', 200, 100, 7));
    expect(markPaths('ring', 200, 100, 7)).not.toEqual(markPaths('ring', 200, 100, 8));
    expect(markPaths('cross', 200, 100, 7)).not.toEqual(markPaths('cross', 200, 100, 8));
  });
  it('keeps a mark close to the box it is given', () => {
    for (const kind of ['ring', 'dashed', 'cross', 'question'] as const) {
      for (const d of markPaths(kind, 300, 120, 5)) {
        const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
        numbers.forEach((n, i) => expect(Math.abs(n), `${kind} ${d}`).toBeLessThanOrEqual((i % 2 === 0 ? 150 : 60) * 1.35));
      }
    }
  });
  it('lets a ring run past its own start, and closes a dashed ring where it began', () => {
    const ends = (d: string) => {
      const n = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      return Math.hypot(n.at(-2)! - n[0]!, n.at(-1)! - n[1]!);
    };
    expect(ends(markPaths('ring', 300, 300, 3)[0]!)).toBeGreaterThan(60);
    expect(ends(markPaths('dashed', 300, 300, 3)[0]!)).toBeLessThan(20);
  });
});

describe('dashesDrawn', () => {
  const total = (pattern: number[]) => pattern.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);

  it('draws nothing at the start and every dash at the end', () => {
    expect(total(dashesDrawn(0, 10, 0.6))).toBe(0);
    expect(total(dashesDrawn(1, 10, 0.6))).toBeCloseTo(0.6);
  });
  it('draws whole dashes and then the part of the one the pencil is on', () => {
    expect(dashesDrawn(0.25, 10, 0.6)).toEqual([0.06, 0.04, 0.06, 0.04, 0.05, 2].map((n) => expect.closeTo(n)));
  });
  it('always ends on a gap that hides the rest of the stroke, and never on a dash of no length', () => {
    for (const p of [0.1, 0.2, 0.37, 0.5, 1]) {
      const pattern = dashesDrawn(p, 10, 0.6);
      expect(pattern.length % 2).toBe(0);
      expect(pattern.at(-1)).toBeGreaterThanOrEqual(1);
      expect(pattern.at(-2)).toBeGreaterThan(0);
    }
  });
});

describe('ringAround', () => {
  const inside = (ring: { width: number; height: number }, x: number, y: number) => (x / (ring.width / 2)) ** 2 + (y / (ring.height / 2)) ** 2;

  it('clears both ends of the letters of every line by the padding', () => {
    const widths = [300, 520, 560, 480, 260];
    const ring = ringAround(widths, 50, 36, { x: 20, y: 30 });
    expect(ring.height).toBe(5 * 50 - 14 + 60);
    widths.forEach((w, i) => {
      const centre = -125 + (i + 0.5) * 50;
      for (const y of [centre - 18, centre + 18]) expect(inside(ring, w / 2 + 20, y)).toBeLessThanOrEqual(1 + 1e-9);
    });
  });
  it('hugs a single line the way a hand rings a word', () => {
    const ring = ringAround([400], 92, 60, { x: 28, y: 34 });
    expect(ring.height).toBe(60 + 68);
    expect(ring.width).toBeGreaterThan(456);
    expect(ring.width).toBeLessThan(540);
  });
});

describe('markShown', () => {
  it('draws nothing before the pencil touches the film', () => {
    expect(markShown(0, true)).toBe('nothing');
    expect(markShown(0, false)).toBe('nothing');
    expect(markShown(-0.3, true)).toBe('nothing');
  });
  it('draws the stroke live while it grows, and while the lens is moving', () => {
    expect(markShown(0.01, true)).toBe('drawn');
    expect(markShown(0.99, true)).toBe('drawn');
    expect(markShown(1, false)).toBe('drawn');
  });
  it('keeps a finished mark as a picture of itself while the lens rests', () => {
    expect(markShown(1, true)).toBe('kept');
    expect(markShown(1.4, true)).toBe('kept');
  });
});

describe('markExtent', () => {
  const kinds: MarkKind[] = ['ring', 'dashed', 'cross', 'question'];
  const sizes: [number, number][] = [[31, 39], [47, 40], [90, 120], [300.4, 96.2], [715.3, 354.9], [220, 900]];

  /** How far the pencil filter's region reaches from the centre of a mark: the box of its strokes and of its own box, grown by the region. */
  const reach = (kind: MarkKind, width: number, height: number, seed: number) => {
    const numbers = markPaths(kind, width, height, seed).flatMap((d) => (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number));
    const xs = [-width / 2, width / 2, ...numbers.filter((_, i) => i % 2 === 0)];
    const ys = [-height / 2, height / 2, ...numbers.filter((_, i) => i % 2 === 1)];
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    return { x: Math.max(Math.abs(x0 - PENCIL_REGION.x * (x1 - x0)), Math.abs(x1 + PENCIL_REGION.x * (x1 - x0))), y: Math.max(Math.abs(y0 - PENCIL_REGION.y * (y1 - y0)), Math.abs(y1 + PENCIL_REGION.y * (y1 - y0))) };
  };

  it('covers all the pencil filter works on, for every kind of mark, hand and size', () => {
    for (const kind of kinds) for (const [width, height] of sizes) for (let seed = 0; seed < 40; seed++) {
      const extent = markExtent(kind, width, height, seed);
      const needed = reach(kind, width, height, seed);
      expect(extent.x, `${kind} ${width}x${height} seed ${seed}`).toBeGreaterThanOrEqual(needed.x);
      expect(extent.y, `${kind} ${width}x${height} seed ${seed}`).toBeGreaterThanOrEqual(needed.y);
    }
  });
  it('is a whole number of pixels either way from the centre, so the picture and the live mark share one pixel grid', () => {
    for (const kind of kinds) for (const [width, height] of sizes) {
      const extent = markExtent(kind, width, height, 7);
      expect(Number.isInteger(extent.x) && Number.isInteger(extent.y)).toBe(true);
    }
  });
  it('keeps the picture close to the mark', () => {
    for (const kind of kinds) for (const [width, height] of sizes) {
      const extent = markExtent(kind, width, height, 7);
      expect(extent.x, `${kind} ${width}x${height}`).toBeLessThanOrEqual(width + 0.4 * height + 16);
      expect(extent.y, `${kind} ${width}x${height}`).toBeLessThanOrEqual(height + 0.2 * width + 16);
    }
  });
});
