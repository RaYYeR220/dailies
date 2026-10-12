// Measuring the renderer, and holding two versions of it side by side. Not a test: run it by hand.
//
//   pnpm --filter @dailies/reel exec tsx test/bench.ts reel   --out <dir> [--src <dir>]... [--runs 2]
//   pnpm --filter @dailies/reel exec tsx test/bench.ts frames --out <dir> [--src <dir>]... [--every 5] [--runs 2]
//   pnpm --filter @dailies/reel exec tsx test/bench.ts stills --out <dir> [--src <dir>] [--board fixture|stress|real]... [--frames 10,20]
//   pnpm --filter @dailies/reel exec tsx test/bench.ts compare <dirA> <dirB> [--sheets <dir>]
//
// `reel` renders the whole fixture reel the way `renderReel` does and reports frames per second. `frames` renders
// every nth frame on one tab and reports what a frame costs in each scene and in each glide. `stills` writes PNGs:
// the review stills of a board, and frames of the fixture reel as it plays. `compare` sets two such folders
// against each other, pixel by pixel.
//
// Every render forces software rendering (`--gl swiftshader`, or `--gl default` to let Chrome decide), so a laptop
// predicts a server that has no graphics card. `--src` names a copy of `src/` to bundle instead of the working
// tree and may be given more than once: the versions are then rendered turn about in one browser, which is the
// only fair comparison on a machine that is doing other work. A copy has to sit inside this package so that it
// resolves the same modules: `git archive <commit> src | tar -x -C .bench/<name>`.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderFrames, renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import type { LineTiming, Storyboard } from '@dailies/core';
import { COMPOSITION_ID, HEIGHT, WIDTH, type ReelProps } from '../src/remotion/config';
import { lensPath } from '../src/remotion/lens';
import { stillName } from '../src/render';
import { buildTimeline, type Timeline } from '../src/timeline';
import { fixtureStoryboard, fixtureTimings, realStoryboard, realTimings, stressStoryboard, stressTimings } from './fixture';

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const TIMEOUT_MS = 240_000;
const BOARDS: Record<string, () => { storyboard: Storyboard; timings: LineTiming[] }> = {
  fixture: () => ({ storyboard: fixtureStoryboard(), timings: fixtureTimings() }),
  stress: () => ({ storyboard: stressStoryboard(), timings: stressTimings() }),
  real: () => ({ storyboard: realStoryboard(), timings: realTimings() }),
};

type Gl = 'swiftshader' | 'swangle' | 'angle' | 'default';
type Browser = Awaited<ReturnType<typeof openBrowser>>;

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags = new Map<string, string[]>();
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
    flags.set(arg.slice(2), [...(flags.get(arg.slice(2)) ?? []), value]);
    i += 1;
  }
  const one = (name: string, fallback: string) => flags.get(name)?.at(-1) ?? fallback;
  return { command, positional, all: (name: string) => flags.get(name) ?? [], one, int: (name: string, fallback: number) => Number.parseInt(one(name, String(fallback)), 10) };
}

/** CPU seconds used so far by every process this one has started and that is still alive: the browser and its helpers. */
function childCpuSeconds(): number {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,time='], { encoding: 'utf8' }).trim().split('\n').map((line) => line.trim().split(/\s+/));
  const children = new Map<string, string[]>();
  const time = new Map<string, number>();
  for (const [pid, ppid, cpu] of rows as [string, string, string][]) {
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
    // `time` is [[dd-]hh:]mm:ss.cc
    const [days, clock] = cpu.includes('-') ? (cpu.split('-') as [string, string]) : ['0', cpu];
    time.set(pid, clock.split(':').reduce((sum, part) => sum * 60 + Number(part), 0) + Number(days) * 86400);
  }
  let total = 0;
  const walk = (pid: string) => { for (const child of children.get(pid) ?? []) { total += time.get(child) ?? 0; walk(child); } };
  walk(String(process.pid));
  return total;
}

interface Version { name: string; serveUrl: string }

