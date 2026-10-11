import React from 'react';
import { theme } from '../../theme';
import { clampEnd, fitSize, textUnits } from '../text';
import { Frame, Label, Rise, Rule, useContentBox, useMotion, type SceneOf } from '../ui';

const { color, font, size, weight, leading, tracking, space, advance } = theme;

// The schema puts no limit on these two, so the scene sets its own.
const REPO_CHARS = 80;
const WINDOW_CHARS = 60;

export const Count: React.FC<{ value: number; unit: string; tone?: string }> = ({ value, unit, tone = color.text }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: space.sm }}>
    <div style={{ fontFamily: font.display, fontSize: size.count, lineHeight: leading.display, color: tone }}>{value.toLocaleString('en-US')}</div>
    <Label>{unit}</Label>
  </div>
);

/** The repo name as large as two lines of the content box allow. */
export const Hero: React.FC<{ text: string }> = ({ text }) => {
  const box = useContentBox(true);
  const fontSize = fitSize(textUnits(text), { width: box.width, height: size.hero.max * leading.display * 2 }, { ...size.hero, advance: advance.display, leading: leading.display });
  return (
    <div style={{ fontFamily: font.display, fontSize, fontWeight: weight.regular, lineHeight: leading.display, letterSpacing: tracking.display, overflowWrap: 'anywhere' }}>{text}</div>
  );
};

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

export const Title: React.FC<{ scene: SceneOf<'title'> }> = ({ scene }) => {
  const m = useMotion();
  return (
    <Frame full>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.lg }}>
        <Rise progress={m.enter(0)} style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
          <Label tone={color.accent}>Dailies</Label>
          <Label>{clampEnd(scene.windowLabel, WINDOW_CHARS)}</Label>
        </Rise>
        <Rise progress={m.enter(1)}>
          <Hero text={clampEnd(scene.repo, REPO_CHARS)} />
        </Rise>
        <Rule progress={m.enter(2)} />
        <Rise progress={m.enter(3)} style={{ display: 'flex', gap: space.xl }}>
          <Count value={scene.sessionCount} unit={plural(scene.sessionCount, 'session')} />
          <Count value={scene.commitCount} unit={plural(scene.commitCount, 'commit')} />
        </Rise>
      </div>
    </Frame>
  );
};
