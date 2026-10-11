import type { LineTiming } from '@dailies/core';

export function alignLines(
  lines: { id: string; text: string }[],
  totalSec: number,
  silences: { start: number; end: number }[],
): LineTiming[] {
  const n = lines.length;
  const totalChars = lines.reduce((sum, l) => sum + l.text.length, 0) || 1;
  const usable = silences.filter((s) => s.start > 0 && s.end < totalSec);
  const used = new Set<number>();
  const tolerance = totalSec * 0.25;

  const boundaries: number[] = [];
  let cumChars = 0;
  for (let i = 0; i < n - 1; i++) {
    cumChars += lines[i]!.text.length;
    const expected = (totalSec * cumChars) / totalChars;

    let bestIndex = -1;
    let bestDist = Infinity;
    for (let j = 0; j < usable.length; j++) {
      if (used.has(j)) continue;
      const mid = (usable[j]!.start + usable[j]!.end) / 2;
      const dist = Math.abs(mid - expected);
      if (dist <= tolerance && dist < bestDist) {
        bestDist = dist;
        bestIndex = j;
      }
    }

    if (bestIndex >= 0) {
      used.add(bestIndex);
      boundaries.push((usable[bestIndex]!.start + usable[bestIndex]!.end) / 2);
    } else {
      boundaries.push(expected);
    }
  }

  const timings: LineTiming[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const end = i < boundaries.length ? boundaries[i]! : totalSec;
    timings.push({ lineId: lines[i]!.id, startSec: start, endSec: end });
    start = end;
  }
  return timings;
}

export function estimateTimings(lines: { id: string; text: string }[]): LineTiming[] {
  let start = 0;
  return lines.map((l) => {
    const duration = Math.max(l.text.length / 15, 1.6);
    const end = start + duration;
    const timing: LineTiming = { lineId: l.id, startSec: start, endSec: end };
    start = end;
    return timing;
  });
}
