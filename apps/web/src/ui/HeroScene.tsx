'use client';

import { useEffect, useRef } from 'react';
import { LoupeBody } from './Loupe';
import { ringPath, seeded } from './pencil';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The strip as the naked eye sees it on the dark lightbox: small frames with a few soft bars each. */
function stripFrames() {
  const rand = seeded(212);
  const out: React.ReactNode[] = [];
  for (let k = -9; k <= 9; k++) {
    const x = 417.4;
    const y = r1(470 + k * 103.2 - 42);
    out.push(<rect key={`f${k}`} x={x} y={y} width="119.4" height="84" rx="1.5" fill="#101816" />);
    const bars = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < bars; i++) {
      out.push(<rect key={`b${k}-${i}`} x={x + 10} y={r1(y + 14 + i * 12)} width={r1(22 + rand() * 72)} height="3" rx="1.5" fill="#eef3f1" opacity={(0.06 + rand() * 0.08).toFixed(2)} />);
    }
  }
  return out;
}

/** The optical soundtrack beside the picture: a ribbon whose width is the sound. */
function soundtrack() {
  let left = '';
  let right = '';
  for (let y = -620; y <= 620; y += 5) {
    const a = 3 + 13 * Math.abs(Math.sin(y * 0.045) * Math.sin(y * 0.013 + 1.3)) + 4 * Math.abs(Math.sin(y * 0.31));
    left += `${r1(-206 - a)},${y} `;
    right = `${r1(-206 + a)},${y} ${right}`;
  }
  return (left + right).trim();
}

const FRAMES = stripFrames();
const SOUND = soundtrack();
const PERFS = Array.from({ length: 15 }, (_, i) => r1((i - 7 + 0.5) * 87.72 - 18.3));

/**
 * One frame of the night under the loupe: the test run that failed, ringed in pencil. Scrolling slides
 * the film under the glass towards what the agent said next; the refraction in the skirt goes the other
 * way and the highlight turns.
 */
export function HeroScene({ className }: { className?: string }) {
  const lens = useRef<SVGGElement>(null);
  const skirt = useRef<SVGGElement>(null);
  const glass = useRef<SVGGElement>(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let queued = false;
    const shift = () => {
      queued = false;
      const t = Math.min(window.scrollY / window.innerHeight, 1.15);
      lens.current?.setAttribute('transform', `translate(${(-16 * t).toFixed(1)} ${(-132 * t).toFixed(1)})`);
      skirt.current?.setAttribute('transform', `translate(${(7 * t).toFixed(1)} ${(44 * t).toFixed(1)})`);
      glass.current?.setAttribute('transform', `rotate(${(-16 * t).toFixed(1)})`);
    };
    const onScroll = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(shift);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    shift();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <svg className={className} viewBox="0 0 940 940" aria-hidden="true">
      <defs>
        <radialGradient id="hero-spill" cx="470" cy="470" r="640" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#eef3f1" stopOpacity=".2" />
          <stop offset=".56" stopColor="#eef3f1" stopOpacity=".15" />
          <stop offset=".72" stopColor="#eef3f1" stopOpacity=".055" />
          <stop offset="1" stopColor="#eef3f1" stopOpacity="0" />
        </radialGradient>
        <pattern id="hero-perfs" patternUnits="userSpaceOnUse" x="375" y="5.6" width="190" height="25.8">
          <rect x="11" y="7.5" width="15.2" height="10.8" rx="2" fill="#1c2724" />
          <rect x="163.8" y="7.5" width="15.2" height="10.8" rx="2" fill="#1c2724" />
        </pattern>
      </defs>

      <g id="hero-strip" transform="rotate(-7 470 470)">
        <rect x="375" y="-520" width="190" height="1980" fill="#070a09" />
        <rect x="375" y="-520" width="190" height="1980" fill="url(#hero-perfs)" />
        {FRAMES}
        <path d="M375.6,-520V1460M564.4,-520V1460" stroke="#eef3f1" strokeOpacity=".16" strokeWidth="1.2" />
        <path d="M409.5,-520V1460" stroke="#eef3f1" strokeOpacity=".1" strokeWidth="2.4" strokeDasharray="3 2 7 3 2 5 9 2" />
      </g>
      <circle data-spill cx="470" cy="470" r="640" fill="url(#hero-spill)" />

      <LoupeBody
        x={470}
        y={470}
        lensFill="#16221e"
        glassRef={glass}
        under={
          <g ref={skirt}>
            <use href="#hero-strip" transform="scale(1.09) translate(-464 -474)" />
          </g>
        }
      >
        <g ref={lens}>
          <g transform="rotate(-7)">
            <g fill="#5b6f68">
              {PERFS.map((y) => (
                <g key={y}>
                  <rect x="-285.6" y={y} width="51.7" height="36.6" rx="7" />
                  <rect x="234" y={y} width="51.7" height="36.6" rx="7" />
                </g>
              ))}
            </g>
            <polygon points={SOUND} fill="#eef3f1" fillOpacity=".5" />

            <rect x="-178.8" y="-493.4" width="405.8" height="285.6" rx="5" fill="url(#lp-pic)" />
            <g fill="#eef3f1">
              <rect x="-150" y="-262" width="170" height="9" rx="4.5" opacity=".24" />
              <rect x="-150" y="-240" width="236" height="9" rx="4.5" opacity=".14" />
            </g>

            {/* the frame under the glass: the test run */}
            <rect x="-178.8" y="-142.8" width="405.8" height="285.6" rx="5" fill="url(#lp-pic)" />
            <text className="mono" x="-176" y="-160" fontSize="12.5" fill="#eef3f1" fillOpacity=".5" letterSpacing="1.5">S3  204</text>
            <text className="code" x="-150" y="-96" fontSize="17" fill="#eef3f1" fillOpacity=".6">$ pnpm test</text>
            <text className="disp" x="24" y="34" textAnchor="middle" fontSize="66" fontWeight="800" fill="#eef3f1" letterSpacing="-1.8">2 failed</text>
            <path
              className="lens-draw"
              style={{ '--draw-delay': '0.55s' } as React.CSSProperties}
              pathLength={1}
              d={ringPath(24, 10, 190, 66, { seed: 12, start: Math.PI * 0.9 })}
              fill="none"
              stroke="#ffd60a"
              strokeWidth="7.5"
              strokeLinecap="round"
              filter="url(#pencil)"
            />
            <text className="disp" x="24" y="112" textAnchor="middle" fontSize="19" fontWeight="300" fill="#eef3f1" fillOpacity=".55">12 passed</text>

            {/* the next frame: what the agent said afterwards */}
            <rect x="-178.8" y="207.8" width="405.8" height="285.6" rx="5" fill="url(#lp-pic)" />
            <text className="mono" x="-112" y="246" fontSize="13" fill="#eef3f1" fillOpacity=".5">agent, 02:14</text>
            <text className="txt" x="-112" y="292" fontSize="27" fontWeight="600" fill="#eef3f1" fillOpacity=".92">“All 14 tests pass.”</text>
          </g>
        </g>
      </LoupeBody>
    </svg>
  );
}
