import React from 'react';
import { theme } from '../../theme';
import { LIMITS, clampEnd, countUp, fitLine, textUnits } from '../text';
import { Frame, Label, Rise, Rule, useContentBox, useMotion, type SceneOf } from '../ui';

const { font, size, leading, tracking, space, advance } = theme;

const MAX_ITEMS = 6;

export const Stats: React.FC<{ scene: SceneOf<'stats'> }> = ({ scene }) => {
  const m = useMotion();
  const box = useContentBox();
  const items = scene.items.slice(0, MAX_ITEMS).map((item) => ({ label: clampEnd(item.label, LIMITS.statLabel), value: clampEnd(item.value, LIMITS.statValue) }));

  // One row up to three values, two by two for four, three across for five and six.
  const columns = items.length <= 3 ? Math.max(1, items.length) : items.length === 4 ? 2 : 3;
  const cellWidth = (box.width - (columns - 1) * space.xl) / columns;
  const longest = Math.max(1, ...items.map((item) => textUnits(item.value)));
  const fontSize = fitLine(longest, cellWidth, { ...size.stat, advance: advance.figure });

  return (
    <Frame label="By the numbers">
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, columnGap: space.xl, rowGap: space.xl, alignContent: 'center' }}>
        {items.map((item, i) => (
          <Rise key={i} progress={m.reveal(i, items.length)} style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
            <Rule />
            <div style={{ fontFamily: font.display, fontSize, lineHeight: leading.display, letterSpacing: tracking.display, whiteSpace: 'nowrap' }}>{countUp(item.value, m.span(0, 1))}</div>
            <Label>{item.label}</Label>
          </Rise>
        ))}
      </div>
    </Frame>
  );
};
