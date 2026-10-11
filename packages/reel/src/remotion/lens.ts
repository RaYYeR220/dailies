// Where the loupe is at every frame: pure, so it runs under vitest and in the browser alike.
// A scene declares a shot (where the lens rests, how large, over what film); `lensPath` strings the resting
// places together with a glide across every cut; `framing` adds the film that passes under the lens meanwhile.
import { measureSpring, spring } from 'remotion';
import type { Scene, Storyboard } from '@dailies/core';
import type { Timeline } from '../timeline';
import { theme } from '../theme';
import { HEIGHT, WIDTH } from './config';
import { MAX_STEPS } from './cues';
import { endMarks } from './pencil';
import { stripOf } from './strip';

const { shot, loupe, layout, motion, film } = theme;

/** A resting place: the centre of the lens in px, its scale (1 is a 276 px glass) and the turn of its barrel in degrees. */
export interface LensRest { x: number; y: number; scale: number; turn: number }

/** The lens at one frame. At rest `from` and `to` are the same scene; in a glide `progress` runs from 0 towards 1. */
export interface LensState extends LensRest { from: number; to: number; progress: number }

export interface LensPath {
  /** One resting place per scene, in scene order. */
  rests: LensRest[];
  /** One glide per cut: it leaves at `start`, is half way at `cut` and has landed by `end`. */
  transitions: { start: number; cut: number; end: number }[];
  at(frame: number): LensState;
}

/** What a scene declares: where the lens rests and the film it rests on. */
export interface Shot {
  lens: LensRest;
  /** Screen px of the pitch of a full frame under this lens. */
  unit: number;
  /** Portrait half-frames instead of full landscape ones. */
  half: boolean;
  /** Perforations from the start of the scene's first frame to the point under the centre of the lens. */
  at: number;
  /** The first and the last frame the scene puts content on; every other frame of its stretch is greeked. */
  frames: readonly [number, number];
}

const ramp = (t: number, from: number, to: number) => Math.max(0, Math.min(1, (t - from) / (to - from)));
const MAX_STATS = shot.stats.scale.length;
const NONE = [0, -1] as const;
const OVERFLOW_SLOTS = 2.5;   // frames of room the `+n` after the end card's marks takes

function statsShot(count: number): Omit<Shot, 'lens' | 'frames'> & { x: number; scale: number } {
  const n = Math.max(1, Math.min(MAX_STATS, count));
  const scale = shot.stats.scale[n - 1]!;
  const reach = loupe.skirt.outer * scale;
  // A single value sits under a centred lens. With more, the lens moves to the head of the strip and the
  // remaining values start right where its skirt ends.
  if (n === 1) return { x: WIDTH / 2, scale, unit: shot.stats.maxPitch * 2, half: true, at: film.perforations / 4 };
  const x = reach - shot.stats.bleed[n - 1]!;
  const clear = reach + shot.stats.gap;
  const pitch = Math.min(shot.stats.maxPitch, (WIDTH - layout.margin / 4 - x - clear) / (n - 1));
  return { x, scale, unit: pitch * 2, half: true, at: film.perforations / 2 - clear / (pitch / (film.perforations / 2)) };
}

/** The pitch of the small frames on the end card and where the marks stop, for `frames` marks and maybe a `+n` after them. */
export function endStrip(frames: number, overflow: boolean): { pitch: number; marksEnd: number } {
  const slots = frames + (overflow ? OVERFLOW_SLOTS : 0);
  const pitch = slots * shot.end.pitch <= shot.end.reach + shot.end.pitch ? shot.end.pitch : Math.max(shot.end.minPitch, shot.end.reach / slots);
  const lensEdge = shot.end.x - loupe.skirt.outer * shot.end.scale + shot.end.overlap;
  return { pitch, marksEnd: lensEdge - (overflow ? OVERFLOW_SLOTS * pitch : 0) };
}

