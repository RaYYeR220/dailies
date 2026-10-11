// The whole art direction of the reel. Scenes take every colour, family, size, radius and
// timing from here and carry none of their own, so a redesign is an edit to this file.
import { loadFont as loadDisplay } from '@remotion/google-fonts/InstrumentSerif';
import { loadFont as loadText } from '@remotion/google-fonts/IBMPlexSans';
import { loadFont as loadMono } from '@remotion/google-fonts/IBMPlexMono';

// Rendering waits for these. Outside a browser (tests, the Node side of the renderer) loadFont does nothing.
const display = loadDisplay('normal', { weights: ['400'], subsets: ['latin'] });
loadDisplay('italic', { weights: ['400'], subsets: ['latin'] });
const text = loadText('normal', { weights: ['400', '500'], subsets: ['latin', 'cyrillic'] });
const mono = loadMono('normal', { weights: ['400'], subsets: ['latin', 'cyrillic'] });

const color = {
  // Both backdrop colours must keep a luma above 0.12: the review stage runs ffmpeg blackdetect,
  // which reads anything at or below 0.10 as a black frame. theme.test.ts pins this.
  bg: '#1E1F25',
  bgGlow: '#2A2C35',
  panel: '#282A32',
  edge: '#40434F',
  text: '#F2EFE8',
  muted: '#B1B3BC',
  faint: '#858893',
  accent: '#E9B95F',
  ok: '#8BD5A1',
  okWash: 'rgba(139, 213, 161, 0.14)',
  bad: '#F68C7F',
  badWash: 'rgba(246, 140, 127, 0.15)',
  stale: '#E9B95F',
} as const;

export const theme = {
  color,
  backdrop: `radial-gradient(120% 90% at 12% 0%, ${color.bgGlow} 0%, ${color.bg} 62%)`,
  font: {
    // The display face has no Cyrillic; the text face behind it does, so a quoted prompt still sets cleanly.
    display: `"${display.fontFamily}", "${text.fontFamily}", serif`,
    text: `"${text.fontFamily}", sans-serif`,
    mono: `"${mono.fontFamily}", monospace`,
  },
  /** Mean glyph advance in em, used to fit text to a box without measuring it. */
  advance: { display: 0.42, figure: 0.5, text: 0.52, mono: 0.6 },
  /** Type sizes in px at 1920x1080. A range is fitted to the text it holds. */
  size: {
    hero: { max: 190, min: 80 },
    quote: { max: 92, min: 46 },
    claim: { max: 66, min: 40 },
    reality: { max: 46, min: 32 },
    stat: { max: 148, min: 60 },
    count: 96,
    stamp: 44,
    body: 36,
    caption: 34,
    icon: 34,
    code: 28,
    label: 22,
  },
  weight: { regular: 400, medium: 500 },
  leading: { display: 1.06, quote: 1.2, text: 1.35, code: 1.5 },
  tracking: { display: '-0.01em', label: '0.16em', none: '0em' },
  radius: { sm: 8, md: 14, lg: 22 },
  space: { xs: 8, sm: 16, md: 28, lg: 44, xl: 72 },
  stroke: { hair: 2, bar: 6, icon: 2.6 },
  layout: {
    marginX: 120,
    headerTop: 60,
    contentTop: 148,
    contentBottom: 92,            // bottom inset of a scene when the narration is voiced
    contentBottomCaptions: 252,   // bottom inset that keeps a three-line caption bar clear of the scene
    captionBottom: 52,
    captionWidth: 1560,
    progress: 4,
  },
  motion: {
    enterSec: 0.5,       // one element's entrance
    staggerSec: 0.1,     // delay between neighbours
    riseBy: 28,          // px an element travels while entering
    // Share of a scene by which everything has landed. Review stills are taken at the middle
    // of a scene, so this has to stay below 0.5 or the reviewer sees half-built frames.
    settleBy: 0.42,
    ease: [0.16, 1, 0.3, 1],
    stamp: { damping: 11, stiffness: 170, mass: 0.7 },
    stampTilt: -3,       // degrees
    stampFrom: 1.7,      // scale the stamp drops in from
  },
} as const;
