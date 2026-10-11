// Film geometry: pure. A strip is laid out in "rest px": the scene as it sits when the lens has landed, with the
// origin at the point under the centre of the lens and x running along the film. Film.tsx draws from these boxes.
import { theme } from '../theme';

const { film } = theme;

export interface Strip {
  /** Screen px of one perforation pitch. */
  perf: number;
  /** Perforations per frame: eight for a full landscape frame, four for a portrait half-frame. */
  per: number;
  /** Screen px from one frame to the next. */
  pitch: number;
  height: number;
  frame: { top: number; width: number; height: number; radius: number };
}

/** The strip under a lens whose full-frame pitch is `unit` px. */
export function stripOf(unit: number, half: boolean): Strip {
  const per = half ? film.perforations / 2 : film.perforations;
  const perf = unit / film.perforations;
  const pitch = perf * per;
  return {
    perf,
    per,
    pitch,
    height: unit * film.height,
    frame: {
      top: unit * (film.frame.top - film.height / 2),
      width: pitch - unit * film.frame.gap,
      height: unit * film.frame.height,
      radius: Math.max(film.frame.minRadius, unit * film.frame.radius),
    },
  };
}

export interface Box { left: number; top: number; width: number; height: number }

/** The picture area of frame `k`, when the lens rests `at` perforations past the start of frame 0. */
export function frameBox(strip: Strip, at: number, k: number): Box {
  return { left: (k * strip.per - at) * strip.perf + (strip.pitch - strip.frame.width) / 2, top: strip.frame.top, width: strip.frame.width, height: strip.frame.height };
}

/** The frames whose picture area reaches into `from..to` px along the strip. */
export function framesWithin(strip: Strip, at: number, from: number, to: number): number[] {
  const first = Math.floor(from / strip.pitch + at / strip.per) - 1;
  const last = Math.ceil(to / strip.pitch + at / strip.per) + 1;
  const frames: number[] = [];
  for (let k = first; k <= last; k++) {
    const box = frameBox(strip, at, k);
    if (box.left + box.width > from && box.left < to) frames.push(k);
  }
  return frames;
}
