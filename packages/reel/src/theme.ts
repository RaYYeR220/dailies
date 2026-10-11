// The whole art direction of the reel: "Loupe". A strip of film on a switched-off lightbox, a loupe moving
// along it, verdicts in grease pencil. Scenes take every colour, family, size, radius and timing from here
// and carry none of their own, so a redesign is an edit to this file. docs/design.md describes the direction.
import { loadFont as loadDisplay } from '@remotion/google-fonts/Unbounded';
import { loadFont as loadText } from '@remotion/google-fonts/Figtree';
import { loadFont as loadTextWide } from '@remotion/google-fonts/Manrope';
import { loadFont as loadCode } from '@remotion/google-fonts/MartianMono';

// Rendering waits for these. Outside a browser (tests, the Node side of the renderer) loadFont does nothing.
const display = loadDisplay('normal', { weights: ['300', '600', '800'], subsets: ['latin', 'latin-ext', 'cyrillic'] });
const text = loadText('normal', { weights: ['500', '600'], subsets: ['latin', 'latin-ext'] });
// Figtree has no Cyrillic or Greek. Manrope stands in for those glyphs only, so a quoted prompt never falls to a system font.
const textWide = loadTextWide('normal', { weights: ['500', '600'], subsets: ['cyrillic', 'greek'] });
const code = loadCode('normal', { weights: ['400', '500'], subsets: ['latin', 'latin-ext', 'cyrillic'] });

/** Resolves when every face is usable. Text is measured to be fitted, so nothing may be laid out before this. */
export const fontsReady: Promise<unknown> = Promise.all([display, text, textWide, code].map((f) => f.waitUntilDone()));

const color = {
  lightbox: { far: '#0d1211', glass: '#121917', near: '#1a2421' },
  // `lit` has to keep a luma above 0.12: the review stage runs ffmpeg blackdetect, and the lit glass is what
  // keeps a frame of this dark room from reading as black. theme.test.ts and lens.test.ts pin this.
  film: { base: '#070a09', frame: '#131c19', perf: '#1c2724', lit: '#2a3f38' },
  white: '#eef3f1',
  soft: '#c3cfca',
  muted: '#8fa099',
  pencil: '#ffd60a',
  ink: '#0d1211',
} as const;

