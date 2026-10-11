import React from 'react';
import { theme } from '../theme';
import { WIDTH } from './config';
import type { Framing, Take } from './lens';
import { FACE, faceStyle } from './measure';
import { frameBox, framesWithin, stripOf } from './strip';
import { useScene } from './ui';

const { color, film } = theme;

const paint = (id: string) => `url(#${id})`;
const SLACK = 240;   // px of film drawn past each side of the frame, for the tilt and for motion blur

/** The base of the strip with its two rows of perforations and the light on its edges. It runs on past both sides of the frame. */
const Band: React.FC<{ view: Framing; lensX: number; id: string }> = ({ view, lensX, id }) => {
  const perf = view.unit / film.perforations;
  const height = view.unit * film.height;
  const left = lensX + SLACK;
  const width = WIDTH + 2 * SLACK;
  const hole = { width: view.unit * film.perf.width, height: view.unit * film.perf.height, inset: view.unit * film.perf.inset, radius: view.unit * film.perf.radius };
  // Perforations sit at whole numbers of the film's own count, so they travel with it and stay in step across a glide.
  const phase = (((-view.takes[0]!.focus % 1) + 1) % 1) * perf;
  return (
    <svg width={width} height={height} style={{ position: 'absolute', left: -left, top: -height / 2 }}>
      <defs>
        <pattern id={id} patternUnits="userSpaceOnUse" x={left + phase} y={0} width={perf} height={height}>
          <rect x={(perf - hole.width) / 2} y={hole.inset} width={hole.width} height={hole.height} rx={hole.radius} fill={color.film.perf} />
          <rect x={(perf - hole.width) / 2} y={height - hole.inset - hole.height} width={hole.width} height={hole.height} rx={hole.radius} fill={color.film.perf} />
        </pattern>
      </defs>
      <rect width={width} height={height} fill={color.film.base} />
      <rect width={width} height={height} fill={paint(id)} />
      <path d={`M0,${film.edgeWidth / 2}H${width}M0,${height - film.edgeWidth / 2}H${width}`} stroke={film.edge} strokeWidth={film.edgeWidth} />
    </svg>
  );
};

/** A few soft bars: what an unlit frame holds when it is not the one being told. Fixed by the frame's number. */
const Greek: React.FC<{ k: number; unit: number; width: number }> = ({ k, unit, width }) => {
  const seed = (n: number) => { const x = Math.sin((k * 97 + n * 13 + 3) * 12.9898) * 43758.5453; return x - Math.floor(x); };
  const rows = 3 + Math.floor(seed(0) * 3);
  const bar = unit * film.greek.bar;
  const inset = unit * film.padding;
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{ position: 'absolute', left: inset, top: inset + i * unit * film.greek.pitch, height: bar, width: (width - 2 * inset) * (0.25 + seed(i + 1) * 0.55), borderRadius: bar, background: color.white, opacity: film.greek.opacity * (0.6 + seed(i + 7) * 0.8) }}
        />
      ))}
    </>
  );
};

const PRINT_EVERY = 4;   // frames between two runs of the edge print

/** The picture frames of one scene's stretch of film, and the print along its edge. Frames the scene puts content on are left empty; the rest are greeked. */
const Frames: React.FC<{ take: Take; unit: number; lensX: number }> = ({ take, unit, lensX }) => {
  const { shot } = take;
  const strip = stripOf(shot.unit, shot.half);
  const scale = unit / shot.unit;
  const moved = (shot.at - take.focus) * strip.perf;
  const frames = framesWithin(strip, shot.at, (-lensX - SLACK) / scale - moved, (WIDTH - lensX + SLACK) / scale - moved);
  const [first, last] = shot.frames;
  const print = Math.min(film.print.maxSize, shot.unit * film.print.size);
  const margin = shot.unit * film.perf.inset;
  return (
    <>
      {frames.map((k) => {
        const box = frameBox(strip, shot.at, k);
        return (
          <React.Fragment key={k}>
            <div style={{ position: 'absolute', ...box, borderRadius: strip.frame.radius, background: color.film.frame, opacity: take.frames }}>
              {k < first || k > last ? <Greek k={k} unit={shot.unit} width={box.width} /> : null}
            </div>
            {print >= film.print.minSize ? (
              <>
                {k % PRINT_EVERY === 0 ? (
                  <div style={{ position: 'absolute', left: box.left, top: -strip.height / 2 + (margin - print) / 2, ...faceStyle(FACE.print, print, 1), color: color.white, opacity: film.print.opacity * take.frames }}>
                    {film.print.label}
                  </div>
                ) : null}
                {k < first || k > last ? (
                  <div style={{ position: 'absolute', left: box.left, top: strip.height / 2 - margin + (margin - print) / 2, ...faceStyle(FACE.print, print, 1), color: color.white, opacity: film.print.opacity * take.frames }}>
                    {`${((k % 36) + 36) % 36 + 1}A`}
                  </div>
                ) : null}
              </>
            ) : null}
          </React.Fragment>
        );
      })}
    </>
  );
};

/**
 * The film as the camera sees it, drawn around the point under the lens (which is this element's origin).
 * Each take is one scene's stretch of the strip, moved and scaled by the camera; `children(take)` puts that
 * scene's content on it, in the px of the scene at rest.
 */
export const Strip: React.FC<{ view: Framing; lensX: number; id: string; filter?: string; children?: (take: Take) => React.ReactNode }> = ({ view, lensX, id, filter, children }) => (
  <div style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transform: `rotate(${film.tilt}deg)`, filter }}>
    <Band view={view} lensX={lensX} id={id} />
    {view.takes.map((take) => {
      const perf = view.unit / film.perforations;
      return (
        <div key={take.index} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0, transformOrigin: '0 0', transform: `translateX(${(take.shot.at - take.focus) * perf}px) scale(${view.unit / take.shot.unit})` }}>
          <Frames take={take} unit={view.unit} lensX={lensX} />
          {children ? <div style={{ opacity: take.presence }}>{children(take)}</div> : null}
        </div>
      );
    })}
  </div>
);

/** A box over the picture area of frame `k` of the scene being drawn. */
export const OnFrame: React.FC<{ k: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ k, style, children }) => {
  const { shot } = useScene();
  const strip = stripOf(shot.unit, shot.half);
  return <div style={{ position: 'absolute', ...frameBox(strip, shot.at, k), ...style }}>{children}</div>;
};