/** The shot of a scene. In a captions cut a narrated scene sits higher, clear of the caption bar. */
export function shotOf(scene: Scene, captions = false): Shot {
  const lift = captions && scene.lines.length > 0 ? layout.captionInset / 2 : 0;
  const centre = film.perforations / 2;
  switch (scene.type) {
    case 'title': return { lens: { x: shot.title.x, y: shot.title.y, scale: shot.title.scale, turn: shot.title.turn }, unit: shot.title.unit, half: false, at: centre, frames: NONE };
    case 'prompt': return { lens: { x: shot.prompt.x, y: shot.prompt.y - lift, scale: shot.prompt.scale, turn: shot.prompt.turn }, unit: shot.prompt.unit, half: false, at: centre, frames: [0, 0] };
    case 'terminal': {
      const steps = Math.min(MAX_STEPS, scene.steps.length);
      const frames = [0, steps - 1] as const;
      // A single step has the frame to itself: the lens sits in the middle of it, and larger.
      if (steps <= 1) return { lens: { x: shot.terminal.alone.x, y: shot.terminal.y - lift, scale: shot.terminal.alone.scale, turn: shot.terminal.turn }, unit: shot.terminal.unit, half: false, at: centre, frames };
      return { lens: { x: shot.terminal.x, y: shot.terminal.y - lift, scale: shot.terminal.scale, turn: shot.terminal.turn }, unit: shot.terminal.unit, half: false, at: shot.terminal.at, frames };
    }
    case 'diff': return { lens: { x: shot.diff.x, y: shot.diff.y - lift, scale: shot.diff.scale, turn: shot.diff.turn }, unit: shot.diff.unit, half: false, at: centre, frames: [0, 0] };
    case 'stats': {
      const s = statsShot(scene.items.length);
      return { lens: { x: s.x, y: shot.stats.y - lift, scale: s.scale, turn: shot.stats.turn }, unit: s.unit, half: true, at: s.at, frames: [0, Math.min(MAX_STATS, scene.items.length) - 1] };
    }
    case 'flag': {
      // The quote is frame 0; the lens rests on the frame after it. A long record gets a larger glass, which
      // grows away from the quote so the quote's frame stays where it is.
      const scale = shot.flag.scale + shot.flag.grow * ramp(scene.reality.length, shot.flag.short, shot.flag.long);
      const x = shot.flag.x + loupe.skirt.outer * (scale - shot.flag.scale);
      const at = film.perforations + centre + (x - shot.flag.x) / (shot.flag.unit / film.perforations);
      return { lens: { x, y: shot.flag.y - lift, scale, turn: shot.flag.turn }, unit: shot.flag.unit, half: false, at, frames: [0, 1] };
    }
    case 'end': {
      const { marks, overflow } = endMarks(scene);
      const { pitch, marksEnd } = endStrip(marks.length, overflow > 0);
      const per = film.perforations / 2;
      return { lens: { x: shot.end.x, y: shot.end.y, scale: shot.end.scale, turn: shot.end.turn }, unit: pitch * 2, half: true, at: marks.length * per + (shot.end.x - marksEnd) / (pitch / per), frames: NONE };
    }
  }
}

// The glide: a spring that follows a short ramp instead of a step, so the lens leaves softly and still settles
// like a spring. Tabulated once; a transition reads it through a time warp that puts the cut at half way.
const GLIDE = (() => {
  const { config, rampFrames } = motion.glide;
  const fps = 30;
  const length = measureSpring({ fps, config, threshold: 0.002 }) + rampFrames;
  const raw = Array.from({ length: length + 1 }, (_, f) => {
    let sum = 0;
    for (let j = 0; j < rampFrames; j++) sum += f - j <= 0 ? 0 : spring({ frame: f - j, fps, config });
    return sum / rampFrames;
  });
  const table = raw.map((v) => v / raw[length]!);
  const after = table.findIndex((v) => v >= 0.5);
  const half = after - 1 + (0.5 - table[after - 1]!) / (table[after]! - table[after - 1]!);
  return { table, length, half };
})();

