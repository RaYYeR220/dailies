import React from 'react';
import { theme } from '../../theme';
import { clampEnd } from '../text';
import { Count, Frame, Hero, Label, Rise, Rule, useMotion, type SceneOf } from '../ui';

const { color, space } = theme;

// The schema puts no limit on these two, so the scene sets its own.
const REPO_CHARS = 80;
const WINDOW_CHARS = 60;

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
