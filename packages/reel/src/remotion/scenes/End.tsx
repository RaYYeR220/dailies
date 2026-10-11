import React from 'react';
import { theme } from '../../theme';
import { clampEnd } from '../text';
import { Frame, Label, Rise, Rule, useMotion, type SceneOf } from '../ui';
import { Count, Hero } from './Title';

const { color, space } = theme;

const REPO_CHARS = 80;

export const End: React.FC<{ scene: SceneOf<'end'> }> = ({ scene }) => {
  const m = useMotion();
  return (
    <Frame full>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.lg }}>
        <Rise progress={m.enter(0)} style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
          <Label tone={color.accent}>End of reel</Label>
          <Label>Claims checked against the record</Label>
        </Rise>
        <Rise progress={m.enter(1)}>
          <Hero text={clampEnd(scene.repo, REPO_CHARS)} />
        </Rise>
        <Rule progress={m.enter(2)} />
        <Rise progress={m.enter(3)} style={{ display: 'flex', gap: space.xl }}>
          <Count value={scene.verified} unit="verified" tone={color.ok} />
          <Count value={scene.flagged} unit="flagged" tone={scene.flagged > 0 ? color.bad : color.muted} />
        </Rise>
      </div>
    </Frame>
  );
};
