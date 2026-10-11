// Measuring type in the browser, so text is fitted to what the fonts really set and not to an estimate.
// Widths are taken once per string at a reference size and kept in em; type scales linearly from there.
import type { CSSProperties } from 'react';
import { theme } from '../theme';
import { estimateEm, type Em } from './text';

const { font, weight, tracking, advance } = theme;

/** A face type is set in: family, weight, letter spacing in em, and variable-font settings. */
export interface Face { family: string; weight: number; tracking: number; settings?: string; advance: number }

export const FACE = {
  heavy: { family: font.display, weight: weight.heavy, tracking: tracking.display, advance: advance.display },
  figure: { family: font.display, weight: weight.heavy, tracking: tracking.figure, advance: advance.display },
  semi: { family: font.display, weight: weight.semi, tracking: tracking.display, advance: advance.display },
  light: { family: font.display, weight: weight.light, tracking: tracking.none, advance: advance.display },
  verdict: { family: font.display, weight: weight.heavy, tracking: tracking.verdict, advance: advance.display },
  text: { family: font.text, weight: weight.semi, tracking: tracking.none, advance: advance.text },
  body: { family: font.text, weight: weight.medium, tracking: tracking.none, advance: advance.text },
  code: { family: font.code, weight: weight.regular, tracking: tracking.none, advance: advance.code },
  print: { family: font.code, weight: weight.regular, tracking: tracking.print, advance: advance.code },
  engrave: { family: font.code, weight: weight.regular, tracking: tracking.engrave, advance: advance.code },
  codeStrong: { family: font.code, weight: weight.medium, tracking: tracking.none, advance: advance.code },
} satisfies Record<string, Face>;

/** The CSS that sets `face` at `size` px. */
export function faceStyle(face: Face, size: number, leading: number): CSSProperties {
  return { fontFamily: face.family, fontWeight: face.weight, fontSize: size, lineHeight: leading, letterSpacing: `${face.tracking}em`, fontVariationSettings: face.settings, whiteSpace: 'pre' };
}

const REFERENCE = 100;   // px the probe is set at
const measures = new Map<Face, Em>();
let probe: HTMLSpanElement | null = null;

/** The measure of `face`: the width of a string in em. Call only once the fonts are loaded; `forgetMeasures` clears what came before. */
export function emOf(face: Face): Em {
  const known = measures.get(face);
  if (known) return known;
  if (typeof document === 'undefined') return estimateEm(face.advance);
  const widths = new Map<string, number>();
  const em: Em = (text) => {
    let width = widths.get(text);
    if (width === undefined) {
      if (!probe) {
        probe = document.createElement('span');
        Object.assign(probe.style, { position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden' });
        document.body.appendChild(probe);
      }
      Object.assign(probe.style, faceStyle(face, REFERENCE, 1), { fontSize: `${REFERENCE}px`, fontVariationSettings: face.settings ?? 'normal' });
      probe.textContent = text;
      width = probe.getBoundingClientRect().width / REFERENCE;
      widths.set(text, width);
    }
    return width;
  };
  measures.set(face, em);
  return em;
}

export function forgetMeasures(): void {
  measures.clear();
}
