import React from 'react';
import { interpolate } from 'remotion';
import { theme } from '../../theme';
import { LIMITS, clampEnd, tailLines } from '../text';
import { Frame, Mark, Panel, useContentBox, useMotion, type SceneOf } from '../ui';

const { color, font, size, leading, space, advance } = theme;

const MAX_STEPS = 4;
const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;

export const Terminal: React.FC<{ scene: SceneOf<'terminal'> }> = ({ scene }) => {
  const m = useMotion();
  const box = useContentBox();
  const steps = scene.steps.slice(0, MAX_STEPS);

  // Whole rows and columns of the code face that fit the panel; nothing is left to be cut off by overflow.
  const rowHeight = size.code * leading.code;
  const rows = Math.floor((box.height - 2 * space.lg - (steps.length - 1) * space.md) / rowHeight);
  const cols = Math.floor((box.width - 2 * space.lg) / (size.code * advance.mono));
  const outputRows = Math.max(0, Math.floor(rows / steps.length) - 1);
  const markCols = Math.ceil((size.icon + space.md) / (size.code * advance.mono));

  return (
    <Frame label="Terminal">
      <Panel style={{ flex: 1, padding: space.lg, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: space.md, fontFamily: font.mono, fontSize: size.code, lineHeight: leading.code }}>
        {steps.map((step, i) => {
          // Each step owns one slot of the settle window: the command is typed, its output lands, then the mark.
          const p = m.slot(i, steps.length);
          const command = Array.from(clampEnd(step.command.replace(/\s+/g, ' ').trim(), Math.min(LIMITS.command, cols - 2 - markCols)));
          const typed = Math.floor(interpolate(p, [0, 0.5], [0, command.length], CLAMP));
          const landed = interpolate(p, [0.5, 0.75], [0, 1], CLAMP);
          const marked = interpolate(p, [0.75, 1], [0, 1], CLAMP);
          const output = tailLines(clampEnd(step.output, LIMITS.output), outputRows, cols);
          return (
            <div key={i} style={{ opacity: interpolate(p, [0, 0.05], [0, 1], CLAMP) }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: rowHeight }}>
                <div style={{ whiteSpace: 'pre' }}>
                  <span style={{ color: color.accent }}>$ </span>
                  <span>{command.slice(0, typed).join('')}</span>
                </div>
                <Mark ok={step.ok} progress={marked} />
              </div>
              <div style={{ opacity: landed, color: color.muted, whiteSpace: 'pre' }}>
                {output.skipped > 0 && outputRows > 0 ? <div style={{ height: rowHeight, color: color.faint }}>{`… ${output.skipped} earlier lines`}</div> : null}
                {output.lines.map((line, j) => (
                  <div key={j} style={{ height: rowHeight }}>{line}</div>
                ))}
              </div>
            </div>
          );
        })}
      </Panel>
    </Frame>
  );
};
