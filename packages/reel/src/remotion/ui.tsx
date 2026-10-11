import React, { createContext, useContext, useEffect, useState } from 'react';
import { Easing, continueRender, delayRender, interpolate } from 'remotion';
import type { Scene } from '@dailies/core';
import { fontsReady, theme } from '../theme';
import type { Span } from './cues';
import type { Shot } from './lens';
import { ringAround } from './pencil';
import { FACE, emOf, faceStyle, forgetMeasures, type Face } from './measure';
import { BREAKS, clampWidth, fitText, sourceRef, splitLast, type Fitted } from './text';

const { color, motion, pencil, size, leading, space } = theme;

export type SceneOf<T extends Scene['type']> = Extract<Scene, { type: T }>;

/** The three layers a scene draws: what is on the film, what is under the glass, and what lies over both. */
export interface SceneParts<T extends Scene['type']> {
  Film: React.FC<{ scene: SceneOf<T> }>;
  Glass: React.FC<{ scene: SceneOf<T> }>;
  Over?: React.FC<{ scene: SceneOf<T> }>;
}

/** What a scene knows about its own time and place while it is on screen. */
export interface Clock {
  /** Frames since the scene's cut: negative while it is still arriving, past `duration` while it leaves. */
  frame: number;
  duration: number;
  fps: number;
  /** Frames after the cut by which the lens has landed on this scene. */
  landing: number;
  /** The spans of the scene's narration lines. */
  lines: Span[];
  shot: Shot;
  /** The y the scene's content has to stay above: the frame's height, or the top of the caption inset. */
  bottom: number;
  /** A still: every cue counts as already passed, so the frame shows the scene as it ends up. */
  settled: boolean;
}

export const SceneContext = createContext<Clock | null>(null);

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(...motion.ease);

/** The scene's clock, with its motion. Every helper but `drawn` has finished by `settle` frames, before the middle of the scene. */
export function useScene() {
  const clock = useContext(SceneContext);
  if (!clock) throw new Error('a scene layer was drawn outside a scene');
  const { frame, fps, duration, landing, settled } = clock;
  const settle = Math.max(1, duration * motion.settleBy);
  const length = Math.max(1, Math.min(motion.enterSec * fps, settle));
  const from = (start: number, frames: number) => interpolate(frame, [start, start + Math.max(1, frames)], [0, 1], { ...CLAMP, easing: ease });
  // Entrances wait for the lens: they start when it is most of the way there.
  const arrive = Math.min(landing * 0.5, Math.max(0, settle - length));
  return {
    ...clock,
    settle,
    arrive,
    /** Entrance of element `order` in a quick stagger once the lens arrives. */
    enter: (order = 0) => from(Math.min(arrive + order * motion.staggerSec * fps, settle - length), length),
    /** Entrance of item `index` of `count`, the starts spread from the arrival to the end of the settle window. */
    reveal: (index: number, count: number) => from(arrive + ((settle - length - arrive) * index) / Math.max(1, count - 1), length),
    /** Eased progress between two shares of the stretch from the arrival to the end of the settle window. */
    span: (start: number, end: number) => from(arrive + (settle - arrive) * start, (settle - arrive) * (end - start)),
    /** How much of a pencil mark cued at `cue` is drawn, 0..1. */
    drawn: (cue: number, seconds: number = motion.drawSec) => (settled ? 1 : interpolate(frame, [cue, cue + Math.max(1, seconds * fps)], [0, 1], CLAMP)),
    /** Frames since `cue`; a still is well past every cue (ten seconds, which any spring has long settled in). */
    since: (cue: number) => (settled ? 10 * fps : frame - cue),
  };
}

/** True once every face has loaded. Text is measured to be fitted, so nothing is laid out before that. */
export function useFonts(): boolean {
  const [handle] = useState(() => delayRender('Loading the reel fonts'));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    // A face that fails to load must not hang the render: the fallback family sets the text instead.
    fontsReady.catch(() => undefined).then(() => { if (live) { forgetMeasures(); setReady(true); } });
    return () => { live = false; };
  }, []);
  useEffect(() => { if (ready) continueRender(handle); }, [ready, handle]);
  return ready;
}

/** Fades and lifts its children in as `progress` goes 0..1. */
export const Rise: React.FC<{ progress: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ progress, style, children }) => (
  <div style={{ opacity: progress, transform: `translateY(${(1 - progress) * motion.riseBy}px)`, ...style }}>{children}</div>
);

const haloOf = (size: number, halo?: string): React.CSSProperties | null => (halo ? { WebkitTextStroke: `${size * pencil.halo}px ${halo}`, paintOrder: 'stroke fill' } : null);

/**
 * Fitted text, one element per line so it sets exactly as it was measured. With `halo` every glyph keeps an
 * outline of that colour under it, which is what lets a pencil mark pass behind type.
 */
export const Lines: React.FC<{ fitted: Fitted; face: Face; leading: number; align?: 'left' | 'center' | 'right'; tone?: string; halo?: string; style?: React.CSSProperties }> = ({
  fitted, face, leading, align = 'left', tone = color.white, halo, style,
}) => (
  <div
    style={{
      ...faceStyle(face, fitted.size, leading),
      color: tone,
      textAlign: align,
      ...haloOf(fitted.size, halo),
      ...style,
    }}
  >
    {fitted.lines.map((line, i) => (
      <div key={i}>{line}</div>
    ))}
  </div>
);

