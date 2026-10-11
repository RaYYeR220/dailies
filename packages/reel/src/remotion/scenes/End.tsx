import { theme } from '../../theme';
import { OnFrame } from '../Film';
import { glassRoom, linesRoom } from '../lens';
import { Mark } from '../marks';
import { FACE, emOf } from '../measure';
import { endMarks, type EndMark } from '../pencil';
import { frameBox, stripOf } from '../strip';
import { boxRoom, clampEnd, fitText } from '../text';
import { GlassBlock, Lines, RepoName, Rise, Type, fitRepo, useScene, type SceneParts } from '../ui';

const { color, size, leading, space, layout, loupe, dim, motion, film } = theme;

const REPO_CHARS = 80;
const HERO_LINES = 3;
// The size of each mark as a share of the pitch of its frame, and its stroke.
const SHAPE: Record<EndMark, { width: number; height: number }> = { ring: { width: 0.6, height: 0.76 }, cross: { width: 0.72, height: 1 }, question: { width: 0.5, height: 0.8 } };
const STROKE = { share: 0.062, min: 4, max: 9 };
const TALLY_MARK = 52;     // px of the mark in front of each count
const TALLY_STROKE = 6.5;
const STAGGER = 4;         // frames between two marks drawing on

const stroke = (pitch: number) => Math.max(STROKE.min, Math.min(STROKE.max, pitch * STROKE.share));

export const End: SceneParts<'end'> = {
  Film: ({ scene }) => {
    const m = useScene();
    const { marks, overflow } = endMarks(scene);
    const strip = stripOf(m.shot.unit, m.shot.half);
    const box = frameBox(strip, m.shot.at, 0);
    // The scene is silent, so the marks are not cued by a line: they follow one another once the lens has landed.
    const draw = motion.drawSec * m.fps;
    const step = Math.min(STAGGER, Math.max(0, m.settle - m.arrive - draw) / Math.max(1, marks.length));
    const after = frameBox(strip, m.shot.at, marks.length);
    return (
      <>
        {marks.map((kind, i) => (
          <OnFrame key={i} k={i}>
            <Mark kind={kind} x={box.width / 2} y={box.height / 2} width={strip.pitch * SHAPE[kind].width} height={strip.pitch * SHAPE[kind].height} seed={20 + i} weight={stroke(strip.pitch)} progress={m.drawn(m.arrive + i * step)} />
          </OnFrame>
        ))}
        {overflow > 0 ? (
          <Type face={FACE.text} size={size.text.tally} leading={leading.solid} style={{ position: 'absolute', left: after.left + space.xs, top: -size.text.tally / 2, opacity: m.span(0.6, 1), WebkitTextStroke: `${space.sm}px ${color.film.base}`, paintOrder: 'stroke fill' }}>{`+${overflow}`}</Type>
        ) : null}
      </>
    );
  },

  Glass: () => {
    const { shot } = useScene();
    const room = glassRoom(shot.lens);
    const mark = fitText('Dailies', { ...size.display.wordmark, leading: leading.solid }, linesRoom(room), emOf(FACE.heavy), { maxLines: 1 });
    return (
      <GlassBlock at={room}>
        <Lines fitted={mark} face={FACE.heavy} leading={leading.solid} align="center" />
      </GlassBlock>
    );
  },

  Over: ({ scene }) => {
    const m = useScene();
    const strip = stripOf(m.shot.unit, m.shot.half);
    const width = m.shot.lens.x - loupe.skirt.outer * m.shot.lens.scale - layout.margin - space.xxl;
    // The name sits in the room above the strip and the counts in the room under it. The strip is tilted, so at
    // the left of the frame, where both of them are, it lies lower than at the lens.
    const drop = Math.tan((-film.tilt * Math.PI) / 180) * (m.shot.lens.x - layout.margin);
    const above = m.shot.lens.y + drop - strip.height / 2;
    const below = m.shot.lens.y + drop + strip.height / 2;
    const hero = above - layout.margin - space.xl;
    const fit = fitRepo(clampEnd(scene.repo, REPO_CHARS), size.display.hero, (above, below) => boxRoom(width, hero - above - below), HERO_LINES);
    const tallies: { kind: EndMark; count: number; text: string }[] = [
      { kind: 'ring', count: scene.verified, text: `${scene.verified.toLocaleString('en-US')} ${scene.verified === 1 ? 'claim' : 'claims'} verified` },
      { kind: 'cross', count: scene.flagged, text: `${scene.flagged.toLocaleString('en-US')} flagged` },
      { kind: 'question', count: scene.unverified ?? 0, text: `${(scene.unverified ?? 0).toLocaleString('en-US')} unverified` },
    ];
    return (
      <>
        <Rise progress={m.enter(0)} style={{ position: 'absolute', left: layout.margin, top: layout.margin + (hero - fit.height) / 2, width }}>
          <RepoName fit={fit} />
        </Rise>
        <Rise progress={m.span(0.5, 1)} style={{ position: 'absolute', left: layout.margin, top: below + (layout.margin + space.xl), display: 'flex', gap: space.xxl }}>
          {tallies.map((tally) => (
            <div key={tally.kind} style={{ display: 'flex', alignItems: 'center', gap: space.md, opacity: tally.count > 0 ? dim.full : dim.zero }}>
              <div style={{ position: 'relative', width: TALLY_MARK, height: TALLY_MARK }}>
                <Mark kind={tally.kind} x={TALLY_MARK / 2} y={TALLY_MARK / 2} width={TALLY_MARK * SHAPE[tally.kind].width * 1.5} height={TALLY_MARK * SHAPE[tally.kind].height} seed={31} weight={TALLY_STROKE} />
              </div>
              <Type face={FACE.text} size={size.text.tally} leading={leading.solid}>{tally.text}</Type>
            </div>
          ))}
        </Rise>
      </>
    );
  },
};
