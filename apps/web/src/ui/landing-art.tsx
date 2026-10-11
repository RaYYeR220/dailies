import type { ReactNode } from 'react';
import { LoupeBody } from './Loupe';
import type { Mark } from './model';
import { crossPath, questionPath, ringPath } from './pencil';

/* Pictures for the landing page. Each one is a frame of film; none of them is interface. */

const pencil = { fill: 'none', stroke: '#ffd60a', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, filter: 'url(#pencil)' };

function Perfs({ count, pitch, first, top, bottom, w, h, rx }: { count: number; pitch: number; first: number; top: number; bottom: number; w: number; h: number; rx: number }) {
  return (
    <g fill="#1c2724">
      {Array.from({ length: count }, (_, i) => (
        <g key={i}>
          <rect x={i * pitch + first} y={top} width={w} height={h} rx={rx} />
          <rect x={i * pitch + first} y={bottom} width={w} height={h} rx={rx} />
        </g>
      ))}
    </g>
  );
}

/** One frame of a strip that runs on to either side: eight perforations to the frame, numbered below. */
function StepFrame({ n, label, edgePrint, children, over }: { n: number; label: string; edgePrint?: string; children?: ReactNode; over?: ReactNode }) {
  return (
    <svg viewBox="0 0 640 590" role="img" aria-label={label}>
      <rect y="-1" width="640" height="592" fill="#070a09" />
      <Perfs count={8} pitch={80} first={23.25} top={33.5} bottom={509.3} w={33.5} h={47} rx={6.4} />
      <path d="M0,0H640M0,590H640" stroke="#eef3f1" strokeOpacity=".16" strokeWidth="2" />
      <rect x="16.7" y="92.5" width="606.5" height="404" rx="6.7" fill="#131c19" />
      {children}
      <text className="mono" x="60" y="580" fontSize="19" fill="#eef3f1" fillOpacity=".62">{n}</text>
      {edgePrint ? <text className="mono" x="80" y="26" fontSize="13" fill="#eef3f1" fillOpacity=".26" letterSpacing="3">{edgePrint}</text> : null}
      {over}
    </svg>
  );
}

export function StepPaste() {
  return (
    <StepFrame n={1} label="Frame 1: a repository address pasted into a field." edgePrint="DAILIES SAFETY FILM">
      <rect x="58" y="246" width="524" height="96" rx="48" fill="#070a09" fillOpacity=".72" stroke="#eef3f1" strokeOpacity=".28" strokeWidth="2" />
      <text className="code" x="96" y="303" fontSize="25" fill="#eef3f1" fillOpacity=".92">github.com/acme/api</text>
      <rect x="398" y="258" width="172" height="72" rx="36" fill="#ffd60a" />
      <text className="txt" x="484" y="303" fontSize="25" fontWeight="600" textAnchor="middle" fill="#0d1211">Paste</text>
    </StepFrame>
  );
}

export function StepCheck() {
  return (
    <StepFrame
      n={2}
      label="Frame 2, under the loupe: the agent wrote “All 14 tests pass”, crossed out in pencil."
      over={
        <LoupeBody x={320} y={295} scale={0.92}>
          <g transform="rotate(-2)">
            <text className="mono" x="0" y="-104" fontSize="20" textAnchor="middle" fill="#eef3f1" fillOpacity=".62">agent, 02:14</text>
            <path d={crossPath(0, 4, 420, 190, 3)} strokeWidth="12" {...pencil} />
            <text className="disp" textAnchor="middle" fontSize="50" fontWeight="600" fill="#eef3f1" letterSpacing="-1.5" stroke="#2a3f38" strokeWidth="8" strokeLinejoin="round" paintOrder="stroke">
              <tspan x="0" y="-12">“All 14</tspan>
              <tspan x="0" y="52">tests pass.”</tspan>
            </text>
          </g>
        </LoupeBody>
      }
    />
  );
}

export function StepDecide() {
  return (
    <StepFrame n={3} label="Frame 3: a play button, Approve and Request changes.">
      <circle cx="150" cy="294" r="60" fill="none" stroke="#eef3f1" strokeOpacity=".75" strokeWidth="3" />
      <path d="M136,268 L180,294 L136,320Z" fill="#eef3f1" stroke="#eef3f1" strokeWidth="7" strokeLinejoin="round" />
      <rect x="262" y="216" width="304" height="70" rx="35" fill="#ffd60a" />
      <text className="txt" x="414" y="260" fontSize="25" fontWeight="600" textAnchor="middle" fill="#0d1211">Approve</text>
      <rect x="262" y="302" width="304" height="70" rx="35" fill="none" stroke="#eef3f1" strokeOpacity=".42" strokeWidth="2" />
      <text className="txt" x="414" y="346" fontSize="25" fontWeight="600" textAnchor="middle" fill="#eef3f1">Request changes</text>
    </StepFrame>
  );
}

/** A single frame cut from the strip, carrying one of the four marks on the thing it judges. */
export function VerdictChip({ kind }: { kind: Mark }) {
  const quote = (a: string, b: string) => (
    <text className="disp" textAnchor="middle" fontSize="31" fontWeight="600" fill="#eef3f1" letterSpacing="-.8" stroke="#263a33" strokeWidth="6" strokeLinejoin="round" paintOrder="stroke">
      <tspan x="160" y="136">{a}</tspan>
      <tspan x="160" y="176">{b}</tspan>
    </text>
  );
  return (
    <svg viewBox="0 0 320 295" aria-hidden="true">
      <rect width="320" height="295" fill="#070a09" />
      <Perfs count={8} pitch={40} first={11.6} top={16.7} bottom={254.7} w={16.7} h={23.5} rx={3.2} />
      <rect x="8.4" y="46.2" width="303.2" height="202" rx="4" fill="url(#lp-pic)" />
      {kind === 'ring' ? (
        <>
          <text className="disp" x="160" y="160" fontSize="35" fontWeight="800" textAnchor="middle" fill="#eef3f1" letterSpacing="-1">14 passed</text>
          <path d={ringPath(160, 148, 139, 52, { seed: 3, start: Math.PI * 0.88 })} strokeWidth="6.5" {...pencil} />
        </>
      ) : null}
      {kind === 'cross' ? (
        <>
          <path d={crossPath(160, 148, 252, 150, 6)} strokeWidth="8" {...pencil} />
          {quote('“All 14', 'tests pass.”')}
        </>
      ) : null}
      {kind === 'dashed' ? (
        <>
          <text className="disp" x="160" y="146" fontSize="35" fontWeight="800" textAnchor="middle" fill="#eef3f1" fillOpacity=".82" letterSpacing="-1">14 passed</text>
          <path d={ringPath(160, 134, 139, 50, { seed: 8, turns: 1, drift: 0 })} strokeWidth="6.5" strokeDasharray="22 15" {...pencil} />
          <text className="code" x="160" y="222" fontSize="15" textAnchor="middle" fill="#eef3f1" fillOpacity=".66">then send.ts was edited</text>
        </>
      ) : null}
      {kind === 'question' ? (
        <>
          <text className="disp" fontSize="27" fontWeight="600" fill="#eef3f1" letterSpacing="-.8">
            <tspan x="32" y="106">“Deployed</tspan>
            <tspan x="32" y="141">to staging.”</tspan>
          </text>
          <path d={questionPath(246, 192, 92)} strokeWidth="8" {...pencil} />
        </>
      ) : null}
    </svg>
  );
}
