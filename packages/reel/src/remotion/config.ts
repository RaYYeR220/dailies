// Shared by the composition and by the Node side of the renderer, so it imports nothing that needs a browser.
import type { LineTiming, Storyboard } from '@dailies/core';

export const COMPOSITION_ID = 'Reel';
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const NARRATION_FILE = 'narration.wav';

/** `audio` says whether `NARRATION_FILE` is in the public folder. Without it the reel is a captions cut. */
export type ReelProps = { storyboard: Storyboard; timings: LineTiming[]; audio: boolean };
