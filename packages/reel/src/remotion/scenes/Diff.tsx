import React from 'react';
import { theme } from '../../theme';
import { glassRoom } from '../lens';
import { FACE, emOf, type Face } from '../measure';
import { LIMITS, boxRoom, clampEnd, clampStart, commonIndent, countUp, fitText, parseHunk, splitLast, windowRows, type DiffRow } from '../text';
import { Lines, Type, useScene, type SceneParts } from '../ui';

const { color, size, leading, space, loupe, dim } = theme;

const SHA_CHARS = 8;
const MAX_ROWS = 10;
const MIN_DIRECTORY = 6;   // columns a directory needs to be worth showing
const INDENT = 2;          // columns between the sign of a row and its text
const SIGN: Record<DiffRow['kind'], string> = { add: '+', del: '−', context: ' ', hunk: ' ' };
// Added and removed lines are told apart by weight and brightness, never by hue.
const TONE: Record<DiffRow['kind'], { face: Face; opacity: number }> = {
  add: { face: FACE.codeStrong, opacity: dim.strong },
  del: { face: FACE.code, opacity: dim.removed },
  context: { face: FACE.code, opacity: dim.soft },
  hunk: { face: FACE.code, opacity: dim.removed },
};

export const Diff: SceneParts<'diff'> = {
  Film: () => null,

  Glass: ({ scene }) => {
    const m = useScene();
    const room = glassRoom(m.shot.lens, m.bottom);
    const rowHeight = size.code.patch * leading.patch;
    const headHeight = size.display.file.max * leading.display;
    const refHeight = size.code.ref * leading.code;
    const fixed = headHeight + space.xl + space.md + refHeight;

    // The header of the first hunk says nothing the file name does not; later ones mark a gap in the patch.
    const parsed = parseHunk(clampEnd(scene.hunk, LIMITS.hunk));
    const rows = parsed[0]?.kind === 'hunk' ? parsed.slice(1) : parsed;
    const view = windowRows(rows, Math.max(1, Math.min(MAX_ROWS, Math.floor((room.height - fixed) / rowHeight))));
    // Indentation every shown line shares is taken off, so the patch starts at the margin and keeps its columns for code.
    const indent = commonIndent(view.rows.filter((row) => row.kind !== 'hunk').map((row) => row.text));
    const count = view.rows.length + (view.hidden > 0 ? 1 : 0);
    const height = fixed + count * rowHeight;
    const width = room.width(-height / 2, height / 2);
    const column = emOf(FACE.code)('0') * size.code.patch;
    const top = -height / 2 + headHeight + space.xl;
    // A row runs as far as the glass does at its own height, which near the middle is further than the block is wide.
    const columns = (i: number) => Math.max(INDENT + 1, Math.floor((width / 2 + Math.min(room.reach(top + i * rowHeight)[1], room.reach(top + (i + 1) * rowHeight)[1]) - loupe.rim / 2) / column));

    const counted = m.span(0, 1);
    const counts = `+${countUp(String(scene.added), counted)} −${countUp(String(scene.removed), counted)}`;
    const countsWidth = emOf(FACE.light)(`+${scene.added} −${scene.removed}`) * size.display.file.max;
    const { head, tail } = splitLast(scene.path);
    const file = fitText(tail, { ...size.display.file, leading: leading.display }, boxRoom(width - countsWidth - space.xxl, headHeight), emOf(FACE.semi), { maxLines: 1 });
    const fileWidth = emOf(FACE.semi)(file.lines[0] ?? '') * file.size;
    const directoryColumns = Math.floor((width - countsWidth - space.xxl - fileWidth - space.sm) / (emOf(FACE.code)('0') * size.code.command));

    return (
      <div style={{ position: 'absolute', left: room.cx - width / 2, top: room.cy - height / 2, width, height }}>
        <div style={{ height: headHeight, display: 'flex', alignItems: 'baseline', marginBottom: space.xl }}>
          {head && directoryColumns >= MIN_DIRECTORY ? (
            <Type face={FACE.code} size={size.code.command} leading={leading.solid} style={{ opacity: dim.soft, marginRight: space.sm }}>{clampStart(head, directoryColumns)}</Type>
          ) : null}
          <Lines fitted={file} face={FACE.semi} leading={leading.solid} />
          <div style={{ flex: 1 }} />
          <Type face={FACE.light} size={size.display.file.max} leading={leading.solid}>{counts}</Type>
        </div>
        {view.rows.map((row, i) => (
          <div key={i} style={{ position: 'relative', height: rowHeight, opacity: m.reveal(i, count) }}>
            {row.kind === 'add' ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: -2 * loupe.glass * m.shot.lens.scale, right: -2 * loupe.glass * m.shot.lens.scale, background: color.white, opacity: dim.band }} /> : null}
            <Type face={TONE[row.kind].face} size={size.code.patch} leading={leading.patch} style={{ position: 'relative', opacity: TONE[row.kind].opacity }}>
              {row.kind === 'hunk' ? '⋯' : `${SIGN[row.kind]}${' '.repeat(INDENT)}${clampEnd(row.text.slice(indent), columns(i) - INDENT - 1)}`}
            </Type>
          </div>
        ))}
        {view.hidden > 0 ? (
          <Type face={FACE.code} size={size.code.patch} leading={leading.patch} style={{ height: rowHeight, opacity: dim.removed * m.reveal(count - 1, count) }}>{`… ${view.hidden} more lines`}</Type>
        ) : null}
        <Type face={FACE.code} size={size.code.ref} leading={leading.code} style={{ marginTop: space.md, opacity: dim.faint }}>{`commit ${scene.sha.slice(0, SHA_CHARS)}`}</Type>
      </div>
    );
  },
};
