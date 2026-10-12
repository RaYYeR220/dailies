import { theme } from '../../theme';
import { OnFrame } from '../Film';
import { glassRoom, linesRoom } from '../lens';
import { FACE, emOf } from '../measure';
import { frameBox, stripOf } from '../strip';
import { LIMITS, boxRoom, clampEnd, countUp, fitText, type Fitted } from '../text';
import { GlassBlock, Lines, ROLES, fitFigure, heightOf, useScene, type Role, type Room, type SceneParts } from '../ui';

const { color, size, leading, space } = theme;

const MAX_ITEMS = 6;
const LABEL_LINES = 2;

/** A figure counting up to its value. */
const counting = <T extends { lines: string[] }>(fitted: T, progress: number): T => ({ ...fitted, lines: fitted.lines.map((line) => countUp(line, progress)) });

/**
 * The values of the frames after the first, each on one line. The figures of a row are set at one size: the size
 * the longest of them fits at.
 */
export function fitRow(values: string[], room: Room): (Fitted & { role: Role })[] {
  const display = ROLES.value[0]!;
  const free = values.map((value) => fitFigure(value, ROLES.value, room));
  const common = Math.min(...free.filter((v) => v.role === display).map((v) => v.size));
  return free.map((v) => (v.role === display && v.size > common ? { ...v, size: common } : v));
}

export const Stats: SceneParts<'stats'> = {
  Film: ({ scene }) => {
    const m = useScene();
    const box = frameBox(stripOf(m.shot.unit, m.shot.half), m.shot.at, 0);
    const width = box.width - 2 * space.sm;
    const labelType = { max: size.text.label, min: size.text.label, leading: leading.text };
    // The first value is the one under the glass; the rest take a frame each.
    const items = scene.items.slice(1, MAX_ITEMS).map((item) => {
      const label = fitText(clampEnd(item.label, LIMITS.statLabel), labelType, boxRoom(width, LABEL_LINES * labelType.max * labelType.leading), emOf(FACE.text), { maxLines: LABEL_LINES });
      return { label, text: clampEnd(item.value, LIMITS.statValue) };
    });
    const labelHeight = Math.max(0, ...items.map((item) => item.label.lines.length)) * labelType.max * labelType.leading;
    const values = fitRow(items.map((item) => item.text), boxRoom(width, box.height - 2 * space.md - space.sm - labelHeight));
    const valueHeight = Math.max(0, ...values.map(heightOf));
    return (
      <>
        {items.map((item, i) => (
          <OnFrame key={i} k={i + 1} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: space.sm }}>
            <div style={{ height: valueHeight, display: 'flex', alignItems: 'flex-end' }}>
              <Lines fitted={counting(values[i]!, m.span(0, 1))} face={values[i]!.role.face} leading={values[i]!.role.type.leading} align="center" />
            </div>
            <div style={{ height: labelHeight }}>
              <Lines fitted={item.label} face={FACE.text} leading={labelType.leading} align="center" tone={color.soft} />
            </div>
          </OnFrame>
        ))}
      </>
    );
  },

  Glass: ({ scene }) => {
    const m = useScene();
    const item = scene.items[0];
    if (!item) return null;
    const room = glassRoom(m.shot.lens, m.bottom);
    const labelType = { max: size.text.figure, min: size.text.label, leading: leading.text };
    // The figure is fitted with room for two lines of label under it; the label then takes the chords that are left.
    const value = fitFigure(clampEnd(item.value, LIMITS.statValue), ROLES.figure, linesRoom(room, 0, space.sm + LABEL_LINES * labelType.min * labelType.leading));
    const label = fitText(clampEnd(item.label, LIMITS.statLabel), labelType, linesRoom(room, heightOf(value) + space.sm, 0), emOf(FACE.text), { maxLines: LABEL_LINES, fewest: true });
    return (
      <GlassBlock at={room}>
        <Lines fitted={counting(value, m.span(0, 1))} face={value.role.face} leading={value.role.type.leading} align="center" />
        <Lines fitted={label} face={FACE.text} leading={labelType.leading} align="center" tone={color.soft} style={{ marginTop: space.sm }} />
      </GlassBlock>
    );
  },
};
