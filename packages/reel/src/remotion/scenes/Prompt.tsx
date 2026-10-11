import React from 'react';
import { interpolate } from 'remotion';
import { theme } from '../../theme';
import { LIMITS, clampEnd, fitSize, textUnits } from '../text';
import { Frame, Label, Rise, useContentBox, useMotion, type SceneOf } from '../ui';

const { color, font, size, leading, tracking, space, stroke, advance } = theme;

const SESSION_CHARS = 12;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const Prompt: React.FC<{ scene: SceneOf<'prompt'> }> = ({ scene }) => {
  const m = useMotion();
  const box = useContentBox();
  // Line breaks are flattened: the size is fitted to continuous text, and a pasted list would outgrow its rows.
  const chars = Array.from(clampEnd(scene.quote.replace(/\s+/g, ' ').trim(), LIMITS.promptQuote));
  const footer = size.label * leading.text + space.lg;
  const fontSize = fitSize(textUnits(chars.join('')), { width: box.width - space.lg - stroke.bar, height: box.height - footer }, { ...size.quote, advance: advance.display, leading: leading.quote });

  // Typed on over the settle window. The untyped rest is laid out but invisible, so lines never re-wrap mid-word.
  const typed = Math.floor(interpolate(m.frame, [0, m.settle], [0, chars.length], CLAMP));
  const cursor = 1 - m.span(1, 1.2);

  return (
    <Frame label="The prompt">
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div style={{ borderLeft: `${stroke.bar}px solid ${color.accent}`, paddingLeft: space.lg, fontFamily: font.display, fontSize, lineHeight: leading.quote, letterSpacing: tracking.display, overflowWrap: 'anywhere' }}>
          <span>{chars.slice(0, typed).join('')}</span>
          <span style={{ borderRight: `${stroke.hair}px solid ${color.accent}`, marginRight: -stroke.hair, opacity: cursor }} />
          <span style={{ opacity: 0 }}>{chars.slice(typed).join('')}</span>
        </div>
      </div>
      <Rise progress={m.enter(1)} style={{ height: footer, display: 'flex', alignItems: 'flex-end', gap: space.md }}>
        <Label tone={color.accent}>Human prompt</Label>
        <div style={{ fontFamily: font.mono, fontSize: size.label, lineHeight: leading.text, color: color.muted }}>session {clampEnd(scene.sessionId, SESSION_CHARS)}</div>
      </Rise>
    </Frame>
  );
};
