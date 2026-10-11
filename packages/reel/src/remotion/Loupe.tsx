import React from 'react';
import { fade, theme } from '../theme';
import type { LensRest } from './lens';
import { FACE } from './measure';

const { color, loupe, film, radius } = theme;

const BOX = loupe.skirt.outer + 8;   // half the side of the square the loupe is drawn in, at scale 1
const ID = { lit: 'loupe-lit', barrel: 'loupe-barrel', rim: 'loupe-rim', spec: 'loupe-spec', glow: 'loupe-glow', engrave: 'loupe-engrave' } as const;
const dark = color.film.base;
const paint = (id: string) => `url(#${id})`;

/** A disc of `r` px (at scale 1) centred on the lens. */
const disc = (lens: LensRest, r: number): React.CSSProperties => {
  const size = 2 * r * lens.scale;
  return { position: 'absolute', left: lens.x - size / 2, top: lens.y - size / 2, width: size, height: size, borderRadius: radius.pill };
};

/**
 * The loupe: the one lens of the reel. From the lightbox up it is a shadow, a clear skirt that refracts the film
 * under it (`skirt`), the glass with what is seen through it (`children`, drawn about the centre of the lens and
 * tilted with the film), the highlights on the glass, the knurled barrel and its engraved rim.
 * `transit` 0..1 dims the glass while the lens is between two frames.
 */
