import React from 'react';
import { theme } from '../../theme';
import { WIDTH } from '../config';
import { glassRoom, linesRoom } from '../lens';
import { FACE, emOf } from '../measure';
import { boxRoom, clampEnd, fitText } from '../text';
import { GlassBlock, Lines, RepoName, Rise, Type, fitRepo, useScene, type SceneParts } from '../ui';

const { color, size, leading, space, layout, loupe } = theme;

// The schema puts no limit on these two, so the scene sets its own.
const REPO_CHARS = 80;
const WINDOW_CHARS = 60;
const WINDOW_LINES = 3;
const NAME_LINES = 4;
// The greeked lines of the magnified frame around the name, as shares of the glass radius: x, y, length.
const GREEK: [number, number, number][] = [[-0.5, -0.7, 0.5], [-0.5, -0.61, 0.76], [-0.39, 0.55, 0.62], [-0.39, 0.64, 0.39]];
const GREEK_CLEAR = 1;   // the name may be this tall, as a share of the radius, before the greeked lines make way

const count = (n: number, word: string) => `${n.toLocaleString('en-US')} ${n === 1 ? word : `${word}s`}`;

export const Title: SceneParts<'title'> = {
  Film: () => null,

  Glass: ({ scene }) => {
    const { shot } = useScene();
    const room = glassRoom(shot.lens);
    const fit = fitRepo(clampEnd(scene.repo, REPO_CHARS), size.display.repo, (above) => linesRoom(room, above), NAME_LINES);
    const r = loupe.glass * shot.lens.scale;
    const bar = r * loupe.greek.bar;
    return (
      <>
        {fit.height < r * GREEK_CLEAR
          ? GREEK.map(([x, y, length], i) => (
              <div key={i} style={{ position: 'absolute', left: x * r, top: y * r, width: length * r, height: bar, borderRadius: bar, background: color.white, opacity: loupe.greek.opacity }} />
            ))
          : null}
        <GlassBlock at={room}>
          <RepoName fit={fit} align="center" />
        </GlassBlock>
      </>
    );
  },

  Over: ({ scene }) => {
    const m = useScene();
    const left = m.shot.lens.x + loupe.skirt.outer * m.shot.lens.scale + space.md;
    const width = WIDTH - layout.margin - left;
    const type = { ...size.display.window, leading: leading.display };
    const label = fitText(clampEnd(scene.windowLabel, WINDOW_CHARS), type, boxRoom(width, WINDOW_LINES * type.min * type.leading), emOf(FACE.light), { maxLines: WINDOW_LINES, fewest: true });
    return (
      <>
        <Rise progress={m.enter(0)} style={{ position: 'absolute', left: layout.margin, top: layout.margin - space.lg }}>
          <Type face={FACE.semi} size={size.display.wordmark.min} leading={leading.solid}>Dailies</Type>
        </Rise>
        <div style={{ position: 'absolute', left, top: layout.margin, width }}>
          <Rise progress={m.enter(1)}>
            <Lines fitted={label} face={FACE.light} leading={leading.display} />
          </Rise>
          <Rise progress={m.enter(2)} style={{ marginTop: space.lg }}>
            <Type face={FACE.body} size={size.text.detail} tone={color.soft}>{`${count(scene.sessionCount, 'session')}, ${count(scene.commitCount, 'commit')}`}</Type>
          </Rise>
        </div>
      </>
    );
  },
};