/** Bundles each version, opens one browser for all of them, and cleans up after `fn`. */
async function withVersions<T>(sources: string[], gl: Gl, fn: (versions: Version[], browser: Browser) => Promise<T>): Promise<T> {
  const work = mkdtempSync(join(tmpdir(), 'dailies-bench-'));
  let browser: Browser | undefined;
  try {
    const publicDir = join(work, 'public');
    mkdirSync(publicDir);
    const versions: Version[] = [];
    for (const [n, src] of (sources.length > 0 ? sources : ['src']).entries()) {
      const root = resolve(PACKAGE_ROOT, src);
      if (!root.startsWith(PACKAGE_ROOT)) throw new Error(`${src} is outside the package: it would resolve other modules than the working tree does`);
      const name = sources.length > 0 ? basename(root) : 'tree';
      versions.push({ name, serveUrl: await bundle({ entryPoint: join(root, 'remotion', 'index.ts'), publicDir, outDir: join(work, `bundle-${n}`) }) });
    }
    const browserExecutable = process.env.DAILIES_BROWSER_EXECUTABLE || null;
    if (!browserExecutable) await ensureBrowser();
    browser = await openBrowser('chrome', { browserExecutable, chromiumOptions: { gl: gl === 'default' ? null : gl } });
    return await fn(versions, browser);
  } finally {
    await browser?.close({ silent: true });
    rmSync(work, { recursive: true, force: true });
  }
}

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length === 0 ? NaN : (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.ceil((sorted.length - 1) / 2)]!) / 2; };
const fixed = (n: number, digits = 1) => n.toFixed(digits);

/** The whole reel, as `renderReel` renders it: every run of every version in turn, and the frames per second of each. */
async function reel(out: string, sources: string[], gl: Gl, runs: number, board: string, concurrency: number | null) {
  const { storyboard, timings } = BOARDS[board]!();
  const timeline = buildTimeline(storyboard, timings);
  const inputProps: ReelProps = { storyboard, timings, audio: false };
  mkdirSync(out, { recursive: true });
  await withVersions(sources, gl, async (versions, browser) => {
    const results = new Map<string, { seconds: number[]; cpu: number[] }>(versions.map((v) => [v.name, { seconds: [], cpu: [] }]));
    for (let run = 0; run < runs; run++) {
      for (const version of versions) {
        const composition = await selectComposition({ serveUrl: version.serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS });
        const [cpu0, t0] = [childCpuSeconds(), performance.now()];
        await renderMedia({ serveUrl: version.serveUrl, composition, inputProps, codec: 'h264', outputLocation: join(out, `${version.name}.mp4`), puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS, concurrency });
        const seconds = (performance.now() - t0) / 1000;
        const cpu = childCpuSeconds() - cpu0;
        results.get(version.name)!.seconds.push(seconds);
        results.get(version.name)!.cpu.push(cpu);
        console.log(`run ${run + 1} ${version.name}: ${timeline.totalFrames} frames in ${fixed(seconds)} s = ${fixed(timeline.totalFrames / seconds)} fps, ${fixed(cpu)} CPU s`);
      }
    }
    console.log(`\n${board} reel, ${timeline.totalFrames} frames, gl=${gl}, concurrency=${concurrency ?? 'default'}`);
    for (const [name, r] of results) {
      console.log(`${name.padEnd(12)} best ${fixed(timeline.totalFrames / Math.min(...r.seconds))} fps, median ${fixed(timeline.totalFrames / median(r.seconds))} fps, ${fixed(median(r.cpu))} CPU s (${fixed((median(r.cpu) / timeline.totalFrames) * 1000, 0)} ms a frame)`);
    }
  });
}

/** What part of the reel each frame belongs to: a scene at rest, or the glide into a scene. */
function partsOf(storyboard: Storyboard, timeline: Timeline): (frame: number) => string {
  const path = lensPath(timeline, storyboard, { captions: true });
  return (frame) => {
    const glide = path.transitions.findIndex((t) => frame > t.start && frame < t.end);
    if (glide >= 0) return `${String(glide + 1).padStart(2, '0')}→ glide into ${storyboard.scenes[glide + 1]!.type}`;
    const index = timeline.scenes.findIndex((slot) => frame >= slot.startFrame && frame < slot.startFrame + slot.durationInFrames);
    return `${String(index).padStart(2, '0')}  ${storyboard.scenes[index]!.type}`;
  };
}

