import React from 'react';
import { spring } from 'remotion';
import { theme } from '../../theme';
import { cueFrame, itemSpans } from '../cues';
import { OnFrame } from '../Film';
import { glassRoom, linesRoom } from '../lens';
import { Mark } from '../marks';
import { FACE, emOf, faceStyle } from '../measure';
import { frameBox, stripOf } from '../strip';
import { LIMITS, boxRoom, clampEnd, clampWidth, closingCount } from '../text';
import { GlassBlock, Lines, ROLES, Type, fitRef, fitRoles, heightOf, ringOf, useScene, widthOf, type SceneOf, type SceneParts } from '../ui';

const { color, size, leading, space, film, loupe, dim, motion, radius, shot } = theme;

const WORD = { contradicted: 'CONTRADICTED', stale: 'STALE' } as const;
// The cross takes this share of the quote's frame; a ring stands this far off what it holds, in px.
const CROSS = { width: 0.94, height: 0.7 };
const RING = { x: 56, y: 40 };
const RING_RIM = 40;   // extra margin the reality keeps from the rim, so its ring stays on the glass
const RECORD_RING = { x: 22, y: 30 };   // how far the ring round the whole record stands off its lines
const RING_EDGE = 14;  // the closest a ring comes to the edge of the glass

/** When the three beats of the scene land: the pencil over the quote, the pill, the ring around the record. */
function useCues(scene: SceneOf<'flag'>) {
  const m = useScene();
  // The first line tells the claim, the last tells the record; a single line is shared between them.
  const [claim, record] = itemSpans([0, Math.max(0, scene.lines.length - 1)], m.lines, { start: 0, end: m.duration });
  const quote = cueFrame(claim!, m.fps, m.landing);
  const pill = quote + motion.drawSec * m.fps;
  return { m, quote, pill, record: Math.max(cueFrame(record!, m.fps, m.landing), pill) };
}

/** Where the centre of the pill is along the strip, from the centre of a lens of `scale`: just inside the lens's near edge. */
const pillX = (scale: number) => shot.flag.pill.x - loupe.skirt.outer * scale;

/** The verdict pill: its word and its size in px. */
function pillOf(verdict: SceneOf<'flag'>['verdict']) {
  const word = WORD[verdict];
  return { word, width: emOf(FACE.verdict)(word) * size.display.verdict + 2 * shot.flag.pill.pad, height: size.display.verdict * shot.flag.pill.height };
}

/** The entry the claim was made in: the one the first line cites, or failing that the claim's own id. Set to fit `width` px. */
const source = (scene: SceneOf<'flag'>, width: number): string => {
  const cited = scene.lines.flatMap((line) => line.evidence).find((e) => e.type === 'entry');
  return cited?.type === 'entry' ? fitRef(cited.entryId, width) : clampWidth(`claim ${scene.claimId}`, width / size.code.ref, emOf(FACE.code));
};

