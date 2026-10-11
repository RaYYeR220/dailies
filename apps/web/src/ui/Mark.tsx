import type { CSSProperties } from 'react';
import type { Mark as MarkKind } from './model';
import { crossPath, questionPath, ringPath } from './pencil';
import styles from './Mark.module.css';

/** What each mark says, for a reader who cannot see it. */
export const MARK_WORDS: Record<MarkKind, string> = {
  ring: 'Verified',
  cross: 'Contradicted',
  dashed: 'Stale',
  question: 'Unverified',
};

function markPath(kind: MarkKind, seed: number): string {
  if (kind === 'ring') return ringPath(24, 24, 17, 15.5, { seed, wobble: 0.05, turns: 1.13 });
  if (kind === 'dashed') return ringPath(24, 24, 17, 15.5, { seed, wobble: 0.05, turns: 1, drift: 0 });
  if (kind === 'cross') return crossPath(24, 24, 31, 31, seed);
  return questionPath(24, 23, 40);
}

export interface MarkProps {
  kind: MarkKind;
  size?: number;
  seed?: number;
  weight?: number;
  /** The text alternative. Pass null when the words sit right next to the mark. */
  label?: string | null;
  /** Draw the stroke on, as the pencil would. */
  draw?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One of the four pencil marks, at icon size. */
export function Mark({ kind, size = 28, seed = 3, weight = 4.6, label, draw = false, className, style }: MarkProps) {
  const words = label === undefined ? MARK_WORDS[kind] : label;
  return (
    <svg
      className={`${styles.mark} ${draw ? styles.draw : ''} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      style={style}
      {...(words ? { role: 'img', 'aria-label': words } : { 'aria-hidden': true })}
    >
      <path
        d={markPath(kind, seed)}
        fill="none"
        stroke="var(--pencil)"
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...(kind === 'dashed' ? { strokeDasharray: '8.5 8', className: styles.dashed } : { pathLength: 1 })}
      />
    </svg>
  );
}

export interface PenciledProps {
  /** ring: verified. cross: contradicted. dashed: stale. */
  mark: Exclude<MarkKind, 'question'>;
  seed?: number;
  weight?: number;
  draw?: boolean;
  /** Leave air between the phrase and the mark: for a short word that the ring would otherwise touch. */
  roomy?: boolean;
  /** Spoken after the text, since the mark itself is silent. */
  label?: string;
  children: React.ReactNode;
}

/** A phrase with a pencil mark drawn on it. The drawing stretches to the phrase, so it survives reflow. */
export function Penciled({ mark, seed = 5, weight = 3.2, draw = false, roomy = false, label, children }: PenciledProps) {
  const d =
    mark === 'cross'
      ? crossPath(150, 50, 292, 84, seed)
      : // The ring fills its box; how far it stands off the phrase is set by the box, in CSS.
        ringPath(150, 50, 145, 43, { seed, wobble: 0.03, tilt: -0.015, start: Math.PI * 0.9, ...(mark === 'dashed' ? { turns: 1, drift: 0 } : { turns: 1.07, drift: -0.05 }) });
  return (
    <span className={`${styles.penciled} ${draw ? styles.draw : ''} ${roomy ? styles.roomy : ''} ${mark === 'cross' ? styles.crossed : ''}`}>
      {children}
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
        <path
          d={d}
          fill="none"
          stroke="var(--pencil)"
          strokeWidth={weight}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          filter="url(#pencil-sm)"
          {...(mark === 'dashed' ? { strokeDasharray: '9 7', className: styles.dashed } : { pathLength: 1 })}
        />
      </svg>
      {label ? <span className="sr"> ({label})</span> : null}
    </span>
  );
}