/** `hex` at `opacity`, for the washes and shadows that are a theme colour seen through something. */
export function fade(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

interface LensPlace { x: number; y: number; scale: number }

export const theme = {
  color,
  /** The room: darkest far from the lens. */
  backdrop: (lens: LensPlace) =>
    `radial-gradient(circle 1300px at ${lens.x}px ${lens.y}px, ${color.lightbox.near} 0%, ${color.lightbox.glass} 45%, ${color.lightbox.far} 100%)`,
  /** The loupe's lamp falling on the film around it. */
  spill: (lens: LensPlace) =>
    `radial-gradient(circle ${Math.round(640 * lens.scale)}px at ${lens.x}px ${lens.y}px, ${fade(color.white, 0.2)} 0%, ${fade(color.white, 0.15)} 54%, ${fade(color.white, 0.05)} 70%, ${fade(color.white, 0)} 100%)`,
  font: {
    display: `"${display.fontFamily}", "${textWide.fontFamily}", sans-serif`,
    text: `"${text.fontFamily}", "${textWide.fontFamily}", sans-serif`,
    code: `"${code.fontFamily}", monospace`,
  },
  /** Mean glyph advance in em: the stand-in for a measurement where there is no browser to measure in. */
  advance: { display: 0.68, text: 0.5, code: 0.7 },
  /** The smallest size a role may be set at, in px at 1920x1080. theme.test.ts holds every size below to it. */
  floor: { display: 72, text: 40, code: 30 },
  /** Type sizes in px at 1920x1080. A range is fitted to the text it holds. */
  size: {
    display: {
      repo: { max: 132, min: 72 },      // the repo name under the glass
      hero: { max: 150, min: 72 },      // the repo name on the end card
      window: { max: 124, min: 72 },    // the window label beside the lens
      quote: { max: 84, min: 72 },      // a prompt or a claim short enough for display
      result: { max: 84, min: 72 },     // the decisive part of a command's output
      figure: { max: 188, min: 72 },    // a stat under the glass
      value: { max: 100, min: 72 },     // a stat on a frame
      file: { max: 76, min: 72 },
      wordmark: { max: 100, min: 72 },
      verdict: 72,
    },
    text: {
      quote: { max: 60, min: 40 },      // a prompt or a claim too long for display
      reality: { max: 56, min: 40 },
      value: { max: 64, min: 40 },      // a stat or a result too long for display
      figure: 52,                       // the label of the stat under the glass
      label: 40,
      detail: 44,
      tally: 44,
      caption: 40,
    },
    code: { output: { max: 44, min: 30 }, command: 32, patch: 30, ref: 30 },
  },
  weight: { light: 300, regular: 400, medium: 500, semi: 600, heavy: 800 },
  leading: { solid: 1, display: 1.1, tight: 1.22, quote: 1.24, text: 1.3, code: 1.3, patch: 2 },
  /** Letter spacing in em. */
  tracking: { display: -0.02, figure: -0.027, none: 0, verdict: 0.014, print: 0.24, engrave: 0.36 },
  space: { xxs: 4, xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48, huge: 72, vast: 112 },
  radius: { pill: 999, bar: 20 },
  pillShadow: `0 10px 28px ${fade(color.film.base, 0.55)}`,
  /** How dim a thing is: full, secondary, tertiary, and the levels of a patch. */
  dim: { full: 1, strong: 0.94, soft: 0.62, faint: 0.5, removed: 0.42, band: 0.05, zero: 0.35 },

  /** 35 mm stock. Lengths are shares of the frame pitch of a full, eight-perforation frame. */
  film: {
    tilt: -2,                // degrees; the strip, and everything seen through the glass
    perforations: 8,         // per full frame; a half-frame takes four
    height: 0.9215,
    perf: { width: 0.0523, height: 0.0735, inset: 0.0523, radius: 0.01 },
    frame: { top: 0.1445, height: 0.6314, gap: 0.0523, radius: 0.0105, minRadius: 3 },
    edge: fade(color.white, 0.16),
    edgeWidth: 2,
    greek: { bar: 0.03, pitch: 0.072, opacity: 0.09 },
    print: { size: 0.032, minSize: 9, maxSize: 26, opacity: 0.3, label: 'DAILIES SAFETY FILM' },   // texture, not text: exempt from the floors
    padding: 0.077,          // inset of a frame's content
  },

  /** The loupe at scale 1, in px from its centre. */
  loupe: {
    glass: 276,
    barrel: { radius: 300, width: 46, knurl: 312.5, knurlWidth: 15, body: '#0a0d0c', shade: ['#66756f', '#232c29', '#090c0b', '#1b2320', '#45524d'], stops: [0, 0.2, 0.48, 0.68, 0.86] },
    skirt: { inner: 322, outer: 362, refraction: 1.07, shift: { x: 6, y: -4 } },
    glint: { x: -118, y: -178, long: 62, short: 13, turn: -38 },
    engrave: { radius: 290.5, size: 9.5, opacity: 0.62, text: 'DAILIES OPTICAL     4× ILLUMINATED LOUPE     No 0212' },
    rim: 44,                 // clear margin between text and the edge of the glass, in screen px
    // The shadow on the lightbox: a disc of `radius`, moved by `x`, `y`, dense under the skirt and gone at its own edge.
    shadow: {
      radius: 404,
      x: 12,
      y: 24,
      paint: `radial-gradient(closest-side, ${fade(color.film.base, 0.66)} 0%, ${fade(color.film.base, 0.62)} 80%, ${fade(color.film.base, 0.36)} 90%, ${fade(color.film.base, 0)} 100%)`,
    },
    base: '#17201d',
    veil: 0.1,
    passing: { magnify: 2.4, gain: 1.6 },   // the film seen going by under the glass during a glide: how enlarged, how soon in full
    focusBlur: 16,           // px of blur on content the lens has not landed on yet
    parallax: 1.35,          // how much faster than the film the content under the glass passes
    greek: { bar: 0.036, opacity: 0.14 },
  },

  /** Grease pencil. Three sizes of the same hand: a wobble of the stroke, then waxy holes knocked in it. */
  pencil: {
    large: { above: 260, wobble: { frequency: 0.012, octaves: 2, scale: 18, seed: 7 }, wax: { frequency: 0.5, seed: 3, cut: 2.2 } },
    medium: { above: 90, wobble: { frequency: 0.03, octaves: 2, scale: 7, seed: 4 }, wax: { frequency: 0.85, seed: 11, cut: 2.15 } },
    small: { above: 0, wobble: { frequency: 0.05, octaves: 1, scale: 3, seed: 9 }, wax: null },
    weight: { share: 0.034, min: 6, max: 16 },   // stroke width from the size of the mark
    halo: 0.14,                                  // width of the halo type keeps over a mark, in em
    dash: { count: 15, fill: 0.6 },
  },

  layout: {
    margin: 96,
    measure: 1240,           // the widest a line of running text is set
    captionInset: 248,       // bottom inset a narrated scene keeps clear in a captions cut
    captionBottom: 36,
    captionWidth: 1640,
    captionLines: 3,
    captionEdge: fade(color.white, 0.13),
    captionFill: fade(color.film.base, 0.92),
  },

  /** Where the lens rests in each scene: centre in px, scale, the turn of the barrel in degrees, the frame pitch under it. */
  shot: {
    title: { x: 600, y: 690, scale: 1.4, turn: 0, unit: 300 },
    prompt: { x: 960, y: 540, scale: 2.25, turn: -90, unit: 1100 },
    // `at` is how far into its frame the lens rests, in perforations: a little past the middle, which leaves the step before it in the clear.
    terminal: { x: 1548, y: 520, scale: 1.25, turn: 0, unit: 600, at: 4.4, alone: { x: 960, scale: 1.5 } },   // `alone`: a single step, with no step before it to keep clear
    diff: { x: 980, y: 540, scale: 2.75, turn: -90, unit: 1500 },
    stats: { y: 540, turn: 0, scale: [1.3, 1.15, 1.15, 1.05, 1, 0.95], bleed: [0, -40, -40, -40, 20, 90], maxPitch: 420, gap: 8 },
    // The lens grows by up to `grow` for a long record, away from the quote. `pill` is the centre of the verdict pill:
    // `x` from the near edge of the lens, `y` below its centre. `floor` is how far down the glass text may reach, as a share of the radius.
    flag: { x: 1333, y: 497, scale: 1.152, grow: 0.17, short: 90, long: 200, turn: 0, unit: 803, pill: { x: 117, y: 362, pad: 36, height: 1.5 }, floor: 0.72 },
    end: { x: 1640, y: 550, scale: 1.1, turn: 0, pitch: 146, minPitch: 64, reach: 1160, overlap: 14 },
  },

  motion: {
    enterSec: 0.5,           // one element's entrance
    staggerSec: 0.1,         // delay between neighbours
    riseBy: 28,              // px an element travels while entering
    // Share of a scene by which everything but the pencil has landed. Review stills are taken at the middle
    // of a scene, so this has to stay below 0.5 or the reviewer sees half-built frames.
    settleBy: 0.42,
    ease: [0.16, 1, 0.3, 1],
    /** The lens glide and the film advance between scenes: a spring following a short ramp, so it leaves softly. */
    glide: { config: { damping: 11.5, stiffness: 50, mass: 1 }, rampFrames: 6, leadSec: 0.35, followSec: 0.75 },
    travel: 1500,            // px of film that pass under the lens between two scenes
    shutter: 0.6,            // motion blur of the film: the share of a frame's travel its perforations and frames smear over
    driftPerSec: 7,          // px the picture drifts along the strip while a scene plays
    stepSec: 0.6,            // the strip advancing one frame inside a scene
    drawSec: 0.5,            // one pencil mark
    cueShare: 0.4,           // how far into its line a mark starts
    cueMinSec: 0.27,
    cueMaxSec: 1.5,
    stamp: { damping: 11, stiffness: 170, mass: 0.7 },
    stampTilt: -5,           // degrees
    stampFrom: 1.7,          // scale the verdict pill drops in from
  },
} as const;
