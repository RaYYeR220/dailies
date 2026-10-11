/**
 * Grease-pencil geometry. Every mark is a path a hand could have drawn: a seeded wobble, never a perfect
 * shape. The same seed always gives the same stroke, so the server and the browser render one drawing.
 */

type Point = [number, number];

const r1 = (n: number) => Math.round(n * 10) / 10;

function random(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth curve through the points (Catmull-Rom, written as cubic Béziers). */
function through(points: Point[]): string {
  let d = `M${r1(points[0]![0])},${r1(points[0]![1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(i + 2, points.length - 1)]!;
    const c1: Point = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${r1(c1[0])},${r1(c1[1])} ${r1(c2[0])},${r1(c2[1])} ${r1(p2[0])},${r1(p2[1])}`;
  }
  return d;
}

export interface RingOptions {
  seed?: number;
  /** How far round the hand goes. 1.14 overshoots the start; exactly 1 closes, for a dashed ring. */
  turns?: number;
  /** Where the stroke starts, in radians. The default is at the left, going over the top. */
  start?: number;
  wobble?: number;
  tilt?: number;
  /** How much the loop opens or tightens from start to finish. */
  drift?: number;
}

/** A hand-drawn loop around an ellipse. */
export function ringPath(cx: number, cy: number, rx: number, ry: number, o: RingOptions = {}): string {
  const { seed = 1, turns = 1.14, start = Math.PI * 0.97, wobble = 0.035, tilt = -0.05, drift = -0.1 } = o;
  const rand = random(seed * 7919 + 13);
  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const amp1 = wobble * (0.7 + rand() * 0.6);
  const amp2 = wobble * 0.6 * (0.7 + rand() * 0.6);
  // A closed ring uses whole-number harmonics so the wobble meets itself where the stroke ends.
  const second = turns === 1 ? 2 : 2.3;
  const steps = 30;
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + Math.PI * 2 * turns * t;
    const k = 1 + amp1 * Math.sin(a + phase1) + amp2 * Math.sin(a * second + phase2) + drift * (t - 0.5);
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    points.push([cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)]);
  }
  return through(points);
}

/** Two crossing strokes in a box `w` by `h`, each with a slight bow. */
export function crossPath(cx: number, cy: number, w: number, h: number, seed = 1): string {
  const rand = random(seed * 104729 + 7);
  const j = (m: number) => (rand() - 0.5) * m;
  const [x1, x2, y1, y2] = [cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2];
  const P = (x: number, y: number) => `${r1(x)},${r1(y)}`;
  const down = `M${P(x1 + j(w * 0.05), y1 + j(h * 0.08))} C${P(cx - w * 0.2, cy - h * 0.2 + j(h * 0.1))} ${P(cx + w * 0.16, cy + h * 0.12 + j(h * 0.1))} ${P(x2 + j(w * 0.05), y2 + j(h * 0.08))}`;
  const up = `M${P(x2 + j(w * 0.05), y1 + j(h * 0.08))} C${P(cx + w * 0.18, cy - h * 0.16 + j(h * 0.1))} ${P(cx - w * 0.2, cy + h * 0.2 + j(h * 0.1))} ${P(x1 + j(w * 0.05), y2 + j(h * 0.08))}`;
  return `${down} ${up}`;
}

/** A question mark `h` tall, centred on cx,cy: the hook, then the dot. */
export function questionPath(cx: number, cy: number, h: number): string {
  const s = h / 100;
  const P = (x: number, y: number) => `${r1(cx + x * s)},${r1(cy + y * s)}`;
  return `M${P(-23, -23)} C${P(-25, -57)} ${P(27, -59)} ${P(26, -27)} C${P(25, -6)} ${P(1, -5)} ${P(0, 19)} M${P(-1, 43)} L${P(1, 45)}`;
}