/** One line of type at a fixed size. `halo` as for `Lines`. */
export const Type: React.FC<{ face: Face; size: number; leading?: number; tone?: string; halo?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({
  face, size, leading = theme.leading.text, tone = color.white, halo, style, children,
}) => <div style={{ ...faceStyle(face, size, leading), color: tone, ...haloOf(size, halo), ...style }}>{children}</div>;

/** A way of setting a string: a face and the range of sizes it may take. */
export interface Role { face: Face; type: { max: number; min: number; leading: number } }
export type Room = (count: number, lineHeight: number) => number[] | null;

/**
 * `text` fitted in the first of `roles` that takes it whole. A string too long for the display face at its
 * floor is set in the text face rather than cut; only the last role may shorten it with an ellipsis.
 */
export function fitRoles(text: string, roles: Role[], room: Room, opts: { maxLines?: number; soft?: RegExp; fewest?: boolean } = {}): Fitted & { role: Role } {
  let last: (Fitted & { role: Role }) | null = null;
  for (const role of roles) {
    last = { ...fitText(text, role.type, room, emOf(role.face), opts), role };
    if (!last.cut && last.lines.length > 0) return last;
  }
  if (!last) throw new Error('fitRoles needs at least one role');
  return last;
}

/** The width in px of the widest line of a fitted text. */
export const widthOf = (fitted: Fitted, face: Face): number => Math.max(0, ...fitted.lines.map((line) => emOf(face)(line) * fitted.size));

const OWNER_HEIGHT = size.text.detail * leading.text + space.xs;
const WHOLE_NAME = 0.3;   // a name on one line has to keep this much of its size range, or the owner moves to a line of its own

/**
 * A repo name: `owner/name` on one line of display when that stays large, otherwise the owner in the text face
 * over the name in display, broken where a name may break. `room(above)` is the room for the display lines
 * when `above` px sit over them.
 */
export function fitRepo(repo: string, range: { max: number; min: number }, room: (above: number) => Room, maxLines = 3): { owner: string | null; name: Fitted; height: number } {
  const type = { ...range, leading: leading.display };
  const whole = fitText(repo, type, room(0), emOf(FACE.heavy), { maxLines: 1, soft: BREAKS.name });
  const { head, tail } = splitLast(repo);
  if (!head || (!whole.cut && whole.lines.length > 0 && whole.size >= range.min + (range.max - range.min) * WHOLE_NAME)) {
    const name = head ? whole : fitText(repo, type, room(0), emOf(FACE.heavy), { maxLines, soft: BREAKS.name, fewest: true });
    return { owner: null, name, height: name.lines.length * name.size * leading.display };
  }
  const name = fitText(tail, type, room(OWNER_HEIGHT), emOf(FACE.heavy), { maxLines, soft: BREAKS.name, fewest: true });
  return { owner: head, name, height: OWNER_HEIGHT + name.lines.length * name.size * leading.display };
}

/** The repo name as `fitRepo` set it. */
export const RepoName: React.FC<{ fit: ReturnType<typeof fitRepo>; align?: 'left' | 'center' }> = ({ fit, align = 'left' }) => (
  <div style={{ textAlign: align }}>
    {fit.owner ? (
      <Type face={FACE.body} size={size.text.detail} tone={color.soft} style={{ height: OWNER_HEIGHT }}>{fit.owner}</Type>
    ) : null}
    <Lines fitted={fit.name} face={FACE.heavy} leading={leading.display} align={align} />
  </div>
);

/** A column centred on a point of the glass, measured from the centre of the lens. */
export const GlassBlock: React.FC<{ at: { cx: number; cy: number }; style?: React.CSSProperties; children: React.ReactNode }> = ({ at, style, children }) => (
  <div style={{ position: 'absolute', left: at.cx, top: at.cy, transform: 'translate(-50%, -50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', ...style }}>{children}</div>
);

/** The roles text is fitted in, in the order they are tried. */
export const ROLES = {
  /** A human's words: display while they are few, the text face when they run long. */
  prompt: [{ face: FACE.light, type: { ...size.display.quote, leading: leading.quote } }, { face: FACE.body, type: { ...size.text.quote, leading: leading.text } }],
  claim: [{ face: FACE.semi, type: { ...size.display.quote, leading: leading.quote } }, { face: FACE.text, type: { ...size.text.quote, leading: leading.tight } }],
  result: [{ face: FACE.heavy, type: { ...size.display.result, leading: leading.display } }, { face: FACE.text, type: { ...size.text.value, leading: leading.text } }],
  output: [{ face: FACE.codeStrong, type: { ...size.code.output, leading: leading.code } }],
  figure: [{ face: FACE.figure, type: { ...size.display.figure, leading: leading.display } }, { face: FACE.text, type: { ...size.text.value, leading: leading.text } }],
  value: [{ face: FACE.heavy, type: { ...size.display.value, leading: leading.display } }, { face: FACE.text, type: { ...size.text.value, leading: leading.text } }],
  reality: [{ face: FACE.text, type: { ...size.text.reality, leading: leading.tight } }],
} satisfies Record<string, Role[]>;

/** The height in px of a fitted text. */
export const heightOf = (fitted: Fitted & { role: Role }): number => fitted.lines.length * fitted.size * fitted.role.type.leading;

/** The reference of an entry in the longest form that fits `width` px: with the word `session`, without it, or cut. */
export function fitRef(entryId: string, width: number): string {
  const em = emOf(FACE.code);
  const forms = [sourceRef(entryId), sourceRef(entryId, true)];
  return forms.find((form) => em(form) * size.code.ref <= width) ?? clampWidth(forms[1]!, width / size.code.ref, em);
}

const INK = 0.72;   // the height of a line's letters, as a share of its size

/** The box of a pencil ring round a fitted, centred text, standing `pad` px off its letters. */
export const ringOf = (fitted: Fitted, face: Face, leading: number, pad: { x: number; y: number }) =>
  ringAround(fitted.lines.map((line) => emOf(face)(line) * fitted.size), fitted.size * leading, fitted.size * INK, pad);
