import { describe, it, expect } from 'vitest';
import { alignLines, estimateTimings } from '../src/align';

describe('alignLines', () => {
  it('aligns exactly when the pause count matches', () => {
    const t = alignLines(
      [{ id: 'a', text: 'x'.repeat(30) }, { id: 'b', text: 'x'.repeat(30) }],
      10,
      [{ start: 4.8, end: 5.4 }],
    );
    expect(t).toEqual([
      { lineId: 'a', startSec: 0, endSec: 5.1 },
      { lineId: 'b', startSec: 5.1, endSec: 10 },
    ]);
  });

  it('picks the nearest pauses when there are more pauses than boundaries', () => {
    const lines = [
      { id: 'a', text: 'x'.repeat(20) },
      { id: 'b', text: 'x'.repeat(20) },
      { id: 'c', text: 'x'.repeat(20) },
    ];
    // 3 equal lines over 12s => expected boundaries at 4.0 and 8.0.
    const silences = [
      { start: 1.0, end: 1.2 }, // mid 1.1, a decoy far from both
      { start: 3.8, end: 4.2 }, // mid 4.0, exact match for boundary 0
      { start: 7.6, end: 8.4 }, // mid 8.0, exact match for boundary 1
      { start: 10.0, end: 10.4 }, // mid 10.2, a decoy far from both
    ];
    const t = alignLines(lines, 12, silences);
    expect(t).toEqual([
      { lineId: 'a', startSec: 0, endSec: 4 },
      { lineId: 'b', startSec: 4, endSec: 8 },
      { lineId: 'c', startSec: 8, endSec: 12 },
    ]);
  });

  it('falls back to proportional positions when there are fewer pauses than boundaries', () => {
    const lines = [
      { id: 'a', text: 'x'.repeat(20) },
      { id: 'b', text: 'x'.repeat(20) },
      { id: 'c', text: 'x'.repeat(20) },
    ];
    // Only one pause, near the second boundary's expected position (8.0). The
    // first boundary (expected 4.0) has nothing within tolerance and must
    // fall back to its proportional position.
    const t = alignLines(lines, 12, [{ start: 7.7, end: 8.3 }]);
    expect(t).toEqual([
      { lineId: 'a', startSec: 0, endSec: 4 },
      { lineId: 'b', startSec: 4, endSec: 8 },
      { lineId: 'c', startSec: 8, endSec: 12 },
    ]);
  });

  it('returns contiguous timings with no pauses at all', () => {
    const lines = [{ id: 'a', text: 'x'.repeat(20) }, { id: 'b', text: 'x'.repeat(20) }];
    const t = alignLines(lines, 10, []);
    expect(t).toEqual([
      { lineId: 'a', startSec: 0, endSec: 5 },
      { lineId: 'b', startSec: 5, endSec: 10 },
    ]);
  });

  it('drops a silence touching the start or end of the audio', () => {
    const lines = [{ id: 'a', text: 'x'.repeat(20) }, { id: 'b', text: 'x'.repeat(20) }];
    const t = alignLines(lines, 10, [
      { start: 0, end: 0.3 },
      { start: 9.7, end: 10 },
    ]);
    expect(t).toEqual([
      { lineId: 'a', startSec: 0, endSec: 5 },
      { lineId: 'b', startSec: 5, endSec: 10 },
    ]);
  });

  it('never throws and returns one timing for a single line with no boundaries needed', () => {
    const t = alignLines([{ id: 'only', text: 'hi' }], 3, [{ start: 1, end: 1.5 }]);
    expect(t).toEqual([{ lineId: 'only', startSec: 0, endSec: 3 }]);
  });
});

describe('estimateTimings', () => {
  it('estimates 15 characters per second with a 1.6s floor, contiguous from zero', () => {
    const t = estimateTimings([{ id: 'a', text: 'x'.repeat(30) }, { id: 'b', text: 'hi' }]);
    expect(t[0]).toEqual({ lineId: 'a', startSec: 0, endSec: 2 });
    expect(t[1]!.startSec).toBe(2);
    expect(t[1]!.endSec).toBeCloseTo(3.6, 5);
  });
});
