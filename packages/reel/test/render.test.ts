import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureBrowser } from '@remotion/renderer';
import { buildTimeline, renderReel, renderStills, toSrt } from '../src/index';
import { fixtureStoryboard, fixtureTimings, shortStoryboard, stressStoryboard, stressTimings } from './fixture';

const RENDER_TIMEOUT = 120_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

interface Probe { streams: { codec_type: string; codec_name: string; width?: number; height?: number }[]; format: { duration: string } }
const probe = (path: string): Probe =>
  JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', path], { encoding: 'utf8' }));

/** The review stage's own check: black segments of half a second or more. */
const blackSegments = (path: string): string[] =>
  (spawnSync('ffmpeg', ['-i', path, '-vf', 'blackdetect=d=0.5', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/black_start:\S+/g) ?? []);

/** A mono 16-bit WAV holding a 440 Hz tone, the format the voice stage writes. */
function writeTone(path: string, seconds: number, sampleRate = 24000): void {
  const samples = Math.round(seconds * sampleRate);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * n) / sampleRate) * 12000), 44 + n * 2);
  writeFileSync(path, buf);
}

const dirs: string[] = [];
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'dailies-reel-test-')); dirs.push(d); return d; };

// The first run on a machine downloads Chrome Headless Shell; that is not part of any test's budget.
beforeAll(async () => { await ensureBrowser(); }, 600_000);
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('renderReel', () => {
  it('renders the fixture storyboard to a 1080p h264 MP4 with subtitles and a poster', async () => {
    const sb = fixtureStoryboard();
    const timings = fixtureTimings();
    const outDir = join(scratch(), 'nested', 'reel');   // does not exist yet

    const artifact = await renderReel({ storyboard: sb, timings, audioPath: null, outDir });

    const { totalFrames } = buildTimeline(sb, timings);
    expect(artifact).toEqual({ videoPath: join(outDir, 'reel.mp4'), srtPath: join(outDir, 'reel.srt'), posterPath: join(outDir, 'poster.png'), durationSec: totalFrames / 30 });

    const info = probe(artifact.videoPath);
    expect(info.streams.find((s) => s.codec_type === 'video')).toMatchObject({ codec_name: 'h264', width: 1920, height: 1080 });
    expect(Math.abs(Number(info.format.duration) - totalFrames / 30)).toBeLessThan(0.2);
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(false);
    expect(blackSegments(artifact.videoPath)).toEqual([]);

    expect(readFileSync(artifact.srtPath, 'utf8')).toBe(toSrt(sb, timings, 2.5));
    expect(readFileSync(artifact.posterPath).subarray(0, 4)).toEqual(PNG_MAGIC);
    expect(probe(artifact.posterPath).streams[0]).toMatchObject({ width: 1920, height: 1080 });
  }, RENDER_TIMEOUT);

  it('muxes the narration into the video when there is audio', async () => {
    const dir = scratch();
    const audioPath = join(dir, 'voice.wav');
    writeTone(audioPath, 2);

    const artifact = await renderReel({ storyboard: shortStoryboard(), timings: [{ lineId: 'l1', startSec: 0, endSec: 2 }], audioPath, outDir: join(dir, 'reel') });

    expect(existsSync(join(dir, 'reel', 'public', 'narration.wav'))).toBe(true);
    const info = probe(artifact.videoPath);
    expect(info.streams.some((s) => s.codec_type === 'audio')).toBe(true);
    expect(Math.abs(Number(info.format.duration) - artifact.durationSec)).toBeLessThan(0.2);

    // The tone runs from the end of the title (2.5 s) for two seconds, with silence on either side of it.
    const stderr = spawnSync('ffmpeg', ['-i', artifact.videoPath, '-af', 'silencedetect=noise=-40dB:d=0.3', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
    const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
    expect(ends[0]).toBeGreaterThan(2.3);
    expect(ends[0]).toBeLessThan(2.7);
    expect(starts[1]).toBeGreaterThan(4.3);
    expect(starts[1]).toBeLessThan(4.7);
  }, RENDER_TIMEOUT);

  it('fails before rendering when a line has no timing', async () => {
    await expect(renderReel({ storyboard: fixtureStoryboard(), timings: [], audioPath: null, outDir: scratch() })).rejects.toThrow(/no timing for line l1/);
  });
});

describe('renderStills', () => {
  // The stress storyboard has every field at its schema limit, so this also proves no scene throws on its worst input.
  it('writes one 1080p PNG per scene, in scene order', async () => {
    const sb = stressStoryboard();
    const outDir = join(scratch(), 'stills');

    const stills = await renderStills({ storyboard: sb, timings: stressTimings(), outDir });

    expect(stills.map((s) => s.sceneId)).toEqual(sb.scenes.map((s) => s.id));
    expect(new Set(stills.map((s) => s.path)).size).toBe(sb.scenes.length);
    for (const still of stills) {
      expect(still.path.startsWith(outDir)).toBe(true);
      expect(readFileSync(still.path).subarray(0, 4)).toEqual(PNG_MAGIC);
      expect(probe(still.path).streams[0]).toMatchObject({ width: 1920, height: 1080 });
    }
  }, RENDER_TIMEOUT);
});
