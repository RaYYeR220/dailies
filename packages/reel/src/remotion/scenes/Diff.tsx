import React from 'react';
import { theme } from '../../theme';
import { LIMITS, clampEnd, clampStart, countUp, parseHunk, windowRows, type DiffRow } from '../text';
import { Frame, Panel, useContentBox, useMotion, type SceneOf } from '../ui';

const { color, font, size, weight, leading, space, advance } = theme;

const SHA_CHARS = 8;
const SIGN: Record<DiffRow['kind'], string> = { add: '+', del: '−', context: ' ', hunk: ' ' };
const TONE: Record<DiffRow['kind'], { sign: string; text: string; wash: string }> = {
  add: { sign: color.ok, text: color.text, wash: color.okWash },
  del: { sign: color.bad, text: color.text, wash: color.badWash },
  context: { sign: color.faint, text: color.muted, wash: 'transparent' },
  hunk: { sign: color.faint, text: color.faint, wash: 'transparent' },
};

export const Diff: React.FC<{ scene: SceneOf<'diff'> }> = ({ scene }) => {
  const m = useMotion();
  const box = useContentBox();

  const rowHeight = size.code * leading.code;
  const header = size.body * leading.text + space.md;
  const capacity = Math.floor((box.height - header - 2 * space.md) / rowHeight);
  const cols = Math.floor((box.width - 2 * space.lg) / (size.code * advance.mono));
  const view = windowRows(parseHunk(clampEnd(scene.hunk, LIMITS.hunk)), capacity);
  const counted = m.span(0, 1);

  return (
    <Frame label="Diff">
      <div style={{ height: header, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', fontFamily: font.mono, opacity: m.enter() }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: space.md, fontSize: size.code, lineHeight: leading.text }}>
          <div>{clampStart(scene.path, Math.floor(cols / 2))}</div>
          <div style={{ color: color.faint }}>{scene.sha.slice(0, SHA_CHARS)}</div>
        </div>
        <div style={{ display: 'flex', gap: space.md, fontSize: size.body, fontWeight: weight.medium, lineHeight: leading.text }}>
          <div style={{ color: color.ok }}>+{countUp(String(scene.added), counted)}</div>
          <div style={{ color: color.bad }}>−{countUp(String(scene.removed), counted)}</div>
        </div>
      </div>
      <Panel style={{ flex: 1, padding: `${space.md}px 0`, display: 'flex', flexDirection: 'column', justifyContent: 'center', fontFamily: font.mono, fontSize: size.code, lineHeight: leading.code }}>
        {view.rows.map((row, i) => (
          <div key={i} style={{ height: rowHeight, padding: `0 ${space.lg}px`, display: 'flex', whiteSpace: 'pre', background: TONE[row.kind].wash, opacity: m.reveal(i, view.rows.length) }}>
            <span style={{ color: TONE[row.kind].sign }}>{SIGN[row.kind]} </span>
            <span style={{ color: TONE[row.kind].text }}>{clampEnd(row.text, cols - 2)}</span>
          </div>
        ))}
        {view.hidden > 0 ? (
          <div style={{ height: rowHeight, padding: `0 ${space.lg}px`, color: color.faint, opacity: m.span(0.8, 1) }}>{`… ${view.hidden} more lines`}</div>
        ) : null}
      </Panel>
    </Frame>
  );
};
