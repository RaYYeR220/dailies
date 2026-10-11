import React, { createContext, useContext } from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Scene } from '@dailies/core';
import { theme } from '../theme';
import { clampStart } from './text';

const { color, font, size, weight, leading, tracking, space, stroke, layout, motion } = theme;

export type SceneOf<T extends Scene['type']> = Extract<Scene, { type: T }>;

export const ReelContext = createContext<{ repo: string; captions: boolean }>({ repo: '', captions: false });

const HEADER_REPO_CHARS = 48;

/** The area a scene may draw in. It is shorter in captions mode so the caption bar never covers content. */
export function useContentBox(full = false): { width: number; height: number } {
  const { width, height } = useVideoConfig();
  const { captions } = useContext(ReelContext);
  const bottom = captions && !full ? layout.contentBottomCaptions : layout.contentBottom;
  return { width: width - 2 * layout.marginX, height: height - layout.contentTop - bottom };
}

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const ease = Easing.bezier(...motion.ease);

/** Scene-local motion. Every helper has finished by `settle` frames, before the middle of the scene. */
export function useMotion() {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const settle = Math.max(1, durationInFrames * motion.settleBy);
  const length = Math.max(1, Math.min(motion.enterSec * fps, settle));
  const from = (start: number, frames: number) => interpolate(frame, [start, start + Math.max(1, frames)], [0, 1], { ...CLAMP, easing: ease });
  return {
    frame,
    fps,
    settle,
    /** Entrance of element `order` in a quick stagger from the top of the scene. */
    enter: (order = 0) => from(Math.min(order * motion.staggerSec * fps, settle - length), length),
    /** Entrance of item `index` of `count`, the starts spread across the settle window. */
    reveal: (index: number, count: number) => from(((settle - length) * index) / Math.max(1, count - 1), length),
    /** Linear progress through slot `index` when the settle window is cut into `count` equal slots. */
    slot: (index: number, count: number) => interpolate(frame, [(settle * index) / count, Math.max((settle * index) / count + 1, (settle * (index + 1)) / count)], [0, 1], CLAMP),
    /** Eased progress between two shares of the settle window. */
    span: (start: number, end: number) => from(settle * start, settle * (end - start)),
  };
}

/** Fades and lifts its children in as `progress` goes 0..1. */
export const Rise: React.FC<{ progress: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ progress, style, children }) => (
  <div style={{ opacity: progress, transform: `translateY(${(1 - progress) * motion.riseBy}px)`, ...style }}>{children}</div>
);

export const Label: React.FC<{ tone?: string; children: React.ReactNode }> = ({ tone = color.muted, children }) => (
  <div style={{ fontFamily: font.text, fontSize: size.label, fontWeight: weight.medium, lineHeight: leading.text, letterSpacing: tracking.label, textTransform: 'uppercase', color: tone }}>
    {children}
  </div>
);

/** A hairline that draws itself from the left. */
export const Rule: React.FC<{ progress?: number; tone?: string }> = ({ progress = 1, tone = color.edge }) => (
  <div style={{ height: stroke.hair, width: `${progress * 100}%`, background: tone }} />
);

export const Panel: React.FC<{ style?: React.CSSProperties; children: React.ReactNode }> = ({ style, children }) => (
  <div style={{ background: color.panel, border: `${stroke.hair}px solid ${color.edge}`, borderRadius: theme.radius.lg, overflow: 'hidden', ...style }}>{children}</div>
);

/** Pass or fail, told apart by shape as well as colour. */
export const Mark: React.FC<{ ok: boolean; progress?: number }> = ({ ok, progress = 1 }) => (
  <svg width={size.icon} height={size.icon} viewBox="0 0 24 24" fill="none" style={{ opacity: progress, transform: `scale(${progress})`, flexShrink: 0 }}>
    <path
      d={ok ? 'M4.5 12.5l5 5L19.5 7' : 'M6 6l12 12M18 6L6 18'}
      stroke={ok ? color.ok : color.bad}
      strokeWidth={stroke.icon}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * The shared scene frame: an optional header naming the scene kind and the repo, and the content box under it.
 * `full` ignores the caption inset, for scenes that are never narrated.
 */
export const Frame: React.FC<{ label?: string; full?: boolean; children: React.ReactNode }> = ({ label, full = false, children }) => {
  const { repo } = useContext(ReelContext);
  const box = useContentBox(full);
  const m = useMotion();
  return (
    <AbsoluteFill style={{ color: color.text, fontFamily: font.text }}>
      {label ? (
        <div style={{ position: 'absolute', top: layout.headerTop, left: layout.marginX, right: layout.marginX, display: 'flex', justifyContent: 'space-between', alignItems: 'center', opacity: m.enter() }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
            <div style={{ width: space.md, height: stroke.bar, background: color.accent }} />
            <Label tone={color.text}>{label}</Label>
          </div>
          <div style={{ fontFamily: font.mono, fontSize: size.label, lineHeight: leading.text, color: color.faint }}>{clampStart(repo, HEADER_REPO_CHARS)}</div>
        </div>
      ) : null}
      <div style={{ position: 'absolute', top: layout.contentTop, left: layout.marginX, width: box.width, height: box.height, display: 'flex', flexDirection: 'column' }}>{children}</div>
    </AbsoluteFill>
  );
};