/** Every nth frame on one tab, each version in turn: the cost of a frame by part of the reel, as the fastest of the runs. */
async function frames(out: string, sources: string[], gl: Gl, runs: number, every: number, board: string) {
  const { storyboard, timings } = BOARDS[board]!();
  const timeline = buildTimeline(storyboard, timings);
  const inputProps: ReelProps = { storyboard, timings, audio: false };
  const partOf = partsOf(storyboard, timeline);
  await withVersions(sources, gl, async (versions, browser) => {
    const best = new Map<string, Map<number, number>>(versions.map((v) => [v.name, new Map()]));
    const cpu = new Map<string, number[]>(versions.map((v) => [v.name, []]));
    for (let run = 0; run < runs; run++) {
      for (const version of versions) {
        const composition = await selectComposition({ serveUrl: version.serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS });
        const outputDir = join(out, `frames-${version.name}`);
        rmSync(outputDir, { recursive: true, force: true });
        mkdirSync(outputDir, { recursive: true });
        const cpu0 = childCpuSeconds();
        const times = best.get(version.name)!;
        await renderFrames({
          serveUrl: version.serveUrl, composition, inputProps, outputDir, imageFormat: 'jpeg', concurrency: 1, everyNthFrame: every, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS,
          onStart: () => undefined,
          onFrameUpdate: (_done, frame, ms) => { times.set(frame, Math.min(times.get(frame) ?? Infinity, ms)); },
        });
        cpu.get(version.name)!.push(childCpuSeconds() - cpu0);
        console.log(`run ${run + 1} ${version.name}: ${fixed(cpu.get(version.name)!.at(-1)!)} CPU s`);
      }
    }
    const parts = [...new Set([...best.values().next().value!.keys()].sort((a, b) => a - b).map(partOf))].sort();
    console.log(`\n${board} reel, every ${every}th frame on one tab, gl=${gl}: ms a frame (fastest of ${runs})`);
    console.log(`${'part'.padEnd(28)}${'frames'.padStart(7)}${versions.map((v) => v.name.padStart(12)).join('')}`);
    const row = (label: string, keep: (frame: number) => boolean) => {
      const cells = versions.map((v) => { const ms = [...best.get(v.name)!].filter(([frame]) => keep(frame)).map(([, t]) => t); return { n: ms.length, mean: ms.reduce((a, b) => a + b, 0) / Math.max(1, ms.length) }; });
      console.log(`${label.padEnd(28)}${String(cells[0]!.n).padStart(7)}${cells.map((c) => fixed(c.mean, 0).padStart(12)).join('')}`);
    };
    for (const part of parts) row(part, (frame) => partOf(frame) === part);
    row('all', () => true);
    for (const v of versions) console.log(`${v.name}: ${fixed(Math.min(...cpu.get(v.name)!))} CPU s for the pass (fastest of ${runs})`);
  });
}

/** The review stills of each board (`<board>-settled/NN-type.png`), and frames of the reel as it plays (`<board>-playing/fNNNN.png`). */
async function stills(out: string, sources: string[], gl: Gl, boards: string[], picked: number[] | null, every: number) {
  if (sources.length > 1) throw new Error('stills takes one --src: give each version its own --out');
  await withVersions(sources, gl, async ([version], browser) => {
    for (const board of boards) {
      const { storyboard, timings } = BOARDS[board]!();
      const timeline = buildTimeline(storyboard, timings);
      const path = lensPath(timeline, storyboard, { captions: true });
      const shoot = async (inputProps: ReelProps, list: { frame: number; file: string }[], dir: string) => {
        mkdirSync(dir, { recursive: true });
        const composition = await selectComposition({ serveUrl: version!.serveUrl, id: COMPOSITION_ID, inputProps, puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS });
        for (const { frame, file } of list) {
          await renderStill({ serveUrl: version!.serveUrl, composition, inputProps, frame, output: join(dir, file), imageFormat: 'png', puppeteerInstance: browser, timeoutInMilliseconds: TIMEOUT_MS });
        }
        console.log(`${dir}: ${list.length} stills`);
      };
      const middles = timeline.scenes.map((slot, n) => ({ frame: slot.startFrame + Math.floor(slot.durationInFrames / 2), file: stillName(n, storyboard.scenes[n]!.type) }));
      await shoot({ storyboard, timings, audio: false, settled: true }, middles, join(out, `${board}-settled`));
      // As it plays: every nth frame, and four frames across each glide, where the film moves and the glass pulls focus.
      const playing = picked ?? [...new Set([
        ...Array.from({ length: Math.ceil(timeline.totalFrames / every) }, (_, i) => i * every),
        ...path.transitions.flatMap((t) => [t.start + 3, t.cut - 2, t.cut + 2, Math.round((t.cut + t.end) / 2)]),
      ])].filter((frame) => frame >= 0 && frame < timeline.totalFrames).sort((a, b) => a - b);
      await shoot({ storyboard, timings, audio: false }, playing.map((frame) => ({ frame, file: `f${String(frame).padStart(4, '0')}.png` })), join(out, `${board}-playing`));
    }
  });
}

const pixels = (file: string): Buffer => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: WIDTH * HEIGHT * 3 + 1024 });

const walk = (dir: string, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith('.png') ? [`${prefix}${e.name}`] : [])).sort();

