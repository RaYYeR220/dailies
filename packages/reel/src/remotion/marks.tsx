import React from 'react';
import { theme } from '../theme';
import { dashesDrawn, markPaths, type MarkKind } from './pencil';

const { color, pencil } = theme;

type Hand = 'large' | 'medium' | 'small';
const HANDS: Hand[] = ['large', 'medium', 'small'];
const filterId = (hand: Hand) => `pencil-${hand}`;

/** The grease-pencil filters, once per document: the stroke is made to wobble, then waxy holes are knocked in it. */
export const PencilDefs: React.FC = () => (
  <svg width={0} height={0} style={{ position: 'absolute' }}>
    <defs>
      {HANDS.map((hand) => {
        const { wobble, wax } = pencil[hand];
        return (
          <filter key={hand} id={filterId(hand)} x="-12%" y="-20%" width="124%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency={wobble.frequency} numOctaves={wobble.octaves} seed={wobble.seed} result="wobble" />
            <feDisplacementMap in="SourceGraphic" in2="wobble" scale={wobble.scale} xChannelSelector="R" yChannelSelector="G" result="stroke" />
            {wax ? (
              <>
                <feTurbulence type="fractalNoise" baseFrequency={wax.frequency} numOctaves={2} seed={wax.seed} result="grain" />
                <feColorMatrix in="grain" type="matrix" values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 ${wax.cut}`} result="holes" />
                <feComposite in="stroke" in2="holes" operator="in" />
              </>
            ) : null}
          </filter>
        );
      })}
    </defs>
  </svg>
);

// How the time of a mark is shared between its strokes: a cross is two equal strokes, a question mark a hook and a dot.
const SHARES: Record<MarkKind, number[]> = { ring: [1], dashed: [1], cross: [0.5, 0.5], question: [0.82, 0.18] };

/**
 * One pencil mark in a `width` by `height` box centred on (`x`, `y`) of its positioned parent.
 * `progress` 0..1 draws it on, stroke by stroke, the way the hand would.
 */
export const Mark: React.FC<{ kind: MarkKind; x: number; y: number; width: number; height: number; seed: number; progress?: number; weight?: number; opacity?: number }> = ({
  kind, x, y, width, height, seed, progress = 1, weight, opacity = 1,
}) => {
  const reach = Math.max(width, height);
  const hand: Hand = reach >= pencil.large.above ? 'large' : reach >= pencil.medium.above ? 'medium' : 'small';
  const stroke = weight ?? Math.max(pencil.weight.min, Math.min(pencil.weight.max, reach * pencil.weight.share));
  const shares = SHARES[kind];
  let before = 0;
  return (
    <svg width={width} height={height} viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`} style={{ position: 'absolute', left: x - width / 2, top: y - height / 2, overflow: 'visible', opacity }}>
      <g fill="none" stroke={color.pencil} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" filter={`url(#${filterId(hand)})`}>
        {/* An unstroked box the size of the mark: it keeps the filter region still while the strokes grow. */}
        <rect x={-width / 2} y={-height / 2} width={width} height={height} stroke="none" />
        {markPaths(kind, width, height, seed).map((d, i) => {
          const share = shares[i] ?? 1;
          const drawn = Math.max(0, Math.min(1, (progress - before) / share));
          before += share;
          const dashes = kind === 'dashed' ? dashesDrawn(drawn, pencil.dash.count, pencil.dash.fill) : [drawn, 2];
          return <path key={i} d={d} pathLength={1} strokeDasharray={dashes.join(' ')} strokeOpacity={drawn > 0 ? 1 : 0} />;
        })}
      </g>
    </svg>
  );
};