export const Flag: SceneParts<'flag'> = {
  Film: ({ scene }) => {
    const { m, quote: cue } = useCues(scene);
    const strip = stripOf(m.shot.unit, m.shot.half);
    const box = frameBox(strip, m.shot.at, 0);
    const pad = space.xxl;
    const label = size.code.ref * leading.code;
    const width = box.width - 2 * pad;
    const room = box.height - 2 * pad - label - space.md;
    const quote = fitRoles(`“${clampEnd(scene.quote.replace(/\s+/g, ' ').trim(), LIMITS.flagQuote)}”`, ROLES.claim, boxRoom(width, room));
    const [w, h] = [widthOf(quote, quote.role.face), heightOf(quote)];
    const top = pad + label + space.md + (room - h) / 2;
    const drawn = m.drawn(cue);
    // The reference sits on the edge of the film under the frame, and stops short of the pill.
    const margin = m.shot.unit * film.perf.inset;
    const reference = source(scene, pillX(m.shot.lens.scale) - pillOf(scene.verdict).width / 2 - box.left - space.md);
    return (
      <>
        <OnFrame k={0}>
          {scene.verdict === 'contradicted' ? (
            <Mark kind="cross" x={box.width / 2} y={box.height / 2 + label / 2} width={box.width * CROSS.width} height={box.height * CROSS.height} seed={3} progress={drawn} />
          ) : (
            // The dashed ring goes round the quote and stays under the label above it.
            <Mark kind="dashed" x={pad + w / 2} y={top + h / 2} width={Math.min(box.width + pad, w + 2 * RING.x)} height={Math.min(2 * (top + h / 2 - pad - label), h + 2 * RING.y)} seed={5} progress={drawn} />
          )}
          <Type face={FACE.code} size={size.code.ref} leading={leading.code} style={{ position: 'absolute', left: pad, top: pad, opacity: dim.faint }}>the agent said</Type>
          <Lines fitted={quote} face={quote.role.face} leading={quote.role.type.leading} halo={color.film.frame} style={{ position: 'absolute', left: pad, top }} />
        </OnFrame>
        <Type face={FACE.code} size={size.code.ref} leading={leading.solid} style={{ position: 'absolute', left: box.left, top: strip.height / 2 - margin + (margin - size.code.ref) / 2, opacity: dim.strong }}>{reference}</Type>
      </>
    );
  },

  Glass: ({ scene }) => {
    const { m, record: cue } = useCues(scene);
    const r = loupe.glass * m.shot.lens.scale;
    // The pill lies across the foot of the glass, so the record keeps to the part above it.
    const room = glassRoom(m.shot.lens, Math.min(m.bottom, m.shot.lens.y + r * shot.flag.floor), loupe.rim + RING_RIM);
    const reality = clampEnd(scene.reality.replace(/\s+/g, ' ').trim(), LIMITS.flagReality);
    const drawn = m.drawn(cue);
    const split = closingCount(reality);
    if (split) {
      // A record that ends on a count: the count is set large and ringed, what leads up to it sits above.
      const count = fitRoles(split.count, [ROLES.result[0]!], linesRoom(room, size.text.reality.min * leading.text + space.md, 0), { maxLines: 1 });
      const lead = fitRoles(split.lead, ROLES.reality, linesRoom(room, 0, space.md + heightOf(count) + RING.y));
      if (!count.cut && !lead.cut) {
        const [w, h] = [widthOf(count, count.role.face), heightOf(count)];
        return (
          <GlassBlock at={room}>
            <Lines fitted={lead} face={lead.role.face} leading={lead.role.type.leading} align="center" style={{ marginBottom: space.md, opacity: dim.strong }} />
            <div style={{ position: 'relative' }}>
              <Lines fitted={count} face={count.role.face} leading={count.role.type.leading} align="center" />
              <Mark kind="ring" x={w / 2} y={h / 2} width={w + RING.x} height={h + RING.y} seed={7} progress={drawn} />
            </div>
          </GlassBlock>
        );
      }
    }
    const text = fitRoles(reality, ROLES.reality, linesRoom(room, RING.y / 2, RING.y / 2, 2 * r - 2 * (loupe.rim + RING.x)));
    const [w, h] = [widthOf(text, text.role.face), heightOf(text)];
    // The ring goes round the whole record, and no further out than the glass does.
    const ring = ringOf(text, text.role.face, text.role.type.leading, RECORD_RING);
    return (
      <GlassBlock at={room}>
        <div style={{ position: 'relative' }}>
          <Lines fitted={text} face={text.role.face} leading={text.role.type.leading} align="center" />
          <Mark kind="ring" x={w / 2} y={h / 2} width={Math.min(ring.width, 2 * (r - RING_EDGE))} height={Math.min(ring.height, 2 * (r - RING_EDGE))} seed={7} progress={drawn} />
        </div>
      </GlassBlock>
    );
  },

  Over: ({ scene }) => {
    const { m, pill: cue } = useCues(scene);
    const since = m.since(cue);
    const stamp = spring({ frame: since, fps: m.fps, config: motion.stamp });
    const { word, width, height } = pillOf(scene.verdict);
    const centre = { x: m.shot.lens.x + pillX(m.shot.lens.scale), y: m.shot.lens.y + shot.flag.pill.y };
    return (
      <div
        style={{
          position: 'absolute',
          left: centre.x - width / 2,
          top: centre.y - height / 2,
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          background: color.pencil,
          boxShadow: theme.pillShadow,
          opacity: since >= 0 ? 1 : 0,
          transform: `rotate(${motion.stampTilt}deg) scale(${motion.stampFrom + (1 - motion.stampFrom) * stamp})`,
          ...faceStyle(FACE.verdict, size.display.verdict, leading.solid),
          color: color.ink,
        }}
      >
        {word}
      </div>
    );
  },
};
