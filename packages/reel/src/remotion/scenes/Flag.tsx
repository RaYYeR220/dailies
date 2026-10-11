import React from 'react';
import { spring } from 'remotion';
import { theme } from '../../theme';
import { LIMITS, clampEnd, fitSize, textUnits } from '../text';
import { Frame, Label, Rise, Rule, useContentBox, useMotion, type SceneOf } from '../ui';

const { color, font, size, weight, leading, tracking, radius, space, stroke, advance, motion } = theme;

// Shares of the content box the two texts may fill; the stamp row and the labels take the rest.
const QUOTE_SHARE = 0.33;
const REALITY_SHARE = 0.21;

export const Flag: React.FC<{ scene: SceneOf<'flag'> }> = ({ scene }) => {
  const m = useMotion();
  const box = useContentBox();
  const tone = scene.verdict === 'contradicted' ? color.bad : color.stale;
  const quote = clampEnd(scene.quote.trim(), LIMITS.flagQuote);
  const reality = clampEnd(scene.reality.trim(), LIMITS.flagReality);

  const quoteWidth = box.width - space.lg - stroke.bar;
  const quoteSize = fitSize(textUnits(quote) + 2, { width: quoteWidth, height: box.height * QUOTE_SHARE }, { ...size.claim, advance: advance.display, leading: leading.quote });
  const realitySize = fitSize(textUnits(reality), { width: box.width, height: box.height * REALITY_SHARE }, { ...size.reality, advance: advance.text, leading: leading.text });

  // The claim, then the record, then the stamp drops on the pair.
  const stampAt = m.settle * 0.6;
  const stamp = spring({ frame: m.frame - stampAt, fps: m.fps, config: motion.stamp, durationInFrames: Math.max(1, Math.round(m.settle - stampAt)) });

  return (
    <Frame label="Claim against the record">
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.lg }}>
        <Rise progress={m.span(0, 0.3)} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <Label>The agent wrote</Label>
          <div style={{ borderLeft: `${stroke.bar}px solid ${color.edge}`, paddingLeft: space.lg, fontFamily: font.display, fontStyle: 'italic', fontSize: quoteSize, lineHeight: leading.quote, letterSpacing: tracking.display, overflowWrap: 'anywhere' }}>
            “{quote}”
          </div>
        </Rise>
        <div style={{ display: 'flex', alignItems: 'center', gap: space.md, padding: `${space.sm}px 0` }}>
          <div
            style={{
              opacity: m.frame >= stampAt ? 1 : 0,
              transform: `rotate(${motion.stampTilt}deg) scale(${motion.stampFrom + (1 - motion.stampFrom) * stamp})`,
              border: `${stroke.bar}px solid ${tone}`,
              borderRadius: radius.sm,
              padding: `${space.xs}px ${space.md}px`,
              color: tone,
              fontFamily: font.text,
              fontSize: size.stamp,
              fontWeight: weight.medium,
              lineHeight: leading.text,
              letterSpacing: tracking.label,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {scene.verdict}
          </div>
          <div style={{ flex: 1 }}>
            <Rule progress={m.span(0.3, 0.6)} tone={tone} />
          </div>
        </div>
        <Rise progress={m.span(0.3, 0.6)} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <Label tone={tone}>The record shows</Label>
          <div style={{ fontSize: realitySize, fontWeight: weight.medium, lineHeight: leading.text, overflowWrap: 'anywhere' }}>{reality}</div>
        </Rise>
      </div>
    </Frame>
  );
};
