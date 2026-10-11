import type { ReactNode } from 'react';
import styles from './Loupe.module.css';

/*
  The one loupe. Drawn around 0,0: the lens is 276 units across its radius, the knurled barrel sits at 300,
  and a clear acrylic skirt runs out to 362. Whatever is passed as children is what is under the glass,
  in the same units, clipped to the lens.
*/
export const LENS_R = 276;
export const LOUPE_R = 362;

const ENGRAVING = 'DAILIES OPTICAL     4× ILLUMINATED LOUPE     No 0212';

/** Gradients, clips and the pencil filters, once per document. Every loupe and every mark refers to these. */
export function LoupeDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <clipPath id="lp-lens">
          <circle r={LENS_R} />
        </clipPath>
        <clipPath id="lp-skirt">
          <path clipRule="evenodd" d="M-362,0a362,362 0 1,0 724,0a362,362 0 1,0 -724,0Z M-322,0a322,322 0 1,0 644,0a322,322 0 1,0 -644,0Z" />
        </clipPath>
        <radialGradient id="lp-spill">
          <stop offset="0" stopColor="#eef3f1" stopOpacity=".2" />
          <stop offset=".54" stopColor="#eef3f1" stopOpacity=".15" />
          <stop offset=".7" stopColor="#eef3f1" stopOpacity=".05" />
          <stop offset="1" stopColor="#eef3f1" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lp-lit" cx="0" cy="0" r={LENS_R} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#eef3f1" stopOpacity=".1" />
          <stop offset=".62" stopColor="#eef3f1" stopOpacity="0" />
          <stop offset=".86" stopColor="#070a09" stopOpacity=".16" />
          <stop offset=".955" stopColor="#eef3f1" stopOpacity=".2" />
          <stop offset="1" stopColor="#070a09" stopOpacity=".7" />
        </radialGradient>
        <linearGradient id="lp-barrel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#66756f" />
          <stop offset=".2" stopColor="#232c29" />
          <stop offset=".48" stopColor="#090c0b" />
          <stop offset=".68" stopColor="#1b2320" />
          <stop offset=".86" stopColor="#45524d" />
          <stop offset="1" stopColor="#101514" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lp-rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#eef3f1" stopOpacity=".75" />
          <stop offset=".4" stopColor="#eef3f1" stopOpacity=".05" />
          <stop offset=".7" stopColor="#eef3f1" stopOpacity=".04" />
          <stop offset="1" stopColor="#eef3f1" stopOpacity=".4" />
        </linearGradient>
        <linearGradient id="lp-spec" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".34" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lp-pic" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e443d" />
          <stop offset="1" stopColor="#22322d" />
        </linearGradient>
        <filter id="lp-soft18" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <filter id="lp-soft8" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" />
        </filter>
        <filter id="lp-soft2" x="-30%" y="-80%" width="160%" height="260%">
          <feGaussianBlur stdDeviation="2.5" />
        </filter>
        {/* Grease pencil: wobble the stroke, then knock waxy holes in it. Two sizes of the same hand. */}
        <filter id="pencil" x="-14%" y="-34%" width="128%" height="168%">
          <feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="4" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G" result="d" />
          <feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="11" result="g" />
          <feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2.6 0 0 0 2.15" result="holes" />
          <feComposite in="d" in2="holes" operator="in" />
        </filter>
        <filter id="pencil-sm" x="-10%" y="-30%" width="120%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="1" seed="9" result="w" />
          <feDisplacementMap in="SourceGraphic" in2="w" scale="3" xChannelSelector="R" yChannelSelector="G" />
        </filter>
        <path id="lp-engrave" d="M-290.5,0a290.5,290.5 0 1,1 581,0" fill="none" />
      </defs>
    </svg>
  );
}

function Glass() {
  return (
    <>
      <circle r={LENS_R} fill="url(#lp-lit)" />
      <path d="M-237,-111 A262,262 0 0 1 45,-258 A340,340 0 0 0 -237,-111Z" fill="url(#lp-spec)" opacity=".5" />
      <ellipse cx="-118" cy="-178" rx="54" ry="9" transform="rotate(-38 -118 -178)" fill="#fff" opacity=".32" filter="url(#lp-soft2)" />
      <path d="M118,226 A255,255 0 0 0 226,118" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="5" strokeLinecap="round" />
    </>
  );
}