/**
 * Two folders of stills, pixel by pixel. For each pair: the largest difference in any channel (0..255), the mean
 * difference, the share of pixels that differ by more than 8 and by more than 24, and the box those lie in.
 * With `sheets`, a pair that differs at all is also written side by side with its difference, eight times amplified.
 */
function compare(a: string, b: string, sheets: string | null) {
  const names = walk(a).filter((name) => walk(b).includes(name));
  if (names.length === 0) throw new Error('the two folders share no still');
  console.log(`${'still'.padEnd(34)}${'max'.padStart(5)}${'mean'.padStart(8)}${'>8'.padStart(9)}${'>24'.padStart(9)}  box of >8`);
  const worst = { max: 0, mean: 0, over8: 0, over24: 0 };
  for (const name of names) {
    const [pa, pb] = [pixels(join(a, name)), pixels(join(b, name))];
    if (pa.length !== pb.length) throw new Error(`${name}: the two stills are not the same size`);
    let max = 0;
    let sum = 0;
    let over8 = 0;
    let over24 = 0;
    const box = { x0: WIDTH, y0: HEIGHT, x1: -1, y1: -1 };
    for (let p = 0; p < pa.length; p += 3) {
      const d = Math.max(Math.abs(pa[p]! - pb[p]!), Math.abs(pa[p + 1]! - pb[p + 1]!), Math.abs(pa[p + 2]! - pb[p + 2]!));
      sum += d;
      if (d > max) max = d;
      if (d > 8) {
        over8 += 1;
        const [x, y] = [(p / 3) % WIDTH, Math.floor(p / 3 / WIDTH)];
        box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
      }
      if (d > 24) over24 += 1;
    }
    const count = pa.length / 3;
    const share = (n: number) => `${fixed((n / count) * 100, 3)}%`;
    console.log(`${name.padEnd(34)}${String(max).padStart(5)}${fixed(sum / count, 3).padStart(8)}${share(over8).padStart(9)}${share(over24).padStart(9)}  ${over8 > 0 ? `${box.x0},${box.y0} to ${box.x1},${box.y1}` : '-'}`);
    worst.max = Math.max(worst.max, max); worst.mean = Math.max(worst.mean, sum / count); worst.over8 = Math.max(worst.over8, over8 / count); worst.over24 = Math.max(worst.over24, over24 / count);
    if (sheets && max > 0) {
      const file = join(sheets, `${name.replace(/\//g, '--').replace(/\.png$/, '')}.jpg`);
      mkdirSync(sheets, { recursive: true });
      const graph = '[0][1]blend=all_mode=difference,eq=contrast=1,lutrgb=r=clipval*8:g=clipval*8:b=clipval*8[d];[0][1][d]hstack=inputs=3';
      const made = spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', join(a, name), '-i', join(b, name), '-filter_complex', graph, '-q:v', '2', file], { encoding: 'utf8' });
      if (made.status !== 0) throw new Error(`ffmpeg could not write ${file}: ${made.stderr}`);
    }
  }
  console.log(`\n${names.length} pairs. Worst: max ${worst.max}, mean ${fixed(worst.mean, 3)}, ${fixed(worst.over8 * 100, 3)}% over 8, ${fixed(worst.over24 * 100, 3)}% over 24`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gl = args.one('gl', 'swiftshader') as Gl;
  const out = resolve(args.one('out', join(tmpdir(), 'dailies-bench')));
  const boards = args.all('board').length > 0 ? args.all('board') : ['fixture'];
  for (const board of boards) if (!BOARDS[board]) throw new Error(`no board called ${board}: ${Object.keys(BOARDS).join(', ')}`);
  switch (args.command) {
    case 'reel': return reel(out, args.all('src'), gl, args.int('runs', 1), boards[0]!, args.all('concurrency').length > 0 ? args.int('concurrency', 1) : null);
    case 'frames': return frames(out, args.all('src'), gl, args.int('runs', 1), args.int('every', 5), boards[0]!);
    case 'stills': return stills(out, args.all('src'), gl, boards, args.all('frames').length > 0 ? args.one('frames', '').split(',').map(Number) : null, args.int('every', 30));
    case 'compare': {
      const [a, b] = args.positional;
      if (!a || !b) throw new Error('compare needs two folders');
      return compare(resolve(a), resolve(b), args.all('sheets').length > 0 ? resolve(args.one('sheets', '')) : null);
    }
    default: throw new Error('usage: bench.ts reel|frames|stills|compare (see the head of this file)');
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; });
