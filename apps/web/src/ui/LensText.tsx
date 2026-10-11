import type { Mark } from './model';
import { crossPath, questionPath, ringPath } from './pencil';

export interface LensTextProps {
  /** The few words under the glass. */
  focus: string;
  /** Dimmed context that runs out of the glass above and below. */
  above?: string;
  below?: string;
  mark?: Mark;
  /** Display face for a count or a value, the code face for anything quoted from the record. */
  face?: 'code' | 'disp';
  seed?: number;
  draw?: boolean;
}

/** One short passage seen through the lens, with its pencil mark drawn on it. In loupe units. */
export function LensText({ focus, above, below, mark = 'ring', face = 'code', seed = 4, draw = false }: LensTextProps) {
  // Roughly how wide a character runs in each face, so the passage and its ring stay inside the glass.
  const advance = face === 'disp' ? 0.74 : 0.66;
  const size = Math.max(28, Math.min(face === 'disp' ? 92 : 76, 392 / (Math.max(focus.length, 3) * advance)));
  const half = (focus.length * advance * size) / 2;
  const row = size * 1.62;
  const weight = Math.max(4.5, size * 0.11);
  const stroke = { fill: 'none', stroke: '#ffd60a', strokeWidth: weight, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, filter: 'url(#pencil)' };
  const drawn = draw ? { pathLength: 1, className: 'lens-draw' } : {};
  return (
    <g transform="rotate(-3)">
      {above ? <text className="code" x="0" y={size * 0.34 - row} textAnchor="middle" fontSize={size * 0.62} fill="#eef3f1" fillOpacity=".24" style={{ whiteSpace: 'pre' }}>{above}</text> : null}
      {below ? <text className="code" x="0" y={size * 0.34 + row * 0.9} textAnchor="middle" fontSize={size * 0.62} fill="#eef3f1" fillOpacity=".24" style={{ whiteSpace: 'pre' }}>{below}</text> : null}
      {mark === 'cross' ? <path d={crossPath(0, 0, half * 2 + size * 0.9, size * 1.9, seed)} {...stroke} {...drawn} /> : null}
      <text
        className={face}
        x="0"
        y={size * 0.34}
        textAnchor="middle"
        fontSize={size}
        fontWeight={face === 'disp' ? 800 : 600}
        letterSpacing={face === 'disp' ? -size * 0.03 : 0}
        fill="#eef3f1"
        stroke="#2a3f38"
        strokeWidth={mark === 'cross' ? size * 0.14 : 0}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ whiteSpace: 'pre' }}
      >
        {focus}
      </text>
      {mark === 'ring' ? <path d={ringPath(0, 0, half + size * 0.62, size * 0.98, { seed, start: Math.PI * 0.84, wobble: 0.03 })} {...stroke} {...drawn} /> : null}
      {mark === 'dashed' ? (
        <path d={ringPath(0, 0, half + size * 0.62, size * 0.98, { seed, turns: 1, drift: 0, wobble: 0.03 })} {...stroke} strokeDasharray={`${size * 0.42} ${size * 0.3}`} />
      ) : null}
      {mark === 'question' ? <path d={questionPath(half + size * 0.8, 0, size * 1.5)} {...stroke} {...drawn} /> : null}
    </g>
  );
}