function glideAt(time: number): number {
  const t = Math.max(0, Math.min(GLIDE.length, time));
  const i = Math.min(GLIDE.length - 1, Math.floor(t));
  return GLIDE.table[i]! + (GLIDE.table[i + 1]! - GLIDE.table[i]!) * (t - i);
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The path of the lens through a reel: one resting place per scene and a glide over every cut.
 * The glide starts before the cut and lands inside the settle window of the scene it enters, so the lens
 * is still again well before the middle of that scene.
 */
export function lensPath(timeline: Timeline, storyboard: Storyboard, opts: { captions?: boolean } = {}): LensPath {
  const rests = storyboard.scenes.map((scene) => shotOf(scene, opts.captions ?? false).lens);
  const transitions = timeline.scenes.slice(1).map((into, i) => {
    const out = timeline.scenes[i]!;
    const lead = Math.min(Math.round(motion.glide.leadSec * timeline.fps), Math.floor(out.durationInFrames / 2));
    const follow = Math.min(Math.round(motion.glide.followSec * timeline.fps), Math.floor(into.durationInFrames * motion.settleBy));
    return { start: into.startFrame - lead, cut: into.startFrame, end: into.startFrame + follow };
  });

  const resting = (i: number): LensState => ({ ...rests[i]!, from: i, to: i, progress: 0 });
  const at = (frame: number): LensState => {
    let index = 0;
    for (const [i, t] of transitions.entries()) {
      if (frame >= t.end) { index = i + 1; continue; }
      if (frame <= t.start) break;
      const time = frame <= t.cut
        ? ((frame - t.start) / (t.cut - t.start)) * GLIDE.half
        : GLIDE.half + ((frame - t.cut) / (t.end - t.cut)) * (GLIDE.length - GLIDE.half);
      const progress = glideAt(time);
      const [a, b] = [rests[i]!, rests[i + 1]!];
      return { x: mix(a.x, b.x, progress), y: mix(a.y, b.y, progress), scale: mix(a.scale, b.scale, progress), turn: mix(a.turn, b.turn, progress), from: i, to: i + 1, progress };
    }
    return resting(index);
  };
  return { rests, transitions, at };
}

/** The share of the frame the glass covers, 0..1. The lit glass is what keeps a frame of the dark room from reading as black. */
export function glassShare(lens: { x: number; y: number; scale: number }): number {
  const r = loupe.glass * lens.scale;
  const rows = 240;
  let area = 0;
  for (let i = 0; i < rows; i++) {
    const y = ((i + 0.5) / rows) * HEIGHT;
    const dy = y - lens.y;
    if (Math.abs(dy) >= r) continue;
    const half = Math.sqrt(r * r - dy * dy);
    area += Math.max(0, Math.min(WIDTH, lens.x + half) - Math.max(0, lens.x - half)) * (HEIGHT / rows);
  }
  return area / (WIDTH * HEIGHT);
}

/**
 * One scene's film as the camera sees it: how far along its own frames the lens is (`focus`, in perforations),
 * how much of what the scene put on the film shows (`presence`) and how much of its bare frames (`frames`).
 */
export interface Take { index: number; shot: Shot; focus: number; presence: number; frames: number }

/** The lens and the film under it at one frame. In a glide both scenes are on the strip, one leaving and one arriving. */
export interface Framing { lens: LensState; unit: number; takes: Take[] }

/**
 * Perforations of film that pass under the lens between two scenes: about `motion.travel` px of it, adjusted
 * so that the perforations of the scene being left run on into those of the scene being entered.
 */
export function travel(a: Shot, focusA: number, b: Shot): number {
  const mean = Math.sqrt(stripOf(a.unit, a.half).perf * stripOf(b.unit, b.half).perf);
  const whole = Math.round(motion.travel / mean);
  return whole + ((((b.at - focusA - whole) % 1) + 1) % 1);
}

const OPENING_PERFORATIONS = 10;   // how far the film is pulled in under the lens as the reel opens

/**
 * The framing at `frame`. `focusOf(i)` is where the lens is along scene `i`'s own frames right now; a scene that
 * advances its strip while it plays (the terminal) moves that, every other scene leaves it at its shot's `at`.
 */
export function framing(path: LensPath, shots: Shot[], frame: number, focusOf: (index: number) => number): Framing {
  const lens = path.at(frame);
  if (lens.from === lens.to) {
    const shot = shots[lens.from]!;
    // The reel opens on the second half of a glide: the film is pulled into place under a lens that is already waiting.
    const open = path.transitions[0] ? Math.max(1, path.transitions[0].end - path.transitions[0].cut) : 1;
    const e = lens.from === 0 && frame < open ? glideAt(GLIDE.half + (Math.max(0, frame) / open) * (GLIDE.length - GLIDE.half)) : 1;
    const away = (1 - e) * 2 * OPENING_PERFORATIONS;
    return { lens, unit: shot.unit, takes: [{ index: lens.from, shot, focus: focusOf(lens.from) - away, presence: ramp(e, 0.5, 0.92), frames: 1 }] };
  }
  const [a, b] = [shots[lens.from]!, shots[lens.to]!];
  const e = lens.progress;
  const left = focusOf(lens.from);
  const distance = travel(a, left, b);
  return {
    lens,
    unit: a.unit * (b.unit / a.unit) ** e,
    takes: [
      { index: lens.from, shot: a, focus: left + e * distance, presence: 1 - ramp(e, 0.04, 0.34), frames: 1 - ramp(e, 0.3, 0.62) },
      { index: lens.to, shot: b, focus: focusOf(lens.to) - (1 - e) * distance, presence: ramp(e, 0.5, 0.92), frames: ramp(e, 0.38, 0.7) },
    ],
  };
}

/**
 * The room for text under the glass at a resting place: a block centred on (`cx`, `cy`) from the centre of the
 * lens, at most `height` tall, and `width(top, bottom)` wide for a line between those two heights of the block.
 * It keeps `loupe.rim` clear of the edge of the glass and of the frame, and stays above `bottom`.
 */
export interface GlassRoom {
  cx: number;
  cy: number;
  height: number;
  width(top: number, bottom: number): number;
  /** How far the glass runs to the left and to the right of the block's centre at height `y` of the block. */
  reach(y: number): readonly [number, number];
}

export function glassRoom(rest: LensRest, bottom: number = HEIGHT, rim: number = loupe.rim): GlassRoom {
  const r = loupe.glass * rest.scale - rim;
  const side = layout.margin / 2;
  const top = Math.max(-r, side - rest.y);
  const floor = Math.min(r, bottom - side / 2 - rest.y);
  const cy = (top + floor) / 2;
  const reach = (y: number) => {
    const half = Math.sqrt(Math.max(0, r * r - y * y));
    return [Math.max(-half, side - rest.x), Math.min(half, WIDTH - side - rest.x)] as const;
  };
  const [l0, r0] = reach(cy);
  const cx = (l0 + r0) / 2;
  return {
    cx,
    cy,
    height: Math.max(0, floor - top),
    reach: (y) => { const [l, rr] = reach(cy + y); return [cx - l, rr - cx] as const; },
    width: (t, b) => {
      // The narrowest of the chords at the two edges of the line, measured symmetrically about the block's centre.
      const spans = [reach(cy + t), reach(cy + b)];
      return Math.max(0, 2 * Math.min(...spans.map(([l, rr]) => Math.min(cx - l, rr - cx))));
    },
  };
}

/**
 * A room for `fitText` inside a glass: the lines sit in a block that also holds `above` px over them and `below`
 * px under, centred in the glass. No line is given more than `cap` px, which keeps a measure readable.
 */
export function linesRoom(room: GlassRoom, above = 0, below = 0, cap = Infinity) {
  return (count: number, lineHeight: number): number[] | null => {
    const height = above + count * lineHeight + below;
    if (height > room.height) return null;
    const top = -height / 2 + above;
    const widths = Array.from({ length: count }, (_, i) => Math.min(cap, room.width(top + i * lineHeight, top + (i + 1) * lineHeight)));
    return widths.every((w) => w > 0) ? widths : null;
  };
}