export const Loupe: React.FC<{ lens: LensRest; transit?: number; skirt?: React.ReactNode; children?: React.ReactNode }> = ({ lens, transit = 0, skirt, children }) => {
  const { glass, barrel, engrave, glint } = loupe;
  const s = lens.scale;
  return (
    <>
      <div style={{ ...disc(lens, loupe.skirt.outer), boxShadow: loupe.shadow.map((d) => `${d.x * s}px ${d.y * s}px ${d.blur * s}px ${d.spread * s}px ${fade(dark, d.opacity)}`).join(', ') }} />

      <div style={{ ...disc(lens, loupe.skirt.outer), overflow: 'hidden', background: loupe.base }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transform: `scale(${loupe.skirt.refraction}) translate(${loupe.skirt.shift.x * s}px, ${loupe.skirt.shift.y * s}px)` }}>{skirt}</div>
        <div style={{ position: 'absolute', inset: 0, background: color.white, opacity: loupe.veil }} />
      </div>

      <div style={{ ...disc(lens, glass + 2), overflow: 'hidden', background: color.film.lit }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0, transform: `rotate(${film.tilt}deg)` }}>{children}</div>
        <div style={{ position: 'absolute', inset: 0, background: dark, opacity: transit * loupe.transit }} />
      </div>

      <svg width={2 * BOX * s} height={2 * BOX * s} viewBox={`${-BOX} ${-BOX} ${2 * BOX} ${2 * BOX}`} style={{ position: 'absolute', left: lens.x - BOX * s, top: lens.y - BOX * s }}>
        <defs>
          <radialGradient id={ID.lit} cx={0} cy={0} r={glass} gradientUnits="userSpaceOnUse">
            <stop offset={0} stopColor={color.white} stopOpacity={0.1} />
            <stop offset={0.62} stopColor={color.white} stopOpacity={0} />
            <stop offset={0.86} stopColor={dark} stopOpacity={0.16} />
            <stop offset={0.955} stopColor={color.white} stopOpacity={0.2} />
            <stop offset={1} stopColor={dark} stopOpacity={0.7} />
          </radialGradient>
          <linearGradient id={ID.barrel} x1={0} y1={0} x2={1} y2={1}>
            {barrel.shade.map((tone, i) => (
              <stop key={i} offset={barrel.stops[i]} stopColor={tone} />
            ))}
            <stop offset={1} stopColor={dark} stopOpacity={0} />
          </linearGradient>
          <linearGradient id={ID.rim} x1={0} y1={0} x2={1} y2={1}>
            <stop offset={0} stopColor={color.white} stopOpacity={0.75} />
            <stop offset={0.4} stopColor={color.white} stopOpacity={0.05} />
            <stop offset={0.7} stopColor={color.white} stopOpacity={0.04} />
            <stop offset={1} stopColor={color.white} stopOpacity={0.4} />
          </linearGradient>
          <linearGradient id={ID.spec} x1={0} y1={0} x2={1} y2={1}>
            <stop offset={0} stopColor={color.white} stopOpacity={0.34} />
            <stop offset={1} stopColor={color.white} stopOpacity={0} />
          </linearGradient>
          <radialGradient id={ID.glow}>
            <stop offset={0} stopColor={color.white} stopOpacity={0.36} />
            <stop offset={0.55} stopColor={color.white} stopOpacity={0.2} />
            <stop offset={1} stopColor={color.white} stopOpacity={0} />
          </radialGradient>
          <path id={ID.engrave} d={`M${-engrave.radius},0a${engrave.radius},${engrave.radius} 0 1,1 ${2 * engrave.radius},0`} fill="none" />
        </defs>

        {/* The clear skirt: its thickness, its lit edge, and the shade the barrel throws on it. */}
        <g fill="none">
          <circle r={(loupe.skirt.inner + loupe.skirt.outer) / 2} stroke={color.white} strokeOpacity={0.06} strokeWidth={loupe.skirt.outer - loupe.skirt.inner} />
          <circle r={loupe.skirt.outer - 1} stroke={paint(ID.rim)} strokeWidth={1.6} />
          <circle r={loupe.skirt.outer - 8} stroke={color.white} strokeOpacity={0.07} strokeWidth={5} />
          <circle r={loupe.skirt.inner + 8} stroke={dark} strokeOpacity={0.4} strokeWidth={14} />
        </g>

        {/* The glass: lit from within, darker towards its edge, with the room's light caught on it. */}
        <circle r={glass} fill={paint(ID.lit)} />
        <path d="M-237,-111 A262,262 0 0 1 45,-258 A340,340 0 0 0 -237,-111Z" fill={paint(ID.spec)} opacity={0.5} />
        <ellipse cx={glint.x} cy={glint.y} rx={glint.long} ry={glint.short} transform={`rotate(${glint.turn} ${glint.x} ${glint.y})`} fill={paint(ID.glow)} />
        <path d="M118,226 A255,255 0 0 0 226,118" fill="none" stroke={color.white} strokeOpacity={0.12} strokeWidth={5} strokeLinecap="round" />

        {/* The barrel, its knurling and its rims. */}
        <g fill="none">
          <circle r={barrel.radius} stroke={barrel.body} strokeWidth={barrel.width} />
          <circle r={barrel.radius} stroke={paint(ID.barrel)} strokeWidth={barrel.width - 2} />
          <circle r={barrel.knurl} stroke={dark} strokeOpacity={0.66} strokeWidth={barrel.knurlWidth} strokeDasharray="2.1 3.1" />
          <circle r={barrel.knurl} stroke={color.white} strokeOpacity={0.1} strokeWidth={barrel.knurlWidth} strokeDasharray=".9 4.3" strokeDashoffset={1.4} />
          <circle r={barrel.knurl - barrel.knurlWidth / 2 - 1.5} stroke={dark} strokeOpacity={0.7} strokeWidth={1.6} />
          <circle r={glass + 3} stroke={dark} strokeWidth={3.5} />
          <circle r={glass + 6} stroke={paint(ID.rim)} strokeWidth={1.3} />
          <circle r={barrel.radius + barrel.width / 2 - 1.5} stroke={paint(ID.rim)} strokeWidth={1.2} opacity={0.8} />
        </g>

        <text transform={`rotate(${lens.turn})`} fontFamily={FACE.engrave.family} fontSize={engrave.size} letterSpacing={engrave.size * FACE.engrave.tracking} fill={color.white} fillOpacity={engrave.opacity}>
          <textPath href={`#${ID.engrave}`} startOffset="50%" textAnchor="middle" style={{ whiteSpace: 'pre' }}>{engrave.text}</textPath>
        </text>
      </svg>
    </>
  );
};
