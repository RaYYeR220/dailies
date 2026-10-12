import { describe, it, expect } from 'vitest';
import { ticks } from '../src/remotion/knurl';

type Point = [number, number];
/** The corners of every tick of a path, tick by tick. */
const cornersOf = (d: string): Point[][] =>
  d.split('Z').filter(Boolean).map((tick) => (tick.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)).map((n) => n.flatMap((_, i) => (i % 2 === 0 ? [[n[i]!, n[i + 1]!] as Point] : [])));
const radiusOf = ([x, y]: Point) => Math.hypot(x, y);
/** The angle of a point, clockwise on a screen from three o'clock, 0..2π. */
const angleOf = ([x, y]: Point) => (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);

describe('ticks', () => {
  const [radius, width, dash, gap] = [312.5, 15, 2.1, 3.1];
  const round = 2 * Math.PI * radius;

  it('cuts one four-cornered tick for every dash of the dashed circle it stands for', () => {
    const all = cornersOf(ticks(radius, width, dash, gap));
    expect(all).toHaveLength(Math.ceil(round / (dash + gap)));
    for (const tick of all) expect(tick).toHaveLength(4);
  });
  it('gives every tick the width of the stroke, across the circle', () => {
    for (const [a, b, c, e] of cornersOf(ticks(radius, width, dash, gap)) as [Point, Point, Point, Point][]) {
      expect(radiusOf(a)).toBeCloseTo(radius + width / 2, 1);
      expect(radiusOf(b)).toBeCloseTo(radius + width / 2, 1);
      expect(radiusOf(c)).toBeCloseTo(radius - width / 2, 1);
      expect(radiusOf(e)).toBeCloseTo(radius - width / 2, 1);
      // its two sides lie along the radius, as the ends of a dash do
      expect(angleOf(a)).toBeCloseTo(angleOf(e), 3);
      expect(angleOf(b)).toBeCloseTo(angleOf(c), 3);
    }
  });
  it('starts at three o’clock and runs clockwise, a dash and a gap at a time', () => {
    const all = cornersOf(ticks(radius, width, dash, gap)) as [Point, Point, Point, Point][];
    all.slice(0, 20).forEach(([a, b], k) => {
      expect(angleOf(a) * radius).toBeCloseTo(k * (dash + gap), 1);
      expect(angleOf(b) * radius).toBeCloseTo(k * (dash + gap) + dash, 1);
    });
    expect(all[1]![0][1]).toBeGreaterThan(0);   // clockwise on a screen: down from three o'clock
  });
  it('starts as far into the pattern as the dash offset says', () => {
    const [a, b] = cornersOf(ticks(radius, width, 0.9, 4.3, 1.4))[0] as [Point, Point];
    expect(angleOf(a) * radius).toBeCloseTo(5.2 - 1.4, 1);
    expect(angleOf(b) * radius).toBeCloseTo(5.2 - 1.4 + 0.9, 1);
    // an offset that falls inside a dash leaves the rest of that dash at the start
    const [c, e] = cornersOf(ticks(radius, width, dash, gap, 1.5))[0] as [Point, Point];
    expect(angleOf(c) * radius).toBeCloseTo(0, 1);
    expect(angleOf(e) * radius).toBeCloseTo(dash - 1.5, 1);
  });
  it('cuts the last tick off at the seam instead of running on past the start', () => {
    // a circle one and a half dashes round: a whole dash, a gap, then half a dash up to the seam
    const short = (1.5 * 2 + 1) / (2 * Math.PI);
    const all = cornersOf(ticks(short, 0.2, 2, 1)) as [Point, Point, Point, Point][];
    expect(all).toHaveLength(2);
    expect(angleOf(all[1]![0]) * short).toBeCloseTo(3, 1);
    expect(all[1]![1][0]).toBeCloseTo(short + 0.1, 1);   // back at three o'clock
    expect(all[1]![1][1]).toBeCloseTo(0, 1);
  });
  it('writes the same path every time', () => {
    expect(ticks(radius, width, dash, gap)).toBe(ticks(radius, width, dash, gap));
  });
});
