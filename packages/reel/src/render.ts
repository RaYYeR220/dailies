import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { LineTiming, RenderArtifact, Scene, Storyboard } from '@dailies/core';
import { COMPOSITION_ID, NARRATION_FILE, type ReelProps } from './remotion/config';
import { toSrt } from './srt';
import { buildTimeline } from './timeline';

const ENTRY_POINT = fileURLToPath(new URL('./remotion/index.ts', import.meta.url));

type Browser = Awaited<ReturnType<typeof openBrowser>>;
type Composition = Awaited<ReturnType<typeof selectComposition>>;
interface Stage { serveUrl: string; composition: Composition; browser: Browser }

const middle = (slot: { startFrame: number; durationInFrames: number }) => slot.startFrame + Math.floor(slot.durationInFrames / 2);

const SCENE_TYPES = new Set<string>(['title', 'prompt', 'terminal', 'diff', 'stats', 'flag', 'end'] satisfies Scene['type'][]);

/**
 * File name of the still for scene `index`. Stills are numbered because scene ids come from a model and need not
 * be unique; the type is only used when it is one of ours, so nothing read from a storyboard can steer the path.
 */
export function stillName(index: number, type: string): string {
  return `${String(index + 1).padStart(2, '0')}-${SCENE_TYPES.has(type) ? type : 'scene'}.png`;
}

/** Bundles the composition with `publicDir`, opens one browser for every render in `fn`, and cleans both up. */
async function withComposition<T>(inputProps: ReelProps, publicDir: string | null, fn: (stage: Stage) => Promise<T>): Promise<T> {
  const work = await mkdtemp(join(tmpdir(), 'dailies-reel-'));
  let browser: Browser | undefined;
  try {
    const emptyPublic = join(work, 'public');
    await mkdir(emptyPublic);
    const serveUrl = await bundle({ entryPoint: ENTRY_POINT, publicDir: publicDir ?? emptyPublic, outDir: join(work, 'bundle') });
    await ensureBrowser();
    browser = await openBrowser('chrome');
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser });
    return await fn({ serveUrl, composition, browser });
  } finally {
    await browser?.close({ silent: true });
    await rm(work, { recursive: true, force: true });
  }
}

/** Writes `reel.mp4`, `reel.srt` and `poster.png` into `outDir`. With `audioPath` null the cut carries captions instead of narration. */
export async function renderReel(i: { storyboard: Storyboard; timings: LineTiming[]; audioPath: string | null; outDir: string }): Promise<RenderArtifact> {
  const timeline = buildTimeline(i.storyboard, i.timings);   // rejects a storyboard that cannot be timed before anything is bundled
  const outDir = resolve(i.outDir);
  const publicDir = join(outDir, 'public');
  const narration = join(publicDir, NARRATION_FILE);
  await mkdir(publicDir, { recursive: true });
  if (i.audioPath === null) await rm(narration, { force: true });   // a voiced attempt may have left one behind
  else if (resolve(i.audioPath) !== narration) await copyFile(i.audioPath, narration);

  const videoPath = join(outDir, 'reel.mp4');
  const srtPath = join(outDir, 'reel.srt');
  const posterPath = join(outDir, 'poster.png');
  const inputProps: ReelProps = { storyboard: i.storyboard, timings: i.timings, audio: i.audioPath !== null };

  await withComposition(inputProps, publicDir, async ({ serveUrl, composition, browser }) => {
    await renderMedia({ serveUrl, composition, inputProps, codec: 'h264', outputLocation: videoPath, puppeteerInstance: browser });
    await renderStill({ serveUrl, composition, inputProps, frame: middle(timeline.scenes[0]!), output: posterPath, puppeteerInstance: browser });
  });
  await writeFile(srtPath, toSrt(i.storyboard, i.timings, timeline.audioStartFrame / timeline.fps));

  return { videoPath, srtPath, posterPath, durationSec: timeline.totalFrames / timeline.fps };
}

/**
 * One PNG per scene, taken at the scene's middle frame, for the review stage.
 * Stills are drawn as the captions cut: it is the tighter layout and shows every piece of text a frame can carry.
 * They are also drawn settled, with every pencil mark landed, though a mark waits for its line in the reel itself.
 */
export async function renderStills(i: { storyboard: Storyboard; timings: LineTiming[]; outDir: string }): Promise<{ sceneId: string; path: string }[]> {
  const timeline = buildTimeline(i.storyboard, i.timings);
  const outDir = resolve(i.outDir);
  await mkdir(outDir, { recursive: true });
  const inputProps: ReelProps = { storyboard: i.storyboard, timings: i.timings, audio: false, settled: true };

  return withComposition(inputProps, null, async ({ serveUrl, composition, browser }) => {
    const stills: { sceneId: string; path: string }[] = [];
    for (const [n, slot] of timeline.scenes.entries()) {
      const path = join(outDir, stillName(n, i.storyboard.scenes[n]!.type));
      await renderStill({ serveUrl, composition, inputProps, frame: middle(slot), output: path, puppeteerInstance: browser });
      stills.push({ sceneId: slot.sceneId, path });
    }
    return stills;
  });
}