function Barrel({ small }: { small: boolean }) {
  if (small) {
    // The same barrel for small sizes: no knurling and no engraving, heavier rims.
    return (
      <>
        <circle r="300" fill="none" stroke="#0a0d0c" strokeWidth="46" />
        <circle r="300" fill="none" stroke="url(#lp-barrel)" strokeWidth="44" />
        <circle r="312" fill="none" stroke="#000" strokeOpacity=".45" strokeWidth="13" />
        <circle r="279" fill="none" stroke="#000" strokeWidth="5" />
        <circle r="283" fill="none" stroke="url(#lp-rim)" strokeWidth="3.5" />
        <circle r="321" fill="none" stroke="url(#lp-rim)" strokeWidth="3" opacity=".8" />
      </>
    );
  }
  return (
    <>
      <circle r="300" fill="none" stroke="#0a0d0c" strokeWidth="46" />
      <circle r="300" fill="none" stroke="url(#lp-barrel)" strokeWidth="44" />
      <circle r="312.5" fill="none" stroke="#000" strokeOpacity=".62" strokeWidth="15" strokeDasharray="2.1 3.1" />
      <circle r="312.5" fill="none" stroke="#eef3f1" strokeOpacity=".1" strokeWidth="15" strokeDasharray=".9 4.3" strokeDashoffset="1.4" />
      <circle r="303.5" fill="none" stroke="#000" strokeOpacity=".7" strokeWidth="1.6" />
      <circle r="279" fill="none" stroke="#000" strokeWidth="3.5" />
      <circle r="282" fill="none" stroke="url(#lp-rim)" strokeWidth="1.3" />
      <circle r="321.5" fill="none" stroke="url(#lp-rim)" strokeWidth="1.2" opacity=".8" />
      <text className="mono" fontSize="9.5" letterSpacing="3.4" fill="#eef3f1" fillOpacity=".62">
        <textPath href="#lp-engrave" startOffset="50%" textAnchor="middle">
          {ENGRAVING}
        </textPath>
      </text>
    </>
  );
}

export interface LoupeBodyProps {
  x?: number;
  y?: number;
  scale?: number;
  /** Below about 200 px across: drop the knurling and the engraving. */
  small?: boolean;
  shadow?: boolean;
  lensFill?: string;
  /** What the clear skirt refracts, in loupe units. Without it the skirt lets the page show through. */
  under?: ReactNode;
  /** A ref-able group around the highlights, for a scene that turns them. */
  glassRef?: React.Ref<SVGGElement>;
  /** What is under the glass, in loupe units, centred on 0,0. */
  children?: ReactNode;
}

/** The loupe as a group, for placing inside a larger SVG scene. */
export function LoupeBody({ x = 0, y = 0, scale = 1, small = false, shadow = true, lensFill = '#2a3f38', under, glassRef, children }: LoupeBodyProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {shadow ? (
        <>
          <circle cx="16" cy="28" r="366" fill="#000" opacity=".4" filter="url(#lp-soft18)" />
          <circle cx="8" cy="16" r="330" fill="#000" opacity=".6" filter="url(#lp-soft8)" />
        </>
      ) : null}
      <g clipPath="url(#lp-skirt)">
        <circle r="364" fill="#17201d" fillOpacity={under ? 1 : 0.5} />
        {under}
        <circle r="364" fill="#eef3f1" opacity=".1" />
      </g>
      <circle r="342" fill="none" stroke="#eef3f1" strokeOpacity=".06" strokeWidth="40" />
      <circle r="361" fill="none" stroke="url(#lp-rim)" strokeWidth={small ? 3 : 1.6} />
      <circle r="354" fill="none" stroke="#eef3f1" strokeOpacity=".07" strokeWidth="5" />
      <circle r="330" fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="14" />
      <g clipPath="url(#lp-lens)">
        <circle r="278" fill={lensFill} />
        {children}
      </g>
      <g ref={glassRef}>
        <Glass />
      </g>
      <Barrel small={small} />
    </g>
  );
}

export interface LoupeProps extends Omit<LoupeBodyProps, 'x' | 'y' | 'scale'> {
  className?: string;
  style?: React.CSSProperties;
  /** What a screen reader hears. Without it the loupe is decoration. */
  label?: string;
  /** A lens with nothing drawn in it: the page under the glass shows through, lit. */
  clear?: boolean;
}

/** The loupe on its own, sized by CSS. Its box hugs the skirt and leaves room for the shadow. */
export function Loupe({ className, style, label, clear = false, ...body }: LoupeProps) {
  const R = LOUPE_R + 26;
  const drawn = clear ? { ...body, lensFill: 'transparent', shadow: false } : body;
  return (
    <span className={`${styles.loupe} ${className ?? ''}`} style={style}>
      {body.under ? null : <span className={styles.skirt} aria-hidden="true" />}
      {clear ? <span className={styles.clear} aria-hidden="true" /> : null}
      <svg viewBox={`${-R} ${-R + 8} ${R * 2} ${R * 2}`} {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
        <LoupeBody {...drawn} />
      </svg>
    </span>
  );
}
