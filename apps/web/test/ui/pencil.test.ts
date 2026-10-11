import { describe, it, expect } from 'vitest';
import { crossPath, questionPath, ringPath } from '../../src/ui/pencil';

const numbers = (d: string) => d.match(/-?\d+(\.\d+)?/g)!.map(Number);
const endpoints = (d: string) => {
  const n = numbers(d);
  return { start: [n[0]!, n[1]!], end: [n.at(-2)!, n.at(-1)!] };
};

describe('ringPath', () => {
  it('draws the same ring for the same seed and a different hand for another', () => {
    expect(ringPath(24, 24, 17, 15, { seed: 3 })).toBe(ringPath(24, 24, 17, 15, { seed: 3 }));
    expect(ringPath(24, 24, 17, 15, { seed: 3 })).not.toBe(ringPath(24, 24, 17, 15, { seed: 4 }));
  });

  it('is one stroke that overshoots its own start, the way a hand closes a loop', () => {
    const d = ringPath(100, 100, 80, 40, { seed: 1 });
    expect(d.match(/M/g)).toHaveLength(1);
    const { start, end } = endpoints(d);
    expect(Math.hypot(start[0]! - end[0]!, start[1]! - end[1]!)).toBeGreaterThan(8);
  });

  it('stays close to the ellipse it was asked for', () => {
    const n = numbers(ringPath(100, 100, 80, 40, { seed: 9 }));
    for (let i = 0; i < n.length; i += 2) {
      expect(n[i]!).toBeGreaterThan(100 - 80 * 1.35);
      expect(n[i]!).toBeLessThan(100 + 80 * 1.35);
      expect(n[i + 1]!).toBeGreaterThan(100 - 40 * 1.6);
      expect(n[i + 1]!).toBeLessThan(100 + 40 * 1.6);
    }
  });

  it('closes exactly once round when asked for a dashed ring, so the dashes do not double up', () => {
    const { start, end } = endpoints(ringPath(100, 100, 80, 40, { seed: 2, turns: 1, drift: 0 }));
    expect(Math.hypot(start[0]! - end[0]!, start[1]! - end[1]!)).toBeLessThan(1);
  });
});

describe('crossPath', () => {
  it('is two strokes that run corner to corner', () => {
    const d = crossPath(24, 24, 30, 30, 5);
    expect(d.match(/M/g)).toHaveLength(2);
    const n = numbers(d);
    expect(n.every(Number.isFinite)).toBe(true);
    expect(n[0]!).toBeLessThan(24);
    expect(n[1]!).toBeLessThan(24);
  });

  it('is deterministic per seed', () => {
    expect(crossPath(24, 24, 30, 30, 5)).toBe(crossPath(24, 24, 30, 30, 5));
    expect(crossPath(24, 24, 30, 30, 5)).not.toBe(crossPath(24, 24, 30, 30, 6));
  });
});

describe('questionPath', () => {
  it('is a hook and a dot', () => {
    expect(questionPath(24, 24, 40).match(/M/g)).toHaveLength(2);
  });
});
