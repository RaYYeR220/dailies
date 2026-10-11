// Grease-pencil geometry: pure, so it runs under vitest. marks.tsx strokes these paths and animates them.
// Every path is a deterministic function of its size and seed; a render never differs from the one before.

export type MarkKind = 'ring' | 'cross' | 'dashed' | 'question';

/** A small seeded generator (mulberry32), so a mark wobbles the same way on every frame. */
function random(seed: number): () => number {
  let a = (Math.imul(seed | 0, 0x9e3779b1) + 0x7f4a7c15) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Point = readonly [number, number];
const n1 = (n: number) => Math.round(n * 10) / 10;

/** A smooth curve through `points` (Catmull-Rom, written as cubic Béziers). */
function through(points: Point[]): string {
  let d = `M${n1(points[0]![0])},${n1(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    d += ` C${n1(p1[0] + (p2[0] - p0[0]) / 6)},${n1(p1[1] + (p2[1] - p0[1]) / 6)} ${n1(p2[0] - (p3[0] - p1[0]) / 6)},${n1(p2[1] - (p3[1] - p1[1]) / 6)} ${n1(p2[0])},${n1(p2[1])}`;
  }
  return d;
}

const RING_STEPS = 32;

/**
 * A loop drawn by hand inside a `width` by `height` box centred on the origin. It starts at the left, goes over
 * the top, and with `turns` above 1 runs past its own start the way a pencil does when it closes a circle.
 */
export function ringPath(width: number, height: number, seed: number, turns = 1.14): string {
  const r = random(seed);
  const phase = [r() * Math.PI * 2, r() * Math.PI * 2] as const;
  const wobble = [0.03 * (0.7 + r() * 0.6), 0.02 * (0.7 + r() * 0.6)] as const;
  const tilt = -0.07 + r() * 0.06;
  const start = Math.PI * (0.86 + r() * 0.12);
  const drift = turns > 1 ? -0.1 : 0;   // an open loop spirals inwards a little, so its end sits inside its start
  const points: Point[] = [];
  for (let i = 0; i <= RING_STEPS; i++) {
    const t = i / RING_STEPS;
    const a = start + Math.PI * 2 * turns * t;
    const k = 1 + wobble[0] * Math.sin(a + phase[0]) + wobble[1] * Math.sin(a * 2.3 + phase[1]) + drift * (t - 0.5);
    const x = (Math.cos(a) * width * k) / 2;
    const y = (Math.sin(a) * height * k) / 2;
    points.push([x * Math.cos(tilt) - y * Math.sin(tilt), x * Math.sin(tilt) + y * Math.cos(tilt)]);
  }
  return through(points);
}

/** Two strokes through a `width` by `height` box centred on the origin, each a little bowed and off its corners. */
export function crossPaths(width: number, height: number, seed: number): [string, string] {
  const r = random(seed);
  const j = (range: number) => (r() - 0.5) * range;
  const [x, y] = [width / 2, height / 2];
  const stroke = (side: 1 | -1) =>
    through([
      [-side * x + j(width * 0.05), -y + j(height * 0.08)],
      [-side * x * 0.36, -y * 0.38 + j(height * 0.08)],
      [side * x * 0.3, y * 0.26 + j(height * 0.08)],
      [side * x + j(width * 0.05), y + j(height * 0.08)],
    ]);
  return [stroke(1), stroke(-1)];
}

/** A question mark `height` tall centred on the origin: the hook, then the dot. */
export function questionPaths(height: number): [string, string] {
  const s = height / 100;
  const p = (x: number, y: number) => `${n1(x * s)},${n1(y * s)}`;
  return [`M${p(-23, -23)} C${p(-25, -57)} ${p(27, -59)} ${p(26, -27)} C${p(25, -6)} ${p(1, -5)} ${p(0, 19)}`, `M${p(-1, 43)} L${p(1, 45)}`];
}

/** The strokes of a mark in the order a hand would draw them. */
export function markPaths(kind: MarkKind, width: number, height: number, seed: number): string[] {
  switch (kind) {
    case 'ring': return [ringPath(width, height, seed)];
    case 'dashed': return [ringPath(width, height, seed, 1)];
    case 'cross': return crossPaths(width, height, seed);
    case 'question': return questionPaths(height);
  }
}

/**
 * The dash array that shows the first `progress` of a dashed stroke whose length is normalised to 1:
 * whole dashes, the one being drawn, then nothing.
 */
export function dashesDrawn(progress: number, count: number, fill: number): number[] {
  const period = 1 / count;
  const dash = period * fill;
  const drawn = Math.max(0, Math.min(1, progress));
  const whole = Math.floor(drawn / period);
  const pattern: number[] = [];
  for (let i = 0; i < whole; i++) pattern.push(dash, period - dash);
  const part = Math.min(dash, drawn - whole * period);
  // A dash of no length would still leave a dot under a round cap, so the pattern ends on a gap instead.
  if (part > 0 || pattern.length === 0) pattern.push(part, 2);
  else pattern[pattern.length - 1]! += 2;
  return pattern;
}

export type EndMark = 'ring' | 'cross' | 'question';
const END_MARK_CAP = 16;
const END_ORDER: EndMark[] = ['ring', 'cross', 'question'];

/**
 * One mark per claim for the end card: rings for verified, crosses for flagged, question marks for unverified,
 * in that order. More than sixteen claims are shown as sixteen marks in the proportions of the three kinds,
 * never dropping a kind that occurred, and `overflow` is how many claims have no mark of their own.
 */
export function endMarks(counts: { verified: number; flagged: number; unverified: number }): { marks: EndMark[]; overflow: number } {
  const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  const claims = [whole(counts.verified), whole(counts.flagged), whole(counts.unverified)];
  const total = claims.reduce((a, b) => a + b, 0);
  const shown = total <= END_MARK_CAP ? claims : claims.map((n) => (n === 0 ? 0 : Math.max(1, Math.floor((n * END_MARK_CAP) / total))));
  const sum = () => shown.reduce((a, b) => a + b, 0);
  const owed = (i: number) => (claims[i]! * END_MARK_CAP) / total - shown[i]!;
  while (sum() < Math.min(total, END_MARK_CAP)) {
    const i = [0, 1, 2].filter((k) => shown[k]! < claims[k]!).reduce((best, k) => (owed(k) > owed(best) ? k : best));
    shown[i]! += 1;
  }
  while (sum() > END_MARK_CAP) shown[shown.indexOf(Math.max(...shown))]! -= 1;
  return { marks: END_ORDER.flatMap((kind, i) => Array<EndMark>(shown[i]!).fill(kind)), overflow: total - sum() };
}

/**
 * The box of a ring that goes round a block of centred lines `widths` px wide and `lineHeight` px tall each,
 * standing `pad` px off them. An ellipse as tall as the block plus its padding is made wide enough to clear
 * the corners of every line, so the pencil never runs through the text it selects.
 */
export function ringAround(widths: number[], lineHeight: number, pad: { x: number; y: number }): { width: number; height: number } {
  const half = (widths.length * lineHeight) / 2;
  const b = half + pad.y;
  let a = 0;
  widths.forEach((width, i) => {
    // The corner of this line that lies furthest from the middle of the block.
    const y = Math.max(Math.abs(-half + i * lineHeight), Math.abs(-half + (i + 1) * lineHeight));
    a = Math.max(a, (width / 2 + pad.x) / Math.sqrt(1 - (y / b) ** 2));
  });
  return { width: 2 * a, height: 2 * b };
}
